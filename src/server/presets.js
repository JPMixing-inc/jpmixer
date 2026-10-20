'use strict';

const path = require('path');
const { app } = require('electron');
const { toNullProto } = require('./safe-object');
const { writeFileAtomic, loadJsonObject } = require('./safe-write');

// { [deviceId]: { [name]: { levels: { ch: sliderVal }, pans: { ch: panVal }, owner?, aux?, savedAt? } } }
// owner/aux/savedAt are only on newer saves — older entries just have levels + pans.
// Object.create(null), not {} — deviceId and name both come straight from a
// browser client's WS message (save-preset), completely unvalidated. With a
// normal {} prototype, deviceId: "__proto__" turns `_presets[deviceId][name]
// = value` into `Object.prototype[name] = value`, polluting every plain
// object in the process for any client that sends it. A null-prototype
// object has no __proto__/constructor/etc. accessors to hijack.
let _presets = Object.create(null);

// { [oldDeviceId]: newDeviceId } — written when Settings merges one device's
// mixes into another. A phone (or browser origin) still using the old id then
// reads and writes the merged group instead of starting a new orphan.
// Kept in its own file so presets.json keeps its existing format. Keys are
// client-supplied device ids too, so null-prototype for the same reason.
let _aliases = Object.create(null);

function dataPath(file) { return path.join(app.getPath('userData'), file); }

function load() {
  // toNullProto matters here too, not just at the declarations — JSON.parse's
  // result has a normal Object.prototype, which would silently reintroduce the
  // vulnerability the next time savePreset() runs. On a corrupt file, write
  // the recovered copy straight back: the broken one was moved aside, and a
  // missing file would load as empty next launch.
  let presetsCorrupt = false, aliasesCorrupt = false;
  const presets = loadJsonObject(dataPath('presets.json'), app.getPath('userData'), 'presets',
    (msg) => { presetsCorrupt = true; console.error('[JPMixer] ' + msg); });
  if (presets) _presets = toNullProto(presets);
  const aliases = loadJsonObject(dataPath('preset-aliases.json'), app.getPath('userData'), 'presetAliases',
    (msg) => { aliasesCorrupt = true; console.error('[JPMixer] ' + msg); });
  if (aliases) _aliases = toNullProto(aliases);
  if (presetsCorrupt) persist();
  if (aliasesCorrupt) persistAliases();
}

function persist() {
  try {
    writeFileAtomic(dataPath('presets.json'), JSON.stringify(_presets, null, 2));
    return true;
  } catch (e) {
    console.error('[JPMixer] Preset save error:', e);
    return false;
  }
}

function persistAliases() {
  try {
    writeFileAtomic(dataPath('preset-aliases.json'), JSON.stringify(_aliases, null, 2));
    return true;
  } catch (e) {
    console.error('[JPMixer] Preset alias save error:', e);
    return false;
  }
}

const SAVE_FAILED = { ok: false, error: 'Could not save to disk — nothing was changed.' };

// Follows merge aliases to the device id that actually holds the mixes
function resolve(deviceId) {
  let id = deviceId;
  for (let hops = 0; hops < 20 && _aliases[id]; hops++) id = _aliases[id];
  return id;
}

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const sameMix = (a, b) => JSON.stringify(a.levels || {}) === JSON.stringify(b.levels || {})
                       && JSON.stringify(a.pans || {})   === JSON.stringify(b.pans || {});
// Copy of a device bucket that stays null-prototype (a {...spread} would not)
const copyBucket = (bucket) => Object.assign(Object.create(null), bucket);

// What a saved mix may hold: channel keys 1..256 with fader positions 0..1.
// Anything else a client sends is dropped, and the limits keep one device
// from filling the disk. The phone always sends valid values; this guards
// against crafted messages, which used to be stored as-is — and then made
// every backup fail to restore, since restore does check (mix-backup.js).
const MAX_NAME = 64, MAX_DEVICE_ID = 128, MAX_MIXES_PER_DEVICE = 200, MAX_CHANNEL = 256;
function cleanLevels(values) {
  const out = {}; // keys are checked to be digits, so a plain object is safe here
  if (!values || typeof values !== 'object' || Array.isArray(values)) return out;
  for (const [ch, v] of Object.entries(values)) {
    if (!/^[1-9]\d*$/.test(ch) || Number(ch) > MAX_CHANNEL) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) continue;
    out[ch] = v;
  }
  return out;
}

