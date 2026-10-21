'use strict';

// ── Waves eMotion LV1 — MyMon remote protocol ───────────────────────────────
// Pure, side-effect-free: frames, OSC encode/decode, and readers for the
// messages JPMixer uses. No sockets here — see lv1-client.js.
//
// Worked out from LV1 17.3 (MyMon service v.17.6) on a real show: captures of
// Waves' own MyFOH app, then JPMixer's own client reading and writing sends.
// LV1 loads the MyMon service when its MyMon/MyFOH remote is switched on; it
// listens on a TCP port chosen at launch.
//
// Each frame on the TCP stream is:
//   uint32 BE  length of the OSC message that follows
//   uint32 BE  2      (always 2 in every frame seen, both directions)
//   uint32 BE  0
//   an ordinary OSC 1.0 message (address, type tags, big-endian args;
//   doubles 'd' for levels, 'h' int64, 'T'/'F' booleans)
//
// Tracks are addressed (type, index), both from 0. Types seen:
//   0 input channel, 2 aux mix, 3 LR, 6 matrix, 7 cue, 8 talkback, 12 DCA
// A send is (source type, source index, mix index). Levels are dB:
// -144 is off, +10 the top. Send pan runs -45..45.
//
// Session:
//   → /handshake ,iii [1, -1, 1]   then  → /device_name ,ss [name, uuid]
//   ← /handshake ,i [1], then the whole show: /Aux/Tracks, /Channels,
//     /Notify/Scene/Name, /Notify/SceneList, /Notify/CurSceneIndex, …
//   Both sides send /ping ,hi [time, n]; the other echoes it as /pong with
//   the same args. LV1 pings every 200 ms and drops a client that doesn't
//   answer within a few seconds.
//   → /Get/Sends ,i [mix]  ← /Notify/Sends, /Notify/Sends/On, /Notify/Sends/Pan …
//   → /Set/Aux/Send/Gain ,iiid [srcType, src, mix, dB]
//   → /Set/Aux/Send/On   ,iiiT|F
//   → /Set/Aux/Send/Pan  ,iiid [srcType, src, mix, -45..45]
//   LV1 confirms every change, and announces changes made anywhere else, as
//   /Notify/Aux/Send/Gain|On|Pan with the same leading args plus a flag.
//
// Main faders (the Console Controller):
//   → /Set/Track/Out/Gain ,iid [type, index, dB]   ← /Notify/Track/Out/Gain [type, index, dB, flag]
//   → /Set/Track/Out/Mute ,iiT|F                    ← /Notify/Track/Out/Mute [type, index, 0|1, flag]
//   → /Set/Solo ,iii [type, index, 0|1]             ← /Notify/Solo [type, index, 0|1, flag]
// /Set/Solo is the engineer's cue solo for the whole desk (it also lights
// the DCA solos) — right for the Console Controller, wrong for a performer:
// JPMixer solos within one mix by switching the other sends off instead.

// 2 aux bus and 25 monitor mix are both mixes: LV1 lists them together in
// /Aux/Tracks, and a send's mix is the position in that list, not the
// track's own index (each type counts from 0)
const TRACK = { INPUT: 0, AUX: 2, DCA: 12, MONITOR: 25 };
const LEVEL_MIN = -144, LEVEL_MAX = 10, PAN_MAX = 45;

const pad = n => (n + 3) & ~3;
function oscString(s) { const b = Buffer.alloc(pad(Buffer.byteLength(s) + 1)); b.write(s); return b; }

