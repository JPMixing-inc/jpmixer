'use strict';
// Team chat clears itself when the service moves on: when Planning Center's
// current plan changes, history empties and every open chat card is told.
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
process.env.JPM_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-chat-test-'));
const express = require('express');
const config = require('./config');
const chat = require('./chat');
const pco = require('./pco-client');

const request = (port, method, urlPath, body) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} }, (res) => {
    let text = ''; res.on('data', (c) => (text += c)); res.on('end', () => resolve(JSON.parse(text)));
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});

test('the chat clears when the next service’s plan takes over, and only then', async () => {
  config.save({ ...config.getAll(), pcoAppId: 'app', pcoSecret: 'secret', pcoServiceTypeId: '1' });
  let planId = 'sat', reachable = true;
  const origFetch = global.fetch;
  global.fetch = async (url) => {
    if (!reachable) throw new Error('offline');
    if (String(url).includes('/plans?')) return { ok: true, text: async () => JSON.stringify({ data: [{ id: planId, attributes: { sort_date: '2999-01-01T00:00:00Z', title: planId === 'sat' ? 'Saturday Night' : 'Sunday Morning' } }] }) };
    return { ok: true, text: async () => JSON.stringify({ data: [] }) };
  };
  const app = express(); chat.mountChat(app);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const fresh = async () => { pco.shared.clear(); await chat.checkPlan(); };
  try {
    chat.reset(); await fresh();
    await request(port, 'POST', '/chat/send', { role: 'foh', name: 'Chris', text: 'Pastor on headset tonight' });
    const before = await request(port, 'GET', '/chat/history');
    assert.equal(before.messages.length, 1);

    // An open chat card listening for the clear
    const heard = new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port, path: '/chat/stream' }, (res) => {
        let text = ''; res.on('data', (c) => { text += c; const m = text.match(/event: clear\ndata: (.+)\n/); if (m) { res.destroy(); resolve(JSON.parse(m[1])); } });
      });
    });
    await new Promise((r) => setTimeout(r, 50));

    await fresh(); // same plan: nothing happens
    assert.equal((await request(port, 'GET', '/chat/history')).messages.length, 1, 'same plan keeps the chat');

    reachable = false; planId = 'sun'; await fresh();
    assert.equal((await request(port, 'GET', '/chat/history')).messages.length, 1, 'Planning Center unreachable: nothing cleared');

    reachable = true; await fresh();
    const after = await request(port, 'GET', '/chat/history');
    assert.equal(after.messages.length, 0, 'next plan: chat cleared');
    assert.notEqual(after.generation, before.generation, 'a page that missed the clear can tell');
    const msg = await heard;
    assert.equal(msg.generation, after.generation);
    assert.equal(msg.reason, 'Sunday Morning');
  } finally { global.fetch = origFetch; server.close(); }
});
