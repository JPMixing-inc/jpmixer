'use strict';

// ── Plugins ────────────────────────────────────────────────────────────────
// Add-ons other people write for JPMixer. Each one is a folder in
// <userData>/plugins with a plugin.json (its name, what it asks to do, the
// settings it needs) and a JavaScript file. Settings → Plugins
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
// its own tab under Plugins in Settings (settings.js), next to Smaart's
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
// are off until Allow plugins (Settings → Plugins) turns them on (pluginsEnabled
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
  integration: 'Feed JPMixer’s own pages and Settings (official JPMixer plugins only)',
};
// Official JPMixer plugins: they run without Allow plugins, as long as their
// files are the ones installed from the approved list (or from the copy that
// comes with JPMixer). An integration (Shure, Smaart, Companion) also has its
// on/off and settings in JPMixer's config, in its own Settings tab
// (integrations.js hands them over), not in plugins.json.
const OFFICIAL = { patch: {}, shure: { integration: true }, smaart: { integration: true }, companion: { integration: true } };
const isIntegrationId = (id) => !!(Object.hasOwn(OFFICIAL, id) && OFFICIAL[id].integration);
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
// The official plugins that come with JPMixer (for moving people over from
// the versions where these were built in): beside the app, or the repo's
// plugins/ folder when running from source
const bundledDir = () => (app.isPackaged && process.resourcesPath ? path.join(process.resourcesPath, 'plugins') : path.join(__dirname, '..', '..', 'plugins'));

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
  if (asked.includes('integration') && !isIntegrationId(id)) return { ok: false, error: 'Only JPMixer’s own integrations can ask for "integration".' };
  const settings = [];
  const keys = new Set();
  for (const f of (Array.isArray(raw.settings) ? raw.settings : []).slice(0, MAX_SETTINGS)) {
    const field = cleanField(f);
    if (!field) return { ok: false, error: `A setting in plugin.json isn’t valid: ${text(JSON.stringify(f), 80)}` };
    if (keys.has(field.key)) return { ok: false, error: `Two settings use the key "${field.key}".` };
    keys.add(field.key);
    settings.push(field);
  }
  // Every plugin has its own tab under Plugins in Settings, with its settings
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
  // An integration's come from JPMixer's config, as integrations.js gives them
  if (isIntegrationId(manifest.id)) return JSON.parse(JSON.stringify((integrations[manifest.id] && integrations[manifest.id].settings) || {}));
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
let allowed = false; // Allow plugins (Settings → Plugins)
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
const filesPrint = (entry) => crypto.createHash('sha1').update(JSON.stringify([entry.manifest, entry.folder])).digest('hex');