function savePreset(deviceId, name, levels, pans, meta) {
  if (typeof name !== 'string' || typeof deviceId !== 'string' || !name || !deviceId) return false;
  if (name.length > MAX_NAME || deviceId.length > MAX_DEVICE_ID) return false;
  const id = resolve(deviceId);
  const previous = _presets[id];
  if (!has(previous || {}, name) && Object.keys(previous || {}).length >= MAX_MIXES_PER_DEVICE) return false;
  _presets[id] = copyBucket(previous);
  const entry = { levels: cleanLevels(levels), pans: cleanLevels(pans), savedAt: new Date().toISOString() };
  if (meta && meta.owner) entry.owner = meta.owner;
  if (meta && meta.aux != null) entry.aux = meta.aux;
  _presets[id][name] = entry;
  if (persist()) return true;
  if (previous) _presets[id] = previous;
  else delete _presets[id];
  return false;
}

function deletePreset(deviceId, name) {
  const id = resolve(deviceId);
  if (!_presets[id]) return true;
  const previous = _presets[id];
  _presets[id] = copyBucket(previous);
  delete _presets[id][name];
  if (Object.keys(_presets[id]).length === 0) delete _presets[id];
  if (persist()) return true;
  _presets[id] = previous;
  return false;
}

function getPreset(deviceId, name) {
  // Falling back to a normal {} here would let name: "__proto__" read back
  // a live reference to Object.prototype itself (not a write, but still a
  // reference leak a caller could go on to mutate) — same reasoning as the
  // write paths above, just on the read side.
  return (_presets[resolve(deviceId)] || Object.create(null))[name] || null;
}

function getByDevice(deviceId) {
  return _presets[resolve(deviceId)] || Object.create(null);
}

function getAll() { return _presets; }
function getAliases() { return _aliases; }

// "Find My Mixes" — a phone whose localStorage was wiped also loses its device
// id, so its old backup can't be found by id. Search every device's mixes by
// owner name or mix name instead (empty query lists everything), one result
// per device, newest first. Names and metadata only — the phone fetches the
// levels with getByDevice() once the musician picks a result.
function findGroups(query, excludeDeviceId, limit = 50) {
  const q = String(query || '').trim().toLowerCase();
  const exclude = excludeDeviceId ? resolve(excludeDeviceId) : null;
  const groups = [];
  for (const [deviceId, mixes] of Object.entries(_presets)) {
    if (deviceId === exclude) continue;
    const entries = Object.entries(mixes || {});
    if (entries.length === 0) continue;

    const owners = [...new Set(entries.map(([, p]) => p && p.owner).filter(Boolean))];
    const matches = !q
      || owners.some(o => o.toLowerCase().includes(q))
      || entries.some(([name]) => name.toLowerCase().includes(q));
    if (!matches) continue;

    let lastSaved = null, lastAux = null;
    for (const [, p] of entries) {
      if (p && p.savedAt && (!lastSaved || p.savedAt > lastSaved)) {
        lastSaved = p.savedAt;
        lastAux   = p.aux ?? null;
      }
    }
    groups.push({
      deviceId,
      names: entries.map(([name]) => name).sort((a, b) => a.localeCompare(b)),
      owners,
      lastSaved,
      lastAux
    });
  }
  // Newest first; older saves with no savedAt sort to the bottom
  groups.sort((a, b) => (b.lastSaved || '').localeCompare(a.lastSaved || ''));
  return groups.slice(0, limit);
}

