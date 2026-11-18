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
// klang-server.js pings the processor to tell if it's there: answered here,
// so a test can unplug it (pingDown) without a real network
const childProcess = require('child_process');
const realExecFile = childProcess.execFile;
let pingDown = false;
childProcess.execFile = function (file, args, opts, cb) {
  if (file === 'ping') { setImmediate(() => cb(pingDown ? new Error('no reply') : null)); return; }
  return realExecFile.apply(this, arguments);
};
const server = require('./klang-server.js');

async function main() {
  // ── Mock "KLANG processor" UDP receiver ────────────────────────────────
  const mock = dgram.createSocket('udp4');
  const received = [];
  mock.on('message', (buf) => { if (!pingDown) received.push(osc.readMessage(buf)); }); // unplugged: lost
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

  // ── An unmute while the processor is unreachable is sent when it's back ──
  // Only the mutes on used to be re-sent: the channel stayed muted.
  {
    pingDown = true;
    let deadline = Date.now() + 8000;
    while (server.isConsoleConnected() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    assert.equal(server.isConsoleConnected(), false, 'the processor should show offline');
    ws.send(JSON.stringify({ type: 'set-mute', aux: 1, ch: 2, muted: false }));
    await new Promise((r) => setTimeout(r, 150));
    pingDown = false;
    received.length = 0;
    deadline = Date.now() + 8000;
    while (!server.isConsoleConnected() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(received.some(m => m.address === '/Kf/ui/1/ch/2/mute' && m.args === false), 'the unmute should reach the processor when it is back');
    console.log('ok - an unmute made while the processor was unreachable is sent when it is back');
  }

  ws.close();
  server.stop();

  // ── The paired dLive is asked for channel names; open phones get them ──
  // It was never asked (it only says a name when one is renamed), so phones
  // showed CH 1…8 all service; and names that did arrive reached no phone.
  {
    const net = require('net');
    const asked = [], held = [];
    let replyNow = null; // replies wait until the phone is open, so it's there to be told
    const fakeDlive = net.createServer((sock) => {
      sock.on('data', (d) => {
        const b = [...d];
        // Name get: header, midiCh, 0x01, ch, F7 (possibly several in one chunk)
        for (let i = 0; i + 10 < b.length + 1; i++) {
          if (b[i] === 0xF0 && b[i + 9] === 0x01 && b[i + 11] === 0xF7) {
            const midiCh = b[i + 8], ch = b[i + 10];
            asked.push(ch + 1);
            const name = ch === 0 ? 'Kick' : ch === 1 ? '2' : `Ch${ch + 1}`; // "2": the dLive's default
            const reply = Buffer.from([0xF0, 0x00, 0x00, 0x1A, 0x50, 0x10, 0x01, 0x00, midiCh, 0x02, ch, ...Buffer.from(name, 'ascii'), 0xF7]);
            if (replyNow) sock.write(reply); else held.push(() => sock.write(reply));
          }
        }
      });
    });
    await new Promise((r) => fakeDlive.listen(0, '127.0.0.1', r));
    const port2 = 18212;
    server.start({ serverPort: port2, klangIp: '127.0.0.1', klangPort: mockPort, channels: 4, auxes: 2, deskIp: '127.0.0.1', dliveMidiPort: fakeDlive.address().port, dliveBaseChannel: 0, channelOverrides: { 3: { label: 'Settings name' } } });
    await new Promise((r) => setTimeout(r, 100));
    const phone = new WebSocket(`ws://127.0.0.1:${port2}`);
    const got = [];
    phone.on('message', (m) => got.push(JSON.parse(m)));
    await new Promise((r) => phone.on('open', r));
    await new Promise((r) => setTimeout(r, 200));
    replyNow = true;
    held.splice(0).forEach((send) => send());
    let deadline = Date.now() + 3000;
    while (!got.some(j => j.type === 'channel-relabeled' && j.channel === 4) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual([...new Set(asked)].sort(), [1, 2, 3, 4], 'every input up to Settings’ count is asked for');
    const relabels = got.filter(j => j.type === 'channel-relabeled');
    assert.ok(relabels.some(j => j.channel === 1 && j.label === 'Kick'), 'an open phone sees the console’s name');
    assert.ok(!relabels.some(j => j.channel === 2), 'a dLive default (a number) is left to CH 2');
    assert.ok(relabels.some(j => j.channel === 3 && j.label === 'Settings name'), 'Settings’ own label still wins');
    assert.equal(server.getChannelNames()[1], 'Kick', 'and pages that open later get it too');
    console.log('ok - the paired dLive is asked for every channel name, and open phones are told');
    phone.close();
    server.stop();
    fakeDlive.close();
  }
  mock.close();

  console.log('\nAll klang-server end-to-end checks passed');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
