'use strict';
// The Custom Pages plugin (plugins/custom-pages): link-only pages whose faders
// stop at their highest level, set up only from the JPMixer computer, and the
// host's side of it (the "faders" permission is JPMixer's own plugins only;
// the page is kept off the Home pages list; "opened on this computer" comes
// from this computer's pass, not from the page).

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return path.join(__dirname, '_fake-electron-for-tests.js');
  return origResolve.call(this, request, ...args);
};
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-custom-pages-test-'));
process.env.JPM_TEST_USERDATA = userData;

const test = require('node:test');
const assert = require('node:assert/strict');
const plugins = require('./plugins');
const SOURCE = path.join(__dirname, '..', '..', 'plugins', 'custom-pages');
const pages = require(path.join(SOURCE, 'pages.js'));

test('the cap: a move stops at the highest level, and a fader above it can only come down', () => {
  assert.equal(pages.allowedLevel(0, -10, -5), -5, 'under the cap: as asked');
  assert.equal(pages.allowedLevel(0, -10, 6), 0, 'over it: stops at the cap');
  assert.equal(pages.allowedLevel(-6, null, 4), -6, 'not known yet: the cap');
  assert.equal(pages.allowedLevel(0, 6, 8), 6, 'the engineer put it above the cap: it can’t go higher…');
  assert.equal(pages.allowedLevel(0, 6, 3), 3, '…but it can come down');
  assert.equal(pages.allowedLevel(0, -10, 99), 0, 'past the fader’s own top');
  assert.equal(pages.allowedLevel(10, -10, 99), 10);
  assert.equal(pages.allowedLevel(0, -10, -999), -150, 'off is the bottom');
  assert.equal(pages.allowedLevel(0, -10, NaN), null);
  assert.equal(pages.allowedLevel(0, -10, '3'), null, 'only a number is a level');
});

test('a page as the editor sends it is tidied: its own id and key, each strip once, sensible limits', () => {
  const page = pages.cleanPage({ name: '  YTH\nWednesday ', faders: [{ kind: 'ch', n: 3, max: -2.04 }, { kind: 'ch', n: 3, max: 5 }, { kind: 'cg', n: 1, max: 40 }, { kind: 'aux', n: 1 }, { kind: 'ch', n: 0 }], mutes: 'yes', companion: true, columns: 99, key: 'chosen-by-the-page-000000' });
  assert.match(page.id, /^[0-9a-f]{10}$/);
  assert.match(page.key, /^[A-Za-z0-9_-]{24}$/);
  assert.notEqual(page.key, 'chosen-by-the-page-000000', 'the editor never chooses a key');
  assert.equal(page.name, 'YTH Wednesday');
  assert.deepEqual(page.faders, [{ kind: 'ch', n: 3, max: -2 }, { kind: 'cg', n: 1, max: 10 }]);
  assert.deepEqual([page.mutes, page.companion, page.columns, page.rows, page.enabled], [false, true, 4, 2, true]);
  const again = pages.cleanPage({ ...page, name: 'Renamed' }, page);
  assert.deepEqual([again.id, again.key], [page.id, page.key], 'a saved page keeps its id and link');
  // A hand-edited file: junk and duplicates dropped
  const store = pages.cleanStore({ pages: [page, { ...page }, { id: 'x', key: page.key }, null] });
  assert.equal(store.pages.length, 1);
  assert.equal(pages.pageForKey(store, page.key).id, page.id);
  assert.equal(pages.pageForKey(store, page.key.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))), null);
  assert.equal(pages.pageForKey({ pages: [{ ...page, enabled: false }] }, page.key), null, 'a page that’s off doesn’t open');
});

test('the host: "faders" is for JPMixer’s own plugins, and a link-only page stays off the Home pages list', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-fake-plugin-'));
  fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = () => {};');
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ id: 'fake-faders', name: 'Fake', main: 'index.js', permissions: ['faders'], settings: [{ key: 'x', type: 'text' }] }));
  assert.match(plugins.readManifest(dir).error, /Only JPMixer’s own plugins can ask for "faders"/);
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ id: 'fake-faders', name: 'Fake', main: 'index.js', permissions: ['companion'], settings: [{ key: 'x', type: 'text' }] }));
  assert.match(plugins.readManifest(dir).error, /Only JPMixer’s own plugins can ask for "companion"/);
  const real = plugins.readManifest(SOURCE);
  assert.equal(real.ok, true);
  assert.equal(real.manifest.page.listed, false);
});

