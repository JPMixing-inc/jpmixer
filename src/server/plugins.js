'use strict';

// ── Plugins ────────────────────────────────────────────────────────────────
// Add-ons other people write for JPMixer. Each one is a folder in
// <userData>/plugins with a plugin.json (its name, what it asks to do, the
// settings it needs) and a JavaScript file. Settings → Integrations → Plugins
// lists them; each is off until someone turns it on there.
//
// Every plugin runs in its own process (plugin-runner.js), never inside
// JPMixer: a plugin that crashes or hangs mid-service can't take the console
// connection or the pages with it. That process is JPMixer's own Electron
// run as plain Node, with Node's permission model on: it can read its own
// folder, write only to its own data folder (<userData>/plugin-data/<id>),
// and can't read config.json, start other programs or load native code.
// Network access stays open (integrations need it). Node calls the
// permission model a seat belt, not a sandbox, so a plugin is still someone
// else's code: Settings says so before one is turned on.
//
// Every plugin must declare at least one setting in plugin.json: those make
// its own tab under Settings → Integrations (settings.js), next to Smaart's
// and Shure's.
//
// A plugin with the "page" permission also has a page of its own (HTML,
// scripts and images in its folder), served at /p/<id>/ and listed with the
// Home pages. It's served sandboxed (CSP sandbox without same-origin), so it
// can't read JPMixer's own pages or their cookies, and it talks only to its
// plugin: POST /plugin-api/<id>/<name> reaches the plugin's
// jp.page.handle(name, fn) and answers with what fn returns
// (mountPluginPages, below).
//
// A plugin never gets the config. It gets its own settings, and only the
// data its plugin.json asks for (PERMISSIONS below), from the providers
// main.js hands to start(). It talks to JPMixer only through messages:
//   card      a card on FOH Home (title, a big value, rows, a note)
//   status    one line shown under it in Settings
//   request   the console's names or the Planning Center plan, once
// and JPMixer pushes 'console' / 'planningCenter' when they change.
// A plugin that exits is started again after a pause; five crashes in ten
// minutes and it stays stopped until it's turned off and on, or Reload.
//
// Where each came from is kept too: the approved list on GitHub
// (plugin-store.js), or a file or folder someone imported
// (source: 'catalog' | 'file'). An author can have a plugin
// restart by itself whenever its files change (watch).
//
// Which plugins are on, and their settings, are kept in plugins.json (not
// config.json, so a Settings save can never drop them). Plugins as a whole
// are off until Allow plugins (Settings → Integrations → Plugins) turns them on (pluginsEnabled
// in the config, passed in as `allowed`): while off, none runs and FOH Home
// has no plugin cards, whatever plugins.json says.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fork } = require('child_process');
const { app } = require('electron');
const { writeFileAtomic, loadJsonObject } = require('./safe-write');
const { toNullProto } = require('./safe-object');

const ID = /^[a-z][a-z0-9-]{1,29}$/;
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const PERMISSIONS = {
  card: 'Show a card on FOH Home',
  console: 'See channel, control group and mix names, each channel’s 48V, and whether the console is connected',
  planningCenter: 'See the plan’s title, what’s live and what’s next from Planning Center',
  page: 'Show a page of its own, listed with the Home pages',
};
const FIELD_TYPES = new Set(['text', 'password', 'number', 'checkbox', 'select']);
const COLORS = new Set(['green', 'yellow', 'red', 'blue', 'gray']);
const LEVELS = new Set(['ok', 'warn', 'error']);
const MAX_SETTINGS = 24, MAX_ROWS = 20, LOG_LINES = 200;
const RESTART_DELAYS_MS = [2000, 5000, 15000, 30000, 60000];
const CRASH_WINDOW_MS = 10 * 60 * 1000, MAX_CRASHES = 5;
const STOP_GRACE_MS = 2000;
const CONSOLE_PUSH_MS = 3000, PCO_PUSH_MS = 15000;

const pluginsDir = () => path.join(app.getPath('userData'), 'plugins');
const dataDir = (id) => path.join(app.getPath('userData'), 'plugin-data', id);
const stateFile = () => path.join(app.getPath('userData'), 'plugins.json');
const RUNNER = path.join(__dirname, 'plugin-runner.js');

const text = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');

// ── plugin.json ──
// A clean copy of one settings field, or null if it isn't one
function cleanField(f) {
  if (!f || typeof f !== 'object' || !KEY.test(String(f.key || '')) || !FIELD_TYPES.has(f.type)) return null;
  const out = { key: f.key, type: f.type, label: text(f.label, 60) || f.key, help: text(f.help, 240), placeholder: text(f.placeholder, 80) };
  if (f.type === 'number') {
    out.min = Number.isFinite(f.min) ? f.min : null;
    out.max = Number.isFinite(f.max) ? f.max : null;
  }
  if (f.type === 'select') {
    out.options = (Array.isArray(f.options) ? f.options : []).slice(0, 50)
      .map((o) => (o && typeof o === 'object' ? { value: text(o.value, 80), label: text(o.label, 80) || text(o.value, 80) } : { value: text(o, 80), label: text(o, 80) }))
      .filter((o) => o.value);
    if (!out.options.length) return null;
  }
  out.default = coerce(out, f.default);
  return out;
}

