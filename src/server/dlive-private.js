'use strict';

const net = require('net');
const dgram = require('dgram');
const EventEmitter = require('events');

// ── dLive's own app protocol (TCP 51321), for per-send pan ──────────────
// A&H's public MIDI protocol (dlive-client.js) has no pan for a send, so
// JPMixer reads and sets it the way A&H's dLive4You app does, decoded from
// that app talking to dLive Director 2.12 offline (2026-10-29). Only pan
// goes this way; everything else stays on MIDI. A private protocol can
// change with a firmware update: if anything here doesn't answer, pan is
// simply not offered (dlive-server.js).
//
//   e0 | u16 len | payload | e7    hello: 01 03 <u16 our UDP port>, then 04 03
//   f1 | u16 1 | u32 src | u32 dst | u32 type | u32 len | payload | f8
//     type 4 to object 1       look an object up by name -> type 2 { u32 id }, or 3 (none)
//     type 6 to object 1       subscribe { u16 0, u32 handle, u16 0, u16 0x1000, u16 0, u16 param, u16 1 }
//     type 8 to the handle     ask for its value -> type 0x1000 { u16 value }, and again
//                              whenever it changes, made anywhere
//     type <param>             set it (src = the object, dst = the handle) { u16 value }
//   UDP: the console pings e0 00 01 03 e7 every second at our address and
//   the port in the hello; with no echo it drops us after about 9 s.
//
// Emits 'connect', 'close', 'value' { handle, value }.
const PORT = 51321;
const T = { LOOKUP: 4, FOUND: 2, NOT_FOUND: 3, SUBSCRIBE: 6, GET: 8, VALUE: 0x1000 };

// Kept steady, as JPMixer's other console links are: questions go out at a
// steady pace (a set goes at once), one name lookup at a time (answers carry
// no name, so a late one would answer the next question), and a link that
// goes quiet or out of step is dropped and opened again.
const PACE_PER_TICK = 40, PACE_MS = 20;   // up to 2000 messages a second
const LOOKUP_MS = 3000;
const PING_LOST_MS = 6000;                // the console pings every second
const MAX_FRAME = 1 << 20;
const START = new Set([0xf1, 0xf0, 0xe0]);

class DlivePrivate extends EventEmitter {
  constructor({ host, port = PORT }) {
    super();
    this.host = host;
    this.port = port;
    this.connected = false;
    this._sock = null; this._udp = null; this._buf = Buffer.alloc(0);
    this._lookupChain = Promise.resolve();
    this._lookup = null;           // the lookup waiting for its answer: { resolve }
    this._queue = []; this._pacer = null;
    this._lastPing = 0; this._watch = null;
    this._nextHandle = 0x6000;
    this._stopped = false; this._retry = null; this._delay = 2000;
  }

  connect() { this._stopped = false; this._open(); }

  _later() {
    if (this._stopped) return;
    clearTimeout(this._retry);
    this._retry = setTimeout(() => this._open(), this._delay);
    this._delay = Math.min(this._delay * 2, 30000);
  }

  _open() {
    const udp = dgram.createSocket('udp4');
    udp.on('message', (m, from) => { this._lastPing = Date.now(); try { udp.send(m, from.port, from.address); } catch (_) {} });
    let bound = false;
    udp.on('error', () => { if (!bound) { try { udp.close(); } catch (_) {} this._later(); } });
    udp.bind(0, () => {
      bound = true;
      if (this._stopped) { try { udp.close(); } catch (_) {} return; }
      this._udp = udp;
      const port = udp.address().port;
      const sock = net.createConnection({ host: this.host, port: this.port });
      this._sock = sock;
      this._buf = Buffer.alloc(0);
      sock.setNoDelay(true);
      sock.setKeepAlive(true, 5000);
      sock.on('connect', () => {
        sock.write(Buffer.from([0xe0, 0, 4, 0x01, 0x03, port >> 8, port & 0xff, 0xe7]));
        sock.write(Buffer.from([0xe0, 0, 2, 0x04, 0x03, 0xe7]));
        this.connected = true;
        this._delay = 2000;
        this._lastPing = 0;
        // Once the console has pinged, its pings stopping means the link is gone
        this._watch = setInterval(() => { if (this._lastPing && Date.now() - this._lastPing > PING_LOST_MS) this._drop(); }, 1000);
        this.emit('connect');
      });
      sock.on('data', (d) => this._onData(d));
      sock.on('error', () => {});
      sock.on('close', () => {
        if (this._sock !== sock) return;
        const was = this.connected;
        this._reset();
        try { udp.close(); } catch (_) {}
        this._udp = null;
        if (was) this.emit('close');
        this._later();
      });
    });
  }
  // Everything waiting is dropped (its answers would never come)
  _reset() {
    this.connected = false; this._sock = null;
    clearInterval(this._watch); this._watch = null;
    clearInterval(this._pacer); this._pacer = null; this._queue = [];
    if (this._lookup) { const l = this._lookup; this._lookup = null; l.resolve(null); }
  }
  // Out of step or quiet: closed, and opened again
  _drop() { if (this._sock) { try { this._sock.destroy(); } catch (_) {} } }

