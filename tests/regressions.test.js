'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const quiet = { log() {}, warn() {}, error() {} };

function fakeClock() {
  let now = 0;
  const timers = new Set();
  const add = (fn, ms, repeat) => {
    const timer = { fn, ms, repeat, due: now + ms };
    timers.add(timer);
    return timer;
  };
  return {
    setTimeout: (fn, ms) => add(fn, ms, false),
    setInterval: (fn, ms) => add(fn, ms, true),
    clearTimeout: timer => timers.delete(timer),
    clearInterval: timer => timers.delete(timer),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].filter(t => t.due <= end).sort((a, b) => a.due - b.due)[0];
        if (!next) break;
        now = next.due;
        if (next.repeat) next.due += next.ms;
        else timers.delete(next);
        next.fn();
      }
      now = end;
    }
  };
}

function presetStore() {
  let fail = false;
  const files = new Map();
  const context = vm.createContext({
    module: { exports: {} }, console: quiet,
    require: name => {
      if (name === 'electron') return { app: { getPath: () => '/review-data' } };
      if (name === './safe-write') return {
        loadJsonObject: () => null,
        writeFileAtomic(file, data) {
          if (fail) throw new Error('ENOSPC');
          files.set(file, data);
        }
      };
      return name.startsWith('./') ? require(path.join(root, 'src/server', name)) : require(name);
    }
  });
  vm.runInContext(read('src/server/presets.js'), context);
  return { api: context.module.exports, files, fail: value => { fail = value; } };
}

function serverHarness() {
  const clock = fakeClock();
  const store = presetStore();
  const ports = [];
  let socketServer;
  class UDP extends EventEmitter {
    constructor() { super(); this.sent = []; ports.push(this); }
    send(message) { this.sent.push(message); }
    open() { this.emit('ready'); }
    close() {}
  }
  class SocketServer extends EventEmitter {
    constructor() { super(); this.clients = new Set(); socketServer = this; }
    close() {}
  }
  const httpServer = new EventEmitter();
  httpServer.listen = () => {};
  httpServer.close = () => {};
  const express = () => ({ use() {}, get() {}, post() {} });
  express.static = () => {};
  const scenes = { A: { 1: { 1: 0.6 } }, B: { 1: { 1: 0.3 } } };
  const mocks = {
    express, http: { createServer: () => httpServer },
    ws: { Server: SocketServer, OPEN: 1 }, osc: { UDPPort: UDP },
    electron: { app: { getPath: () => '/review-data' } },
    fs: { mkdirSync() {}, statSync: () => ({ size: 0 }), appendFileSync() {} },
    './presets': store.api,
    './config': { get: () => undefined, getAll: () => ({}), updateOverride() {} },
    './greenroom': { mountGreenRoom() {} },
    './scenes': {
      getAll: () => scenes, getScene: (name, aux) => scenes[name]?.[aux],
      saveScene(name, aux, values) { (scenes[name] ||= {})[aux] = values; },
      deleteScene(name, aux) { delete scenes[name]?.[aux]; }
    }
  };
  // shared-handlers.js must see the same mocked preset store and ws as the server
  const sharedContext = vm.createContext({ module: { exports: {} }, require: name => mocks[name] || require(name) });
  vm.runInContext(read('src/server/shared-handlers.js'), sharedContext);
  mocks['./shared-handlers'] = sharedContext.module.exports;
  const context = vm.createContext({
    ...clock, Buffer, console: quiet, module: { exports: {} },
    __dirname: path.join(root, 'src/server'),
    require: name => mocks[name] || require(name)
  });
  vm.runInContext(read('src/server/osc-server.js'), context);
  const run = code => vm.runInContext(code, context);
  const cfg = {
    deskIp: '192.0.2.1', deskSendPort: 8000, deskListenPort: 8001,
    serverPort: 0, channels: 2, auxes: 1, sceneRecallEnabled: true
  };
  context.cfg = cfg;
  run('start(cfg); loaded = true; startWebSocketServer()');
  const socket = new EventEmitter();
  socket.readyState = 1;
  socket.sent = [];
  socket.send = payload => socket.sent.push(JSON.parse(payload));
  socket.terminate = () => { socket.readyState = 3; };
  socketServer.clients.add(socket);
  socketServer.emit('connection', socket);
  return {
    clock, store, socket, ports, run,
    send: message => socket.emit('message', JSON.stringify(message)),
    echo: message => ports.at(-1).emit('message', message, null, { address: cfg.deskIp }),
    cached: address => run(`cache.get(${JSON.stringify(address)})?.args[0]`)
  };
}