// args: [{ t: 'i'|'f'|'d'|'h'|'s'|'T'|'F', v }]
function encodeMessage(address, args = []) {
  const parts = [oscString(address), oscString(',' + args.map(a => a.t).join(''))];
  for (const a of args) {
    if (a.t === 'i') { if (!Number.isInteger(a.v)) throw new RangeError(`int arg must be an integer, got ${a.v}`); const b = Buffer.alloc(4); b.writeInt32BE(a.v); parts.push(b); }
    else if (a.t === 'f') { const b = Buffer.alloc(4); b.writeFloatBE(a.v); parts.push(b); }
    else if (a.t === 'd') { if (!Number.isFinite(a.v)) throw new RangeError(`double arg must be finite, got ${a.v}`); const b = Buffer.alloc(8); b.writeDoubleBE(a.v); parts.push(b); }
    else if (a.t === 'h') { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(a.v)); parts.push(b); }
    else if (a.t === 's') parts.push(oscString(String(a.v)));
    else if (a.t !== 'T' && a.t !== 'F') throw new TypeError(`unsupported OSC type ${a.t}`);
  }
  return Buffer.concat(parts);
}
function frame(address, args) {
  const msg = encodeMessage(address, args), head = Buffer.alloc(12);
  head.writeUInt32BE(msg.length, 0); head.writeUInt32BE(2, 4); head.writeUInt32BE(0, 8);
  return Buffer.concat([head, msg]);
}

function readString(b, o) {
  let e = o; while (e < b.length && b[e] !== 0) e++;
  if (e >= b.length) throw new RangeError('unterminated OSC string');
  return [b.toString('utf8', o, e), o + pad(e - o + 1)];
}
// → { address, types, args } with plain values (T/F → true/false, h → string)
function decodeMessage(b) {
  let [address, o] = readString(b, 0), tags; [tags, o] = readString(b, o);
  if (tags[0] !== ',') throw new RangeError('missing OSC type tags');
  const args = [];
  for (const t of tags.slice(1)) {
    if (t === 'i') { args.push(b.readInt32BE(o)); o += 4; }
    else if (t === 'f') { args.push(b.readFloatBE(o)); o += 4; }
    else if (t === 'd') { args.push(b.readDoubleBE(o)); o += 8; }
    else if (t === 'h') { args.push(b.readBigInt64BE(o).toString()); o += 8; }
    else if (t === 's' || t === 'S') { let s; [s, o] = readString(b, o); args.push(s); }
    else if (t === 'b') { const n = b.readUInt32BE(o); args.push(b.subarray(o + 4, o + 4 + n)); o += 4 + pad(n); }
    else if (t === 'T') args.push(true);
    else if (t === 'F') args.push(false);
    else if (t === 'N' || t === 'I') args.push(null);
    else throw new RangeError(`unsupported OSC type ${t}`);
  }
  return { address, types: tags.slice(1), args };
}

// Splits a TCP byte stream into messages. push() returns the complete ones;
// a malformed message is skipped, not thrown. A frame header that can't be
// real means the stream is out of step and can't be trusted again: `lost`
// is set, nothing more is read, and the connection should be dropped
// (LV1 sends its whole state again to a new one).
class FrameReader {
  constructor({ maxFrame = 4 * 1024 * 1024 } = {}) { this.buf = Buffer.alloc(0); this.maxFrame = maxFrame; this.bad = 0; this.lost = false; }
  push(chunk) {
    if (this.lost) return [];
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out = [];
    while (this.buf.length >= 12) {
      const len = this.buf.readUInt32BE(0);
      if (len > this.maxFrame) { this.bad++; this.lost = true; this.buf = Buffer.alloc(0); break; }
      if (this.buf.length < 12 + len) break;
      const body = this.buf.subarray(12, 12 + len);
      this.buf = this.buf.subarray(12 + len);
      try { out.push(decodeMessage(body)); } catch (_) { this.bad++; }
    }
    return out;
  }
}

