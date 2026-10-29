'use strict';

// ── One plugin's process ───────────────────────────────────────────────────
// plugins.js starts this in a process of its own for each plugin that's on,
// then sends 'start' with the plugin's file and settings. This loads the
// plugin and hands it `jp`, the only way it talks to JPMixer (see
// docs/PLUGINS.md for what a plugin author sees):
//   jp.plugin              { id, name, version, folder, dataFolder }
//   jp.settings            its settings from Settings → Plugins
//   jp.card.show(card)     the FOH Home card; jp.card.clear()
//   jp.status(text, level) the line under it in Settings ('ok' | 'warn' | 'error')
//   jp.console.get()       Promise of the console's names; .onChange(fn)
//   jp.planningCenter.get() Promise of the plan, live and next; .onChange(fn)
//   jp.page.handle(name, fn)  answers its page's call `name` ("page" permission);
//                          fn(body, { local, base }) — local: opened on this
//                          computer (JPMixer, or a browser opened from Settings);
//                          base then: the address phones use, as Settings shows it
//   jp.onSettings(fn)      new settings without a restart (fn gets them; jp.settings follows)
//   jp.onStop(fn)          runs before the plugin is stopped
// Official plugins with the "integration" permission (Shure, Smaart,
// Companion) also feed JPMixer's own pages:
//   jp.integration.handle(name, fn)  answers JPMixer's own call `name`
//   jp.integration.share(event, data) sends `event` to JPMixer (in batches, every 25 ms)
// Official plugins with "faders" (Custom Pages) move the console's channel and
// control group faders and mutes, as the Console Controller does:
//   jp.faders.get(want)    Promise of { supported, type, connected, ch: { n: { db, mute } }, cg }
//                          (want [{ kind, n }]: strips to ask the console for)
//   jp.faders.onChange(fn) the same, when it changes
//   jp.faders.set({ kind: 'ch' | 'cg', number, level })  or  { kind, number, muted }
// and, with "companion", Companion buttons through the Companion buttons plugin:
//   jp.companion.surfaces([{ id, name, columns, rows }])  one surface per page
//   jp.companion.view(id, since)  its buttons changed since `since`, and how it's doing
//   jp.companion.press(id, index, pressed)   jp.companion.status()
// Anything it logs (console.log) shows in its log in Settings. An error it
// doesn't catch stops it; plugins.js starts it again.

// WASI reaches files without going through Node's permission checks (Node
// 20, the version inside JPMixer, doesn't cover it), so a plugin could read
// past its folder with it. It's switched off before any plugin code loads,
// for require('wasi') and import('node:wasi') alike.
{
  const wasi = require('wasi');
  class WASI { constructor() { throw new Error('WASI isn’t available to JPMixer plugins.'); } }
  Object.defineProperty(wasi, 'WASI', { value: WASI, writable: false, configurable: false, enumerable: true });
  require('module').syncBuiltinESMExports();
  Object.freeze(wasi);
}

const send = (msg) => { try { if (process.connected) process.send(msg); } catch (_) {} };

let plugin = null;          // jp.plugin
let permissions = [];
const stopHandlers = [];
const pageHandlers = new Map(); // call name -> fn(body)
const integrationHandlers = new Map(); // JPMixer's own call name -> fn(body)
const settingsHandlers = [];
let currentSettings = Object.freeze({});
const listeners = { console: new Set(), planningCenter: new Set(), faders: new Set() };
const pending = new Map();  // request id -> { resolve, reject, timer }
let nextId = 1;
let stopping = false;

function needs(permission, what) {
  if (!permissions.includes(permission)) throw new Error(`${what}: add "${permission}" to "permissions" in plugin.json.`);
}

function request(what, extra = {}, type = 'request') {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`JPMixer didn’t answer ${what} in time.`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    send({ type, id, what, ...extra });
  });
}

// The card: at most four updates a second reach JPMixer, always the latest
let cardTimer = null, cardWaiting = null, cardLast = 0;
function sendCard() {
  cardTimer = null;
  cardLast = Date.now();
  send(cardWaiting);
  cardWaiting = null;
}
function queueCard(msg) {
  cardWaiting = msg;
  if (cardTimer) return;
  const wait = Math.max(0, 250 - (Date.now() - cardLast));
  cardTimer = setTimeout(sendCard, wait);
}

function source(what, permission, label) {
  return {
    get() { needs(permission, `${label}.get()`); return request(what); },
    onChange(fn) {
      needs(permission, `${label}.onChange()`);
      if (typeof fn !== 'function') throw new TypeError(`${label}.onChange() needs a function.`);
      listeners[what].add(fn);
      return () => listeners[what].delete(fn);
    },
  };
}

