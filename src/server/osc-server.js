'use strict';

const express  = require('express');
const http     = require('http');
const WebSocket = require('ws');
const osc      = require('osc');
const path     = require('path');
const fs       = require('fs');
const { app }  = require('electron');
const scenes   = require('./scenes');
const presets  = require('./presets');
const shared   = require('./shared-handlers');
const config   = require('./config');
const { mountGreenRoom } = require('./greenroom');
const { mountBranding } = require('./branding');
const channelProcessing = require('./digico-channel');
const { mountPerformerAssignments } = require('./performer-assignments');
const { mountFoh } = require('./foh');
const access = require('./access');

let httpServer    = null;
let wss           = null;
let udpPort       = null;
let ipadPorts     = new Map(); // ip → { id, name, ip, sendPort } — O(1) lookup by source IP
let serverCfg     = {};

// Ring buffer of recent server events for /api/events diagnostics
const eventLog = [];
function logEvent(type, detail) {
  const entry = { t: new Date().toISOString(), type, detail };
  eventLog.push(entry);
  if (eventLog.length > 100) eventLog.shift();
  console.log(`[JPMixer] ${type}: ${detail}`);
  writeEventLogFile(entry);
}

// The in-memory ring above is gone after a crash or quit, so every event is
// also appended to jpmixer-events.log in the OSC logs folder (Settings → OSC
// Log → open folder). Events are low-rate (connects, saves, recalls, errors —
// never per-fader), so a synchronous append is fine. Rotates at 1 MB,
// keeping 3 old files.
const EVENT_LOG_MAX_BYTES = 1024 * 1024;
const EVENT_LOG_KEEP      = 3;
let eventLogFile  = null;
let eventLogBytes = 0;

function writeEventLogFile(entry) {
  try {
    if (!eventLogFile) {
      eventLogFile = path.join(oscLogRecordsFolder(), 'jpmixer-events.log');
      try { eventLogBytes = fs.statSync(eventLogFile).size; } catch (_) { eventLogBytes = 0; }
    }
    const line = `${entry.t}  ${entry.type}  ${entry.detail}\n`;
    if (eventLogBytes + line.length > EVENT_LOG_MAX_BYTES) {
      for (let i = EVENT_LOG_KEEP - 1; i >= 1; i--) {
        try { fs.renameSync(`${eventLogFile}.${i}`, `${eventLogFile}.${i + 1}`); } catch (_) {}
      }
      try { fs.renameSync(eventLogFile, `${eventLogFile}.1`); } catch (_) {}
      eventLogBytes = 0;
    }
    fs.appendFileSync(eventLogFile, line);
    eventLogBytes += Buffer.byteLength(line);
  } catch (_) {} // logging must never take the server down
}

// Ring buffer of raw OSC traffic (desk ⇄ server) for the Settings "OSC Log" view.
// Entries are batched and flushed to onOscTraffic periodically rather than fired
// one IPC message at a time — priming alone can push 100+ messages/sec.
const oscLog = [];
const OSC_LOG_CAP = 500;
let oscLogBatch = [];
let oscLogFlushTimer = null;
let oscLogSeq = 0;
const OSC_LOG_FLUSH_MS = 150;

function logOscTraffic(dir, address, args, source) {
  const entry = { seq: ++oscLogSeq, t: Date.now(), dir, address, args, source };
  oscLog.push(entry);
  if (oscLog.length > OSC_LOG_CAP) oscLog.shift();
  oscLogBatch.push(entry);

  if (oscLogRecordStream) {
    try {
      oscLogRecordStream.write(formatOscLogLine(entry) + '\n');
      oscLogRecordCount++;
    } catch (e) {
      console.error('[JPMixer] OSC log write error:', e.message);
    }
  }
}

// ── OSC Log recording — writes raw OSC traffic to a text file on disk ─────
// Independent of the Settings terminal's own Pause/Clear (those are display-only);
// once started, every message is written until stopped, regardless of that UI state.

let oscLogRecordStream = null;
let oscLogRecordPath   = null;
let oscLogRecordCount  = 0;

function oscLogRecordsFolder() {
  const dir = path.join(app.getPath('userData'), 'osc-logs');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  return dir;
}

function formatOscLogLine(entry) {
  const time = new Date(entry.t).toTimeString().slice(0, 8) + '.' + String(entry.t % 1000).padStart(3, '0');
  const args = (entry.args || []).map(a =>
    typeof a === 'number' ? (Number.isInteger(a) ? String(a) : a.toFixed(3)) : JSON.stringify(a)
  ).join(', ');
  const arrow  = entry.dir === 'in' ? '<-' : '->';
  const source = (entry.source && entry.source !== 'desk') ? `  (${entry.source})` : '';
  return `[${time}] ${arrow} ${entry.address} ${args}${source}`;
}

