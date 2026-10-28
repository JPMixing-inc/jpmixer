'use strict';

const net = require('net');
const EventEmitter = require('events');
const P = require('./lv1-protocol.js');

// ── LV1 TCP transport ───────────────────────────────────────────────────────
// One TCP connection to LV1's MyMon service: handshake, ping/pong, and
// reconnecting. See lv1-protocol.js for the wire format.
//
// LV1 chooses its port at launch, so `resolveTarget` is asked for
// { host, port } before every connection attempt (Settings, or discovery).
//
// Emits:
//   'connected'          after LV1 answers the handshake
//   'disconnected'       the connection dropped (it reconnects by itself)
//   'message' (m)        every message except ping/pong: { address, args }
//   'error' (err)
class Lv1Client extends EventEmitter {
  constructor({ resolveTarget, deviceName = 'JPMixer', deviceId, retryMs = 2000, silenceMs = 4000, handshakeMs = 5000 }) {
    super();
    this.host = null;
    this.resolveTarget = resolveTarget;
    this.deviceName = deviceName;
    this.deviceId = deviceId;
    this.retryMs = retryMs;
    this.silenceMs = silenceMs; // LV1 pings every 200 ms; this long with nothing means it's gone
    this.handshakeMs = handshakeMs; // LV1 answers the handshake at once; anything else on that port isn't LV1's MyMon service
    this._handshakeTimer = null;
    this.connected = false;
    this.port = null;
    this._socket = null;
    this._stopped = true;
    this._retry = null;
    this._pingTimer = null;
    this._pings = 0;
    this._lastRx = 0;
  }

  connect() {
    this._stopped = false;
    this._attempt();
  }

  // Graceful by default: writes already queued (a mute being released on
  // shutdown) go out before the socket closes; destroy() would drop them.
  disconnect() {
    this._stopped = true;
    clearTimeout(this._retry); this._retry = null;
    const socket = this._socket;
    if (socket && !socket.destroyed) {
      this._socket = null;
      clearInterval(this._pingTimer); this._pingTimer = null;
      clearTimeout(this._handshakeTimer); this._handshakeTimer = null;
      socket.removeAllListeners('close'); socket.removeAllListeners('data'); socket.removeAllListeners('connect'); socket.on('error', () => {});
      // Still connecting: nothing to deliver, so don't let it finish and
      // turn up at LV1 as a second JPMixer
      // Otherwise a moment before closing, so LV1 reads the last writes (the
      // mutes released on shutdown) before the close arrives — dLive
      // Director dropped writes ended straight after
      if (socket.connecting) socket.destroy();
      else { setTimeout(() => { try { socket.end(); } catch (_) {} }, 250); setTimeout(() => socket.destroy(), 1500).unref(); }
      if (this.connected) { this.connected = false; this.emit('disconnected'); }
      return;
    }
    this._drop(false);
  }

  async _attempt() {
    if (this._stopped || this._socket) return;
    let target = null;
    try { target = await this.resolveTarget(); } catch (_) {}
    if (this._stopped || this._socket) return;
    const port = target && target.port;
    if (!target || !target.host || !Number.isInteger(port) || port < 1 || port > 65535) { this._scheduleRetry(); return; }
    this.host = target.host; this.port = port;
    const socket = net.connect({ host: this.host, port });
    socket.setNoDelay(true);
    this._socket = socket;
    const reader = new P.FrameReader();
    socket.on('connect', () => {
      this._lastRx = Date.now();
      socket.write(P.msg.handshake());
      socket.write(P.msg.deviceName(this.deviceName, this.deviceId));
      this._handshakeTimer = setTimeout(() => {
        if (this._socket !== socket || this.connected) return;
        this.emit('error', new Error(`no MyMon handshake from ${this.host}:${this.port} — is that LV1's remote port?`));
        this._drop(true);
      }, this.handshakeMs);
      // Our own keep-alive, as Waves' apps send; also how a silent LV1 is noticed
      this._pingTimer = setInterval(() => {
        if (Date.now() - this._lastRx > this.silenceMs) { this._drop(true); return; }
        this._write(() => P.msg.ping(process.hrtime.bigint(), this._pings++));
      }, 1000);
    });
    socket.on('data', (chunk) => {
      this._lastRx = Date.now();
      // Messages that arrived whole before any garbled data still count
      for (const m of reader.push(chunk)) {
        if (this._socket !== socket) return;
        if (m.address === '/ping') { this._write(() => P.msg.pong(m.args)); continue; }
        if (m.address === '/pong') continue;
        if (m.address === '/handshake' && !this.connected) { this.connected = true; clearTimeout(this._handshakeTimer); this._handshakeTimer = null; this.emit('connected'); }
        this.emit('message', m);
      }
      if (reader.lost && this._socket === socket) { this.emit('error', new Error('garbled data from LV1 — reconnecting')); this._drop(true); }
    });
    socket.on('error', (err) => this.emit('error', err));
    socket.on('close', () => { if (this._socket === socket) this._drop(true); });
  }

