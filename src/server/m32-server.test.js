'use strict';
// End-to-end test for m32-server.js: a real HTTP server and WebSocket phones
// against a fake M32 on UDP that answers the way the protocol document says
// a real one does (see m32-protocol.js). Not a capture of a real console.
const path = require('path');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return path.join(__dirname, '_fake-electron-for-tests.js');
  return origResolve.call(this, request, ...args);
};
const fs = require('fs');
const os = require('os');
process.env.JPM_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-m32-test-'));

const dgram = require('dgram');
const osc = require('osc');
const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const scenes = require('./scenes.js');
const server = require('./m32-server.js');

const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(check, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return true; await wait(20); }
  return false;
}

// ── Fake M32 ───────────────────────────────────────────────────────────────
// 4 channels, mix buses 1-2 linked (one stereo mix), 3 and 4 mono. Every
// address answers (a real console has them all); names default to blank.
function fakeM32() {
  const sock = dgram.createSocket('udp4');
  const state = new Map();
  const fake = { sock, state, received: [], clients: new Map(), silent: false, echoToSender: false };
  const names = { '/ch/01/config/name': 'KICK', '/ch/02/config/name': 'BASS', '/ch/03/config/name': 'KEYS', '/ch/04/config/name': 'VOX',
    '/bus/01/config/name': 'BAND IEM', '/bus/02/config/name': 'BAND IEM', '/bus/03/config/name': 'VOX IEM', '/bus/04/config/name': 'DRUM WEDGE',
    '/dca/1/config/name': 'BAND' };
  for (const [a, v] of Object.entries(names)) state.set(a, v);
  for (let ch = 1; ch <= 4; ch++) {
    for (let bus = 1; bus <= 4; bus++) {
      state.set(`/ch/0${ch}/mix/0${bus}/level`, 0.5); // -10 dB
      state.set(`/ch/0${ch}/mix/0${bus}/on`, 1);
      if (bus % 2) state.set(`/ch/0${ch}/mix/0${bus}/pan`, 0.5);
    }
    state.set(`/ch/0${ch}/mix/fader`, 0.75);
    state.set(`/ch/0${ch}/mix/on`, 1);
  }
  state.set('/ch/04/mix/03/on', 0); // the engineer has VOX off in VOX IEM
  state.set('/config/buslink/1-2', 1);
  state.set('/-show/prepos/current', 2);
  state.set('/-prefs/show_control', 1);
  const isInt = (a) => /\/on$|buslink|solosw|prepos|show_control/.test(a);
  const typed = (a, v) => ({ type: typeof v === 'string' ? 's' : isInt(a) ? 'i' : 'f', value: v });
  const valueOf = (a) => (state.has(a) ? state.get(a) : /\/name$/.test(a) ? '' : 0);
  const out = (address, args, port, host) => sock.send(Buffer.from(osc.writePacket({ address, args })), port, host);
  // A change, to every /xremote client (not the one that made it, unless echoToSender)
  fake.set = (address, v, fromKey = null) => {
    state.set(address, v);
    for (const [key, until] of fake.clients) {
      if (until < Date.now() || (key === fromKey && !fake.echoToSender)) continue;
      const [host, port] = key.split(':');
      out(address, [typed(address, v)], Number(port), host);
    }
  };
  sock.on('message', (buf, rinfo) => {
    if (fake.silent) return;
    let m;
    try { m = osc.readPacket(new Uint8Array(buf), {}); } catch (_) { return; }
    const key = `${rinfo.address}:${rinfo.port}`;
    if (m.address === '/xremote') { fake.clients.set(key, Date.now() + 10000); return; }
    if (m.address === '/xinfo') { out('/xinfo', ['127.0.0.1', 'TEST', 'M32', '4.06'].map(v => ({ type: 's', value: v })), rinfo.port, rinfo.address); return; }
    if (!m.args.length) { out(m.address, [typed(m.address, valueOf(m.address))], rinfo.port, rinfo.address); return; }
    fake.received.push(m);
    if (m.address === '/-action/goscene') { fake.set('/-show/prepos/current', m.args[0]); return; }
    fake.set(m.address, m.args[0], key);
  });
  return fake;
}