function startOscLogRecording() {
  if (oscLogRecordStream) return { ok: true, filePath: oscLogRecordPath };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(oscLogRecordsFolder(), `osc-log-${stamp}.txt`);
  try {
    oscLogRecordStream = fs.createWriteStream(filePath, { flags: 'a' });
    oscLogRecordStream.on('error', (e) => {
      console.error('[JPMixer] OSC log write error:', e.message);
      logEvent('osc-log-error', e.message);
      stopOscLogRecording();
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
  oscLogRecordPath  = filePath;
  oscLogRecordCount = 0;
  logEvent('osc-log-start', filePath);
  return { ok: true, filePath };
}

function stopOscLogRecording() {
  if (!oscLogRecordStream) return { ok: true, filePath: null, count: 0 };
  const filePath = oscLogRecordPath;
  const count     = oscLogRecordCount;
  try { oscLogRecordStream.end(); } catch (e) {}
  oscLogRecordStream = null;
  oscLogRecordPath   = null;
  logEvent('osc-log-stop', `${filePath} (${count} lines)`);
  return { ok: true, filePath, count };
}

function getOscLogRecordingStatus() {
  return { recording: !!oscLogRecordStream, filePath: oscLogRecordPath, count: oscLogRecordCount };
}

// Captures every unique OSC address received — for debugging unknown addresses
const allSeenAddresses = new Map(); // address → last args received

// OSC message cache — address → { address, args }
const cache = new Map();

// Active browser connections
let connections = [];

// True once all console metadata has been loaded
let loaded = false;

// ── Desk liveness ──
// UDP has no connection, so once the names had loaded nothing ever said the
// desk had gone: powered off or unplugged, Settings stayed "Connected" and
// phones kept "working" with nothing reaching the desk. A DiGiCo is silent
// while nothing changes, so after DESK_QUIET_MS without a message a cheap
// query goes out (one the desk is known to answer — seen in a real
// recording); no reply within DESK_PROBE_MS means disconnected. The first
// message back marks it connected again and re-sends every phone mute, since
// a desk that restarted has lost the -150 writes behind them.
let deskAlive = false;
let deskLastHeardAt = 0;
let deskProbeSentAt = 0;
let deskWatchTimer = null;
const DESK_QUIET_MS = 8000;
const DESK_PROBE_MS = 5000;
const DESK_PROBE_ADDRESS = '/Console/Session/Filename/?';

function noteDeskHeard() {
  deskLastHeardAt = Date.now();
  deskProbeSentAt = 0;
  if (loaded && !deskAlive) {
    deskAlive = true;
    logEvent('console-back', 'the desk is answering again — re-sending mutes and refreshing open mixes');
    if (onConsoleStatusChange) onConsoleStatusChange(true);
    reassertMuteSolo();
    if (cache.has('/Console/Input_Channels') && cache.has('/Console/Aux_Outputs/modes')) queueActiveAuxRefresh();
  }
}

function watchDesk() {
  if (!udpPort || !loaded) return;
  const now = Date.now();
  if (now - deskLastHeardAt < DESK_QUIET_MS) return;
  if (deskProbeSentAt && now - deskProbeSentAt < DESK_PROBE_MS) return; // probe still out
  if (deskProbeSentAt && deskAlive) {
    deskAlive = false;
    logEvent('console-lost', `no answer from ${serverCfg.deskIp} for ${Math.round((now - deskLastHeardAt) / 1000)}s`);
    if (onConsoleStatusChange) onConsoleStatusChange(false);
  }
  deskProbeSentAt = now;
  sendToDesk(DESK_PROBE_ADDRESS, []);
}

// Every phone mute and solo, re-sent as -150 to the desk (applyMuteSolo only
// writes silenced channels and anything coming out of silence)
function reassertMuteSolo() {
  const auxes = new Set([...Object.keys(muteState), ...Object.keys(soloState)]);
  for (const aux of auxes) applyMuteSolo(aux, { paced: true }); // every mix at once: keep it paced
}

// Callback fired when console connected/disconnected
let onConsoleStatusChange = null;

// Callback fired when browser connection count changes
let onConnectionCountChange = null;

// Callback fired when the HTTP/WS server fails to (re)start — e.g. port already in use
let onServerError = null;

// Callback fired (batched) with new OSC traffic entries — feeds the Settings OSC Log view
let onOscTraffic = null;

// Background cache-priming interval
let cachePrimeInterval = null;

// Paced, deduped queue for desk queries after startup — browser cache misses,
// EQ loading, Console state, aux refresh and background priming all share one
// query per 100ms tick. See the note on primeCache for why queries are never
// bursted at the desk.
const deskQueryQueue  = [];
const deskQueryQueued = new Set();
let deskQueryTimer    = null;

// `urgent` = a performer waiting on it right now (opening an aux, the EQ
// panel): those go ahead of background work like Console-page polling,
// session refresh and cache priming, which could otherwise sit in front of
// them for tens of seconds. The rate is the same either way.
const deskQueryUrgent = [];

// Queries sent recently and probably still awaiting the desk's reply. Over a
// real network the reply takes long enough that background priming (which
// re-checks every 100ms) used to queue the same query again before the
// answer arrived — every priming query went to the desk twice. A query is
// not re-queued while it's in flight; a lost reply is retried after this.
const QUERY_IN_FLIGHT_MS = 1000;
const deskQuerySentAt = new Map(); // address → ms

function queryInFlight(address) {
  const at = deskQuerySentAt.get(address);
  return at !== undefined && Date.now() - at < QUERY_IN_FLIGHT_MS;
}

function queueDeskQueries(addresses, urgent = false) {
  for (const a of addresses) {
    if (queryInFlight(a)) continue;
    if (deskQueryQueued.has(a)) {
      if (!urgent) continue;
      const i = deskQueryQueue.indexOf(a); // already waiting in the background lane — promote it
      if (i < 0) continue;
      deskQueryQueue.splice(i, 1);
      deskQueryUrgent.push(a);
      continue;
    }
    deskQueryQueued.add(a);
    (urgent ? deskQueryUrgent : deskQueryQueue).push(a);
  }
  if (deskQueryTimer || (deskQueryQueue.length === 0 && deskQueryUrgent.length === 0)) return;
  deskQueryTimer = setInterval(() => {
    const next = deskQueryUrgent.length ? deskQueryUrgent.shift() : deskQueryQueue.shift();
    if (next === undefined) {
      clearInterval(deskQueryTimer);
      deskQueryTimer = null;
      return;
    }
    deskQueryQueued.delete(next);
    deskQuerySentAt.set(next, Date.now());
    if (deskQuerySentAt.size > 2000) {
      for (const [a, at] of deskQuerySentAt) if (Date.now() - at >= QUERY_IN_FLIGHT_MS) deskQuerySentAt.delete(a);
    }
    sendToDesk(next, []);
  }, 100);
}

function clearDeskQueries() {
  if (deskQueryTimer) { clearInterval(deskQueryTimer); deskQueryTimer = null; }
  deskQueryQueue.length = 0;
  deskQueryUrgent.length = 0;
  deskQueryQueued.clear();
  deskQuerySentAt.clear();
  primeAttempts.clear();
}

// Connection watchdog — pings clients to detect silent disconnects
let pingInterval = null;

// Per-aux mute/solo state — [aux][ch] = true
const muteState    = {};
const soloState    = {};
const premuteState = {}; // saved real levels before mute/solo — [aux][ch] = dB

// Console-level state (main faders, mutes, solos) for the console controller page
const consoleFaders = {}; // ch  → dB
const consoleMutes  = {}; // ch  → bool
const consoleSolos  = {}; // ch  → bool
const auxFaders     = {}; // aux → dB
const auxMutes      = {}; // aux → bool
const cgFaders      = {}; // cg  → dB
const cgMutes       = {}; // cg  → bool
const cgSolos       = {}; // cg  → bool

// Channel and control group faders and mutes for plugins (plugins.js
// "faders", JPMixer's own plugins only): what the Console Controller shows,
// and moved the way it moves them. kind 'ch' | 'cg'; a level is dB, -150 off.
const liveCount = (key, fallback) => (cache.has(key) ? cache.get(key).args[0] : fallback);
const stripMax = (kind) => (kind === 'ch' ? liveCount('/Console/Input_Channels', serverCfg.channels || 48) : liveCount('/Console/Control_Groups', serverCfg.groups || 8));
function getStrips() {
  const out = { ch: {}, cg: {} };
  for (const [kind, faders, mutes] of [['ch', consoleFaders, consoleMutes], ['cg', cgFaders, cgMutes]]) {
    for (let n = 1; n <= stripMax(kind); n++) {
      if (faders[n] === undefined && mutes[n] === undefined) continue;
      out[kind][n] = { db: Number.isFinite(faders[n]) ? faders[n] : null, mute: mutes[n] === undefined ? null : !!mutes[n] };
    }
  }
  return out;
}
// Asks the desk for the ones not known yet (through the paced queue)
function primeStrips(list) {
  const queries = [];
  for (const { kind, n } of Array.isArray(list) ? list.slice(0, 64) : []) {
    if (!['ch', 'cg'].includes(kind) || !Number.isInteger(n) || n < 1 || n > stripMax(kind)) continue;
    const base = kind === 'ch' ? `/Input_Channels/${n}` : `/Control_Groups/${n}`;
    if ((kind === 'ch' ? consoleFaders : cgFaders)[n] === undefined) queries.push(`${base}/fader/?`);
    if ((kind === 'ch' ? consoleMutes : cgMutes)[n] === undefined) queries.push(`${base}/mute/?`);
  }
  if (queries.length) queueDeskQueries(queries);
}
function setStrip(kind, nRaw, what, value) {
  const n = parseInt(nRaw, 10);
  if (!['ch', 'cg'].includes(kind) || !Number.isInteger(n) || n < 1 || n > stripMax(kind)) return false;
  const base = kind === 'ch' ? `/Input_Channels/${n}` : `/Control_Groups/${n}`;
  if (what === 'fader') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    const db = Math.max(-150, Math.min(10, value));
    sendToDesk(`${base}/fader`, [db]);
    (kind === 'ch' ? consoleFaders : cgFaders)[n] = db;
    broadcastToClients({ address: `${base}/fader`, args: [db] });
    return true;
  }
  if (what === 'mute') {
    const val = value ? 1.0 : 0.0;
    sendToDesk(`${base}/mute`, [val]);
    (kind === 'ch' ? consoleMutes : cgMutes)[n] = !!value;
    broadcastToClients({ address: `${base}/mute`, args: [val] });
    return true;
  }
  return false;
}

function clearConsoleState() {
  for (const state of [consoleFaders, consoleMutes, consoleSolos, auxFaders, auxMutes, cgFaders, cgMutes, cgSolos]) {
    for (const k of Object.keys(state)) delete state[k];
  }
}

// Snapshot tracking
let currentSnapshotName = '';
let currentSnapshot     = -1;

// Debounce timer for session-change reloads
let sessionReloadTimer  = null;
let sceneRecallTimer = null;
let metadataFetchTimer = null;

function cancelSceneRecall() {
  clearTimeout(sceneRecallTimer);
  sceneRecallTimer = null;
}

// ── Colour helper ─────────────────────────────────────────────────────────

function generateColour(total, index) {
  const h = (index / total) * 360;
  const s = 0.65, l = 0.55;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return `#${[f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

// ── Mute / Solo ───────────────────────────────────────────────────────────

// A performer's mute or solo goes to the desk at once, as in 1.7.x: queued at
// the paced 1-per-100ms rate, a solo on a 48-channel mix took ~5 s to silence
// the other channels one by one. That's at most one write per channel, the
// same burst 1.7.x always sent. `paced` is for re-applying every mix's
// mutes at once (a desk that came back), which can be hundreds of writes.
function applyMuteSolo(aux, { paced = false } = {}) {
  const write = paced ? (key, args) => sendToDeskPaced(key, args, true) : sendToDesk;
  const anySolo = Object.values(soloState[aux] || {}).some(v => v);
  const chCount = cache.has('/Console/Input_Channels')
    ? cache.get('/Console/Input_Channels').args[0]
    : (serverCfg.channels || 48);

  if (!premuteState[aux]) premuteState[aux] = {};

  const restoredLevels = {}; // ch -> dB — sent to clients for fader snap-back
  const unknown = []; // silenced sends whose level isn't read yet

  for (let ch = 1; ch <= chCount; ch++) {
    const key = `/Input_Channels/${ch}/Aux_Send/${aux}/send_level`;
    const muted    = !!(muteState[aux]?.[ch]);
    const soloed   = !!(soloState[aux]?.[ch]);
    const silenced = muted || (anySolo && !soloed);
    // Not read from the desk yet (just after starting, or a mix nobody has
    // open): ask for it, and processDeskSendLevel() silences it when the
    // answer comes, keeping the real level for the unmute. Skipping it left
    // the channel audible while every phone showed it muted.
    if (!cache.has(key)) { if (silenced) unknown.push(`${key}/?`); continue; }

    // Silenced channels are (re-)sent -150 on every mute/solo change, so a
    // -150 lost on a busy network is corrected by the next change rather than
    // leaving a channel audible that every phone shows muted. Audible channels
    // are only written when they come back from silence — a mute is not a
    // rewrite of the whole mix.
    if (silenced) {
      if (premuteState[aux][ch] === undefined) premuteState[aux][ch] = cache.get(key).args[0];
      write(key, [-150]);
    } else if (premuteState[aux][ch] !== undefined) {
      const restore = premuteState[aux][ch];
      write(key, [restore]);
      cache.set(key, { address: key, args: [restore] });
      restoredLevels[ch] = restore;
      delete premuteState[aux][ch];
    }
  }

  if (unknown.length) queueDeskQueries(unknown, true);

  // Single broadcast — includes restored levels so faders snap back in one message
  broadcastToClients({
    type: 'mute-solo-state',
    aux,
    mutes:  muteState[aux]  || {},
    solos:  soloState[aux]  || {},
    levels: restoredLevels
  });
}

function clearMuteSolo() {
  Object.keys(muteState).forEach(k => delete muteState[k]);
  Object.keys(soloState).forEach(k => delete soloState[k]);
  Object.keys(premuteState).forEach(k => delete premuteState[k]);
}

// Shared entry points for both the browser WS handler above and the
// External Control API (api-server.js) — same validation/dispatch either
// way, so a Companion/Stream Deck button behaves identically to a browser
// mute button.
function fireSnapshot(action) {
  const addrMap = {
    prev: '/Snapshots/Fire_Prev_Snapshot',
    next: '/Snapshots/Fire_Next_Snapshot',
  };
  const addr = addrMap[action];
  if (addr) sendToDesk(addr, [1]);
}

function setMute(auxRaw, chRaw, muted) {
  const aux = parseInt(auxRaw), ch = parseInt(chRaw);
  const chMax  = cache.has('/Console/Input_Channels') ? cache.get('/Console/Input_Channels').args[0] : (serverCfg.channels || 48);
  const auxMax = cache.has('/Console/Aux_Outputs/modes') ? cache.get('/Console/Aux_Outputs/modes').args.length : (serverCfg.auxes || 16);
  if (isNaN(aux) || aux < 1 || aux > auxMax || isNaN(ch) || ch < 1 || ch > chMax) return false;
  if (!muteState[aux]) muteState[aux] = {};
  muteState[aux][ch] = !!muted;
  applyMuteSolo(aux);
  return true;
}

function setSolo(auxRaw, chRaw, soloed) {
  const aux = parseInt(auxRaw), ch = parseInt(chRaw);
  const chMax  = cache.has('/Console/Input_Channels') ? cache.get('/Console/Input_Channels').args[0] : (serverCfg.channels || 48);
  const auxMax = cache.has('/Console/Aux_Outputs/modes') ? cache.get('/Console/Aux_Outputs/modes').args.length : (serverCfg.auxes || 16);
  if (isNaN(aux) || aux < 1 || aux > auxMax || isNaN(ch) || ch < 1 || ch > chMax) return false;
  if (!soloState[aux]) soloState[aux] = {};
  soloState[aux][ch] = !!soloed;
  applyMuteSolo(aux);
  return true;
}

// Live relabeling — the External Control API's main use case (e.g. a
// Planning Center connector naming aux mixes after who's playing them for a
// service). Updates the in-memory config this session is using, persists
// via config.js's targeted updateOverride() (not the full save-config path,
// which would restart this backend), and broadcasts to already-connected
// browser clients so labels update live with no reconnect.
// Live relabeling (Control API / Planning Center) — see shared-handlers.js.
// The desk's own counts bound the number once they're known.
function liveChannelCount() {
  return cache.has('/Console/Input_Channels') ? cache.get('/Console/Input_Channels').args[0] : (serverCfg.channels || 48);
}
function liveAuxCount() {
  return cache.has('/Console/Aux_Outputs/modes') ? cache.get('/Console/Aux_Outputs/modes').args.length : (serverCfg.auxes || 16);
}
function setChannelLabel(n, label) {
  return shared.relabel(serverCfg, 'channel', n, label, liveChannelCount(), broadcastToClients);
}

function setAuxLabel(n, label) {
  return shared.relabel(serverCfg, 'aux', n, label, liveAuxCount(), broadcastToClients);
}

// Names last announced to phones from the desk. The desk re-sends every
// name on connect and on snapshot recall; only a change is worth rebuilding
// every phone's list for (a Settings or Planning Center label still wins).
const deskLabelSent = new Map(); // "ch:N" / "aux:N" -> label
function announceDeskLabel(kind, n, label) {
  const key = `${kind}:${n}`;
  if (deskLabelSent.get(key) === label) return;
  deskLabelSent.set(key, label);
  broadcastToClients(kind === 'aux' ? { type: 'aux-relabeled', aux: n, label } : { type: 'channel-relabeled', channel: n, label });
}

// The desk reports the physical -150 dB used to implement mute/solo. Keep
// that echo separate from the musician's logical fader value. This also
// applies an existing solo to channels whose first reply arrives later.
function processDeskSendLevel(msg) {
  const match = msg.address.match(/^\/Input_Channels\/(\d+)\/Aux_Send\/(\d+)\/send_level$/);
  if (!match) return msg;
  const [, ch, aux] = match;
  const silenced = muteState[aux]?.[ch]
    || (Object.values(soloState[aux] || {}).some(Boolean) && !soloState[aux]?.[ch]);
  if (!silenced) return msg;
  if (!premuteState[aux]) premuteState[aux] = {};
  const db = msg.args[0];
  if (db !== -150 || premuteState[aux][ch] === undefined) premuteState[aux][ch] = db;
  // Urgent: a snapshot change restores sends on the desk while it also
  // queues hundreds of Ear Scene writes, and this channel must not stay
  // audible behind them while every phone shows it muted.
  if (db !== -150) sendToDeskPaced(msg.address, [-150], true);
  return { ...msg, args: [premuteState[aux][ch], ...msg.args.slice(1)] };
}

// ── Scene recall ───────────────────────────────────────────────────────────

const sliderToDb = shared.sliderToDb; // one clamped copy for every backend

// Sends one aux's saved scene values to the desk (paced — see sendToDeskPaced)
// and updates server-side caches right away, so the cache, the clients and
// any desk echoes all agree; returns the { chStr: sliderVal } map to send
// back to clients.
function pushSceneValuesToDesk(auxStr, values) {
  const levels = {};
  const aux = parseInt(auxStr);
  const chMax = serverCfg.channels || 48, auxMax = serverCfg.auxes || 16;
  // aux/values come straight from client-controlled recall-scene/apply-preset
  // payloads — an arbitrary object with arbitrary keys/values, not
  // necessarily produced by mixer.js's own UI. Reject rather than build an
  // OSC address (and cache key) from an out-of-range or non-finite input —
  // same lesson as the dLive/KLANG backends' equivalent functions.
  if (isNaN(aux) || aux < 1 || aux > auxMax) return levels;
  const anySolo = Object.values(soloState[aux] || {}).some(v => v);
  if (!premuteState[aux]) premuteState[aux] = {};

  for (const [chStr, sliderVal] of Object.entries(values)) {
    const ch = parseInt(chStr);
    // 0..1 only, and the address from the parsed numbers: "3x" or a negative
    // position used to go to the desk as a malformed address or a NaN level.
    if (isNaN(ch) || ch < 1 || ch > chMax || !Number.isFinite(sliderVal) || sliderVal < 0 || sliderVal > 1) continue;
    const address = `/Input_Channels/${ch}/Aux_Send/${aux}/send_level`;
    const db = sliderToDb(sliderVal);
    const muted    = !!(muteState[aux]?.[ch]);
    const soloed   = !!(soloState[aux]?.[ch]);
    const silenced = muted || (anySolo && !soloed);

    // Always update cache to the real recalled value
    cache.set(address, { address, args: [db] });
    levels[chStr] = sliderVal;

    if (silenced) {
      // Channel is silenced — store real level so unmute restores to the recalled value
      premuteState[aux][ch] = db;
      sendToDeskPaced(address, [-150], true); // silencing always jumps the queue
    } else {
      delete premuteState[aux][ch];
      sendToDeskPaced(address, [db]);
    }
  }
  return levels;
}

function applySceneForSnapshot(snapshotName) {
  if (!serverCfg.sceneRecallEnabled) {
    logEvent('scene-skip', `auto-recall disabled — snapshot:"${snapshotName}"`);
    return;
  }
  const allSavedScenes = scenes.getAll();
  const snapshotScenes = allSavedScenes[snapshotName];
  if (!snapshotScenes) {
    logEvent('scene-skip', `no scene saved for snapshot:"${snapshotName}" (saved keys: ${Object.keys(allSavedScenes).join(', ') || 'none'})`);
    return;
  }

  logEvent('scene-recall', `applying scene for snapshot:"${snapshotName}"`);

  // levels broadcast to clients: { auxStr: { chStr: sliderVal (0-1) } }
  const broadcastLevels = {};
  for (const [auxStr, values] of Object.entries(snapshotScenes)) {
    broadcastLevels[auxStr] = pushSceneValuesToDesk(auxStr, values);
  }

  // Broadcast levels directly — don't rely on desk echoes which may be
  // dropped while loaded=false during a session reload
  broadcastToClients({ type: 'scene-recalled', snapshot: snapshotName, levels: broadcastLevels });
}

// ── Config builder — sent to every new browser client ─────────────────────

function buildConfig(extra) {
  const auxCount = cache.has('/Console/Aux_Outputs/modes')
    ? cache.get('/Console/Aux_Outputs/modes').args.length
    : (serverCfg.auxes || 16);

  const auxModes = cache.has('/Console/Aux_Outputs/modes')
    ? cache.get('/Console/Aux_Outputs/modes').args
    : [];

  const cfgAuxOverrides = serverCfg.auxOverrides || {};
  const auxilaries = [];
  for (let i = 0; i < auxCount; i++) {
    const ov = cfgAuxOverrides[String(i + 1)] || {};
    const consoleName = shared.consoleNameOr(serverCfg, 'auxes', i + 1, cache.has(`/Aux_Outputs/${i+1}/Buss_Trim/name`)
      ? cache.get(`/Aux_Outputs/${i+1}/Buss_Trim/name`).args[0]
      : undefined) || `AUX ${i+1}`;
    auxilaries.push({
      enabled:   ov.enabled !== false,
      label:     ov.label || consoleName,
      channel:   i + 1,
      stereo:    auxModes[i] === 2,
      colour:    ov.colour || generateColour(auxCount, i),
      icon:      '',
      eqEnabled: ov.eqEnabled === true,
      linkOnly:  ov.linkOnly === true,
      groups:    shared.auxGroupNames(ov, serverCfg),
    });
  }

  const chCount = cache.has('/Console/Input_Channels')
    ? cache.get('/Console/Input_Channels').args[0]
    : (serverCfg.channels || 48);

  const channels = shared.buildChannelList(chCount, serverCfg, i => cache.has(`/Input_Channels/${i}/Channel_Input/name`) ? cache.get(`/Input_Channels/${i}/Channel_Input/name`).args[0] : undefined);

  const controlGroups = getControlGroups();

  return JSON.stringify({
    config: {
      channels,
      aux: auxilaries,
      controlGroups,
      snapshot: currentSnapshotName,
      sceneRecallEnabled: !!serverCfg.sceneRecallEnabled,
      earScenes: serverCfg.performerEarScenes !== false, // Settings: Ear Scenes on performer phones
      scenes: scenes.getAll(),
      mutes: muteState,
      solos: soloState,
      ...extra
    }
  });
}

// The console's control groups, by number, with their names (also for plugins)
function getControlGroups() {
  const cgCount = cache.has('/Console/Control_Groups')
    ? cache.get('/Console/Control_Groups').args[0]
    : 8;
  const controlGroups = [];
  for (let i = 1; i <= cgCount; i++) {
    const name = cache.has(`/Control_Groups/${i}/name`)
      ? cache.get(`/Control_Groups/${i}/name`).args[0]
      : cache.has(`/Control_Groups/${i}/Channel_Input/name`)
        ? cache.get(`/Control_Groups/${i}/Channel_Input/name`).args[0]
        : `CG ${i}`;
    controlGroups.push({ channel: i, label: name });
  }
  return controlGroups;
}

// ── Cache ─────────────────────────────────────────────────────────────────

const CACHE_PATTERNS = [
  /^\/Console\/Input_Channels$/,
  /^\/Console\/Aux_Outputs\/modes$/,
  /^\/Console\/Control_Groups$/,
  /^\/Aux_Outputs\/\d+\/Buss_Trim\/name$/,
  /^\/Input_Channels\/\d+\/Channel_Input\/name$/,
  /^\/Control_Groups\/\d+\/Channel_Input\/name$/,
  /^\/Control_Groups\/\d+\/name$/,
  /^\/Input_Channels\/\d+\/Aux_Send\/\d+\/send_level$/,
  /^\/Input_Channels\/\d+\/Aux_Send\/\d+\/send_pan$/,
  /^\/Aux_Outputs\/\d+\/EQ\//,
  channelProcessing.CACHE_RE, // input channel gain/EQ/dynamics… for the Console Controller's channel panel
];

function maybeCacheResponse(msg) {
  for (const pat of CACHE_PATTERNS) {
    if (pat.test(msg.address)) {
      cache.set(msg.address, msg);
      return;
    }
  }
}

// ── Broadcast helpers ─────────────────────────────────────────────────────

// Paced queue for bulk *set* messages to the desk — Ear Scene recalls, My Mix
// loads and mute/solo re-applies. A snapshot change used to write every
// channel of every aux with a scene in one synchronous loop (16 auxes × 50
// channels = 800 UDP packets at once), against the "never burst the desk"
// rule above, and enough to drop packets on a busy network. Now one goes out
// per tick, at the exact same 1-per-100ms cadence as deskQueryTimer above —
// the only desk-traffic rate this project actually has real-world evidence
// is safe (query bursts are what caused the CommandBridge.dll crash this
// pacing discipline exists to avoid). An earlier version of this queue used
// 8 per 10ms (~800/s, ~80x faster) as an untested guess; that's reverted
// until it's actually been validated against real hardware — a full
// 800-message recall now takes ~80s to drain rather than ~1s, which is slow,
// but a crashed desk mid-show is worse than a slow one.
const DESK_SET_BATCH   = 1;
const DESK_SET_TICK_MS = 100;
const deskSetQueue  = new Map(); // address → args
// Mute/solo writes jump the queue — a performer killing feedback must not
// wait behind a snapshot's worth of Ear Scene writes (up to ~1s).
const deskSetUrgent = new Map();
let deskSetTimer    = null;

function sendToDeskPaced(address, args, urgent = false) {
  // An address already waiting in the urgent lane stays there: a bulk write
  // to the same send (a recall) must not push a pending mute to the back.
  urgent = urgent || deskSetUrgent.has(address);
  // re-insert so send order follows the latest write; an address lives in one lane only
  deskSetQueue.delete(address);
  deskSetUrgent.delete(address);
  (urgent ? deskSetUrgent : deskSetQueue).set(address, args);
  if (deskSetTimer) return;
  deskSetTimer = setInterval(() => {
    let sent = 0;
    for (const lane of [deskSetUrgent, deskSetQueue]) {
      for (const [addr, a] of lane) {
        if (sent >= DESK_SET_BATCH) break;
        lane.delete(addr);
        rawSendToDesk(addr, a);
        sent++;
      }
    }
    if (deskSetQueue.size === 0 && deskSetUrgent.size === 0) { clearInterval(deskSetTimer); deskSetTimer = null; }
  }, DESK_SET_TICK_MS);
}

function clearDeskSetQueue() {
  if (deskSetTimer) { clearInterval(deskSetTimer); deskSetTimer = null; }
  const dropped = deskSetQueue.size + deskSetUrgent.size;
  if (dropped) logEvent('desk-set-dropped', `${dropped} queued writes discarded`);
  deskSetQueue.clear();
  deskSetUrgent.clear();
}

// On stop, queued writes are the desk state people asked for — an unmute's
// restore, the rest of a recall. Dropping them left unmuted channels at -150
// on the desk (their premute level was already handed to the queue). Sending
// the remainder at once is a burst, but only of whatever hadn't drained yet,
// and only at shutdown or a restart. NOTE: now that the steady-state queue
// is paced at 1/100ms (see DESK_SET_BATCH above, slowed from an untested
// 800/s), a stop/restart that lands mid-recall can have a meaningfully
// larger backlog still queued than before — this flush still bursts all of
// it at once rather than pacing it out. That's an intentional, narrower
// trade (a restart landing exactly mid-recall is rare, and main.js's quit
// path only allows ~1s for stop() to finish anyway), but it's worth
// revisiting with real hardware if a full-recall-then-immediate-restart
// turns out to be a real pattern in practice.
function flushDeskSetQueue() {
  if (deskSetTimer) { clearInterval(deskSetTimer); deskSetTimer = null; }
  const pending = [...deskSetUrgent, ...deskSetQueue];
  deskSetUrgent.clear();
  deskSetQueue.clear();
  if (pending.length) logEvent('desk-set-flush', `${pending.length} queued writes sent on stop`);
  for (const [addr, a] of pending) rawSendToDesk(addr, a);
}

function sendToDesk(address, args) {
  // supersedes a queued paced write to the same address
  if (deskSetQueue.size) deskSetQueue.delete(address);
  if (deskSetUrgent.size) deskSetUrgent.delete(address);
  rawSendToDesk(address, args);
}

function rawSendToDesk(address, args) {
  if (!udpPort || !serverCfg.deskIp) return;
  try {
    udpPort.send({ address, args: args || [] }, serverCfg.deskIp, serverCfg.deskSendPort);
    logOscTraffic('out', address, args || [], 'desk');
  } catch (e) {
    console.error('[JPMixer] sendToDesk error:', e.message);
  }
}

function sendToAllIpads(address, args, excludeIp) {
  if (!udpPort) return;
  for (const { ip, sendPort } of ipadPorts.values()) {
    if (ip === excludeIp) continue;
    try {
      udpPort.send({ address, args: args || [] }, ip, sendPort);
    } catch (e) {}
  }
}

// (Re)builds the iPad registry from config — at start, and live from
// applyConfigLive() so adding or fixing an iPad no longer restarts the server
// (which dropped every phone). Health stats survive for an unchanged entry.
function registerIpads(cfg) {
  const previous = new Map([...ipadPorts.values()].map(e => [e.id, e]));
  ipadPorts.clear();
  for (const conn of (cfg.ipadConnections || [])) {
    if (!conn.enabled || !conn.ip) continue;
    const old = previous.get(conn.id);
    const keep = old && old.configuredIp === conn.ip;
    const ip = keep ? old.ip : conn.ip;
    ipadPorts.set(ip, {
      id: conn.id, name: conn.name || 'iPad', ip, configuredIp: conn.ip, sendPort: conn.sendPort,
      lastHeardAt: keep ? old.lastHeardAt : null, messages: keep ? old.messages : 0
    });
  }
}

// OSC arriving from an address that's neither the desk nor a configured iPad.
// Its messages used to go through the desk path, so a stray device (or an iPad
// whose DHCP address changed) could make JPMixer record levels the desk never
// had. Now they're ignored and listed for Settings — except that a sender
// asking the console questions (".../?", which a desk never sends) while
// exactly one configured iPad has gone quiet is that iPad at a new address,
// and is followed automatically.
const IPAD_QUIET_MS = 60000;
const unknownSenders = new Map(); // ip → { lastAt, messages, lastAddress, asksQuestions }

function adoptMovedIpad(ip, oscMsg) {
  if (!oscMsg.address.endsWith('/?')) return null;
  const now = Date.now();
  const quiet = [...ipadPorts.values()].filter(e => !e.lastHeardAt || now - e.lastHeardAt > IPAD_QUIET_MS);
  if (quiet.length !== 1 || ipadPorts.size !== 1) return null;
  const entry = quiet[0];
  ipadPorts.delete(entry.ip);
  logEvent('ipad-moved', `"${entry.name}" now sending from ${ip} (configured ${entry.configuredIp}) — following it`);
  entry.ip = ip;
  ipadPorts.set(ip, entry);
  unknownSenders.delete(ip);
  return entry;
}

function noteUnknownSender(ip, oscMsg) {
  const rec = unknownSenders.get(ip) || { messages: 0, asksQuestions: false };
  if (!unknownSenders.has(ip)) logEvent('osc-unknown-sender', `${ip} is sending OSC but isn't the console or a configured iPad (${oscMsg.address})`);
  rec.lastAt = Date.now();
  rec.messages++;
  rec.lastAddress = oscMsg.address;
  if (oscMsg.address.endsWith('/?')) rec.asksQuestions = true;
  // Replies to console queries (session, snapshot and channel names) only
  // come from a desk: this is probably the console, on an address other
  // than the one in Settings
  if (!oscMsg.address.endsWith('/?') && /^\/(Console|Snapshots)\/|^\/Input_Channels\/\d+\/Channel_Input\/name$/.test(oscMsg.address)) rec.looksLikeConsole = true;
  unknownSenders.set(ip, rec);
}

// For Settings: each configured iPad's state, plus unknown senders
function getIpadStatus() {
  const now = Date.now();
  return {
    ipads: [...ipadPorts.values()].map(e => ({
      id: e.id, name: e.name, ip: e.ip, configuredIp: e.configuredIp, sendPort: e.sendPort,
      lastHeardAt: e.lastHeardAt, messages: e.messages
    })),
    unknownSenders: [...unknownSenders.entries()]
      .filter(([, r]) => now - r.lastAt < 5 * 60000)
      .map(([ip, r]) => ({ ip, lastAt: r.lastAt, messages: r.messages, lastAddress: r.lastAddress, asksQuestions: r.asksQuestions, looksLikeConsole: !!r.looksLikeConsole }))
  };
}

// Counts how many connected mixer clients currently have each aux selected —
// lets the Monitor view show "who's mixing what" without exposing identities.
function getActiveMixerCounts() {
  const counts = {};
  for (const conn of connections) {
    if (conn.readyState === WebSocket.OPEN && conn._activeAux != null) {
      counts[conn._activeAux] = (counts[conn._activeAux] || 0) + 1;
    }
  }
  return counts;
}

// Per-connection info for the Devices view — only includes clients that have
// actually identified as a mixer (sent identify and/or set-active-aux), so
// the Devices/Console/Monitor pages themselves never show up in their own list.
function getConnectedDevicesInfo() {
  const devices = [];
  for (const conn of connections) {
    if (conn.readyState === WebSocket.OPEN && (conn._deviceId != null || conn._activeAux != null)) {
      devices.push({
        deviceId:     conn._deviceId || null,
        aux:          conn._activeAux ?? null,
        lastActivity: conn._lastActivityAt || null,
        lastPong:     conn._lastPong || null
      });
    }
  }
  return devices;
}

function broadcastDevicesUpdate() {
  broadcastToClients({ type: 'devices-update', devices: getConnectedDevicesInfo() });
}

// device-activity → Devices view only, rate-limited — see shared-handlers.js
function broadcastActivity(msg, fromWs) {
  shared.broadcastActivity(connections, msg, fromWs);
}

function broadcastToClients(msg, excludeSocket) {
  const payload = typeof msg === 'string' ? msg : JSON.stringify(msg);
  const alive = [];
  for (const conn of connections) {
    if (conn.readyState === WebSocket.OPEN) {
      alive.push(conn);
      if (conn !== excludeSocket) conn.send(payload);
    }
  }
  connections = alive;
}

function broadcast(oscMsg, excludeIpOrSocket) {
  // Forward to desk (unless message originated from desk)
  if (excludeIpOrSocket !== serverCfg.deskIp) {
    sendToDesk(oscMsg.address, oscMsg.args);
  }

  // Relay to all iPads (skip the one that sent this message)
  sendToAllIpads(oscMsg.address, oscMsg.args, excludeIpOrSocket);

  // Forward to browser clients
  const payload = JSON.stringify(oscMsg);
  const alive = [];
  for (const conn of connections) {
    if (conn.readyState === WebSocket.OPEN) {
      alive.push(conn);
      if (conn !== excludeIpOrSocket) conn.send(payload);
    }
  }
  connections = alive;
}

// ── Sequential loader — polls desk until all metadata is cached ───────────

// Retry timer for the metadata load: re-asks for whatever the loader is
// waiting on — the channel count at first, then the name whose reply was
// lost. Always re-asking for /Console/Channels/? made the desk re-send its
// 9-message console summary every 3s for the whole name load (seen against
// the offline editor after a session change).
function fetchValues() {
  clearTimeout(metadataFetchTimer);
  metadataFetchTimer = null;
  if (loaded) return;
  console.log('[JPMixer] Requesting console metadata…');
  loadNextRequiredParameter();
  if (!loaded) metadataFetchTimer = setTimeout(fetchValues, 3000);
}

// The loader below re-runs on every incoming message, and the desk answers
// some queries with several messages (/Console/Channels/? → 9), so the same
// next query used to go out up to 9 times in a burst. Send each at most once
// per half second; fetchValues()'s 3s retry still covers a lost reply.
let lastLoadQuery = null, lastLoadQueryAt = 0;
function sendLoadQuery(address) {
  if (address === lastLoadQuery && Date.now() - lastLoadQueryAt < 500) return;
  lastLoadQuery = address;
  lastLoadQueryAt = Date.now();
  sendToDesk(address, []);
}

function loadNextRequiredParameter() {
  if (!cache.has('/Console/Input_Channels')) {
    sendLoadQuery('/Console/Channels/?');
    return;
  }

  if (!cache.has('/Console/Aux_Outputs/modes')) {
    sendLoadQuery('/Console/Aux_Outputs/modes/?');
    return;
  }

  // One request at a time, paced by the desk's own reply — this function re-runs
  // on every incoming OSC message, so the next request only goes out once the
  // previous one is answered. Matches the v1.1.6 behavior. A later change that
  // burst all missing names in a single synchronous tick was reverted: it's the
  // prime suspect for an Access Violation crash in the console's CommandBridge.dll,
  // which never happened under this slower pacing. Do not re-batch this.
  const auxCount = cache.get('/Console/Aux_Outputs/modes').args.length;
  for (let i = 1; i <= auxCount; i++) {
    if (!cache.has(`/Aux_Outputs/${i}/Buss_Trim/name`)) {
      sendLoadQuery(`/Aux_Outputs/${i}/Buss_Trim/name/?`);
      return;
    }
  }

  const chCount = cache.get('/Console/Input_Channels').args[0];
  for (let i = 1; i <= chCount; i++) {
    if (!cache.has(`/Input_Channels/${i}/Channel_Input/name`)) {
      sendLoadQuery(`/Input_Channels/${i}/Channel_Input/name/?`);
      return;
    }
  }

  // All names loaded — request current snapshot then go live
  sendToDesk('/Snapshots/Current_Snapshot/?', []);

  loaded = true;
  deskAlive = true;
  deskLastHeardAt = Date.now();
  deskProbeSentAt = 0;
  clearTimeout(metadataFetchTimer);
  metadataFetchTimer = null;
  logEvent('metadata-loaded', `clients:${connections.length}`);
  if (onConsoleStatusChange) onConsoleStatusChange(true);

  // wss already running means this was a session-change reload with pages
  // still connected — they only get the layout on connect otherwise, so push
  // the new session's config, then refresh the auxes people are actively
  // mixing ahead of background priming.
  if (wss) {
    broadcastToClients(buildConfig({ sessionReload: true }));
    queueActiveAuxRefresh();
  }
  startWebSocketServer();

  // Prime aux send levels in the background
  cachePrimeInterval = setInterval(primeCache, 100);
}

// One query per 100ms tick — matches v1.1.6. This was briefly raised to a
// 12-per-tick batch to speed up priming, but that's the other prime suspect
// for the CommandBridge.dll Access Violation crash: a real console apparently
// can't be trusted with that much concurrent query load. The Monitor view
// takes longer to fully populate in the background as a result, but the
// mixer/console pages are already usable well before priming finishes, and
// requestAuxValues() in mixer.js asks for a given aux the moment a performer
// opens it — those queries take the paced queue's urgent lane, ahead of this
// background priming. Do not raise this without confirming on real
// hardware, not just a demo-mode/local test.
// Tries per value before priming gives up on it (a desk that never answers
// one address must not stall priming of everything after it)
const PRIME_MAX_ATTEMPTS = 3;
const primeAttempts = new Map(); // query address → tries

function primeCache() {
  if (deskQueryQueue.length > 0 || deskQueryUrgent.length > 0) return; // yield the tick — keeps the combined query rate at one per 100ms

  const chCount  = cache.has('/Console/Input_Channels')
    ? cache.get('/Console/Input_Channels').args[0]
    : (serverCfg.channels || 48);
  const auxCount = cache.has('/Console/Aux_Outputs/modes')
    ? cache.get('/Console/Aux_Outputs/modes').args.length
    : (serverCfg.auxes || 16);

  // Every send level and pan (what the mixes need), then each channel's
  // 48V (for the Patch plugin's 48V lights; the desk also pushes changes)
  function* wanted() {
    for (let aux = 1; aux <= auxCount; aux++) {
      for (let ch = 1; ch <= chCount; ch++) {
        for (const prop of ['send_level', 'send_pan']) yield `/Input_Channels/${ch}/Aux_Send/${aux}/${prop}`;
      }
    }
    for (let ch = 1; ch <= chCount; ch++) yield `/Input_Channels/${ch}/Channel_Input/phantom`;
  }
  let waiting = false; // something is still in flight — not finished yet
  for (const key of wanted()) {
    if (cache.has(key)) continue;
    const query = `${key}/?`;
    if (queryInFlight(query)) { waiting = true; continue; }
    const tries = primeAttempts.get(query) || 0;
    if (tries >= PRIME_MAX_ATTEMPTS) continue; // the desk doesn't answer this one
    primeAttempts.set(query, tries + 1);
    queueDeskQueries([query]);
    return;
  }
  if (waiting) return;

  clearInterval(cachePrimeInterval);
  cachePrimeInterval = null;
  const skipped = [...primeAttempts.values()].filter(n => n >= PRIME_MAX_ATTEMPTS).length;
  console.log(`[JPMixer] Cache fully primed${skipped ? ` (${skipped} values never answered by the desk)` : ''}`);
}

// After a session reload, re-query send levels (and pans, for stereo auxes) for
// every aux a connected mixer has open, through the paced queue — mixer.js
// skips its own requestAuxValues() burst on a sessionReload config.
function queueActiveAuxRefresh() {
  const chCount  = cache.get('/Console/Input_Channels').args[0];
  const auxModes = cache.get('/Console/Aux_Outputs/modes').args;
  const activeAuxes = [...new Set(connections.map(c => c._activeAux).filter(a => a != null))];
  // Every active aux's levels before any pans — levels are what performers
  // react to. Phones keep showing their previous faders meanwhile (mixer.js
  // keeps the rows when the channel layout is unchanged).
  const levels = [], pans = [];
  for (const aux of activeAuxes) {
    for (let ch = 1; ch <= chCount; ch++) {
      levels.push(`/Input_Channels/${ch}/Aux_Send/${aux}/send_level/?`);
      if (auxModes[aux - 1] === 2) pans.push(`/Input_Channels/${ch}/Aux_Send/${aux}/send_pan/?`);
    }
  }
  queueDeskQueries(levels.concat(pans));
}

// ── Snapshot tracking ─────────────────────────────────────────────────────

function processSnapshotMsg(oscMsg) {
  // Ignore the outgoing session's remaining notifications while the desk
  // settles. The metadata reload requests the current snapshot again.
  if (sessionReloadTimer) return;
  if (oscMsg.address === '/Snapshots/Current_Snapshot') {
    cancelSceneRecall();
    currentSnapshot = oscMsg.args[0];
    if (currentSnapshot < 0) {
      currentSnapshotName = '';
      broadcastToClients({ address: '/SnapshotName', args: [currentSnapshotName] });
      return;
    }
    sendToDesk('/Snapshots/names/?', []);
    return;
  }

  const rename = oscMsg.address.match(/^\/Snapshots\/Rename_Snapshot\/(\d+)$/);
  if (rename && parseInt(rename[1]) === currentSnapshot) {
    currentSnapshotName = oscMsg.args[0];
    broadcastToClients({ address: '/SnapshotName', args: [currentSnapshotName] });
    return;
  }

  if (oscMsg.address === '/Snapshots/name' && oscMsg.args[0] === currentSnapshot) {
    currentSnapshotName = oscMsg.args[oscMsg.args.length - 1];
    broadcastToClients({ address: '/SnapshotName', args: [currentSnapshotName] });
    cancelSceneRecall();
    const snapshot = currentSnapshot, name = currentSnapshotName;
    sceneRecallTimer = setTimeout(() => {
      sceneRecallTimer = null;
      if (currentSnapshot === snapshot && currentSnapshotName === name) applySceneForSnapshot(name);
    }, 300);
  }
}

// ── WebSocket server — started only after console is loaded ───────────────

function startWebSocketServer() {
  if (wss) return;
  wss = new WebSocket.Server({ server: httpServer });

  // Ping all clients every 25s using native WS ping frames (handled by browser
  // at protocol level — works even when iOS has suspended JavaScript).
  // Also send a JSON ping so the client's own heartbeat timer stays alive.
  // Terminate only if no pong received for 75s (3 missed ping intervals).
  pingInterval = setInterval(() => {
    const now = Date.now();
    for (const client of connections) {
      if (now - client._lastPong > 75000) {
        logEvent('ping-timeout', `terminating stale client`);
        client.terminate();
        continue;
      }
      try { client.ping(); } catch (_) {}
      try { client.send(JSON.stringify({ type: 'ping' })); } catch (_) {}
    }
    // Refresh the Devices view's last-active/connection-quality snapshot on
    // the same cadence, even when nothing else about the device list changed.
    broadcastDevicesUpdate();
  }, 25000);

  wss.on('connection', (ws, req) => {
    access.noteSocket(ws, req);
    logEvent('client-connect', `total:${connections.length + 1}`);
    ws._lastPong = Date.now();
    ws.on('pong', () => { ws._lastPong = Date.now(); }); // native pong — works even when iOS JS is suspended
    connections.push(ws);
    if (onConnectionCountChange) onConnectionCountChange(connections.length);
    broadcastToClients({ type: 'connection-count', count: connections.length });

    // Send full console state immediately (guard against fast disconnect on connect)
    try {
      ws.send(buildConfig());
      ws.send(JSON.stringify({ type: 'active-mixers', counts: getActiveMixerCounts() }));
      ws.send(JSON.stringify({ type: 'devices-update', devices: getConnectedDevicesInfo() }));
    } catch (_) {}

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);

        if (msg.type === 'pong') { ws._lastPong = Date.now(); return; }
        // The Console Controller's messages need its code (Settings → Pages)
        if (!access.consoleMessageAllowed(ws, msg)) return;

        // Mixer: dump cached levels (and pans) for one specific aux — cache
        // only, never queries the desk
        if (msg.type === 'request-aux-levels') {
          for (const [address, cached] of cache.entries()) {
            if (address.includes(`/Aux_Send/${msg.aux}/`) && (address.endsWith('/send_level') || address.endsWith('/send_pan'))) {
              ws.send(JSON.stringify(cached));
            }
          }
          return;
        }

        // Monitor: dump all cached send levels to this client in a single
        // message — sending hundreds of individual frames made the initial
        // fader fill noticeably slow to settle on first load
        if (msg.type === 'request-all-levels') {
          const sendLevels = [];
          for (const [address, cached] of cache.entries()) {
            if (address.includes('/Aux_Send/') && address.endsWith('/send_level')) {
              sendLevels.push(cached);
            }
          }
          ws.send(JSON.stringify({ type: 'all-levels', levels: sendLevels }));
          return;
        }

        // Scene commands from browser. `snapshot` is optional — omitted for the
        // normal "save what's live right now" flow (defaults to the desk's
        // current snapshot); the Ear Scenes editor passes it explicitly to
        // target a different, non-live snapshot without touching the desk.
        if (msg.type === 'save-scene') {
          const snapshot = (typeof msg.snapshot === 'string' && msg.snapshot) ? msg.snapshot : currentSnapshotName;
          if (!snapshot) return;
          if (!scenes.saveScene(snapshot, msg.aux, msg.values)) return; // not a mix number, or no fader values
          logEvent('scene-save', `snapshot:"${snapshot}" aux:${msg.aux}`);
          broadcastToClients({ type: 'scene-saved', snapshot, aux: msg.aux });
          ws._lastActivityAt = Date.now();
          broadcastActivity({ type: 'device-activity', deviceId: ws._deviceId || null, aux: msg.aux, kind: 'save-scene', snapshot }, ws);
          return;
        }
        if (msg.type === 'delete-scene') {
          const snapshot = (typeof msg.snapshot === 'string' && msg.snapshot) ? msg.snapshot : currentSnapshotName;
          if (!snapshot) return;
          logEvent('scene-delete', `snapshot:"${snapshot}" aux:${msg.aux}`);
          scenes.deleteScene(snapshot, msg.aux);
          broadcastToClients({ type: 'scene-deleted', snapshot, aux: msg.aux });
          return;
        }
        // Musician asked to revert their live mix back to the saved scene
        if (msg.type === 'recall-scene') {
          const saved = scenes.getScene(currentSnapshotName, msg.aux);
          if (!saved) return;
          logEvent('scene-recall-manual', `snapshot:"${currentSnapshotName}" aux:${msg.aux}`);
          const auxStr = String(msg.aux);
          const levels = pushSceneValuesToDesk(auxStr, saved);
          broadcastToClients({ type: 'scene-recalled', snapshot: currentSnapshotName, levels: { [auxStr]: levels } });
          return;
        }
        // Ear Scenes editor asking for a saved snapshot's actual stored levels —
        // read-only, never touches the desk (the client's local allScenes cache
        // only ever holds a true/false "exists" flag once any save/delete event
        // has passed through, not the real per-channel values).
        if (msg.type === 'request-scene') {
          if (!msg.snapshot) return;
          const values = scenes.getScene(msg.snapshot, msg.aux) || {};
          try { ws.send(JSON.stringify({ type: 'scene-values', snapshot: msg.snapshot, aux: msg.aux, values })); } catch (_) {}
          return;
        }

        // Mixer tells us which aux it's currently viewing/adjusting — lets the
        // Monitor view show a live "who's mixing what" presence indicator.
        if (msg.type === 'set-active-aux') {
          ws._activeAux = (msg.aux === null || msg.aux === undefined) ? null : parseInt(msg.aux, 10);
          broadcastToClients({ type: 'active-mixers', counts: getActiveMixerCounts() });
          broadcastDevicesUpdate();
          return;
        }

        // Mixer announces its device id once after connecting — lets the
        // Devices view label each connected client's card.
        if (msg.type === 'identify') {
          ws._deviceId = msg.deviceId || null;
          broadcastDevicesUpdate();
          return;
        }


        // My Mixes storage/sync, Find My Mixes and the activity feed are the
        // same on every backend — see shared-handlers.js
        if (shared.handleSharedMessage(ws, msg, { logEvent, onActivity: broadcastActivity })) return;

        // Client sends levels+pans from localStorage; server pushes them to the desk.
        if (msg.type === 'apply-preset') {
          const auxStr = String(msg.aux);
          const auxNum = parseInt(auxStr);
          if (isNaN(auxNum) || auxNum < 1 || auxNum > (serverCfg.auxes || 16)) return;
          const levels = pushSceneValuesToDesk(auxStr, msg.levels || {});
          // Same reasoning as pushSceneValuesToDesk — ch/val come straight
          // from a client-controlled msg.pans object, not the allowlisted
          // OSC-address path below, so nothing else validates them.
          const chMax = serverCfg.channels || 48;
          for (const [chStr, rawPan] of Object.entries(msg.pans || {})) {
            const ch = parseInt(chStr);
            if (isNaN(ch) || ch < 1 || ch > chMax || !Number.isFinite(rawPan)) continue;
            const val = Math.max(0, Math.min(1, rawPan)); // a pan is 0..1, as the other backends enforce
            const addr = `/Input_Channels/${ch}/Aux_Send/${auxNum}/send_pan`;
            sendToDeskPaced(addr, [val]);
            cache.set(addr, { address: addr, args: [val] });
          }
          logEvent('preset-apply', `aux:${msg.aux} name:"${msg.name}"`);
          broadcastToClients({ type: 'preset-loaded', aux: msg.aux, name: msg.name, levels, pans: msg.pans || {} });
          return;
        }
        if (msg.type === 'request-aux-eq') {
          const auxNum = parseInt(msg.aux);
          if (isNaN(auxNum) || auxNum < 1 || auxNum > (serverCfg.auxes || 16)) return;
          // The parsed number, not msg.aux as sent: "3abc" passed the check
          // above and went to the desk as /Aux_Outputs/3abc/EQ/…
          const prefix = `/Aux_Outputs/${auxNum}/EQ/`;
          const eq = {};
          for (const [address, cached] of cache.entries()) {
            if (address.startsWith(prefix)) eq[address.slice(prefix.length)] = cached.args[0];
          }
          ws.send(JSON.stringify({ type: 'aux-eq', aux: auxNum, eq }));
          // Query any missing params from the desk one at a time, paced — not
          // bursted in a single tick (see the note on primeCache for why).
          const missingEq = [];
          for (let b = 1; b <= 8; b++) {
            for (const p of [`eq_gain_${b}`, `eq_freq_${b}`, `eq_Q_${b}`]) {
              if (!cache.has(`${prefix}${p}`)) missingEq.push(`${prefix}${p}/?`);
            }
          }
          if (!cache.has(`${prefix}eq_in`)) missingEq.push(`${prefix}eq_in/?`);
          queueDeskQueries(missingEq, true);
          return;
        }

        // Console page — request all cached console state
        if (msg.type === 'request-console-state') {
          ws.send(buildConfig());
          // Send whatever we've already cached
          for (const [ch, db] of Object.entries(consoleFaders))
            ws.send(JSON.stringify({ address: `/Input_Channels/${ch}/fader`, args: [db] }));
          for (const [ch, m] of Object.entries(consoleMutes))
            ws.send(JSON.stringify({ address: `/Input_Channels/${ch}/mute`, args: [m ? 1.0 : 0.0] }));
          for (const [ch, s] of Object.entries(consoleSolos))
            ws.send(JSON.stringify({ address: `/Input_Channels/${ch}/solo`, args: [s ? 1.0 : 0.0] }));
          for (const [aux, db] of Object.entries(auxFaders))
            ws.send(JSON.stringify({ address: `/Aux_Outputs/${aux}/fader`, args: [db] }));
          for (const [aux, m] of Object.entries(auxMutes))
            ws.send(JSON.stringify({ address: `/Aux_Outputs/${aux}/mute`, args: [m ? 1.0 : 0.0] }));
          for (const [cg, db] of Object.entries(cgFaders))
            ws.send(JSON.stringify({ address: `/Control_Groups/${cg}/fader`, args: [db] }));
          for (const [cg, m] of Object.entries(cgMutes))
            ws.send(JSON.stringify({ address: `/Control_Groups/${cg}/mute`, args: [m ? 1.0 : 0.0] }));
          for (const [cg, s] of Object.entries(cgSolos))
            ws.send(JSON.stringify({ address: `/Control_Groups/${cg}/solo`, args: [s ? 1.0 : 0.0] }));
          // Poll the desk for anything not already known — responses come back
          // via OSC and broadcast to all clients. Desk-side changes keep the
          // state above current once it's filled, so a reconnect only queries
          // what's missing, and through the paced queue rather than one burst.
          const chCount  = cache.has('/Console/Input_Channels')
            ? cache.get('/Console/Input_Channels').args[0] : (serverCfg.channels || 48);
          const auxCount = cache.has('/Console/Aux_Outputs/modes')
            ? cache.get('/Console/Aux_Outputs/modes').args.length : (serverCfg.auxes || 16);
          const cgPollCount = cache.has('/Console/Control_Groups')
            ? cache.get('/Console/Control_Groups').args[0] : 8;
          const queries = [];
          for (let i = 1; i <= chCount; i++) {
            if (consoleFaders[i] === undefined) queries.push(`/Input_Channels/${i}/fader/?`);
            if (consoleMutes[i]  === undefined) queries.push(`/Input_Channels/${i}/mute/?`);
            if (consoleSolos[i]  === undefined) queries.push(`/Input_Channels/${i}/solo/?`);
          }
          for (let i = 1; i <= auxCount; i++) {
            if (auxFaders[i] === undefined) queries.push(`/Aux_Outputs/${i}/fader/?`);
            if (auxMutes[i]  === undefined) queries.push(`/Aux_Outputs/${i}/mute/?`);
          }
          for (let i = 1; i <= cgPollCount; i++) {
            if (cgFaders[i] === undefined) queries.push(`/Control_Groups/${i}/fader/?`);
            if (cgMutes[i]  === undefined) queries.push(`/Control_Groups/${i}/mute/?`);
            if (cgSolos[i]  === undefined) queries.push(`/Control_Groups/${i}/solo/?`);
            if (!cache.has(`/Control_Groups/${i}/name`) && !cache.has(`/Control_Groups/${i}/Channel_Input/name`)) {
              queries.push(`/Control_Groups/${i}/name/?`);
              queries.push(`/Control_Groups/${i}/Channel_Input/name/?`);
            }
          }
          queueDeskQueries(queries);
          return;
        }

        // Console page controls below (console-*/aux-*/cg-*) previously took
        // ch/aux/cg/db straight from the message with no validation at all —
        // unlike set-mute/set-solo just above, which bound-check against the
        // configured/live channel & aux counts. msg.db in particular flowed
        // straight from Math.log-scaled client input into a real OSC float
        // sent to the desk with no finiteness check (the same NaN-forwarding
        // class of bug fixed elsewhere in this pass). These are WS messages,
        // reachable by anything that opens a connection — not just the
        // Console Controller page's own UI, since nothing here distinguishes
        // which HTML page a given connection loaded.
        const liveChMax  = cache.has('/Console/Input_Channels') ? cache.get('/Console/Input_Channels').args[0] : (serverCfg.channels || 48);
        const liveAuxMax = cache.has('/Console/Aux_Outputs/modes') ? cache.get('/Console/Aux_Outputs/modes').args.length : (serverCfg.auxes || 16);
        const liveCgMax  = cache.has('/Console/Control_Groups') ? cache.get('/Console/Control_Groups').args[0] : (serverCfg.groups || 8);

        // Console page — one channel's processing panel (gain, filters, EQ,
        // dynamics…; see digico-channel.js). What's cached is sent straight
        // away; the rest is asked for one query per tick, the section the
        // engineer is looking at first, never in a burst.
        if (msg.type === 'request-channel-detail') {
          const ch = parseInt(msg.ch);
          if (isNaN(ch) || ch < 1 || ch > liveChMax) return;
          const prefix = `/Input_Channels/${ch}/`;
          const values = {};
          for (const p of Object.keys(channelProcessing.PARAMS)) if (cache.has(prefix + p)) values[p] = cache.get(prefix + p).args[0];
          ws.send(JSON.stringify({ type: 'channel-detail', ch, params: channelProcessing.PARAMS, values }));
          queueDeskQueries(channelProcessing.pathsInOrder(msg.section).filter(p => !cache.has(prefix + p)).map(p => `${prefix}${p}/?`), true);
          return;
        }

        // Console page — set one channel-processing control. Only the controls
        // in digico-channel.js, clamped to their range, ever reach the desk.
        if (msg.type === 'console-param') {
          const ch = parseInt(msg.ch);
          if (isNaN(ch) || ch < 1 || ch > liveChMax) return;
          const value = channelProcessing.clampValue(String(msg.path), msg.value);
          if (value === null) return;
          const address = `/Input_Channels/${ch}/${msg.path}`;
          sendToDesk(address, [value]);
          cache.set(address, { address, args: [value] });
          broadcastToClients({ address, args: [value] }, ws);
          return;
        }

        // Console page — main channel fader. Fader broadcasts skip the sender:
        // echoing its own (by then older) position back makes the thumb jitter.
        if (msg.type === 'console-fader') {
          const ch = parseInt(msg.ch);
          if (isNaN(ch) || ch < 1 || ch > liveChMax || !Number.isFinite(msg.db)) return;
          sendToDesk(`/Input_Channels/${ch}/fader`, [msg.db]);
          consoleFaders[ch] = msg.db;
          broadcastToClients({ address: `/Input_Channels/${ch}/fader`, args: [msg.db] }, ws);
          return;
        }

        // Console page — main channel mute
        if (msg.type === 'console-mute') {
          const ch = parseInt(msg.ch);
          if (isNaN(ch) || ch < 1 || ch > liveChMax) return;
          const val = msg.muted ? 1.0 : 0.0;
          sendToDesk(`/Input_Channels/${ch}/mute`, [val]);
          consoleMutes[ch] = msg.muted;
          broadcastToClients({ address: `/Input_Channels/${ch}/mute`, args: [val] });
          return;
        }

        // Console page — main channel solo
        if (msg.type === 'console-solo') {
          const ch = parseInt(msg.ch);
          if (isNaN(ch) || ch < 1 || ch > liveChMax) return;
          const val = msg.soloed ? 1.0 : 0.0;
          sendToDesk(`/Input_Channels/${ch}/solo`, [val]);
          consoleSolos[ch] = msg.soloed;
          broadcastToClients({ address: `/Input_Channels/${ch}/solo`, args: [val] });
          return;
        }

        // Console page — aux output fader
        if (msg.type === 'aux-fader') {
          const aux = parseInt(msg.aux);
          if (isNaN(aux) || aux < 1 || aux > liveAuxMax || !Number.isFinite(msg.db)) return;
          sendToDesk(`/Aux_Outputs/${aux}/fader`, [msg.db]);
          auxFaders[aux] = msg.db;
          broadcastToClients({ address: `/Aux_Outputs/${aux}/fader`, args: [msg.db] }, ws);
          return;
        }

        // Console page — aux output mute
        if (msg.type === 'aux-mute') {
          const aux = parseInt(msg.aux);
          if (isNaN(aux) || aux < 1 || aux > liveAuxMax) return;
          const val = msg.muted ? 1.0 : 0.0;
          sendToDesk(`/Aux_Outputs/${aux}/mute`, [val]);
          auxMutes[aux] = msg.muted;
          broadcastToClients({ address: `/Aux_Outputs/${aux}/mute`, args: [val] });
          return;
        }

        // Console page — control group fader
        if (msg.type === 'cg-fader') {
          const cg = parseInt(msg.cg);
          if (isNaN(cg) || cg < 1 || cg > liveCgMax || !Number.isFinite(msg.db)) return;
          sendToDesk(`/Control_Groups/${cg}/fader`, [msg.db]);
          cgFaders[cg] = msg.db;
          broadcastToClients({ address: `/Control_Groups/${cg}/fader`, args: [msg.db] }, ws);
          return;
        }

        // Console page — control group mute
        if (msg.type === 'cg-mute') {
          const cg = parseInt(msg.cg);
          if (isNaN(cg) || cg < 1 || cg > liveCgMax) return;
          const val = msg.muted ? 1.0 : 0.0;
          sendToDesk(`/Control_Groups/${cg}/mute`, [val]);
          cgMutes[cg] = msg.muted;
          broadcastToClients({ address: `/Control_Groups/${cg}/mute`, args: [val] });
          return;
        }

        // Console page — control group solo
        if (msg.type === 'cg-solo') {
          const cg = parseInt(msg.cg);
          if (isNaN(cg) || cg < 1 || cg > liveCgMax) return;
          const val = msg.soloed ? 1.0 : 0.0;
          sendToDesk(`/Control_Groups/${cg}/solo`, [val]);
          cgSolos[cg] = msg.soloed;
          broadcastToClients({ address: `/Control_Groups/${cg}/solo`, args: [val] });
          return;
        }

        if (msg.type === 'fire-snapshot') { fireSnapshot(msg.action); return; }
        if (msg.type === 'set-mute') { setMute(msg.aux, msg.ch, msg.muted); return; }
        if (msg.type === 'set-solo') { setSolo(msg.aux, msg.ch, msg.soloed); return; }

        const oscMsg = msg;
        if (!oscMsg.address) return;

        // Allowlist of OSC addresses browser clients are permitted to send/query.
        // Rejects snapshot fires, name changes, or other console-level commands.
        const ALLOWED_OSC_RE = /^\/(?:Input_Channels\/\d+\/Aux_Send\/\d+\/send_(?:level|pan)|Aux_Outputs\/\d+\/EQ\/(?:eq_(?:gain|freq|Q)_\d+|eq_in))(\/\?)?$/;

        // The allowlist regex only checks *shape*, not range — \d+ accepts
        // any digit string, so without this a client can address a channel/
        // aux number far past what's configured. That both grows `cache`
        // unboundedly (a bad number never collides with a real one, so
        // nothing ever evicts it) and sends a fabricated address to the
        // real console — exactly the kind of malformed/out-of-range traffic
        // primeCache()'s own comment blames for a real Access Violation
        // crash. set-mute/set-solo above already bound-check the same way;
        // this closes the same gap for the raw OSC-address path.
        function oscAddressWithinConfiguredRange(address) {
          const chMax  = cache.has('/Console/Input_Channels') ? cache.get('/Console/Input_Channels').args[0] : (serverCfg.channels || 48);
          const auxMax = cache.has('/Console/Aux_Outputs/modes') ? cache.get('/Console/Aux_Outputs/modes').args.length : (serverCfg.auxes || 16);
          const chAux = address.match(/^\/Input_Channels\/(\d+)\/Aux_Send\/(\d+)\/send_(?:level|pan)/);
          if (chAux) {
            const ch = parseInt(chAux[1], 10), aux = parseInt(chAux[2], 10);
            return ch >= 1 && ch <= chMax && aux >= 1 && aux <= auxMax;
          }
          const auxEq = address.match(/^\/Aux_Outputs\/(\d+)\/EQ\//);
          if (auxEq) {
            const aux = parseInt(auxEq[1], 10);
            return aux >= 1 && aux <= auxMax;
          }
          return false; // shouldn't happen — ALLOWED_OSC_RE already matched one of the two shapes above
        }
        // The ranges the mixer page itself keeps to (its fader law and EQ panel)
        function clampBrowserValue(address, v) {
          if (address.endsWith('/send_level')) return Math.max(-150, Math.min(10, v));
          if (address.endsWith('/send_pan')) return Math.max(0, Math.min(1, v));
          if (/\/EQ\/eq_gain_\d+$/.test(address)) return Math.max(-18, Math.min(18, v));
          if (/\/EQ\/eq_freq_\d+$/.test(address)) return Math.max(20, Math.min(20000, v));
          if (/\/EQ\/eq_Q_\d+$/.test(address)) return Math.max(0.1, Math.min(10, v));
          if (address.endsWith('/EQ/eq_in')) return v >= 0.5 ? 1 : 0;
          return v;
        }

        // /? request — respond from cache if available, else relay to desk
        if (oscMsg.address.endsWith('/?')) {
          const key = oscMsg.address.slice(0, -2);
          if (!ALLOWED_OSC_RE.test(oscMsg.address) || !oscAddressWithinConfiguredRange(key)) return;
          if (cache.has(key)) {
            ws.send(JSON.stringify(cache.get(key)));
          } else {
            queueDeskQueries([oscMsg.address], true); // a performer is waiting on this one
          }
          return;
        }

        if (!ALLOWED_OSC_RE.test(oscMsg.address) || !oscAddressWithinConfiguredRange(oscMsg.address)) return;
        // A value-setting message (not a /? query) must carry exactly one
        // finite number — Math.log-based scaling upstream (sliderToDb) and
        // this path both feed the console a raw OSC float; NaN/Infinity
        // would otherwise go out over the wire as a real, malformed value.
        if (!Array.isArray(oscMsg.args) || oscMsg.args.length !== 1 || !Number.isFinite(oscMsg.args[0])) return;
        // And within the desk's range, as the other backends enforce: a
        // crafted +1000 dB send or a pan of 5 used to go out as sent
        oscMsg.args = [clampBrowserValue(oscMsg.address, oscMsg.args[0])];

        // Grab the pre-update value so we can tell the Devices view whether
        // this move raised or lowered the level/pan, before it's overwritten.
        const prevCached = cache.get(oscMsg.address);

        maybeCacheResponse(oscMsg);

        // Flash the sender's activity dot on the Devices view for any fader/pan
        // move, with a short description of what changed. Purely a browser->browser
        // notice via the WS hub — never touches sendToDesk, so no console-load implications.
        const activityMatch = oscMsg.address.match(/^\/Input_Channels\/(\d+)\/Aux_Send\/(\d+)\/send_(level|pan)$/);
        if (activityMatch) {
          const [, chStr, auxStr, kind] = activityMatch;
          const newVal  = Array.isArray(oscMsg.args) ? oscMsg.args[0] : undefined;
          const prevVal = prevCached && Array.isArray(prevCached.args) ? prevCached.args[0] : undefined;
          let direction = null;
          if (typeof newVal === 'number' && typeof prevVal === 'number' && newVal !== prevVal) {
            direction = newVal > prevVal ? 'up' : 'down';
          }
          ws._lastActivityAt = Date.now();
          broadcastActivity({
            type: 'device-activity',
            deviceId: ws._deviceId || null,
            aux: parseInt(auxStr, 10),
            channel: parseInt(chStr, 10),
            kind,
            direction
          }, ws);
        }

        // If this is a send_level and the channel is muted/solo-off, send -150 to desk
        // but still relay the real value to other browser clients so their UI stays accurate
        const msMatch = oscMsg.address.match(/^\/Input_Channels\/(\d+)\/Aux_Send\/(\d+)\/send_level$/);
        if (msMatch) {
          const ch = parseInt(msMatch[1]), aux = parseInt(msMatch[2]);
          const muted   = !!(muteState[aux]?.[ch]);
          const anySolo = Object.values(soloState[aux] || {}).some(v => v);
          const soloed  = !!(soloState[aux]?.[ch]);
          const silenced = muted || (anySolo && !soloed);
          if (silenced) {
            // User moved fader while muted — update saved level so unmute restores to new position
            if (!premuteState[aux]) premuteState[aux] = {};
            premuteState[aux][ch] = oscMsg.args[0];
          }
          sendToDesk(oscMsg.address, silenced ? [-150] : oscMsg.args);
          sendToAllIpads(oscMsg.address, silenced ? [-150] : oscMsg.args, null);
          const payload = JSON.stringify(oscMsg);
          for (const conn of connections) {
            if (conn !== ws && conn.readyState === WebSocket.OPEN) conn.send(payload);
          }
          return;
        }

        broadcast(oscMsg, ws);
      } catch (e) {
        console.error('[JPMixer] WS parse error:', e.message);
      }
    });

    ws.on('close', (code, reason) => {
      // Counted after removing it: broadcast() may already have dropped this
      // closed socket, so length - 1 logged "remaining:-1"
      connections = connections.filter(c => c !== ws);
      logEvent('client-disconnect', `code:${code} reason:${reason || 'none'} remaining:${connections.length}`);
      if (onConnectionCountChange) onConnectionCountChange(connections.length);
      broadcastToClients({ type: 'connection-count', count: connections.length });
      if (ws._activeAux != null) broadcastToClients({ type: 'active-mixers', counts: getActiveMixerCounts() });
      if (ws._deviceId != null || ws._activeAux != null) broadcastDevicesUpdate();
    });
  });
}

