'use strict';
// End-to-end test for wing-server.js against a real HTTP server, real
// WebSocket clients, and a mock UDP "WING console" — same shape as
// klang-server.test.js one layer up. Run with:
//   node src/server/wing-server.test.js
const path = require('path');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return path.join(__dirname, '_fake-electron-for-tests.js');
  return origResolve.call(this, request, ...args);
};

const dgram = require('dgram');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const osc = require('osc');
const server = require('./wing-server.js');

async function main() {
  // ── Mock "WING console" UDP responder ────────────────────────────────
  const mock = dgram.createSocket('udp4');
  const received = [];
  let mockRemote = null;
  mock.on('message', (buf, rinfo) => {
    mockRemote = rinfo;
    const msg = osc.readMessage(buf);
    received.push(msg);
    // Answer any GET (empty args) so checkConnected()/name-priming succeed,
    // mirroring the doc's own documented reply shapes.
    if (Array.isArray(msg.args) && msg.args.length === 0) {
      let reply;
      if (msg.address === '/ch/1/fdr') reply = ['0.0', 0.5, -6.0];
      else if (msg.address.endsWith('/name')) reply = ['Kick'];
      else reply = ['0.0', 0.5, 0.0];
      const packet = osc.writePacket({ address: msg.address, args: reply });
      mock.send(Buffer.from(packet), rinfo.port, rinfo.address);
    }
  });
  await new Promise((resolve) => mock.bind(0, '127.0.0.1', resolve));
  const mockPort = mock.address().port;

  const serverPort = 18230;
  server.start({ serverPort, deskIp: '127.0.0.1', wingPort: mockPort, channels: 8, auxes: 4 });
  await new Promise((r) => setTimeout(r, 900)); // let checkConnected() + all 8 channels' paced name priming (75ms/tick) fully settle

  // ── HTTP static serving ───────────────────────────────────────────────
  {
    const http = require('http');
    const status = await new Promise((resolve) => {
      http.get(`http://127.0.0.1:${serverPort}/devices.html`, (res) => resolve(res.statusCode));
    });
    assert.equal(status, 200);
    console.log('ok - static files (devices.html) served, status 200');
  }

  console.log('ok - console reported connected via a real GET round trip:', server.isConsoleConnected());
  assert.equal(server.isConsoleConnected(), true);

  // ── WS client connects, receives config with stereo:true (real per-send pan) ─
  const ws = new WebSocket(`ws://127.0.0.1:${serverPort}`);
  const config = await new Promise((resolve) => {
    ws.on('message', (m) => { const j = JSON.parse(m); if (j.config) resolve(j.config); });
  });
  assert.equal(config.aux.length, 4);
  assert.equal(config.channels.length, 8);
  assert.equal(config.aux[0].stereo, true, 'WING auxes should report stereo:true — real per-send pan exists');
  assert.equal(config.aux[0].eqEnabled, false);
  console.log('ok - WS client receives config with correct aux/channel counts and stereo:true');

  // ── Fader move -> WING send-level message ───────────────────────────────
  received.length = 0;
  ws.send(JSON.stringify({ address: '/Input_Channels/2/Aux_Send/1/send_level', args: [-11] }));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], { address: '/ch/2/send/1/lvl', args: -11 });
  console.log('ok - a fader move sends the exact WING send-level message (mix=aux=bus, ch=channel)');

  // ── Pan move -> real per-send pan message, scaled from 0..1 to -90..90 ──
  received.length = 0;
  ws.send(JSON.stringify({ address: '/Input_Channels/2/Aux_Send/1/send_pan', args: [0] })); // full left
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(received[0], { address: '/ch/2/send/1/pan', args: -90 });
  console.log('ok - a full-left pan move sends pan -90');

  // ── set-mute uses WING's real send.on flag, not a level-zeroing trick ───
  received.length = 0;
  ws.send(JSON.stringify({ type: 'set-mute', aux: 1, ch: 2, muted: true }));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(received.length, 1);
  assert.equal(received[0].address, '/ch/2/send/1/on');
  assert.equal(received[0].args, 0); // on=0 means silenced
  console.log('ok - set-mute sends a real WING send.on=0 message, not a fake -inf level');

  // ── request-aux-levels replays JPMixer's own last-sent values ──────────
  const levelsBack = await new Promise((resolve) => {
    const collected = [];
    const handler = (m) => {
      const j = JSON.parse(m);
      if (j.address && j.address.includes('send_level')) collected.push(j);
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ type: 'request-aux-levels', aux: 1 }));
    setTimeout(() => { ws.removeListener('message', handler); resolve(collected); }, 200);
  });
  assert.equal(levelsBack.length, 1);
  assert.deepEqual(levelsBack[0], { address: '/Input_Channels/2/Aux_Send/1/send_level', args: [-11] });
  console.log('ok - request-aux-levels replays JPMixer\'s own last-sent level');

  // ── Channel name was actually primed via a real GET ─────────────────────
  // (priming already completed during the initial 900ms wait above)
  const names = server.getChannelNames();
  assert.equal(names['1'], 'Kick');
  console.log('ok - channel names were primed via real GET requests on connect');

  // ── fire-snapshot is a safe no-op (no scene signal exists for WING) ─────
  const crashed1 = [];
  const onUncaught1 = (err) => crashed1.push(err);
  process.on('uncaughtException', onUncaught1);
  ws.send(JSON.stringify({ type: 'fire-snapshot', action: 'next' }));
  await new Promise((r) => setTimeout(r, 100));
  process.removeListener('uncaughtException', onUncaught1);
  assert.equal(crashed1.length, 0);
  console.log('ok - fire-snapshot is a safe no-op (WING has no scene/snapshot signal)');

  // ── Out-of-range / malformed input never crashes the server ────────────
  const crashed = [];
  const onUncaught = (err) => crashed.push(err);
  process.on('uncaughtException', onUncaught);

  ws.send(JSON.stringify({ address: '/Input_Channels/1/Aux_Send/9999/send_level', args: [-10] }));
  ws.send(JSON.stringify({ address: '/Input_Channels/0/Aux_Send/1/send_level', args: [-10] }));
  ws.send(JSON.stringify({ type: 'set-mute', aux: 9999, ch: 1, muted: true }));
  ws.send(JSON.stringify({ type: 'apply-preset', aux: 1, name: 'x', levels: { '1': NaN, '2': -6 }, pans: { '1': Infinity } }));
  await new Promise((r) => setTimeout(r, 200));

  process.removeListener('uncaughtException', onUncaught);
  assert.equal(crashed.length, 0, `bad input should never crash the server; got: ${crashed.map(e => e.message).join('; ')}`);
  assert.equal(ws.readyState, WebSocket.OPEN);
  console.log('ok - out-of-range/non-finite input is ignored, never crashes the server');

  ws.close();
  server.stop();
  mock.close();

  console.log('\nAll wing-server end-to-end checks passed');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
