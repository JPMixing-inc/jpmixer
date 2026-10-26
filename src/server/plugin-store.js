'use strict';

// ── Getting plugins in ─────────────────────────────────────────────────────
// Two ways, both ending in plugins.js install() (which checks plugin.json,
// copies the folder in, and keeps the plugin off until it's turned on):
//
// 1. The approved list. JPMixer's GitHub repo has a plugins/ folder: each
//    approved plugin's source in a folder of its own, and catalog.json
//    listing them (each one's folder, beside catalog.json), with every
//    file's size and SHA-256 (scripts/build-plugin-catalog.js writes it when
//    a plugin is approved). Settings → Plugins → Find plugins reads that list,
//    only when someone opens it. Installing downloads each listed file and
//    refuses the plugin if any file's size or hash doesn't match.
// 2. A file: a .jpmplugin (a zip of the plugin's folder, the name JPMixer
//    opens with a double-click) or a .zip. It's unpacked into a scratch folder
//    first: no paths that climb out of it, no links, at most MAX_FILES files
//    and MAX_BYTES in all, and plugin.json at the top or in one folder.
//    A folder (Import folder…, for people making a plugin) is used as it is.
// How to make one is on GitHub: docs/PLUGINS.md and docs/plugin-template/.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yauzl = require('yauzl');
const plugins = require('./plugins');

// The approved list; JPM_PLUGIN_CATALOG points the tests at a stand-in
const CATALOG_URL = process.env.JPM_PLUGIN_CATALOG || 'https://raw.githubusercontent.com/JPMixing-inc/jpmixer/main/plugins/catalog.json';
const SUBMIT_URL = 'https://github.com/JPMixing-inc/jpmixer/issues/new?template=plugin-submission.yml';
const MAX_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 2000;
const MAX_CATALOG_BYTES = 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;
const ID = /^[a-z][a-z0-9-]{1,29}$/;
const SHA256 = /^[0-9a-f]{64}$/;

// A path inside a plugin, as given by a zip or the catalog: forward slashes,
// no leading slash or drive, nothing that climbs out
function safeRelative(name) {
  const p = String(name || '').replace(/\\/g, '/');
  if (!p || p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.includes('\0')) return null;
  const parts = p.split('/').filter((x) => x && x !== '.');
  if (!parts.length || parts.some((x) => x === '..')) return null;
  return parts.join('/');
}
const junk = (rel) => rel.split('/').some((x) => x === '__MACOSX' || x === '.DS_Store' || x === '.git');

