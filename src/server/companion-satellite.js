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
//
// The Custom Pages plugin's Companion cards go through it too: Custom Pages
// says which surfaces it wants (setCustomSurfaces, "ev-<page id>"), JPMixer
// asks the Companion plugin for them, and Custom Pages reads them by
// revision (customView: only the buttons changed since the page last asked)
// and presses them (customPress). Only JPMixer's own plugins reach these
// (plugins.js, the "companion" permission). With the Home page surfaces off
// (companionHome: false) Companion is for the custom pages alone: the Home
// pages show their Companion card as off, and their taps go nowhere.

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

let settings = { enabled: false, home: true, host: '', columns: 8, rows: 4 };
let status = null;             // the plugin's getStatus(), as it last shared it
const surfaces = new Map();    // role -> the plugin's snapshot, kept up to date with its key and clear events
const CUSTOM_ROLE = /^ev-[0-9a-f]{10}$/;
const isRole = (role) => Object.hasOwn(ROLES, role) || CUSTOM_ROLE.test(String(role));
let customSurfaces = [];        // what Custom Pages asked for: [{ role, label, columns, rows }]
// Revisions, for Custom Pages: every change gets the next number; a surface
// emptied (a snapshot or a clear) records it, so an older page gets everything
let rev = 0;
const revs = new Map();        // role -> { reset, keys: Map(index -> rev) }
const streams = new Map();     // role -> Set(res)
const pressTimes = new Map();  // address -> recent press times
for (const role of Object.keys(ROLES)) streams.set(role, new Set());

const live = () => settings.enabled && plugins.isRunning('companion');
const homeOff = (role) => Object.hasOwn(ROLES, role) && !settings.home;
const clampInt = (v, [lo, hi], dflt) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : dflt; };

function applyConfig(cfg) {
  const next = { enabled: cfg.companionEnabled === true, home: cfg.companionHome !== false, host: String(cfg.companionHost || '').trim(), columns: clampInt(cfg.companionColumns, LIMITS.columns, 8), rows: clampInt(cfg.companionRows, LIMITS.rows, 4) };
  const was = settings;
  settings = next;
  // Turned off: every page shows it off straight away
  if (was.enabled && !next.enabled) { surfaces.clear(); status = null; rev++; for (const role of Object.keys(ROLES)) broadcast(role, 'snapshot', snapshot(role)); }
  // The Home pages' surfaces turned off or on: theirs show it straight away
  else if (was.home !== next.home) { for (const role of Object.keys(ROLES)) { surfaces.delete(role); broadcast(role, 'snapshot', snapshot(role)); } }
}

// While the plugin isn't running: off, starting, or not installed
function message() {
  if (!settings.enabled) return 'Companion buttons are off.';
  if (!settings.home) return 'Companion buttons are on for Custom Pages only. Turn on Home page surfaces in JPMixer Settings → Plugins → Companion.';
  if (!settings.host) return 'Add the Companion computer’s address in Settings.';
  return require('./integrations').notRunningMessage('companion');
}
function snapshot(role) {
  if (live() && surfaces.has(role) && !homeOff(role)) return surfaces.get(role);
  return { ok: true, enabled: settings.enabled && settings.home && !!settings.host, homeOff: homeOff(role), state: settings.enabled && !homeOff(role) ? 'connecting' : 'off', message: message(), registered: false, locked: false, error: '', columns: settings.columns, rows: settings.rows, keys: [] };
}

// What the plugin shares: each surface's snapshot, key and clear events, and its status
plugins.onShare('companion', (event, data) => {
  // A run that's over (or a new one): nothing from it, and open pages told straight away
  if (event === 'started' || event === 'stopped') {
    status = null; surfaces.clear(); revs.clear(); rev++;
    for (const role of Object.keys(ROLES)) broadcast(role, 'snapshot', snapshot(role));
    // A new run: Custom Pages' surfaces again, once its process is there (this comes just before)
    if (event === 'started') setImmediate(sendEventSurfaces);
    return;
  }
  if (event === 'status' && data && typeof data === 'object') { status = data; rev++; return; }
  // Some of what it shared was dropped: every surface asked for again
  if (event === 'overflow') { resync(); return; }
  if (event !== 'surface' || !data || !isRole(data.role)) return;
  const { role } = data;
  if (homeOff(role)) return; // an older Companion plugin still registers them: not shown
  const r = revs.get(role) || { reset: 0, keys: new Map() };
  revs.set(role, r);
  if (data.event === 'snapshot' && data.data && typeof data.data === 'object') {
    surfaces.set(role, data.data);
    r.reset = ++rev; r.keys.clear();
  } else if (data.event === 'key' && data.data && Number.isInteger(data.data.index)) {
    const s = surfaces.get(role);
    if (s) s.keys = [...s.keys.filter((k) => k.index !== data.data.index), data.data].sort((a, b) => a.index - b.index);
    r.keys.set(data.data.index, ++rev);
  } else if (data.event === 'clear') {
    const s = surfaces.get(role);
    if (s) s.keys = [];
    r.reset = ++rev; r.keys.clear();
  } else return;
  broadcast(role, data.event, data.event === 'clear' ? {} : data.data);
});

