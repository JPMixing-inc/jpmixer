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
//   ✓ Console Controller: input, aux and DCA faders and mutes, input and
//     DCA solo (the desk's own solo — see consoleWrite below). Not the
//     channel processing panel.
//   ✗ OSC/MIDI log recording,
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
// Send-level push: dLive sends an unsolicited Send Level message when a send
// changes, the way it's documented to for Fader/Mute/Assignment. Confirmed
// 2026-10-21 against dLive Director 2.12 running offline (System → Offline →
// "Enable Director Connections to MixRack IP Controllers"): a change made by
// another MIDI controller reached JPMixer at once. Not yet seen on a real
// MixRack, so both mechanisms stay, controllable from Settings:
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
const { createPacedWriter } = require('./paced-writer');
const config    = require('./config');
const { mountGreenRoom } = require('./greenroom');
const { mountBranding } = require('./branding');
const { mountPerformerAssignments } = require('./performer-assignments');
const { mountFoh } = require('./foh');

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
// ── The console's mixes ───────────────────────────────────────────────────
// dLive keeps mono (1-62) and stereo (1-31) aux mixes in separate pools,
// as many of each as the show's bus setup has. On connect JPMixer asks for
// every slot's name; only mixes that exist answer (seen on dLive Director
// 2.12). JPMixer's aux N is then the Nth: the mono mixes, then the stereo
// ones. A console that answers none (older firmware) keeps the old mapping,
// aux N = mono aux N, with Settings' Auxes count.
let mixMap = null;    // [{ stereo, n }] by JPMixer aux - 1, or null
let mixProbe = null;  // { mono: Map n->name, stereo: Map n->name } while asking
const auxCountNow = () => mixMap ? mixMap.length : (serverCfg.auxes || 16);
function auxCoord(baseN, aux) {
  try {
    if (!mixMap) return P.coordinate(baseN, 'monoAux', aux);
    const mix = mixMap[aux - 1];
    return mix ? P.coordinate(baseN, mix.stereo ? 'stereoAux' : 'monoAux', mix.n) : null;
  } catch (_) { return null; }
}
// JPMixer's aux number for a coordinate in the aux bank, or null
function auxFor(baseN, midiCh, ch) {
  if (midiCh !== baseN + 2) return null;
  const stereo = ch >= 0x40, n = stereo ? ch - 0x40 + 1 : ch + 1;
  if (!mixMap) return !stereo && n <= 62 ? n : null;
  const i = mixMap.findIndex(m => m.stereo === stereo && m.n === n);
  return i === -1 ? null : i + 1;
}
function dcaCoord(baseN, dca)    { try { return P.coordinate(baseN, 'dca', dca); } catch (_) { return null; } }

