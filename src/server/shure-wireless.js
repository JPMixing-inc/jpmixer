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
    try { saver(mergeLearned(require('./config').getAll(), data)); } catch (e) { console.error('[JPMixer/Wireless] could not save receivers:', e.message); }
  }
});

// What the plugin learned, put into the settings as they are now. It saves
// its whole lists, and a Save & Apply in Settings can land between it
// learning something and it hearing of the new settings: so it only adds
// what it learns (receivers seen; a ticked receiver's id, or its new address;
// a mic's mix moved from the receiver's address to its id) and never ticks,
// unticks or changes a mix, which are Settings'.
const RX_ID = /^[0-9A-F]{8}$/, RX_IP = /^\d{1,3}(\.\d{1,3}){3}$/;
function mergeLearned(cfg, data) {
  const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
  // Receivers seen: the plugin's, with any it doesn't list kept
  const known = new Map(list(cfg.wirelessKnown).filter((k) => RX_ID.test(k.id)).map((k) => [k.id, k]));
  for (const k of list(data.wirelessKnown)) if (RX_ID.test(k.id) && RX_IP.test(k.ip)) known.set(k.id, { id: k.id, ip: k.ip, model: typeof k.model === 'string' ? k.model : '' });
  // Ticked receivers: Settings' list, with the ids and addresses learned
  const learned = list(data.wirelessReceivers).filter((r) => RX_IP.test(r.ip));
  const receivers = list(cfg.wirelessReceivers).filter((r) => RX_IP.test(r.ip)).map((r) => {
    const byId = r.id && learned.find((x) => x.id === r.id);
    if (byId) return { ip: byId.ip, id: r.id };           // followed to a new address
    const byIp = learned.find((x) => x.ip === r.ip && RX_ID.test(x.id || ''));
    return byIp ? { ip: r.ip, id: byIp.id } : (r.id ? { ip: r.ip, id: r.id } : { ip: r.ip });
  });
  // Each mic's mix: Settings', with a key moved from an address to its receiver's id
  const aux = { ...(cfg.wirelessAux && typeof cfg.wirelessAux === 'object' ? cfg.wirelessAux : {}) };
  for (const r of receivers) {
    if (!r.id) continue;
    for (const key of Object.keys(aux)) {
      const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d+)$/.exec(key);
      if (m && m[1] === r.ip && aux[`${r.id}/${m[2]}`] === undefined) { aux[`${r.id}/${m[2]}`] = aux[key]; delete aux[key]; }
    }
  }
  return { wirelessKnown: [...known.values()], wirelessReceivers: receivers, wirelessAux: aux };
}

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
  mergeLearned, applyConfig, getStatus, channelsForPages, mixesForPages, stop, batteryState,
  setSaver: (fn) => { saver = typeof fn === 'function' ? fn : null; },
};
