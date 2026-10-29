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

// Its own folder for config.json and the rest, not the shared temp folder
process.env.JPM_TEST_USERDATA = require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'jpmixer-dlive-test-'));

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
    server.start({ serverPort, deskIp: '127.0.0.1', channels: 8, auxes: 4, dliveBaseChannel: 0, dlivePan: false, dliveMuteBySendOff: false, sceneRecallEnabled: true });
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

    // A rename on the console reaches phones (padded the way Director pads it)
    const watcher = new WebSocket(`ws://127.0.0.1:${serverPort}`);
    const seen = [];
    watcher.on('message', (m) => seen.push(JSON.parse(m)));
    await new Promise((r) => watcher.on('open', r));
    mockSocket.write(Buffer.from(P.buildNameSet(ch1Coord.midiCh, ch1Coord.ch, 'KICK IN ')));
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(seen.some(j => j.type === 'channel-relabeled' && j.channel === 1 && j.label === 'KICK IN'), 'a console rename should reach phones, trimmed');
    const count = seen.filter(j => j.type === 'channel-relabeled').length;
    mockSocket.write(Buffer.from(P.buildNameSet(ch1Coord.midiCh, ch1Coord.ch, 'KICK IN')));
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(seen.filter(j => j.type === 'channel-relabeled').length, count, 'the same name again is not re-announced');
    watcher.close();
    console.log('ok - a console rename reaches phones once, trimmed');
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
  assert.equal(snap.args[0], '42');
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

  // ── An unmute while the link is down reaches the console when it's back ──
  // Only the mutes used to be re-sent on reconnect: the console kept the
  // channel at -inf while the phone showed it on.
  {
    const origCC = net.createConnection;
    net.createConnection = function (opts, cb) { return origCC.call(net, { ...opts, port: mockPort }, cb); };
    const dropped = mockSocket;
    dropped.destroy();
    await new Promise((r) => setTimeout(r, 100));
    musicianWs.send(JSON.stringify({ type: 'set-mute', aux: 1, ch: 3, muted: false }));
    await new Promise((r) => setTimeout(r, 100));
    received.length = 0;
    const deadline = Date.now() + 4000;
    while (mockSocket === dropped && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    net.createConnection = origCC;
    assert.notEqual(mockSocket, dropped, 'dlive-server.js should reconnect to the console');
    const restore = P.buildSendLevelSet(inputCoord.midiCh, inputCoord.ch, auxCoord, P.dbToLv(-10));
    const until = Date.now() + 1000;
    while (!containsSubsequence(received.flat(), restore) && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    assert.ok(containsSubsequence(received.flat(), restore), 'the level from before the mute goes to the console on reconnect');
    console.log('ok - an unmute made while the console link was down is sent when it reconnects');
  }

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
      server.start({ serverPort: 18200, deskIp: '127.0.0.1', channels: 4, auxes: 2, dliveBaseChannel: 0, dlivePan: false, dliveMuteBySendOff: false, dlivePollSendLevels: true, dliveListenSendLevels: true });
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
      server.start({ serverPort: 18201, deskIp: '127.0.0.1', channels: 4, auxes: 2, dliveBaseChannel: 0, dlivePan: false, dliveMuteBySendOff: false, dlivePollSendLevels: false, dliveListenSendLevels: true });
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
      server.start({ serverPort: 18202, deskIp: '127.0.0.1', channels: 4, auxes: 2, dliveBaseChannel: 0, dlivePan: false, dliveMuteBySendOff: false, dlivePollSendLevels: false, dliveListenSendLevels: false });
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
      server.start({ serverPort: 18203, deskIp: '127.0.0.1', channels: 8, auxes: 4, dliveBaseChannel: 0, dlivePan: false, dliveMuteBySendOff: false });
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
      server.start({ serverPort: 18204, deskIp: '127.0.0.1', channels: 4, auxes: 2, dliveBaseChannel: 0, dlivePan: false, dliveMuteBySendOff: false, dliveListenSendLevels: true });
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

  // ── Console Controller: dLive's own faders, mutes and solo ──────────────
  {
    const mock7 = net.createServer();
    let sock7 = null; const got7 = [];
    mock7.on('connection', (s) => { sock7 = s; s.on('data', (d) => got7.push([...d])); });
    await new Promise((resolve) => mock7.listen(0, '127.0.0.1', resolve));
    const origCC7 = net.createConnection;
    net.createConnection = (opts, cb) => origCC7.call(net, { ...opts, port: mock7.address().port }, cb);
    await new Promise((resolve) => { server.start({ serverPort: 18205, deskIp: '127.0.0.1', channels: 4, auxes: 2, groups: 2, dliveBaseChannel: 0, dlivePan: false, dliveMuteBySendOff: false }); setTimeout(resolve, 300); });
    net.createConnection = origCC7;
    const page = new WebSocket('ws://127.0.0.1:18205'); const seen7 = [];
    page.on('message', (m) => seen7.push(JSON.parse(m)));
    await new Promise((resolve) => page.once('open', resolve));
    await new Promise((r) => setTimeout(r, 100));
    const cfg7 = seen7.find(j => j.config).config;
    assert.deepEqual(cfg7.controlGroups.map(g => g.channel), [1, 2], 'DCAs show as control groups, as many as Settings asks for');
    assert.equal(cfg7.channelProcessing, 'preamp-eq', 'the channel panel: preamp, high-pass and EQ');

    const dca2 = P.coordinate(0, 'dca', 2), ch3 = P.coordinate(0, 'input', 3), aux1 = P.coordinate(0, 'monoAux', 1);
    page.send(JSON.stringify({ type: 'request-console-state' }));
    const deadline = Date.now() + 2000;
    while (!containsSubsequence(got7.flat(), P.buildFaderGet(dca2.midiCh, dca2.ch)) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    assert.ok(containsSubsequence(got7.flat(), P.buildFaderGet(ch3.midiCh, ch3.ch)), 'opening the page asks for channel faders');
    assert.ok(containsSubsequence(got7.flat(), P.buildMuteGet(aux1.midiCh, aux1.ch)), '…aux mutes');
    assert.ok(containsSubsequence(got7.flat(), P.buildFaderGet(dca2.midiCh, dca2.ch)), '…and DCA faders');

    got7.length = 0;
    page.send(JSON.stringify({ type: 'console-fader', ch: 3, db: -6 }));
    page.send(JSON.stringify({ type: 'aux-mute', aux: 1, muted: true }));
    page.send(JSON.stringify({ type: 'cg-solo', cg: 2, soloed: true }));
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(containsSubsequence(got7.flat(), P.buildFaderSet(ch3.midiCh, ch3.ch, P.dbToLv(-6))), 'a channel fader move');
    assert.ok(containsSubsequence(got7.flat(), P.buildMuteOn(aux1.midiCh, aux1.ch)), 'an aux master mute');
    assert.ok(containsSubsequence(got7.flat(), P.buildSoloSet(dca2.midiCh, dca2.ch, true)), 'a DCA solo, as the desk\'s own solo');

    seen7.length = 0;
    sock7.write(Buffer.from(P.buildFaderSet(dca2.midiCh, dca2.ch, P.dbToLv(-12))));
    sock7.write(Buffer.from(P.buildSoloSet(ch3.midiCh, ch3.ch, true)));
    sock7.write(Buffer.from(P.buildNameSet(dca2.midiCh, dca2.ch, 'VOX')));
    await new Promise((r) => setTimeout(r, 150));
    const addr = (a) => seen7.find(j => j.address === a)?.args[0];
    assert.equal(addr('/Control_Groups/2/fader'), -12, 'a DCA fader moved on the console reaches the page');
    assert.equal(addr('/Input_Channels/3/solo'), 1, 'and a solo');
    assert.equal(addr('/Control_Groups/2/name'), 'VOX', 'and a DCA rename');
    console.log('ok - Console Controller: dLive channel, aux and DCA faders, mutes and solo, both ways');

    // With a code set, a device that hasn't entered it is told to, and nothing reaches the console
    const config = require('./config');
    const before = config.getAll();
    config.save({ ...before, consoleAccessCode: '2468' });
    const locked = new WebSocket('ws://127.0.0.1:18205'); const seenLocked = [];
    locked.on('message', (m) => seenLocked.push(JSON.parse(m)));
    await new Promise((resolve) => locked.once('open', resolve));
    got7.length = 0;
    locked.send(JSON.stringify({ type: 'console-fader', ch: 3, db: 6 }));
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(seenLocked.some(j => j.type === 'console-locked'), 'the page is asked for the code');
    assert.ok(!containsSubsequence(got7.flat(), P.buildFaderSet(ch3.midiCh, ch3.ch, P.dbToLv(6))), 'and the fader move doesn\'t reach the console');
    config.save(before);
    locked.close();
    console.log('ok - with a Console Controller code set, a device without it can\'t move the console\'s faders');
    page.close(); await server.stop(); mock7.close(); // stopped before the next one starts
  }

  // ── The console's mix layout: mono mixes, then stereo ones ───────────────
  {
    const mock8 = net.createServer();
    let sock8 = null; let bytes8 = [];
    // A show with mono aux 1 and 2 and stereo aux 1: only those answer a name request
    const shows = [[P.coordinate(0, 'monoAux', 1), 'IEM 1'], [P.coordinate(0, 'monoAux', 2), 'IEM 2'], [P.coordinate(0, 'stereoAux', 1), 'BAND ST']];
    const answered = new Set();
    mock8.on('connection', (s) => {
      sock8 = s;
      s.on('data', (d) => {
        bytes8 = bytes8.concat([...d]);
        for (const [c, name] of shows) {
          const k = `${c.midiCh}:${c.ch}`;
          if (!answered.has(k) && containsSubsequence(bytes8, P.buildNameGet(c.midiCh, c.ch))) { answered.add(k); s.write(Buffer.from(P.buildNameSet(c.midiCh, c.ch, name))); }
        }
      });
    });
    await new Promise((resolve) => mock8.listen(0, '127.0.0.1', resolve));
    const origCC8 = net.createConnection;
    net.createConnection = (opts, cb) => origCC8.call(net, { ...opts, port: mock8.address().port }, cb);
    await new Promise((resolve) => { server.start({ serverPort: 18206, deskIp: '127.0.0.1', channels: 4, auxes: 16, dliveBaseChannel: 0, dlivePan: false, dliveMuteBySendOff: false }); setTimeout(resolve, 300); });
    net.createConnection = origCC8;
    const ph8 = new WebSocket('ws://127.0.0.1:18206'); const seen8 = [];
    ph8.on('message', (m) => seen8.push(JSON.parse(m)));
    await new Promise((resolve) => ph8.once('open', resolve));
    const deadline8 = Date.now() + 6000;
    while (server.getAuxCount() === null && Date.now() < deadline8) await new Promise((r) => setTimeout(r, 100));
    assert.equal(server.getAuxCount(), 3, 'the console\'s 3 mixes, not Settings\' 16');
    await new Promise((r) => setTimeout(r, 100));
    const cfg8 = seen8.filter(j => j.config).at(-1).config;
    assert.deepEqual(cfg8.aux.map(a => a.label), ['IEM 1', 'IEM 2', 'BAND ST'], 'mono mixes, then stereo, with their names');

    // aux 3 is stereo aux 1, both ways
    const ch2 = P.coordinate(0, 'input', 2), st1 = P.coordinate(0, 'stereoAux', 1);
    bytes8 = [];
    ph8.send(JSON.stringify({ address: '/Input_Channels/2/Aux_Send/3/send_level', args: [-10] }));
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(containsSubsequence(bytes8, P.buildSendLevelSet(ch2.midiCh, ch2.ch, st1, P.dbToLv(-10))), 'a fader in mix 3 goes to stereo aux 1');
    sock8.write(Buffer.from(P.buildSendLevelSet(ch2.midiCh, ch2.ch, st1, P.dbToLv(-20))));
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(seen8.some(j => j.address === '/Input_Channels/2/Aux_Send/3/send_level' && j.args[0] === -20), 'and stereo aux 1 on the console reaches mix 3 on phones');
    console.log('ok - the console\'s mono and stereo aux mixes are read and mapped both ways');
    ph8.close(); server.stop(); mock8.close();
  }

  // ── Mute by send off, FX returns in mixes, mix EQ, the channel panel, the
  // Console Controller's other strips ─────────────────────────────────────
  {
    const fs = require('fs');
    // Patch's saved patch: input 1 on MixRack socket 39, input 2 on the DX168's input 2
    const patchDir = path.join(process.env.JPM_TEST_USERDATA, 'plugin-data', 'patch');
    fs.mkdirSync(patchDir, { recursive: true });
    fs.writeFileSync(path.join(patchDir, 'patch.json'), JSON.stringify({ boxes: [
      { id: 'dl-mixrack', model: 'ah-cdm64', ports: { 'in.39': { name: 'Kick', src: { kind: 'ch', n: 1 } } } },
      { id: 'dl-dx-1', model: 'ah-dx168', ports: { 'in.2': { name: 'Snare', src: { kind: 'ch', n: 2 } } } },
    ] }));
    const mock9 = net.createServer();
    let sock9 = null; let bytes9 = [];
    const fxr1 = P.coordinate(0, 'fxReturn', 1), grp1 = P.coordinate(0, 'monoGroup', 1), main1 = P.coordinate(0, 'main', 1);
    const names9 = [[fxr1, 'VERB'], [grp1, 'DRUMS'], [main1, '1']];
    const answered9 = new Set();
    let assignAnswers = true; // answer send on/off questions with "on"
    mock9.on('connection', (s) => {
      sock9 = s;
      const dec9 = new P.Decoder();
      s.on('data', (d) => {
        bytes9 = bytes9.concat([...d]);
        // Every name asked for that the show has, each time (as a console does)
        for (const ev of dec9.push([...d])) {
          if (ev.type !== 'sysex' || ev.bytes[8] !== 0x01) continue;
          const hit = names9.find(([c]) => c.midiCh === ev.bytes[7] && c.ch === ev.bytes[9]);
          if (hit) s.write(Buffer.from(P.buildNameSet(hit[0].midiCh, hit[0].ch, hit[1])));
        }
        if (!assignAnswers) return;
        const in1 = P.coordinate(0, 'input', 1), aux1c = P.coordinate(0, 'monoAux', 1);
        if (!answered9.has('a1') && containsSubsequence(bytes9, P.buildSendAssignGet(in1.midiCh, in1.ch, aux1c))) { answered9.add('a1'); s.write(Buffer.from(P.buildSendAssignSet(in1.midiCh, in1.ch, aux1c, true))); }
      });
    });
    await new Promise((resolve) => mock9.listen(0, '127.0.0.1', resolve));
    const origCC9 = net.createConnection;
    net.createConnection = (opts, cb) => origCC9.call(net, { ...opts, port: mock9.address().port }, cb);
    await new Promise((resolve) => { server.start({ serverPort: 18207, deskIp: '127.0.0.1', channels: 4, auxes: 2, groups: 1, dliveBaseChannel: 0, dlivePan: false, dliveFxReturns: 2, auxOverrides: { 1: { eqEnabled: true } } }); setTimeout(resolve, 300); });
    net.createConnection = origCC9;
    const ph9 = new WebSocket('ws://127.0.0.1:18207'); const seen9 = [];
    ph9.on('message', (m) => seen9.push(JSON.parse(m)));
    await new Promise((resolve) => ph9.once('open', resolve));
    const waitFor = async (check, ms = 3000) => { const end = Date.now() + ms; while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); return check(); };
    const sent = (bytes) => containsSubsequence(bytes9, bytes);
    const in1 = P.coordinate(0, 'input', 1), aux1 = P.coordinate(0, 'monoAux', 1);

    // FX returns: channels 129 on, named as on the console
    assert.ok(await waitFor(() => seen9.some(j => j.type === 'channel-relabeled' && j.channel === 129 && j.label === 'VERB')), 'FX return 1 is named from the console');
    const cfg9 = seen9.find(j => j.config).config;
    assert.deepEqual(cfg9.channels.map(c => c.channel), [1, 2, 3, 4, 129, 130], 'the inputs, then 2 FX returns');
    assert.equal(cfg9.channels.find(c => c.channel === 130).label, 'FX Return 2', 'an FX return with only its number is called FX Return N');
    ph9.send(JSON.stringify({ address: '/Input_Channels/129/Aux_Send/1/send_level', args: [-5] }));
    assert.ok(await waitFor(() => sent(P.buildSendLevelSet(fxr1.midiCh, fxr1.ch, aux1, P.dbToLv(-5)))), 'an FX return\'s level in a mix goes to its send on the console');
    sock9.write(Buffer.from(P.buildSendLevelSet(fxr1.midiCh, fxr1.ch, aux1, P.dbToLv(-8))));
    assert.ok(await waitFor(() => seen9.some(j => j.address === '/Input_Channels/129/Aux_Send/1/send_level' && j.args[0] === -8)), 'and the console\'s back to phones');
    console.log('ok - FX returns in mixes: channels 129 on, named from the console, both ways');

    // Mute by send off: the console's on/off is asked for, the send switched off, the level left alone
    bytes9 = [];
    ph9.send(JSON.stringify({ type: 'set-mute', aux: 1, ch: 1, muted: true }));
    assert.ok(await waitFor(() => sent(P.buildSendAssignSet(in1.midiCh, in1.ch, aux1, false))), 'a mute switches the send off');
    assert.ok(sent(P.buildSendAssignGet(in1.midiCh, in1.ch, aux1)), 'after asking the console whether it was on');
    assert.ok(!sent(P.buildSendLevelSet(in1.midiCh, in1.ch, aux1, 0)), 'the level isn\'t touched');
    // The engineer switches it on while it's muted: off again, kept for the unmute
    bytes9 = [];
    sock9.write(Buffer.from(P.buildSendAssignSet(in1.midiCh, in1.ch, aux1, true)));
    assert.ok(await waitFor(() => sent(P.buildSendAssignSet(in1.midiCh, in1.ch, aux1, false))), 'switched on elsewhere while muted: off again');
    // A fader move while muted goes to the console (its level is the console's)
    bytes9 = [];
    ph9.send(JSON.stringify({ address: '/Input_Channels/1/Aux_Send/1/send_level', args: [-3] }));
    assert.ok(await waitFor(() => sent(P.buildSendLevelSet(in1.midiCh, in1.ch, aux1, P.dbToLv(-3)))), 'a move while muted reaches the console');
    bytes9 = [];
    ph9.send(JSON.stringify({ type: 'set-mute', aux: 1, ch: 1, muted: false }));
    assert.ok(await waitFor(() => sent(P.buildSendAssignSet(in1.midiCh, in1.ch, aux1, true))), 'the unmute switches it back on');
    // A send the console has off stays off after a mute and unmute
    const in2 = P.coordinate(0, 'input', 2);
    sock9.write(Buffer.from(P.buildSendAssignSet(in2.midiCh, in2.ch, aux1, false)));
    await new Promise((r) => setTimeout(r, 100));
    bytes9 = [];
    ph9.send(JSON.stringify({ type: 'set-mute', aux: 1, ch: 2, muted: true }));
    ph9.send(JSON.stringify({ type: 'set-mute', aux: 1, ch: 2, muted: false }));
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(!sent(P.buildSendAssignSet(in2.midiCh, in2.ch, aux1, true)), 'a send the console had off isn\'t switched on by an unmute');
    console.log('ok - mute by send off: on/off asked for, switched off and back, an engineer\'s change kept, the level left alone');

    // Mix EQ for its musicians: aux 1 allowed, read from the console and written to it
    assert.equal(cfg9.aux[0].eqEnabled, true);
    assert.equal(cfg9.aux[1].eqEnabled, false, 'only where Settings allows it');
    bytes9 = [];
    ph9.send(JSON.stringify({ type: 'request-aux-eq', aux: 1 }));
    assert.ok(await waitFor(() => sent(P.buildNrpnGet(aux1.midiCh, aux1.ch, P.peqParam(3, 'gain')))), 'the mix\'s PEQ is asked for');
    sock9.write(Buffer.from(P.buildNrpnSet(aux1.midiCh, aux1.ch, P.peqParam(0, 'gain'), 0x55)));
    assert.ok(await waitFor(() => seen9.some(j => j.address === '/Aux_Outputs/1/EQ/eq_gain_1' && Math.abs(j.args[0] - 5) < 0.01)), 'its low band\'s gain reaches phones (55 = +5 dB)');
    ph9.send(JSON.stringify({ address: '/Aux_Outputs/1/EQ/eq_freq_2', args: [1000] }));
    assert.ok(await waitFor(() => sent(P.buildNrpnSet(aux1.midiCh, aux1.ch, P.peqParam(1, 'freq'), 71))), 'a phone\'s move goes to the console (1 kHz = 71)');
    bytes9 = [];
    ph9.send(JSON.stringify({ address: '/Aux_Outputs/2/EQ/eq_freq_2', args: [1000] }));
    await new Promise((r) => setTimeout(r, 150));
    const aux2 = P.coordinate(0, 'monoAux', 2);
    assert.ok(!sent(P.buildNrpnSet(aux2.midiCh, aux2.ch, P.peqParam(1, 'freq'), 71)), 'nothing for a mix Settings hasn\'t allowed');
    console.log('ok - a mix\'s EQ for its musicians: read from the console and written to it, only where allowed');

    // The channel panel: preamp from Patch's socket, high-pass and EQ
    bytes9 = []; seen9.length = 0;
    ph9.send(JSON.stringify({ type: 'request-channel-detail', ch: 1 }));
    assert.ok(await waitFor(() => seen9.some(j => j.type === 'channel-detail')), 'the panel is answered');
    const d1 = seen9.find(j => j.type === 'channel-detail');
    assert.ok(d1.params['Channel_Input/analog_gain'] && d1.params['Channel_Input/phantom'] && d1.params['Channel_Input/pad'], 'input 1 has a preamp: Patch knows its socket');
    assert.match(d1.note, /MixRack socket 39/);
    assert.ok(d1.params['EQ/eq_gain_1'] && d1.params['Filters/lo_filter_freq'], 'and EQ and high-pass');
    assert.ok(await waitFor(() => sent(P.buildPreampGainGet(0, 38)) && sent(P.buildPhantomGet(0, 38)) && sent(P.buildNrpnGet(in1.midiCh, in1.ch, P.PARAM.HPF_FREQ))), 'its preamp (socket 39) and high-pass are asked for');
    sock9.write(Buffer.from([0xE0, 38, 0x32]));
    assert.ok(await waitFor(() => seen9.some(j => j.address === '/Input_Channels/1/Channel_Input/analog_gain' && Math.abs(j.args[0] - P.gvToGain(0x32)) < 0.01)), 'the console\'s gain reaches the panel');
    bytes9 = [];
    ph9.send(JSON.stringify({ type: 'console-param', ch: 1, path: 'Channel_Input/phantom', value: 1 }));
    ph9.send(JSON.stringify({ type: 'console-param', ch: 1, path: 'EQ/eq_gain_1', value: 3 }));
    ph9.send(JSON.stringify({ type: 'console-param', ch: 1, path: 'Filters/lo_filter_in', value: 1 }));
    assert.ok(await waitFor(() => sent(P.buildPhantomSet(0, 38, true))), '48V goes to socket 39');
    assert.ok(sent(P.buildNrpnSet(in1.midiCh, in1.ch, P.peqParam(3, 'gain'), P.peqGainToVv(3))), 'the panel\'s band 1 is dLive\'s top band');
    assert.ok(sent(P.buildNrpnSet(in1.midiCh, in1.ch, P.PARAM.HPF_ON, 0x7F)), 'and the high-pass on');
    seen9.length = 0;
    ph9.send(JSON.stringify({ type: 'request-channel-detail', ch: 2 }));
    assert.ok(await waitFor(() => seen9.some(j => j.type === 'channel-detail')));
    assert.match(seen9.find(j => j.type === 'channel-detail').note, /DX 2/, 'input 2 is on the DX168\'s input 2');
    seen9.length = 0;
    ph9.send(JSON.stringify({ type: 'request-channel-detail', ch: 3 }));
    assert.ok(await waitFor(() => seen9.some(j => j.type === 'channel-detail')));
    const d3 = seen9.find(j => j.type === 'channel-detail');
    assert.ok(!d3.params['Channel_Input/phantom'], 'a channel Patch doesn\'t know has no preamp controls (no guessing)');
    assert.match(d3.note, /Patch/);
    bytes9 = [];
    ph9.send(JSON.stringify({ type: 'console-param', ch: 3, path: 'Channel_Input/phantom', value: 1 }));
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(!bytes9.some((b, i) => b === 0x0C && bytes9[i - 1] === 0x00 && bytes9[i - 2] === 0x00), 'and no 48V is sent for it');
    console.log('ok - the channel panel: preamp on Patch\'s socket (MixRack and DX), high-pass and EQ, both ways; none without a socket');

    // The Console Controller's other strips: the ones the show has
    seen9.length = 0;
    ph9.send(JSON.stringify({ type: 'request-console-state' }));
    assert.ok(await waitFor(() => seen9.some(j => j.config && j.config.consoleExtras && j.config.consoleExtras.length), 9000), 'the other strips are read');
    const ex = seen9.filter(j => j.config).at(-1).config.consoleExtras;
    assert.deepEqual(ex.map(x => x.kind), ['fxr', 'grp', 'main', 'mg'], 'FX returns, groups, mains and mute groups the show has');
    assert.deepEqual(ex.find(x => x.kind === 'grp').strips, [{ n: 1, label: 'DRUMS' }]);
    assert.deepEqual(ex.find(x => x.kind === 'main').strips, [{ n: 1, label: 'Main 1' }], 'a name that\'s only its number gets one');
    assert.equal(ex.find(x => x.kind === 'mg').strips.length, 8);
    bytes9 = [];
    ph9.send(JSON.stringify({ type: 'extra-fader', kind: 'grp', n: 1, db: -4 }));
    ph9.send(JSON.stringify({ type: 'extra-mute', kind: 'mg', n: 2, muted: true }));
    const mg2 = P.coordinate(0, 'muteGroup', 2);
    assert.ok(await waitFor(() => sent(P.buildFaderSet(grp1.midiCh, grp1.ch, P.dbToLv(-4))) && sent(P.buildMuteOn(mg2.midiCh, mg2.ch))), 'a group fader and a mute group mute reach the console');
    sock9.write(Buffer.from(P.buildFaderSet(main1.midiCh, main1.ch, P.dbToLv(-2))));
    assert.ok(await waitFor(() => seen9.some(j => j.address === '/Extra/main/1/fader' && j.args[0] === -2)), 'and the main fader from the console reaches the page');
    console.log('ok - Console Controller: dLive\'s FX returns, groups, mains and mute groups, both ways');

    // Stopped while muted: the send is switched on again
    ph9.send(JSON.stringify({ type: 'set-mute', aux: 1, ch: 1, muted: true }));
    assert.ok(await waitFor(() => { const i = bytes9.length; return sent(P.buildSendAssignSet(in1.midiCh, in1.ch, aux1, false)) && i >= 0; }));
    bytes9 = [];
    ph9.close();
    await server.stop();
    assert.ok(sent(P.buildSendAssignSet(in1.midiCh, in1.ch, aux1, true)), 'stopping puts a muted send back on');
    console.log('ok - stopped mid-mute, the send is on again');
    mock9.close();
  }

  // ── Pan on the stereo mixes, through the console's own app protocol ─────
  {
    const DP = require('./dlive-private');
    // A stand-in console on MIDI: 2 mono groups, mono aux 1, stereo aux 1 and 2
    const midiNames = [[P.coordinate(0, 'monoGroup', 1), 'G1'], [P.coordinate(0, 'monoGroup', 2), 'G2'], [P.coordinate(0, 'monoAux', 1), 'IEM'], [P.coordinate(0, 'stereoAux', 1), 'BAND'], [P.coordinate(0, 'stereoAux', 2), 'VOX']];
    let midiSock = null;
    const midi = net.createServer((s) => {
      midiSock = s;
      const dec = new P.Decoder();
      s.on('data', (d) => { for (const ev of dec.push([...d])) { if (ev.type !== 'sysex' || ev.bytes[8] !== 0x01) continue; const hit = midiNames.find(([c]) => c.midiCh === ev.bytes[7] && c.ch === ev.bytes[9]); if (hit) s.write(Buffer.from(P.buildNameSet(hit[0].midiCh, hit[0].ch, hit[1]))); } });
    });
    await new Promise((r) => midi.listen(0, '127.0.0.1', r));
    // ...and on its app protocol: modules by name, subscriptions, values, sets
    // Channel 1's send levels at the stereo mixes' places (3 and 5): what MIDI says too, so the places prove out
    const priv = { values: new Map([[DP.inputParam('level', 1, 3), DP.dbToValue(-10)], [DP.inputParam('level', 1, 5), DP.dbToValue(-12)], [DP.inputParam('level', 2, 3), DP.dbToValue(-4)], [DP.inputParam('level', 2, 5), DP.dbToValue(-6)]]), handles: new Map(), sets: [], sock: null, lookups: [] };
    const frameOf = (src, dst, type, payload = Buffer.alloc(0)) => { const h = Buffer.alloc(19); h[0] = 0xf1; h.writeUInt16BE(1, 1); h.writeUInt32BE(src, 3); h.writeUInt32BE(dst, 7); h.writeUInt32BE(type, 11); h.writeUInt32BE(payload.length, 15); return Buffer.concat([h, payload, Buffer.from([0xf8])]); };
    const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16BE(v); return b; };
    const privServer = net.createServer((s) => {
      priv.sock = s;
      let buf = Buffer.alloc(0);
      s.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        for (;;) {
          if (!buf.length) break;
          const m = buf[0]; let n = null;
          if (m === 0xf1 && buf.length >= 19) n = 20 + buf.readUInt32BE(15);
          else if (m === 0xe0 && buf.length >= 3) n = 4 + buf.readUInt16BE(1);
          if (n === null || buf.length < n) break;
          const f = buf.subarray(0, n); buf = buf.subarray(n);
          if (m !== 0xf1) continue;
          const src = f.readUInt32BE(3), dst = f.readUInt32BE(7), type = f.readUInt32BE(11), payload = f.subarray(19, n - 1);
          if (type === 4) {
            const name = payload.toString('latin1'), mm = /Number (\d\d)/.exec(name), mc = /^(Graphic EQ|Compressor), Mix Channel (\d+) - Intermediate/.exec(name);
            priv.lookups.push(name.replace(/\0/g, ''));
            const id = mm ? 0x2d + Number(mm[1]) : mc ? (mc[1] === 'Compressor' ? 0x7100 : 0x7000) + Number(mc[2]) : null;
            const b = Buffer.alloc(4); if (id !== null) b.writeUInt32BE(id);
            s.write(frameOf(1, 0, id !== null ? 2 : 3, id !== null ? b : Buffer.alloc(0)));
          }
          else if (type === 6) priv.handles.set(payload.readUInt32BE(2), { obj: src, param: payload.readUInt16BE(12) });
          // Inputs 3 and 4 are a stereo pair (00 in the high byte), the rest mono (01)
          else if (type === 8) { const h = priv.handles.get(dst); if (h) s.write(frameOf(dst, src, 0x1000, u16(priv.values.get(h.param) ?? (h.param >= 0x12b0 && h.param < 0x12b8 ? (h.param === 0x12b2 || h.param === 0x12b3 ? 0x0025 : 0x0125) : h.param >= 0x1b00 ? 37 : 0)))); }
          else { const value = payload.length === 1 ? payload[0] : payload.readUInt16BE(0); priv.sets.push({ obj: src, handle: dst, param: type, value, bytes: payload.length }); priv.values.set(type, value); }
        }
      });
    });
    await new Promise((r) => privServer.listen(0, '127.0.0.1', r));
    const origCC11 = net.createConnection;
    net.createConnection = (opts, cb) => origCC11.call(net, { ...opts, port: opts.port === DP.PORT ? privServer.address().port : midi.address().port }, cb);
    server.start({ serverPort: 18208, deskIp: '127.0.0.1', channels: 4, auxes: 3, dliveBaseChannel: 0, dlivePollSendLevels: false, auxOverrides: { 2: { eqEnabled: true } } });
    const ph11 = new WebSocket('ws://127.0.0.1:18208'); const seen11 = [];
    ph11.on('message', (m) => seen11.push(JSON.parse(m)));
    await new Promise((resolve) => ph11.once('open', resolve));
    const waitFor = async (check, ms = 6000) => { const end = Date.now() + ms; while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); return check(); };
    const lastCfg = () => (seen11.filter(j => j.config).at(-1) || {}).config;
    assert.ok(await waitFor(() => lastCfg() && lastCfg().aux.map(x => x.label).join() === 'IEM,BAND,VOX'), 'the layout is read');
    await new Promise((r) => setTimeout(r, 600)); // the link comes up
    assert.equal(lastCfg().aux[1].stereo, false, 'no pan before the mix\'s place is proven');
    // Phones on both stereo mixes, and their send levels over MIDI: the places prove out
    const in1 = P.coordinate(0, 'input', 1);
    const in2 = P.coordinate(0, 'input', 2);
    midiSock.write(Buffer.from(P.buildSendLevelSet(in1.midiCh, in1.ch, P.coordinate(0, 'stereoAux', 1), P.dbToLv(-10))));
    midiSock.write(Buffer.from(P.buildSendLevelSet(in1.midiCh, in1.ch, P.coordinate(0, 'stereoAux', 2), P.dbToLv(-12))));
    // One matching channel isn't enough (a neighbouring mix could match): a second, at another level
    await new Promise((r) => setTimeout(r, 300));
    ph11.send(JSON.stringify({ type: 'set-active-aux', aux: 3 }));
    ph11.send(JSON.stringify({ type: 'set-active-aux', aux: 2 }));
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(lastCfg().aux[1].stereo, false, 'one channel matching doesn\'t prove a place');
    midiSock.write(Buffer.from(P.buildSendLevelSet(in2.midiCh, in2.ch, P.coordinate(0, 'stereoAux', 1), P.dbToLv(-4))));
    midiSock.write(Buffer.from(P.buildSendLevelSet(in2.midiCh, in2.ch, P.coordinate(0, 'stereoAux', 2), P.dbToLv(-6))));
    ph11.send(JSON.stringify({ type: 'set-active-aux', aux: 3 }));
    ph11.send(JSON.stringify({ type: 'set-active-aux', aux: 2 }));
    assert.ok(await waitFor(() => lastCfg().aux[1].stereo && lastCfg().aux[2].stereo), 'the stereo mixes get pan once their places are proven');
    assert.deepEqual(lastCfg().aux.map(a => [a.label, a.stereo]), [['IEM', false], ['BAND', true], ['VOX', true]], 'a mono mix has no pan');
    assert.ok(await waitFor(() => lastCfg().channels.length === 3), 'a stereo input (3 and 4) is one channel');
    assert.deepEqual(lastCfg().channels.map(c => c.channel), [1, 2, 3]);
    // Mix 2 is stereo aux 1: place 3 in the console's list (2 groups, 1 mono aux before it)
    assert.ok(await waitFor(() => seen11.some(j => j.address === '/Input_Channels/1/Aux_Send/2/send_pan')), 'its pans are read when a phone picks it');
    assert.ok([...priv.handles.values()].some(h => h.obj === 0x2e && h.param === DP.inputParam('pan', 1, 3) && h.param === 0x1b73), 'channel 1, slot 0, place 3');
    assert.ok([...priv.handles.values()].some(h => h.param === DP.inputParam('pan', 2, 3) && h.param === 0x1bb3), 'channel 2 is slot 1');
    assert.equal(seen11.find(j => j.address === '/Input_Channels/1/Aux_Send/2/send_pan').args[0], 0.5, 'the middle (37) is the middle');
    for (let v = 0; v <= 73; v++) assert.equal(DP.sliderToPan(DP.panToSlider(v)), v, 'every pan step there and back');
    // A phone pans channel 2 hard right
    ph11.send(JSON.stringify({ address: '/Input_Channels/2/Aux_Send/2/send_pan', args: [1] }));
    assert.ok(await waitFor(() => priv.sets.some(x => x.param === 0x1bb3 && x.value === 73)), 'the console is told 73, full right');
    // A pan made on the console reaches the phones
    const h1 = [...priv.handles.entries()].find(([, h]) => h.param === 0x1b73)[0];
    priv.sock.write(frameOf(h1, 0x2e, 0x1000, u16(0)));
    assert.ok(await waitFor(() => seen11.some(j => j.address === '/Input_Channels/1/Aux_Send/2/send_pan' && j.args[0] === 0)), 'a pan made elsewhere reaches phones');
    // A pan on a stereo pair's right half is the pair's: its left half's
    ph11.send(JSON.stringify({ address: '/Input_Channels/4/Aux_Send/2/send_pan', args: [0] }));
    assert.ok(await waitFor(() => priv.sets.some(x => x.param === DP.inputParam('pan', 3, 3) && x.value === 0)), 'channel 4\'s pan goes to channel 3');
    assert.ok(!priv.sets.some(x => x.param === DP.inputParam('pan', 4, 3)), 'never to the right half');
    // Solo on a channel doesn't switch off a stereo pair's right half (it would silence the pair)
    ph11.send(JSON.stringify({ type: 'set-solo', aux: 2, ch: 1, soloed: true }));
    await new Promise((r) => setTimeout(r, 400));
    ph11.send(JSON.stringify({ type: 'set-solo', aux: 2, ch: 1, soloed: false }));
    // Its graphic EQ and compressor (Settings allows EQ on mix 2): found by the mix's place, read and set
    assert.equal(lastCfg().aux[1].geqEnabled, true); assert.equal(lastCfg().aux[1].compEnabled, true);
    assert.equal(lastCfg().aux[2].geqEnabled, false, 'only on a mix Settings allows EQ on');
    ph11.send(JSON.stringify({ type: 'request-aux-dyn', aux: 2 }));
    assert.ok(await waitFor(() => seen11.some(j => j.type === 'aux-dyn' && String(j.aux) === '2')), 'the panel is answered');
    assert.ok(priv.lookups.includes('Graphic EQ, Mix Channel 4 - Intermediate') && priv.lookups.includes('Compressor, Mix Channel 4 - Intermediate'), 'named after the mix\'s place (3, counted from 1)');
    ph11.send(JSON.stringify({ address: '/Aux_Outputs/2/GEQ/geq_gain_16', args: [3] }));
    ph11.send(JSON.stringify({ address: '/Aux_Outputs/2/Comp/comp_in', args: [1] }));
    ph11.send(JSON.stringify({ address: '/Aux_Outputs/2/Comp/comp_thresh', args: [-10] }));
    assert.ok(await waitFor(() => priv.sets.some(x => x.obj === 0x7004 && x.param === 0x1013 && x.value === 0x8300)), 'band 16 (1 kHz) +3 dB to the graphic EQ');
    assert.ok(priv.sets.some(x => x.obj === 0x7104 && x.param === 0x1007 && x.value === 1 && x.bytes === 1), 'the compressor in, as one byte');
    assert.ok(priv.sets.some(x => x.obj === 0x7104 && x.param === 0x1000 && x.value === 0x7600), 'its threshold, -10 dB');
    const before12 = priv.sets.length;
    ph11.send(JSON.stringify({ address: '/Aux_Outputs/3/GEQ/geq_gain_1', args: [6] }));
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(priv.sets.length, before12, 'nothing for a mix Settings hasn\'t allowed');
    // Mix 1 (mono) has no pan: nothing is sent
    const before11 = priv.sets.length;
    ph11.send(JSON.stringify({ address: '/Input_Channels/2/Aux_Send/1/send_pan', args: [0] }));
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(priv.sets.length, before11, 'no pan for a mono mix');
    // A place that doesn't check out: channel 3's send is -20 dB over MIDI but 0 dB at that place — no pan on that mix
    const in3 = P.coordinate(0, 'input', 3), st1 = P.coordinate(0, 'stereoAux', 1);
    const lvlHandle = [...priv.handles.entries()].find(([, h]) => h.param === DP.inputParam('level', 3, 3))[0];
    priv.sock.write(frameOf(lvlHandle, 0x2e, 0x1000, u16(0x8000)));
    midiSock.write(Buffer.from(P.buildSendLevelSet(in3.midiCh, in3.ch, st1, P.dbToLv(-20))));
    assert.ok(await waitFor(() => lastCfg().aux[1].stereo === false, 6000), 'the mix loses its pan when its levels disagree with MIDI');
    assert.equal(lastCfg().aux[2].stereo, true, 'the other stereo mix keeps it');
    console.log('ok - pan on the stereo mixes: found by itself, read and set both ways, none on a mono mix, and none where the place doesn\'t check out');
    net.createConnection = origCC11;
    ph11.close(); await server.stop(); midi.close(); privServer.close();
  }

  // ── A mix that isn't where the layout says: found by its send levels ────
  {
    const DP = require('./dlive-private');
    // On MIDI: mono aux 1, a stereo FX send and stereo aux 1, so the layout
    // says place 3 for the stereo aux (the mono aux, then the FX send's two).
    // On the app protocol it's at places 5 and 6 (both halves read the send)
    const st1 = P.coordinate(0, 'stereoAux', 1), fx1 = P.coordinate(0, 'stereoFxSend', 1);
    const names = [[P.coordinate(0, 'monoAux', 1), 'IEM'], [st1, 'BAND'], [fx1, 'VERB']];
    let midiSock = null;
    const midi = net.createServer((s) => {
      midiSock = s;
      const dec = new P.Decoder();
      s.on('data', (d) => { for (const ev of dec.push([...d])) { if (ev.type !== 'sysex' || ev.bytes[8] !== 0x01) continue; const hit = names.find(([c]) => c.midiCh === ev.bytes[7] && c.ch === ev.bytes[9]); if (hit) s.write(Buffer.from(P.buildNameSet(hit[0].midiCh, hit[0].ch, hit[1]))); } });
    });
    await new Promise((r) => midi.listen(0, '127.0.0.1', r));
    const values = new Map();
    for (const [ch, db] of [[1, -10], [2, -4]]) for (const place of [5, 6]) values.set(DP.inputParam('level', ch, place), DP.dbToValue(db));
    const handles = new Map(), sets = [];
    const frameOf = (src, dst, type, payload = Buffer.alloc(0)) => { const h = Buffer.alloc(19); h[0] = 0xf1; h.writeUInt16BE(1, 1); h.writeUInt32BE(src, 3); h.writeUInt32BE(dst, 7); h.writeUInt32BE(type, 11); h.writeUInt32BE(payload.length, 15); return Buffer.concat([h, payload, Buffer.from([0xf8])]); };
    const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16BE(v); return b; };
    const privServer = net.createServer((s) => {
      let buf = Buffer.alloc(0);
      s.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        for (;;) {
          if (!buf.length) break;
          const m = buf[0]; let n = null;
          if (m === 0xf1 && buf.length >= 19) n = 20 + buf.readUInt32BE(15);
          else if (m === 0xe0 && buf.length >= 3) n = 4 + buf.readUInt16BE(1);
          if (n === null || buf.length < n) break;
          const f = buf.subarray(0, n); buf = buf.subarray(n);
          if (m !== 0xf1) continue;
          const src = f.readUInt32BE(3), dst = f.readUInt32BE(7), type = f.readUInt32BE(11), payload = f.subarray(19, n - 1);
          if (type === 4) { const mm = /Number (\d\d)/.exec(payload.toString('latin1')); const b = Buffer.alloc(4); if (mm) b.writeUInt32BE(0x2d + Number(mm[1])); s.write(frameOf(1, 0, mm ? 2 : 3, mm ? b : Buffer.alloc(0))); }
          else if (type === 6) handles.set(payload.readUInt32BE(2), payload.readUInt16BE(12));
          // Every input mono (01 in the high byte), pans in the middle
          else if (type === 8) { const param = handles.get(dst); if (param !== undefined) s.write(frameOf(dst, src, 0x1000, u16(values.get(param) ?? (param >= 0x12b0 && param < 0x12b8 ? 0x0125 : param >= 0x1b00 ? 37 : 0)))); }
          else sets.push({ param: type, value: payload.readUInt16BE(0) });
        }
      });
    });
    await new Promise((r) => privServer.listen(0, '127.0.0.1', r));
    const origCC = net.createConnection;
    net.createConnection = (opts, cb) => origCC.call(net, { ...opts, port: opts.port === DP.PORT ? privServer.address().port : midi.address().port }, cb);
    server.start({ serverPort: 18209, deskIp: '127.0.0.1', channels: 4, auxes: 2, dliveBaseChannel: 0, dlivePollSendLevels: false });
    const ph = new WebSocket('ws://127.0.0.1:18209'); const seen = [];
    ph.on('message', (m) => seen.push(JSON.parse(m)));
    await new Promise((resolve) => ph.once('open', resolve));
    const waitFor = async (check, ms = 6000) => { const end = Date.now() + ms; while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); return check(); };
    const lastCfg = () => (seen.filter(j => j.config).at(-1) || {}).config;
    assert.ok(await waitFor(() => lastCfg() && lastCfg().aux.map(x => x.label).join() === 'IEM,BAND'), 'the layout is read');
    await new Promise((r) => setTimeout(r, 600)); // the link comes up
    // Its sends over MIDI; channel 3's is switched off, its level still up (and off on the app protocol)
    for (const [ch, db] of [[1, -10], [2, -4], [3, -8]]) { const c = P.coordinate(0, 'input', ch); midiSock.write(Buffer.from(P.buildSendLevelSet(c.midiCh, c.ch, st1, P.dbToLv(db)))); }
    const in3 = P.coordinate(0, 'input', 3);
    midiSock.write(Buffer.from(P.buildSendAssignSet(in3.midiCh, in3.ch, st1, false)));
    await new Promise((r) => setTimeout(r, 300));
    ph.send(JSON.stringify({ type: 'set-active-aux', aux: 2 }));
    // The layout counts the mono aux and the FX send: the mix is first checked at place 3
    assert.ok(await waitFor(() => [...handles.values()].includes(DP.inputParam('level', 4, 3))), 'checked first after the mono aux and the FX send');
    assert.ok(![...handles.values()].includes(DP.inputParam('level', 4, 1)), 'not straight after the mono aux');
    // Place 3 disagrees (rechecked after 2.5 s), the search reads every place, and place 5 checks out
    assert.ok(await waitFor(() => lastCfg().aux[1].stereo === true, 12000), 'the mix gets pan at the place its levels are found at');
    ph.send(JSON.stringify({ address: '/Input_Channels/1/Aux_Send/2/send_pan', args: [0] }));
    assert.ok(await waitFor(() => sets.some(x => x.param === DP.inputParam('pan', 1, 5) && x.value === 0)), 'a pan goes to place 5');
    assert.ok(!sets.some(x => x.param === DP.inputParam('pan', 1, 3)), 'never to the place the layout guessed');
    console.log('ok - pan on a mix that isn\'t where the layout says: found by its levels, a send switched off saying nothing');
    net.createConnection = origCC;
    ph.close(); await server.stop(); midi.close(); privServer.close();
  }

  // ── Finding the console's base MIDI channel ─────────────────────────────
  {
    const { findBaseChannel } = require('./dlive-client');
    const mock10 = net.createServer((s) => {
      // A console on MIDI channels 4-8 (base 3): it answers only on those
      const dec = new P.Decoder();
      s.on('data', (d) => {
        for (const ev of dec.push([...d])) {
          if (ev.type !== 'sysex') continue;
          const midiCh = ev.bytes[7], op = ev.bytes[8];
          if (op === 0x01 && midiCh >= 3 && midiCh <= 7) s.write(Buffer.from(P.buildNameSet(midiCh, ev.bytes[9], 'X')));
        }
      });
    });
    await new Promise((resolve) => mock10.listen(0, '127.0.0.1', resolve));
    const found = await findBaseChannel({ host: '127.0.0.1', port: mock10.address().port, timeoutMs: 1500 });
    assert.deepEqual(found, { ok: true, baseChannel: 3 });
    mock10.close();
    console.log('ok - Find: the lowest MIDI channel that answers is the base channel');
  }

  console.log('\nAll dlive-server end-to-end checks passed');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
