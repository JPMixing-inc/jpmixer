'use strict';

const fs   = require('fs');
const path = require('path');
const { app } = require('electron');

let _presetsPath = null;
// { [deviceId]: { [name]: { levels: { ch: sliderVal }, pans: { ch: panVal } } } }
let _presets = {};

function presetsPath() {
  if (!_presetsPath) _presetsPath = path.join(app.getPath('userData'), 'presets.json');
  return _presetsPath;
}

function load() {
  try {
    const p = presetsPath();
    if (fs.existsSync(p)) _presets = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { _presets = {}; }
}

function persist() {
  try { fs.writeFileSync(presetsPath(), JSON.stringify(_presets, null, 2)); }
  catch (e) { console.error('[JPMixer] Preset save error:', e); }
}

function savePreset(deviceId, name, levels, pans) {
  if (!name || !deviceId) return;
  if (!_presets[deviceId]) _presets[deviceId] = {};
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
  return (_presets[deviceId] || {})[name] || null;
}

function getByDevice(deviceId) {
  return _presets[deviceId] || {};
}

function getAll() { return _presets; }

// Wholesale replace — used when restoring from a backup file
function replaceAll(data) {
  _presets = (data && typeof data === 'object') ? data : {};
  persist();
}

load();
module.exports = { savePreset, deletePreset, getPreset, getByDevice, getAll, replaceAll };
