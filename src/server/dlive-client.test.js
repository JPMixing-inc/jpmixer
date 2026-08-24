'use strict';
// Integration test for dlive-client.js against a real local TCP socket (a
// mock server standing in for the dLive MixRack). Run with:
//   node src/server/dlive-client.test.js
// Exercises real socket I/O, TCP chunk-boundary splitting, and reconnect —
// the things dlive-protocol.test.js's pure unit tests can't cover.

const net = require('net');
const assert = require('node:assert/strict');
const { DliveClient } = require('./dlive-client.js');
const P = require('./dlive-protocol.js');

async function main() {
  const mock = net.createServer();
  let mockSocket = null;
  mock.on('connection', (sock) => {
    mockSocket = sock;
    sock.on('data', (d) => mock.emit('_received', d));
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const port = mock.address().port;

  const client = new DliveClient({ host: '127.0.0.1', port });

  // ── connects ──────────────────────────────────────────────────────────
  await new Promise((resolve, reject) => {
    client.once('connect', resolve);
    client.once('error', reject);
    client.connect();
  });
  console.log('ok - client connects to a real TCP socket');

  // ── outbound write reaches the server verbatim ───────────────────────
  {
    const received = new Promise((resolve) => mock.once('_received', (d) => resolve([...d])));
    const inputCoord = P.coordinate(0, 'input', 5);
    const auxCoord = P.coordinate(0, 'monoAux', 2);
    client.setSendLevel(inputCoord, auxCoord, 0);
    const bytes = await received;
    assert.deepEqual(bytes, P.buildSendLevelSet(inputCoord.midiCh, inputCoord.ch, auxCoord, P.dbToLv(0)));
    console.log('ok - setSendLevel writes the exact expected bytes to the socket');
  }

  // ── inbound: send-level push decodes and emits ───────────────────────
  {
    const ev = new Promise((resolve) => client.once('sendLevel', resolve));
    const inputCoord = P.coordinate(0, 'input', 5);
    const auxCoord = P.coordinate(0, 'monoAux', 2);
    mockSocket.write(Buffer.from(P.buildSendLevelSet(inputCoord.midiCh, inputCoord.ch, auxCoord, 0x50)));
    const got = await ev;
    assert.equal(got.midiCh, inputCoord.midiCh, 'source bank must be exposed — this same message shape carries Group/Matrix/DCA sends too, not just inputs');
    assert.equal(got.ch, inputCoord.ch);
    assert.equal(got.sndMidiCh, auxCoord.midiCh);
    assert.equal(got.sndCh, auxCoord.ch);
    assert.equal(got.lv, 0x50);
    console.log('ok - inbound sendLevel SysEx decodes correctly over a real socket');
  }

  // ── inbound split across two separate socket writes (real TCP chunking) ──
  {
    const ev = new Promise((resolve) => client.once('mute', resolve));
    const wire = Buffer.from(P.buildMuteOn(3, 0x07));
    mockSocket.write(wire.slice(0, 2));
    await new Promise((r) => setTimeout(r, 20));
    mockSocket.write(wire.slice(2));
    const got = await ev;
    assert.deepEqual(got, { midiCh: 3, ch: 0x07, on: true });
    console.log('ok - mute event decodes correctly when split across two socket writes');
  }

  // ── scene recall round-trip (bank select + program change) ──────────
  {
    const ev = new Promise((resolve) => client.once('sceneRecall', resolve));
    mockSocket.write(Buffer.from(P.buildSceneRecall(0, 250)));
    const got = await ev;
    assert.deepEqual(got, { sceneNumber: 250 });
    console.log('ok - sceneRecall decodes bank+programChange back to the original scene number');
  }

  // ── name decode ───────────────────────────────────────────────────────
  {
    const ev = new Promise((resolve) => client.once('name', resolve));
    const coord = P.coordinate(0, 'input', 1);
    const nameBytes = Buffer.from('Kick In', 'ascii');
    mockSocket.write(Buffer.from([...P.SYSEX_HEADER, coord.midiCh, 0x02, coord.ch, ...nameBytes, P.SYSEX_END]));
    const got = await ev;
    assert.equal(got.name, 'Kick In');
    console.log('ok - channel name decodes correctly');
  }

  // ── reconnect after the "console" drops the connection ───────────────
  {
    const reconnected = new Promise((resolve) => client.once('connect', resolve));
    mockSocket.destroy();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(client.connected, false);
    await reconnected;
    assert.equal(client.connected, true);
    console.log('ok - client automatically reconnects after the socket drops');
  }

  client.disconnect();
  mock.close();

  // ── TLS auth flow ────────────────────────────────────────────────────
  // Real certificates aren't needed to test this logic — tls.connect() is
  // swapped out for a plain socket to the same mock server, so the auth
  // byte-detection code (which doesn't know or care about encryption) runs
  // for real while avoiding a hard openssl dependency in the test suite.
  const tls = require('tls');
  const origTlsConnect = tls.connect;

  {
    const mockTls = net.createServer();
    let mockTlsSocket = null;
    const received = [];
    mockTls.on('connection', (sock) => { mockTlsSocket = sock; sock.on('data', (d) => received.push([...d])); });
    await new Promise((resolve) => mockTls.listen(0, '127.0.0.1', resolve));
    const mockTlsPort = mockTls.address().port;
    tls.connect = (opts, cb) => net.createConnection({ ...opts, port: mockTlsPort }, cb);

    const tlsClient = new DliveClient({ host: '127.0.0.1', port: mockTlsPort, tlsEnabled: true, username: 3, password: 'hunter2' });
    const authOk = new Promise((resolve) => tlsClient.once('authOk', resolve));
    const connected = new Promise((resolve) => tlsClient.once('connect', resolve));
    tlsClient.connect();

    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(received.flat(), P.buildTlsAuthMessage(3, 'hunter2'), 'the exact auth bytes (profile + password, no comma) should reach the console');
    console.log('ok - TLS auth sends the correct profile+password bytes on connect');

    // `connected` goes true as soon as the raw socket opens, before AuthOK —
    // an outbound call landing in that window must not put real protocol
    // bytes on the wire during what the console treats as an auth-only phase.
    assert.equal(tlsClient.connected, true);
    const coordPreAuth = P.coordinate(0, 'input', 1);
    const wroteWhilePendingAuth = tlsClient.setFader(coordPreAuth, -6);
    assert.equal(wroteWhilePendingAuth, false, 'a write attempted before AuthOK should be rejected');
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(received.flat(), P.buildTlsAuthMessage(3, 'hunter2'), 'nothing beyond the auth bytes should have reached the console yet');
    console.log('ok - a write attempted before AuthOK is rejected, not sent');

    mockTlsSocket.write('AuthOK');
    await authOk;
    await connected;
    console.log('ok - TLS client emits authOk then connect once the console confirms');

    // Traffic after AuthOK (even in the same TCP read) should still decode normally.
    const faderEv = new Promise((resolve) => tlsClient.once('fader', resolve));
    const coord = P.coordinate(0, 'input', 1);
    mockTlsSocket.write(Buffer.from(P.buildFaderSet(coord.midiCh, coord.ch, 0x60)));
    const fev = await faderEv;
    assert.equal(fev.lv, 0x60);
    console.log('ok - MIDI traffic after AuthOK decodes normally');

    tlsClient.disconnect();
    mockTls.close();
  }

  // ── TLS auth failure — connection drops before AuthOK ──────────────────
  {
    const mockTls2 = net.createServer();
    let mockTlsSocket2 = null;
    mockTls2.on('connection', (sock) => { mockTlsSocket2 = sock; });
    await new Promise((resolve) => mockTls2.listen(0, '127.0.0.1', resolve));
    const mockTls2Port = mockTls2.address().port;
    tls.connect = (opts, cb) => net.createConnection({ ...opts, port: mockTls2Port }, cb);

    const tlsClient2 = new DliveClient({ host: '127.0.0.1', port: mockTls2Port, tlsEnabled: true, username: 0, password: 'wrong' });
    const errorEv = new Promise((resolve) => tlsClient2.once('error', resolve));
    tlsClient2.connect();
    await new Promise((r) => setTimeout(r, 100));
    mockTlsSocket2.destroy(); // console drops the connection without ever sending AuthOK

    const err = await errorEv;
    assert.match(err.message, /auth/i, 'should surface a clear auth-related error, not a silent reconnect loop');
    console.log('ok - a connection dropped before AuthOK surfaces a clear auth-failure error');

    tlsClient2.disconnect();
    mockTls2.close();
  }

  tls.connect = origTlsConnect;
  console.log('\nAll dlive-client integration checks passed');
}

main().catch((err) => { console.error(err); process.exit(1); });
