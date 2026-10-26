'use strict';

// Writes plugins/catalog.json: the approved plugins JPMixer lists under
// Settings → Integrations → Plugins → Find plugins (src/server/plugin-store.js).
// Run it after adding or updating an approved plugin in plugins/<id>/:
//   node scripts/build-plugin-catalog.js
// Each plugin's name, version and permissions come from its plugin.json; every
// file is listed with its size and SHA-256, and JPMixer refuses any download
// that doesn't match. `--check` only says whether catalog.json is up to date.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', 'plugins');
const OUT = path.join(ROOT, 'catalog.json');
const SKIP = new Set(['.DS_Store', '.git', '__MACOSX', 'node_modules/.cache']);

function files(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) throw new Error(`${path.relative(ROOT, p)} is a link; approved plugins hold plain files only`);
    if (e.isDirectory()) out.push(...files(p, base));
    else if (e.isFile()) {
      const buf = fs.readFileSync(p);
      out.push({ path: path.relative(base, p).split(path.sep).join('/'), size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') });
    }
  }
  return out;
}

function build() {
  const plugins = [];
  for (const e of fs.readdirSync(ROOT, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const dir = path.join(ROOT, e.name);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
    if (manifest.id !== e.name) throw new Error(`plugins/${e.name}: its folder must be named after its id ("${manifest.id}")`);
    plugins.push({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description || '',
      author: manifest.author || '',
      ...(manifest.homepage ? { homepage: manifest.homepage } : {}),
      permissions: manifest.permissions || [],
      ...(manifest.minJPMixer ? { minJPMixer: manifest.minJPMixer } : {}),
      path: e.name,
      files: files(dir),
    });
  }
  return JSON.stringify({ version: 1, plugins }, null, 2) + '\n';
}

if (require.main === module) {
  const next = build();
  if (process.argv.includes('--check')) {
    const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (now !== next) { console.error('plugins/catalog.json is out of date: run node scripts/build-plugin-catalog.js'); process.exit(1); }
    console.log('plugins/catalog.json is up to date');
  } else {
    fs.writeFileSync(OUT, next);
    console.log(`Wrote plugins/catalog.json (${JSON.parse(next).plugins.length} plugins)`);
  }
}

module.exports = { build, OUT };
