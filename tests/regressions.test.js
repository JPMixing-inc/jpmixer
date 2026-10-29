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
    './performer-assignments': { mountPerformerAssignments() {} },
    './greenroom': { mountGreenRoom() {} },
    './branding': { mountBranding() {} },
    './digico-channel': require('../src/server/digico-channel'),
    './foh': { mountFoh() {} },
    './access': { mountOneTimeLinks() {}, noteSocket() {}, consoleMessageAllowed: () => true, fromThisComputer: () => true }, // no codes set
    './console-names': { remembered: () => undefined }, // no names remembered: what the console sends now
    './scenes': {
      getAll: () => scenes, getScene: (name, aux) => scenes[name]?.[aux],
      saveScene(name, aux, values) { (scenes[name] ||= {})[aux] = values; return true; }, // the real one reports whether it stored
      deleteScene(name, aux) { delete scenes[name]?.[aux]; }
    }
  };
  // shared-handlers.js must see the same mocked preset store and ws as the server
  const sharedContext = vm.createContext({ module: { exports: {} }, require: name => mocks[name] || require(name) });
  vm.runInContext(read('src/server/shared-handlers.js'), sharedContext);
  mocks['./shared-handlers'] = sharedContext.module.exports;
  const context = vm.createContext({
    ...clock, Buffer, console: quiet, module: { exports: {} }, setImmediate,
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
  h.clock.advance(100); // deskSetTimer ticks every 100ms (DESK_SET_TICK_MS), not 10 — see osc-server.js
  assert.equal(h.ports[0].sent.at(-1).args[0], -150);
  h.echo({ address: level(1), args: [-150] });
  assert.equal(h.cached(level(1)), -12);
  h.send({ type: 'request-aux-levels', aux: 1 });
  assert.equal(h.socket.sent.at(-1).args[0], -12);
  h.send({ address: level(1), args: [-9] });
  h.echo({ address: level(1), args: [-150] });
  assert.equal(h.cached(level(1)), -9);
  h.send({ type: 'set-mute', aux: 1, ch: 1, muted: false });
  h.clock.advance(100);
  assert.equal(h.ports[0].sent.at(-1).args[0], -9);
});

