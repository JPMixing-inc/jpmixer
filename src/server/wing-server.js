'use strict';

// ── Behringer WING server — a fourth, independent backend ──────────────────
// Speaks the exact same browser-facing WebSocket dialect osc-server.js,
// dlive-server.js, and klang-server.js do, so mixer.js, monitor.js, and
// devices.js work completely unmodified. Never imported by, and never
// imports, any of the other three.
//
// UNLIKE dLive/KLANG: WING is a single, self-contained console — no paired
// secondary connection needed (KLANG needs one to a dLive console for
// channel names/scene sync; WING has its own channel names and no scene
// data to sync at all, see below). It also has a real synchronous GET, used
// here for connection liveness and one-time name priming — genuinely
// stronger footing than either of the other two new backends.
//
// WHY NO EAR SCENES: WING's OSC layer doesn't expose scene/snapshot ("event")
// recall at all — see wing-protocol.js's file header. There's no live
// "current snapshot" signal to key an Ear Scene off of, so currentSnapshot
// stays permanently null here; the existing save-scene/recall-scene handlers
// already no-op gracefully on a null key (same as any other backend before
// its first snapshot arrives), so this isn't a special case, just a
// permanent one. My Mixes and Devices View are unaffected — neither depends
// on snapshot identity.
//
// SCOPE (deliberately not full parity):
//   ✓ Musician mix control: per-send level, a REAL per-send mute (WING's
//     send.N.on flag — no "-inf trick" needed, unlike DiGiCo/dLive)
//   ✓ Pan, via WING's real per-send pan parameter — mixer.js's existing pan
//     UI works unmodified since this reports `stereo: true` per aux
//   ✓ My Mixes, Devices View
//   ✗ Ear Scenes (see above), built-in aux EQ, Console Controller
//
// Channel/bus counts: WING's marketing copy says "48-channel, 28-bus", but
// the OSC doc's own default-tree appendix enumerates ch 1-40 and bus 1-16 —
// see wing-protocol.js's file header for why this file doesn't hardcode a
// ceiling either way. Settings' Channels/Auxes fields are the only source
// of truth.

const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');
const scenes    = require('./scenes');
const presets   = require('./presets');
const shared    = require('./shared-handlers');
const config    = require('./config');
const { mountGreenRoom } = require('./greenroom');
const { mountBranding } = require('./branding');
const { mountPerformerAssignments } = require('./performer-assignments');
const { mountFoh } = require('./foh');
const { WingClient } = require('./wing-client');
const { createPacedWriter } = require('./paced-writer');
// Presets, mute/solo and their on/off queries go through this — see
// paced-writer.js. A musician's own fader/pan move stays direct.
const pacer = createPacedWriter();

let httpServer = null;
let wss        = null;
let wing       = null;
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
  console.log(`[JPMixer/WING] ${type}: ${detail}`);
}

// ── State ────────────────────────────────────────────────────────────────
const currentSnapshot = null; // see file header — WING has no scene signal, this never changes
const levelCache = new Map(); // "ch:aux" -> dB, last value WE sent (SET has no per-write confirmation to key off — see wing-client.js)
const panCache   = new Map(); // "ch:aux" -> -90..90 pan value
const nameCache  = new Map(); // "input:N" -> name, from a real GET on connect
const muteState  = {};        // muteState[aux][ch]
const soloState  = {};        // soloState[aux][ch]
// Sends JPMixer is holding off for a mute/solo: key -> { wasOn }. wasOn is
// null while asking the console, true if JPMixer switched it off, false if
// it was already off (so a release must leave it off).
const silencedSends = new Map();
// Releases (send back on) not yet followed by a good liveness check: key ->
// when. UDP to a console that's gone just vanishes, so these are sent again
// when it's back; an unmute during a drop used to leave the send off.
const recentReleases = new Map();

function levelKey(ch, aux) { return `${ch}:${aux}`; }
function sliderToAzimuth(v) { return (v - 0.5) * 180; } // matches klang-server.js's own convention

// Tracks the real round-trip result from checkConnected(), not just whether
// the local UDP socket opened (wing.ready) — see the 'open' handler in
// start() below, and isConsoleConnected()'s own comment.
let consoleConnected = false;

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

