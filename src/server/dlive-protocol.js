'use strict';

// ── dLive MIDI Over TCP/IP Protocol (Firmware V2.0) ─────────────────────────
// Pure, side-effect-free protocol logic: channel addressing, value scaling,
// and MIDI message encode/decode. No sockets here — see dlive-client.js for
// the TCP transport. Kept entirely separate from osc-server.js/DiGiCo on
// purpose: this file is never imported by the DiGiCo path.
//
// Reference: "dLive MIDI Over TCP/IP Protocol, Firmware V2.0" (Allen & Heath,
// June 2024) plus its "dLive MIDI TCP/IP Reference Table v2.0" appendix.

// ── SysEx header ─────────────────────────────────────────────────────────
// F0 00 00 1A 50 10 MV mV — MV/mV (major/minor doc version bytes) are fixed
// constants per the spec, not something callers vary.
const SYSEX_HEADER = [0xF0, 0x00, 0x00, 0x1A, 0x50, 0x10, 0x01, 0x00];
const SYSEX_END = 0xF7;

// ── Channel banking ──────────────────────────────────────────────────────
// dLive doesn't address channels with a string path like DiGiCo OSC does.
// Instead a MIDI channel selects a *bank* (Inputs / Groups / Aux+FX sends /
// Matrix / everything else) and a byte within that bank's message selects
// the specific channel. `baseN` is the console's configured base MIDI
// channel (Utility / Control / MIDI), 0-11 (channels 1-12).
//
// Returns { midiCh, ch } where midiCh is a 0-15 nibble (goes into the low
// bits of a MIDI status byte) and ch is the 0x00-0x7F selector byte used in
// note numbers / NRPN select messages / SysEx channel bytes.
function coordinate(baseN, type, index) {
  if (baseN < 0 || baseN > 11) throw new RangeError(`baseN must be 0-11, got ${baseN}`);
  const i = index - 1; // 1-based channel numbers in, 0-based byte offsets out

  switch (type) {
    case 'input':
      if (i < 0 || i > 127) throw new RangeError(`input channel ${index} out of range (1-128)`);
      return { midiCh: baseN, ch: i };

    case 'monoGroup':
      if (i < 0 || i > 61) throw new RangeError(`mono group ${index} out of range (1-62)`);
      return { midiCh: baseN + 1, ch: i };
    case 'stereoGroup':
      if (i < 0 || i > 30) throw new RangeError(`stereo group ${index} out of range (1-31)`);
      return { midiCh: baseN + 1, ch: 0x40 + i };

    case 'monoAux':
      if (i < 0 || i > 61) throw new RangeError(`mono aux ${index} out of range (1-62)`);
      return { midiCh: baseN + 2, ch: i };
    case 'stereoAux':
      if (i < 0 || i > 30) throw new RangeError(`stereo aux ${index} out of range (1-31)`);
      return { midiCh: baseN + 2, ch: 0x40 + i };

    case 'monoMatrix':
      if (i < 0 || i > 61) throw new RangeError(`mono matrix ${index} out of range (1-62)`);
      return { midiCh: baseN + 3, ch: i };
    case 'stereoMatrix':
      if (i < 0 || i > 30) throw new RangeError(`stereo matrix ${index} out of range (1-31)`);
      return { midiCh: baseN + 3, ch: 0x40 + i };

    case 'monoFxSend':
      if (i < 0 || i > 15) throw new RangeError(`mono FX send ${index} out of range (1-16)`);
      return { midiCh: baseN + 4, ch: i };
    case 'stereoFxSend':
      if (i < 0 || i > 15) throw new RangeError(`stereo FX send ${index} out of range (1-16)`);
      return { midiCh: baseN + 4, ch: 0x10 + i };
    case 'fxReturn':
      if (i < 0 || i > 15) throw new RangeError(`FX return ${index} out of range (1-16)`);
      return { midiCh: baseN + 4, ch: 0x20 + i };
    case 'main':
      if (i < 0 || i > 5) throw new RangeError(`main ${index} out of range (1-6)`);
      return { midiCh: baseN + 4, ch: 0x30 + i };
    case 'dca':
      if (i < 0 || i > 23) throw new RangeError(`DCA ${index} out of range (1-24)`);
      return { midiCh: baseN + 4, ch: 0x36 + i };
    case 'muteGroup':
      if (i < 0 || i > 7) throw new RangeError(`mute group ${index} out of range (1-8)`);
      return { midiCh: baseN + 4, ch: 0x4E + i };
    case 'stereoUfxSend':
      if (i < 0 || i > 7) throw new RangeError(`stereo UFX send ${index} out of range (1-8)`);
      return { midiCh: baseN + 4, ch: 0x56 + i };
    case 'stereoUfxReturn':
      if (i < 0 || i > 7) throw new RangeError(`stereo UFX return ${index} out of range (1-8)`);
      return { midiCh: baseN + 4, ch: 0x5E + i };

    default:
      throw new TypeError(`unknown channel type "${type}"`);
  }
}