// ── Messages JPMixer sends ───────────────────────────────────────────────
const i = v => ({ t: 'i', v });
const clampLevel = db => Math.max(LEVEL_MIN, Math.min(LEVEL_MAX, db));
const clampPan = p => Math.max(-PAN_MAX, Math.min(PAN_MAX, p));
const msg = {
  handshake: () => frame('/handshake', [i(1), i(-1), i(1)]),
  deviceName: (name, uuid) => frame('/device_name', [{ t: 's', v: name }, { t: 's', v: uuid }]),
  ping: (time, n) => frame('/ping', [{ t: 'h', v: time }, i(n)]),
  pong: (args) => frame('/pong', [{ t: 'h', v: args[0] }, i(args[1])]),
  getSends: (mix) => frame('/Get/Sends', [i(mix)]),
  setSendGain: (srcType, src, mix, db) => frame('/Set/Aux/Send/Gain', [i(srcType), i(src), i(mix), { t: 'd', v: clampLevel(db) }]),
  setSendOn: (srcType, src, mix, on) => frame('/Set/Aux/Send/On', [i(srcType), i(src), i(mix), { t: on ? 'T' : 'F' }]),
  setSendPan: (srcType, src, mix, pan) => frame('/Set/Aux/Send/Pan', [i(srcType), i(src), i(mix), { t: 'd', v: clampPan(pan) }]),
  setTrackGain: (type, index, db) => frame('/Set/Track/Out/Gain', [i(type), i(index), { t: 'd', v: clampLevel(db) }]),
  setTrackMute: (type, index, on) => frame('/Set/Track/Out/Mute', [i(type), i(index), { t: on ? 'T' : 'F' }]),
  setSolo: (type, index, on) => frame('/Set/Solo', [i(type), i(index), i(on ? 1 : 0)]),
  // Not yet confirmed on a real LV1 — see lv1-server.js fireSnapshot()
  recallScene: (index) => frame('/Scene/Recall', [i(index)]),
};

// ── Readers for what LV1 sends ───────────────────────────────────────────
// /Channels: count, then per track 19 values starting (name, type, index,
// fader dB, ?, ?, mute 0|1, …), with 1 mono / 2 stereo 16th from 0
const CHANNEL_FIELDS = 19;
function parseChannels(args) {
  const tracks = [];
  for (let o = 1; o + 2 < args.length; o += CHANNEL_FIELDS) {
    if (typeof args[o] !== 'string' || !Number.isInteger(args[o + 1]) || !Number.isInteger(args[o + 2])) break;
    tracks.push({ name: args[o], type: args[o + 1], index: args[o + 2], gain: Number.isFinite(args[o + 3]) ? args[o + 3] : null, mute: args[o + 6] === 1, stereo: args[o + 16] !== 1 });
  }
  return tracks;
}
// /Aux/Tracks: count, then (index, track type, name) per mix, in LV1's order
function parseAuxTracks(args) {
  const mixes = [];
  for (let o = 1; o + 2 < args.length; o += 3) {
    if (!Number.isInteger(args[o]) || typeof args[o + 2] !== 'string') break;
    mixes.push({ index: args[o], kind: args[o + 1], name: args[o + 2] });
  }
  return mixes;
}
// /Notify/Sends and /Notify/Sends/On: mix, count, then (srcType, src, value)
// /Notify/Sends/Pan: mix, count, then (srcType, src, flag, value)
function parseSends(args, width = 3) {
  const out = { mix: args[0], sends: [] };
  for (let o = 2; o + width - 1 < args.length; o += width) {
    out.sends.push({ srcType: args[o], src: args[o + 1], value: args[o + width - 1] });
  }
  return out;
}
// /Notify/SceneList: count, then (index, name)
function parseSceneList(args) {
  const list = [];
  for (let o = 1; o + 1 < args.length; o += 2) if (Number.isInteger(args[o]) && typeof args[o + 1] === 'string') list.push({ index: args[o], name: args[o + 1] });
  return list;
}

// JPMixer numbers channels and auxes from 1; LV1 indexes tracks from 0
const panFromSlider = v => (Math.max(0, Math.min(1, v)) - 0.5) * 2 * PAN_MAX;
const panToSlider = p => (clampPan(p) / PAN_MAX + 1) / 2;

module.exports = {
  TRACK, LEVEL_MIN, LEVEL_MAX, PAN_MAX,
  encodeMessage, decodeMessage, frame, FrameReader, msg,
  parseChannels, parseAuxTracks, parseSends, parseSceneList,
  panFromSlider, panToSlider, clampLevel,
};
