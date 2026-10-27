'use strict';

// ── Companion buttons on the Home pages ────────────────────────────────────
// Companion buttons are a plugin now (plugins/companion: the Satellite
// connection to Bitfocus Companion is there, in a process of its own, with
// one button surface per Home page). JPMixer still serves the pages, from
// the surfaces the plugin shares, and passes their taps to it:
//
//   GET  /companion/state?role=foh   the surface now (status, grid, every key)
//   GET  /companion/stream?role=foh  Server-Sent Events: snapshot, key, clear
//   POST /companion/press            { role, key, pressed }
//
// A stream, like the chat card's, so a Home page isn't counted as a mixing
// device. FOH's surface is behind its access code like the rest of FOH Home.
// Its settings are still the config's (Settings → Pages → Companion buttons;
// integrations.js hands them to the plugin).

const express = require('express');
const plugins = require('./plugins');

const ROLES = {
  foh: 'FOH Home',
  propresenter: 'ProPresenter Home',
  lighting: 'Lighting Home',
  switcher: 'Switcher Home',
};
const DEFAULT_PORT = 16622;
const LIMITS = { columns: [1, 12], rows: [1, 8] };
const PRESS_LIMIT = 30, PRESS_WINDOW_MS = 1000; // per device address

let settings = { enabled: false, host: '', columns: 8, rows: 4 };
let status = null;             // the plugin's getStatus(), as it last shared it
const surfaces = new Map();    // role -> the plugin's snapshot, kept up to date with its key and clear events
const streams = new Map();     // role -> Set(res)
const pressTimes = new Map();  // address -> recent press times
for (const role of Object.keys(ROLES)) streams.set(role, new Set());

const live = () => settings.enabled && plugins.isRunning('companion');
const clampInt = (v, [lo, hi], dflt) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : dflt; };

function applyConfig(cfg) {
  const next = { enabled: cfg.companionEnabled === true, host: String(cfg.companionHost || '').trim(), columns: clampInt(cfg.companionColumns, LIMITS.columns, 8), rows: clampInt(cfg.companionRows, LIMITS.rows, 4) };
  const was = settings.enabled;
  settings = next;
  // Turned off: every page shows it off straight away
  if (was && !next.enabled) { surfaces.clear(); status = null; for (const role of Object.keys(ROLES)) broadcast(role, 'snapshot', snapshot(role)); }
}

// While the plugin isn't running: off, starting, or not installed
function message() {
  if (!settings.enabled) return 'Companion buttons are off.';
  if (!settings.host) return 'Add the Companion computer’s address in Settings.';
  return require('./integrations').notRunningMessage('companion');
}
function snapshot(role) {
  if (live() && surfaces.has(role)) return surfaces.get(role);
  return { ok: true, enabled: settings.enabled && !!settings.host, state: settings.enabled ? 'connecting' : 'off', message: message(), registered: false, locked: false, error: '', columns: settings.columns, rows: settings.rows, keys: [] };
}

// What the plugin shares: each surface's snapshot, key and clear events, and its status
plugins.onShare('companion', (event, data) => {
  // A run that's over (or a new one): nothing from it, and open pages told straight away
  if (event === 'started' || event === 'stopped') { status = null; surfaces.clear(); for (const role of Object.keys(ROLES)) broadcast(role, 'snapshot', snapshot(role)); return; }
  if (event === 'status' && data && typeof data === 'object') { status = data; return; }
  // Some of what it shared was dropped: every surface asked for again
  if (event === 'overflow') { resync(); return; }
  if (event !== 'surface' || !data || !Object.hasOwn(ROLES, data.role)) return;
  const { role } = data;
  if (data.event === 'snapshot' && data.data && typeof data.data === 'object') {
    surfaces.set(role, data.data);
  } else if (data.event === 'key' && data.data && Number.isInteger(data.data.index)) {
    const s = surfaces.get(role);
    if (s) s.keys = [...s.keys.filter((k) => k.index !== data.data.index), data.data].sort((a, b) => a.index - b.index);
  } else if (data.event === 'clear') {
    const s = surfaces.get(role);
    if (s) s.keys = [];
  } else return;
  broadcast(role, data.event, data.event === 'clear' ? {} : data.data);
});

