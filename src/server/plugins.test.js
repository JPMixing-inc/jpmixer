'use strict';
// plugins.js and plugin-runner.js: plugin.json checks, settings, and real
// plugin processes (a card, the console's names, what a plugin can't read,
// and starting again after a crash).

const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return path.join(__dirname, '_fake-electron-for-tests.js');
  return origResolve.call(this, request, ...args);
};
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-plugins-test-'));
process.env.JPM_TEST_USERDATA = userData;

const test = require('node:test');
const assert = require('node:assert/strict');
const plugins = require('./plugins');
// Plugin processes keep the test running; stop them even when a test fails
test.after(() => plugins.stopAll());

function makePlugin(folderName, manifest, code) {
  const folder = path.join(userData, 'plugins', folderName);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'plugin.json'), JSON.stringify(manifest));
  if (code !== undefined) fs.writeFileSync(path.join(folder, manifest.main || 'index.js'), code);
  return folder;
}
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
};

test('plugin.json: an id, a main file inside the folder, known permissions and valid settings', () => {
  const ok = makePlugin('good', {
    id: 'good-one', name: 'Good one', version: '1.0.0', permissions: ['card'],
    settings: [
      { key: 'host', label: 'Address', type: 'text', default: '10.0.0.5' },
      { key: 'port', label: 'Port', type: 'number', default: 1025, min: 1, max: 65535 },
      { key: 'mode', label: 'Mode', type: 'select', options: ['a', { value: 'b', label: 'B' }], default: 'b' },
      { key: 'on', label: 'On', type: 'checkbox' },
    ],
  }, 'module.exports = () => {};');
  const read = plugins.readManifest(ok);
  assert.equal(read.ok, true);
  assert.equal(read.manifest.cardTitle, 'Good one');
  assert.deepEqual(read.manifest.settings.map((f) => f.default), ['10.0.0.5', 1025, 'b', false]);

  assert.match(plugins.readManifest(makePlugin('bad-id', { id: 'Bad Id' }, '')).error, /"id"/);
  assert.match(plugins.readManifest(makePlugin('escape', { id: 'escape', main: '../good/index.js' })).error, /inside the plugin/);
  assert.match(plugins.readManifest(makePlugin('perm', { id: 'perm', permissions: ['fs'] }, '')).error, /Unknown permission: fs/);
  assert.match(plugins.readManifest(makePlugin('field', { id: 'field', settings: [{ key: 'x', type: 'colour' }] }, '')).error, /setting/);
  assert.match(plugins.readManifest(makePlugin('nomain', { id: 'nomain' })).error, /index\.js is missing/);
  assert.match(plugins.readManifest(makePlugin('nosettings', { id: 'nosettings', permissions: ['card'] }, '')).error, /at least one setting/, 'every plugin has a settings tab');
  for (const f of ['good', 'bad-id', 'escape', 'perm', 'field', 'nomain', 'nosettings']) fs.rmSync(path.join(userData, 'plugins', f), { recursive: true });
});

test('settings are kept as plugin.json describes them', () => {
  const port = { type: 'number', min: 1, max: 100, default: 5 };
  assert.equal(plugins._coerce(port, '250'), 100);
  assert.equal(plugins._coerce(port, 'x'), 5);
  const pick = { type: 'select', options: [{ value: 'a' }, { value: 'b' }], default: 'b' };
  assert.equal(plugins._coerce(pick, 'zzz'), 'b');
  assert.equal(plugins._coerce({ type: 'checkbox', default: true }, 'yes'), true);
  assert.equal(plugins._coerce({ type: 'text', default: '' }, 42), '');
});

test('a card is plain text, a few colors, and a limited number of rows', () => {
  const card = plugins._cleanCard({ value: 12.5, unit: 'min', color: 'purple', rows: Array.from({ length: 40 }, (_, i) => ({ label: `R${i}`, value: i, color: 'red' })), note: '<b>hi</b>\u0007' });
  assert.equal(card.value, '12.5');
  assert.equal(card.color, '');
  assert.equal(card.rows.length, 20);
  assert.equal(card.rows[3].value, '3');
  assert.equal(card.note, '<b>hi</b>', 'kept as text (pages show it with textContent); control characters dropped');
});