// A value as the field's type, or the field's default
function coerce(field, value) {
  switch (field.type) {
    case 'checkbox': return typeof value === 'boolean' ? value : field.default === true;
    case 'number': {
      let n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
      if (!Number.isFinite(n)) return Number.isFinite(field.default) ? field.default : null;
      if (field.min !== null && n < field.min) n = field.min;
      if (field.max !== null && n > field.max) n = field.max;
      return n;
    }
    case 'select': {
      const v = typeof value === 'string' ? value : '';
      if (field.options.some((o) => o.value === v)) return v;
      return field.default !== undefined && field.options.some((o) => o.value === field.default) ? field.default : field.options[0].value;
    }
    default: return typeof value === 'string' ? value.slice(0, 500) : typeof field.default === 'string' ? field.default : '';
  }
}

// { ok, manifest } or { ok: false, error } for the plugin in `folder`
function readManifest(folder) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(folder, 'plugin.json'), 'utf8')); }
  catch (e) { return { ok: false, error: e.code === 'ENOENT' ? 'No plugin.json in this folder.' : 'plugin.json isn’t valid JSON.' }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'plugin.json isn’t valid.' };
  const id = String(raw.id || '');
  if (!ID.test(id)) return { ok: false, error: 'plugin.json needs an "id": 2 to 30 lowercase letters, numbers and dashes, starting with a letter.' };
  const main = String(raw.main || 'index.js');
  const entry = path.resolve(folder, main);
  if (!entry.startsWith(path.resolve(folder) + path.sep) || !/\.c?js$/.test(entry)) return { ok: false, error: '"main" must be a .js file inside the plugin’s folder.' };
  if (!fs.existsSync(entry)) return { ok: false, error: `${main} is missing.` };
  const asked = Array.isArray(raw.permissions) ? raw.permissions : [];
  const unknown = asked.filter((p) => !Object.hasOwn(PERMISSIONS, p));
  if (unknown.length) return { ok: false, error: `Unknown permission: ${unknown.map(String).join(', ')}. This version of JPMixer knows ${Object.keys(PERMISSIONS).join(', ')}.` };
  const settings = [];
  const keys = new Set();
  for (const f of (Array.isArray(raw.settings) ? raw.settings : []).slice(0, MAX_SETTINGS)) {
    const field = cleanField(f);
    if (!field) return { ok: false, error: `A setting in plugin.json isn’t valid: ${text(JSON.stringify(f), 80)}` };
    if (keys.has(field.key)) return { ok: false, error: `Two settings use the key "${field.key}".` };
    keys.add(field.key);
    settings.push(field);
  }
  // Every plugin has its own tab under Settings → Integrations, with its settings
  if (!settings.length) return { ok: false, error: 'plugin.json needs "settings" with at least one setting. They make the plugin’s own tab in Settings, under Plugins.' };
  const name = text(raw.name, 40) || id;
  // Its page: an .html file inside its folder (page/index.html unless it says)
  let page = null;
  if (asked.includes('page')) {
    const entryRel = String((raw.page && raw.page.entry) || 'page/index.html');
    const pageEntry = path.resolve(folder, entryRel);
    if (!pageEntry.startsWith(path.resolve(folder) + path.sep) || !/\.html?$/i.test(pageEntry)) return { ok: false, error: '"page.entry" must be an .html file inside the plugin’s folder.' };
    if (!fs.existsSync(pageEntry)) return { ok: false, error: `${entryRel} (its page) is missing.` };
    page = { title: text(raw.page && raw.page.title, 40) || name, entry: path.relative(folder, pageEntry).split(path.sep).join('/') };
  }
  return {
    ok: true,
    manifest: {
      id, name, main,
      version: text(raw.version, 20),
      description: text(raw.description, 300),
      author: text(raw.author, 60),
      homepage: /^https:\/\/[^\s]{1,200}$/.test(String(raw.homepage || '')) ? String(raw.homepage) : '',
      permissions: [...new Set(asked)],
      settings,
      cardTitle: text(raw.card && raw.card.title, 40) || name,
      page,
    },
  };
}

