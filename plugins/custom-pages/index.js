'use strict';

// Custom Pages: link-only pages for a youth night or an event, each with the
// channel and control group faders that group needs, every one with its own
// highest level, so nobody on the page can push a fader past it. Optional
// mute buttons, and a Companion card: its own surface in Companion, through
// the Companion buttons plugin (jp.companion), which has the connection.
//
// The pages are set up in JPMixer's Settings, in this plugin's tab (Settings
// is on the JPMixer computer, and calls with from.local), kept in this
// plugin's data folder (pages.json, see pages.js), and each is
// opened from its link (?k=…). The level caps are checked here, in the
// plugin: what the page asks for is only ever a wish.
//
// The page calls:
//   open  { key }            → { mode: 'event', page } | 'gone' | 'nolink' | 'editor'
//   state { key, since }     → its faders' levels, the console's status, and
//                              the Companion buttons changed since `since`
//   move  { key, kind, n, level } → { db } the level set, within the cap
//   mute  { key, kind, n, muted } (pages with mute buttons)
//   press { key, index, pressed } (pages with a Companion card)
// and, from Settings on the JPMixer computer only (from.local):
//   editor → { pages, console, base, companion }
//   save { page } / remove { id } / newLink { id } → { pages }

const fs = require('fs');
const path = require('path');
const pages = require('./pages');