function phone(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.got = [];
  ws.on('message', m => ws.got.push(JSON.parse(m)));
  ws.opened = new Promise(r => ws.on('open', r));
  ws.last = (pred) => [...ws.got].reverse().find(pred);
  return ws;
}
const sent = (fake, address) => fake.received.filter(m => m.address === address).map(m => m.args[0]);
const close = (a, b) => Math.abs(a - b) < 1e-6;

test('M32 backend end to end', async (t) => {
  const fake = fakeM32();
  await new Promise(r => fake.sock.bind(0, '127.0.0.1', r));
  const m32Port = fake.sock.address().port;
  let connected = null;
  server.setConsoleStatusCallback(s => { connected = s; });
  const serverPort = 18250;
  const cfg = { serverPort, deskIp: '127.0.0.1', m32Port, channels: 4, auxes: 4, sceneRecallEnabled: true };
  server.start(cfg);
  t.after(async () => { await server.stop(); fake.sock.close(); });

  assert.ok(await until(() => connected === true), 'connects and reports it');
  assert.ok(fake.clients.size === 1, 'subscribes with /xremote');
  assert.ok(await until(() => fake.state.get('/ch/04/mix/04/level') !== undefined && server.getEventLog().some(e => e.type === 'console-read'), 5000), 'reads every mix');
  assert.match(server.getEventLog().find(e => e.type === 'console-info').detail, /M32 "TEST", firmware 4\.06/);

  const a = phone(serverPort), b = phone(serverPort);
  await Promise.all([a.opened, b.opened]);
  await until(() => a.got.some(j => j.config));

  await t.test('phones get the console\'s names, and a linked pair is one stereo mix', () => {
    const { config } = a.last(j => j.config);
    assert.deepEqual(config.channels.map(c => c.label), ['KICK', 'BASS', 'KEYS', 'VOX']);
    assert.deepEqual(config.aux.map(x => x.label), ['BAND IEM', 'BAND IEM', 'VOX IEM', 'DRUM WEDGE']);
    assert.deepEqual(config.aux.map(x => x.enabled), [true, false, true, true], 'bus 2 is the right half of mix 1');
    assert.deepEqual(config.aux.map(x => x.stereo), [true, false, false, false]);
    assert.equal(config.snapshot, '02', 'the scene the console is on');
    assert.equal(config.controlGroups[0].label, 'BAND');
    assert.deepEqual(server.getChannelNames(), { 1: 'KICK', 2: 'BASS', 3: 'KEYS', 4: 'VOX' });
    assert.deepEqual(server.getAuxNames(), { 1: 'BAND IEM', 2: 'Linked to mix 1', 3: 'VOX IEM', 4: 'DRUM WEDGE' }, 'Settings sees why mix 2 isn\'t on phones');
  });

  await t.test('a phone opening a mix gets its levels and pans', async () => {
    a.got.length = 0;
    a.send(JSON.stringify({ type: 'request-aux-levels', aux: 1 }));
    assert.ok(await until(() => a.got.filter(j => /send_level$/.test(j.address || '')).length === 4));
    assert.equal(a.last(j => j.address === '/Input_Channels/1/Aux_Send/1/send_level').args[0], -10);
    assert.equal(a.last(j => j.address === '/Input_Channels/1/Aux_Send/1/send_pan').args[0], 0.5);
    a.got.length = 0;
    a.send(JSON.stringify({ address: '/Input_Channels/2/Aux_Send/3/send_level/?' }));
    assert.ok(await until(() => a.got.some(j => j.address === '/Input_Channels/2/Aux_Send/3/send_level')));
  });

  await t.test('a fader move goes to the console as a float on its fader scale, to both halves of a stereo mix', async () => {
    fake.received.length = 0;
    b.got.length = 0;
    a.send(JSON.stringify({ address: '/Input_Channels/1/Aux_Send/1/send_level', args: [0] }));
    assert.ok(await until(() => sent(fake, '/ch/01/mix/02/level').length === 1));
    assert.ok(close(sent(fake, '/ch/01/mix/01/level')[0], 0.75), '0 dB is 0.75');
    assert.ok(close(sent(fake, '/ch/01/mix/02/level')[0], 0.75));
    assert.ok(await until(() => b.got.some(j => j.address === '/Input_Channels/1/Aux_Send/1/send_level' && j.args[0] === 0)), 'other phones follow');
    // Pan on the stereo mix; none on a mono one
    a.send(JSON.stringify({ address: '/Input_Channels/1/Aux_Send/1/send_pan', args: [0.25] }));
    a.send(JSON.stringify({ address: '/Input_Channels/1/Aux_Send/3/send_pan', args: [0.25] }));
    assert.ok(await until(() => sent(fake, '/ch/01/mix/01/pan').length === 1));
    await wait(100);
    assert.deepEqual(sent(fake, '/ch/01/mix/03/pan'), []);
    // The right half isn't a mix of its own
    a.send(JSON.stringify({ address: '/Input_Channels/1/Aux_Send/2/send_level', args: [-20] }));
    await wait(100);
    assert.equal(sent(fake, '/ch/01/mix/02/level').length, 1);
  });

  await t.test('changes made on the console reach the phones', async () => {
    a.got.length = 0;
    fake.set('/ch/03/mix/03/level', 0.25); // -30 dB
    assert.ok(await until(() => a.got.some(j => j.address === '/Input_Channels/3/Aux_Send/3/send_level' && j.args[0] === -30)));
    fake.set('/ch/02/config/name', 'BASS DI');
    assert.ok(await until(() => a.got.some(j => j.type === 'channel-relabeled' && j.channel === 2 && j.label === 'BASS DI')));
    fake.set('/bus/04/config/name', 'DRUMS');
    assert.ok(await until(() => a.got.some(j => j.type === 'aux-relabeled' && j.aux === 4 && j.label === 'DRUMS')));
  });

  await t.test('the console echoing JPMixer\'s own writes back doesn\'t move faders', async () => {
    fake.echoToSender = true;
    a.got.length = 0; b.got.length = 0;
    for (const db of [-12, -11, -10]) a.send(JSON.stringify({ address: '/Input_Channels/2/Aux_Send/4/send_level', args: [db] }));
    await wait(200);
    assert.ok(!a.got.some(j => j.address === '/Input_Channels/2/Aux_Send/4/send_level'), 'the phone that moved it gets nothing back');
    assert.deepEqual(b.got.filter(j => j.address === '/Input_Channels/2/Aux_Send/4/send_level').map(j => j.args[0]), [-12, -11, -10]);
    fake.echoToSender = false;
  });

  await t.test('mute and solo switch sends off and back on; a send the engineer had off stays off', async () => {
    fake.received.length = 0;
    a.send(JSON.stringify({ type: 'set-mute', aux: 3, ch: 1, muted: true }));
    assert.ok(await until(() => fake.state.get('/ch/01/mix/03/on') === 0));
    a.send(JSON.stringify({ type: 'set-mute', aux: 3, ch: 1, muted: false }));
    assert.ok(await until(() => fake.state.get('/ch/01/mix/03/on') === 1));
    // Solo KEYS in VOX IEM: every other send off; VOX was already off
    fake.received.length = 0;
    a.send(JSON.stringify({ type: 'set-solo', aux: 3, ch: 3, soloed: true }));
    assert.ok(await until(() => fake.state.get('/ch/01/mix/03/on') === 0 && fake.state.get('/ch/02/mix/03/on') === 0));
    assert.equal(fake.state.get('/ch/03/mix/03/on'), 1);
    assert.equal(fake.state.get('/ch/04/mix/03/on'), 0, 'VOX was already off');
    a.send(JSON.stringify({ type: 'set-solo', aux: 3, ch: 3, soloed: false }));
    assert.ok(await until(() => fake.state.get('/ch/01/mix/03/on') === 1 && fake.state.get('/ch/02/mix/03/on') === 1));
    await wait(100);
    assert.equal(fake.state.get('/ch/04/mix/03/on'), 0, 'VOX stays off');
    // The stereo mix: both halves
    a.send(JSON.stringify({ type: 'set-mute', aux: 1, ch: 2, muted: true }));
    assert.ok(await until(() => fake.state.get('/ch/02/mix/01/on') === 0 && fake.state.get('/ch/02/mix/02/on') === 0));
    // The engineer (or a scene) switching a muted send back on: off again
    fake.set('/ch/02/mix/01/on', 1);
    assert.ok(await until(() => fake.state.get('/ch/02/mix/01/on') === 0));
    a.send(JSON.stringify({ type: 'set-mute', aux: 1, ch: 2, muted: false }));
    assert.ok(await until(() => fake.state.get('/ch/02/mix/01/on') === 1 && fake.state.get('/ch/02/mix/02/on') === 1));
    // A mute and quick release and mute again ends muted
    for (const muted of [true, false, true]) a.send(JSON.stringify({ type: 'set-mute', aux: 4, ch: 3, muted }));
    await wait(200);
    assert.equal(fake.state.get('/ch/03/mix/04/on'), 0);
    a.send(JSON.stringify({ type: 'set-mute', aux: 4, ch: 3, muted: false }));
    assert.ok(await until(() => fake.state.get('/ch/03/mix/04/on') === 1));
  });

  await t.test('a scene recall on the console: phones follow, and its Ear Scene is laid over it', async () => {
    scenes.saveScene('05', '3', { 1: 1 }); // KICK at the top of VOX IEM in scene 05
    a.got.length = 0;
    fake.received.length = 0;
    fake.set('/-show/prepos/current', 5);
    assert.ok(await until(() => a.got.some(j => j.address === '/SnapshotName' && j.args[0] === '05')));
    assert.ok(await until(() => sent(fake, '/ch/01/mix/03/level').length === 1), 'the Ear Scene goes to the console');
    assert.ok(close(sent(fake, '/ch/01/mix/03/level')[0], 1), '+10 dB');
    assert.ok(a.got.some(j => j.type === 'scene-recalled' && j.snapshot === '05'));
  });

  await t.test('the ‹ › buttons recall the next and previous scene', async () => {
    fake.received.length = 0;
    a.send(JSON.stringify({ type: 'fire-snapshot', action: 'next' }));
    assert.ok(await until(() => sent(fake, '/-action/goscene')[0] === 6));
    assert.ok(await until(() => a.got.some(j => j.address === '/SnapshotName' && j.args[0] === '06')));
  });

  await t.test('the Console Controller moves the console\'s own faders, mutes and solos', async () => {
    a.got.length = 0;
    a.send(JSON.stringify({ type: 'request-console-state' }));
    assert.ok(await until(() => a.got.some(j => j.address === '/Input_Channels/1/fader')));
    assert.equal(a.last(j => j.address === '/Input_Channels/1/fader').args[0], 0);
    fake.received.length = 0;
    a.send(JSON.stringify({ type: 'console-fader', ch: 2, db: -10 }));
    a.send(JSON.stringify({ type: 'console-mute', ch: 2, muted: true }));
    a.send(JSON.stringify({ type: 'aux-fader', aux: 3, db: 0 }));
    a.send(JSON.stringify({ type: 'cg-mute', cg: 1, muted: true }));
    a.send(JSON.stringify({ type: 'cg-solo', cg: 1, soloed: true }));
    assert.ok(await until(() => fake.received.length === 5));
    assert.ok(close(fake.state.get('/ch/02/mix/fader'), 0.5));
    assert.equal(fake.state.get('/ch/02/mix/on'), 0);
    assert.ok(close(fake.state.get('/bus/03/mix/fader'), 0.75));
    assert.equal(fake.state.get('/dca/1/on'), 0);
    assert.equal(fake.state.get('/-stat/solosw/73'), 1);
    assert.ok(await until(() => b.got.some(j => j.address === '/Input_Channels/2/mute' && j.args[0] === 1)), 'other pages follow');
    // Plugins see the same
    assert.deepEqual(server.getStrips().ch[2], { db: -10, mute: true });
    // And the console's own moves come back
    a.got.length = 0;
    fake.set('/ch/03/mix/on', 0);
    assert.ok(await until(() => a.got.some(j => j.address === '/Input_Channels/3/mute' && j.args[0] === 1)));
  });

  await t.test('the console dropping off: status follows, and a release made meanwhile is sent again', async () => {
    a.send(JSON.stringify({ type: 'set-mute', aux: 3, ch: 2, muted: true }));
    assert.ok(await until(() => fake.state.get('/ch/02/mix/03/on') === 0));
    fake.silent = true;
    assert.ok(await until(() => connected === false, 8000), 'reported gone');
    a.send(JSON.stringify({ type: 'set-mute', aux: 3, ch: 2, muted: false })); // lost
    await wait(100);
    assert.equal(fake.state.get('/ch/02/mix/03/on'), 0);
    fake.silent = false;
    assert.ok(await until(() => connected === true, 5000), 'back');
    assert.ok(await until(() => fake.state.get('/ch/02/mix/03/on') === 1), 'the release reached it');
  });

  await t.test('the traffic log has what went each way', () => {
    const log = server.getOscLog();
    assert.ok(log.some(e => e.dir === 'out' && e.address === '/ch/02/mix/03/on'));
    assert.ok(log.some(e => e.dir === 'in' && e.address === '/ch/01/config/name'));
    assert.ok(!log.some(e => e.address === '/xinfo' || e.address === '/xremote'), 'the connection check is left out');
  });

  await t.test('stopping switches back on every send a mute is holding off', async () => {
    a.send(JSON.stringify({ type: 'set-mute', aux: 4, ch: 1, muted: true }));
    assert.ok(await until(() => fake.state.get('/ch/01/mix/04/on') === 0));
    await server.stop();
    assert.ok(await until(() => fake.state.get('/ch/01/mix/04/on') === 1));
  });
});

