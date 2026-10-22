'use strict';
// The Devices page's stage arrangement is saved on this computer and shared
// with every browser, and open pages hear about each save.
const path = require('path');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return path.join(__dirname, '_fake-electron-for-tests.js');
  return origResolve.call(this, request, ...args);
};
const fs = require('fs');
const os = require('os');
const http = require('http');
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.JPM_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-device-stage-test-'));
const express = require('express');
const stage = require('./device-stage.js');

function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} }, (res) => {
      let text = ''; res.on('data', (c) => (text += c)); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}

test('an arrangement saved from one browser is what every other browser loads', async () => {
  stage._reset();
  const app = express(); stage.mountDeviceStage(app);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    assert.equal((await request(port, 'GET', '/device-stage?signature=8')).body.layout, null, 'nothing saved yet');
    const layout = { positions: { 'dev-maya': { x: 0.2, y: 0.4 }, 'stage-aux:3': { x: 0.9, y: 0.1 } }, hiddenAuxes: [8], height: 900 };
    const saved = await request(port, 'POST', '/device-stage', { signature: '8', clientId: 'a', layout });
    assert.equal(saved.body.ok, true);
    const loaded = (await request(port, 'GET', '/device-stage?signature=8')).body.layout;
    assert.deepEqual(loaded.positions, layout.positions);
    assert.deepEqual(loaded.hiddenAuxes, [8]);
    assert.equal(loaded.height, 900);
    // A console with a different number of mixes keeps its own
    assert.equal((await request(port, 'GET', '/device-stage?signature=24')).body.layout, null);
    // Kept on disk, so it survives a restart
    stage._reset();
    assert.deepEqual(JSON.parse(JSON.stringify(stage.get('8').positions)), layout.positions);
  } finally { server.close(); }
});

test('bad positions are cleaned or refused', () => {
  stage._reset();
  const cleaned = stage.clean({
    positions: { 'dev-ok': { x: 1.7, y: -2 }, 'anon-0': { x: 0.5, y: 0.5 }, 'bad key!': { x: 0.1, y: 0.1 }, 'dev-nan': { x: 'a', y: 1 } },
    hiddenAuxes: [3, 3, 0, 999, 'x'], height: 5,
  });
  assert.deepEqual(cleaned.positions, { 'dev-ok': { x: 1, y: 0 } }, 'clamped to the stage; unstable and junk keys dropped');
  assert.deepEqual(cleaned.hiddenAuxes, [3]);
  assert.equal(cleaned.height, 720);
  assert.equal(stage.clean(null), null);
  assert.equal(stage.set('not-a-number', { positions: {} }), null);
});

test('open Devices pages hear about a save, with who saved it', async () => {
  stage._reset();
  const app = express(); stage.mountDeviceStage(app);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const heard = new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port, path: '/device-stage/stream' }, (res) => {
        let text = '';
        res.on('data', (c) => { text += c; const m = text.match(/event: layout\ndata: (.+)\n/); if (m) { res.destroy(); resolve(JSON.parse(m[1])); } });
      });
    });
    await new Promise((r) => setTimeout(r, 100));
    await request(port, 'POST', '/device-stage', { signature: '8', clientId: 'ipad', layout: { positions: { 'dev-a': { x: 0, y: 0 } } } });
    const msg = await heard;
    assert.equal(msg.signature, '8');
    assert.equal(msg.by, 'ipad');
    assert.ok(msg.rev >= 1);
  } finally { server.close(); }
});
