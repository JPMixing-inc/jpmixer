'use strict';

// ── Shure wireless on the pages ───────────────────────────────────────────
// Shure wireless is a plugin now (plugins/shure: finding and reading the
// receivers is there, in a process of its own). JPMixer still answers the
// FOH Home Wireless card (/wireless-data), the musician's phone and Monitor
// Engineer (/wireless-aux) and Settings, from what the plugin last shared,
// so the pages and their addresses are as they were. Its settings are still
// the config's (Settings → Plugins → Shure wireless; integrations.js
// hands them to the plugin), and the receivers it learns come back here to
// be saved there, as before (the saver main.js sets).

const plugins = require('./plugins');

let enabled = false;
let saver = null;
let shared = { status: null, channels: [] };

plugins.onShare('shure', (event, data) => {
  if (event === 'started' || event === 'stopped') { shared = { status: null, channels: [] }; return; } // nothing from a run that's over
  if (event === 'status' && data && typeof data === 'object') shared.status = data;
  if (event === 'channels' && Array.isArray(data)) shared.channels = data;
  if (event === 'save' && data && typeof data === 'object' && saver) {
    // Only what it may change: the receivers seen and read, and each mic's mix
    const patch = {};
    for (const k of ['wirelessKnown', 'wirelessReceivers', 'wirelessAux']) if (Object.hasOwn(data, k)) patch[k] = data[k];
    try { saver(patch); } catch (e) { console.error('[JPMixer/Wireless] could not save receivers:', e.message); }
  }
});

const live = () => enabled && plugins.isRunning('shure');

function applyConfig(cfg) { enabled = !!cfg.wirelessEnabled; }

function getStatus() {
  if (live() && shared.status) return shared.status;
  const plugin = enabled ? (plugins.isInstalled('shure') ? 'starting' : 'missing') : 'off';
  const message = enabled ? require('./integrations').notRunningMessage('shure') : '';
  return { enabled, discovered: [], receivers: [], plugin, message };
}

// What the FOH Home Wireless card shows: every channel of every receiver read
function channelsForPages() { return live() ? shared.channels : []; }

// The phone mixer and Monitor Engineer: each mix's mics, without addresses
function mixesForPages() {
  const mixes = {};
  for (const ch of channelsForPages()) {
    if (!ch.aux) continue;
    (mixes[ch.aux] ||= []).push({ name: ch.name, status: ch.status, transmitter: ch.transmitter, battBars: ch.battBars, battState: ch.battState, lastBatt: ch.lastBatt, runTimeMin: ch.runTimeMin, txType: ch.txType });
  }
  return mixes;
}

const batteryState = (bars) => (bars === null || bars === undefined ? null : bars >= 4 ? 'good' : bars === 3 ? 'replace' : 'critical');

// The plugin stops with the other plugins (plugins.stopAll), saving first
function stop() {}

module.exports = {
  applyConfig, getStatus, channelsForPages, mixesForPages, stop, batteryState,
  setSaver: (fn) => { saver = typeof fn === 'function' ? fn : null; },
};
