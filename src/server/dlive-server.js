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
const access = require('./access');
const dliveSockets = require('./dlive-sockets');
const DP = require('./dlive-private');

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

// ── The channels in a musician's mix: the inputs, then FX returns ─────────
// Settings' "FX returns in mixes" (dliveFxReturns, 0-16) puts the first FX
// returns in every mix after the inputs, so a singer can have reverb in
// their ears. FX return k is mix channel 128 + k — past dLive's 128 inputs,
// so its saved levels, Ear Scenes and My Mixes never land on an input.
const FX_BASE = 128;
const inputCount = () => Math.min(128, serverCfg.channels || 48);
const fxReturnCount = () => (Number.isInteger(serverCfg.dliveFxReturns) ? Math.max(0, Math.min(16, serverCfg.dliveFxReturns)) : 0);
const fxReturnChannels = () => Array.from({ length: fxReturnCount() }, (_, i) => FX_BASE + i + 1);
// A stereo input's right half isn't one of them: it's its pair, with the left
// (a mute or solo on it would also silence the left, which the console links)
const mixChannels = () => [...Array.from({ length: inputCount() }, (_, i) => i + 1).filter(ch => !isRightHalf(ch)), ...fxReturnChannels()];
// An FX return's name in the mixes: the console's, unless it's only its number
const fxReturnName = (ch) => { const name = nameCache.get(`input:${ch}`); return name && !/^\d+$/.test(name) ? name : `FX Return ${ch - FX_BASE}`; };
const isMixChannel = (ch) => Number.isInteger(ch) && ((ch >= 1 && ch <= inputCount() && !isRightHalf(ch)) || (ch > FX_BASE && ch <= FX_BASE + fxReturnCount()));
// The send's source on the console, and the mix channel a source is
function sourceCoord(baseN, ch) {
  if (!isMixChannel(ch)) return null;
  try { return ch > FX_BASE ? P.coordinate(baseN, 'fxReturn', ch - FX_BASE) : P.coordinate(baseN, 'input', ch); } catch (_) { return null; }
}
function sourceFor(baseN, midiCh, ch) {
  if (midiCh === baseN) return isMixChannel(ch + 1) ? ch + 1 : null;
  if (midiCh === baseN + 4 && ch >= 0x20 && ch < 0x30) return isMixChannel(FX_BASE + ch - 0x20 + 1) ? FX_BASE + ch - 0x20 + 1 : null;
  return null;
}
// ── The console's mixes ───────────────────────────────────────────────────
// dLive keeps mono (1-62) and stereo (1-31) aux mixes in separate pools,
// as many of each as the show's bus setup has. On connect JPMixer asks for
// every slot's name; only mixes that exist answer (seen on dLive Director
// 2.12). JPMixer's aux N is then the Nth: the mono mixes, then the stereo
// ones. A console that answers none (older firmware) keeps the old mapping,
// aux N = mono aux N, with Settings' Auxes count.
let mixMap = null;    // [{ stereo, n }] by JPMixer aux - 1, or null
let mixProbe = null;  // { mono: Map n->name, stereo: Map n->name, groups: { mono, stereo }, fx: { mono, stereo } } while asking
const auxCountNow = () => mixMap ? mixMap.length : (serverCfg.auxes || 16);
let busLayout = null; // { firstMonoAux, firstStereoAux }: where the auxes start in the console's list of mixes
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
// The DCAs (JPMixer's control groups), by number, with their names (also for plugins)
const getControlGroups = () => Array.from({ length: dcaCount() }, (_, i) => ({ channel: i + 1, label: nameCache.get(`dca:${i + 1}`) || `DCA ${i + 1}` }));
const consoleState = new Map(); // "input:3" / "aux:2" / "cg:1" -> { gain, mute, solo }
let consolePrimed = false;      // the console's faders/mutes have been asked for
function stripCoord(baseN, kind, n) {
  if (kind === 'input') return n <= (serverCfg.channels || 48) ? channelCoord(baseN, n) : null;
  if (kind === 'aux') return n <= auxCountNow() ? auxCoord(baseN, n) : null;
  if (kind === 'cg') return n <= dcaCount() ? dcaCoord(baseN, n) : null;
  const x = extras && extras[kind] && extras[kind][n - 1];
  return x ? x.coord : null;
}
// The strip a dLive coordinate is, or null if the Console Controller doesn't show it
function stripFor(baseN, midiCh, ch) {
  if (midiCh === baseN && ch <= 127) return { kind: 'input', n: ch + 1 };
  const aux = auxFor(baseN, midiCh, ch);
  if (aux) return { kind: 'aux', n: aux };
  if (midiCh === baseN + 4 && ch >= 0x36 && ch < 0x36 + 24) return { kind: 'cg', n: ch - 0x36 + 1 };
  return extrasByCoord.get(`${midiCh}:${ch}`) || null;
}
const stripBase = (kind, n) => (STRIP_PATH[kind] ? `/${STRIP_PATH[kind]}/${n}` : `/Extra/${kind}/${n}`);
const hasSolo = (kind) => kind === 'input' || kind === 'cg';
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
  if (extras) primeExtras(); else if (!extraProbe) probeExtras(baseN); // the rest of the strips, once found
  startPriming();
}
function sendConsoleState(ws) {
  const out = [];
  for (const [key, t] of consoleState) {
    const [kind, n] = key.split(':');
    const base = stripBase(kind, n);
    if (t.gain !== null) out.push({ address: `${base}/fader`, args: [jsonDb(t.gain)] });
    out.push({ address: `${base}/mute`, args: [t.mute ? 1 : 0] });
    if (hasSolo(kind)) out.push({ address: `${base}/solo`, args: [t.solo ? 1 : 0] });
  }
  for (const m of out) { try { ws.send(JSON.stringify(m)); } catch (_) {} }
}
// Channel and control group faders and mutes for plugins (plugins.js
// "faders", JPMixer's own plugins only): what the Console Controller shows,
// and moved the way it moves them. kind 'ch' | 'cg'; a level is dB, -150 off.
const STRIP_KIND = { ch: 'input', cg: 'cg' };
function getStrips() {
  const out = { ch: {}, cg: {} };
  for (const [key, t] of consoleState) {
    const [kind, n] = key.split(':');
    const k = kind === 'input' ? 'ch' : kind === 'cg' ? 'cg' : null;
    if (k) out[k][n] = { db: t.gain === null ? null : jsonDb(t.gain), mute: !!t.mute };
  }
  return out;
}
function primeStrips() { primeConsole(moduleBaseN); }
function setStrip(kind, nRaw, what, value) {
  const n = parseInt(nRaw, 10);
  if (!STRIP_KIND[kind] || !Number.isInteger(n) || n < 1 || !client || !stripCoord(moduleBaseN, STRIP_KIND[kind], n)) return false;
  if (what === 'fader' && (typeof value !== 'number' || !Number.isFinite(value))) return false;
  if (what !== 'fader' && what !== 'mute') return false;
  consoleWrite(null, moduleBaseN, STRIP_KIND[kind], n, what, value);
  return true;
}

// A Console Controller move: to the console, and to the other pages. The
// console confirms it to every controller, JPMixer included.
function consoleWrite(ws, baseN, kind, nRaw, what, value) {
  const n = parseInt(nRaw, 10);
  const c = Number.isInteger(n) && n >= 1 ? stripCoord(baseN, kind, n) : null;
  if (!c || !client) return;
  const t = stripState(kind, n), base = stripBase(kind, n);
  if (what === 'fader') {
    if (typeof value !== 'number' || !Number.isFinite(value) || kind === 'mg') return; // a mute group has no fader
    const db = value <= -90 ? -Infinity : Math.min(10, value);
    t.gain = db;
    client.setFader(c, db);
    broadcastToClients({ address: `${base}/fader`, args: [jsonDb(db)] }, ws);
  } else if (what === 'mute') {
    t.mute = !!value;
    client.setMute(c, t.mute);
  } else if (what === 'solo' && hasSolo(kind)) {
    t.solo = !!value;
    client.setSolo(c, t.solo);
  }
}

// ── Console Controller: the rest of dLive's strips ──────────────────────
// FX returns and sends, groups, matrices, mains (faders and mutes) and the
// mute groups (mutes), in their own tab. Which the show has is read the
// first time a Console Controller opens: only the ones that exist answer
// their name (as for the mixes). Mute groups always exist and have no name
// to ask for.
const EXTRA_KINDS = [
  { kind: 'fxr', title: 'FX returns', label: 'FX Ret', fader: true, slots: [['fxReturn', 16]] },
  { kind: 'fxs', title: 'FX sends', label: 'FX', fader: true, slots: [['monoFxSend', 16], ['stereoFxSend', 16]] },
  { kind: 'grp', title: 'Groups', label: 'Grp', fader: true, slots: [['monoGroup', 62], ['stereoGroup', 31]] },
  { kind: 'mtx', title: 'Matrices', label: 'Mtx', fader: true, slots: [['monoMatrix', 62], ['stereoMatrix', 31]] },
  { kind: 'main', title: 'Mains', label: 'Main', fader: true, slots: [['main', 6]] },
  { kind: 'mg', title: 'Mute groups', label: 'Mute group', fader: false, slots: [['muteGroup', 8]], noProbe: true },
];
const EXTRA_BY_KIND = Object.fromEntries(EXTRA_KINDS.map(k => [k.kind, k]));
let extras = null;              // kind -> [{ coord, type, index, label }], once read
let extraProbe = null;          // { want: Map("midiCh:ch" -> slot), found: Map("midiCh:ch" -> name) } while asking
const extrasByCoord = new Map(); // "midiCh:ch" -> { kind, n }
let extraProbeTimer = null, extraProbeFinishTimer = null;
function probeExtras(baseN) {
  clearInterval(extraProbeTimer); clearTimeout(extraProbeFinishTimer);
  const probe = extraProbe = { want: new Map(), found: new Map() };
  const queue = [];
  for (const k of EXTRA_KINDS) {
    if (k.noProbe) continue;
    for (const [type, count] of k.slots) for (let i = 1; i <= count; i++) {
      const c = P.coordinate(baseN, type, i);
      probe.want.set(`${c.midiCh}:${c.ch}`, { kind: k.kind, type, index: i });
      queue.push(c);
    }
  }
  extraProbeTimer = setInterval(() => {
    const c = queue.shift();
    if (c) { if (client) client.requestName(c); return; }
    clearInterval(extraProbeTimer); extraProbeTimer = null;
    extraProbeFinishTimer = setTimeout(() => { extraProbeFinishTimer = null; if (extraProbe === probe) finishExtraProbe(baseN); }, 600);
  }, 20);
}
function finishExtraProbe(baseN) {
  const probe = extraProbe; extraProbe = null;
  if (!probe) return;
  const next = {};
  for (const k of EXTRA_KINDS) next[k.kind] = [];
  for (const [key, slot] of probe.want) {
    if (!probe.found.has(key)) continue;
    const [midiCh, ch] = key.split(':').map(Number);
    next[slot.kind].push({ coord: { midiCh, ch }, type: slot.type, index: slot.index, name: probe.found.get(key) });
  }
  for (let i = 1; i <= 8; i++) next.mg.push({ coord: P.coordinate(baseN, 'muteGroup', i), type: 'muteGroup', index: i, name: '' });
  extrasByCoord.clear();
  for (const k of EXTRA_KINDS) {
    next[k.kind].forEach((x, i) => {
      x.label = extraLabel(k, x);
      extrasByCoord.set(`${x.coord.midiCh}:${x.coord.ch}`, { kind: k.kind, n: i + 1 });
    });
  }
  extras = next;
  logEvent('console-extras', EXTRA_KINDS.map(k => `${next[k.kind].length} ${k.title.toLowerCase()}`).join(', '));
  primeExtras();
  startPriming();
  if (wss) { const msg = JSON.parse(buildConfig()); msg.config.liveUpdate = true; broadcastToClients(msg); }
}
// A strip's name: the console's, unless it's only its number (as dLive's defaults are)
function extraLabel(k, x) {
  const stereo = /^stereo/.test(x.type);
  const fallback = `${k.label} ${stereo ? 'St ' : ''}${x.index}`;
  return x.name && !/^\d+$/.test(x.name) ? x.name : fallback; // dLive's default names are numbers
}
function primeExtras() {
  if (!extras) return;
  for (const k of EXTRA_KINDS) for (const x of extras[k.kind]) {
    if (k.fader) enqueuePrime(() => client && client.requestFader(x.coord));
    enqueuePrime(() => client && client.requestMute(x.coord));
  }
}
const consoleExtras = () => (extras ? EXTRA_KINDS.filter(k => extras[k.kind].length).map(k => ({ kind: k.kind, title: k.title, fader: k.fader, strips: extras[k.kind].map((x, i) => ({ n: i + 1, label: x.label })) })) : []);