const level = ch => `/Input_Channels/${ch}/Aux_Send/1/send_level`;

test('mute echoes preserve logical levels for cache responses and unmute', () => {
  const h = serverHarness();
  h.echo({ address: level(1), args: [-12] });
  h.send({ type: 'set-mute', aux: 1, ch: 1, muted: true });
  h.clock.advance(10);
  assert.equal(h.ports[0].sent.at(-1).args[0], -150);
  h.echo({ address: level(1), args: [-150] });
  assert.equal(h.cached(level(1)), -12);
  h.send({ type: 'request-aux-levels', aux: 1 });
  assert.equal(h.socket.sent.at(-1).args[0], -12);
  h.send({ address: level(1), args: [-9] });
  h.echo({ address: level(1), args: [-150] });
  assert.equal(h.cached(level(1)), -9);
  h.send({ type: 'set-mute', aux: 1, ch: 1, muted: false });
  h.clock.advance(10);
  assert.equal(h.ports[0].sent.at(-1).args[0], -9);
});

test('solo silences channels as their first values arrive and restores them', () => {
  const h = serverHarness();
  h.echo({ address: level(1), args: [-12] });
  h.send({ type: 'set-solo', aux: 1, ch: 1, soloed: true });
  h.clock.advance(10);
  h.echo({ address: level(2), args: [-6] });
  h.clock.advance(10);
  assert.equal(h.ports[0].sent.at(-1).address, level(2));
  assert.equal(h.ports[0].sent.at(-1).args[0], -150);
  h.echo({ address: level(2), args: [-150] });
  assert.equal(h.cached(level(2)), -6);
  h.send({ type: 'set-solo', aux: 1, ch: 1, soloed: false });
  h.clock.advance(10);
  assert.equal(h.ports[0].sent.at(-1).args[0], -6);
});

test('cold queries are deduplicated and paced alongside EQ and cache priming', () => {
  const h = serverHarness();
  const before = h.ports[0].sent.length;
  // The harness console has 2 channels — 1.8.0 rejects queries for channels
  // that don't exist, so only those two count (each sent twice → queued once)
  for (let ch = 1; ch <= 2; ch++) {
    h.send({ address: `${level(ch)}/?`, args: [] });
    h.send({ address: `${level(ch)}/?`, args: [] });
  }
  h.send({ type: 'request-aux-eq', aux: 1 });
  h.run('primeCache()');
  assert.equal(h.ports[0].sent.length, before);
  h.clock.advance(99);
  assert.equal(h.ports[0].sent.length, before);
  h.clock.advance(1);
  assert.equal(h.ports[0].sent.length, before + 1);
  // 2 levels + 25 EQ params, minus the 1 just sent — all performer-initiated,
  // so they wait in the urgent lane ahead of background polling/priming
  assert.equal(h.run('deskQueryUrgent.length + deskQueryQueue.length'), 26);
  assert.equal(h.run('deskQueryQueue.length'), 0);
  h.clock.advance(100);
  assert.equal(h.ports[0].sent.length, before + 2);
});

test('background priming and browser queries share the final queue tick', () => {
  const h = serverHarness();
  const before = h.ports[0].sent.length;
  h.send({ address: `${level(1)}/?`, args: [] });
  h.run('cachePrimeInterval = setInterval(primeCache, 100)');
  h.clock.advance(100);
  assert.equal(h.ports[0].sent.length, before + 1);
  h.clock.advance(100);
  assert.equal(h.ports[0].sent.length, before + 2);
});

test('rapid snapshot changes recall only the latest snapshot once', () => {
  const h = serverHarness();
  h.echo({ address: '/Snapshots/Current_Snapshot', args: [1] });
  h.echo({ address: '/Snapshots/name', args: [1, 'A'] });
  h.clock.advance(100);
  h.echo({ address: '/Snapshots/Current_Snapshot', args: [2] });
  h.echo({ address: '/Snapshots/name', args: [2, 'B'] });
  h.clock.advance(200);
  assert.equal(h.run('deskSetQueue.size'), 0);
  h.clock.advance(100);
  assert.equal(h.cached(level(1)), h.run('sliderToDb(0.3)'));
  assert.equal(h.socket.sent.filter(m => m.type === 'scene-recalled').length, 1);
});

