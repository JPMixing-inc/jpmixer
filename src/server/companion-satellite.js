'use strict';

// ── Companion buttons on the Home pages, via the Satellite API ─────────────
// JPMixer connects to Bitfocus Companion as a Satellite client and registers
// one button surface per Home page: "JPMixer FOH Home", "JPMixer Lighting
// Home" and so on. In Companion each shows up under Surfaces, where it can be
// given its own page — so the Lighting card shows lighting buttons. Button
// images reach the pages live and taps on the pages press the button in
// Companion, the same as a Stream Deck.
//
// Protocol: https://companion.free/for-developers/Satellite-API — line-based
// text over TCP (default port 16622). One connection carries all four
// surfaces. Mounted from mountFoh(), so it's on every console backend; the
// connection itself lives in this module and survives server restarts.
//
//   GET  /companion/state?role=foh   the surface now (status, grid, every key)
//   GET  /companion/stream?role=foh  Server-Sent Events: snapshot, key, clear
//   POST /companion/press            { role, key, pressed }
//
// A stream, like the chat card's, so a Home page isn't counted as a mixing
// device. FOH's surface is behind its access code like the rest of FOH Home.

const net = require('net');
const os = require('os');
const express = require('express');

const ROLES = {
  foh: 'FOH Home',
  propresenter: 'ProPresenter Home',
  lighting: 'Lighting Home',
  switcher: 'Switcher Home',
};
const DEFAULT_PORT = 16622;
const LIMITS = { columns: [1, 12], rows: [1, 8] };
const PING_MS = 2000;          // the API asks clients to ping about every 2 s
const SILENT_MS = 10000;       // no reply at all for this long: reconnect
const RETRY_MS = 5000;
const CAPS_WAIT_MS = 600;      // CAPS follows BEGIN on 1.10+; older servers never send it
const HOLD_MAX_MS = 20000;     // a press with no release (page closed mid-tap) is let go
const PRESS_LIMIT = 30, PRESS_WINDOW_MS = 1000; // per device address

let settings = { enabled: false, host: '', port: DEFAULT_PORT, columns: 8, rows: 4 };
let socket = null;
let buffer = '';
let retryTimer = null, pingTimer = null, capsTimer = null;
let lastHeard = 0;
let server = { apiVersion: null, companionVersion: null, caps: {} };
let state = 'off';             // off | connecting | connected | error
let message = 'Companion buttons are off.';
const surfaces = new Map();    // role -> { registered, locked, keys: Map(index -> key) }
const streams = new Map();     // role -> Set(res)
const held = new Map();        // `${role}:${key}` -> timer
const pressTimes = new Map();  // address -> recent press times
let bitmapSize = 72;

for (const role of Object.keys(ROLES)) { surfaces.set(role, freshSurface()); streams.set(role, new Set()); }
function freshSurface() { return { registered: false, locked: false, error: '', keys: new Map() }; }