test('solo silences channels as their first values arrive and restores them', () => {
  const h = serverHarness();
  h.echo({ address: level(1), args: [-12] });
  h.send({ type: 'set-solo', aux: 1, ch: 1, soloed: true });
  h.clock.advance(100); // deskSetTimer ticks every 100ms (DESK_SET_TICK_MS), not 10 — see osc-server.js
  h.echo({ address: level(2), args: [-6] });
  h.clock.advance(100);
  assert.equal(h.ports[0].sent.at(-1).address, level(2));
  assert.equal(h.ports[0].sent.at(-1).args[0], -150);
  h.echo({ address: level(2), args: [-150] });
  assert.equal(h.cached(level(2)), -6);
  h.send({ type: 'set-solo', aux: 1, ch: 1, soloed: false });
  h.clock.advance(100);
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

test('monitor boost skips channels whose level has not loaded, and a session reload forgets old levels', () => {
  const sent = [];
  const context = vm.createContext({ console: quiet, WebSocket: { OPEN: 1 }, record: message => sent.push(JSON.parse(message)) });
  vm.runInContext(read('src/mixer/monitor.js').split('// ── Boot')[0], context);
  vm.runInContext(`
    ws = { readyState: 1, send: record };
    chConfig = [{ channel: 1, enabled: true }, { channel: 2, enabled: true }];
    levels[1] = { 1: 0.8 };
    boostAux(1, 0.5);
  `, context);
  assert.deepEqual(sent.map(m => m.address), ['/Input_Channels/1/Aux_Send/1/send_level'],
    'channel 2 has no known level yet and must not be sent to -89.5 dB');
  vm.runInContext('applyConfig = () => {}; onMessage({ config: { sessionReload: true } })', context);
  assert.equal(vm.runInContext('Object.keys(levels).length', context), 0);
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
  h.clock.advance(100); // deskSetTimer ticks every 100ms (DESK_SET_TICK_MS), not 10 — see osc-server.js
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
  h.clock.advance(100); // deskSetTimer ticks every 100ms (DESK_SET_TICK_MS), not 10 — see osc-server.js
  const firstTick = h.ports[0].sent.slice(mark);
  assert.equal(firstTick[0].address, level(1));
  assert.equal(firstTick[0].args[0], -150);
});

test('muting a send whose level has not been read asks the desk for it, then silences it', () => {
  // Skipped before: every phone showed the channel muted while it stayed audible
  const h = serverHarness();
  const mark = h.ports[0].sent.length;
  h.send({ type: 'set-mute', aux: 1, ch: 1, muted: true });
  h.clock.advance(300);
  assert(h.ports[0].sent.slice(mark).some(m => m.address === `${level(1)}/?`), 'the level is asked for');
  assert(!h.ports[0].sent.slice(mark).some(m => m.address === level(2) || m.address === `${level(2)}/?`), 'an audible channel is left alone');
  h.echo({ address: level(1), args: [-12] });
  h.clock.advance(100);
  assert.deepEqual([h.ports[0].sent.at(-1).address, h.ports[0].sent.at(-1).args[0]], [level(1), -150]);
  assert.equal(h.cached(level(1)), -12, 'the real level is kept for the unmute');
  h.send({ type: 'set-mute', aux: 1, ch: 1, muted: false });
  h.clock.advance(100);
  assert.deepEqual([h.ports[0].sent.at(-1).address, h.ports[0].sent.at(-1).args[0]], [level(1), -12]);
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
  // Two distinct addresses now queued (ch1's re-assert + ch2's new mute) —
  // DESK_SET_BATCH is 1 per tick (see osc-server.js), so draining both needs
  // two ticks, not one.
  h.clock.advance(200);
  const sent = h.ports[0].sent.slice(mark).map(m => [m.address, m.args[0]]);
  assert.deepEqual(sent.sort(), [[level(1), -150], [level(2), -150]].sort());
});

test('a solo silences every other channel at once, not one per 100 ms', () => {
  const h = serverHarness();
  // The harness console has 2 channels; give it a full band's worth of sends
  h.run(`cache.set('/Console/Input_Channels', { address: '/Console/Input_Channels', args: [24] })`);
  for (let ch = 1; ch <= 24; ch++) h.echo({ address: `/Input_Channels/${ch}/Aux_Send/1/send_level`, args: [-10] });
  const mark = h.ports[0].sent.length;
  h.send({ type: 'set-solo', aux: 1, ch: 5, soloed: true });
  // No clock advance: everything must already be on its way to the desk
  const silenced = h.ports[0].sent.slice(mark).filter(m => m.args[0] === -150).map(m => m.address);
  assert.equal(silenced.length, 23, 'all 23 other channels silenced in the same moment');
  assert(!silenced.includes('/Input_Channels/5/Aux_Send/1/send_level'), 'the soloed channel stays audible');
  // Un-solo: the 23 come back at once too
  const mark2 = h.ports[0].sent.length;
  h.send({ type: 'set-solo', aux: 1, ch: 5, soloed: false });
  assert.equal(h.ports[0].sent.slice(mark2).filter(m => m.args[0] === -10).length, 23);
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
  const toIpad = h.ports[0].sent.slice(mark).filter(m => m.address === level(1));
  assert.deepEqual(toIpad.map(m => m.args[0]), [-150], 'exactly one relay, carrying the real value');
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
  // (lastLoadQuery reset: the harness's own startup just sent this query)
  h.run(`loaded = false; cache.delete('/Console/Input_Channels'); lastLoadQuery = null;
    for (let i = 0; i < 9; i++) loadNextRequiredParameter();`);
  const sent = h.ports[0].sent.slice(mark).filter(m => m.address === '/Console/Channels/?');
  assert.equal(sent.length, 1);
});

test('the metadata retry re-asks for what the loader is waiting on, not the console summary', () => {
  const h = serverHarness();
  h.run(`loaded = false; cache.set('/Console/Input_Channels', { address: '/Console/Input_Channels', args: [2] });
    cache.delete('/Console/Aux_Outputs/modes');`);
  const mark = h.ports[0].sent.length;
  h.run('fetchValues()');
  h.clock.advance(3000); // one retry
  const sent = h.ports[0].sent.slice(mark).map(m => m.address);
  assert.ok(!sent.includes('/Console/Channels/?'), sent.join(', '));
  assert.ok(sent.includes('/Console/Aux_Outputs/modes/?'));
});

test('a session change stops querying the old session immediately', () => {
  const h = serverHarness();
  h.run(`queueDeskQueries(['/old/1/?', '/old/2/?']); cachePrimeInterval = setInterval(primeCache, 100)`);
  h.echo({ address: '/Console/Session/!', args: [0] });
  const mark = h.ports[0].sent.length;
  h.clock.advance(400); // still inside the 500ms debounce
  assert.deepEqual(h.ports[0].sent.slice(mark).map(m => m.address), []);
});

test('a malformed packet is ignored instead of stopping the server', () => {
  const h = serverHarness();
  h.ports[0].emit('error', new Error('A malformed type tag string was found while reading the arguments of an OSC message.'));
  assert.equal(h.run('loaded'), true, 'server still running');
  h.ports[0].emit('error', Object.assign(new Error('bind EADDRINUSE 0.0.0.0:9000'), { code: 'EADDRINUSE' }));
  assert.equal(h.run('loaded'), false, 'a real socket failure still stops it');
});

test('an iPad message with no type tag (DiGiCo iPad app) is relayed to the desk', () => {
  const h = serverHarness();
  h.run(`ipadPorts.set('192.0.2.9', { ip: '192.0.2.9', sendPort: 7000, name: 'iPad' })`);
  const mark = h.ports[0].sent.length;
  // Exactly what the iPad app sent: the address, null-padded, nothing after
  const bare = new Uint8Array(Buffer.from('/Console/Name/?\0', 'latin1'));
  h.ports[0].emit('raw', bare, { address: '192.0.2.9', port: 61753 });
  h.ports[0].emit('error', new Error('A malformed type tag string was found while reading the arguments of an OSC message.'));
  const sent = h.ports[0].sent.slice(mark);
  assert.ok(sent.some(m => m.address === '/Console/Name/?'), 'forwarded to the desk');
  assert.equal(h.run('loaded'), true, 'server still running');
});

test('stop sends muted channels\' real levels before closing the socket', async () => {
  const h = serverHarness();
  const events = [];
  const udp = h.ports[0];
  const origSend = udp.send.bind(udp);
  udp.send = (m) => { events.push(['send', m.address, m.args[0]]); origSend(m); };
  udp.close = () => { events.push(['close']); udp.emit('close'); };
  h.echo({ address: level(1), args: [-12] });
  h.send({ type: 'set-mute', aux: 1, ch: 1, muted: true });
  h.clock.advance(10);
  const closed = h.run('stop()');
  assert.ok(!events.some(e => e[0] === 'close'), 'socket must not close in the same tick as the final sends');
  await closed;
  const closeAt = events.findIndex(e => e[0] === 'close');
  const restoreAt = events.findIndex(e => e[1] === level(1) && e[2] === -12);
  assert.ok(restoreAt >= 0 && closeAt > restoreAt, JSON.stringify(events.slice(-4)));
});

// ── iPad relay reliability ────────────────────────────────────────────────

const fromHost = (h, ip, message) => h.ports.at(-1).emit('message', message, null, { address: ip });

test('a session change is relayed to iPads so the app re-syncs', () => {
  const h = serverHarness();
  h.run(`registerIpads({ ipadConnections: [{ id: 1, enabled: true, name: 'iPad', ip: '192.0.2.9', sendPort: 7000 }] })`);
  const mark = h.ports[0].sent.length;
  h.echo({ address: '/Console/Session/!', args: [0] });
  assert.ok(h.ports[0].sent.slice(mark).some(m => m.address === '/Console/Session/!'));
});

test('OSC from an unknown device is ignored, not treated as the desk', () => {
  const h = serverHarness();
  h.echo({ address: level(1), args: [-12] });
  fromHost(h, '192.0.2.77', { address: level(1), args: [5] });
  assert.equal(h.cached(level(1)), -12, 'a stray device must not change what JPMixer thinks the desk holds');
  const st = h.run('getIpadStatus()');
  assert.equal(st.unknownSenders[0].ip, '192.0.2.77');
});

test('an iPad that changed address is followed when it is the only, quiet iPad', () => {
  const h = serverHarness();
  h.run(`registerIpads({ ipadConnections: [{ id: 1, enabled: true, name: 'iPad', ip: '192.0.2.9', sendPort: 7000 }] })`);
  const mark = h.ports[0].sent.length;
  fromHost(h, '192.0.2.50', { address: '/Console/Name/?', args: [] });
  const st = h.run('getIpadStatus()');
  assert.equal(st.ipads[0].ip, '192.0.2.50');
  assert.equal(st.ipads[0].configuredIp, '192.0.2.9');
  assert.ok(h.ports[0].sent.slice(mark).some(m => m.address === '/Console/Name/?'), 'its query reached the desk');
  assert.equal(st.unknownSenders.length, 0);
});

test('iPad changes apply live without dropping the relay', () => {
  const h = serverHarness();
  h.run(`applyConfigLive({ ...serverCfg, ipadConnections: [{ id: 2, enabled: true, name: 'Stage iPad', ip: '192.0.2.10', sendPort: 7000 }] })`);
  assert.equal(h.run('getIpadStatus()').ipads[0].name, 'Stage iPad');
  assert.equal(h.run('loaded'), true);
});

test('live saves preserve a recovered iPad address until its configured IP changes', () => {
  const h = serverHarness();
  h.run(`applyConfigLive({ ...serverCfg, ipadConnections: [{ id: 1, enabled: true, name: 'Pad', ip: '192.0.2.9', sendPort: 7000 }] })`);
  fromHost(h, '192.0.2.50', { address: '/Console/Name/?', args: [] });
  h.run('applyConfigLive({ ...serverCfg })');
  let entry = h.run('getIpadStatus().ipads[0]');
  assert.equal(entry.ip, '192.0.2.50');
  assert.equal(entry.configuredIp, '192.0.2.9');
  assert.equal(entry.messages, 1);
  h.run(`applyConfigLive({ ...serverCfg, ipadConnections: [{ id: 1, enabled: true, name: 'Pad', ip: '192.0.2.60', sendPort: 7000 }] })`);
  entry = h.run('getIpadStatus().ipads[0]');
  assert.equal(entry.ip, '192.0.2.60');
});

test('a send error (e.g. Wi-Fi dropping) does not stop the server', () => {
  const h = serverHarness();
  h.ports[0].emit('error', Object.assign(new Error('send EADDRNOTAVAIL 192.0.2.9:7000'), { code: 'EADDRNOTAVAIL', syscall: 'send' }));
  assert.equal(h.run('loaded'), true);
});

test('a desk channel rename reaches phones as a relabel, and a Settings label still wins', () => {
  const h = serverHarness();
  h.socket.sent = [];
  h.echo({ address: '/Input_Channels/2/Channel_Input/name', args: ['Kick'] });
  const relabels = () => h.socket.sent.filter(m => m.type === 'channel-relabeled');
  assert.deepEqual(relabels().map(m => [m.channel, m.label]), [[2, 'Kick']]);

  h.run("serverCfg.channelOverrides = { '2': { label: 'Drums' } }");
  h.socket.sent = [];
  h.echo({ address: '/Input_Channels/2/Channel_Input/name', args: ['CH 2'] });
  assert.deepEqual(relabels().map(m => [m.channel, m.label]), [[2, 'Drums']]);
});

test('a desk aux rename tells phones the label to show, a Settings label winning, and only when it changes', () => {
  const h = serverHarness();
  const relabels = () => h.socket.sent.filter(m => m.type === 'aux-relabeled').map(m => [m.aux, m.label]);
  h.socket.sent = [];
  h.echo({ address: '/Aux_Outputs/3/Buss_Trim/name', args: ['IEM 3'] });
  assert.deepEqual(relabels(), [[3, 'IEM 3']]);
  h.socket.sent = [];
  h.echo({ address: '/Aux_Outputs/3/Buss_Trim/name', args: ['IEM 3'] }); // re-sent on a snapshot recall
  assert.deepEqual(relabels(), [], 'the same name again is not re-announced');
  h.run("serverCfg.auxOverrides = { '3': { label: 'Vocal 1 - Sam' } }");
  h.echo({ address: '/Aux_Outputs/3/Buss_Trim/name', args: ['AUX 3'] });
  assert.deepEqual(relabels(), [[3, 'Vocal 1 - Sam']], 'the label wins over the desk name');
});

test('a snapshot restoring a muted channel is re-silenced ahead of queued recall writes, and keeps its place', () => {
  const h = serverHarness();
  h.echo({ address: level(1), args: [-12] });
  h.send({ type: 'set-mute', aux: 1, ch: 1, muted: true });
  h.clock.advance(100);
  h.run(`for (let i = 0; i < 200; i++) sendToDeskPaced('/recall/' + i, [0])`);
  // The desk's snapshot change put the muted send back to an audible level
  h.echo({ address: level(1), args: [-3] });
  // ...and a recall then touches the same send with a normal-lane write
  h.run(`sendToDeskPaced(${JSON.stringify(level(1))}, [-150])`);
  const mark = h.ports[0].sent.length;
  h.clock.advance(100);
  const next = h.ports[0].sent.slice(mark)[0];
  assert.deepEqual([next.address, next.args[0]], [level(1), -150]);
});

test('DiGiCo presets use parsed channel numbers and reject out-of-range positions', () => {
  const h = serverHarness();
  h.send({ type: 'apply-preset', aux: 1, name: 'Mix', levels: { '2x': 0.5, 1: -0.5 }, pans: { '2x': 0.3 } });
  h.clock.advance(1000);
  const sent = h.ports[0].sent.map(m => [m.address, m.args[0]]);
  assert(!sent.some(([a]) => a.includes('2x')), 'a raw "2x" key must not reach the desk as an address');
  assert(!sent.some(([a, v]) => a === level(1) && !Number.isFinite(v)), 'a negative position must not send NaN');
  assert(sent.some(([a]) => a === level(2)), 'the "2x" key is read as channel 2');
});

test('phone mixer: a socket replaced by the Safari nudge cannot later close the healthy one', () => {
  const clock = fakeClock();
  const sockets = [];
  class FakeSocket {
    constructor() { this.readyState = 0; this.sent = []; this.closed = false; sockets.push(this); }
    send(m) { this.sent.push(JSON.parse(m)); }
    close() { this.closed = true; this.readyState = 3; }
  }
  FakeSocket.CONNECTING = 0; FakeSocket.OPEN = 1; FakeSocket.CLOSING = 2; FakeSocket.CLOSED = 3;
  const el = () => ({ classList: { add() {}, remove() {} }, textContent: '' });
  const context = vm.createContext({
    ...clock, WebSocket: FakeSocket, JSON, console: quiet,
    document: { location: { host: 'test' }, body: { classList: { add() {}, remove() {}, contains: () => false } }, getElementById: el },
    sessionStorage: { getItem: () => null, setItem() {} },
    deviceId: 'phone', selectedAux: null, flushPresetSync() {}, onMessage() {}
  });
  const source = read('src/mixer/mixer.js');
  vm.runInContext(source.slice(source.indexOf('// ── WebSocket'), source.indexOf('function sendOSC')), context);
  vm.runInContext('startWebsocket()', context);
  clock.advance(2000); // still CONNECTING: the nudge opens a second socket
  const [stuck, healthy] = sockets;
  assert.equal(sockets.length, 2);
  assert.equal(stuck.closed, true, 'the replaced socket is closed');
  assert.equal(stuck.onerror, null, 'and detached, so its late error cannot act');
  healthy.readyState = 1;
  healthy.onopen();
  assert.equal(healthy.closed, false);
  assert.equal(healthy.sent[0].type, 'identify');
  assert.equal(vm.runInContext('ws', context), healthy);
});

test('phone faders: values arriving mid-drag wait, and the latest shows after the hold', () => {
  const clock = fakeClock();
  let now = 0;
  const realAdvance = clock.advance;
  clock.advance = ms => { now += ms; realAdvance(ms); };
  const context = vm.createContext({ ...clock, Date: { now: () => now } });
  const source = read('src/mixer/mixer.js');
  vm.runInContext(source.slice(source.indexOf('const ECHO_HOLD_MS'), source.indexOf('function addFaderOverlay')), context);
  const slider = { value: 0.5 };
  context.slider = slider;
  const echo = v => vm.runInContext(`showWhenReleased(slider, () => { slider.value = ${v}; })`, context);
  echo(0.6);
  assert.equal(slider.value, 0.6, 'not held: shown straight away');
  vm.runInContext('holdSlider(slider)', context);
  slider.value = 0.2; // the musician pulls it down
  echo(0.9);          // a late echo of the louder position
  assert.equal(slider.value, 0.2, 'a late echo must not overwrite the drag');
  vm.runInContext('releaseSlider(slider)', context);
  echo(0.21);         // the desk's echo of the final position
  clock.advance(100);
  assert.equal(slider.value, 0.2, 'still held for a moment after release');
  clock.advance(400);
  assert.equal(slider.value, 0.21, 'then the latest value is shown');
});

test('phone faders: two quick drags are not a double-tap, and each fader follows its own finger', () => {
  const clock = fakeClock();
  let now = 1000;
  const context = vm.createContext({ ...clock, Date: { now: () => now }, sceneLocked: false, hasSavedScene: () => false, showLockedHint() {}, Event: class { constructor(type) { this.type = type; } } });
  const source = read('src/mixer/mixer.js');
  vm.runInContext(source.slice(source.indexOf('const ECHO_HOLD_MS'), source.indexOf('// Double-tap puts the send at unity')), context);
  // A 344 px fader at x 0-344: the thumb's centre is 22 + value * 300
  function fader() {
    const handlers = {};
    const overlay = { style: {}, addEventListener: (type, fn) => { handlers[type] = fn; } };
    const slider = { value: '0.5', min: '0', max: '1', style: {}, parentNode: { style: {}, appendChild() {} },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 344, height: 40 }), dispatchEvent() {} };
    context.document = { createElement: () => overlay, querySelector: () => null };
    let resets = 0;
    context.addFaderOverlay(slider, () => { resets++; }, false);
    const fire = (type, changed, all = changed) => handlers[type]({ changedTouches: changed, touches: type === 'touchend' ? [] : all, preventDefault() {} });
    return { slider, fire, resets: () => resets };
  }
  const t = (id, x, y = 20) => ({ identifier: id, clientX: x, clientY: y });
  context.addFaderOverlay = vm.runInContext('addFaderOverlay', context);

  const a = fader();
  // Pulling a loud channel down in two quick flicks
  a.fire('touchstart', [t(0, 172)]); a.fire('touchmove', [t(0, 140)]); now += 80; a.fire('touchend', [t(0, 140)]);
  now += 100;
  const x = 22 + parseFloat(a.slider.value) * 300;
  a.fire('touchstart', [t(1, x)]); a.fire('touchmove', [t(1, x - 30)]); now += 80; a.fire('touchend', [t(1, x - 30)]);
  assert.equal(a.resets(), 0, 'two drags in a row must not put the fader at 0 dB');
  assert(parseFloat(a.slider.value) < 0.5);
  // A real double tap on the thumb still resets it
  now += 1000;
  const at = 22 + parseFloat(a.slider.value) * 300;
  a.fire('touchstart', [t(2, at)]); now += 60; a.fire('touchend', [t(2, at)]);
  now += 120;
  a.fire('touchstart', [t(3, at)]); now += 60; a.fire('touchend', [t(3, at)]);
  assert.equal(a.resets(), 1, 'a double tap still resets');

  // A thumb already resting on the screen (finger 7) doesn't drive this fader
  const b = fader();
  b.fire('touchstart', [t(8, 172)], [t(7, 600), t(8, 172)]);
  b.fire('touchmove', [t(8, 202)], [t(7, 600), t(8, 202)]);
  assert(Math.abs(parseFloat(b.slider.value) - 0.6) < 1e-9, 'moves with its own finger: +30 px = +0.1');
  b.fire('touchmove', [t(7, 650)], [t(7, 650), t(8, 202)]);
  assert(Math.abs(parseFloat(b.slider.value) - 0.6) < 1e-9, 'another finger moving changes nothing');
  b.fire('touchstart', [t(9, 202)], [t(7, 650), t(8, 202), t(9, 202)]);
  b.fire('touchmove', [t(9, 300)], [t(7, 650), t(8, 202), t(9, 300)]);
  assert(Math.abs(parseFloat(b.slider.value) - 0.6) < 1e-9, 'a second finger on a held fader is ignored');
  b.fire('touchend', [t(9, 300)]);
  b.fire('touchmove', [t(8, 232)], [t(7, 650), t(8, 232)]);
  assert(Math.abs(parseFloat(b.slider.value) - 0.7) < 1e-9, 'and lifting it leaves the first finger in charge');
});

