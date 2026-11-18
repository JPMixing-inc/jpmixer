'use strict';

// ── Midas M32 / Behringer X32 server — a sixth, independent backend ────────
// Speaks the same browser-facing WebSocket dialect as osc-server.js and the
// dLive/KLANG/WING/LV1 backends, so mixer.js, monitor.js and devices.js work
// unmodified. Never imported by, and never imports, the other backends.
//
// The M32 and X32 share one OSC protocol (see m32-protocol.js), so this one
// backend covers both. Written from the protocol document before it had been
// tried on a real console: the event log and the OSC Log tab are there so
// the first people testing it can show what their console did.
//
// Like LV1, the console tells JPMixer what it has:
//   - channel, mix and DCA names, read when it connects and followed as
//     they change (Settings labels still win)
//   - every send level, on/off and pan: read when it connects (an open mix
//     first), then kept current by /xremote, so phones follow changes made
//     on the desk, in M32-Edit or in the M32 Mix app
//   - which mix buses are linked: a linked pair is one stereo mix (the odd
//     bus, with pan), and its even bus isn't offered as a mix of its own
//   - the scene (or cue) it's on, so Ear Scenes work, keyed by its number
//
// SCOPE:
//   ✓ Per-send level, pan (stereo mixes), real per-send on/off for mute and
//     solo, My Mixes, Ear Scenes, Devices View, live names
//   ✓ Console Controller: channel, mix and DCA faders and mutes, channel and
//     DCA solo, and the ‹ › scene buttons
//   ✓ Traffic log (Settings → OSC Log), recordable to a file
//   ✗ Mix EQ for performers, the channel processing panel
//
// Mute/solo switch sends off with the console's per-send on/off rather than
// pulling the level down, so a level is never lost. A send the engineer had
// already switched off stays off when the mute or solo is released.
//
// Channels: JPMixer's 1-32 are the input channels, 33-40 the aux ins and
// 41-48 the FX returns (Settings' channel count, up to 48). Mixes are the 16
// mix buses (Settings' aux count, up to 16).

const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');
const fs        = require('fs');
const { app }   = require('electron');
const scenes    = require('./scenes');
const shared    = require('./shared-handlers');
const access    = require('./access');
const { mountGreenRoom } = require('./greenroom');
const { mountBranding } = require('./branding');
const { mountPerformerAssignments } = require('./performer-assignments');
const { mountFoh } = require('./foh');
const P = require('./m32-protocol');
const { M32Client } = require('./m32-client');
const { createPacedWriter } = require('./paced-writer');
// Presets, Ear Scenes and mute/solo go through this; a musician's own
// fader/pan move goes straight out.
const pacer = createPacedWriter();

let httpServer = null;
let wss        = null;
let m32        = null;
let serverCfg  = {};
let connections = [];
let pingInterval = null;
let sceneCheck = null;

let onConsoleStatusChange = null;
let onConnectionCountChange = null;
let onServerError = null;
let onOscTraffic = null;

const eventLog = [];
function logEvent(type, detail) {
  eventLog.push({ t: new Date().toISOString(), type, detail });
  if (eventLog.length > 100) eventLog.shift();
  console.log(`[JPMixer/M32] ${type}: ${detail}`);
}

// ── State ────────────────────────────────────────────────────────────────
let consoleConnected = false;
let consoleInfo = '';           // model, name and firmware, logged once
let currentScene = null;        // the scene/cue number as two digits ("05"), the Ear Scene key
let showPosition = null;        // the same as a number
let showControl = null;         // what the console's show list steps through: 0 cues, 2 snippets, else scenes
const showKind = () => (showControl === 0 ? 'cue' : showControl === 2 ? 'snippet' : 'scene');
let positionKnown = false;      // the console has said where it is (-1: no scene loaded)
const names = { input: new Map(), aux: new Map(), cg: new Map() }; // from the console
const busLinks = new Array(P.BUSES / 2).fill(false); // pair (bus 1-2 is 0) linked as one stereo mix
// Each strip's own fader/mute/solo, for the Console Controller:
// "input:N" | "aux:N" | "cg:N" -> { gain (dB), mute, solo }
const tracks = new Map();
const levelCache = new Map();   // "ch:aux" -> dB
const panCache   = new Map();   // "ch:aux" -> 0..1
const onCache    = new Map();   // "ch:aux" -> the console's per-send on/off
const muteState  = {};          // muteState[aux][ch]
const soloState  = {};          // soloState[aux][ch]
// Sends JPMixer is holding off for a mute/solo: key -> { wasOn }. wasOn is
// null while asking the console, true if JPMixer switched it off, false if
// it was already off (so a release leaves it off).
const silencedSends = new Map();
// Releases sent in the last 10 s: key -> when. UDP to a console that's gone
// just vanishes (it's only noticed gone after 5 s of silence), so these are
// sent again when it's back; switching a send on twice does nothing. The
// console reporting that send's on/off since clears it. One made while the
// console is gone, or in the 10 s before the drop was noticed, is kept for
// the reconnect however long it's away (KEPT): the 10 s used to be counted
// at the reconnect, so an outage over 10 s lost the unmute and the channel
// stayed off in that musician's ears.
const recentReleases = new Map();
let RELEASE_RESEND_MS = 10000;
const KEPT = Infinity;
// JPMixer's own writes, so what the console reports in the moment after
// (its echo, or an answer to a question asked just before the write) doesn't
// put a fader back: "lvl:ch:aux" | "pan:ch:aux" | "trk:strip:n" -> when.
// And paced writes not sent yet, which the console can't know about.
const recentWrites = new Map();
const queuedWrites = new Set();
const ECHO_MS = 1000;
// Mixes whose sends have been asked for since the console connected, and
// those fully answered
const auxAsked = new Set();
const auxRead  = new Set();

const levelKey = (ch, aux) => `${ch}:${aux}`;
const chCount  = () => Math.max(1, Math.min(Number.isInteger(serverCfg.channels) ? serverCfg.channels : P.INPUTS, P.INPUTS));
const auxCount = () => Math.max(0, Math.min(Number.isInteger(serverCfg.auxes) ? serverCfg.auxes : P.BUSES, P.BUSES));