// ── Fader value scaling (dB <-> LV byte) ────────────────────────────────
// The spec's own worked table (page 9) gives named anchor points on a
// 00-7F scale from -45dB to +10dB, and every single one of them — verified
// against an independent, real-world MIDI-TCP implementation
// (bitfocus/companion-module-allenheath-dlive-ilive) — sits on one exact
// line: db = (lv - 0x6B) / 2, i.e. precisely 0.5dB per LV step, with LV=0
// reserved as a hard "-inf" sentinel rather than continuing the line.
// (One anchor — +5dB — is listed in this file's earlier revision as
// lv=0x74/116, which breaks that line by 0.5dB; cross-checking the same
// spec against that independent implementation confirms it's 0x75/117, and
// that the OCR pass on the source PDF misread the digit. The formula below
// matches all twelve documented anchors exactly once corrected.)
//
// A&H doesn't document this formula explicitly, only the anchor table, so
// extrapolating it below -45dB (down to where clamping makes it read as
// LV=0, i.e. "off") is an inference from the pattern holding with zero
// exceptions across the entire documented range — not a written guarantee.
function dbToLv(db) {
  if (db <= -Infinity) return 0x00;
  return Math.max(0, Math.min(0x7F, Math.round(db * 2 + 0x6B)));
}

function lvToDb(lv) {
  lv = Math.max(0, Math.min(0x7F, lv));
  if (lv === 0) return -Infinity;
  return (lv - 0x6B) / 2;
}

// ── NRPN parameter IDs (fader/send-related subset actually used) ────────
const PARAM = {
  FADER_LEVEL: 0x17,
  MAIN_ASSIGN: 0x18,
  DCA_MUTE_ASSIGN: 0x40,
};

// ── MIDI status byte helpers ─────────────────────────────────────────────
const noteOnStatus  = (midiCh) => 0x90 | midiCh;
const ccStatus       = (midiCh) => 0xB0 | midiCh;
const pcStatus        = (midiCh) => 0xC0 | midiCh;

// Solo isn't in the official V2.0 doc this file is otherwise built from —
// found only by cross-checking against a real independent implementation
// (bitfocus/companion-module-allenheath-dlive-ilive). It's a CC pair, not
// NRPN or SysEx like everything else here: select-channel on CC 0x73, then
// on/off (0x7F/0x00) as the value on CC 0x26. Confirmed against dLive
// Director 2.12 offline (2026-10-21): it solos the channel, and the console
// sends the same pair to its other controllers. There's no way to ask for
// the current solo state. Used by the Console Controller (the desk's own
// solo); the musician mixer's per-mix solo zeroes sends instead, as on DiGiCo.
const SOLO = { SELECT: 0x73, VALUE: 0x26 };
function buildSoloSet(midiCh, ch, on) {
  const s = ccStatus(midiCh);
  return [s, SOLO.SELECT, ch, s, SOLO.VALUE, on ? 0x7F : 0x00];
}

