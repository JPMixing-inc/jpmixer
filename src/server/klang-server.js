'use strict';

// ── KLANG (for dLive consoles) server — a third, independent backend ───────
// Speaks the exact same browser-facing WebSocket dialect osc-server.js and
// dlive-server.js do (including OSC-address-shaped {address,args} messages)
// so mixer.js, monitor.js, and devices.js work completely unmodified.
// Never imported by, and never imports, osc-server.js or dlive-server.js.
//
// WHY "for dLive consoles" specifically: KLANG is an outboard 3D in-ear
// processor that sits *alongside* a console, not instead of one — it needs
// its own dedicated multitrack audio feed, patched at the audio level
// entirely outside JPMixer's control. This backend targets the specific,
// common rig shape of a dLive console paired with a KLANG unit: musicians'
// faders drive KLANG's own per-channel mix gain directly (KLANG's mix is
// what they actually hear), while a secondary, read-only connection to the
// paired dLive console supplies channel names and drives Ear Scene recall
// off the console's own snapshot changes — both by reusing DliveClient from
// dlive-client.js as-is, never its send-level/fader-write methods.
//
// SCOPE (deliberately not full parity with KLANG:app):
//   ✓ Musician mix control: channel gain, mute, solo (KLANG has real native
//     per-channel-per-mix mute/solo — no "drive the level to -inf" trick
//     needed here, unlike the DiGiCo/dLive paths)
//   ✓ Pan, via KLANG's stereo-mode azimuth (-90..90) — mixer.js's existing
//     pan UI works unmodified since this is the one backand that reports
//     `stereo: true` per aux
//   ✓ My Mixes, Devices View — console-agnostic, work the same as elsewhere
//   ✓ Ear Scenes, IF the secondary dLive connection is configured — keyed by
//     dLive scene number, same scheme the plain dLive backend uses
//   ✗ Built-in aux EQ, Console Controller — not implemented (same as dLive)
//   ✗ 3D/i3D positioning — only the stereo-mode azimuth pan model, see
//     klang-protocol.js's file header for why
//   ✗ OSC/MIDI traffic log recording
//
// IMPORTANT ARCHITECTURAL LIMIT, inherited from klang-client.js: KLANG's OSC
// control surface has no documented read-back for a channel's actual gain/
// pan/mute state — only continuous meters, and only via a handshake/relay
// mechanism this integration doesn't implement (see klang-protocol.js).
// Every value this file tracks (levelCache, muteState, soloState) is purely
// "the last value JPMixer itself sent" — never confirmed by the hardware.
// If a musician also has the real KLANG:app open changing the same mix,
// JPMixer has no way to detect or reconcile that divergence.

const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');
const scenes    = require('./scenes');
const presets   = require('./presets');
const shared    = require('./shared-handlers');
const config    = require('./config');
const { mountGreenRoom } = require('./greenroom');
const { KlangClient } = require('./klang-client');
const { DliveClient } = require('./dlive-client');

let httpServer = null;
let wss        = null;
let klang      = null; // KlangClient — the actual mix control connection
let dlive      = null; // DliveClient, optional — channel names + scene sync only
let serverCfg  = {};
let connections = [];
let pingInterval = null;

let onConsoleStatusChange = null;
let onConnectionCountChange = null;
let onServerError = null;
let onOscTraffic = null; // accepted for interface parity, never fired — no traffic log in this pass

const eventLog = [];
function logEvent(type, detail) {
  eventLog.push({ t: new Date().toISOString(), type, detail });
  if (eventLog.length > 100) eventLog.shift();
  console.log(`[JPMixer/KLANG] ${type}: ${detail}`);
}

// ── State ────────────────────────────────────────────────────────────────
let currentSceneNumber = null; // from the paired dLive console, if connected
const levelCache  = new Map(); // "ch:aux" -> dB, last value WE sent (see file header)
const panCache    = new Map(); // "ch:aux" -> 0..1 slider value, same caveat
const nameCache   = new Map(); // "input:N" -> name, from the dLive side only
const muteState   = {};        // muteState[aux][ch]
const soloState   = {};        // soloState[aux][ch]