// Shared events go in batches: everything shared in the last 25 ms in one
// message, in order (a Companion page change is a burst of key images, and
// none can be skipped)
const SHARE_BATCH_MS = 25, SHARE_BATCH_MAX = 500;
const shareQueue = [];
let shareTimer = null;
function pumpShares() {
  shareTimer = null;
  while (shareQueue.length) send({ type: 'shares', list: shareQueue.splice(0, SHARE_BATCH_MAX) });
}

function makeApi(info, settings) {
  currentSettings = Object.freeze({ ...settings });
  return Object.freeze({
    plugin: Object.freeze({ ...info }),
    get settings() { return currentSettings; },
    onSettings(fn) {
      if (typeof fn !== 'function') throw new TypeError('jp.onSettings() needs a function.');
      settingsHandlers.push(fn);
      send({ type: 'settings-live' }); // JPMixer sends new settings here instead of restarting it
    },
    card: Object.freeze({
      show(card) {
        needs('card', 'jp.card.show()');
        if (!card || typeof card !== 'object') throw new TypeError('jp.card.show() needs an object, like { value: "12", label: "minutes" }.');
        queueCard({ type: 'card', card: JSON.parse(JSON.stringify(card)) });
      },
      clear() { queueCard({ type: 'card-clear' }); },
    }),
    status(text, level = 'ok') { send({ type: 'status', text: String(text ?? ''), level }); },
    console: Object.freeze(source('console', 'console', 'jp.console')),
    planningCenter: Object.freeze(source('planningCenter', 'planningCenter', 'jp.planningCenter')),
    onStop(fn) { if (typeof fn === 'function') stopHandlers.push(fn); },
    companion: Object.freeze({
      surfaces(list) { needs('companion', 'jp.companion.surfaces()'); return request('jp.companion', { op: 'surfaces', body: { list: JSON.parse(JSON.stringify(Array.isArray(list) ? list : [])) } }, 'companion-call'); },
      view(id, since) { needs('companion', 'jp.companion.view()'); return request('jp.companion', { op: 'view', body: { id: String(id), since: Number(since) || 0 } }, 'companion-call'); },
      press(id, index, pressed) { needs('companion', 'jp.companion.press()'); return request('jp.companion', { op: 'press', body: { id: String(id), index: Number(index), pressed: pressed === true } }, 'companion-call'); },
      status() { needs('companion', 'jp.companion.status()'); return request('jp.companion', { op: 'status', body: {} }, 'companion-call'); },
    }),
    faders: Object.freeze({
      get(want) {
        needs('faders', 'jp.faders.get()');
        const list = Array.isArray(want) ? want.slice(0, 64).map((w) => ({ kind: w && w.kind, n: w && w.n })) : undefined;
        return request('faders', list ? { want: list } : {});
      },
      onChange(fn) {
        needs('faders', 'jp.faders.onChange()');
        if (typeof fn !== 'function') throw new TypeError('jp.faders.onChange() needs a function.');
        listeners.faders.add(fn);
        return () => listeners.faders.delete(fn);
      },
      set(change) {
        needs('faders', 'jp.faders.set()');
        const c = change && typeof change === 'object' ? change : {};
        const what = c.level !== undefined ? 'fader' : c.muted !== undefined ? 'mute' : null;
        if (!what) throw new TypeError('jp.faders.set() needs { kind, number, level } or { kind, number, muted }.');
        return request('jp.faders.set()', { change: { kind: c.kind, number: c.number, what, value: what === 'fader' ? Number(c.level) : c.muted === true } }, 'fader-set');
      },
    }),
    integration: Object.freeze({
      handle(name, fn) {
        needs('integration', 'jp.integration.handle()');
        if (!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(String(name))) throw new TypeError('jp.integration.handle() needs a name of letters, numbers, _ and -.');
        if (typeof fn !== 'function') throw new TypeError('jp.integration.handle() needs a function.');
        integrationHandlers.set(String(name), fn);
      },
      share(event, data) {
        needs('integration', 'jp.integration.share()');
        if (!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(String(event))) throw new TypeError('jp.integration.share() needs an event name of letters, numbers, _ and -.');
        // Far too many at once: they're dropped, and JPMixer is told to ask for
        // everything again (a Companion key can't be skipped)
        if (shareQueue.length >= 5000) shareQueue.splice(0, shareQueue.length, { event: 'overflow', data: null });
        shareQueue.push({ event: String(event), data: data === undefined ? null : JSON.parse(JSON.stringify(data)) });
        if (!shareTimer) shareTimer = setTimeout(pumpShares, SHARE_BATCH_MS);
      },
    }),
    page: Object.freeze({
      // What the plugin's page gets back from a call: fn(body) → any JSON
      handle(name, fn) {
        needs('page', 'jp.page.handle()');
        if (!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(String(name))) throw new TypeError('jp.page.handle() needs a name of letters, numbers, _ and -.');
        if (typeof fn !== 'function') throw new TypeError('jp.page.handle() needs a function.');
        pageHandlers.set(String(name), fn);
      },
    }),
  });
}

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  const deadline = new Promise((r) => setTimeout(r, 1500));
  await Promise.race([Promise.allSettled(stopHandlers.map((fn) => Promise.resolve().then(fn))), deadline]);
  if (cardTimer) { clearTimeout(cardTimer); sendCard(); }
  if (shareTimer) { clearTimeout(shareTimer); pumpShares(); }
  // Out only once JPMixer has had everything (what the Shure plugin saves as it stops)
  const out = () => process.exit(code);
  if (!process.connected) { out(); return; }
  setTimeout(out, 300).unref();
  try { process.send({ type: 'bye' }, out); } catch (_) { out(); }
}

