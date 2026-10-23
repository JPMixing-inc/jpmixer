'use strict';

// ── Waves eMotion LV1 server — a fifth, independent backend ────────────────
// Speaks the same browser-facing WebSocket dialect as osc-server.js and the
// dLive/KLANG/WING backends, so mixer.js, monitor.js and devices.js work
// unmodified. Never imported by, and never imports, the other backends.
//
// LV1 is reached through its MyMon remote service (see lv1-protocol.js),
// which is what Waves' own MyMon/MyFOH apps use. The engineer switches that
// remote on in LV1; JPMixer then joins as one more remote device.
//
// UNLIKE WING: LV1 tells JPMixer everything —
//   - channel and mix names, and the real channel/mix counts, from the show
//     (Settings labels still win over them)
//   - every send level, on/off and pan, on connect and whenever it changes
//     anywhere, so phones follow changes made on LV1 itself
//   - the current scene, so Ear Scenes work, keyed by scene name as DiGiCo's are
//
// SCOPE:
//   ✓ Per-send level, pan, real per-send on/off for mute and solo, My Mixes,
//     Ear Scenes, Devices View, live names
//   ✓ Console Controller: input, aux and DCA (control group) faders and
//     mutes, input and DCA solo (LV1's own cue solo)
//   ✓ Scene ‹ › from the Console Controller / Monitor Engineer (/Scene/Recall)
//   ✗ Built-in aux EQ, the channel processing panel, traffic log
//
// Mute/solo switch sends off with LV1's per-send on/off rather than pulling
// the level down, so a level is never lost. A send the engineer had already
// switched off stays off when the mute or solo is released.

const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');
const os        = require('os');
const crypto    = require('crypto');
const scenes    = require('./scenes');
const presets   = require('./presets');
const shared    = require('./shared-handlers');
const config    = require('./config');
const { mountGreenRoom } = require('./greenroom');
const { mountBranding } = require('./branding');
const { mountPerformerAssignments } = require('./performer-assignments');
const { mountFoh } = require('./foh');
const P = require('./lv1-protocol');
const { Lv1Client } = require('./lv1-client');
const discovery = require('./lv1-discovery');
const fs        = require('fs');
const { app }   = require('electron');
// Where LV1 was last found (see lv1-discovery.js remember())
const lastFoundFile = () => path.join(app.getPath('userData'), 'lv1-last-found.json');
function loadLastFound() {
  try {
    for (const [wanted, t] of Object.entries(JSON.parse(fs.readFileSync(lastFoundFile(), 'utf8')))) {
      if (t && typeof t.host === 'string' && Number.isInteger(t.port)) discovery.remember(wanted, { host: t.host, port: t.port });
    }
  } catch (_) {}
}
function saveLastFound() {
  try { fs.writeFileSync(lastFoundFile(), JSON.stringify(discovery.remembered())); } catch (_) {}
}
const { createPacedWriter } = require('./paced-writer');
// Presets, Ear Scenes and mute/solo go through this; a musician's own
// fader/pan move goes straight out.
const pacer = createPacedWriter();

let httpServer = null;
let wss        = null;
let lv1        = null;
let serverCfg  = {};
let connections = [];
let pingInterval = null;

let onConsoleStatusChange = null;
let onConnectionCountChange = null;
let onServerError = null;
let onOscTraffic = null; // accepted for interface parity, never fired — no traffic log for LV1

const eventLog = [];
function logEvent(type, detail) {
  eventLog.push({ t: new Date().toISOString(), type, detail });
  if (eventLog.length > 100) eventLog.shift();
  console.log(`[JPMixer/LV1] ${type}: ${detail}`);
}