test('monitor faders: values arriving mid-drag wait, and the latest shows after the hold', () => {
  const clock = fakeClock();
  let now = 0;
  const realAdvance = clock.advance;
  clock.advance = ms => { now += ms; realAdvance(ms); };
  const context = vm.createContext({ ...clock, Date: { now: () => now }, console: quiet, WebSocket: { OPEN: 1 } });
  vm.runInContext(read('src/mixer/monitor.js').split('// ── Boot')[0], context);
  const fader = { value: '0.5', style: { setProperty() {} }, setAttribute() {} };
  context.fader = fader;
  vm.runInContext(`
    channelEls.set('1-1', { fader, db: { textContent: '' } });
    fader._resync = () => updateFaderEl(1, 1, levels[1][1]);
  `, context);
  const echo = db => vm.runInContext(`applySendLevel('/Input_Channels/1/Aux_Send/1/send_level', [${db}])`, context);
  const slider = db => vm.runInContext(`dbToSlider(${db})`, context);
  echo(-6);
  assert.equal(fader.value, slider(-6), 'not held: shown straight away');
  vm.runInContext('holdFader(fader)', context);
  fader.value = slider(-30); // the engineer pulls it down
  echo(0);                   // a late echo of the louder position
  assert.equal(fader.value, slider(-30), 'a late echo must not overwrite the drag');
  vm.runInContext('releaseFader(fader)', context);
  echo(-29.5);               // the desk's echo of the final position
  clock.advance(100);
  assert.equal(fader.value, slider(-30), 'still held for a moment after release');
  clock.advance(400);
  assert.equal(fader.value, slider(-29.5), 'then the latest value is shown');
});