function levelKey(ch, aux) { return `${ch}:${aux}`; }

// 0..1 slider value (mixer.js's own representation) <-> KLANG's -90..90
// stereo-mode azimuth. DiGiCo/dLive's own send_pan already carries a 0..1
// value straight through with no conversion; KLANG needs degrees.
function sliderToAzimuth(v) { return (v - 0.5) * 180; }
function azimuthToSlider(deg) { return deg / 180 + 0.5; }

function broadcastToClients(msg, excludeSocket) {
  const payload = typeof msg === 'string' ? msg : JSON.stringify(msg);
  for (const conn of connections) {
    if (conn !== excludeSocket && conn.readyState === WebSocket.OPEN) conn.send(payload);
  }
}

function getActiveMixerCounts() {
  const counts = {};
  for (const conn of connections) {
    if (conn.readyState === WebSocket.OPEN && conn._activeAux != null) {
      counts[conn._activeAux] = (counts[conn._activeAux] || 0) + 1;
    }
  }
  return counts;
}

function getConnectedDevicesInfo() {
  const devices = [];
  for (const conn of connections) {
    if (conn.readyState === WebSocket.OPEN && (conn._deviceId != null || conn._activeAux != null)) {
      devices.push({
        deviceId: conn._deviceId || null,
        aux: conn._activeAux ?? null,
        lastActivity: conn._lastActivityAt || null,
        lastPong: conn._lastPong || null,
      });
    }
  }
  return devices;
}

function broadcastDevicesUpdate() {
  broadcastToClients({ type: 'devices-update', devices: getConnectedDevicesInfo() });
}

// ── Config builder — same shape osc-server.js's/dlive-server.js's produce ──

function buildConfig() {
  const auxCount = serverCfg.auxes || 16;
  const chCount  = serverCfg.channels || 48;
  const cfgAuxOverrides = serverCfg.auxOverrides || {};
  const cfgOverrides    = serverCfg.channelOverrides || {};
  const cfgGroups       = serverCfg.channelGroups || [];

  const auxilaries = [];
  for (let i = 1; i <= auxCount; i++) {
    const ov = cfgAuxOverrides[String(i)] || {};
    auxilaries.push({
      enabled:   ov.enabled !== false,
      label:     ov.label || `AUX ${i}`,
      channel:   i,
      stereo:    true,  // KLANG's stereo-mode azimuth is a real pan control — see file header
      colour:    ov.colour || '#e8a020',
      icon:      '',
      eqEnabled: false, // aux EQ not implemented for KLANG in this pass
      linkOnly:  ov.linkOnly === true,
    });
  }

  const groupOrder = {};
  cfgGroups.forEach((g, i) => { groupOrder[String(g.id)] = i; });

  const raw = [];
  for (let i = 1; i <= chCount; i++) {
    const ov = cfgOverrides[String(i)] || {};
    const liveName = nameCache.get(`input:${i}`);
    raw.push({
      channel: i,
      enabled: ov.enabled !== false,
      label:   ov.label || liveName || '',
      icon:    ov.icon || '',
      groupId: ov.groupId || null,
      order:   ov.order !== undefined ? ov.order : i,
    });
  }
  raw.sort((a, b) => {
    const ga = a.groupId !== null ? (groupOrder[String(a.groupId)] ?? 9999) : 9999;
    const gb = b.groupId !== null ? (groupOrder[String(b.groupId)] ?? 9999) : 9999;
    if (ga !== gb) return ga - gb;
    return a.order - b.order;
  });

  const channels = [];
  let lastGroupId;
  raw.forEach((ch) => {
    const isFirst = ch.groupId !== lastGroupId;
    lastGroupId = ch.groupId;
    const group = cfgGroups.find(g => String(g.id) === String(ch.groupId));
    channels.push({
      enabled: ch.enabled,
      label: ch.label,
      channel: ch.channel,
      order: channels.length,
      title: (isFirst && group) ? group.name : '',
      icon: ch.icon,
    });
  });

  return JSON.stringify({
    config: {
      channels,
      aux: auxilaries,
      controlGroups: [], // Console Controller not implemented for KLANG
      snapshot: currentSceneNumber != null ? String(currentSceneNumber) : '—',
      sceneRecallEnabled: !!serverCfg.sceneRecallEnabled,
      scenes: scenes.getAll(),
      mutes: muteState,
      solos: soloState,
    },
  });
}

