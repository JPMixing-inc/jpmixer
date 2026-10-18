'use strict';

const net = require('net');
const tls = require('tls');
const EventEmitter = require('events');
const P = require('./dlive-protocol.js');

// ── dLive MIDI-over-TCP/IP transport ────────────────────────────────────
// Owns the raw socket, MIDI byte framing, and reconnect policy. Never
// imported by osc-server.js — kept entirely separate from the DiGiCo path.
//
// Emits (in addition to standard 'connect'/'close'/'error'):
//   'authOk'                                    — TLS auth handshake succeeded
//   'sendLevel'   { midiCh, ch, sndMidiCh, sndCh, lv } — an aux/FX/matrix send level changed
//   'fader'       { midiCh, ch, lv }             — a channel/aux/DCA's own fader changed
//   'mainAssign'  { midiCh, ch, on }             — channel-to-main assignment changed
//   'mute'        { midiCh, ch, on }             — a mute status changed
//   'sceneRecall' { sceneNumber }                — a scene was recalled (by console or us)
//   'name'        { midiCh, ch, name }
//   'colour'      { midiCh, ch, colourIndex }
//
// NOTE: The spec explicitly documents that Fader Level, Mute, and Channel
// Assignment changes are echoed back unsolicited (it says so for each one).
// It does NOT explicitly say the same for Send Level, the message this
// whole integration leans on hardest — that's inferred by pattern
// consistency with the rest of the protocol, not confirmed in writing.
// dlive-server.js's poll mode exists specifically as a fallback in case
// this turns out to be wrong on real hardware — and per the research note
// in that file's header, real-world precedent (a working third-party dLive
// MIDI integration) leans toward treating *poll* as the mechanism actually
// worth trusting, not push.
//
// FINDINGS FROM RESEARCH (before any real hardware access) — see also the
// comment above dbToLv/lvToDb in dlive-protocol.js:
//   - MIDI/TCP has its own On/Off/Secure-Mode toggle on the console
//     (Utility → Control → MIDI, added firmware V1.91) that must be turned
//     on before anything can connect at all — same idea as DiGiCo Pad
//     needing manual enabling. Nothing in this codebase can detect or set
//     this; it's an operator setup step to document for the engineer.
//   - The GET/query mechanism this file's polling relies on was added in
//     firmware V1.91 too, so any V2.0+ console (which this whole
//     integration targets) should have it.
//   - The MixRack port (51325 unencrypted / 51327 TLS) is what the official
//     spec documents and what this file defaults to, needed specifically
//     because Scene Recall is MixRack-only. One independent, widely-used
//     real-world implementation (bitfocus/companion-module-allenheath-
//     dlive-ilive) instead defaults to 51328 — the Surface port per the
//     same spec — with a code comment claiming "the new version of firmware
//     changed the port." That claim is unverified and the spec is
//     consistent across the V1.9 and V2.0 revisions, but since it can't be
//     resolved without real hardware either way, the port is configurable
//     (dlive-server.js reads cfg.dliveMidiPort) rather than hardcoded, so
//     it can be switched from Settings without a code change if 51325
//     doesn't respond.
class DliveClient extends EventEmitter {
  constructor({ host, port = 51325, tlsEnabled = false, username = null, password = null, baseChannel = 0 }) {
    super();
    this.host = host;
    this.port = port;
    this.tlsEnabled = tlsEnabled;
    this.username = username;
    this.password = password;
    this.baseChannel = baseChannel; // "N" — must match the console's Utility/Control/MIDI setting

    this.connected = false;
    this._authOk = false;
    this._socket = null;
    this._decoder = new P.Decoder();
    this._nrpn = new P.NrpnReassembler();
    this._reconnectTimer = null;
    this._reconnectDelay = 1000;
    this._manuallyStopped = false;
    this._sceneBankPending = null; // holds bank number between CC0 and the following Program Change
  }

  connect() {
    this._manuallyStopped = false;
    this._openSocket();
  }

