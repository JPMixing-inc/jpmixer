'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function harness() {
  const cfg = { pcoPhoneAssignments: true, pcoUpdateAuxNames: true, pcoAppId: 'id', pcoSecret: 'secret', pcoServiceTypeId: 'service', pcoDay: 'Sunday', pcoPositionMapping: { Vocal: 6, Guitar: 7 }, auxes: 16, auxOverrides: {} };
  const members = [{ personId: '100', personName: 'Same Name', positionName: 'Vocal', confirmed: true, days: ['Sunday'] }, { personId: '200', personName: 'Same Name', positionName: 'Guitar', confirmed: true, days: [] }];
  const routes = {}, calls = [], store = { phone: { Sunday: { levels: { 1: 0.7 }, pans: { 1: 0.5 } } } };
  let fail = false, failBackup = false;
  const context = { module: { exports: {} }, Date, Set, Map, Object, Number, String,
    require(name) {
      if (name === 'express') return { json: () => (_q, _r, next) => next() };
      if (name === './config') return { get: key => cfg[key], getAll: () => ({ ...cfg }) };
      if (name === './pco-services') { const m = { module: { exports: {} }, Date, Number, Object, Promise, require: (n) => (n === './home-roles' ? require(path.join(root, 'src/server/home-roles.js')) : { getAll: () => ({ ...cfg }) }) }; vm.runInNewContext(fs.readFileSync(path.join(root, 'src/server/pco-services.js'), 'utf8'), m); return m.module.exports; }
      if (name === './pco-client') return { nextPlan: async () => { calls.push('plan'); if (fail) throw Error('offline'); return { id: 'plan', title: 'Sunday' }; }, planTeamMembers: async () => members, resolveAutoDay: async () => 'Sunday' };
      if (name === './presets') return { getByDevice: id => store[id] || {}, importMixes: data => { calls.push('import'); Object.assign(store, data); return { ok: true }; } };
      if (name === './auto-backup') return { writeBackup: async () => { calls.push('backup'); if (failBackup) throw Error('disk full'); } };
      throw Error(name);
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/server/performer-assignments.js'), 'utf8'), context);
  const api = context.module.exports;
  api.mountPerformerAssignments({ get: (url, fn) => { routes[url] = fn; }, post: (url, _middleware, fn) => { routes[url] = fn; } });
  async function request(url, body) { let data; await routes[url]({ body }, { set() {}, json: value => { data = value; } }); return JSON.parse(JSON.stringify(data)); }
  return { cfg, members, api, request, store, calls, offline: () => { fail = true; }, failBackup: () => { failBackup = true; } };
}

test('Planning Center person IDs disambiguate identical names and map position/day to the correct aux', async () => {
  const h = harness(), data = await h.request('/performer-assignments');
  assert.equal(data.people.length, 2); assert.equal(data.people.find(p => p.personId === '100').aux, 6); assert.equal(data.people.find(p => p.personId === '200').aux, 7);
  assert.equal(JSON.stringify(data).includes('secret'), false);
  await h.request('/performer-assignments'); assert.equal(h.calls.filter(c => c === 'plan').length, 1, 'roster is cached across phones');
});

test('declined, unconfirmed, wrong-day, unmapped, disabled and private mixes are excluded; multiple auxes are ambiguous', () => {
  const { api } = harness(); const member = { personId: '1', personName: 'Person', positionName: 'Vocal', confirmed: true, days: ['Sunday'] };
  const build = (members, overrides = {}) => api.buildAssignments(members, { Vocal: 6, Guitar: 7 }, 16, overrides, false, 'Sunday');
  assert.equal(build([{ ...member, declined: true }]).length, 0); assert.equal(build([{ ...member, confirmed: false }]).length, 0); assert.equal(build([{ ...member, days: ['Saturday'] }]).length, 0); assert.equal(build([{ ...member, personId: null }]).length, 0);
  assert.equal(build([member], { 6: { enabled: false } }).length, 0); assert.equal(build([member], { 6: { linkOnly: true } }).length, 0);
  const multiple = build([member, { ...member, positionName: 'Guitar' }]); assert.equal(multiple[0].ambiguous, true); assert.equal(multiple[0].aux, null);
});

test('new device can select the same person key without changing My Mixes or hardware', async () => {
  const h = harness(); const first = await h.request('/performer-identity', { personId: '100', deviceId: 'phone' });
  const reset = await h.request('/performer-identity', { personId: '100', deviceId: 'new-uuid' });
  assert.equal(first.deviceId, 'pco-person:100'); assert.equal(reset.deviceId, first.deviceId); assert.equal(reset.aux, 6); assert.equal(h.calls.includes('import'), false); assert.deepEqual(Object.keys(h.store), ['phone']);
});

test('optional legacy linking copies levels/pans after safety backup and preserves originals', async () => {
  const h = harness(), before = JSON.stringify(h.store.phone); const result = await h.request('/performer-identity', { personId: '100', deviceId: 'phone', copyExisting: true });
  assert.equal(result.ok, true); assert.equal(JSON.stringify(h.store.phone), before); assert.deepEqual(h.store['pco-person:100'].Sunday.levels, h.store.phone.Sunday.levels); assert.equal(h.store['pco-person:100'].Sunday.owner, 'Same Name'); assert.deepEqual(h.calls.slice(-2), ['backup', 'import']);
  const failed = harness(); failed.failBackup(); assert.equal((await failed.request('/performer-identity', { personId: '100', deviceId: 'phone', copyExisting: true })).ok, false); assert.equal(failed.store['pco-person:100'], undefined);
});

test('disabled assignment and PCO outages leave manual selection and saved mixes available', async () => {
  const h = harness(); h.cfg.pcoPhoneAssignments = false; assert.equal((await h.request('/performer-assignments')).enabled, false); assert.equal(h.calls.length, 0);
  assert.equal((await h.request('/performer-identity', { personId: '100' })).ok, false);
  const disabled = harness(); disabled.cfg.pcoUpdateAuxNames = false; assert.equal((await disabled.request('/performer-assignments')).enabled, false);
  const offline = harness(); offline.offline(); assert.equal((await offline.request('/performer-assignments')).ok, false); assert.deepEqual(Object.keys(offline.store), ['phone']);
  const missing = harness(); assert.equal((await missing.request('/performer-identity', { personId: 'not-scheduled' })).ok, false);
});

test('late saved-mix responses and acknowledgements cannot leak across performer identities', () => {
  const source = fs.readFileSync(path.join(root, 'src/mixer/mixer.js'), 'utf8');
  let imported = null;
  const context = vm.createContext({ deviceId: 'pco-person:200', localPresets: { Sarah: { levels: { 1: 0.3 } } }, pendingSync: { Sunday: { seq: 1, op: 'save' } }, resetHeartbeat() {}, importFoundPresets: (p) => { imported = p; } });
  vm.runInContext(source.slice(source.indexOf('function onMessage(e)'), source.indexOf('// ── Apply config')), context);
  for (const type of ['device-presets', 'preset-synced', 'preset-sync-error']) {
    context.event = { data: JSON.stringify({ type, deviceId: 'pco-person:100', presets: { Alex: { levels: { 1: 0.9 } } }, name: 'Sunday', seq: 1 }) };
    vm.runInContext('onMessage(event)', context);
  }
  assert.equal(context.localPresets.Alex, undefined); assert(context.pendingSync.Sunday);

  // "Find My Mixes" copy — tagged with whichever identity requested it
  // (mixer.js's confirmImportGroup), echoed back by the server, and must be
  // discarded if the active identity changed (e.g. switched performer)
  // before the reply arrived — otherwise the old identity's recovered
  // mixes would land in the new identity's active bucket.
  context.event = { data: JSON.stringify({ type: 'found-device-presets', deviceId: 'pco-person:100', presets: { Found: { levels: { 1: 0.5 } } } }) };
  vm.runInContext('onMessage(event)', context);
  assert.equal(imported, null, 'a found-device-presets reply tagged for a since-abandoned identity must not be imported');

  context.event = { data: JSON.stringify({ type: 'found-device-presets', deviceId: 'pco-person:200', presets: { Found: { levels: { 1: 0.5 } } } }) };
  vm.runInContext('onMessage(event)', context);
  assert.equal(JSON.stringify(imported), JSON.stringify({ Found: { levels: { 1: 0.5 } } }), 'a reply tagged for the currently-active identity still imports normally');
});


test('disabled person assignment does not change ordinary device owner names or saved-mix storage', () => {
  const source = fs.readFileSync(path.join(root, 'src/mixer/mixer.js'), 'utf8');
  const writes = [], storage = { jpm_owner: 'Updated performer name' };
  const context = vm.createContext({ performerProfile: null, deviceId: 'phone', physicalDeviceId: 'phone', physicalOwner: 'Old name', localStorage: { getItem: key => storage[key] || null, setItem: (key, value) => writes.push([key, value]), removeItem: key => writes.push([key]) } });
  vm.runInContext(source.slice(source.indexOf('globalThis.mixerIdentityBridge ='), source.indexOf('// ── Boot')), context);
  context.mixerIdentityBridge.activate(null);
  assert.deepEqual(writes, []); assert.equal(storage.jpm_owner, 'Updated performer name');
});
