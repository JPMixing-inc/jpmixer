'use strict';

const express  = require('express');
const http     = require('http');
const WebSocket = require('ws');
const osc      = require('osc');
const path     = require('path');
const scenes   = require('./scenes');

let httpServer    = null;
let wss           = null;
let udpPort       = null;
let ipadPorts     = []; // [{ id, ip, sendPort, udpPort }]
let serverCfg     = {};

// Ring buffer of recent server events for /api/events diagnostics
const eventLog = [];
function logEvent(type, detail) {
  const entry = { t: new Date().toISOString(), type, detail };
  eventLog.push(entry);
  if (eventLog.length > 100) eventLog.shift();
  console.log(`[JPMixer] ${type}: ${detail}`);
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

// Background cache-priming interval
let cachePrimeInterval = null;

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
    broadcastLevels[auxStr] = {};
    for (const [chStr, sliderVal] of Object.entries(values)) {
      const address = `/Input_Channels/${chStr}/Aux_Send/${auxStr}/send_level`;
      const db = sliderToDb(sliderVal);
      sendToDesk(address, [db]);
      // Update cache immediately so desk echoes don't race with the broadcast
      cache.set(address, { address, args: [db] });
      broadcastLevels[auxStr][chStr] = sliderVal;
      // If this channel was muted, update premuteState so unmute restores the recalled value
      if (premuteState[auxStr]?.[chStr] !== undefined) {
        premuteState[auxStr][chStr] = db;
      }
    }
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
      enabled: ov.enabled !== false,
      label:   ov.label || consoleName,
      channel: i + 1,
      stereo:  auxModes[i] === 2,
      colour:  ov.colour || generateColour(auxCount, i),
      icon:    ''
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
      icon:    ov.icon  || '',
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
      title:   (isFirst && group) ? group.name   : '',
      colour:  (isFirst && group) ? group.colour : '',
      icon:    ch.icon,
    });
  });

  const cgCount = cache.has('/Console/Control_Groups')
    ? cache.get('/Console/Control_Groups').args[0]
    : 8;
  const controlGroups = [];
  for (let i = 1; i <= cgCount; i++) {
    const name = cache.has(`/Control_Groups/${i}/Channel_Input/name`)
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
  /^\/Input_Channels\/\d+\/Aux_Send\/\d+\/send_level$/,
  /^\/Input_Channels\/\d+\/Aux_Send\/\d+\/send_pan$/,
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
  } catch (e) {
    console.error('[JPMixer] sendToDesk error:', e.message);
  }
}

function sendToAllIpads(address, args, excludeIp) {
  for (const { ip, sendPort, udpPort: iPort } of ipadPorts) {
    if (ip === excludeIp) continue;
    try {
      iPort.send({ address, args: args || [] }, ip, sendPort);
    } catch (e) {}
  }
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

    // Send full console state immediately
    ws.send(buildConfig());

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

        // Monitor: dump all cached send levels to this client
        if (msg.type === 'request-all-levels') {
          for (const [address, cached] of cache.entries()) {
            if (address.includes('/Aux_Send/') && address.endsWith('/send_level')) {
              ws.send(JSON.stringify(cached));
            }
          }
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
          if (!muteState[msg.aux]) muteState[msg.aux] = {};
          muteState[msg.aux][msg.ch] = !!msg.muted;
          applyMuteSolo(msg.aux);
          return;
        }

        if (msg.type === 'set-solo') {
          if (!soloState[msg.aux]) soloState[msg.aux] = {};
          soloState[msg.aux][msg.ch] = !!msg.soloed;
          applyMuteSolo(msg.aux);
          return;
        }

        const oscMsg = msg;
        if (!oscMsg.address) return;

        // /? request — respond from cache if available, else relay to desk
        if (oscMsg.address.endsWith('/?')) {
          const key = oscMsg.address.slice(0, -2);
          if (cache.has(key)) {
            ws.send(JSON.stringify(cache.get(key)));
          } else {
            sendToDesk(oscMsg.address, oscMsg.args || []);
          }
          return;
        }

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
    });
  });
}

// ── Main start / stop ─────────────────────────────────────────────────────