// ── Console Controller ─────────────────────────────────────────────────────
// Its strips and dLive's channels: inputs, aux masters (the mono auxes the
// musician mixer uses) and DCAs (shown as control groups, up to 24 — as many
// as Settings' Control Groups count).
const STRIP_PATH = { input: 'Input_Channels', aux: 'Aux_Outputs', cg: 'Control_Groups' };
const dcaCount = () => Math.max(0, Math.min(24, Number.isInteger(serverCfg.groups) ? serverCfg.groups : 8));
const consoleState = new Map(); // "input:3" / "aux:2" / "cg:1" -> { gain, mute, solo }
let consolePrimed = false;      // the console's faders/mutes have been asked for
function stripCoord(baseN, kind, n) {
  if (kind === 'input') return n <= (serverCfg.channels || 48) ? channelCoord(baseN, n) : null;
  if (kind === 'aux') return n <= auxCountNow() ? auxCoord(baseN, n) : null;
  return n <= dcaCount() ? dcaCoord(baseN, n) : null;
}
// The strip a dLive coordinate is, or null if the Console Controller doesn't show it
function stripFor(baseN, midiCh, ch) {
  if (midiCh === baseN && ch <= 127) return { kind: 'input', n: ch + 1 };
  const aux = auxFor(baseN, midiCh, ch);
  if (aux) return { kind: 'aux', n: aux };
  if (midiCh === baseN + 4 && ch >= 0x36 && ch < 0x36 + 24) return { kind: 'cg', n: ch - 0x36 + 1 };
  return null;
}
function stripState(kind, n) {
  const key = `${kind}:${n}`;
  if (!consoleState.has(key)) consoleState.set(key, { gain: null, mute: false, solo: false });
  return consoleState.get(key);
}
// -inf can't go in JSON: -150, the "off" every page already uses
const jsonDb = db => (db === -Infinity || db === null || db === undefined) ? -150 : db;
function primeConsole(baseN) {
  if (consolePrimed || !client) return;
  consolePrimed = true;
  for (const [kind, count] of [['input', serverCfg.channels || 48], ['aux', auxCountNow()], ['cg', dcaCount()]]) {
    for (let n = 1; n <= count; n++) {
      const c = stripCoord(baseN, kind, n); if (!c) continue;
      enqueuePrime(() => client && client.requestFader(c));
      enqueuePrime(() => client && client.requestMute(c));
    }
  }
  startPriming();
}
function sendConsoleState(ws) {
  const out = [];
  for (const [key, t] of consoleState) {
    const [kind, n] = key.split(':');
    const base = `/${STRIP_PATH[kind]}/${n}`;
    if (t.gain !== null) out.push({ address: `${base}/fader`, args: [jsonDb(t.gain)] });
    out.push({ address: `${base}/mute`, args: [t.mute ? 1 : 0] });
    if (kind !== 'aux') out.push({ address: `${base}/solo`, args: [t.solo ? 1 : 0] });
  }
  for (const m of out) { try { ws.send(JSON.stringify(m)); } catch (_) {} }
}
// A Console Controller move: to the console, and to the other pages. The
// console confirms it to every controller, JPMixer included.
function consoleWrite(ws, baseN, kind, nRaw, what, value) {
  const n = parseInt(nRaw, 10);
  const c = Number.isInteger(n) && n >= 1 ? stripCoord(baseN, kind, n) : null;
  if (!c || !client) return;
  const t = stripState(kind, n), base = `/${STRIP_PATH[kind]}/${n}`;
  if (what === 'fader') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    const db = value <= -90 ? -Infinity : Math.min(10, value);
    t.gain = db;
    client.setFader(c, db);
    broadcastToClients({ address: `${base}/fader`, args: [jsonDb(db)] }, ws);
  } else if (what === 'mute') {
    t.mute = !!value;
    client.setMute(c, t.mute);
  } else if (what === 'solo' && kind !== 'aux') {
    t.solo = !!value;
    client.setSolo(c, t.solo);
  }
}

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
// Send levels JPMixer asked for: "ch:aux" -> reply deadline. With push
// listening off (dliveListenSendLevels false), replies to these are still
// accepted. Poll and mute both depend on them, and both arrive as the same
// 'sendLevel' event as an unsolicited push.
const requestedSendLevels = new Map();
const SEND_LEVEL_REPLY_MS = 5000;
function requestSendLevel(ch, aux, inputCoord, sendCoord) {
  if (!client) return;
  const now = Date.now();
  if (requestedSendLevels.size > 500) {
    for (const [k, deadline] of requestedSendLevels) if (deadline < now) requestedSendLevels.delete(k);
  }
  requestedSendLevels.set(levelKey(ch, aux), now + SEND_LEVEL_REPLY_MS);
  client.requestSendLevel(inputCoord, sendCoord);
}

// Bulk send-level writes (mute/solo, recalls) go through here — see
// paced-writer.js. A musician's own fader move stays direct.
const pacer = createPacedWriter();
function pacedSendLevel(ch, aux, inputCoord, sendCoord, db, urgent) {
  pacer.write(`lvl:${ch}:${aux}`, () => client && client.setSendLevel(inputCoord, sendCoord, db), urgent);
}

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
    if (inputCoord && sendCoord) requestSendLevel(ch, aux, inputCoord, sendCoord);
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

// ── Config builder — same shape osc-server.js's buildConfig() produces ────