// ── Config builder — same shape the other three backends produce ──────────

function buildConfig() {
  const auxCount = serverCfg.auxes || 16;
  const chCount  = serverCfg.channels || 40;
  const cfgAuxOverrides = serverCfg.auxOverrides || {};

  const auxilaries = [];
  for (let i = 1; i <= auxCount; i++) {
    const ov = cfgAuxOverrides[String(i)] || {};
    auxilaries.push({
      enabled:   ov.enabled !== false,
      label:     ov.label || shared.consoleNameOr(serverCfg, 'auxes', i, undefined) || `AUX ${i}`,
      channel:   i,
      stereo:    true,  // WING has a real per-send pan — see file header
      colour:    ov.colour || '#e8a020',
      icon:      '',
      eqEnabled: false, // aux EQ not implemented for WING in this pass
      linkOnly:  ov.linkOnly === true,
      groups:    shared.auxGroupNames(ov, serverCfg),
    });
  }

  const channels = shared.buildChannelList(chCount, serverCfg, i => nameCache.get(`input:${i}`));

  return JSON.stringify({
    config: {
      channels,
      aux: auxilaries,
      controlGroups: [], // Console Controller not implemented for WING
      snapshot: '—', // see file header — WING has no scene/snapshot signal
      sceneRecallEnabled: false,
      earScenes: serverCfg.performerEarScenes !== false, // Settings: Ear Scenes on performer phones
      scenes: scenes.getAll(),
      mutes: muteState,
      solos: soloState,
    },
  });
}

// ── Mute / Solo — real WING per-send mute, no level-zeroing trick needed ──

function applyMuteSolo(aux) {
  broadcastToClients({ type: 'mute-solo-state', aux, mutes: muteState[aux] || {}, solos: soloState[aux] || {}, levels: {} });
}

// Validation lives here (not just in the WS handler) so the External
// Control API (api-server.js) gets the exact same guarantees a browser
// mute button does.
function sendMute(auxRaw, chRaw, on) {
  const aux = parseInt(auxRaw, 10), ch = parseInt(chRaw, 10);
  const chMax = serverCfg.channels || 40, auxMax = serverCfg.auxes || 16;
  if (isNaN(aux) || aux < 1 || aux > auxMax || isNaN(ch) || ch < 1 || ch > chMax) return false;
  if (!muteState[aux]) muteState[aux] = {};
  muteState[aux][ch] = !!on;
  applySilencing(aux);
  applyMuteSolo(aux);
  return true;
}

function sendSolo(auxRaw, chRaw, on) {
  const aux = parseInt(auxRaw, 10), ch = parseInt(chRaw, 10);
  const chMax = serverCfg.channels || 40, auxMax = serverCfg.auxes || 16;
  if (isNaN(aux) || aux < 1 || aux > auxMax || isNaN(ch) || ch < 1 || ch > chMax) return false;
  if (!soloState[aux]) soloState[aux] = {};
  soloState[aux][ch] = !!on;
  applySilencing(aux);
  applyMuteSolo(aux);
  return true;
}

function fireSnapshot() { return false; } // no scene signal for WING — see file header

// Live relabeling — see osc-server.js's setChannelLabel/setAuxLabel for the
// full rationale (Planning Center connector use case).
// Live relabeling (Control API / Planning Center) — see shared-handlers.js
function setChannelLabel(n, label) {
  return shared.relabel(serverCfg, 'channel', n, label, serverCfg.channels || 40, broadcastToClients);
}

function setAuxLabel(n, label) {
  return shared.relabel(serverCfg, 'aux', n, label, serverCfg.auxes || 16, broadcastToClients);
}