// A fake console behind the host's fader API: what the plugin set, and what it reads
function fakeDesk() {
  const desk = { supported: true, type: 'digico', connected: true, ch: { 3: { db: -10, mute: false }, 4: { db: 6, mute: false } }, cg: { 1: { db: -5, mute: false } }, sets: [], primed: [] };
  return {
    desk,
    providers: {
      console: () => ({ type: 'digico', connected: true, channels: [{ number: 3, name: 'Handheld 1' }, { number: 4, name: 'Tracks' }], groups: [{ number: 1, name: 'Band' }], mixes: [] }),
      faders: (want) => { if (want) desk.primed.push(want); return { supported: desk.supported, type: desk.type, connected: desk.connected, ch: desk.ch, cg: desk.cg }; },
      setFader: (kind, n, what, value) => {
        desk.sets.push([kind, n, what, value]);
        const s = desk[kind][n] || (desk[kind][n] = { db: null, mute: false });
        if (what === 'fader') s.db = value; else s.mute = value;
        return true;
      },
      pageBase: async () => 'http://192.0.2.10:8080',
    },
  };
}

const until = async (fn, what = '') => { for (let i = 0; i < 160; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } throw new Error(`timed out${what ? `: ${what}` : ''}`); };
const LOCAL = { local: true, base: 'http://192.0.2.10:8080' };