test('a plugin that’s on runs in its own process: its card, settings and the console’s names', async () => {
  plugins._reset();
  fs.writeFileSync(path.join(userData, 'config.json'), '{"pcoSecret":"do-not-read"}');
  makePlugin('hello', {
    id: 'hello', name: 'Hello', version: '0.1.0', permissions: ['card', 'console'],
    settings: [{ key: 'greeting', label: 'Greeting', type: 'text', default: 'Hi' }],
  }, `
    const fs = require('fs');
    module.exports = async (jp) => {
      let secret = 'read';
      try { fs.readFileSync(${JSON.stringify(path.join(userData, 'config.json'))}, 'utf8'); } catch (e) { secret = e.code; }
      let exec = 'ran';
      try { require('child_process').execSync('echo hi'); } catch (e) { exec = e.code; }
      fs.writeFileSync(jp.plugin.dataFolder + '/state.txt', 'saved');
      const desk = await jp.console.get();
      jp.card.show({ value: jp.settings.greeting, label: desk.type, rows: [{ label: 'config.json', value: secret }, { label: 'exec', value: exec }] });
      jp.console.onChange((d) => jp.card.show({ value: 'changed', label: String(d.connected) }));
      let planErr = '';
      try { await jp.planningCenter.get(); } catch (e) { planErr = e.message; }
      jp.status(planErr.includes('planningCenter') ? 'checked' : 'unexpected: ' + planErr, 'warn');
    };
  `);
  let desk = { type: 'digico', connected: false, channels: [], mixes: [] };
  await plugins.start({ console: () => desk, allowed: true });
  assert.equal(plugins._running.size, 0, 'off until turned on');
  assert.equal(plugins.cards().length, 0);

  assert.equal(plugins.save({ hello: { enabled: true, settings: { greeting: 'Welcome', nope: 1 } }, ghost: { enabled: true } }).ok, true);
  const saved = JSON.parse(fs.readFileSync(path.join(userData, 'plugins.json'), 'utf8'));
  assert.deepEqual(saved, { hello: { enabled: true, settings: { greeting: 'Welcome' }, watch: false } }, 'only plugins that exist, only their own settings');
  await plugins.apply();

  const card = await until(() => plugins.cards()[0]?.card);
  assert.equal(card.value, 'Welcome');
  assert.equal(card.label, 'digico');
  assert.deepEqual(card.rows.map((r) => r.value), ['ERR_ACCESS_DENIED', 'ERR_ACCESS_DENIED'], 'config.json and other programs are out of reach');
  assert.equal(fs.readFileSync(path.join(plugins.dataDir('hello'), 'state.txt'), 'utf8'), 'saved', 'its own data folder is writable');
  await until(() => plugins.list()[0].status?.text === 'checked');
  assert.equal(plugins.list()[0].status.level, 'warn');
  assert.equal(plugins.cards()[0].cardId, 'p-hello');

  // A change the console reports reaches onChange
  desk = { ...desk, connected: true };
  await until(() => plugins.cards()[0]?.card?.value === 'changed', 8000);
  assert.equal(plugins.cards()[0].card.label, 'true');

  // New settings restart it with them
  plugins.save({ hello: { settings: { greeting: 'Again' } } });
  await plugins.apply();
  await until(() => plugins.cards()[0]?.card?.value === 'Again');

  // Off: stopped, no card
  plugins.save({ hello: { enabled: false } });
  await plugins.apply();
  assert.equal(plugins._running.size, 0);
  assert.equal(plugins.cards().length, 0);
  await plugins.stopAll();
});

test('a plugin that crashes is started again, and its error is shown', async () => {
  plugins._reset();
  const marker = path.join(plugins.dataDir('crashy'), 'runs.txt');
  makePlugin('crashy', { id: 'crashy', name: 'Crashy', permissions: ['card'], settings: [{ key: 'note', label: 'Note', type: 'text' }] }, `
    const fs = require('fs');
    module.exports = (jp) => {
      const file = jp.plugin.dataFolder + '/runs.txt';
      let runs = 0; try { runs = Number(fs.readFileSync(file, 'utf8')); } catch (_) {}
      fs.writeFileSync(file, String(runs + 1));
      if (runs === 0) setTimeout(() => { throw new Error('boom'); }, 50);
      else jp.card.show({ value: 'run ' + (runs + 1) });
    };
  `);
  plugins.save({ crashy: { enabled: true } });
  await plugins.start({ allowed: true });
  await until(() => /boom/.test(plugins.list().find((p) => p.id === 'crashy').status?.text || ''));
  assert.match(plugins.getLog('crashy').map((l) => l.text).join('\n'), /Error: boom/);
  await until(() => plugins.cards().find((c) => c.id === 'crashy')?.card?.value === 'run 2', 10000);
  assert.equal(fs.readFileSync(marker, 'utf8'), '2');
  await plugins.stopAll();
});

