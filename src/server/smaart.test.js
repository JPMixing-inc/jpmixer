'use strict';
// Smaart SPL against a stand-in Smaart API server (WebSocket, API v3 like
// Smaart 8.5, or v4 like Smaart 9): finding the API path, the password,
// the logging inputs and their live levels, and that JPMixer only ever reads.
// It runs end to end: the Smaart plugin (plugins/smaart) in its own process,
// installed from the copy that comes with JPMixer as moving over does, with
// JPMixer's /smaart-spl answering from what it shares (smaart.js).

const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return path.join(__dirname, '_fake-electron-for-tests.js');
  return origResolve.call(this, request, ...args);
};
process.env.JPM_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-smaart-test-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const plugins = require('./plugins');
const integrations = require('./integrations');
const smaartShim = require('./smaart');
const lib = require('../../plugins/smaart/smaart'); // the plugin's own connection code, for what can only be tested in here

// JPMixer's side: the config to the plugin (integrations.js) and to smaart.js, as main.js does
let current = {};
const smaart = {
  applyConfig(c) { current = c; smaartShim.applyConfig(c); return integrations.applyConfig(c); },
  getStatus: () => smaartShim.getStatus(),
  singleReading: (m, i) => smaartShim.singleReading(m, i),
  stop() { return smaart.applyConfig({ ...current, smaartEnabled: false }); },
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await check(); if (v) return v; await wait(50); }
  return check();
}

// The stand-in. `received` keeps every message JPMixer sent, by path.
function standIn({ version = 3, password = '', inputs = [{ device: 'Smaart I-O', channel: 'Front Left' }] } = {}) {
  const received = [];
  const state = { inputs, levels: { 'LAeq 10': 94.2, 'SPL A Slow': 97.6, 'SPL Fast': 99.1, 'LAeq 1': 95 }, violation: 'none', quiet: false };
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  const base = `/api/v${version}/`;
  const endpoint = (i) => `${base}devices/${encodeURIComponent(i.device)}/channels/${encodeURIComponent(i.channel)}`;
  wss.on('connection', (ws, req) => {
    const path = req.url;
    let authed = !password;
    const streamOf = state.inputs.find((i) => endpoint(i) === path);
    if (streamOf) {
      const timer = setInterval(() => {
        ws.send(JSON.stringify({
          timestamp: new Date().toISOString(), deviceName: streamOf.device, channelName: streamOf.channel,
          metrics: Object.entries(state.levels).map(([k, v]) => (state.violation === k ? { [k]: v, violation: true } : { [k]: v })),
        }));
      }, 60);
      ws.on('close', () => clearInterval(timer));
    }
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      received.push({ path, msg });
      if (state.quiet) return; // asleep: the connection stays open, nothing answers
      const reply = (response) => ws.send(JSON.stringify(msg.sequenceNumber ? { sequenceNumber: msg.sequenceNumber, response } : { response }));
      if (path === '/') { ws.send(JSON.stringify({ supportedApiVersions: [{ [String(version)]: base }] })); return; }
      if (streamOf) return; // stream commands get no reply
      if (path !== base) { reply({ error: 'unknown target' }); return; }
      if (msg.action === 'set' && msg.properties?.[0]?.password !== undefined) {
        authed = msg.properties[0].password === password;
        reply(authed ? {} : { error: 'incorrect password' });
        return;
      }
      if (msg.action === 'get' && !msg.target) { reply({ applicationName: version === 4 ? 'Smaart Suite' : 'Smaart', applicationVersion: version === 4 ? '9.5.0' : '8.5.2', authenticationRequired: !!password }); return; }
      if (!authed) { reply({ error: 'authentication required' }); return; }
      if (msg.action === 'get' && msg.target === 'activeCalibratedInputs') {
        const metrics = Object.keys(state.levels);
        const devices = [...new Set(state.inputs.map((i) => i.device))].map((d) => ({
          deviceName: d,
          activeCalibratedChannels: state.inputs.filter((i) => i.device === d).map((i, n) => ({ channelIndex: n, channelName: i.channel, streamEndpoint: endpoint(i), logEndpointPrefix: `/api/v${version}/logs/x/` })),
        }));
        reply({ devices, metrics, colorThresholds: metrics.map(() => ({ greenAboveLevel: 80, yellowAboveLevel: 95, redAboveLevel: 100 })) });
        return;
      }
      reply({ error: 'unknown action' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port, received, state,
    close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(); server.close(() => r()); }),
  })));
}

