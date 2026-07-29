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

// Paced EQ-param-loading timers, keyed by aux — prevents two overlapping
// timers for the same aux (e.g. panel closed/reopened quickly, or a
// reconnect racing an in-flight load) from doubling the query rate
const eqPrimeTimers = new Map();

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

// Snapshot tracking
let currentSnapshotName = '';
let currentSnapshot     = -1;

// Debounce timer for session-change reloads
let sessionReloadTimer  = null;

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

function applyMuteSolo(aux) {
  const anySolo = Object.values(soloState[aux] || {}).some(v => v);
  const chCount = cache.has('/Console/Input_Channels')
    ? cache.get('/Console/Input_Channels').args[0]
    : (serverCfg.channels || 48);

  if (!premuteState[aux]) premuteState[aux] = {};

  const restoredLevels = {}; // ch -> dB — sent to clients for fader snap-back

  for (let ch = 1; ch <= chCount; ch++) {
    const key = `/Input_Channels/${ch}/Aux_Send/${aux}/send_level`;
    if (!cache.has(key)) continue; // skip channels not in this mix
    const muted    = !!(muteState[aux]?.[ch]);
    const soloed   = !!(soloState[aux]?.[ch]);
    const silenced = muted || (anySolo && !soloed);

    if (silenced) {
      if (premuteState[aux][ch] === undefined) {
        premuteState[aux][ch] = cache.get(key).args[0];
      }
      sendToDesk(key, [-150]);
    } else {
      const restore = premuteState[aux][ch] !== undefined
        ? premuteState[aux][ch]
        : cache.get(key).args[0];
      sendToDesk(key, [restore]);
      cache.set(key, { address: key, args: [restore] });
      restoredLevels[ch] = restore;
      delete premuteState[aux][ch];
    }
  }

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

// ── Scene recall ───────────────────────────────────────────────────────────

function sliderToDb(v) {
  const db = ((Math.log(v * 100) / Math.log(100)) * 100) - 90;
  return db === -Infinity ? -150 : db;
}

// Sends one aux's saved scene values to the desk and updates server-side
// caches so desk echoes don't race the broadcast; returns the { chStr: sliderVal }
// map to send back to clients.
function pushSceneValuesToDesk(auxStr, values) {
  const levels = {};
  const aux = parseInt(auxStr);
  const anySolo = Object.values(soloState[aux] || {}).some(v => v);
  if (!premuteState[aux]) premuteState[aux] = {};

  for (const [chStr, sliderVal] of Object.entries(values)) {
    const ch = parseInt(chStr);
    const address = `/Input_Channels/${chStr}/Aux_Send/${auxStr}/send_level`;
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
      sendToDesk(address, [-150]);
    } else {
      delete premuteState[aux][ch];
      sendToDesk(address, [db]);
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

function buildConfig() {
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
    const consoleName = cache.has(`/Aux_Outputs/${i+1}/Buss_Trim/name`)
      ? cache.get(`/Aux_Outputs/${i+1}/Buss_Trim/name`).args[0]
      : `AUX ${i+1}`;
    auxilaries.push({
      enabled:   ov.enabled !== false,
      label:     ov.label || consoleName,
      channel:   i + 1,
      stereo:    auxModes[i] === 2,
      colour:    ov.colour || generateColour(auxCount, i),
      icon:      '',
      eqEnabled: ov.eqEnabled === true,
    });
  }

  const chCount = cache.has('/Console/Input_Channels')
    ? cache.get('/Console/Input_Channels').args[0]
    : (serverCfg.channels || 48);

  const cfgGroups    = serverCfg.channelGroups    || [];
  const cfgOverrides = serverCfg.channelOverrides || {};

  // Map group id → sort index
  const groupOrder = {};
  cfgGroups.forEach((g, i) => { groupOrder[String(g.id)] = i; });

  // Build raw channels with overrides applied
  const raw = [];
  for (let i = 1; i <= chCount; i++) {
    const ov = cfgOverrides[String(i)] || {};
    const consoleLabel = cache.has(`/Input_Channels/${i}/Channel_Input/name`)
      ? cache.get(`/Input_Channels/${i}/Channel_Input/name`).args[0] : '';
    raw.push({
      channel: i,
      enabled: ov.enabled !== false,
      label:   ov.label || consoleLabel || '',
      icon:    ov.icon || '',
      groupId: ov.groupId || null,
      order:   ov.order  !== undefined ? ov.order : i,
    });
  }

  // Sort: by group first, then by custom order within each group
  raw.sort((a, b) => {
    const ga = a.groupId !== null ? (groupOrder[String(a.groupId)] ?? 9999) : 9999;
    const gb = b.groupId !== null ? (groupOrder[String(b.groupId)] ?? 9999) : 9999;
    if (ga !== gb) return ga - gb;
    return a.order - b.order;
  });

  // Inject section titles at first channel of each group
  const channels = [];
  let lastGroupId;
  raw.forEach((ch, idx) => {
    const isFirst = ch.groupId !== lastGroupId;
    lastGroupId = ch.groupId;
    const group = cfgGroups.find(g => String(g.id) === String(ch.groupId));
    channels.push({
      enabled: ch.enabled,
      label:   ch.label,
      channel: ch.channel,
      order:   idx,
      title:   (isFirst && group) ? group.name : '',
      icon:    ch.icon,
    });
  });

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

  return JSON.stringify({
    config: {
      channels,
      aux: auxilaries,
      controlGroups,
      snapshot: currentSnapshotName,
      sceneRecallEnabled: !!serverCfg.sceneRecallEnabled,
      scenes: scenes.getAll(),
      mutes: muteState,
      solos: soloState
    }
  });
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

function sendToDesk(address, args) {
  if (!udpPort || !serverCfg.deskIp) return;
  try {
    udpPort.send({ address, args: args || [] }, serverCfg.deskIp, serverCfg.deskSendPort);
    logOscTraffic('out', address, args || [], 'desk');
  } catch (e) {
    console.error('[JPMixer] sendToDesk error:', e.message);
  }
}

function sendToAllIpads(address, args, excludeIp) {
  for (const { ip, sendPort } of ipadPorts.values()) {
    if (ip === excludeIp) continue;
    try {
      udpPort.send({ address, args: args || [] }, ip, sendPort);
    } catch (e) {}
  }
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

function broadcastToClients(msg) {
  const payload = typeof msg === 'string' ? msg : JSON.stringify(msg);
  const alive = [];
  for (const conn of connections) {
    if (conn.readyState === WebSocket.OPEN) {
      alive.push(conn);
      conn.send(payload);
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

function fetchValues() {
  if (loaded) return;
  sendToDesk('/Console/Channels/?', []);
  console.log('[JPMixer] Requesting console metadata…');
  setTimeout(fetchValues, 3000);
}

function loadNextRequiredParameter() {
  if (!cache.has('/Console/Input_Channels')) {
    sendToDesk('/Console/Channels/?', []);
    return;
  }

  if (!cache.has('/Console/Aux_Outputs/modes')) {
    sendToDesk('/Console/Aux_Outputs/modes/?', []);
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
      sendToDesk(`/Aux_Outputs/${i}/Buss_Trim/name/?`, []);
      return;
    }
  }

  const chCount = cache.get('/Console/Input_Channels').args[0];
  for (let i = 1; i <= chCount; i++) {
    if (!cache.has(`/Input_Channels/${i}/Channel_Input/name`)) {
      sendToDesk(`/Input_Channels/${i}/Channel_Input/name/?`, []);
      return;
    }
  }

  // All names loaded — request current snapshot then go live
  sendToDesk('/Snapshots/Current_Snapshot/?', []);

  loaded = true;
  logEvent('metadata-loaded', `clients:${connections.length}`);
  if (onConsoleStatusChange) onConsoleStatusChange(true);
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
// requestAuxValues() in mixer.js queries a given aux directly the moment a
// performer opens it anyway. Do not raise this without confirming on real
// hardware, not just a demo-mode/local test.
function primeCache() {
  const chCount  = cache.has('/Console/Input_Channels')
    ? cache.get('/Console/Input_Channels').args[0]
    : (serverCfg.channels || 48);
  const auxCount = cache.has('/Console/Aux_Outputs/modes')
    ? cache.get('/Console/Aux_Outputs/modes').args.length
    : (serverCfg.auxes || 16);

  for (let aux = 1; aux <= auxCount; aux++) {
    for (let ch = 1; ch <= chCount; ch++) {
      if (!cache.has(`/Input_Channels/${ch}/Aux_Send/${aux}/send_level`)) {
        sendToDesk(`/Input_Channels/${ch}/Aux_Send/${aux}/send_level/?`, []);
        return;
      }
      if (!cache.has(`/Input_Channels/${ch}/Aux_Send/${aux}/send_pan`)) {
        sendToDesk(`/Input_Channels/${ch}/Aux_Send/${aux}/send_pan/?`, []);
        return;
      }
    }
  }

  clearInterval(cachePrimeInterval);
  cachePrimeInterval = null;
  console.log('[JPMixer] Cache fully primed');
}

// ── Snapshot tracking ─────────────────────────────────────────────────────

function processSnapshotMsg(oscMsg) {
  if (oscMsg.address === '/Snapshots/Current_Snapshot') {
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
    setTimeout(() => applySceneForSnapshot(currentSnapshotName), 300);
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
  }, 25000);

  wss.on('connection', (ws) => {
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
    } catch (_) {}

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);

        if (msg.type === 'pong') { ws._lastPong = Date.now(); return; }

        // Mixer: dump cached levels for one specific aux
        if (msg.type === 'request-aux-levels') {
          for (const [address, cached] of cache.entries()) {
            if (address.includes(`/Aux_Send/${msg.aux}/`) && address.endsWith('/send_level')) {
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

        // Scene commands from browser
        if (msg.type === 'save-scene') {
          logEvent('scene-save', `snapshot:"${currentSnapshotName}" aux:${msg.aux}`);
          scenes.saveScene(currentSnapshotName, msg.aux, msg.values);
          broadcastToClients({ type: 'scene-saved', snapshot: currentSnapshotName, aux: msg.aux });
          return;
        }
        if (msg.type === 'delete-scene') {
          scenes.deleteScene(currentSnapshotName, msg.aux);
          broadcastToClients({ type: 'scene-deleted', snapshot: currentSnapshotName, aux: msg.aux });
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

        // Mixer tells us which aux it's currently viewing/adjusting — lets the
        // Monitor view show a live "who's mixing what" presence indicator.
        if (msg.type === 'set-active-aux') {
          ws._activeAux = (msg.aux === null || msg.aux === undefined) ? null : parseInt(msg.aux, 10);
          broadcastToClients({ type: 'active-mixers', counts: getActiveMixerCounts() });
          return;
        }

        // Personal named mixes — stored per-device, aux-agnostic.
        // Levels and pans are stored without an aux so they work regardless
        // of which aux the performer is currently assigned to.
        if (msg.type === 'save-preset') {
          const name = (msg.name || '').trim();
          if (!name || !msg.deviceId) return;
          logEvent('preset-save', `device:${msg.deviceId.slice(0,8)} name:"${name}"`);
          presets.savePreset(msg.deviceId, name, msg.levels, msg.pans);
          return;
        }
        if (msg.type === 'delete-preset') {
          if (!msg.deviceId) return;
          presets.deletePreset(msg.deviceId, msg.name);
          return;
        }
        // Client sends levels+pans from localStorage; server pushes them to the desk.
        if (msg.type === 'apply-preset') {
          const auxStr = String(msg.aux);
          const levels = pushSceneValuesToDesk(auxStr, msg.levels || {});
          for (const [ch, val] of Object.entries(msg.pans || {})) {
            const addr = `/Input_Channels/${ch}/Aux_Send/${auxStr}/send_pan`;
            sendToDesk(addr, [val]);
            cache.set(addr, { address: addr, args: [val] });
          }
          logEvent('preset-apply', `aux:${msg.aux} name:"${msg.name}"`);
          broadcastToClients({ type: 'preset-loaded', aux: msg.aux, name: msg.name, levels, pans: msg.pans || {} });
          return;
        }
        // Device requests its preset backup (used when localStorage is empty, e.g. new device)
        if (msg.type === 'request-device-presets') {
          if (!msg.deviceId) return;
          try { ws.send(JSON.stringify({ type: 'device-presets', presets: presets.getByDevice(msg.deviceId) })); } catch (_) {}
          return;
        }
        if (msg.type === 'request-aux-eq') {
          const prefix = `/Aux_Outputs/${msg.aux}/EQ/`;
          const eq = {};
          for (const [address, cached] of cache.entries()) {
            if (address.startsWith(prefix)) eq[address.slice(prefix.length)] = cached.args[0];
          }
          ws.send(JSON.stringify({ type: 'aux-eq', aux: msg.aux, eq }));
          // Query any missing params from the desk one at a time, paced — not
          // bursted in a single tick (see the note on primeCache for why).
          const missingEq = [];
          for (let b = 1; b <= 8; b++) {
            for (const p of [`eq_gain_${b}`, `eq_freq_${b}`, `eq_Q_${b}`]) {
              if (!cache.has(`${prefix}${p}`)) missingEq.push(`${prefix}${p}/?`);
            }
          }
          if (!cache.has(`${prefix}eq_in`)) missingEq.push(`${prefix}eq_in/?`);
          if (missingEq.length > 0) {
            // The EQ panel can send this twice in quick succession (open + a
            // reconnect racing it) — cancel any timer already loading this
            // aux instead of letting two run concurrently.
            const existingEqTimer = eqPrimeTimers.get(msg.aux);
            if (existingEqTimer) clearInterval(existingEqTimer);
            let eqIdx = 0;
            const eqTimer = setInterval(() => {
              if (eqIdx >= missingEq.length) {
                clearInterval(eqTimer);
                eqPrimeTimers.delete(msg.aux);
                return;
              }
              sendToDesk(missingEq[eqIdx++], []);
            }, 100);
            eqPrimeTimers.set(msg.aux, eqTimer);
          }
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
          // Poll the desk for current values — responses come back via OSC and broadcast to all clients
          const chCount  = cache.has('/Console/Input_Channels')
            ? cache.get('/Console/Input_Channels').args[0] : (serverCfg.channels || 48);
          const auxCount = cache.has('/Console/Aux_Outputs/modes')
            ? cache.get('/Console/Aux_Outputs/modes').args.length : (serverCfg.auxes || 16);
          const cgPollCount = cache.has('/Console/Control_Groups')
            ? cache.get('/Console/Control_Groups').args[0] : 8;
          for (let i = 1; i <= chCount; i++) {
            sendToDesk(`/Input_Channels/${i}/fader/?`, []);
            sendToDesk(`/Input_Channels/${i}/mute/?`, []);
          }
          for (let i = 1; i <= auxCount; i++) {
            sendToDesk(`/Aux_Outputs/${i}/fader/?`, []);
            sendToDesk(`/Aux_Outputs/${i}/mute/?`, []);
          }
          for (let i = 1; i <= cgPollCount; i++) {
            sendToDesk(`/Control_Groups/${i}/fader/?`, []);
            sendToDesk(`/Control_Groups/${i}/mute/?`, []);
            sendToDesk(`/Control_Groups/${i}/solo/?`, []);
            sendToDesk(`/Control_Groups/${i}/name/?`, []);
            sendToDesk(`/Control_Groups/${i}/Channel_Input/name/?`, []);
          }
          return;
        }

        // Console page — main channel fader
        if (msg.type === 'console-fader') {
          sendToDesk(`/Input_Channels/${msg.ch}/fader`, [msg.db]);
          consoleFaders[msg.ch] = msg.db;
          broadcastToClients({ address: `/Input_Channels/${msg.ch}/fader`, args: [msg.db] });
          return;
        }

        // Console page — main channel mute
        if (msg.type === 'console-mute') {
          const val = msg.muted ? 1.0 : 0.0;
          sendToDesk(`/Input_Channels/${msg.ch}/mute`, [val]);
          consoleMutes[msg.ch] = msg.muted;
          broadcastToClients({ address: `/Input_Channels/${msg.ch}/mute`, args: [val] });
          return;
        }

        // Console page — main channel solo
        if (msg.type === 'console-solo') {
          const val = msg.soloed ? 1.0 : 0.0;
          sendToDesk(`/Input_Channels/${msg.ch}/solo`, [val]);
          consoleSolos[msg.ch] = msg.soloed;
          broadcastToClients({ address: `/Input_Channels/${msg.ch}/solo`, args: [val] });
          return;
        }

        // Console page — aux output fader
        if (msg.type === 'aux-fader') {
          sendToDesk(`/Aux_Outputs/${msg.aux}/fader`, [msg.db]);
          auxFaders[msg.aux] = msg.db;
          broadcastToClients({ address: `/Aux_Outputs/${msg.aux}/fader`, args: [msg.db] });
          return;
        }

        // Console page — aux output mute
        if (msg.type === 'aux-mute') {
          const val = msg.muted ? 1.0 : 0.0;
          sendToDesk(`/Aux_Outputs/${msg.aux}/mute`, [val]);
          auxMutes[msg.aux] = msg.muted;
          broadcastToClients({ address: `/Aux_Outputs/${msg.aux}/mute`, args: [val] });
          return;
        }

        // Console page — control group fader
        if (msg.type === 'cg-fader') {
          sendToDesk(`/Control_Groups/${msg.cg}/fader`, [msg.db]);
          cgFaders[msg.cg] = msg.db;
          broadcastToClients({ address: `/Control_Groups/${msg.cg}/fader`, args: [msg.db] });
          return;
        }

        // Console page — control group mute
        if (msg.type === 'cg-mute') {
          const val = msg.muted ? 1.0 : 0.0;
          sendToDesk(`/Control_Groups/${msg.cg}/mute`, [val]);
          cgMutes[msg.cg] = msg.muted;
          broadcastToClients({ address: `/Control_Groups/${msg.cg}/mute`, args: [val] });
          return;
        }

        // Console page — control group solo
        if (msg.type === 'cg-solo') {
          const val = msg.soloed ? 1.0 : 0.0;
          sendToDesk(`/Control_Groups/${msg.cg}/solo`, [val]);
          cgSolos[msg.cg] = msg.soloed;
          broadcastToClients({ address: `/Control_Groups/${msg.cg}/solo`, args: [val] });
          return;
        }

        if (msg.type === 'fire-snapshot') {
          const addrMap = {
            prev: '/Snapshots/Fire_Prev_Snapshot',
            next: '/Snapshots/Fire_Next_Snapshot',
          };
          const addr = addrMap[msg.action];
          if (addr) sendToDesk(addr, [1]);
          return;
        }

        if (msg.type === 'set-mute') {
          const aux = parseInt(msg.aux), ch = parseInt(msg.ch);
          const chMax  = cache.has('/Console/Input_Channels') ? cache.get('/Console/Input_Channels').args[0] : (serverCfg.channels || 48);
          const auxMax = cache.has('/Console/Aux_Outputs/modes') ? cache.get('/Console/Aux_Outputs/modes').args.length : (serverCfg.auxes || 16);
          if (isNaN(aux) || aux < 1 || aux > auxMax || isNaN(ch) || ch < 1 || ch > chMax) return;
          if (!muteState[aux]) muteState[aux] = {};
          muteState[aux][ch] = !!msg.muted;
          applyMuteSolo(aux);
          return;
        }

        if (msg.type === 'set-solo') {
          const aux = parseInt(msg.aux), ch = parseInt(msg.ch);
          const chMax  = cache.has('/Console/Input_Channels') ? cache.get('/Console/Input_Channels').args[0] : (serverCfg.channels || 48);
          const auxMax = cache.has('/Console/Aux_Outputs/modes') ? cache.get('/Console/Aux_Outputs/modes').args.length : (serverCfg.auxes || 16);
          if (isNaN(aux) || aux < 1 || aux > auxMax || isNaN(ch) || ch < 1 || ch > chMax) return;
          if (!soloState[aux]) soloState[aux] = {};
          soloState[aux][ch] = !!msg.soloed;
          applyMuteSolo(aux);
          return;
        }

        const oscMsg = msg;
        if (!oscMsg.address) return;

        // Allowlist of OSC addresses browser clients are permitted to send/query.
        // Rejects snapshot fires, name changes, or other console-level commands.
        const ALLOWED_OSC_RE = /^\/(?:Input_Channels\/\d+\/Aux_Send\/\d+\/send_(?:level|pan)|Aux_Outputs\/\d+\/EQ\/(?:eq_(?:gain|freq|Q)_\d+|eq_in))(\/\?)?$/;

        // /? request — respond from cache if available, else relay to desk
        if (oscMsg.address.endsWith('/?')) {
          const key = oscMsg.address.slice(0, -2);
          if (!ALLOWED_OSC_RE.test(oscMsg.address)) return;
          if (cache.has(key)) {
            ws.send(JSON.stringify(cache.get(key)));
          } else {
            sendToDesk(oscMsg.address, oscMsg.args || []);
          }
          return;
        }

        if (!ALLOWED_OSC_RE.test(oscMsg.address)) return;

        maybeCacheResponse(oscMsg);

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
      logEvent('client-disconnect', `code:${code} reason:${reason || 'none'} remaining:${connections.length - 1}`);
      connections = connections.filter(c => c !== ws);
      if (onConnectionCountChange) onConnectionCountChange(connections.length);
      broadcastToClients({ type: 'connection-count', count: connections.length });
      if (ws._activeAux != null) broadcastToClients({ type: 'active-mixers', counts: getActiveMixerCounts() });
    });
  });
}

// ── Demo mode — fake console data so the UI can be explored without hardware ──

function startDemoMode() {
  const chCount  = serverCfg.channels || 16;
  const auxCount = serverCfg.auxes    || 6;
  const chOv     = serverCfg.channelOverrides || {};
  const auxOv    = serverCfg.auxOverrides     || {};

  cache.set('/Console/Input_Channels', { address: '/Console/Input_Channels', args: [chCount] });
  cache.set('/Console/Aux_Outputs/modes', { address: '/Console/Aux_Outputs/modes', args: new Array(auxCount).fill(2) });

  // Channel names: seed the cache with the label override if set, else "CH N".
  // buildConfig() will prefer ov.label anyway, so this just covers the no-override case.
  for (let i = 1; i <= chCount; i++) {
    const addr = `/Input_Channels/${i}/Channel_Input/name`;
    const label = (chOv[String(i)] || {}).label || `CH ${i}`;
    cache.set(addr, { address: addr, args: [label] });
  }

  // Aux names: same logic — override label if set, else "AUX N"
  for (let i = 1; i <= auxCount; i++) {
    const addr = `/Aux_Outputs/${i}/Buss_Trim/name`;
    const label = (auxOv[String(i)] || {}).label || `AUX ${i}`;
    cache.set(addr, { address: addr, args: [label] });
  }

  // Pre-fill plausible random levels for every ch × aux combination
  for (let aux = 1; aux <= auxCount; aux++) {
    for (let ch = 1; ch <= chCount; ch++) {
      const addr = `/Input_Channels/${ch}/Aux_Send/${aux}/send_level`;
      const db = sliderToDb(Math.random() * 0.35 + 0.40); // ~-20dB to +1dB
      cache.set(addr, { address: addr, args: [db] });
    }
  }

  currentSnapshotName = 'DEMO';
  loaded = true;
  logEvent('demo-mode', `channels:${chCount} auxes:${auxCount}`);
  if (onConsoleStatusChange) onConsoleStatusChange(true);
  startWebSocketServer();
}

// ── Main start / stop ─────────────────────────────────────────────────────

function start(cfg) {
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
  app.use(express.static(path.join(__dirname, '..', 'mixer')));
  app.use('/instrument-icons', express.static(path.join(__dirname, '..', '..', 'assets', 'Icons For instruments', '1-To-70-SVG-Files-MusicalInstrumentsBundle')));
  app.use('/instrument-icons', express.static(path.join(__dirname, '..', '..', 'assets', 'Icons For instruments', '71-To-120-SVG-Files-MusicalInstrumentsBundle')));

  // Diagnostic endpoints — localhost only to keep rig topology off the venue network
  const diagOnly = (req, res, next) => {
    const addr = req.socket.remoteAddress;
    if (addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1') return next();
    res.status(403).json({ error: 'Diagnostic endpoints are localhost-only' });
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
    const rows = eventLog.slice().reverse().map(e =>
      `<tr><td>${e.t}</td><td><b>${e.type}</b></td><td>${e.detail}</td></tr>`
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

  udpPort.on('message', (oscMsg, timeTag, info) => {
    allSeenAddresses.set(oscMsg.address, oscMsg.args);

    logOscTraffic('in', oscMsg.address, oscMsg.args, ipadPorts.has(info.address) ? `ipad:${ipadPorts.get(info.address).name}` : 'desk');

    // Message from a configured iPad — forward to desk and browser clients, skip desk handling
    const fromIpad = ipadPorts.get(info.address);
    if (fromIpad) {
      console.log(`[JPMixer] iPad "${fromIpad.name}" ← ${oscMsg.address}`);
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

    // Session change — reload data without dropping clients
    if (oscMsg.address === '/Console/Session/!') {
      logEvent('session-change', 'debouncing 500ms');
      clearTimeout(sessionReloadTimer);
      sessionReloadTimer = setTimeout(() => {
        logEvent('session-reload', 'clearing cache and reloading');
        cache.clear();
        clearMuteSolo();
        loaded = false;
        if (onConsoleStatusChange) onConsoleStatusChange(false);
        if (cachePrimeInterval) { clearInterval(cachePrimeInterval); cachePrimeInterval = null; }
        fetchValues();
      }, 500);
      return;
    }

    processSnapshotMsg(oscMsg);
    maybeCacheResponse(oscMsg);

    // Relay all desk messages to every configured iPad regardless of address
    sendToAllIpads(oscMsg.address, oscMsg.args, null);

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

    broadcast(oscMsg, info.address);
  });

  udpPort.on('error', (err) => {
    if (err.code === 'EHOSTDOWN' || err.code === 'EHOSTUNREACH') {
      console.warn(`[JPMixer] Desk not responding (${err.address})`);
    } else {
      console.error('[JPMixer] UDP error:', err.message);
    }
  });

  udpPort.on('ready', fetchValues);
  udpPort.open();

  // iPad OSC relay — shares the main UDP port. iPads send to JPMixer's main listen port;
  // messages are routed by source IP. JPMixer sends replies to each iPad's sendPort.
  for (const conn of (cfg.ipadConnections || [])) {
    if (!conn.enabled || !conn.ip) continue;
    ipadPorts.set(conn.ip, { id: conn.id, name: conn.name || 'iPad', ip: conn.ip, sendPort: conn.sendPort });
    console.log(`[JPMixer] iPad "${conn.name}" registered → ${conn.ip}:${conn.sendPort} (receives from main port)`);
  }
}

function stop() {
  if (cachePrimeInterval)  { clearInterval(cachePrimeInterval);   cachePrimeInterval  = null; }
  if (pingInterval)        { clearInterval(pingInterval);         pingInterval        = null; }
  if (sessionReloadTimer)  { clearTimeout(sessionReloadTimer);    sessionReloadTimer  = null; }
  if (oscLogFlushTimer)    { clearInterval(oscLogFlushTimer);     oscLogFlushTimer    = null; }
  if (oscLogRecordStream)  { stopOscLogRecording(); }
  for (const t of eqPrimeTimers.values()) clearInterval(t);
  eqPrimeTimers.clear();

  // Restore real fader levels to the desk for any muted channels so the desk
  // doesn't retain -150 after we stop. Must run before clearMuteSolo() wipes premuteState.
  if (udpPort) {
    for (const [auxKey, channels] of Object.entries(premuteState)) {
      for (const [chKey, db] of Object.entries(channels)) {
        sendToDesk(`/Input_Channels/${chKey}/Aux_Send/${auxKey}/send_level`, [db]);
      }
    }
  }
  clearMuteSolo();
  if (udpPort) { try { udpPort.close(); } catch (_) {} udpPort = null; }
  ipadPorts.clear();
  if (wss)         { wss.close();                               wss         = null; }
  if (httpServer)  { httpServer.close();                        httpServer  = null; }
  loaded = false;
  if (onConsoleStatusChange) onConsoleStatusChange(false);
  cache.clear();
  connections = [];
  console.log('[JPMixer] Server stopped');
}

function getChannelNames() {
  const names = {};
  for (const [key, val] of cache.entries()) {
    const m = key.match(/^\/Input_Channels\/(\d+)\/Channel_Input\/name$/);
    if (m) names[m[1]] = val.args[0] || '';
  }
  return names;
}

function getAuxNames() {
  const names = {};
  for (const [key, val] of cache.entries()) {
    const m = key.match(/^\/Aux_Outputs\/(\d+)\/Buss_Trim\/name$/);
    if (m) names[m[1]] = val.args[0] || '';
  }
  return names;
}

function isConsoleConnected() { return loaded; }
function setConsoleStatusCallback(cb) { onConsoleStatusChange = cb; }

function setConnectionCountCallback(cb) { onConnectionCountChange = cb; }
function getConnectionCount() { return connections.length; }

function setServerErrorCallback(cb) { onServerError = cb; }

function getOscLog() { return oscLog; }
function setOscTrafficCallback(cb) { onOscTraffic = cb; }

module.exports = { start, stop, getChannelNames, getAuxNames, isConsoleConnected, setConsoleStatusCallback, setConnectionCountCallback, getConnectionCount, setServerErrorCallback, getOscLog, setOscTrafficCallback, startOscLogRecording, stopOscLogRecording, getOscLogRecordingStatus, oscLogRecordsFolder };