// ── Official plugins ──
// Every file's SHA-256, as installed (from the approved list, which checked
// each against it, or the copy with JPMixer): { "index.js": "…", … }
function hashFiles(folder) {
  const out = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.DS_Store') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out[path.relative(folder, p).split(path.sep).join('/')] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    }
  };
  walk(folder);
  return out;
}
const officialChecks = new Map(); // id -> { stamp, ok, folder, at }
function stampOf(folder) {
  const parts = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.DS_Store') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) { const st = fs.statSync(p); parts.push(`${p}:${st.size}:${st.mtimeMs}`); }
    }
  };
  walk(folder);
  return parts.sort().join('|');
}
// Installed from the approved list before JPMixer recorded the files (Patch,
// on 2.0.13): official if they're the same as the copy that comes with
// JPMixer, and recorded from then on
function adoptFiles(entry) {
  try {
    const catalog = JSON.parse(fs.readFileSync(path.join(bundledDir(), 'catalog.json'), 'utf8'));
    const listed = (Array.isArray(catalog.plugins) ? catalog.plugins : []).find((p) => p && p.id === entry.id);
    if (!listed || !Array.isArray(listed.files)) return false;
    const now = hashFiles(entry.folder);
    const want = Object.fromEntries(listed.files.map((f) => [f.path, f.sha256]));
    if (Object.keys(now).length !== Object.keys(want).length || !Object.entries(want).every(([f, h]) => now[f] === h)) return false;
    state = toNullProto(JSON.parse(JSON.stringify(state)));
    state[entry.id] = { ...state[entry.id], files: now };
    return saveState();
  } catch (_) { return false; }
}
// Checked again only when a file's size or time changes, and those are
// looked at no more than every few seconds (pages ask for every file)
const OFFICIAL_RECHECK_MS = 5000;
// `fresh`: look at the files now (deciding whether to start it), not a few seconds ago
function isOfficial(entry, { fresh = false } = {}) {
  if (!entry || !entry.manifest || !Object.hasOwn(OFFICIAL, entry.id)) return false;
  const hit = officialChecks.get(entry.id);
  if (!fresh && hit && hit.folder === entry.folder && Date.now() - hit.at < OFFICIAL_RECHECK_MS) return hit.ok;
  let stamp;
  try { stamp = stampOf(entry.folder); } catch (_) { return false; }
  if (hit && hit.folder === entry.folder && hit.stamp === stamp) { hit.at = Date.now(); return hit.ok; }
  loadState();
  let saved = state[entry.id];
  if (saved && saved.source === 'catalog' && !saved.files && adoptFiles(entry)) saved = state[entry.id];
  let ok = false;
  if (saved && ['catalog', 'bundled'].includes(saved.source) && saved.files && typeof saved.files === 'object') {
    try {
      const now = hashFiles(entry.folder);
      const want = saved.files;
      ok = Object.keys(now).length === Object.keys(want).length && Object.entries(want).every(([f, h]) => now[f] === h);
    } catch (_) { ok = false; }
  }
  // Kept either way (a copy that doesn't match isn't hashed again until it changes)
  officialChecks.set(entry.id, { stamp, ok, folder: entry.folder, at: Date.now() });
  return ok;
}
// Should this plugin be running? An integration: when its Settings tab has it
// on. Any other: when it's on, and plugins are allowed (or it's official).
// Plugins being installed (their folder about to be swapped): held stopped till it's done
const installingIds = new Set();
function wantsRun(entry, { fresh = false } = {}) {
  if (!entry || !entry.manifest || installingIds.has(entry.id)) return false;
  if (isIntegrationId(entry.id)) return !!(integrations[entry.id] && integrations[entry.id].enabled) && isOfficial(entry, { fresh });
  return !!(state[entry.id] && state[entry.id].enabled === true) && (allowed || isOfficial(entry, { fresh }));
}
// An integration's on/off and settings, from JPMixer's config (integrations.js)
let integrations = Object.create(null); // id -> { enabled, settings }

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
  // Network access stays open (integrations need it): newer Node's permission
  // model closes it unless asked (Node 20, inside JPMixer today, doesn't)
  if (process.allowedNodeEnvironmentFlags && process.allowedNodeEnvironmentFlags.has('--allow-net')) execArgv.push('--allow-net');
  // Packaged, the runner is inside app.asar, which Electron reads as a file
  if (RUNNER.includes(`.asar${path.sep}`)) execArgv.push(`--allow-fs-read=${RUNNER.slice(0, RUNNER.indexOf(`.asar${path.sep}`) + 5)}`);
  const run = {
    id: manifest.id, entry, settings, fp: fingerprint(entry, settings), files: filesPrint(entry), live: false,
    official: isOfficial(entry, { fresh: true }), // checked as it starts: the code it runs is what it loaded then
    child: null, card: null, cardAt: null, status: { level: 'ok', text: 'Starting…' },
    log: [], stopping: false, restartTimer: null, startedAt: Date.now(), lastPush: { console: '', planningCenter: '' },
  };
  running.set(manifest.id, run);
  // A new run of an integration: JPMixer forgets what the last one shared
  for (const fn of shareListeners.get(manifest.id) || []) { try { fn('started', null); } catch (_) {} }
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
    case 'settings-live': // it takes new settings without a restart
      run.live = true;
      return;
    case 'shares': {
      // Only an official integration feeds JPMixer's own pages
      if (!can('integration') || !isIntegrationId(run.id) || !run.official) { addLog('error', 'jp.integration.share: only official JPMixer integrations can use it.'); return; }
      for (const one of (Array.isArray(msg.list) ? msg.list : []).slice(0, 500)) {
        const event = String((one && one.event) || '');
        if (!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(event)) continue;
        for (const fn of shareListeners.get(run.id) || []) { try { fn(event, one.data); } catch (e) { console.error(`[JPMixer] ${run.id} share:`, e.message); } }
      }
      return;
    }
    case 'integration-reply': {
      const call = run.integrationCalls && run.integrationCalls.get(msg.id);
      if (!call) return;
      run.integrationCalls.delete(msg.id);
      clearTimeout(call.timer);
      if (msg.error) call.reject(Object.assign(new Error(text(msg.error, 300) || 'The plugin couldn’t do that.'), { fromPlugin: true }));
      else call.resolve(msg.result === undefined ? null : msg.result);
      return;
    }
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
  // An integration's pages stop showing what it last shared
  for (const fn of shareListeners.get(run.id) || []) { try { fn('stopped', null); } catch (_) {} }
  for (const calls of [run.pageCalls, run.integrationCalls]) {
    for (const call of (calls || new Map()).values()) { clearTimeout(call.timer); call.reject(new Error('The plugin stopped.')); }
    if (calls) calls.clear();
  }
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
    if (entry && wantsRun(entry, { fresh: true })) startOne(entry);
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
  const wanted = new Map(entries.filter((e) => wantsRun(e, { fresh: true })).map((e) => [e.id, e]));
  const stops = [];
  for (const [id, run] of running) {
    const entry = wanted.get(id);
    const settings = entry ? settingsFor(entry.manifest) : null;
    // Only its settings changed, and it takes them live: no restart
    if (entry && !force && !run.gaveUp && run.live && run.child && filesPrint(entry) === run.files && fingerprint(entry, settings) !== run.fp) {
      if (send(run, { type: 'settings', settings })) { run.settings = settings; run.fp = fingerprint(entry, settings); continue; }
    }
    const changed = !entry || force || run.gaveUp || fingerprint(entry, settings) !== run.fp;
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

// ── Official integrations (integrations.js) ──
// Their on/off and settings from JPMixer's config: { shure: { enabled, settings }, … }
function setIntegrations(next) {
  const clean = Object.create(null);
  for (const [id, v] of Object.entries(next || {})) {
    if (!isIntegrationId(id) || !v || typeof v !== 'object') continue;
    clean[id] = { enabled: v.enabled === true, settings: v.settings && typeof v.settings === 'object' ? JSON.parse(JSON.stringify(v.settings)) : {} };
  }
  integrations = clean;
  return started ? apply() : Promise.resolve();
}
// What an integration learned and JPMixer saved (Shure's receivers): its
// settings become that, without sending them back to it (it has them), so a
// restart starts from there and a later apply() doesn't see a change
function noteIntegrationSettings(id, settings) {
  if (!isIntegrationId(id) || !integrations[id] || !settings || typeof settings !== 'object') return;
  const clean = JSON.parse(JSON.stringify(settings));
  integrations[id] = { ...integrations[id], settings: clean };
  const run = running.get(id);
  if (run) { run.settings = clean; run.fp = fingerprint(run.entry, clean); }
}
// Something an integration shares with JPMixer: fn(event, data). 'started'
// (data null) comes first each time a new process starts, before anything it
// shares, and 'stopped' when one ends (stopped, crashed or turned off)
const shareListeners = new Map(); // id -> Set(fn)
function onShare(id, fn) {
  if (!shareListeners.has(id)) shareListeners.set(id, new Set());
  shareListeners.get(id).add(fn);
  return () => shareListeners.get(id).delete(fn);
}
// JPMixer's own call to an integration (a Companion press, the Smaart card's options)
const INTEGRATION_CALL_TIMEOUT_MS = 5000;
let integrationCallId = 0;
function callIntegration(id, name, body, timeoutMs = INTEGRATION_CALL_TIMEOUT_MS) {
  const run = running.get(id);
  if (!run || !run.child || !isIntegrationId(id) || !run.entry.manifest.permissions.includes('integration')) return Promise.reject(Object.assign(new Error('not running'), { notRunning: true }));
  run.integrationCalls = run.integrationCalls || new Map();
  if (run.integrationCalls.size >= 50) return Promise.reject(new Error('busy'));
  return new Promise((resolve, reject) => {
    const callId = ++integrationCallId;
    const timer = setTimeout(() => { run.integrationCalls.delete(callId); reject(new Error('The plugin didn’t answer in time.')); }, timeoutMs);
    run.integrationCalls.set(callId, { resolve, reject, timer });
    if (!send(run, { type: 'integration-call', id: callId, name, body })) { clearTimeout(timer); run.integrationCalls.delete(callId); reject(Object.assign(new Error('not running'), { notRunning: true })); }
  });
}
// An official plugin as it is here: installed? official? running? its status
function officialState(id) {
  const entry = scanSoon().find((e) => e.id === id && e.manifest);
  const run = running.get(id);
  return {
    installed: !!entry, official: !!entry && isOfficial(entry), version: entry ? entry.manifest.version : null,
    running: !!(run && run.child), state: run ? (run.gaveUp ? 'crashed' : run.child ? 'running' : 'restarting') : 'off',
    status: run ? run.status : null,
  };
}
// The version of the copy that comes with JPMixer (null if there's none)
function bundledVersion(id) {
  try {
    const catalog = JSON.parse(fs.readFileSync(path.join(bundledDir(), 'catalog.json'), 'utf8'));
    const listed = (Array.isArray(catalog.plugins) ? catalog.plugins : []).find((p) => p && p.id === id);
    return listed && typeof listed.version === 'string' ? listed.version : null;
  } catch (_) { return null; }
}
// The official plugins that come with JPMixer, as their catalog lists them
// (for Find plugins: installable with no internet, or before they're on the
// approved list on GitHub)
function bundledCatalog() {
  try {
    const catalog = JSON.parse(fs.readFileSync(path.join(bundledDir(), 'catalog.json'), 'utf8'));
    return (Array.isArray(catalog.plugins) ? catalog.plugins : []).filter((p) => p && Object.hasOwn(OFFICIAL, p.id));
  } catch (_) { return []; }
}
// The copy of an official plugin that comes with JPMixer, after checking each
// file against that copy's catalog: { ok, folder } or { ok: false, error }
function checkBundled(id) {
  if (!Object.hasOwn(OFFICIAL, id)) return { ok: false, error: 'Not an official plugin.' };
  const listed = bundledCatalog().find((p) => p.id === id);
  if (!listed || !Array.isArray(listed.files)) return { ok: false, error: 'The copy of this plugin that comes with JPMixer is missing.' };
  const folder = path.join(bundledDir(), String(listed.path || id));
  try {
    const now = hashFiles(folder);
    const want = Object.fromEntries(listed.files.map((f) => [f.path, f.sha256]));
    if (Object.keys(now).length !== Object.keys(want).length || !Object.entries(want).every(([f, h]) => now[f] === h)) return { ok: false, error: 'The copy of this plugin that comes with JPMixer doesn’t match its list.' };
  } catch (e) { return { ok: false, error: `Couldn’t read the copy that comes with JPMixer: ${e.message}` }; }
  return { ok: true, folder };
}
// Installs an official plugin from the copy that comes with JPMixer (moving
// someone over from a version where it was built in, or with no internet)
async function installBundled(id) {
  const check = checkBundled(id);
  return check.ok ? install(check.folder, { origin: 'bundled' }) : check;
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
    const base = { id: e.id, folder: e.folder, enabled: isIntegrationId(e.id) ? !!(integrations[e.id] && integrations[e.id].enabled) : on, source: saved.source || 'file', watch: saved.watch === true,
      official: isOfficial(e), integration: isIntegrationId(e.id) };
    if (!e.manifest) return { ...base, error: e.error, state: 'invalid' };
    return {
      ...base,
      manifest: e.manifest,
      permissions: e.manifest.permissions.map((p) => ({ id: p, text: PERMISSIONS[p] })),
      settings: settingsFor(e.manifest),
      state: run ? (run.gaveUp ? 'crashed' : run.child ? 'running' : 'restarting') : base.enabled ? (base.official || !isIntegrationId(e.id) ? 'starting' : 'crashed') : 'off',
      // An integration that's on but whose files changed doesn't run: said so, not "starting"
      status: run ? run.status : base.enabled && isIntegrationId(e.id) && !base.official ? { level: 'error', text: 'Its files have changed, so it isn’t running. Save & Apply puts the approved copy back.' } : null,
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
  if (installingIds.has(id)) return { ok: false, error: 'It’s being installed already.' };
  installingIds.add(id); // nothing starts the old copy while its folder is swapped
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
    installingIds.delete(id);
    await apply();
    return { ok: false, error: `Couldn’t copy it: ${e.message}` };
  }
  installingIds.delete(id);
  crashed.delete(id);
  loadState();
  state = toNullProto(JSON.parse(JSON.stringify(state)));
  // An official plugin's files, as installed, so it can be told apart from a copy changed since
  let files = null;
  if ((origin === 'catalog' || origin === 'bundled') && Object.hasOwn(OFFICIAL, id)) { try { files = hashFiles(target); } catch (_) { files = null; } }
  state[id] = { enabled: false, settings: {}, ...(state[id] || {}), source: origin, ...(files ? { files } : {}) };
  if (!files) delete state[id].files;
  officialChecks.delete(id);
  scanned = { at: 0, list: [] }; // the folder changed: read it again next time
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
  scanned = { at: 0, list: [] };
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
  loadState();
  return scanSoon()
    .filter((e) => e.manifest && e.manifest.permissions.includes('card') && !isIntegrationId(e.id) && wantsRun(e))
    .map((e) => {
      const run = running.get(e.id);
      const stateName = run ? (run.gaveUp ? 'crashed' : run.child ? 'running' : 'restarting') : 'starting';
      return { id: e.id, cardId: `p-${e.id}`, title: e.manifest.cardTitle, card: run ? run.card : null, state: stateName };
    });
}

// ── Plugin pages ──
// A plugin that's on and has the "page" permission: its folder and page
const pageEntry = (id) => {
  if (!ID.test(String(id || ''))) return null;
  loadState();
  const entry = scanSoon().find((e) => e.manifest && e.manifest.id === id && e.manifest.permissions.includes('page') && e.manifest.page);
  if (!entry || !wantsRun(entry)) return null;
  const folder = real(entry.folder);
  const file = path.join(folder, ...entry.manifest.page.entry.split('/'));
  return { folder, dir: path.dirname(file), index: path.basename(file), title: entry.manifest.page.title };
};
// For the Home pages list: every plugin page that can be opened now
function pages() {
  loadState();
  return scanSoon()
    .filter((e) => e.manifest && e.manifest.page && e.manifest.permissions.includes('page') && wantsRun(e))
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
    if (!page) { res.status(404).type('text/plain').send('This plugin page isn’t available. Its plugin may be off, or plugins may not be allowed (Settings → Plugins).'); return; }
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
  setIntegrations, noteIntegrationSettings, bundledVersion, onShare, callIntegration, officialState, installBundled, checkBundled, bundledCatalog, isIntegrationId, OFFICIAL, bundledDir,
  isRunning: (id) => { const run = running.get(id); return !!(run && run.child); },
  isInstalled: (id) => scanSoon().some((e) => e.id === id && e.manifest),
  start, setAllowed, apply, restart, stopAll, stopOne, list, getLog, save, forget, cards, readManifest, scan, previewInstall, install,
  pluginsDir, dataDir, PERMISSIONS,
  _cleanCard: cleanCard, _coerce: coerce, _running: running,
  _setRestartDelays: (list) => { RESTART_DELAYS_MS.splice(0, RESTART_DELAYS_MS.length, ...list); },
  _reset: () => { state = Object.create(null); stateLoaded = false; crashed.clear(); provided.clear(); scanned = { at: 0, list: [] }; officialChecks.clear(); },
};
