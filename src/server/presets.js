'use strict';

const fs   = require('fs');
const path = require('path');
const { app } = require('electron');
const { toNullProto } = require('./safe-object');

let _presetsPath = null;
// { [deviceId]: { [name]: { levels: { ch: sliderVal }, pans: { ch: panVal } } } }
// Object.create(null), not {} — deviceId and name both come straight from a
// browser client's WS message (save-preset), completely unvalidated. With a
// normal {} prototype, deviceId: "__proto__" turns `_presets[deviceId][name]
// = value` into `Object.prototype[name] = value`, polluting every plain
// object in the process for any client that sends it. A null-prototype
// object has no __proto__/constructor/etc. accessors to hijack.
let _presets = Object.create(null);

function presetsPath() {
  if (!_presetsPath) _presetsPath = path.join(app.getPath('userData'), 'presets.json');
  return _presetsPath;
}

function load() {
  try {
    const p = presetsPath();
    // toNullProto matters here too, not just at the initial declaration —
    // JSON.parse's own result has a normal Object.prototype, which would
    // silently reintroduce the exact vulnerability the null-prototype
    // stores below exist to close, the next time savePreset() runs.
    if (fs.existsSync(p)) _presets = toNullProto(JSON.parse(fs.readFileSync(p, 'utf8')));
  } catch (e) { _presets = Object.create(null); }
}

function persist() {
  try { fs.writeFileSync(presetsPath(), JSON.stringify(_presets, null, 2)); }
  catch (e) { console.error('[JPMixer] Preset save error:', e); }
}

function savePreset(deviceId, name, levels, pans) {
  if (!name || !deviceId) return;
  if (!_presets[deviceId]) _presets[deviceId] = Object.create(null);
  _presets[deviceId][name] = { levels: levels || {}, pans: pans || {} };
  persist();
}

function deletePreset(deviceId, name) {
  if (!_presets[deviceId]) return;
  delete _presets[deviceId][name];
  if (Object.keys(_presets[deviceId]).length === 0) delete _presets[deviceId];
  persist();
}

function getPreset(deviceId, name) {
  // Falling back to a normal {} here would let name: "__proto__" read back
  // a live reference to Object.prototype itself (not a write, but still a
  // reference leak a caller could go on to mutate) — same reasoning as the
  // write paths above, just on the read side.
  return (_presets[deviceId] || Object.create(null))[name] || null;
}

function getByDevice(deviceId) {
  return _presets[deviceId] || Object.create(null);
}

function getAll() { return _presets; }

// Wholesale replace — used when restoring from a backup file
function replaceAll(data) {
  _presets = toNullProto((data && typeof data === 'object') ? data : {});
  persist();
}

load();
module.exports = { savePreset, deletePreset, getPreset, getByDevice, getAll, replaceAll };