test('a plugin can only use what plugin.json asks for', async () => {
  plugins._reset();
  makePlugin('quiet', { id: 'quiet', name: 'Quiet', permissions: [], settings: [{ key: 'note', label: 'Note', type: 'text' }] }, `
    module.exports = (jp) => {
      try { jp.card.show({ value: 'x' }); } catch (e) { jp.status(e.message, 'error'); }
    };
  `);
  plugins.save({ quiet: { enabled: true } });
  await plugins.start({ console: () => ({ secret: true }), allowed: true });
  const status = await until(() => plugins.list().find((p) => p.id === 'quiet').status?.level === 'error' && plugins.list().find((p) => p.id === 'quiet').status);
  assert.match(status.text, /add "card" to "permissions"/);
  assert.equal(plugins.cards().some((c) => c.id === 'quiet'), false, 'no card without the permission');
  await plugins.stopAll();
});

test('with Allow plugins off, none runs and FOH Home has no plugin cards', async () => {
  plugins._reset();
  makePlugin('gate', { id: 'gate', name: 'Gate', permissions: ['card'], settings: [{ key: 'note', label: 'Note', type: 'text' }] }, `module.exports = (jp) => jp.card.show({ value: 'on' });`);
  plugins.save({ gate: { enabled: true } });
  await plugins.start({ allowed: false });
  assert.equal(plugins._running.has('gate'), false, 'turned on itself, but plugins are off');
  assert.deepEqual(plugins.cards(), []);
  await plugins.setAllowed(true);
  await until(() => plugins.cards().find((c) => c.id === 'gate')?.card?.value === 'on');
  await plugins.setAllowed(false);
  assert.equal(plugins._running.size, 0, 'turning plugins off stops every one');
  assert.deepEqual(plugins.cards(), []);
  await plugins.stopAll();
});

test('Restart when its files change: saving a file starts it again with the change', async () => {
  plugins._reset();
  const folder = makePlugin('watched', { id: 'watched', name: 'Watched', permissions: ['card'], settings: [{ key: 'note', label: 'Note', type: 'text' }] }, `module.exports = (jp) => jp.card.show({ value: 'one' });`);
  plugins.save({ watched: { enabled: true, watch: true } });
  await plugins.start({ allowed: true });
  await until(() => plugins.cards().find((c) => c.id === 'watched')?.card?.value === 'one');
  fs.writeFileSync(path.join(folder, 'index.js'), `module.exports = (jp) => jp.card.show({ value: 'two' });`);
  await until(() => plugins.cards().find((c) => c.id === 'watched')?.card?.value === 'two', 8000);
  assert.equal(plugins.list().find((p) => p.id === 'watched').watch, true);
  await plugins.stopAll();
});

test('a plugin can’t use WASI to read past its folder', async () => {
  plugins._reset();
  makePlugin('wasi-try', { id: 'wasi-try', name: 'WASI try', permissions: ['card'], settings: [{ key: 'note', label: 'Note', type: 'text' }] }, `
    module.exports = async (jp) => {
      const tries = [];
      try { new (require('wasi').WASI)({ version: 'preview1', preopens: { '/r': '/' } }); tries.push('require: open'); } catch (e) { tries.push('require: blocked'); }
      try { const m = await import('node:wasi'); new m.WASI({ version: 'preview1', preopens: { '/r': '/' } }); tries.push('import: open'); } catch (e) { tries.push('import: blocked'); }
      try { require('worker_threads'); new (require('worker_threads').Worker)('1', { eval: true }); tries.push('worker: open'); } catch (e) { tries.push('worker: blocked'); }
      jp.card.show({ rows: tries.map((t) => ({ label: t.split(':')[0], value: t.split(': ')[1] })) });
    };
  `);
  plugins.save({ 'wasi-try': { enabled: true } });
  await plugins.start({ allowed: true });
  const card = await until(() => plugins.cards().find((c) => c.id === 'wasi-try')?.card);
  assert.deepEqual(card.rows.map((r) => `${r.label}: ${r.value}`), ['require: blocked', 'import: blocked', 'worker: blocked']);
  await plugins.stopAll();
});

test('a plugin that keeps crashing stops after five crashes, until it’s started again', async () => {
  plugins._reset();
  plugins._setRestartDelays([30, 30, 30, 30, 30]);
  try {
    makePlugin('always-crash', { id: 'always-crash', name: 'Always crash', permissions: [], settings: [{ key: 'note', label: 'Note', type: 'text' }] }, `module.exports = () => { throw new Error('nope'); };`);
    plugins.save({ 'always-crash': { enabled: true } });
    await plugins.start({ allowed: true });
    const p = await until(() => { const x = plugins.list().find((e) => e.id === 'always-crash'); return x.state === 'crashed' && x; }, 15000);
    assert.match(p.status.text, /Stopped after crashing 5 times/);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(plugins.list().find((e) => e.id === 'always-crash').state, 'crashed', 'it isn’t started again by itself');
    await plugins.apply({ force: true }); // Reload
    assert.notEqual(plugins.list().find((e) => e.id === 'always-crash').state, 'crashed', 'Reload tries again');
  } finally {
    plugins._setRestartDelays([2000, 5000, 15000, 30000, 60000]);
    await plugins.stopAll();
  }
});

