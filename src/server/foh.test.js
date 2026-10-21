'use strict';
// Integration test for foh.js's /foh-data route against a real Express app
// + real HTTP requests, with Planning Center's API mocked via a global
// fetch monkeypatch (same approach as greenroom.test.js).
// Run with: node src/server/foh.test.js

const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return path.join(__dirname, '_fake-electron-for-tests.js');
  return origResolve.call(this, request, ...args);
};
process.env.JPM_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-foh-test-'));

const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const config = require('./config');
const { mountFoh, hasFohAccess } = require('./foh');

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
  let connected = true;
  let deviceCount = 3;
  mountFoh(app, { isConsoleConnected: () => connected, getConnectionCount: () => deviceCount });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  // ── Not configured yet ───────────────────────────────────────────────
  {
    const data = await get(port, '/foh-data');
    assert.equal(data.ok, false);
    assert.ok(data.error.includes('Settings'), 'should point at Settings, not a raw error, when the FOH position is not configured');
    assert.equal(data.consoleConnected, true, 'connection status is independent of Planning Center being configured at all');
    assert.equal(data.connectionCount, 3);
    t('an unconfigured FOH Engineer position returns a clear, non-crashing message, but still reports connection status');
  }

  // ── Configured, mock Planning Center responses ──────────────────────
  config.save({
    ...config.getAll(),
    pcoAppId: 'app', pcoSecret: 'secret', pcoServiceTypeId: '1',
    pcoFohPositionName: 'Audio Engineer FOH', pcoFohTeamId: '', pcoDay: '',
  });

  const origFetch = global.fetch;
  global.fetch = async (url) => {
    if (url.includes('/plans?')) {
      return { ok: true, text: async () => JSON.stringify({ data: [
        { id: '100', type: 'Plan', attributes: { sort_date: '2999-01-01T00:00:00Z', title: 'Sunday Service' } },
      ] }) };
    }
    if (url.includes('/plan_times')) {
      return { ok: true, text: async () => JSON.stringify({ data: [] }) };
    }
    if (url.includes('/team_members')) {
      return { ok: true, text: async () => JSON.stringify({
        data: [
          { id: '1', type: 'PlanPerson', attributes: { name: 'Josiah Papovitch', team_position_name: 'Audio Engineer FOH', status: 'C', photo_thumbnail_url: 'https://example.com/josiah.jpg' } },
          { id: '2', type: 'PlanPerson', attributes: { name: 'Jane Doe', team_position_name: 'Lead Vocal', status: 'C' } },
          { id: '3', type: 'PlanPerson', attributes: { name: 'Unconfirmed Guy', team_position_name: 'Audio Engineer FOH', status: 'U' } },
        ],
      }) };
    }
    if (url.includes('/team_positions')) {
      return { ok: true, text: async () => JSON.stringify({
        data: [
          { id: '10', type: 'TeamPosition', attributes: { name: 'Audio Engineer FOH' }, relationships: { team: { data: { type: 'Team', id: 'team-production' } } } },
          { id: '11', type: 'TeamPosition', attributes: { name: 'Lead Vocal' }, relationships: { team: { data: { type: 'Team', id: 'team-worship' } } } },
        ],
        included: [
          { type: 'Team', id: 'team-production', attributes: { name: 'Production' } },
          { type: 'Team', id: 'team-worship', attributes: { name: 'Worship Team' } },
        ],
      }) };
    }
    if (url.includes('/items')) {
      return { ok: true, text: async () => JSON.stringify({ data: [
        { id: 'i2', type: 'Item', attributes: { item_type: 'song', title: 'Great Are You Lord', description: 'Led by: Jane', length: 300, key_name: 'G', sequence: 3 } },
        { id: 'i1', type: 'Item', attributes: { item_type: 'header', title: 'WORSHIP', description: null, length: 0, key_name: null, sequence: 1 } },
        // Flanks the live item — "Firm Foundation" is the nearest preceding
        // content item (skipping the WORSHIP header between them), "Build
        // My Life" the nearest following one.
        { id: 'i3', type: 'Item', attributes: { item_type: 'song', title: 'Firm Foundation', description: 'Led by: Will', length: 260, key_name: 'A', sequence: 2 } },
        { id: 'i4', type: 'Item', attributes: { item_type: 'song', title: 'Build My Life', description: 'Led by: Renee', length: 310, key_name: 'C', sequence: 4 } },
      ] }) };
    }
    // Services LIVE — in progress, pointed at "Great Are You Lord" (i2).
    // current_item_time is a `links` entry on Live, not a relationship —
    // fetched as its own request, same shape confirmed against a real
    // account (see pco-client.js's getLiveItemId).
    if (url.includes('/live/item_times/')) {
      return { ok: true, text: async () => JSON.stringify({ data: { type: 'ItemTime', id: 'it-time-1', relationships: { item: { data: { type: 'Item', id: 'i2' } } } } }) };
    }
    if (url.includes('/live')) {
      return { ok: true, text: async () => JSON.stringify({ data: { type: 'Live', id: '100', attributes: {}, links: {
        current_item_time: 'https://api.planningcenteronline.com/services/v2/service_types/1/plans/100/live/item_times/it-time-1',
      } } }) };
    }
    throw new Error('unexpected URL in test: ' + url);
  };

  {
    const data = await get(port, '/foh-data');
    assert.equal(data.ok, true);
    assert.equal(data.plan.title, 'Sunday Service');
    assert.deepEqual(data.engineer, { name: 'Josiah Papovitch', photoUrl: 'https://example.com/josiah.jpg', personId: null });
    assert.equal(data.consoleConnected, true);
    assert.equal(data.connectionCount, 3);
    assert.deepEqual(data.roster.map((m) => m.name), ['Josiah Papovitch', 'Jane Doe'], 'confirmed members only by default, same rule as Green Room');
    assert.equal(data.rosterTeamName, null, 'no pcoTeamId set — generic "Team" heading, not a specific team name');
    assert.deepEqual(data.order.map((it) => it.title), ['WORSHIP', 'Firm Foundation', 'Great Are You Lord', 'Build My Life'], 'returned in Planning Center\'s own sequence order, not response order');
    const liveRow = data.order.find((it) => it.title === 'Great Are You Lord');
    assert.equal(liveRow.keyName, 'G');
    assert.equal(liveRow.live, true, 'Great Are You Lord is the live item in this fixture');
    assert.equal(data.order.find((it) => it.title === 'WORSHIP').live, false);
    assert.deepEqual(data.liveItem, { type: 'song', title: 'Great Are You Lord', description: 'Led by: Jane', length: 300, keyName: 'G', live: true });
    assert.deepEqual(data.previousItem, { type: 'song', title: 'Firm Foundation', description: 'Led by: Will', length: 260, keyName: 'A', live: false }, 'nearest preceding content item, skipping the WORSHIP header');
    assert.deepEqual(data.nextItem, { type: 'song', title: 'Build My Life', description: 'Led by: Renee', length: 310, keyName: 'C', live: false });
    t('a configured FOH position resolves to the confirmed person scheduled to it, with their photo, roster, and order of service');
  }

  config.save({ ...config.getAll(), pcoTeamId: 'team-worship' });
  {
    const data = await get(port, '/foh-data');
    assert.equal(data.rosterTeamName, 'Worship Team', 'the roster card\'s heading should name the actual team, not a generic "Team"');
    assert.deepEqual(data.roster.map((m) => m.name), ['Jane Doe'], 'narrowed to Worship Team members only — Josiah (Production) excluded');
    t('pcoTeamId resolves rosterTeamName so the roster card can say which team it is');
  }
  config.save({ ...config.getAll(), pcoTeamId: '' });

  connected = false; deviceCount = 0;
  {
    const data = await get(port, '/foh-data');
    assert.equal(data.consoleConnected, false);
    assert.equal(data.connectionCount, 0);
    t('connection status reflects the active backend live, not a cached value');
  }
  connected = true; deviceCount = 3;

  config.save({ ...config.getAll(), pcoFohPositionName: 'Monitor Engineer' });
  {
    const data = await get(port, '/foh-data');
    assert.equal(data.ok, true);
    assert.equal(data.engineer, null, 'nobody is scheduled to a position that was never on this plan');
    t('a configured position nobody is scheduled to resolves to a null engineer, not an error');
  }

  config.save({ ...config.getAll(), pcoFohPositionName: 'Audio Engineer FOH', pcoFohTeamId: 'team-production' });
  {
    const data = await get(port, '/foh-data');
    assert.deepEqual(data.engineer, { name: 'Josiah Papovitch', photoUrl: 'https://example.com/josiah.jpg', personId: null });
    t('pairing the FOH position with its team still resolves correctly when they match');
  }

  config.save({ ...config.getAll(), pcoFohTeamId: 'team-worship' });
  {
    const data = await get(port, '/foh-data');
    assert.equal(data.engineer, null, 'the position exists, but not on the team this FOH role was pinned to — must not fall back to a same-named match on a different team');
    t('pairing the FOH position with the wrong team excludes an otherwise-matching person');
  }

  // ── A decline must never win over an available confirmed person, even
  // when it's listed first and includeUnconfirmed is on (a real bug: the
  // original FOH slot's person declined, someone else got confirmed, and
  // the page kept greeting the person who said no instead). ──
  config.save({ ...config.getAll(), pcoFohTeamId: '', pcoIncludeUnconfirmed: true });
  {
    const declineFetch = global.fetch;
    global.fetch = async (url) => {
      if (url.includes('/plans?')) {
        return { ok: true, text: async () => JSON.stringify({ data: [
          { id: '100', type: 'Plan', attributes: { sort_date: '2999-01-01T00:00:00Z', title: 'Sunday Service' } },
        ] }) };
      }
      if (url.includes('/plan_times')) return { ok: true, text: async () => JSON.stringify({ data: [] }) };
      if (url.includes('/items')) return { ok: true, text: async () => JSON.stringify({ data: [] }) };
      if (url.includes('/team_members')) {
        return { ok: true, text: async () => JSON.stringify({ data: [
          { id: '1', type: 'PlanPerson', attributes: { name: 'Heath (declined)', team_position_name: 'Audio Engineer FOH', status: 'D', photo_thumbnail_url: 'https://example.com/heath.jpg' } },
          { id: '2', type: 'PlanPerson', attributes: { name: 'Chris (confirmed)', team_position_name: 'Audio Engineer FOH', status: 'C', photo_thumbnail_url: 'https://example.com/chris.jpg' } },
        ] }) };
      }
      throw new Error('unexpected URL in test: ' + url);
    };
    const data = await get(port, '/foh-data');
    assert.deepEqual(data.engineer, { name: 'Chris (confirmed)', photoUrl: 'https://example.com/chris.jpg', personId: null }, 'the declined person appears first in Planning Center\'s own order, but must lose to the confirmed one regardless');
    t('a declined FOH candidate never wins over a confirmed one, even when listed first with includeUnconfirmed on');
    global.fetch = declineFetch;
  }

  // ── ProPresenter / Lighting / Switcher Home pages ───────────────────
  {
    global.fetch = async (url) => {
      if (url.includes('/plans?')) return { ok: true, text: async () => JSON.stringify({ data: [{ id: '100', type: 'Plan', attributes: { sort_date: '2999-01-01T00:00:00Z', title: 'Sunday Service' } }] }) };
      if (url.includes('/plan_times')) return { ok: true, text: async () => JSON.stringify({ data: [] }) };
      if (url.includes('/team_members')) return { ok: true, text: async () => JSON.stringify({ data: [
        { id: '1', type: 'PlanPerson', attributes: { name: 'Sam Slides', team_position_name: 'ProPresenter', status: 'C' } },
        { id: '2', type: 'PlanPerson', attributes: { name: 'Lee Lights', team_position_name: 'Lighting', status: 'C' } },
      ] }) };
      if (url.includes('/items')) return { ok: true, text: async () => JSON.stringify({ data: [] }) };
      throw new Error('not in this test: ' + url);
    };
    config.save({ ...config.getAll(), pcoFohTeamId: '', pcoTeamId: '', pcoIncludeUnconfirmed: false, pcoProPresenterPositionName: 'ProPresenter', pcoLightingPositionName: 'Lighting', pcoSwitcherPositionName: '' });
    const slides = await get(port, '/role-data?role=propresenter');
    assert.equal(slides.ok, true);
    assert.equal(slides.engineer.name, 'Sam Slides', 'each page welcomes the person in its own role');
    assert.deepEqual(slides.role, { id: 'propresenter', label: 'ProPresenter', page: 'ProPresenter Home' });
    assert.equal(slides.consoleConnected, false, 'only FOH Home reports the console');
    assert.equal((await get(port, '/role-data?role=lighting')).engineer.name, 'Lee Lights');
    const switcher = await get(port, '/role-data?role=switcher');
    assert.equal(switcher.ok, false);
    assert.match(switcher.error, /Switcher Home page isn’t set up yet/);
    const unknown = await get(port, '/role-data?role=nope');
    assert.equal(unknown.ok, false);
    t('the ProPresenter, Lighting and Switcher pages each welcome their own scheduled role, or say how to set it up');

    const page = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: '/lighting.html' }, (res) => { let d = ''; res.on('data', c => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d })); }).on('error', reject));
    assert.equal(page.status, 200);
    assert.match(page.body, /data-role-page/);
    assert(!page.body.includes('fhConsoleBadge'), 'no console badge on the role pages');
    t('/lighting.html serves the shared role page');
  }

  // ── FOH Home access code ────────────────────────────────────────────
  {
    const phone = (cookie) => ({ socket: { remoteAddress: '::ffff:192.0.2.50' }, headers: cookie ? { cookie } : {} });
    config.save({ ...config.getAll(), fohAccessCode: '' });
    assert.equal(hasFohAccess(phone()), true, 'no code set: open to the network, as before');
    config.save({ ...config.getAll(), fohAccessCode: '4821' });
    assert.equal(hasFohAccess(phone()), false);
    assert.equal(hasFohAccess({ socket: { remoteAddress: '127.0.0.1' }, headers: {} }), true, 'this computer never needs the code');
    const post = (body) => new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/foh-unlock', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => { let d = ''; res.on('data', c => (d += c)); res.on('end', () => resolve({ status: res.statusCode, cookie: res.headers['set-cookie'], body: JSON.parse(d) })); });
      req.on('error', reject); req.end(JSON.stringify(body));
    });
    const wrong = await post({ code: '1111' });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.cookie, undefined);
    const right = await post({ code: ' 4821 ' });
    assert.equal(right.body.ok, true);
    const cookie = right.cookie[0].split(';')[0];
    assert.match(right.cookie[0], /HttpOnly/);
    assert.equal(hasFohAccess(phone(cookie)), true, 'the cookie from the right code opens it');
    assert.equal(hasFohAccess(phone('jpm_foh=forged')), false);
    config.save({ ...config.getAll(), fohAccessCode: '9999' });
    assert.equal(hasFohAccess(phone(cookie)), false, 'changing the code signs every device out');
    t('FOH Home needs its code on other devices, remembers it per browser, and a new code signs everyone out');

    let last;
    for (let i = 0; i < 9; i++) last = await post({ code: 'guess' + i });
    assert.equal(last.status, 429, 'guessing is limited');
    t('guessing the FOH code is rate-limited');

    const pages = (await get(port, '/home-pages')).pages;
    assert.deepEqual(pages.map(p => p.id), ['foh', 'propresenter', 'lighting', 'switcher']);
    assert.equal(pages[0].locked, true);
    assert.equal(pages[0].href, '/foh.html');
    assert.equal(pages.find(p => p.id === 'switcher').configured, false);
    t('the Home page picker lists every page, which are set up, and which need a code');
    config.save({ ...config.getAll(), fohAccessCode: '' });
  }

  // ── Team chat ─────────────────────────────────────────────────────────
  {
    require('./chat').reset();
    const postChat = (body) => new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/chat/send', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => { let d = ''; res.on('data', c => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) })); });
      req.on('error', reject); req.end(JSON.stringify(body));
    });
    // A stream listener first, to check messages arrive live
    const live = [];
    const stream = await new Promise((resolve) => http.get({ host: '127.0.0.1', port, path: '/chat/stream' }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk) => { for (const m of chunk.matchAll(/^data: (.+)$/gm)) live.push(JSON.parse(m[1])); });
      resolve(res);
    }));
    const sent = await postChat({ role: 'lighting', name: 'Lee Lights', text: '  Haze is on  ', clientId: 'abc' });
    assert.equal(sent.body.ok, true);
    assert.equal(sent.body.message.text, 'Haze is on', 'trimmed');
    await new Promise(r => setTimeout(r, 50));
    assert.deepEqual(live.map(m => [m.role, m.name, m.text]), [['lighting', 'Lee Lights', 'Haze is on']], 'every open page gets it straight away');
    assert.equal((await postChat({ role: 'lighting', text: '   ' })).status, 400, 'an empty message is refused');
    assert.equal((await postChat({ role: 'audience', text: 'hi' })).status, 400, 'only the Home pages can post');
    const long = await postChat({ role: 'foh', text: 'x'.repeat(900), name: 'n'.repeat(200) });
    assert.equal(long.body.message.text.length, 500);
    assert.equal(long.body.message.name.length, 60);
    const history = (await get(port, '/chat/history')).messages;
    assert.deepEqual(history.map(m => m.role), ['lighting', 'foh']);
    t('team chat: messages reach every open Home page live, are kept for history, and are validated');

    let status;
    for (let i = 0; i < 12; i++) status = (await postChat({ role: 'switcher', text: 'spam ' + i })).status;
    assert.equal(status, 429, 'one device can\u2019t flood the chat');
    t('team chat: sending is rate-limited per device');
    stream.destroy();
  }

  // ── Saved layouts per scheduled team member ────────────────────────────
  {
    let scheduled = { id: '777', name: 'Lee Lights' };
    global.fetch = async (url) => {
      if (url.includes('/plans?')) return { ok: true, text: async () => JSON.stringify({ data: [{ id: '100', type: 'Plan', attributes: { sort_date: '2999-01-01T00:00:00Z', title: 'Sunday Service' } }] }) };
      if (url.includes('/plan_times')) return { ok: true, text: async () => JSON.stringify({ data: [] }) };
      if (url.includes('/team_members')) return { ok: true, text: async () => JSON.stringify({ data: [
        { id: 'pp1', type: 'PlanPerson', attributes: { name: scheduled.name, team_position_name: 'Lighting', status: 'C' }, relationships: { person: { data: { type: 'Person', id: scheduled.id } } } },
      ] }) };
      if (url.includes('/items')) return { ok: true, text: async () => JSON.stringify({ data: [] }) };
      throw new Error('not in this test: ' + url);
    };
    config.save({ ...config.getAll(), fohAccessCode: '', pcoLightingPositionName: 'Lighting', pcoLightingTeamId: '' });
    const post = (body) => new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/home-layout', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => { let d = ''; res.on('data', c => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) })); });
      req.on('error', reject); req.end(JSON.stringify(body));
    });
    const layout = { order: ['chat', 'live', 'team', 'order'], cards: { chat: { size: 'wide', height: 'tall' }, team: { hidden: true }, evil: { size: 'huge', span: 99 } } };
    const lighting = await get(port, '/role-data?role=lighting');
    assert.equal(lighting.engineer.personId, '777', 'the page knows who is scheduled');
    const saved = await post({ role: 'lighting', personId: '777', layout });
    assert.equal(saved.body.ok, true);
    assert.equal(saved.body.name, 'Lee Lights');
    const back = await get(port, '/home-layout?role=lighting&person=777');
    assert.deepEqual(back.layout.order, ['chat', 'live', 'team', 'order']);
    assert.equal(back.layout.cards.chat.size, 'wide');
    assert.equal(back.layout.cards.team.hidden, true);
    assert.deepEqual(back.layout.cards.evil, { hidden: false, size: 'standard', height: 'auto', span: null, pixels: null }, 'out-of-range sizes are reset, not stored');
    assert.equal((await get(port, '/home-layout?role=lighting&person=555')).layout, null, 'someone else has no saved layout');
    assert.equal(back.fromRole, 'lighting');
    t('a Home page layout saves for the scheduled team member and loads back for them only');

    const elsewhere = await get(port, '/home-layout?role=switcher&person=777');
    assert.equal(elsewhere.fromRole, 'lighting', 'no Switcher layout yet: their Lighting one is offered');
    assert.equal(elsewhere.fromPage, 'Lighting Home');
    assert.deepEqual(elsewhere.layout.order, ['chat', 'live', 'team', 'order']);
    t('on a page they have no layout for, the person gets the one they saved on another Home page');

    const free = { v: 2, cards: {
      chat: { x: 16, y: 40, w: 8, h: 30 }, live: { x: 0, y: 0, w: 24, h: 20, hidden: false },
      evil: { x: 20, y: 0, w: 10, h: 30 },    // runs off the right edge
      tiny: { x: 0, y: 0, w: 1, h: 2 },       // smaller than a card can be
    } };
    assert.equal((await post({ role: 'lighting', personId: '777', layout: free })).body.ok, true);
    const freeBack = await get(port, '/home-layout?role=lighting&person=777');
    assert.deepEqual(freeBack.layout, { v: 2, cards: { chat: { hidden: false, x: 16, y: 40, w: 8, h: 30 }, live: { hidden: false, x: 0, y: 0, w: 24, h: 20 } } });
    t('a free-grid layout (any position and size) saves and loads back exactly; impossible cards are dropped');

    assert.equal((await post({ role: 'lighting', personId: '555', layout })).status, 409, 'only for the person scheduled right now');
    scheduled = { id: '888', name: 'Sam Spot' };
    require('./pco-client').shared.clear();
    const stale = await post({ role: 'lighting', personId: '777', layout });
    assert.equal(stale.status, 409);
    assert.match(stale.body.error, /now scheduled for Sam Spot/);
    config.save({ ...config.getAll(), pcoLightingPositionName: '' });
    assert.equal((await post({ role: 'lighting', personId: '888', layout })).status, 409, 'nobody scheduled: nothing to save for');
    t('a layout can only be saved for whoever is scheduled on that page right now');
  }

  {
    // Planning Center card: this plan's link, the next few plans, and no link
    // that isn't Planning Center's own
    global.fetch = async (url) => {
      const plan = (id, date, title, href) => ({ id, type: 'Plan', attributes: { sort_date: date, title, series_title: 'Rooted', planning_center_url: href } });
      if (url.includes('filter=future')) return { ok: true, text: async () => JSON.stringify({ data: [
        plan('100', '2999-01-01T10:00:00Z', 'Sunday Service', 'https://services.planningcenteronline.com/plans/100'),
        plan('101', '2999-01-08T10:00:00Z', 'Next Week', 'https://services.planningcenteronline.com/plans/101'),
        plan('102', '2999-01-15T10:00:00Z', 'Sneaky', 'javascript:alert(1)'),
      ] }) };
      if (url.includes('/plans?')) return { ok: true, text: async () => JSON.stringify({ data: [plan('100', '2999-01-01T10:00:00Z', 'Sunday Service', 'https://services.planningcenteronline.com/plans/100')] }) };
      if (url.includes('/plan_times') || url.includes('/team_members') || url.includes('/items')) return { ok: true, text: async () => JSON.stringify({ data: [] }) };
      if (url.includes('/live')) return { ok: true, text: async () => JSON.stringify({ data: { links: {} } }) };
      throw new Error('not in this test: ' + url);
    };
    require('./pco-client').shared.clear();
    config.save({ ...config.getAll(), fohAccessCode: '', pcoLightingPositionName: 'Lighting', pcoLightingTeamId: '' });
    const d = await get(port, '/role-data?role=lighting');
    assert.equal(d.plan.url, 'https://services.planningcenteronline.com/plans/100');
    assert.equal(d.plan.seriesTitle, 'Rooted');
    assert.deepEqual(d.upcoming.map(p => p.title), ['Next Week', 'Sneaky'], 'the current plan isn\'t repeated under Coming up');
    assert.equal(d.upcoming[0].url, 'https://services.planningcenteronline.com/plans/101');
    assert.equal(d.upcoming[1].url, null, 'a link that isn\'t Planning Center\'s is dropped');
    assert.equal(d.pcoHome, 'https://services.planningcenteronline.com');
    t('the Planning Center card gets this plan\'s link and the next plans, and only Planning Center links');
  }

  global.fetch = origFetch;
  server.close();

  console.log(`\n${n} checks passed`);
}

main().catch((err) => { console.error(err); process.exit(1); });
