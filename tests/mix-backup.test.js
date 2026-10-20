'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const backup = require('../src/server/mix-backup');
const crc32 = require('buffer-crc32');
const root = path.resolve(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
const mix = value => ({ levels: { 1: value, 50: 0 }, pans: { 1: 0.5 }, owner: 'Performer', aux: 6, savedAt: '2026-10-19T12:00:00.000Z' });
const fixture = { phone: { Sunday: mix(0.75) } };
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jpm-mix-backup-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function store() {
  const files = new Map(); let failFile = null;
  const context = {
    module: { exports: {} }, console: { error() {} },
    require(name) {
      if (name === 'electron') return { app: { getPath: () => '/isolated' } };
      if (name === './safe-write') return {
        loadJsonObject: () => null,
        writeFileAtomic(file, text) { if (file.endsWith(failFile || '\0')) throw Error('disk full'); files.set(path.basename(file), JSON.parse(text)); }
      };
      return require(name.startsWith('.') ? path.join(root, 'src/server', name) : name);
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/server/presets.js'), 'utf8'), context);
  return { presets: context.module.exports, files, fail: name => { failFile = name; } };
}
// Small stored ZIP fixture, including the Mac resource entries in extracted archives.
function zip(entries) {
  const local = [], central = []; let offset = 0;
  for (const [filename, text] of entries) {
    const name = Buffer.from(filename), data = Buffer.from(text), crc = crc32.unsigned(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    local.push(h, name, data); central.push(c, name); offset += h.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

test('mix-only export roundtrips levels, pans, metadata and aliases', async t => {
  const file = path.join(temp(t), 'mixes.json');
  backup.write(file, fixture, { oldPhone: 'phone' }, '1.8.0');
  const data = await backup.read(file);
  assert.deepEqual(data, { presets: fixture, aliases: { oldPhone: 'phone' }, mixes: 1, devices: 1, dropped: 0 });
  const exported = JSON.parse(fs.readFileSync(file)); assert.equal(exported.type, 'mix-backup'); assert.equal(exported.config, undefined); assert.equal(exported.scenes, undefined);
});

test('accepts raw presets and both full backup formats while ignoring scenes/config', () => {
  for (const data of [fixture, { app: 'JPMixer', type: 'backup', version: 1, config: {}, presets: fixture }, { app: 'JPMixer', type: 'backup', version: 2, config: {}, scenes: {}, presets: fixture }]) assert.deepEqual(backup.validate(data).presets, fixture);
});

test('reads an extracted Mac ZIP and ignores the separate scenes file', async t => {
  const file = path.join(temp(t), 'mixes.zip');
  fs.writeFileSync(file, zip([['__MACOSX/saves/._presets.json', 'resource fork'], ['saves/scenes.json', '{not a preset}'], ['saves/presets.json', JSON.stringify(fixture)], ['saves/preset-aliases.json', '{"old":"phone"}']]));
  const data = await backup.read(file); assert.equal(data.mixes, 1); assert.deepEqual(data.aliases, { old: 'phone' });
});

test('rejects malformed data, scenes, future formats, cycles, invalid levels and ambiguous ZIPs', async t => {
  for (const data of [null, [], {}, { Snapshot: { 6: { 1: 0.5 } } }, { app: 'JPMixer', type: 'mix-backup', version: 9, presets: fixture }, { phone: { Sunday: { levels: { 1: 999 } } } }, { app: 'JPMixer', type: 'mix-backup', version: 1, presets: fixture, presetAliases: { a: 'b', b: 'a' } }]) assert.throws(() => backup.validate(data));
  const dir = temp(t), file = path.join(dir, 'bad.zip'); fs.writeFileSync(file, zip([['a/presets.json', JSON.stringify(fixture)], ['b/presets.json', JSON.stringify(fixture)]])); await assert.rejects(backup.read(file), /multiple/);
  fs.writeFileSync(file, zip([['scenes.json', '{}']])); await assert.rejects(backup.read(file), /no presets/);
  const json = path.join(dir, 'bad.json'); fs.writeFileSync(json, 'not json'); await assert.rejects(backup.read(json), /valid JSON/);
});

test('import keeps existing mixes, suffixes conflicts and skips repeated copies', () => {
  const { presets } = store(); presets.savePreset('phone', 'Sunday', { 1: 0.2 }, { 1: 0.5 });
  const before = plain(presets.getPreset('phone', 'Sunday'));
  const result = presets.importMixes(fixture); assert.equal(result.ok, true); assert.equal(result.imported, 1); assert.equal(result.renamed, 1);
  assert.deepEqual(plain(presets.getPreset('phone', 'Sunday')), before); assert.deepEqual(plain(presets.getPreset('phone', 'Sunday (2)')), fixture.phone.Sunday);
  const again = presets.importMixes(fixture); assert.equal(again.imported, 0); assert.equal(again.skipped, 1); assert.equal(Object.keys(presets.getByDevice('phone')).length, 2);
});

test('import respects existing device merges and restores backup aliases without redirecting existing groups', () => {
  const { presets } = store(); presets.savePreset('old', 'Existing', { 1: 0.2 }, {}); presets.savePreset('current', 'Current', { 1: 0.3 }, {}); presets.mergeDevices('old', 'current');
  const result = presets.importMixes({ old: fixture.phone }); assert.equal(result.imported, 1); assert(presets.getPreset('current', 'Sunday'));
  presets.importMixes({ recovered: fixture.phone }, { restoredPhone: 'recovered', current: 'recovered' });
  assert(presets.getPreset('restoredPhone', 'Sunday')); assert.equal(presets.resolve('current'), 'current');
});

test('disk failures roll back mix and alias memory and the saved mix file', () => {
  for (const file of ['presets.json', 'preset-aliases.json']) {
    const { presets, files, fail } = store(); presets.savePreset('existing', 'Keep', { 1: 0.2 }, {}); const before = plain(presets.getAll());
    fail(file); const result = presets.importMixes(fixture, { old: 'phone' }); assert.equal(result.ok, false); assert.deepEqual(plain(presets.getAll()), before); assert.deepEqual(plain(presets.getAliases()), {}); assert.deepEqual(files.get('presets.json'), before);
  }
});

test('unified loader IPC inspects without applying, checks the owning window and restores only requested sections', async () => {
  const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const start = source.indexOf('let pendingRestore = null;'), end = source.indexOf('// ── Settings → My Mixes admin', start);
  const handlers = {}, calls = [], event = { sender:{ id:1 } };
  const context = { path,ipcMain:{ handle:(name,fn) => { handlers[name] = fn; } },BrowserWindow:{ getFocusedWindow:() => null },dialogParent:() => undefined,dialog:{ showOpenDialog:async () => ({ filePaths:['mixes.zip'] }) },
    require:() => ({ read:async () => { calls.push('inspect'); return fixture; },describe:() => ({ filename:'mixes.zip',kind:'My Mixes',sections:[{ id:'mixes' }] }),apply:async (_data,sections,mode) => { calls.push([sections,mode]); return { ok:true,selected:sections,configChanged:false,mixes:{ imported:1,skipped:0,renamed:0,deviceIds:['phone'] } }; } }),
    config:{},presets:{},scenes:{},autoBackup:{},serverRunning:true,server:{ pushDevicePresets:id => calls.push('push:'+id) }
  };
  vm.runInNewContext(source.slice(start,end),context);
  const preview = await handlers['inspect-backup'](event); assert.equal(preview.ok,true); assert.deepEqual(calls,['inspect']);
  assert.equal((await handlers['restore-backup']({ sender:{ id:2 } },{ id:preview.id,sections:['mixes'],mixMode:'merge' })).ok,false);
  const result = await handlers['restore-backup'](event,{ id:preview.id,sections:['mixes'],mixMode:'merge' }); assert.equal(result.ok,true);
  assert.deepEqual(plain(calls),['inspect',[['mixes'],'merge'],'push:phone']);
  assert.equal((await handlers['restore-backup'](event,{ id:preview.id,sections:['mixes'],mixMode:'merge' })).ok,false);
});

test('copy/paste snapshots one or all mixes, preserves source and uses destination owner', () => {
  const { presets } = store();
  presets.savePreset('source', 'Sunday', { 1: 0.8 }, { 1: 0.2 }, { owner: 'Source', aux: 6 });
  presets.savePreset('source', 'Rehearsal', { 1: 0.6 }, {});
  presets.savePreset('target', 'Keep', { 1: 0.1 }, {}, { owner: 'Target', aux: 9 });
  const before = plain(presets.getAll());
  const clip = presets.copyMixes('source', ['Sunday']); assert.equal(clip.ok, true);
  assert.deepEqual(Object.keys(clip.mixes), ['Sunday']);
  const pasted = presets.pasteMixes('target', clip); assert.equal(pasted.copied, 1);
  const result = presets.getPreset('target', 'Sunday'); assert.deepEqual(plain(result.levels), { 1: 0.8 }); assert.deepEqual(plain(result.pans), { 1: 0.2 }); assert.equal(result.owner, 'Target'); assert.equal(result.aux, undefined);
  assert.deepEqual(plain(presets.getByDevice('source')), before.source); assert.deepEqual(plain(presets.getPreset('target', 'Keep')), before.target.Keep);
  const all = presets.copyMixes('source', null); assert.equal(Object.keys(all.mixes).length, 2);
  presets.deletePreset('source', 'Sunday');
  assert.equal(presets.pasteMixes('new-phone', all).copied, 2);
  assert.deepEqual(plain(presets.getPreset('new-phone', 'Sunday').levels), { 1: 0.8 }); assert.equal(presets.getPreset('new-phone', 'Sunday').owner, undefined);
});

test('paste suffixes conflicting names, skips identical copies and follows device aliases', () => {
  const { presets } = store();
  presets.savePreset('source', 'Sunday', { 1: 0.8 }, {}); presets.savePreset('target', 'Sunday', { 1: 0.2 }, {});
  presets.savePreset('old-target', 'Other', { 1: 0.1 }, {}); presets.mergeDevices('old-target', 'target');
  const clip = presets.copyMixes('source', null); const result = presets.pasteMixes('old-target', clip);
  assert.equal(result.toId, 'target'); assert.equal(result.renamed, 1); assert.equal(presets.getPreset('target', 'Sunday').levels[1], 0.2); assert.equal(presets.getPreset('target', 'Sunday (2)').levels[1], 0.8);
  const again = presets.pasteMixes('target', clip); assert.equal(again.copied, 0); assert.equal(again.skipped, 1);
  assert.equal(presets.pasteMixes('source', clip).ok, false);
});

test('invalid copy and failed paste leave source, destination and disk untouched', () => {
  const { presets, files, fail } = store(); presets.savePreset('source', 'Sunday', { 1: 0.8 }, {});
  assert.equal(presets.copyMixes('missing', null).ok, false); assert.equal(presets.copyMixes('source', ['missing']).ok, false); assert.equal(presets.copyMixes('source', []).ok, false); assert.equal(presets.pasteMixes('target', null).ok, false);
  const before = plain(presets.getAll()); const clip = presets.copyMixes('source', null); fail('presets.json');
  assert.equal(presets.pasteMixes('target', clip).ok, false); assert.deepEqual(plain(presets.getAll()), before); assert.deepEqual(files.get('presets.json'), before);
});

test('clipboard IPC backs up before paste, updates target list, and clears without console commands', async () => {
  const text = fs.readFileSync(path.join(root, 'main.js'), 'utf8'); const start = text.indexOf('let mixClipboard = null;'); const end = text.indexOf("ipcMain.handle('set-preset-owner'", start);
  const { presets } = store(); presets.savePreset('source', 'Sunday', { 1: 0.8 }, {});
  const handlers = {}, calls = []; let fail = false;
  const context = { ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }, presets, autoBackup: { writeBackup: async () => { calls.push('backup'); if (fail) throw Error('disk full'); } }, serverRunning: true, server: { getConnectedDevicesInfo: () => [{ deviceId: 'new-phone', aux: 6 }], pushDevicePresets: id => calls.push('push:' + id) } };
  vm.runInNewContext(text.slice(start, end), context);
  assert.equal((await handlers['paste-presets'](null, 'target')).ok, false);
  assert.equal(handlers['copy-presets'](null, 'source', ['Sunday']).ok, true);
  fail = true; assert.equal((await handlers['paste-presets'](null, 'target')).ok, false); assert.equal(presets.getPreset('target', 'Sunday'), null);
  calls.length = 0; fail = false; assert.equal((await handlers['paste-presets'](null, 'new-phone')).copied, 1); assert.deepEqual(calls, ['backup', 'push:new-phone']);
  assert.equal(handlers['get-mix-devices']()[0].deviceId, 'new-phone');
  handlers['clear-preset-clipboard'](); assert.equal((await handlers['paste-presets'](null, 'other')).ok, false);
});


test('Planning Center performer backups cannot be merged away into another identity', () => {
  const { presets } = store();
  presets.savePreset('pco-person:100', 'Alex ears', { 1: 0.4 }, {});
  presets.savePreset('pco-person:200', 'Sarah ears', { 1: 0.3 }, {});
  const before = plain(presets.getAll());
  assert.equal(presets.mergeDevices('pco-person:100', 'pco-person:200').ok, false);
  assert.deepEqual(plain(presets.getAll()), before);
  assert.equal(presets.pasteMixes('pco-person:200', presets.copyMixes('pco-person:100', null)).copied, 1);
});