// Linked mix buses: the odd one is a stereo mix, the even one its right half
const linked   = (aux) => busLinks[Math.floor((aux - 1) / 2)] === true;
const isStereo = (aux) => aux % 2 === 1 && linked(aux);
const isRightHalf = (aux) => aux % 2 === 0 && linked(aux);
// The buses a change to a mix goes to: both halves of a stereo mix, in case
// the console doesn't copy a linked send's level and on/off across by itself
const busesOf  = (aux) => (isStereo(aux) ? [aux, aux + 1] : [aux]);
const isMix    = (aux) => Number.isInteger(aux) && aux >= 1 && aux <= auxCount() && !isRightHalf(aux);

function broadcastToClients(msg, excludeSocket) {
  const payload = typeof msg === 'string' ? msg : JSON.stringify(msg);
  for (const conn of connections) {
    if (conn !== excludeSocket && conn.readyState === WebSocket.OPEN) conn.send(payload);
  }
}

function getActiveMixerCounts() {
  const counts = {};
  for (const conn of connections) {
    if (conn.readyState === WebSocket.OPEN && conn._activeAux != null) counts[conn._activeAux] = (counts[conn._activeAux] || 0) + 1;
  }
  return counts;
}

function getConnectedDevicesInfo() {
  const devices = [];
  for (const conn of connections) {
    if (conn.readyState === WebSocket.OPEN && (conn._deviceId != null || conn._activeAux != null)) {
      devices.push({ deviceId: conn._deviceId || null, aux: conn._activeAux ?? null, lastActivity: conn._lastActivityAt || null, lastPong: conn._lastPong || null });
    }
  }
  return devices;
}
function broadcastDevicesUpdate() { broadcastToClients({ type: 'devices-update', devices: getConnectedDevicesInfo() }); }

// ── OSC traffic log (Settings → OSC Log) ──────────────────────────────────
// The same shape as osc-server.js's, so the tab and its recording work as
// they do for DiGiCo. The connection check and the scene check that run
// every second or two are left out, apart from a scene change.
const oscLog = [];
const OSC_LOG_CAP = 500;
let oscLogBatch = [];
let oscLogFlushTimer = null;
let oscLogSeq = 0;
let oscLogRecordStream = null;
let oscLogRecordPath = null;
let oscLogRecordCount = 0;
let lastLoggedPosition = null;

function logOscTraffic(dir, msg) {
  if (msg.address === P.ADDR.info || msg.address === P.XREMOTE.address) return;
  if (msg.address === P.ADDR.showPosition) {
    const v = Array.isArray(msg.args) ? msg.args[0] : undefined;
    if (v === lastLoggedPosition) return;
    lastLoggedPosition = v;
  }
  const args = (msg.args || []).map(a => (a && typeof a === 'object' && 'value' in a ? a.value : a));
  const entry = { seq: ++oscLogSeq, t: Date.now(), dir, address: msg.address, args, source: 'desk' };
  oscLog.push(entry);
  if (oscLog.length > OSC_LOG_CAP) oscLog.shift();
  oscLogBatch.push(entry);
  if (oscLogRecordStream) {
    try { oscLogRecordStream.write(formatOscLogLine(entry) + '\n'); oscLogRecordCount++; } catch (_) {}
  }
}
function formatOscLogLine(entry) {
  const time = new Date(entry.t).toTimeString().slice(0, 8) + '.' + String(entry.t % 1000).padStart(3, '0');
  const args = (entry.args || []).map(a => (typeof a === 'number' ? (Number.isInteger(a) ? String(a) : a.toFixed(4)) : JSON.stringify(a))).join(', ');
  return `[${time}] ${entry.dir === 'in' ? '<-' : '->'} ${entry.address} ${args}`;
}
function oscLogRecordsFolder() {
  const dir = path.join(app.getPath('userData'), 'osc-logs');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return dir;
}
function startOscLogRecording() {
  if (oscLogRecordStream) return { ok: true, filePath: oscLogRecordPath };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(oscLogRecordsFolder(), `m32-log-${stamp}.txt`);
  try {
    oscLogRecordStream = fs.createWriteStream(filePath, { flags: 'a' });
    oscLogRecordStream.on('error', (e) => { logEvent('osc-log-error', e.message); stopOscLogRecording(); });
  } catch (e) {
    return { ok: false, error: e.message };
  }
  oscLogRecordPath = filePath;
  oscLogRecordCount = 0;
  logEvent('osc-log-start', filePath);
  return { ok: true, filePath };
}
function stopOscLogRecording() {
  if (!oscLogRecordStream) return { ok: true, filePath: null, count: 0 };
  const filePath = oscLogRecordPath, count = oscLogRecordCount;
  try { oscLogRecordStream.end(); } catch (_) {}
  oscLogRecordStream = null; oscLogRecordPath = null;
  logEvent('osc-log-stop', `${filePath} (${count} lines)`);
  return { ok: true, filePath, count };
}
function getOscLogRecordingStatus() { return { recording: !!oscLogRecordStream, filePath: oscLogRecordPath, count: oscLogRecordCount }; }

// ── Config builder — same shape the other backends produce ───────────────
const getControlGroups = () => Array.from({ length: P.DCAS }, (_, i) => ({ channel: i + 1, label: names.cg.get(i + 1) || `DCA ${i + 1}` }));

function buildConfig(extra = {}) {
  const cfgAuxOverrides = serverCfg.auxOverrides || {};
  const auxilaries = [];
  for (let i = 1; i <= auxCount(); i++) {
    const ov = cfgAuxOverrides[String(i)] || {};
    auxilaries.push({
      // The right half of a stereo mix isn't a mix of its own
      enabled:   ov.enabled !== false && !isRightHalf(i),
      label:     ov.label || shared.consoleNameOr(serverCfg, 'auxes', i, names.aux.get(i)) || `AUX ${i}`,
      channel:   i,
      stereo:    isStereo(i), // a mono mix's sends have no pan
      colour:    ov.colour || '#e8a020',
      icon:      '',
      eqEnabled: false, // the mix's EQ isn't offered to performers on the M32 yet
      linkOnly:  ov.linkOnly === true,
      groups:    shared.auxGroupNames(ov, serverCfg),
      channels:  shared.auxChannels(ov),
    });
  }
  return JSON.stringify({
    config: {
      channels: shared.buildChannelList(chCount(), serverCfg, i => names.input.get(i)),
      aux: auxilaries,
      controlGroups: getControlGroups(),
      channelProcessing: false, // no channel processing panel for the M32 yet
      snapshot: currentScene || '—',
      sceneRecallEnabled: !!serverCfg.sceneRecallEnabled,
      earScenes: serverCfg.performerEarScenes !== false,
      scenes: scenes.getAll(),
      mutes: muteState,
      solos: soloState,
      ...extra,
    },
  });
}