let jpm; // JPMixer's /smaart-spl route
let optionsAllowed = false, savedOptions = null;
test.before(async () => {
  await plugins.start({ allowed: false }); // official: no Allow plugins needed
  const installed = await integrations.ensureInstalled('smaart');
  assert.deepEqual(installed, { ok: true, from: 'bundled' }, 'installed from the copy that comes with JPMixer');
  const app = express();
  // As foh.js mounts it: FOH's code, and the options saved (to the config, then the plugin)
  smaartShim.mountSmaart(app, { canChange: () => optionsAllowed, save: (o) => { savedOptions = o; smaart.applyConfig({ ...current, smaartMetric: o.main, smaartLiveMetric: o.live, smaartHiddenInputs: o.hidden }); return true; } });
  jpm = http.createServer(app);
  await new Promise((r) => jpm.listen(0, '127.0.0.1', r));
});
test.after(async () => { await plugins.stopAll(); jpm.close(); });
const spl = () => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: jpm.address().port, path: '/smaart-spl' }, (res) => {
    let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(JSON.parse(d)));
  }).on('error', reject);
});
const until2 = (fn, ms) => until(fn, ms || 8000); // the plugin starts in a process of its own
const cfg = (port, more = {}) => ({ smaartEnabled: true, smaartHost: '127.0.0.1', smaartPort: port, smaartPassword: '', smaartMetric: '', smaartLiveMetric: '', ...more });

test('reads a Smaart 8.5 input (API v3): LAeq 10 big, SPL A Slow small, in Smaart’s colours', async () => {
  const s = await standIn({ version: 3 });
  try {
    await smaart.applyConfig(cfg(s.port));
    const data = await until2(async () => { const d = await spl(); return d.inputs[0]?.main?.value ? d : null; });
    assert.equal(data.state, 'connected');
    assert.match(data.message, /Smaart 8\.5\.2.*1 input/);
    const input = data.inputs[0];
    assert.equal(input.channel, 'Front Left');
    assert.deepEqual(input.main, { name: 'LAeq 10', value: 94.2, color: 'green', over: false });
    assert.deepEqual(input.live, { name: 'SPL A Slow', value: 97.6, color: 'yellow', over: false });
    assert.equal(input.stale, false);
    assert.equal(smaart.getStatus().apiVersion, 3);
  } finally { await smaart.stop(); await s.close(); }
});

test('Smaart 9 (API v4) works the same, and the chosen readings are used', async () => {
  const s = await standIn({ version: 4 });
  try {
    await smaart.applyConfig(cfg(s.port, { smaartMetric: 'SPL Fast', smaartLiveMetric: 'LAeq 1' }));
    const data = await until2(async () => { const d = await spl(); return d.inputs[0]?.main?.value ? d : null; });
    assert.equal(smaart.getStatus().apiVersion, 4);
    assert.deepEqual(data.inputs[0].main, { name: 'SPL Fast', value: 99.1, color: 'yellow', over: false });
    assert.deepEqual(data.inputs[0].live, { name: 'LAeq 1', value: 95, color: 'yellow', over: false });
  } finally { await smaart.stop(); await s.close(); }
});

test('an alarm in Smaart marks the reading over', async () => {
  const s = await standIn();
  try {
    s.state.violation = 'LAeq 10';
    s.state.levels['LAeq 10'] = 101.3;
    await smaart.applyConfig(cfg(s.port));
    const data = await until2(async () => { const d = await spl(); return d.inputs[0]?.main?.over ? d : null; });
    assert.deepEqual(data.inputs[0].main, { name: 'LAeq 10', value: 101.3, color: 'red', over: true });
  } finally { await smaart.stop(); await s.close(); }
});