// ── State ────────────────────────────────────────────────────────────────
let consoleConnected = false;
let currentScene = null;        // LV1 scene name, the Ear Scene key
let sceneList = [];             // [{ index, name }] in LV1's order
let sceneIndex = null;          // LV1's current scene (an index into sceneList)
const inputNames = new Map();   // channel (1-based) -> name from LV1
// Every track's own fader/mute/solo, for the Console Controller:
// "type:n" (n from 1) -> { gain, mute, solo }
const tracks = new Map();
let dcas = [];                  // DCA names by number - 1 (JPMixer's control groups)
// The Console Controller's addresses for each LV1 track type it shows
// LV1's mixes in its own order: JPMixer's aux N is the Nth, and that
// position is how LV1 addresses its sends. Each is an aux bus or a
// monitor mix track: { name, kind (track type), index (that type's own) }
const mixes      = [];
let inputCount   = 0;           // input channels in the LV1 show
const levelCache = new Map();   // "ch:aux" -> dB
const panCache   = new Map();   // "ch:aux" -> 0..1
const onCache    = new Map();   // "ch:aux" -> LV1's per-send on/off
const muteState  = {};          // muteState[aux][ch]
const soloState  = {};          // soloState[aux][ch]
// Sends JPMixer has switched off for a mute/solo: key -> { wasOn, levelHeld }.
// wasOn false = it was already off, so a release leaves it off.
// levelHeld = a level change waiting for the release. LV1 switches a send
// back on by itself when its level is raised from -inf, so a level written
// while muted would unmute it (and JPMixer switching it off again made the
// send flicker on LV1). It's kept here and written on release instead.
const silencedSends = new Map();
// Released mutes/solos LV1 hasn't been sent yet (it was unreachable at the
// time): key -> the silencedSends entry. Written on reconnect.
const pendingReleases = new Map();
// What JPMixer wrote in the last moment, so LV1's confirmations of those
// writes aren't sent back to phones: key -> [{ value, at }]. All of them,
// not just the last: during a drag LV1 confirms earlier values after
// newer ones went out, and passing those on put faders back where they'd been.
const recentWrites = new Map();

const levelKey = (ch, aux) => `${ch}:${aux}`;
// LV1 reports its own counts once connected; Settings' are the fallback
const chCount  = () => inputCount || serverCfg.channels || 16;
const auxCount = () => mixes.length || serverCfg.auxes || 8;

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