const clampInt = (v, [lo, hi], dflt) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : dflt; };
const versionAtLeast = (v, want) => {
  const a = String(v || '0').split('.').map(Number), b = want.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); }
  return true;
};
// A Satellite "serial" stays the same across restarts, so Companion keeps
// each surface's page. The computer's name keeps two JPMixers apart.
const hostTag = () => os.hostname().replace(/\.local$/i, '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 24) || 'mac';
const deviceId = (role) => `jpmixer-${role}`;
const roleFromDevice = (id) => { const m = /^jpmixer-([a-z]+)$/.exec(String(id || '')); return m && ROLES[m[1]] ? m[1] : null; };
const keyCount = () => settings.columns * settings.rows;

// ── Connection ──────────────────────────────────────────────────────────

function applyConfig(cfg) {
  const next = {
    enabled: cfg.companionEnabled === true,
    host: String(cfg.companionHost || '').trim(),
    port: clampInt(cfg.companionPort, [1, 65535], DEFAULT_PORT),
    columns: clampInt(cfg.companionColumns, LIMITS.columns, 8),
    rows: clampInt(cfg.companionRows, LIMITS.rows, 4),
  };
  const changed = JSON.stringify(next) !== JSON.stringify(settings);
  settings = next;
  if (!settings.enabled || !settings.host) {
    disconnect();
    setStatus('off', settings.enabled ? 'Add the Companion computer’s address in Settings.' : 'Companion buttons are off.');
    return;
  }
  if (changed || !socket) { disconnect(); connect(); }
}

function connect() {
  clearTimeout(retryTimer);
  setStatus('connecting', `Connecting to Companion at ${settings.host}:${settings.port}…`);
  buffer = '';
  server = { apiVersion: null, companionVersion: null, caps: {} };
  const sock = net.createConnection({ host: settings.host, port: settings.port });
  socket = sock;
  sock.setNoDelay(true);
  sock.setKeepAlive(true, 5000);
  sock.setEncoding('utf8');
  sock.setTimeout(8000, () => { if (sock === socket && !server.apiVersion) sock.destroy(new Error('No answer from Companion.')); });
  sock.on('data', (chunk) => { if (sock === socket) onData(chunk); });
  sock.on('error', (err) => { if (sock === socket) setStatus('error', describeError(err)); });
  sock.on('close', () => {
    if (sock !== socket) return;
    socket = null;
    stopTimers();
    resetSurfaces();
    if (state !== 'error') setStatus('error', 'Lost the connection to Companion. Trying again…');
    if (settings.enabled && settings.host) retryTimer = setTimeout(connect, RETRY_MS);
  });
}

function describeError(err) {
  const code = err && err.code;
  if (code === 'ECONNREFUSED') return `Companion isn’t accepting Satellite connections at ${settings.host}:${settings.port}. Check that Companion is running and the port matches.`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `Can’t find ${settings.host} on the network.`;
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'ETIMEDOUT') return `Can’t reach ${settings.host}. Check that both computers are on the same network.`;
  return (err && err.message) || 'Couldn’t connect to Companion.';
}

function disconnect() {
  clearTimeout(retryTimer);
  stopTimers();
  if (socket) {
    const sock = socket;
    socket = null;
    try { sock.end('QUIT\n'); } catch (_) {}
    setTimeout(() => { try { sock.destroy(); } catch (_) {} }, 500).unref?.();
  }
  resetSurfaces();
}
function stopTimers() {
  clearInterval(pingTimer); pingTimer = null;
  clearTimeout(capsTimer); capsTimer = null;
  for (const t of held.values()) clearTimeout(t);
  held.clear();
}
function resetSurfaces() {
  for (const role of Object.keys(ROLES)) {
    surfaces.set(role, freshSurface());
    broadcast(role, 'snapshot', snapshot(role));
  }
}

function send(line) {
  if (!socket || socket.destroyed) return false;
  try { socket.write(line + '\n'); return true; } catch (_) { return false; }
}

// ── Messages from Companion ─────────────────────────────────────────────

function onData(chunk) {
  lastHeard = Date.now();
  buffer += chunk;
  if (buffer.length > 8 * 1024 * 1024) { buffer = ''; socket?.destroy(new Error('Companion sent an oversized message.')); return; }
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).replace(/\r$/, '');
    buffer = buffer.slice(nl + 1);
    if (line) { try { onLine(line); } catch (err) { console.error('[JPMixer] Companion message error:', err); } }
  }
}

// COMMAND ARG=VAL ARG2="with spaces"  (values may be quoted)
function parse(line) {
  const space = line.indexOf(' ');
  const command = space === -1 ? line : line.slice(0, space);
  const rest = space === -1 ? '' : line.slice(space + 1);
  const args = {};
  const re = /([A-Za-z_]+)=("((?:[^"\\]|\\.)*)"|\S*)/g;
  let m;
  while ((m = re.exec(rest))) args[m[1]] = m[3] !== undefined ? m[3].replace(/\\(.)/g, '$1') : m[2];
  const result = /^(OK|ERROR)\b/.exec(rest);
  return { command, args, result: result ? result[1] : null };
}