function fail(err) {
  const message = (err && err.message) || String(err);
  console.error((err && err.stack) || message);
  send({ type: 'status', level: 'error', text: `Stopped: ${message}` });
  setTimeout(() => process.exit(1), 50);
}

process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
process.on('disconnect', () => stop(0)); // JPMixer quit: its stop handlers still run (closing connections)

// Page calls wait until the plugin has started (its main function has
// returned, or 2 s have passed: a plugin may keep running in it), so one that
// arrives while it's still setting up isn't told the plugin doesn't answer
let started = false;
const startWaiters = [];
const whenStarted = () => (started ? Promise.resolve() : new Promise((resolve) => startWaiters.push(resolve)));
function markStarted() { if (started) return; started = true; for (const resolve of startWaiters.splice(0)) resolve(); }

process.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'start' && !plugin) {
    plugin = msg.plugin;
    permissions = Array.isArray(msg.permissions) ? msg.permissions : [];
    let main;
    try { main = require(msg.entry); } catch (e) { fail(e); return; }
    const fn = typeof main === 'function' ? main : main && typeof main.default === 'function' ? main.default : null;
    if (!fn) { fail(new Error(`${plugin.id}: its main file must export a function, like module.exports = (jp) => { … }.`)); return; }
    send({ type: 'status', level: 'ok', text: 'Running' });
    setTimeout(markStarted, 2000).unref();
    try { Promise.resolve(fn(makeApi(plugin, msg.settings || {}))).catch(fail).finally(markStarted); } catch (e) { markStarted(); fail(e); }
    return;
  }
  if (msg.type === 'reply') {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error)); else p.resolve(msg.result);
    return;
  }
  if (msg.type === 'console' || msg.type === 'planningCenter' || msg.type === 'faders') {
    for (const fn of listeners[msg.type]) {
      try { Promise.resolve(fn(msg.data)).catch(fail); } catch (e) { fail(e); }
    }
    return;
  }
  if (msg.type === 'page-call') {
    const reply = (out) => send({ type: 'page-reply', id: msg.id, ...out });
    // An error thrown here goes back to the page, and doesn't stop the plugin
    whenStarted().then(() => {
      const fn = pageHandlers.get(msg.name);
      if (!fn) throw Object.assign(new Error(`This plugin doesn’t answer "${String(msg.name)}".`), { quiet: true });
      const local = !!(msg.from && msg.from.local === true);
      return fn(msg.body, Object.freeze({ local, base: local && msg.from && typeof msg.from.base === 'string' ? msg.from.base : '' }));
    })
      .then((result) => { try { reply({ result: result === undefined ? null : JSON.parse(JSON.stringify(result)) }); } catch (e) { reply({ error: 'The plugin’s answer wasn’t JSON.' }); } })
      .catch((e) => { if (!(e && e.quiet)) console.error((e && e.stack) || e); reply({ error: (e && e.message) || String(e) }); });
    return;
  }
  // JPMixer's own call (an official integration): answered like a page's
  if (msg.type === 'integration-call') {
    const reply = (out) => send({ type: 'integration-reply', id: msg.id, ...out });
    whenStarted().then(() => {
      const fn = integrationHandlers.get(msg.name);
      if (!fn) throw Object.assign(new Error(`This plugin doesn’t answer "${String(msg.name)}".`), { quiet: true });
      return fn(msg.body);
    })
      .then((result) => { try { reply({ result: result === undefined ? null : JSON.parse(JSON.stringify(result)) }); } catch (e) { reply({ error: 'The plugin’s answer wasn’t JSON.' }); } })
      .catch((e) => { if (!(e && e.quiet)) console.error((e && e.stack) || e); reply({ error: (e && e.message) || String(e) }); });
    return;
  }
  if (msg.type === 'settings') {
    currentSettings = Object.freeze({ ...(msg.settings || {}) });
    for (const fn of settingsHandlers) {
      try { Promise.resolve(fn(currentSettings)).catch(fail); } catch (e) { fail(e); }
    }
    return;
  }
  if (msg.type === 'stop') stop(0);
});