// Settings → Performers → Merge. Moves every mix from one device group into
// another (an identical mix already there is skipped, a different one with
// the same name is kept as "Name (2)"), then aliases the old id to the new
// one. Callers write a backup first — this removes the source group.
function mergeDevices(fromId, toId) {
  const from = resolve(fromId), to = resolve(toId);
  if (!from || !to || from === to) return { ok: false, error: 'Pick two different devices.' };
  if (from.startsWith('pco-person:')) return { ok: false, error: 'Planning Center performer backups stay separate. Use Copy and Paste to share their mixes.' };
  const source = _presets[from];
  if (!source) return { ok: false, error: 'That device has no mixes.' };
  // Work on a copy of the target and commit only once both files are written,
  // so a failed write (disk full, file locked) leaves memory and disk as they were
  const hadTarget = !!_presets[to];
  const previousTarget = _presets[to];
  const target = copyBucket(previousTarget);

  let moved = 0, renamed = 0;
  for (const [name, mix] of Object.entries(source)) {
    if (has(target, name) && sameMix(target[name], mix)) continue;
    let newName = name;
    for (let n = 2; has(target, newName); n++) newName = `${name} (${n})`;
    if (newName !== name) renamed++;
    target[newName] = mix;
    moved++;
  }
  const previousAlias = _aliases[from];
  _presets[to] = target;
  delete _presets[from];
  _aliases[from] = to;
  if (persist() && persistAliases()) return { ok: true, moved, renamed, toId: to };

  // Roll back memory, then put presets.json back to match it
  _presets[from] = source;
  if (hadTarget) _presets[to] = previousTarget; else delete _presets[to];
  if (previousAlias === undefined) delete _aliases[from]; else _aliases[from] = previousAlias;
  persist();
  return SAVE_FAILED;
}

// Settings → Performers → Set Name. Stamps the musician's name on every mix in
// the group so Find My Mixes can match it by name.
function setOwner(deviceId, owner) {
  const id = resolve(deviceId);
  const mixes = _presets[id];
  if (!mixes) return { ok: false, error: 'That device has no mixes.' };
  const clean = String(owner || '').trim().slice(0, 64);
  const updated = copyBucket(mixes);
  for (const [name, mix] of Object.entries(updated)) {
    if (!mix || typeof mix !== 'object') continue;
    const next = { ...mix };
    if (clean) next.owner = clean;
    else delete next.owner;
    updated[name] = next;
  }
  _presets[id] = updated;
  if (persist()) return { ok: true };
  _presets[id] = mixes;
  return SAVE_FAILED;
}

// Clipboard snapshots keep their values even if the source is edited/deleted.
function copyMixes(deviceId, names) {
  const id = resolve(deviceId), bucket = _presets[id];
  if (!bucket) return { ok: false, error: 'That device has no saved mixes.' };
  const selected = names == null ? Object.keys(bucket) : names;
  if (!Array.isArray(selected) || !selected.length || selected.some(name => typeof name !== 'string' || !has(bucket, name))) return { ok: false, error: 'Choose an existing saved mix to copy.' };
  const mixes = Object.create(null);
  for (const name of new Set(selected)) mixes[name] = toNullProto(JSON.parse(JSON.stringify(bucket[name])));
  return { ok: true, sourceId: id, mixes };
}