// ── Demo mode — fake console data so the UI can be explored without hardware ──

function startDemoMode() {
  const chCount  = serverCfg.channels || 16;
  const auxCount = serverCfg.auxes    || 6;

  cache.set('/Console/Input_Channels', { address: '/Console/Input_Channels', args: [chCount] });
  cache.set('/Console/Aux_Outputs/modes', { address: '/Console/Aux_Outputs/modes', args: new Array(auxCount).fill(2) });

  // The fake desk's own names are plain "CH N" / "AUX N", like a desk
  // nobody has named; buildConfig() puts JPMixer's labels on top. They used
  // to be seeded from those labels, so a label taken off again (performer
  // names turned off in Settings → Planning Center) fell back to itself and
  // the name never went away in demo mode.
  for (let i = 1; i <= chCount; i++) {
    const addr = `/Input_Channels/${i}/Channel_Input/name`;
    cache.set(addr, { address: addr, args: [`CH ${i}`] });
  }
  for (let i = 1; i <= auxCount; i++) {
    const addr = `/Aux_Outputs/${i}/Buss_Trim/name`;
    cache.set(addr, { address: addr, args: [`AUX ${i}`] });
  }

  // Pre-fill plausible random levels for every ch × aux combination
  for (let aux = 1; aux <= auxCount; aux++) {
    for (let ch = 1; ch <= chCount; ch++) {
      const addr = `/Input_Channels/${ch}/Aux_Send/${aux}/send_level`;
      const db = sliderToDb(Math.random() * 0.35 + 0.40); // ~-20dB to +1dB
      cache.set(addr, { address: addr, args: [db] });
    }
  }

  // Channel processing for the Console Controller's channel panel: typical
  // values, in the ranges a real SD reported (see digico-channel.js)
  const demoProcessing = {
    'Channel_Input/analog_gain': 24, 'Channel_Input/trim': 0, 'Channel_Input/phantom': 0, 'Channel_Input/phase': 0,
    'Panner/pan': 0.5, 'Filters/lo_filter_in': 1, 'Filters/lo_filter_freq': 80, 'Filters/hi_filter_in': 0, 'Filters/hi_filter_freq': 18000,
    'Channel_Delay/delay_on': 0, 'Channel_Delay/delay': 0, 'Insert/insert_A_in': 0, 'Insert/insert_B_in': 0, 'EQ/eq_in': 1,
    'Dynamics/comp_in': 0, 'Dynamics/comp_thresh_1': -20, 'Dynamics/comp_ratio_1': 3, 'Dynamics/comp_attack_1': 0.01, 'Dynamics/comp_release_1': 0.5,
    'Dynamics/comp_gain_1': 0, 'Dynamics/comp_knee_1': 0, 'Dynamics/comp_auto-gain_1': 0, 'Dynamics/gate_in': 0, 'Dynamics/gate_thresh': -44,
    'Dynamics/gate_range': 40, 'Dynamics/gate_attack': 0.002, 'Dynamics/gate_hold': 0.13, 'Dynamics/gate_release': 0.14,
  };
  [6300, 1600, 300, 100].forEach((f, i) => {
    const b = i + 1;
    Object.assign(demoProcessing, { [`EQ/eq_freq_${b}`]: f, [`EQ/eq_gain_${b}`]: 0, [`EQ/eq_Q_${b}`]: 0.71, [`EQ/dynamic_eq_on_${b}`]: 0,
      [`EQ/eq_thresh_${b}`]: -36, [`EQ/eq_ratio_${b}`]: 2, [`EQ/eq_attack_${b}`]: 0.01, [`EQ/eq_release_${b}`]: 0.3 });
  });
  // 48V on a few channels (condensers, DIs), so it shows on the Patch page
  const demoPhantom = new Set([3, 4, 7, 8, 12]);
  for (let ch = 1; ch <= chCount; ch++) {
    for (const [p, v] of Object.entries(demoProcessing)) {
      const addr = `/Input_Channels/${ch}/${p}`;
      cache.set(addr, { address: addr, args: [p === 'Channel_Input/phantom' && demoPhantom.has(ch) ? 1 : v] });
    }
  }

  // The console's own faders and mutes (the Console Controller, Custom Pages):
  // channels around -10 to -3 dB, control groups at 0 dB, nothing muted
  for (let ch = 1; ch <= chCount; ch++) { consoleFaders[ch] = Math.round(sliderToDb(Math.random() * 0.15 + 0.40) * 10) / 10; consoleMutes[ch] = false; consoleSolos[ch] = false; }
  for (let cg = 1; cg <= (serverCfg.groups || 8); cg++) { cgFaders[cg] = 0; cgMutes[cg] = false; cgSolos[cg] = false; }

  currentSnapshotName = 'DEMO';
  loaded = true;
  deskAlive = true;
  logEvent('demo-mode', `channels:${chCount} auxes:${auxCount}`);
  if (onConsoleStatusChange) onConsoleStatusChange(true);
  startWebSocketServer();
}

