'use strict';
// Integration test for greenroom.js's /greenroom-data route against a real
// Express app + real HTTP requests, with Planning Center's API mocked via
// a global fetch monkeypatch (same approach as pco-client.test.js).
// Run with: node src/server/greenroom.test.js

const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return path.join(__dirname, '_fake-electron-for-tests.js');
  return origResolve.call(this, request, ...args);
};
process.env.JPM_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-greenroom-test-'));

const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const config = require('./config');
const { mountGreenRoom } = require('./greenroom');

let n = 0;
function t(name) { n++; console.log('ok -', name); }

function get(port, urlPath) {
  require('./pco-client').shared.clear(); // each check sets up its own Planning Center replies
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function main() {
  const app = express();
  mountGreenRoom(app);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  // ── Not configured yet ───────────────────────────────────────────────
  {
    const data = await get(port, '/greenroom-data');
    assert.equal(data.ok, false);
    assert.ok(data.error.includes('Settings'), 'should point at Settings, not a raw error, when nothing is configured yet');
    t('an unconfigured Planning Center setup returns a clear, non-crashing message');
  }

  // ── Configured, mock Planning Center responses ──────────────────────
  // pcoDay defaults to 'auto' (see config.js) — pinned to '' here so the
  // tests below that aren't about day filtering aren't affected by it; the
  // dedicated pcoDay tests further down set it explicitly as needed.
  config.save({ ...config.getAll(), pcoAppId: 'app', pcoSecret: 'secret', pcoServiceTypeId: '1', pcoIncludeUnconfirmed: false, pcoDay: '' });

  const origFetch = global.fetch;
  global.fetch = async (url) => {
    if (url.includes('/plans?')) {
      return { ok: true, text: async () => JSON.stringify({ data: [
        { id: '100', type: 'Plan', attributes: { sort_date: '2999-01-01T00:00:00Z', title: 'Sunday Service' } },
      ] }) };
    }
    if (url.includes('/plan_times')) {
      return { ok: true, text: async () => JSON.stringify({ data: [
        { id: 'pt-sat', type: 'PlanTime', attributes: { starts_at: '2025-01-18T22:00:00Z' } }, // a Saturday
        { id: 'pt-sun', type: 'PlanTime', attributes: { starts_at: '2025-01-19T15:00:00Z' } },  // a Sunday
      ] }) };
    }
    if (url.includes('/team_members')) {
      // John is scheduled Saturday only (via `times`), Jane Sunday only (via
      // `service_times`) — a weekend plan with split-team scheduling.
      // Deliberately NO `included` PlanTime entries — confirmed against a
      // real account that Planning Center silently ignores
      // `include=times,service_times` here; the days above are resolved via
      // the separate /plan_times mock instead (see pco-client.js).
      return { ok: true, text: async () => JSON.stringify({
        data: [
          {
            id: '1', type: 'PlanPerson', attributes: { name: 'John Smith', team_position_name: 'Acoustic Guitar', status: 'C', photo_thumbnail_url: 'https://example.com/john.jpg' },
            relationships: { times: { data: [{ type: 'PlanTime', id: 'pt-sat' }] } },
          },
          {
            id: '2', type: 'PlanPerson', attributes: { name: 'Jane Doe', team_position_name: 'Lead Vocal', status: 'U' },
            relationships: { service_times: { data: [{ type: 'PlanTime', id: 'pt-sun' }] } },
          },
        ],
      }) };
    }
    if (url.includes('/team_positions')) {
      // Acoustic Guitar -> Worship, Lead Vocal -> Production — only fetched
      // at all when pcoTeamId is set (see greenroom.js).
      return { ok: true, text: async () => JSON.stringify({ data: [
        { id: '10', type: 'TeamPosition', attributes: { name: 'Acoustic Guitar' }, relationships: { team: { data: { type: 'Team', id: 'team-worship' } } } },
        { id: '11', type: 'TeamPosition', attributes: { name: 'Lead Vocal' }, relationships: { team: { data: { type: 'Team', id: 'team-production' } } } },
      ] }) };
    }
    throw new Error('unexpected URL in test: ' + url);
  };

  {
    const data = await get(port, '/greenroom-data');
    assert.equal(data.ok, true);
    assert.equal(data.plan.title, 'Sunday Service');
    assert.equal(data.members.length, 1, 'unconfirmed (status U) should be excluded by default');
    assert.deepEqual(data.members[0], { name: 'John Smith', position: 'Acoustic Guitar', photoUrl: 'https://example.com/john.jpg' });
    t('a configured setup returns the plan + confirmed members only, in the display shape');
  }

  config.save({ ...config.getAll(), pcoIncludeUnconfirmed: true });
  {
    const data = await get(port, '/greenroom-data');
    assert.equal(data.members.length, 2, 'pcoIncludeUnconfirmed:true should include everyone scheduled');
    t('pcoIncludeUnconfirmed setting is respected');
  }

  config.save({ ...config.getAll(), pcoGreenRoomHidden: ['lead vocal'] }); // case-insensitive on purpose
  {
    const data = await get(port, '/greenroom-data');
    assert.equal(data.members.length, 1);
    assert.equal(data.members[0].name, 'John Smith', 'Lead Vocal should be hidden regardless of case, Acoustic Guitar should remain');
    t('pcoGreenRoomHidden excludes a position case-insensitively without needing to touch the aux mapping');
  }

  config.save({ ...config.getAll(), pcoGreenRoomHidden: [], pcoTeamId: 'team-worship' });
  {
    const data = await get(port, '/greenroom-data');
    assert.equal(data.members.length, 1, 'only the Worship-team member (John Smith, Acoustic Guitar) should remain — Jane Doe is on Production');
    assert.equal(data.members[0].name, 'John Smith');
    t('pcoTeamId narrows the Green Room display to the selected team, matching the Settings tab');
  }

  config.save({ ...config.getAll(), pcoTeamId: '' });
  {
    const data = await get(port, '/greenroom-data');
    assert.equal(data.members.length, 2, 'clearing pcoTeamId (All Teams) should show everyone again');
    t('an empty pcoTeamId (All Teams) shows every team again');
  }

  config.save({ ...config.getAll(), pcoDay: 'Saturday' });
  {
    const data = await get(port, '/greenroom-data');
    assert.equal(data.members.length, 1);
    assert.equal(data.members[0].name, 'John Smith', 'John (Saturday via `times`) should remain, Jane (Sunday via `service_times`) should not');
    t('pcoDay narrows the Green Room display to one weekend day, resolving both the `times` and `service_times` relationships');
  }

  config.save({ ...config.getAll(), pcoDay: '' });
  {
    const data = await get(port, '/greenroom-data');
    assert.equal(data.members.length, 2, 'clearing pcoDay (every day) should show everyone again');
    t('an empty pcoDay shows every day again');
  }

  config.save({ ...config.getAll(), pcoDay: 'auto' });
  {
    // Both mock PlanTimes are fixed dates in the past (2025) — whichever is
    // less far in the past (pt-sun, one day later than pt-sat) is "closest
    // to right now" from any point after both have passed, same as a real
    // weekend once Saturday's service has already happened.
    const data = await get(port, '/greenroom-data');
    assert.equal(data.members.length, 1);
    assert.equal(data.members[0].name, 'Jane Doe', '"auto" should resolve to whichever PlanTime is closest to now (Sunday, via `service_times`), not literally today\'s date');
    t('pcoDay: "auto" resolves against the plan\'s own PlanTimes rather than today\'s calendar date');
  }

  // ── A decline is a definite no, never shown just because includeUnconfirmed is on ──
  config.save({ ...config.getAll(), pcoDay: '', pcoTeamId: '', pcoIncludeUnconfirmed: true });
  {
    const declineFetch = global.fetch;
    global.fetch = async (url) => {
      if (url.includes('/plans?')) {
        return { ok: true, text: async () => JSON.stringify({ data: [
          { id: '100', type: 'Plan', attributes: { sort_date: '2999-01-01T00:00:00Z', title: 'Sunday Service' } },
        ] }) };
      }
      if (url.includes('/plan_times')) return { ok: true, text: async () => JSON.stringify({ data: [] }) };
      if (url.includes('/team_members')) {
        return { ok: true, text: async () => JSON.stringify({ data: [
          { id: '1', type: 'PlanPerson', attributes: { name: 'Confirmed Carl', team_position_name: 'Drums', status: 'C' } },
          { id: '2', type: 'PlanPerson', attributes: { name: 'Declined Dana', team_position_name: 'Bass', status: 'D' } },
          { id: '3', type: 'PlanPerson', attributes: { name: 'Pending Pat', team_position_name: 'Keys', status: 'U' } },
        ] }) };
      }
      throw new Error('unexpected URL in test: ' + url);
    };
    const data = await get(port, '/greenroom-data');
    assert.equal(data.members.length, 2, 'includeUnconfirmed:true should add the pending person but must never add the declined one');
    assert.ok(!data.members.some((m) => m.name === 'Declined Dana'), 'a decline is a definite no, not "hasn\'t responded yet"');
    assert.ok(data.members.some((m) => m.name === 'Pending Pat'), 'pending (unconfirmed) is exactly what includeUnconfirmed is meant to add');
    t('a declined team member is excluded even with includeUnconfirmed:true, unlike a merely-pending one');
    global.fetch = declineFetch;
  }

  global.fetch = origFetch;
  server.close();

  console.log(`\n${n} checks passed`);
}

main().catch((err) => { console.error(err); process.exit(1); });
