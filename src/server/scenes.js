'use strict';

const path = require('path');
const { app } = require('electron');
const config = require('./config');
const { toNullProto } = require('./safe-object');
const { writeFileAtomic, loadJsonObject } = require('./safe-write');

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

// Data read from disk or a backup file comes back as plain {} objects —
// rebuild it null-prototype so the guarantee above still holds.
function toSceneStore(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return Object.create(null);
  return toNullProto(data);
}

// Empties the in-memory store without touching the file (the next save
// writes it). Used at launch when Settings → "Clear Ear Scenes on launch" is
// on, and by main.js when the Console Type changes mid-session — DiGiCo keys
// scenes by snapshot name, dLive by scene number, and this store doesn't
// otherwise know to clear itself just because the meaning of its keys
// changed out from under it.
function clearOnStartup() {
  // Object.create(null), not {} — see the note on the initial declaration
  // above; a plain {} here would silently reintroduce the vulnerability.
  _scenes = Object.create(null);
}

// Ear Scenes are kept across launches by default. Wiping them on every launch
// used to be unconditional — any quit, crash or reboot silently dropped every
// saved scene — so it's now the opt-in "Clear Ear Scenes on launch" option.
// Older versions wiped Ear Scenes in memory at launch but kept writing
// scenes.json on every save, so on the first launch of a version that loads
// it, the file may hold a past show's scenes — and auto-recall would push
// them to the desk on the next snapshot change. On that first launch (no
// scenes-meta.json yet), only a recently saved file is trusted; an older one
// is copied aside for recovery and the store starts empty.
const UPGRADE_SCENES_MAX_AGE_MS = 48 * 60 * 60 * 1000;

function staleOnFirstUpgrade() {
  const fs = require('fs');
  if (fs.existsSync(metaPath())) return false;
  try {
    const age = Date.now() - fs.statSync(scenesPath()).mtimeMs;
    if (age <= UPGRADE_SCENES_MAX_AGE_MS) return false;
    const aside = scenesPath().replace(/\.json$/, '.before-upgrade.json');
    fs.copyFileSync(scenesPath(), aside);
    console.error(`[JPMixer] scenes.json last saved ${Math.round(age / 3600000)}h ago — not loading it on this first launch; copied to ${path.basename(aside)}`);
    return true;
  } catch (_) {
    return false; // no scenes.json yet — nothing to skip
  }
}

function load() {
  if (config.get('clearScenesOnLaunch')) { clearOnStartup(); return; }
  // Written empty right away (the old file is already copied aside) so a later
  // launch can't pick the stale scenes back up
  if (staleOnFirstUpgrade()) { clearOnStartup(); persist(); return; }
  let corrupt = false;
  const data = loadJsonObject(scenesPath(), app.getPath('userData'), 'scenes',
    (msg) => { corrupt = true; console.error('[JPMixer] ' + msg); });
  if (data) _scenes = toSceneStore(data);
  if (corrupt) persist(); // the broken file was moved aside — write the recovered copy back
}

function persist() {
  try { writeFileAtomic(scenesPath(), JSON.stringify(_scenes, null, 2)); }
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

// Which keying scheme the stored scenes use — 'name' (DiGiCo snapshot names)
// or 'number' (dLive/KLANG scene numbers). Kept beside scenes.json, not in
// it, so scenes.json keeps its format; main.js compares it on start to
// clear scenes that belong to the other scheme.
function metaPath() { return path.join(app.getPath('userData'), 'scenes-meta.json'); }
function getKeyScheme() {
  try { return JSON.parse(require('fs').readFileSync(metaPath(), 'utf8')).keyScheme || null; }
  catch (_) { return null; }
}
function setKeyScheme(scheme) {
  if (getKeyScheme() === scheme) return;
  try { writeFileAtomic(metaPath(), JSON.stringify({ keyScheme: scheme })); }
  catch (e) { console.error('[JPMixer] Scene meta save error:', e); }
}

// Console Type switched to the other keying scheme — the stored scenes no
// longer mean anything, so clear them on disk too (they would otherwise come
// back at the next launch). main.js writes a backup first.
function clearForSchemeChange() {
  clearOnStartup();
  persist();
}

// Wholesale replace — used when restoring from a backup file
function replaceAll(data) {
  _scenes = toSceneStore(data);
  persist();
}

load();
module.exports = { saveScene, deleteScene, getScene, getAll, replaceAll, clearOnStartup, clearForSchemeChange, getKeyScheme, setKeyScheme };