// Every plugin in the plugins folder: { id, folder, manifest } or, for one
// that can't load, { id (the folder name), folder, error }
function scan() {
  let entries = [];
  try { entries = fs.readdirSync(pluginsDir(), { withFileTypes: true }); } catch (_) { return []; }
  const out = [];
  const seen = new Set();
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const folder = path.join(pluginsDir(), e.name);
    const read = readManifest(folder);
    if (!read.ok) { out.push({ id: e.name, folder, error: read.error }); continue; }
    if (seen.has(read.manifest.id)) { out.push({ id: e.name, folder, error: `Another folder already has the id "${read.manifest.id}".` }); continue; }
    seen.add(read.manifest.id);
    out.push({ id: read.manifest.id, folder, manifest: read.manifest });
  }
  return out;
}

// ── On/off and settings (plugins.json) ──
let state = Object.create(null); // id -> { enabled, settings }
let stateLoaded = false;
function loadState() {
  if (stateLoaded) return;
  stateLoaded = true;
  const data = loadJsonObject(stateFile(), app.getPath('userData'), 'plugins', (msg) => console.error('[JPMixer] ' + msg));
  if (data) state = toNullProto(data);
}
function saveState() {
  try { writeFileAtomic(stateFile(), JSON.stringify(state, null, 2)); return true; }
  catch (e) { console.error('[JPMixer] could not save plugins.json:', e.message); return false; }
}
// A plugin's settings: what's saved, as plugin.json describes them
function settingsFor(manifest) {
  const saved = (state[manifest.id] && state[manifest.id].settings) || {};
  const out = {};
  for (const f of manifest.settings) out[f.key] = coerce(f, Object.hasOwn(saved, f.key) ? saved[f.key] : f.default);
  return out;
}

// ── Running ──
let providers = { console: null, planningCenter: null };
const running = new Map(); // id -> run
const crashed = new Map(); // id -> { at: [times], message }
let started = false;
let allowed = false; // Allow plugins (Settings → Integrations → Plugins)
let pushTimers = [];

function permissionFlag() {
  const flags = process.allowedNodeEnvironmentFlags;
  if (flags && flags.has('--permission')) return '--permission';
  if (flags && flags.has('--experimental-permission')) return '--experimental-permission';
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major > 23 || (major === 23 && minor >= 5) || (major === 22 && minor >= 13) ? '--permission' : '--experimental-permission';
}

// Only what a process needs to run (Windows can't open sockets without SystemRoot)
function childEnv() {
  const env = { ELECTRON_RUN_AS_NODE: '1' };
  for (const k of ['LANG', 'LC_ALL', 'TZ', 'SystemRoot', 'SYSTEMROOT', 'windir', 'TEMP', 'TMP', 'TMPDIR']) if (process.env[k]) env[k] = process.env[k];
  return env;
}

function fingerprint(entry, settings) {
  return crypto.createHash('sha1').update(JSON.stringify([entry.manifest, settings, entry.folder])).digest('hex');
}

// The real path (macOS's temp and /var folders are symlinks), which is what
// Node's permission checks compare against
const real = (p) => { try { return fs.realpathSync(p); } catch (_) { return p; } };

function startOne(entry) {
  const { manifest } = entry;
  const folder = real(entry.folder);
  const settings = settingsFor(manifest);
  const data = dataDir(manifest.id);
  try { fs.mkdirSync(data, { recursive: true }); } catch (_) {}
  const flag = permissionFlag();
  const execArgv = [
    flag,
    `--allow-fs-read=${RUNNER}`,
    `--allow-fs-read=${path.join(folder, '*')}`,
    `--allow-fs-read=${path.join(real(data), '*')}`,
    `--allow-fs-write=${path.join(real(data), '*')}`,
  ];
  // Packaged, the runner is inside app.asar, which Electron reads as a file
  if (RUNNER.includes(`.asar${path.sep}`)) execArgv.push(`--allow-fs-read=${RUNNER.slice(0, RUNNER.indexOf(`.asar${path.sep}`) + 5)}`);
  const run = {
    id: manifest.id, entry, settings, fp: fingerprint(entry, settings),
    child: null, card: null, cardAt: null, status: { level: 'ok', text: 'Starting…' },
    log: [], stopping: false, restartTimer: null, startedAt: Date.now(), lastPush: { console: '', planningCenter: '' },
  };
  running.set(manifest.id, run);
  let child;
  try {
    child = fork(RUNNER, [], { execPath: process.execPath, execArgv, env: childEnv(), cwd: folder, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], serialization: 'json' });
  } catch (e) {
    run.status = { level: 'error', text: `Couldn’t start: ${e.message}` };
    return run;
  }
  run.child = child;
  const addLog = (level, line) => {
    if (!line) return;
    run.log.push({ at: new Date().toISOString(), level, text: line.slice(0, 1000) });
    if (run.log.length > LOG_LINES) run.log.splice(0, run.log.length - LOG_LINES);
  };
  const lines = (level) => {
    let buffer = '';
    return (chunk) => {
      buffer += String(chunk);
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop().slice(-2000);
      for (const p of parts) if (!/ExperimentalWarning: Permission|--trace-warnings/.test(p)) addLog(level, p);
    };
  };
  child.stdout.on('data', lines('info'));
  child.stderr.on('data', lines('error'));
  child.on('message', (msg) => onMessage(run, msg, addLog));
  child.on('error', (e) => addLog('error', e.message));
  child.on('exit', (code, signal) => onExit(run, code, signal));
  send(run, { type: 'start', plugin: { id: manifest.id, name: manifest.name, version: manifest.version, folder, dataFolder: real(data) }, entry: path.resolve(folder, manifest.main), settings, permissions: manifest.permissions });
  return run;
}

