'use strict';
// The ProPresenter plugin (plugins/propresenter), run as JPMixer runs it,
// against a fake ProPresenter that answers the way ProPresenter 21.4 did:
// its four cards, what each button sends, and a ProPresenter that's gone.

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
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-propresenter-test-'));
process.env.JPM_TEST_USERDATA = userData;

const test = require('node:test');
const assert = require('node:assert/strict');
const plugins = require('./plugins');
const SOURCE = path.join(__dirname, '..', '..', 'plugins', 'propresenter');
test.after(() => plugins.stopAll());

// ── Fake ProPresenter ──────────────────────────────────────────────────────
function fakeProPresenter() {
  const id = (name, uuid, index = 0) => ({ name, uuid, index });
  const pp = {
    calls: [], streams: new Set(),
    slide: { current: { text: 'Verse one line\nVerse two line', notes: '', uuid: 's1' }, next: { text: 'Chorus line\nmore', notes: '', uuid: 's2' } },
    timers: [{ id: id('Countdown', 't1'), time: '00:05:00', state: 'stopped' }],
    stage: '',
    messages: [{ id: id('Parking', 'm1'), message: 'Move car {Plate}', tokens: [], is_active: false }],
    macros: [{ id: id('Walk-in', 'mac1') }],
    looks: [{ id: id('Default', 'look1') }, { id: id('Lyrics only', 'look2', 1) }],
    look: { id: id('Default', 'live-look') },
  };
  const line = (url, data) => `${JSON.stringify({ url, data })}\r\n\r\n`;
  pp.push = (url, data) => { for (const res of pp.streams) res.write(line(url, data)); };
  pp.server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = req.url;
      const json = (v) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
      const done = () => { res.writeHead(204); res.end(); };
      if (url === '/v1/status/updates' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' });
        pp.streams.add(res);
        res.on('close', () => pp.streams.delete(res)); // (the request closes as soon as its body is read)
        res.write(line('status/slide', pp.slide));
        res.write(line('presentation/current', { presentation: { id: id('Sunday Songs', 'p1') } }));
        res.write(line('timers/current', pp.timers));
        res.write(line('messages', pp.messages));
        res.write(line('look/current', pp.look));
        res.write(line('status/layers', { slide: true, media: false }));
        res.write(line('presentation/slide_index', { presentation_index: { index: 0, presentation_id: id('Sunday Songs', 'p1') } }));
        return;
      }
      if (req.method !== 'GET' || /trigger|clear|\/start$|\/stop$|\/reset$/.test(url)) pp.calls.push(`${req.method} ${url}${body ? ' ' + body : ''}`);
      // Pictures: a slide's and media's (a few bytes standing in for a JPEG)
      const thumb = /^\/v1\/(presentation\/p1\/thumbnail\/(\d+)|media\/([^/?]+)\/thumbnail)\?quality=480$/.exec(url);
      if (thumb) { pp.thumbs = (pp.thumbs || 0) + 1; res.writeHead(200, { 'Content-Type': 'image/jpeg' }); res.end(Buffer.from(`jpeg ${thumb[2] || thumb[3]}`)); return; }
      if (url === '/version') return json({ name: 'Test Mac', host_description: 'ProPresenter 21.4', api_version: 'v1' });
      if (url === '/v1/macros') return json(pp.macros);
      if (url === '/v1/looks') return json(pp.looks);
      if (url === '/v1/clear/groups') return json([{ id: id('Clear All', 'cg1') }]);
      if (url === '/v1/timers/current') return json(pp.timers);
      if (url === '/v1/stage/message') {
        if (req.method === 'PUT') { pp.stage = JSON.parse(body); return done(); }
        if (req.method === 'DELETE') { pp.stage = ''; return done(); }
        return json(pp.stage);
      }
      const timer = /^\/v1\/timer\/([^/]+)\/(start|stop|reset)$/.exec(url);
      if (timer) {
        const t = pp.timers.find((x) => x.id.uuid === timer[1]);
        if (t) t.state = timer[2] === 'start' ? 'running' : 'stopped';
        if (t && timer[2] === 'reset') t.time = '00:05:00';
        return done(); // as on 21.4: no stream update for a reset
      }
      const msg = /^\/v1\/message\/([^/]+)\/(trigger|clear)$/.exec(url);
      if (msg) {
        const m = pp.messages.find((x) => x.id.uuid === msg[1]);
        if (m) m.is_active = msg[2] === 'trigger';
        pp.push('messages', pp.messages);
        return done();
      }
      if (/^\/v1\/(trigger\/(next|previous)|clear\/layer\/\w+|clear\/group\/[^/]+\/trigger|macro\/[^/]+\/trigger|look\/[^/]+\/trigger)$/.test(url)) return done();
      res.writeHead(404); res.end();
    });
  });
  return pp;
}

const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 50)); }
};
const card = (key) => plugins.cards().find((c) => c.cardId === `p-propresenter_${key}`)?.card;