// Names and links arrive one by one when the console connects; phones get
// one refreshed layout once they settle
let layoutTimer = null;
function pushLayoutSoon() {
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => { if (wss) broadcastToClients(buildConfig({ liveUpdate: true })); }, 250);
}

// ── Writes to the console ─────────────────────────────────────────────────
function noteWrite(key) { recentWrites.set(key, Date.now()); }
// What the console says about something JPMixer has just changed (or is
// about to) is older than what JPMixer sent
const justWritten = (key) => queuedWrites.has(key) || Date.now() - (recentWrites.get(key) || 0) < ECHO_MS;

function writeSendOn(ch, aux, on) {
  let sent = true;
  for (const bus of busesOf(aux)) sent = !!(m32 && m32.send(() => P.sendOn(ch, bus, on))) && sent;
  return sent;
}
// A mute/solo's on/off, paced. Noted as the console's state when it's
// queued, not sent: a mute, release and mute again in quick succession has
// to see the release it's replacing, or it ends up on.
function queueSendOn(ch, aux, on) {
  const key = levelKey(ch, aux);
  onCache.set(key, on);
  noteWrite(`on:${key}`);
  pacer.write(`on:${key}`, () => writeSendOn(ch, aux, on), true);
}

// A send level from a phone, preset or Ear Scene: straight to the console,
// or paced for a batch
function writeLevel(ch, aux, db, paced) {
  const key = levelKey(ch, aux), wkey = `lvl:${key}`;
  levelCache.set(key, db);
  pacer.cancel(wkey); // this supersedes a queued write
  const level = P.dbToLevel(db);
  const out = () => {
    queuedWrites.delete(wkey);
    noteWrite(wkey);
    for (const bus of busesOf(aux)) m32 && m32.send(() => P.sendLevel(ch, bus, level));
  };
  if (!paced) { out(); return; }
  queuedWrites.add(wkey);
  pacer.write(wkey, out);
}
function writePan(ch, aux, slider, paced) {
  if (!isStereo(aux)) return false;
  const key = levelKey(ch, aux), wkey = `pan:${key}`;
  panCache.set(key, slider);
  pacer.cancel(wkey);
  const out = () => { queuedWrites.delete(wkey); noteWrite(wkey); m32 && m32.send(() => P.sendPan(ch, aux, slider)); };
  if (!paced) { out(); return true; }
  queuedWrites.add(wkey);
  pacer.write(wkey, out);
  return true;
}

// ── Mute / solo ──────────────────────────────────────────────────────────
function applyMuteSolo(aux) {
  broadcastToClients({ type: 'mute-solo-state', aux, mutes: muteState[aux] || {}, solos: soloState[aux] || {}, levels: {} });
}
function validPair(auxRaw, chRaw) {
  const aux = parseInt(auxRaw, 10), ch = parseInt(chRaw, 10);
  if (!isMix(aux) || !Number.isInteger(ch) || ch < 1 || ch > chCount()) return null;
  return { aux, ch };
}
// Validated here, not only in the WS handler, so the Control API gets the
// same guarantees as a phone's button
function sendMute(auxRaw, chRaw, on) {
  const p = validPair(auxRaw, chRaw); if (!p) return false;
  if (!muteState[p.aux]) muteState[p.aux] = {};
  muteState[p.aux][p.ch] = !!on;
  applySilencing(p.aux); applyMuteSolo(p.aux);
  return true;
}
function sendSolo(auxRaw, chRaw, on) {
  const p = validPair(auxRaw, chRaw); if (!p) return false;
  if (!soloState[p.aux]) soloState[p.aux] = {};
  soloState[p.aux][p.ch] = !!on;
  applySilencing(p.aux); applyMuteSolo(p.aux);
  return true;
}

// Re-derives every channel's send on/off in this mix from mute/solo. The
// console's on/off is known once its sends are read; before that it's asked
// first, so a send the engineer switched off stays off on release. A mute
// always switches the send off, even one JPMixer thinks is off already:
// that does nothing if it's right, and keeps the channel silent if it isn't.
function applySilencing(aux) {
  const anySolo = Object.values(soloState[aux] || {}).some(Boolean);
  for (let ch = 1; ch <= chCount(); ch++) {
    const key = levelKey(ch, aux);
    const silenced = !!muteState[aux]?.[ch] || (anySolo && !soloState[aux]?.[ch]);
    const entry = silencedSends.get(key);
    if (silenced && !entry) {
      recentReleases.delete(key);
      if (onCache.has(key)) {
        silencedSends.set(key, { wasOn: onCache.get(key) });
        queueSendOn(ch, aux, false);
        continue;
      }
      const pending = { wasOn: null };
      silencedSends.set(key, pending);
      const client = m32;
      pacer.write(`geton:${key}`, () => client && client.query(P.ADDR.sendOn(ch, aux), true).then((on) => {
        if (m32 !== client || silencedSends.get(key) !== pending || pending.wasOn !== null) return; // released, stopped or settled meanwhile
        pending.wasOn = on !== 0; // no answer: assume on, so it's still silenced
        queueSendOn(ch, aux, false);
      }), true);
    } else if (!silenced && entry) {
      silencedSends.delete(key);
      pacer.cancel(`geton:${key}`); // not asked yet: nothing was switched off
      if (entry.wasOn) {
        queueSendOn(ch, aux, true);
        recentReleases.set(key, consoleConnected ? Date.now() : KEPT);
      }
    }
  }
}

// Two mix buses about to be linked or unlinked: their mutes and solos are
// released first, on the buses they were made on. After the change a release
// would go to other buses (unlinking left the right half off), or the mix
// couldn't be reached at all (linking hides the right half).
function releasePair(pair) {
  for (const aux of [pair * 2 - 1, pair * 2]) {
    let had = false;
    for (const [key, entry] of [...silencedSends]) {
      const [ch, a] = key.split(':').map(Number);
      if (a !== aux) continue;
      had = true;
      silencedSends.delete(key);
      pacer.cancel(`geton:${key}`);
      if (!entry.wasOn) continue;
      const buses = busesOf(aux); // as they are now
      onCache.set(key, true);
      pacer.write(`on:${key}`, () => { for (const bus of buses) m32 && m32.send(() => P.sendOn(ch, bus, true)); }, true);
    }
    if (had || muteState[aux] || soloState[aux]) {
      delete muteState[aux]; delete soloState[aux];
      applyMuteSolo(aux);
    }
  }
}

