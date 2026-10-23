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
const { mountGreenRoom, _resetLive } = require('./greenroom');

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
    assert.deepEqual(data.members[0], { name: 'John Smith', position: 'Acoustic Guitar', positions: ['Acoustic Guitar'], photoUrl: 'https://example.com/john.jpg', auxes: [] });
    assert.equal(data.mics, true, 'mic batteries are on unless turned off');
    t('a configured setup returns the plan + confirmed members only, in the display shape');
  }

  {
    const saved = config.getAll();
    config.save({ ...saved, pcoPositionMapping: { 'acoustic guitar': 4, Keys: 9 }, greenRoomMics: false });
    const data = await get(port, '/greenroom-data');
    assert.deepEqual(data.members[0].auxes, [4], 'the mix their position is mapped to, whatever its case');
    assert.equal(data.mics, false);
    config.save(saved);
    t('each card carries the mixes its positions are mapped to, for their mic battery');
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

  // ── Someone serving more than one role: one card with both ───────────
  {
    const scheduleMock = global.fetch;
    const saved = config.getAll();
    config.save({ ...saved, pcoTeamId: '', pcoDay: '', pcoIncludeUnconfirmed: true });
    global.fetch = async (url) => {
      if (url.includes('/team_members')) {
        return { ok: true, text: async () => JSON.stringify({ data: [
          { id: 'a', attributes: { name: 'Sam Lee', team_position_name: 'Vocal 2', status: 'C' }, relationships: { person: { data: { id: 'p-sam' } } } },
          { id: 'b', attributes: { name: 'Ana Ruiz', team_position_name: 'Keys', status: 'C', photo_thumbnail_url: 'https://example.com/ana.jpg' }, relationships: { person: { data: { id: 'p-ana' } } } },
          { id: 'c', attributes: { name: 'Sam Lee', team_position_name: 'Acoustic Guitar', status: 'C', photo_thumbnail_url: 'https://example.com/sam.jpg' }, relationships: { person: { data: { id: 'p-sam' } } } },
          { id: 'd', attributes: { name: 'Sam Lee', team_position_name: 'Vocal 2', status: 'C' }, relationships: { person: { data: { id: 'p-sam' } } } },
          { id: 'e', attributes: { name: 'Sam Lee', team_position_name: 'Drums', status: 'C' }, relationships: { person: { data: { id: 'p-other-sam' } } } },
        ] }) };
      }
      return scheduleMock(url);
    };
    const data = await get(port, '/greenroom-data');
    const sam = data.members.find((m) => m.positions.includes('Vocal 2'));
    assert.deepEqual(sam.positions, ['Vocal 2', 'Acoustic Guitar'], 'both roles, in schedule order, listed once');
    assert.equal(sam.photoUrl, 'https://example.com/sam.jpg', 'a photo from any of their entries');
    assert.equal(data.members.length, 3, 'a different person with the same name keeps their own card');
    global.fetch = scheduleMock;
    config.save(saved);
    t('someone serving two roles is one card with both roles');
  }

  // ── Now / Up next from Planning Center Live ──────────────────────────
  {
    const scheduleMock = global.fetch;
    let liveItem = 'i2', liveStartAt = '2026-10-25T13:04:10Z', pastOffset = 0;
    _resetLive();
    global.fetch = async (url) => {
      if (url.includes('/items')) {
        return { ok: true, text: async () => JSON.stringify({ data: [
          { id: 'i1', attributes: { item_type: 'song', title: 'Amazing Grace', key_name: 'G', length: 300, sequence: 1 } },
          { id: 'i2', attributes: { item_type: 'song', title: 'How Great Thou Art', key_name: 'Bb', length: 360, sequence: 2 } },
          { id: 'i3', attributes: { item_type: 'header', title: 'MESSAGE', sequence: 3 } },
          { id: 'i4', attributes: { item_type: 'item', title: 'Sermon', length: 1800, sequence: 4 } },
        ] }) };
      }
      if (url.includes('/live-item-time')) return { ok: true, text: async () => JSON.stringify({ data: { attributes: { live_start_at: liveStartAt }, relationships: { item: { data: { id: liveItem } } } } }) };
      if (url.includes('/plan_times')) {
        const at = (min) => new Date(Date.now() + min * 60000).toISOString();
        return { ok: true, text: async () => JSON.stringify({ data: [
          { id: 'pt-past', attributes: { starts_at: at(-90 - pastOffset), ends_at: at(-1 - pastOffset), time_type: 'service' } },
          { id: 'pt-reh', attributes: { starts_at: at(5), time_type: 'rehearsal' } },
          { id: 'pt-late', attributes: { starts_at: at(180), time_type: 'service' } },
          { id: 'pt-next', attributes: { starts_at: at(20), time_type: 'service' } },
        ] }) };
      }
      if (url.includes('/live')) return { ok: true, text: async () => JSON.stringify({ data: { links: { current_item_time: liveItem ? 'https://api.planningcenteronline.com/services/v2/live-item-time' : null } } }) };
      return scheduleMock(url);
    };
    let data = await get(port, '/greenroom-live');
    assert.equal(data.ok, true);
    assert.deepEqual(data.live.now, { title: 'How Great Thou Art', keyName: 'Bb', length: 360, type: 'song' });
    assert.equal(data.live.next.title, 'Sermon', 'Up next skips section headers');
    assert.equal(data.live.index, 1, 'its place in the order of service');
    t('/greenroom-live shows the live item and the next one, skipping headers');

    assert.equal(data.live.startedAt, '2026-10-25T13:04:10Z');
    assert.ok(Math.abs(Date.parse(data.serverTime) - Date.now()) < 5000, 'JPMixer’s own clock, for counting down');
    t('the live item’s start time comes from Planning Center when it has one');

    const nextAt = Date.parse(data.nextServiceAt) - Date.now();
    assert.ok(nextAt > 19 * 60000 && nextAt < 21 * 60000, 'the next service still to come, not the rehearsal, a past or a later one');
    t('/greenroom-live gives the next service time');

    pastOffset = -10; // the earlier service now ends in 9 minutes
    data = await get(port, '/greenroom-live');
    assert.equal(data.nextServiceAt, null);
    pastOffset = 0;
    t('no countdown to the next service while one is still on');

    _resetLive();
    liveItem = 'i4'; liveStartAt = null;
    const before = Date.now();
    data = await get(port, '/greenroom-live');
    const firstSeen = Date.parse(data.live.startedAt);
    assert.equal(data.live.now.title, 'Sermon');
    assert.ok(firstSeen >= before - 1000 && firstSeen <= Date.now() + 1000, 'without one, when JPMixer first saw it live');
    await new Promise((r) => setTimeout(r, 50));
    _resetLive(false);
    data = await get(port, '/greenroom-live');
    assert.equal(data.live.startedAt, new Date(firstSeen).toISOString(), 'and it stays that while the item stays live');
    t('without Planning Center’s start time, the item counts from when it went live');

    _resetLive();
    liveItem = null;
    data = await get(port, '/greenroom-live');
    assert.equal(data.live, null);
    t('/greenroom-live is empty when Planning Center Live isn’t running');
    global.fetch = scheduleMock;
  }

  {
    const saved = config.getAll();
    config.save({ ...saved, pcoAppId: '', pcoSecret: '' });
    const data = await get(port, '/greenroom-live');
    assert.equal(data.ok, true);
    assert.equal(data.live, null);
    assert.equal(data.nextServiceAt, null);
    config.save(saved);
    t('/greenroom-live answers quietly when Planning Center isn’t set up');
  }

  // ── "Your mix" QR code ───────────────────────────────────────────────
  {
    const getWithHost = (host) => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: '/greenroom-qr', headers: { Host: host } }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });
    let data = await getWithHost('192.168.1.20:8080');
    assert.equal(data.enabled, true);
    assert.equal(data.url, 'http://192.168.1.20:8080/', 'the address the TV typed, which phones on its network reach too');
    assert.ok(data.svg.startsWith('<svg') && data.svg.includes('<path d="M'), 'an SVG QR code');
    assert.ok(!/<script|on\w+=/i.test(data.svg));
    data = await getWithHost('192.168.1.20');
    assert.equal(data.url, 'http://192.168.1.20/', 'Port 80 needs no port in the address');
    t('the Green Room QR code opens the aux picker at the address the TV used');

    data = await getWithHost('localhost:8080');
    assert.ok(data.url === null || (/^http:\/\/\d+\.\d+\.\d+\.\d+(:\d+)?\/$/.test(data.url) && !data.url.includes('127.0.0.1')), 'this computer’s network address, not localhost');
    data = await getWithHost('evil.example"><script>');
    assert.ok(!data.url || !data.url.includes('<'), 'an odd Host header is never put in the code');
    t('a Green Room open on this computer gets its network address instead of localhost');

    config.save({ ...config.getAll(), greenRoomQr: false });
    data = await getWithHost('192.168.1.20:8080');
    assert.deepEqual(data, { ok: true, enabled: false });
    config.save({ ...config.getAll(), greenRoomQr: true });
    t('Settings can turn the QR code off');

    data = await getWithHost('192.168.1.20:8080').then(() => get(port, '/greenroom-spl'));
    assert.deepEqual(data, { ok: true, enabled: false, reading: null }, 'off by default');
    config.save({ ...config.getAll(), greenRoomSpl: true, smaartEnabled: false });
    data = await get(port, '/greenroom-spl');
    assert.equal(data.enabled, false, 'it also needs Smaart SPL on');
    config.save({ ...config.getAll(), greenRoomSpl: false });
    t('the Green Room SPL reading is off unless both it and Smaart SPL are on');
  }

  global.fetch = origFetch;
  server.close();

  console.log(`\n${n} checks passed`);
}

main().catch((err) => { console.error(err); process.exit(1); });
