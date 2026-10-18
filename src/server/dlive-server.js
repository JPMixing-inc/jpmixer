'use strict';

// ── dLive server — parallel to osc-server.js, never imported by it ─────────
// Speaks the exact same browser-facing WebSocket dialect osc-server.js does
// (including OSC-address-shaped {address,args} messages) so mixer.js,
// monitor.js, console.js, and devices.js work completely unmodified — only
// main.js's choice of which server module to require() differs by console
// type. Internally this talks dLive's MIDI-over-TCP/IP protocol instead of
// OSC/UDP; see dlive-protocol.js / dlive-client.js for that layer.
//
// UNLIKE DiGiCo: DiGiCo Pad only allows one external-control instance on the
// console at a time (confirmed via DiGiCo's own tech note TN324) — dLive
// has no such exclusivity. Per Allen & Heath's own support article, the
// MixRack supports up to 40 simultaneous TCP connections shared across the
// Surface, any IP6/IP8/IP1/IP4 remotes, Director, MixPad/OneMix/4You apps,
// AND third-party controllers — explicitly stated to work "at the same
// time as or even without a Surface." JPMixer only ever holds one of those
// 40 slots, so it can coexist with whatever else the venue already has
// connected. Worth knowing about only for a very large install already
// running close to that ceiling.
//
// Scope of this pass — deliberately not full parity with the DiGiCo path:
//   ✓ Musician mixer: aux send levels, mute/solo (emulated via zeroing the
//     send, same trick osc-server.js uses), My Mixes, Ear Scenes, Devices View
//   ✓ Monitor Engineer View also works, without any extra code — its per-
//     channel faders, ±0.5dB boost buttons, mute/solo, and snapshot prev/
//     next all reuse the exact same message types/addresses as the musician
//     mixer, so they fell out of the above for free once it worked
//   ✗ Pan — no per-channel-per-aux pan message exists in the V2.0 spec as
//     documented; sends are silently accepted and dropped rather than faked.
//     mixer.js's PAN toggle stays hidden regardless, since it's already
//     gated on the aux's `stereo` flag (verified against a real browser),
//     which every dLive aux reports false — no separate fix needed there.
//   ✗ Built-in aux EQ — same story as pan: config always reports
//     `eqEnabled: false`, so mixer.js's existing gate already hides the EQ
//     menu item; the request-aux-eq stub below is unreachable in practice.
//   ✗ Console Controller (main faders/DCAs/groups), OSC/MIDI log recording,
//     iPad relay — not implemented; exported stubs only so main.js's shared
//     calls don't crash if invoked while dLive is active. Console
//     Controller's messages for these (console-fader, aux-fader, cg-fader,
//     etc.) have no `.address` field and match none of the handled `type`s,
//     so they're inert no-ops rather than errors — except fire-snapshot,
//     which Console Controller also uses and which *is* implemented.
//   ✗ Aux mono/stereo distinction — dLive has separate mono/stereo aux send
//     pools; every JPMixer-configured aux is mapped to a *mono* aux send
//     (1-62 available), which covers the overwhelmingly common case
//
// UNVERIFIED ASSUMPTION (flagged in dlive-client.js too): that dLive pushes
// an unsolicited Send Level message when a send changes, the way it's
// documented to do for Fader/Mute/Assignment. Needs real hardware to confirm.
// Until then, two independent mechanisms keep send levels in sync, both
// controllable from Settings:
//   - Push  (dliveListenSendLevels, default on) — trust the console's own
//     unsolicited echoes, same as the DiGiCo path relies on for everything.
//     Free to leave on even if it turns out to do nothing.
//   - Poll  (dlivePollSendLevels, default on) — a paced background loop that
//     actively requests the current send level for every channel in every
//     *actively mixed* aux (never the full channel×aux matrix — see
//     rebuildSendLevelPollQueue), one request per tick. This is the safety
//     net if push turns out not to happen; harmless, redundant confirmation
//     if it does.
//
// Real-world signal on which one actually matters: a working third-party
// dLive MIDI integration (X-Touch via Bome, forum.bome.com) confirmed aux
// send levels genuinely are controllable via this exact SysEx mechanism on
// real hardware — but its author built it around *active polling on an
// iterative timer* to read fader positions back, not unsolicited push. That
// doesn't prove push never fires, but it's a real person who needed this to
// work reliably choosing not to depend on it. Treat poll as the mechanism
// this integration actually leans on, and push as a bonus that may or may
// not add anything — the reverse of how the two were originally framed here.
// A separate, less conclusive forum thread reported SysEx sends not
// responding at all for a couple of users on unspecified firmware/setups;
// unresolved in that thread, and may not even be the same 0x0D Send Level
// message this integration uses (one participant's follow-up was clearly
// about the separate 0x0E on/off Group/Aux *assignment* message instead) —
// but it's one more reason the send-level path specifically deserves the
// first and most careful real-hardware test, ahead of everything else here.