function send(run, msg) {
  if (!run.child || !run.child.connected) return false;
  try { run.child.send(msg); return true; } catch (_) { return false; }
}

function cleanCard(card) {
  if (!card || typeof card !== 'object') return null;
  const color = (c) => (COLORS.has(c) ? c : '');
  return {
    title: text(card.title, 40),
    value: text(card.value, 24),
    unit: text(card.unit, 12),
    label: text(card.label, 80),
    color: color(card.color),
    rows: (Array.isArray(card.rows) ? card.rows : []).slice(0, MAX_ROWS)
      .filter((r) => r && typeof r === 'object')
      .map((r) => ({ label: text(r.label, 40), value: text(r.value, 40), color: color(r.color) })),
    note: text(card.note, 200),
  };
}

async function onMessage(run, msg, addLog) {
  if (!msg || typeof msg !== 'object' || running.get(run.id) !== run) return;
  const can = (p) => run.entry.manifest.permissions.includes(p);
  switch (msg.type) {
    case 'card':
      if (!can('card')) { addLog('error', 'card.show: plugin.json doesn’t ask for the "card" permission.'); return; }
      run.card = cleanCard(msg.card);
      run.cardAt = new Date().toISOString();
      return;
    case 'card-clear':
      run.card = null;
      run.cardAt = new Date().toISOString();
      return;
    case 'status':
      run.status = { level: LEVELS.has(msg.level) ? msg.level : 'ok', text: text(msg.text, 160) };
      return;
    case 'page-reply': {
      const call = run.pageCalls && run.pageCalls.get(msg.id);
      if (!call) return;
      run.pageCalls.delete(msg.id);
      clearTimeout(call.timer);
      if (msg.error) call.reject(Object.assign(new Error(text(msg.error, 300) || 'The plugin couldn’t do that.'), { fromPlugin: true }));
      else call.resolve(msg.result === undefined ? null : msg.result);
      return;
    }
    case 'request': {
      const what = msg.what;
      if (!['console', 'planningCenter'].includes(what) || !can(what)) { send(run, { type: 'reply', id: msg.id, error: `plugin.json doesn’t ask for the "${String(what)}" permission.` }); return; }
      try { send(run, { type: 'reply', id: msg.id, result: await provide(what) }); }
      catch (e) { send(run, { type: 'reply', id: msg.id, error: e.message || 'Not available right now.' }); }
      return;
    }
    default:
  }
}

// Shared by every plugin and the push timers, and asked for at most every
// PROVIDE_EVERY_MS: a plugin asking in a loop can't hammer Planning Center
const PROVIDE_EVERY_MS = 2000;
const provided = new Map(); // what -> { at, promise }
function provide(what) {
  const hit = provided.get(what);
  if (hit && (hit.pending || Date.now() - hit.at < PROVIDE_EVERY_MS)) return hit.promise; // still being fetched: joined
  const fn = providers[what];
  const promise = (async () => {
    if (typeof fn !== 'function') return null;
    const value = await fn();
    return value === undefined ? null : JSON.parse(JSON.stringify(value));
  })();
  const entry = { at: Date.now(), promise, pending: true };
  provided.set(what, entry);
  promise.then(() => { entry.pending = false; entry.at = Date.now(); }, () => { if (provided.get(what) === entry) provided.delete(what); });
  return promise;
}

function onExit(run, code, signal) {
  run.child = null;
  for (const call of (run.pageCalls || new Map()).values()) { clearTimeout(call.timer); call.reject(new Error('The plugin stopped.')); }
  if (run.pageCalls) run.pageCalls.clear();
  if (running.get(run.id) !== run) return;
  if (run.stopping) { running.delete(run.id); return; }
  // An unexpected exit: start it again after a pause, unless it keeps crashing
  const now = Date.now();
  const record = crashed.get(run.id) || { at: [] };
  record.at = record.at.filter((t) => now - t < CRASH_WINDOW_MS).concat(now);
  const why = run.status.level === 'error' && run.status.text ? run.status.text : signal ? `Stopped (${signal}).` : `Stopped (exit code ${code}).`;
  record.message = why;
  crashed.set(run.id, record);
  if (record.at.length >= MAX_CRASHES) {
    run.status = { level: 'error', text: `Stopped after crashing ${MAX_CRASHES} times. ${why} Turn it off and on, or Reload, to try again.` };
    run.gaveUp = true;
    return;
  }
  const delay = RESTART_DELAYS_MS[Math.min(record.at.length - 1, RESTART_DELAYS_MS.length - 1)];
  run.status = { level: 'error', text: `${why} Starting again in ${Math.round(delay / 1000)} s.` };
  run.restartTimer = setTimeout(() => {
    if (running.get(run.id) !== run || run.stopping) return;
    running.delete(run.id);
    const entry = scan().find((e) => e.id === run.id && e.manifest);
    loadState();
    if (allowed && entry && state[run.id] && state[run.id].enabled === true) startOne(entry);
  }, delay);
  if (run.restartTimer.unref) run.restartTimer.unref();
}