function onLine(line) {
  const { command, args, result } = parse(line);
  switch (command) {
    case 'BEGIN':
      server.apiVersion = args.ApiVersion || '1.0.0';
      server.companionVersion = args.CompanionVersion || '';
      socket?.setTimeout(0);
      startPing();
      // 1.10+ sends CAPS straight after; wait for it (briefly) before registering
      if (versionAtLeast(server.apiVersion, '1.10.0')) capsTimer = setTimeout(registerAll, CAPS_WAIT_MS);
      else registerAll();
      return;
    case 'CAPS':
      server.caps = {
        formats: String(args.BITMAP_FORMATS || 'rgb').split(',').map(s => s.trim()).filter(Boolean),
      };
      if (capsTimer) { clearTimeout(capsTimer); capsTimer = null; registerAll(); }
      return;
    case 'PING': send('PONG ' + line.slice(5)); return;
    case 'PONG': return;
    case 'ADD-DEVICE': {
      const role = roleFromDevice(args.DEVICEID);
      if (!role) return;
      const surface = surfaces.get(role);
      if (result === 'OK') { surface.registered = true; surface.error = ''; }
      else { surface.registered = false; surface.error = args.MESSAGE || 'Companion refused this surface.'; }
      updateConnectedStatus();
      broadcast(role, 'snapshot', snapshot(role));
      return;
    }
    case 'KEY-STATE': return onKeyState(args);
    case 'KEYS-CLEAR': {
      const role = roleFromDevice(args.DEVICEID);
      if (!role) return;
      surfaces.get(role).keys.clear();
      broadcast(role, 'clear', {});
      return;
    }
    case 'LOCKED-STATE': {
      const role = roleFromDevice(args.DEVICEID);
      if (!role) return;
      surfaces.get(role).locked = args.LOCKED === '1' || args.LOCKED === 'true';
      broadcast(role, 'snapshot', snapshot(role));
      return;
    }
    case 'ERROR':
      if (args.DEVICEID) {
        const role = roleFromDevice(args.DEVICEID);
        if (role && !surfaces.get(role).registered) { surfaces.get(role).error = args.MESSAGE || 'Companion refused this surface.'; updateConnectedStatus(); }
      }
      return;
    default:
      return; // BRIGHTNESS, DEVICE-CONFIG, VARIABLE-VALUE, OK replies: nothing to show
  }
}

function startPing() {
  clearInterval(pingTimer);
  pingTimer = setInterval(() => {
    if (Date.now() - lastHeard > SILENT_MS) { socket?.destroy(new Error('Companion stopped answering.')); return; }
    send('PING jpm');
  }, PING_MS);
  pingTimer.unref?.();
}

function registerAll() {
  capsTimer = null;
  const png = (server.caps.formats || []).includes('png') && versionAtLeast(server.apiVersion, '1.12.0');
  bitmapSize = png ? 96 : 72;
  // Before API 1.5.1 a surface could have at most 32 keys
  const total = versionAtLeast(server.apiVersion, '1.5.1') ? keyCount() : Math.min(32, keyCount());
  const columns = Math.min(settings.columns, total);
  const tag = hostTag();
  for (const [role, label] of Object.entries(ROLES)) {
    const parts = [
      'ADD-DEVICE', `DEVICEID=${deviceId(role)}`, `PRODUCT_NAME="JPMixer ${label}"`,
      `KEYS_TOTAL=${total}`, `KEYS_PER_ROW=${columns}`,
      `BITMAPS=${versionAtLeast(server.apiVersion, '1.5.0') ? bitmapSize : 'true'}`,
      'COLORS=hex', 'TEXT=true', 'TEXT_STYLE=true',
    ];
    if (versionAtLeast(server.apiVersion, '1.7.0')) parts.push('BRIGHTNESS=false');
    if (versionAtLeast(server.apiVersion, '1.10.0')) parts.push(`SERIAL=jpmixer:${tag}:${role}`);
    if (png) parts.push('BITMAP_FORMAT=png');
    send(parts.join(' '));
  }
  updateConnectedStatus();
}

function onKeyState(args) {
  const role = roleFromDevice(args.DEVICEID);
  if (!role) return;
  let index = Number.NaN;
  if (/^\d+$/.test(args.KEY || '')) index = Number(args.KEY);
  else if (/^\d+\/\d+$/.test(args.KEY || '')) { const [r, c] = args.KEY.split('/').map(Number); index = r * settings.columns + c; }
  if (!Number.isInteger(index) || index < 0 || index >= keyCount()) return;
  const surface = surfaces.get(role);
  const prev = surface.keys.get(index) || {};
  const key = {
    index,
    type: args.TYPE || prev.type || 'BUTTON',
    bitmap: args.BITMAP !== undefined ? args.BITMAP : prev.bitmap || '',
    size: bitmapSize,
    color: safeColor(args.COLOR !== undefined ? args.COLOR : prev.color),
    textColor: safeColor(args.TEXTCOLOR !== undefined ? args.TEXTCOLOR : prev.textColor),
    text: args.TEXT !== undefined ? decodeText(args.TEXT) : prev.text || '',
    fontSize: args.FONT_SIZE !== undefined ? Number(args.FONT_SIZE) || 0 : prev.fontSize || 0,
    pressed: args.PRESSED === '1' || args.PRESSED === 'true',
  };
  // Only images Companion produces: a bare base64 RGB buffer, or a data: URL of a PNG/WebP
  if (key.bitmap && !/^data:image\/(png|webp);base64,[A-Za-z0-9+/=]+$/.test(key.bitmap) && !/^[A-Za-z0-9+/=]+$/.test(key.bitmap)) key.bitmap = '';
  surface.keys.set(index, key);
  broadcast(role, 'key', key);
}
function safeColor(value) {
  const v = String(value || '');
  return /^#[0-9a-f]{3,8}$/i.test(v) || /^rgba?\([\d.,%]+\)$/i.test(v) ? v : '';
}
function decodeText(b64) {
  try { return Buffer.from(String(b64), 'base64').toString('utf8').slice(0, 200); } catch (_) { return ''; }
}