// The console's on/off for a send. One JPMixer is holding off that comes
// back on (a scene recall, or the engineer) is switched off again, and
// released on when the mute/solo ends.
function noteDeskOn(ch, aux, on) {
  const key = levelKey(ch, aux);
  const entry = silencedSends.get(key);
  // Not held: a report that disagrees with what JPMixer has just written is
  // older than the write (an answer to a question asked before it)
  if (!entry && on !== onCache.get(key) && justWritten(`on:${key}`)) return;
  onCache.set(key, on);
  recentReleases.delete(key); // the console has told us since: a reconnect mustn't resend it
  if (!entry) return;
  if (entry.wasOn === null) entry.wasOn = on;
  else if (on) entry.wasOn = true;
  if (on) queueSendOn(ch, aux, false);
}

// ── Scenes ───────────────────────────────────────────────────────────────
// The Console Controller's and Monitor Engineer's ‹ › buttons: the scene (or
// cue, when the console's show list steps through cues) before or after the
// one it's on
function fireSnapshot(action) {
  if (!m32 || !consoleConnected || showPosition === null) return false;
  const next = showPosition + (action === 'next' ? 1 : -1);
  if (next < 0 || next > P.SHOW_MAX) return false;
  const kind = showKind();
  logEvent('scene-fire', `${action} → ${kind} ${next}`);
  return m32.send(() => (kind === 'cue' ? P.goCue(next) : kind === 'snippet' ? P.goSnippet(next) : P.goScene(next)));
}

// Live relabeling (Control API / Planning Center) — see shared-handlers.js
function setChannelLabel(n, label) { return shared.relabel(serverCfg, 'channel', n, label, chCount(), broadcastToClients); }
function setAuxLabel(n, label) { return shared.relabel(serverCfg, 'aux', n, label, auxCount(), broadcastToClients); }

// ── Ear Scenes — keyed by the console's scene number ──────────────────────
function pushSceneValues(auxStr, values) {
  const levels = {};
  const aux = parseInt(auxStr, 10);
  if (!isMix(aux)) return levels;
  for (const [chStr, sliderVal] of Object.entries(values || {})) {
    const ch = parseInt(chStr, 10);
    // Recall/preset payloads come from clients: skip anything that isn't a real slider position
    if (!Number.isInteger(ch) || ch < 1 || ch > chCount() || !Number.isFinite(sliderVal) || sliderVal < 0 || sliderVal > 1) continue;
    if (!shared.channelOnMix(serverCfg, aux, ch)) continue; // hidden from this mix's phones
    levels[chStr] = sliderVal;
    writeLevel(ch, aux, shared.sliderToDb(sliderVal), true);
  }
  return levels;
}
function applySceneByName(name) {
  if (!serverCfg.sceneRecallEnabled) { logEvent('scene-skip', `auto-recall disabled — scene ${name}`); return; }
  const saved = scenes.getAll()[name];
  if (!saved) { logEvent('scene-skip', `no Ear Scene saved for scene ${name}`); return; }
  logEvent('scene-recall', `applying scene ${name}`);
  const broadcastLevels = {};
  for (const [auxStr, values] of Object.entries(saved)) broadcastLevels[auxStr] = pushSceneValues(auxStr, values);
  broadcastToClients({ type: 'scene-recalled', snapshot: name, levels: broadcastLevels });
}

// The console is on a new scene (or cue). The first one seen is where it
// already was. After a recall, the sends are read again (in case the scene's
// changes didn't all come through /xremote), then any Ear Scene is laid
// over them; its own mixes' levels aren't read, as it's about to set them.
let sceneTimer = null;
function onShowPosition(n) {
  if (!Number.isInteger(n) || n < -1 || n > P.SHOW_MAX) return;
  const first = !positionKnown;
  positionKnown = true;
  if (n === -1) return; // no scene loaded yet
  const key = String(n).padStart(2, '0');
  if (key === currentScene) return;
  currentScene = key;
  showPosition = n;
  const kind = showKind();
  logEvent('scene-change', `${kind} ${key}`);
  if (m32) m32.query(P.ADDR.showName(kind, n), true).then((name) => { if (typeof name === 'string' && name.trim()) logEvent('scene-name', `${kind} ${key} is "${name.trim()}"`); });
  broadcastToClients({ address: '/SnapshotName', args: [key] });
  if (first) return;
  clearTimeout(sceneTimer);
  sceneTimer = setTimeout(() => {
    if (currentScene !== key) return;
    const saved = serverCfg.sceneRecallEnabled ? scenes.getAll()[key] : null;
    for (let aux = 1; aux <= auxCount(); aux++) readSends(aux, { levels: !(saved && saved[String(aux)]) });
    applySceneByName(key);
  }, 300);
}

// ── What the console sends ────────────────────────────────────────────────
function sendLevelToPhones(ch, aux, db) { broadcastToClients({ address: `/Input_Channels/${ch}/Aux_Send/${aux}/send_level`, args: [db] }); }
function sendPanToPhones(ch, aux, slider) { broadcastToClients({ address: `/Input_Channels/${ch}/Aux_Send/${aux}/send_pan`, args: [slider] }); }

const PAGE = { input: '/Input_Channels', aux: '/Aux_Outputs', cg: '/Control_Groups' };
const pageFor = (strip, n) => `${PAGE[strip]}/${n}`;
function trackState(strip, n) {
  const key = `${strip}:${n}`;
  if (!tracks.has(key)) tracks.set(key, { gain: null, mute: false, solo: false });
  return tracks.get(key);
}
const stripShown = (strip, n) => (strip === 'input' ? n <= chCount() : strip === 'aux' ? n <= auxCount() : n <= P.DCAS);