// ── Main start / stop ─────────────────────────────────────────────────────

// An OSC packet that is only an address ("/Console/Name/?" + null padding)
// with no type tag string — returns the address, else null
function readBareOscAddress(data) {
  if (!data || data.length < 4 || data[0] !== 0x2f) return null; // must start with "/"
  let end = 0;
  while (end < data.length && data[end] !== 0) end++;
  const padded = (end + 4) & ~3; // address + at least one null, padded to 4 bytes
  if (end === data.length || padded < data.length) return null; // unterminated, or a type tag follows
  return String.fromCharCode(...data.subarray(0, end));
}
let bareMessagePending = false;

// UDP socket errors that mean the socket itself is unusable
const UDP_FATAL_CODES = new Set(['EADDRINUSE', 'EACCES', 'EADDRNOTAVAIL', 'ERR_SOCKET_BIND']);
let lastBadPacketLogAt = 0;

function start(cfg) {
  cancelSceneRecall();
  deskLabelSent.clear(); // a new session announces every name afresh
  clearTimeout(metadataFetchTimer);
  metadataFetchTimer = null;
  currentSnapshot = -1;
  currentSnapshotName = '';
  serverCfg = cfg;
  loaded    = false;
  cache.clear();
  connections = [];

  oscLogFlushTimer = setInterval(() => {
    if (oscLogBatch.length === 0) return;
    const batch = oscLogBatch;
    oscLogBatch = [];
    if (onOscTraffic) onOscTraffic(batch);
  }, OSC_LOG_FLUSH_MS);

  const app = express();
  // The mixer pages keep express's default ETag revalidation — caching
  // mixer.js/index.html for days would leave phones on old code after an
  // update. Icons never change between releases, so phones may keep them a week.
  access.mountOneTimeLinks(app); // a browser opened from Settings: this computer's pass
  app.use(express.static(path.join(__dirname, '..', 'mixer')));
  const ICON_CACHE = { maxAge: '7d' };
  app.use('/instrument-icons', express.static(path.join(__dirname, '..', '..', 'assets', 'Icons For instruments', '1-To-70-SVG-Files-MusicalInstrumentsBundle'), ICON_CACHE));
  app.use('/instrument-icons', express.static(path.join(__dirname, '..', '..', 'assets', 'Icons For instruments', '71-To-120-SVG-Files-MusicalInstrumentsBundle'), ICON_CACHE));
  mountGreenRoom(app);
  mountBranding(app);
  mountPerformerAssignments(app);
  mountFoh(app, { isConsoleConnected, getConnectionCount });

  // Diagnostic endpoints — localhost only to keep rig topology off the venue network
  const diagOnly = (req, res, next) => {
    // This computer's pass, not its address: the port 80 helper connects from it
    if (access.fromThisComputer(req)) return next();
    res.status(403).json({ error: 'Diagnostic endpoints only open from JPMixer on this computer' });
  };

  // Shows selectively-cached OSC values
  app.get('/api/osc-cache', diagOnly, (req, res) => {
    const entries = {};
    for (const [k, v] of cache.entries()) entries[k] = v.args;
    res.json(entries);
  });

  // Shows EVERY unique OSC address received — useful for finding unknown paths
  app.get('/api/osc-all', diagOnly, (req, res) => {
    const entries = {};
    for (const [k, v] of allSeenAddresses.entries()) entries[k] = v;
    res.json(entries);
  });

  // Clears the all-seen tracker so you can isolate new messages (POST to avoid accidental GETs)
  app.post('/api/osc-clear', diagOnly, (req, res) => {
    allSeenAddresses.clear();
    res.json({ cleared: true });
  });

  // Recent server events — open in browser to diagnose disconnects
  app.get('/api/events', diagOnly, (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    // e.detail (and, less often, e.type) can carry client-controlled strings
    // verbatim — a saved preset/scene name, a WS close reason — so this page
    // isn't safe to build with raw interpolation even though it's gated
    // localhost-only above.
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const rows = eventLog.slice().reverse().map(e =>
      `<tr><td>${esc(e.t)}</td><td><b>${esc(e.type)}</b></td><td>${esc(e.detail)}</td></tr>`
    ).join('');
    res.send(`<html><head><meta http-equiv="refresh" content="3"><style>
      body{font-family:monospace;font-size:12px;background:#111;color:#eee;padding:12px}
      table{border-collapse:collapse;width:100%} td{padding:4px 8px;border-bottom:1px solid #333}
    </style></head><body><h3>JPMixer Event Log (auto-refreshes every 3s)</h3>
    <p>Connections: ${connections.length} | Loaded: ${loaded}</p>
    <table><tr><th>Time</th><th>Type</th><th>Detail</th></tr>${rows}</table></body></html>`);
  });

  httpServer = http.createServer(app);

  // Without this, a listen failure (e.g. EADDRINUSE from a port already in use,
  // which is easy to hit on the stop+immediately-start cycle Save & Apply and
  // Import Backup both do) is an unhandled 'error' event — Node throws it as an
  // uncaught exception, which crashes the whole Electron main process.
  httpServer.on('error', (err) => {
    logEvent('http-error', `${err.code || err.message} — server failed to (re)start on port ${cfg.serverPort}`);
    console.error('[JPMixer] HTTP server error:', err.message);
    stop();
    if (onServerError) onServerError(err);
  });

  httpServer.listen(cfg.serverPort, () => {
    if (cfg.demoMode) {
      console.log(`[JPMixer] Web server     → http://localhost:${cfg.serverPort} (DEMO)`);
    } else {
      console.log(`[JPMixer] Web server     → http://localhost:${cfg.serverPort}`);
      console.log(`[JPMixer] Polling desk   → ${cfg.deskIp}:${cfg.deskSendPort}`);
      console.log(`[JPMixer] OSC listen     → :${cfg.deskListenPort}`);
    }
  });

  if (cfg.demoMode) {
    startDemoMode();
    return;
  }

  udpPort = new osc.UDPPort({
    localAddress: '0.0.0.0',
    localPort:    cfg.deskListenPort
  });

  const onUdpMessage = (oscMsg, timeTag, info) => {
    // Who sent it: a configured iPad, the desk, or an unknown device
    let fromIpad = ipadPorts.get(info.address);
    if (!fromIpad && info.address !== serverCfg.deskIp) {
      fromIpad = adoptMovedIpad(info.address, oscMsg);
      if (!fromIpad) {
        noteUnknownSender(info.address, oscMsg);
        logOscTraffic('in', oscMsg.address, oscMsg.args, `unknown:${info.address}`);
        return;
      }
    }

    allSeenAddresses.set(oscMsg.address, oscMsg.args);
    logOscTraffic('in', oscMsg.address, oscMsg.args, fromIpad ? `ipad:${fromIpad.name}` : 'desk');

    // Message from a configured iPad — forward to desk and browser clients, skip desk handling
    if (fromIpad) {
      fromIpad.lastHeardAt = Date.now();
      fromIpad.messages++;
      maybeCacheResponse(oscMsg);
      const iPadMsMatch = oscMsg.address.match(/^\/Input_Channels\/(\d+)\/Aux_Send\/(\d+)\/send_level$/);
      if (iPadMsMatch) {
        const ch = parseInt(iPadMsMatch[1]), aux = parseInt(iPadMsMatch[2]);
        const muted    = !!(muteState[aux]?.[ch]);
        const anySolo  = Object.values(soloState[aux] || {}).some(v => v);
        const soloed   = !!(soloState[aux]?.[ch]);
        const silenced = muted || (anySolo && !soloed);
        if (silenced) {
          if (!premuteState[aux]) premuteState[aux] = {};
          premuteState[aux][ch] = oscMsg.args[0];
        }
        sendToDesk(oscMsg.address, silenced ? [-150] : oscMsg.args);
        sendToAllIpads(oscMsg.address, silenced ? [-150] : oscMsg.args, info.address);
      } else {
        sendToDesk(oscMsg.address, oscMsg.args);
        sendToAllIpads(oscMsg.address, oscMsg.args, info.address);
      }
      broadcastToClients(oscMsg);
      return;
    }

    noteDeskHeard();

    // Session change — reload data without dropping clients
    if (oscMsg.address === '/Console/Session/!') {
      // iPads need this too — the DiGiCo app re-syncs on it. It used to return
      // below before anything was relayed, leaving iPads on the old session.
      sendToAllIpads(oscMsg.address, oscMsg.args, null);
      cancelSceneRecall();
      clearDeskSetQueue();
      // Stop asking about the old session right away — the desk is busy
      // loading the new one, and those answers would be discarded anyway
      clearDeskQueries();
      if (cachePrimeInterval) { clearInterval(cachePrimeInterval); cachePrimeInterval = null; }
      clearTimeout(metadataFetchTimer);
      metadataFetchTimer = null;
      currentSnapshot = -1;
      currentSnapshotName = '';
      logEvent('session-change', 'debouncing 500ms');
      clearTimeout(sessionReloadTimer);
      sessionReloadTimer = setTimeout(() => {
        sessionReloadTimer = null;
        logEvent('session-reload', 'clearing cache and reloading');
        cache.clear();
        deskLabelSent.clear(); // the new session's names are all announced afresh
        clearMuteSolo();
        clearConsoleState();
        clearDeskQueries();
        clearDeskSetQueue(); // writes meant for the old session
        cancelSceneRecall();
        loaded = false;
        deskAlive = false;
        if (onConsoleStatusChange) onConsoleStatusChange(false);
        if (cachePrimeInterval) { clearInterval(cachePrimeInterval); cachePrimeInterval = null; }
        fetchValues();
      }, 500);
      return;
    }

    processSnapshotMsg(oscMsg);
    // iPads get the desk's real value (-150 for a channel JPMixer has muted),
    // the same as the browser send_level path relays to them — telling them
    // the logical level made the DiGiCo iPad app show a muted channel as open,
    // and re-sending that would silently undo the mute. Browser clients and
    // the cache get the logical level below.
    const deskMsg = oscMsg;
    oscMsg = processDeskSendLevel(oscMsg);
    maybeCacheResponse(oscMsg);

    // Relay all desk messages to every configured iPad regardless of address
    sendToAllIpads(deskMsg.address, deskMsg.args, null);

    if (!loaded) {
      loadNextRequiredParameter();
      return;
    }

    // /? from desk — respond from cache
    if (oscMsg.address.endsWith('/?')) {
      const key = oscMsg.address.slice(0, -2);
      if (cache.has(key)) broadcastToClients(cache.get(key));
      return;
    }

    // Console-level fader / mute / solo — track state and forward to console page.
    // Use string segment parsing instead of 8 sequential regexes: split once on '/'
    // gives ['', section, index, property, ...] — O(1) dispatch per message type.
    {
      const p = oscMsg.address.split('/'); // ['', section, idx, prop, ...]
      const section = p[1], idx = parseInt(p[2]), prop = p[3];
      if (!isNaN(idx)) {
        const bcast = () => broadcastToClients({ address: oscMsg.address, args: oscMsg.args });
        if (section === 'Input_Channels') {
          if (prop === 'fader') { consoleFaders[idx] = oscMsg.args[0];  bcast(); return; }
          if (prop === 'mute')  { consoleMutes[idx]  = !!oscMsg.args[0]; bcast(); return; }
          if (prop === 'solo')  { consoleSolos[idx]  = !!oscMsg.args[0]; bcast(); return; }
        } else if (section === 'Aux_Outputs') {
          if (prop === 'fader') { auxFaders[idx] = oscMsg.args[0];  bcast(); return; }
          if (prop === 'mute')  { auxMutes[idx]  = !!oscMsg.args[0]; bcast(); return; }
        } else if (section === 'Control_Groups') {
          if (prop === 'fader') { cgFaders[idx] = oscMsg.args[0];  bcast(); return; }
          if (prop === 'mute')  { cgMutes[idx]  = !!oscMsg.args[0]; bcast(); return; }
          if (prop === 'solo')  { cgSolos[idx]  = !!oscMsg.args[0]; bcast(); return; }
          // CG name — two possible paths the desk uses; broadcast so console page can update label
          if (prop === 'name' || (prop === 'Channel_Input' && p[4] === 'name')) { bcast(); return; }
        }
      }
    }

    // A channel renamed on the desk: tell phones the label to show, with a
    // Settings label still winning (same rule as buildConfig). Phones used
    // to apply the raw name themselves and overwrote the wrong row.
    const deskChName = oscMsg.address.match(/^\/Input_Channels\/(\d+)\/Channel_Input\/name$/);
    if (deskChName) {
      const n = parseInt(deskChName[1], 10);
      const ov = (serverCfg.channelOverrides || {})[String(n)] || {};
      announceDeskLabel('ch', n, ov.label || String(oscMsg.args[0] ?? ''));
    }
    // The same for an aux renamed (or re-sent) by the desk: a Settings or
    // Planning Center label wins. Phones used to apply the raw name and
    // showed "AUX 3" over the label until they reloaded.
    const deskAuxName = oscMsg.address.match(/^\/Aux_Outputs\/(\d+)\/Buss_Trim\/name$/);
    if (deskAuxName) {
      const n = parseInt(deskAuxName[1], 10);
      const ov = (serverCfg.auxOverrides || {})[String(n)] || {};
      announceDeskLabel('aux', n, ov.label || String(oscMsg.args[0] ?? '') || `AUX ${n}`);
    }

    // Browser clients only. iPads were already sent the desk's real value
    // above — broadcast() relayed every desk message to them a second time,
    // with the logical level for a muted channel, which overrode the -150
    // (and doubled all iPad traffic). It would also forward to the desk any
    // message that arrived from an address other than the desk's.
    broadcastToClients(oscMsg);
  };
  udpPort.on('message', onUdpMessage);

  // Older OSC senders — the DiGiCo iPad app among them (its /Console/Name/?)
  // — send just an address, with no type tag string. osc.js rejects those as
  // malformed, so the iPad never got past connecting through the relay. Read
  // them here as messages with no arguments, which is how the desk treats
  // them, and route them like any other message.
  udpPort.on('raw', (data, info) => {
    const address = readBareOscAddress(data);
    if (!address) return;
    bareMessagePending = true; // osc.js reports this same packet as an error next
    onUdpMessage({ address, args: [] }, undefined, info);
  });

  udpPort.on('error', (err) => {
    if (err.code === 'EHOSTDOWN' || err.code === 'EHOSTUNREACH') {
      // Expected/recoverable — the desk is temporarily unreachable, not a
      // setup failure. Matches this handler's original behavior.
      console.warn(`[JPMixer] Desk not responding (${err.address})`);
      return;
    }
    // A local bind failure (EADDRINUSE/EACCES/EADDRNOTAVAIL on
    // deskListenPort — the exact scenario the HTTP server's own error
    // handler above already guards against, e.g. the stop+immediately-
    // start cycle Save & Apply and Import Backup both do) leaves no working
    // UDP socket, so stop and surface it, like httpServer's error handling.
    // Only when binding: the same codes on a *send* (e.g. EADDRNOTAVAIL while
    // Wi-Fi briefly drops, or an unreachable iPad) are transient
    if (UDP_FATAL_CODES.has(err.code) && err.syscall !== 'send') {
      console.error('[JPMixer] UDP error:', err.message || err.code);
      logEvent('udp-error', `${err.code} — desk socket failed`);
      stop();
      if (onServerError) onServerError(err);
      return;
    }
    // The bare-address message the 'raw' handler above already handled
    if (bareMessagePending) { bareMessagePending = false; return; }
    // Anything else is one bad packet — osc.js reports an undecodable message
    // (from any device sending to this port: a misconfigured iPad app, a
    // network scanner) as an 'error'. Stopping here took the whole server
    // down, and every phone with it, over a single garbled packet (seen when
    // an iPad OSC app was pointed at this port). Log it, rate-limited, and
    // keep going.
    const now = Date.now();
    if (now - lastBadPacketLogAt > 10000) {
      lastBadPacketLogAt = now;
      logEvent('udp-bad-packet', `ignored: ${err.message || err.code || err}`);
    }
  });

  udpPort.on('ready', fetchValues);
  udpPort.open();
  if (deskWatchTimer) clearInterval(deskWatchTimer);
  deskWatchTimer = setInterval(watchDesk, 2000);

  // iPad OSC relay — shares the main UDP port. iPads send to JPMixer's main listen port;
  // messages are routed by source IP. JPMixer sends replies to each iPad's sendPort.
  registerIpads(cfg);
  for (const e of ipadPorts.values()) console.log(`[JPMixer] iPad "${e.name}" registered → ${e.ip}:${e.sendPort} (receives from main port)`);
}

