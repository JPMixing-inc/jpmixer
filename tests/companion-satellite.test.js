'use strict';
// Companion buttons on the Home pages: JPMixer as a Satellite client against
// a fake Companion server speaking the Satellite API.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const express = require('express');
const companion = require('../src/server/companion-satellite');

const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(20); }
  throw new Error('timed out waiting');
}

// A fake Companion: records every line JPMixer sends, and lets the test send lines back
function fakeCompanion({ apiVersion = '1.12.0', caps = 'BITMAP_FORMATS=rgb,png', autoOk = true } = {}) {
  const lines = [];
  let client = null;
  const srv = net.createServer((sock) => {
    client = sock;
    sock.setEncoding('utf8');
    let buf = '';
    sock.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        lines.push(line);
        const m = /^ADD-DEVICE DEVICEID=(\S+)/.exec(line);
        if (m && autoOk) sock.write(`ADD-DEVICE OK DEVICEID=${m[1]}\n`);
      }
    });
    sock.write(`BEGIN CompanionVersion=5.1.0 ApiVersion=${apiVersion}\n`);
    if (caps) sock.write(`CAPS ${caps}\n`);
  });
  return new Promise(resolve => srv.listen(0, '127.0.0.1', () => resolve({
    port: srv.address().port, lines,
    send: (line) => client.write(line + '\n'),
    dropClient: () => client && client.destroy(),
    close: () => new Promise(r => { client?.destroy(); srv.close(r); }),
  })));
}

function pageServer(canUse) {
  const app = express();
  companion.mountCompanion(app, { canUse });
  return new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
}
const request = (port, method, path, body) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path, method, headers: body ? { 'Content-Type': 'application/json' } : {} }, (res) => {
    let d = ''; res.on('data', c => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null }));
  });
  req.on('error', reject);
  req.end(body ? JSON.stringify(body) : undefined);
});
const cfg = (port, extra = {}) => ({ companionEnabled: true, companionHost: '127.0.0.1', companionPort: port, companionColumns: 8, companionRows: 4, ...extra });

test('registers one surface per Home page, using PNG images and a stable serial on new Companion', async (t) => {
  const fake = await fakeCompanion();
  t.after(async () => { companion.stop(); await fake.close(); });
  companion.applyConfig(cfg(fake.port));
  await until(() => fake.lines.filter(l => l.startsWith('ADD-DEVICE')).length === 4);
  const adds = fake.lines.filter(l => l.startsWith('ADD-DEVICE'));
  assert.deepEqual(adds.map(l => /DEVICEID=(\S+)/.exec(l)[1]), ['jpmixer-foh', 'jpmixer-propresenter', 'jpmixer-lighting', 'jpmixer-switcher']);
  for (const l of adds) {
    assert.match(l, /KEYS_TOTAL=32 KEYS_PER_ROW=8/);
    assert.match(l, /BITMAP_FORMAT=png/);
    assert.match(l, /BITMAPS=96/);
    assert.match(l, /SERIAL=jpmixer:[A-Za-z0-9-]+:[a-z]+/);
  }
  assert.match(adds[2], /PRODUCT_NAME="JPMixer Lighting Home"/);
  await until(() => companion.getStatus().state === 'connected' && companion.getStatus().surfaces.switcher.registered);
});

test('older Companion (no CAPS): plain RGB images, no serial, and at most 32 keys', async (t) => {
  const fake = await fakeCompanion({ apiVersion: '1.4.0', caps: null });
  t.after(async () => { companion.stop(); await fake.close(); });
  companion.applyConfig(cfg(fake.port, { companionRows: 5 })); // 8 × 5 = 40 keys
  await until(() => fake.lines.filter(l => l.startsWith('ADD-DEVICE')).length === 4);
  const add = fake.lines.find(l => l.startsWith('ADD-DEVICE'));
  assert.match(add, /KEYS_TOTAL=32 /, 'API 1.4 allows at most 32 keys');
  assert.doesNotMatch(add, /BITMAP_FORMAT|SERIAL|BRIGHTNESS/, 'only parameters this version knows');
  assert.match(add, /BITMAPS=true/, 'before 1.5 BITMAPS is a yes/no');
});

