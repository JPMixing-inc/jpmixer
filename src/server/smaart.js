'use strict';

// ── Smaart SPL on the Home pages ────────────────────────────────────────────
// JPMixer reads live sound levels from Rational Acoustics Smaart and shows
// them in FOH Home's SPL card. Smaart 8.4 and later (API v3) and Smaart 9
// Suite or SPL (API v4) share them; RT and LE don't. JPMixer only reads:
// it sends queries, Smaart's API password if one is set, and the update
// rate of its own streams. It never starts a measurement or changes a
// setting in Smaart.
//
// The API is JSON over WebSocket, on the port in Smaart's Options →
// Preferences → API (26000 unless changed). Any query to the server root
// lists the API versions it has and their paths (/api/v3/, /api/v4/).
// There, activeCalibratedInputs lists the mic inputs that are calibrated
// and logging SPL, each with its own stream endpoint; connecting to one
// streams that input's metrics (SPL A Slow, LAeq 10…) a few times a second.
// The list is asked for again every 15 s, as inputs start and stop logging.
// v8 can't be found automatically (its discovery isn't documented), so the
// Smaart computer's address is entered in Settings.
//
//   GET  /smaart-spl          { enabled, state, message, metrics: [name],
//                               choice: { main, live, hidden }, inputs: [{ id,
//                               key, device, channel, hidden, main, live, stale }] }
//   POST /smaart-spl/options  { main, live, hidden: [key] } — the card's own
//                               options; saved for every screen (FOH's code applies)
//   main / live: { name, value, color: green|yellow|red|'', over } — the big
//   and small readings chosen on the card or in Settings (or automatic),
//   coloured by Smaart's own thresholds and flagged by its alarms. live is
//   null when the small reading is turned off ('none'). An input's key is
//   "device/channel", which stays the same across Smaart versions.

const WebSocket = require('ws');

const DEFAULT_PORT = 26000;
const RETRY_MS = 5000;
let INPUTS_EVERY_MS = 15000;
let REPLY_WAIT_MS = 8000;        // no answer to a query this long: reconnect (tests shorten both)
const STALE_MS = 5000;           // an input that's gone quiet greys out
const STREAM_FPS = 4;            // Smaart sends up to 8 a second; 4 is plenty for a meter
const HOST = /^[a-z0-9.-]{1,253}$/i;

let settings = { enabled: false, host: '', port: DEFAULT_PORT, password: '' };
let readings = { main: '', live: '', hidden: [] }; // metric names ('' = automatic, live 'none' = off) and input keys left off the card
const AUTO_MAIN = ['LAeq 10', 'LAeq 1', 'SPL A Slow', 'SPL Slow', 'SPL A Fast'];
const AUTO_LIVE = ['SPL A Slow', 'SPL A Fast', 'SPL Slow', 'SPL Fast'];
let state = 'off';               // off | connecting | connected | error
let message = 'Smaart SPL is off.';
let api = null;                  // the WebSocket to /api/vN/
let apiPath = null, apiVersion = null, appName = null, appVersion = null;
let retryTimer = null, inputsTimer = null;
let seq = 0;
const pending = new Map();       // sequenceNumber -> handler
const inputs = new Map();        // id -> { id, device, channel, endpoint, ws, metrics, over, at }
let metricNames = [], thresholds = {};
let generation = 0;              // bumps on every (re)connect; late callbacks of an old one do nothing

const clampPort = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : DEFAULT_PORT; };

function applyConfig(cfg) {
  readings = { main: String(cfg.smaartMetric || ''), live: String(cfg.smaartLiveMetric || ''), hidden: Array.isArray(cfg.smaartHiddenInputs) ? cfg.smaartHiddenInputs.filter((k) => typeof k === 'string') : [] };
  const next = {
    enabled: cfg.smaartEnabled === true,
    host: String(cfg.smaartHost || '').trim(),
    port: clampPort(cfg.smaartPort),
    password: String(cfg.smaartPassword || ''),
  };
  const same = next.enabled === settings.enabled && next.host === settings.host && next.port === settings.port && next.password === settings.password;
  settings = next;
  if (same && (state !== 'off' || !next.enabled)) return;
  disconnect();
  if (!settings.enabled) { setState('off', 'Smaart SPL is off.'); return; }
  if (!HOST.test(settings.host)) { setState('error', 'Enter the Smaart computer’s address in Settings → Integrations → Smaart SPL.'); return; }
  connect();
}

function setState(s, msg) { state = s; message = msg; }
const where = () => `${settings.host}:${settings.port}`;
const cantReach = () => `Can’t reach Smaart at ${where()}. Check that Smaart is open with its API turned on (Options → Preferences → API).`;