test('the plugin: set up on this computer only, links open their page, caps hold, mutes and New link', async () => {
  plugins._reset();
  assert.equal((await plugins.installBundled('custom-pages')).ok, true, 'installed from the copy that comes with JPMixer');
  plugins.save({ 'custom-pages': { enabled: true, settings: {} } });
  const { desk, providers } = fakeDesk();
  await plugins.start(providers);
  try {
    await until(() => plugins.list().find((p) => p.id === 'custom-pages')?.state === 'running');
    assert.equal(plugins.list().find((p) => p.id === 'custom-pages').official, true, 'the approved files: JPMixer Original');
    assert.deepEqual(plugins.pages().map((p) => p.id), [], 'not on the Home pages list');
    assert.deepEqual(plugins.pages({ all: true }).map((p) => p.id), ['custom-pages'], 'Settings can still open it');

    // Without a link: the editor on this computer, nothing on any other device
    assert.equal((await plugins.callPage('custom-pages', 'open', {})).mode, 'nolink');
    assert.equal((await plugins.callPage('custom-pages', 'open', {}, LOCAL)).mode, 'editor');
    await assert.rejects(plugins.callPage('custom-pages', 'save', { page: { name: 'Sneaky', faders: [{ kind: 'ch', n: 4, max: 10 }] } }), /set up on the JPMixer computer/);
    await assert.rejects(plugins.callPage('custom-pages', 'editor', {}), /set up on the JPMixer computer/);

    const ed = await plugins.callPage('custom-pages', 'save', { page: { name: 'YTH Wednesday', faders: [{ kind: 'ch', n: 3, max: 0 }, { kind: 'ch', n: 4, max: 0 }, { kind: 'cg', n: 1, max: -3 }] } }, LOCAL);
    assert.equal(ed.base, 'http://192.0.2.10:8080', 'the editor gets the address phones use, for the link and QR code');
    assert.deepEqual(ed.console.channels.map((c) => c.name), ['Handheld 1', 'Tracks']);
    const page = ed.pages[0];
    const key = page.key;

    // The link opens it, with the console's names
    const opened = await plugins.callPage('custom-pages', 'open', { key });
    assert.equal(opened.mode, 'event');
    assert.deepEqual(opened.page.faders.map((f) => [f.name, f.max]), [['Handheld 1', 0], ['Tracks', 0], ['Band', -3]]);
    assert.equal(opened.page.mutes, false);
    assert.equal((await plugins.callPage('custom-pages', 'open', { key: 'x'.repeat(24) })).mode, 'gone');
    await until(() => desk.primed.some((w) => w.some((s) => s.kind === 'cg' && s.n === 1)));

    // The cap
    assert.equal((await plugins.callPage('custom-pages', 'move', { key, kind: 'ch', n: 3, level: 9 })).db, 0, 'pushed past the cap: stops there');
    assert.deepEqual(desk.sets.at(-1), ['ch', 3, 'fader', 0]);
    assert.equal((await plugins.callPage('custom-pages', 'move', { key, kind: 'ch', n: 3, level: -20 })).db, -20);
    assert.equal((await plugins.callPage('custom-pages', 'move', { key, kind: 'ch', n: 4, level: 9 })).db, 6, 'above the cap on the desk: can’t go higher');
    assert.equal((await plugins.callPage('custom-pages', 'move', { key, kind: 'ch', n: 4, level: 2 })).db, 2, 'but comes down');
    assert.equal((await plugins.callPage('custom-pages', 'move', { key, kind: 'ch', n: 4, level: 5 })).db, 2, 'and still can’t go back up');
    assert.equal((await plugins.callPage('custom-pages', 'move', { key, kind: 'ch', n: 4, level: -3 })).db, -3);
    assert.equal((await plugins.callPage('custom-pages', 'move', { key, kind: 'ch', n: 4, level: 5 })).db, 0, 'once under it, the cap holds');
    assert.equal((await plugins.callPage('custom-pages', 'move', { key, kind: 'cg', n: 1, level: 0 })).db, -3);
    await assert.rejects(plugins.callPage('custom-pages', 'move', { key, kind: 'ch', n: 5, level: -10 }), /isn’t on this page/);
    await assert.rejects(plugins.callPage('custom-pages', 'move', { key: 'y'.repeat(24), kind: 'ch', n: 3, level: -10 }), /doesn’t work any more/);
    await assert.rejects(plugins.callPage('custom-pages', 'mute', { key, kind: 'ch', n: 3, muted: true }), /no mute buttons/);

    // What the page polls
    const st = await plugins.callPage('custom-pages', 'state', { key, since: 0 });
    assert.deepEqual(st.console, { supported: true, connected: true });
    assert.deepEqual(st.faders.map((f) => [f.n, f.db]), [[3, -20], [4, 0], [1, -3]]);
    assert.equal(st.companion, null);

    // Mute buttons on: they work
    await plugins.callPage('custom-pages', 'save', { page: { ...page, mutes: true, faders: page.faders } }, LOCAL);
    assert.deepEqual(await plugins.callPage('custom-pages', 'mute', { key, kind: 'ch', n: 3, muted: true }), { muted: true });
    assert.deepEqual(desk.sets.at(-1), ['ch', 3, 'mute', true]);

    // New link: the old one stops at once; off: the link shows it isn't available
    const renewed = await plugins.callPage('custom-pages', 'newLink', { id: page.id }, LOCAL);
    const newKey = renewed.pages[0].key;
    assert.notEqual(newKey, key);
    assert.equal((await plugins.callPage('custom-pages', 'open', { key })).mode, 'gone');
    assert.equal((await plugins.callPage('custom-pages', 'open', { key: newKey })).mode, 'event');
    await plugins.callPage('custom-pages', 'save', { page: { ...renewed.pages[0], enabled: false } }, LOCAL);
    assert.equal((await plugins.callPage('custom-pages', 'open', { key: newKey })).mode, 'gone');
    assert.equal((await plugins.callPage('custom-pages', 'state', { key: newKey })).gone, true);

    // Kept across a restart
    await plugins.restart('custom-pages');
    await until(() => plugins.list().find((p) => p.id === 'custom-pages')?.state === 'running');
    assert.equal((await plugins.callPage('custom-pages', 'editor', {}, LOCAL)).pages[0].name, 'YTH Wednesday');
    await plugins.callPage('custom-pages', 'remove', { id: page.id }, LOCAL);
    assert.deepEqual((await plugins.callPage('custom-pages', 'editor', {}, LOCAL)).pages, []);
  } finally {
    await plugins.stopAll();
    await until(() => plugins._running.size === 0); // stopAll doesn't wait for them to exit
  }
});