// ── EQ and preamps ──────────────────────────────────────────────────────
// A mix's EQ for its musicians (Settings → Mixes → EQ, as on DiGiCo and
// LV1), and an input's preamp, high-pass filter and EQ in the Console
// Controller's channel panel. dLive's PEQ has four bands (0 the lowest),
// each a type, frequency, width and gain; its MIDI control has no EQ in/out.
// The phones number the bands 1 (low) to 4 (high); the channel panel, as
// on a DiGiCo, 1 (high) to 4 (low).
const eqCache = new Map();      // "midiCh:ch" -> { [param]: vv }
const preampCache = new Map();  // socket -> { gain, pad, phantom }
const lastWrite = new Map();    // "midiCh:ch:param" -> when JPMixer last set it (its echo isn't news)
const ECHO_MS = 600;
const coordKey = (c) => `${c.midiCh}:${c.ch}`;
const eqOf = (c) => { const k = coordKey(c); if (!eqCache.has(k)) eqCache.set(k, {}); return eqCache.get(k); };
const PHONE_FIELD = { gain: 'eq_gain', freq: 'eq_freq', width: 'eq_Q', type: 'eq_shape' };
function peqValue(field, vv) {
  if (field === 'gain') return P.vvToPeqGain(vv);
  if (field === 'freq') return P.vvToPeqFreq(vv);
  if (field === 'width') return P.vvToPeqQ(vv);
  return P.PEQ_TYPES[vv] || 'Bell';
}
function peqVv(field, v) {
  if (field === 'gain') return P.peqGainToVv(v);
  if (field === 'freq') return P.peqFreqToVv(v);
  return P.peqQToVv(v);
}
function requestEq(c, withHpf) {
  for (let band = 0; band < 4; band++) for (const field of ['type', 'freq', 'width', 'gain']) {
    const param = P.peqParam(band, field);
    enqueuePrime(() => client && client.requestParam(c, param));
  }
  if (withHpf) for (const param of [P.PARAM.HPF_ON, P.PARAM.HPF_FREQ]) enqueuePrime(() => client && client.requestParam(c, param));
  startPriming();
}
// One NRPN setting, written by JPMixer
function writeParam(c, param, vv) {
  eqOf(c)[param] = vv;
  lastWrite.set(`${coordKey(c)}:${param}`, Date.now());
  if (client) client.setParam(c, param, vv);
}

// The phones' EQ for a mix
function auxEqAllowed(aux) { return serverCfg.auxOverrides?.[String(aux)]?.eqEnabled === true && !!auxCoord(moduleBaseN, aux); }
function phoneEq(aux) {
  const c = auxCoord(moduleBaseN, aux);
  const eq = c ? eqCache.get(coordKey(c)) || {} : {};
  const out = {};
  for (let band = 0; band < 4; band++) {
    for (const field of ['gain', 'freq', 'width', 'type']) {
      const vv = eq[P.peqParam(band, field)];
      if (vv !== undefined) out[`${PHONE_FIELD[field]}_${band + 1}`] = peqValue(field, vv);
    }
  }
  return out;
}
function writePhoneEq(ws, aux, name, band, raw) {
  const field = { eq_gain: 'gain', eq_freq: 'freq', eq_Q: 'width' }[name];
  if (!field || !auxEqAllowed(aux) || !(band >= 1 && band <= 4) || typeof raw !== 'number' || !Number.isFinite(raw)) return;
  const c = auxCoord(moduleBaseN, aux);
  const vv = peqVv(field, raw);
  writeParam(c, P.peqParam(band - 1, field), vv);
  broadcastToClients({ address: `/Aux_Outputs/${aux}/EQ/${name}_${band}`, args: [peqValue(field, vv)] }, ws);
  ws._lastActivityAt = Date.now();
}

// The channel panel: which socket an input's preamp is (from Patch)
function pluginDataFolder() {
  try { return path.join(require('electron').app.getPath('userData'), 'plugin-data'); } catch (_) { return null; }
}
function socketsOf(ch) {
  const folder = pluginDataFolder();
  return folder ? dliveSockets.socketMap(folder).get(ch) || [] : [];
}
// The socket a channel's preamp can be set on: Patch's, while its name still
// fits the console's ({ sock } or { stale })
function preampSocket(ch) {
  const sock = socketsOf(ch)[0];
  if (!sock) return {};
  return dliveSockets.nameFits(sock.name, nameCache.get(`input:${ch}`)) ? { sock } : { stale: sock };
}
// The inputs a socket feeds (a socket can be patched to more than one)
function channelsOfSocket(socket) {
  const folder = pluginDataFolder();
  const out = [];
  if (!folder) return out;
  for (const [ch, list] of dliveSockets.socketMap(folder)) if (list.some(x => x.socket === socket) && ch <= inputCount()) out.push(ch);
  return out;
}
const panelBand = (p) => 4 - p; // panel band 1 (high) is dLive band 3
function channelDetail(ch) {
  const c = channelCoord(moduleBaseN, ch);
  const { sock, stale } = preampSocket(ch);
  const params = {}, values = {};
  if (sock) {
    const pre = preampCache.get(sock.socket) || {};
    params['Channel_Input/analog_gain'] = { kind: 'num', min: P.PREAMP_GAIN_MIN, max: P.PREAMP_GAIN_MAX, unit: 'dB', label: 'Preamp gain', section: 'input' };
    params['Channel_Input/pad'] = { kind: 'bool', label: 'Pad', section: 'input' };
    params['Channel_Input/phantom'] = { kind: 'bool', label: '48V', section: 'input' };
    if (pre.gain !== undefined) values['Channel_Input/analog_gain'] = pre.gain;
    if (pre.pad !== undefined) values['Channel_Input/pad'] = pre.pad ? 1 : 0;
    if (pre.phantom !== undefined) values['Channel_Input/phantom'] = pre.phantom ? 1 : 0;
  }
  const eq = (c && eqCache.get(coordKey(c))) || {};
  params['Filters/lo_filter_in'] = { kind: 'bool', label: 'High-pass', section: 'eq' };
  params['Filters/lo_filter_freq'] = { kind: 'num', min: P.HPF_FREQ_MIN, max: P.HPF_FREQ_MAX, unit: 'Hz', scale: 'log', label: 'High-pass frequency', section: 'eq' };
  if (eq[P.PARAM.HPF_ON] !== undefined) values['Filters/lo_filter_in'] = eq[P.PARAM.HPF_ON] >= 0x40 ? 1 : 0;
  if (eq[P.PARAM.HPF_FREQ] !== undefined) values['Filters/lo_filter_freq'] = P.vvToHpfFreq(eq[P.PARAM.HPF_FREQ]);
  for (let p = 1; p <= 4; p++) {
    params[`EQ/eq_gain_${p}`] = { kind: 'num', min: -P.PEQ_GAIN_MAX, max: P.PEQ_GAIN_MAX, unit: 'dB', label: 'Gain', section: 'eq', band: p };
    params[`EQ/eq_freq_${p}`] = { kind: 'num', min: P.PEQ_FREQ_MIN, max: P.PEQ_FREQ_MAX, unit: 'Hz', scale: 'log', label: 'Frequency', section: 'eq', band: p };
    params[`EQ/eq_Q_${p}`] = { kind: 'num', min: P.PEQ_Q_MIN, max: P.PEQ_Q_MAX, unit: 'Q', scale: 'log', label: 'Q', section: 'eq', band: p };
    params[`EQ/eq_shape_${p}`] = { kind: 'text', label: 'Shape', section: 'eq', band: p, readOnly: true };
    for (const field of ['gain', 'freq', 'width', 'type']) {
      const vv = eq[P.peqParam(panelBand(p), field)];
      if (vv !== undefined) values[`EQ/${PHONE_FIELD[field]}_${p}`] = peqValue(field, vv);
    }
  }
  let note;
  if (stale) note = `Patch has ${stale.where} as “${stale.name}”, but the console calls this channel “${nameCache.get(`input:${ch}`)}”: the console may have been re-patched since the show was imported. Import the show again in Settings → Plugins → Patch to set its preamp here.`;
  else if (!sock) note = 'JPMixer doesn’t know which socket this channel’s preamp is. Import the dLive show in Settings → Plugins → Patch to show its gain, pad and 48V here.';
  else {
    const others = channelsOfSocket(sock.socket).filter(n => n !== ch);
    note = `Preamp: ${sock.where}, from Patch.${others.length ? ` It also feeds ${others.map(n => `Ch ${n}`).join(', ')}.` : ''}`;
  }
  return { type: 'channel-detail', ch, params, values, note };
}
const panelsFor = (ch) => connections.filter(c => c._detailCh === ch && c.readyState === WebSocket.OPEN);
function toPanels(ch, path, value, except) {
  for (const conn of panelsFor(ch)) if (conn !== except) { try { conn.send(JSON.stringify({ address: `/Input_Channels/${ch}/${path}`, args: [value] })); } catch (_) {} }
}
function openChannelDetail(ws, ch) {
  ws._detailCh = ch;
  try { ws.send(JSON.stringify(channelDetail(ch))); } catch (_) {}
  const { sock } = preampSocket(ch);
  if (sock) {
    enqueuePrime(() => client && client.requestPreampGain(sock.socket));
    enqueuePrime(() => client && client.requestPad(sock.socket));
    enqueuePrime(() => client && client.requestPhantom(sock.socket));
  }
  const c = channelCoord(moduleBaseN, ch);
  if (c) requestEq(c, true);
}
// A change from the panel: to the console, and to the other panels on that channel
function writeChannelParam(ws, ch, path, raw) {
  const c = channelCoord(moduleBaseN, ch);
  if (!c || typeof path !== 'string' || typeof raw !== 'number' || !Number.isFinite(raw) || !client) return;
  if (path.startsWith('Channel_Input/')) {
    const { sock } = preampSocket(ch); // none, or a stale one: nothing goes to a preamp
    if (!sock) return;
    const pre = preampCache.get(sock.socket) || {};
    preampCache.set(sock.socket, pre);
    let value;
    if (path === 'Channel_Input/analog_gain') { value = Math.round(Math.max(P.PREAMP_GAIN_MIN, Math.min(P.PREAMP_GAIN_MAX, raw)) * 10) / 10; pre.gain = value; client.setPreampGain(sock.socket, value); }
    else if (path === 'Channel_Input/pad') { pre.pad = raw >= 0.5; value = pre.pad ? 1 : 0; client.setPad(sock.socket, pre.pad); }
    else if (path === 'Channel_Input/phantom') { pre.phantom = raw >= 0.5; value = pre.phantom ? 1 : 0; client.setPhantom(sock.socket, pre.phantom); }
    else return;
    lastWrite.set(`preamp:${sock.socket}:${path}`, Date.now());
    for (const n of new Set([ch, ...channelsOfSocket(sock.socket)])) toPanels(n, path, value, n === ch ? ws : null);
    logEvent('preamp', `${path.split('/')[1]} ${sock.where} → ${value}`);
    return;
  }
  if (path === 'Filters/lo_filter_in') { writeParam(c, P.PARAM.HPF_ON, raw >= 0.5 ? 0x7F : 0x3F); toPanels(ch, path, raw >= 0.5 ? 1 : 0, ws); return; }
  if (path === 'Filters/lo_filter_freq') { const vv = P.hpfFreqToVv(raw); writeParam(c, P.PARAM.HPF_FREQ, vv); toPanels(ch, path, P.vvToHpfFreq(vv), ws); return; }
  const m = /^EQ\/(eq_gain|eq_freq|eq_Q)_([1-4])$/.exec(path);
  if (!m) return;
  const field = { eq_gain: 'gain', eq_freq: 'freq', eq_Q: 'width' }[m[1]];
  const vv = peqVv(field, raw);
  writeParam(c, P.peqParam(panelBand(Number(m[2])), field), vv);
  toPanels(ch, path, peqValue(field, vv), ws);
}