function pasteMixes(deviceId, clipboard) {
  if (typeof deviceId !== 'string' || !deviceId) return { ok: false, error: 'Choose a destination device.' };
  if (!clipboard?.mixes || !Object.keys(clipboard.mixes).length) return { ok: false, error: 'Copy a saved mix first.' };
  const id = resolve(deviceId);
  if (id === resolve(clipboard.sourceId)) return { ok: false, error: 'Choose a different destination device.' };
  const previous = _presets[id], target = copyBucket(previous);
  // Copies belong to the destination performer. Do not copy the source's
  // owner or last-used aux onto an unrelated device.
  const targetOwner = Object.values(target).find(mix => mix?.owner)?.owner;
  let copied = 0, skipped = 0, renamed = 0;
  for (const [name, mix] of Object.entries(clipboard.mixes)) {
    const duplicate = Object.entries(target).some(([candidate, value]) =>
      (candidate === name || (candidate.startsWith(name + ' (') && /^\d+\)$/.test(candidate.slice(name.length + 2)))) && sameMix(value, mix));
    if (duplicate) { skipped++; continue; }
    let newName = name;
    for (let n = 2; has(target, newName); n++) newName = `${name} (${n})`;
    if (newName !== name) renamed++;
    const entry = { levels: toNullProto(JSON.parse(JSON.stringify(mix.levels || {}))), pans: toNullProto(JSON.parse(JSON.stringify(mix.pans || {}))), savedAt: new Date().toISOString() };
    if (targetOwner) entry.owner = targetOwner;
    target[newName] = entry; copied++;
  }
  if (!copied) return { ok: true, copied, skipped, renamed, toId: id };
  _presets[id] = target;
  if (persist()) return { ok: true, copied, skipped, renamed, toId: id };
  if (previous) _presets[id] = previous; else delete _presets[id];
  return SAVE_FAILED;
}

// Add a backup without overwriting existing mixes or redirecting an existing group.
// Both stores are committed together; on failure restore memory and disk.
function importMixes(data, aliases = {}) {
  const previousPresets = _presets, previousAliases = _aliases;
  _presets = toNullProto(JSON.parse(JSON.stringify(_presets)));
  _aliases = toNullProto(JSON.parse(JSON.stringify(_aliases)));
  let imported = 0, skipped = 0, renamed = 0;
  const changedDevices = new Set();
  for (const [from, target] of Object.entries(aliases)) {
    if (!has(_aliases, from) && !has(_presets, from)) {
      let next = target;
      const seen = new Set([from]);
      while (has(aliases, next) && !seen.has(next)) { seen.add(next); next = aliases[next]; }
      // Current merges take precedence. Avoid introducing a cycle across stores.
      next = resolve(next);
      if (next !== from) { _aliases[from] = next; changedDevices.add(next); }
    }
  }
  for (const [device, bucket] of Object.entries(data)) {
    const id = resolve(device);
    if (!has(_presets, id)) _presets[id] = Object.create(null);
    for (const [name, mix] of Object.entries(bucket)) {
      // Reimporting the same file must be harmless even when a prior import
      // had to suffix a conflicting name.
      const duplicate = Object.entries(_presets[id]).some(([candidate, value]) =>
        (candidate === name || (candidate.startsWith(name + ' (') && /^\d+\)$/.test(candidate.slice(name.length + 2)))) && sameMix(value, mix));
      if (duplicate) { skipped++; continue; }
      let newName = name;
      for (let n = 2; has(_presets[id], newName); n++) newName = `${name} (${n})`;
      if (newName !== name) renamed++;
      _presets[id][newName] = toNullProto(mix);
      imported++; changedDevices.add(id);
    }
  }
  if (persist() && persistAliases()) return { ok: true, imported, skipped, renamed, deviceIds: [...changedDevices] };
  _presets = previousPresets; _aliases = previousAliases;
  persist(); persistAliases();
  return SAVE_FAILED;
}

// Wholesale replace — used when restoring from a backup file. Aliases are
// replaced too: a v1 backup (from before aliases existed) restores none, so
// merges made since can't redirect a restored device's own group elsewhere.
function replaceAll(data, aliases) {
  const previousPresets = _presets, previousAliases = _aliases;
  _presets = toNullProto((data && typeof data === 'object') ? data : {});
  _aliases = toNullProto((aliases && typeof aliases === 'object') ? aliases : {});
  if (persist() && persistAliases()) return true;
  _presets = previousPresets; _aliases = previousAliases;
  persist(); persistAliases();
  return false;
}

load();
module.exports = {
  savePreset, deletePreset, getPreset, getByDevice, getAll, getAliases, findGroups,
  mergeDevices, setOwner, resolve, replaceAll, importMixes, copyMixes, pasteMixes, cleanLevels
};