test('a password is sent only when Smaart asks for one, and a missing or wrong one says so', async () => {
  const s = await standIn({ password: 'church' });
  try {
    await smaart.applyConfig(cfg(s.port));
    assert.match((await until2(async () => /password/i.test(smaart.getStatus().message) && smaart.getStatus())).message, /asks for its API password/);
    await smaart.applyConfig(cfg(s.port, { smaartPassword: 'nope' }));
    assert.match((await until2(async () => /isn’t right/.test(smaart.getStatus().message) && smaart.getStatus())).message, /password isn’t right/);
    await smaart.applyConfig(cfg(s.port, { smaartPassword: 'church' }));
    const data = await until2(async () => { const d = await spl(); return d.inputs[0]?.main?.value ? d : null; });
    assert.equal(data.inputs.length, 1);
  } finally { await smaart.stop(); await s.close(); }
});

test('no logging inputs, and a Smaart that isn’t running, each get a clear message', async () => {
  const s = await standIn({ inputs: [] });
  try {
    await smaart.applyConfig(cfg(s.port));
    const st = await until2(async () => smaart.getStatus().state === 'connected' && smaart.getStatus());
    assert.match(st.message, /no inputs are logging SPL/);
  } finally { await smaart.stop(); await s.close(); }
  await smaart.applyConfig(cfg(1)); // nothing listens on port 1
  const st = await until2(async () => /Can’t reach/.test(smaart.getStatus().message) && smaart.getStatus());
  assert.match(st.message, /Can’t reach Smaart at 127\.0\.0\.1:1/);
  await smaart.stop();
});

test('Settings off, or no address, does not connect', async () => {
  await smaart.applyConfig(cfg(26000, { smaartEnabled: false }));
  assert.equal(smaart.getStatus().state, 'off');
  assert.equal((await spl()).enabled, false);
  assert.equal(plugins.isRunning('smaart'), false, 'off: the plugin isn’t running at all');
  await smaart.applyConfig(cfg(26000, { smaartHost: '' }));
  assert.match((await until2(async () => /Enter the Smaart computer’s address/.test(smaart.getStatus().message) && smaart.getStatus())).message, /Enter the Smaart computer’s address/);
  await smaart.stop();
});

test('JPMixer only reads from Smaart: queries, its password, and its own streams’ rate', async () => {
  const s = await standIn({ password: 'church', inputs: [{ device: 'Smaart I-O', channel: 'Front Left' }, { device: 'Smaart I-O', channel: 'Front Right' }] });
  try {
    await smaart.applyConfig(cfg(s.port, { smaartPassword: 'church' }));
    await until2(async () => (await spl()).inputs.filter((i) => i.main?.value).length === 2);
    await wait(300);
    assert.ok(s.received.length > 0);
    for (const { msg } of s.received) {
      if (msg.action === 'get') continue;
      assert.equal(msg.action, 'set', `only gets and sets: ${JSON.stringify(msg)}`);
      const keys = (msg.properties || []).flatMap((p) => Object.keys(p));
      assert.ok(keys.every((k) => k === 'password' || k === 'targetFPS'), `only the password and stream rate are set: ${JSON.stringify(msg)}`);
    }
  } finally { await smaart.stop(); await s.close(); }
});