// ── Mute / Solo — real KLANG mute/solo, no level-zeroing trick needed ──────

function applyMuteSolo(aux) {
  broadcastToClients({ type: 'mute-solo-state', aux, mutes: muteState[aux] || {}, solos: soloState[aux] || {}, levels: {} });
}

// Validation lives here (not just in the WS handler) so the External
// Control API (api-server.js) gets the exact same guarantees a browser
// mute button does.
function sendMute(auxRaw, chRaw, on) {
  const aux = parseInt(auxRaw, 10), ch = parseInt(chRaw, 10);
  const chMax = serverCfg.channels || 48, auxMax = serverCfg.auxes || 16;
  if (isNaN(aux) || aux < 1 || aux > auxMax || isNaN(ch) || ch < 1 || ch > chMax) return false;
  if (!muteState[aux]) muteState[aux] = {};
  muteState[aux][ch] = !!on;
  klang && klang.setMute(aux, ch, on);
  applyMuteSolo(aux);
  return true;
}

function sendSolo(auxRaw, chRaw, on) {
  const aux = parseInt(auxRaw, 10), ch = parseInt(chRaw, 10);
  const chMax = serverCfg.channels || 48, auxMax = serverCfg.auxes || 16;
  if (isNaN(aux) || aux < 1 || aux > auxMax || isNaN(ch) || ch < 1 || ch > chMax) return false;
  if (!soloState[aux]) soloState[aux] = {};
  soloState[aux][ch] = !!on;
  klang && klang.setSolo(aux, ch, on);
  applyMuteSolo(aux);
  return true;
}

function fireSnapshot(action) {
  if (currentSceneNumber == null || !dlive) return false; // no paired dLive connection — nothing to fire
  const next = action === 'next' ? currentSceneNumber + 1 : currentSceneNumber - 1;
  if (next < 1 || next > 500) return false;
  dlive.recallScene(next);
  return true;
}

// Live relabeling — see osc-server.js's setChannelLabel/setAuxLabel for the
// full rationale. KLANG mode already supports pulling names from the paired
// dLive console; this is a separate, JPMixer-side override on top of that.
// Live relabeling (Control API / Planning Center) — see shared-handlers.js
function setChannelLabel(n, label) {
  return shared.relabel(serverCfg, 'channel', n, label, 48, broadcastToClients);
}

function setAuxLabel(n, label) {
  return shared.relabel(serverCfg, 'aux', n, label, 16, broadcastToClients);
}

// ── Scene (Ear Scene) recall — keyed by dLive scene NUMBER, same as the
// plain dLive backend, driven purely by the secondary dLive connection ────

function pushValuesToKlang(auxStr, values, pans) {
  const aux = parseInt(auxStr, 10);
  if (!Number.isInteger(aux) || aux < 1) return { levels: {}, pans: {} };
  const outLevels = {}, outPans = {};

  for (const [chStr, sliderVal] of Object.entries(values || {})) {
    const ch = parseInt(chStr, 10);
    if (!Number.isInteger(ch) || ch < 1) continue;
    // values/pans come straight from client-controlled recall-scene/
    // apply-preset payloads — reject non-finite input rather than forward
    // it (same NaN-propagation lesson as the dLive work).
    if (!Number.isFinite(sliderVal) || sliderVal < 0 || sliderVal > 1) continue;
    const db = shared.sliderToDb(sliderVal);
    levelCache.set(levelKey(ch, aux), db);
    outLevels[chStr] = sliderVal;
    klang && klang.setGain(aux, ch, db);
  }
  for (const [chStr, panVal] of Object.entries(pans || {})) {
    const ch = parseInt(chStr, 10);
    if (!Number.isInteger(ch) || ch < 1 || !Number.isFinite(panVal)) continue;
    panCache.set(levelKey(ch, aux), panVal);
    outPans[chStr] = panVal;
    klang && klang.setPan(aux, ch, sliderToAzimuth(panVal));
  }
  return { levels: outLevels, pans: outPans };
}

