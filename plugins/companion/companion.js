'use strict';

// ── Companion buttons via the Satellite API: the plugin's own code ────────
// Moved here from JPMixer (src/server/companion-satellite.js, which now
// serves the pages from what index.js shares).
// JPMixer connects to Bitfocus Companion as a Satellite client and registers
// one button surface per Home page: "JPMixer FOH Home", "JPMixer Lighting
// Home" and so on. In Companion each shows up under Surfaces, where it can be
// given its own page — so the Lighting card shows lighting buttons. Button
// images reach the pages live and taps on the pages press the button in
// Companion, the same as a Stream Deck.
//
// JPMixer can also ask for more surfaces (setExtras): one per Custom page with
// Companion buttons, "JPMixer <page name>", each with its own grid. Their
// roles are "ev-<page id>". With the Home page surfaces off (companionHome:
// false) only those are registered: Companion for the custom pages alone.
//
// Protocol: https://companion.free/for-developers/Satellite-API — line-based
// text over TCP (default port 16622). One connection carries every surface. What the pages need goes out through onEvent(role, event, data)
// (snapshot, key, clear), and presses come in through press().

const net = require('net');
const os = require('os');

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

let settings = { enabled: false, home: true, host: '', port: DEFAULT_PORT, columns: 8, rows: 4 };
let socket = null;
let buffer = '';
let retryTimer = null, pingTimer = null, capsTimer = null;
let lastHeard = 0;
let server = { apiVersion: null, companionVersion: null, caps: {} };
let state = 'off';             // off | connecting | connected | error
let message = 'Companion buttons are off.';
const surfaces = new Map();    // role -> { registered, locked, keys: Map(index -> key) }
const extras = new Map();      // "ev-<id>" -> { label, columns, rows }: the Custom Pages' surfaces
const EXTRA_RE = /^ev-[0-9a-f]{10}$/;
const held = new Map();        // `${role}:${key}` -> timer
let bitmapSize = 72;
let onEvent = () => {};        // (role, event, data): to the pages, through JPMixer

// The surfaces registered in Companion: the Home pages' (unless they're off) and the custom pages'
const allRoles = () => [...(settings.home ? Object.keys(ROLES) : []), ...extras.keys()];
const labelOf = (role) => (ROLES[role] || (extras.get(role) || {}).label || '');
// A Home page's grid is Settings'; an Custom page's is its own
const dims = (role) => (extras.has(role) ? extras.get(role) : settings);
for (const role of Object.keys(ROLES)) surfaces.set(role, freshSurface());
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
const roleFromDevice = (id) => { const m = /^jpmixer-([a-z]+|ev-[0-9a-f]{10})$/.exec(String(id || '')); return m && ((settings.home && ROLES[m[1]]) || extras.has(m[1])) ? m[1] : null; };
const keyCount = (role) => dims(role).columns * dims(role).rows;

// ── Connection ──────────────────────────────────────────────────────────