  _drop(retry) {
    const socket = this._socket;
    this._socket = null;
    clearInterval(this._pingTimer); this._pingTimer = null;
    clearTimeout(this._handshakeTimer); this._handshakeTimer = null;
    if (socket) { socket.removeAllListeners('close'); socket.on('error', () => {}); socket.destroy(); }
    if (this.connected) { this.connected = false; this.emit('disconnected'); }
    if (retry) this._scheduleRetry();
  }

  _scheduleRetry() {
    if (this._stopped || this._retry) return;
    this._retry = setTimeout(() => { this._retry = null; this._attempt(); }, this.retryMs);
  }

  // A builder, so a value the encoder rejects is a failed send, not a throw
  _write(build) {
    if (!this._socket || this._socket.destroyed) return false;
    try { this._socket.write(build()); return true; } catch (_) { return false; }
  }

  // ── Outbound (JPMixer channel/aux numbers start at 1) ──────────────────
  getSends(aux) { return this.connected && this._write(() => P.msg.getSends(aux - 1)); }
  setSendLevel(ch, aux, db) { return this.connected && this._write(() => P.msg.setSendGain(P.TRACK.INPUT, ch - 1, aux - 1, db)); }
  setSendOn(ch, aux, on) { return this.connected && this._write(() => P.msg.setSendOn(P.TRACK.INPUT, ch - 1, aux - 1, on)); }
  setSendPan(ch, aux, slider) { return this.connected && this._write(() => P.msg.setSendPan(P.TRACK.INPUT, ch - 1, aux - 1, P.panFromSlider(slider))); }
  // A track's own fader, mute and the desk's solo (type from P.TRACK, n from 1)
  setTrackGain(type, n, db) { return this.connected && this._write(() => P.msg.setTrackGain(type, n - 1, db)); }
  setTrackMute(type, n, on) { return this.connected && this._write(() => P.msg.setTrackMute(type, n - 1, on)); }
  setSolo(type, n, on) { return this.connected && this._write(() => P.msg.setSolo(type, n - 1, on)); }
  // A track's EQ (n from 1): ask for all of it, or set one band's gain, freq, Q or on, or the EQ in/out
  getEq(type, n) { return this.connected && this._write(() => P.msg.getEq(type, n - 1)); }
  setEqBand(type, n, band, param, value) {
    const build = { gain: P.msg.setEqGain, freq: P.msg.setEqFreq, q: P.msg.setEqQ, on: P.msg.setEqBandOn }[param];
    return !!build && this.connected && this._write(() => build(type, n - 1, band, value));
  }
  setEqIn(type, n, on) { return this.connected && this._write(() => P.msg.setEqIn(type, n - 1, on)); }
  // LV1's scene at this index in its scene list (from 0, as LV1 numbers them)
  recallScene(index) { return this.connected && this._write(() => P.msg.recallScene(index)); }
}

module.exports = { Lv1Client };