// ── Pan on the stereo mixes ─────────────────────────────────────────────
// dLive's MIDI control has no pan for a send, so pan goes through the
// protocol dLive's own apps use (dlive-private.js). Everything about it is
// found by itself, as with the rest of the console: which mixes are stereo
// (the mix layout), and where each one is in the console's list of mixes,
// which every show lays out its own way: the groups, the mono auxes, the
// FX sends, then the stereo auxes, a stereo mix taking two places (seen on
// Director 2.12 with 10 groups, 2 mono and 24 stereo auxes, and on a
// MixRack with stereo groups and FX sends). Each mix's place is checked: its send
// levels there must be the ones MIDI reads. A mix whose levels disagree
// gets no pan, and a console that doesn't answer this protocol (an older
// or newer firmware) gets none at all. Inputs only; FX returns have none.
const panCache = new Map();    // "ch:aux" -> 0..1
const panLink = {
  client: null, ready: false,
  objects: new Map(),          // module name -> object id
  subs: new Map(),             // "pan|level:ch:aux" -> { obj, handle }
  byHandle: new Map(),         // handle -> { what, ch, aux }
  mixes: new Set(),            // auxes subscribed
  checked: new Map(),          // aux -> { ok: n, bad: n } (its place, checked against MIDI)
  privLevel: new Map(),        // "ch:aux" -> dB, as this protocol has it
  wrote: new Map(),            // "ch:aux" -> when JPMixer last set its pan
  stereoIn: new Map(),         // input -> true when it's half of a stereo pair (read on connect)
  placeOf: new Map(),          // aux -> the place it's subscribed and checked at
  searched: new Set(),         // auxes looked for at every place (findPlace), once each
  scan: new Map(),             // "ch:place" -> dB, the levels findPlace reads
};
// The right half of a stereo input: the console keeps the pair's sends and
// pans on the left one (the odd channel), and phones show the pair as it
const isRightHalf = (ch) => ch % 2 === 0 && panLink.stereoIn.get(ch) === true && panLink.stereoIn.get(ch - 1) === true;
const panChannel = (ch) => (isRightHalf(ch) ? ch - 1 : ch);
const panWanted = () => serverCfg.dlivePan !== false;
// A mix's place in the console's list of mixes (a stereo mix takes two: its
// left one), or null: the one it's checked at, or else the layout's guess
function mixPlace(aux) {
  if (panLink.placeOf.has(aux)) return panLink.placeOf.get(aux);
  const m = mixMap && mixMap[aux - 1];
  if (!m || !busLayout) return null;
  const i = m.stereo ? busLayout.firstStereoAux + 2 * m.rank : busLayout.firstMonoAux + m.rank;
  return i >= 0 && i < 64 ? i : null;
}
const panMixIndex = (aux) => (mixMap && mixMap[aux - 1] && mixMap[aux - 1].stereo ? mixPlace(aux) : null);
// This protocol for a mix: the link is up, its place is known, and hasn't been contradicted
function placeOk(aux) {
  if (!panWanted() || !panLink.ready || mixPlace(aux) === null) return false;
  const c = panLink.checked.get(aux);
  return !(c && c.bad > 0);
}
// Proven: at least one send at that place has the level MIDI reads, and
// none disagrees. Nothing goes to a mix's place before that: a wrong place
// would be someone else's mix (on a live console). A mix whose sends are all
// off has nothing to prove it, and gets none until one isn't.
// Proof is two channels matching at two different levels: one alone could
// be a neighbouring mix with the same level (many sends sit at 0 dB)
const placeProven = (aux) => {
  const c = panLink.checked.get(aux);
  return !!(c && c.bad === 0 && c.pending === 0 && c.matched.size >= 2 && new Set(c.matched.values()).size >= 2);
};
// Pan for this mix: a stereo one, its place proven
const panAvailable = (aux) => placeOk(aux) && placeProven(aux) && panMixIndex(aux) !== null;
function pushLayout() { if (wss) { const msg = JSON.parse(buildConfig()); msg.config.liveUpdate = true; broadcastToClients(msg); } }
async function panObject(ch) {
  const name = DP.inputModuleName(ch);
  if (panLink.objects.has(name)) return panLink.objects.get(name);
  const id = panLink.client ? await panLink.client.lookup(name) : null;
  if (id !== null) panLink.objects.set(name, id);
  return id;
}
// A mix's send levels from every input, to check its place, and its pans on a stereo mix
async function subscribeMix(auxRaw) {
  const aux = Number(auxRaw);
  if (!placeOk(aux) || panLink.mixes.has(aux)) return;
  panLink.mixes.add(aux);
  const idx = mixPlace(aux);
  panLink.placeOf.set(aux, idx);
  const kinds = panMixIndex(aux) !== null ? ['pan', 'level'] : ['level'];
  for (let ch = 1; ch <= inputCount(); ch++) {
    const obj = await panObject(ch);
    if (obj === null || !panLink.client || !panLink.ready) { panLink.mixes.delete(aux); return; }
    for (const what of kinds) {
      const key = `${what}:${ch}:${aux}`;
      if (panLink.subs.has(key)) continue;
      const handle = panLink.client.subscribe(obj, DP.inputParam(what, ch, idx));
      if (handle === null) continue;
      panLink.subs.set(key, { obj, handle });
      panLink.byHandle.set(handle, { what, ch, aux });
    }
  }
}
// The place of a mix, checked one send at a time: this protocol's level and
// MIDI's must agree (both off, or within a dB). A level that has just moved
// can reach one protocol before the other, so a disagreement only counts if
// it's still there a moment later.
const panRechecks = new Map(); // "ch:aux" -> timer
// MIDI's quietest send is -53 dB (the next step is off): anything quieter
// here reads as off there, so both count as off
const sendOff = (db) => !(db > -53.25);
function checkPanPlace(ch, aux, again = false) {
  const key = levelKey(ch, aux);
  if (isRightHalf(ch) || !panLink.privLevel.has(key) || !levelCache.has(key)) return; // a pair's right half has no sends of its own
  // A send muted by its level: MIDI's cache keeps the level to put back, the console has it off
  if (!muteBySendOff() && isSilenced(aux, ch)) return;
  // A send switched off: MIDI still reads its level, and this protocol may
  // or may not (Director's does), so it says nothing
  if (assignCache.get(key) === false) return;
  const a = panLink.privLevel.get(key), b = levelCache.get(key);
  const aOff = sendOff(a), bOff = sendOff(b);
  const c = panLink.checked.get(aux) || { bad: 0, pending: 0, matched: new Map() };
  panLink.checked.set(aux, c);
  if (aOff && bOff) return; // both off: says nothing
  if (aOff === bOff && Math.abs(a - b) <= 1) {
    const was = placeProven(aux);
    c.matched.set(ch, Math.round(b * 2) / 2);
    if (!was && placeProven(aux)) {
      logEvent('pan-layout', `mix ${aux}: place ${mixPlace(aux) + 1} checks out (${[...c.matched].map(([n, v]) => `ch ${n} ${v} dB`).join(', ')})`);
      scheduleLayoutPush();
      // The pans read while it was being proven
      if (panAvailable(aux)) for (const [k, v] of panCache) { const [pc, pa] = k.split(':').map(Number); if (pa === aux) broadcastToClients({ address: `/Input_Channels/${pc}/Aux_Send/${aux}/send_pan`, args: [v] }); }
    }
    return;
  }
  // A disagreement: MIDI is asked again (it may only not have caught up
  // with a change made elsewhere), and it counts only if it's still there.
  // While it's being looked at, nothing goes to that mix's place.
  if (!again) {
    if (panRechecks.has(key)) return;
    const wasProven = placeProven(aux);
    c.pending++;
    if (wasProven) scheduleLayoutPush();
    const input = sourceCoord(moduleBaseN, ch), snd = auxCoord(moduleBaseN, aux);
    if (input && snd) { requestSendLevel(ch, aux, input, snd); if (client) client.requestSendAssign(input, snd); }
    panRechecks.set(key, setTimeout(() => {
      panRechecks.delete(key);
      c.pending = Math.max(0, c.pending - 1);
      checkPanPlace(ch, aux, true);
      if (placeProven(aux) !== wasProven) scheduleLayoutPush();
    }, 2500));
    return;
  }
  c.matched.delete(ch);
  if (c.bad++ === 0) {
    logEvent('pan-layout', `mix ${aux}: channel ${ch}'s send is ${bOff ? 'off' : b.toFixed(1) + ' dB'} over MIDI but ${aOff ? 'off' : a.toFixed(1) + ' dB'} at place ${mixPlace(aux) + 1} — looking for the mix at the other places`);
    pushLayout();
    findPlace(aux, mixPlace(aux));
  }
}
// ── A mix whose place didn't check out, found by its send levels ────────
// The layout's guess (groups, then mono auxes, then stereo) is how
// Director lays out a show, but a console can have more before the auxes.
// Up to 3 of the mix's sends, at different levels, are read at every
// place; the one place where all of them have the levels MIDI reads (both
// halves, on a stereo mix) is the mix's, and it's checked there again send
// by send like any other. No place, or more than one, and the mix gets no
// pan, graphic EQ or compressor. Once per mix until the link reconnects.
const SCAN_SENDS = 3;
async function findPlace(aux, failedAt) {
  const m = mixMap && mixMap[aux - 1];
  if (!m || panLink.searched.has(aux) || !panLink.client || !panLink.ready) return;
  panLink.searched.add(aux);
  const link = panLink.client;
  const midiDb = (ch) => levelCache.get(levelKey(ch, aux));
  const picks = [], levels = new Set();
  for (const ch of mixChannels()) {
    if (picks.length >= SCAN_SENDS || ch > inputCount()) continue; // FX returns have no place here
    const db = midiDb(ch), r = Math.round(db);
    if (db === undefined || sendOff(db) || levels.has(r) || assignCache.get(levelKey(ch, aux)) === false || (!muteBySendOff() && isSilenced(aux, ch))) continue;
    levels.add(r); picks.push(ch);
  }
  const give = (why) => logEvent('pan-layout', `mix ${aux}: ${why} — no pan, graphic EQ or compressor on this mix until JPMixer reconnects`);
  if (picks.length < 2) { give('too few of its sends are up at different levels to look for it'); return; }
  for (const ch of picks) {
    const obj = await panObject(ch);
    if (obj === null || panLink.client !== link || !panLink.ready) return;
    for (let p = 0; p < 64; p++) {
      const key = `scan:${ch}:${p}`;
      if (panLink.subs.has(key)) continue;
      const handle = link.subscribe(obj, DP.inputParam('level', ch, p));
      if (handle === null) continue;
      panLink.subs.set(key, { obj, handle });
      panLink.byHandle.set(handle, { what: 'scan', ch, aux: p });
    }
  }
  const read = () => picks.every((ch) => Array.from({ length: 64 }, (_, p) => p).every((p) => panLink.scan.has(`${ch}:${p}`)));
  for (let i = 0; i < 50 && !read(); i++) await new Promise((r) => setTimeout(r, 100));
  if (panLink.client !== link || !panLink.ready || !panLink.searched.has(aux)) return; // forgotten meanwhile
  const fits = (ch, p) => { const a = panLink.scan.get(`${ch}:${p}`), b = midiDb(ch); return a !== undefined && b !== undefined && !sendOff(a) && Math.abs(a - b) <= 1; };
  const places = [];
  for (let p = 0; p < (m.stereo ? 63 : 64); p++) if (picks.every((ch) => fits(ch, p) && (!m.stereo || fits(ch, p + 1)))) places.push(p);
  if (places.length === 1 && places[0] === failedAt) { give(`its other sends fit place ${failedAt + 1}, so it's that one send that disagrees`); return; }
  if (places.length !== 1) { give(places.length ? `${places.length} places fit its sends` : 'no place fits its sends'); return; }
  logEvent('pan-layout', `mix ${aux}: found at place ${places[0] + 1} (the layout said ${failedAt + 1}); checking it there`);
  moveMix(aux, places[0]);
}
// A mix to its found place: what was read and checked at the old one goes
function moveMix(aux, place) {
  const ofAux = (key) => key.split(':').pop() === String(aux);
  for (const [key, t] of [...panRechecks]) if (ofAux(key)) { clearTimeout(t); panRechecks.delete(key); }
  for (const [key, sub] of [...panLink.subs]) if ((key.startsWith('pan:') || key.startsWith('level:')) && ofAux(key)) { panLink.subs.delete(key); panLink.byHandle.delete(sub.handle); }
  for (const map of [panLink.privLevel, panCache]) for (const key of [...map.keys()]) if (ofAux(key)) map.delete(key);
  panLink.checked.delete(aux); panLink.mixes.delete(aux); procs.delete(aux);
  panLink.placeOf.set(aux, place);
  subscribeMix(aux);
}
function onPanValue({ handle, value, bytes }) {
  const sub = panLink.byHandle.get(handle);
  if (!sub) return;
  if (sub.what === 'geq' || sub.what === 'comp') { onProcValue(sub, value); return; }
  if (sub.what === 'scan') { panLink.scan.set(`${sub.ch}:${sub.aux}`, DP.levelToDb(value)); return; }
  if (sub.what === 'stereo') {
    const was = panLink.stereoIn.get(sub.ch);
    panLink.stereoIn.set(sub.ch, DP.isStereoValue(value, bytes));
    if (was !== panLink.stereoIn.get(sub.ch)) { scheduleLayoutPush(); releaseRightHalf(sub.ch); } // the channel list changes
    return;
  }
  if (isRightHalf(sub.ch)) return; // its pair's left half carries it
  const key = levelKey(sub.ch, sub.aux);
  if (sub.what === 'level') { panLink.privLevel.set(key, DP.levelToDb(value)); checkPanPlace(sub.ch, sub.aux); return; }
  const slider = DP.panToSlider(value);
  panCache.set(key, slider);
  const wrote = panLink.wrote.get(key);
  if (wrote && Date.now() - wrote < 600) return; // JPMixer's own move
  if (panAvailable(sub.aux)) broadcastToClients({ address: `/Input_Channels/${sub.ch}/Aux_Send/${sub.aux}/send_pan`, args: [slider] });
}
// A stereo pair, checked against MIDI: the console links a pair, so its two
// halves always have the same send levels. Two that differ aren't a pair
// (whatever the flag said), and both show again.
// Only two readings close together count: a console that reports just the
// half that changed would otherwise be compared with an old reading.
const midiSends = new Map(); // "ch:sndMidiCh:sndCh" -> { db, at }, inputs only
function checkStereoPair(ch, snd, db) {
  midiSends.set(`${ch}:${snd}`, { db, at: Date.now() });
  if (midiSends.size > 20000) midiSends.clear();
  const left = ch % 2 === 1 ? ch : ch - 1, right = left + 1;
  if (!(panLink.stereoIn.get(left) && panLink.stereoIn.get(right))) return;
  const x = midiSends.get(`${left}:${snd}`), y = midiSends.get(`${right}:${snd}`);
  if (!x || !y || Math.abs(x.at - y.at) > 1500) return;
  const a = x.db, b = y.db;
  const aOff = !(a > -90), bOff = !(b > -90);
  if (aOff === bOff && (aOff || Math.abs(a - b) <= 0.5)) return;
  panLink.stereoIn.set(left, false); panLink.stereoIn.set(right, false);
  logEvent('stereo-inputs', `channels ${left} and ${right} have different send levels — not a stereo pair; both show`);
  scheduleLayoutPush();
}
// Which inputs are stereo pairs: asked for every input once the link is up
let layoutPushTimer = null;
function scheduleLayoutPush() { clearTimeout(layoutPushTimer); layoutPushTimer = setTimeout(() => { layoutPushTimer = null; pushLayout(); }, 300); }
async function readStereoInputs() {
  for (let ch = 1; ch <= inputCount(); ch++) {
    const obj = await panObject(ch);
    if (obj === null || !panLink.client || !panLink.ready) return;
    const key = `stereo:${ch}:0`;
    if (panLink.subs.has(key)) continue;
    const handle = panLink.client.subscribe(obj, DP.STEREO_PARAM(ch));
    if (handle === null) continue;
    panLink.subs.set(key, { obj, handle });
    panLink.byHandle.set(handle, { what: 'stereo', ch, aux: 0 });
  }
}
function writePan(chRaw, aux, slider) {
  if (!panAvailable(aux) || !(chRaw >= 1 && chRaw <= inputCount()) || !Number.isFinite(slider)) return false;
  const ch = panChannel(chRaw); // a stereo pair's pan is its left half's
  const sub = panLink.subs.get(`pan:${ch}:${aux}`);
  if (!sub || !panLink.client) { subscribeMix(aux); return false; }
  const val = Math.max(0, Math.min(1, slider));
  panCache.set(levelKey(ch, aux), val);
  panLink.wrote.set(levelKey(ch, aux), Date.now());
  return panLink.client.set(sub.obj, sub.handle, DP.inputParam('pan', ch, panMixIndex(aux)), DP.sliderToPan(val));
}
function startPanLink(host) {
  stopPanLink();
  if (!panWanted() || !host) return;
  const link = new DP.DlivePrivate({ host });
  panLink.client = link;
  // A link that keeps dropping within seconds (the console's UDP ping not
  // getting through, a firewall, say) is given up on, rather than every
  // phone's layout changing every few seconds
  let since = 0, quickDrops = 0;
  link.on('connect', async () => {
    if (panLink.client !== link) return;
    since = Date.now();
    // Up when the console answers for its first input module
    const id = await link.lookup(DP.inputModuleName(1));
    if (panLink.client !== link) return;
    if (id === null) { logEvent('pan-link', 'connected, but the console didn\'t answer for its inputs — no pan'); return; }
    panLink.objects.set(DP.inputModuleName(1), id);
    panLink.ready = true;
    logEvent('pan-link', 'up — pan on the stereo mixes');
    pushLayout();
    readStereoInputs();
    for (const aux of Object.keys(getActiveMixerCounts()).map(Number)) subscribeMix(aux);
  });
  link.on('close', () => {
    if (panLink.client !== link) return;
    const was = panLink.ready;
    resetPanLink();
    quickDrops = since && Date.now() - since < 20000 ? quickDrops + 1 : 0;
    if (quickDrops >= 3) {
      logEvent('pan-link', 'keeps dropping a few seconds after connecting — the console\'s UDP ping may be blocked by this computer\'s firewall. Pan, graphic EQ and compressor are off until JPMixer restarts.');
      link.removeAllListeners(); link.disconnect(); panLink.client = null;
      if (was) pushLayout();
      return;
    }
    if (was) { logEvent('pan-link', 'down — pan comes back when it reconnects'); pushLayout(); }
  });
  link.on('value', onPanValue);
  link.connect();
}
// ── A mix's graphic EQ and compressor (dLive's own app protocol) ─────────
// As dLive4You offers them to a musician: the graphic EQ's 28 bands and its
// in/out, the compressor's threshold and in/out. Allowed by the same switch
// as the mix's EQ (Settings → Aux mixes → EQ), on a mix whose place checks
// out. The phones' addresses:
//   /Aux_Outputs/<aux>/GEQ/geq_in, /GEQ/geq_gain_<1-28> (dB)
//   /Aux_Outputs/<aux>/Comp/comp_in, /Comp/comp_thresh (dB)
const procs = new Map(); // aux -> { geq, comp: { obj, handles: Map(param -> handle), values: Map(param -> value) } | null, ready }
const PROC_PARAMS = { geq: [DP.GEQ.IN, ...Array.from({ length: DP.GEQ.BANDS }, (_, i) => DP.GEQ.FIRST_BAND + i)], comp: [DP.COMP.IN, DP.COMP.THRESH] };
const procAllowed = (aux) => placeOk(aux) && placeProven(aux) && serverCfg.auxOverrides?.[String(aux)]?.eqEnabled === true;
function procAvailable(aux, kind) {
  if (!procAllowed(aux)) return false;
  const p = procs.get(aux);
  return !(p && p.ready && !p[kind]); // not known yet, or found
}
async function ensureProcs(aux) {
  if (!procAllowed(aux) || procs.has(aux)) return procs.get(aux);
  const p = { geq: null, comp: null, ready: false };
  procs.set(aux, p);
  const place = mixPlace(aux);
  for (const kind of ['geq', 'comp']) {
    const obj = panLink.client ? await panLink.client.lookup(DP.mixObjectName(kind, place)) : null;
    if (obj === null || !panLink.client) continue;
    const x = { obj, handles: new Map(), values: new Map() };
    for (const param of PROC_PARAMS[kind]) {
      const handle = panLink.client.subscribe(obj, param);
      if (handle === null) continue;
      x.handles.set(param, handle);
      panLink.byHandle.set(handle, { what: kind, aux, param });
    }
    p[kind] = x;
  }
  p.ready = true;
  if (!p.geq || !p.comp) { logEvent('mix-processing', `mix ${aux}: ${!p.geq ? 'no graphic EQ' : ''}${!p.geq && !p.comp ? ', ' : ''}${!p.comp ? 'no compressor' : ''} at place ${place + 1}`); pushLayout(); }
  return p;
}
// One setting as the phones have it: the address and value
function procMessage(aux, kind, param, value) {
  if (kind === 'geq') {
    if (param === DP.GEQ.IN) return { address: `/Aux_Outputs/${aux}/GEQ/geq_in`, args: [value ? 1 : 0] };
    return { address: `/Aux_Outputs/${aux}/GEQ/geq_gain_${param - DP.GEQ.FIRST_BAND + 1}`, args: [DP.levelToDb(value === 0 ? 0x8000 : value)] };
  }
  if (param === DP.COMP.IN) return { address: `/Aux_Outputs/${aux}/Comp/comp_in`, args: [value ? 1 : 0] };
  return { address: `/Aux_Outputs/${aux}/Comp/comp_thresh`, args: [DP.levelToDb(value === 0 ? 0x8000 : value)] };
}
function onProcValue(sub, value) {
  const p = procs.get(sub.aux), x = p && p[sub.what];
  if (!x) return;
  x.values.set(sub.param, value);
  const wrote = panLink.wrote.get(`${sub.what}:${sub.aux}:${sub.param}`);
  if (wrote && Date.now() - wrote < 600) return; // JPMixer's own move
  if (procAvailable(sub.aux, sub.what)) broadcastToClients(procMessage(sub.aux, sub.what, sub.param, value));
}
function procState(aux) {
  const p = procs.get(aux), out = {};
  for (const kind of ['geq', 'comp']) {
    const x = p && p[kind];
    if (!x || !procAvailable(aux, kind)) continue;
    for (const [param, value] of x.values) { const m = procMessage(aux, kind, param, value); out[m.address.split('/').slice(3).join('/')] = m.args[0]; }
  }
  return out;
}
// A phone's change: to the console, and to the other phones on that mix
function writeProc(ws, aux, kind, name, raw) {
  if (!procAvailable(aux, kind) || typeof raw !== 'number' || !Number.isFinite(raw)) return;
  const p = procs.get(aux), x = p && p[kind];
  if (!x || !panLink.client) return;
  let param, value, bytes = 2;
  if (name === 'geq_in' || name === 'comp_in') { param = kind === 'geq' ? DP.GEQ.IN : DP.COMP.IN; value = raw >= 0.5 ? 1 : 0; bytes = 1; }
  else if (kind === 'geq') {
    const m = /^geq_gain_(\d+)$/.exec(name), band = m ? parseInt(m[1], 10) : 0;
    if (!(band >= 1 && band <= DP.GEQ.BANDS)) return;
    param = DP.GEQ.FIRST_BAND + band - 1;
    value = DP.dbToValue(Math.max(-DP.GEQ.MAX, Math.min(DP.GEQ.MAX, raw)));
  } else if (name === 'comp_thresh') { param = DP.COMP.THRESH; value = DP.dbToValue(Math.max(DP.COMP.MIN, Math.min(DP.COMP.MAX, raw))); }
  else return;
  const handle = x.handles.get(param);
  if (handle === undefined) return;
  x.values.set(param, value);
  panLink.wrote.set(`${kind}:${aux}:${param}`, Date.now());
  panLink.client.set(x.obj, handle, param, value, bytes);
  broadcastToClients(procMessage(aux, kind, param, value), ws);
  ws._lastActivityAt = Date.now();
}

