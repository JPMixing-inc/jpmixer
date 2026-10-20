'use strict';

const path = require('path');
const { app } = require('electron');
const config = require('./config');
const { toNullProto } = require('./safe-object');
const { writeFileAtomic } = require('./safe-write');

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
// writes it). Used unconditionally at launch (see load() below), and by
// main.js when the Console Type changes mid-session — DiGiCo keys scenes by
// snapshot name, dLive by scene number, and this store doesn't otherwise
// know to clear itself just because the meaning of its keys changed out
// from under it.
function clearOnStartup() {
  // Object.create(null), not {} — see the note on the initial declaration
  // above; a plain {} here would silently reintroduce the vulnerability.
  _scenes = Object.create(null);
}

// Ear Scenes always start empty on launch, by design — they're the
// session's working mixes, not permanent storage (My Mixes are the
// permanent ones, in presets.js). scenes.json is still written on every
// save() during a session (crash/quit resilience while running), but it is
// deliberately never read back into memory at startup, so there is nothing
// to migrate or validate the age of here.
function load() {
  clearOnStartup();
}

function persist() {
  try { writeFileAtomic(scenesPath(), JSON.stringify(_scenes, null, 2)); return true; }
  catch (e) { console.error('[JPMixer] Scene save error:', e); return false; }
}

// Keeps only { channel: fader position 0..1 } entries — what the phone
// sends. A stored null or junk value made every later recall of that
// snapshot throw part-way through, so later auxes never got theirs.
function cleanValues(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null;
  const out = {};
  for (const [ch, v] of Object.entries(values)) {
    if (/^[1-9]\d*$/.test(ch) && Number.isFinite(v) && v >= 0 && v <= 1) out[ch] = v;
  }
  return out;
}

function saveScene(snapshot, aux, values) {
  if (!snapshot) return;
  values = cleanValues(values);
  if (!values) return;
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

// Console Type switched to the other keying scheme (DiGiCo keys scenes by
// snapshot name, dLive/KLANG/WING by scene number) mid-session — the stored
// scenes no longer mean anything, so clear them on disk too, not just in
// memory. main.js tracks the previous scheme purely in memory
// (lastSceneKeyScheme) and calls this when it changes; no disk-persisted
// record of the scheme is needed, since Ear Scenes never survive a relaunch
// in the first place (see load() above) — there's nothing left on disk from
// a previous session's scheme for a fresh launch to need to compare against.
function clearForSchemeChange() {
  clearOnStartup();
  persist();
}

// Wholesale replace — used when restoring from a backup file
function replaceAll(data) {
  const previous = _scenes;
  _scenes = toSceneStore(data);
  if (persist()) return true;
  _scenes = previous;
  return false;
}

load();
module.exports = { saveScene, deleteScene, getScene, getAll, replaceAll, clearOnStartup, clearForSchemeChange };
