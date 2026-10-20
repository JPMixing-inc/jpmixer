'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const net = require('node:net');
const { EventEmitter, once } = require('node:events');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, 'src/server', file), 'utf8');
const levelAddress = ch => `/Input_Channels/${ch}/Aux_Send/1/send_level`;

// Exercise each real backend's WS handlers without contacting any hardware.
function backend(family) {
  let socketServer;
  const transports = [];
  class Client extends EventEmitter {
    constructor() { super(); this.writes = []; transports.push(this); }
    connect() {}
    disconnect(options) { this.disconnectOptions = options; this.disconnected = true; return Promise.resolve(); }
    setSendLevel(...args) { this.writes.push(['level', ...args]); }
    setGain(...args) { this.writes.push(['gain', ...args]); }
    setSendOn(...args) { this.writes.push(['on', ...args]); }
    getSendOn(ch, bus) { return Promise.resolve((this.sendOnState || {})[`${ch}:${bus}`] ?? true); }
    setMute(...args) { this.writes.push(['mute', ...args]); }
    setSolo(...args) { this.writes.push(['solo', ...args]); }
    setSendPan(...args) { this.writes.push(['pan', ...args]); }
    setPan(...args) { this.writes.push(['pan', ...args]); }
    requestSendLevel() {}
    requestName() {}
    requestColour() {}
  }
  class SocketServer extends EventEmitter {
    constructor() { super(); this.clients = new Set(); socketServer = this; }
    close() {}
  }
  const http = new EventEmitter();
  http.listen = () => {};
  http.close = () => {};
  const express = () => ({ use() {}, get() {} });
  express.static = () => {};
  const scenes = { '42': { '1': { '1': 0.25 } } };
  const mocks = {
    express, http: { createServer: () => http }, ws: { Server: SocketServer, OPEN: 1 },
    './performer-assignments': { mountPerformerAssignments() {} },
    './greenroom': { mountGreenRoom() {} }, './branding': { mountBranding() {} }, './foh': { mountFoh() {} }, './config': {}, './presets': {},
    './scenes': { getAll: () => scenes, getScene: (key, aux) => scenes[key]?.[aux] },
    './wing-client': { WingClient: Client }, './klang-client': { KlangClient: Client },
    './dlive-client': { DliveClient: Client }
  };
  const sharedContext = vm.createContext({
    module: { exports: {} }, require: name => mocks[name] || require(name)
  });
  vm.runInContext(read('shared-handlers.js'), sharedContext);
  mocks['./shared-handlers'] = sharedContext.module.exports;
  const context = vm.createContext({
    module: { exports: {} }, __dirname: path.join(root, 'src/server'),
    console: { log() {}, error() {} },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, setImmediate,
    require: name => mocks[name] || (name.startsWith('./') ? require(path.join(root, 'src/server', name)) : require(name))
  });
  vm.runInContext(read(`${family}-server.js`), context);
  const run = code => vm.runInContext(code, context);
  const drain = () => run('pacer.flush()');
  run("start({serverPort:0,deskIp:'127.0.0.1',klangIp:'127.0.0.1',channels:2,auxes:1,sceneRecallEnabled:true})");
  function socket() {
    const ws = new EventEmitter();
    ws.readyState = 1;
    ws.messages = [];
    ws.send = payload => ws.messages.push(JSON.parse(payload));
    ws.terminate = () => { ws.readyState = 3; };
    // Writes are paced (paced-writer.js, covered by its own test); these
    // tests check which values reach the console, so drain after each one.
    ws.sendMessage = msg => { ws.emit('message', JSON.stringify(msg)); drain(); };
    socketServer.clients.add(ws);
    socketServer.emit('connection', ws);
    return ws;
  }
  return { run, drain, socket, client: transports[0], sceneClient: transports.at(-1), api: context.module.exports };
}