// ── Config builder — same shape the other backends produce ───────────────
function buildConfig(extra = {}) {
  const cfgAuxOverrides = serverCfg.auxOverrides || {};
  const auxilaries = [];
  for (let i = 1; i <= auxCount(); i++) {
    const ov = cfgAuxOverrides[String(i)] || {};
    auxilaries.push({
      enabled:   ov.enabled !== false,
      label:     ov.label || shared.consoleNameOr(serverCfg, 'auxes', i, mixes[i - 1]?.name) || `AUX ${i}`,
      channel:   i,
      stereo:    mixStereo(i), // a mono mix's sends have no pan
      colour:    ov.colour || '#e8a020',
      icon:      '',
      eqEnabled: false, // aux EQ isn't implemented for LV1
      linkOnly:  ov.linkOnly === true,
      groups:    shared.auxGroupNames(ov, serverCfg),
    });
  }
  return JSON.stringify({
    config: {
      channels: shared.buildChannelList(chCount(), serverCfg, i => inputNames.get(i)),
      aux: auxilaries,
      controlGroups: dcas.map((name, i) => ({ channel: i + 1, label: name || `DCA ${i + 1}` })),
      channelProcessing: false, // the Console Controller's EQ/dynamics panel is DiGiCo-only
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

// Names and counts arrive together on connect and can change with the show;
// phones get one refreshed layout once they settle
let layoutTimer = null;
function pushLayoutSoon() {
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => { if (wss) broadcastToClients(buildConfig({ liveUpdate: true })); }, 250);
}

// ── Mute / solo ──────────────────────────────────────────────────────────
function applyMuteSolo(aux) {
  broadcastToClients({ type: 'mute-solo-state', aux, mutes: muteState[aux] || {}, solos: soloState[aux] || {}, levels: {} });
}

function validPair(auxRaw, chRaw) {
  const aux = parseInt(auxRaw, 10), ch = parseInt(chRaw, 10);
  if (!Number.isInteger(aux) || aux < 1 || aux > auxCount() || !Number.isInteger(ch) || ch < 1 || ch > chCount()) return null;
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

// Re-derives every channel's send on/off in this mix from mute/solo. LV1
// reports each send's on/off, so (unlike WING) there's nothing to ask first.
function applySilencing(aux) {
  const anySolo = Object.values(soloState[aux] || {}).some(Boolean);
  for (let ch = 1; ch <= chCount(); ch++) {
    const key = levelKey(ch, aux);
    const silenced = !!muteState[aux]?.[ch] || (anySolo && !soloState[aux]?.[ch]);
    const entry = silencedSends.get(key);
    if (silenced && !entry) {
      const pending = pendingReleases.get(key);
      if (pending) {
        // Muted again before the release reached LV1: it's still off there
        pendingReleases.delete(key); pacer.cancel(`rel:${key}`);
        silencedSends.set(key, pending);
        continue;
      }
      const wasOn = onCache.get(key) !== false;
      silencedSends.set(key, { wasOn });
      if (wasOn) pacer.write(`on:${key}`, () => lv1 && lv1.setSendOn(ch, aux, false), true);
    } else if (!silenced && entry) {
      silencedSends.delete(key);
      pendingReleases.set(key, entry);
      pacer.write(`rel:${key}`, () => flushRelease(key), true);
    }
  }
}

// A release: the send back on (unless the engineer had it off) and any level
// held while it was off. Kept for the reconnect if LV1 can't be reached.
// A held level raised from -inf switches the send on in LV1 by itself even
// when it was off before; that's what the same fader move would have done
// unmuted.
function flushRelease(key) {
  const entry = pendingReleases.get(key);
  if (!entry || !lv1 || !lv1.connected) return;
  const [ch, aux] = key.split(':').map(Number);
  let sent = true;
  if (entry.wasOn) sent = lv1.setSendOn(ch, aux, true) && sent;
  if (entry.levelHeld && levelCache.has(key)) {
    const db = levelCache.get(key);
    noteWrite(`lvl:${key}`, P.clampLevel(db));
    sent = lv1.setSendLevel(ch, aux, db) && sent;
  }
  if (sent) pendingReleases.delete(key);
}

// A send level from a phone, preset or Ear Scene: straight to LV1 (or
// paced, for a batch), or held while a mute/solo has the send switched off
function writeLevel(ch, aux, db, paced) {
  const key = levelKey(ch, aux);
  levelCache.set(key, db);
  pacer.cancel(`lvl:${ch}:${aux}`); // this supersedes a queued write
  const entry = silencedSends.get(key);
  if (entry) { entry.levelHeld = true; return; }
  noteWrite(`lvl:${key}`, P.clampLevel(db));
  if (paced) pacer.write(`lvl:${ch}:${aux}`, () => lv1 && lv1.setSendLevel(ch, aux, db));
  else if (lv1) lv1.setSendLevel(ch, aux, db);
}

// The Console Controller's and Monitor Engineer's ‹ › scene buttons: LV1's
// previous or next scene in its list
function fireSnapshot(action) {
  if (!lv1 || !lv1.connected || !sceneList.length) return false;
  const pos = sceneList.findIndex(s => s.index === sceneIndex);
  const next = pos === -1 ? (action === 'next' ? 0 : sceneList.length - 1) : pos + (action === 'next' ? 1 : -1);
  if (next < 0 || next >= sceneList.length) return false;
  logEvent('scene-fire', `${action} → "${sceneList[next].name}"`);
  return lv1.recallScene(sceneList[next].index);
}

// Live relabeling (Control API / Planning Center) — see shared-handlers.js
function setChannelLabel(n, label) { return shared.relabel(serverCfg, 'channel', n, label, chCount(), broadcastToClients); }
function setAuxLabel(n, label) { return shared.relabel(serverCfg, 'aux', n, label, auxCount(), broadcastToClients); }

// ── Ear Scenes — keyed by LV1 scene name ─────────────────────────────────
function pushSceneValues(auxStr, values) {
  const levels = {};
  const aux = parseInt(auxStr, 10);
  if (!Number.isInteger(aux) || aux < 1 || aux > auxCount()) return levels;
  for (const [chStr, sliderVal] of Object.entries(values || {})) {
    const ch = parseInt(chStr, 10);
    // Recall/preset payloads come from clients: skip anything that isn't a real slider position
    if (!Number.isInteger(ch) || ch < 1 || ch > chCount() || !Number.isFinite(sliderVal) || sliderVal < 0 || sliderVal > 1) continue;
    levels[chStr] = sliderVal;
    writeLevel(ch, aux, shared.sliderToDb(sliderVal), true);
  }
  return levels;
}
function applySceneByName(name) {
  if (!serverCfg.sceneRecallEnabled) { logEvent('scene-skip', `auto-recall disabled — scene:"${name}"`); return; }
  const saved = scenes.getAll()[name];
  if (!saved) { logEvent('scene-skip', `no Ear Scene saved for "${name}"`); return; }
  logEvent('scene-recall', `applying "${name}"`);
  const broadcastLevels = {};
  for (const [auxStr, values] of Object.entries(saved)) broadcastLevels[auxStr] = pushSceneValues(auxStr, values);
  broadcastToClients({ type: 'scene-recalled', snapshot: name, levels: broadcastLevels });
}

// ── What LV1 sends ────────────────────────────────────────────────────────
// A performer's level waiting for a mute/solo release wins over LV1's
const heldLevel = (ch, aux) => !!silencedSends.get(levelKey(ch, aux))?.levelHeld;
const ECHO_MS = 1500;
function noteWrite(key, value) {
  const now = Date.now();
  const list = (recentWrites.get(key) || []).filter(w => now - w.at < ECHO_MS);
  list.push({ value, at: now });
  recentWrites.set(key, list.slice(-60));
}
// LV1 confirming one of JPMixer's own recent writes. LV1 reports levels to
// 0.1 dB, so a write of -20.04 comes back as -20.0.
function isEcho(key, value) {
  const now = Date.now();
  return (recentWrites.get(key) || []).some(w => now - w.at < ECHO_MS && Math.abs(w.value - value) < 0.06);
}
function sendLevelToPhones(ch, aux, db) { broadcastToClients({ address: `/Input_Channels/${ch}/Aux_Send/${aux}/send_level`, args: [db] }); }
function sendPanToPhones(ch, aux, slider) { broadcastToClients({ address: `/Input_Channels/${ch}/Aux_Send/${aux}/send_pan`, args: [slider] }); }

// A phone asking for one send (it asks for every channel when it picks a
// mix). Answered from what LV1 last reported; a mix not read yet is asked
// for, and LV1's answer goes to every phone.
function answerQuery(ws, ch, aux, kind) {
  const key = levelKey(ch, aux);
  const cache = kind === 'pan' ? panCache : levelCache;
  if (cache.has(key)) {
    try { ws.send(JSON.stringify({ address: `/Input_Channels/${ch}/Aux_Send/${aux}/send_${kind}`, args: [cache.get(key)] })); } catch (_) {}
  } else {
    pacer.write(`get:${aux}`, () => lv1 && lv1.getSends(aux));
  }
}

function requestAllSends() {
  for (let aux = 1; aux <= auxCount(); aux++) {
    const a = aux;
    pacer.write(`get:${a}`, () => lv1 && lv1.getSends(a));
  }
}

function onLv1Message(m) {
  const a = m.args;
  switch (m.address) {
    case '/Channels': {
      const all = P.parseChannels(a);
      const inputs = all.filter(t => t.type === P.TRACK.INPUT);
      inputNames.clear();
      for (const t of inputs) inputNames.set(t.index + 1, t.name);
      inputCount = inputs.length;
      tracks.clear();
      for (const t of all) tracks.set(`${t.type}:${t.index + 1}`, { gain: t.gain, mute: t.mute, solo: false, stereo: t.stereo });
      dcas = [];
      for (const t of all) if (t.type === P.TRACK.DCA) dcas[t.index] = t.name;
      for (let i = 0; i < dcas.length; i++) if (dcas[i] === undefined) dcas[i] = '';
      pushLayoutSoon();
      return;
    }
    case '/Aux/Tracks': {
      const list = P.parseAuxTracks(a);
      mixes.length = 0;
      for (const mix of list) mixes.push({ name: mix.name, kind: mix.kind, index: mix.index });
      pushLayoutSoon();
      requestAllSends();
      return;
    }
    case '/Notify/Track/Name': {
      const [type, index, name] = a;
      if (typeof name !== 'string') return;
      if (type === P.TRACK.INPUT) {
        const ch = index + 1;
        inputNames.set(ch, name);
        const label = serverCfg.channelOverrides?.[String(ch)]?.label;
        broadcastToClients({ type: 'channel-relabeled', channel: ch, label: label || name });
      } else if (type === P.TRACK.DCA) {
        for (let i = dcas.length; i < index; i++) dcas[i] = '';
        dcas[index] = name;
        broadcastToClients({ address: `/Control_Groups/${index + 1}/name`, args: [name] });
      } else {
        const aux = auxForTrack(type, index + 1);
        if (!aux) return;
        mixes[aux - 1].name = name;
        const label = serverCfg.auxOverrides?.[String(aux)]?.label;
        broadcastToClients({ type: 'aux-relabeled', aux, label: label || name });
      }
      return;
    }
    case '/Notify/Sends': {
      const { mix, sends } = P.parseSends(a);
      const aux = mix + 1;
      for (const s of sends) {
        if (s.srcType !== P.TRACK.INPUT || !Number.isFinite(s.value)) continue;
        const ch = s.src + 1;
        if (heldLevel(ch, aux)) continue;
        levelCache.set(levelKey(ch, aux), s.value);
        sendLevelToPhones(ch, aux, s.value);
      }
      return;
    }
    case '/Notify/Sends/On': {
      const { mix, sends } = P.parseSends(a);
      for (const s of sends) if (s.srcType === P.TRACK.INPUT) noteDeskOn(s.src + 1, mix + 1, s.value === true);
      return;
    }
    case '/Notify/Sends/Pan': {
      const { mix, sends } = P.parseSends(a, 4);
      const aux = mix + 1;
      for (const s of sends) {
        if (s.srcType !== P.TRACK.INPUT || !Number.isFinite(s.value)) continue;
        const slider = P.panToSlider(s.value);
        panCache.set(levelKey(s.src + 1, aux), slider);
        sendPanToPhones(s.src + 1, aux, slider);
      }
      return;
    }
    case '/Notify/Aux/Send/Gain': {
      const [srcType, src, mix, db] = a;
      if (srcType !== P.TRACK.INPUT || !Number.isFinite(db)) return;
      const ch = src + 1, aux = mix + 1, key = levelKey(ch, aux);
      if (heldLevel(ch, aux)) return;
      levelCache.set(key, db);
      if (!isEcho(`lvl:${key}`, db)) sendLevelToPhones(ch, aux, db);
      return;
    }
    case '/Notify/Aux/Send/Pan': {
      const [srcType, src, mix, pan] = a;
      if (srcType !== P.TRACK.INPUT || !Number.isFinite(pan)) return;
      const ch = src + 1, aux = mix + 1, key = levelKey(ch, aux), slider = P.panToSlider(pan);
      panCache.set(key, slider);
      if (!isEcho(`pan:${key}`, pan)) sendPanToPhones(ch, aux, slider);
      return;
    }
    case '/Notify/Aux/Send/On': {
      const [srcType, src, mix, on] = a;
      if (srcType === P.TRACK.INPUT) noteDeskOn(src + 1, mix + 1, on === true);
      return;
    }
    case '/Notify/Track/Out/Gain': {
      const [type, index, db] = a;
      if (!Number.isInteger(type) || !Number.isInteger(index) || !Number.isFinite(db)) return;
      const t = trackState(type, index + 1); t.gain = db;
      const page = pageFor(type, index + 1);
      if (page && !isEcho(`trk:${type}:${index + 1}`, db)) broadcastToClients({ address: `${page}/fader`, args: [db] });
      return;
    }
    case '/Notify/Track/Out/Mute': {
      const [type, index, muted] = a;
      if (!Number.isInteger(type) || !Number.isInteger(index)) return;
      const t = trackState(type, index + 1); t.mute = muted === 1 || muted === true;
      const page = pageFor(type, index + 1);
      if (page) broadcastToClients({ address: `${page}/mute`, args: [t.mute ? 1 : 0] });
      return;
    }
    case '/Notify/Solo': {
      const [type, index, on] = a;
      if (!Number.isInteger(type) || !Number.isInteger(index)) return;
      const t = trackState(type, index + 1); t.solo = on === 1 || on === true;
      if (type === P.TRACK.INPUT || type === P.TRACK.DCA) broadcastToClients({ address: `${pageFor(type, index + 1)}/solo`, args: [t.solo ? 1 : 0] });
      return;
    }
    case '/Notify/SceneList': {
      sceneList = P.parseSceneList(a);
      return;
    }
    case '/Notify/CurSceneIndex': {
      if (Number.isInteger(a[0])) sceneIndex = a[0];
      return;
    }
    case '/Notify/Scene/Name': {
      const name = typeof a[0] === 'string' ? a[0] : null;
      if (!name || name === currentScene) return;
      // Its place in the list, in case LV1's index message hasn't come (yet)
      const known = sceneList.find(s => s.name === name);
      if (known) sceneIndex = known.index;
      const first = currentScene === null;
      currentScene = name;
      logEvent('scene-change', `"${name}"`);
      broadcastToClients({ address: '/SnapshotName', args: [name] });
      if (first) return; // the scene LV1 was already on when JPMixer connected
      // A scene recall changes LV1's own sends: read them back, then lay any
      // Ear Scene over them once LV1 has finished applying the scene
      setTimeout(() => { if (currentScene === name) { applySceneByName(name); requestAllSends(); } }, 300);
      return;
    }
    default:
  }
}

function trackState(type, n) {
  const key = `${type}:${n}`;
  if (!tracks.has(key)) tracks.set(key, { gain: null, mute: false, solo: false });
  return tracks.get(key);
}

// ── Console Controller ────────────────────────────────────────────────────
// Its strips and LV1's tracks. Inputs and DCAs map straight across; an aux
// strip is whichever track (aux bus or monitor mix) is that mix.
function trackFor(strip, num) {
  if (strip === 'input') return num >= 1 && num <= chCount() ? { type: P.TRACK.INPUT, n: num } : null;
  if (strip === 'cg') return num >= 1 && num <= dcas.length ? { type: P.TRACK.DCA, n: num } : null;
  const mix = mixes[num - 1];
  return mix ? { type: mix.kind, n: mix.index + 1 } : null;
}
function auxForTrack(type, n) {
  const pos = mixes.findIndex(m => m.kind === type && m.index + 1 === n);
  return pos === -1 ? null : pos + 1;
}
// The page address for an LV1 track (n from 1), or null if it isn't shown
function pageFor(type, n) {
  if (type === P.TRACK.INPUT) return `/Input_Channels/${n}`;
  if (type === P.TRACK.DCA) return `/Control_Groups/${n}`;
  const aux = auxForTrack(type, n);
  return aux ? `/Aux_Outputs/${aux}` : null;
}
function mixStereo(aux) {
  const mix = mixes[aux - 1];
  return mix ? tracks.get(`${mix.kind}:${mix.index + 1}`)?.stereo !== false : true;
}
// Everything it shows, sent to the one page that asked
function sendConsoleState(ws) {
  const out = [];
  const add = (strip, count, withSolo) => {
    for (let num = 1; num <= count; num++) {
      const tr = trackFor(strip, num); if (!tr) continue;
      const t = tracks.get(`${tr.type}:${tr.n}`); if (!t) continue;
      const base = pageFor(tr.type, tr.n);
      if (Number.isFinite(t.gain)) out.push({ address: `${base}/fader`, args: [t.gain] });
      out.push({ address: `${base}/mute`, args: [t.mute ? 1 : 0] });
      if (withSolo) out.push({ address: `${base}/solo`, args: [t.solo ? 1 : 0] });
    }
  };
  add('input', chCount(), true);
  add('aux', auxCount(), false);
  add('cg', dcas.length, true);
  for (const m of out) { try { ws.send(JSON.stringify(m)); } catch (_) {} }
}
// A Console Controller move: to LV1, and to the other pages showing it
function consoleWrite(ws, strip, numRaw, kind, value) {
  const tr = trackFor(strip, parseInt(numRaw, 10));
  if (!tr || !lv1) return;
  const { type, n } = tr;
  const t = trackState(type, n), base = pageFor(type, n);
  if (kind === 'fader') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    const db = P.clampLevel(value);
    t.gain = db;
    noteWrite(`trk:${type}:${n}`, db);
    lv1.setTrackGain(type, n, db);
    broadcastToClients({ address: `${base}/fader`, args: [db] }, ws);
  } else if (kind === 'mute') {
    t.mute = !!value;
    lv1.setTrackMute(type, n, t.mute);
  } else if (kind === 'solo') {
    t.solo = !!value;
    lv1.setSolo(type, n, t.solo);
  }
}

// LV1's on/off for a send. One JPMixer is holding off that comes back on
// (a scene recall, or the engineer) is switched off again, and released on
// when the mute/solo ends.
function noteDeskOn(ch, aux, on) {
  const key = levelKey(ch, aux);
  onCache.set(key, on);
  const entry = silencedSends.get(key);
  if (entry && on) {
    entry.wasOn = true;
    pacer.write(`on:${key}`, () => lv1 && lv1.setSendOn(ch, aux, false), true);
  }
}

// ── Server lifecycle ────────────────────────────────────────────────────
// The same remote-device id each time, so LV1 sees one JPMixer on this computer
function deviceId() {
  const h = crypto.createHash('sha256').update(`JPMixer:${os.hostname()}`).digest('hex').toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function resetState() {
  consoleConnected = false;
  currentScene = null;
  sceneList = []; sceneIndex = null;
  inputNames.clear(); mixes.length = 0; inputCount = 0;
  tracks.clear(); dcas = [];
  levelCache.clear(); panCache.clear(); onCache.clear();
  silencedSends.clear(); pendingReleases.clear(); recentWrites.clear();
  pacer.clear();
  Object.keys(muteState).forEach(k => delete muteState[k]);
  Object.keys(soloState).forEach(k => delete soloState[k]);
}

function start(cfg) {
  serverCfg = cfg;
  connections = [];
  resetState();

  const appExpress = express();
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
  httpServer.listen(cfg.serverPort, () => console.log(`[JPMixer/LV1] Web server → http://localhost:${cfg.serverPort}`));

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
        // A mix LV1 hasn't reported yet (a phone back while a big show is
        // still arriving): ask, and LV1's answer reaches every phone
        const auxN = parseInt(msg.aux, 10);
        if (Number.isInteger(auxN) && auxN >= 1 && auxN <= auxCount() && !levelCache.has(levelKey(1, auxN))) pacer.write(`get:${auxN}`, () => lv1 && lv1.getSends(auxN));
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
        logEvent('scene-save', `scene:"${key}" aux:${msg.aux}`);
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
        if (Number.isInteger(aux) && aux >= 1 && aux <= auxCount()) {
          Object.assign(outLevels, pushSceneValues(String(aux), msg.levels));
          for (const [chStr, panVal] of Object.entries(msg.pans || {})) {
            const ch = parseInt(chStr, 10);
            if (!Number.isInteger(ch) || ch < 1 || ch > chCount() || !Number.isFinite(panVal) || panVal < 0 || panVal > 1) continue;
            panCache.set(levelKey(ch, aux), panVal);
            outPans[chStr] = panVal;
            noteWrite(`pan:${levelKey(ch, aux)}`, P.panFromSlider(panVal));
            pacer.write(`pan:${ch}:${aux}`, () => lv1 && lv1.setSendPan(ch, aux, panVal));
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
        try { ws.send(JSON.stringify({ type: 'channel-detail', ch: msg.ch, params: {}, values: {}, unsupported: true })); } catch (_) {}
        return;
      }

      // Raw OSC-address-shaped messages from mixer.js (send_level / send_pan,
      // and the same addresses ending /? when a phone picks a mix)
      if (!msg.address) return;
      const m = msg.address.match(/^\/Input_Channels\/(\d+)\/Aux_Send\/(\d+)\/send_(level|pan)(\/\?)?$/);
      if (!m) return;
      const ch = parseInt(m[1], 10), aux = parseInt(m[2], 10), kind = m[3];
      if (!validPair(aux, ch)) return;
      if (m[4]) { answerQuery(ws, ch, aux, kind); return; }
      const rawVal = Array.isArray(msg.args) ? msg.args[0] : undefined;
      if (typeof rawVal !== 'number' || !Number.isFinite(rawVal)) return;
      const key = levelKey(ch, aux);

      if (kind === 'pan') {
        const val = Math.max(0, Math.min(1, rawVal));
        panCache.set(key, val);
        pacer.cancel(`pan:${ch}:${aux}`); // supersedes a queued preset write
        noteWrite(`pan:${key}`, P.panFromSlider(val));
        lv1 && lv1.setSendPan(ch, aux, val);
        broadcastToClients({ address: msg.address, args: [val] }, ws);
        ws._lastActivityAt = Date.now();
        shared.broadcastActivity(connections, { type: 'device-activity', deviceId: ws._deviceId || null, aux, channel: ch, kind: 'pan', direction: val < 0.5 ? 'left' : val > 0.5 ? 'right' : null }, ws);
        return;
      }

      const val = Math.max(-150, Math.min(P.LEVEL_MAX, rawVal));
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

  // ── LV1 connection ───────────────────────────────────────────────────
  // The LV1 computer's address. Blank = find LV1 on the network (this
  // computer's first), as Waves' apps do; see lv1-discovery.js.
  const wanted = (cfg.deskIp || '').trim();
  const fixedPort = Number.isInteger(cfg.lv1Port) && cfg.lv1Port > 0 && cfg.lv1Port <= 65535 ? cfg.lv1Port : 0;
  let lastNote = null;
  const resolveTarget = async () => {
    if (fixedPort) return { host: wanted || '127.0.0.1', port: fixedPort };
    const target = await discovery.find(wanted);
    if (target) saveLastFound();
    const note = target ? `found at ${target.host}:${target.port}` : `${wanted || 'no LV1'} not found — is LV1 open with its MyMon remote switched on?`;
    if (note !== lastNote) { lastNote = note; logEvent('lv1-discovery', note); }
    return target;
  };
  loadLastFound();
  const client = new Lv1Client({ resolveTarget, deviceName: 'JPMixer', deviceId: deviceId() });
  lv1 = client;
  client.on('connected', () => {
    if (lv1 !== client) return;
    consoleConnected = true;
    logEvent('console-connect', `${client.host}:${client.port}`);
    if (onConsoleStatusChange) onConsoleStatusChange(true);
    // Back after a drop: an LV1 that restarted has every send on again while
    // phones still show their mutes. Switch the silenced ones back off.
    for (const [key, entry] of silencedSends) {
      if (!entry.wasOn) continue;
      const [ch, aux] = key.split(':').map(Number);
      pacer.write(`on:${key}`, () => lv1 && lv1.setSendOn(ch, aux, false), true);
    }
    // And mutes/solos released while LV1 couldn't be reached
    for (const key of pendingReleases.keys()) pacer.write(`rel:${key}`, () => flushRelease(key), true);
  });
  client.on('disconnected', () => {
    if (lv1 !== client) return;
    consoleConnected = false;
    logEvent('console-error', 'connection to LV1 lost — reconnecting');
    if (onConsoleStatusChange) onConsoleStatusChange(false);
  });
  client.on('message', (m) => { if (lv1 === client) onLv1Message(m); });
  client.on('error', (err) => { if (lv1 === client && err.code !== 'ECONNREFUSED') logEvent('lv1-error', err.message || err.code || String(err)); });
  client.connect();
}

function stop() {
  if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
  clearTimeout(layoutTimer); layoutTimer = null;
  pacer.flush(); // queued writes are the state people asked for
  // Release every mute/solo: start() forgets this state, and leaving sends
  // off would strand channels silent. Levels moved while they were off go
  // out too — they're what the performer last asked for.
  if (lv1) {
    for (const [key, entry] of silencedSends) pendingReleases.set(key, entry);
    for (const key of [...pendingReleases.keys()]) flushRelease(key);
    const closing = lv1;
    lv1 = null;
    closing.disconnect(); // graceful: the writes above go out first
    closing.removeAllListeners();
    closing.on('error', () => {});
  }
  silencedSends.clear(); pendingReleases.clear();
  discovery.close();
  if (wss) { for (const c of wss.clients) { try { c.terminate(); } catch (_) {} } wss.close(); wss = null; }
  if (httpServer) { httpServer.close(); httpServer = null; }
  consoleConnected = false;
  if (onConsoleStatusChange) onConsoleStatusChange(false);
  levelCache.clear(); panCache.clear(); pacer.clear();
  connections = [];
  console.log('[JPMixer/LV1] Server stopped');
  return Promise.resolve();
}

function getChannelNames() {
  const out = {};
  for (const [ch, name] of inputNames) out[String(ch)] = name;
  return out;
}
function getAuxNames() {
  const out = {};
  mixes.forEach((m, i) => { if (m && m.name) out[String(i + 1)] = m.name; });
  return out;
}
// Save & Apply for settings that don't need a reconnect. Everything reads
// serverCfg when it runs, so swapping it in and re-sending the layout is enough.
function applyConfigLive(cfg) {
  serverCfg = cfg;
  logEvent('config-live', `pushed to ${connections.length} clients`);
  if (wss) broadcastToClients(buildConfig({ liveUpdate: true }));
}
function getChannelCount() { return inputCount || null; }
function getAuxCount() { return mixes.length || null; }

function isConsoleConnected() { return consoleConnected; }
function setConsoleStatusCallback(cb) { onConsoleStatusChange = cb; }
function setConnectionCountCallback(cb) { onConnectionCountChange = cb; }
function getConnectionCount() { return connections.length; }
function setServerErrorCallback(cb) { onServerError = cb; }

// Traffic log / recording — not implemented for LV1
function getOscLog() { return []; }
function setOscTrafficCallback(cb) { onOscTraffic = cb; }
function startOscLogRecording() { return { ok: false, error: 'Traffic recording is not available for LV1' }; }
function stopOscLogRecording() { return { ok: false, error: 'Traffic recording is not available for LV1' }; }
function getOscLogRecordingStatus() { return { recording: false }; }
function oscLogRecordsFolder() { return null; }

// After Settings merges device groups — see shared-handlers.js
function pushDevicePresets(deviceId) { shared.pushDevicePresets(connections, deviceId); }

module.exports = { getConnectedDevicesInfo, pushDevicePresets,
  start, stop, applyConfigLive, getChannelNames, getAuxNames, getChannelCount, getAuxCount,
  isConsoleConnected, setConsoleStatusCallback, setConnectionCountCallback, getConnectionCount,
  setServerErrorCallback, getOscLog, setOscTrafficCallback,
  startOscLogRecording, stopOscLogRecording, getOscLogRecordingStatus, oscLogRecordsFolder,
  fireSnapshot, setMute: sendMute, setSolo: sendSolo, setChannelLabel, setAuxLabel,
};