function updateConnectedStatus() {
  if (!socket) return;
  const refused = [...surfaces.entries()].filter(([, s]) => s.error);
  if (refused.length === Object.keys(ROLES).length) setStatus('error', `Companion refused the surfaces: ${refused[0][1].error}`);
  else setStatus('connected', `Connected to Companion${server.companionVersion ? ' ' + server.companionVersion : ''} at ${settings.host}.`);
}
function setStatus(next, text) {
  const changed = next !== state || text !== message;
  state = next; message = text;
  if (changed) for (const role of Object.keys(ROLES)) broadcast(role, 'snapshot', snapshot(role));
}

// ── Presses from the pages ───────────────────────────────────────────────

function press(role, index, pressed) {
  const surface = surfaces.get(role);
  if (!surface || !surface.registered || surface.locked) return false;
  if (!Number.isInteger(index) || index < 0 || index >= keyCount()) return false;
  const id = `${role}:${index}`;
  clearTimeout(held.get(id));
  held.delete(id);
  if (pressed) {
    const t = setTimeout(() => { held.delete(id); send(`KEY-PRESS DEVICEID=${deviceId(role)} KEY=${index} PRESSED=false`); }, HOLD_MAX_MS);
    t.unref?.();
    held.set(id, t);
  }
  return send(`KEY-PRESS DEVICEID=${deviceId(role)} KEY=${index} PRESSED=${pressed ? 'true' : 'false'}`);
}

function tooFast(addr) {
  const now = Date.now();
  if (pressTimes.size > 500) for (const [k, times] of pressTimes) if (!times.length || now - times[times.length - 1] > PRESS_WINDOW_MS) pressTimes.delete(k);
  const times = (pressTimes.get(addr) || []).filter(t => now - t < PRESS_WINDOW_MS);
  times.push(now);
  pressTimes.set(addr, times);
  return times.length > PRESS_LIMIT;
}

// ── Pages ────────────────────────────────────────────────────────────────

function snapshot(role) {
  const surface = surfaces.get(role);
  return {
    ok: true,
    enabled: settings.enabled && !!settings.host,
    state, message,
    registered: surface.registered,
    locked: surface.locked,
    error: surface.error,
    columns: settings.columns, rows: settings.rows,
    keys: [...surface.keys.values()],
  };
}
function broadcast(role, event, data) {
  const set = streams.get(role);
  if (!set || !set.size) return;
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) { try { res.write(frame); } catch (_) { set.delete(res); } }
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

  app.post('/companion/press', express.json({ limit: '1kb' }), (req, res) => {
    const role = roleOf(req, res);
    if (!role) return;
    const addr = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    if (tooFast(addr)) { res.status(429).json({ ok: false, error: 'Too many presses — slow down a little.' }); return; }
    const ok = press(role, Number(req.body?.key), req.body?.pressed === true);
    res.status(ok ? 200 : 409).json(ok ? { ok: true } : { ok: false, error: 'Companion isn’t connected right now.' });
  });
}

function getStatus() {
  return {
    enabled: settings.enabled, state, message,
    companionVersion: server.companionVersion, apiVersion: server.apiVersion,
    surfaces: Object.fromEntries([...surfaces.entries()].map(([role, s]) => [role, { registered: s.registered, locked: s.locked, error: s.error }])),
  };
}

function stop() { settings = { ...settings, enabled: false }; disconnect(); }

module.exports = { applyConfig, mountCompanion, getStatus, stop, ROLES, DEFAULT_PORT, LIMITS, _parse: parse };