test('the ProPresenter plugin: its cards on every Home page, and each button reaches ProPresenter', async () => {
  const pp = fakeProPresenter();
  await new Promise((r) => pp.server.listen(0, '127.0.0.1', r));
  const port = pp.server.address().port;
  fs.cpSync(SOURCE, path.join(userData, 'plugins', 'propresenter'), { recursive: true });
  plugins.save({ propresenter: { enabled: true, settings: { host: '127.0.0.1', port } } });
  await plugins.start({ allowed: true });
  try {
    assert.deepEqual(plugins.cards().map((c) => [c.cardId, c.title, c.everyPage]), [
      ['p-propresenter_now', 'ProPresenter', true], ['p-propresenter_timers', 'Timers', true],
      ['p-propresenter_messages', 'Audience messages', true], ['p-propresenter_macros', 'Macros & Looks', true],
    ]);
    // The controller: On screen (pictures of both slides), Controls, Timers, Stage message
    const section = (title) => card('now')?.sections.find((x) => x.title === title);
    await until(() => section('On screen')?.images[0].src && section('On screen').images[1].src && card('macros')?.sections?.length === 2);
    assert.deepEqual(card('now').sections.map((x) => x.title), ['On screen', 'Controls', 'Timers', 'Stage message']);
    const [now, next] = section('On screen').images;
    assert.deepEqual([now.label, now.caption, next.label, next.caption], ['Now', 'Verse one line\nVerse two line', 'Next', 'Chorus line\nmore']);
    assert.match(now.src, /^\/plugin-cards\/image\/p-propresenter_now\/[0-9a-f]{16}$/);
    assert.equal(plugins.cardImage('p-propresenter_now', 'current', { foh: false }).buf.toString(), 'jpeg 0', 'the live slide’s picture');
    assert.equal(plugins.cardImage('p-propresenter_now', 'next', { foh: false }).buf.toString(), 'jpeg 1', 'and the next one’s');
    assert.deepEqual(section('On screen').rows, [{ label: 'Presentation', value: 'Sunday Songs', color: '' }, { label: 'Look', value: 'Default', color: '' }]);
    assert.deepEqual(section('Controls').buttons.map((b) => b.id), ['prev', 'next', 'clear-slide', 'clear-group:cg1']);
    // The next slide: its picture is the one already fetched for Next
    const before = pp.thumbs;
    pp.slide = { current: pp.slide.next, next: { text: 'Bridge line', notes: '', uuid: 's3' } };
    pp.push('status/slide', pp.slide); // as ProPresenter does: the words, then the slide number
    pp.push('presentation/slide_index', { presentation_index: { index: 1, presentation_id: { name: 'Sunday Songs', uuid: 'p1', index: 0 } } });
    await until(() => plugins.cardImage('p-propresenter_now', 'current', { foh: false })?.buf.toString() === 'jpeg 1');
    await until(() => plugins.cardImage('p-propresenter_now', 'next', { foh: false })?.buf.toString() === 'jpeg 2');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(pp.thumbs - before, 1, 'Next becoming Now is the picture it already had: only the new Next is fetched');
    assert.deepEqual(card('timers').rows.map((r) => [r.label, r.value, r.buttons.map((b) => b.id)]), [['Countdown', '5:00', ['start:t1', 'reset:t1']]]);
    assert.deepEqual(plugins.runningTimers(), [], 'no timer running: nothing at the top of the pages');
    assert.deepEqual(card('macros').sections.map((x) => [x.title, x.buttons.map((b) => [b.label, b.active])]), [['Macros', [['Walk-in', false]]], ['Looks', [['Default', true], ['Lyrics only', false]]]], 'the live Look marked, by name');

    // Slides, clear, macros and Looks: each sends what ProPresenter Control does
    const press = async (key, button, text) => { assert.deepEqual(plugins.pressCard(`p-propresenter_${key}`, button, text, { foh: false }), { ok: true }); };
    for (const [key, button, sent] of [['now', 'next', 'GET /v1/trigger/next'], ['now', 'prev', 'GET /v1/trigger/previous'], ['now', 'clear-slide', 'GET /v1/clear/layer/slide'],
      ['now', 'clear-group:cg1', 'GET /v1/clear/group/cg1/trigger'], ['macros', 'macro:mac1', 'GET /v1/macro/mac1/trigger'], ['macros', 'look:look2', 'GET /v1/look/look2/trigger']]) {
      await press(key, button);
      await until(() => pp.calls.includes(sent));
    }
    // A timer: started, then reset (which the stream doesn't report): the card follows both
    await press('timers', 'start:t1');
    await until(() => card('timers').rows[0].buttons[0].id === 'stop:t1');
    // Running: at the top of the Home pages and the Green Room, ticking; over time in red
    pp.timers[0].time = '00:04:12';
    pp.push('timers/current', pp.timers);
    await until(() => plugins.runningTimers()[0]?.time === '4:12');
    assert.deepEqual(plugins.runningTimers(), [{ plugin: 'propresenter', name: 'Countdown', time: '4:12', over: false }]);
    pp.timers[0].time = '-00:00:07'; pp.timers[0].state = 'overrunning';
    pp.push('timers/current', pp.timers);
    await until(() => plugins.runningTimers()[0]?.over === true && plugins.runningTimers()[0].time === '-0:07');
    pp.timers[0].state = 'running';
    await press('timers', 'reset:t1');
    await until(() => card('timers').rows[0].value === '5:00' && plugins.runningTimers().length === 0);
    // The stage message: typed, shown, cleared
    await press('now', 'stage', 'Band to the stage');
    await until(() => pp.stage === 'Band to the stage' && section('Stage message').text === 'On stage: Band to the stage');
    await press('now', 'stage-clear');
    await until(() => pp.stage === '' && section('Stage message').text === '' && !section('Stage message').buttons.length);
    // An audience message: shown, then hidden
    await press('messages', 'msg:m1');
    await until(() => pp.calls.includes('POST /v1/message/m1/trigger []') && card('messages').rows[0].buttons[0].label === 'Hide' && card('messages').rows[0].value === 'Showing');
    await press('messages', 'msg:m1');
    await until(() => pp.calls.includes('GET /v1/message/m1/clear'));
    // An image from the Media bin on screen: named, with Clear media
    pp.push('status/layers', { slide: false, media: true });
    pp.push('transport/presentation/current', { name: 'Walk-in loop.mp4', uuid: 'med1', is_playing: true });
    await until(() => section('On screen').images[0].caption === 'Walk-in loop.mp4' && section('Controls').buttons.some((b) => b.id === 'clear-media'));
    await until(() => plugins.cardImage('p-propresenter_now', 'current', { foh: false })?.buf.toString() === 'jpeg med1');
    assert.equal(plugins.cardImage('p-propresenter_now', 'next', { foh: false }), null, 'no next picture for media');
    await press('now', 'clear-media');
    await until(() => pp.calls.includes('GET /v1/clear/layer/media'));
    // A button the card doesn't have isn't sent
    assert.equal(plugins.pressCard('p-propresenter_now', 'macro:anything', undefined, { foh: false }).ok, false);

    // ProPresenter gone: every card says so, and it reconnects when it's back
    for (const res of pp.streams) res.destroy();
    pp.server.close();
    await until(() => card('now').value === 'Not connected');
    assert.match(card('timers').note, /ProPresenter/);
    assert.equal(card('messages'), null, 'no audience messages card while it isn’t connected');
  } finally {
    await plugins.stopAll();
    pp.server.close();
  }
});