function applySceneForSceneNumber(sceneNumber) {
  if (!serverCfg.sceneRecallEnabled) { logEvent('scene-skip', `auto-recall disabled — scene:${sceneNumber}`); return; }
  const key = String(sceneNumber);
  const allSaved = scenes.getAll();
  const sceneScenes = allSaved[key];
  if (!sceneScenes) { logEvent('scene-skip', `no scene saved for scene:${sceneNumber}`); return; }

  logEvent('scene-recall', `applying scene ${sceneNumber}`);
  const broadcastLevels = {};
  for (const [auxStr, values] of Object.entries(sceneScenes)) {
    broadcastLevels[auxStr] = pushValuesToKlang(auxStr, values, {}).levels;
  }
  broadcastToClients({ type: 'scene-recalled', snapshot: key, levels: broadcastLevels });
}

// ── Server lifecycle ────────────────────────────────────────────────────

function start(cfg) {
  serverCfg = cfg;
  connections = [];
  currentSceneNumber = null;
  levelCache.clear();
  panCache.clear();
  nameCache.clear();
  Object.keys(muteState).forEach(k => delete muteState[k]);
  Object.keys(soloState).forEach(k => delete soloState[k]);

  const appExpress = express();
  appExpress.use(express.static(path.join(__dirname, '..', 'mixer')));
  mountGreenRoom(appExpress);

  httpServer = http.createServer(appExpress);
  httpServer.on('error', (err) => {
    logEvent('http-error', `${err.code || err.message} — server failed to (re)start on port ${cfg.serverPort}`);
    stop();
    if (onServerError) onServerError(err);
  });

  httpServer.listen(cfg.serverPort, () => {
    console.log(`[JPMixer/KLANG] Web server → http://localhost:${cfg.serverPort}`);
  });

  wss = new WebSocket.Server({ server: httpServer });

  pingInterval = setInterval(() => {
    const now = Date.now();
    for (const conn of connections) {
      if (now - conn._lastPong > 75000) { logEvent('ping-timeout', 'terminating stale client'); conn.terminate(); continue; }
      try { conn.ping(); } catch (_) {}
      try { conn.send(JSON.stringify({ type: 'ping' })); } catch (_) {}
    }
    broadcastDevicesUpdate();
  }, 25000);

  wss.on('connection', (ws) => {
    logEvent('client-connect', `total:${connections.length + 1}`);
    ws._lastPong = Date.now();
    ws.on('pong', () => { ws._lastPong = Date.now(); });
    connections.push(ws);
    if (onConnectionCountChange) onConnectionCountChange(connections.length);
    broadcastToClients({ type: 'connection-count', count: connections.length });

    try {
      ws.send(buildConfig());
      ws.send(JSON.stringify({ type: 'active-mixers', counts: getActiveMixerCounts() }));
      ws.send(JSON.stringify({ type: 'devices-update', devices: getConnectedDevicesInfo() }));
    } catch (_) {}

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch (_) { return; }

      if (msg.type === 'pong') { ws._lastPong = Date.now(); return; }

      if (msg.type === 'request-aux-levels') {
        const chCount = serverCfg.channels || 48;
        for (let ch = 1; ch <= chCount; ch++) {
          const key = levelKey(ch, msg.aux);
          if (levelCache.has(key)) {
            ws.send(JSON.stringify({ address: `/Input_Channels/${ch}/Aux_Send/${msg.aux}/send_level`, args: [levelCache.get(key)] }));
          }
          if (panCache.has(key)) {
            ws.send(JSON.stringify({ address: `/Input_Channels/${ch}/Aux_Send/${msg.aux}/send_pan`, args: [panCache.get(key)] }));
          }
        }
        return;
      }

      if (msg.type === 'request-all-levels') {
        const sendLevels = [];
        for (const [key, db] of levelCache.entries()) {
          const [ch, aux] = key.split(':');
          sendLevels.push({ address: `/Input_Channels/${ch}/Aux_Send/${aux}/send_level`, args: [db] });
        }
        ws.send(JSON.stringify({ type: 'all-levels', levels: sendLevels }));
        return;
      }

      if (msg.type === 'save-scene') {
        const key = (typeof msg.snapshot === 'string' && msg.snapshot) ? msg.snapshot : (currentSceneNumber != null ? String(currentSceneNumber) : null);
        if (!key) return;
        logEvent('scene-save', `scene:"${key}" aux:${msg.aux}`);
        scenes.saveScene(key, msg.aux, msg.values);
        broadcastToClients({ type: 'scene-saved', snapshot: key, aux: msg.aux });
        ws._lastActivityAt = Date.now();
        shared.broadcastActivity(connections, { type: 'device-activity', deviceId: ws._deviceId || null, aux: msg.aux, kind: 'save-scene', snapshot: key }, ws);
        return;
      }
      if (msg.type === 'delete-scene') {
        const key = (typeof msg.snapshot === 'string' && msg.snapshot) ? msg.snapshot : (currentSceneNumber != null ? String(currentSceneNumber) : null);
        if (!key) return;
        scenes.deleteScene(key, msg.aux);
        broadcastToClients({ type: 'scene-deleted', snapshot: key, aux: msg.aux });
        return;
      }
      if (msg.type === 'request-scene') {
        if (!msg.snapshot) return;
        const values = scenes.getScene(msg.snapshot, msg.aux) || {};
        try { ws.send(JSON.stringify({ type: 'scene-values', snapshot: msg.snapshot, aux: msg.aux, values })); } catch (_) {}
        return;
      }
      if (msg.type === 'recall-scene') {
        if (currentSceneNumber == null) return;
        const key = String(currentSceneNumber);
        const saved = scenes.getScene(key, msg.aux);
        if (!saved) return;
        const { levels } = pushValuesToKlang(String(msg.aux), saved, {});
        broadcastToClients({ type: 'scene-recalled', snapshot: key, levels: { [String(msg.aux)]: levels } });
        return;
      }

      if (msg.type === 'set-active-aux') {
        ws._activeAux = (msg.aux === null || msg.aux === undefined) ? null : parseInt(msg.aux, 10);
        broadcastToClients({ type: 'active-mixers', counts: getActiveMixerCounts() });
        broadcastDevicesUpdate();
        return;
      }
      if (msg.type === 'identify') {
        ws._deviceId = msg.deviceId || null;
        broadcastDevicesUpdate();
        return;
      }

      // My Mixes storage/sync, Find My Mixes and the activity feed are the
      // same on every backend — see shared-handlers.js
      if (shared.handleSharedMessage(ws, msg, { logEvent, onActivity: (m, from) => shared.broadcastActivity(connections, m, from) })) return;
      if (msg.type === 'apply-preset') {
        const { levels, pans } = pushValuesToKlang(String(msg.aux), msg.levels || {}, msg.pans || {});
        broadcastToClients({ type: 'preset-loaded', aux: msg.aux, name: msg.name, levels, pans });
        return;
      }

      if (msg.type === 'request-aux-eq') {
        try { ws.send(JSON.stringify({ type: 'aux-eq', aux: msg.aux, eq: {} })); } catch (_) {}
        return;
      }

      if (msg.type === 'set-mute') { sendMute(msg.aux, msg.ch, !!msg.muted); return; }
      if (msg.type === 'set-solo') { sendSolo(msg.aux, msg.ch, !!msg.soloed); return; }
      if (msg.type === 'fire-snapshot') { fireSnapshot(msg.action); return; }

      // Raw OSC-address-shaped messages from mixer.js (send_level / send_pan)
      const oscMsg = msg;
      if (!oscMsg.address) return;
      const ALLOWED_OSC_RE = /^\/Input_Channels\/(\d+)\/Aux_Send\/(\d+)\/send_(level|pan)$/;
      const m = oscMsg.address.match(ALLOWED_OSC_RE);
      if (!m) return; // includes EQ addresses and any query (/?) form — not implemented for KLANG
      const [, chStr, auxStr, kind] = m;
      const ch = parseInt(chStr, 10), aux = parseInt(auxStr, 10);
      if (!Number.isInteger(ch) || ch < 1 || !Number.isInteger(aux) || aux < 1) return;
      const val = Array.isArray(oscMsg.args) ? oscMsg.args[0] : undefined;
      if (typeof val !== 'number') return;

      const key = levelKey(ch, aux);

      if (kind === 'pan') {
        panCache.set(key, val);
        klang && klang.setPan(aux, ch, sliderToAzimuth(val));
        broadcastToClients(oscMsg, ws);
        ws._lastActivityAt = Date.now();
        shared.broadcastActivity(connections, { type: 'device-activity', deviceId: ws._deviceId || null, aux, channel: ch, kind: 'pan', direction: val < 0.5 ? 'left' : val > 0.5 ? 'right' : null }, ws);
        return;
      }

      const prevDb = levelCache.get(key);
      levelCache.set(key, val);
      klang && klang.setGain(aux, ch, val);
      broadcastToClients(oscMsg, ws);

      ws._lastActivityAt = Date.now();
      let direction = null;
      if (typeof prevDb === 'number' && val !== prevDb) direction = val > prevDb ? 'up' : 'down';
      shared.broadcastActivity(connections, { type: 'device-activity', deviceId: ws._deviceId || null, aux, channel: ch, kind: 'level', direction }, ws);
    });

    ws.on('close', () => {
      connections = connections.filter(c => c !== ws);
      if (onConnectionCountChange) onConnectionCountChange(connections.length);
      broadcastToClients({ type: 'connection-count', count: connections.length });
      if (ws._deviceId != null || ws._activeAux != null) broadcastDevicesUpdate();
    });
  });

  // ── KLANG UDP client — the actual mix control connection ────────────────
  if (!cfg.klangIp) {
    logEvent('klang-error', 'KLANG IP Address is not set in the Setup tab — nothing to send mix control to.');
  }
  klang = new KlangClient({ host: cfg.klangIp, port: Number.isInteger(cfg.klangPort) && cfg.klangPort > 0 && cfg.klangPort <= 65535 ? cfg.klangPort : 9110 });
  klang.on('open', () => {
    // See file header: this only confirms the local UDP socket bound, not
    // that a KLANG processor is actually present/reachable at cfg.klangIp.
    logEvent('klang-open', `sending to ${cfg.klangIp}:${klang.port}`);
    if (onConsoleStatusChange) onConsoleStatusChange(true);
  });
  klang.on('error', (err) => logEvent('klang-error', err.message || err.code || String(err)));
  klang.connect();

  // ── Secondary dLive connection — channel names + scene sync only ────────
  // Reuses DliveClient exactly as dlive-server.js does, but never calls any
  // of its send-level/fader/mute-write methods — this backend's mix control
  // is KLANG's job, not dLive's.
  if (cfg.deskIp) {
    const baseN = Number.isInteger(cfg.dliveBaseChannel) ? Math.max(0, Math.min(11, cfg.dliveBaseChannel)) : 0;
    const defaultPort = cfg.dliveTlsEnabled ? 51327 : 51325;
    const midiPort = Number.isInteger(cfg.dliveMidiPort) && cfg.dliveMidiPort > 0 && cfg.dliveMidiPort <= 65535
      ? cfg.dliveMidiPort : defaultPort;
    dlive = new DliveClient({
      host: cfg.deskIp,
      port: midiPort,
      tlsEnabled: !!cfg.dliveTlsEnabled,
      username: cfg.dliveUsername,
      password: cfg.dlivePassword,
      baseChannel: baseN,
    });

    dlive.on('connect', () => logEvent('dlive-connect', cfg.deskIp));
    dlive.on('close', () => logEvent('dlive-disconnect', cfg.deskIp));
    dlive.on('error', (err) => logEvent('dlive-error', err.message || err.code || String(err)));
    dlive.on('name', (ev) => {
      if (ev.midiCh === baseN) nameCache.set(`input:${ev.ch + 1}`, ev.name);
    });
    dlive.on('sceneRecall', (ev) => {
      currentSceneNumber = ev.sceneNumber;
      logEvent('scene-change', `scene:${ev.sceneNumber}`);
      broadcastToClients({ address: '/SnapshotName', args: [String(ev.sceneNumber)] });
      applySceneForSceneNumber(ev.sceneNumber);
    });
    dlive.connect();
  } else {
    logEvent('dlive-skip', 'No paired dLive console IP set — channel names and Ear Scenes will not sync automatically.');
  }
}

