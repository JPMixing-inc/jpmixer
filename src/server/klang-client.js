'use strict';

const osc = require('osc');
const EventEmitter = require('events');
const K = require('./klang-protocol.js');

// ── KLANG UDP transport ─────────────────────────────────────────────────────
// Owns the local UDP socket. Never imported by osc-server.js or dlive-*.js —
// kept entirely separate, same as the dLive path is from DiGiCo's.
//
// IMPORTANT ARCHITECTURAL LIMIT (unlike DiGiCo/dLive, both of which have a
// real transport-level notion of "connected" — a TCP socket for dLive, OSC
// echo replies for DiGiCo): UDP has no connection state, and this client
// deliberately doesn't implement KLANG's handshake/relay mechanism (see
// klang-protocol.js's file header — that's the only way to receive anything
// back from KLANG at all). So "open" here means only "the local UDP socket
// bound successfully" — it is NOT confirmation that a KLANG processor is
// actually present, reachable, or listening at the configured IP. Every
// send is fire-and-forget. klang-server.js's status reporting must not
// claim a stronger guarantee than this actually provides.
//
// Emits: 'open', 'error'
class KlangClient extends EventEmitter {
  constructor({ host, port = 9110 }) {
    super();
    this.host = host;
    this.port = port;
    this.ready = false;
    this._udp = null;
  }

  connect() {
    if (this._udp) return;
    const udp = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: 0 });
    this._udp = udp;
    udp.on('error', (err) => this.emit('error', err));
    udp.on('ready', () => { this.ready = true; this.emit('open'); });
    udp.open();
  }

  disconnect() {
    this.ready = false;
    if (this._udp) { try { this._udp.close(); } catch (_) {} }
    this._udp = null;
  }

  // Takes a builder so a bad value (e.g. Infinity) that makes the protocol
  // encoder throw is caught here as a failed send, not thrown at the caller.
  _send(build) {
    if (!this._udp || !this.ready) return false;
    try { this._udp.send(build(), this.host, this.port); return true; }
    catch (_) { return false; }
  }

  setGain(mix, ch, db)        { return this._send(() => K.gainDbMessage(mix, ch, db)); }
  setMute(mix, ch, on)        { return this._send(() => K.muteMessage(mix, ch, on)); }
  setSolo(mix, ch, on)        { return this._send(() => K.soloMessage(mix, ch, on)); }
  setName(mix, ch, name)      { return this._send(() => K.nameMessage(mix, ch, name)); }
  setColour(mix, ch, hex)     { return this._send(() => K.colourMessage(mix, ch, hex)); }
  setPan(mix, ch, deg)        { return this._send(() => K.panMessage(mix, ch, deg)); }
  setMixGain(mix, db)         { return this._send(() => K.mixGainDbMessage(mix, db)); }
  setMixName(mix, name)       { return this._send(() => K.mixNameMessage(mix, name)); }
}

module.exports = { KlangClient };