function retry(msg) {
  disconnect();
  setState('error', msg);
  if (settings.enabled) retryTimer = setTimeout(connect, RETRY_MS);
}

function disconnect() {
  generation++;
  clearTimeout(retryTimer); clearInterval(inputsTimer);
  retryTimer = inputsTimer = null;
  pending.clear();
  if (api) { try { api.terminate(); } catch (_) {} api = null; }
  for (const input of inputs.values()) closeStream(input);
  inputs.clear();
  apiPath = apiVersion = appName = appVersion = null;
  metricNames = []; thresholds = {};
}

// Step 1: ask the root which API versions it has; v4 wins, then v3
function connect() {
  const gen = ++generation;
  setState('connecting', `Connecting to Smaart at ${where()}…`);
  let root;
  try { root = new WebSocket(`ws://${settings.host}:${settings.port}/`, { handshakeTimeout: 5000 }); }
  catch (_) { retry(cantReach()); return; }
  const timer = setTimeout(() => { try { root.terminate(); } catch (_) {} }, REPLY_WAIT_MS);
  let chosen = null;
  root.on('open', () => root.send(JSON.stringify({ action: 'get' })));
  root.on('message', (raw) => {
    const msg = parse(raw);
    const versions = msg && (msg.supportedApiVersions || (msg.response && msg.response.supportedApiVersions));
    if (Array.isArray(versions)) chosen = pickVersion(versions);
    try { root.close(); } catch (_) {}
  });
  root.on('error', () => {});
  root.on('close', () => {
    clearTimeout(timer);
    if (gen !== generation) return;
    if (!chosen) {
      // Some servers answer the root with the API itself; try the paths in turn
      if (state === 'connecting') openApi(gen, ['/api/v4/', '/api/v3/']);
      return;
    }
    openApi(gen, [chosen.path], chosen.version);
  });
}

function pickVersion(list) {
  const found = [];
  for (const entry of list) for (const [v, p] of Object.entries(entry || {})) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 3 && typeof p === 'string' && /^\/api\/v\d+\/$/.test(p)) found.push({ version: n, path: p });
  }
  found.sort((a, b) => b.version - a.version);
  return found[0] || null;
}

// Step 2: the API itself. Server properties, the password if asked, then the inputs.
function openApi(gen, paths, version) {
  const [path, ...rest] = paths;
  if (!path) { retry(cantReach()); return; }
  let ws, opened = false;
  try { ws = new WebSocket(`ws://${settings.host}:${settings.port}${path}`, { handshakeTimeout: 5000 }); }
  catch (_) { retry(cantReach()); return; }
  api = ws;
  ws.on('open', async () => {
    if (gen !== generation) return;
    opened = true;
    apiPath = path; apiVersion = version || Number(path.match(/v(\d+)/)[1]);
    try {
      const props = await request({ action: 'get' });
      if (props && props.error) throw new Error(props.error);
      appName = props && props.applicationName || 'Smaart';
      appVersion = props && props.applicationVersion || null;
      if (props && props.authenticationRequired) {
        if (!settings.password) { retry('Smaart asks for its API password. Enter it in Settings → Integrations → Smaart SPL.'); return; }
        const auth = await request({ action: 'set', properties: [{ password: settings.password }] });
        if (auth && /incorrect password/i.test(auth.error || '')) { retry('Smaart says the API password isn’t right. Check it in Settings → Integrations → Smaart SPL.'); return; }
      }
      await refreshInputs();
      // The regular inputs check is also the heartbeat: a Smaart that stops
      // answering (asleep, Wi-Fi gone) without closing the connection is
      // reconnected rather than shown as connected with stale readings
      inputsTimer = setInterval(() => refreshInputs().catch(() => {
        if (gen === generation) retry(`Smaart at ${where()} stopped answering. Trying again…`);
      }), INPUTS_EVERY_MS);
    } catch (e) {
      if (gen === generation) retry(e && e.message === 'no reply' ? `Smaart at ${where()} isn’t answering.` : cantReach());
    }
  });
  ws.on('message', (raw) => {
    const msg = parse(raw);
    if (!msg) return;
    const handler = pending.get(msg.sequenceNumber);
    if (handler) { pending.delete(msg.sequenceNumber); handler(msg.response || {}); }
  });
  ws.on('error', () => {});
  ws.on('close', () => {
    if (gen !== generation) return;
    if (!opened && rest.length) { openApi(gen, rest, version); return; }
    retry(opened ? `Lost the connection to Smaart at ${where()}. Trying again…` : cantReach());
  });
}