// ── Message builders (writer side — always emits full status bytes; the
// spec's running-status examples are an optimization for the *sender*, not
// a requirement, so writing full messages every time is valid and simpler) ──

function buildFaderSet(midiCh, ch, lv) {
  const s = ccStatus(midiCh);
  return [s, 0x63, ch, s, 0x62, PARAM.FADER_LEVEL, s, 0x06, lv];
}

function buildFaderGet(midiCh, ch) {
  return [...SYSEX_HEADER, midiCh, 0x05, 0x0B, PARAM.FADER_LEVEL, ch, SYSEX_END];
}

function buildMuteOn(midiCh, ch) {
  const s = noteOnStatus(midiCh);
  return [s, ch, 0x7F, s, ch, 0x00];
}

function buildMuteOff(midiCh, ch) {
  const s = noteOnStatus(midiCh);
  return [s, ch, 0x3F, s, ch, 0x00];
}

function buildMuteGet(midiCh, ch) {
  return [...SYSEX_HEADER, midiCh, 0x05, 0x09, ch, SYSEX_END];
}

// Aux/FX/Matrix send level — this is the one that matters most for JPMixer:
// it's the direct equivalent of DiGiCo's `/Input_Channels/N/Aux_Send/M/send_level`.
// `snd` is the destination aux/mix's own {midiCh, ch} coordinate.
function buildSendLevelSet(midiCh, ch, snd, lv) {
  return [...SYSEX_HEADER, midiCh, 0x0D, ch, snd.midiCh, snd.ch, lv, SYSEX_END];
}

function buildSendLevelGet(midiCh, ch, snd) {
  return [...SYSEX_HEADER, midiCh, 0x05, 0x0F, 0x0D, ch, snd.midiCh, snd.ch, SYSEX_END];
}

function buildNameSet(midiCh, ch, name) {
  const bytes = Buffer.from(String(name).slice(0, 32), 'ascii');
  return [...SYSEX_HEADER, midiCh, 0x03, ch, ...bytes, SYSEX_END];
}

function buildNameGet(midiCh, ch) {
  return [...SYSEX_HEADER, midiCh, 0x01, ch, SYSEX_END];
}

// Fixed 8-colour palette — dLive doesn't support arbitrary RGB like DiGiCo.
const COLOURS = ['#666666', '#e02020', '#3aa832', '#e0c020', '#2050d0', '#8020c0', '#20a0d0', '#f0f0f0'];
// Off, Red, Green, Yellow, Blue, Purple, Lt Blue, White (index = wire value)

function nearestColourIndex(hex) {
  if (!hex) return 0;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  let best = 0, bestDist = Infinity;
  COLOURS.forEach((c, idx) => {
    const cr = parseInt(c.slice(1, 3), 16), cg = parseInt(c.slice(3, 5), 16), cb = parseInt(c.slice(5, 7), 16);
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < bestDist) { bestDist = d; best = idx; }
  });
  return best;
}

function buildColourSet(midiCh, ch, hex) {
  return [...SYSEX_HEADER, midiCh, 0x06, ch, nearestColourIndex(hex), SYSEX_END];
}

function buildColourGet(midiCh, ch) {
  return [...SYSEX_HEADER, midiCh, 0x04, ch, SYSEX_END];
}

// Scene recall — MixRack only. 500 scenes across 4 banks of ≤128 each.
// Unlike DiGiCo, dLive has no scene *name* query over this protocol — only
// a numeric id — so Ear Scenes on dLive have to key off scene number.
function buildSceneRecall(baseN, sceneNumber) {
  if (baseN < 0 || baseN > 11) throw new RangeError(`baseN must be 0-11, got ${baseN}`);
  if (sceneNumber < 1 || sceneNumber > 500) throw new RangeError(`scene ${sceneNumber} out of range (1-500)`);
  const bank = Math.floor((sceneNumber - 1) / 128);
  const ss = (sceneNumber - 1) % 128;
  return [ccStatus(baseN), 0x00, bank, pcStatus(baseN), ss];
}

