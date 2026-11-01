'use strict';

const osc = require('osc');
const EventEmitter = require('events');
const P = require('./m32-protocol');

// ── M32 / X32 UDP transport ─────────────────────────────────────────────────
// One local UDP socket to the console's port 10023. The console answers to
// whatever address and port a message came from.
//
// Keeping in step: /xremote asks the console to send every change (made on
// the desk, in M32-Edit or on another app) for 10 seconds, so it's sent
// again every 8. /xinfo every 2 seconds is the connection check: the
// console counts as connected while anything has come from it in the last 5.
//
// Reading: query() asks for one value. At most `window` questions are out at
// once and the next goes when one is answered (or after getTimeoutMs), so a
// whole show is read as fast as the console answers without flooding it.
// Questions wait while the console isn't answering. Answers and /xremote
// updates both arrive as 'message' events, so the server keeps its state the
// same way for each; query() also resolves with the value.
//
// Emits: 'open', 'connected', 'disconnected', 'message' ({ address, args }), 'error'
class M32Client extends EventEmitter {
  constructor({ host, port = P.PORT, window = 8, getTimeoutMs = 800, aliveMs = 5000, onTraffic = null }) {
    super();
    this.host = host;
    this.port = port;
    this.window = window;
    this.getTimeoutMs = getTimeoutMs;
    this.aliveMs = aliveMs;
    this.onTraffic = onTraffic; // (dir 'in' | 'out', { address, args }) for the traffic log
    this.ready = false;     // the local socket is open
    this.connected = false; // the console is answering
    this.unanswered = 0;    // questions that timed out, for the event log
    this._udp = null;
    this._timer = null;
    this._lastHeard = 0;
    this._lastXremote = 0;
    this._lastInfo = 0;
    this._queue = [];            // addresses waiting to be asked, in order
    this._waiting = new Map();   // address -> { resolvers: [], timer } (queued or asked)
    this._asked = new Set();     // addresses asked and not yet answered
  }

  connect() {
    if (this._udp) return;
    // No metadata:true: with it every argument arrives as { type, value }
    // (see osc-server.js)
    const udp = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: 0 });
    this._udp = udp;
    udp.on('error', (err) => this.emit('error', err));
    udp.on('ready', () => {
      if (this._udp !== udp) return;
      this.ready = true;
      this.emit('open');
      this._tick();
      this._timer = setInterval(() => this._tick(), 1000);
    });
    udp.on('message', (msg) => { if (this._udp === udp) this._onMessage(msg); });
    udp.open();
  }

  disconnect() {
    this.ready = false;
    this.connected = false;
    clearInterval(this._timer); this._timer = null;
    for (const w of this._waiting.values()) { clearTimeout(w.timer); for (const r of w.resolvers) r(null); }
    this._waiting.clear(); this._asked.clear(); this._queue = [];
    if (this._udp) { try { this._udp.close(); } catch (_) {} }
    this._udp = null;
  }

  _tick() {
    const now = Date.now();
    if (now - this._lastXremote >= 8000) this._xremote();
    if (now - this._lastInfo >= 2000) { this._lastInfo = now; this._raw(P.get(P.ADDR.info), false); }
    if (this.connected && now - this._lastHeard > this.aliveMs) {
      this.connected = false;
      this.emit('disconnected');
    }
  }
  _xremote() { this._lastXremote = Date.now(); this._raw(P.XREMOTE, false); }

  _onMessage(msg) {
    if (!msg || typeof msg.address !== 'string') return;
    this._lastHeard = Date.now();
    if (!this.connected) {
      this.connected = true;
      this._xremote(); // a console that restarted has forgotten this client
      this.emit('connected');
    }
    if (this.onTraffic) this.onTraffic('in', msg);
    this.emit('message', msg);
    const w = this._waiting.get(msg.address);
    if (w && this._asked.has(msg.address)) {
      this._asked.delete(msg.address);
      this._waiting.delete(msg.address);
      clearTimeout(w.timer);
      const value = Array.isArray(msg.args) ? msg.args[0] : undefined;
      for (const r of w.resolvers) r(value === undefined ? null : value);
    }
    this._pump();
  }

  // The local socket is open: a message goes out (the console may not be there)
  _raw(msg, log = true) {
    if (!this._udp || !this.ready) return false;
    try {
      this._udp.send(msg, this.host, this.port);
      if (log && this.onTraffic) this.onTraffic('out', msg);
      return true;
    } catch (_) { return false; }
  }

  // A change to the console. Takes a builder, so a bad value that makes the
  // protocol helpers throw is a failed send, not an exception for the caller.
  send(build) {
    let msg;
    try { msg = typeof build === 'function' ? build() : build; } catch (_) { return false; }
    return this._raw(msg);
  }

  // Asks for one value without queueing (the server's 1-second scene check)
  ask(address) { return this._raw(P.get(address), false); }

  // Asks for one value. Resolves with it, or null if the console didn't
  // answer; never rejects. front: ahead of everything already waiting (a
  // mix a phone has just opened). Asking again for an address already
  // waiting shares its answer (and with front, moves it up).
  query(address, front = false) {
    return new Promise((resolve) => {
      if (!this._udp) { resolve(null); return; }
      const w = this._waiting.get(address);
      if (w) {
        w.resolvers.push(resolve);
        if (front && !this._asked.has(address)) this._moveToFront(address);
        return;
      }
      this._waiting.set(address, { resolvers: [resolve], timer: null });
      if (front) this._queue.unshift(address); else this._queue.push(address);
      this._pump();
    });
  }
  // Moves addresses still waiting to be asked to the front, keeping their order
  promote(addresses) {
    const wanted = addresses.filter(a => this._waiting.has(a) && !this._asked.has(a));
    if (!wanted.length) return;
    const set = new Set(wanted);
    this._queue = [...wanted, ...this._queue.filter(a => !set.has(a))];
  }
  _moveToFront(address) {
    const at = this._queue.indexOf(address);
    if (at > 0) { this._queue.splice(at, 1); this._queue.unshift(address); }
  }
  pending() { return this._queue.length + this._asked.size; }

  _pump() {
    if (!this.connected) return;
    while (this._asked.size < this.window && this._queue.length) {
      const address = this._queue.shift();
      const w = this._waiting.get(address);
      if (!w) continue;
      this._asked.add(address);
      w.timer = setTimeout(() => {
        if (this._waiting.get(address) !== w) return;
        this._waiting.delete(address);
        this._asked.delete(address);
        this.unanswered++;
        for (const r of w.resolvers) r(null);
        this._pump();
      }, this.getTimeoutMs);
      this._raw(P.get(address), false);
    }
  }
}

module.exports = { M32Client };