for (const family of ['klang', 'wing']) {
  test(`${family}: presets send dB, retain slider positions in notices, and return dB from cache`, () => {
    const h = backend(family), ws = h.socket();
    const slider = Math.pow(100, 0.7) / 100; // -20 dB on the shared browser curve
    for (const [value, db] of [[slider, -20], [0, -150], [1, 10]]) {
      ws.sendMessage({ type: 'apply-preset', aux: 1, name: 'Mix', levels: { 1: value } });
      assert(Math.abs(h.client.writes.at(-1).at(-1) - db) < 1e-8);
      assert.equal(ws.messages.at(-1).levels[1], value);
      ws.sendMessage({ type: 'request-aux-levels', aux: 1 });
      assert(Math.abs(ws.messages.at(-1).args[0] - db) < 1e-8);
    }
  });

  test(`${family}: fader and pan moves reach other screens without echoing to the sender`, () => {
    const h = backend(family), a = h.socket(), b = h.socket();
    for (const message of [
      { address: levelAddress(1), args: [-12] },
      { address: '/Input_Channels/1/Aux_Send/1/send_pan', args: [0.2] }
    ]) {
      a.messages.length = b.messages.length = 0;
      a.sendMessage(message);
      assert.deepEqual(b.messages.find(m => m.address === message.address), message);
      assert(!a.messages.some(m => m.address === message.address));
    }
  });
}

// Lets a WING on/off query resolve and the write it queues go out
const settle = async (h) => {
  for (let i = 0; i < 3; i++) { await new Promise(resolve => setImmediate(resolve)); h.drain(); }
};

test('WING mute and solo cover untouched sends without enabling unrelated sends', async () => {
  const h = backend('wing'), ws = h.socket();
  ws.sendMessage({ type: 'set-mute', aux: 1, ch: 2, muted: true });
  await settle(h);
  assert.deepEqual(h.client.writes, [['on', 2, 1, false]]);
  ws.sendMessage({ type: 'set-mute', aux: 1, ch: 2, muted: false });
  assert.deepEqual(h.client.writes.at(-1), ['on', 2, 1, true]);
  h.client.writes.length = 0;
  ws.sendMessage({ type: 'set-solo', aux: 1, ch: 1, soloed: true });
  await settle(h);
  assert.deepEqual(h.client.writes, [['on', 2, 1, false]]);
  ws.sendMessage({ address: levelAddress(2), args: [-9] });
  assert(h.run("silencedSends.has('2:1')"));
  ws.sendMessage({ type: 'set-solo', aux: 1, ch: 1, soloed: false });
  assert.deepEqual(h.client.writes.at(-1), ['on', 2, 1, true]);
});

test('WING leaves a send the engineer had switched off still off when a solo is released', async () => {
  const h = backend('wing'), ws = h.socket();
  h.client.sendOnState = { '2:1': false };
  ws.sendMessage({ type: 'set-solo', aux: 1, ch: 1, soloed: true });
  await settle(h);
  ws.sendMessage({ type: 'set-solo', aux: 1, ch: 1, soloed: false });
  assert.deepEqual(h.client.writes.filter(w => w[0] === 'on'), [], 'it was already off: nothing to switch off, and it must not be switched on');
});

test('WING: releasing a mute before the console answers changes nothing on the desk', async () => {
  const h = backend('wing'), ws = h.socket();
  ws.sendMessage({ type: 'set-mute', aux: 1, ch: 2, muted: true });
  ws.sendMessage({ type: 'set-mute', aux: 1, ch: 2, muted: false });
  await settle(h);
  assert.deepEqual(h.client.writes.filter(w => w[0] === 'on'), []);
});

test('KLANG and WING stop() releases every mute and solo JPMixer set before closing', async () => {
  const k = backend('klang'), kws = k.socket();
  kws.sendMessage({ type: 'set-mute', aux: 1, ch: 2, muted: true });
  kws.sendMessage({ type: 'set-solo', aux: 1, ch: 1, soloed: true });
  k.client.writes.length = 0;
  const kClosed = k.api.stop();
  assert.deepEqual(k.client.writes, [['mute', 1, 2, false], ['solo', 1, 1, false]]);
  assert.equal(k.client.disconnected, undefined, 'socket must not close in the same tick as the releases');
  await kClosed;
  assert.equal(k.client.disconnected, true);

  const w = backend('wing'), wws = w.socket();
  wws.sendMessage({ type: 'set-mute', aux: 1, ch: 2, muted: true });
  await settle(w);
  w.client.writes.length = 0;
  await w.api.stop();
  assert.deepEqual(w.client.writes, [['on', 2, 1, true]]);
});