const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');
const scenes    = require('./scenes');
const presets   = require('./presets');
const shared    = require('./shared-handlers');
const P         = require('./dlive-protocol');
const { DliveClient } = require('./dlive-client');
const config    = require('./config');
const { mountGreenRoom } = require('./greenroom');

let httpServer = null;
let wss        = null;
let client     = null;
let serverCfg  = {};
let connections = [];
let pingInterval = null;
// Mirrors the `baseN` local inside start() — kept in sync there — so the
// External Control API's setMute/setSolo/fireSnapshot below (called from
// outside any single WS connection's closure) can reuse the exact same
// dLive addressing logic the browser WS handler already uses.
let moduleBaseN = 0;

let onConsoleStatusChange = null;
let onConnectionCountChange = null;
let onServerError = null;
let onOscTraffic = null; // accepted for interface parity, never fired — no MIDI log in this pass

const eventLog = [];
function logEvent(type, detail) {
  eventLog.push({ t: new Date().toISOString(), type, detail });
  if (eventLog.length > 100) eventLog.shift();
  console.log(`[JPMixer/dLive] ${type}: ${detail}`);
}

// ── Console-connected state ─────────────────────────────────────────────
let consoleConnected = false;
let currentSceneNumber = null; // dLive has no scene *name* — Ear Scenes key off this instead

// levelCache["ch:aux"] = dB — mirrors osc-server.js's cache.get(...).args[0] pattern
const levelCache = new Map();
const nameCache  = new Map(); // "input:5" / "aux:2" -> name string, from dLive SysEx replies
const colourCache = new Map();

const muteState    = {}; // muteState[aux][ch]
const soloState    = {}; // soloState[aux][ch]
const premuteState = {}; // premuteState[aux][ch] = dB saved before silencing

// dlive-protocol.js's coordinate() throws on an out-of-range channel/aux
// number by design (it's a strict library function) — that's correct for a
// pure math helper, but wrong for anything reachable from a browser
// message. Wrapped here so a bad number (e.g. a mistyped aux count in
// Settings, or literally any client sending an out-of-range address —
// nothing upstream of the OSC-address regex match validates the number)
// degrades to "ignore this" instead of crashing the whole server. Found by
// tracing through what "how many auxes can this handle" actually meant in
// practice — dLive's mono aux pool tops out at 62, but Settings' generic
// Auxes field allows up to 64 for any console type.
function channelCoord(baseN, ch) { try { return P.coordinate(baseN, 'input', ch); } catch (_) { return null; } }
function auxCoord(baseN, aux)    { try { return P.coordinate(baseN, 'monoAux', aux); } catch (_) { return null; } }

function levelKey(ch, aux) { return `${ch}:${aux}`; }

// ── Send-level polling — the fallback path (see file header) ──────────────
let sendLevelPollTimer = null;
let sendLevelPollQueue = [];
let sendLevelPollIndex = 0;

// Only channels within auxes someone's actually got open — polling the full
// channel × aux matrix on a big session would be hundreds of requests for
// mixes nobody's listening to. Rebuilt whenever which auxes are active changes.
function rebuildSendLevelPollQueue() {
  const activeAuxes = Object.keys(getActiveMixerCounts()).map(Number);
  const chCount = serverCfg.channels || 48;
  const queue = [];
  for (const aux of activeAuxes) {
    for (let ch = 1; ch <= chCount; ch++) queue.push({ ch, aux });
  }
  sendLevelPollQueue = queue;
  sendLevelPollIndex = 0;
}