function request(body) {
  return new Promise((resolve, reject) => {
    if (!api || api.readyState !== WebSocket.OPEN) { reject(new Error('closed')); return; }
    const n = ++seq;
    const timer = setTimeout(() => { pending.delete(n); reject(new Error('no reply')); }, REPLY_WAIT_MS);
    pending.set(n, (response) => { clearTimeout(timer); resolve(response); });
    api.send(JSON.stringify({ sequenceNumber: n, ...body }));
  });
}

// Step 3: which inputs are logging, and a stream for each
async function refreshInputs() {
  const gen = generation;
  const r = await request({ action: 'get', target: 'activeCalibratedInputs' });
  if (gen !== generation) return;
  if (r.error) { setState('error', `Smaart answered: ${String(r.error).slice(0, 120)}`); return; }
  metricNames = Array.isArray(r.metrics) ? r.metrics.filter((m) => typeof m === 'string').slice(0, 64) : [];
  thresholds = {};
  if (Array.isArray(r.colorThresholds)) metricNames.forEach((name, i) => {
    const t = r.colorThresholds[i];
    if (t && [t.greenAboveLevel, t.yellowAboveLevel, t.redAboveLevel].every(Number.isFinite)) thresholds[name] = { green: t.greenAboveLevel, yellow: t.yellowAboveLevel, red: t.redAboveLevel };
  });
  const seen = new Set();
  for (const device of Array.isArray(r.devices) ? r.devices : []) {
    for (const ch of Array.isArray(device && device.activeCalibratedChannels) ? device.activeCalibratedChannels : []) {
      const endpoint = String(ch && ch.streamEndpoint || '');
      if (!/^\/api\/v\d+\/[^\s]*$/.test(endpoint)) continue;
      const id = endpoint;
      seen.add(id);
      if (!inputs.has(id)) {
        const input = { id, device: String(device.deviceName || ''), channel: String(ch.channelName || `Input ${Number(ch.channelIndex) + 1}`), endpoint, ws: null, metrics: {}, over: [], at: 0, alarms: {} };
        inputs.set(id, input);
        openStream(input, gen);
      }
      const input = inputs.get(id);
      input.alarms = {};
      for (const a of Array.isArray(ch.alarms) ? ch.alarms : []) if (a && typeof a.metric === 'string' && Number.isFinite(a.level)) input.alarms[a.metric] = a.level;
    }
  }
  for (const [id, input] of inputs) if (!seen.has(id)) { closeStream(input); inputs.delete(id); }
  setState('connected', inputs.size
    ? `Connected to ${appName || 'Smaart'}${appVersion ? ' ' + appVersion : ''}. Reading ${inputs.size} input${inputs.size === 1 ? '' : 's'}.`
    : `Connected to ${appName || 'Smaart'}${appVersion ? ' ' + appVersion : ''}, but no inputs are logging SPL. In Smaart, start SPL logging on a calibrated input.`);
}

function openStream(input, gen) {
  let ws;
  try { ws = new WebSocket(`ws://${settings.host}:${settings.port}${input.endpoint}`, { handshakeTimeout: 5000 }); }
  catch (_) { return; }
  input.ws = ws;
  ws.on('open', () => {
    if (settings.password) ws.send(JSON.stringify({ action: 'set', properties: [{ password: settings.password }] }));
    ws.send(JSON.stringify({ action: 'set', properties: [{ targetFPS: STREAM_FPS }] }));
  });
  ws.on('message', (raw) => {
    const msg = parse(raw);
    if (!msg || !Array.isArray(msg.metrics)) return;
    const metrics = {}, over = [];
    for (const item of msg.metrics.slice(0, 64)) {
      if (!item || typeof item !== 'object') continue;
      for (const [name, value] of Object.entries(item)) {
        if (name === 'violation' || name === 'overload') continue;
        if (Number.isFinite(value)) { metrics[name] = Math.round(value * 10) / 10; if (item.violation === true) over.push(name); }
      }
    }
    input.metrics = metrics; input.over = over; input.at = Date.now();
  });
  ws.on('error', () => {});
  ws.on('close', () => {
    if (input.ws !== ws) return;
    input.ws = null;
    // The next inputs check opens it again if the input is still logging
    if (gen === generation && inputs.get(input.id) === input) inputs.delete(input.id);
  });
}

function closeStream(input) {
  const ws = input.ws;
  input.ws = null;
  if (ws) { try { ws.terminate(); } catch (_) {} }
}

function parse(raw) {
  try { const v = JSON.parse(String(raw)); return v && typeof v === 'object' ? v : null; } catch (_) { return null; }
}

