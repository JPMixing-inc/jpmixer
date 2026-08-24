'use strict';

// ── Behringer WING OSC Protocol ─────────────────────────────────────────────
// Pure, side-effect-free protocol logic: builds {address, args} OSC message
// objects, and decodes WING's GET-reply shape into plain values. No sockets
// here — see wing-client.js for the UDP transport. Kept entirely separate
// from osc-server.js/dlive-*.js/klang-*.js on purpose: this is a fourth,
// independent backend.
//
// Reference: "OSC Documentation for WING" (Patrick-Gilles Maillot, authorized
// by Behringer to publish/maintain it), wing-docs.com/pdf/OSC_Documentation.pdf,
// doc version 0.3.2.
//
// UNLIKE dLive/KLANG: WING's OSC layer supports a real synchronous GET (send
// an address with no args, get the current value back) and a confirmed SET
// (every write replies with an explicit OK or a specific error) — the doc's
// own worked examples for both are what this file's tests are checked
// against. This is a meaningfully stronger foundation than either of the
// other two new backends, which both have to trust their own last-sent
// value with no real read-back.
//
// Addressing (from the doc's own JSON default-tree appendix):
//   /ch/<N>/fdr, /ch/<N>/mute, /ch/<N>/pan   — channel N's own fader/mute/pan
//   /ch/<N>/send/<M>/lvl                     — channel N's send level to bus M
//   /ch/<N>/send/<M>/pan                     — channel N's send pan to bus M
//     (WING has real per-send pan — dLive's protocol doesn't expose this at all)
//   /ch/<N>/send/<M>/on                      — per-send on/off (a real per-send
//     mute, not the "-inf trick" DiGiCo/dLive need — closer to KLANG's model)
//   /bus/<M>/fdr, /bus/<M>/mute, /bus/<M>/name — the bus itself (JPMixer's aux)
//
// Ch count/bus count: the doc's marketing copy says "48-channel, 28-bus", but
// the JSON default-tree appendix enumerates ch 1-40 and bus 1-16 specifically
// — likely the marketing figure includes WING's separate 8 "aux" input strips
// (a different concept from a bus — an extra source type, not a mix
// destination) and other bus-like destinations (main/mtx) combined. Given
// that ambiguity, this file does not hardcode a channel/bus ceiling the way
// dlive-protocol.js does for dLive's clearly-spec'd 128/62 — Settings'
// existing Channels/Auxes fields are the only source of truth here.
//
// SCOPE (deliberately not full parity):
//   ✓ Channel gain, per-send level/pan/mute, bus name
//   ✗ Snapshot/scene ("event") recall — not documented anywhere in this OSC
//     spec. The doc's own file-system section shows scenes living under
//     library/shows/<name>/events, and the intro lists MIDI/GPIO (not OSC)
//     as WING's "external show control" mechanism. Ear Scenes/snapshot-
//     following are out of scope for this pass as a result.
//   ✗ EQ, dynamics, FX — WING's parameter tree covers these in depth, but
//     this integration only needs the mixing-bridge subset.

function assertPositiveInt(name, value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer, got ${value}`);
  }
}

function assertFiniteNumber(name, value) {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number, got ${value}`);
  }
}

function channelPath(ch) {
  assertPositiveInt('ch', ch);
  return `/ch/${ch}`;
}

function sendPath(ch, bus) {
  assertPositiveInt('bus', bus);
  return `${channelPath(ch)}/send/${bus}`;
}

function busPath(bus) {
  assertPositiveInt('bus', bus);
  return `/bus/${bus}`;
}

// ── GET (query) — empty args; the reply carries the value, see
// decodeGetReply() below ─────────────────────────────────────────────────
function getMessage(address) {
  return { address, args: [] };
}

// ── SET ──────────────────────────────────────────────────────────────────
function sendLevelSet(ch, bus, db) {
  assertFiniteNumber('db', db);
  return { address: `${sendPath(ch, bus)}/lvl`, args: [db] };
}

function sendPanSet(ch, bus, pan) {
  assertFiniteNumber('pan', pan);
  return { address: `${sendPath(ch, bus)}/pan`, args: [pan] };
}

// A real per-send mute — not the "drive the level to -inf" trick DiGiCo/
// dLive need, since WING's send object has its own "on" flag independent of
// the channel's own mute state.
function sendOnSet(ch, bus, on) {
  return { address: `${sendPath(ch, bus)}/on`, args: [on ? 1 : 0] };
}

function channelFaderSet(ch, db) {
  assertFiniteNumber('db', db);
  return { address: `${channelPath(ch)}/fdr`, args: [db] };
}

function channelMuteSet(ch, on) {
  return { address: `${channelPath(ch)}/mute`, args: [on ? 1 : 0] };
}

function channelNameGet(ch) { return getMessage(`${channelPath(ch)}/name`); }
function busNameGet(bus)    { return getMessage(`${busPath(bus)}/name`); }

function sendLevelGet(ch, bus) { return getMessage(`${sendPath(ch, bus)}/lvl`); }
function sendPanGet(ch, bus)   { return getMessage(`${sendPath(ch, bus)}/pan`); }

// ── Reply decoding ───────────────────────────────────────────────────────
// The doc's own examples: a float-typed parameter (e.g. fdr) replies with
// type tag 'sff' — [ascii label, raw 0..1 position, actual value in real
// units] — and an int/enum-typed parameter (e.g. mute) replies with 'sfi' —
// [ascii label, float 0..1, actual int value]. Either way the real value is
// the LAST argument. A plain string-only reply ('s', e.g. a name) is the
// value itself, no unwrapping needed.
function decodeGetReply(args) {
  if (!Array.isArray(args) || args.length === 0) return null;
  if (args.length === 1) return args[0];
  return args[args.length - 1];
}

// Confirms a SET was applied. The doc's own examples: '/*' + ',s' + "OK", or
// one of a fixed set of error strings.
function isOkReply(address, value) {
  return address === '/*' && value === 'OK';
}

module.exports = {
  getMessage,
  sendLevelSet,
  sendPanSet,
  sendOnSet,
  channelFaderSet,
  channelMuteSet,
  channelNameGet,
  busNameGet,
  sendLevelGet,
  sendPanGet,
  decodeGetReply,
  isOkReply,
};