test('phone dialogs: the keypress that opens a dialog cannot answer it, and a second dialog cancels the first', async () => {
  const clock = fakeClock();
  const listeners = { document: [] };
  const element = () => {
    const own = [];
    return { style: {}, value: '', textContent: '', focus() {}, select() {},
      addEventListener: (t, fn) => own.push([t, fn]), removeEventListener: (t, fn) => { const i = own.findIndex(([a, b]) => a === t && b === fn); if (i >= 0) own.splice(i, 1); },
      click: () => own.filter(([t]) => t === 'click').forEach(([, fn]) => fn()) };
  };
  const els = { actionDialogInput: element(), actionDialogConfirm: element(), actionDialogCancel: element(), actionDialogTitle: element() };
  const context = vm.createContext({
    ...clock,
    document: {
      body: { classList: { add() {}, remove() {} } },
      getElementById: id => els[id],
      addEventListener: (t, fn) => listeners.document.push([t, fn]),
      removeEventListener: (t, fn) => { const i = listeners.document.findIndex(([a, b]) => a === t && b === fn); if (i >= 0) listeners.document.splice(i, 1); },
    },
  });
  const source = read('src/mixer/mixer.js');
  vm.runInContext(source.slice(source.indexOf('let cancelOpenActionDialog'), source.indexOf('function hasSavedScene')), context);
  const pressEnter = () => [...listeners.document].filter(([t]) => t === 'keydown').forEach(([, fn]) => fn({ key: 'Enter' }));
  const flush = () => new Promise(r => setImmediate(r));

  let answer;
  vm.runInContext('showActionDialog({ title: "Update Ear Scene?" })', context).then(v => { answer = v; });
  pressEnter(); // the same Return keypress, still bubbling up to the document
  await flush();
  assert.equal(answer, undefined, 'the opening keypress must not answer the dialog');
  clock.advance(0);
  pressEnter(); // a deliberate Return afterwards still works
  await flush();
  assert.equal(answer, true);

  let first, second;
  vm.runInContext('showActionDialog({ title: "A" })', context).then(v => { first = v; });
  vm.runInContext('showActionDialog({ title: "B" })', context).then(v => { second = v; });
  els.actionDialogConfirm.click();
  await flush();
  assert.equal(first, false, 'the first dialog was cancelled when the second opened');
  assert.equal(second, true, 'one tap answers only the dialog on screen');
});