// Re-derives every configured channel's send.on state for this aux from the
// current mute/solo state — WING's send.on is a real per-send toggle, so
// (unlike DiGiCo/dLive's -inf trick) this never has to touch or remember a
// "pre-mute level" at all.
function applySilencing(aux) {
  if (!wing) return;
  const anySolo = Object.values(soloState[aux] || {}).some(v => v);
  for (let ch = 1; ch <= (serverCfg.channels || 40); ch++) {
    const key = levelKey(ch, aux);
    const muted = !!(muteState[aux]?.[ch]);
    const soloed = !!(soloState[aux]?.[ch]);
    const silenced = muted || (anySolo && !soloed);
    const entry = silencedSends.get(key);
    if (silenced && !entry) {
      // Ask first: a send the engineer had switched off must stay off when
      // the mute/solo is released, not come back on with it.
      const pending = { wasOn: null };
      silencedSends.set(key, pending);
      const client = wing;
      pacer.write(`geton:${key}`, () => client.getSendOn(ch, aux).then((on) => {
        if (wing !== client || silencedSends.get(key) !== pending) return; // released or stopped meanwhile
        pending.wasOn = on !== false; // no answer: assume on, so it's still silenced
        if (pending.wasOn) pacer.write(`on:${key}`, () => client.setSendOn(ch, aux, false), true);
      }), true);
      recentReleases.delete(key);
    } else if (silenced && entry.wasOn) {
      pacer.write(`on:${key}`, () => wing && wing.setSendOn(ch, aux, false), true); // re-assert
    } else if (!silenced && entry) {
      silencedSends.delete(key);
      pacer.cancel(`geton:${key}`); // not asked yet: nothing was switched off
      if (entry.wasOn) {
        pacer.write(`on:${key}`, () => wing && wing.setSendOn(ch, aux, true), true);
        recentReleases.set(key, Date.now());
      }
    }
  }
}

// ── Paced name priming on connect — one query per tick, same discipline
// established elsewhere in this app (see osc-server.js's primeCache and
// dlive-server.js's startPriming for why this matters even though WING has
// no documented crash history to point to specifically) ───────────────────
let primeQueue = [];
let primeTimer = null;
function enqueuePrime(fn) { primeQueue.push(fn); }
// Every real call site enqueues the whole batch, then calls startPriming()
// once — calling stopPriming() first here would clear primeQueue before the
// interval ever fires (found and fixed as a real, previously-shipped bug in
// dlive-server.js's identical pattern — see that file's comment).
function startPriming() {
  if (primeTimer) return; // already running — a fresh enqueue just extends the same queue
  primeTimer = setInterval(() => {
    const fn = primeQueue.shift();
    if (fn) fn();
    if (primeQueue.length === 0) stopPriming();
  }, 75);
}
function stopPriming() {
  if (primeTimer) { clearInterval(primeTimer); primeTimer = null; }
  primeQueue = [];
}

// ── Server lifecycle ────────────────────────────────────────────────────