// The reading to show: the one chosen, or the first of the automatic list
// this input has, or any it has. The small one never repeats the big one.
function pick(metrics, wanted, auto, not) {
  const names = Object.keys(metrics).filter((n) => n !== not);
  if (wanted && names.includes(wanted)) return wanted;
  return auto.find((n) => names.includes(n)) || names[0] || null;
}
function reading(input, name) {
  if (!name) return null;
  const value = input.metrics[name];
  const t = thresholds[name];
  const color = !t || !Number.isFinite(value) ? '' : value >= t.red ? 'red' : value >= t.yellow ? 'yellow' : value >= t.green ? 'green' : '';
  return { name, value, color, over: input.over.includes(name) };
}
function snapshot() {
  const now = Date.now();
  return {
    ok: true,
    enabled: settings.enabled,
    state, message,
    metrics: metricNames,
    choice: { main: readings.main, live: readings.live, hidden: readings.hidden },
    inputs: [...inputs.values()].map((i) => {
      const main = pick(i.metrics, readings.main, AUTO_MAIN, null);
      const live = readings.live === 'none' ? null : pick(i.metrics, readings.live, AUTO_LIVE, main);
      const key = inputKey(i);
      return { id: i.id, key, device: i.device, channel: i.channel, hidden: readings.hidden.includes(key), main: reading(i, main), live: reading(i, live), stale: !i.at || now - i.at > STALE_MS };
    }),
  };
}
const inputKey = (i) => `${i.device}/${i.channel}`;

// One reading for the Green Room TV (greenroom.js): its own metric and
// input from Settings ('' = automatic: the first input the FOH card shows,
// and LAeq 10, then SPL A Slow…). null while Smaart isn't sending one.
function singleReading(metric, key) {
  if (!settings.enabled || state !== 'connected' || !inputs.size) return null;
  const all = [...inputs.values()];
  const input = (key && all.find((i) => inputKey(i) === key)) || all.find((i) => !readings.hidden.includes(inputKey(i))) || all[0];
  const r = reading(input, pick(input.metrics, metric, AUTO_MAIN, null));
  if (!r || !Number.isFinite(r.value)) return null;
  return { ...r, input: input.channel || input.device, stale: !input.at || Date.now() - input.at > STALE_MS };
}

// The card's options, checked before they're saved: metric names as Smaart
// writes them, and input keys
const METRIC = /^[A-Za-z0-9 .()%-]{1,40}$/;
function cleanOptions(body) {
  const b = body && typeof body === 'object' ? body : {};
  const main = b.main === '' || METRIC.test(String(b.main)) ? String(b.main || '') : null;
  const live = b.live === '' || b.live === 'none' || METRIC.test(String(b.live)) ? String(b.live || '') : null;
  const hidden = Array.isArray(b.hidden) ? [...new Set(b.hidden.filter((k) => typeof k === 'string' && k.length <= 160))].slice(0, 32) : null;
  return main === null || live === null || hidden === null ? null : { main, live, hidden };
}

// canChange(req): may this page change the card's options (FOH's code).
// save(options): stores them in the config and applies them (foh.js).
function mountSmaart(app, { canChange = () => true, save = null } = {}) {
  app.get('/smaart-spl', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(snapshot());
  });
  app.post('/smaart-spl/options', require('express').json({ limit: '8kb' }), (req, res) => {
    if (!canChange(req)) { res.status(401).json({ ok: false, needCode: true }); return; }
    const options = cleanOptions(req.body);
    if (!options) { res.status(400).json({ ok: false, error: 'Those options couldn’t be saved.' }); return; }
    if (save && !save(options)) { res.status(500).json({ ok: false, error: 'Couldn’t save the options on the JPMixer computer.' }); return; }
    if (!save) readings = options;
    res.json({ ok: true, choice: readings });
  });
}

function getStatus() {
  return { enabled: settings.enabled, state, message, application: appName, version: appVersion, apiVersion, metrics: metricNames, inputs: inputs.size,
    inputList: [...inputs.values()].map((i) => ({ key: inputKey(i), name: i.channel || i.device })) };
}

function stop() { settings = { ...settings, enabled: false }; disconnect(); setState('off', 'Smaart SPL is off.'); }

module.exports = { applyConfig, mountSmaart, getStatus, singleReading, stop, DEFAULT_PORT, _pickVersion: pickVersion, _cleanOptions: cleanOptions,
  _setTimings: (inputsMs, replyMs) => { INPUTS_EVERY_MS = inputsMs; REPLY_WAIT_MS = replyMs; } };