function stopOne(id) {
  const run = running.get(id);
  if (!run) return Promise.resolve();
  run.stopping = true;
  clearTimeout(run.restartTimer);
  if (!run.child) { running.delete(id); return Promise.resolve(); }
  const child = run.child;
  return new Promise((resolve) => {
    const done = () => { clearTimeout(kill); if (running.get(id) === run) running.delete(id); resolve(); };
    const kill = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, STOP_GRACE_MS);
    child.once('exit', done);
    if (!send(run, { type: 'stop' })) { try { child.kill(); } catch (_) {} }
  });
}

// Starts what's on, stops what's off or gone, and restarts any whose
// settings or files changed. `force` restarts every one that's on (Reload).
async function apply({ force = false } = {}) {
  loadState();
  const entries = scan().filter((e) => e.manifest);
  const wanted = new Map(allowed ? entries.filter((e) => state[e.id] && state[e.id].enabled === true).map((e) => [e.id, e]) : []);
  const stops = [];
  for (const [id, run] of running) {
    const entry = wanted.get(id);
    const changed = !entry || force || run.gaveUp || fingerprint(entry, settingsFor(entry.manifest)) !== run.fp;
    if (changed) stops.push(stopOne(id));
  }
  await Promise.all(stops);
  for (const [id, entry] of wanted) {
    if (force || !running.has(id)) crashed.delete(id);
    if (!running.has(id)) startOne(entry);
  }
  updateWatchers(wanted);
}

// ── Restart when its files change (for plugin authors) ──
// One watcher per plugin that's on and has it ticked; a burst of saves
// restarts it once, half a second after the last
const watchers = new Map(); // id -> { watcher, folder, timer }
function updateWatchers(wanted) {
  for (const [id, w] of watchers) {
    const entry = wanted.get(id);
    if (!entry || !(state[id] && state[id].watch === true) || entry.folder !== w.folder) { clearTimeout(w.timer); try { w.watcher.close(); } catch (_) {} watchers.delete(id); }
  }
  for (const [id, entry] of wanted) {
    if (watchers.has(id) || !(state[id] && state[id].watch === true)) continue;
    let watcher;
    try { watcher = fs.watch(entry.folder, { recursive: true }); } catch (_) {
      try { watcher = fs.watch(entry.folder); } catch (_) { continue; } // no recursive watching on this system
    }
    const w = { watcher, folder: entry.folder, timer: null };
    watcher.on('change', (_type, file) => {
      if (file && /(^|[\\/])(\.|node_modules[\\/]\.cache)/.test(String(file))) return; // .DS_Store, editor swap files
      clearTimeout(w.timer);
      w.timer = setTimeout(() => restart(id).catch(() => {}), 500);
    });
    watcher.on('error', () => {});
    watchers.set(id, w);
  }
}

// Sends the console's names / the plan to plugins that asked, when they change
async function push(what) {
  const runs = [...running.values()].filter((r) => r.child && r.entry.manifest.permissions.includes(what));
  if (!runs.length) return;
  let value;
  try { value = await provide(what); } catch (_) { return; }
  const key = JSON.stringify(value);
  for (const run of runs) {
    if (run.lastPush[what] === key) continue;
    if (send(run, { type: what, data: value })) run.lastPush[what] = key;
  }
}

function start(given = {}) {
  providers = { console: given.console || null, planningCenter: given.planningCenter || null };
  allowed = given.allowed === true;
  provided.clear();
  if (started) return apply();
  started = true;
  pushTimers = [
    setInterval(() => push('console'), CONSOLE_PUSH_MS),
    setInterval(() => push('planningCenter'), PCO_PUSH_MS),
  ];
  for (const t of pushTimers) if (t.unref) t.unref();
  return apply();
}

// Allow plugins turned on or off
function setAllowed(value) {
  allowed = value === true;
  return apply();
}

