'use strict';

// ── Custom Pages: the pages and their rules ─────────────────────────────────
// Kept in the plugin's data folder (pages.json):
//   { pages: [{ id, key, name, enabled, faders: [{ kind, n, max }], mutes,
//               companion, columns, rows }] }
// id names the page (and its Companion surface); key is the secret in its link
// (?k=…), changed with New link. Each fader is a console channel ('ch') or
// control group ('cg') with the highest level the page may set (max, dB).

const crypto = require('crypto');

const MAX_PAGES = 20, MAX_FADERS = 24;
const LEVEL_MIN = -150, LEVEL_MAX = 10; // -150 is off, as on every JPMixer page
const GRID = { columns: [1, 8], rows: [1, 4] };

const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const intIn = (v, lo, hi, dflt) => (Number.isInteger(v) && v >= lo && v <= hi ? v : dflt);
const clampLevel = (db) => Math.max(LEVEL_MIN, Math.min(LEVEL_MAX, db));

const newId = () => crypto.randomBytes(5).toString('hex');            // 10 hex characters
const newKey = () => crypto.randomBytes(18).toString('base64url');     // 24 characters
const ID_RE = /^[0-9a-f]{10}$/, KEY_RE = /^[A-Za-z0-9_-]{24}$/;

function cleanFader(f) {
  if (!f || typeof f !== 'object') return null;
  const kind = f.kind === 'cg' ? 'cg' : f.kind === 'ch' ? 'ch' : null;
  const n = intIn(f.n, 1, 256, null);
  if (!kind || !n) return null;
  const max = typeof f.max === 'number' && Number.isFinite(f.max) ? Math.round(clampLevel(f.max) * 10) / 10 : 0;
  return { kind, n, max };
}

// A page as an editor sent it, tidied. `before` is the saved page it replaces,
// whose id and key it keeps (the editor never chooses a key)
function cleanPage(p, before) {
  if (!p || typeof p !== 'object') return null;
  const seen = new Set();
  const faders = [];
  for (const f of (Array.isArray(p.faders) ? p.faders : []).slice(0, MAX_FADERS)) {
    const fader = cleanFader(f);
    if (!fader || seen.has(`${fader.kind}:${fader.n}`)) continue; // each strip once
    seen.add(`${fader.kind}:${fader.n}`);
    faders.push(fader);
  }
  return {
    id: before ? before.id : newId(),
    key: before ? before.key : newKey(),
    name: str(p.name, 40) || 'Custom page',
    enabled: p.enabled !== false,
    faders,
    mutes: p.mutes === true,
    companion: p.companion === true,
    columns: intIn(p.columns, ...GRID.columns, 4),
    rows: intIn(p.rows, ...GRID.rows, 2),
  };
}

// What was saved, checked again as it's read (a hand-edited file can't break it)
function cleanStore(raw) {
  const pages = [];
  const ids = new Set(), keys = new Set();
  for (const p of (raw && Array.isArray(raw.pages) ? raw.pages : []).slice(0, MAX_PAGES)) {
    if (!p || !ID_RE.test(String(p.id)) || !KEY_RE.test(String(p.key)) || ids.has(p.id) || keys.has(p.key)) continue;
    const page = cleanPage(p, { id: p.id, key: p.key });
    ids.add(page.id); keys.add(page.key);
    pages.push(page);
  }
  return { pages };
}

// The page a link opens: only an enabled one, with the key compared in
// constant time
function pageForKey(store, key) {
  if (typeof key !== 'string' || !KEY_RE.test(key)) return null;
  const want = Buffer.from(key);
  for (const p of store.pages) {
    const have = Buffer.from(p.key);
    if (have.length === want.length && crypto.timingSafeEqual(have, want)) return p.enabled ? p : null;
  }
  return null;
}

// The level a move may set. At or under the cap it goes as asked. Above it,
// only when the console already has the fader above the cap (the engineer put
// it there): then it can come down, but never go back up. Otherwise it stops
// at the cap. null for something that isn't a level.
function allowedLevel(cap, current, wanted) {
  if (typeof wanted !== 'number' || !Number.isFinite(wanted)) return null;
  const db = clampLevel(wanted);
  if (db <= cap) return db;
  if (typeof current === 'number' && Number.isFinite(current) && current > cap) return Math.min(db, current);
  return cap;
}

module.exports = { cleanPage, cleanStore, cleanFader, pageForKey, allowedLevel, newKey, MAX_PAGES, MAX_FADERS, LEVEL_MIN, LEVEL_MAX, GRID, ID_RE };