test('stop and session change cancel pending scene recalls and metadata retries', () => {
  for (const sessionChange of [false, true]) {
    const h = serverHarness();
    h.echo({ address: '/Snapshots/Current_Snapshot', args: [1] });
    h.echo({ address: '/Snapshots/name', args: [1, 'A'] });
    if (sessionChange) {
      h.echo({ address: '/Console/Session/!', args: [] });
      // Old snapshot packets can still arrive during the 500ms debounce.
      h.echo({ address: '/Snapshots/Current_Snapshot', args: [1] });
      h.echo({ address: '/Snapshots/name', args: [1, 'A'] });
    } else h.run('stop(); start(cfg); loaded = true; startWebSocketServer()');
    h.clock.advance(400);
    assert.equal(h.run('deskSetQueue.size'), 0);
    assert.equal(h.socket.sent.filter(m => m.type === 'scene-recalled').length, 0);
    h.run('stop()');
    const sent = h.ports.at(-1).sent.length;
    h.clock.advance(10000);
    assert.equal(h.ports.at(-1).sent.length, sent);
  }
});

test('disk failures retain old presets, withhold sync acknowledgements, and allow retries', () => {
  const h = serverHarness();
  const save = { type: 'save-preset', deviceId: 'phone', name: 'Mix', levels: { 1: 0.6 }, seq: 1 };
  h.store.fail(true);
  h.send(save);
  assert.equal(h.socket.sent.at(-1).type, 'preset-sync-error');
  assert.equal(h.store.api.getPreset('phone', 'Mix'), null);
  h.store.fail(false);
  h.send(save);
  assert.equal(h.socket.sent.at(-1).type, 'preset-synced');
  assert.equal(h.store.api.getPreset('phone', 'Mix').levels[1], 0.6);
  h.store.fail(true);
  h.send({ ...save, levels: { 1: 0.2 }, seq: 2 });
  assert.equal(h.socket.sent.at(-1).type, 'preset-sync-error');
  assert.equal(h.store.api.getPreset('phone', 'Mix').levels[1], 0.6);
  h.send({ type: 'delete-preset', deviceId: 'phone', name: 'Mix', seq: 3 });
  assert.equal(h.socket.sent.at(-1).type, 'preset-sync-error');
  assert(h.store.api.getPreset('phone', 'Mix'));
  h.store.fail(false);
  h.send({ type: 'delete-preset', deviceId: 'phone', name: 'Mix', seq: 3 });
  assert.equal(h.socket.sent.at(-1).type, 'preset-synced');
  assert.equal(h.store.api.getPreset('phone', 'Mix'), null);
});

test('monitor tracks preset loads and restored levels before mix boost', () => {
  const sent = [];
  const context = vm.createContext({ console: quiet, WebSocket: { OPEN: 1 }, record: message => sent.push(JSON.parse(message)) });
  vm.runInContext(read('src/mixer/monitor.js').split('// ── Boot')[0], context);
  vm.runInContext(`
    levels[1] = { 1: 0.2 };
    onMessage({ type: 'preset-loaded', aux: 1, levels: { 1: 0.8 } });
  `, context);
  assert.equal(vm.runInContext('levels[1][1]', context), 0.8);
  vm.runInContext(`
    ws = { readyState: 1, send: record };
    chConfig = [{ channel: 1, enabled: true }];
    boostAux(1, 0.5);
  `, context);
  assert.equal(sent.at(-1).args[0], vm.runInContext('sliderToDb(0.8) + 0.5', context));
  vm.runInContext(`onMessage({ type: 'mute-solo-state', aux: 1, mutes: {}, solos: {}, levels: { 1: -6 } })`, context);
  assert.equal(vm.runInContext('levels[1][1]', context), vm.runInContext('dbToSlider(-6)', context));
});

test('browser retains failed sync entries, retries, and clears only matching acknowledgements', () => {
  const clock = fakeClock();
  let retries = 0, saved = 0;
  const context = vm.createContext({
    ...clock, pendingSync: { Mix: { op: 'save', seq: 2 } },
    presetSyncRetryTimer: null, presetSyncErrorShown: false,
    resetHeartbeat() {}, showToast() {}, flushPresetSync() { retries++; },
    savePendingSync() { saved++; }
  });
  const source = read('src/mixer/mixer.js');
  vm.runInContext(source.slice(source.indexOf('function onMessage(e)'), source.indexOf('// ── Apply config')), context);
  const send = message => {
    context.event = { data: JSON.stringify(message) };
    vm.runInContext('onMessage(event)', context);
  };
  send({ type: 'preset-sync-error', name: 'Mix', seq: 2 });
  assert(context.pendingSync.Mix);
  clock.advance(5000);
  assert.equal(retries, 1);
  send({ type: 'preset-synced', name: 'Mix', seq: 1 });
  assert(context.pendingSync.Mix);
  send({ type: 'preset-synced', name: 'Mix', seq: 2 });
  assert.equal(context.pendingSync.Mix, undefined);
  assert.equal(saved, 1);
});