function onConsoleMessage(msg) {
  const m = P.parseMessage(msg.address, msg.args);
  if (!m) return;
  switch (m.kind) {
    case 'send-level': {
      if (m.ch > chCount() || !isMix(m.bus)) return;
      const key = levelKey(m.ch, m.bus);
      if (justWritten(`lvl:${key}`)) return;
      if (levelCache.get(key) === m.db) return;
      levelCache.set(key, m.db);
      sendLevelToPhones(m.ch, m.bus, m.db);
      return;
    }
    case 'send-on':
      if (m.ch > chCount() || !isMix(m.bus)) return;
      noteDeskOn(m.ch, m.bus, m.on);
      return;
    case 'send-pan': {
      if (m.ch > chCount() || !isStereo(m.bus)) return;
      const key = levelKey(m.ch, m.bus);
      if (justWritten(`pan:${key}`)) return;
      if (panCache.get(key) === m.pan) return;
      panCache.set(key, m.pan);
      sendPanToPhones(m.ch, m.bus, m.pan);
      return;
    }
    case 'name': {
      if (names[m.strip].get(m.n) === m.name) return;
      names[m.strip].set(m.n, m.name);
      if (!stripShown(m.strip, m.n)) return;
      if (m.strip === 'input') {
        const label = serverCfg.channelOverrides?.[String(m.n)]?.label;
        broadcastToClients({ type: 'channel-relabeled', channel: m.n, label: label || m.name });
      } else if (m.strip === 'aux') {
        const label = serverCfg.auxOverrides?.[String(m.n)]?.label;
        broadcastToClients({ type: 'aux-relabeled', aux: m.n, label: label || m.name || `AUX ${m.n}` });
      } else {
        broadcastToClients({ address: `/Control_Groups/${m.n}/name`, args: [m.name || `DCA ${m.n}`] });
      }
      return;
    }
    case 'bus-link': {
      const i = m.pair - 1;
      if (busLinks[i] === m.linked) return;
      releasePair(m.pair);
      busLinks[i] = m.linked;
      logEvent('bus-link', `mix buses ${m.pair * 2 - 1}-${m.pair * 2} ${m.linked ? 'linked (one stereo mix)' : 'unlinked'}`);
      pushLayoutSoon();
      // A new stereo mix's pans; or the right half, now a mix of its own
      if (consoleConnected) {
        const odd = m.pair * 2 - 1;
        if (m.linked) readSends(odd, { levels: false, on: false });
        else if (odd + 1 <= auxCount()) { auxAsked.delete(odd + 1); auxRead.delete(odd + 1); readSends(odd + 1); }
      }
      return;
    }
    case 'strip': {
      if (!stripShown(m.strip, m.n)) return;
      const t = trackState(m.strip, m.n);
      if (m.what === 'fader') {
        if (justWritten(`trk:${m.strip}:${m.n}`)) return;
        t.gain = m.db;
        broadcastToClients({ address: `${pageFor(m.strip, m.n)}/fader`, args: [m.db] });
      } else {
        t.mute = m.muted;
        broadcastToClients({ address: `${pageFor(m.strip, m.n)}/mute`, args: [m.muted ? 1 : 0] });
      }
      return;
    }
    case 'solo': {
      if (m.strip === 'aux' || !stripShown(m.strip, m.n)) return; // the Console Controller has no mix solo
      trackState(m.strip, m.n).solo = m.on;
      broadcastToClients({ address: `${pageFor(m.strip, m.n)}/solo`, args: [m.on ? 1 : 0] });
      return;
    }
    case 'show-control':
      showControl = m.mode;
      return;
    case 'show-position':
      onShowPosition(m.n);
      return;
    case 'info': {
      const text = `${m.model || 'console'}${m.name ? ` "${m.name}"` : ''}${m.firmware ? `, firmware ${m.firmware}` : ''}`;
      if (text !== consoleInfo) { consoleInfo = text; logEvent('console-info', text); }
      return;
    }
    default:
  }
}

// ── Reading the console ───────────────────────────────────────────────────
// Everything JPMixer shows, asked for once it answers: names, links and the
// scene first, then the Console Controller's strips, then every mix's sends
// (the mixes phones have open first). /xremote keeps it all current after.
let readStartedAt = 0;
function readEverything() {
  if (!m32) return;
  const client = m32;
  const q = (a) => client.query(a);
  auxAsked.clear(); auxRead.clear();
  readStartedAt = Date.now();
  const unansweredBefore = client.unanswered;
  q(P.ADDR.showControl);
  q(P.ADDR.showPosition);
  const links = [];
  for (let pair = 1; pair <= P.BUSES / 2; pair++) links.push(q(P.ADDR.busLink(pair)));
  for (let ch = 1; ch <= chCount(); ch++) q(P.ADDR.inputName(ch));
  for (let aux = 1; aux <= auxCount(); aux++) q(P.ADDR.busName(aux));
  for (let dca = 1; dca <= P.DCAS; dca++) q(P.ADDR.dcaName(dca));
  for (const [strip, count] of [['input', chCount()], ['aux', auxCount()], ['cg', P.DCAS]]) {
    for (let n = 1; n <= count; n++) { q(P.ADDR.stripFader(strip, n)); q(P.ADDR.stripOn(strip, n)); }
  }
  for (let ch = 1; ch <= chCount(); ch++) q(P.ADDR.solo('input', ch));
  for (let dca = 1; dca <= P.DCAS; dca++) q(P.ADDR.solo('cg', dca));
  // The sends once the links are known, so a stereo mix's pans are asked for
  Promise.all(links).then(() => {
    if (m32 !== client) return;
    const open = new Set(connections.map(c => c._activeAux).filter(isMix));
    const order = [...open, ...Array.from({ length: auxCount() }, (_, i) => i + 1).filter(a => !open.has(a))];
    return Promise.all(order.map(aux => readSends(aux)));
  }).then(() => {
    if (m32 !== client) return;
    const missed = client.unanswered - unansweredBefore;
    logEvent('console-read', `read ${auxRead.size} mixes of ${chCount()} channels in ${((Date.now() - readStartedAt) / 1000).toFixed(1)} s${missed ? ` (${missed} values not answered)` : ''}`);
  });
}

