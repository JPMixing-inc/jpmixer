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
    // nextPlan() checks the closest-by-distance past plan's own PlanTimes
    // before trusting it — empty here means a plain single-service plan,
    // nothing more precise than sort_date to check, so it should fall
    // through to the sort_date pick unchanged (plan 400 still wins).
    '/services/v2/service_types/4/plans/400/plan_times': { body: { data: [] } },
    // A weekend plan whose last service genuinely ended a while ago — closer
    // by raw sort_date distance (2 days) than the next plan (5 days), but
    // its actual last PlanTime's `ends_at` is well in the past, so the
    // upcoming plan should win instead once that's checked.
    '/services/v2/service_types/7/plans?order=-sort_date&per_page=25': {
      body: { data: [
        { id: '701', type: 'Plan', attributes: { sort_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(), title: 'Next weekend' } },
        { id: '700', type: 'Plan', attributes: { sort_date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), title: 'Last weekend' } },
      ] },
    },
    '/services/v2/service_types/7/plans/700/plan_times': {
      body: { data: [
        { id: 'pt700', type: 'PlanTime', attributes: {
          starts_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
          ends_at: new Date(Date.now() - 1.5 * 24 * 60 * 60 * 1000).toISOString(),
        } },
      ] },
    },
    // Same shape, but this past plan's last service hasn't ended yet (still
    // mid-weekend) — must stay selected rather than jumping ahead early.
    '/services/v2/service_types/8/plans?order=-sort_date&per_page=25': {
      body: { data: [
        { id: '801', type: 'Plan', attributes: { sort_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(), title: 'Next weekend' } },
        { id: '800', type: 'Plan', attributes: { sort_date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), title: 'This weekend' } },
      ] },
    },
    '/services/v2/service_types/8/plans/800/plan_times': {
      body: { data: [
        { id: 'pt800', type: 'PlanTime', attributes: {
          starts_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
          ends_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // still 2 hours from ending
        } },
      ] },
    },
    // A rehearsal an hour ago (closest) and the actual service in two days.
    '/services/v2/service_types/12/plans/1300/plan_times': {
      body: { data: [
        { id: 'reh', type: 'PlanTime', attributes: { time_type: 'rehearsal', starts_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() } },
        { id: 'svc', type: 'PlanTime', attributes: { time_type: 'service', starts_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString() } },
      ] },
    },
    // 9am and 11am as separate plans, seen at "10:05": 9am started 65 min
    // ago and runs another 25 min; 11am starts in 55 min, so it's closer.
    '/services/v2/service_types/10/plans?order=-sort_date&per_page=25': {
      body: { data: [
        { id: '1101', type: 'Plan', attributes: { sort_date: new Date(Date.now() + 55 * 60 * 1000).toISOString(), title: '11am' } },
        { id: '1100', type: 'Plan', attributes: { sort_date: new Date(Date.now() - 65 * 60 * 1000).toISOString(), title: '9am' } },
      ] },
    },
    '/services/v2/service_types/10/plans/1100/plan_times': {
      body: { data: [{ id: 'pt1100', type: 'PlanTime', attributes: {
        starts_at: new Date(Date.now() - 65 * 60 * 1000).toISOString(),
        ends_at: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
      } }] },
    },
    // Same, at "10:40": 9am finished 10 min ago.
    '/services/v2/service_types/11/plans?order=-sort_date&per_page=25': {
      body: { data: [
        { id: '1201', type: 'Plan', attributes: { sort_date: new Date(Date.now() + 20 * 60 * 1000).toISOString(), title: '11am' } },
        { id: '1200', type: 'Plan', attributes: { sort_date: new Date(Date.now() - 100 * 60 * 1000).toISOString(), title: '9am' } },
      ] },
    },
    '/services/v2/service_types/11/plans/1200/plan_times': {
      body: { data: [{ id: 'pt1200', type: 'PlanTime', attributes: {
        starts_at: new Date(Date.now() - 100 * 60 * 1000).toISOString(),
        ends_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      } }] },
    },
    // planTeamMembers() always fetches plan_times too (to resolve `days`) —
    // an empty list here means a plain, non-split-team plan with one service.
    '/services/v2/service_types/1/plans/102/plan_times': { body: { data: [] } },
    '/services/v2/service_types/2/plans/200/plan_times': { body: { data: [] } },
    '/services/v2/service_types/3/plans/300/plan_times': { body: { data: [] } },
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
    // A weekend plan with two PlanTimes (Saturday + Sunday) and split-team
    // scheduling — one person tied via `times`, one via `service_times`
    // (PCO's own reference doesn't document which is used in practice), and
    // one with neither relationship at all (not split-team scheduled).
    '/services/v2/service_types/5/plans/500/plan_times': {
      body: { data: [
        { id: 'pt-sat', type: 'PlanTime', attributes: { name: 'Saturday 5:00 PM', starts_at: '2025-01-18T22:00:00Z' } }, // a Saturday UTC evening
        { id: 'pt-sun', type: 'PlanTime', attributes: { name: 'Sunday 9:00 AM', starts_at: '2025-01-19T15:00:00Z' } },   // a Sunday UTC morning
      ] },
    },
    // Out of response order on purpose — listPlanItems() must sort by
    // `sequence`, not trust the array order it came back in.
    '/services/v2/service_types/5/plans/500/items': {
      body: { data: [
        { id: 'it-2', type: 'Item', attributes: { item_type: 'song', title: 'Great Are You Lord', description: 'Led by: Jane', length: 300, key_name: 'G', sequence: 2 } },
        { id: 'it-1', type: 'Item', attributes: { item_type: 'header', title: 'WORSHIP', description: null, length: 0, key_name: null, sequence: 1 } },
      ] },
    },
    // Live, idle — confirmed real shape (against a live account, nothing
    // in progress): `current_item_time` is a `links` entry, not a
    // `relationships` one, and it's null when nobody's pressed "Go Live".
    '/services/v2/service_types/9/plans/900/live': {
      body: { data: { type: 'Live', id: '900', attributes: {}, links: { current_item_time: null } } },
    },
    // Live, in progress — the `current_item_time` link is a real URL,
    // fetched separately (not resolved via `?include=`, which does
    // nothing on this resource — see pco-client.js).
    '/services/v2/service_types/9/plans/901/live': {
      body: { data: { type: 'Live', id: '901', attributes: {}, links: {
        current_item_time: 'https://api.planningcenteronline.com/services/v2/service_types/9/plans/901/live/item_times/it-time-1',
      } } },
    },
    '/services/v2/service_types/9/plans/901/live/item_times/it-time-1': {
      body: { data: { type: 'ItemTime', id: 'it-time-1', relationships: { item: { data: { type: 'Item', id: 'it-live-99' } } } } },
    },
    '/services/v2/service_types/5/plans/500/team_members?include=person,team_position': {
      body: {
        data: [
          {
            id: '5000', type: 'PlanPerson', attributes: { name: 'Saturday Person', team_position_name: 'Acoustic Guitar', status: 'C' },
            relationships: { times: { data: [{ type: 'PlanTime', id: 'pt-sat' }] } },
          },
          {
            id: '5001', type: 'PlanPerson', attributes: { name: 'Sunday Person', team_position_name: 'Lead Vocal', status: 'C' },
            relationships: { service_times: { data: [{ type: 'PlanTime', id: 'pt-sun' }] } },
          },
          {
            id: '5002', type: 'PlanPerson', attributes: { name: 'Every-Weekend Person', team_position_name: 'Drums', status: 'C' },
          },
        ],
        // Deliberately NO `included` PlanTime entries — confirmed against a
        // real split-team account that Planning Center silently ignores
        // `include=times,service_times` on this endpoint. The real ids on
        // the relationships above are genuine; resolving them has to go
        // through a separate plan_times fetch (mocked above), never via
        // this response's own `included`.
      },
    },
    // Relative to Date.now() on purpose (see the nextPlan mocks above) — one
    // PlanTime an hour in the past, one ten hours in the future, so "closest
    // to now" has an unambiguous winner regardless of when this test runs.
    '/services/v2/service_types/6/plans/600/plan_times': {
      body: { data: [
        { id: 'near', type: 'PlanTime', attributes: { starts_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString() } },
        { id: 'far', type: 'PlanTime', attributes: { starts_at: new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString() } },
      ] },
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
    const types = await pco.listServiceTypes({ appId: ' test-app ', secret: 'test-secret\n' });
    assert.deepEqual(types, [{ id: '1', name: 'Sunday Service' }]);
    t('credentials pasted with stray whitespace still authenticate');
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
    const plan = await pco.nextPlan('7', creds);
    assert.equal(plan.id, '701', 'closer by raw sort_date distance (2 days vs. 5) is not enough once that weekend\'s last PlanTime (ends_at) has genuinely already passed — the upcoming plan should win instead');
    t('nextPlan moves on to the upcoming plan once the closer-by-distance one\'s last service has actually ended');
  }

  {
    const plan = await pco.nextPlan('8', creds);
    assert.equal(plan.id, '800', 'this weekend\'s last service doesn\'t end for another 2 hours — must stay selected rather than jumping ahead to next weekend early');
    t('nextPlan keeps a still-ongoing weekend plan selected even though it\'s already "past" by sort_date');
  }

  {
    const running = await pco.nextPlan('10', creds);
    assert.equal(running.id, '1100', 'the 9am plan is still running, even though the 11am plan is now closer');
    const finished = await pco.nextPlan('11', creds);
    assert.equal(finished.id, '1201', 'once 9am has ended, 11am takes over');
    t('nextPlan keeps a running service selected until it ends, even when the next separate plan is closer');
  }

  {
    const expected = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { weekday: 'long' });
    assert.equal(await pco.resolveAutoDay('12', '1300', creds), expected, 'the closer rehearsal must not decide the day');
    t('resolveAutoDay picks the nearest service time, not a rehearsal');
  }

  {
    const members = await pco.planTeamMembers('1', '102', creds);
    assert.equal(members.length, 3);
    assert.deepEqual(members[0], { personId: null, personName: 'John Smith', positionName: 'Acoustic Guitar', photoUrl: null, status: 'C', confirmed: true, declined: false, days: [] });
    assert.equal(members[1].confirmed, false, 'status U (unconfirmed) must not count as confirmed');
    assert.equal(members[2].confirmed, false, 'status D (declined) must not count as confirmed');
    t('planTeamMembers parses direct convenience attributes and confirmed status correctly');
  }

  {
    const members = await pco.planTeamMembers('2', '200', creds);
    assert.deepEqual(members, [{ personId: 'p1', personName: 'Alex Rivera', positionName: 'Drums', photoUrl: 'https://example.com/alex.jpg', status: 'C', confirmed: true, declined: false, days: [] }]);
    t('planTeamMembers falls back to resolving person/team_position/photo via included[] when no direct attributes exist');
  }

  {
    const members = await pco.planTeamMembers('3', '300', creds);
    assert.equal(members.length, 2, 'must include everyone scheduled across both pages, e.g. Worship (page 1) and Production (page 2)');
    assert.deepEqual(members.map((m) => m.positionName).sort(), ['Lead Vocal', 'Sound Tech']);
    t('planTeamMembers follows pagination — a full team spanning multiple pages is not silently truncated');
  }

  {
    const times = await pco.listPlanTimes('5', '500', creds);
    assert.deepEqual(times.map((t) => t.name), ['Saturday 5:00 PM', 'Sunday 9:00 AM']);
    t('listPlanTimes parses a weekend plan\'s individual service times');
  }

  {
    const items = await pco.listPlanItems('5', '500', creds);
    assert.deepEqual(items.map((it) => it.title), ['WORSHIP', 'Great Are You Lord'], 'sorted by sequence, not response order');
    assert.equal(items[0].type, 'header');
    assert.equal(items[1].type, 'song');
    assert.equal(items[1].keyName, 'G');
    assert.equal(items[1].length, 300);
    t('listPlanItems parses a plan\'s order of service, sorted by sequence');
  }

  {
    const liveItemId = await pco.getLiveItemId('9', '900', creds);
    assert.equal(liveItemId, null, 'nobody has pressed "Go Live" yet — must resolve to null, not throw');
    t('getLiveItemId resolves to null when Services LIVE is idle');
  }

  {
    const liveItemId = await pco.getLiveItemId('9', '901', creds);
    assert.equal(liveItemId, 'it-live-99', 'follows the current_item_time link (not a relationship) to the live ItemTime, then its item relationship');
    t('getLiveItemId resolves the actual live item\'s id when a session is in progress');
  }

  {
    const liveItemId = await pco.getLiveItemId('nonexistent', 'nonexistent', creds);
    assert.equal(liveItemId, null, 'any failure fetching Live degrades to "nothing live" rather than throwing — see pco-client.js');
    t('getLiveItemId never throws, even against a Live endpoint that 404s');
  }

  {
    const members = await pco.planTeamMembers('5', '500', creds);
    const byName = Object.fromEntries(members.map((m) => [m.personName, m.days]));
    assert.deepEqual(byName['Saturday Person'], ['Saturday'], 'resolved via the `times` relationship');
    assert.deepEqual(byName['Sunday Person'], ['Sunday'], 'resolved via the `service_times` relationship — PCO\'s own reference doesn\'t document which one is actually used, so both are checked');
    assert.deepEqual(byName['Every-Weekend Person'], [], 'no time relationship at all (not split-team scheduled) must mean "every day", not "no day" — an empty array, not an error');
    t('planTeamMembers resolves which day(s) each person is scheduled for, for weekend-plan day filtering');
  }

  {
    const expected = new Date(Date.now() - 1 * 60 * 60 * 1000).toLocaleDateString('en-US', { weekday: 'long' });
    const day = await pco.resolveAutoDay('6', '600', creds);
    assert.equal(day, expected, 'the PlanTime an hour in the past is closer to right now than the one ten hours out, regardless of which is chronologically first');
    t('resolveAutoDay picks whichever PlanTime is closest to right now, not literally today\'s date');
  }

  {
    const day = await pco.resolveAutoDay('1', '102', creds);
    assert.equal(day, '', 'a plan with no PlanTimes at all has nothing for "auto" to resolve against');
    t('resolveAutoDay returns empty (no filtering) when the plan has no PlanTimes');
  }

  {
    let threw = null;
    try { await pco.listServiceTypes({ appId: 'wrong', secret: 'wrong' }); } catch (e) { threw = e; }
    assert.ok(threw, 'bad credentials should throw, not silently return empty data');
    assert.equal(threw.status, 401);
    assert.ok(threw.body.includes('bad credentials'), 'the raw response body should be attached for diagnosis, per the file header');
    t('bad Planning Center credentials surface a 401 with the raw response body attached');
  }

  {
    const realFetch = global.fetch;
    let calls = 0, fail = false;
    global.fetch = async (...args) => { calls++; if (fail) throw new Error('offline'); return realFetch(...args); };
    pco.shared.clear();
    const [a, b] = await Promise.all([pco.shared.listPositions('1', creds), pco.shared.listPositions('1', creds)]);
    const first = calls;
    assert.deepEqual(a, b);
    await pco.shared.listPositions('1', creds);
    assert.equal(calls, first, 'screens loading together, or within 20s, share one answer');
    await pco.listPositions('1', creds);
    assert(calls > first, 'Settings (the plain functions) always fetches fresh');
    calls = 0;
    await pco.shared.listPositions('1', { appId: 'other', secret: 'other' }).catch(() => {});
    assert(calls > 0, 'other credentials never get this account’s cached answer');
    pco.shared.clear(); fail = true;
    await assert.rejects(pco.shared.listPositions('1', creds));
    fail = false; calls = 0;
    await pco.shared.listPositions('1', creds);
    assert(calls > 0, 'a failure is not cached');
    global.fetch = realFetch;
    t('the display pages share a short Planning Center cache; Settings and failures are never cached');
  }

  global.fetch = origFetch;
  mock.close();

  console.log(`\n${n} checks passed`);
}

main().catch((err) => { console.error(err); process.exit(1); });