// Quitting: ask each to stop, and don't wait (each also exits when JPMixer's
// end of the channel closes)
function stopAll() {
  for (const w of watchers.values()) { clearTimeout(w.timer); try { w.watcher.close(); } catch (_) {} }
  watchers.clear();
  for (const t of pushTimers) clearInterval(t);
  pushTimers = [];
  started = false;
  const all = [...running.keys()].map(stopOne);
  return Promise.all(all);
}

// ── For Settings ──
function list() {
  loadState();
  return scan().map((e) => {
    const run = running.get(e.id);
    const on = !!(state[e.id] && state[e.id].enabled === true);
    const saved = state[e.id] || {};
    const base = { id: e.id, folder: e.folder, enabled: on, source: saved.source || 'file', watch: saved.watch === true };
    if (!e.manifest) return { ...base, error: e.error, state: 'invalid' };
    return {
      ...base,
      manifest: e.manifest,
      permissions: e.manifest.permissions.map((p) => ({ id: p, text: PERMISSIONS[p] })),
      settings: settingsFor(e.manifest),
      state: run ? (run.gaveUp ? 'crashed' : run.child ? 'running' : 'restarting') : on ? 'starting' : 'off',
      status: run ? run.status : null,
      hasCard: e.manifest.permissions.includes('card'),
    };
  });
}

function getLog(id) {
  const run = running.get(id);
  return run ? run.log.slice() : [];
}

// { [id]: { enabled, settings } } from Settings' Save & Apply. Only plugins
// that exist, and only the settings each declares.
function save(changes) {
  loadState();
  if (!changes || typeof changes !== 'object') return { ok: false, error: 'Nothing to save.' };
  const entries = new Map(scan().filter((e) => e.manifest).map((e) => [e.id, e]));
  const next = toNullProto(JSON.parse(JSON.stringify(state)));
  for (const [id, change] of Object.entries(changes)) {
    const entry = entries.get(id);
    if (!entry || !change || typeof change !== 'object') continue;
    const current = next[id] || { enabled: false, settings: {} };
    const settings = { ...(current.settings || {}) };
    if (change.settings && typeof change.settings === 'object') {
      for (const f of entry.manifest.settings) if (Object.hasOwn(change.settings, f.key)) settings[f.key] = coerce(f, change.settings[f.key]);
    }
    next[id] = {
      ...current,
      enabled: typeof change.enabled === 'boolean' ? change.enabled : current.enabled === true,
      settings,
      watch: typeof change.watch === 'boolean' ? change.watch : current.watch === true,
    };
  }
  const previous = state;
  state = next;
  if (!saveState()) { state = previous; return { ok: false, error: 'Couldn’t save the plugin settings.' }; }
  return { ok: true };
}

// Stops one and starts it again if it's on (after its files change)
async function restart(id) {
  await stopOne(id);
  crashed.delete(id);
  return apply();
}

// ── Adding one (Settings → Add plugin…) ──
// Copies a plugin's folder into the plugins folder: plain files and folders
// only (no links that could point elsewhere), at most MAX_INSTALL_BYTES.
// Replacing one already there swaps the folder in one step. Returns
// { ok, manifest, replaced } or { ok: false, error }.
const MAX_INSTALL_BYTES = 100 * 1024 * 1024;
function measure(folder) {
  let bytes = 0, files = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) throw new Error(`It contains a link (${path.relative(folder, p)}). Copy the real files into the folder instead.`);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) { bytes += fs.statSync(p).size; files++; }
      if (bytes > MAX_INSTALL_BYTES) throw new Error('It’s over 100 MB.');
    }
  };
  walk(folder);
  return { bytes, files };
}
function previewInstall(source) {
  const read = readManifest(source);
  if (!read.ok) return read;
  const from = real(source);
  if (from === real(pluginsDir()) || from.startsWith(real(pluginsDir()) + path.sep)) return { ok: false, error: 'That folder is already in JPMixer’s plugins folder.' };
  try { measure(source); } catch (e) { return { ok: false, error: e.message }; }
  const existing = scan().find((e) => e.manifest && e.manifest.id === read.manifest.id);
  return { ok: true, manifest: read.manifest, existing: existing ? existing.manifest : null };
}
// `origin`: 'catalog' (the approved list) or 'file' (imported)
async function install(source, { origin = 'file' } = {}) {
  const check = previewInstall(source);
  if (!check.ok) return check;
  const id = check.manifest.id;
  const target = path.join(pluginsDir(), id);
  const temp = path.join(pluginsDir(), `.adding-${id}-${Date.now()}`);
  try {
    fs.mkdirSync(pluginsDir(), { recursive: true });
    fs.cpSync(source, temp, { recursive: true, verbatimSymlinks: true });
    await stopOne(id);
    const found = check.existing ? scan().find((e) => e.manifest && e.manifest.id === id) : null;
    const old = found ? found.folder : null; // gone in the meantime: nothing to replace
    if (old) fs.rmSync(old, { recursive: true, force: true });
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(temp, target);
  } catch (e) {
    try { fs.rmSync(temp, { recursive: true, force: true }); } catch (_) {}
    await apply();
    return { ok: false, error: `Couldn’t copy it: ${e.message}` };
  }
  crashed.delete(id);
  loadState();
  state = toNullProto(JSON.parse(JSON.stringify(state)));
  state[id] = { enabled: false, settings: {}, ...(state[id] || {}), source: origin };
  saveState();
  await apply();
  return { ok: true, manifest: check.manifest, replaced: !!check.existing };
}