// Everything known about where the mixes are: forgotten when the link opens
// again or the console's mix layout is read again (a changed bus layout
// moves them), so nothing goes to a place before it's proven again
function forgetPlaces() {
  for (const t of panRechecks.values()) clearTimeout(t);
  panRechecks.clear();
  panLink.checked.clear();
  procs.clear();
  for (const [key, sub] of [...panLink.subs]) if (!key.startsWith('stereo:')) { panLink.subs.delete(key); panLink.byHandle.delete(sub.handle); }
  for (const [h, sub] of [...panLink.byHandle]) if (sub.what === 'geq' || sub.what === 'comp') panLink.byHandle.delete(h);
  panLink.mixes.clear();
  panLink.privLevel.clear();
  panLink.placeOf.clear(); panLink.searched.clear(); panLink.scan.clear();
  panCache.clear();
}
function resetPanLink() {
  forgetPlaces();
  midiSends.clear();
  panLink.ready = false;
  panLink.objects.clear(); panLink.subs.clear(); panLink.byHandle.clear(); panLink.mixes.clear();
  panLink.privLevel.clear(); panLink.wrote.clear();
  clearTimeout(layoutPushTimer); layoutPushTimer = null;
}
function stopPanLink() {
  const link = panLink.client;
  panLink.client = null;
  if (link) { link.removeAllListeners(); link.disconnect(); }
  resetPanLink();
  panLink.checked.clear();
  panLink.stereoIn.clear();
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
  const queue = [];
  // Every input, a stereo pair's right half too: only read, so its levels
  // keep checking that it is one (checkStereoPair)
  for (const aux of activeAuxes) {
    for (let ch = 1; ch <= inputCount(); ch++) queue.push({ ch, aux });
    for (const ch of fxReturnChannels()) queue.push({ ch, aux });
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
  pacer.write(`lvl:${ch}:${aux}`, () => sendLevelNow(ch, aux, inputCoord, sendCoord, db), urgent);
}

// Sends a write couldn't get to the desk (the link was down): sent again from
// levelCache on reconnect. An unmute during a drop used to leave the desk at
// -∞ while the phone showed the channel on (only mutes were re-sent).
const unsentLevels = new Set(); // levelKey
const levelWrites = new Map(); // "ch:aux" -> when JPMixer last wrote it
function sendLevelNow(ch, aux, inputCoord, sendCoord, db) {
  const key = levelKey(ch, aux);
  levelWrites.set(key, Date.now());
  if (levelWrites.size > 5000) levelWrites.clear();
  if (client && client.setSendLevel(inputCoord, sendCoord, db)) unsentLevels.delete(key);
  else unsentLevels.add(key);
}
// ── A send's own on/off (mute by send off, below) ──
const assignCache = new Map();  // "ch:aux" -> the send's on/off, as the console last said
const ownAssign = new Map();    // "ch:aux" -> the console's own on/off from before JPMixer switched it off
const unsentAssign = new Map(); // "ch:aux" -> an on/off a write couldn't get to the desk
function sendAssignNow(ch, aux, src, snd, on) {
  const key = levelKey(ch, aux);
  if (client && client.setSendAssign(src, snd, on)) { unsentAssign.delete(key); assignCache.set(key, on); }
  else unsentAssign.set(key, on);
}
// The wanted on/off is noted at once, not when its turn comes: a solo let go
// (or an unmute and a mute again) while the writes are still queued has to
// see what's on its way, and replace it (the pacer keeps a key's latest)
const assignWrites = new Map(); // "ch:aux" -> { on, at }: JPMixer's latest, for after a reconnect
function pacedSendAssign(ch, aux, src, snd, on, urgent) {
  const key = levelKey(ch, aux);
  assignCache.set(key, on);
  assignWrites.set(key, { on, at: Date.now() });
  pacer.write(`asg:${ch}:${aux}`, () => sendAssignNow(ch, aux, src, snd, on), urgent);
}

// A link that died without closing took the writes of its last seconds with
// it (they looked sent): the ones from the last 90 s go again on reconnect
const RESEND_MS = 90000;
function resendRecent(baseN) {
  const since = Date.now() - RESEND_MS;
  for (const [key, at] of levelWrites) {
    if (at < since || !levelCache.has(key)) continue;
    const [ch, aux] = key.split(':').map(Number);
    if (!muteBySendOff() && isSilenced(aux, ch)) continue; // reassertSilencing sends those
    const input = sourceCoord(baseN, ch), snd = auxCoord(baseN, aux);
    if (input && snd) pacedSendLevel(ch, aux, input, snd, levelCache.get(key), true);
  }
  for (const [key, w] of assignWrites) {
    if (w.at < since || !w.on) continue; // offs: reassertSilencing
    const [ch, aux] = key.split(':').map(Number);
    if (isSilenced(aux, ch)) continue;
    const input = sourceCoord(baseN, ch), snd = auxCoord(baseN, aux);
    if (input && snd) pacedSendAssign(ch, aux, input, snd, true, true);
  }
}
function resendUnsentLevels(baseN) {
  for (const key of [...unsentLevels]) {
    unsentLevels.delete(key);
    const [ch, aux] = key.split(':').map(Number);
    if ((!muteBySendOff() && isSilenced(aux, ch)) || !levelCache.has(key)) continue; // reassertSilencing() sends the silenced ones
    const input = sourceCoord(baseN, ch), snd = auxCoord(baseN, aux);
    if (input && snd) pacedSendLevel(ch, aux, input, snd, levelCache.get(key), true);
  }
  // Send on/offs that didn't get there, if they're still what's wanted
  for (const [key, on] of [...unsentAssign]) {
    unsentAssign.delete(key);
    const [ch, aux] = key.split(':').map(Number);
    if (on === isSilenced(aux, ch)) continue; // muted again (or unmuted) since
    const input = sourceCoord(baseN, ch), snd = auxCoord(baseN, aux);
    if (input && snd) pacedSendAssign(ch, aux, input, snd, on, true);
  }
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
    const inputCoord = ch > FX_BASE ? sourceCoord(baseN, ch) : channelCoord(baseN, ch), sendCoord = auxCoord(baseN, aux);
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
      // A stereo mix gets pan when the console's own app protocol is up and
      // the mix's place checks out (see panAvailable)
      stereo:    panAvailable(i),
      colour:    ov.colour || colourCache.get(`aux:${i}`) || '#e8a020',
      icon:      '',
      eqEnabled: auxEqAllowed(i), // the mix's own PEQ on the console, when Settings allows it
      // Its graphic EQ and compressor, through dLive's own app protocol (same switch)
      geqEnabled: procAvailable(i, 'geq'),
      compEnabled: procAvailable(i, 'comp'),
      linkOnly:  ov.linkOnly === true,
      groups:    shared.auxGroupNames(ov, serverCfg),
    });
  }

  // The inputs, then any FX returns in the mixes (channel 129 on)
  // A stereo input is one channel, its left half (the console links the
  // pair: a move on either is a move on both)
  const channels = shared.buildChannelList(Math.min(128, chCount), serverCfg, i => (i > FX_BASE ? fxReturnName(i) : nameCache.get(`input:${i}`)), fxReturnChannels(), isRightHalf);

  return JSON.stringify({
    config: {
      channels,
      aux: auxilaries,
      controlGroups: getControlGroups(),
      channelProcessing: 'preamp-eq', // the Console Controller's channel panel: preamp (from Patch's socket), high-pass and PEQ
      consoleExtras: consoleExtras(), // FX returns and sends, groups, matrices, mains and mute groups
      auxEqQ: [P.PEQ_Q_MIN, P.PEQ_Q_MAX], // the phone EQ panel's Q slider covers dLive's widths
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

// ── Mute and solo in a musician's mix ──────────────────────────────────
// Two ways, Settings → Console → dLive (dliveMuteBySendOff):
//   - Send off (the default): the console's own on/off for the send. The
//     level stays on the console the whole time, so nothing has to be put
//     back, and a send left off (JPMixer closed mid-mute, say) is one the
//     engineer switches on again with its level as it was. A send the
//     console already had off stays off when it's unmuted.
//   - Level: the send goes to -∞ and its level is put back after, as on
//     DiGiCo. Kept for a console that doesn't take the send on/off.
const muteBySendOff = () => serverCfg.dliveMuteBySendOff !== false;
function applyMuteSolo(baseN, aux) {
  if (muteBySendOff()) { applyMuteSoloBySendOff(baseN, aux); return; }
  const anySolo = Object.values(soloState[aux] || {}).some(v => v);
  if (!premuteState[aux]) premuteState[aux] = {};
  const restoredLevels = {};
  const snd = auxCoord(baseN, aux);
  // Settings' generic Auxes field allows up to 64, but dLive's mono aux pool
  // tops out at 62 — a misconfigured count shouldn't crash the server.
  if (!snd) { logEvent('coord-error', `aux ${aux} is out of dLive's addressable range — skipping mute/solo`); return; }

  for (const ch of mixChannels()) {
    const key = levelKey(ch, aux);
    const muted = !!(muteState[aux]?.[ch]);
    const soloed = !!(soloState[aux]?.[ch]);
    const silenced = muted || (anySolo && !soloed);
    const inputCoord = sourceCoord(baseN, ch);
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

function applyMuteSoloBySendOff(baseN, aux) {
  const snd = auxCoord(baseN, aux);
  if (!snd) { logEvent('coord-error', `aux ${aux} is out of dLive's addressable range — skipping mute/solo`); return; }
  for (const ch of mixChannels()) {
    const src = sourceCoord(baseN, ch);
    if (src) sendOffFor(ch, aux, src, snd);
  }
  if (primeQueue.length) startPriming();
  broadcastToClients({ type: 'mute-solo-state', aux, mutes: muteState[aux] || {}, solos: soloState[aux] || {}, levels: {} });
}
// One send: off while it's silenced, keeping the console's own on/off; that
// back after. A send whose on/off isn't known yet is asked for first (the
// answer comes back through here).
function sendOffFor(ch, aux, src, snd) {
  const key = levelKey(ch, aux);
  if (isSilenced(aux, ch)) {
    if (!ownAssign.has(key)) {
      if (!assignCache.has(key)) { enqueuePrime(() => client && client.requestSendAssign(src, snd)); return; }
      ownAssign.set(key, assignCache.get(key));
    }
    if (ownAssign.get(key) && assignCache.get(key) !== false) pacedSendAssign(ch, aux, src, snd, false, true);
  } else if (ownAssign.has(key)) {
    const own = ownAssign.get(key);
    ownAssign.delete(key);
    if (own && assignCache.get(key) !== true) pacedSendAssign(ch, aux, src, snd, true, true);
  }
}

// Every mute and solo phones made, put back on the console (with the mix
// layout as it was), and forgotten: before a changed layout is used
function releaseAllSilencing(baseN) {
  const auxes = new Set([...Object.keys(muteState), ...Object.keys(soloState), ...Object.keys(premuteState)].map(Number));
  for (const aux of auxes) {
    const snd = auxCoord(baseN, aux);
    if (!snd || !client) continue;
    for (const [ch, db] of Object.entries(premuteState[aux] || {})) { const input = sourceCoord(baseN, Number(ch)); if (input) client.setSendLevel(input, snd, db); }
  }
  for (const [key, own] of ownAssign) {
    if (!own || !client) continue;
    const [ch, aux] = key.split(':').map(Number);
    const input = sourceCoord(baseN, ch), snd = auxCoord(baseN, aux);
    if (input && snd) client.setSendAssign(input, snd, true);
  }
  clearMuteSolo();
  for (const aux of auxes) broadcastToClients({ type: 'mute-solo-state', aux, mutes: {}, solos: {}, levels: {} });
}
// A channel found to be a stereo pair's right half: a mute or solo a phone
// set on it before that was known is let go (it would hold the pair off)
function releaseRightHalf(ch) {
  if (!isRightHalf(ch)) return;
  for (const aux of new Set([...Object.keys(muteState), ...Object.keys(soloState)].map(Number))) {
    const wasMuted = muteState[aux]?.[ch], wasSoloed = soloState[aux]?.[ch];
    const key = levelKey(ch, aux), snd = auxCoord(moduleBaseN, aux), input = sourceCoord(moduleBaseN, ch) || channelCoord(moduleBaseN, ch);
    if (muteState[aux]) delete muteState[aux][ch];
    if (soloState[aux]) delete soloState[aux][ch];
    if (ownAssign.get(key) && input && snd) pacedSendAssign(ch, aux, input, snd, true, true);
    ownAssign.delete(key);
    if (premuteState[aux] && premuteState[aux][ch] !== undefined && input && snd) { pacedSendLevel(ch, aux, input, snd, premuteState[aux][ch], true); delete premuteState[aux][ch]; }
    if (wasMuted || wasSoloed) applyMuteSolo(moduleBaseN, aux); // a solo elsewhere: the rest of the mix as it should be
  }
}

function clearMuteSolo() {
  Object.keys(muteState).forEach(k => delete muteState[k]);
  Object.keys(soloState).forEach(k => delete soloState[k]);
  Object.keys(premuteState).forEach(k => delete premuteState[k]);
  ownAssign.clear();
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
    for (const ch of mixChannels()) {
      if (!isSilenced(aux, ch)) continue;
      const input = sourceCoord(baseN, ch);
      if (!input) continue;
      if (!muteBySendOff()) pacedSendLevel(ch, aux, input, snd, -Infinity, true);
      else if (ownAssign.get(levelKey(ch, aux))) pacedSendAssign(ch, aux, input, snd, false, true);
    }
  }
}

function setMute(auxRaw, chRaw, muted) {
  const aux = parseInt(auxRaw, 10), ch = parseInt(chRaw, 10);
  if (isNaN(aux) || aux < 1 || aux > auxCountNow() || !isMixChannel(ch)) return false;
  if (!muteState[aux]) muteState[aux] = {};
  muteState[aux][ch] = !!muted;
  applyMuteSolo(moduleBaseN, aux);
  return true;
}

function setSolo(auxRaw, chRaw, soloed) {
  const aux = parseInt(auxRaw, 10), ch = parseInt(chRaw, 10);
  if (isNaN(aux) || aux < 1 || aux > auxCountNow() || !isMixChannel(ch)) return false;
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

    const inputCoord = snd ? sourceCoord(baseN, ch) : null;
    // Only cache/send once both coordinates actually resolved — ch/aux are
    // also client-controlled and unbounded (no upper limit on the object's
    // keys), so caching before this check let an out-of-range pair pollute
    // levelCache with an entry nothing ever clears.
    if (!inputCoord) continue;
    levelCache.set(levelKey(ch, aux), db);
    if (silenced && !muteBySendOff()) {
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

let mixProbeTimer = null, mixProbeFinishTimer = null;
function startMixProbe(baseN, again = false) {
  clearInterval(mixProbeTimer);
  clearTimeout(mixProbeFinishTimer); mixProbeFinishTimer = null;
  const probe = mixProbe = { mono: new Map(), stereo: new Map(), groups: { mono: new Set(), stereo: new Set() }, fx: { mono: new Set(), stereo: new Set() }, again };
  // The groups and FX sends too: they come before the auxes in the
  // console's list of mixes, which the pan on a stereo mix needs (see mixPlace)
  const slots = [...Array.from({ length: 62 }, (_, i) => P.coordinate(baseN, 'monoAux', i + 1)), ...Array.from({ length: 31 }, (_, i) => P.coordinate(baseN, 'stereoAux', i + 1)),
    ...Array.from({ length: 62 }, (_, i) => P.coordinate(baseN, 'monoGroup', i + 1)), ...Array.from({ length: 31 }, (_, i) => P.coordinate(baseN, 'stereoGroup', i + 1)),
    ...Array.from({ length: 16 }, (_, i) => P.coordinate(baseN, 'monoFxSend', i + 1)), ...Array.from({ length: 16 }, (_, i) => P.coordinate(baseN, 'stereoFxSend', i + 1))];
  mixProbeTimer = setInterval(() => {
    const c = slots.shift();
    if (c) { if (client) client.requestName(c); return; }
    clearInterval(mixProbeTimer); mixProbeTimer = null;
    // The last answers. Only this probe's: a restart in these 600 ms used to
    // have the old probe finish the new one early, with a partial mix list
    mixProbeFinishTimer = setTimeout(() => { mixProbeFinishTimer = null; if (mixProbe === probe) finishMixProbe(baseN); }, 600);
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
    const next = [...mono.map((n, rank) => ({ stereo: false, n, rank })), ...stereo.map((n, rank) => ({ stereo: true, n, rank }))];
    const same = (x, y) => x && y && x.length === y.length && x.every((m, i) => m.stereo === y[i].stereo && m.n === y[i].n);
    if (mixMap && !same(mixMap, next)) {
      // Fewer mixes than before: maybe only a reply that didn't come. Asked again before it's believed.
      if (next.length < mixMap.length && !probe.again) { logEvent('mix-layout', `${next.length} mixes, ${mixMap.length} before — asking again`); startMixProbe(baseN, true); return; }
      // The console's mixes changed (a new show, or a changed bus layout):
      // JPMixer's mix numbers now mean other mixes, so every mute and solo
      // JPMixer made goes back first, on the mixes they were made on
      logEvent('mix-layout', `the console's mixes changed (${mixMap.length} → ${next.length}): phones' mutes and solos are put back, and the mixes start fresh`);
      releaseAllSilencing(baseN);
      levelCache.clear(); assignCache.clear(); assignWrites.clear(); levelWrites.clear();
    }
    mixMap = next;
    // Where the auxes are in the console's list of mixes (a stereo mix takes
    // two places): the groups, the mono auxes, the FX sends, then the stereo
    // auxes. Measured on a MixRack whose show has 4 stereo groups, 2 mono
    // auxes, 4 stereo FX sends and 15 stereo auxes (2026-10-29); where mono
    // FX sends go isn't known (with the stereo ones is a guess). A mix that
    // isn't there is looked for (findPlace)
    const groups = probe.groups.mono.size + 2 * probe.groups.stereo.size;
    const fx = probe.fx.mono.size + 2 * probe.fx.stereo.size;
    busLayout = { firstMonoAux: groups, firstStereoAux: groups + mono.length + fx };
    forgetPlaces(); // every mix's place is proven again on this layout
    logEvent('mix-layout', `${mono.length} mono + ${stereo.length} stereo aux mixes (${probe.groups.mono.size} mono + ${probe.groups.stereo.size} stereo groups, ${probe.fx.mono.size} mono + ${probe.fx.stereo.size} stereo FX sends; mono auxes from place ${busLayout.firstMonoAux + 1}, stereo from ${busLayout.firstStereoAux + 1})`);
    mixMap.forEach((m, i) => {
      nameCache.set(`aux:${i + 1}`, (m.stereo ? probe.stereo : probe.mono).get(m.n));
      const c = auxCoord(baseN, i + 1);
      if (c) enqueuePrime(() => client && client.requestColour(c));
    });
  }
  startPriming();
  rebuildSendLevelPollQueue();
  if (wss) { const msg = JSON.parse(buildConfig()); msg.config.liveUpdate = true; broadcastToClients(msg); }
  // Phones already on a mix: its places can be read now (before the layout, they couldn't)
  for (const aux of Object.keys(getActiveMixerCounts()).map(Number)) subscribeMix(aux);
}

// ── Server lifecycle ───────────────────────────────────────────────────────

function start(cfg) {
  serverCfg = cfg;
  connections = [];
  currentSceneNumber = null;
  levelCache.clear();
  unsentLevels.clear();
  requestedSendLevels.clear();
  pacer.clear();
  nameCache.clear();
  colourCache.clear();
  consoleState.clear(); consolePrimed = false;
  mixMap = null; mixProbe = null; busLayout = null;
  panCache.clear();
  assignCache.clear(); unsentAssign.clear(); assignWrites.clear(); levelWrites.clear();
  extras = null; extraProbe = null; extrasByCoord.clear();
  eqCache.clear(); preampCache.clear(); lastWrite.clear();
  clearMuteSolo();

  // 0-11 per the console's own Utility → Control → MIDI setting — coordinate()
  // enforces this range for every channel/aux lookup, but buildSceneRecall()
  // bit-ORs baseN into a MIDI status byte without any range check of its own
  // (scene recall doesn't go through coordinate() at all), so an out-of-range
  // value here would silently corrupt the status byte instead of erroring.
  const baseN = Number.isInteger(cfg.dliveBaseChannel) ? Math.max(0, Math.min(11, cfg.dliveBaseChannel)) : 0;
  moduleBaseN = baseN;

  const appExpress = express();
  access.mountOneTimeLinks(appExpress); // a browser opened from Settings: this computer's pass
  appExpress.use(express.static(path.join(__dirname, '..', 'mixer')));
  mountGreenRoom(appExpress);
  mountBranding(appExpress);
  mountPerformerAssignments(appExpress);
  mountFoh(appExpress, { isConsoleConnected, getConnectionCount });

  const diagOnly = (req, res, next) => {
    // This computer's pass, not its address: the port 80 helper connects from it
    if (access.fromThisComputer(req)) return next();
    res.status(403).json({ error: 'Diagnostic endpoints only open from JPMixer on this computer' });
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
        const pans = panAvailable(parseInt(msg.aux, 10));
        for (const ch of mixChannels()) {
          const key = levelKey(ch, msg.aux);
          if (levelCache.has(key)) {
            const address = `/Input_Channels/${ch}/Aux_Send/${msg.aux}/send_level`;
            ws.send(JSON.stringify({ address, args: [levelCache.get(key)] }));
          }
          if (pans && panCache.has(key)) ws.send(JSON.stringify({ address: `/Input_Channels/${ch}/Aux_Send/${msg.aux}/send_pan`, args: [panCache.get(key)] }));
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
        if (ws._activeAux) subscribeMix(ws._activeAux); // its pans, on a stereo mix
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
        // Its pans, on a stereo mix that has them
        const pans = {};
        const aux = parseInt(msg.aux, 10);
        if (panAvailable(aux)) {
          for (const [chStr, val] of Object.entries(msg.pans || {})) {
            const ch = parseInt(chStr, 10);
            if (Number.isFinite(val) && val >= 0 && val <= 1 && writePan(ch, aux, val)) pans[chStr] = val;
          }
        }
        broadcastToClients({ type: 'preset-loaded', aux: msg.aux, name: msg.name, levels, pans });
        return;
      }

      if (msg.type === 'request-aux-eq') {
        // What's known now, then the console's (its answers reach every phone on that mix)
        const aux = parseInt(msg.aux, 10);
        const allowed = auxEqAllowed(aux);
        try { ws.send(JSON.stringify({ type: 'aux-eq', aux: msg.aux, eq: allowed ? phoneEq(aux) : {} })); } catch (_) {}
        if (allowed) requestEq(auxCoord(baseN, aux), false);
        return;
      }

      if (msg.type === 'request-aux-dyn') {
        // A mix's graphic EQ and compressor: what's known, then the console's answers as they come
        const aux = parseInt(msg.aux, 10);
        ensureProcs(aux).then(() => { try { ws.send(JSON.stringify({ type: 'aux-dyn', aux: msg.aux, values: procState(aux), geq: procAvailable(aux, 'geq'), comp: procAvailable(aux, 'comp') })); } catch (_) {} });
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
      if (msg.type === 'extra-fader' && EXTRA_BY_KIND[msg.kind]) { consoleWrite(ws, baseN, msg.kind, msg.n, 'fader', msg.db); return; }
      if (msg.type === 'extra-mute' && EXTRA_BY_KIND[msg.kind])  { consoleWrite(ws, baseN, msg.kind, msg.n, 'mute', msg.muted); return; }
      if (msg.type === 'request-channel-detail') {
        const ch = parseInt(msg.ch, 10);
        // Always answered, so the panel never waits
        if (!(ch >= 1 && ch <= inputCount())) {
          try { ws.send(JSON.stringify({ type: 'channel-detail', ch: msg.ch, params: {}, values: {}, note: 'dLive has no channel by that number.' })); } catch (_) {}
          return;
        }
        openChannelDetail(ws, ch);
        return;
      }
      // The panel was closed: no more of that channel's changes to this screen
      if (msg.type === 'close-channel-detail') { ws._detailCh = null; return; }
      if (msg.type === 'console-param') {
        const ch = parseInt(msg.ch, 10);
        if (ch >= 1 && ch <= inputCount()) writeChannelParam(ws, ch, msg.path, msg.value);
        return;
      }

      // Raw OSC-address-shaped messages from mixer.js (send_level / send_pan)
      const oscMsg = msg;
      if (!oscMsg.address) return;
      // A musician's graphic EQ and compressor for their mix
      const dynm = oscMsg.address.match(/^\/Aux_Outputs\/(\d+)\/(GEQ|Comp)\/((?:geq|comp)_[a-z]+(?:_\d+)?)$/);
      if (dynm) { writeProc(ws, parseInt(dynm[1], 10), dynm[2] === 'GEQ' ? 'geq' : 'comp', dynm[3], Array.isArray(oscMsg.args) ? oscMsg.args[0] : undefined); return; }
      // A musician's EQ for their mix (the mix's own PEQ)
      const eqm = oscMsg.address.match(/^\/Aux_Outputs\/(\d+)\/EQ\/(eq_gain|eq_freq|eq_Q)_(\d)$/);
      if (eqm) { writePhoneEq(ws, parseInt(eqm[1], 10), eqm[2], parseInt(eqm[3], 10), Array.isArray(oscMsg.args) ? oscMsg.args[0] : undefined); return; }
      // A phone picking a mix asks for each send's level and pan ("…/?"):
      // answered from what's known (the console's answers follow as they come)
      const q = oscMsg.address.match(/^\/Input_Channels\/(\d+)\/Aux_Send\/(\d+)\/send_(level|pan)\/\?$/);
      if (q) {
        const key = levelKey(parseInt(q[1], 10), parseInt(q[2], 10));
        const cache = q[3] === 'pan' ? (panAvailable(parseInt(q[2], 10)) ? panCache : null) : levelCache;
        if (cache && cache.has(key)) { try { ws.send(JSON.stringify({ address: oscMsg.address.slice(0, -2), args: [cache.get(key)] })); } catch (_) {} }
        return;
      }
      const ALLOWED_OSC_RE = /^\/Input_Channels\/(\d+)\/Aux_Send\/(\d+)\/send_(level|pan)$/;
      const m = oscMsg.address.match(ALLOWED_OSC_RE);
      if (!m) return; // includes EQ addresses — not implemented for dLive
      const [, chStr, auxStr, kind] = m;
      const ch = parseInt(chStr, 10), aux = parseInt(auxStr, 10);

      if (kind === 'pan') {
        // Through the console's own app protocol, on a stereo mix (see writePan)
        const val = Array.isArray(oscMsg.args) ? oscMsg.args[0] : undefined;
        if (typeof val !== 'number' || !writePan(ch, aux, val)) return;
        broadcastToClients({ address: oscMsg.address, args: [Math.max(0, Math.min(1, val))] }, ws);
        ws._lastActivityAt = Date.now();
        shared.broadcastActivity(connections, { type: 'device-activity', deviceId: ws._deviceId || null, aux, channel: ch, kind: 'pan', direction: val < 0.5 ? 'left' : val > 0.5 ? 'right' : null }, ws);
        return;
      }

      const db = Array.isArray(oscMsg.args) ? oscMsg.args[0] : undefined;
      if (!Number.isFinite(db)) return;

      const key = levelKey(ch, aux);
      const prevDb = levelCache.get(key);
      if (!client) return;
      // Nothing upstream of the regex match validates ch/aux are actually
      // in range — this is the most directly client-reachable path, so it's
      // where an out-of-range number is most likely to show up in practice.
      const inputCoord = sourceCoord(baseN, ch), sendCoord = auxCoord(baseN, aux);
      if (!inputCoord || !sendCoord) return;
      levelCache.set(key, db);
      // Muted by its level: the move is kept for the unmute. By send off: it goes to the console
      const silenced = isSilenced(aux, ch) && !muteBySendOff();
      if (silenced) {
        if (!premuteState[aux]) premuteState[aux] = {};
        premuteState[aux][ch] = db;
      }
      pacer.cancel(`lvl:${ch}:${aux}`); // this move supersedes a queued recall write
      sendLevelNow(ch, aux, inputCoord, sendCoord, silenced ? -Infinity : db);
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
  // Only this connection's events: after a restart (Save & Apply), the old
  // one's late 'close' cleared the new one's mix probe, leaving a partial mix
  // list, and showed the console as disconnected while it was connected
  const own = client;
  const on = (event, fn) => own.on(event, (...args) => { if (client === own) fn(...args); });

  on('connect', () => {
    consoleConnected = true;
    logEvent('console-connect', cfg.deskIp);
    if (onConsoleStatusChange) onConsoleStatusChange(true);
    // A console that restarted may have other sends on or off than JPMixer last knew
    assignCache.clear();
    // A console that restarted has lost the -∞ behind every phone mute and
    // solo; phones would show M lit on an audible channel. Re-send them
    // first (nothing to do on the first connect — start() cleared the state).
    reassertSilencing(baseN);
    resendUnsentLevels(baseN);
    resendRecent(baseN);
    // Prime channel/aux names + colours so the mixer shows real labels —
    // paced one request per tick, never bursted (see startPriming above).
    // Settings' Channels/Auxes counts can be configured higher than dLive's
    // actual protocol ceiling (128 inputs, 62 mono auxes) — skip anything
    // past that rather than crashing on an out-of-range coordinate.
    for (let i = 1; i <= (serverCfg.channels || 48); i++) {
      const c = channelCoord(baseN, i);
      if (c) enqueuePrime(() => client.requestName(c));
    }
    for (const ch of fxReturnChannels()) {
      const c = sourceCoord(baseN, ch);
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
    if (consolePrimed) { consolePrimed = false; extras = null; extraProbe = null; primeConsole(baseN); }
    startPriming();
    rebuildSendLevelPollQueue();
    startSendLevelPolling(baseN);
  });

  on('close', () => {
    consoleConnected = false;
    logEvent('console-disconnect', cfg.deskIp);
    if (onConsoleStatusChange) onConsoleStatusChange(false);
    stopPriming();
    stopSendLevelPolling();
    clearInterval(mixProbeTimer); mixProbeTimer = null; mixProbe = null; // asked again on reconnect
    clearTimeout(mixProbeFinishTimer); mixProbeFinishTimer = null;
    clearInterval(extraProbeTimer); extraProbeTimer = null; extraProbe = null;
    clearTimeout(extraProbeFinishTimer); extraProbeFinishTimer = null;
  });

  on('error', (err) => {
    // Common connection failures (e.g. ECONNREFUSED for an unreachable or
    // empty IP) carry an empty .message — logging that alone is useless for
    // diagnosing a bad Console tab config, so fall back to .code.
    logEvent('console-error', err.message || err.code || String(err));
  });

  on('sendLevel', (ev) => {
    if (ev.midiCh === baseN) checkStereoPair(ev.ch + 1, `${ev.sndMidiCh}:${ev.sndCh}`, ev.db);
    // This same message shape carries Group/Matrix/DCA sends too, not just
    // Input channels — checking the *source's* bank (ev.midiCh) as well as
    // the destination's is what keeps a Group's send from getting
    // misattributed and broadcast as some unrelated input channel's level.
    const ch = sourceFor(baseN, ev.midiCh, ev.ch); // an input, or an FX return in the mixes
    if (!ch) return;
    // The destination's JPMixer aux: mono and stereo aux sends share one
    // bank (stereo at 0x40+), so this goes through the console's mix list —
    // a stereo mix the show doesn't use, or any stereo mix on a console
    // whose layout wasn't read, is ignored rather than taken for a mono one.
    const aux = auxFor(baseN, ev.sndMidiCh, ev.sndCh);
    if (!aux) return;
    const input = sourceCoord(baseN, ch), snd = auxCoord(baseN, aux);
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
    if (isSilenced(aux, ch) && !muteBySendOff()) {
      if (!premuteState[aux]) premuteState[aux] = {};
      if (db > -90 || premuteState[aux][ch] === undefined) premuteState[aux][ch] = db;
      if (db > -90) pacedSendLevel(ch, aux, input, snd, -Infinity, true);
      db = premuteState[aux][ch];
    }
    levelCache.set(key, db);
    broadcastToClients({ address: `/Input_Channels/${ch}/Aux_Send/${aux}/send_level`, args: [db] });
    checkPanPlace(ch, aux); // a stereo mix's place in the pan protocol, checked against MIDI
  });

  // A send's own on/off: the answer to JPMixer's question (mute by send
  // off), or a change made anywhere. One switched on while a phone has it
  // muted is the engineer's: kept for the unmute, and the send off again.
  on('sendAssign', (ev) => {
    const ch = sourceFor(baseN, ev.midiCh, ev.ch); if (!ch) return;
    const aux = auxFor(baseN, ev.sndMidiCh, ev.sndCh); if (!aux) return;
    const key = levelKey(ch, aux);
    assignCache.set(key, ev.on);
    if (!muteBySendOff() || !isSilenced(aux, ch)) return;
    if (ev.on || !ownAssign.has(key)) ownAssign.set(key, ev.on);
    const src = sourceCoord(baseN, ch), snd = auxCoord(baseN, aux);
    if (src && snd && ev.on) pacedSendAssign(ch, aux, src, snd, false, true);
  });

  on('sceneRecall', (ev) => {
    // A scene can change sends' own on/off: what JPMixer knew of them is
    // dropped, and every send a phone has off is asked again (the answer
    // switches it off again if the scene turned it on)
    assignCache.clear();
    for (const key of ownAssign.keys()) {
      const [ch, aux] = key.split(':').map(Number);
      const input = sourceCoord(baseN, ch), snd = auxCoord(baseN, aux);
      if (input && snd) enqueuePrime(() => client && client.requestSendAssign(input, snd));
    }
    startPriming();
    currentSceneNumber = ev.sceneNumber;
    logEvent('scene-change', `scene:${ev.sceneNumber}`);
    broadcastToClients({ address: '/SnapshotName', args: [String(ev.sceneNumber)] });
    applySceneForSceneNumber(baseN, ev.sceneNumber);
  });

  on('name', (evRaw) => {
    // dLive's default names are only numbers ("1", "2"…): no name, so pages
    // show their own ("DCA 1", "AUX 1", a channel's number)
    const ev = /^\d+$/.test(evRaw.name) ? { ...evRaw, name: '' } : evRaw;
    // Disambiguate input vs aux by which bank the coordinate's midiCh falls in.
    // A name that changes (renamed on the console, or first read on connect)
    // is announced to phones, a Settings label still winning — as DiGiCo
    // and LV1 do. They used to keep the old name until they reloaded.
    // The Console Controller's other strips: one being looked for, or a rename
    const ck = `${ev.midiCh}:${ev.ch}`;
    if (extraProbe && extraProbe.want.has(ck)) extraProbe.found.set(ck, ev.name);
    else if (extras && extrasByCoord.has(ck)) {
      const { kind, n } = extrasByCoord.get(ck), x = extras[kind][n - 1];
      x.name = ev.name;
      const label = extraLabel(EXTRA_BY_KIND[kind], x);
      if (label !== x.label) { x.label = label; broadcastToClients({ address: `/Extra/${kind}/${n}/name`, args: [label] }); }
    }
    if (mixProbe && ev.midiCh === baseN + 1) (ev.ch >= 0x40 ? mixProbe.groups.stereo : mixProbe.groups.mono).add(ev.ch);
    if (mixProbe && ev.midiCh === baseN + 4 && ev.ch < 0x20) (ev.ch >= 0x10 ? mixProbe.fx.stereo : mixProbe.fx.mono).add(ev.ch);
    if (ev.midiCh === baseN + 4 && ev.ch >= 0x20 && ev.ch < 0x30) {
      // An FX return: a channel in the mixes when Settings puts it there
      const n = FX_BASE + ev.ch - 0x20 + 1, key = `input:${n}`;
      if (nameCache.get(key) === ev.name) return;
      nameCache.set(key, ev.name);
      if (!isMixChannel(n)) return;
      const label = serverCfg.channelOverrides?.[String(n)]?.label;
      broadcastToClients({ type: 'channel-relabeled', channel: n, label: label || fxReturnName(n) });
      return;
    }
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
  on('fader', (ev) => {
    const strip = stripFor(baseN, ev.midiCh, ev.ch); if (!strip) return;
    stripState(strip.kind, strip.n).gain = ev.db;
    broadcastToClients({ address: `${stripBase(strip.kind, strip.n)}/fader`, args: [jsonDb(ev.db)] });
  });
  on('mute', (ev) => {
    const strip = stripFor(baseN, ev.midiCh, ev.ch); if (!strip) return;
    stripState(strip.kind, strip.n).mute = ev.on;
    broadcastToClients({ address: `${stripBase(strip.kind, strip.n)}/mute`, args: [ev.on ? 1 : 0] });
  });
  on('solo', (ev) => {
    const strip = stripFor(baseN, ev.midiCh, ev.ch); if (!strip || !hasSolo(strip.kind)) return;
    stripState(strip.kind, strip.n).solo = ev.on;
    broadcastToClients({ address: `${stripBase(strip.kind, strip.n)}/solo`, args: [ev.on ? 1 : 0] });
  });

  // EQ and high-pass settings: answers to JPMixer's questions, and changes
  // made anywhere. JPMixer's own write coming back isn't news.
  on('nrpn', (ev) => {
    const peq = P.peqFromParam(ev.param);
    if (!peq && ev.param !== P.PARAM.HPF_ON && ev.param !== P.PARAM.HPF_FREQ) return;
    const c = { midiCh: ev.midiCh, ch: ev.ch };
    eqOf(c)[ev.param] = ev.value;
    const wrote = lastWrite.get(`${coordKey(c)}:${ev.param}`);
    if (wrote && Date.now() - wrote < ECHO_MS) return;
    const aux = auxFor(baseN, ev.midiCh, ev.ch);
    if (aux && peq) {
      broadcastToClients({ address: `/Aux_Outputs/${aux}/EQ/${PHONE_FIELD[peq.field]}_${peq.band + 1}`, args: [peqValue(peq.field, ev.value)] });
      return;
    }
    if (ev.midiCh !== baseN || ev.ch + 1 > inputCount()) return;
    const ch = ev.ch + 1;
    if (peq) toPanels(ch, `EQ/${PHONE_FIELD[peq.field]}_${4 - peq.band}`, peqValue(peq.field, ev.value));
    else if (ev.param === P.PARAM.HPF_ON) toPanels(ch, 'Filters/lo_filter_in', ev.value >= 0x40 ? 1 : 0);
    else toPanels(ch, 'Filters/lo_filter_freq', P.vvToHpfFreq(ev.value));
  });
  // A socket preamp's gain, pad or 48V: to the panels of the channels it feeds
  const onPreamp = (path, value) => (ev) => {
    if (ev.midiCh !== baseN) return;
    const pre = preampCache.get(ev.socket) || {};
    preampCache.set(ev.socket, pre);
    const v = value(ev, pre);
    const wrote = lastWrite.get(`preamp:${ev.socket}:${path}`);
    if (wrote && Date.now() - wrote < ECHO_MS) return;
    for (const ch of channelsOfSocket(ev.socket)) toPanels(ch, path, v);
  };
  on('preampGain', onPreamp('Channel_Input/analog_gain', (ev, pre) => (pre.gain = ev.db)));
  on('pad', onPreamp('Channel_Input/pad', (ev, pre) => ((pre.pad = ev.on) ? 1 : 0)));
  on('phantom', onPreamp('Channel_Input/phantom', (ev, pre) => ((pre.phantom = ev.on) ? 1 : 0)));

  on('colour', (ev) => {
    const n = auxFor(baseN, ev.midiCh, ev.ch);
    if (n) colourCache.set(`aux:${n}`, ev.hex);
  });

  client.connect();
  // Pan on the stereo mixes: dLive's own app protocol, beside MIDI
  startPanLink(cfg.deskIp);
}

function stop() {
  if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
  stopPanLink();
  clearInterval(extraProbeTimer); extraProbeTimer = null; extraProbe = null;
  clearTimeout(extraProbeFinishTimer); extraProbeFinishTimer = null;
  clearInterval(mixProbeTimer); mixProbeTimer = null; mixProbe = null;
  clearTimeout(mixProbeFinishTimer); mixProbeFinishTimer = null;
  stopPriming();
  stopSendLevelPolling();
  pacer.flush(); // queued writes are the state people asked for
  // Restore the actual send levels before dropping the mute bookkeeping.
  // Gracefully end TCP after these writes so shutdown cannot discard them.
  if (client) {
    for (const [aux, channels] of Object.entries(premuteState)) {
      const snd = auxCoord(moduleBaseN, Number(aux));
      for (const [ch, db] of Object.entries(channels)) {
        const input = sourceCoord(moduleBaseN, Number(ch));
        if (input && snd) client.setSendLevel(input, snd, db);
      }
    }
    // Sends switched off for a mute: on again, as the console had them
    for (const [key, own] of ownAssign) {
      if (!own) continue;
      const [ch, aux] = key.split(':').map(Number);
      const input = sourceCoord(moduleBaseN, ch), snd = auxCoord(moduleBaseN, aux);
      if (input && snd) client.setSendAssign(input, snd, true);
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
  unsentLevels.clear();
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

module.exports = { getConnectedDevicesInfo, pushDevicePresets, getControlGroups,
  start, stop, applyConfigLive, getChannelNames, getAuxNames, getChannelCount, getAuxCount,
  isConsoleConnected, setConsoleStatusCallback, setConnectionCountCallback, getConnectionCount,
  setServerErrorCallback, getOscLog, setOscTrafficCallback,
  startOscLogRecording, stopOscLogRecording, getOscLogRecordingStatus, oscLogRecordsFolder,
  fireSnapshot, setMute, setSolo, setChannelLabel, setAuxLabel, getStrips, primeStrips, setStrip,
};
