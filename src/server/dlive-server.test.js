'use strict';
// End-to-end test for dlive-server.js against a real HTTP server, real
// WebSocket clients, and a mock TCP "dLive console" — the same shape of
// test dlive-client.test.js runs, one layer up. Run with:
//   node src/server/dlive-server.test.js
//
// This file requires Electron's `app.getPath`, which only exists inside a
// running Electron process — scenes.js/presets.js call it at module load.
// Stub it out before requiring dlive-server.js so this runs under plain node.
const path = require('path');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return path.join(__dirname, '_fake-electron-for-tests.js');
  return origResolve.call(this, request, ...args);
};

const net = require('net');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const P = require('./dlive-protocol.js');
const server = require('./dlive-server.js');

function containsSubsequence(haystack, needle) {
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    if (needle.every((b, j) => haystack[i + j] === b)) return true;
  }
  return false;
}

async function main() {
  // ── Mock "dLive MixRack" TCP server ──────────────────────────────────
  const mock = net.createServer();
  let mockSocket = null;
  const received = [];
  mock.on('connection', (sock) => {
    mockSocket = sock;
    sock.on('data', (d) => received.push([...d]));
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const mockPort = mock.address().port;

  // dlive-server.js always dials the real dLive port (51325/51327). Redirect
  // just the one connection attempt this test triggers to our mock instead.
  const origCreateConnection = net.createConnection;
  net.createConnection = function (opts, cb) {
    return origCreateConnection.call(net, { ...opts, port: mockPort }, cb);
  };

  const serverPort = 18199;
  await new Promise((resolve) => {
    server.start({ serverPort, deskIp: '127.0.0.1', channels: 8, auxes: 4, dliveBaseChannel: 0, sceneRecallEnabled: true });
    setTimeout(resolve, 300); // let the HTTP server + TCP client both come up
  });
  net.createConnection = origCreateConnection;

  assert.ok(mockSocket, 'mock console should have received a TCP connection from dlive-server.js');
  console.log('ok - dlive-server.js connected to the mock console over TCP');

  // ── HTTP static serving ───────────────────────────────────────────────
  {
    const http = require('http');
    const status = await new Promise((resolve) => {
      http.get(`http://127.0.0.1:${serverPort}/devices.html`, (res) => resolve(res.statusCode));
    });
    assert.equal(status, 200);
    console.log('ok - static files (devices.html) served, status 200');
  }

  // ── WebSocket: musician client connects, receives config ────────────
  const musicianWs = new WebSocket(`ws://127.0.0.1:${serverPort}`);
  const config = await new Promise((resolve) => {
    musicianWs.on('message', (m) => { const j = JSON.parse(m); if (j.config) resolve(j.config); });
  });
  assert.equal(config.aux.length, 4);
  assert.equal(config.channels.length, 8);
  assert.equal(config.aux[0].label, 'AUX 1');
  console.log('ok - WS client receives config message with correct aux/channel counts');

  musicianWs.send(JSON.stringify({ type: 'identify', deviceId: 'musician-1' }));
  musicianWs.send(JSON.stringify({ type: 'set-active-aux', aux: 1 }));
  await new Promise((r) => setTimeout(r, 100));

  // ── Channel names actually get primed via a real request/reply round trip ──
  // Regression test: startPriming() used to call stopPriming() first, which
  // clears the very queue enqueuePrime() just filled — so every enqueued
  // priming call (channel/aux name and colour requests) silently never ran.
  // Reproduced directly before fixing (5 enqueued, 0 executed after 500ms).
  {
    const ch1Coord = P.coordinate(0, 'input', 1);
    const nameGetBytes = P.buildNameGet(ch1Coord.midiCh, ch1Coord.ch);
    const sawNameRequest = () => containsSubsequence(received.flat(), nameGetBytes);
    // Priming is paced at 75ms/tick — give it real time to reach channel 1.
    const deadline = Date.now() + 1000;
    while (!sawNameRequest() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    assert.ok(sawNameRequest(), 'dlive-server.js should actually send a Name Get request for channel 1 on connect');

    const nameReply = P.buildNameSet(ch1Coord.midiCh, ch1Coord.ch, 'Kick');
    mockSocket.write(Buffer.from(nameReply));
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(server.getChannelNames()['1'], 'Kick', 'the primed name should actually reach getChannelNames()');
    console.log('ok - channel names are actually primed via a real request/reply round trip (regression: startPriming() used to wipe its own queue)');
  }

  // ── Devices view client sees the musician ────────────────────────────
  const devicesWs = new WebSocket(`ws://127.0.0.1:${serverPort}`);
  await new Promise((resolve) => devicesWs.once('open', resolve));
  const devicesUpdate = await new Promise((resolve) => {
    devicesWs.on('message', (m) => { const j = JSON.parse(m); if (j.type === 'devices-update' && j.devices.length > 0) resolve(j); });
  });
  assert.equal(devicesUpdate.devices[0].deviceId, 'musician-1');
  assert.equal(devicesUpdate.devices[0].aux, 1);
  console.log('ok - Devices View sees the musician\'s identify + set-active-aux');

  // ── Musician moves a fader — verify the exact dLive bytes hit the "console" ──
  received.length = 0;
  musicianWs.send(JSON.stringify({ address: '/Input_Channels/3/Aux_Send/1/send_level', args: [-10] }));
  await new Promise((r) => setTimeout(r, 150));
  const inputCoord = P.coordinate(0, 'input', 3);
  const auxCoord = P.coordinate(0, 'monoAux', 1);
  const expected = P.buildSendLevelSet(inputCoord.midiCh, inputCoord.ch, auxCoord, P.dbToLv(-10));
  assert.ok(containsSubsequence(received.flat(), expected), 'expected exact dLive send-level SysEx bytes to reach the mock console');
  console.log('ok - fader move on musician mixer produces the exact expected dLive wire bytes');

  // ── Console pushes a live send-level change — musician client sees it broadcast back ──
  const pushed = new Promise((resolve) => {
    musicianWs.on('message', (m) => { const j = JSON.parse(m); if (j.address === '/Input_Channels/5/Aux_Send/1/send_level') resolve(j); });
  });
  const pushCoord = P.coordinate(0, 'input', 5);
  mockSocket.write(Buffer.from(P.buildSendLevelSet(pushCoord.midiCh, pushCoord.ch, auxCoord, P.dbToLv(-6))));
  const pushResult = await pushed;
  assert.ok(Math.abs(pushResult.args[0] - (-6)) < 0.1);
  console.log('ok - unsolicited console send-level push broadcasts to browser clients in OSC-shaped format');

  // ── A send from a non-Input source (e.g. a Group) must NOT get misattributed
  // to some unrelated input channel — this is the bug the midiCh check above
  // in dlive-server.js's sendLevel handler exists to prevent. ────────────
  {
    let sawAnyBroadcast = false;
    const onMsg = (m) => { const j = JSON.parse(m); if (j.address && j.address.includes('Aux_Send')) sawAnyBroadcast = true; };
    musicianWs.on('message', onMsg);
    const groupCoord = P.coordinate(0, 'monoGroup', 5); // midiCh = baseN+1, not an Input channel
    mockSocket.write(Buffer.from(P.buildSendLevelSet(groupCoord.midiCh, groupCoord.ch, auxCoord, P.dbToLv(2))));
    await new Promise((r) => setTimeout(r, 150));
    musicianWs.removeListener('message', onMsg);
    assert.equal(sawAnyBroadcast, false, 'a Group send should never be broadcast as if it were an Input channel\'s send level');
    console.log('ok - a send-level message from a non-Input source is not misattributed to an input channel');
  }

  // ── Console recalls a scene — SnapshotName broadcasts, scene tracked ──
  const snapshotEv = new Promise((resolve) => {
    musicianWs.on('message', (m) => { const j = JSON.parse(m); if (j.address === '/SnapshotName') resolve(j); });
  });
  mockSocket.write(Buffer.from(P.buildSceneRecall(0, 42)));
  const snap = await snapshotEv;
  assert.equal(snap.args[0], 'Scene 42');
  console.log('ok - console scene recall (Bank+ProgramChange) tracked and broadcast as /SnapshotName');

  // ── Ear Scene save/recall round-trip using the tracked scene number ───
  musicianWs.send(JSON.stringify({ type: 'save-scene', aux: 1, values: { '3': 0.6 } }));
  await new Promise((r) => setTimeout(r, 100));
  musicianWs.send(JSON.stringify({ type: 'request-scene', snapshot: '42', aux: 1 }));
  const sceneValues = await new Promise((resolve) => {
    musicianWs.on('message', (m) => { const j = JSON.parse(m); if (j.type === 'scene-values') resolve(j); });
  });
  assert.deepEqual(sceneValues.values, { '3': 0.6 });
  console.log('ok - Ear Scene save/request round-trips, keyed by scene number 42');

  // ── Mute emulation: verify it drives the send to -inf via dLive bytes ──
  received.length = 0;
  musicianWs.send(JSON.stringify({ type: 'set-mute', aux: 1, ch: 3, muted: true }));
  await new Promise((r) => setTimeout(r, 100));
  const muteExpected = P.buildSendLevelSet(inputCoord.midiCh, inputCoord.ch, auxCoord, P.dbToLv(-Infinity));
  assert.ok(containsSubsequence(received.flat(), muteExpected), 'mute should drive the aux send to -inf via the same SysEx mechanism, not a Mute NoteOn');
  console.log('ok - musician mute emulates via zeroing the send level (matches DiGiCo\'s approach)');

  musicianWs.close();
  devicesWs.close();
  server.stop();
  mock.close();

  // ── Scenario 2: polling enabled — verify Get requests actually go out ────
  {
    const mock2 = net.createServer();
    let mockSocket2 = null;
    const received2 = [];
    mock2.on('connection', (sock) => { mockSocket2 = sock; sock.on('data', (d) => received2.push([...d])); });
    await new Promise((resolve) => mock2.listen(0, '127.0.0.1', resolve));
    const mockPort2 = mock2.address().port;

    const origCC = net.createConnection;
    net.createConnection = (opts, cb) => origCC.call(net, { ...opts, port: mockPort2 }, cb);
    await new Promise((resolve) => {
      server.start({ serverPort: 18200, deskIp: '127.0.0.1', channels: 4, auxes: 2, dliveBaseChannel: 0, dlivePollSendLevels: true, dliveListenSendLevels: true });
      setTimeout(resolve, 300);
    });
    net.createConnection = origCC;
    assert.ok(mockSocket2, 'scenario 2: mock console should be connected');

    // A client has to pick an aux for polling to include any channels — the
    // queue is scoped to actively-mixed auxes, not the whole matrix.
    const ws2 = new WebSocket('ws://127.0.0.1:18200');
    await new Promise((resolve) => ws2.once('open', resolve));
    ws2.send(JSON.stringify({ type: 'set-active-aux', aux: 1 }));

    received2.length = 0;
    await new Promise((r) => setTimeout(r, 400)); // several 75ms poll ticks
    const expectedGet = P.buildSendLevelGet(P.coordinate(0, 'input', 1).midiCh, P.coordinate(0, 'input', 1).ch, P.coordinate(0, 'monoAux', 1));
    assert.ok(containsSubsequence(received2.flat(), expectedGet), 'polling should issue Send Level Get requests for the active aux\'s channels');
    console.log('ok - polling (when enabled) actively requests send levels for active auxes');

    ws2.close();
    server.stop();
    mock2.close();
  }

  // ── Scenario 3: polling disabled — verify no Get requests go out ─────────
  {
    const mock3 = net.createServer();
    let mockSocket3 = null;
    const received3 = [];
    mock3.on('connection', (sock) => { mockSocket3 = sock; sock.on('data', (d) => received3.push([...d])); });
    await new Promise((resolve) => mock3.listen(0, '127.0.0.1', resolve));
    const mockPort3 = mock3.address().port;

    const origCC2 = net.createConnection;
    net.createConnection = (opts, cb) => origCC2.call(net, { ...opts, port: mockPort3 }, cb);
    await new Promise((resolve) => {
      server.start({ serverPort: 18201, deskIp: '127.0.0.1', channels: 4, auxes: 2, dliveBaseChannel: 0, dlivePollSendLevels: false, dliveListenSendLevels: true });
      setTimeout(resolve, 300);
    });
    net.createConnection = origCC2;
    assert.ok(mockSocket3, 'scenario 3: mock console should be connected');

    const ws3 = new WebSocket('ws://127.0.0.1:18201');
    await new Promise((resolve) => ws3.once('open', resolve));
    ws3.send(JSON.stringify({ type: 'set-active-aux', aux: 1 }));

    received3.length = 0;
    await new Promise((r) => setTimeout(r, 400));
    const getOpcodeSeq = [0x05, 0x0F, 0x0D]; // Send Level Get's distinguishing opcode bytes
    assert.ok(!containsSubsequence(received3.flat(), getOpcodeSeq), 'polling disabled should mean zero Send Level Get requests');
    console.log('ok - polling (when disabled) sends no Get requests at all');

    ws3.close();
    server.stop();
    mock3.close();
  }

  // ── Scenario 4: push disabled — a console-pushed send level is ignored ──
  {
    const mock4 = net.createServer();
    let mockSocket4 = null;
    mock4.on('connection', (sock) => { mockSocket4 = sock; });
    await new Promise((resolve) => mock4.listen(0, '127.0.0.1', resolve));
    const mockPort4 = mock4.address().port;

    const origCC3 = net.createConnection;
    net.createConnection = (opts, cb) => origCC3.call(net, { ...opts, port: mockPort4 }, cb);
    await new Promise((resolve) => {
      server.start({ serverPort: 18202, deskIp: '127.0.0.1', channels: 4, auxes: 2, dliveBaseChannel: 0, dlivePollSendLevels: false, dliveListenSendLevels: false });
      setTimeout(resolve, 300);
    });
    net.createConnection = origCC3;
    assert.ok(mockSocket4, 'scenario 4: mock console should be connected');

    const ws4 = new WebSocket('ws://127.0.0.1:18202');
    let sawBroadcast = false;
    ws4.on('message', (m) => { const j = JSON.parse(m); if (j.address === '/Input_Channels/2/Aux_Send/1/send_level') sawBroadcast = true; });
    await new Promise((resolve) => ws4.once('open', resolve));

    const pc = P.coordinate(0, 'input', 2), ac = P.coordinate(0, 'monoAux', 1);
    mockSocket4.write(Buffer.from(P.buildSendLevelSet(pc.midiCh, pc.ch, ac, 0x50)));
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(sawBroadcast, false, 'push disabled should mean a console-originated send-level change is never broadcast to clients');
    console.log('ok - push (when disabled) ignores console-originated send-level changes');

    ws4.close();
    server.stop();
    mock4.close();
  }

  // ── Scenario 5: out-of-range ch/aux numbers must never crash the server ──
  // dLive's protocol has a hard ceiling (128 channels, 62 mono auxes) that
  // Settings' generic count fields don't enforce, and the raw OSC-address
  // message path has nothing upstream validating the numbers at all — any
  // connected browser can send whatever it wants.
  {
    const mock5 = net.createServer();
    let mockSocket5 = null;
    mock5.on('connection', (sock) => { mockSocket5 = sock; });
    await new Promise((resolve) => mock5.listen(0, '127.0.0.1', resolve));
    const mockPort5 = mock5.address().port;

    const crashed = [];
    const onUncaught = (err) => crashed.push(err);
    process.on('uncaughtException', onUncaught);

    const origCC4 = net.createConnection;
    net.createConnection = (opts, cb) => origCC4.call(net, { ...opts, port: mockPort5 }, cb);
    await new Promise((resolve) => {
      server.start({ serverPort: 18203, deskIp: '127.0.0.1', channels: 8, auxes: 4, dliveBaseChannel: 0 });
      setTimeout(resolve, 300);
    });
    net.createConnection = origCC4;
    assert.ok(mockSocket5, 'scenario 5: mock console should be connected');

    const ws5 = new WebSocket('ws://127.0.0.1:18203');
    await new Promise((resolve) => ws5.once('open', resolve));
    ws5.send(JSON.stringify({ address: '/Input_Channels/1/Aux_Send/9999/send_level', args: [-10] }));
    ws5.send(JSON.stringify({ address: '/Input_Channels/9999/Aux_Send/1/send_level', args: [-10] }));
    ws5.send(JSON.stringify({ type: 'set-mute', aux: 9999, ch: 1, muted: true }));
    ws5.send(JSON.stringify({ type: 'apply-preset', aux: 9999, name: 'x', levels: { '1': 0.5 }, pans: {} }));
    await new Promise((r) => setTimeout(r, 300));

    process.removeListener('uncaughtException', onUncaught);
    assert.equal(crashed.length, 0, `out-of-range ch/aux should never crash the server; got: ${crashed.map(e => e.message).join('; ')}`);
    assert.equal(ws5.readyState, WebSocket.OPEN, 'the connection itself should still be alive after all of that');
    console.log('ok - out-of-range channel/aux numbers are ignored, never crash the server');

    ws5.close();
    server.stop();
    mock5.close();
  }

  // ── Scenario 6: a stereo aux's send-level push isn't misread as a mono aux ──
  // Mono aux sends (0-61) and stereo aux sends (0x40-0x5E) share the exact
  // same midiCh bank (baseN+2) — coordinate('monoAux') and
  // coordinate('stereoAux') both return that same midiCh, only `ch` differs.
  // The push handler used to check only the bank, so a stereo aux's send
  // level got reinterpreted as mono aux (ch+1), broadcasting a bogus aux
  // number this integration doesn't support and polluting levelCache.
  {
    const mock6 = net.createServer();
    let mockSocket6 = null;
    mock6.on('connection', (sock) => { mockSocket6 = sock; });
    await new Promise((resolve) => mock6.listen(0, '127.0.0.1', resolve));
    const mockPort6 = mock6.address().port;

    const origCC5 = net.createConnection;
    net.createConnection = (opts, cb) => origCC5.call(net, { ...opts, port: mockPort6 }, cb);
    await new Promise((resolve) => {
      server.start({ serverPort: 18204, deskIp: '127.0.0.1', channels: 4, auxes: 2, dliveBaseChannel: 0, dliveListenSendLevels: true });
      setTimeout(resolve, 300);
    });
    net.createConnection = origCC5;
    assert.ok(mockSocket6, 'scenario 6: mock console should be connected');

    const ws6 = new WebSocket('ws://127.0.0.1:18204');
    let sawAnySendLevelBroadcast = false;
    ws6.on('message', (m) => {
      const j = JSON.parse(m);
      if (typeof j.address === 'string' && j.address.includes('/send_level')) sawAnySendLevelBroadcast = true;
    });
    await new Promise((resolve) => ws6.once('open', resolve));

    const inputCoord = P.coordinate(0, 'input', 2);
    const stereoAux1 = P.coordinate(0, 'stereoAux', 1); // same midiCh as monoAux, ch=0x40
    mockSocket6.write(Buffer.from(P.buildSendLevelSet(inputCoord.midiCh, inputCoord.ch, stereoAux1, 0x50)));
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(sawAnySendLevelBroadcast, false, 'a stereo aux send-level push should never be broadcast as a bogus mono aux update');
    console.log('ok - a stereo aux send-level push is not misattributed as a mono aux update');

    ws6.close();
    server.stop();
    mock6.close();
  }

  console.log('\nAll dlive-server end-to-end checks passed');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
