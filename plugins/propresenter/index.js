'use strict';

// ── ProPresenter on the Home pages ──────────────────────────────────────────
// Cards on every Home page, through ProPresenter's own network API (the one
// ProPresenter Control uses: ProPresenter → Settings → Network → Enable
// Network, ProPresenter 7.9 and later):
//   now       the controller: what's on screen and next, with pictures of both
//             slides; Previous / Next / Clear; the timers; the stage message
//   timers    every timer, Start / Stop / Reset
//   messages  ProPresenter's audience messages, Show / Hide (only when it has some)
//   macros    the macros, and the Looks with the live one marked
// and, while a timer runs, it at the top of every Home page and the Green
// Room screen (jp.timers; the "Running timers at the top" setting).
// Anyone with a Home page open can use the buttons.
//
// What changes comes over one long request (POST /v1/status/updates: a line
// of JSON for each change). The stage message, and the lists of macros and
// Looks, aren't in it, so they're asked for every few seconds; and on
// ProPresenter 21.4 a timer reset didn't always come through it, so the
// timers are asked for too. Tested on ProPresenter 21.4.

const http = require('http');

module.exports = (jp) => {
  let host = '127.0.0.1', port = 50000, timersOnTop = true;
  const readSettings = (s) => {
    host = String(s.host || '').trim() || '127.0.0.1';
    port = Number.isInteger(s.port) && s.port > 0 && s.port <= 65535 ? s.port : 50000;
    timersOnTop = s.timersOnTop !== false;
  };
  readSettings(jp.settings);

  // ── What ProPresenter has ──────────────────────────────────────────────
  const state = {
    connected: false, name: '', error: '',
    slide: null,        // { current: { text, notes }, next: { text } }
    presentation: '',   // the active presentation's name
    layers: {},         // which layers have something on them: { slide, media, … }
    media: '',          // the media on the presentation layer (an image or video from the Media bin)
    mediaUuid: '',      // and its id, for its picture
    slideAt: null,      // the live slide: { uuid (its presentation), index }
    timers: [],         // [{ uuid, name, time, state }]
    stage: '',          // the stage message
    messages: [],       // [{ uuid, name, active }]
    macros: [],         // [{ uuid, name }]
    looks: [],          // [{ uuid, name }]
    look: '',           // the live Look's name (its uuid differs from the saved one's)
    clearGroups: [],    // [{ uuid, name }]
  };

  // ── Talking to ProPresenter ────────────────────────────────────────────
  function call(method, path, body, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const req = http.request({ host, port, path, method, timeout: timeoutMs, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { if (text.length < 2e6) text += c; });
        res.on('end', () => {
          if (res.statusCode >= 400) { reject(Object.assign(new Error(`ProPresenter said ${res.statusCode} to ${path}`), { status: res.statusCode })); return; }
          if (!text.trim()) { resolve(null); return; }
          try { resolve(JSON.parse(text)); } catch (_) { resolve(text); }
        });
        // Closed part-way through its answer (ProPresenter quit): no 'end'
        // comes, so it's settled here, or the caller waited for ever
        res.on('error', reject);
        res.on('close', () => { if (!res.complete) reject(new Error('ProPresenter closed the connection')); });
      });
      req.on('timeout', () => req.destroy(new Error('ProPresenter didn’t answer')));
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }
  const get = (path) => call('GET', path);
  // A picture (a slide's or media's thumbnail): { type, buf }, or null
  function getImage(path) {
    return new Promise((resolve) => {
      const req = http.request({ host, port, path, method: 'GET', timeout: 4000 }, (res) => {
        const parts = [];
        let size = 0;
        res.on('data', (c) => { size += c.length; if (size <= 600 * 1024) parts.push(c); });
        res.on('end', () => {
          const type = String(res.headers['content-type'] || '').split(';')[0].trim();
          resolve(res.statusCode === 200 && size <= 600 * 1024 && /^image\/(jpeg|png)$/.test(type) ? { type, buf: Buffer.concat(parts) } : null);
        });
        res.on('error', () => resolve(null));
        res.on('close', () => { if (!res.complete) resolve(null); }); // cut off part-way
      });
      req.on('timeout', () => req.destroy());
      req.on('error', () => resolve(null));
      req.end();
    });
  }
  const idOf = (x) => (x && x.id) || {};

  // ── The live stream ────────────────────────────────────────────────────
  const STREAMED = ['status/slide', 'presentation/current', 'presentation/slide_index', 'timers/current', 'messages', 'look/current', 'status/layers', 'transport/presentation/current'];
  let stream = null, retryTimer = null, stopped = false;
  let gen = 0; // each connection's number: an old one's callbacks are ignored
  function connect() {
    clearTimeout(retryTimer);
    if (stopped) return;
    const my = ++gen;
    const lost = (why) => { if (my === gen) dropped(why); };
    const data = Buffer.from(JSON.stringify(STREAMED));
    const req = http.request({ host, port, path: '/v1/status/updates', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, (res) => {
      if (my !== gen) { res.destroy(); return; }
      if (res.statusCode !== 200) { res.resume(); lost(`ProPresenter answered ${res.statusCode}. Is it 7.9 or later?`); return; }
      state.connected = true; state.error = '';
      lastAnswer = Date.now(); // the time without answers starts again
      jp.status(`Connected to ProPresenter at ${host}:${port}`, 'ok');
      refreshLists();
      draw();
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop();
        if (buffer.length > 4e6) buffer = '';
        for (const line of lines) {
          if (!line.trim()) continue;
          if (my !== gen) return;
          try { onUpdate(JSON.parse(line)); } catch (_) { /* a partial line: ignored */ }
        }
      });
      res.on('end', () => lost('ProPresenter closed the connection.'));
      res.on('error', () => lost('The connection to ProPresenter dropped.'));
    });
    req.on('error', (e) => lost(e.code === 'ECONNREFUSED' ? 'ProPresenter isn’t answering. Check it’s open, with Enable Network on, and the port.' : e.code === 'EHOSTUNREACH' || e.code === 'ETIMEDOUT' ? 'Can’t reach the ProPresenter computer. Check its address.' : `Can’t reach ProPresenter (${e.code || e.message}).`));
    req.setTimeout(8000, () => { if (!state.connected) req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })); });
    req.on('socket', (sock) => { try { sock.setKeepAlive(true, 5000); } catch (_) {} });
    req.write(data);
    req.end();
    stream = req;
  }
  function dropped(why) {
    if (stopped) return;
    if (stream) { try { stream.destroy(); } catch (_) {} stream = null; }
    const was = state.connected;
    state.connected = false;
    state.error = why;
    jp.status(why, 'warn');
    if (was || !drawnOnce) draw();
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, 3000);
  }

  function onUpdate(msg) {
    const d = msg && msg.data;
    switch (msg && msg.url) {
      case 'status/slide': case 'status/slide-asked': {
        const was = state.slide && state.slide.current ? state.slide.current : null;
        state.slide = d && typeof d === 'object' ? d : null;
        // The same slide with new words: edited in ProPresenter, so its
        // presentation's pictures are fetched again rather than from the cache
        const now = state.slide && state.slide.current;
        if (was && now && now.uuid === was.uuid && now.text !== was.text && state.slideAt) {
          for (const key of [...pictureCache.keys()]) if (key.startsWith(`p:${state.slideAt.uuid}:`)) pictureCache.delete(key);
          shown.current = shown.next = null;
        }
        break;
      }
      case 'presentation/current':
        state.presentation = (d && d.presentation && idOf(d.presentation).name) || '';
        break;
      case 'timers/current': {
        const timers = readTimers(d);
        if (JSON.stringify(timers) === JSON.stringify(state.timers)) return;
        state.timers = timers;
        break;
      }
      case 'messages':
        state.messages = (Array.isArray(d) ? d : []).map((m) => ({ uuid: idOf(m).uuid, name: idOf(m).name || 'Message', active: m.is_active === true })).filter((m) => m.uuid);
        break;
      case 'look/current':
        state.look = idOf(d).name || '';
        break;
      case 'presentation/slide_index': {
        const at = d && d.presentation_index;
        state.slideAt = at && Number.isInteger(at.index) && at.presentation_id && at.presentation_id.uuid ? { uuid: at.presentation_id.uuid, index: at.index } : null;
        break;
      }
      case 'status/layers':
        state.layers = d && typeof d === 'object' ? d : {};
        break;
      case 'transport/presentation/current':
        state.media = (d && typeof d.name === 'string' && d.name) || '';
        state.mediaUuid = (d && typeof d.uuid === 'string' && d.uuid) || '';
        break;
      default: return;
    }
    // The slide's words and its number come apart (the stream, then the
    // poll): pictures follow both at the end of askSlide, so one move fetches
    // one picture, not one for each half
    if (/layers|transport/.test(msg.url)) refreshPictures();
    // ProPresenter 21.4 sends the slide number once, not when it changes:
    // a new slide (or presentation) is asked for at once
    if (msg.url === 'status/slide' || msg.url === 'presentation/current') askSlide();
    draw();
  }
  // The live slide's number, asked for (see above); and every second, as a
  // change isn't always streamed at all (four times a second: each is a
  // few hundred bytes, answered in about 5 ms)
  // Gone is judged by the time since the last answer, with a 1 s limit on
  // these: counting 12 missed polls took 36 s against a computer that took
  // the connection and never answered (each one waited out 3 s).
  let asking = false, lastAnswer = Date.now();
  const SILENT_MS = 3000;
  async function askSlide() {
    if (asking || !state.connected) return;
    asking = true;
    try {
      const [at, slide] = await Promise.all([call('GET', '/v1/presentation/slide_index', undefined, 1000), call('GET', '/v1/status/slide', undefined, 1000)]);
      lastAnswer = Date.now();
      if (slide && typeof slide === 'object' && JSON.stringify(slide) !== JSON.stringify(state.slide)) onUpdate({ url: 'status/slide-asked', data: slide });
      const now = at && at.presentation_index;
      const key = now && Number.isInteger(now.index) && now.presentation_id ? `${now.presentation_id.uuid}:${now.index}` : '';
      const had = state.slideAt ? `${state.slideAt.uuid}:${state.slideAt.index}` : '';
      if (key !== had) onUpdate({ url: 'presentation/slide_index', data: at });
      refreshPictures(); // nothing to do when neither changed
    } catch (e) {
      // A connection that died without closing (the ProPresenter computer
      // asleep, a cable out) never ends the stream: 3 s of no answers at all
      // is gone. (An error answer, like an older ProPresenter's 404, is an answer.)
      // (One that doesn't know these, answering 404, streams them instead)
      if (e && e.status) { lastAnswer = Date.now(); refreshPictures(); }
      else if (Date.now() - lastAnswer >= SILENT_MS && state.connected) dropped('ProPresenter stopped answering. Check it’s on and on the network.');
    } finally { asking = false; }
  }
  const slideTimer = setInterval(askSlide, 250);

  // ── Pictures of the current and next slide ─────────────────────────────
  // The live slide's and the one after it, from ProPresenter; or the media's
  // while an image or video from the Media bin is on screen. Each is fetched
  // once, when it changes, and handed to JPMixer for the pages.
  const shown = { current: null, next: null }; // what each picture is of: 'p:<uuid>:<index>' | 'm:<uuid>' | null
  const textHash = (text) => { let h = 5381; for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0; return h.toString(36); };
  const pictureCache = new Map(); // the last few pictures: going back a slide, or Next becoming Now, needs no new fetch
  let retryPictures = null;
  function refreshPictures() {
    const want = { current: null, next: null };
    if (state.connected && state.layers.slide && state.slideAt) {
      // With a hash of the slide's words: pictures are kept by position, so
      // a slide inserted or edited before (or as) the next one showed the
      // old slide's picture there
      const words = (s) => textHash(s && typeof s.text === 'string' ? s.text : '');
      want.current = `p:${state.slideAt.uuid}:${state.slideAt.index}:${words(state.slide && state.slide.current)}`;
      if (state.slide && state.slide.next) want.next = `p:${state.slideAt.uuid}:${state.slideAt.index + 1}:${words(state.slide.next)}`;
    } else if (state.connected && state.layers.media && state.mediaUuid) {
      want.current = `m:${state.mediaUuid}`;
    }
    for (const name of ['current', 'next']) {
      const key = want[name];
      if (key === shown[name]) continue;
      shown[name] = key;
      if (!key) { jp.card.image(name, null, { card: 'now' }); continue; }
      const [kind, uuid, index] = key.split(':');
      const path = kind === 'p'
        ? `/v1/presentation/${encodeURIComponent(uuid)}/thumbnail/${index}?quality=480`
        : `/v1/media/${encodeURIComponent(uuid)}/thumbnail?quality=480`;
      const cached = pictureCache.get(key);
      (cached ? Promise.resolve(cached) : getImage(path)).then((img) => {
        if (img) { pictureCache.delete(key); pictureCache.set(key, img); while (pictureCache.size > 8) pictureCache.delete(pictureCache.keys().next().value); }
        if (shown[name] !== key) return; // moved on meanwhile
        jp.card.image(name, img ? img.buf : null, { card: 'now', type: img ? img.type : undefined });
        // Not answered (slow, or an error): asked for again in a moment
        if (!img) { shown[name] = null; clearTimeout(retryPictures); retryPictures = setTimeout(refreshPictures, 2000); }
      });
    }
  }

  const readTimers = (d) => (Array.isArray(d) ? d : []).map((t) => ({ uuid: idOf(t).uuid, name: idOf(t).name || 'Timer', time: String(t.time || ''), state: String(t.state || '') })).filter((t) => t.uuid);
  const refreshTimers = () => get('/v1/timers/current').then((d) => onUpdate({ url: 'timers/current', data: d }), () => {});

  // What isn't streamed: the stage message and timers every 2 s, the lists every 15 s
  let tick = 0;
  async function poll() {
    if (!state.connected) return;
    tick++;
    try {
      const stage = await get('/v1/stage/message');
      const text = typeof stage === 'string' ? stage : '';
      if (text !== state.stage) { state.stage = text; draw(); }
    } catch (_) { /* the stream notices a lost connection */ }
    await refreshTimers();
    if (tick % 8 === 0) refreshLists();
  }
  async function refreshLists() {
    const list = (x) => (Array.isArray(x) ? x : []).map((m) => ({ uuid: idOf(m).uuid, name: idOf(m).name || '' })).filter((m) => m.uuid);
    const [macros, looks, groups, version] = await Promise.all(['/v1/macros', '/v1/looks', '/v1/clear/groups', '/version'].map((p) => get(p).catch(() => undefined)));
    if (macros !== undefined) state.macros = list(macros);
    if (looks !== undefined) state.looks = list(looks);
    if (groups !== undefined) state.clearGroups = list(groups);
    if (version && typeof version === 'object') state.name = String(version.name || '');
    draw();
  }
  const pollTimer = setInterval(poll, 2000);

  // ── The cards ──────────────────────────────────────────────────────────
  let drawnOnce = false;
  const firstLine = (s) => String(s || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  function offline() {
    const note = state.error || 'Connecting to ProPresenter…';
    refreshPictures();
    jp.card.show({ value: 'Not connected', color: 'gray', note }, 'now');
    for (const id of ['timers', 'macros']) jp.card.show({ label: 'ProPresenter isn’t connected.', note }, id);
    jp.card.clear('messages');
  }
  // A timer's time as people read it: 00:04:57 is 4:57, 01:05:00 is 1:05:00
  function shortTime(t) {
    const m = /^(-?)(\d+):(\d{2}):(\d{2})$/.exec(String(t || '').trim());
    if (!m) return String(t || '');
    const h = parseInt(m[2], 10), min = parseInt(m[3], 10);
    return `${m[1]}${h ? `${h}:${m[3]}` : String(min)}:${m[4]}`;
  }
  const running = (t) => t.state === 'running' || t.state === 'overrunning';
  const over = (t) => t.state === 'overrunning' || /^-/.test(t.time);
  // The running ones, for the top of the pages
  let topShape = null;
  function drawTop() {
    const list = timersOnTop && state.connected
      ? state.timers.filter(running).map((t) => ({ name: t.name, time: shortTime(t.time), over: over(t) }))
      : [];
    const shape = JSON.stringify(list);
    if (shape === topShape) return;
    topShape = shape;
    jp.timers.show(list);
  }
  // A timer's row: its time, Start (or Stop) and Reset
  const timerRow = (t) => ({
    label: t.name, value: t.time ? shortTime(t.time) : '—', color: over(t) ? 'red' : running(t) ? 'green' : '',
    buttons: [
      running(t) ? { id: `stop:${t.uuid}`, label: 'Stop', active: true, color: 'green' } : { id: `start:${t.uuid}`, label: 'Start' },
      { id: `reset:${t.uuid}`, label: 'Reset' },
    ],
  });
  // The first few lines of a slide, for under its picture
  const lines = (s, n = 3) => String(s || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, n).join('\n');

  function draw() {
    drawnOnce = true;
    drawTop();
    if (!state.connected) { offline(); return; }
    // ── The controller ──
    const current = state.slide && state.slide.current ? String(state.slide.current.text || '') : '';
    const next = state.slide && state.slide.next ? String(state.slide.next.text || '') : '';
    const slideUp = !!state.layers.slide && !!state.slideAt;
    // An image or video from the Media bin, while it's on screen
    const media = state.layers.media && state.media ? state.media : '';
    const nowCaption = slideUp ? (lines(current) || 'A slide with no text') : media ? media : 'Nothing on screen';
    const info = [];
    if (state.presentation) info.push({ label: 'Presentation', value: short(state.presentation, 40) });
    if (state.look) info.push({ label: 'Look', value: state.look });
    const clearAll = state.clearGroups.find((g) => /clear all/i.test(g.name)) || state.clearGroups[0];
    // Running timers first, up to 4 (the Timers card has them all)
    const timers = [...state.timers.filter(running), ...state.timers.filter((t) => !running(t))].slice(0, 4);
    jp.card.show({
      sections: [
        {
          title: 'On screen',
          images: [
            { name: 'current', label: 'Now', caption: nowCaption },
            { name: 'next', label: 'Next', caption: slideUp ? (lines(next) || (next ? 'A slide with no text' : 'End of the presentation')) : '' },
          ],
          rows: info,
        },
        {
          title: 'Controls',
          buttons: [
            { id: 'prev', label: '‹ Previous' },
            { id: 'next', label: 'Next ›', color: 'blue' },
            { id: 'clear-slide', label: 'Clear slide' },
            ...(media ? [{ id: 'clear-media', label: 'Clear media' }] : []),
            clearAll ? { id: `clear-group:${clearAll.uuid}`, label: short(clearAll.name || 'Clear all', 30), color: 'red' } : { id: 'clear-all', label: 'Clear all', color: 'red' },
          ],
        },
        ...(timers.length ? [{ title: 'Timers', rows: timers.map(timerRow) }] : []),
        {
          title: 'Stage message',
          text: state.stage ? `On stage: ${state.stage}` : '',
          input: { id: 'stage', placeholder: 'Message for the stage screens', button: 'Show' },
          ...(state.stage ? { buttons: [{ id: 'stage-clear', label: 'Clear stage message' }] } : {}),
        },
      ],
      note: state.name ? `ProPresenter on ${state.name}` : '',
    }, 'now');
    // ── Every timer ──
    const all = state.timers.slice(0, 8);
    jp.card.show({ rows: all.map(timerRow), label: all.length ? '' : 'ProPresenter has no timers.' }, 'timers');
    // ── Audience messages, when ProPresenter has some ──
    if (!state.messages.length) jp.card.clear('messages');
    else jp.card.show({
      rows: state.messages.slice(0, 20).map((m) => ({ label: m.name, value: m.active ? 'Showing' : '', color: m.active ? 'green' : '', buttons: [m.active ? { id: `msg:${m.uuid}`, label: 'Hide', active: true } : { id: `msg:${m.uuid}`, label: 'Show' }] })),
      note: 'Each shows with the text it has in ProPresenter.',
    }, 'messages');
    // ── Macros & Looks ──
    const macros = state.macros.slice(0, 16);
    const looks = state.looks.slice(0, 24 - macros.length);
    jp.card.show({
      sections: [
        ...(macros.length ? [{ title: 'Macros', buttons: macros.map((m) => ({ id: `macro:${m.uuid}`, label: short(m.name || 'Macro', 30) })) }] : []),
        ...(looks.length ? [{ title: 'Looks', buttons: looks.map((l) => ({ id: `look:${l.uuid}`, label: short(l.name || 'Look', 30), color: 'blue', active: !!state.look && l.name === state.look })) }] : []),
      ],
      label: macros.length || looks.length ? '' : 'ProPresenter has no macros or Looks.',
    }, 'macros');
  }

  // ── The buttons ────────────────────────────────────────────────────────
  jp.card.onPress(async ({ button, text }) => {
    const [what, id] = button.split(/:(.*)/s);
    const enc = encodeURIComponent(id || '');
    try {
      switch (what) {
        case 'prev': await get('/v1/trigger/previous'); break;
        case 'next': await get('/v1/trigger/next'); break;
        case 'clear-slide': await get('/v1/clear/layer/slide'); break;
        case 'clear-media': await get('/v1/clear/layer/media'); break;
        case 'clear-all': for (const layer of ['slide', 'media', 'announcements', 'props', 'messages']) await get(`/v1/clear/layer/${layer}`); break;
        case 'clear-group': await get(`/v1/clear/group/${enc}/trigger`); break;
        case 'start': case 'stop': case 'reset': await get(`/v1/timer/${enc}/${what}`); await refreshTimers(); break;
        case 'stage': {
          const message = String(text || '').trim();
          if (message) await call('PUT', '/v1/stage/message', message); else await call('DELETE', '/v1/stage/message');
          state.stage = message; draw();
          break;
        }
        case 'stage-clear': await call('DELETE', '/v1/stage/message'); state.stage = ''; draw(); break;
        case 'msg': {
          const m = state.messages.find((x) => x.uuid === id);
          if (m && m.active) await get(`/v1/message/${enc}/clear`); else await call('POST', `/v1/message/${enc}/trigger`, []);
          break;
        }
        case 'macro': await get(`/v1/macro/${enc}/trigger`); break;
        case 'look': await get(`/v1/look/${enc}/trigger`); break;
        default: return;
      }
      console.log(`${button}${text ? ` "${text}"` : ''}: done`);
    } catch (e) {
      console.error(`${button}: ${e.message}`);
      jp.status(`${button}: ${e.message}`, 'warn');
    }
  });

  jp.onSettings((s) => {
    readSettings(s);
    const old = stream;
    stream = null;
    state.connected = false;
    state.error = '';
    draw(); // "Connecting…" until the new address answers, not the old one's cards (and timers at the top)
    connect(); // a new number first, so the old connection's close is ignored
    if (old) { try { old.destroy(); } catch (_) {} }
  });
  jp.onStop(() => {
    stopped = true;
    clearTimeout(retryTimer);
    clearInterval(pollTimer);
    clearInterval(slideTimer);
    clearTimeout(retryPictures);
    if (stream) { try { stream.destroy(); } catch (_) {} }
  });

  draw();
  connect();
};