function stop() {
  cancelSceneRecall();
  clearTimeout(metadataFetchTimer);
  metadataFetchTimer = null;
  if (cachePrimeInterval)  { clearInterval(cachePrimeInterval);   cachePrimeInterval  = null; }
  if (pingInterval)        { clearInterval(pingInterval);         pingInterval        = null; }
  if (sessionReloadTimer)  { clearTimeout(sessionReloadTimer);    sessionReloadTimer  = null; }
  if (deskWatchTimer)      { clearInterval(deskWatchTimer);       deskWatchTimer      = null; }
  deskAlive = false;
  if (oscLogFlushTimer)    { clearInterval(oscLogFlushTimer);     oscLogFlushTimer    = null; }
  if (oscLogRecordStream)  { stopOscLogRecording(); }
  clearDeskQueries();

  // Restore real fader levels to the desk for any muted channels so the desk
  // doesn't retain -150 after we stop. Must run before clearMuteSolo() wipes premuteState.
  if (udpPort) {
    for (const [auxKey, channels] of Object.entries(premuteState)) {
      for (const [chKey, db] of Object.entries(channels)) {
        sendToDesk(`/Input_Channels/${chKey}/Aux_Send/${auxKey}/send_level`, [db]);
      }
    }
  }
  flushDeskSetQueue();
  clearMuteSolo();
  clearConsoleState();
  // Close the UDP socket on the next turn, not now. The sends just queued
  // above (muted channels' real levels, the flushed writes) are dropped if
  // the socket closes in the same tick — measured: 20 of 20 lost — so every
  // stop, quit and restarting Save & Apply left channels muted from a phone
  // silent on the desk. Callers that restart straight away wait on the
  // returned promise so the new socket can bind the same port.
  let socketClosed = Promise.resolve();
  if (udpPort) {
    const closing = udpPort;
    udpPort = null;
    socketClosed = new Promise((resolve) => {
      const done = () => { clearTimeout(fallback); resolve(); };
      const fallback = setTimeout(done, 1000);
      closing.once('close', done);
      setImmediate(() => { try { closing.close(); } catch (_) { done(); } });
    });
  }
  ipadPorts.clear();
  unknownSenders.clear();
  // wss.close() only stops accepting *new* connections — already-upgraded
  // WebSocket sockets are detached from the HTTP server's own connection
  // tracking (a known `ws` gotcha) and are left open otherwise. A client
  // still connected at this exact moment would keep a live socket whose
  // 'message' handler closure still references this module's shared state
  // (cache, muteState, etc.), and phones would sit until their 35s heartbeat
  // gave up. Terminate them all so they reconnect straight away.
  for (const conn of connections) { try { conn.terminate(); } catch (_) {} }
  if (wss) {
    for (const client of wss.clients) { try { client.terminate(); } catch (_) {} }
    wss.close();
    wss = null;
  }
  if (httpServer)  { httpServer.close();                        httpServer  = null; }
  loaded = false;
  if (onConsoleStatusChange) onConsoleStatusChange(false);
  cache.clear();
  connections = [];
  console.log('[JPMixer] Server stopped');
  return socketClosed;
}

