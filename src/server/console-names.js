'use strict';

// ── Console names, remembered ──────────────────────────────────────────────
// The channel and mix names the console last reported, kept on this computer
// (console-names.json) for each console type, so Settings and every page
// still show them while the console is off or not connected yet. Setting up
// with a console that's off used to show bare numbers everywhere.
//
// Which name shows: one typed in JPMixer (Channels / Aux mixes tab) always
// wins; then the console's live name; then the remembered one. main.js
// records what the console reports every few seconds while it's connected;
// demo mode's made-up names are never recorded.
//   { digico: { channels: { "1": "Kick" }, auxes: { "1": "Vocal 1" } }, … }

const path = require('path');
const { app } = require('electron');
const { writeFileAtomic, loadJsonObject } = require('./safe-write');
const { toNullProto } = require('./safe-object');

const TYPE = /^[a-z0-9]{1,16}$/;
const NUMBER = /^[1-9]\d{0,3}$/;
const MAX_NAME = 64;
const SAVE_DELAY_MS = 2000;

let store = Object.create(null);
let loaded = false;
let saveTimer = null;
const file = () => path.join(app.getPath('userData'), 'console-names.json');

function load() {
  if (loaded) return;
  loaded = true;
  const data = loadJsonObject(file(), app.getPath('userData'), 'consoleNames', (msg) => console.error('[JPMixer] ' + msg));
  if (data) store = toNullProto(data);
}

// A tidy { "n": name } copy: numbered keys and short strings only
function clean(names) {
  const out = Object.create(null);
  if (!names || typeof names !== 'object') return out;
  for (const [n, name] of Object.entries(names)) {
    if (NUMBER.test(n) && typeof name === 'string') out[n] = name.slice(0, MAX_NAME);
  }
  return out;
}

// What the console reports now, laid over what was remembered (a name the
// console stops sending is kept, a renamed one is updated). Saved shortly
// after, once, however many changed.
function record(type, { channels, auxes } = {}) {
  load();
  if (!TYPE.test(String(type || ''))) return false;
  const entry = store[type] || (store[type] = { channels: Object.create(null), auxes: Object.create(null) });
  let changed = false;
  for (const [kind, names] of [['channels', channels], ['auxes', auxes]]) {
    entry[kind] = entry[kind] || Object.create(null);
    for (const [n, name] of Object.entries(clean(names))) {
      if (entry[kind][n] !== name) { entry[kind][n] = name; changed = true; }
    }
  }
  if (changed) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY_MS);
    if (saveTimer.unref) saveTimer.unref();
  }
  return changed;
}

function save() {
  clearTimeout(saveTimer); saveTimer = null;
  try { writeFileAtomic(file(), JSON.stringify(store, null, 2)); }
  catch (e) { console.error('[JPMixer] could not save the console names:', e.message); }
}
// Before quitting: anything still waiting to be saved
function flush() { if (saveTimer) save(); }

// The remembered name for one channel or mix ('channels' | 'auxes'), or undefined
function remembered(type, kind, n) {
  load();
  const names = store[type] && store[type][kind];
  const name = names ? names[String(n)] : undefined;
  return typeof name === 'string' ? name : undefined;
}

// Every remembered name of one kind, as { "n": name }
function all(type, kind) {
  load();
  return { ...((store[type] && store[type][kind]) || {}) };
}

// ── Backups ──
// Every remembered name, and taking them back in. A restore replaces the
// remembered names of each console type in the backup and keeps any other
// type's; anything that isn't a name is skipped.
function getAll() { load(); return JSON.parse(JSON.stringify(store)); }
function cleanAll(data) {
  const out = Object.create(null);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
  for (const [type, entry] of Object.entries(data)) {
    if (!TYPE.test(type) || !entry || typeof entry !== 'object') continue;
    const channels = clean(entry.channels), auxes = clean(entry.auxes);
    if (Object.keys(channels).length || Object.keys(auxes).length) out[type] = { channels, auxes };
  }
  return out;
}
function count(data) {
  const all = cleanAll(data === undefined ? getAll() : data);
  let channels = 0, auxes = 0;
  for (const entry of Object.values(all)) { channels += Object.keys(entry.channels).length; auxes += Object.keys(entry.auxes).length; }
  return { types: Object.keys(all).length, channels, auxes };
}
function write(next) {
  const previous = store;
  store = next;
  clearTimeout(saveTimer); saveTimer = null;
  try { writeFileAtomic(file(), JSON.stringify(store, null, 2)); return true; }
  catch (e) { console.error('[JPMixer] console names restore error:', e.message); store = previous; return false; }
}
function importAll(data) {
  load();
  const next = toNullProto(JSON.parse(JSON.stringify(store)));
  for (const [type, entry] of Object.entries(cleanAll(data))) next[type] = toNullProto(entry);
  return write(next);
}
// Puts back exactly what was there before (a failed restore's rollback)
function replaceAll(data) { load(); return write(toNullProto(cleanAll(data))); }

module.exports = { record, remembered, all, flush, getAll, cleanAll, count, importAll, replaceAll, _reset: () => { store = Object.create(null); loaded = false; clearTimeout(saveTimer); saveTimer = null; } };