test('a copy whose files were changed can’t move the faders, even with the right id', async () => {
  plugins._reset();
  plugins.save({ 'custom-pages': { enabled: false } }); // off while its files are changed
  assert.equal((await plugins.installBundled('custom-pages')).ok, true);
  const folder = path.join(userData, 'plugins', 'custom-pages');
  // The same plugin with its files changed (its cap check could be gone): not the approved files any more
  const index = path.join(folder, 'index.js');
  fs.appendFileSync(index, '\n// changed\n');
  plugins.save({ 'custom-pages': { enabled: true, settings: {} } });
  const { desk, providers } = fakeDesk();
  await plugins.start(providers);
  try {
    await until(() => plugins.list().find((p) => p.id === 'custom-pages')?.state === 'running');
    assert.equal(plugins._running.get('custom-pages').official, false, 'checked as it started: not the approved files');
    const ed = await plugins.callPage('custom-pages', 'save', { page: { name: 'Changed', faders: [{ kind: 'ch', n: 3, max: 0 }] } }, LOCAL);
    await assert.rejects(plugins.callPage('custom-pages', 'move', { key: ed.pages[0].key, kind: 'ch', n: 3, level: 10 }), /official copy/);
    assert.deepEqual(desk.sets, [], 'nothing reached the console');
  } finally {
    await plugins.stopAll();
    await until(() => plugins._running.size === 0); // stopAll doesn't wait for them to exit
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('the page is told it was opened on this computer only with this computer’s pass', async () => {
  plugins._reset();
  assert.equal((await plugins.installBundled('custom-pages')).ok, true, 'installed from the copy that comes with JPMixer');
  plugins.save({ 'custom-pages': { enabled: true, settings: {} } });
  const { providers } = fakeDesk();
  await plugins.start(providers);
  const express = require('express');
  const app = express();
  plugins.mountPluginPages(app);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const access = require('./access');
  const req = (method, p, headers = {}, body) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d })); });
    r.on('error', reject); r.end(body);
  });
  try {
    await until(() => plugins.list().find((p) => p.id === 'custom-pages')?.state === 'running');
    const meta = (html, name) => (new RegExp(`<meta name="${name}" content="([^"]+)">`).exec(html) || [])[1];
    // From this computer's address but without its pass (a phone through the port 80 helper)
    const phone = await req('GET', '/p/custom-pages/');
    assert.equal(phone.status, 200);
    assert.equal(meta(phone.body, 'jpmixer-local'), undefined);
    const own = await req('GET', '/p/custom-pages/', { cookie: `${access.LOCAL_COOKIE}=${access.localPass()}` });
    const localToken = meta(own.body, 'jpmixer-local');
    assert.ok(localToken, 'JPMixer’s own window, or a browser opened from Settings');
    const token = meta(own.body, 'jpmixer-token');
    const open = async (extra) => JSON.parse((await req('POST', '/plugin-api/custom-pages/open', { 'Content-Type': 'application/json', 'X-JPMixer-Token': token, ...extra }, '{}')).body).result.mode;
    assert.equal(await open({}), 'nolink');
    assert.equal(await open({ 'X-JPMixer-Local': 'made-up-made-up-made-up-made-up-made-up!' }), 'nolink');
    assert.equal(await open({ 'X-JPMixer-Local': localToken }), 'editor');
  } finally {
    server.close();
    await plugins.stopAll();
    await until(() => plugins._running.size === 0); // stopAll doesn't wait for them to exit
  }
});

