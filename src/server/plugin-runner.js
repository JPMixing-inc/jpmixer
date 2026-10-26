'use strict';

// ── One plugin's process ───────────────────────────────────────────────────
// plugins.js starts this in a process of its own for each plugin that's on,
// then sends 'start' with the plugin's file and settings. This loads the
// plugin and hands it `jp`, the only way it talks to JPMixer (see
// docs/PLUGINS.md for what a plugin author sees):
//   jp.plugin              { id, name, version, folder, dataFolder }
//   jp.settings            its settings from Settings → Integrations → Plugins
//   jp.card.show(card)     the FOH Home card; jp.card.clear()
//   jp.status(text, level) the line under it in Settings ('ok' | 'warn' | 'error')
//   jp.console.get()       Promise of the console's names; .onChange(fn)
//   jp.planningCenter.get() Promise of the plan, live and next; .onChange(fn)
//   jp.onStop(fn)          runs before the plugin is stopped
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
const listeners = { console: new Set(), planningCenter: new Set() };
const pending = new Map();  // request id -> { resolve, reject, timer }
let nextId = 1;
let stopping = false;

function needs(permission, what) {
  if (!permissions.includes(permission)) throw new Error(`${what}: add "${permission}" to "permissions" in plugin.json.`);
}

function request(what) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`JPMixer didn’t answer ${what}.get() in time.`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    send({ type: 'request', id, what });
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

function makeApi(info, settings) {
  return Object.freeze({
    plugin: Object.freeze({ ...info }),
    settings: Object.freeze({ ...settings }),
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
  });
}

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  const deadline = new Promise((r) => setTimeout(r, 1500));
  await Promise.race([Promise.allSettled(stopHandlers.map((fn) => Promise.resolve().then(fn))), deadline]);
  if (cardTimer) { clearTimeout(cardTimer); sendCard(); }
  process.exit(code);
}

function fail(err) {
  const message = (err && err.message) || String(err);
  console.error((err && err.stack) || message);
  send({ type: 'status', level: 'error', text: `Stopped: ${message}` });
  setTimeout(() => process.exit(1), 50);
}

process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
process.on('disconnect', () => process.exit(0)); // JPMixer quit

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
    try { Promise.resolve(fn(makeApi(plugin, msg.settings || {}))).catch(fail); } catch (e) { fail(e); }
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
  if (msg.type === 'console' || msg.type === 'planningCenter') {
    for (const fn of listeners[msg.type]) {
      try { Promise.resolve(fn(msg.data)).catch(fail); } catch (e) { fail(e); }
    }
    return;
  }
  if (msg.type === 'stop') stop(0);
});