// One mix's sends: level, on/off and (a stereo mix) pan for every channel
function sendAddresses(aux, { levels = true, on = true, pan = true } = {}) {
  const out = [];
  for (let ch = 1; ch <= chCount(); ch++) {
    if (levels) out.push(P.ADDR.sendLevel(ch, aux));
    if (on) out.push(P.ADDR.sendOn(ch, aux));
    if (pan && isStereo(aux)) out.push(P.ADDR.sendPan(ch, aux));
  }
  return out;
}
function readSends(aux, opts = {}, front = false) {
  if (!m32 || !isMix(aux)) return Promise.resolve();
  const client = m32;
  auxAsked.add(aux);
  const addresses = sendAddresses(aux, opts);
  const asked = (front ? addresses.slice().reverse() : addresses).map(a => client.query(a, front));
  return Promise.all(asked).then(() => { if (m32 === client && opts.levels !== false) auxRead.add(aux); });
}
// A phone opening a mix: its sends go ahead of everything else being read
function readMixFirst(aux) {
  if (!m32 || !isMix(aux) || auxRead.has(aux)) return;
  if (!auxAsked.has(aux)) readSends(aux, {}, true);
  else m32.promote(sendAddresses(aux));
}

// ── Console Controller ────────────────────────────────────────────────────
function sendConsoleState(ws) {
  const out = [];
  for (const [strip, count, withSolo] of [['input', chCount(), true], ['aux', auxCount(), false], ['cg', P.DCAS, true]]) {
    for (let n = 1; n <= count; n++) {
      const t = tracks.get(`${strip}:${n}`); if (!t) continue;
      const base = pageFor(strip, n);
      if (Number.isFinite(t.gain)) out.push({ address: `${base}/fader`, args: [t.gain] });
      out.push({ address: `${base}/mute`, args: [t.mute ? 1 : 0] });
      if (withSolo) out.push({ address: `${base}/solo`, args: [t.solo ? 1 : 0] });
    }
  }
  for (const m of out) { try { ws.send(JSON.stringify(m)); } catch (_) {} }
}

// A Console Controller move: to the console, and to the other pages showing it
function consoleWrite(ws, strip, numRaw, kind, value) {
  const n = parseInt(numRaw, 10);
  if (!m32 || !Number.isInteger(n) || n < 1 || !stripShown(strip, n)) return false;
  const t = trackState(strip, n), base = pageFor(strip, n);
  if (kind === 'fader') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    const level = P.dbToLevel(value);
    t.gain = P.levelToDb(level);
    noteWrite(`trk:${strip}:${n}`);
    m32.send(() => P.stripFader(strip, n, level));
    broadcastToClients({ address: `${base}/fader`, args: [t.gain] }, ws);
  } else if (kind === 'mute') {
    t.mute = !!value;
    m32.send(() => P.stripOn(strip, n, !t.mute));
    broadcastToClients({ address: `${base}/mute`, args: [t.mute ? 1 : 0] }, ws);
  } else if (kind === 'solo') {
    if (strip === 'aux') return false;
    t.solo = !!value;
    m32.send(() => P.solo(strip, n, t.solo));
    broadcastToClients({ address: `${base}/solo`, args: [t.solo ? 1 : 0] }, ws);
  } else return false;
  return true;
}

// Channel and DCA faders and mutes for plugins (plugins.js "faders"): what
// the Console Controller shows, moved the way it moves them. kind 'ch' | 'cg';
// a level is dB, -150 off. Read when the console connects, so nothing to ask for.
const STRIP_KIND = { ch: 'input', cg: 'cg' };
function getStrips() {
  const out = { ch: {}, cg: {} };
  for (const [kind, count] of [['ch', chCount()], ['cg', P.DCAS]]) {
    for (let n = 1; n <= count; n++) {
      const t = tracks.get(`${STRIP_KIND[kind]}:${n}`); if (!t) continue;
      out[kind][n] = { db: Number.isFinite(t.gain) ? t.gain : null, mute: !!t.mute };
    }
  }
  return out;
}
function primeStrips() {}
function setStrip(kind, nRaw, what, value) {
  if (!STRIP_KIND[kind] || (what !== 'fader' && what !== 'mute')) return false;
  return consoleWrite(null, STRIP_KIND[kind], nRaw, what, value);
}

// ── Server lifecycle ────────────────────────────────────────────────────
function resetState() {
  consoleConnected = false;
  consoleInfo = '';
  currentScene = null; showPosition = null; showControl = null; positionKnown = false; lastLoggedPosition = null;
  for (const map of Object.values(names)) map.clear();
  busLinks.fill(false);
  tracks.clear();
  levelCache.clear(); panCache.clear(); onCache.clear();
  silencedSends.clear(); recentReleases.clear(); recentWrites.clear(); queuedWrites.clear();
  auxAsked.clear(); auxRead.clear();
  pacer.clear();
  Object.keys(muteState).forEach(k => delete muteState[k]);
  Object.keys(soloState).forEach(k => delete soloState[k]);
}