function stop() {
  if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
  if (klang) { klang.removeAllListeners(); klang.disconnect(); klang = null; }
  if (dlive) { dlive.removeAllListeners(); dlive.disconnect(); dlive = null; }
  // Same fix as osc-server.js's stop() — wss.close() alone leaves already-
  // upgraded sockets open, detached from the HTTP server's own tracking.
  if (wss) { for (const c of wss.clients) { try { c.terminate(); } catch (_) {} } wss.close(); wss = null; }
  if (httpServer) { httpServer.close(); httpServer = null; }
  if (onConsoleStatusChange) onConsoleStatusChange(false);
  levelCache.clear();
  panCache.clear();
  connections = [];
  console.log('[JPMixer/KLANG] Server stopped');
}

function getChannelNames() {
  const out = {};
  for (const [k, v] of nameCache.entries()) if (k.startsWith('input:')) out[k.slice(6)] = v;
  return out;
}
function getAuxNames() { return {}; } // no live aux-name source for KLANG in this pass
function getChannelCount() { return null; }
function getAuxCount() { return null; }

// See file header: this reports only "did the local UDP socket open", never
// confirmed reachability of an actual KLANG processor.
function isConsoleConnected() { return !!(klang && klang.ready); }
function setConsoleStatusCallback(cb) { onConsoleStatusChange = cb; }
function setConnectionCountCallback(cb) { onConnectionCountChange = cb; }
function getConnectionCount() { return connections.length; }
function setServerErrorCallback(cb) { onServerError = cb; }

// Traffic log / recording — not implemented for KLANG in this pass.
function getOscLog() { return []; }
function setOscTrafficCallback(cb) { onOscTraffic = cb; }
function startOscLogRecording() { return { ok: false, error: 'Traffic recording is not yet implemented for KLANG' }; }
function stopOscLogRecording() { return { ok: false, error: 'Traffic recording is not yet implemented for KLANG' }; }
function getOscLogRecordingStatus() { return { recording: false }; }
function oscLogRecordsFolder() { return null; }

// After Settings merges device groups — see shared-handlers.js
function pushDevicePresets(deviceId) {
  shared.pushDevicePresets(connections, deviceId);
}

module.exports = { pushDevicePresets,
  start, stop, getChannelNames, getAuxNames, getChannelCount, getAuxCount,
  isConsoleConnected, setConsoleStatusCallback, setConnectionCountCallback, getConnectionCount,
  setServerErrorCallback, getOscLog, setOscTrafficCallback,
  startOscLogRecording, stopOscLogRecording, getOscLogRecordingStatus, oscLogRecordsFolder,
  fireSnapshot, setMute: sendMute, setSolo: sendSolo, setChannelLabel, setAuxLabel,
};