test('the card’s options: readings, the small one off, inputs left off, and FOH’s code', async () => {
  const s = await standIn({ inputs: [{ device: 'Smaart I-O', channel: 'Front Left' }, { device: 'Smaart I-O', channel: 'Stage Left' }] });
  optionsAllowed = false; savedOptions = null;
  const call = (method, path, body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: jpm.address().port, path, method, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
    });
    req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
  try {
    await smaart.applyConfig(cfg(s.port));
    let data = (await until2(async () => { const d = (await call('GET', '/smaart-spl')).body; return d.inputs.filter((i) => i.main?.value).length === 2 ? d : null; }));
    assert.deepEqual(data.metrics, ['LAeq 10', 'SPL A Slow', 'SPL Fast', 'LAeq 1'], 'Smaart’s own metric names, for the menus');
    assert.deepEqual(data.inputs.map((i) => i.key), ['Smaart I-O/Front Left', 'Smaart I-O/Stage Left']);

    let r = await call('POST', '/smaart-spl/options', { main: 'SPL Fast', live: 'none', hidden: ['Smaart I-O/Stage Left'] });
    assert.equal(r.status, 401, 'FOH’s code is needed to change them');
    assert.equal(savedOptions, null);

    optionsAllowed = true;
    const connectedAt = smaart.getStatus().message;
    r = await call('POST', '/smaart-spl/options', { main: 'SPL Fast', live: 'none', hidden: ['Smaart I-O/Stage Left'] });
    assert.equal(r.status, 200);
    assert.deepEqual(savedOptions, { main: 'SPL Fast', live: 'none', hidden: ['Smaart I-O/Stage Left'] });
    // The plugin takes them as new settings: the card changes, without reconnecting to Smaart
    data = await until2(async () => { const d = (await call('GET', '/smaart-spl')).body; return d.inputs[0]?.main?.name === 'SPL Fast' ? d : null; });
    assert.equal(smaart.getStatus().message, connectedAt, 'still connected, not reconnected');
    const [left, stage] = data.inputs;
    assert.equal(left.main.name, 'SPL Fast');
    assert.equal(left.live, null, 'the small reading is off');
    assert.equal(left.hidden, false);
    assert.equal(stage.hidden, true, 'Stage Left is left off the card');

    r = await call('POST', '/smaart-spl/options', { main: '<script>', live: '', hidden: [] });
    assert.equal(r.status, 400, 'only metric names are taken');
    r = await call('POST', '/smaart-spl/options', { main: '', live: '', hidden: 'all' });
    assert.equal(r.status, 400);
  } finally { optionsAllowed = false; await smaart.stop(); await s.close(); }
});

test('the Green Room’s one reading: its own metric and input, or the first input FOH shows', async () => {
  const s = await standIn({ inputs: [{ device: 'Smaart I-O', channel: 'Front Left' }, { device: 'Smaart I-O', channel: 'Stage Left' }] });
  try {
    assert.equal(await smaart.singleReading('', ''), null, 'nothing while Smaart is off');
    await smaart.applyConfig(cfg(s.port, { smaartHiddenInputs: ['Smaart I-O/Front Left'] }));
    await until2(async () => (await spl()).inputs.filter((i) => i.main?.value).length === 2);
    assert.deepEqual(await smaart.singleReading('', ''), { name: 'LAeq 10', value: 94.2, color: 'green', over: false, input: 'Stage Left', stale: false }, 'the first input the FOH card shows');
    const r = await smaart.singleReading('SPL Fast', 'Smaart I-O/Front Left');
    assert.equal(r.name, 'SPL Fast');
    assert.equal(r.input, 'Front Left', 'the chosen input, even if the FOH card leaves it off');
    assert.equal((await smaart.singleReading('Nope', 'Smaart I-O/Gone')).name, 'LAeq 10', 'a reading or input Smaart no longer has falls back');
    assert.deepEqual((await until2(async () => smaart.getStatus().inputList.length === 2 && smaart.getStatus())).inputList, [{ key: 'Smaart I-O/Front Left', name: 'Front Left' }, { key: 'Smaart I-O/Stage Left', name: 'Stage Left' }]);
  } finally { await smaart.stop(); await s.close(); }
});

test('a Smaart that stops answering without hanging up is reconnected, not shown as connected (the plugin’s code, in here)', async () => {
  const s = await standIn();
  lib._setTimings(150, 300);
  try {
    lib.applyConfig(cfg(s.port));
    await until(async () => lib.getStatus().state === 'connected');
    s.state.quiet = true;
    const st = await until(async () => lib.getStatus().state === 'error' && lib.getStatus(), 4000);
    assert.ok(st, 'no longer connected');
    assert.match(st.message, /stopped answering|isn’t answering|Can’t reach/);
    s.state.quiet = false;
    assert.ok(await until(async () => lib.getStatus().state === 'connected', 9000), 'and back when it answers again');
  } finally { lib.stop(); lib._setTimings(15000, 8000); await s.close(); }
});

test('the API version is picked from what the server lists', () => {
  assert.deepEqual(lib._pickVersion([{ 3: '/api/v3/' }, { 4: '/api/v4/' }]), { version: 4, path: '/api/v4/' });
  assert.deepEqual(lib._pickVersion([{ 3: '/api/v3/' }]), { version: 3, path: '/api/v3/' });
  assert.equal(lib._pickVersion([{ 2: '/api/v2/' }, { 4: 'http://elsewhere/' }]), null);
});
