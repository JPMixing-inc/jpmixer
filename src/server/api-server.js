'use strict';

// ── External Control API — Companion / Stream Deck / Planning Center ──────
// A standalone, always-on HTTP server, entirely independent of whichever
// console backend (osc/dlive/klang/wing-server.js) is currently active —
// starting, stopping, or restarting the console connection never touches
// this server, and vice versa. That independence is deliberate: a Planning
// Center connector renaming aux mixes ahead of every service can't
// reasonably force a console reconnect each time it runs, and this API
// should stay reachable by Companion/Stream Deck even while the console
// backend itself is between restarts.
//
// Auth: a single bearer token, checked via `Authorization: Bearer <token>`
// or a `?token=` query param — Companion's generic HTTP module and simple
// Stream Deck HTTP actions don't always support setting custom headers, so
// both are accepted. Compared with crypto.timingSafeEqual, not `===`. The
// token is read fresh from config on every request, so regenerating it in
// Settings takes effect immediately with no server restart needed.
//
// No CORS headers are added anywhere here: every intended caller (Companion,
// Stream Deck, a PCO connector script) talks to this server-to-server, not
// from a browser page, so there's no reason to allow cross-origin browser
// access to a token-gated surface that can rename channels/mute mixes.
//
// Business logic (validating a channel/aux number, applying a mute, firing
// a snapshot, relabeling) intentionally lives in whichever backend module
// is active, not here — see setMute/setSolo/fireSnapshot/setChannelLabel/
// setAuxLabel exported from osc-server.js/dlive-server.js/klang-server.js/
// wing-server.js. This file is just an HTTP-shaped front door onto the
// exact same entry points the browser WS handlers already call, so a
// Companion button behaves identically to a mixer page's own mute button.

const express = require('express');
const http = require('http');
const crypto = require('crypto');
const config = require('./config');

let httpServer = null;
let activeBackend = null; // whichever of osc/dlive/klang/wing-server main.js currently has running, or null

// Called by main.js whenever it (re)picks the active console backend, in
// startServer()/stopServer() — keeps this module's view in sync without
// this module needing to know anything about console-type selection itself.
function setActiveBackend(backend) { activeBackend = backend; }

function timingSafeTokenMatch(provided, expected) {
  if (!expected || typeof provided !== 'string' || provided.length === 0) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function authMiddleware(req, res, next) {
  const expected = config.get('apiToken');
  if (!expected) { res.status(503).json({ error: 'Control API token not set — generate one in Settings' }); return; }
  const header = req.headers['authorization'] || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const provided = bearer || req.query.token;
  if (!timingSafeTokenMatch(provided, expected)) { res.status(401).json({ error: 'Unauthorized' }); return; }
  next();
}

function requireBackend(req, res, next) {
  if (!activeBackend) { res.status(503).json({ error: 'No console backend is running' }); return; }
  next();
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', authMiddleware);

  app.get('/api/v1/status', (req, res) => {
    res.json({
      ok: true,
      consoleType: config.get('consoleType'),
      connected: activeBackend ? !!activeBackend.isConsoleConnected() : false,
      channels: config.get('channels'),
      auxes: config.get('auxes'),
    });
  });

  app.get('/api/v1/channels', requireBackend, (req, res) => {
    res.json({ channels: config.get('channelOverrides') || {} });
  });

  app.get('/api/v1/auxes', requireBackend, (req, res) => {
    res.json({ auxes: config.get('auxOverrides') || {} });
  });

  app.post('/api/v1/channels/:n/label', requireBackend, (req, res) => {
    const label = req.body && req.body.label;
    if (typeof label !== 'string') { res.status(400).json({ error: 'label (string) is required' }); return; }
    const ok = activeBackend.setChannelLabel(req.params.n, label);
    if (!ok) { res.status(400).json({ error: 'Invalid channel number' }); return; }
    res.json({ ok: true });
  });

  app.post('/api/v1/auxes/:n/label', requireBackend, (req, res) => {
    const label = req.body && req.body.label;
    if (typeof label !== 'string') { res.status(400).json({ error: 'label (string) is required' }); return; }
    const ok = activeBackend.setAuxLabel(req.params.n, label);
    if (!ok) { res.status(400).json({ error: 'Invalid aux number' }); return; }
    res.json({ ok: true });
  });

  app.post('/api/v1/auxes/:n/mute', requireBackend, (req, res) => {
    const { channel, muted } = req.body || {};
    const ok = activeBackend.setMute(req.params.n, channel, !!muted);
    if (!ok) { res.status(400).json({ error: 'Invalid aux/channel number' }); return; }
    res.json({ ok: true });
  });

  app.post('/api/v1/auxes/:n/solo', requireBackend, (req, res) => {
    const { channel, soloed } = req.body || {};
    const ok = activeBackend.setSolo(req.params.n, channel, !!soloed);
    if (!ok) { res.status(400).json({ error: 'Invalid aux/channel number' }); return; }
    res.json({ ok: true });
  });

  // Relative snapshot navigation only — matches the exact capability the
  // browser mixer UI already has (fire-snapshot's 'prev'/'next' action).
  // There's no "recall snapshot N directly" entry point in any backend
  // today, so this route doesn't claim one either.
  app.post('/api/v1/scenes/fire', requireBackend, (req, res) => {
    const action = req.body && req.body.action;
    if (action !== 'next' && action !== 'prev') { res.status(400).json({ error: "action must be 'next' or 'prev'" }); return; }
    activeBackend.fireSnapshot(action);
    res.json({ ok: true });
  });

  app.use((req, res) => { res.status(404).json({ error: 'Not found' }); });

  // Keeps a thrown error (e.g. malformed JSON body) from leaking a stack
  // trace to an external caller.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[JPMixer/API] request error:', err.message || err);
    res.status(400).json({ error: 'Bad request' });
  });

  return app;
}

function stop() {
  if (httpServer) { try { httpServer.close(); } catch (_) {} httpServer = null; }
}

// Starts/stops/rebinds the listener based on current config — safe to call
// repeatedly (e.g. after every Settings save) without side effects when
// nothing relevant changed. A token change needs no restart at all, since
// authMiddleware reads config.get('apiToken') fresh on every request.
function applyConfig(cfg) {
  const shouldRun = !!cfg.apiEnabled;
  const port = Number.isInteger(cfg.apiPort) && cfg.apiPort > 0 && cfg.apiPort <= 65535 ? cfg.apiPort : 9096;

  if (!shouldRun) { stop(); return; }
  // The phones' port (or port 80's helper): taken by the API first at the
  // next launch, no phone could connect. The API stays off instead.
  if (port === cfg.serverPort || port === 80) {
    console.error(`[JPMixer/API] not started: port ${port} is the phones' port — pick another in Settings`);
    stop(); return;
  }
  if (httpServer && httpServer.__jpmPort === port) return; // already running on the right port
  stop();

  const app = buildApp();
  const server = http.createServer(app);
  server.__jpmPort = port;
  server.on('error', (err) => {
    console.error(`[JPMixer/API] failed to start on port ${port}:`, err.message || err);
    if (httpServer === server) httpServer = null;
  });
  server.listen(port, () => {
    console.log(`[JPMixer/API] Control API listening on http://localhost:${port}`);
  });
  httpServer = server;
}

module.exports = { applyConfig, stop, setActiveBackend };
