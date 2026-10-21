'use strict';
// End-to-end test for lv1-server.js: a real HTTP server and WebSocket
// phones against a fake LV1 that speaks the MyMon protocol the way a real
// LV1 17.3 did in captures (see lv1-protocol.js).
const path = require('path');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return path.join(__dirname, '_fake-electron-for-tests.js');
  return origResolve.call(this, request, ...args);
};
const fs = require('fs');
const os = require('os');
process.env.JPM_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-lv1-test-'));

const net = require('net');
const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const P = require('./lv1-protocol.js');
const server = require('./lv1-server.js');

const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(check, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return true; await wait(20); }
  return false;
}

// ── Fake LV1 ───────────────────────────────────────────────────────────────
// 4 inputs, 2 mixes, everything sent to both mixes
function fakeLv1() {
  const names = ['KICK', 'BASS', 'KEYS', 'VOX'];
  const mixNames = ['BAND IEM', 'VOX IEM'];
  // As in a real 80-channel show: an aux bus and a monitor mix, each its
  // type's track 0, listed together — a send's mix is the list position
  const mixTracks = [{ type: 2, index: 0 }, { type: 25, index: 0 }];
  const state = { level: {}, on: {}, pan: {} }; // "src:mix" (0-based)
  for (let s = 0; s < 4; s++) for (let m = 0; m < 2; m++) { state.level[`${s}:${m}`] = -10 - s; state.on[`${s}:${m}`] = true; state.pan[`${s}:${m}`] = 0; }
  state.on['3:1'] = false; // the engineer has switched VOX off in VOX IEM
  // Each track's own fader/mute/solo: "type:index" (0-based)
  state.track = { '0:0': { gain: -5, mute: false, solo: false }, '0:3': { gain: -2, mute: true, solo: false },
    '2:0': { gain: 0, mute: false, solo: false }, '25:0': { gain: -1, mute: false, solo: false, mono: true }, '12:0': { gain: -3, mute: false, solo: false }, '12:1': { gain: 0, mute: false, solo: false } };
  const fake = { received: [], sockets: new Set(), state, scene: 'SONG 1', echoDelay: 0 };
  // LV1's confirmations, optionally late (as over a busy network)
  const later = (fn) => fake.echoDelay ? setTimeout(fn, fake.echoDelay) : fn();
  const send = (sock, address, args) => sock.write(Buffer.concat([P.frame(address, args)]));
  const tagged = v => typeof v === 'boolean' ? { t: v ? 'T' : 'F' } : Number.isInteger(v) ? { t: 'i', v } : typeof v === 'string' ? { t: 's', v } : { t: 'd', v };
  const notifyAll = (address, values) => { for (const s of fake.sockets) send(s, address, values.map(tagged)); };
  fake.notifyAll = notifyAll;
  function sendsFor(sock, mix) {
    const list = (fn, width) => [mix, 4, ...[0, 1, 2, 3].flatMap(s => fn(s))];
    send(sock, '/Notify/Sends', list(s => [0, s, state.level[`${s}:${mix}`]]).map(tagged));
    send(sock, '/Notify/Sends/On', list(s => [0, s, state.on[`${s}:${mix}`]]).map(tagged));
    send(sock, '/Notify/Sends/Pan', list(s => [0, s, true, state.pan[`${s}:${mix}`]]).map(tagged));
  }
  fake.server = net.createServer((sock) => {
    fake.sockets.add(sock);
    sock.on('close', () => fake.sockets.delete(sock));
    sock.on('error', () => {});
    send(sock, '/Notify/ServiceVersion', [tagged('v.17.6.26.454'), tagged(454), tagged(17), tagged(6)]);
    const reader = new P.FrameReader();
    sock.on('data', (chunk) => {
      for (const m of reader.push(chunk)) {
        if (m.address === '/ping' || m.address === '/pong') continue;
        fake.received.push(m);
        const [srcType, src, mix, value] = m.args;
        const key = `${src}:${mix}`;
        if (m.address === '/handshake') {
          send(sock, '/handshake', [tagged(1)]);
          send(sock, '/Aux/Tracks', [tagged(2), ...mixNames.flatMap((n, i) => [tagged(mixTracks[i].index), tagged(mixTracks[i].type), tagged(n)])]);
          // 19 values per track; only name, type and index matter here
          const track = (n, type, i) => { const t = state.track[`${type}:${i}`] || { gain: -144, mute: false }; return [n, type, i, t.gain, 0, 0, t.mute ? 1 : 0, -1, -1, -1, -1, -1, -1, -1, -1, 0, t.mono ? 1 : 2, '65793', 0]; };
          send(sock, '/Channels', [8, ...names.flatMap((n, i) => track(n, 0, i)), ...mixNames.flatMap((n, i) => track(n, mixTracks[i].type, mixTracks[i].index)), ...track('DRUM DCA', 12, 0), ...track('VOX DCA', 12, 1)].map(tagged));
          send(sock, '/Notify/Scene/Name', [tagged(fake.scene)]);
          send(sock, '/Notify/SceneList', [3, 0, 'SONG 1', 1, 'SONG 2', 2, 'SONG 3'].map(tagged));
          send(sock, '/Notify/CurSceneIndex', [tagged(['SONG 1', 'SONG 2', 'SONG 3'].indexOf(fake.scene))]);
        } else if (m.address === '/Get/Sends') {
          sendsFor(sock, m.args[0]);
        } else if (m.address === '/Set/Aux/Send/Gain' && srcType === 0) {
          const wasInf = state.level[key] <= -144;
          state.level[key] = Math.max(-144, Math.min(10, value));
          // As LV1 does: raising a level from -inf switches the send on
          if (wasInf && state.level[key] > -144 && !state.on[key]) { state.on[key] = true; later(() => notifyAll('/Notify/Aux/Send/On', [0, src, mix, true, true])); }
          const v = state.level[key];
          later(() => notifyAll('/Notify/Aux/Send/Gain', [0, src, mix, v, true]));
        } else if (m.address === '/Set/Track/Out/Gain') {
          const [type, index, db] = m.args; const t = state.track[`${type}:${index}`] ||= { gain: -144, mute: false, solo: false };
          t.gain = db; later(() => notifyAll('/Notify/Track/Out/Gain', [type, index, db, true]));
        } else if (m.address === '/Set/Track/Out/Mute') {
          const [type, index, on] = m.args; const t = state.track[`${type}:${index}`] ||= { gain: -144, mute: false, solo: false };
          t.mute = on; notifyAll('/Notify/Track/Out/Mute', [type, index, on ? 1 : 0, true]);
        } else if (m.address === '/Set/Solo') {
          const [type, index, on] = m.args; const t = state.track[`${type}:${index}`] ||= { gain: -144, mute: false, solo: false };
          t.solo = on === 1; notifyAll('/Notify/Solo', [type, index, on, 1]);
        } else if (m.address === '/Scene/Recall') {
          fake.scene = ['SONG 1', 'SONG 2', 'SONG 3'][m.args[0]];
          notifyAll('/Notify/CurSceneIndex', [m.args[0]]);
          notifyAll('/Notify/Scene/Name', [fake.scene]);
        } else if (m.address === '/Set/Aux/Send/On' && srcType === 0) {
          state.on[key] = value;
          notifyAll('/Notify/Aux/Send/On', [0, src, mix, value, true]);
        } else if (m.address === '/Set/Aux/Send/Pan' && srcType === 0) {
          state.pan[key] = Math.max(-45, Math.min(45, value));
          notifyAll('/Notify/Aux/Send/Pan', [0, src, mix, state.pan[key], true]);
        }
      }
    });
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

test('LV1 backend end to end', async (t) => {
  const fake = fakeLv1();
  await new Promise(r => fake.server.listen(0, '127.0.0.1', r));
  const lv1Port = fake.server.address().port;
  let connected = null;
  server.setConsoleStatusCallback(s => { connected = s; });
  const serverPort = 18240;
  server.start({ serverPort, deskIp: '127.0.0.1', lv1Port, channels: 16, auxes: 8, sceneRecallEnabled: true });
  t.after(async () => { await server.stop(); for (const s of fake.sockets) s.destroy(); fake.server.close(); });

  assert.ok(await until(() => connected === true), 'connects to LV1 and reports it');
  assert.ok(await until(() => fake.received.filter(m => m.address === '/Get/Sends').length === 2), 'asks for both mixes');
  const hello = fake.received.find(m => m.address === '/device_name');
  assert.equal(hello.args[0], 'JPMixer');
  assert.match(hello.args[1], /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-8[0-9A-F]{3}-[0-9A-F]{12}$/);

  const a = phone(serverPort), b = phone(serverPort);
  await Promise.all([a.opened, b.opened]);
  await until(() => a.got.some(j => j.config));
  await wait(400); // the layout refresh that follows LV1's show data
  const showConfig = a.last(j => j.config).config;

  await t.test('phones get the show: counts, names and scene from LV1, not Settings', () => {
    const { config } = a.last(j => j.config);
    assert.equal(server.getChannelCount(), 4);
    assert.deepEqual(config.channels.map(c => c.label), ['KICK', 'BASS', 'KEYS', 'VOX']);
    assert.deepEqual(config.aux.map(x => x.label), ['BAND IEM', 'VOX IEM']);
    assert.deepEqual(config.aux.map(x => x.stereo), [true, false], 'the mono monitor mix has no pan');
    assert.equal(config.snapshot, 'SONG 1');
    assert.deepEqual(server.getAuxNames(), { 1: 'BAND IEM', 2: 'VOX IEM' });
  });

  await t.test('a phone reads a mix as LV1 has it', async () => {
    a.got.length = 0;
    a.send(JSON.stringify({ type: 'request-aux-levels', aux: 2 }));
    assert.ok(await until(() => a.got.filter(j => /Aux_Send\/2\/send_level/.test(j.address || '')).length === 4));
    const lvl = a.last(j => j.address === '/Input_Channels/3/Aux_Send/2/send_level');
    assert.deepEqual(lvl.args, [-12]);
    assert.deepEqual(a.last(j => j.address === '/Input_Channels/3/Aux_Send/2/send_pan').args, [0.5]);
  });

  await t.test('a phone picking a mix gets its levels by asking for each channel', async () => {
    a.got.length = 0;
    for (let ch = 1; ch <= 4; ch++) a.send(JSON.stringify({ address: `/Input_Channels/${ch}/Aux_Send/2/send_level/?`, args: [] }));
    assert.ok(await until(() => a.got.filter(j => /Aux_Send\/2\/send_level$/.test(j.address || '')).length === 4));
    assert.deepEqual(a.last(j => j.address === '/Input_Channels/4/Aux_Send/2/send_level').args, [-13]);
  });

  await t.test('a fader move goes to LV1, other phones follow, and LV1\'s echo isn\'t sent back', async () => {
    a.got.length = 0; b.got.length = 0;
    a.send(JSON.stringify({ address: '/Input_Channels/2/Aux_Send/1/send_level', args: [-20.5] }));
    assert.ok(await until(() => fake.state.level['1:0'] === -20.5));
    assert.deepEqual(fake.received.at(-1).args, [0, 1, 0, -20.5]);
    assert.ok(await until(() => b.got.some(j => j.address === '/Input_Channels/2/Aux_Send/1/send_level')));
    await wait(150);
    assert.equal(a.got.filter(j => j.address === '/Input_Channels/2/Aux_Send/1/send_level').length, 0, 'the mover gets no echo');
    assert.equal(b.got.filter(j => j.address === '/Input_Channels/2/Aux_Send/1/send_level').length, 1, 'the other phone gets it once');
  });

  await t.test('LV1 confirming earlier values of a drag late doesn\'t move any phone\'s fader back', async () => {
    fake.echoDelay = 120;
    a.got.length = 0; b.got.length = 0;
    for (const v of [-30, -25, -20]) { a.send(JSON.stringify({ address: '/Input_Channels/3/Aux_Send/1/send_level', args: [v] })); await wait(15); }
    assert.ok(await until(() => fake.state.level['2:0'] === -20));
    await wait(300);
    fake.echoDelay = 0;
    const addr = '/Input_Channels/3/Aux_Send/1/send_level';
    assert.equal(a.got.filter(j => j.address === addr).length, 0, 'the mover gets none of LV1\'s confirmations');
    assert.deepEqual(b.got.filter(j => j.address === addr).map(j => j.args[0]), [-30, -25, -20], 'the other phone gets each move once, in order');
  });

  await t.test('a fader moved while muted stays muted on LV1, and the new level lands on unmute', async () => {
    fake.state.level['1:1'] = -144; fake.state.on['1:1'] = false; // BASS in VOX IEM: -inf and off, as many LV1 sends are
    a.send(JSON.stringify({ type: 'set-mute', aux: 2, ch: 2, muted: true }));
    await wait(100);
    const sentBefore = fake.received.length;
    a.send(JSON.stringify({ address: '/Input_Channels/2/Aux_Send/2/send_level', args: [-12] }));
    await wait(200);
    assert.equal(fake.received.slice(sentBefore).filter(m => m.address === '/Set/Aux/Send/Gain').length, 0, 'nothing reaches LV1 while muted');
    assert.equal(fake.state.on['1:1'], false, 'LV1 never switched it on');
    a.send(JSON.stringify({ type: 'set-mute', aux: 2, ch: 2, muted: false }));
    assert.ok(await until(() => fake.state.level['1:1'] === -12 && fake.state.on['1:1'] === true), 'on unmute: the level, and LV1 switches it on');
  });

  await t.test('a pan move is scaled to LV1\'s -45..45', async () => {
    a.send(JSON.stringify({ address: '/Input_Channels/1/Aux_Send/1/send_pan', args: [1] }));
    assert.ok(await until(() => fake.state.pan['0:0'] === 45));
  });

  await t.test('a change made on LV1 reaches the phones', async () => {
    a.got.length = 0;
    fake.notifyAll('/Notify/Aux/Send/Gain', [0, 3, 0, -3.5, true]);
    assert.ok(await until(() => a.got.some(j => j.address === '/Input_Channels/4/Aux_Send/1/send_level' && j.args[0] === -3.5)));
    fake.notifyAll('/Notify/Track/Name', [0, 0, 'KICK IN', true]);
    assert.ok(await until(() => a.got.some(j => j.type === 'channel-relabeled' && j.channel === 1 && j.label === 'KICK IN')));
  });

  await t.test('mute switches the send off and back on, leaving the level alone', async () => {
    const levelBefore = fake.state.level['0:0'];
    a.send(JSON.stringify({ type: 'set-mute', aux: 1, ch: 1, muted: true }));
    assert.ok(await until(() => fake.state.on['0:0'] === false));
    assert.equal(fake.state.level['0:0'], levelBefore);
    a.send(JSON.stringify({ type: 'set-mute', aux: 1, ch: 1, muted: false }));
    assert.ok(await until(() => fake.state.on['0:0'] === true));
  });

  await t.test('solo switches the others off; a send the engineer had off stays off afterwards', async () => {
    a.send(JSON.stringify({ type: 'set-solo', aux: 2, ch: 1, soloed: true }));
    assert.ok(await until(() => fake.state.on['1:1'] === false && fake.state.on['2:1'] === false));
    assert.equal(fake.state.on['0:1'], true, 'the soloed channel stays on');
    a.send(JSON.stringify({ type: 'set-solo', aux: 2, ch: 1, soloed: false }));
    assert.ok(await until(() => fake.state.on['1:1'] === true && fake.state.on['2:1'] === true));
    await wait(100);
    assert.equal(fake.state.on['3:1'], false, 'VOX was off on LV1 before the solo and stays off');
  });

  await t.test('a muted send LV1 turns back on (a scene recall) is switched off again', async () => {
    a.send(JSON.stringify({ type: 'set-mute', aux: 1, ch: 3, muted: true }));
    assert.ok(await until(() => fake.state.on['2:0'] === false));
    fake.state.on['2:0'] = true;
    fake.notifyAll('/Notify/Aux/Send/On', [0, 2, 0, true, true]);
    assert.ok(await until(() => fake.state.on['2:0'] === false));
  });

  await t.test('the Console Controller gets LV1\'s DCAs as control groups, and no processing panel', () => {
    const config = showConfig;
    assert.deepEqual(config.controlGroups, [{ channel: 1, label: 'DRUM DCA' }, { channel: 2, label: 'VOX DCA' }]);
    assert.equal(config.channelProcessing, false);
  });

  await t.test('the Console Controller opens showing LV1\'s faders and mutes', async () => {
    a.got.length = 0;
    a.send(JSON.stringify({ type: 'request-console-state' }));
    assert.ok(await until(() => a.got.some(j => j.address === '/Control_Groups/2/solo')));
    const val = addr => a.last(j => j.address === addr)?.args[0];
    assert.equal(val('/Input_Channels/1/fader'), -5);
    assert.equal(val('/Input_Channels/4/mute'), 1, 'VOX is muted on LV1');
    assert.equal(val('/Input_Channels/1/mute'), 0);
    assert.equal(val('/Aux_Outputs/1/fader'), 0);
    assert.equal(val('/Control_Groups/1/fader'), -3);
  });

  await t.test('Console Controller moves go to LV1 as main faders, mutes and the desk\'s solo', async () => {
    a.got.length = 0; b.got.length = 0;
    a.send(JSON.stringify({ type: 'console-fader', ch: 2, db: -7.5 }));
    a.send(JSON.stringify({ type: 'console-mute', ch: 1, muted: true }));
    a.send(JSON.stringify({ type: 'console-solo', ch: 3, soloed: true }));
    a.send(JSON.stringify({ type: 'aux-fader', aux: 2, db: -4 }));
    a.send(JSON.stringify({ type: 'aux-mute', aux: 1, muted: true }));
    a.send(JSON.stringify({ type: 'cg-fader', cg: 1, db: -10 }));
    a.send(JSON.stringify({ type: 'cg-solo', cg: 2, soloed: true }));
    assert.ok(await until(() => fake.state.track['12:1']?.solo === true));
    const tr = fake.state.track;
    assert.equal(tr['0:1'].gain, -7.5); assert.equal(tr['0:0'].mute, true); assert.equal(tr['0:2'].solo, true);
    assert.equal(tr['25:0'].gain, -4, 'aux 2 is the monitor mix track, not aux bus 2'); assert.equal(tr['2:0'].mute, true); assert.equal(tr['12:0'].gain, -10);
    assert.ok(await until(() => b.got.some(j => j.address === '/Input_Channels/1/mute' && j.args[0] === 1)), 'other pages see LV1\'s confirmed mute');
    assert.ok(b.got.some(j => j.address === '/Input_Channels/2/fader' && j.args[0] === -7.5), 'and the fader move');
    await wait(100);
    assert.equal(a.got.filter(j => j.address === '/Input_Channels/2/fader').length, 0, 'the mover gets no echo of its own fader');
    a.send(JSON.stringify({ type: 'console-solo', ch: 3, soloed: false }));
    a.send(JSON.stringify({ type: 'cg-solo', cg: 2, soloed: false }));
    assert.ok(await until(() => tr['0:2'].solo === false && tr['12:1'].solo === false));
  });

  await t.test('a main fader moved on LV1 reaches the Console Controller', async () => {
    a.got.length = 0;
    fake.notifyAll('/Notify/Track/Out/Gain', [12, 1, -6.5, true]);
    assert.ok(await until(() => a.got.some(j => j.address === '/Control_Groups/2/fader' && j.args[0] === -6.5)));
    fake.notifyAll('/Notify/Track/Out/Gain', [25, 0, -2.5, true]);
    assert.ok(await until(() => a.got.some(j => j.address === '/Aux_Outputs/2/fader' && j.args[0] === -2.5)), 'the monitor mix shows as aux 2');
    fake.notifyAll('/Notify/Track/Name', [25, 0, 'VOX 1', true]);
    assert.ok(await until(() => a.got.some(j => j.type === 'aux-relabeled' && j.aux === 2 && j.label === 'VOX 1')));
    fake.notifyAll('/Notify/Track/Name', [12, 1, 'VOCALS', true]);
    assert.ok(await until(() => a.got.some(j => j.address === '/Control_Groups/2/name' && j.args[0] === 'VOCALS')), 'a DCA renamed on LV1');
  });

  await t.test('the processing panel is told there\'s nothing to show', async () => {
    a.got.length = 0;
    a.send(JSON.stringify({ type: 'request-channel-detail', ch: 1, section: 'input' }));
    assert.ok(await until(() => a.got.some(j => j.type === 'channel-detail' && j.unsupported === true)));
  });

  await t.test('a scene change on LV1 tells the phones and lays the saved Ear Scene over it', async () => {
    a.send(JSON.stringify({ type: 'save-scene', snapshot: 'SONG 2', aux: 2, values: { 2: 0.5 } }));
    await until(() => a.got.some(j => j.type === 'scene-saved'));
    a.got.length = 0;
    fake.notifyAll('/Notify/Scene/Name', ['SONG 2']);
    assert.ok(await until(() => a.got.some(j => j.address === '/SnapshotName' && j.args[0] === 'SONG 2')));
    assert.ok(await until(() => a.got.some(j => j.type === 'scene-recalled' && j.snapshot === 'SONG 2')));
    const expected = require('./shared-handlers').sliderToDb(0.5);
    assert.ok(await until(() => Math.abs(fake.state.level['1:1'] - expected) < 0.001), 'BASS in VOX IEM set to the Ear Scene level');
  });

  await t.test('the ‹ › scene buttons step through LV1\'s scene list', async () => {
    // LV1 is on SONG 2 (index 1) after the previous test
    a.got.length = 0;
    a.send(JSON.stringify({ type: 'fire-snapshot', action: 'next' }));
    assert.ok(await until(() => a.got.some(j => j.address === '/SnapshotName' && j.args[0] === 'SONG 3')));
    assert.deepEqual(fake.received.filter(m => m.address === '/Scene/Recall').at(-1).args, [2]);
    const recalls = fake.received.filter(m => m.address === '/Scene/Recall').length;
    a.send(JSON.stringify({ type: 'fire-snapshot', action: 'next' })); // already the last scene
    await wait(150);
    assert.equal(fake.received.filter(m => m.address === '/Scene/Recall').length, recalls, 'nothing past the last scene');
    a.send(JSON.stringify({ type: 'fire-snapshot', action: 'prev' }));
    assert.ok(await until(() => a.got.some(j => j.address === '/SnapshotName' && j.args[0] === 'SONG 2')));
  });

  await t.test('after a dropped connection it reconnects and re-asserts mutes', async () => {
    for (const s of fake.sockets) s.destroy();
    assert.ok(await until(() => connected === false));
    fake.state.on['2:0'] = true; // an LV1 that came back with every send on
    assert.ok(await until(() => connected === true, 6000), 'reconnects by itself');
    assert.ok(await until(() => fake.state.on['2:0'] === false));
  });

  await t.test('an unmute while LV1 is unreachable reaches it once it\'s back', async () => {
    a.send(JSON.stringify({ type: 'set-mute', aux: 1, ch: 4, muted: true }));
    assert.ok(await until(() => fake.state.on['3:0'] === false));
    for (const s of fake.sockets) s.destroy();
    assert.ok(await until(() => connected === false));
    a.send(JSON.stringify({ type: 'set-mute', aux: 1, ch: 4, muted: false }));
    await wait(100);
    assert.equal(fake.state.on['3:0'], false, 'nothing could reach LV1 yet');
    assert.ok(await until(() => connected === true, 6000));
    assert.ok(await until(() => fake.state.on['3:0'] === true), 'the unmute landed after the reconnect');
  });

  await t.test('a Planning Center or Control API rename reaches every mix LV1 has, whatever Settings\' count says', () => {
    server.applyConfigLive({ serverPort, deskIp: '127.0.0.1', lv1Port, channels: 16, auxes: 1, sceneRecallEnabled: true });
    assert.equal(server.setAuxLabel(2, 'VOX - Sam'), true, 'LV1 reported 2 mixes; Settings\' 1 is only a fallback');
    assert.equal(server.setAuxLabel(3, 'nope'), false, 'but not a mix LV1 doesn\'t have');
    assert.equal(server.setChannelLabel(4, 'Lead Vox'), true);
    assert.equal(server.setChannelLabel(5, 'nope'), false);
    server.applyConfigLive({ serverPort, deskIp: '127.0.0.1', lv1Port, channels: 16, auxes: 8, sceneRecallEnabled: true });
  });

  await t.test('stopping turns back on every send a mute or solo switched off', async () => {
    // and a level moved while muted goes out with it
    a.send(JSON.stringify({ type: 'set-mute', aux: 1, ch: 2, muted: true }));
    assert.ok(await until(() => fake.state.on['1:0'] === false));
    a.send(JSON.stringify({ address: '/Input_Channels/2/Aux_Send/1/send_level', args: [-33] }));
    await wait(100);
    assert.notEqual(fake.state.level['1:0'], -33, 'held while muted');
    assert.equal(fake.state.on['2:0'], false);
    await server.stop();
    assert.ok(await until(() => fake.state.on['2:0'] === true));
    assert.ok(await until(() => fake.state.on['1:0'] === true && fake.state.level['1:0'] === -33), 'the held level went out on stop');
    assert.equal(fake.state.on['3:1'], false, 'still leaves the engineer\'s own off send alone');
  });
  a.close(); b.close();
});