  disconnect() {
    this._stopped = true;
    clearTimeout(this._retry);
    const sock = this._sock;
    this._reset();
    if (sock) { try { sock.destroy(); } catch (_) {} }
    if (this._udp) { try { this._udp.close(); } catch (_) {} this._udp = null; }
  }

  _write(bytes) {
    if (!this._sock || !this.connected) return false;
    try { this._sock.write(bytes); return true; } catch (_) { return false; }
  }
  _frame(src, dst, type, payload = Buffer.alloc(0)) {
    const h = Buffer.alloc(19);
    h[0] = 0xf1; h.writeUInt16BE(1, 1); h.writeUInt32BE(src >>> 0, 3); h.writeUInt32BE(dst >>> 0, 7); h.writeUInt32BE(type >>> 0, 11); h.writeUInt32BE(payload.length, 15);
    return Buffer.concat([h, payload, Buffer.from([0xf8])]);
  }
  _f1(src, dst, type, payload) { return this._write(this._frame(src, dst, type, payload)); }
  // Questions (subscriptions, reads, lookups) at a steady pace, in order
  _paced(frame, then) {
    if (!this.connected) return false;
    this._queue.push({ frame, then });
    if (!this._pacer) this._pacer = setInterval(() => {
      for (let i = 0; i < PACE_PER_TICK && this._queue.length; i++) { const q = this._queue.shift(); this._write(q.frame); if (q.then) q.then(); }
      if (!this._queue.length) { clearInterval(this._pacer); this._pacer = null; }
    }, PACE_MS);
    return true;
  }

  _onData(d) {
    let buf = this._buf.length ? Buffer.concat([this._buf, d]) : d;
    for (;;) {
      if (!buf.length) break;
      const m = buf[0];
      if (!START.has(m)) {
        // Out of step: on to the next message start, and the link opened again
        // if this happens (an answer may have been lost with it)
        let i = 1; while (i < buf.length && !START.has(buf[i])) i++;
        buf = buf.subarray(i);
        this._drop();
        break;
      }
      let n = null;
      if (m === 0xf1) { if (buf.length >= 19) n = 20 + buf.readUInt32BE(15); }
      else if (m === 0xf0) { if (buf.length >= 11) n = 12 + buf.readUInt16BE(9); }
      else if (buf.length >= 3) n = 4 + buf.readUInt16BE(1);
      if (n !== null && n > MAX_FRAME) { buf = Buffer.alloc(0); this._drop(); break; } // no real message is that long
      if (n === null || buf.length < n) break;
      const f = buf.subarray(0, n);
      buf = buf.subarray(n);
      if (m === 0xf1) this._onMessage(f.readUInt32BE(3), f.readUInt32BE(7), f.readUInt32BE(11), f.subarray(19, n - 1));
    }
    this._buf = buf.length ? Buffer.from(buf) : Buffer.alloc(0);
  }
  _onMessage(src, dst, type, payload) {
    // A name lookup's answer, from object 1 (one lookup is asked at a time)
    if (src === 1 && dst === 0 && (type === T.FOUND || type === T.NOT_FOUND)) {
      const l = this._lookup; this._lookup = null;
      if (l) l.resolve(type === T.FOUND && payload.length >= 4 ? payload.readUInt32BE(0) : null);
      else this._drop(); // an answer nothing asked for: out of step
      return;
    }
    if (type === T.VALUE && payload.length >= 1) this.emit('value', { handle: src, value: payload.length >= 2 ? payload.readUInt16BE(0) : payload[0], bytes: payload.length });
  }