function decodeSceneNumber(bank, ss) {
  return bank * 128 + ss + 1;
}

// ── MIDI byte-stream decoder ─────────────────────────────────────────────
// TCP delivers arbitrary chunk boundaries, and dLive uses MIDI running
// status (a message can omit its status byte if identical to the previous
// one) — so this needs to be a real stateful stream parser, not a
// packet-at-a-time reader like DiGiCo's OSC/UDP side.
//
// Usage: create one Decoder per connection, call .push(buffer) as bytes
// arrive, consume the array of decoded messages it returns.
class Decoder {
  constructor() {
    this._buf = [];        // unconsumed bytes
    this._runningStatus = null;
    this._inSysEx = false;
    this._sysExBytes = [];
  }

  push(chunk) {
    for (const b of chunk) this._buf.push(b);
    const out = [];
    let msg;
    while ((msg = this._tryDecodeOne()) !== undefined) {
      if (msg !== null) out.push(msg);
    }
    return out;
  }

  _tryDecodeOne() {
    if (this._buf.length === 0) return undefined;

    // Inside a SysEx block: consume until F7.
    if (this._inSysEx) {
      const idx = this._buf.indexOf(SYSEX_END);
      if (idx === -1) { this._sysExBytes.push(...this._buf); this._buf = []; return undefined; }
      this._sysExBytes.push(...this._buf.slice(0, idx));
      this._buf = this._buf.slice(idx + 1);
      this._inSysEx = false;
      const payload = this._sysExBytes;
      this._sysExBytes = [];
      return { type: 'sysex', bytes: payload };
    }

    let status = this._buf[0];
    let offset = 0;
    if (status & 0x80) {
      offset = 1;
    } else {
      // Running status — reuse the last real status byte, this byte is data.
      if (this._runningStatus == null) { this._buf.shift(); return null; } // desync, drop
      status = this._runningStatus;
      offset = 0;
    }

    if (status === 0xF0) {
      this._runningStatus = null; // SysEx clears running status
      this._buf = this._buf.slice(1);
      this._inSysEx = true;
      return null;
    }

    const type = status & 0xF0;
    const midiCh = status & 0x0F;

    if (type === 0x90 || type === 0xB0 || type === 0xE0) {
      // Note On, Control Change, Pitchbend — all 2 data bytes.
      if (this._buf.length < offset + 2) return undefined; // wait for more
      const d1 = this._buf[offset], d2 = this._buf[offset + 1];
      this._buf = this._buf.slice(offset + 2);
      this._runningStatus = status;
      if (type === 0x90) return { type: 'noteOn', midiCh, note: d1, velocity: d2 };
      if (type === 0xB0) return { type: 'cc', midiCh, controller: d1, value: d2 };
      return { type: 'pitchbend', midiCh, lsb: d1, msb: d2 };
    }

    if (type === 0xC0) {
      // Program Change — 1 data byte.
      if (this._buf.length < offset + 1) return undefined;
      const d1 = this._buf[offset];
      this._buf = this._buf.slice(offset + 1);
      this._runningStatus = status;
      return { type: 'programChange', midiCh, program: d1 };
    }

    // Unhandled status (e.g. system realtime) — drop the byte and resync.
    this._buf.shift();
    return null;
  }
}