test('Companion buttons on a custom page go through the Companion buttons plugin: its surface, its buttons, taps', async () => {
  const net = require('net');
  const lines = [];
  let sock = null;
  // A stand-in Companion, speaking Satellite
  const companion = net.createServer((s) => { sock = s; s.setEncoding('utf8'); let buf = ''; s.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) !== -1) { lines.push(buf.slice(0, i)); buf = buf.slice(i + 1); } }); s.write('BEGIN CompanionVersion=3.4.0 ApiVersion=1.5.0\n'); });
  await new Promise((r) => companion.listen(0, '127.0.0.1', r));
  const cfg = { companionEnabled: true, companionHost: '127.0.0.1', companionPort: companion.address().port, companionColumns: 8, companionRows: 4 };
  const cs = require('./companion-satellite');
  const integrations = require('./integrations');
  plugins._reset();
  plugins.save({ 'custom-pages': { enabled: false } });
  assert.equal((await plugins.installBundled('companion')).ok, true);
  assert.equal((await plugins.installBundled('custom-pages')).ok, true);
  plugins.save({ 'custom-pages': { enabled: true, settings: {} } });
  const { providers } = fakeDesk();
  // As main.js hands them over
  providers.companion = (op, body) => (op === 'surfaces' ? cs.setCustomSurfaces(body.list) : op === 'view' ? cs.customView(String(body.id), body.since) : op === 'press' ? cs.customPress(String(body.id), Number(body.index), body.pressed === true) : cs.customStatus());
  cs.applyConfig(cfg);
  await plugins.start(providers);
  integrations.applyConfig(cfg);
  try {
    await until(() => plugins.list().find((p) => p.id === 'companion')?.state === 'running' && plugins.list().find((p) => p.id === 'custom-pages')?.state === 'running', 'both running');
    await until(() => lines.filter((l) => l.startsWith('ADD-DEVICE')).length >= 4, 'the Home pages’ surfaces');
    for (const role of ['foh', 'propresenter', 'lighting', 'switcher']) sock.write(`ADD-DEVICE OK DEVICEID=jpmixer-${role}\n`);
    // A page with its Companion card on: a surface of its own, in the Companion plugin's connection
    const ed = await plugins.callPage('custom-pages', 'save', { page: { name: 'YTH "Wed"', companion: true, columns: 2, rows: 1, faders: [{ kind: 'ch', n: 3, max: 0 }] } }, LOCAL);
    const page = ed.pages.find((p) => p.id === ed.saved);
    const dev = `jpmixer-ev-${page.id}`;
    await until(() => lines.some((l) => l.startsWith(`ADD-DEVICE DEVICEID=${dev}`)), 'the custom page’s surface');
    assert.match(lines.find((l) => l.startsWith(`ADD-DEVICE DEVICEID=${dev}`)), /PRODUCT_NAME="JPMixer YTH  Wed " KEYS_TOTAL=2 KEYS_PER_ROW=2/, 'named after the page, its own grid (quotes can’t break the line)');
    assert.equal(ed.companion.state === 'missing' || ed.companion.state === 'off', false, 'the editor sees the Companion plugin set up');
    sock.write(`ADD-DEVICE OK DEVICEID=${dev}\n`);
    sock.write(`KEY-STATE DEVICEID=${dev} KEY=1 TEXT=${Buffer.from('Go').toString('base64')} COLOR=#ff0000\n`);
    const shown = await until(async () => { const st = await plugins.callPage('custom-pages', 'state', { key: page.key, since: 0 }); return st.companion && st.companion.keys.length ? st.companion : null; });
    assert.deepEqual([shown.live, shown.full, shown.columns, shown.rows, shown.keys[0].index, shown.keys[0].text, shown.keys[0].color], [true, true, 2, 1, 1, 'Go', '#ff0000']);
    assert.deepEqual((await plugins.callPage('custom-pages', 'state', { key: page.key, since: shown.rev })).companion.keys, [], 'nothing new since: nothing sent again');
    assert.deepEqual(await plugins.callPage('custom-pages', 'press', { key: page.key, index: 1, pressed: true }), { sent: true });
    await until(() => lines.includes(`KEY-PRESS DEVICEID=${dev} KEY=1 PRESSED=true`));
    // Its card turned off: the surface goes from Companion
    await plugins.callPage('custom-pages', 'save', { page: { ...page, companion: false } }, LOCAL);
    await until(() => lines.includes(`REMOVE-DEVICE DEVICEID=${dev}`));
    await assert.rejects(plugins.callPage('custom-pages', 'press', { key: page.key, index: 1, pressed: true }), /no Companion buttons/);
    // Without the Companion buttons plugin, the page says so
    integrations.applyConfig({ ...cfg, companionEnabled: false });
    cs.applyConfig({ ...cfg, companionEnabled: false });
    await plugins.callPage('custom-pages', 'save', { page: { ...page, companion: true } }, LOCAL);
    assert.match((await plugins.callPage('custom-pages', 'state', { key: page.key, since: 0 })).companion.note, /Companion buttons are off/);
  } finally {
    await plugins.stopAll();
    await until(() => plugins._running.size === 0);
    companion.close();
  }
});