module.exports = async (jp) => {
  const file = path.join(jp.plugin.dataFolder, 'pages.json');
  let store = { pages: [] };
  try { store = pages.cleanStore(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { if (e.code !== 'ENOENT') console.error('pages.json couldn’t be read; starting with no pages:', e.message); }
  function persist(next) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, file);
    store = next;
    afterChange();
  }

  // The console's names (jp.console) and the faders' levels (jp.faders)
  let names = { channels: [], groups: [], type: '', connected: false };
  let levels = { supported: false, connected: false, ch: {}, cg: {} };
  const wanted = () => store.pages.filter((p) => p.enabled).flatMap((p) => p.faders.map((f) => ({ kind: f.kind, n: f.n })));
  async function refreshLevels() { try { levels = await jp.faders.get(wanted()); } catch (_) { /* kept as it was */ } }
  jp.faders.onChange((data) => { if (data) levels = data; });
  jp.console.onChange((data) => { if (data) names = data; });
  try { names = await jp.console.get(); } catch (_) { /* filled in by onChange */ }
  await refreshLevels();

  const nameOf = (kind, n) => {
    const list = kind === 'cg' ? names.groups : names.channels;
    const hit = (list || []).find((x) => x.number === n);
    return (hit && hit.name) || (kind === 'cg' ? `Control group ${n}` : `Channel ${n}`);
  };
  const strip = (kind, n) => ((levels[kind] || {})[n]) || {};
  // The level this plugin set last, for 2 s: the console's report of an
  // earlier level can still be on its way, and mustn't let a fader that was
  // brought under the cap go back up past it
  const recent = new Map(); // "kind:n" -> { db, at }
  const RECENT_MS = 2000;
  const currentLevel = (kind, n) => {
    const mine = recent.get(`${kind}:${n}`);
    if (mine && Date.now() - mine.at < RECENT_MS) return mine.db;
    const db = strip(kind, n).db;
    return typeof db === 'number' ? db : null;
  };

  function showStatus() {
    const count = store.pages.filter((p) => p.enabled).length;
    jp.status(`${count} custom page${count === 1 ? '' : 's'} on`);
  }
  // Each page with its Companion card on is a surface in the Companion
  // buttons plugin (asked for again whenever the pages change)
  const surfaces = () => store.pages.filter((p) => p.enabled && p.companion).map((p) => ({ id: p.id, name: p.name, columns: p.columns, rows: p.rows }));
  function afterChange() {
    jp.companion.surfaces(surfaces()).catch(() => {});
    refreshLevels();
    showStatus();
  }
  jp.onSettings(() => showStatus());
  afterChange();
  jp.onStop(() => jp.companion.surfaces([]).catch(() => {}));

  // ── The custom page ──
  const pageOf = (body) => {
    const page = pages.pageForKey(store, body && body.key);
    if (!page) throw new Error('This link doesn’t work any more. Ask the engineer for the page’s new link.');
    return page;
  };
  const faderOf = (page, body) => {
    const f = page.faders.find((x) => x.kind === (body && body.kind) && x.n === (body && body.n));
    if (!f) throw new Error('That fader isn’t on this page.');
    return f;
  };
  const customView = (page) => ({
    name: page.name,
    mutes: page.mutes,
    companion: page.companion,
    faders: page.faders.map((f) => ({ kind: f.kind, n: f.n, name: nameOf(f.kind, f.n), max: f.max })),
  });
  const consoleView = () => ({ supported: !!levels.supported, connected: !!levels.connected });

  jp.page.handle('open', (body, from) => {
    if (body && body.key) {
      const page = pages.pageForKey(store, body.key);
      return page ? { mode: 'event', page: customView(page), console: consoleView() } : { mode: 'gone' };
    }
    return { mode: from && from.local ? 'editor' : 'nolink' };
  });

  jp.page.handle('state', async (body) => {
    const page = pages.pageForKey(store, body && body.key);
    if (!page) return { gone: true };
    const since = Number.isInteger(body.since) && body.since >= 0 ? body.since : 0;
    let companion = null;
    if (page.companion) { try { companion = await jp.companion.view(page.id, since); } catch (_) { companion = { live: false, note: 'Companion buttons aren’t available right now.', keys: [], full: false, columns: page.columns, rows: page.rows, rev: since }; } }
    return {
      console: consoleView(),
      faders: page.faders.map((f) => {
        const s = strip(f.kind, f.n);
        return { kind: f.kind, n: f.n, name: nameOf(f.kind, f.n), db: typeof s.db === 'number' ? s.db : null, mute: typeof s.mute === 'boolean' ? s.mute : null };
      }),
      companion,
    };
  });

  jp.page.handle('move', async (body) => {
    const page = pageOf(body);
    const f = faderOf(page, body);
    const db = pages.allowedLevel(f.max, currentLevel(f.kind, f.n), body.level);
    if (db === null) throw new Error('That isn’t a level.');
    recent.set(`${f.kind}:${f.n}`, { db, at: Date.now() });
    const ok = await jp.faders.set({ kind: f.kind, number: f.n, level: db });
    if (!ok) throw new Error('The console isn’t taking fader moves right now.');
    levels = { ...levels, [f.kind]: { ...(levels[f.kind] || {}), [f.n]: { ...strip(f.kind, f.n), db } } };
    return { db };
  });

  jp.page.handle('mute', async (body) => {
    const page = pageOf(body);
    if (!page.mutes) throw new Error('This page has no mute buttons.');
    const f = faderOf(page, body);
    const muted = body.muted === true;
    const ok = await jp.faders.set({ kind: f.kind, number: f.n, muted });
    if (!ok) throw new Error('The console isn’t taking mutes right now.');
    levels = { ...levels, [f.kind]: { ...(levels[f.kind] || {}), [f.n]: { ...strip(f.kind, f.n), mute: muted } } };
    return { muted };
  });

  jp.page.handle('press', async (body) => {
    const page = pageOf(body);
    if (!page.companion) throw new Error('This page has no Companion buttons.');
    return { sent: await jp.companion.press(page.id, Number(body.index), body.pressed === true) };
  });

  // ── The editor: on this computer only ──
  const editorOnly = (from) => { if (!(from && from.local)) throw new Error('Custom Pages are set up on the JPMixer computer, from Settings → Plugins → Custom Pages.'); };
  const editorView = async (from) => ({
    pages: store.pages,
    console: {
      type: names.type || levels.type || '',
      connected: !!levels.connected,
      supported: !!levels.supported,
      channels: (names.channels || []).map((c) => ({ number: c.number, name: c.name || '' })),
      groups: (names.groups || []).map((g) => ({ number: g.number, name: g.name || '' })),
    },
    base: (from && from.base) || '',
    companion: await jp.companion.status().catch(() => ({ state: 'off', message: 'Companion buttons aren’t available right now.' })),
    defaultMax: typeof jp.settings.defaultMax === 'number' ? jp.settings.defaultMax : 0,
    limits: { pages: pages.MAX_PAGES, faders: pages.MAX_FADERS, min: pages.LEVEL_MIN, max: pages.LEVEL_MAX, grid: pages.GRID },
  });
  jp.page.handle('editor', (_body, from) => { editorOnly(from); return editorView(from); });
  jp.page.handle('save', async (body, from) => {
    editorOnly(from);
    const given = body && body.page;
    const before = given && given.id ? store.pages.find((p) => p.id === given.id) : null;
    if (given && given.id && !before) throw new Error('That page was removed. Reload to see the pages as they are.');
    if (!before && store.pages.length >= pages.MAX_PAGES) throw new Error(`There can be up to ${pages.MAX_PAGES} custom pages.`);
    const page = pages.cleanPage(given, before);
    if (!page) throw new Error('That page couldn’t be saved.');
    persist({ pages: before ? store.pages.map((p) => (p.id === page.id ? page : p)) : [...store.pages, page] });
    return { ...(await editorView(from)), saved: page.id };
  });
  jp.page.handle('remove', (body, from) => {
    editorOnly(from);
    persist({ pages: store.pages.filter((p) => p.id !== (body && body.id)) });
    return editorView(from);
  });
  // A new secret for a page's link: the old link stops working at once
  jp.page.handle('newLink', (body, from) => {
    editorOnly(from);
    if (!store.pages.some((p) => p.id === (body && body.id))) throw new Error('That page was removed.');
    persist({ pages: store.pages.map((p) => (p.id === body.id ? { ...p, key: pages.newKey() } : p)) });
    return editorView(from);
  });
};