function getChannelNames() {
  const names = {};
  for (const [key, val] of cache.entries()) {
    const m = key.match(/^\/Input_Channels\/(\d+)\/Channel_Input\/name$/);
    if (m) names[m[1]] = val.args[0] || '';
  }
  return names;
}

// Each input channel's 48V as the desk last reported it (from a query, the
// desk itself, or the iPad relay), for plugins: { "5": true, … }. A channel
// the desk hasn't reported yet isn't listed.
function getPhantom() {
  const out = {};
  // Each channel's key looked up (the cache holds thousands of send levels)
  const count = Math.min(256, (cache.has('/Console/Input_Channels') ? cache.get('/Console/Input_Channels').args[0] : 0) || serverCfg.channels || 48);
  for (let ch = 1; ch <= count; ch++) {
    const val = cache.get(`/Input_Channels/${ch}/Channel_Input/phantom`);
    if (val && val.args && val.args.length) out[String(ch)] = Number(val.args[0]) >= 0.5;
  }
  return out;
}

function getAuxNames() {
  const names = {};
  for (const [key, val] of cache.entries()) {
    const m = key.match(/^\/Aux_Outputs\/(\d+)\/Buss_Trim\/name$/);
    if (m) names[m[1]] = val.args[0] || '';
  }
  return names;
}