test('existing musician and console controls remain available', () => {
  const h = serverHarness();
  for (const message of [
    { address: level(1), args: [-9] },
    { address: '/Input_Channels/1/Aux_Send/1/send_pan', args: [0.7] },
    { address: '/Aux_Outputs/1/EQ/eq_gain_1', args: [2] },
    { type: 'console-fader', ch: 1, db: -3 },
    { type: 'console-mute', ch: 1, muted: true },
    { type: 'console-solo', ch: 1, soloed: true },
    { type: 'aux-fader', aux: 1, db: -2 },
    { type: 'aux-mute', aux: 1, muted: true },
    { type: 'cg-fader', cg: 1, db: -1 },
    { type: 'cg-mute', cg: 1, muted: true },
    { type: 'cg-solo', cg: 1, soloed: true },
    { type: 'fire-snapshot', action: 'next' }
  ]) {
    const before = h.ports[0].sent.length;
    h.send(message);
    assert.equal(h.ports[0].sent.length, before + 1);
  }
  h.send({ type: 'save-scene', aux: 1, snapshot: 'A', values: { 1: 0.5 } });
  assert(h.socket.sent.some(m => m.type === 'scene-saved'));
  h.send({ type: 'apply-preset', aux: 1, name: 'Mix', levels: { 1: 0.7 }, pans: { 1: 0.6 } });
  assert.equal(h.socket.sent.at(-1).type, 'preset-loaded');
  h.clock.advance(10);
  assert.equal(h.cached(level(1)), h.run('sliderToDb(0.7)'));
});

// ── Code-review fixes for 1.8.0 ────────────────────────────────────────────

test('stop sends an unmute restore that was still queued instead of leaving the desk at -150', () => {
  const h = serverHarness();
  h.echo({ address: level(1), args: [-12] });
  h.send({ type: 'set-mute', aux: 1, ch: 1, muted: true });
  h.clock.advance(10);
  assert.equal(h.ports[0].sent.at(-1).args[0], -150);
  h.send({ type: 'set-mute', aux: 1, ch: 1, muted: false }); // restore queued, not sent yet
  h.run('stop()');
  const last = h.ports[0].sent.filter(m => m.address === level(1)).at(-1);
  assert.equal(last.args[0], -12);
});

test('a mute goes out ahead of a queued Ear Scene recall', () => {
  const h = serverHarness();
  h.echo({ address: level(1), args: [-12] });
  h.run(`for (let i = 0; i < 200; i++) sendToDeskPaced('/recall/' + i, [0])`);
  const mark = h.ports[0].sent.length;
  h.send({ type: 'set-mute', aux: 1, ch: 1, muted: true });
  h.clock.advance(10);
  const firstTick = h.ports[0].sent.slice(mark);
  assert.equal(firstTick[0].address, level(1));
  assert.equal(firstTick[0].args[0], -150);
});

test('a mute writes only silenced channels, not the whole mix', () => {
  const h = serverHarness();
  h.echo({ address: level(1), args: [-12] });
  h.echo({ address: level(2), args: [-6] });
  const mark = h.ports[0].sent.length;
  h.send({ type: 'set-mute', aux: 1, ch: 1, muted: true });
  h.clock.advance(100);
  assert.deepEqual(h.ports[0].sent.slice(mark).map(m => [m.address, m.args[0]]), [[level(1), -150]]);
});

test('every mute/solo change re-asserts -150 on channels already silenced', () => {
  const h = serverHarness();
  h.echo({ address: level(1), args: [-12] });
  h.echo({ address: level(2), args: [-6] });
  h.send({ type: 'set-mute', aux: 1, ch: 1, muted: true });
  h.clock.advance(100);
  const mark = h.ports[0].sent.length; // suppose that -150 was lost on the network
  h.send({ type: 'set-mute', aux: 1, ch: 2, muted: true });
  h.clock.advance(100);
  const sent = h.ports[0].sent.slice(mark).map(m => [m.address, m.args[0]]);
  assert.deepEqual(sent.sort(), [[level(1), -150], [level(2), -150]].sort());
});

test('a performer query goes ahead of background polling', () => {
  const h = serverHarness();
  h.run(`queueDeskQueries(['/background/1/?', '/background/2/?', '/background/3/?'])`);
  h.send({ address: `${level(2)}/?`, args: [] });
  h.clock.advance(100);
  assert.equal(h.ports[0].sent.at(-1).address, `${level(2)}/?`);
  h.clock.advance(100);
  assert.equal(h.ports[0].sent.at(-1).address, '/background/1/?');
});