// Forgets a plugin's on/off and settings (after its folder is removed)
function forget(id) {
  loadState();
  if (!Object.hasOwn(state, id)) return true;
  const previous = state;
  state = toNullProto(JSON.parse(JSON.stringify(state)));
  delete state[id];
  if (!saveState()) { state = previous; return false; }
  return true;
}

// ── For FOH Home ──
// The cards of plugins that are on and ask for one, in plugin order
// FOH Home asks every 2 seconds from every screen: the folder is read again
// at most that often
let scanned = { at: 0, list: [] };
function scanSoon() {
  if (Date.now() - scanned.at > 2000) scanned = { at: Date.now(), list: scan() };
  return scanned.list;
}
function cards() {
  if (!allowed) return [];
  loadState();
  return scanSoon()
    .filter((e) => e.manifest && e.manifest.permissions.includes('card') && state[e.id] && state[e.id].enabled === true)
    .map((e) => {
      const run = running.get(e.id);
      const stateName = run ? (run.gaveUp ? 'crashed' : run.child ? 'running' : 'restarting') : 'starting';
      return { id: e.id, cardId: `p-${e.id}`, title: e.manifest.cardTitle, card: run ? run.card : null, state: stateName };
    });
}

// ── Plugin pages ──
// A plugin that's on and has the "page" permission: its folder and page
const pageEntry = (id) => {
  if (!allowed || !ID.test(String(id || ''))) return null;
  loadState();
  if (!(state[id] && state[id].enabled === true)) return null;
  const entry = scanSoon().find((e) => e.manifest && e.manifest.id === id && e.manifest.permissions.includes('page') && e.manifest.page);
  if (!entry) return null;
  const folder = real(entry.folder);
  const file = path.join(folder, ...entry.manifest.page.entry.split('/'));
  return { folder, dir: path.dirname(file), index: path.basename(file), title: entry.manifest.page.title };
};
// For the Home pages list: every plugin page that can be opened now
function pages() {
  if (!allowed) return [];
  loadState();
  return scanSoon()
    .filter((e) => e.manifest && e.manifest.page && e.manifest.permissions.includes('page') && state[e.id] && state[e.id].enabled === true)
    .map((e) => ({ id: e.id, title: e.manifest.page.title, plugin: e.manifest.name, href: `/p/${e.id}/` }));
}

// A call from a plugin's page to the plugin's jp.page.handle(name, fn)
const PAGE_CALL_TIMEOUT_MS = 10000;
let pageCallId = 0;
function callPage(id, name, body) {
  const run = running.get(id);
  if (!run || !run.child || !run.entry.manifest.permissions.includes('page')) return Promise.reject(Object.assign(new Error('The plugin isn’t running right now.'), { status: 503 }));
  run.pageCalls = run.pageCalls || new Map();
  if (run.pageCalls.size >= 20) return Promise.reject(Object.assign(new Error('The plugin is busy. Try again.'), { status: 429 }));
  return new Promise((resolve, reject) => {
    const callId = ++pageCallId;
    const timer = setTimeout(() => { run.pageCalls.delete(callId); reject(Object.assign(new Error('The plugin didn’t answer in time.'), { status: 504 })); }, PAGE_CALL_TIMEOUT_MS);
    run.pageCalls.set(callId, { resolve, reject, timer });
    if (!send(run, { type: 'page-call', id: callId, name, body })) { clearTimeout(timer); run.pageCalls.delete(callId); reject(Object.assign(new Error('The plugin isn’t running right now.'), { status: 503 })); }
  });
}