// Live counts as actually reported by the desk — used so Settings can catch
// its "Channels"/"Auxes" fields drifting out of sync with the real console
// (a stale, too-low field silently hides the highest-numbered channels/auxes
// from being configurable, even though the mixer pages still show them).
function getChannelCount() {
  return cache.has('/Console/Input_Channels') ? cache.get('/Console/Input_Channels').args[0] : null;
}
function getAuxCount() {
  return cache.has('/Console/Aux_Outputs/modes') ? cache.get('/Console/Aux_Outputs/modes').args.length : null;
}

function isConsoleConnected() { return loaded && deskAlive; }
function setConsoleStatusCallback(cb) { onConsoleStatusChange = cb; }

function setConnectionCountCallback(cb) { onConnectionCountChange = cb; }
function getConnectionCount() { return connections.length; }

function setServerErrorCallback(cb) { onServerError = cb; }

// Save & Apply for settings that don't need a restart (labels, colours, icons,
// channel order, scene recall…) — swap the config in and push the new layout
// to every connected page. Mixer pages refill their faders from the server
// cache on a liveUpdate config, so this sends nothing to the desk.
function applyConfigLive(cfg) {
  serverCfg = cfg;
  registerIpads(cfg);
  logEvent('config-live', `pushed to ${connections.length} clients`);
  if (wss) broadcastToClients(buildConfig({ liveUpdate: true }));
}

// After Settings merges device groups — see shared-handlers.js
function pushDevicePresets(deviceId) {
  shared.pushDevicePresets(connections, deviceId);
}

function getOscLog() { return oscLog; }
function setOscTrafficCallback(cb) { onOscTraffic = cb; }

module.exports = { getConnectedDevicesInfo, getControlGroups, getPhantom, start, stop, applyConfigLive, getIpadStatus, pushDevicePresets, getChannelNames, getAuxNames, getChannelCount, getAuxCount, isConsoleConnected, setConsoleStatusCallback, setConnectionCountCallback, getConnectionCount, setServerErrorCallback, getOscLog, setOscTrafficCallback, startOscLogRecording, stopOscLogRecording, getOscLogRecordingStatus, oscLogRecordsFolder, fireSnapshot, setMute, setSolo, setChannelLabel, setAuxLabel, getStrips, primeStrips, setStrip };