test('Companion for custom pages only: with the Home page surfaces off, just the custom page’s surface, even when Companion starts after the page', async () => {
  const net = require('net');
  const lines = [];
  let sock = null;
  const companion = net.createServer((s) => { sock = s; s.setEncoding('utf8'); let buf = ''; s.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) !== -1) { lines.push(buf.slice(0, i)); buf = buf.slice(i + 1); } }); s.on('error', () => {}); s.write('BEGIN CompanionVersion=4.0.0 ApiVersion=1.7.0\n'); });
  await new Promise((r) => companion.listen(0, '127.0.0.1', r));
  const cfg = { companionEnabled: true, companionHome: false, companionHost: '127.0.0.1', companionPort: companion.address().port, companionColumns: 8, companionRows: 4 };
  const cs = require('./companion-satellite');
  const integrations = require('./integrations');
  const express = require('express');
  const app = express();
  cs.mountCompanion(app);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const homeState = async () => (await fetch(`http://127.0.0.1:${server.address().port}/companion/state?role=foh`)).json();
  plugins._reset();
  plugins.save({ 'custom-pages': { enabled: false } });
  assert.equal((await plugins.installBundled('companion')).ok, true);
  assert.equal((await plugins.installBundled('custom-pages')).ok, true);
  plugins.save({ 'custom-pages': { enabled: true, settings: {} } });
  const { providers } = fakeDesk();
  providers.companion = (op, body) => (op === 'surfaces' ? cs.setCustomSurfaces(body.list) : op === 'view' ? cs.customView(String(body.id), body.since) : op === 'press' ? cs.customPress(String(body.id), Number(body.index), body.pressed === true) : cs.customStatus());
  // Companion off to begin with: the page is made first
  cs.applyConfig({ ...cfg, companionEnabled: false });
  await plugins.start(providers);
  try {
    await until(() => plugins.list().find((p) => p.id === 'custom-pages')?.state === 'running', 'Custom Pages running');
    const ed = await plugins.callPage('custom-pages', 'save', { page: { name: 'Youth', companion: true, columns: 4, rows: 2, faders: [{ kind: 'ch', n: 3, max: 0 }] } }, LOCAL);
    assert.match(ed.companion.message, /Home page surfaces can stay off/);
    const page = ed.pages.find((p) => p.id === ed.saved);
    const dev = `jpmixer-ev-${page.id}`;
    // Now Companion is turned on, for the custom pages only
    cs.applyConfig(cfg);
    integrations.applyConfig(cfg);
    await until(() => lines.some((l) => l.startsWith(`ADD-DEVICE DEVICEID=${dev}`)), 'the custom page’s surface, asked for again when Companion started');
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(lines.filter((l) => l.startsWith('ADD-DEVICE') && !/DEVICEID=jpmixer-ev-/.test(l)), [], 'no Home page surfaces');
    sock.write(`ADD-DEVICE OK DEVICEID=${dev}\n`);
    sock.write(`KEY-STATE DEVICEID=${dev} KEY=0 TEXT=${Buffer.from('Walk-in').toString('base64')}\n`);
    const shown = await until(async () => { const st = await plugins.callPage('custom-pages', 'state', { key: page.key, since: 0 }); return st.companion && st.companion.keys.length ? st.companion : null; });
    assert.deepEqual([shown.live, shown.note, shown.keys[0].text], [true, '', 'Walk-in']);
    const home = await homeState();
    assert.deepEqual([home.enabled, home.homeOff, home.state], [false, true, 'off'], 'FOH Home shows its Companion card as off');
    assert.match(home.message, /Custom Pages only/);
    assert.match(cs.getStatus().message, /Custom Pages only\./, 'the Companion tab says so');
    // The Home page surfaces turned on: Companion gets them too, and the custom page's again
    lines.length = 0;
    cs.applyConfig({ ...cfg, companionHome: true });
    integrations.applyConfig({ ...cfg, companionHome: true });
    await until(() => ['foh', 'propresenter', 'lighting', 'switcher', `ev-${page.id}`].every((r) => lines.some((l) => l.startsWith(`ADD-DEVICE DEVICEID=jpmixer-${r} `))), 'every surface');
    sock.write('ADD-DEVICE OK DEVICEID=jpmixer-foh\n');
    await until(async () => (await homeState()).registered === true, 'FOH Home’s surface');
  } finally {
    server.close();
    await plugins.stopAll();
    await until(() => plugins._running.size === 0);
    companion.close();
  }
});