// A ProPresenter that answers the slide polls (as 21.4 does): a slide's words
// changing at the same number fetch its picture again; and one that keeps the
// connection but stops answering is noticed in a few seconds, not half a minute
test('ProPresenter: edited slides get new pictures, and a silent ProPresenter is noticed in seconds', async () => {
  const state = { silent: false, text: 'Verse one', thumbs: 0 };
  const line = (url, data) => `${JSON.stringify({ url, data })}\r\n\r\n`;
  const slide = () => ({ current: { text: state.text, notes: '', uuid: 's1' }, next: null });
  const at = { presentation_index: { index: 0, presentation_id: { name: 'Songs', uuid: 'p1', index: 0 } } };
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const json = (v) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
      if (req.url === '/v1/status/updates') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' });
        res.write(line('status/layers', { slide: true, media: false }));
        res.write(line('status/slide', slide()));
        res.write(line('presentation/slide_index', at));
        return; // kept open, as ProPresenter does
      }
      if (state.silent) return; // takes the request, never answers
      if (req.url === '/v1/status/slide') return json(slide());
      if (req.url === '/v1/presentation/slide_index') return json(at);
      if (/^\/v1\/presentation\/p1\/thumbnail\/0/.test(req.url)) { state.thumbs++; res.writeHead(200, { 'Content-Type': 'image/jpeg' }); res.end(Buffer.from(`jpeg ${state.text}`)); return; }
      if (req.url === '/v1/timers/current' || req.url === '/v1/macros' || req.url === '/v1/looks' || req.url === '/v1/clear/groups' || req.url === '/v1/messages') return json([]);
      res.writeHead(404); res.end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  plugins.save({ propresenter: { enabled: true, settings: { host: '127.0.0.1', port: server.address().port } } });
  await plugins.start({ allowed: true });
  try {
    const picture = () => plugins.cardImage('p-propresenter_now', 'current', { foh: false })?.buf.toString();
    await until(() => picture() === 'jpeg Verse one');
    state.text = 'Chorus (inserted)'; // the same slide number, other words: not streamed, only polled
    await until(() => picture() === 'jpeg Chorus (inserted)');
    assert.equal(state.thumbs, 2, 'one fetch for each version of the slide');
    state.silent = true;
    const quietAt = Date.now();
    await until(() => card('now')?.value === 'Not connected', 8000);
    const took = Date.now() - quietAt;
    assert.ok(took < 6000, `noticed after ${took} ms`);
  } finally {
    await plugins.stopAll();
    server.closeAllConnections?.();
    server.close();
  }
});