  _openSocket() {
    const onConnect = () => {
      this.connected = true;
      this._reconnectDelay = 1000;
      if (!this.tlsEnabled) this.emit('connect');
      // TLS sessions require an auth message before anything else works —
      // see buildTlsAuthMessage's comment in dlive-protocol.js for the byte
      // format (a profile byte, then raw password ASCII, no separator).
      if (this.tlsEnabled) {
        this._socket.write(Buffer.from(P.buildTlsAuthMessage(this.username, this.password)));
      }
    };

    const socket = this.tlsEnabled
      ? tls.connect({ host: this.host, port: this.port, rejectUnauthorized: false }, onConnect)
      : net.createConnection({ host: this.host, port: this.port }, onConnect);

    this._socket = socket;
    let authBuf = '';

    socket.on('data', (chunk) => {
      if (this.tlsEnabled && !this._authOk) {
        authBuf += chunk.toString('latin1');
        if (authBuf.includes('AuthOK')) {
          this._authOk = true;
          this.emit('authOk');
          this.emit('connect');
          const rest = authBuf.slice(authBuf.indexOf('AuthOK') + 6);
          if (rest.length) this._handleBytes(Buffer.from(rest, 'latin1'));
        }
        return;
      }
      this._handleBytes(chunk);
    });

    socket.on('error', (err) => this.emit('error', err));

    socket.on('close', () => {
      const wasConnected = this.connected;
      // Spec: "If the username and password match, the unit will respond
      // with AuthOK, otherwise the connection will be dropped." Without this
      // check, a wrong username/password just looks like an ordinary
      // connect-reconnect loop — nothing else here distinguishes "wrong
      // credentials" from "console unreachable."
      if (this.tlsEnabled && wasConnected && !this._authOk) {
        this.emit('error', new Error('dLive TLS connection closed before authenticating — check the username/password in Settings'));
      }
      this.connected = false;
      this._authOk = false;
      this._socket = null;
      if (wasConnected) this.emit('close');
      if (!this._manuallyStopped) this._scheduleReconnect();
    });
  }

