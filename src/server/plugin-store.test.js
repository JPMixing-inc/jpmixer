'use strict';
// plugin-store.js: the approved list (download, checked file by file), .zip /
// .jpmplugin files (nothing escapes the folder, no links), and the repo's
// plugins/catalog.json and docs/plugin-template being valid.

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return path.join(__dirname, '_fake-electron-for-tests.js');
  return origResolve.call(this, request, ...args);
};
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-plugin-store-test-'));
process.env.JPM_TEST_USERDATA = userData;

const test = require('node:test');
const assert = require('node:assert/strict');

// A stand-in for GitHub: the catalog and each plugin's files
const served = new Map();
const server = http.createServer((req, res) => {
  const body = served.get(decodeURIComponent(req.url));
  if (body === undefined) { res.writeHead(404); res.end(); return; }
  res.writeHead(200); res.end(body);
});
let base = '';
test.before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.JPM_PLUGIN_CATALOG = `${base}/plugins/catalog.json`;
});
test.after(() => server.close());
const store = () => require('./plugin-store');
const plugins = require('./plugins');

// A small zip writer (stored, not compressed) for the tests' archives
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries) { // [{ name, data, link }]
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name), data = Buffer.from(e.data || '');
    const crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((e.link ? 0o120777 : 0o100644) << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, name, data); centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const manifest = (id, extra = {}) => JSON.stringify({ id, name: id, version: '1.0.0', permissions: ['card'], settings: [{ key: 'x', label: 'X', type: 'text' }], ...extra });
const writeZip = (name, entries) => { const f = path.join(userData, name); fs.writeFileSync(f, zip(entries)); return f; };

test('paths from a zip or the list can’t climb out of the plugin’s folder', () => {
  const s = store();
  assert.equal(s._safeRelative('a/b.js'), 'a/b.js');
  assert.equal(s._safeRelative('a\\b.js'), 'a/b.js');
  for (const bad of ['../x.js', 'a/../../x', '/etc/passwd', 'C:/x', '']) assert.equal(s._safeRelative(bad), null, bad);
  assert.ok(s._newer('1.10.0', '1.9.3') > 0);
  assert.equal(s._newer('2.0.0', '2.0.0'), 0);
});

test('a .jpmplugin or .zip opens, with plugin.json at the top or in one folder', async () => {
  const top = await store().open(writeZip('top.jpmplugin', [{ name: 'plugin.json', data: manifest('zip-top') }, { name: 'index.js', data: 'module.exports = () => {};' }]));
  assert.equal(top.ok, true, top.error);
  assert.equal(top.manifest.id, 'zip-top');
  const result = await plugins.install(top.folder, { origin: 'file' });
  top.cleanup();
  assert.equal(result.ok, true);
  assert.equal(plugins.list().find((p) => p.id === 'zip-top').source, 'file', 'labelled as not from the approved list');

  const nested = await store().open(writeZip('nested.zip', [{ name: 'Nested/plugin.json', data: manifest('zip-nested') }, { name: 'Nested/index.js', data: 'module.exports = () => {};' }, { name: '__MACOSX/Nested/._index.js', data: 'junk' }]));
  assert.equal(nested.ok, true, nested.error);
  nested.cleanup();
});

test('a zip that would write outside its folder, holds a link, or has no plugin.json is refused', async () => {
  const slip = await store().open(writeZip('slip.zip', [{ name: '../../evil.js', data: 'x' }]));
  assert.equal(slip.ok, false);
  assert.match(slip.error, /outside the plugin’s folder/);
  assert.equal(fs.existsSync(path.join(userData, '..', 'evil.js')), false);
  const link = await store().open(writeZip('link.zip', [{ name: 'plugin.json', data: manifest('linky') }, { name: 'index.js', data: '/etc/passwd', link: true }]));
  assert.match(link.error, /contains a link/);
  const none = await store().open(writeZip('none.zip', [{ name: 'a/readme.txt', data: 'hi' }]));
  assert.match(none.error, /no plugin\.json/);
  const notZip = path.join(userData, 'bad.jpmplugin'); fs.writeFileSync(notZip, 'not a zip');
  assert.match((await store().open(notZip)).error, /isn’t a plugin or a zip/);
  // Nothing left over in the scratch folder
  const scratch = path.join(userData, 'plugin-scratch');
  assert.deepEqual(fs.existsSync(scratch) ? fs.readdirSync(scratch) : [], []);
});

test('the approved list: installed and up-to-date, an update, and a file that doesn’t match is refused', async () => {
  const files = { 'plugin.json': manifest('listed', { version: '1.2.0' }), 'index.js': 'module.exports = (jp) => jp.card.show({ value: "hi" });' };
  const entry = (version, tamper) => ({
    id: 'listed', name: 'Listed', version, description: 'From the list', author: 'Someone', permissions: ['card'], path: 'listed',
    files: Object.entries(files).map(([p, d]) => ({ path: p, size: Buffer.byteLength(d), sha256: crypto.createHash('sha256').update(tamper && p === 'index.js' ? 'other' : d).digest('hex') })),
  });
  for (const [p, d] of Object.entries(files)) served.set(`/plugins/listed/${p}`, d);
  served.set('/plugins/catalog.json', JSON.stringify({ version: 1, plugins: [entry('1.2.0'), { id: 'Bad Id', path: 'x', files: [] }] }));

  const list = await store().catalog('2.0.11');
  assert.equal(list.ok, true, list.error);
  assert.deepEqual(list.plugins.map((p) => p.id), ['listed'], 'entries that aren’t valid are left out');
  assert.equal(list.plugins[0].installedVersion, null);

  const opened = await store().openFromCatalog('listed');
  assert.equal(opened.ok, true, opened.error);
  assert.equal((await plugins.install(opened.folder, { origin: 'catalog' })).ok, true);
  opened.cleanup();
  assert.equal(plugins.list().find((p) => p.id === 'listed').source, 'catalog');
  assert.equal((await store().catalog('2.0.11')).plugins[0].installedVersion, '1.2.0');

  // A newer version on the list shows as an update; one needing a newer JPMixer can't be installed
  served.set('/plugins/catalog.json', JSON.stringify({ version: 1, plugins: [{ ...entry('1.3.0'), minJPMixer: '9.0.0' }] }));
  const later = (await store().catalog('2.0.11')).plugins[0];
  assert.equal(later.update, true);
  assert.equal(later.tooNew, true);

  // A file that doesn't match the list's hash: nothing is installed
  served.set('/plugins/catalog.json', JSON.stringify({ version: 1, plugins: [entry('1.2.0', true)] }));
  await store().catalog('2.0.11');
  const bad = await store().openFromCatalog('listed');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /doesn’t match the approved copy/);

  served.delete('/plugins/catalog.json');
  assert.match((await store().catalog('2.0.11')).error, /isn’t published yet/);
});

test('the repo’s plugins/catalog.json matches the plugins/ folder', () => {
  const { build, OUT } = require('../../scripts/build-plugin-catalog');
  assert.equal(fs.readFileSync(OUT, 'utf8'), build(), 'run node scripts/build-plugin-catalog.js');
  for (const p of JSON.parse(build()).plugins) assert.equal(plugins.readManifest(path.join(__dirname, '..', '..', 'plugins', p.path)).ok, true, `${p.id} loads`);
});

test('the starter in docs/plugin-template is a plugin JPMixer loads', () => {
  const read = plugins.readManifest(path.join(__dirname, '..', '..', 'docs', 'plugin-template'));
  assert.equal(read.ok, true, read.error);
});
