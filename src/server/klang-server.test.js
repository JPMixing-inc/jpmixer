'use strict';
// End-to-end test for klang-server.js against a real HTTP server, real
// WebSocket clients, and a mock UDP "KLANG processor" — same shape as
// dlive-server.test.js one layer up. Run with:
//   node src/server/klang-server.test.js
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
const server = require('./klang-server.js');

async function main() {
  // ── Mock "KLANG processor" UDP receiver ────────────────────────────────
  const mock = dgram.createSocket('udp4');
  const received = [];
  mock.on('message', (buf) => received.push(osc.readMessage(buf)));
  await new Promise((resolve) => mock.bind(0, '127.0.0.1', resolve));
  const mockPort = mock.address().port;

  const serverPort = 18210;
  server.start({ serverPort, klangIp: '127.0.0.1', klangPort: mockPort, channels: 8, auxes: 4, deskIp: '' });
  await new Promise((r) => setTimeout(r, 300));

  // ── HTTP static serving ───────────────────────────────────────────────
  {
    const http = require('http');
    const status = await new Promise((resolve) => {
      http.get(`http://127.0.0.1:${serverPort}/devices.html`, (res) => resolve(res.statusCode));
    });
    assert.equal(status, 200);
    console.log('ok - static files (devices.html) served, status 200');
  }

  // ── WS client connects, receives config with stereo:true (pan supported) ─
  const ws = new WebSocket(`ws://127.0.0.1:${serverPort}`);
  const config = await new Promise((resolve) => {
    ws.on('message', (m) => { const j = JSON.parse(m); if (j.config) resolve(j.config); });
  });
  assert.equal(config.aux.length, 4);
  assert.equal(config.channels.length, 8);
  assert.equal(config.aux[0].stereo, true, 'KLANG auxes should report stereo:true so mixer.js shows pan controls');
  assert.equal(config.aux[0].eqEnabled, false);
  console.log('ok - WS client receives config with correct aux/channel counts and stereo:true');

  // ── Fader move -> KLANG gain message ────────────────────────────────────
  received.length = 0;
  ws.send(JSON.stringify({ address: '/Input_Channels/2/Aux_Send/1/send_level', args: [-11] }));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], { address: '/Kf/ui/1/ch/2/gaindB', args: -11 });
  console.log('ok - a fader move sends the exact KLANG gaindB message (mix=aux, ch=channel)');

  // ── Pan move -> KLANG azimuth message, scaled from 0..1 to -90..90 ──────
  received.length = 0;
  ws.send(JSON.stringify({ address: '/Input_Channels/2/Aux_Send/1/send_pan', args: [0] })); // full left
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(received[0], { address: '/Kf/ui/1/ch/2/azi', args: -90 });
  console.log('ok - a full-left pan move sends azi -90');

  received.length = 0;
  ws.send(JSON.stringify({ address: '/Input_Channels/2/Aux_Send/1/send_pan', args: [1] })); // full right
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(received[0], { address: '/Kf/ui/1/ch/2/azi', args: 90 });
  console.log('ok - a full-right pan move sends azi +90');

  // ── set-mute uses KLANG's real native mute, not a level-zeroing trick ───
  received.length = 0;
  ws.send(JSON.stringify({ type: 'set-mute', aux: 1, ch: 2, muted: true }));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(received.length, 1);
  assert.equal(received[0].address, '/Kf/ui/1/ch/2/mute');
  assert.equal(received[0].args, true);
  console.log('ok - set-mute sends a real KLANG mute message, not a fake -inf level');

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
  console.log('ok - request-aux-levels replays JPMixer\'s own last-sent gain (no hardware read-back exists)');

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

  console.log('\nAll klang-server end-to-end checks passed');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