  _scheduleReconnect() {
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => this._openSocket(), this._reconnectDelay);
    this._reconnectDelay = Math.min(this._reconnectDelay * 2, 15000);
  }

  disconnect({ flush = false } = {}) {
    this._manuallyStopped = true;
    clearTimeout(this._reconnectTimer);
    const socket = this._socket;
    this._socket = null;
    this.connected = false;
    if (!socket) return Promise.resolve();
    if (!flush) {
      try { socket.destroy(); } catch (_) {}
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => { socket.destroy(); done(); }, 1000);
      socket.once('close', done);
      try { socket.end(); } catch (_) { socket.destroy(); done(); }
    });
  }

  _write(bytes) {
    if (!this._socket || !this.connected) return false;
    // TLS sessions require the AuthOK handshake before anything else is
    // valid — `connected` alone goes true as soon as the raw socket opens,
    // which for TLS is *before* auth completes (see _openSocket). Without
    // this check, a fader move landing in that window would send real
    // protocol bytes into what the console treats as an auth-only phase.
    if (this.tlsEnabled && !this._authOk) return false;
    try { this._socket.write(Buffer.from(bytes)); return true; }
    catch (_) { return false; }
  }

  // ── Outbound API ──────────────────────────────────────────────────────

  setSendLevel(inputCh, aux, db) {
    const lv = P.dbToLv(db);
    return this._write(P.buildSendLevelSet(inputCh.midiCh, inputCh.ch, aux, lv));
  }

  requestSendLevel(inputCh, aux) {
    return this._write(P.buildSendLevelGet(inputCh.midiCh, inputCh.ch, aux));
  }

  setFader(coord, db) {
    return this._write(P.buildFaderSet(coord.midiCh, coord.ch, P.dbToLv(db)));
  }

  requestFader(coord) {
    return this._write(P.buildFaderGet(coord.midiCh, coord.ch));
  }

  setMute(coord, on) {
    return this._write(on ? P.buildMuteOn(coord.midiCh, coord.ch) : P.buildMuteOff(coord.midiCh, coord.ch));
  }

  requestMute(coord) {
    return this._write(P.buildMuteGet(coord.midiCh, coord.ch));
  }

  requestName(coord) {
    return this._write(P.buildNameGet(coord.midiCh, coord.ch));
  }

  setName(coord, name) {
    return this._write(P.buildNameSet(coord.midiCh, coord.ch, name));
  }

  requestColour(coord) {
    return this._write(P.buildColourGet(coord.midiCh, coord.ch));
  }

  setColour(coord, hex) {
    return this._write(P.buildColourSet(coord.midiCh, coord.ch, hex));
  }

  recallScene(sceneNumber) {
    return this._write(P.buildSceneRecall(this.baseChannel, sceneNumber));
  }

  // ── Inbound decoding ──────────────────────────────────────────────────

  _handleBytes(chunk) {
    const events = this._decoder.push(chunk);
    for (const ev of events) this._handleDecoded(ev);
  }

  _handleDecoded(ev) {
    if (ev.type === 'cc') {
      // Bank Select (controller 0) precedes a scene-recall Program Change.
      if (ev.controller === 0x00) { this._sceneBankPending = ev.value; return; }
      const nrpn = this._nrpn.feed(ev);
      if (nrpn) {
        const coord = { midiCh: nrpn.midiCh, ch: nrpn.ch };
        if (nrpn.param === P.PARAM.FADER_LEVEL) {
          this.emit('fader', { ...coord, lv: nrpn.value, db: P.lvToDb(nrpn.value) });
        } else if (nrpn.param === P.PARAM.MAIN_ASSIGN) {
          this.emit('mainAssign', { ...coord, on: nrpn.value >= 0x40 });
        }
      }
      return;
    }

    if (ev.type === 'noteOn') {
      if (ev.velocity === 0) return; // spec: velocity 00 ignored
      this.emit('mute', { midiCh: ev.midiCh, ch: ev.note, on: ev.velocity >= 0x40 });
      return;
    }

    if (ev.type === 'programChange') {
      const bank = this._sceneBankPending ?? 0;
      this._sceneBankPending = null;
      this.emit('sceneRecall', { sceneNumber: P.decodeSceneNumber(bank, ev.program) });
      return;
    }

    if (ev.type === 'sysex') {
      this._handleSysex(ev.bytes);
    }
  }

  _handleSysex(bytes) {
    const headerTail = P.SYSEX_HEADER.slice(1); // header minus the F0 the decoder already stripped
    if (bytes.length < headerTail.length + 2) return; // too short to even carry midiCh + opcode
    for (let i = 0; i < headerTail.length; i++) {
      if (bytes[i] !== headerTail[i]) return; // not one of ours (or malformed) — ignore
    }
    const midiCh = bytes[7];
    const opcode = bytes[8];

    if (opcode === 0x0D) { // Send Level (Set, and — inferred — the live-push shape too)
      // A truncated payload would otherwise destructure into undefined
      // fields, which flow through lvToDb(undefined) -> NaN and out as a
      // malformed event instead of being dropped.
      if (bytes.length < 13) return;
      const [ch, sndMidiCh, sndCh, lv] = bytes.slice(9);
      // midiCh (the *source* channel's bank) matters here: this same message
      // shape carries Group/Matrix/DCA sends too, not just Input channels —
      // a consumer that ignores it and assumes "ch" is always an input
      // channel number will misattribute sends from anything else.
      this.emit('sendLevel', { midiCh, ch, sndMidiCh, sndCh, lv, db: P.lvToDb(lv) });
      return;
    }
    if (opcode === 0x02 || opcode === 0x03) { // Name: 0x02 get-reply, 0x03 set(-echo)
      if (bytes.length < 10) return;
      const ch = bytes[9];
      const name = Buffer.from(bytes.slice(10)).toString('ascii').replace(/\0+$/, '');
      this.emit('name', { midiCh, ch, name });
      return;
    }
    if (opcode === 0x05 || opcode === 0x06) { // Colour: 0x05 get-reply, 0x06 set(-echo)
      if (bytes.length < 11) return;
      const ch = bytes[9];
      const colourIndex = bytes[10];
      this.emit('colour', { midiCh, ch, colourIndex, hex: P.COLOURS[colourIndex] || P.COLOURS[0] });
    }
    // Preamp pad/48V/gain and other opcodes: not implemented in this pass.
  }
}

module.exports = { DliveClient };
