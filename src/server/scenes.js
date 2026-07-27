'use strict';

const fs   = require('fs');
const path = require('path');
const { app } = require('electron');

let _scenesPath = null;
let _scenes = {};  // { snapshotName: { auxChannel: { chNum: sliderValue } } }

function scenesPath() {
  if (!_scenesPath) _scenesPath = path.join(app.getPath('userData'), 'scenes.json');
  return _scenesPath;
}

// Ear scenes start fresh every time the app launches — wipe both the
// in-memory store and the persisted file so old snapshots' mixes never linger.
function clearOnStartup() {
  _scenes = {};
  // Don't write to disk on startup — the file will be written on the first saveScene() call.
}

function persist() {
  try { fs.writeFileSync(scenesPath(), JSON.stringify(_scenes, null, 2)); }
  catch (e) { console.error('[JPMixer] Scene save error:', e); }
}

function saveScene(snapshot, aux, values) {
  if (!snapshot) return;
  if (!_scenes[snapshot]) _scenes[snapshot] = {};
  _scenes[snapshot][String(aux)] = values;
  persist();
}

function deleteScene(snapshot, aux) {
  if (!_scenes[snapshot]) return;
  delete _scenes[snapshot][String(aux)];
  if (Object.keys(_scenes[snapshot]).length === 0) delete _scenes[snapshot];
  persist();
}

function getScene(snapshot, aux) {
  return (_scenes[snapshot] || {})[String(aux)] || null;
}

function getAll() { return _scenes; }

clearOnStartup();
module.exports = { saveScene, deleteScene, getScene, getAll };