function buildConfig() {
  const auxCount = auxCountNow();
  const chCount  = serverCfg.channels || 48;
  const cfgAuxOverrides = serverCfg.auxOverrides || {};

  const auxilaries = [];
  for (let i = 1; i <= auxCount; i++) {
    const ov = cfgAuxOverrides[String(i)] || {};
    const liveName = nameCache.get(`aux:${i}`);
    auxilaries.push({
      enabled:   ov.enabled !== false,
      label:     ov.label || shared.consoleNameOr(serverCfg, 'auxes', i, liveName) || `AUX ${i}`,
      channel:   i,
      // A stereo mix is mixed like a mono one: dLive's MIDI control has no
      // per-send pan, so phones don't offer pan either way
      stereo:    false,
      colour:    ov.colour || colourCache.get(`aux:${i}`) || '#e8a020',
      icon:      '',
      eqEnabled: false, // aux EQ not implemented for dLive yet
      linkOnly:  ov.linkOnly === true,
      groups:    shared.auxGroupNames(ov, serverCfg),
    });
  }

  const channels = shared.buildChannelList(chCount, serverCfg, i => nameCache.get(`input:${i}`));

  return JSON.stringify({
    config: {
      channels,
      aux: auxilaries,
      controlGroups: Array.from({ length: dcaCount() }, (_, i) => ({ channel: i + 1, label: nameCache.get(`dca:${i + 1}`) || `DCA ${i + 1}` })),
      channelProcessing: false, // the Console Controller's EQ/dynamics panel is DiGiCo-only
      snapshot: currentSceneNumber != null ? String(currentSceneNumber) : '—',
      sceneRecallEnabled: !!serverCfg.sceneRecallEnabled,
      earScenes: serverCfg.performerEarScenes !== false, // Settings: Ear Scenes on performer phones
      scenes: scenes.getAll(),
      mutes: muteState,
      solos: soloState,
    },
  });
}

// ── Mute / Solo — same algorithm as osc-server.js's applyMuteSolo, using
// dLive send-level writes in place of sendToDesk() ──────────────────────

function isSilenced(aux, ch) {
  return !!muteState[aux]?.[ch]
    || (Object.values(soloState[aux] || {}).some(Boolean) && !soloState[aux]?.[ch]);
}

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
    const muted = !!(muteState[aux]?.[ch]);
    const soloed = !!(soloState[aux]?.[ch]);
    const silenced = muted || (anySolo && !soloed);
    const inputCoord = channelCoord(baseN, ch);
    if (!inputCoord) continue;
    if (!levelCache.has(key)) {
      // Fetch the real level before silencing an uncached send so unmute
      // can restore it. The reply handler applies the active mute/solo.
      if (silenced) enqueuePrime(() => requestSendLevel(ch, aux, inputCoord, snd));
      continue;
    }

    if (silenced) {
      if (premuteState[aux][ch] === undefined) premuteState[aux][ch] = levelCache.get(key);
      pacedSendLevel(ch, aux, inputCoord, snd, -Infinity, true);
    } else if (premuteState[aux][ch] !== undefined) {
      const restore = premuteState[aux][ch];
      pacedSendLevel(ch, aux, inputCoord, snd, restore, true);
      levelCache.set(key, restore);
      restoredLevels[ch] = restore;
      delete premuteState[aux][ch];
    }
  }
  if (primeQueue.length) startPriming();

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
function reassertSilencing(baseN) {
  const auxes = new Set([...Object.keys(muteState), ...Object.keys(soloState)].map(Number));
  for (const aux of auxes) {
    const snd = auxCoord(baseN, aux);
    if (!snd) continue;
    for (let ch = 1; ch <= (serverCfg.channels || 48); ch++) {
      if (!isSilenced(aux, ch)) continue;
      const input = channelCoord(baseN, ch);
      if (input) pacedSendLevel(ch, aux, input, snd, -Infinity, true);
    }
  }
}

function setMute(auxRaw, chRaw, muted) {
  const aux = parseInt(auxRaw, 10), ch = parseInt(chRaw, 10);
  const chMax = serverCfg.channels || 48, auxMax = auxCountNow();
  if (isNaN(aux) || aux < 1 || aux > auxMax || isNaN(ch) || ch < 1 || ch > chMax) return false;
  if (!muteState[aux]) muteState[aux] = {};
  muteState[aux][ch] = !!muted;
  applyMuteSolo(moduleBaseN, aux);
  return true;
}

function setSolo(auxRaw, chRaw, soloed) {
  const aux = parseInt(auxRaw, 10), ch = parseInt(chRaw, 10);
  const chMax = serverCfg.channels || 48, auxMax = auxCountNow();
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
  return shared.relabel(serverCfg, 'channel', n, label, serverCfg.channels || 48, broadcastToClients);
}