function start(cfg) {
  serverCfg = cfg;
  connections = [];
  consoleConnected = false;
  levelCache.clear();
  pacer.clear();
  panCache.clear();
  nameCache.clear();
  silencedSends.clear();
  recentReleases.clear();
  Object.keys(muteState).forEach(k => delete muteState[k]);
  Object.keys(soloState).forEach(k => delete soloState[k]);

  const appExpress = express();
  require('./access').mountOneTimeLinks(appExpress); // a browser opened from Settings: this computer's pass
  appExpress.use(express.static(path.join(__dirname, '..', 'mixer')));
  mountGreenRoom(appExpress);
  mountBranding(appExpress);
  mountPerformerAssignments(appExpress);
  mountFoh(appExpress, { isConsoleConnected, getConnectionCount });

  httpServer = http.createServer(appExpress);
  httpServer.on('error', (err) => {
    logEvent('http-error', `${err.code || err.message} — server failed to (re)start on port ${cfg.serverPort}`);
    stop();
    if (onServerError) onServerError(err);
  });

  httpServer.listen(cfg.serverPort, () => {
    console.log(`[JPMixer/WING] Web server → http://localhost:${cfg.serverPort}`);
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

    ws.on('message', shared.guarded(logEvent, (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch (_) { return; }

      if (msg.type === 'pong') { ws._lastPong = Date.now(); return; }

      if (msg.type === 'request-aux-levels') {
        const chCount = serverCfg.channels || 40;
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

      // save-scene/delete-scene/request-scene/recall-scene: currentSnapshot
      // is permanently null for WING (see file header) — these already
      // no-op gracefully on a null key, same as any other backend before
      // its first snapshot arrives, so no special-casing needed here.
      if (msg.type === 'save-scene') {
        const key = (typeof msg.snapshot === 'string' && msg.snapshot) ? msg.snapshot : currentSnapshot;
        if (!key) return;
        if (!scenes.saveScene(key, msg.aux, msg.values)) return; // not a mix number, or no fader values
        broadcastToClients({ type: 'scene-saved', snapshot: key, aux: msg.aux });
        return;
      }
      if (msg.type === 'delete-scene') {
        const key = (typeof msg.snapshot === 'string' && msg.snapshot) ? msg.snapshot : currentSnapshot;
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
        const aux = parseInt(msg.aux, 10);
        const chMax = serverCfg.channels || 40;
        const outLevels = {}, outPans = {};
        if (Number.isInteger(aux) && aux >= 1 && aux <= (serverCfg.auxes || 16)) {
          for (const [chStr, sliderVal] of Object.entries(msg.levels || {})) {
            const ch = parseInt(chStr, 10);
            if (!Number.isInteger(ch) || ch < 1 || ch > chMax || !Number.isFinite(sliderVal) || sliderVal < 0 || sliderVal > 1) continue;
            const db = shared.sliderToDb(sliderVal);
            levelCache.set(levelKey(ch, aux), db);
            outLevels[chStr] = sliderVal;
            pacer.write(`lvl:${ch}:${aux}`, () => wing && wing.setSendLevel(ch, aux, db));
          }
          for (const [chStr, panVal] of Object.entries(msg.pans || {})) {
            const ch = parseInt(chStr, 10);
            if (!Number.isInteger(ch) || ch < 1 || ch > chMax || !Number.isFinite(panVal) || panVal < 0 || panVal > 1) continue;
            panCache.set(levelKey(ch, aux), panVal);
            outPans[chStr] = panVal;
            pacer.write(`pan:${ch}:${aux}`, () => wing && wing.setSendPan(ch, aux, sliderToAzimuth(panVal)));
          }
        }
        broadcastToClients({ type: 'preset-loaded', aux: msg.aux, name: msg.name, levels: outLevels, pans: outPans });
        return;
      }

      if (msg.type === 'request-aux-eq') {
        try { ws.send(JSON.stringify({ type: 'aux-eq', aux: msg.aux, eq: {} })); } catch (_) {}
        return;
      }

      if (msg.type === 'set-mute') { sendMute(msg.aux, msg.ch, !!msg.muted); return; }
      if (msg.type === 'set-solo') { sendSolo(msg.aux, msg.ch, !!msg.soloed); return; }
      if (msg.type === 'fire-snapshot') return; // no scene signal for WING — see file header

      // Raw OSC-address-shaped messages from mixer.js (send_level / send_pan)
      const oscMsg = msg;
      if (!oscMsg.address) return;
      const ALLOWED_OSC_RE = /^\/Input_Channels\/(\d+)\/Aux_Send\/(\d+)\/send_(level|pan)$/;
      const m = oscMsg.address.match(ALLOWED_OSC_RE);
      if (!m) return;
      const [, chStr, auxStr, kind] = m;
      const ch = parseInt(chStr, 10), aux = parseInt(auxStr, 10);
      if (!Number.isInteger(ch) || ch < 1 || !Number.isInteger(aux) || aux < 1) return;
      const rawVal = Array.isArray(oscMsg.args) ? oscMsg.args[0] : undefined;
      if (typeof rawVal !== 'number' || !Number.isFinite(rawVal)) return;
      // In range, and clamped before it reaches the console: there was no
      // upper bound on ch/aux, and Infinity/huge dB values were sent as-is.
      if (ch > (serverCfg.channels || 40) || aux > (serverCfg.auxes || 16)) return;
      const val = kind === 'pan' ? Math.max(0, Math.min(1, rawVal)) : Math.max(-150, Math.min(10, rawVal));
      oscMsg.args = [val, ...oscMsg.args.slice(1)];

      const key = levelKey(ch, aux);

      if (kind === 'pan') {
        panCache.set(key, val);
        pacer.cancel(`pan:${ch}:${aux}`); // supersedes a queued preset write
        wing && wing.setSendPan(ch, aux, sliderToAzimuth(val));
        broadcastToClients(oscMsg, ws);
        ws._lastActivityAt = Date.now();
        shared.broadcastActivity(connections, { type: 'device-activity', deviceId: ws._deviceId || null, aux, channel: ch, kind: 'pan', direction: val < 0.5 ? 'left' : val > 0.5 ? 'right' : null }, ws);
        return;
      }

      const prevDb = levelCache.get(key);
      levelCache.set(key, val);
      pacer.cancel(`lvl:${ch}:${aux}`); // supersedes a queued preset write
      wing && wing.setSendLevel(ch, aux, val);
      broadcastToClients(oscMsg, ws);

      ws._lastActivityAt = Date.now();
      let direction = null;
      if (typeof prevDb === 'number' && val !== prevDb) direction = val > prevDb ? 'up' : 'down';
      shared.broadcastActivity(connections, { type: 'device-activity', deviceId: ws._deviceId || null, aux, channel: ch, kind: 'level', direction }, ws);
    }));

    ws.on('close', () => {
      connections = connections.filter(c => c !== ws);
      if (onConnectionCountChange) onConnectionCountChange(connections.length);
      broadcastToClients({ type: 'connection-count', count: connections.length });
      if (ws._deviceId != null || ws._activeAux != null) broadcastDevicesUpdate();
    });
  });

  // ── WING UDP client ──────────────────────────────────────────────────────
  if (!cfg.deskIp) {
    logEvent('wing-error', 'Console IP Address is not set on the Console tab — nothing to connect to.');
  }
  const wingPort = Number.isInteger(cfg.wingPort) && cfg.wingPort > 0 && cfg.wingPort <= 65535 ? cfg.wingPort : 2223;
  wing = new WingClient({ host: cfg.deskIp, port: wingPort });
  wing.on('open', () => {
    logEvent('wing-open', `sending to ${cfg.deskIp}:${wing.port}`);
    checkLiveness(wing, true);
    // Re-checked on a timer, not just once: started before the WING booted,
    // it used to stay "disconnected" with no channel names all session; a
    // WING that dropped later still showed connected.
    if (livenessTimer) clearInterval(livenessTimer);
    livenessTimer = setInterval(() => checkLiveness(wing, false), LIVENESS_MS);
  });
  wing.on('error', (err) => logEvent('wing-error', err.message || err.code || String(err)));
  wing.connect();
}

// A real round trip, not just "did the local socket bind" — see
// wing-client.js's checkConnected(). Status is only reported on a change.
const LIVENESS_MS = 5000;
let livenessTimer = null;
let livenessChecking = false;
async function checkLiveness(client, first) {
  if (!client || livenessChecking) return;
  livenessChecking = true;
  const askedAt = Date.now();
  let alive;
  try { alive = await client.checkConnected(); } finally { livenessChecking = false; }
  if (wing !== client) return; // stopped meanwhile
  // A reply while connected: the releases sent before the question got there
  if (alive && consoleConnected) for (const [key, at] of recentReleases) if (at < askedAt) recentReleases.delete(key);
  if (!first && alive === consoleConnected) return;
  consoleConnected = alive;
  if (onConsoleStatusChange) onConsoleStatusChange(alive);
  logEvent(alive ? 'console-connect' : 'console-error', alive ? serverCfg.deskIp : 'no reply from console — check the IP and that the console is powered on');
  if (!alive) return;
  // Back after a drop: a console that restarted has every send on again,
  // while phones still show their mutes. Switch the silenced ones back off.
  if (!first) {
    for (const [key, entry] of silencedSends) {
      if (!entry.wasOn) continue;
      const [ch, bus] = key.split(':').map(Number);
      pacer.write(`on:${key}`, () => wing && wing.setSendOn(ch, bus, false), true);
    }
    // And the ones released while it was gone, back on
    for (const key of recentReleases.keys()) {
      if (silencedSends.has(key)) continue;
      const [ch, bus] = key.split(':').map(Number);
      pacer.write(`on:${key}`, () => wing && wing.setSendOn(ch, bus, true), true);
    }
    recentReleases.clear();
  }
  for (let i = 1; i <= (serverCfg.channels || 40); i++) {
    const ch = i;
    enqueuePrime(async () => {
      const name = wing && await wing.getChannelName(ch);
      if (typeof name === 'string' && name) nameCache.set(`input:${ch}`, name);
    });
  }
  startPriming();
}

function stop() {
  if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
  if (livenessTimer) { clearInterval(livenessTimer); livenessTimer = null; }
  stopPriming();
  pacer.flush(); // queued writes are the state people asked for
  // Turn back on every send a mute/solo switched off. start() forgets this
  // state, so leaving them off stranded channels silent while phones showed
  // nothing muted, with no way to unmute them.
  if (wing) {
    for (const [key, entry] of silencedSends) {
      if (!entry.wasOn) continue;
      const [ch, aux] = key.split(':').map(Number);
      wing.setSendOn(ch, aux, true);
    }
  }
  silencedSends.clear();
  // Close on the next turn: UDP sends queued in this tick are dropped if the
  // socket closes now (measured on DiGiCo — see osc-server.js's stop()).
  let closed = Promise.resolve();
  if (wing) {
    const closing = wing;
    wing = null;
    closing.removeAllListeners();
    closing.on('error', () => {});
    closed = new Promise((resolve) => setImmediate(() => { closing.disconnect(); resolve(); }));
  }
  // Same fix as osc-server.js's stop() — wss.close() alone leaves already-
  // upgraded sockets open, detached from the HTTP server's own tracking.
  if (wss) { for (const c of wss.clients) { try { c.terminate(); } catch (_) {} } wss.close(); wss = null; }
  if (httpServer) { httpServer.close(); httpServer = null; }
  consoleConnected = false;
  if (onConsoleStatusChange) onConsoleStatusChange(false);
  levelCache.clear();
  pacer.clear();
  panCache.clear();
  connections = [];
  console.log('[JPMixer/WING] Server stopped');
  return closed;
}

function getChannelNames() {
  const out = {};
  for (const [k, v] of nameCache.entries()) if (k.startsWith('input:')) out[k.slice(6)] = v;
  return out;
}
function getAuxNames() { return {}; } // no live bus-name cache maintained in this pass
// Save & Apply for settings that don't need a reconnect (labels, colours,
// order, visibility, scene recall…). It used to restart this backend on
// every save, which dropped every phone mid-service. Everything here reads
// serverCfg when it runs, so swapping it in and re-sending the layout is
// enough; phones refill their faders from levelCache, nothing goes to the desk.
function applyConfigLive(cfg) {
  serverCfg = cfg;
  logEvent('config-live', `pushed to ${connections.length} clients`);
  if (!wss) return;
  const msg = JSON.parse(buildConfig());
  msg.config.liveUpdate = true;
  broadcastToClients(msg);
}

function getChannelCount() { return null; }
function getAuxCount() { return null; }

// Reflects the real round-trip result from checkConnected(), not just
// whether the local UDP socket opened — see the 'open' handler above.
function isConsoleConnected() { return consoleConnected; }
function setConsoleStatusCallback(cb) { onConsoleStatusChange = cb; }
function setConnectionCountCallback(cb) { onConnectionCountChange = cb; }
function getConnectionCount() { return connections.length; }
function setServerErrorCallback(cb) { onServerError = cb; }

// Traffic log / recording — not implemented for WING in this pass.
function getOscLog() { return []; }
function setOscTrafficCallback(cb) { onOscTraffic = cb; }
function startOscLogRecording() { return { ok: false, error: 'Traffic recording is not yet implemented for WING' }; }
function stopOscLogRecording() { return { ok: false, error: 'Traffic recording is not yet implemented for WING' }; }
function getOscLogRecordingStatus() { return { recording: false }; }
function oscLogRecordsFolder() { return null; }

// After Settings merges device groups — see shared-handlers.js
function pushDevicePresets(deviceId) {
  shared.pushDevicePresets(connections, deviceId);
}

module.exports = { getConnectedDevicesInfo, pushDevicePresets, getControlGroups: () => [], // no control groups yet
  start, stop, applyConfigLive, getChannelNames, getAuxNames, getChannelCount, getAuxCount,
  isConsoleConnected, setConsoleStatusCallback, setConnectionCountCallback, getConnectionCount,
  setServerErrorCallback, getOscLog, setOscTrafficCallback,
  startOscLogRecording, stopOscLogRecording, getOscLogRecordingStatus, oscLogRecordsFolder,
  fireSnapshot, setMute: sendMute, setSolo: sendSolo, setChannelLabel, setAuxLabel,
};
