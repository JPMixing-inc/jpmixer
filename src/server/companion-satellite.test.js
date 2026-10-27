'use strict';
// Companion buttons end to end: the Companion plugin (plugins/companion) in
// its own process, installed from the copy that comes with JPMixer as moving
// over does, against a stand-in Companion speaking the Satellite API, and the
// Home pages served by JPMixer from what it shares (companion-satellite.js):
// the four surfaces registered, a button reaching a page's stream, a tap
// pressing it in Companion, FOH's code, and the pages off when it's off.

const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return path.join(__dirname, '_fake-electron-for-tests.js');
  return origResolve.call(this, request, ...args);
};
process.env.JPM_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-companion-test-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const plugins = require('./plugins');
const integrations = require('./integrations');
const companion = require('./companion-satellite');
const lib = require('../../plugins/companion/companion'); // the plugin's own code

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await check(); if (v) return v; await wait(50); }
  return check();
}

// A stand-in Companion: says BEGIN, accepts each surface, records every line
function standIn() {
  const lines = [];
  let client = null;
  const server = net.createServer((sock) => {
    client = sock;
    sock.setEncoding('utf8');
    sock.write('BEGIN CompanionVersion=3.4.0 ApiVersion=1.7.0\n');
    let buf = '';
    sock.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        lines.push(line);
        const m = /^ADD-DEVICE DEVICEID=(\S+)/.exec(line);
        if (m) sock.write(`ADD-DEVICE OK DEVICEID=${m[1]}\n`);
        if (line.startsWith('PING')) sock.write(`PONG ${line.slice(5)}\n`);
      }
    });
  });
  return {
    lines,
    say: (s) => client && client.write(s + '\n'),
    listen: () => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port))),
    close: () => new Promise((r) => { if (client) client.destroy(); server.close(r); }),
  };
}

test('the Satellite parser reads quoted values (the plugin’s code)', () => {
  assert.deepEqual(lib._parse('KEY-STATE DEVICEID=jpmixer-foh KEY=3 TEXT="SGVsbG8=" COLOR=#ff0000'),
    { command: 'KEY-STATE', args: { DEVICEID: 'jpmixer-foh', KEY: '3', TEXT: 'SGVsbG8=', COLOR: '#ff0000' }, result: null });
  assert.equal(lib._parse('ADD-DEVICE OK DEVICEID=jpmixer-foh').result, 'OK');
});

test('Companion buttons as a plugin: surfaces, a button on the page, a tap pressed in Companion', async () => {
  await plugins.start({ allowed: false }); // official: no Allow plugins needed
  const comp = standIn();
  const port = await comp.listen();
  let fohCode = false;
  const app = express();
  companion.mountCompanion(app, { canUse: (req, role) => role !== 'foh' || fohCode });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const cfg = { companionEnabled: true, companionHost: '127.0.0.1', companionPort: port, companionColumns: 4, companionRows: 2 };
  try {
    assert.deepEqual(await integrations.ensureInstalled('companion'), { ok: true, from: 'bundled' });
    companion.applyConfig(cfg);
    await integrations.applyConfig(cfg);

    // Each Home page registered as a surface of its own, 4 × 2 keys
    await until(() => comp.lines.filter((l) => l.startsWith('ADD-DEVICE')).length === 4);
    const lighting = comp.lines.find((l) => l.includes('DEVICEID=jpmixer-lighting'));
    assert.match(lighting, /PRODUCT_NAME="JPMixer Lighting Home"/);
    assert.match(lighting, /KEYS_TOTAL=8 KEYS_PER_ROW=4/);
    const state = await until(async () => { const s = await (await fetch(`${base}/companion/state?role=lighting`)).json(); return s.registered ? s : null; });
    assert.equal(state.state, 'connected');
    assert.match(state.message, /Connected to Companion 3\.4\.0/);

    // A button in Companion reaches the page's stream
    const ctrl = new AbortController();
    const stream = await fetch(`${base}/companion/stream?role=lighting`, { signal: ctrl.signal });
    const reader = stream.body.getReader();
    let got = '';
    const read = (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; got += Buffer.from(value).toString(); } } catch (_) {} })();
    comp.say(`KEY-STATE DEVICEID=jpmixer-lighting KEY=2 TYPE=BUTTON COLOR=#ff0000 TEXT=${Buffer.from('House').toString('base64')} PRESSED=false`);
    await until(() => /event: key\ndata: .*"text":"House"/.test(got));
    const key = JSON.parse(got.match(/event: key\ndata: (.*)\n/)[1]);
    assert.deepEqual([key.index, key.text, key.color], [2, 'House', '#ff0000']);
    assert.equal((await (await fetch(`${base}/companion/state?role=lighting`)).json()).keys[0].text, 'House', 'and a page opened later sees it');
    ctrl.abort(); await read;

    // A tap on the page presses it in Companion
    const press = (role, key, pressed) => fetch(`${base}/companion/press`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, key, pressed }) });
    assert.equal((await press('lighting', 2, true)).status, 200);
    assert.equal((await press('lighting', 2, false)).status, 200);
    await until(() => comp.lines.includes('KEY-PRESS DEVICEID=jpmixer-lighting KEY=2 PRESSED=false'));
    assert.ok(comp.lines.includes('KEY-PRESS DEVICEID=jpmixer-lighting KEY=2 PRESSED=true'));
    assert.equal((await press('lighting', 99, true)).status, 409, 'a key that isn’t there');

    // FOH's surface needs FOH's code
    assert.equal((await fetch(`${base}/companion/state?role=foh`)).status, 401);
    fohCode = true;
    assert.equal((await fetch(`${base}/companion/state?role=foh`)).status, 200);

    // The plugin crashes: an open page is told straight away (not left showing dead buttons)
    const ctrl2 = new AbortController();
    const live = await fetch(`${base}/companion/stream?role=lighting`, { signal: ctrl2.signal });
    const reader2 = live.body.getReader();
    let got2 = '';
    const read2 = (async () => { try { for (;;) { const { value, done } = await reader2.read(); if (done) break; got2 += Buffer.from(value).toString(); } } catch (_) {} })();
    await until(() => /event: snapshot/.test(got2));
    got2 = '';
    plugins._running.get('companion').child.kill('SIGKILL');
    await until(() => /event: snapshot\ndata: .*"registered":false/.test(got2));
    assert.match(got2, /"keys":\[\]/, 'no buttons from the run that crashed');
    ctrl2.abort(); await read2;
    await until(() => plugins.isRunning('companion')); // started again after a pause
    await until(async () => (await (await fetch(`${base}/companion/state?role=lighting`)).json()).registered, 15000);

    // Off in Settings: the plugin stops, drops the surfaces in Companion, and the pages show it off
    companion.applyConfig({ ...cfg, companionEnabled: false });
    await integrations.applyConfig({ ...cfg, companionEnabled: false });
    assert.equal(plugins.isRunning('companion'), false);
    await until(() => comp.lines.includes('QUIT'));
    const off = await (await fetch(`${base}/companion/state?role=lighting`)).json();
    assert.deepEqual([off.enabled, off.state, off.message, off.keys.length], [false, 'off', 'Companion buttons are off.', 0]);
    assert.equal((await press('lighting', 2, true)).status, 409);
  } finally {
    await plugins.stopAll();
    server.close();
    await comp.close();
  }
});