test('console channel panel: only allowed controls reach the desk, clamped, and a channel loads one query per tick', () => {
  const h = serverHarness();
  const desk = () => h.ports.at(-1).sent.map(m => [m.address, ...(m.args || []).map(a => (typeof a === 'object' ? a.value : a))]);
  h.ports.at(-1).sent.length = 0;
  h.send({ type: 'console-param', ch: 2, path: 'EQ/eq_gain_2', value: 40 });
  h.send({ type: 'console-param', ch: 2, path: 'Channel_Input/phantom', value: 0.7 });
  h.send({ type: 'console-param', ch: 2, path: 'Channel_Input/name', value: 1 });
  h.send({ type: 'console-param', ch: 2, path: '../../Console/Session', value: 1 });
  h.send({ type: 'console-param', ch: 999, path: 'EQ/eq_gain_2', value: 1 });
  h.send({ type: 'console-param', ch: 2, path: 'EQ/eq_gain_2', value: 'NaN' });
  h.send({ type: 'console-param', ch: 2, path: 'Dynamics/comp_knee_1', value: 7 });
  assert.deepEqual(desk(), [['/Input_Channels/2/EQ/eq_gain_2', 18], ['/Input_Channels/2/Channel_Input/phantom', 1]], 'out-of-range values are clamped; anything not in the table never goes out');
  assert.equal(h.cached('/Input_Channels/2/EQ/eq_gain_2'), 18);

  h.ports.at(-1).sent.length = 0;
  h.socket.sent = [];
  h.send({ type: 'request-channel-detail', ch: 2, section: 'dynamics' });
  const detail = h.socket.sent.find(m => m.type === 'channel-detail');
  assert.equal(detail.values['EQ/eq_gain_2'], 18, 'what’s cached comes back straight away');
  assert.equal(desk().length, 0, 'queries go out on the pacer, never in a burst');
  h.clock.advance(100);
  assert.equal(desk().length, 1);
  assert.match(desk()[0][0], /^\/Input_Channels\/2\/Dynamics\/.+\/\?$/, 'the section being looked at is asked for first');
  h.clock.advance(300);
  assert.equal(desk().length, 4, 'one query per 100 ms');
});

