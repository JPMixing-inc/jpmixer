'use strict';

// ── Midas M32 / Behringer X32 OSC protocol ──────────────────────────────────
// Pure helpers: the console's addresses, its 0..1 fader scale in dB, and
// reading what it sends. No sockets here; m32-client.js has the UDP side.
//
// The M32 and X32 share one protocol (OSC over UDP, port 10023), so this
// covers the M32, M32R, M32C and every X32. Reference: "Unofficial X32/M32
// OSC Remote Protocol" (Patrick-Gilles Maillot). Written from that document,
// before anyone had tried it on a real console.
//
// Addresses are zero-padded (/ch/01, /bus/16), except DCAs (/dca/1):
//   /ch/NN/mix/MM/level   a channel's send to mix bus MM, 0..1 on the fader scale
//   /ch/NN/mix/MM/on      that send on (1) or off (0)
//   /ch/NN/mix/MM/pan     its pan, 0..1; odd MM only, used when MM and MM+1 are linked
//   /ch/NN/config/name    a channel's name (/bus/MM/config/name, /dca/N/config/name)
//   /ch/NN/mix/fader, /ch/NN/mix/on   the channel's own fader and on (0 = muted)
//   /bus/MM/mix/fader, /bus/MM/mix/on, /dca/N/fader, /dca/N/on   the same for mixes and DCAs
//   /config/buslink/1-2 … 15-16       two mix buses linked as one stereo mix
//   /-stat/solosw/01..80  solo: 01-32 channels, 33-40 aux ins, 41-48 FX returns,
//                         49-64 mix buses, 73-80 DCAs
//   /-show/prepos/current the scene (or cue) the console is on, -1 for none
//   /-prefs/show_control  what the console's show list steps through: 0 cues, 1 scenes, 2 snippets
//   /-action/goscene, /-action/gocue, /-action/gosnippet  recall one by number
//   /xremote              send this client every change for the next 10 seconds
//   /xinfo                the console's address, name, model and firmware
// Sending an address with no arguments asks for its value; the console
// answers on the same address.
//
// JPMixer's channels are the console's 48 sources that send to the mixes:
// 1-32 the input channels, 33-40 the aux ins, 41-48 the FX returns.

const PORT = 10023;
const INPUTS = 48;
const BUSES = 16;
const DCAS = 8;
const SHOW_MAX = 99;
const OFF_DB = -150; // JPMixer's "off" (the console's -∞)
const SOLO_BUS = 48; // a mix bus's solo is /-stat/solosw/(48 + bus)
const SOLO_DCA = 72; // a DCA's is /-stat/solosw/(72 + dca)

const pad = (n, width = 2) => String(n).padStart(width, '0');

function checkInt(name, value, max) {
  if (!Number.isInteger(value) || value < 1 || value > max) throw new RangeError(`${name} must be 1-${max}, got ${value}`);
}

// A JPMixer channel's address on the console
function inputPath(ch) {
  checkInt('ch', ch, INPUTS);
  if (ch <= 32) return `/ch/${pad(ch)}`;
  if (ch <= 40) return `/auxin/${pad(ch - 32)}`;
  return `/fxrtn/${pad(ch - 40)}`;
}
const INPUT_BASE = { ch: 0, auxin: 32, fxrtn: 40 };
const INPUT_MAX = { ch: 32, auxin: 8, fxrtn: 8 };
// "ch"/"auxin"/"fxrtn" and its number on the console → a JPMixer channel, or null
function inputFrom(kind, n) {
  return Number.isInteger(n) && n >= 1 && n <= INPUT_MAX[kind] ? INPUT_BASE[kind] + n : null;
}
function busPath(bus) { checkInt('bus', bus, BUSES); return `/bus/${pad(bus)}`; }
function dcaPath(dca) { checkInt('dca', dca, DCAS); return `/dca/${dca}`; }
function sendPath(ch, bus) { checkInt('bus', bus, BUSES); return `${inputPath(ch)}/mix/${pad(bus)}`; }