// One request per tick — paced deliberately. The DiGiCo path exists as a
// cautionary tale here: an earlier version of that code briefly burst
// metadata requests instead of pacing them and it's the prime suspect for a
// console Access Violation crash. Don't repeat that mistake for dLive.
function startSendLevelPolling(baseN) {
  stopSendLevelPolling();
  if (!serverCfg.dlivePollSendLevels) return;
  sendLevelPollTimer = setInterval(() => {
    if (!client || !client.connected) return;
    if (sendLevelPollIndex >= sendLevelPollQueue.length) {
      rebuildSendLevelPollQueue();
      if (sendLevelPollQueue.length === 0) return;
    }
    const { ch, aux } = sendLevelPollQueue[sendLevelPollIndex++];
    const inputCoord = channelCoord(baseN, ch), sendCoord = auxCoord(baseN, aux);
    if (inputCoord && sendCoord) client.requestSendLevel(inputCoord, sendCoord);
  }, 75);
}

function stopSendLevelPolling() {
  if (sendLevelPollTimer) { clearInterval(sendLevelPollTimer); sendLevelPollTimer = null; }
  sendLevelPollQueue = [];
  sendLevelPollIndex = 0;
}

// ── Name/colour priming on connect — same "never burst the console" pacing ─
let primeQueue = [];
let primeTimer = null;

function enqueuePrime(fn) { primeQueue.push(fn); }

// Bug fixed here: this used to call stopPriming() first, which clears
// primeQueue — but every real call site enqueues the whole batch *then*
// calls startPriming() once, so that reset wiped the queue before the
// interval ever fired a single tick. Priming (channel/aux names and
// colours) has never actually run as a result. Verified with a standalone
// repro before fixing: 5 enqueued calls, 0 executed after 500ms.
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

// ── Broadcast helpers — identical shape/behavior to osc-server.js's ────────