  // An object's id by its name, or null. One at a time; one that isn't
  // answered drops the link (a late answer would answer the next lookup)
  lookup(name, timeoutMs = LOOKUP_MS) {
    const run = () => new Promise((resolve) => {
      if (!this.connected) { resolve(null); return; }
      let timer = null;
      const entry = { resolve: (v) => { clearTimeout(timer); resolve(v); } };
      const frame = this._frame(0, 1, T.LOOKUP, Buffer.from(String(name) + '\0', 'latin1'));
      if (!this._paced(frame, () => {
        this._lookup = entry;
        timer = setTimeout(() => { if (this._lookup === entry) { this._lookup = null; resolve(null); this._drop(); } }, timeoutMs);
      })) resolve(null);
    });
    const p = this._lookupChain.then(run, run);
    this._lookupChain = p.then(() => {}, () => {});
    return p;
  }
  // Subscribe to one parameter of an object: its value comes as 'value' { handle }
  subscribe(obj, param) {
    if (!this.connected) return null;
    const handle = this._nextHandle++;
    const p = Buffer.alloc(16);
    p.writeUInt32BE(handle, 2); p.writeUInt16BE(0x1000, 8); p.writeUInt16BE(param & 0xffff, 12); p.writeUInt16BE(1, 14);
    this._paced(this._frame(obj, 1, T.SUBSCRIBE, p));
    this._paced(this._frame(obj, handle, T.GET));
    return handle;
  }
  // A value of 2 bytes (levels, pans), or 1 (a switch: 1 on, 0 off). At once.
  set(obj, handle, param, value, bytes = 2) {
    const v = Buffer.alloc(bytes === 1 ? 1 : 2);
    if (bytes === 1) v[0] = value ? 1 : 0;
    else v.writeUInt16BE(Math.max(0, Math.min(0xffff, Math.round(value))));
    return this._f1(obj, handle, param & 0xffff, v);
  }
}

// An input channel's place in the mixer: 16 modules of 8 ("Input Mixer
// Module, Number 01" holds inputs 1-8), and its slot in that module
const inputModuleName = (ch) => `Input Mixer Module, Number ${String(Math.ceil(ch / 8)).padStart(2, '0')}`;
const inputSlot = (ch) => (ch - 1) % 8;
// Each slot has a window of 64 places, one per mix in the show's bus list
// (mixIndex 0-63: groups, then auxes, mono before stereo). A stereo mix has
// two places, left and right; its send is set on the left one.
const PARAM_BASE = { pan: 0x1b70, level: 0x1970 };
const inputParam = (what, ch, mixIndex) => PARAM_BASE[what] + 0x40 * inputSlot(ch) + mixIndex;
// Whether an input is half of a stereo pair: its high byte is 00 on a stereo
// input, 01 on a mono one (Director 2.12: inputs 1-16 stereo, 17 on mono).
// A pair is always an odd channel (left) and the next one; the console keeps
// a stereo channel's sends and pans on the left one.
const STEREO_PARAM = (ch) => 0x12b0 + inputSlot(ch);
const isStereoValue = (v, bytes = 2) => bytes === 2 && (v >> 8) === 0; // a 1-byte answer isn't this setting
// Pan 0 (full left) to 73 (full right), 37 in the middle; the pages use
// 0..1 with 0.5 the middle, so each side is scaled on its own (37 steps
// left, 36 right) and the middle reads C, not R1
const PAN_MAX = 73, PAN_MID = 37;
const panToSlider = (v) => { const x = Math.max(0, Math.min(PAN_MAX, v)); return x <= PAN_MID ? x / PAN_MID / 2 : 0.5 + (x - PAN_MID) / (PAN_MAX - PAN_MID) / 2; };
const sliderToPan = (p) => { const x = Math.max(0, Math.min(1, p)); return x <= 0.5 ? Math.round(x * 2 * PAN_MID) : PAN_MID + Math.round((x - 0.5) * 2 * (PAN_MAX - PAN_MID)); };
// A send level as this protocol has it: 0x8000 + dB × 256; 0 is off
const levelToDb = (v) => (v === 0 ? -Infinity : (v - 0x8000) / 256);
const dbToValue = (db) => Math.max(0, Math.min(0xffff, Math.round(0x8000 + db * 256)));

// A mix's own processing, as dLive4You offers it (decoded 2026-10-29): its
// objects are named after the mix's place in the bus list, counted from 1
// ("Graphic EQ, Mix Channel 13 - Intermediate" is the mix at place 12).
//   Graphic EQ   0x1000 in (1 byte), bands 0x1004 (31.5 Hz) to 0x101f (16 kHz): dB, ±12
//   Compressor   0x1007 in (1 byte), 0x1000 threshold: dB, -46 to +18
const mixObjectName = (kind, place) => `${kind === 'geq' ? 'Graphic EQ' : 'Compressor'}, Mix Channel ${place + 1} - Intermediate`;
const GEQ = { IN: 0x1000, FIRST_BAND: 0x1004, BANDS: 28, MAX: 12, FREQS: [31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000] };
const COMP = { IN: 0x1007, THRESH: 0x1000, MIN: -46, MAX: 18 };

module.exports = { DlivePrivate, inputModuleName, inputSlot, inputParam, STEREO_PARAM, isStereoValue, dbToValue, mixObjectName, GEQ, COMP, panToSlider, sliderToPan, levelToDb, PAN_MAX, PORT };
