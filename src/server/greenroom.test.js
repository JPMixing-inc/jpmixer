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
  config.save({ ...config.getAll(), pcoAppId: 'app', pcoSecret: 'secret', pcoServiceTypeId: '1', pcoIncludeUnconfirmed: false });

  const origFetch = global.fetch;
  global.fetch = async (url) => {
    if (url.includes('/plans?')) {
      return { ok: true, text: async () => JSON.stringify({ data: [
        { id: '100', type: 'Plan', attributes: { sort_date: '2999-01-01T00:00:00Z', title: 'Sunday Service' } },
      ] }) };
    }
    if (url.includes('/team_members')) {
      return { ok: true, text: async () => JSON.stringify({ data: [
        { id: '1', type: 'PlanPerson', attributes: { name: 'John Smith', team_position_name: 'Acoustic Guitar', status: 'C', photo_thumbnail_url: 'https://example.com/john.jpg' } },
        { id: '2', type: 'PlanPerson', attributes: { name: 'Jane Doe', team_position_name: 'Lead Vocal', status: 'U' } },
      ] }) };
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

  global.fetch = origFetch;
  server.close();

  console.log(`\n${n} checks passed`);
}

main().catch((err) => { console.error(err); process.exit(1); });