function broadcastToClients(msg) {
  const payload = typeof msg === 'string' ? msg : JSON.stringify(msg);
  for (const conn of connections) {
    if (conn.readyState === WebSocket.OPEN) conn.send(payload);
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

// ── Config builder — same shape osc-server.js's buildConfig() produces ────

function buildConfig() {
  const auxCount = serverCfg.auxes || 16;
  const chCount  = serverCfg.channels || 48;
  const cfgAuxOverrides = serverCfg.auxOverrides || {};
  const cfgOverrides    = serverCfg.channelOverrides || {};
  const cfgGroups       = serverCfg.channelGroups || [];

  const auxilaries = [];
  for (let i = 1; i <= auxCount; i++) {
    const ov = cfgAuxOverrides[String(i)] || {};
    const liveName = nameCache.get(`aux:${i}`);
    auxilaries.push({
      enabled:   ov.enabled !== false,
      label:     ov.label || liveName || `AUX ${i}`,
      channel:   i,
      stereo:    false, // see file header — mono-only in this pass
      colour:    ov.colour || colourCache.get(`aux:${i}`) || '#e8a020',
      icon:      '',
      eqEnabled: false, // aux EQ not implemented for dLive yet
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
      controlGroups: [], // control groups not implemented for dLive yet
      snapshot: currentSceneNumber != null ? `Scene ${currentSceneNumber}` : '—',
      sceneRecallEnabled: !!serverCfg.sceneRecallEnabled,
      scenes: scenes.getAll(),
      mutes: muteState,
      solos: soloState,
    },
  });
}

// ── Mute / Solo — same algorithm as osc-server.js's applyMuteSolo, using
// dLive send-level writes in place of sendToDesk() ──────────────────────

function applyMuteSolo(baseN, aux) {
  const anySolo = Object.values(soloState[aux] || {}).some(v => v);
  const chCount = serverCfg.channels || 48;
  if (!premuteState[aux]) premuteState[aux] = {};
  const restoredLevels = {};
  const snd = auxCoord(baseN, aux);
  // Settings' generic Auxes field allows up to 64, but dLive's mono aux pool
  // tops out at 62 — a misconfigured count shouldn't crash the server.
  if (!snd) { logEvent('coord-error', `aux ${aux} is out of dLive's addressable range — skipping mute/solo`); return; }

  for (let ch = 1; ch <= chCount; ch++) {
    const key = levelKey(ch, aux);
    if (!levelCache.has(key)) continue;
    const muted = !!(muteState[aux]?.[ch]);
    const soloed = !!(soloState[aux]?.[ch]);
    const silenced = muted || (anySolo && !soloed);
    const inputCoord = channelCoord(baseN, ch);
    if (!inputCoord) continue;

    if (silenced) {
      if (premuteState[aux][ch] === undefined) premuteState[aux][ch] = levelCache.get(key);
      client && client.setSendLevel(inputCoord, snd, -Infinity);
    } else {
      const restore = premuteState[aux][ch] !== undefined ? premuteState[aux][ch] : levelCache.get(key);
      client && client.setSendLevel(inputCoord, snd, restore);
      levelCache.set(key, restore);
      restoredLevels[ch] = restore;
      delete premuteState[aux][ch];
    }
  }

  broadcastToClients({ type: 'mute-solo-state', aux, mutes: muteState[aux] || {}, solos: soloState[aux] || {}, levels: restoredLevels });
}

function clearMuteSolo() {
  Object.keys(muteState).forEach(k => delete muteState[k]);
  Object.keys(soloState).forEach(k => delete soloState[k]);
  Object.keys(premuteState).forEach(k => delete premuteState[k]);
}

// Shared entry points for both the browser WS handler below and the
// External Control API (api-server.js) — same validation/dispatch either
// way, so a Companion/Stream Deck button behaves identically to a browser
// mute button.
function setMute(auxRaw, chRaw, muted) {
  const aux = parseInt(auxRaw, 10), ch = parseInt(chRaw, 10);
  const chMax = serverCfg.channels || 48, auxMax = serverCfg.auxes || 16;
  if (isNaN(aux) || aux < 1 || aux > auxMax || isNaN(ch) || ch < 1 || ch > chMax) return false;
  if (!muteState[aux]) muteState[aux] = {};
  muteState[aux][ch] = !!muted;
  applyMuteSolo(moduleBaseN, aux);
  return true;
}

function setSolo(auxRaw, chRaw, soloed) {
  const aux = parseInt(auxRaw, 10), ch = parseInt(chRaw, 10);
  const chMax = serverCfg.channels || 48, auxMax = serverCfg.auxes || 16;
  if (isNaN(aux) || aux < 1 || aux > auxMax || isNaN(ch) || ch < 1 || ch > chMax) return false;
  if (!soloState[aux]) soloState[aux] = {};
  soloState[aux][ch] = !!soloed;
  applyMuteSolo(moduleBaseN, aux);
  return true;
}

function fireSnapshot(action) {
  if (currentSceneNumber == null || !client) return false;
  const next = action === 'next' ? currentSceneNumber + 1 : currentSceneNumber - 1;
  if (next < 1 || next > 500) return false;
  client.recallScene(next);
  return true;
}

// Live relabeling — see osc-server.js's setChannelLabel/setAuxLabel for the
// full rationale (Planning Center connector use case). dLive has no live
// name-push of its own, so this only ever affects JPMixer's own label —
// consistent with how channelOverrides/auxOverrides already work here.
// Live relabeling (Control API / Planning Center) — see shared-handlers.js
function setChannelLabel(n, label) {
  return shared.relabel(serverCfg, 'channel', n, label, 48, broadcastToClients);
}

function setAuxLabel(n, label) {
  return shared.relabel(serverCfg, 'aux', n, label, 16, broadcastToClients);
}

// ── Scene (Ear Scene) recall — keyed by scene NUMBER, not name ───────────

function pushSceneValuesToDesk(baseN, auxStr, values) {
  const levels = {};
  const aux = parseInt(auxStr, 10);
  const anySolo = Object.values(soloState[aux] || {}).some(v => v);
  if (!premuteState[aux]) premuteState[aux] = {};
  const snd = auxCoord(baseN, aux);
  // aux here can come straight from client messages (recall-scene, apply-preset)
  // or from a scene saved under an aux number that's since become invalid —
  // out of dLive's range shouldn't crash the server, just skip sending.

  for (const [chStr, sliderVal] of Object.entries(values)) {
    const ch = parseInt(chStr, 10);
    // values comes straight from client-controlled recall-scene/apply-preset
    // payloads — an arbitrary object with arbitrary keys/values, not
    // necessarily produced by mixer.js's own slider. A non-finite sliderVal
    // would otherwise propagate as NaN through sliderToDb/dbToLv all the way
    // to a wire byte (Buffer coerces NaN to 0x00, i.e. a real "-inf" send —
    // wrong, not just unsent). Skip rather than encode garbage.
    if (!Number.isFinite(sliderVal)) continue;
    const db = sliderToDb(sliderVal);
    const muted = !!(muteState[aux]?.[ch]);
    const soloed = !!(soloState[aux]?.[ch]);
    const silenced = muted || (anySolo && !soloed);

    levels[chStr] = sliderVal;

    const inputCoord = snd ? channelCoord(baseN, ch) : null;
    // Only cache/send once both coordinates actually resolved — ch/aux are
    // also client-controlled and unbounded (no upper limit on the object's
    // keys), so caching before this check let an out-of-range pair pollute
    // levelCache with an entry nothing ever clears.
    if (!inputCoord) continue;
    levelCache.set(levelKey(ch, aux), db);
    if (silenced) {
      premuteState[aux][ch] = db;
      client && client.setSendLevel(inputCoord, snd, -Infinity);
    } else {
      delete premuteState[aux][ch];
      client && client.setSendLevel(inputCoord, snd, db);
    }
  }
  return levels;
}

function applySceneForSceneNumber(baseN, sceneNumber) {
  if (!serverCfg.sceneRecallEnabled) { logEvent('scene-skip', `auto-recall disabled — scene:${sceneNumber}`); return; }
  const key = String(sceneNumber);
  const allSaved = scenes.getAll();
  const sceneScenes = allSaved[key];
  if (!sceneScenes) { logEvent('scene-skip', `no scene saved for scene:${sceneNumber}`); return; }

  logEvent('scene-recall', `applying scene ${sceneNumber}`);
  const broadcastLevels = {};
  for (const [auxStr, values] of Object.entries(sceneScenes)) {
    broadcastLevels[auxStr] = pushSceneValuesToDesk(baseN, auxStr, values);
  }
  broadcastToClients({ type: 'scene-recalled', snapshot: key, levels: broadcastLevels });
}

// slider (0-1) -> dB. Matches osc-server.js's own sliderToDb exactly — this
// is the client's curve, not dLive's, and dB is dB regardless of which
// console's fader law produced the slider position. Only this direction is
// needed server-side: incoming console dB values are broadcast to browsers
// as-is and converted back to slider positions client-side (mixer.js has
// its own dbToSlider for that) — a server-side copy would just be dead code.
function sliderToDb(v) {
  const db = ((Math.log(v * 100) / Math.log(100)) * 100) - 90;
  return db === -Infinity ? -150 : db;
}

// ── Server lifecycle ───────────────────────────────────────────────────────

function start(cfg) {
  serverCfg = cfg;
  connections = [];
  currentSceneNumber = null;
  levelCache.clear();
  nameCache.clear();
  colourCache.clear();
  clearMuteSolo();

  // 0-11 per the console's own Utility → Control → MIDI setting — coordinate()
  // enforces this range for every channel/aux lookup, but buildSceneRecall()
  // bit-ORs baseN into a MIDI status byte without any range check of its own
  // (scene recall doesn't go through coordinate() at all), so an out-of-range
  // value here would silently corrupt the status byte instead of erroring.
  const baseN = Number.isInteger(cfg.dliveBaseChannel) ? Math.max(0, Math.min(11, cfg.dliveBaseChannel)) : 0;
  moduleBaseN = baseN;

  const appExpress = express();
  appExpress.use(express.static(path.join(__dirname, '..', 'mixer')));
  mountGreenRoom(appExpress);

  const diagOnly = (req, res, next) => {
    const addr = req.socket.remoteAddress;
    if (addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1') return next();
    res.status(403).json({ error: 'Diagnostic endpoints are localhost-only' });
  };
  appExpress.get('/api/events', diagOnly, (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    const rows = eventLog.slice().reverse().map(e => `<tr><td>${e.t}</td><td><b>${e.type}</b></td><td>${e.detail}</td></tr>`).join('');
    res.send(`<html><head><meta http-equiv="refresh" content="3"><style>body{font-family:monospace;font-size:12px;background:#111;color:#eee;padding:12px}table{border-collapse:collapse;width:100%}td{padding:4px 8px;border-bottom:1px solid #333}</style></head><body><h3>JPMixer (dLive) Event Log</h3><p>Connections: ${connections.length} | Console connected: ${consoleConnected}</p><table><tr><th>Time</th><th>Type</th><th>Detail</th></tr>${rows}</table></body></html>`);
  });

  httpServer = http.createServer(appExpress);
  httpServer.on('error', (err) => {
    logEvent('http-error', `${err.code || err.message} — server failed to (re)start on port ${cfg.serverPort}`);
    stop();
    if (onServerError) onServerError(err);
  });

  httpServer.listen(cfg.serverPort, () => {
    console.log(`[JPMixer/dLive] Web server → http://localhost:${cfg.serverPort}`);
    console.log(`[JPMixer/dLive] Connecting to dLive MixRack → ${cfg.deskIp}`);
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
            const address = `/Input_Channels/${ch}/Aux_Send/${msg.aux}/send_level`;
            ws.send(JSON.stringify({ address, args: [levelCache.get(key)] }));
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
        const levels = pushSceneValuesToDesk(baseN, String(msg.aux), saved);
        broadcastToClients({ type: 'scene-recalled', snapshot: key, levels: { [String(msg.aux)]: levels } });
        return;
      }

      if (msg.type === 'set-active-aux') {
        ws._activeAux = (msg.aux === null || msg.aux === undefined) ? null : parseInt(msg.aux, 10);
        broadcastToClients({ type: 'active-mixers', counts: getActiveMixerCounts() });
        broadcastDevicesUpdate();
        rebuildSendLevelPollQueue(); // picks up newly (in)active auxes immediately, not next full cycle
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
        const auxStr = String(msg.aux);
        const levels = pushSceneValuesToDesk(baseN, auxStr, msg.levels || {});
        // Pan not implemented for dLive (see file header) — accepted, not applied.
        broadcastToClients({ type: 'preset-loaded', aux: msg.aux, name: msg.name, levels, pans: {} });
        return;
      }

      if (msg.type === 'request-aux-eq') {
        // Aux EQ not implemented for dLive in this pass — reply empty so the
        // mixer page's EQ panel shows a flat curve instead of hanging.
        try { ws.send(JSON.stringify({ type: 'aux-eq', aux: msg.aux, eq: {} })); } catch (_) {}
        return;
      }

      if (msg.type === 'set-mute') { setMute(msg.aux, msg.ch, msg.muted); return; }
      if (msg.type === 'set-solo') { setSolo(msg.aux, msg.ch, msg.soloed); return; }
      if (msg.type === 'fire-snapshot') { fireSnapshot(msg.action); return; }

      // Raw OSC-address-shaped messages from mixer.js (send_level / send_pan)
      const oscMsg = msg;
      if (!oscMsg.address) return;
      const ALLOWED_OSC_RE = /^\/Input_Channels\/(\d+)\/Aux_Send\/(\d+)\/send_(level|pan)$/;
      const m = oscMsg.address.match(ALLOWED_OSC_RE);
      if (!m) return; // includes EQ addresses and any query (/?) form — not implemented for dLive
      const [, chStr, auxStr, kind] = m;
      const ch = parseInt(chStr, 10), aux = parseInt(auxStr, 10);

      if (kind === 'pan') return; // no dLive message for per-send pan — see file header

      const db = Array.isArray(oscMsg.args) ? oscMsg.args[0] : undefined;
      if (typeof db !== 'number') return;

      const key = levelKey(ch, aux);
      const prevDb = levelCache.get(key);
      levelCache.set(key, db);
      if (!client) return;
      // Nothing upstream of the regex match validates ch/aux are actually
      // in range — this is the most directly client-reachable path, so it's
      // where an out-of-range number is most likely to show up in practice.
      const inputCoord = channelCoord(baseN, ch), sendCoord = auxCoord(baseN, aux);
      if (!inputCoord || !sendCoord) return;
      client.setSendLevel(inputCoord, sendCoord, db);

      ws._lastActivityAt = Date.now();
      let direction = null;
      if (typeof prevDb === 'number' && db !== prevDb) direction = db > prevDb ? 'up' : 'down';
      shared.broadcastActivity(connections, { type: 'device-activity', deviceId: ws._deviceId || null, aux, channel: ch, kind: 'level', direction }, ws);
    });

    ws.on('close', () => {
      connections = connections.filter(c => c !== ws);
      if (onConnectionCountChange) onConnectionCountChange(connections.length);
      broadcastToClients({ type: 'connection-count', count: connections.length });
      if (ws._deviceId != null || ws._activeAux != null) { broadcastDevicesUpdate(); rebuildSendLevelPollQueue(); }
    });
  });

  // ── dLive MIDI-over-TCP client ─────────────────────────────────────────
  if (!cfg.deskIp) {
    logEvent('console-error', 'Console IP Address is not set in the Setup tab — nothing to connect to.');
  }
  // Port defaults to the spec-documented MixRack port, but is overridable —
  // see the port note in dlive-client.js's file header for why.
  const defaultPort = cfg.dliveTlsEnabled ? 51327 : 51325;
  // net.createConnection/tls.connect throw *synchronously* on an out-of-range
  // port, before httpServer's async 'error' handler above ever gets a chance
  // to fire and clean up — an unvalidated value here would leak the
  // httpServer/wss/pingInterval this function already created. Range-check
  // before it ever reaches DliveClient.
  const midiPort = Number.isInteger(cfg.dliveMidiPort) && cfg.dliveMidiPort > 0 && cfg.dliveMidiPort <= 65535
    ? cfg.dliveMidiPort : defaultPort;
  client = new DliveClient({
    host: cfg.deskIp,
    port: midiPort,
    tlsEnabled: !!cfg.dliveTlsEnabled,
    username: cfg.dliveUsername,
    password: cfg.dlivePassword,
    baseChannel: baseN,
  });

  client.on('connect', () => {
    consoleConnected = true;
    logEvent('console-connect', cfg.deskIp);
    if (onConsoleStatusChange) onConsoleStatusChange(true);
    // Prime channel/aux names + colours so the mixer shows real labels —
    // paced one request per tick, never bursted (see startPriming above).
    // Settings' Channels/Auxes counts can be configured higher than dLive's
    // actual protocol ceiling (128 inputs, 62 mono auxes) — skip anything
    // past that rather than crashing on an out-of-range coordinate.
    for (let i = 1; i <= (serverCfg.channels || 48); i++) {
      const c = channelCoord(baseN, i);
      if (c) enqueuePrime(() => client.requestName(c));
    }
    for (let i = 1; i <= (serverCfg.auxes || 16); i++) {
      const c = auxCoord(baseN, i);
      if (!c) continue;
      enqueuePrime(() => client.requestName(c));
      enqueuePrime(() => client.requestColour(c));
    }
    startPriming();
    rebuildSendLevelPollQueue();
    startSendLevelPolling(baseN);
  });

  client.on('close', () => {
    consoleConnected = false;
    logEvent('console-disconnect', cfg.deskIp);
    if (onConsoleStatusChange) onConsoleStatusChange(false);
    stopPriming();
    stopSendLevelPolling();
  });

  client.on('error', (err) => {
    // Common connection failures (e.g. ECONNREFUSED for an unreachable or
    // empty IP) carry an empty .message — logging that alone is useless for
    // diagnosing a bad Setup tab config, so fall back to .code.
    logEvent('console-error', err.message || err.code || String(err));
  });

  client.on('sendLevel', (ev) => {
    if (serverCfg.dliveListenSendLevels === false) return; // push disabled — poll-only mode
    // This same message shape carries Group/Matrix/DCA sends too, not just
    // Input channels — checking the *source's* bank (ev.midiCh) as well as
    // the destination's is what keeps a Group's send from getting
    // misattributed and broadcast as some unrelated input channel's level.
    if (ev.midiCh !== baseN) return;              // source isn't an Input channel
    if (ev.sndMidiCh !== baseN + 2) return;       // destination isn't in the aux+FX bank at all
    if (ev.sndCh >= 0x40) return;                 // destination is a *stereo* aux (0x40-0x5E) —
    // mono (0-61) and stereo (0x40-0x5E) aux sends share this same midiCh
    // bank, so the check above alone can't tell them apart. Without this,
    // a stereo aux's send level gets reversed into a bogus mono aux number
    // (ch+1 past 62) and broadcast/cached as if it were real — the 'name'
    // and 'colour' handlers below already guard the same ambiguity with the
    // same ev.ch < 0x40 check; this one was missing it.
    // ev.ch/ev.sndCh are coordinate bytes, not JPMixer channel numbers
    // directly — for the mono, baseN-aligned mapping this pass uses, input
    // coordinate byte === channel number - 1, and aux coordinate byte within
    // the monoAux bank === aux number - 1. Reverse that here.
    const ch = ev.ch + 1, aux = ev.sndCh + 1;
    const key = levelKey(ch, aux);
    levelCache.set(key, ev.db);
    broadcastToClients({ address: `/Input_Channels/${ch}/Aux_Send/${aux}/send_level`, args: [ev.db] });
  });

  client.on('sceneRecall', (ev) => {
    currentSceneNumber = ev.sceneNumber;
    logEvent('scene-change', `scene:${ev.sceneNumber}`);
    broadcastToClients({ address: '/SnapshotName', args: [`Scene ${ev.sceneNumber}`] });
    applySceneForSceneNumber(baseN, ev.sceneNumber);
  });

  client.on('name', (ev) => {
    // Disambiguate input vs aux by which bank the coordinate's midiCh falls in.
    if (ev.midiCh === baseN) nameCache.set(`input:${ev.ch + 1}`, ev.name);
    else if (ev.midiCh === baseN + 2 && ev.ch < 0x40) nameCache.set(`aux:${ev.ch + 1}`, ev.name);
  });
  client.on('colour', (ev) => {
    if (ev.midiCh === baseN + 2 && ev.ch < 0x40) colourCache.set(`aux:${ev.ch + 1}`, ev.hex);
  });

  client.connect();
}