test('dLive fader moves and echoes preserve mute/solo and logical levels', () => {
  const h = backend('dlive'), ws = h.socket();
  ws.sendMessage({ address: levelAddress(1), args: [-12] });
  ws.sendMessage({ type: 'set-mute', aux: 1, ch: 1, muted: true });
  ws.sendMessage({ address: levelAddress(1), args: [-9] });
  assert.equal(h.client.writes.at(-1).at(-1), -Infinity);
  h.client.emit('sendLevel', { midiCh: 0, ch: 0, sndMidiCh: 2, sndCh: 0, db: -Infinity });
  assert.equal(ws.messages.at(-1).args[0], -9);
  ws.sendMessage({ type: 'set-mute', aux: 1, ch: 1, muted: false });
  assert.equal(h.client.writes.at(-1).at(-1), -9);
  ws.sendMessage({ type: 'set-solo', aux: 1, ch: 1, soloed: true });
  ws.sendMessage({ address: levelAddress(2), args: [-6] });
  assert.equal(h.client.writes.at(-1).at(-1), -Infinity);
  ws.sendMessage({ type: 'set-solo', aux: 1, ch: 1, soloed: false });
  assert.equal(h.client.writes.at(-1).at(-1), -6);
});

test('dLive silences late replies under solo and serializes off as -150, not null', () => {
  const h = backend('dlive'), ws = h.socket();
  ws.sendMessage({ type: 'set-solo', aux: 1, ch: 1, soloed: true });
  h.client.emit('sendLevel', { midiCh: 0, ch: 1, sndMidiCh: 2, sndCh: 0, db: -12 });
  assert.equal(h.client.writes.at(-1).at(-1), -Infinity);
  assert.equal(ws.messages.at(-1).args[0], -12);
  ws.sendMessage({ type: 'set-solo', aux: 1, ch: 1, soloed: false });
  h.client.emit('sendLevel', { midiCh: 0, ch: 1, sndMidiCh: 2, sndCh: 0, db: -Infinity });
  assert.equal(ws.messages.at(-1).args[0], -150);
});

test('dLive ignores a send reply outside the mono aux coordinate range', () => {
  const h = backend('dlive'), ws = h.socket();
  h.run('serverCfg.auxes = 64');
  ws.sendMessage({ type: 'set-mute', aux: 63, ch: 1, muted: true });
  const before = h.client.writes.length;
  h.client.emit('sendLevel', { midiCh: 0, ch: 0, sndMidiCh: 2, sndCh: 62, db: -12 });
  assert.equal(h.client.writes.length, before);
});

test('dLive stop restores muted sends before gracefully disconnecting', async () => {
  const h = backend('dlive'), ws = h.socket();
  ws.sendMessage({ address: levelAddress(1), args: [-12] });
  ws.sendMessage({ type: 'set-mute', aux: 1, ch: 1, muted: true });
  await h.api.stop();
  assert.equal(h.client.writes.at(-1).at(-1), -12);
  assert.equal(h.client.disconnectOptions.flush, true);
});

for (const family of ['dlive', 'klang']) {
  test(`${family}: scene notifications and reconnect config use the saved scene key`, () => {
    const h = backend(family), ws = h.socket();
    h.sceneClient.emit('sceneRecall', { sceneNumber: 42 });
    const notice = ws.messages.find(m => m.address === '/SnapshotName');
    assert.equal(notice.args[0], '42');
    const cfg = JSON.parse(h.run('buildConfig()')).config;
    assert.equal(cfg.snapshot, '42');
    assert(cfg.scenes[cfg.snapshot][1]);
    if (family === 'klang') {
      assert(Math.abs(h.client.writes.at(-1).at(-1) - (50 * Math.log10(25) - 90)) < 1e-8);
      assert.equal(ws.messages.find(m => m.type === 'scene-recalled').levels[1][1], 0.25);
    }
  });
}

