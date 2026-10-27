'use strict';

// ── Shure, Smaart and Companion, as official plugins ─────────────────────
// Each used to be built into JPMixer; now each is a plugin of its own
// (plugins/shure, plugins/smaart, plugins/companion), so a church installs
// only the ones it uses. What hasn't moved: their settings are still in the
// config, set in their own Settings tabs as before, and their on/off is
// still that tab's switch. This hands each plugin its own settings (and
// nothing else from the config), and the pages still ask JPMixer, which
// answers from what the plugin last shared (smaart.js, shure-wireless.js,
// companion-satellite.js).
//
// Moving over: someone updating from a version where one was built in and
// turned on gets its plugin installed by itself, from the copy that comes
// with JPMixer, so it works with no internet. Turning one on later installs
// it from the approved list, or from that copy if there's no internet.

const plugins = require('./plugins');

// > 0 when version a is newer than b (x.y.z)
function newer(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0), pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

// Each integration: the switch that turns it on, and every config key it reads
const INTEGRATIONS = {
  smaart: { name: 'Smaart SPL', enabledKey: 'smaartEnabled', keys: ['smaartEnabled', 'smaartHost', 'smaartPort', 'smaartPassword', 'smaartMetric', 'smaartLiveMetric', 'smaartHiddenInputs'] },
  shure: { name: 'Shure wireless', enabledKey: 'wirelessEnabled', keys: ['wirelessEnabled', 'wirelessKnown', 'wirelessReceivers', 'wirelessAux'] },
  companion: { name: 'Companion buttons', enabledKey: 'companionEnabled', keys: ['companionEnabled', 'companionHost', 'companionPort', 'companionColumns', 'companionRows'] },
};

// Why an integration's plugin couldn't be installed, for its tab's status line
const problems = Object.create(null);
// While it isn't installed (or is, but not the official copy): what its tab says
function notInstalledMessage(id) {
  const name = INTEGRATIONS[id] ? INTEGRATIONS[id].name : 'this';
  return problems[id] ? `Couldn’t install the ${name} plugin: ${problems[id]}` : `Installing the ${name} plugin…`;
}

// While an integration that's on isn't running: why (for its tab and pages)
function notRunningMessage(id) {
  const name = INTEGRATIONS[id] ? INTEGRATIONS[id].name : 'This plugin';
  const now = plugins.officialState(id);
  if (!now.installed) return notInstalledMessage(id);
  if (!now.official) return `The ${name} plugin’s files have changed, so it isn’t running. Save & Apply in Settings puts the approved copy back.`;
  if (now.state === 'crashed' || now.state === 'restarting') return (now.status && now.status.text) || `The ${name} plugin stopped.`;
  return `Starting ${name}…`;
}

const settingsOf = (cfg, id) => Object.fromEntries(INTEGRATIONS[id].keys.map((k) => [k, cfg[k] === undefined ? null : cfg[k]]));

// The config as it is now: each integration's on/off and settings, to its plugin
function applyConfig(cfg) {
  const next = {};
  for (const [id, info] of Object.entries(INTEGRATIONS)) next[id] = { enabled: cfg[info.enabledKey] === true, settings: settingsOf(cfg, id) };
  return plugins.setIntegrations(next);
}

// The config after an integration's own save (Shure's receivers): its plugin's
// settings follow, without being sent back to it
function noteSaved(id, cfg) { plugins.noteIntegrationSettings(id, settingsOf(cfg, id)); }

// The plugin for an integration, if it isn't there (or isn't the official
// copy): from the approved list when `online`, else (or if that fails) the
// copy that comes with JPMixer. { ok, from } or { ok: false, error }
// One at a time for each: moving over at start and a Settings save can ask at once
const installing = new Map(); // id -> promise
function ensureInstalled(id, options = {}) {
  if (!Object.hasOwn(INTEGRATIONS, id)) return Promise.resolve({ ok: false, error: 'Unknown integration.' });
  if (installing.has(id)) return installing.get(id);
  const run = ensureOne(id, options).finally(() => installing.delete(id));
  installing.set(id, run);
  return run;
}
async function ensureOne(id, { online = false, fromCatalog = null } = {}) {
  const now = plugins.officialState(id);
  // Installed and the approved copy: kept, unless this JPMixer comes with a newer one
  // (a newer one from the approved list is never swapped for an older copy)
  const bundled = plugins.bundledVersion(id);
  if (now.installed && now.official && !(bundled && newer(bundled, now.version) > 0)) { delete problems[id]; return { ok: true, from: 'installed' }; }
  if (online && typeof fromCatalog === 'function') {
    try {
      const result = await fromCatalog(id);
      if (result && result.ok) { delete problems[id]; return { ok: true, from: 'catalog' }; }
    } catch (_) { /* the copy that comes with JPMixer, below */ }
  }
  const result = await plugins.installBundled(id);
  if (result.ok) delete problems[id]; else problems[id] = result.error || 'unknown error';
  return result.ok ? { ok: true, from: 'bundled' } : result;
}

// First launch of this version: every integration that's turned on gets its
// plugin (the copy that comes with JPMixer: no internet needed). Run again on
// every start, so one whose plugin was removed or changed is put back. If
// that copy can't be used, `fromCatalog` (as for ensureInstalled) gets it
// from the approved list instead.
async function moveOver(cfg, log = (msg) => console.log('[JPMixer] ' + msg), { fromCatalog = null } = {}) {
  const out = {};
  for (const [id, info] of Object.entries(INTEGRATIONS)) {
    if (cfg[info.enabledKey] !== true) continue;
    let result = await ensureInstalled(id);
    if (!result.ok && typeof fromCatalog === 'function') {
      log(`Couldn’t use the copy of the ${info.name} plugin that comes with JPMixer (${result.error}); trying the approved list.`);
      result = await ensureInstalled(id, { online: true, fromCatalog });
    }
    out[id] = result;
    if (result.ok && result.from === 'bundled') log(`${info.name} is now a plugin; installed it from the copy that comes with JPMixer.`);
    else if (result.ok && result.from === 'catalog') log(`${info.name} is now a plugin; installed it from the approved list.`);
    else if (!result.ok) log(`Couldn’t install the ${info.name} plugin: ${result.error}`);
  }
  return out;
}

// For Settings: each integration's plugin (installed? running? its version)
function status() {
  return Object.fromEntries(Object.keys(INTEGRATIONS).map((id) => [id, plugins.officialState(id)]));
}

module.exports = { INTEGRATIONS, applyConfig, noteSaved, ensureInstalled, moveOver, status, notInstalledMessage, notRunningMessage };