function stop() {
  if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
  stopPriming();
  stopSendLevelPolling();
  clearMuteSolo();
  if (client) { client.removeAllListeners(); client.disconnect(); client = null; }
  // wss.close() alone only stops accepting new connections — already-
  // upgraded sockets are detached from the HTTP server's own tracking (a
  // known `ws` gotcha) and stay open with their 'message' handler still
  // referencing this module's shared state. See osc-server.js's stop() for
  // the same fix, applied there first.
  if (wss) { for (const c of wss.clients) { try { c.terminate(); } catch (_) {} } wss.close(); wss = null; }
  if (httpServer) { httpServer.close(); httpServer = null; }
  consoleConnected = false;
  if (onConsoleStatusChange) onConsoleStatusChange(false);
  levelCache.clear();
  connections = [];
  console.log('[JPMixer/dLive] Server stopped');
}

function getChannelNames() {
  const out = {};
  for (const [k, v] of nameCache.entries()) if (k.startsWith('input:')) out[k.slice(6)] = v;
  return out;
}
function getAuxNames() {
  const out = {};
  for (const [k, v] of nameCache.entries()) if (k.startsWith('aux:')) out[k.slice(4)] = v;
  return out;
}
// dLive has no live "how many channels/auxes exist" query (see file header) —
// unlike DiGiCo, Settings' configured counts are the only source of truth.
function getChannelCount() { return null; }
function getAuxCount() { return null; }

function isConsoleConnected() { return consoleConnected; }
function setConsoleStatusCallback(cb) { onConsoleStatusChange = cb; }
function setConnectionCountCallback(cb) { onConnectionCountChange = cb; }
function getConnectionCount() { return connections.length; }
function setServerErrorCallback(cb) { onServerError = cb; }

// MIDI traffic log / recording — not implemented for dLive in this pass.
function getOscLog() { return []; }
function setOscTrafficCallback(cb) { onOscTraffic = cb; }
function startOscLogRecording() { return { ok: false, error: 'Traffic recording is not yet implemented for dLive' }; }
function stopOscLogRecording() { return { ok: false, error: 'Traffic recording is not yet implemented for dLive' }; }
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
  fireSnapshot, setMute, setSolo, setChannelLabel, setAuxLabel,
};