test('a solo made before the console answers: released, the sends come back on (and one the engineer had off stays off)', async (t) => {
  const fake = fakeM32();
  fake.silent = true; // still booting
  await new Promise((r) => fake.sock.bind(0, '127.0.0.1', r));
  let connected = null;
  server.setConsoleStatusCallback((s) => { connected = s; });
  const serverPort = 18251;
  server.start({ serverPort, deskIp: '127.0.0.1', m32Port: fake.sock.address().port, channels: 4, auxes: 4 });
  t.after(async () => { await server.stop(); fake.sock.close(); });
  const a = phone(serverPort);
  await a.opened;
  a.send(JSON.stringify({ type: 'set-solo', aux: 3, ch: 1, soloed: true }));
  await wait(200);
  fake.silent = false; // the console answers
  assert.ok(await until(() => connected === true, 6000));
  assert.ok(await until(() => fake.state.get('/ch/02/mix/03/on') === 0 && fake.state.get('/ch/03/mix/03/on') === 0, 5000), 'the others switched off once their on/off was known');
  assert.equal(fake.state.get('/ch/01/mix/03/on'), 1);
  a.send(JSON.stringify({ type: 'set-solo', aux: 3, ch: 1, soloed: false }));
  assert.ok(await until(() => fake.state.get('/ch/02/mix/03/on') === 1 && fake.state.get('/ch/03/mix/03/on') === 1), 'released: back on');
  await wait(150);
  assert.equal(fake.state.get('/ch/04/mix/03/on'), 0, 'VOX, off on the console, stays off');
  a.close();
});
