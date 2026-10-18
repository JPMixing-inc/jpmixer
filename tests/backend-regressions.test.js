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
    disconnect(options) { this.disconnectOptions = options; return Promise.resolve(); }
    setSendLevel(...args) { this.writes.push(['level', ...args]); }
    setGain(...args) { this.writes.push(['gain', ...args]); }
    setSendOn(...args) { this.writes.push(['on', ...args]); }
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
    './greenroom': { mountGreenRoom() {} }, './config': {}, './presets': {},
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
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    require: name => mocks[name] || (name.startsWith('./') ? require(path.join(root, 'src/server', name)) : require(name))
  });
  vm.runInContext(read(`${family}-server.js`), context);
  const run = code => vm.runInContext(code, context);
  run("start({serverPort:0,deskIp:'127.0.0.1',klangIp:'127.0.0.1',channels:2,auxes:1,sceneRecallEnabled:true})");
  function socket() {
    const ws = new EventEmitter();
    ws.readyState = 1;
    ws.messages = [];
    ws.send = payload => ws.messages.push(JSON.parse(payload));
    ws.terminate = () => { ws.readyState = 3; };
    ws.sendMessage = msg => ws.emit('message', JSON.stringify(msg));
    socketServer.clients.add(ws);
    socketServer.emit('connection', ws);
    return ws;
  }
  return { run, socket, client: transports[0], sceneClient: transports.at(-1), api: context.module.exports };
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

test('WING mute and solo cover untouched sends without enabling unrelated sends', () => {
  const h = backend('wing'), ws = h.socket();
  ws.sendMessage({ type: 'set-mute', aux: 1, ch: 2, muted: true });
  assert.deepEqual(h.client.writes, [['on', 2, 1, false]]);
  ws.sendMessage({ type: 'set-mute', aux: 1, ch: 2, muted: false });
  assert.deepEqual(h.client.writes.at(-1), ['on', 2, 1, true]);
  h.client.writes.length = 0;
  ws.sendMessage({ type: 'set-solo', aux: 1, ch: 1, soloed: true });
  assert.deepEqual(h.client.writes, [['on', 2, 1, false]]);
  ws.sendMessage({ address: levelAddress(2), args: [-9] });
  assert(h.run("silencedSends.has('2:1')"));
  ws.sendMessage({ type: 'set-solo', aux: 1, ch: 1, soloed: false });
  assert.deepEqual(h.client.writes.at(-1), ['on', 2, 1, true]);
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
    { data: [plan('tomorrow', 1), plan('current', -0.01)], links: { next: 'https://api.planningcenteronline.com/old-history' } }
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
  assert.equal(requests, 2);
});