// Unpacked and downloaded copies wait here (beside the plugins folder, not
// in it) until they're checked and installed
function scratchDir(label) {
  const dir = path.join(path.dirname(plugins.pluginsDir()), 'plugin-scratch', `${label}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const removeDir = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} };

// The folder in `dir` that holds plugin.json: dir itself, or its only folder
function pluginRoot(dir) {
  if (fs.existsSync(path.join(dir, 'plugin.json'))) return dir;
  const inside = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith('.') && e.name !== '__MACOSX');
  if (inside.length === 1 && inside[0].isDirectory() && fs.existsSync(path.join(dir, inside[0].name, 'plugin.json'))) return path.join(dir, inside[0].name);
  return null;
}

// ── A .jpmplugin or .zip file ──
function unzip(file, dest) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error) { reject(new Error('That file isn’t a plugin or a zip JPMixer can read.')); return; }
      let total = 0, files = 0, settled = false;
      const fail = (e) => { if (settled) return; settled = true; zip.close(); reject(e); };
      // yauzl itself refuses paths that climb out ("invalid relative path")
      zip.on('error', (e) => fail(new Error(/relative path|absolute path/i.test(String(e && e.message)) ? 'It has a file that would land outside the plugin’s folder.' : 'That zip is damaged.')));
      zip.on('entry', (entry) => {
        const rel = safeRelative(entry.fileName);
        if (!rel) return fail(new Error(`It has a file that would land outside the plugin’s folder (${entry.fileName}).`));
        if (junk(rel)) return zip.readEntry();
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (mode === 0o120000) return fail(new Error(`It contains a link (${rel}). Plugins can only hold plain files.`));
        const target = path.join(dest, ...rel.split('/'));
        if (/\/$/.test(entry.fileName)) { fs.mkdirSync(target, { recursive: true }); return zip.readEntry(); }
        if (++files > MAX_FILES) return fail(new Error(`It has more than ${MAX_FILES} files.`));
        if (total + entry.uncompressedSize > MAX_BYTES) return fail(new Error('It’s over 100 MB unpacked.'));
        zip.openReadStream(entry, (err, stream) => {
          if (err) return fail(new Error('That zip is damaged.'));
          fs.mkdirSync(path.dirname(target), { recursive: true });
          const out = fs.createWriteStream(target, { mode: 0o644 });
          stream.on('data', (chunk) => { total += chunk.length; if (total > MAX_BYTES) { stream.destroy(); out.destroy(); fail(new Error('It’s over 100 MB unpacked.')); } });
          stream.on('error', () => fail(new Error('That zip is damaged.')));
          out.on('error', (e) => fail(e));
          out.on('finish', () => { if (!settled) zip.readEntry(); });
          stream.pipe(out);
        });
      });
      zip.on('end', () => { if (!settled) { settled = true; resolve(); } });
      zip.readEntry();
    });
  });
}

// What's in a file or folder someone chose, before anything is installed:
// { ok, folder, manifest, existing, cleanup } — cleanup() removes the
// unpacked copy. A folder is used where it is.
async function open(chosen) {
  let stat;
  try { stat = fs.statSync(chosen); } catch (_) { return { ok: false, error: 'That file isn’t there any more.' }; }
  if (stat.isDirectory()) {
    const check = plugins.previewInstall(chosen);
    return check.ok ? { ...check, folder: chosen, cleanup: () => {} } : check;
  }
  if (!/\.(jpmplugin|zip)$/i.test(chosen)) return { ok: false, error: 'Choose a .jpmplugin or .zip file, or a plugin’s folder.' };
  const dir = scratchDir('opening');
  try { await unzip(chosen, dir); }
  catch (e) { removeDir(dir); return { ok: false, error: e.message }; }
  const root = pluginRoot(dir);
  if (!root) { removeDir(dir); return { ok: false, error: 'There’s no plugin.json at the top of it, or in a single folder inside it.' }; }
  const check = plugins.previewInstall(root);
  if (!check.ok) { removeDir(dir); return check; }
  return { ...check, folder: root, cleanup: () => removeDir(dir) };
}

// ── The approved list ──
async function fetchLimited(url, maxBytes) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'JPMixer' }, redirect: 'follow' });
    if (!res.ok) { controller.abort(); const e = new Error(res.status === 404 ? 'not-found' : `HTTP ${res.status}`); e.status = res.status; throw e; }
    const length = Number(res.headers.get('content-length'));
    if (Number.isFinite(length) && length > maxBytes) { controller.abort(); throw new Error('too-large'); }
    // Read as it arrives and stop as soon as it's over, whatever the header said
    const chunks = [];
    let total = 0;
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > maxBytes) { controller.abort(); throw new Error('too-large'); }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } finally { clearTimeout(timer); }
}

const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
// One listed plugin, checked; null if it isn't one
function cleanEntry(e) {
  if (!e || typeof e !== 'object' || !ID.test(String(e.id || ''))) return null;
  const dir = safeRelative(e.path);
  if (!dir) return null;
  const files = (Array.isArray(e.files) ? e.files : []).map((f) => ({ path: safeRelative(f && f.path), size: Number(f && f.size), sha256: String((f && f.sha256) || '').toLowerCase() }))
    .filter((f) => f.path && Number.isInteger(f.size) && f.size >= 0 && SHA256.test(f.sha256));
  if (!files.length || files.length > MAX_FILES || !files.some((f) => f.path === 'plugin.json')) return null;
  if (files.reduce((a, f) => a + f.size, 0) > MAX_BYTES) return null;
  return {
    id: e.id,
    name: text(e.name, 40) || e.id,
    version: text(e.version, 20),
    description: text(e.description, 300),
    author: text(e.author, 60),
    homepage: /^https:\/\/[^\s]{1,200}$/.test(String(e.homepage || '')) ? String(e.homepage) : '',
    permissions: (Array.isArray(e.permissions) ? e.permissions : []).filter((p) => Object.hasOwn(plugins.PERMISSIONS, p)),
    minJPMixer: /^\d+\.\d+\.\d+$/.test(String(e.minJPMixer || '')) ? e.minJPMixer : '',
    path: dir,
    files,
  };
}

// > 0 when version a is newer than b (x.y.z)
function newer(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0), pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

let lastCatalog = null; // { at, plugins } — the last good list, for installing from it
// The approved list, each with whether it's installed and if there's an
// update: { ok, plugins, submitUrl } or { ok: false, error }
async function catalog(appVersion) {
  let raw;
  try { raw = JSON.parse((await fetchLimited(CATALOG_URL, MAX_CATALOG_BYTES)).toString('utf8')); }
  catch (e) {
    return { ok: false, submitUrl: SUBMIT_URL, error: e.message === 'not-found' ? 'The list of approved plugins isn’t published yet.' : e.name === 'AbortError' ? 'GitHub didn’t answer in time. Check the internet connection.' : 'Couldn’t get the list of approved plugins. Check the internet connection.' };
  }
  const entries = (raw && Array.isArray(raw.plugins) ? raw.plugins : []).map(cleanEntry).filter(Boolean);
  lastCatalog = { at: Date.now(), plugins: entries };
  const installed = new Map(plugins.list().filter((p) => p.manifest).map((p) => [p.id, p]));
  return {
    ok: true,
    submitUrl: SUBMIT_URL,
    plugins: entries.map((e) => {
      const have = installed.get(e.id);
      return {
        id: e.id, name: e.name, version: e.version, description: e.description, author: e.author, homepage: e.homepage,
        permissions: e.permissions.map((p) => ({ id: p, text: plugins.PERMISSIONS[p] })),
        installedVersion: have ? have.manifest.version : null,
        installedFrom: have ? have.source : null,
        update: !!(have && newer(e.version, have.manifest.version) > 0),
        tooNew: !!(e.minJPMixer && appVersion && newer(e.minJPMixer, appVersion) > 0),
        minJPMixer: e.minJPMixer,
      };
    }),
  };
}

// Downloads one approved plugin into a scratch folder, checking every file
// against the list: { ok, folder, manifest, existing, cleanup }
async function openFromCatalog(id) {
  const entry = lastCatalog && lastCatalog.plugins.find((p) => p.id === id);
  if (!entry) return { ok: false, error: 'Refresh the list of approved plugins, then try again.' };
  const base = CATALOG_URL.replace(/[^/]*$/, ''); // each plugin's path is beside catalog.json
  const dir = scratchDir('downloading');
  try {
    for (const f of entry.files) {
      const buf = await fetchLimited(`${base}${entry.path}/${f.path.split('/').map(encodeURIComponent).join('/')}`, f.size);
      if (buf.length !== f.size || crypto.createHash('sha256').update(buf).digest('hex') !== f.sha256) throw new Error(`${f.path} doesn’t match the approved copy, so it wasn’t installed. If the plugin was just updated, try again in a few minutes.`);
      const target = path.join(dir, ...f.path.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, buf, { mode: 0o644 });
    }
  } catch (e) {
    removeDir(dir);
    return { ok: false, error: e.message === 'not-found' ? 'A file of this plugin is missing on GitHub.' : e.name === 'AbortError' ? 'GitHub didn’t answer in time.' : e.message === 'too-large' ? 'A file of this plugin doesn’t match the approved copy.' : e.message };
  }
  const check = plugins.previewInstall(dir);
  if (!check.ok) { removeDir(dir); return check; }
  if (check.manifest.id !== entry.id) { removeDir(dir); return { ok: false, error: 'This plugin’s id doesn’t match the list.' }; }
  return { ...check, folder: dir, cleanup: () => removeDir(dir) };
}

module.exports = { catalog, openFromCatalog, open, CATALOG_URL, SUBMIT_URL, _safeRelative: safeRelative, _newer: newer };