// ── The fader scale ───────────────────────────────────────────────────────
// The console's levels are 0..1 along its fader, in four straight pieces
// (the document's own formula): 0 is -∞, 0.0625 -60 dB, 0.25 -30 dB,
// 0.5 -10 dB, 0.75 0 dB, 1 +10 dB.
function levelToDb(f) {
  if (!(f > 0)) return OFF_DB;
  const v = Math.min(f, 1);
  let db;
  if (v >= 0.5) db = v * 40 - 30;
  else if (v >= 0.25) db = v * 80 - 50;
  else if (v >= 0.0625) db = v * 160 - 70;
  else db = v * 480 - 90;
  return Math.round(db * 100) / 100;
}
function dbToLevel(db) {
  if (!Number.isFinite(db) || db <= -90) return 0;
  const d = Math.min(db, 10);
  let f;
  if (d < -60) f = (d + 90) / 480;
  else if (d < -30) f = (d + 70) / 160;
  else if (d < -10) f = (d + 50) / 80;
  else f = (d + 30) / 40;
  return Math.max(0, Math.min(1, f));
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ── Messages to the console ───────────────────────────────────────────────
// Every value carries its OSC type: the console wants floats as floats, and
// the osc package would send a level of 1 or 0 as an integer.
const f = (value) => ({ type: 'f', value });
const i = (value) => ({ type: 'i', value });
function get(address) { return { address, args: [] }; }
function sendLevel(ch, bus, level) { return { address: `${sendPath(ch, bus)}/level`, args: [f(clamp01(level))] }; }
function sendOn(ch, bus, on) { return { address: `${sendPath(ch, bus)}/on`, args: [i(on ? 1 : 0)] }; }
function sendPan(ch, bus, pan) { return { address: `${sendPath(ch, bus)}/pan`, args: [f(clamp01(pan))] }; }
// A Console Controller strip: 'input' (a JPMixer channel), 'aux' (a mix bus), 'cg' (a DCA)
function stripPath(strip, n) {
  if (strip === 'input') return `${inputPath(n)}/mix`;
  if (strip === 'aux') return `${busPath(n)}/mix`;
  if (strip === 'cg') return dcaPath(n);
  throw new RangeError(`unknown strip ${strip}`);
}
function stripFader(strip, n, level) { return { address: `${stripPath(strip, n)}/fader`, args: [f(clamp01(level))] }; }
function stripOn(strip, n, on) { return { address: `${stripPath(strip, n)}/on`, args: [i(on ? 1 : 0)] }; }
function soloIndex(strip, n) {
  if (strip === 'input') { checkInt('ch', n, INPUTS); return n; }
  if (strip === 'aux') { checkInt('bus', n, BUSES); return SOLO_BUS + n; }
  if (strip === 'cg') { checkInt('dca', n, DCAS); return SOLO_DCA + n; }
  throw new RangeError(`unknown strip ${strip}`);
}
function soloPath(strip, n) { return `/-stat/solosw/${pad(soloIndex(strip, n))}`; }
function solo(strip, n, on) { return { address: soloPath(strip, n), args: [i(on ? 1 : 0)] }; }
function goScene(n) { return { address: '/-action/goscene', args: [i(n)] }; }
function goCue(n) { return { address: '/-action/gocue', args: [i(n)] }; }
function goSnippet(n) { return { address: '/-action/gosnippet', args: [i(n)] }; }
const XREMOTE = { address: '/xremote', args: [] };

// What to ask for
const ADDR = {
  inputName: (ch) => `${inputPath(ch)}/config/name`,
  busName: (bus) => `${busPath(bus)}/config/name`,
  dcaName: (dca) => `${dcaPath(dca)}/config/name`,
  busLink: (pair) => `/config/buslink/${pair * 2 - 1}-${pair * 2}`, // pair 1..8
  sendLevel: (ch, bus) => `${sendPath(ch, bus)}/level`,
  sendOn: (ch, bus) => `${sendPath(ch, bus)}/on`,
  sendPan: (ch, bus) => `${sendPath(ch, bus)}/pan`,
  stripFader: (strip, n) => `${stripPath(strip, n)}/fader`,
  stripOn: (strip, n) => `${stripPath(strip, n)}/on`,
  solo: soloPath,
  showPosition: '/-show/prepos/current',
  showControl: '/-prefs/show_control',
  showName: (kind, n) => `/-show/showfile/${kind}/${pad(n, 3)}/name`,
  info: '/xinfo',
};

// ── Messages from the console ─────────────────────────────────────────────
// Its answers and its /xremote updates look the same. Returns what the
// message is about in JPMixer's terms, or null for anything else.
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (v) => (Number.isInteger(v) ? v : null);
const str = (v) => (typeof v === 'string' ? v : null);
const RE = {
  send: /^\/(ch|auxin|fxrtn)\/(\d\d)\/mix\/(\d\d)\/(level|on|pan)$/,
  inputName: /^\/(ch|auxin|fxrtn)\/(\d\d)\/config\/name$/,
  inputStrip: /^\/(ch|auxin|fxrtn)\/(\d\d)\/mix\/(fader|on)$/,
  busName: /^\/bus\/(\d\d)\/config\/name$/,
  busStrip: /^\/bus\/(\d\d)\/mix\/(fader|on)$/,
  dcaStrip: /^\/dca\/(\d)\/(fader|on)$/,
  dcaName: /^\/dca\/(\d)\/config\/name$/,
  busLink: /^\/config\/buslink\/(\d+)-(\d+)$/,
  solo: /^\/-stat\/solosw\/(\d\d)$/,
  showName: /^\/-show\/showfile\/(scene|cue|snippet)\/(\d{3})\/name$/,
};
const busFrom = (s) => { const n = parseInt(s, 10); return n >= 1 && n <= BUSES ? n : null; };
const dcaFrom = (s) => { const n = parseInt(s, 10); return n >= 1 && n <= DCAS ? n : null; };
// A fader/on message's value: a level in dB, or muted (on 0) as true/false
function stripValue(what, v) {
  if (what === 'fader') { const x = num(v); return x === null ? null : { db: levelToDb(x), level: x }; }
  const x = int(v); return x === null ? null : { muted: x === 0 };
}

function parseMessage(address, args) {
  if (typeof address !== 'string') return null;
  const a = Array.isArray(args) ? args : [];
  const v = a[0];
  let m;
  if ((m = RE.send.exec(address))) {
    const ch = inputFrom(m[1], parseInt(m[2], 10)), bus = busFrom(m[3]);
    if (!ch || !bus) return null;
    if (m[4] === 'on') { const x = int(v); return x === null ? null : { kind: 'send-on', ch, bus, on: x === 1 }; }
    const x = num(v);
    if (x === null) return null;
    return m[4] === 'level' ? { kind: 'send-level', ch, bus, level: x, db: levelToDb(x) } : { kind: 'send-pan', ch, bus, pan: clamp01(x) };
  }
  if ((m = RE.inputStrip.exec(address))) {
    const n = inputFrom(m[1], parseInt(m[2], 10)), val = stripValue(m[3], v);
    return n && val ? { kind: 'strip', strip: 'input', n, what: m[3], ...val } : null;
  }
  if ((m = RE.busStrip.exec(address))) {
    const n = busFrom(m[1]), val = stripValue(m[2], v);
    return n && val ? { kind: 'strip', strip: 'aux', n, what: m[2], ...val } : null;
  }
  if ((m = RE.dcaStrip.exec(address))) {
    const n = dcaFrom(m[1]), val = stripValue(m[2], v);
    return n && val ? { kind: 'strip', strip: 'cg', n, what: m[2], ...val } : null;
  }
  if ((m = RE.inputName.exec(address))) {
    const ch = inputFrom(m[1], parseInt(m[2], 10)), name = str(v);
    return ch && name !== null ? { kind: 'name', strip: 'input', n: ch, name: name.trim() } : null;
  }
  if ((m = RE.busName.exec(address))) {
    const n = busFrom(m[1]), name = str(v);
    return n && name !== null ? { kind: 'name', strip: 'aux', n, name: name.trim() } : null;
  }
  if ((m = RE.dcaName.exec(address))) {
    const n = dcaFrom(m[1]), name = str(v);
    return n && name !== null ? { kind: 'name', strip: 'cg', n, name: name.trim() } : null;
  }
  if ((m = RE.busLink.exec(address))) {
    const lo = parseInt(m[1], 10), hi = parseInt(m[2], 10), x = int(v);
    if (lo % 2 !== 1 || hi !== lo + 1 || hi > BUSES || x === null) return null;
    return { kind: 'bus-link', pair: (lo + 1) / 2, linked: x === 1 };
  }
  if ((m = RE.solo.exec(address))) {
    const idx = parseInt(m[1], 10), x = int(v);
    if (x === null) return null;
    if (idx >= 1 && idx <= INPUTS) return { kind: 'solo', strip: 'input', n: idx, on: x === 1 };
    if (idx > SOLO_BUS && idx <= SOLO_BUS + BUSES) return { kind: 'solo', strip: 'aux', n: idx - SOLO_BUS, on: x === 1 };
    if (idx > SOLO_DCA && idx <= SOLO_DCA + DCAS) return { kind: 'solo', strip: 'cg', n: idx - SOLO_DCA, on: x === 1 };
    return null;
  }
  if (address === ADDR.showPosition) { const x = int(v); return x === null ? null : { kind: 'show-position', n: x }; }
  if (address === ADDR.showControl) { const x = int(v); return x === null ? null : { kind: 'show-control', mode: x }; }
  if ((m = RE.showName.exec(address))) { const name = str(v); return name === null ? null : { kind: 'show-name', show: m[1], n: parseInt(m[2], 10), name: name.trim() }; }
  if (address === ADDR.info) {
    const [ip, name, model, firmware] = a.map(x => (typeof x === 'string' ? x.trim() : ''));
    return { kind: 'info', ip: ip || '', name: name || '', model: model || '', firmware: firmware || '' };
  }
  return null;
}

module.exports = {
  PORT, INPUTS, BUSES, DCAS, SHOW_MAX, OFF_DB,
  levelToDb, dbToLevel, inputPath,
  get, sendLevel, sendOn, sendPan, stripFader, stripOn, solo, goScene, goCue, goSnippet, XREMOTE, ADDR,
  parseMessage,
};
