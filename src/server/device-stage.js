'use strict';

// ── Devices page stage arrangement, shared by every browser ─────────────────
// The Devices page's stage (where each phone's card sits, which auxes are
// hidden in the Phantom editor, how tall the stage is) is saved here on this
// computer, so any computer or iPad that opens the Devices page shows the
// same arrangement. Stored in device-stage.json:
//   { [signature]: { positions: { key: { x, y } }, hiddenAuxes: [n], height, rev, savedAt } }
// `signature` is the console's aux count, as the page has always keyed it:
// a console with a different number of mixes keeps its own arrangement.
// Position keys are a phone's device id or "stage-aux:N"; x and y are
// fractions of the stage. Whether a browser shows Stage or Grid stays with
// that browser. Open Devices pages hear about a save on /device-stage/stream
// and redraw.

const path = require('path');
const express = require('express');
const { app } = require('electron');
const { writeFileAtomic, loadJsonObject } = require('./safe-write');
const { toNullProto } = require('./safe-object');

const SIGNATURE = /^\d{1,3}$/;
const KEY = /^[A-Za-z0-9_:.-]{1,80}$/;
const MAX_POSITIONS = 300;

let store = Object.create(null);
let loaded = false;
const file = () => path.join(app.getPath('userData'), 'device-stage.json');
const streams = new Set();

function load() {
  if (loaded) return;
  loaded = true;
  const data = loadJsonObject(file(), app.getPath('userData'), 'deviceStage', (msg) => console.error('[JPMixer] ' + msg));
  if (data) store = toNullProto(data);
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// A clean copy of an arrangement, or null if it isn't one. Cards of phones
// without a device id ("anon-…") are left out: their key isn't the same on
// the next connection, let alone on another computer.
function clean(layout) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return null;
  const positions = {};
  const source = layout.positions && typeof layout.positions === 'object' && !Array.isArray(layout.positions) ? layout.positions : {};
  for (const [key, point] of Object.entries(source).slice(0, MAX_POSITIONS)) {
    if (!KEY.test(key) || key.startsWith('anon-') || !point || typeof point !== 'object') continue;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    positions[key] = { x: clamp01(point.x), y: clamp01(point.y) };
  }
  const hiddenAuxes = Array.isArray(layout.hiddenAuxes)
    ? [...new Set(layout.hiddenAuxes.filter((n) => Number.isInteger(n) && n >= 1 && n <= 256))].slice(0, 256)
    : [];
  const height = Number.isInteger(layout.height) && layout.height >= 720 && layout.height <= 20000 ? layout.height : 720;
  return { positions, hiddenAuxes, height };
}

function get(signature) {
  load();
  if (!SIGNATURE.test(String(signature))) return null;
  return store[signature] || null;
}

// Saves an arrangement; returns the saved entry, or null if it isn't valid
function set(signature, layout) {
  load();
  const sig = String(signature);
  const cleaned = SIGNATURE.test(sig) ? clean(layout) : null;
  if (!cleaned) return null;
  const entry = { ...cleaned, rev: ((store[sig] && store[sig].rev) || 0) + 1, savedAt: new Date().toISOString() };
  const previous = store[sig];
  store[sig] = entry;
  try { writeFileAtomic(file(), JSON.stringify(store)); }
  catch (e) {
    console.error('[JPMixer] could not save the Devices stage:', e.message);
    if (previous) store[sig] = previous; else delete store[sig];
    return null;
  }
  return entry;
}

function announce(signature, entry, by) {
  const frame = `event: layout\ndata: ${JSON.stringify({ signature: String(signature), rev: entry.rev, by })}\n\n`;
  for (const res of streams) { try { res.write(frame); } catch (_) { streams.delete(res); } }
}

let keepAlive = null;
function mountDeviceStage(appExpress) {
  // A newly started server takes over the streams, as chat.js does
  for (const res of streams) { try { res.end(); } catch (_) {} }
  streams.clear();
  if (!keepAlive) {
    keepAlive = setInterval(() => { for (const res of streams) { try { res.write(': keepalive\n\n'); } catch (_) { streams.delete(res); } } }, 25000);
    if (keepAlive.unref) keepAlive.unref();
  }

  appExpress.get('/device-stage', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const sig = String(req.query.signature || '');
    if (!SIGNATURE.test(sig)) { res.status(400).json({ ok: false, error: 'Unknown stage.' }); return; }
    res.json({ ok: true, layout: get(sig) });
  });

  appExpress.post('/device-stage', express.json({ limit: '64kb' }), (req, res) => {
    const sig = String(req.body?.signature || '');
    const entry = set(sig, req.body?.layout);
    if (!entry) { res.status(400).json({ ok: false, error: 'That arrangement couldn’t be saved.' }); return; }
    announce(sig, entry, String(req.body?.clientId || '').slice(0, 40));
    res.json({ ok: true, rev: entry.rev });
  });

  appExpress.get('/device-stage/stream', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    streams.add(res);
    req.on('close', () => streams.delete(res));
  });
}

module.exports = { mountDeviceStage, clean, get, set, getAll: () => { load(); return { ...store }; }, _reset: () => { store = Object.create(null); loaded = false; } };