test('dLive TCP shutdown delivers queued restores before closing the socket', { timeout: 5000 }, async t => {
  const { DliveClient } = require('../src/server/dlive-client');
  const server = net.createServer();
  const received = [];
  const peers = new Set();
  server.on('connection', peer => {
    peers.add(peer);
    peer.on('data', bytes => received.push(bytes));
    peer.on('close', () => peers.delete(peer));
  });
  const client = new DliveClient({ host: '127.0.0.1', port: 0 });
  t.after(() => {
    client.disconnect();
    for (const peer of peers) peer.destroy();
    server.close();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  client.port = server.address().port;
  const connected = once(client, 'connect');
  client.connect();
  await connected;
  const P = require('../src/server/dlive-protocol');
  const input = P.coordinate(0, 'input', 1), aux = P.coordinate(0, 'monoAux', 1);
  for (let i = 0; i < 20; i++) client.setSendLevel(input, aux, -12);
  await client.disconnect({ flush: true });
  const expected = Buffer.from(P.buildSendLevelSet(input.midiCh, input.ch, aux, P.dbToLv(-12)));
  assert.deepEqual(Buffer.concat(received), Buffer.concat(Array(20).fill(expected)));
});

test('Planning Center follows future pages through the current plan, then skips older history', async () => {
  const now = Date.now();
  const plan = (id, days) => ({ id, attributes: { sort_date: new Date(now + days * 86400000).toISOString() } });
  const pages = [
    { data: Array.from({ length: 25 }, (_, i) => plan(`future-${i}`, 100 - i)), links: { next: 'https://api.planningcenteronline.com/page2' } },
    { data: [plan('tomorrow', 1), plan('current', -0.01)], links: { next: 'https://api.planningcenteronline.com/old-history' } },
    // 'current' is the closest-by-distance pick AND a past-dated one, so
    // nextPlan() checks its PlanTimes before trusting it — empty here means
    // a plain single-service plan, so it falls through to 'current' unchanged.
    { data: [] }
  ];
  let requests = 0;
  const context = vm.createContext({
    module: { exports: {} }, Buffer, AbortController, setTimeout, clearTimeout,
    fetch: async () => {
      const page = pages[requests++];
      assert(page, 'past history should not be requested');
      return { ok: true, text: async () => JSON.stringify(page) };
    }
  });
  vm.runInContext(read('pco-client.js'), context);
  const selected = await context.module.exports.nextPlan('service', { appId: 'test', secret: 'test' });
  assert.equal(selected.id, 'current');
  assert.equal(requests, 3);
});

test('dLive with push listening off still accepts replies to its own send-level requests', () => {
  const h = backend('dlive'), ws = h.socket();
  h.run('serverCfg.dliveListenSendLevels = false');
  const reply = { midiCh: 0, ch: 0, sndMidiCh: 2, sndCh: 0, db: -7 };
  const levels = () => ws.messages.filter(m => m.address === levelAddress(1));
  h.client.emit('sendLevel', reply);
  assert.equal(levels().length, 0, 'an unsolicited push is ignored when listening is off');
  h.run('requestSendLevel(1, 1, channelCoord(0, 1), auxCoord(0, 1))');
  h.client.emit('sendLevel', reply);
  assert.deepEqual(levels().map(m => m.args[0]), [-7], 'the reply to a poll/mute request is used');
  h.client.emit('sendLevel', reply);
  assert.equal(levels().length, 1, 'one request accepts one reply, not every later push');
});

test('a phone message that makes a backend throw is logged, not thrown out of the socket handler', () => {
  for (const family of ['dlive', 'klang', 'wing']) {
    const h = backend(family), ws = h.socket();
    for (const name of ['setSendLevel', 'setGain']) h.client[name] = () => { throw new Error('boom'); };
    assert.doesNotThrow(() => ws.sendMessage({ address: levelAddress(1), args: [-12] }), `${family} let the error escape`);
  }
});

test('KLANG and WING clamp direct fader/pan values and ignore out-of-range channels and auxes', () => {
  for (const family of ['klang', 'wing']) {
    const h = backend(family), ws = h.socket();
    const levelWrite = () => h.client.writes.filter(w => w[0] === 'gain' || w[0] === 'level').at(-1);
    ws.emit('message', '{"address":"/Input_Channels/1/Aux_Send/1/send_level","args":[1e999]}');
    assert.equal(levelWrite(), undefined, `${family}: Infinity must never reach the console`);
    ws.sendMessage({ address: levelAddress(1), args: [50] });
    assert.equal(levelWrite().at(-1), 10, `${family}: +50 dB is clamped to +10`);
    const before = h.client.writes.length;
    ws.sendMessage({ address: '/Input_Channels/99/Aux_Send/1/send_level', args: [-6] });
    ws.sendMessage({ address: '/Input_Channels/1/Aux_Send/99/send_level', args: [-6] });
    assert.equal(h.client.writes.length, before, `${family}: channel/aux beyond the configured counts are ignored`);
  }
});

test('the KLANG client turns a value its encoder rejects into a failed send instead of throwing', () => {
  const { KlangClient } = require('../src/server/klang-client');
  const client = new KlangClient({ host: '127.0.0.1' });
  client.ready = true;
  client._udp = { send() {} };
  assert.doesNotThrow(() => assert.equal(client.setGain(1, 1, Infinity), false));
});

test('WING notices the console coming up after JPMixer, and dropping later', async () => {
  const h = backend('wing');
  const reports = [];
  h.api.setConsoleStatusCallback(alive => reports.push(alive));
  let alive = false;
  h.client.checkConnected = async () => alive;
  h.client.getChannelName = async () => 'Kick';
  await h.run('checkLiveness(wing, true)');      // JPMixer started first: no reply
  await h.run('checkLiveness(wing, false)');     // still down: nothing new to report
  alive = true;
  await h.run('checkLiveness(wing, false)');     // the WING finished booting
  alive = false;
  await h.run('checkLiveness(wing, false)');     // cable pulled
  assert.deepEqual(reports, [false, true, false]);
  assert.equal(h.api.isConsoleConnected(), false);
});

for (const family of ['dlive', 'klang', 'wing']) {
  test(`${family}: a Settings save applies live, without dropping phones or the console`, () => {
    const h = backend(family), ws = h.socket();
    ws.sendMessage({ type: 'set-mute', aux: 1, ch: 2, muted: true });
    ws.messages.length = 0;
    h.api.applyConfigLive({ serverPort: 0, deskIp: '127.0.0.1', klangIp: '127.0.0.1', channels: 2, auxes: 1, sceneRecallEnabled: false, auxOverrides: { 1: { label: 'Vocals' } } });
    const update = ws.messages.find(m => m.config);
    assert.equal(update.config.liveUpdate, true);
    assert.equal(update.config.aux[0].label, 'Vocals');
    assert.equal(update.config.sceneRecallEnabled, false);
    assert.equal(update.config.mutes[1][2], true, 'a phone’s mute survives the save');
    assert.equal(ws.readyState, 1);
    assert(!h.client.disconnected, 'the console connection stays up');
  });
}

for (const family of ['dlive', 'klang', 'wing']) {
  test(`${family}: channels come out grouped and ordered, with each group's name on its first channel`, () => {
    const h = backend(family), ws = h.socket();
    h.api.applyConfigLive({ channels: 3, auxes: 1, channelGroups: [{ id: 'b', name: 'Band' }, { id: 'v', name: 'Vocals' }],
      channelOverrides: { 1: { groupId: 'v', label: 'Lead' }, 2: { groupId: 'b', order: 5 }, 3: { groupId: 'b', order: 1, enabled: false } } });
    const channels = ws.messages.filter(m => m.config).at(-1).config.channels;
    assert.deepEqual(channels.map(c => [c.channel, c.title, c.order, c.enabled]), [[3, 'Band', 0, false], [2, '', 1, true], [1, 'Vocals', 2, true]]);
    assert.equal(channels[2].label, 'Lead');
    assert.deepEqual(channels.map(c => c.group), ['Band', 'Band', 'Vocals'], 'every channel carries its group for the phone filter');
  });
}

for (const family of ['dlive', 'klang', 'wing']) {
  test(`${family}: a mix's assigned channel groups reach phones by name; a removed group drops out`, () => {
    const h = backend(family), ws = h.socket();
    h.api.applyConfigLive({ channels: 2, auxes: 1, channelGroups: [{ id: 7, name: 'Drums' }, { id: 'v', name: 'Vocals' }], auxOverrides: { 1: { groups: [7, 'gone', 'v'] } } });
    assert.deepEqual([...ws.messages.filter(m => m.config).at(-1).config.aux[0].groups], ['Drums', 'Vocals']);
    h.api.applyConfigLive({ channels: 2, auxes: 1, channelGroups: [{ id: 7, name: 'Drums' }], auxOverrides: {} });
    assert.deepEqual([...ws.messages.filter(m => m.config).at(-1).config.aux[0].groups], [], 'no groups picked: phones show everything');
  });
}

for (const family of ['dlive', 'klang', 'wing']) {
  test(`${family}: phones are told when Ear Scenes are hidden in Settings`, () => {
    const h = backend(family), ws = h.socket();
    assert.equal(ws.messages.filter(m => m.config).at(-1).config.earScenes, true, 'shown unless turned off');
    h.api.applyConfigLive({ channels: 2, auxes: 1, performerEarScenes: false });
    assert.equal(ws.messages.filter(m => m.config).at(-1).config.earScenes, false);
  });
}

test('dLive re-sends every phone mute when the console reconnects', () => {
  const h = backend('dlive'), ws = h.socket();
  ws.sendMessage({ address: levelAddress(2), args: [-9] });
  ws.sendMessage({ type: 'set-mute', aux: 1, ch: 2, muted: true });
  h.client.writes.length = 0;
  h.client.emit('close');
  h.client.emit('connect');
  h.drain();
  const silenced = h.client.writes.filter(w => w[0] === 'level' && w.at(-1) === -Infinity);
  assert.equal(silenced.length, 1, 'the muted send goes back to -∞ after a reconnect');
});

test('WING switches silenced sends off again when the console comes back', async () => {
  const h = backend('wing'), ws = h.socket();
  h.client.getChannelName = async () => 'Kick';
  let alive = true;
  h.client.checkConnected = async () => alive;
  ws.sendMessage({ type: 'set-mute', aux: 1, ch: 2, muted: true });
  await settle(h);
  assert.deepEqual(h.client.writes, [['on', 2, 1, false]]);
  await h.run('checkLiveness(wing, true)');
  h.client.writes.length = 0;
  alive = false; await h.run('checkLiveness(wing, false)');
  alive = true;  await h.run('checkLiveness(wing, false)');
  h.drain();
  assert.deepEqual(h.client.writes.filter(w => w[0] === 'on'), [['on', 2, 1, false]], 'the mute is re-applied on regain');
});

test('KLANG reports reachability from a ping and re-sends mutes when the processor comes back', async () => {
  const h = backend('klang'), ws = h.socket();
  const reports = [];
  h.api.setConsoleStatusCallback(alive => reports.push(alive));
  h.run('globalThis.pingAlive = false; pingHost = async () => globalThis.pingAlive');
  ws.sendMessage({ type: 'set-mute', aux: 1, ch: 2, muted: true });
  h.client.writes.length = 0;
  await h.run('checkReachable(true)');
  assert.equal(h.api.isConsoleConnected(), false, 'a bound socket alone is not "connected" any more');
  h.run('globalThis.pingAlive = true');
  await h.run('checkReachable(false)');
  h.drain();
  assert.deepEqual(reports, [false, true]);
  assert.deepEqual(h.client.writes, [['mute', 1, 2, true]], 'the phone mute is sent again once the processor answers');
});