test('button images reach the page, taps press them in Companion, and junk is dropped', async (t) => {
  const fake = await fakeCompanion();
  const pages = await pageServer(() => true);
  t.after(async () => { companion.stop(); pages.close(); await fake.close(); });
  companion.applyConfig(cfg(fake.port));
  await until(() => companion.getStatus().surfaces.lighting.registered);
  const port = pages.address().port;

  const png = 'data:image/png;base64,iVBORw0KGgo=';
  fake.send(`KEY-STATE DEVICEID=jpmixer-lighting KEY=3 TYPE=BUTTON BITMAP=${png} COLOR=#ff0000 TEXT=${Buffer.from('Blackout').toString('base64')} PRESSED=0`);
  fake.send('KEY-STATE DEVICEID=jpmixer-lighting KEY=99 BITMAP=AAAA'); // off the grid
  fake.send('KEY-STATE DEVICEID=jpmixer-lighting KEY=4 BITMAP=javascript:alert(1) COLOR=red;background:url(x)');
  fake.send('KEY-STATE DEVICEID=jpmixer-somethingelse KEY=1 BITMAP=AAAA');
  const state = await until(async () => { const r = await request(port, 'GET', '/companion/state?role=lighting'); return r.body.keys.length === 2 ? r : null; });
  const k3 = state.body.keys.find(k => k.index === 3);
  assert.equal(k3.bitmap, png);
  assert.equal(k3.text, 'Blackout');
  assert.equal(k3.color, '#ff0000');
  const k4 = state.body.keys.find(k => k.index === 4);
  assert.equal(k4.bitmap, '', 'anything that isn’t a Companion image is dropped');
  assert.equal(k4.color, '', 'and so is a colour that isn’t a colour');
  assert.equal((await request(port, 'GET', '/companion/state?role=foh')).body.keys.length, 0, 'each page has its own surface');

  assert.equal((await request(port, 'POST', '/companion/press', { role: 'lighting', key: 3, pressed: true })).status, 200);
  assert.equal((await request(port, 'POST', '/companion/press', { role: 'lighting', key: 3, pressed: false })).status, 200);
  await until(() => fake.lines.filter(l => l.startsWith('KEY-PRESS')).length === 2);
  assert.deepEqual(fake.lines.filter(l => l.startsWith('KEY-PRESS')), [
    'KEY-PRESS DEVICEID=jpmixer-lighting KEY=3 PRESSED=true',
    'KEY-PRESS DEVICEID=jpmixer-lighting KEY=3 PRESSED=false',
  ]);
  assert.equal((await request(port, 'POST', '/companion/press', { role: 'lighting', key: 40, pressed: true })).status, 409, 'a key off the grid is refused');
  assert.equal((await request(port, 'POST', '/companion/press', { role: 'nope', key: 1, pressed: true })).status, 400);

  fake.send('KEYS-CLEAR DEVICEID=jpmixer-lighting');
  await until(async () => (await request(port, 'GET', '/companion/state?role=lighting')).body.keys.length === 0);
});

test('FOH Home’s buttons need its access code like the rest of FOH Home', async (t) => {
  const pages = await pageServer((req, role) => role !== 'foh');
  t.after(() => pages.close());
  const port = pages.address().port;
  assert.equal((await request(port, 'GET', '/companion/state?role=foh')).status, 401);
  assert.equal((await request(port, 'POST', '/companion/press', { role: 'foh', key: 0, pressed: true })).status, 401);
  assert.equal((await request(port, 'GET', '/companion/state?role=switcher')).status, 200);
});

test('answers Companion’s pings, and says goodbye when turned off', async (t) => {
  const fake = await fakeCompanion();
  t.after(async () => { companion.stop(); await fake.close(); });
  companion.applyConfig(cfg(fake.port));
  await until(() => companion.getStatus().surfaces.foh.registered);
  fake.send('PING hello-123');
  await until(() => fake.lines.includes('PONG hello-123'));
  await until(() => fake.lines.some(l => l.startsWith('PING ')), 3500); // and keeps the link alive itself
  companion.applyConfig({ ...cfg(fake.port), companionEnabled: false });
  await until(() => fake.lines.includes('QUIT'));
  assert.equal(companion.getStatus().state, 'off');
  assert.equal(companion.getStatus().surfaces.foh.registered, false);
});

test('a refused surface or a dropped connection shows up in the status', async (t) => {
  const fake = await fakeCompanion({ autoOk: false });
  t.after(async () => { companion.stop(); await fake.close(); });
  companion.applyConfig(cfg(fake.port));
  await until(() => fake.lines.filter(l => l.startsWith('ADD-DEVICE')).length === 4);
  for (const role of ['foh', 'propresenter', 'lighting', 'switcher']) fake.send(`ADD-DEVICE ERROR DEVICEID=jpmixer-${role} MESSAGE="Surface limit reached"`);
  await until(() => companion.getStatus().state === 'error');
  assert.match(companion.getStatus().message, /Surface limit reached/);
  fake.dropClient();
  await until(() => /Lost the connection|refused/.test(companion.getStatus().message) && !companion.getStatus().surfaces.foh.error);
});

test('nothing to connect to: a clear message, not a crash', async (t) => {
  t.after(() => companion.stop());
  companion.applyConfig({ companionEnabled: true, companionHost: '' });
  assert.match(companion.getStatus().message, /address/);
  const closed = net.createServer(); await new Promise(r => closed.listen(0, '127.0.0.1', r));
  const port = closed.address().port; await new Promise(r => closed.close(r)); // a port nothing listens on
  companion.applyConfig(cfg(port));
  await until(() => companion.getStatus().state === 'error');
  assert.match(companion.getStatus().message, /isn’t accepting Satellite connections/);
});

test('parses quoted values the way Companion sends them', () => {
  const { command, args, result } = companion._parse('ADD-DEVICE ERROR DEVICEID=jpmixer-foh MESSAGE="Bad \\"thing\\" happened"');
  assert.equal(command, 'ADD-DEVICE');
  assert.equal(result, 'ERROR');
  assert.equal(args.MESSAGE, 'Bad "thing" happened');
});
