'use strict';
// Fixture-based tests for pco-client.js — no network access or real
// Planning Center credentials needed. Exercises both the "direct
// convenience attribute" and "resolve via included relationships" parsing
// paths, since which one Planning Center's real API actually uses is an
// assumption (see pco-client.js's file header) this test can't verify —
// only that both paths are implemented correctly.
// Run with: node src/server/pco-client.test.js

const assert = require('node:assert/strict');
const http = require('http');
const pco = require('./pco-client.js');

let n = 0;
function t(name) { n++; console.log('ok -', name); }

// ── Minimal mock Planning Center server ─────────────────────────────────
function startMock(routes) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const handler = routes[req.url];
      if (!handler) { res.writeHead(404); res.end('{}'); return; }
      const { status = 200, body, authCheck } = handler;
      if (authCheck && req.headers.authorization !== authCheck) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad credentials' }));
        return;
      }
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  // pco-client.js hardcodes the real api.planningcenteronline.com base URL
  // (correct behavior for the shipped app) — for this test we monkeypatch
  // global fetch to redirect to our local mock instead of touching the
  // real network, rather than making the base URL configurable just for
  // tests.
  const correctAuth = 'Basic ' + Buffer.from('test-app:test-secret').toString('base64');
  const mock = await startMock({
    '/services/v2/service_types': {
      authCheck: correctAuth,
      body: { data: [{ id: '1', type: 'ServiceType', attributes: { name: 'Sunday Service' } }] },
    },
    '/services/v2/service_types/1/teams': {
      body: { data: [
        { id: 'team-1', type: 'Team', attributes: { name: 'Worship' } },
        { id: 'team-2', type: 'Team', attributes: { name: 'Production' } },
      ] },
    },
    // Page 1 (Worship, via relationship+included) points at a page 2
    // (Production, via a direct team_name attribute) — a real account with
    // multiple teams easily exceeds one page. listPositions must return the
    // union of both, each correctly tagged with its team either way.
    '/services/v2/service_types/1/team_positions?include=team': {
      body: {
        data: [
          {
            id: '10', type: 'TeamPosition', attributes: { name: 'Acoustic Guitar' },
            relationships: { team: { data: { type: 'Team', id: 'team-1' } } },
          },
          {
            id: '11', type: 'TeamPosition', attributes: { name: 'Lead Vocal' },
            relationships: { team: { data: { type: 'Team', id: 'team-1' } } },
          },
        ],
        included: [{ type: 'Team', id: 'team-1', attributes: { name: 'Worship' } }],
        links: { next: 'https://api.planningcenteronline.com/services/v2/service_types/1/team_positions?include=team&offset=2' },
      },
    },
    '/services/v2/service_types/1/team_positions?include=team&offset=2': {
      body: {
        data: [
          {
            id: '12', type: 'TeamPosition', attributes: { name: 'Sound Tech', team_name: 'Production' }, // both a direct attribute and the relationship — direct should win
            relationships: { team: { data: { type: 'Team', id: 'team-2' } } },
          },
        ],
        links: { next: null },
      },
    },
    // Relative to Date.now() on purpose, not fixed calendar dates — "closest
    // to now" is meaningless to test against dates fixed at whatever moment
    // this file was written, since "now" keeps moving.
    '/services/v2/service_types/1/plans?order=-sort_date&per_page=25': {
      body: { data: [
        { id: '101', type: 'Plan', attributes: { sort_date: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(), title: 'Far future plan' } },
        { id: '102', type: 'Plan', attributes: { sort_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), title: 'Closest-to-now plan' } },
        { id: '100', type: 'Plan', attributes: { sort_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), title: 'Long-past plan' } }, // descending order — past plans trail the future ones, must still lose to a much-closer future one
      ] },
    },
    // A church running same-day services at different times (e.g. Saturday
    // 5pm/7pm) — mid-5pm-service, that plan (recently started, in the past
    // by sort_date) must still win over the 7pm plan that hasn't started
    // yet, so the "active" team doesn't flip to the wrong one an hour early.
    '/services/v2/service_types/4/plans?order=-sort_date&per_page=25': {
      body: { data: [
        { id: '401', type: 'Plan', attributes: { sort_date: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), title: '7pm service' } },
        { id: '400', type: 'Plan', attributes: { sort_date: new Date(Date.now() - 20 * 60 * 1000).toISOString(), title: '5pm service' } },
      ] },
    },
    // Direct convenience attributes (name + team_position_name right on the resource)
    '/services/v2/service_types/1/plans/102/team_members?include=person,team_position': {
      body: { data: [
        { id: '1000', type: 'PlanPerson', attributes: { name: 'John Smith', team_position_name: 'Acoustic Guitar', status: 'C' } },
        { id: '1001', type: 'PlanPerson', attributes: { name: 'Jane Doe', team_position_name: 'Lead Vocal', status: 'U' } },
        { id: '1002', type: 'PlanPerson', attributes: { name: 'Bob Declined', team_position_name: 'Bass', status: 'D' } },
      ] },
    },
    // Relationship-fallback shape (no direct attrs — must resolve via `included`)
    '/services/v2/service_types/2/plans/200/team_members?include=person,team_position': {
      body: {
        data: [
          {
            id: '2000', type: 'PlanPerson', attributes: { status: 'C' },
            relationships: {
              person: { data: { type: 'Person', id: 'p1' } },
              team_position: { data: { type: 'TeamPosition', id: 'tp1' } },
            },
          },
        ],
        included: [
          { type: 'Person', id: 'p1', attributes: { first_name: 'Alex', last_name: 'Rivera', avatar: 'https://example.com/alex.jpg' } },
          { type: 'TeamPosition', id: 'tp1', attributes: { name: 'Drums' } },
        ],
      },
    },
    // Paginated team_members — e.g. Worship (page 1) + Production (page 2)
    // scheduled on the same plan, exceeding one page combined.
    '/services/v2/service_types/3/plans/300/team_members?include=person,team_position': {
      body: {
        data: [{ id: '3000', type: 'PlanPerson', attributes: { name: 'Worship Person', team_position_name: 'Lead Vocal', status: 'C' } }],
        links: { next: 'https://api.planningcenteronline.com/services/v2/service_types/3/plans/300/team_members?include=person,team_position&offset=1' },
      },
    },
    '/services/v2/service_types/3/plans/300/team_members?include=person,team_position&offset=1': {
      body: {
        data: [{ id: '3001', type: 'PlanPerson', attributes: { name: 'Production Person', team_position_name: 'Sound Tech', status: 'C' } }],
        links: { next: null },
      },
    },
  });
  const port = mock.address().port;

  const origFetch = global.fetch;
  global.fetch = (url, opts) => origFetch(url.replace('https://api.planningcenteronline.com', `http://127.0.0.1:${port}`), opts);

  const creds = { appId: 'test-app', secret: 'test-secret' };

  {
    const types = await pco.listServiceTypes(creds);
    assert.deepEqual(types, [{ id: '1', name: 'Sunday Service' }]);
    t('listServiceTypes parses id/name correctly');
  }

  {
    const teams = await pco.listTeams('1', creds);
    assert.deepEqual(teams, [{ id: 'team-1', name: 'Worship' }, { id: 'team-2', name: 'Production' }]);
    t('listTeams parses id/name correctly');
  }

  {
    const positions = await pco.listPositions('1', creds);
    assert.deepEqual(positions, [
      { id: '10', name: 'Acoustic Guitar', teamId: 'team-1', teamName: 'Worship' },
      { id: '11', name: 'Lead Vocal', teamId: 'team-1', teamName: 'Worship' },
      { id: '12', name: 'Sound Tech', teamId: 'team-2', teamName: 'Production' },
    ], 'must include page 2 (e.g. a second team) and resolve team info via both the relationship+included path and the direct team_name attribute path');
    t('listPositions follows pagination and tags every position with its team, from every page');
  }

  {
    const plan = await pco.nextPlan('1', creds);
    assert.equal(plan.id, '102', 'the plan closest to now should win over both a further-future plan and a long-past one');
    t('nextPlan (descending sort) picks the plan closest to now');
  }

  {
    const plan = await pco.nextPlan('4', creds);
    assert.equal(plan.id, '400', 'a service that started 20 minutes ago must still beat one starting in 2 hours — otherwise the "active" plan would flip to the wrong same-day service before the current one even ends');
    t('nextPlan keeps a recently-started same-day service selected instead of jumping ahead to the next one');
  }

  {
    const members = await pco.planTeamMembers('1', '102', creds);
    assert.equal(members.length, 3);
    assert.deepEqual(members[0], { personName: 'John Smith', positionName: 'Acoustic Guitar', photoUrl: null, status: 'C', confirmed: true });
    assert.equal(members[1].confirmed, false, 'status U (unconfirmed) must not count as confirmed');
    assert.equal(members[2].confirmed, false, 'status D (declined) must not count as confirmed');
    t('planTeamMembers parses direct convenience attributes and confirmed status correctly');
  }

  {
    const members = await pco.planTeamMembers('2', '200', creds);
    assert.deepEqual(members, [{ personName: 'Alex Rivera', positionName: 'Drums', photoUrl: 'https://example.com/alex.jpg', status: 'C', confirmed: true }]);
    t('planTeamMembers falls back to resolving person/team_position/photo via included[] when no direct attributes exist');
  }

  {
    const members = await pco.planTeamMembers('3', '300', creds);
    assert.equal(members.length, 2, 'must include everyone scheduled across both pages, e.g. Worship (page 1) and Production (page 2)');
    assert.deepEqual(members.map((m) => m.positionName).sort(), ['Lead Vocal', 'Sound Tech']);
    t('planTeamMembers follows pagination — a full team spanning multiple pages is not silently truncated');
  }

  {
    let threw = null;
    try { await pco.listServiceTypes({ appId: 'wrong', secret: 'wrong' }); } catch (e) { threw = e; }
    assert.ok(threw, 'bad credentials should throw, not silently return empty data');
    assert.equal(threw.status, 401);
    assert.ok(threw.body.includes('bad credentials'), 'the raw response body should be attached for diagnosis, per the file header');
    t('bad Planning Center credentials surface a 401 with the raw response body attached');
  }

  global.fetch = origFetch;
  mock.close();

  console.log(`\n${n} checks passed`);
}

main().catch((err) => { console.error(err); process.exit(1); });