// ── NRPN reassembler ──────────────────────────────────────────────────────
// Fader/PEQ/etc "Set" messages are 3 CC messages in sequence (NRPN MSB=CC99
// carrying the channel select byte, NRPN LSB=CC98 carrying the parameter
// ID, Data Entry MSB=CC6 carrying the value). Reassembles those into one
// logical event per MIDI channel, mirroring buildFaderSet's own shape.
// Keyed by midiCh -> a FIFO queue of { ch, param }, not a single slot. A
// single slot only reconstructs correctly if the console always finishes
// one channel's whole MSB/LSB/DataEntry triple before starting the next.
// If it instead interleaves by *phase* — e.g. two channels' CC99s back to
// back, then both CC98s, then both CC6s, plausible if independent internal
// events land in the same output buffer close together — a single slot
// would let the second CC99 silently clobber the first channel's pending
// state before its CC6 ever arrives, attributing one channel's value to
// another. A FIFO queue handles that: each CC99 opens a new entry rather
// than overwriting; each CC98 fills the oldest entry still missing a param;
// each CC6 completes and emits the oldest entry that has one. This assumes
// per-channel relative order is preserved across the three phases (the
// only assumption that makes the messages unambiguously matchable at all,
// since CC98/CC6 carry no channel identifier of their own) — true for both
// the fully-sequential case this always handled and the interleaved case
// it didn't. Unverified against real hardware whether interleaving like
// this ever actually happens; this is a defensive improvement either way.
const NRPN_QUEUE_CAP = 8; // guards against unbounded growth from a desynced/malformed stream
class NrpnReassembler {
  constructor() {
    this._pending = new Map();
  }

  // Feed one decoded `cc` event; returns a { midiCh, ch, param, value }
  // event once a full MSB/LSB/DataEntry sequence completes, else null.
  feed(cc) {
    if (cc.type !== 'cc') return null;

    if (cc.controller === 0x63) { // NRPN MSB = channel select — opens a new pending entry
      let queue = this._pending.get(cc.midiCh);
      if (!queue) { queue = []; this._pending.set(cc.midiCh, queue); }
      if (queue.length >= NRPN_QUEUE_CAP) queue.shift(); // drop the oldest rather than grow forever
      queue.push({ ch: cc.value, param: null });
      return null;
    }

    const queue = this._pending.get(cc.midiCh);
    if (!queue || queue.length === 0) return null;

    if (cc.controller === 0x62) { // NRPN LSB = parameter id — fills the oldest entry still missing one
      const entry = queue.find(e => e.param == null);
      if (entry) entry.param = cc.value;
      return null;
    }
    if (cc.controller === 0x06) { // Data Entry MSB = value — completes the oldest fully-selected entry
      const idx = queue.findIndex(e => e.param != null);
      if (idx === -1) return null;
      const [entry] = queue.splice(idx, 1);
      if (queue.length === 0) this._pending.delete(cc.midiCh);
      return { midiCh: cc.midiCh, ch: entry.ch, param: entry.param, value: cc.value };
    }
    return null;
  }
}

// ── TLS/SSL authentication ────────────────────────────────────────────────
// Spec: "the first data sent to the dLive should be the following message:
// UserProfile, UserPassword. Where UserProfile = 00 to 1F." That's the same
// comma-separated *byte* notation used for every other message in the doc
// (e.g. "BN, 63, CH" — always literal bytes, never a literal ',' character
// on the wire) — so this is one profile byte immediately followed by the
// password's raw ASCII bytes, with no separator byte at all.
//
// Cross-checked against the AHM TCP/IP Protocol doc (a sibling A&H product
// — same manufacturer, same SysEx header convention with a different
// product-ID byte, same authentication wording verbatim). AHM's protocol
// includes something dLive's doesn't: an explicit reference table with a
// "User Profile" column mapping Dec 1-32 to Hex 00-1F. That confirms
// UserProfile really is a numeric profile index, not a username string —
// this isn't just inferred from wording anymore.
function buildTlsAuthMessage(userProfile, password) {
  const profile = Math.max(0, Math.min(0x1F, Number(userProfile) || 0));
  return [profile, ...Buffer.from(String(password || ''), 'ascii')];
}

module.exports = {
  SYSEX_HEADER, SYSEX_END, PARAM, COLOURS, SOLO, buildSoloSet,
  coordinate, dbToLv, lvToDb, nearestColourIndex,
  buildFaderSet, buildFaderGet, buildMuteOn, buildMuteOff, buildMuteGet,
  buildSendLevelSet, buildSendLevelGet, buildNameSet, buildNameGet,
  buildColourSet, buildColourGet, buildSceneRecall, decodeSceneNumber,
  buildTlsAuthMessage,
  Decoder, NrpnReassembler,
};
