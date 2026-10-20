'use strict';

const fs = require('fs');
const path = require('path');
const { readArchive } = require('./backup-files');
const { writeFileAtomic } = require('./safe-write');
const MAX_BYTES = 32 * 1024 * 1024;
const object = value => value && typeof value === 'object' && !Array.isArray(value);

function validate(data, { allowEmpty = false } = {}) {
  let presets, aliases = {};
  if (data?.app === 'JPMixer') {
    if (!['backup', 'mix-backup'].includes(data.type)) throw new Error('This is not a saved-mix backup.');
    const maxVersion = data.type === 'backup' ? 2 : 1;
    if (!Number.isInteger(data.version) || data.version < 1 || data.version > maxVersion) throw new Error('This backup format requires a newer JPMixer version.');
    presets = data.presets;
    aliases = data.presetAliases ?? {};
  } else presets = data;
  if (!object(presets) || !object(aliases)) throw new Error('No valid My Mixes data was found.');
  // A mix with bad levels is skipped and counted, not a reason to refuse the
  // whole file (it used to take the config and scenes down with it). A file
  // whose entries aren't mixes at all is still refused.
  const cleaned = {};
  let mixes = 0, devices = 0, dropped = 0;
  const validValues = values => object(values) && Object.entries(values).every(([ch, value]) => /^[1-9]\d*$/.test(ch) && Number(ch) <= 256 && typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1);
  for (const [id, bucket] of Object.entries(presets)) {
    if (!id || !object(bucket)) throw new Error('Invalid saved-mix device group.');
    const keep = {};
    for (const [name, mix] of Object.entries(bucket)) {
      if (!name.trim() || !object(mix) || !object(mix.levels)) throw new Error('Invalid saved mix. Choose a My Mixes backup or presets.json, not scenes.json.');
      const ok = validValues(mix.levels) && validValues(mix.pans ?? {})
        && (mix.owner == null || typeof mix.owner === 'string') && (mix.savedAt == null || typeof mix.savedAt === 'string');
      if (!ok) { dropped++; continue; }
      keep[name] = mix;
      mixes++;
    }
    if (Object.keys(keep).length) devices++;
    cleaned[id] = keep;
  }
  if (!mixes && !allowEmpty) throw new Error(dropped ? 'Every saved mix in this file has invalid levels.' : 'This file contains no saved My Mixes.');
  for (const [from, to] of Object.entries(aliases)) {
    if (!from || typeof to !== 'string' || !to) throw new Error('Invalid device aliases.');
    const visited = new Set([from]);
    let next = to;
    while (Object.hasOwn(aliases, next)) {
      if (visited.has(next)) throw new Error('Circular device aliases in backup.');
      visited.add(next); next = aliases[next];
    }
    // An alias can legitimately point to a device whose last mix was deleted.
    if (visited.has(next)) throw new Error('Invalid device alias target.');
  }
  return { presets: cleaned, aliases, mixes, devices, dropped };
}

async function readZip(filePath) {
  const files = await readArchive(filePath, name => ['presets.json', 'preset-aliases.json'].includes(name));
  if (!files['presets.json']) throw new Error('This ZIP has no presets.json saved-mix file.');
  return validate({ app: 'JPMixer', type: 'mix-backup', version: 1, presets: JSON.parse(files['presets.json']), presetAliases: files['preset-aliases.json'] ? JSON.parse(files['preset-aliases.json']) : {} });
}

async function read(filePath) {
  if (fs.statSync(filePath).size > MAX_BYTES) throw new Error('Saved-mix file is too large (32 MB maximum).');
  if (path.extname(filePath).toLowerCase() === '.zip') return readZip(filePath);
  let data;
  try { data = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { throw new Error('That file is not valid JSON.'); }
  return validate(data);
}

function write(filePath, presets, aliases, appVersion) {
  writeFileAtomic(filePath, JSON.stringify({ app: 'JPMixer', type: 'mix-backup', version: 1, exportedAt: new Date().toISOString(), appVersion, presets, presetAliases: aliases }, null, 2));
}

module.exports = { read, write, validate };
