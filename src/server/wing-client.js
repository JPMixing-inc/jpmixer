'use strict';

const osc = require('osc');
const EventEmitter = require('events');
const W = require('./wing-protocol.js');

// ── WING UDP transport ──────────────────────────────────────────────────────
// Owns the local UDP socket and the OSC port (2223). Never imported by
// osc-server.js/dlive-*.js/klang-*.js — kept entirely separate.
//
// UNLIKE dLive/KLANG: WING's GET is a real synchronous-shaped request/
// response (send an address with no args, the console replies with the
// current value on that same address) — so this client actually resolves a
// Promise per outbound GET, with a timeout, rather than the fire-and-forget
// pattern the other two backends are stuck with. That's used for connection
// liveness (a real round-trip, not just "did the local socket open") and
// for priming names/values on connect.
//
// SET, on the other hand, is intentionally still fire-and-forget here: the
// console's SET confirmation always replies on the fixed address '/*' with
// no way to tell which of several in-flight SETs it's confirming (per the
// doc's own examples) — there's no way to correlate it back to one write,
// so tracking individual SET success isn't meaningful. Fader-drag-rate SETs
// go out the same way KLANG's/dLive's do.
//
// Emits: 'open', 'error'
class WingClient extends EventEmitter {
  constructor({ host, port = 2223, getTimeoutMs = 1500 }) {
    super();
    this.host = host;
    this.port = port;
    this.getTimeoutMs = getTimeoutMs;
    this.ready = false;
    this._udp = null;
    this._pendingGets = new Map(); // address -> [{resolve, timer}, ...] FIFO per address
  }

  connect() {
    if (this._udp) return;
    // No metadata:true — with it, every incoming arg comes back as a
    // {type, value} object instead of a plain JS value (a real bug hit
    // elsewhere in this app's history, see osc-server.js). Without it, the
    // `osc` package auto-infers plain values on receive too, so
    // _handleMessage below can use msg.args directly.
    const udp = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: 0 });
    this._udp = udp;
    udp.on('error', (err) => this.emit('error', err));
    udp.on('ready', () => { this.ready = true; this.emit('open'); });
    udp.on('message', (msg) => this._handleMessage(msg));
    udp.open();
  }

  disconnect() {
    this.ready = false;
    for (const queue of this._pendingGets.values()) {
      for (const p of queue) { clearTimeout(p.timer); p.resolve(null); }
    }
    this._pendingGets.clear();
    if (this._udp) { try { this._udp.close(); } catch (_) {} }
    this._udp = null;
  }

  _handleMessage(msg) {
    const address = msg.address;
    const queue = this._pendingGets.get(address);
    if (!queue || queue.length === 0) return; // unsolicited/unmatched — ignore, no subscription model implemented here
    const pending = queue.shift();
    if (queue.length === 0) this._pendingGets.delete(address);
    clearTimeout(pending.timer);
    pending.resolve(W.decodeGetReply(msg.args));
  }

  // Resolves with the decoded value, or null on timeout/no connection —
  // never rejects, so a slow/unreachable console degrades to "unknown"
  // rather than an unhandled rejection somewhere in the caller.
  _get(address) {
    return new Promise((resolve) => {
      if (!this._udp || !this.ready) { resolve(null); return; }
      const timer = setTimeout(() => {
        const queue = this._pendingGets.get(address);
        if (queue) {
          const idx = queue.findIndex(p => p.timer === timer);
          if (idx !== -1) queue.splice(idx, 1);
          if (queue.length === 0) this._pendingGets.delete(address);
        }
        resolve(null);
      }, this.getTimeoutMs);
      if (!this._pendingGets.has(address)) this._pendingGets.set(address, []);
      this._pendingGets.get(address).push({ resolve, timer });
      try { this._udp.send(W.getMessage(address), this.host, this.port); }
      catch (_) { /* leave the pending entry to time out */ }
    });
  }

  // Takes a builder so a bad value (e.g. Infinity) that makes the protocol
  // encoder throw is caught here as a failed send, not thrown at the caller.
  _send(build) {
    if (!this._udp || !this.ready) return false;
    try { this._udp.send(build(), this.host, this.port); return true; }
    catch (_) { return false; }
  }

  // ── Liveness — a real round trip, unlike KLANG's "did the socket open" ──
  async checkConnected() {
    const v = await this._get('/ch/1/fdr');
    return v !== null;
  }

  // ── Outbound API ─────────────────────────────────────────────────────────
  setSendLevel(ch, bus, db)  { return this._send(() => W.sendLevelSet(ch, bus, db)); }
  setSendPan(ch, bus, pan)   { return this._send(() => W.sendPanSet(ch, bus, pan)); }
  setSendOn(ch, bus, on)     { return this._send(() => W.sendOnSet(ch, bus, on)); }
  setChannelFader(ch, db)    { return this._send(() => W.channelFaderSet(ch, db)); }
  setChannelMute(ch, on)     { return this._send(() => W.channelMuteSet(ch, on)); }

  getChannelName(ch) { return this._get(`/ch/${ch}/name`); }
  getBusName(bus)     { return this._get(`/bus/${bus}/name`); }
  getSendLevel(ch, bus) { return this._get(`/ch/${ch}/send/${bus}/lvl`); }
  // true/false, or null if the console didn't answer
  async getSendOn(ch, bus) {
    const v = await this._get(`/ch/${ch}/send/${bus}/on`);
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return v !== 0;
    return /^(on|1|true)$/i.test(String(v).trim());
  }
}

module.exports = { WingClient };
