'use strict';
// Integration test for api-server.js (the External Control API) against a
// real HTTP server and a mock "active backend" standing in for whichever
// of osc/dlive/klang/wing-server.js is actually running.
// Run with: node src/server/api-server.test.js

const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return path.join(__dirname, '_fake-electron-for-tests.js');
  return origResolve.call(this, request, ...args);
};
process.env.JPM_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-apiserver-test-'));

const assert = require('node:assert/strict');
const http = require('http');
const config = require('./config');
const api = require('./api-server');

function request(method, urlPath, { token, headerAuth, body } = {}) {
  return new Promise((resolve, reject) => {
    const q = token && !headerAuth ? `?token=${encodeURIComponent(token)}` : '';
    const req = http.request(
      { host: '127.0.0.1', port: PORT, method, path: urlPath + q, headers: {
        'Content-Type': 'application/json',
        ...(token && headerAuth ? { Authorization: `Bearer ${token}` } : {}),
      } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch (_) {}
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

const PORT = 18320;
let n = 0;
function t(name) { n++; console.log('ok -', name); }

async function main() {
  const TOKEN = 'test-token-abc123';
  config.save({ ...config.getAll(), apiEnabled: true, apiPort: PORT, apiToken: TOKEN });
  api.applyConfig(config.getAll());
  await new Promise((r) => setTimeout(r, 150));

  // ── No backend running yet: /status must still answer (connected:false),
  // but anything backend-dependent must 503 rather than crash ────────────
  {
    const res = await request('GET', '/api/v1/status', { token: TOKEN, headerAuth: true });
    assert.equal(res.status, 200);
    assert.equal(res.json.connected, false);
    t('/status answers even with no active backend, reporting connected:false');
  }
  {
    const res = await request('POST', '/api/v1/channels/1/label', { token: TOKEN, headerAuth: true, body: { label: 'Kick' } });
    assert.equal(res.status, 503);
    t('a backend-dependent route 503s cleanly when no console backend is active');
  }

  // ── Auth ─────────────────────────────────────────────────────────────
  {
    const res = await request('GET', '/api/v1/status', {});
    assert.equal(res.status, 401);
    t('no token at all -> 401');
  }
  {
    const res = await request('GET', '/api/v1/status', { token: 'wrong-token', headerAuth: true });
    assert.equal(res.status, 401);
    t('wrong token -> 401');
  }
  {
    const res = await request('GET', '/api/v1/status', { token: TOKEN, headerAuth: false }); // query param path
    assert.equal(res.status, 200);
    t('valid token via ?token= query param is accepted (Companion/Stream Deck compatibility)');
  }

  // ── Mock active backend — records every call so we can assert the API
  // server calls straight through to it with the right arguments ────────
  const calls = [];
  const mockBackend = {
    isConsoleConnected: () => true,
    setChannelLabel: (n, label) => { calls.push(['setChannelLabel', n, label]); return String(n) !== '999'; },
    setAuxLabel: (n, label) => { calls.push(['setAuxLabel', n, label]); return true; },
    setMute: (aux, ch, muted) => { calls.push(['setMute', aux, ch, muted]); return true; },
    setSolo: (aux, ch, soloed) => { calls.push(['setSolo', aux, ch, soloed]); return true; },
    fireSnapshot: (action) => { calls.push(['fireSnapshot', action]); return true; },
  };
  api.setActiveBackend(mockBackend);

  {
    const res = await request('POST', '/api/v1/channels/3/label', { token: TOKEN, headerAuth: true, body: { label: 'Lead Vocal' } });
    assert.equal(res.status, 200);
    assert.deepEqual(calls.pop(), ['setChannelLabel', '3', 'Lead Vocal']);
    t('POST /channels/:n/label calls straight through to the active backend');
  }
  {
    const res = await request('POST', '/api/v1/auxes/2/label', { token: TOKEN, headerAuth: true, body: { label: 'Guitar IEM' } });
    assert.equal(res.status, 200);
    assert.deepEqual(calls.pop(), ['setAuxLabel', '2', 'Guitar IEM']);
    t('POST /auxes/:n/label calls straight through to the active backend');
  }
  {
    const res = await request('POST', '/api/v1/channels/999/label', { token: TOKEN, headerAuth: true, body: { label: 'Bad' } });
    assert.equal(res.status, 400);
    t('an active backend rejecting a label (invalid channel) surfaces as 400, not a crash');
  }
  {
    const res = await request('POST', '/api/v1/auxes/1/mute', { token: TOKEN, headerAuth: true, body: { channel: 5, muted: true } });
    assert.equal(res.status, 200);
    assert.deepEqual(calls.pop(), ['setMute', '1', 5, true]);
    t('POST /auxes/:n/mute calls straight through to the active backend');
  }
  {
    const res = await request('POST', '/api/v1/auxes/1/solo', { token: TOKEN, headerAuth: true, body: { channel: 5, soloed: true } });
    assert.equal(res.status, 200);
    assert.deepEqual(calls.pop(), ['setSolo', '1', 5, true]);
    t('POST /auxes/:n/solo calls straight through to the active backend');
  }
  {
    const res = await request('POST', '/api/v1/scenes/fire', { token: TOKEN, headerAuth: true, body: { action: 'next' } });
    assert.equal(res.status, 200);
    assert.deepEqual(calls.pop(), ['fireSnapshot', 'next']);
    t('POST /scenes/fire calls straight through to the active backend');
  }
  {
    const res = await request('POST', '/api/v1/scenes/fire', { token: TOKEN, headerAuth: true, body: { action: 'sideways' } });
    assert.equal(res.status, 400);
    t('an invalid snapshot-fire action is rejected with 400, not forwarded');
  }

  // ── Malformed JSON body never crashes the server ────────────────────────
  {
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: PORT, method: 'POST', path: `/api/v1/channels/1/label?token=${TOKEN}`, headers: { 'Content-Type': 'application/json' } },
        (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => resolve({ status: r.statusCode })); }
      );
      req.on('error', reject);
      req.write('{not valid json');
      req.end();
    });
    assert.equal(res.status, 400);
    t('malformed JSON body is rejected with 400, not an uncaught exception');
  }

  // ── Toggling apiEnabled starts/stops the listener live, no console
  // backend restart needed (mockBackend stays set the whole time) ────────
  api.applyConfig({ ...config.getAll(), apiEnabled: false });
  await new Promise((r) => setTimeout(r, 100));
  {
    let failed = false;
    try { await request('GET', '/api/v1/status', { token: TOKEN, headerAuth: true }); }
    catch (_) { failed = true; }
    assert.ok(failed, 'the port should no longer accept connections once apiEnabled is false');
    t('disabling the API in config actually stops the listener');
  }

  api.stop();
  console.log(`\n${n} checks passed`);
}

main().catch((err) => { console.error(err); process.exit(1); });
