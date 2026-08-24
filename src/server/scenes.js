'use strict';

const fs   = require('fs');
const path = require('path');
const { app } = require('electron');

let _scenesPath = null;
// Object.create(null), not {} — `snapshot` comes straight from a browser
// client's WS message (save-scene), completely unvalidated. With a normal
// {} prototype, snapshot: "__proto__" turns `_scenes[snapshot][aux] = values`
// into `Object.prototype[aux] = values`, polluting every plain object in the
// process for any client that sends it. See presets.js for the same fix.
let _scenes = Object.create(null);  // { snapshotName: { auxChannel: { chNum: sliderValue } } }

function scenesPath() {
  if (!_scenesPath) _scenesPath = path.join(app.getPath('userData'), 'scenes.json');
  return _scenesPath;
}

// Ear scenes start fresh every time the app launches — wipe both the
// in-memory store and the persisted file so old snapshots' mixes never linger.
function clearOnStartup() {
  // Object.create(null), not {} — see the note on the initial declaration
  // above. This runs at every launch and every Console Type switch, so a
  // plain {} here would silently reintroduce the vulnerability it fixes.
  _scenes = Object.create(null);
  // Don't write to disk on startup — the file will be written on the first saveScene() call.
}

function persist() {
  try { fs.writeFileSync(scenesPath(), JSON.stringify(_scenes, null, 2)); }
  catch (e) { console.error('[JPMixer] Scene save error:', e); }
}

function saveScene(snapshot, aux, values) {
  if (!snapshot) return;
  if (!_scenes[snapshot]) _scenes[snapshot] = Object.create(null);
  // aux is client-controlled too (save-scene's msg.aux, unvalidated) — a
  // normal {} here would let aux: "__proto__" silently reassign this one
  // scene entry's own prototype to attacker data via the __proto__ setter
  // (distinct from, and in addition to, the snapshot-level pollution fixed
  // by _scenes itself being null-prototype above).
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
  // Same reasoning as presets.js's getPreset(): a plain {} fallback would
  // let aux: "__proto__" read back a live Object.prototype reference.
  return (_scenes[snapshot] || Object.create(null))[String(aux)] || null;
}

function getAll() { return _scenes; }

clearOnStartup();
// Exported (not just internal) so main.js can also call this when the
// Console Type changes mid-session — DiGiCo keys scenes by snapshot name,
// dLive by scene number, and this store doesn't otherwise know to clear
// itself just because the meaning of its keys changed out from under it.
module.exports = { saveScene, deleteScene, getScene, getAll, clearOnStartup };