test('merge and set-name roll back when the disk write fails', () => {
  const store = presetStore();
  const p = store.api;
  p.savePreset('old', 'Sunday', { 1: 0.5 }, {});
  p.savePreset('new', 'Rehearsal', { 1: 0.2 }, {});
  store.fail(true);
  assert.equal(p.mergeDevices('old', 'new').ok, false);
  assert.equal(p.getByDevice('old').Sunday.levels[1], 0.5, 'source group still there');
  assert.equal(p.getByDevice('new').Sunday, undefined, 'target unchanged');
  assert.equal(p.resolve('old'), 'old', 'no alias left behind');
  assert.equal(p.setOwner('new', 'Travis').ok, false);
  assert.equal(p.getByDevice('new').Rehearsal.owner, undefined);
  store.fail(false);
  assert.equal(p.mergeDevices('old', 'new').ok, true);
  assert.equal(p.getByDevice('old').Sunday.levels[1], 0.5, 'old id now reads the merged group');
});

// ── Second review pass ─────────────────────────────────────────────────────

test('iPads are relayed the real desk value (-150) for a muted channel, browsers the logical level', () => {
  const h = serverHarness();
  h.run(`ipadPorts.set('192.0.2.9', { ip: '192.0.2.9', sendPort: 9000, name: 'iPad' })`);
  h.echo({ address: level(1), args: [-12] });
  h.send({ type: 'set-mute', aux: 1, ch: 1, muted: true });
  h.clock.advance(10);
  const mark = h.ports[0].sent.length;
  h.echo({ address: level(1), args: [-150] });
  const toIpad = h.ports[0].sent.slice(mark).find(m => m.address === level(1));
  assert.equal(toIpad.args[0], -150);
  assert.equal(h.cached(level(1)), -12);
});

test('importing a backup without aliases clears merge aliases', () => {
  const store = presetStore();
  const p = store.api;
  p.savePreset('A', 'Sunday', { 1: 0.5 }, {});
  p.savePreset('B', 'Rehearsal', { 1: 0.2 }, {});
  assert.equal(p.mergeDevices('A', 'B').ok, true);
  p.replaceAll({ A: { Sunday: { levels: { 1: 0.5 }, pans: {} } }, B: { Rehearsal: { levels: { 1: 0.2 }, pans: {} } } }); // v1: no aliases
  assert.equal(p.resolve('A'), 'A');
  assert.equal(p.getByDevice('A').Sunday.levels[1], 0.5);
});

test('relabeling a channel updates the server config and tells pages, without a restart', () => {
  const h = serverHarness();
  assert.equal(h.run(`setChannelLabel(2, 'Bass DI')`), true);
  assert.deepEqual(h.socket.sent.at(-1), { type: 'channel-relabeled', channel: 2, label: 'Bass DI' });
  assert.equal(h.run(`serverCfg.channelOverrides['2'].label`), 'Bass DI');
  assert.equal(h.run(`setChannelLabel(99, 'nope')`), false, 'out-of-range channel rejected');
  assert.equal(h.run(`setAuxLabel(1, 'Drums')`), true);
  assert.deepEqual(h.socket.sent.at(-1), { type: 'aux-relabeled', aux: 1, label: 'Drums' });
});

// ── Found against the DiGiCo offline editor ───────────────────────────────

test('priming never re-sends a query that is still awaiting its reply', () => {
  const h = serverHarness();
  const mark = h.ports[0].sent.length;
  h.run('cachePrimeInterval = setInterval(primeCache, 100)');
  h.clock.advance(1000); // no replies at all — over a real network they take a while
  const sent = h.ports[0].sent.slice(mark).map(m => m.address);
  const counts = {};
  for (const a of sent) counts[a] = (counts[a] || 0) + 1;
  assert.ok(sent.length > 0);
  assert.deepEqual(Object.values(counts).filter(n => n > 1), [], `re-sent: ${JSON.stringify(counts)}`);
});

test('the startup loader sends each query once even when the desk answers with several messages', () => {
  const h = serverHarness();
  const mark = h.ports[0].sent.length;
  // The harness console has no channel count cached, so the loader's next
  // query is /Console/Channels/? — which the desk answers with 9 messages,
  // each of which re-runs the loader
  h.run(`loaded = false; cache.delete('/Console/Input_Channels');
    for (let i = 0; i < 9; i++) loadNextRequiredParameter();`);
  const sent = h.ports[0].sent.slice(mark).filter(m => m.address === '/Console/Channels/?');
  assert.equal(sent.length, 1);
});
