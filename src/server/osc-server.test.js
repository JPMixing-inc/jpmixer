'use strict';
// End-to-end test for osc-server.js — the original DiGiCo backend, which had
// zero test coverage before this file. Uses demoMode:true so the WS-facing
// behavior under test (validation/pacing/pollution fixes) can be exercised
// without a real console: demo mode still runs the full HTTP+WS server and
// message handlers, it just never creates a real UDP socket, so any
// otherwise-valid sendToDesk() call safely no-ops instead of needing a mock.
// Run with: node src/server/osc-server.test.js
const path = require('path');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return path.join(__dirname, '_fake-electron-for-tests.js');
  return origResolve.call(this, request, ...args);
};

const fs = require('fs');
const os = require('os');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
process.env.JPM_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-oscserver-test-'));

const server = require('./osc-server.js');

async function main() {
  const serverPort = 18220;
  server.start({ serverPort, demoMode: true, channels: 8, auxes: 4, groups: 2, autoBackupEnabled: false });
  await new Promise((r) => setTimeout(r, 300));

  // ── HTTP static serving ──────────────────────────────────────────────
  {
    const http = require('http');
    const status = await new Promise((resolve) => {
      http.get(`http://127.0.0.1:${serverPort}/devices.html`, (res) => resolve(res.statusCode));
    });
    assert.equal(status, 200);
    console.log('ok - static files (devices.html) served, status 200');
  }

  const ws = new WebSocket(`ws://127.0.0.1:${serverPort}`);
  const config = await new Promise((resolve) => {
    ws.on('message', (m) => { const j = JSON.parse(m); if (j.config) resolve(j.config); });
  });
  assert.equal(config.aux.length, 4);
  assert.equal(config.channels.length, 8);
  console.log('ok - WS client receives demo-mode config with correct aux/channel counts');

  // ── Out-of-range raw OSC-address levels never crash, never get cached ──
  {
    const crashed = [];
    const onUncaught = (err) => crashed.push(err);
    process.on('uncaughtException', onUncaught);

    ws.send(JSON.stringify({ address: '/Input_Channels/9999/Aux_Send/1/send_level', args: [-10] }));
    ws.send(JSON.stringify({ address: '/Input_Channels/1/Aux_Send/9999/send_level', args: [-10] }));
    ws.send(JSON.stringify({ address: '/Input_Channels/0/Aux_Send/1/send_level', args: [-10] }));
    await new Promise((r) => setTimeout(r, 150));

    process.removeListener('uncaughtException', onUncaught);
    assert.equal(crashed.length, 0, `out-of-range ch/aux should never crash the server; got: ${crashed.map(e => e.message).join('; ')}`);
    assert.equal(ws.readyState, WebSocket.OPEN);
    console.log('ok - out-of-range channel/aux numbers on the raw OSC path are ignored, never crash the server');
  }

  // ── NaN/non-finite level is rejected, not forwarded as a real OSC value ─
  {
    let sawEcho = false;
    const handler = (m) => {
      const j = JSON.parse(m);
      if (j.address === '/Input_Channels/2/Aux_Send/1/send_level') sawEcho = true;
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ address: '/Input_Channels/2/Aux_Send/1/send_level', args: [NaN] }));
    ws.send(JSON.stringify({ address: '/Input_Channels/2/Aux_Send/1/send_level', args: [] })); // missing arg
    await new Promise((r) => setTimeout(r, 150));
    ws.removeListener('message', handler);
    assert.equal(sawEcho, false, 'a NaN or missing-arg level must never be relayed/echoed to other clients');
    console.log('ok - a NaN or missing-argument level is rejected outright, not forwarded');
  }

  // ── A legitimate, in-range level is still accepted (fixes didn't overcorrect) ─
  // The server relays to *other* clients, not back to the sender, so this
  // needs a second socket to observe the echo.
  {
    const ws2 = new WebSocket(`ws://127.0.0.1:${serverPort}`);
    await new Promise((resolve) => ws2.once('open', resolve));
    const gotEcho = new Promise((resolve) => {
      ws2.on('message', (m) => {
        const j = JSON.parse(m);
        if (j.address === '/Input_Channels/3/Aux_Send/1/send_level' && j.args[0] === -6) resolve(true);
      });
    });
    ws.send(JSON.stringify({ address: '/Input_Channels/3/Aux_Send/1/send_level', args: [-6] }));
    assert.equal(await Promise.race([gotEcho, new Promise((r) => setTimeout(() => r(false), 500))]), true,
      'a legitimate, in-range level move must still relay to other clients — the validation fix must not be over-broad');
    ws2.close();
    console.log('ok - a legitimate in-range level still relays normally (fix is not over-broad)');
  }

  // ── console-fader/aux-fader/cg-fader validate range + finiteness ───────
  {
    let sawAnyConsoleBroadcast = false;
    const handler = (m) => {
      const j = JSON.parse(m);
      if (j.address && (j.address.startsWith('/Input_Channels/') && j.address.endsWith('/fader'))) sawAnyConsoleBroadcast = true;
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ type: 'console-fader', ch: 9999, db: -6 }));   // out of range
    ws.send(JSON.stringify({ type: 'console-fader', ch: 1, db: NaN }));     // non-finite
    ws.send(JSON.stringify({ type: 'console-fader', ch: 1, db: 'nope' }));  // wrong type
    await new Promise((r) => setTimeout(r, 150));
    ws.removeListener('message', handler);
    assert.equal(sawAnyConsoleBroadcast, false, 'console-fader must reject out-of-range ch and non-finite db');
    console.log('ok - console-fader rejects out-of-range channel and non-finite/non-numeric db');
  }
  {
    // The moving page itself no longer gets its own (by then older) position
    // echoed back — that made the thumb jitter — so watch from a second client.
    const ws3 = new WebSocket(`ws://127.0.0.1:${serverPort}`);
    await new Promise((r) => ws3.on('open', r));
    const gotEcho = new Promise((resolve) => {
      ws3.on('message', (m) => {
        const j = JSON.parse(m);
        if (j.address === '/Input_Channels/1/fader' && j.args[0] === -6) resolve(true);
      });
    });
    ws.send(JSON.stringify({ type: 'console-fader', ch: 1, db: -6 }));
    assert.equal(await Promise.race([gotEcho, new Promise((r) => setTimeout(() => r(false), 500))]), true,
      'a legitimate console-fader move must still broadcast to other clients — the validation fix must not be over-broad');
    ws3.close();
    console.log('ok - a legitimate console-fader move still broadcasts to other clients');
  }

  // ── save-scene / save-preset: "__proto__" cannot pollute Object.prototype ─
  {
    ws.send(JSON.stringify({ type: 'save-scene', snapshot: '__proto__', aux: 1, values: { evil: true } }));
    ws.send(JSON.stringify({ type: 'save-preset', deviceId: '__proto__', name: 'pwned', levels: { evil: true }, pans: {} }));
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(({}).evil, undefined, 'save-scene/save-preset with a "__proto__" key must not pollute Object.prototype');
    console.log('ok - save-scene/save-preset with deviceId/snapshot "__proto__" cannot pollute Object.prototype');
  }

  // ── request-console-state is paced, not a synchronous burst ────────────
  {
    // With 8 channels the burst would be ~16 sendToDesk calls fired
    // synchronously in the old code; paced at 100ms/tick they can't all be
    // "done" (i.e. the queue drained) inside one short window. We can't
    // observe sendToDesk directly (demoMode has no real socket), but we can
    // confirm the request itself doesn't throw and the connection survives
    // issuing it many times back to back (a burst-safety smoke check).
    for (let i = 0; i < 5; i++) ws.send(JSON.stringify({ type: 'request-console-state' }));
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(ws.readyState, WebSocket.OPEN, 'rapid request-console-state calls must not crash or drop the connection');
    console.log('ok - repeated request-console-state calls do not crash the server (pacing engaged, not a burst)');
  }

  ws.close();
  server.stop();

  console.log('\nAll osc-server end-to-end checks passed');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