async function resync() {
  for (const role of [...(settings.home ? Object.keys(ROLES) : []), ...customSurfaces.map((x) => x.role)]) {
    try {
      const snap = await plugins.callIntegration('companion', 'snapshot', { role });
      if (snap && typeof snap === 'object') {
        surfaces.set(role, snap);
        revs.set(role, { reset: ++rev, keys: new Map() });
        broadcast(role, 'snapshot', snap);
      }
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
    if (live() && !homeOff(role)) {
      try { ok = (await plugins.callIntegration('companion', 'press', { role, key: Number(req.body?.key), pressed: req.body?.pressed === true }, 3000)) === true; } catch (_) { ok = false; }
    }
    res.status(ok ? 200 : 409).json(ok ? { ok: true } : { ok: false, error: 'Companion isn’t connected right now.' });
  });
}

// ── Custom Pages' Companion cards ──
// [{ id: page id, name, columns, rows }] → their surfaces in the Companion plugin
function setCustomSurfaces(list) {
  customSurfaces = (Array.isArray(list) ? list : []).slice(0, 20)
    .filter((p) => p && /^[0-9a-f]{10}$/.test(String(p.id)))
    .map((p) => ({ role: `ev-${p.id}`, label: String(p.name || 'Custom page').slice(0, 40), columns: clampInt(p.columns, [1, 8], 4), rows: clampInt(p.rows, [1, 4], 2) }));
  const keep = new Set(customSurfaces.map((x) => x.role));
  for (const role of [...surfaces.keys()]) if (CUSTOM_ROLE.test(role) && !keep.has(role)) { surfaces.delete(role); revs.delete(role); }
  rev++;
  return sendEventSurfaces();
}
function sendEventSurfaces() {
  if (!plugins.isRunning('companion')) return Promise.resolve(false);
  return plugins.callIntegration('companion', 'extras', { surfaces: customSurfaces }).then(() => true, () => false);
}
// What a custom page shows: { rev, live, note, columns, rows, full, keys }
// (keys: the buttons changed since `since`, or every one if it's older than
// the surface's last reset)
// The Companion buttons plugin before 1.1.0 has no custom pages' surfaces
const tooOld = () => { try { const v = plugins.officialState('companion').version; return !!v && !versionAtLeast(v, '1.1.0'); } catch (_) { return false; } };
function versionAtLeast(v, want) {
  const a = String(v).split('.').map(Number), b = want.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return true;
}
function customView(pageId, since) {
  const role = `ev-${pageId}`;
  const want = customSurfaces.find((x) => x.role === role);
  const installed = plugins.isInstalled('companion');
  const s = live() ? surfaces.get(role) : null;
  const note = !installed ? 'Companion buttons need the Companion buttons plugin (Settings → Plugins → Find plugins).'
    : tooOld() ? 'Update the Companion buttons plugin (Settings → Plugins) to show its buttons on custom pages.'
    : !settings.enabled ? 'Companion buttons are off. Turn them on in Settings → Plugins → Companion.'
      : !settings.host ? 'Add the Companion computer’s address in Settings → Plugins → Companion.'
        : !plugins.isRunning('companion') ? 'The Companion buttons plugin isn’t running right now.'
          : !s ? 'Waiting for Companion…'
            : s.locked ? 'These buttons are locked in Companion.'
              : s.error ? `Companion refused these buttons: ${s.error}`
                : s.state !== 'connected' ? (s.message || 'Companion isn’t connected right now.')
                  : !s.registered ? 'Waiting for Companion…' : '';
  const r = revs.get(role) || { reset: 0, keys: new Map() };
  const full = !Number.isInteger(since) || since <= 0 || since < r.reset;
  const keys = s ? (s.keys || []).filter((k) => full || (r.keys.get(k.index) || 0) > since) : [];
  return { rev, live: !!(s && !note), note, columns: (s && s.columns) || (want && want.columns) || 4, rows: (s && s.rows) || (want && want.rows) || 2, full, keys };
}
async function customPress(pageId, index, pressed) {
  const role = `ev-${pageId}`;
  if (!live() || !customSurfaces.some((x) => x.role === role)) return false;
  try { return (await plugins.callIntegration('companion', 'press', { role, key: Number(index), pressed: pressed === true }, 3000)) === true; } catch (_) { return false; }
}
// For the Custom Pages editor
function customStatus() {
  if (!plugins.isInstalled('companion')) return { state: 'missing', message: 'Install Companion buttons (Settings → Plugins → Find plugins) to put Companion buttons on custom pages.' };
  if (tooOld()) return { state: 'old', message: 'This Companion buttons plugin is too old for custom pages: update it in Settings → Plugins.' };
  if (!settings.enabled) return { state: 'off', message: 'Companion buttons are off: turn them on in Settings → Plugins → Companion (Home page surfaces can stay off).' };
  const st = getStatus();
  return { state: st.state, message: st.message || '' };
}

function getStatus() {
  if (live() && status) return status;
  return { enabled: settings.enabled, state: settings.enabled ? 'connecting' : 'off', message: message(), companionVersion: null, apiVersion: null, surfaces: Object.fromEntries(Object.keys(ROLES).map((r) => [r, { registered: false, locked: false, error: '' }])) };
}

// The plugin stops with the other plugins (plugins.stopAll), dropping the surfaces in Companion
function stop() {}

module.exports = { applyConfig, mountCompanion, getStatus, stop, setCustomSurfaces, customView, customPress, customStatus, ROLES, DEFAULT_PORT, LIMITS };
