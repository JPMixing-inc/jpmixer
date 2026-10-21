'use strict';

// ── Saved Home page layouts, per team member ────────────────────────────────
// Each Home page (FOH, ProPresenter, Lighting, Switcher) can save its card
// arrangement for the person Planning Center has scheduled on it (the Save
// layout button, see foh.js). That person's layout then loads on any device
// they open the page on. Stored on this computer in home-layouts.json:
//   { [role]: { [personId]: { name, savedAt, layout } } }
// Layouts are only arrangement data — which cards, their order and sizes —
// and are checked here against the same limits the page uses (foh-layout.js).

const path = require('path');
const { app } = require('electron');
const { writeFileAtomic, loadJsonObject } = require('./safe-write');
const { toNullProto } = require('./safe-object');

const ROLES = new Set(['foh', 'propresenter', 'lighting', 'switcher']);
const SIZES = new Set(['compact', 'standard', 'wide', 'full']);
const HEIGHTS = new Set(['auto', 'short', 'tall']);
const CARD_ID = /^[a-z][a-z0-9_-]{0,31}$/;
const PERSON_ID = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_CARDS = 24;

let store = Object.create(null);
let loaded = false;
const file = () => path.join(app.getPath('userData'), 'home-layouts.json');

// Read on first use, so the checks below (clean, cleanAll, count) also work
// where there's no Electron app, e.g. when Restore inspects a backup file
function load() {
  if (loaded) return;
  loaded = true;
  const data = loadJsonObject(file(), app.getPath('userData'), 'homeLayouts', (msg) => console.error('[JPMixer] ' + msg));
  if (data) store = toNullProto(data);
}

const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

// A clean copy of a layout, or null if it isn't one. Version 2 (the free
// grid) places each card itself: x/w in 24 columns, y/h in 10 px rows. The
// older version (an order plus size presets) is still accepted.
function clean(layout) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return null;
  if (layout.v === 2) {
    const cards = {};
    const source = layout.cards && typeof layout.cards === 'object' && !Array.isArray(layout.cards) ? layout.cards : {};
    for (const [id, c] of Object.entries(source).slice(0, MAX_CARDS)) {
      if (!CARD_ID.test(id) || !c || typeof c !== 'object') continue;
      if (!int(c.w, 4, 24) || !int(c.x, 0, 24 - c.w) || !int(c.y, 0, 5000) || !int(c.h, 12, 160)) continue;
      cards[id] = { hidden: c.hidden === true, x: c.x, y: c.y, w: c.w, h: c.h };
    }
    return Object.keys(cards).length ? { v: 2, cards } : null;
  }
  const order = Array.isArray(layout.order) ? [...new Set(layout.order.filter(id => typeof id === 'string' && CARD_ID.test(id)))].slice(0, MAX_CARDS) : [];
  const cards = {};
  const source = layout.cards && typeof layout.cards === 'object' && !Array.isArray(layout.cards) ? layout.cards : {};
  for (const [id, card] of Object.entries(source).slice(0, MAX_CARDS)) {
    if (!CARD_ID.test(id) || !card || typeof card !== 'object') continue;
    cards[id] = {
      hidden: card.hidden === true,
      size: SIZES.has(card.size) ? card.size : 'standard',
      height: HEIGHTS.has(card.height) ? card.height : 'auto',
      span: Number.isInteger(card.span) && card.span >= 3 && card.span <= 12 ? card.span : null,
      pixels: Number.isInteger(card.pixels) && card.pixels >= 120 && card.pixels <= 720 ? card.pixels : null,
    };
  }
  if (!order.length && !Object.keys(cards).length) return null;
  return { order, cards };
}

function get(role, personId) {
  load();
  if (!ROLES.has(role) || !PERSON_ID.test(String(personId || ''))) return null;
  return (store[role] && store[role][personId]) || null;
}

// The layout to show `personId` on `role`: theirs for that page, or else the
// one they saved most recently on another Home page (the cards they share
// keep their sizes and order; the page's own extra cards go at the end).
// fromRole says which page it came from.
function forPerson(role, personId) {
  const own = get(role, personId);
  if (own) return { ...own, fromRole: role };
  if (!ROLES.has(role) || !PERSON_ID.test(String(personId || ''))) return null;
  load();
  let best = null;
  for (const other of ROLES) {
    if (other === role) continue;
    const entry = store[other] && store[other][personId];
    if (entry && (!best || String(entry.savedAt) > String(best.savedAt))) best = { ...entry, fromRole: other };
  }
  return best;
}

// For backups: every saved layout, and taking them back in. A restore adds
// the backup's layouts, replacing the same person on the same page and
// keeping everyone else; anything that isn't a valid layout is skipped.
function getAll() { load(); return JSON.parse(JSON.stringify(store)); }
function count(data) {
  if (data === undefined) { load(); data = store; }
  let layouts = 0;
  const people = new Set();
  for (const byPerson of Object.values(data || {})) for (const person of Object.keys(byPerson || {})) { layouts++; people.add(person); }
  return { layouts, people: people.size };
}
function cleanAll(data) {
  const out = Object.create(null); // person ids come from backup files: no prototype to reach
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
  for (const [role, byPerson] of Object.entries(data)) {
    if (!ROLES.has(role) || !byPerson || typeof byPerson !== 'object') continue;
    for (const [person, entry] of Object.entries(byPerson)) {
      const layout = PERSON_ID.test(person) && entry && clean(entry.layout);
      if (!layout) continue;
      (out[role] ||= Object.create(null))[person] = { name: String(entry.name || '').slice(0, 80), savedAt: typeof entry.savedAt === 'string' ? entry.savedAt : new Date().toISOString(), layout };
    }
  }
  return out;
}
function importAll(data) {
  load();
  const incoming = cleanAll(data);
  const previous = store;
  const next = toNullProto(JSON.parse(JSON.stringify(store)));
  for (const [role, byPerson] of Object.entries(incoming)) {
    next[role] = next[role] || Object.create(null);
    for (const [person, entry] of Object.entries(byPerson)) next[role][person] = toNullProto(entry);
  }
  store = next;
  try {
    writeFileAtomic(file(), JSON.stringify(store, null, 2));
    return true;
  } catch (e) {
    console.error('[JPMixer] Home layout restore error:', e);
    store = previous;
    return false;
  }
}
// Puts back exactly what was there before (a failed restore's rollback)
function replaceAll(data) {
  load();
  const previous = store;
  store = toNullProto(cleanAll(data));
  try { writeFileAtomic(file(), JSON.stringify(store, null, 2)); return true; }
  catch (e) { store = previous; return false; }
}

function set(role, personId, name, layout) {
  const tidy = clean(layout);
  if (!ROLES.has(role) || !PERSON_ID.test(String(personId || '')) || !tidy) return false;
  load();
  const previous = store[role];
  store[role] = Object.assign(Object.create(null), previous);
  store[role][personId] = { name: String(name || '').slice(0, 80), savedAt: new Date().toISOString(), layout: tidy };
  try {
    writeFileAtomic(file(), JSON.stringify(store, null, 2));
    return true;
  } catch (e) {
    console.error('[JPMixer] Home layout save error:', e);
    if (previous) store[role] = previous; else delete store[role];
    return false;
  }
}

module.exports = { get, set, clean, forPerson, getAll, count, cleanAll, importAll, replaceAll };