function start(cfg) {
  serverCfg = cfg;
  connections = [];
  resetState();

  oscLogFlushTimer = setInterval(() => {
    if (!oscLogBatch.length) return;
    const batch = oscLogBatch;
    oscLogBatch = [];
    if (onOscTraffic) onOscTraffic(batch);
  }, 150);

  const appExpress = express();
  access.mountOneTimeLinks(appExpress); // a browser opened from Settings: this computer's pass
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
  httpServer.listen(cfg.serverPort, () => console.log(`[JPMixer/M32] Web server → http://localhost:${cfg.serverPort}`));

  wss = new WebSocket.Server({ server: httpServer, maxPayload: shared.MAX_PAYLOAD });
  pingInterval = setInterval(() => {
    const now = Date.now();
    for (const conn of connections) {
      if (now - conn._lastPong > 75000) { logEvent('ping-timeout', 'terminating stale client'); conn.terminate(); continue; }
      try { conn.ping(); } catch (_) {}
      try { conn.send(JSON.stringify({ type: 'ping' })); } catch (_) {}
    }
    broadcastDevicesUpdate();
  }, 25000);

  wss.on('connection', (ws, req) => {
    access.noteSocket(ws, req);
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
      // The Console Controller's messages need its code (Settings → Pages)
      if (!access.consoleMessageAllowed(ws, msg)) return;

      if (msg.type === 'request-aux-levels') {
        readMixFirst(parseInt(msg.aux, 10)); // not read yet: its answers reach every phone
        for (let ch = 1; ch <= chCount(); ch++) {
          const key = levelKey(ch, msg.aux);
          if (levelCache.has(key)) ws.send(JSON.stringify({ address: `/Input_Channels/${ch}/Aux_Send/${msg.aux}/send_level`, args: [levelCache.get(key)] }));
          if (panCache.has(key)) ws.send(JSON.stringify({ address: `/Input_Channels/${ch}/Aux_Send/${msg.aux}/send_pan`, args: [panCache.get(key)] }));
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
        const key = (typeof msg.snapshot === 'string' && msg.snapshot) ? msg.snapshot : currentScene;
        if (!key) return;
        if (!scenes.saveScene(key, msg.aux, msg.values)) return; // not a mix number, or no fader values
        logEvent('scene-save', `scene ${key} aux:${msg.aux}`);
        broadcastToClients({ type: 'scene-saved', snapshot: key, aux: msg.aux });
        ws._lastActivityAt = Date.now();
        shared.broadcastActivity(connections, { type: 'device-activity', deviceId: ws._deviceId || null, aux: msg.aux, kind: 'save-scene', snapshot: key }, ws);
        return;
      }
      if (msg.type === 'delete-scene') {
        const key = (typeof msg.snapshot === 'string' && msg.snapshot) ? msg.snapshot : currentScene;
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
        if (!currentScene) return;
        const saved = scenes.getScene(currentScene, msg.aux);
        if (!saved) return;
        const levels = pushSceneValues(String(msg.aux), saved);
        broadcastToClients({ type: 'scene-recalled', snapshot: currentScene, levels: { [String(msg.aux)]: levels } });
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

      // My Mixes storage/sync, Find My Mixes and the activity feed — see shared-handlers.js
      if (shared.handleSharedMessage(ws, msg, { logEvent, onActivity: (m, from) => shared.broadcastActivity(connections, m, from) })) return;

      if (msg.type === 'apply-preset') {
        const aux = parseInt(msg.aux, 10);
        const outLevels = {}, outPans = {};
        if (isMix(aux)) {
          Object.assign(outLevels, pushSceneValues(String(aux), shared.plainMap(msg.levels)));
          for (const [chStr, panVal] of Object.entries(shared.plainMap(msg.pans))) {
            const ch = parseInt(chStr, 10);
            if (!Number.isInteger(ch) || ch < 1 || ch > chCount() || !Number.isFinite(panVal) || panVal < 0 || panVal > 1 || !shared.channelOnMix(serverCfg, aux, ch)) continue;
            if (writePan(ch, aux, panVal, true)) outPans[chStr] = panVal;
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
      if (msg.type === 'fire-snapshot') { fireSnapshot(msg.action); return; }

      // Console Controller
      if (msg.type === 'request-console-state') { sendConsoleState(ws); return; }
      if (msg.type === 'console-fader') { consoleWrite(ws, 'input', msg.ch, 'fader', msg.db); return; }
      if (msg.type === 'console-mute')  { consoleWrite(ws, 'input', msg.ch, 'mute', msg.muted); return; }
      if (msg.type === 'console-solo')  { consoleWrite(ws, 'input', msg.ch, 'solo', msg.soloed); return; }
      if (msg.type === 'aux-fader')     { consoleWrite(ws, 'aux', msg.aux, 'fader', msg.db); return; }
      if (msg.type === 'aux-mute')      { consoleWrite(ws, 'aux', msg.aux, 'mute', msg.muted); return; }
      if (msg.type === 'cg-fader')      { consoleWrite(ws, 'cg', msg.cg, 'fader', msg.db); return; }
      if (msg.type === 'cg-mute')       { consoleWrite(ws, 'cg', msg.cg, 'mute', msg.muted); return; }
      if (msg.type === 'cg-solo')       { consoleWrite(ws, 'cg', msg.cg, 'solo', msg.soloed); return; }
      if (msg.type === 'request-channel-detail') {
        // Always answered, so a panel never waits
        try { ws.send(JSON.stringify({ type: 'channel-detail', ch: msg.ch, params: {}, values: {}, readOnly: true, note: 'The M32’s channel processing isn’t available in JPMixer yet.' })); } catch (_) {}
        return;
      }
      if (msg.type === 'close-channel-detail' || msg.type === 'console-param') return;

      // Raw OSC-address-shaped messages from mixer.js (send_level / send_pan,
      // and the same addresses ending /? when a phone picks a mix)
      if (typeof msg.address !== 'string') return;
      const m = msg.address.match(/^\/Input_Channels\/(\d+)\/Aux_Send\/(\d+)\/send_(level|pan)(\/\?)?$/);
      if (!m) return;
      const ch = parseInt(m[1], 10), aux = parseInt(m[2], 10), kind = m[3];
      if (!validPair(aux, ch)) return;
      const key = levelKey(ch, aux);
      if (m[4]) {
        const cache = kind === 'pan' ? panCache : levelCache;
        if (cache.has(key)) { try { ws.send(JSON.stringify({ address: `/Input_Channels/${ch}/Aux_Send/${aux}/send_${kind}`, args: [cache.get(key)] })); } catch (_) {} }
        else readMixFirst(aux);
        return;
      }
      const rawVal = Array.isArray(msg.args) ? msg.args[0] : undefined;
      if (typeof rawVal !== 'number' || !Number.isFinite(rawVal)) return;

      if (kind === 'pan') {
        const val = Math.max(0, Math.min(1, rawVal));
        if (!writePan(ch, aux, val, false)) return; // a mono mix has no pan
        broadcastToClients({ address: msg.address, args: [val] }, ws);
        ws._lastActivityAt = Date.now();
        shared.broadcastActivity(connections, { type: 'device-activity', deviceId: ws._deviceId || null, aux, channel: ch, kind: 'pan', direction: val < 0.5 ? 'left' : val > 0.5 ? 'right' : null }, ws);
        return;
      }

      const val = Math.max(-150, Math.min(10, rawVal));
      const prevDb = levelCache.get(key);
      writeLevel(ch, aux, val, false);
      broadcastToClients({ address: msg.address, args: [val] }, ws);
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

  // ── The console ───────────────────────────────────────────────────────
  const host = (cfg.deskIp || '').trim();
  if (!host) logEvent('console-error', 'Console IP Address is not set on the Console tab — nothing to connect to.');
  const port = Number.isInteger(cfg.m32Port) && cfg.m32Port > 0 && cfg.m32Port <= 65535 ? cfg.m32Port : P.PORT;
  const client = new M32Client({ host, port, onTraffic: logOscTraffic });
  m32 = client;
  client.on('open', () => { if (m32 === client) logEvent('m32-open', `sending to ${host}:${port}`); });
  client.on('connected', () => {
    if (m32 !== client) return;
    consoleConnected = true;
    logEvent('console-connect', `${host}:${port}`);
    if (onConsoleStatusChange) onConsoleStatusChange(true);
    // Back after a drop: a console that restarted has every send on again
    // while phones still show their mutes. Switch the silenced ones back off.
    // (Only those known to have been on: one still waiting to be asked is
    // switched off when its answer comes. Switching it off now made the
    // console report the off JPMixer wrote, taken as the engineer's, so the
    // release left it off.)
    for (const [key, entry] of silencedSends) {
      if (entry.wasOn !== true) continue;
      const [ch, aux] = key.split(':').map(Number);
      queueSendOn(ch, aux, false);
    }
    // And mutes/solos released while it couldn't be reached, or just before
    for (const [key, at] of recentReleases) {
      if ((at !== KEPT && Date.now() - at >= RELEASE_RESEND_MS) || silencedSends.has(key)) continue;
      const [ch, aux] = key.split(':').map(Number);
      queueSendOn(ch, aux, true);
    }
    recentReleases.clear();
    readEverything();
  });
  client.on('disconnected', () => {
    if (m32 !== client) return;
    // Releases sent in the moments before the drop was noticed may not have
    // arrived: kept until it's back, however long that takes
    for (const [key, at] of [...recentReleases]) {
      if (at === KEPT || Date.now() - at < RELEASE_RESEND_MS) recentReleases.set(key, KEPT);
      else recentReleases.delete(key);
    }
    consoleConnected = false;
    logEvent('console-error', 'no reply from the console — check its IP address and that it is switched on');
    if (onConsoleStatusChange) onConsoleStatusChange(false);
  });
  client.on('message', (msg) => { if (m32 === client) onConsoleMessage(msg); });
  client.on('error', (err) => { if (m32 === client) logEvent('m32-error', err.message || err.code || String(err)); });
  // The scene the console is on, every second (in case /xremote doesn't report a recall)
  sceneCheck = setInterval(() => { if (m32 === client && consoleConnected) client.ask(P.ADDR.showPosition); }, 1000);
  if (host) client.connect();
}

function stop() {
  if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
  clearInterval(sceneCheck); sceneCheck = null;
  clearTimeout(layoutTimer); layoutTimer = null;
  clearTimeout(sceneTimer); sceneTimer = null;
  clearInterval(oscLogFlushTimer); oscLogFlushTimer = null;
  oscLogBatch = [];
  pacer.flush(); // queued writes are the state people asked for
  // Turn back on every send a mute/solo switched off. start() forgets this
  // state, so leaving them off would strand channels silent.
  for (const [key, entry] of silencedSends) {
    if (!entry.wasOn) continue;
    const [ch, aux] = key.split(':').map(Number);
    writeSendOn(ch, aux, true);
  }
  silencedSends.clear();
  // Close on the next turn: UDP sends queued in this tick are dropped if the
  // socket closes now (see osc-server.js's stop())
  let closed = Promise.resolve();
  if (m32) {
    const closing = m32;
    m32 = null;
    closing.removeAllListeners();
    closing.on('error', () => {});
    closed = new Promise((resolve) => setImmediate(() => { closing.disconnect(); resolve(); }));
  }
  if (wss) { for (const c of wss.clients) { try { c.terminate(); } catch (_) {} } wss.close(); wss = null; }
  if (httpServer) { httpServer.close(); httpServer = null; }
  consoleConnected = false;
  if (onConsoleStatusChange) onConsoleStatusChange(false);
  levelCache.clear(); panCache.clear(); pacer.clear(); queuedWrites.clear();
  connections = [];
  console.log('[JPMixer/M32] Server stopped');
  return closed;
}

function namesOf(map) {
  const out = {};
  for (const [n, name] of map) if (name) out[String(n)] = name;
  return out;
}
function getChannelNames() { return namesOf(names.input); }
// Settings lists every mix bus: the right half of a stereo mix says what it is
function getAuxNames() {
  const out = namesOf(names.aux);
  for (let aux = 2; aux <= auxCount(); aux += 2) if (isRightHalf(aux)) out[String(aux)] = `Linked to mix ${aux - 1}`;
  return out;
}
// Save & Apply for settings that don't need a reconnect. Everything reads
// serverCfg when it runs, so swapping it in and re-sending the layout is enough.
function applyConfigLive(cfg) {
  serverCfg = cfg;
  logEvent('config-live', `pushed to ${connections.length} clients`);
  if (wss) broadcastToClients(buildConfig({ liveUpdate: true }));
}
// The console's own counts are fixed (Settings' counts choose how many are used)
function getChannelCount() { return null; }
function getAuxCount() { return null; }

function isConsoleConnected() { return consoleConnected; }
function setConsoleStatusCallback(cb) { onConsoleStatusChange = cb; }
function setConnectionCountCallback(cb) { onConnectionCountChange = cb; }
function getConnectionCount() { return connections.length; }
function setServerErrorCallback(cb) { onServerError = cb; }
function getOscLog() { return oscLog; }
function setOscTrafficCallback(cb) { onOscTraffic = cb; }
function getEventLog() { return eventLog.slice(); }

// After Settings merges device groups — see shared-handlers.js
function pushDevicePresets(deviceId) { shared.pushDevicePresets(connections, deviceId); }

module.exports = { getConnectedDevicesInfo, pushDevicePresets, getControlGroups, getEventLog,
  start, stop, applyConfigLive, getChannelNames, getAuxNames, getChannelCount, getAuxCount,
  isConsoleConnected, setConsoleStatusCallback, setConnectionCountCallback, getConnectionCount,
  setServerErrorCallback, getOscLog, setOscTrafficCallback,
  startOscLogRecording, stopOscLogRecording, getOscLogRecordingStatus, oscLogRecordsFolder,
  fireSnapshot, setMute: sendMute, setSolo: sendSolo, setChannelLabel, setAuxLabel, getStrips, primeStrips, setStrip,
  _setReleaseResendMs: (ms) => { RELEASE_RESEND_MS = ms; }, // tests: an outage longer than the window
};
