'use strict';

// ── The Home pages, in one place ───────────────────────────────────────────
// JPMixer's own Home pages (FOH, ProPresenter, Lighting, Switcher, Producer)
// and the ones a church adds (Settings → Planning Center → Home pages: a
// Stage Manager or Camera page, say). Each welcomes whoever Planning Center
// has scheduled in the role picked for it. Everything that lists the Home
// pages reads them here: the pages and their data (foh.js), team chat,
// saved layouts, Companion surfaces, the second service (pco-services.js)
// and the station picker.
//
// A custom page is { id: 10 hex characters, name, position, team } in the
// config's pcoHomePages; its role id is "hp-<id>" and it's served at
// /hp-<id>.html (role.html, like ProPresenter Home). The id stays the same
// when the page is renamed, so links, layouts and Companion pages keep.

const BUILT_IN = {
  foh:          { label: 'FOH Engineer', page: 'FOH Engineer Home', short: 'FOH', positionKey: 'pcoFohPositionName', teamKey: 'pcoFohTeamId' },
  propresenter: { label: 'ProPresenter', page: 'ProPresenter Home', short: 'ProPresenter', positionKey: 'pcoProPresenterPositionName', teamKey: 'pcoProPresenterTeamId' },
  lighting:     { label: 'Lighting', page: 'Lighting Home', short: 'Lighting', positionKey: 'pcoLightingPositionName', teamKey: 'pcoLightingTeamId' },
  switcher:     { label: 'Switcher', page: 'Switcher Home', short: 'Switcher', positionKey: 'pcoSwitcherPositionName', teamKey: 'pcoSwitcherTeamId' },
  producer:     { label: 'Producer', page: 'Producer Home', short: 'Producer', positionKey: 'pcoProducerPositionName', teamKey: 'pcoProducerTeamId' },
};
const MAX_CUSTOM = 12;
const CUSTOM_ID = /^[0-9a-f]{10}$/;
// Any Home page's role id, whether or not it exists now (saved layouts check
// against this without reading the config)
const ROLE_ID = /^(?:foh|propresenter|lighting|switcher|producer|hp-[0-9a-f]{10})$/;

const str = (v, max = 200) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');

// The config's custom pages, cleaned: each id once, at most MAX_CUSTOM
function customPages(cfg) {
  const out = [], seen = new Set();
  for (const p of Array.isArray(cfg && cfg.pcoHomePages) ? cfg.pcoHomePages : []) {
    if (!p || typeof p !== 'object' || !CUSTOM_ID.test(String(p.id)) || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push({ id: p.id, name: str(p.name, 40) || 'Custom', position: str(p.position), team: str(p.team, 40) });
    if (out.length >= MAX_CUSTOM) break;
  }
  return out;
}

// Every Home page, in order: id → { label, page, short, custom, position, team, href }
// (position/team: the main service's pick for it)
function all(cfg = require('./config').getAll()) {
  const out = {};
  for (const [id, r] of Object.entries(BUILT_IN)) {
    out[id] = { label: r.label, page: r.page, short: r.short, custom: false, position: str(cfg[r.positionKey]), team: str(cfg[r.teamKey], 40), href: `/${id}.html` };
  }
  for (const p of customPages(cfg)) {
    const id = `hp-${p.id}`;
    out[id] = { label: p.name, page: `${p.name} Home`, short: p.name, custom: true, position: p.position, team: p.team, href: `/${id}.html` };
  }
  return out;
}
const get = (id, cfg) => { const roles = all(cfg); return Object.hasOwn(roles, id) ? roles[id] : null; };
const has = (id, cfg) => !!get(id, cfg);

module.exports = { BUILT_IN, MAX_CUSTOM, CUSTOM_ID, ROLE_ID, customPages, all, get, has };