function setAuxLabel(n, label) {
  return shared.relabel(serverCfg, 'aux', n, label, auxCountNow(), broadcastToClients);
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
    if (!Number.isFinite(sliderVal) || sliderVal < 0 || sliderVal > 1) continue;
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
      pacedSendLevel(ch, aux, inputCoord, snd, -Infinity, true);
    } else {
      delete premuteState[aux][ch];
      pacedSendLevel(ch, aux, inputCoord, snd, db, false);
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
const sliderToDb = shared.sliderToDb; // one clamped copy for every backend

let mixProbeTimer = null;
function startMixProbe(baseN) {
  clearInterval(mixProbeTimer);
  mixProbe = { mono: new Map(), stereo: new Map() };
  const slots = [...Array.from({ length: 62 }, (_, i) => P.coordinate(baseN, 'monoAux', i + 1)), ...Array.from({ length: 31 }, (_, i) => P.coordinate(baseN, 'stereoAux', i + 1))];
  mixProbeTimer = setInterval(() => {
    const c = slots.shift();
    if (c) { if (client) client.requestName(c); return; }
    clearInterval(mixProbeTimer); mixProbeTimer = null;
    setTimeout(() => finishMixProbe(baseN), 600); // the last answers
  }, 20);
}
// The mix layout's answers are in: build the mix list, then names and
// colours for it, and give pages the new layout
function finishMixProbe(baseN) {
  const probe = mixProbe; mixProbe = null;
  if (!probe || !client) return;
  const mono = [...probe.mono.keys()].sort((a, b) => a - b), stereo = [...probe.stereo.keys()].sort((a, b) => a - b);
  if (!mono.length && !stereo.length) {
    logEvent('mix-layout', `no answer — using Settings' ${serverCfg.auxes || 16} mono auxes`);
    mixMap = null;
    for (let i = 1; i <= (serverCfg.auxes || 16); i++) {
      const c = auxCoord(baseN, i); if (!c) continue;
      enqueuePrime(() => client && client.requestName(c));
      enqueuePrime(() => client && client.requestColour(c));
    }
  } else {
    mixMap = [...mono.map(n => ({ stereo: false, n })), ...stereo.map(n => ({ stereo: true, n }))];
    logEvent('mix-layout', `${mono.length} mono + ${stereo.length} stereo aux mixes`);
    mixMap.forEach((m, i) => {
      nameCache.set(`aux:${i + 1}`, (m.stereo ? probe.stereo : probe.mono).get(m.n));
      const c = auxCoord(baseN, i + 1);
      if (c) enqueuePrime(() => client && client.requestColour(c));
    });
  }
  startPriming();
  rebuildSendLevelPollQueue();
  if (wss) { const msg = JSON.parse(buildConfig()); msg.config.liveUpdate = true; broadcastToClients(msg); }
}

// ── Server lifecycle ───────────────────────────────────────────────────────

function start(cfg) {
  serverCfg = cfg;
  connections = [];
  currentSceneNumber = null;
  levelCache.clear();
  requestedSendLevels.clear();
  pacer.clear();
  nameCache.clear();
  colourCache.clear();
  consoleState.clear(); consolePrimed = false;
  mixMap = null; mixProbe = null;
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
  mountBranding(appExpress);
  mountPerformerAssignments(appExpress);
  mountFoh(appExpress, { isConsoleConnected, getConnectionCount });

  const diagOnly = (req, res, next) => {
    const addr = req.socket.remoteAddress;
    if (addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1') return next();
    res.status(403).json({ error: 'Diagnostic endpoints are localhost-only' });
  };
  appExpress.get('/api/events', diagOnly, (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    // e.detail can carry a phone's own text (a scene name): escaped, as in osc-server.js
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const rows = eventLog.slice().reverse().map(e => `<tr><td>${esc(e.t)}</td><td><b>${esc(e.type)}</b></td><td>${esc(e.detail)}</td></tr>`).join('');
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

    ws.on('message', shared.guarded(logEvent, (raw) => {
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
        if (!scenes.saveScene(key, msg.aux, msg.values)) return; // not a mix number, or no fader values
        logEvent('scene-save', `scene:"${key}" aux:${msg.aux}`);
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

      // Console Controller
      if (msg.type === 'request-console-state') { sendConsoleState(ws); primeConsole(baseN); return; }
      if (msg.type === 'console-fader') { consoleWrite(ws, baseN, 'input', msg.ch, 'fader', msg.db); return; }
      if (msg.type === 'console-mute')  { consoleWrite(ws, baseN, 'input', msg.ch, 'mute', msg.muted); return; }
      if (msg.type === 'console-solo')  { consoleWrite(ws, baseN, 'input', msg.ch, 'solo', msg.soloed); return; }
      if (msg.type === 'aux-fader')     { consoleWrite(ws, baseN, 'aux', msg.aux, 'fader', msg.db); return; }
      if (msg.type === 'aux-mute')      { consoleWrite(ws, baseN, 'aux', msg.aux, 'mute', msg.muted); return; }
      if (msg.type === 'cg-fader')      { consoleWrite(ws, baseN, 'cg', msg.cg, 'fader', msg.db); return; }
      if (msg.type === 'cg-mute')       { consoleWrite(ws, baseN, 'cg', msg.cg, 'mute', msg.muted); return; }
      if (msg.type === 'cg-solo')       { consoleWrite(ws, baseN, 'cg', msg.cg, 'solo', msg.soloed); return; }
      if (msg.type === 'request-channel-detail') {
        try { ws.send(JSON.stringify({ type: 'channel-detail', ch: msg.ch, params: {}, values: {}, unsupported: true })); } catch (_) {}
        return;
      }

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
      if (!Number.isFinite(db)) return;

      const key = levelKey(ch, aux);
      const prevDb = levelCache.get(key);
      if (!client) return;
      // Nothing upstream of the regex match validates ch/aux are actually
      // in range — this is the most directly client-reachable path, so it's
      // where an out-of-range number is most likely to show up in practice.
      const inputCoord = channelCoord(baseN, ch), sendCoord = auxCoord(baseN, aux);
      if (!inputCoord || !sendCoord) return;
      levelCache.set(key, db);
      const silenced = isSilenced(aux, ch);
      if (silenced) {
        if (!premuteState[aux]) premuteState[aux] = {};
        premuteState[aux][ch] = db;
      }
      pacer.cancel(`lvl:${ch}:${aux}`); // this move supersedes a queued recall write
      client.setSendLevel(inputCoord, sendCoord, silenced ? -Infinity : db);
      broadcastToClients(oscMsg, ws);

      ws._lastActivityAt = Date.now();
      let direction = null;
      if (typeof prevDb === 'number' && db !== prevDb) direction = db > prevDb ? 'up' : 'down';
      shared.broadcastActivity(connections, { type: 'device-activity', deviceId: ws._deviceId || null, aux, channel: ch, kind: 'level', direction }, ws);
    }));

    ws.on('close', () => {
      connections = connections.filter(c => c !== ws);
      if (onConnectionCountChange) onConnectionCountChange(connections.length);
      broadcastToClients({ type: 'connection-count', count: connections.length });
      if (ws._deviceId != null || ws._activeAux != null) { broadcastDevicesUpdate(); rebuildSendLevelPollQueue(); }
    });
  });

  // ── dLive MIDI-over-TCP client ─────────────────────────────────────────
  if (!cfg.deskIp) {
    logEvent('console-error', 'Console IP Address is not set on the Console tab — nothing to connect to.');
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
    // A console that restarted has lost the -∞ behind every phone mute and
    // solo; phones would show M lit on an audible channel. Re-send them
    // first (nothing to do on the first connect — start() cleared the state).
    reassertSilencing(baseN);
    // Prime channel/aux names + colours so the mixer shows real labels —
    // paced one request per tick, never bursted (see startPriming above).
    // Settings' Channels/Auxes counts can be configured higher than dLive's
    // actual protocol ceiling (128 inputs, 62 mono auxes) — skip anything
    // past that rather than crashing on an out-of-range coordinate.
    for (let i = 1; i <= (serverCfg.channels || 48); i++) {
      const c = channelCoord(baseN, i);
      if (c) enqueuePrime(() => client.requestName(c));
    }
    // Which mixes the show has: every mono and stereo aux slot's name.
    // Names, colours and the mix list follow once the answers are in.
    // On a lane of its own (93 small requests, one per 20 ms) so it doesn't
    // hold up everything else queued for the first seconds after connecting
    startMixProbe(baseN);
    for (let i = 1; i <= dcaCount(); i++) {
      const c = dcaCoord(baseN, i);
      if (c) enqueuePrime(() => client.requestName(c));
    }
    // A Console Controller already open: its faders and mutes again (a
    // console that restarted may have changed)
    if (consolePrimed) { consolePrimed = false; primeConsole(baseN); }
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
    clearInterval(mixProbeTimer); mixProbeTimer = null; mixProbe = null; // asked again on reconnect
  });

  client.on('error', (err) => {
    // Common connection failures (e.g. ECONNREFUSED for an unreachable or
    // empty IP) carry an empty .message — logging that alone is useless for
    // diagnosing a bad Console tab config, so fall back to .code.
    logEvent('console-error', err.message || err.code || String(err));
  });

  client.on('sendLevel', (ev) => {
    // This same message shape carries Group/Matrix/DCA sends too, not just
    // Input channels — checking the *source's* bank (ev.midiCh) as well as
    // the destination's is what keeps a Group's send from getting
    // misattributed and broadcast as some unrelated input channel's level.
    if (ev.midiCh !== baseN) return;              // source isn't an Input channel
    // The destination's JPMixer aux: mono and stereo aux sends share one
    // bank (stereo at 0x40+), so this goes through the console's mix list —
    // a stereo mix the show doesn't use, or any stereo mix on a console
    // whose layout wasn't read, is ignored rather than taken for a mono one.
    const aux = auxFor(baseN, ev.sndMidiCh, ev.sndCh);
    if (!aux) return;
    const ch = ev.ch + 1;
    const input = channelCoord(baseN, ch), snd = auxCoord(baseN, aux);
    if (!input || !snd) return;
    const key = levelKey(ch, aux);
    // Push listening off: ignore unsolicited updates, but keep replies to
    // JPMixer's own requests — dropping those left poll-only mode reading
    // nothing back and made a mute of an untouched channel do nothing.
    const deadline = requestedSendLevels.get(key);
    if (deadline !== undefined) requestedSendLevels.delete(key);
    if (serverCfg.dliveListenSendLevels === false && !(deadline >= Date.now())) return;
    // Infinity cannot be represented in JSON. Keep the same -150 "off"
    // sentinel as DiGiCo, and never replace the real fader with a mute echo.
    let db = ev.db === -Infinity ? -150 : ev.db;
    if (!Number.isFinite(db)) return;
    if (isSilenced(aux, ch)) {
      if (!premuteState[aux]) premuteState[aux] = {};
      if (db > -90 || premuteState[aux][ch] === undefined) premuteState[aux][ch] = db;
      if (db > -90) pacedSendLevel(ch, aux, input, snd, -Infinity, true);
      db = premuteState[aux][ch];
    }
    levelCache.set(key, db);
    broadcastToClients({ address: `/Input_Channels/${ch}/Aux_Send/${aux}/send_level`, args: [db] });
  });

  client.on('sceneRecall', (ev) => {
    currentSceneNumber = ev.sceneNumber;
    logEvent('scene-change', `scene:${ev.sceneNumber}`);
    broadcastToClients({ address: '/SnapshotName', args: [String(ev.sceneNumber)] });
    applySceneForSceneNumber(baseN, ev.sceneNumber);
  });

  client.on('name', (ev) => {
    // Disambiguate input vs aux by which bank the coordinate's midiCh falls in.
    // A name that changes (renamed on the console, or first read on connect)
    // is announced to phones, a Settings label still winning — as DiGiCo
    // and LV1 do. They used to keep the old name until they reloaded.
    if (ev.midiCh === baseN) {
      const n = ev.ch + 1, key = `input:${n}`;
      if (nameCache.get(key) === ev.name) return;
      nameCache.set(key, ev.name);
      if (n > (serverCfg.channels || 48)) return;
      const label = serverCfg.channelOverrides?.[String(n)]?.label;
      broadcastToClients({ type: 'channel-relabeled', channel: n, label: label || ev.name });
    } else if (ev.midiCh === baseN + 4 && ev.ch >= 0x36 && ev.ch < 0x36 + 24) {
      const n = ev.ch - 0x36 + 1, key = `dca:${n}`;
      if (nameCache.get(key) === ev.name) return;
      nameCache.set(key, ev.name);
      broadcastToClients({ address: `/Control_Groups/${n}/name`, args: [ev.name || `DCA ${n}`] });
    } else if (ev.midiCh === baseN + 2) {
      // While the mix layout is being read, an answer is a mix that exists
      if (mixProbe) {
        (ev.ch >= 0x40 ? mixProbe.stereo : mixProbe.mono).set(ev.ch >= 0x40 ? ev.ch - 0x40 + 1 : ev.ch + 1, ev.name);
        return;
      }
      const n = auxFor(baseN, ev.midiCh, ev.ch); if (!n) return;
      const key = `aux:${n}`;
      if (nameCache.get(key) === ev.name) return;
      nameCache.set(key, ev.name);
      if (n > auxCountNow()) return;
      const label = serverCfg.auxOverrides?.[String(n)]?.label;
      broadcastToClients({ type: 'aux-relabeled', aux: n, label: label || ev.name || `AUX ${n}` });
    }
  });
  // The console's own faders, mutes and solos, for the Console Controller —
  // replies to its requests, and changes made anywhere (the surface,
  // Director, another controller)
  client.on('fader', (ev) => {
    const strip = stripFor(baseN, ev.midiCh, ev.ch); if (!strip) return;
    stripState(strip.kind, strip.n).gain = ev.db;
    broadcastToClients({ address: `/${STRIP_PATH[strip.kind]}/${strip.n}/fader`, args: [jsonDb(ev.db)] });
  });
  client.on('mute', (ev) => {
    const strip = stripFor(baseN, ev.midiCh, ev.ch); if (!strip) return;
    stripState(strip.kind, strip.n).mute = ev.on;
    broadcastToClients({ address: `/${STRIP_PATH[strip.kind]}/${strip.n}/mute`, args: [ev.on ? 1 : 0] });
  });
  client.on('solo', (ev) => {
    const strip = stripFor(baseN, ev.midiCh, ev.ch); if (!strip || strip.kind === 'aux') return;
    stripState(strip.kind, strip.n).solo = ev.on;
    broadcastToClients({ address: `/${STRIP_PATH[strip.kind]}/${strip.n}/solo`, args: [ev.on ? 1 : 0] });
  });

  client.on('colour', (ev) => {
    const n = auxFor(baseN, ev.midiCh, ev.ch);
    if (n) colourCache.set(`aux:${n}`, ev.hex);
  });

  client.connect();
}

function stop() {
  if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
  clearInterval(mixProbeTimer); mixProbeTimer = null; mixProbe = null;
  stopPriming();
  stopSendLevelPolling();
  pacer.flush(); // queued writes are the state people asked for
  // Restore the actual send levels before dropping the mute bookkeeping.
  // Gracefully end TCP after these writes so shutdown cannot discard them.
  if (client) {
    for (const [aux, channels] of Object.entries(premuteState)) {
      const snd = auxCoord(moduleBaseN, Number(aux));
      for (const [ch, db] of Object.entries(channels)) {
        const input = channelCoord(moduleBaseN, Number(ch));
        if (input && snd) client.setSendLevel(input, snd, db);
      }
    }
  }
  clearMuteSolo();
  let closed = Promise.resolve();
  if (client) {
    const closing = client;
    client = null;
    closing.removeAllListeners();
    closing.on('error', () => {}); // socket errors during shutdown must stay handled
    closed = Promise.resolve(closing.disconnect({ flush: true }));
  }
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
  requestedSendLevels.clear();
  pacer.clear();
  connections = [];
  console.log('[JPMixer/dLive] Server stopped');
  return closed;
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
// Known once the console's mix layout has been read (Settings then shows it
// and locks the field, as for DiGiCo and LV1)
function getAuxCount() { return mixMap ? mixMap.length : null; }

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

module.exports = { getConnectedDevicesInfo, pushDevicePresets,
  start, stop, applyConfigLive, getChannelNames, getAuxNames, getChannelCount, getAuxCount,
  isConsoleConnected, setConsoleStatusCallback, setConnectionCountCallback, getConnectionCount,
  setServerErrorCallback, getOscLog, setOscTrafficCallback,
  startOscLogRecording, stopOscLogRecording, getOscLogRecordingStatus, oscLogRecordsFolder,
  fireSnapshot, setMute, setSolo, setChannelLabel, setAuxLabel,
};