async function resync() {
  for (const role of Object.keys(ROLES)) {
    try {
      const snap = await plugins.callIntegration('companion', 'snapshot', { role });
      if (snap && typeof snap === 'object') { surfaces.set(role, snap); broadcast(role, 'snapshot', snap); }
    } catch (_) { /* not running: its 'stopped' clears the pages */ }
  }
}

function broadcast(role, event, data) {
  const set = streams.get(role);
  if (!set || !set.size) return;
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) { try { res.write(frame); } catch (_) { set.delete(res); } }
}

function tooFast(addr) {
  const now = Date.now();
  if (pressTimes.size > 500) for (const [k, times] of pressTimes) if (!times.length || now - times[times.length - 1] > PRESS_WINDOW_MS) pressTimes.delete(k);
  const times = (pressTimes.get(addr) || []).filter(t => now - t < PRESS_WINDOW_MS);
  times.push(now);
  pressTimes.set(addr, times);
  return times.length > PRESS_LIMIT;
}

let keepAlive = null;
// canUse(req, role): false keeps a page out (FOH's access code)
function mountCompanion(app, { canUse = () => true } = {}) {
  // A newly started server takes over: streams still open on the previous one reconnect here
  for (const set of streams.values()) { for (const res of set) { try { res.end(); } catch (_) {} } set.clear(); }
  if (!keepAlive) {
    keepAlive = setInterval(() => { for (const set of streams.values()) for (const res of set) { try { res.write(': keepalive\n\n'); } catch (_) { set.delete(res); } } }, 25000);
    keepAlive.unref?.();
  }
  const roleOf = (req, res) => {
    const role = String(req.query.role || req.body?.role || '');
    if (!Object.hasOwn(ROLES, role)) { res.status(400).json({ ok: false, error: 'Unknown page.' }); return null; }
    if (!canUse(req, role)) { res.status(401).json({ ok: false, needCode: true }); return null; }
    return role;
  };

  app.get('/companion/state', (req, res) => {
    const role = roleOf(req, res);
    if (!role) return;
    res.set('Cache-Control', 'no-store');
    res.json(snapshot(role));
  });

  app.get('/companion/stream', (req, res) => {
    const role = roleOf(req, res);
    if (!role) return;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot(role))}\n\n`);
    streams.get(role).add(res);
    req.on('close', () => streams.get(role).delete(res));
  });

  app.post('/companion/press', express.json({ limit: '1kb' }), async (req, res) => {
    const role = roleOf(req, res);
    if (!role) return;
    const addr = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    if (tooFast(addr)) { res.status(429).json({ ok: false, error: 'Too many presses — slow down a little.' }); return; }
    let ok = false;
    if (live()) {
      try { ok = (await plugins.callIntegration('companion', 'press', { role, key: Number(req.body?.key), pressed: req.body?.pressed === true }, 3000)) === true; } catch (_) { ok = false; }
    }
    res.status(ok ? 200 : 409).json(ok ? { ok: true } : { ok: false, error: 'Companion isn’t connected right now.' });
  });
}

function getStatus() {
  if (live() && status) return status;
  return { enabled: settings.enabled, state: settings.enabled ? 'connecting' : 'off', message: message(), companionVersion: null, apiVersion: null, surfaces: Object.fromEntries(Object.keys(ROLES).map((r) => [r, { registered: false, locked: false, error: '' }])) };
}

// The plugin stops with the other plugins (plugins.stopAll), dropping the surfaces in Companion
function stop() {}

module.exports = { applyConfig, mountCompanion, getStatus, stop, ROLES, DEFAULT_PORT, LIMITS };
