'use strict';
// A second Planning Center service (a Wednesday night) takes over only on a
// day it has a plan and the main one doesn't; the main one comes first.
const path = require('path');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return path.join(__dirname, '_fake-electron-for-tests.js');
  return origResolve.call(this, request, ...args);
};
const fs = require('fs');
const os = require('os');
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.JPM_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-pco-services-test-'));
const svc = require('./pco-services.js');

// Wednesday 22 Oct 2026, 10:00 local; Sunday plan 4 days later
const WED = new Date(2026, 9, 21, 10, 0);
const at = (d, h) => { const x = new Date(WED); x.setDate(x.getDate() + d); x.setHours(h, 0, 0, 0); return x.toISOString(); };
const base = {
  pcoServiceTypeId: 'sun', pcoTeamId: 'sunTeam', pcoDay: 'auto',
  pcoPositionMapping: { 'Vocal 1': 3, Keys: 4 },
  pcoFohPositionName: 'FOH Engineer', pcoFohTeamId: 'sunProd',
  pcoAlt: { enabled: true, serviceTypeId: 'wed', teamId: 'wedTeam', positionMapping: { 'vocal 1': 5, Keys: 0, Bass: 6 }, roles: { lighting: { team: 'wedProd', position: 'Lights' } } },
};
// A stand-in Planning Center: one plan per service type, optional plan times
function fakePco(plans, times = {}) {
  const calls = [];
  return {
    calls,
    nextPlan: async (type) => { calls.push(`plan:${type}`); if (plans[type] instanceof Error) throw plans[type]; return plans[type] || null; },
    listPlanTimes: async (type, id) => { calls.push(`times:${type}`); if (times[type] instanceof Error) throw times[type]; return times[type] || []; },
  };
}

test('with no second service, the main one runs and nothing extra is asked of Planning Center', async () => {
  const pco = fakePco({ sun: { id: 's1', date: at(4, 9) } });
  const { service, plan } = await svc.activeService(pco, {}, { ...base, pcoAlt: { ...base.pcoAlt, enabled: false } }, WED);
  assert.equal(service.which, 'main'); assert.equal(plan.id, 's1');
  assert.deepEqual(pco.calls, ['plan:sun']);
});

test('on the second service’s day it takes over, with its own team, mapping and roles', async () => {
  const pco = fakePco({ sun: { id: 's1', date: at(4, 9) }, wed: { id: 'w1', date: at(0, 19) } });
  const { service, plan } = await svc.activeService(pco, {}, base, WED);
  assert.equal(service.which, 'alt'); assert.equal(plan.id, 'w1');
  assert.equal(service.serviceTypeId, 'wed'); assert.equal(service.teamId, 'wedTeam'); assert.equal(service.day, 'auto');
  // Its own Vocal 1 mix (matched ignoring case), Keys taken off, Bass added
  assert.deepEqual(service.mapping, { 'vocal 1': 5, Bass: 6 });
  assert.deepEqual(service.offMix, ['Keys']);
  assert.deepEqual(service.roles.lighting, { position: 'Lights', team: 'wedProd' });
  // A role it doesn't pick uses the main role's name, without the main team
  assert.deepEqual(service.roles.foh, { position: 'FOH Engineer', team: '' });
});

test('any other day the main service runs', async () => {
  const pco = fakePco({ sun: { id: 's1', date: at(4, 9) }, wed: { id: 'w2', date: at(7, 19) } });
  const { service } = await svc.activeService(pco, {}, base, WED);
  assert.equal(service.which, 'main'); assert.deepEqual(service.mapping, { 'Vocal 1': 3, Keys: 4 });
});

test('the main service comes first when both have something today', async () => {
  const pco = fakePco({ sun: { id: 's1', date: at(0, 9) }, wed: { id: 'w1', date: at(0, 19) } });
  assert.equal((await svc.activeService(pco, {}, base, WED)).service.which, 'main');
});

test('a main plan dated yesterday whose service time is today still comes first', async () => {
  const pco = fakePco({ sun: { id: 's1', date: at(-1, 18) }, wed: { id: 'w1', date: at(0, 19) } }, { sun: [{ startsAt: at(-1, 18) }, { startsAt: at(0, 11) }] });
  assert.equal((await svc.activeService(pco, {}, base, WED)).service.which, 'main');
});

test('a second service whose plan Planning Center says is gone leaves the main one running', async () => {
  const pco = fakePco({ sun: { id: 's1', date: at(4, 9) }, wed: Object.assign(new Error('Not found'), { status: 404 }) });
  const { service, plan } = await svc.activeService(pco, {}, base, WED);
  assert.equal(service.which, 'main'); assert.equal(plan.id, 's1');
});

test('a hiccup on the second service’s night isn’t taken as “not today”: it fails, so nothing switches to the main service', async () => {
  // Falling back renamed the mixes to Sunday's team mid-service, cleared
  // team chat and could move phones to Sunday's mixes
  const hiccup = () => Object.assign(new Error('Couldn’t reach Planning Center'), { temporary: true });
  // Its plan
  await assert.rejects(svc.activeService(fakePco({ sun: { id: 's1', date: at(4, 9) }, wed: hiccup() }), {}, base, WED), /Couldn’t reach/);
  // Its times (a plan dated tomorrow whose service may be tonight)
  await assert.rejects(svc.activeService(fakePco({ sun: { id: 's1', date: at(4, 9) }, wed: { id: 'w1', date: at(1, 9) } }, { wed: hiccup() }), {}, base, WED), /Couldn’t reach/);
  // The main plan's times, asked to see whether the main one is on too
  await assert.rejects(svc.activeService(fakePco({ sun: { id: 's1', date: at(-1, 18) }, wed: { id: 'w1', date: at(0, 19) } }, { sun: hiccup() }), {}, base, WED), /Couldn’t reach/);
});

test('a Home page counts as set up when either service picks its role', () => {
  assert.equal(svc.rolePicked('foh', base), true);
  assert.equal(svc.rolePicked('lighting', base), true);
  assert.equal(svc.rolePicked('lighting', { ...base, pcoAlt: { ...base.pcoAlt, enabled: false } }), false);
  assert.equal(svc.rolePicked('switcher', base), false);
});