// GET /p/<id>/…        the plugin's page and its files, sandboxed
// POST /plugin-api/<id>/<name>   { …JSON } → the plugin → JSON
// A sandboxed page has an opaque origin, so its calls arrive with
// Origin: null, the same as a sandboxed frame on any other website. So each
// call also carries the page's token (X-JPMixer-Token), which JPMixer writes
// into the page's HTML as it serves it (<meta name="jpmixer-token">). Another
// site can't read that HTML (no CORS) or frame the page (frame-ancestors),
// and another plugin's page gets its own plugin's token, not this one's.
const PAGE_CSP = "sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads; frame-ancestors 'self'";
// Kept across restarts (in userData), so an open page still works after JPMixer restarts
let pageSecret = null;
function secret() {
  if (pageSecret) return pageSecret;
  const file = path.join(app.getPath('userData'), 'plugin-pages.key');
  try {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/.test(saved)) return (pageSecret = saved);
  } catch (_) { /* made below */ }
  pageSecret = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(file, pageSecret, { mode: 0o600 }); } catch (e) { console.error('[JPMixer] Couldn’t save the plugin page key:', e.message); }
  return pageSecret;
}
const pageToken = (id) => crypto.createHmac('sha256', secret()).update(`plugin-page:${id}`).digest('hex').slice(0, 40);
const sameToken = (a, b) => typeof a === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
function mountPluginPages(app) {
  const express = require('express');
  app.get(/^\/p\/([a-z][a-z0-9-]{1,29})(\/.*)?$/, (req, res) => {
    const id = req.params[0];
    if (!req.params[1]) { res.redirect(301, `/p/${id}/`); return; }
    const page = pageEntry(id);
    res.set('Cache-Control', 'no-cache');
    if (!page) { res.status(404).type('text/plain').send('This plugin page isn’t available. Its plugin may be off, or plugins may not be allowed (Settings → Integrations → Plugins).'); return; }
    // Express has already decoded the path once
    let rel = req.params[1].slice(1);
    if (!rel) rel = page.index;
    const parts = rel.split('/');
    if (parts.some((x) => !x || x === '..' || x.startsWith('.')) || rel.includes('\\')) { res.status(404).end(); return; }
    const file = path.resolve(page.dir, ...parts);
    if (!file.startsWith(page.dir + path.sep)) { res.status(404).end(); return; }
    let stat;
    try { stat = fs.statSync(file); } catch (_) { res.status(404).end(); return; }
    if (!stat.isFile()) { res.status(404).end(); return; }
    res.set('Content-Security-Policy', PAGE_CSP);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    // An HTML page gets its token, as the first thing in its <head>
    if (/\.html?$/i.test(file)) {
      let html;
      try { html = fs.readFileSync(file, 'utf8'); } catch (_) { res.status(404).end(); return; }
      const meta = `<meta name="jpmixer-token" content="${pageToken(id)}">`;
      // In its <head>; with none, after the doctype (before it would put the page in quirks mode)
      if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${meta}`);
      else if (/^\s*<!doctype[^>]*>/i.test(html)) html = html.replace(/^\s*<!doctype[^>]*>/i, (m) => `${m}\n${meta}`);
      else html = `${meta}\n${html}`;
      res.type('html').send(html);
      return;
    }
    res.sendFile(file);
  });
  const allowOrigin = (req) => {
    const origin = req.headers.origin;
    return origin === 'null' || origin === `http://${req.headers.host}` || origin === undefined;
  };
  app.options('/plugin-api/:id/:name', (req, res) => {
    if (!allowOrigin(req)) { res.status(403).end(); return; }
    res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-JPMixer-Plugin, X-JPMixer-Token');
    res.set('Access-Control-Max-Age', '600');
    res.status(204).end();
  });
  app.post('/plugin-api/:id/:name', express.json({ limit: '512kb' }), async (req, res) => {
    const { id, name } = req.params;
    res.set('Cache-Control', 'no-store');
    const ok = allowOrigin(req) && ID.test(id) && sameToken(req.headers['x-jpmixer-token'], pageToken(id)) && /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(name);
    if (!ok) { res.status(403).json({ ok: false, error: 'Not allowed. Reload the page.' }); return; }
    if (req.headers.origin) res.set('Access-Control-Allow-Origin', req.headers.origin);
    if (!pageEntry(id)) { res.status(404).json({ ok: false, error: 'This plugin isn’t on.' }); return; }
    try { res.json({ ok: true, result: await callPage(id, name, req.body === undefined ? null : req.body) }); }
    catch (e) { res.status(e.status || (e.fromPlugin ? 400 : 500)).json({ ok: false, error: e.message || 'The plugin couldn’t do that.' }); }
  });
}

// For Settings → Performance: each running plugin's process
function processes() {
  return [...running.values()].filter((r) => r.child && r.child.pid).map((r) => ({ id: r.id, name: r.entry.manifest.name, pid: r.child.pid }));
}

module.exports = {
  processes, pages, callPage, mountPluginPages, _pageToken: (id) => pageToken(id),
  start, setAllowed, apply, restart, stopAll, stopOne, list, getLog, save, forget, cards, readManifest, scan, previewInstall, install,
  pluginsDir, dataDir, PERMISSIONS,
  _cleanCard: cleanCard, _coerce: coerce, _running: running,
  _setRestartDelays: (list) => { RESTART_DELAYS_MS.splice(0, RESTART_DELAYS_MS.length, ...list); },
  _reset: () => { state = Object.create(null); stateLoaded = false; crashed.clear(); provided.clear(); scanned = { at: 0, list: [] }; },
};