function applyConfig(cfg) {
  const next = {
    enabled: cfg.companionEnabled === true,
    home: cfg.companionHome !== false, // older JPMixers don't send it: the Home pages, as before
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
  // A new address, grid or set of surfaces: connected again, so Companion has just these
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
  for (const role of [...Object.keys(ROLES), ...extras.keys()]) {
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
  for (const role of allRoles()) register(role);
  updateConnectedStatus();
}
function register(role) {
  const png = (server.caps.formats || []).includes('png') && versionAtLeast(server.apiVersion, '1.12.0');
  // Before API 1.5.1 a surface could have at most 32 keys
  const total = versionAtLeast(server.apiVersion, '1.5.1') ? keyCount(role) : Math.min(32, keyCount(role));
  const parts = [
    'ADD-DEVICE', `DEVICEID=${deviceId(role)}`, `PRODUCT_NAME="JPMixer ${labelOf(role).replace(/["\\\n\r]/g, ' ')}"`,
    `KEYS_TOTAL=${total}`, `KEYS_PER_ROW=${Math.min(dims(role).columns, total)}`,
    `BITMAPS=${versionAtLeast(server.apiVersion, '1.5.0') ? bitmapSize : 'true'}`,
    'COLORS=hex', 'TEXT=true', 'TEXT_STYLE=true',
  ];
  if (versionAtLeast(server.apiVersion, '1.7.0')) parts.push('BRIGHTNESS=false');
  if (versionAtLeast(server.apiVersion, '1.10.0')) parts.push(`SERIAL=jpmixer:${hostTag()}:${role}`);
  if (png) parts.push('BITMAP_FORMAT=png');
  send(parts.join(' '));
}

// The Custom Pages' surfaces: [{ role: "ev-<id>", label, columns, rows }].
// Added, changed or removed in Companion while connected.
function setExtras(list) {
  const next = new Map();
  for (const x of Array.isArray(list) ? list.slice(0, 20) : []) {
    if (!x || !EXTRA_RE.test(String(x.role))) continue;
    const columns = clampInt(x.columns, LIMITS.columns, 4), rows = clampInt(x.rows, LIMITS.rows, 2);
    next.set(x.role, { label: String(x.label || 'Custom page').replace(/[\u0000-\u001f]/g, ' ').slice(0, 40), columns, rows });
  }
  const registered = !!(socket && server.apiVersion && !capsTimer);
  for (const role of [...extras.keys()]) {
    if (next.has(role)) continue;
    extras.delete(role);
    surfaces.delete(role);
    if (registered) send(`REMOVE-DEVICE DEVICEID=${deviceId(role)}`);
  }
  for (const [role, want] of next) {
    const had = extras.get(role);
    if (had && had.label === want.label && had.columns === want.columns && had.rows === want.rows) continue;
    if (had && registered) send(`REMOVE-DEVICE DEVICEID=${deviceId(role)}`);
    extras.set(role, want);
    surfaces.set(role, freshSurface());
    broadcast(role, 'snapshot', snapshot(role));
    if (registered) register(role);
  }
  if (registered) updateConnectedStatus(); // its status says whether there are any
}

function onKeyState(args) {
  const role = roleFromDevice(args.DEVICEID);
  if (!role) return;
  let index = Number.NaN;
  if (/^\d+$/.test(args.KEY || '')) index = Number(args.KEY);
  else if (/^\d+\/\d+$/.test(args.KEY || '')) { const [r, c] = args.KEY.split('/').map(Number); index = r * dims(role).columns + c; }
  if (!Number.isInteger(index) || index < 0 || index >= keyCount(role)) return;
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
  const mine = allRoles().map((role) => surfaces.get(role)).filter(Boolean);
  const refused = mine.filter((s) => s.error);
  if (mine.length && refused.length === mine.length) setStatus('error', `Companion refused the surfaces: ${refused[0].error}`);
  else setStatus('connected', `Connected to Companion${server.companionVersion ? ' ' + server.companionVersion : ''} at ${settings.host}.${settings.home ? '' : extras.size ? ' Custom Pages only.' : ' Custom Pages only: no custom page has Companion buttons yet.'}`);
}
function setStatus(next, text) {
  const changed = next !== state || text !== message;
  state = next; message = text;
  if (changed) for (const role of [...Object.keys(ROLES), ...extras.keys()]) broadcast(role, 'snapshot', snapshot(role));
}

// ── Presses from the pages ───────────────────────────────────────────────

function press(role, index, pressed) {
  const surface = surfaces.get(role);
  if (!surface || !surface.registered || surface.locked) return false;
  if (!Number.isInteger(index) || index < 0 || index >= keyCount(role)) return false;
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

// ── Pages ────────────────────────────────────────────────────────────────

function snapshot(role) {
  const surface = surfaces.get(role) || freshSurface();
  return {
    ok: true,
    enabled: settings.enabled && !!settings.host,
    state, message,
    registered: surface.registered,
    locked: surface.locked,
    error: surface.error,
    columns: dims(role).columns, rows: dims(role).rows,
    keys: [...surface.keys.values()],
  };
}
function broadcast(role, event, data) { onEvent(role, event, data); }

function getStatus() {
  return {
    enabled: settings.enabled, state, message,
    companionVersion: server.companionVersion, apiVersion: server.apiVersion,
    surfaces: Object.fromEntries([...surfaces.entries()].map(([role, s]) => [role, { registered: s.registered, locked: s.locked, error: s.error }])),
  };
}

function stop() { settings = { ...settings, enabled: false }; disconnect(); }

module.exports = { applyConfig, getStatus, snapshot, press, stop, setExtras, isRole: (role) => Object.hasOwn(ROLES, role) || extras.has(role), allRoles, ROLES, DEFAULT_PORT, LIMITS, _parse: parse,
  setEventListener: (fn) => { onEvent = typeof fn === 'function' ? fn : () => {}; } };