test('a plugin’s page is served sandboxed, and only its own page can call it', async () => {
  plugins._reset();
  const folder = makePlugin('paged', {
    id: 'paged', name: 'Paged', permissions: ['page'], page: { title: 'My page' },
    settings: [{ key: 'note', label: 'Note', type: 'text' }],
  }, `
    module.exports = (jp) => {
      jp.page.handle('add', (body) => ({ sum: body.a + body.b }));
      jp.page.handle('fail', () => { throw new Error('nope, on purpose'); });
    };
  `);
  fs.mkdirSync(path.join(folder, 'page'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'page', 'index.html'), '<!doctype html><title>Paged</title>');
  fs.writeFileSync(path.join(folder, 'page', 'app.js'), 'console.log(1)');
  plugins.save({ paged: { enabled: true } });
  await plugins.start({ allowed: true });
  await until(() => plugins.list().find((p) => p.id === 'paged')?.state === 'running');
  assert.deepEqual(plugins.pages(), [{ id: 'paged', title: 'My page', plugin: 'Paged', href: '/p/paged/' }]);

  const express = require('express');
  const http = require('http');
  const app = express();
  plugins.mountPluginPages(app);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(`${base}/p/paged/`);
    assert.equal(page.status, 200);
    // The page's token, written into its <head>
    const token = ((await page.clone().text()).match(/<meta name="jpmixer-token" content="([0-9a-f]+)">/) || [])[1];
    assert.ok(token, 'the page carries its token');
    assert.match(await page.clone().text(), /^<!doctype html>\n<meta name="jpmixer-token"/, 'after the doctype, so the page isn’t in quirks mode');
    assert.equal(token, plugins._pageToken('paged'));
    assert.notEqual(plugins._pageToken('other'), token, 'each plugin page has its own');
    assert.match(page.headers.get('content-security-policy'), /^sandbox allow-scripts/, 'sandboxed: no same-origin, so no cookies or JPMixer pages');
    assert.doesNotMatch(page.headers.get('content-security-policy'), /allow-same-origin/);
    assert.equal((await fetch(`${base}/p/paged/app.js`)).status, 200);
    for (const bad of ['/p/paged/../plugin.json', '/p/paged/%2e%2e/plugin.json', '/p/paged/..%2fplugin.json', '/p/paged/.hidden', '/p/other/']) {
      assert.equal((await fetch(base + bad)).status, 404, bad);
    }
    const call = (name, body, headers) => fetch(`${base}/plugin-api/paged/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'null', 'X-JPMixer-Token': token, ...headers }, body: JSON.stringify(body) });
    const ok = await call('add', { a: 2, b: 3 });
    assert.deepEqual(await ok.json(), { ok: true, result: { sum: 5 } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'null');
    const failed = await call('fail', {});
    assert.equal(failed.status, 400);
    assert.match((await failed.json()).error, /nope, on purpose/);
    assert.match((await (await call('missing', {})).json()).error, /doesn’t answer "missing"/);
    assert.equal((await call('add', { a: 1, b: 1 }, { Origin: 'https://evil.example' })).status, 403, 'another website can’t call it');
    assert.equal((await call('add', { a: 1, b: 1 }, { 'X-JPMixer-Token': '' })).status, 403, 'a sandboxed frame on another site (Origin: null, no token) can’t call it');
    assert.equal((await call('add', { a: 1, b: 1 }, { 'X-JPMixer-Token': plugins._pageToken('other') })).status, 403, 'nor another plugin’s page');
    assert.equal((await fetch(`${base}/p/paged/app.js`)).headers.get('access-control-allow-origin'), null, 'its files can’t be read from another site');
    const preflight = await fetch(`${base}/plugin-api/paged/add`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(preflight.status, 403);
    assert.equal(plugins.list().find((p) => p.id === 'paged').state, 'running', 'an error in a handler doesn’t stop the plugin');

    // Off: no page, no calls
    plugins.save({ paged: { enabled: false } });
    await plugins.apply();
    plugins._reset();
    assert.equal((await fetch(`${base}/p/paged/`)).status, 404);
    assert.equal((await call('add', { a: 1, b: 1 })).status, 404);
    assert.deepEqual(plugins.pages(), []);
  } finally {
    server.close();
    await plugins.stopAll();
  }
});
