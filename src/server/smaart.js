'use strict';

// ── Smaart SPL on the Home pages ────────────────────────────────────────────
// Smaart SPL is a plugin now (plugins/smaart: the connection to Smaart is
// there, in a process of its own). JPMixer still answers FOH Home's SPL card
// and the Green Room, from what the plugin last shared, so the pages and
// their addresses are as they were:
//   GET  /smaart-spl          { enabled, state, message, metrics: [name],
//                               choice: { main, live, hidden }, inputs: [{ id,
//                               key, device, channel, hidden, main, live, stale }] }
//   POST /smaart-spl/options  { main, live, hidden: [key] } — the card's own
//                               options; saved for every screen (FOH's code applies)
//   main / live: { name, value, color: green|yellow|red|'', over } — the big
//   and small readings chosen on the card or in Settings (or automatic).
// Its settings are still the config's (Settings → Plugins → Smaart SPL);
// integrations.js hands them to the plugin.

const plugins = require('./plugins');

const DEFAULT_PORT = 26000;
let enabled = false;          // Settings has it on
let choice = { main: '', live: '', hidden: [] };
let shared = { status: null, snapshot: null };

plugins.onShare('smaart', (event, data) => {
  if (event === 'started' || event === 'stopped') { shared = { status: null, snapshot: null }; return; } // nothing from a run that's over
  if (event === 'status' && data && typeof data === 'object') shared.status = data;
  if (event === 'snapshot' && data && typeof data === 'object') shared.snapshot = data;
});

function applyConfig(cfg) {
  enabled = cfg.smaartEnabled === true;
  choice = { main: String(cfg.smaartMetric || ''), live: String(cfg.smaartLiveMetric || ''), hidden: Array.isArray(cfg.smaartHiddenInputs) ? cfg.smaartHiddenInputs.filter((k) => typeof k === 'string') : [] };
}

// While the plugin isn't running: off, starting, or not installed
function notRunning() {
  if (!enabled) return 'Smaart SPL is off.';
  return require('./integrations').notRunningMessage('smaart');
}
const live = () => enabled && plugins.isRunning('smaart'); // turned off: off at once, while it stops

function getStatus() {
  if (live() && shared.status) return shared.status;
  return { enabled, state: enabled ? 'connecting' : 'off', message: notRunning(), application: null, version: null, apiVersion: null, metrics: [], inputs: 0, inputList: [] };
}
function snapshot() {
  if (live() && shared.snapshot) return { ...shared.snapshot, ok: true };
  const status = getStatus();
  return { ok: true, enabled, state: status.state, message: status.message, metrics: [], choice, inputs: [] };
}

// One reading for the Green Room TV (greenroom.js): its own metric and input
// from Settings ('' = automatic). null while Smaart isn't sending one.
async function singleReading(metric, input) {
  if (!enabled || !live()) return null;
  try { return await plugins.callIntegration('smaart', 'reading', { metric: String(metric || ''), input: String(input || '') }, 2000); } catch (_) { return null; }
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
// save(options): stores them in the config and applies them (foh.js); the
// plugin gets them as new settings, without reconnecting to Smaart.
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
    choice = options;
    res.json({ ok: true, choice });
  });
}

// The plugin stops with the other plugins (plugins.stopAll)
function stop() {}

module.exports = { applyConfig, mountSmaart, getStatus, singleReading, stop, DEFAULT_PORT, _cleanOptions: cleanOptions };