function start(cfg) {
  serverCfg = cfg;
  loaded    = false;
  cache.clear();
  connections = [];

  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'mixer')));
  app.use('/instrument-icons', express.static(path.join(__dirname, '..', '..', 'assets', 'Icons For instruments', '1-To-70-SVG-Files-MusicalInstrumentsBundle')));
  app.use('/instrument-icons', express.static(path.join(__dirname, '..', '..', 'assets', 'Icons For instruments', '71-To-120-SVG-Files-MusicalInstrumentsBundle')));

  // Shows selectively-cached OSC values
  app.get('/api/osc-cache', (req, res) => {
    const entries = {};
    for (const [k, v] of cache.entries()) entries[k] = v.args;
    res.json(entries);
  });

  // Shows EVERY unique OSC address received — useful for finding unknown paths
  app.get('/api/osc-all', (req, res) => {
    const entries = {};
    for (const [k, v] of allSeenAddresses.entries()) entries[k] = v;
    res.json(entries);
  });

  // Clears the all-seen tracker so you can isolate new messages
  app.get('/api/osc-clear', (req, res) => {
    allSeenAddresses.clear();
    res.json({ cleared: true });
  });

  // Recent server events — open in browser to diagnose disconnects
  app.get('/api/events', (req, res) => {
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

  httpServer.listen(cfg.serverPort, () => {
    console.log(`[JPMixer] Web server     → http://localhost:${cfg.serverPort}`);
    console.log(`[JPMixer] Polling desk   → ${cfg.deskIp}:${cfg.deskSendPort}`);
    console.log(`[JPMixer] OSC listen     → :${cfg.deskListenPort}`);
  });

  udpPort = new osc.UDPPort({
    localAddress: '0.0.0.0',
    localPort:    cfg.deskListenPort
  });

  udpPort.on('message', (oscMsg, timeTag, info) => {
    allSeenAddresses.set(oscMsg.address, oscMsg.args);

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

    // Console-level fader / mute / solo — track state and forward to console page
    const chFaderM = oscMsg.address.match(/^\/Input_Channels\/(\d+)\/fader$/);
    if (chFaderM) { consoleFaders[parseInt(chFaderM[1])] = oscMsg.args[0]; broadcastToClients({ address: oscMsg.address, args: oscMsg.args }); return; }

    const chMuteM = oscMsg.address.match(/^\/Input_Channels\/(\d+)\/mute$/);
    if (chMuteM) { consoleMutes[parseInt(chMuteM[1])] = !!oscMsg.args[0]; broadcastToClients({ address: oscMsg.address, args: oscMsg.args }); return; }

    const chSoloM = oscMsg.address.match(/^\/Input_Channels\/(\d+)\/solo$/);
    if (chSoloM) { consoleSolos[parseInt(chSoloM[1])] = !!oscMsg.args[0]; broadcastToClients({ address: oscMsg.address, args: oscMsg.args }); return; }

    const auxFaderM = oscMsg.address.match(/^\/Aux_Outputs\/(\d+)\/fader$/);
    if (auxFaderM) { auxFaders[parseInt(auxFaderM[1])] = oscMsg.args[0]; broadcastToClients({ address: oscMsg.address, args: oscMsg.args }); return; }

    const auxMuteM = oscMsg.address.match(/^\/Aux_Outputs\/(\d+)\/mute$/);
    if (auxMuteM) { auxMutes[parseInt(auxMuteM[1])] = !!oscMsg.args[0]; broadcastToClients({ address: oscMsg.address, args: oscMsg.args }); return; }

    const cgFaderM = oscMsg.address.match(/^\/Control_Groups\/(\d+)\/fader$/);
    if (cgFaderM) { cgFaders[parseInt(cgFaderM[1])] = oscMsg.args[0]; broadcastToClients({ address: oscMsg.address, args: oscMsg.args }); return; }

    const cgMuteM = oscMsg.address.match(/^\/Control_Groups\/(\d+)\/mute$/);
    if (cgMuteM) { cgMutes[parseInt(cgMuteM[1])] = !!oscMsg.args[0]; broadcastToClients({ address: oscMsg.address, args: oscMsg.args }); return; }

    const cgSoloM = oscMsg.address.match(/^\/Control_Groups\/(\d+)\/solo$/);
    if (cgSoloM) { cgSolos[parseInt(cgSoloM[1])] = !!oscMsg.args[0]; broadcastToClients({ address: oscMsg.address, args: oscMsg.args }); return; }

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

  // iPad OSC bridges
  for (const conn of (cfg.ipadConnections || [])) {
    if (!conn.enabled || !conn.ip || !conn.listenPort) continue;
    const iPort = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: conn.listenPort });
    iPort.on('message', (oscMsg) => {
      sendToDesk(oscMsg.address, oscMsg.args);
      maybeCacheResponse(oscMsg);
      broadcastToClients(oscMsg);
    });
    iPort.on('error', (err) => {
      console.warn(`[JPMixer] iPad "${conn.name}" error:`, err.message);
    });
    iPort.open();
    ipadPorts.push({ id: conn.id, ip: conn.ip, sendPort: conn.sendPort, udpPort: iPort });
    console.log(`[JPMixer] iPad "${conn.name}" → ${conn.ip}:${conn.sendPort} (listen :${conn.listenPort})`);
  }
}

function stop() {
  if (cachePrimeInterval)  { clearInterval(cachePrimeInterval);   cachePrimeInterval  = null; }
  if (pingInterval)        { clearInterval(pingInterval);         pingInterval        = null; }
  if (sessionReloadTimer)  { clearTimeout(sessionReloadTimer);    sessionReloadTimer  = null; }
  clearMuteSolo();
  if (udpPort) { try { udpPort.close(); } catch (_) {} udpPort = null; }
  for (const { udpPort: iPort } of ipadPorts) { try { iPort.close(); } catch (_) {} }
  ipadPorts = [];
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

module.exports = { start, stop, getChannelNames, getAuxNames, isConsoleConnected, setConsoleStatusCallback, setConnectionCountCallback, getConnectionCount };