test('DiGiCo: a silent desk is probed, marked disconnected, and re-silenced when it answers again', () => {
  const h = serverHarness();
  h.run('globalThis.reports = []; setConsoleStatusCallback(c => reports.push(c))');
  h.run('deskAlive = true; deskLastHeardAt = Date.now()');
  const desk = () => h.ports.at(-1).sent.map(m => m.address);
  h.send({ type: 'set-active-aux', aux: 1 }); // a phone has this mix open
  // The harness skips the metadata load; the refresh needs the desk's counts
  h.run("cache.set('/Console/Input_Channels', { address: '/Console/Input_Channels', args: [2] }); cache.set('/Console/Aux_Outputs/modes', { address: '/Console/Aux_Outputs/modes', args: [1] })");
  h.echo({ address: level(2), args: [-12] });
  h.send({ type: 'set-mute', aux: 1, ch: 2, muted: true });
  h.clock.advance(100);
  h.ports.at(-1).sent.length = 0;
  h.clock.advance(2000);
  assert.deepEqual(desk(), [], 'heard recently: no probe');
  h.run('deskLastHeardAt = Date.now() - 9000');
  h.clock.advance(2000);
  assert.deepEqual(desk(), ['/Console/Session/Filename/?'], 'quiet for 8s: one cheap query the desk is known to answer');
  h.clock.advance(2000);
  assert.deepEqual(desk(), ['/Console/Session/Filename/?'], 'probe still outstanding: nothing more');
  h.run('deskProbeSentAt = Date.now() - 6000; deskLastHeardAt = Date.now() - 15000');
  h.clock.advance(2000);
  assert.equal(h.run('JSON.stringify(reports)'), '[false]', 'no answer for 5s: disconnected');
  assert.equal(h.run('isConsoleConnected()'), false);
  h.ports.at(-1).sent.length = 0;
  h.echo({ address: '/Console/Session/Filename', args: ['sunday.ses'] });
  assert.equal(h.run('JSON.stringify(reports)'), '[false,true]', 'the first message back: connected');
  h.clock.advance(100);
  const resilenced = h.ports.at(-1).sent.filter(m => m.address === level(2)).map(m => (m.args[0] && typeof m.args[0] === 'object') ? m.args[0].value : m.args[0]);
  assert.deepEqual(resilenced, [-150], 'the phone mute is sent to the desk again, in case it restarted');
  h.clock.advance(100);
  assert(desk().some(a => /^\/Input_Channels\/\d+\/Aux_Send\/1\/send_level\/\?$/.test(a)), 'and the open mix is refreshed from the desk');
});

test('the phone\'s Equalizer opens only its own panel, not the graphic EQ and compressor that share its look', () => {
  // 2.0.16: mix-processing.js's panels are .eq-panel too, and mixer.css's
  // `body.eqOpen .eq-panel` showed all three, the compressor on top
  const css = read('src/mixer/mix-processing.css');
  const js = read('src/mixer/mix-processing.js');
  assert.match(js, /el\('div', 'eq-panel dyn-panel'\)/, 'the panels are .dyn-panel');
  assert.match(css, /body\.eqOpen \.dyn-panel\s*\{\s*display:\s*none;?\s*\}/, 'hidden while the Equalizer is open');
  assert.match(css, /body\.geqOpen #geqPanel, body\.compOpen #compPanel \{ display: flex; \}/, 'each shown by its own class (an id outranks .dyn-panel)');
});
