'use strict';

// ── Which Planning Center service runs today ─────────────────────────────
// Planning Center can follow two Service Types: the main one (the Sunday
// services) and an optional second one (a Wednesday night, a youth night,
// another event), set up in Settings → Planning Center → Second service.
//
// The main one always comes first. On a day when the second one has a plan
// and the main one doesn't, the second one runs everything that reads the
// schedule: aux names (main.js runPcoSync), phone assignment
// (performer-assignments.js), the Green Room (greenroom.js) and the Home
// pages (foh.js). Any other day, nothing changes from a single service.
//
// The second service keeps its own Service Type, Team (Green Room and Home
// page roster), position → aux mapping and Home page roles. Its mapping is
// laid over the main one: a position it doesn't list uses the main
// service's mix for a position of the same name, and 0 takes a position off
// the mixes. A Home page role it doesn't pick uses the main service's role
// name (without the team, since team ids belong to one Service Type). It
// follows the plan's own service time for the day (like pcoDay 'auto').
// "Include unconfirmed" and the hidden Green Room positions are shared.

const config = require('./config');
const homeRoles = require('./home-roles'); // every Home page and its main-service pick

const str = (v) => (typeof v === 'string' ? v : '');
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

function mainService(cfg = config.getAll()) {
  const roles = {};
  for (const [id, r] of Object.entries(homeRoles.all(cfg))) roles[id] = { position: r.position, team: r.team };
  return {
    which: 'main',
    serviceTypeId: str(cfg.pcoServiceTypeId),
    teamId: str(cfg.pcoTeamId),
    day: cfg.pcoDay === undefined ? 'auto' : str(cfg.pcoDay),
    mapping: obj(cfg.pcoPositionMapping),
    offMix: [],
    roles,
  };
}

// The second service's mapping laid over the main one (positions match
// ignoring case, as the sync matches them); 0 = not on a mix
function layMapping(mainMapping, altMapping) {
  const out = { ...obj(mainMapping) };
  for (const [position, aux] of Object.entries(obj(altMapping))) {
    for (const k of Object.keys(out)) if (k.toLowerCase() === position.toLowerCase()) delete out[k];
    const n = Number(aux);
    if (Number.isInteger(n) && n > 0) out[position] = n;
  }
  return out;
}

// null unless a second service is turned on and has a Service Type
function altService(cfg = config.getAll()) {
  const alt = obj(cfg.pcoAlt);
  if (!alt.enabled || !str(alt.serviceTypeId)) return null;
  const main = mainService(cfg);
  const roles = {};
  for (const id of Object.keys(main.roles)) {
    const pick = obj(obj(alt.roles)[id]);
    roles[id] = str(pick.position) ? { position: str(pick.position), team: str(pick.team) } : { position: main.roles[id].position, team: '' };
  }
  return {
    which: 'alt',
    serviceTypeId: str(alt.serviceTypeId),
    teamId: str(alt.teamId),
    day: 'auto',
    mapping: layMapping(main.mapping, alt.positionMapping),
    // Positions it takes off the mixes, so a sync doesn't call them unmapped
    offMix: Object.entries(obj(alt.positionMapping)).filter(([, aux]) => Number(aux) === 0).map(([position]) => position),
    roles,
  };
}

// A failure worth waiting out (no answer, too many requests): see pco-client.js
const temporary = (e) => require('./pco-client').isTemporary(e);

const localDay = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const DAY_MS = 24 * 60 * 60 * 1000;

// Whether a plan has something on today's date (this computer's time zone):
// its date, or any of its times (a weekend plan dated Saturday also covers
// Sunday). The times are only looked up for a plan within a week of today.
async function planIsToday(pco, serviceTypeId, plan, creds, now) {
  if (!plan || !plan.date) return false;
  const date = new Date(plan.date);
  if (Number.isNaN(date.getTime())) return false;
  const today = localDay(now);
  if (localDay(date) === today) return true;
  if (Math.abs(date.getTime() - now.getTime()) > 7 * DAY_MS || !pco.listPlanTimes) return false;
  try {
    const times = await pco.listPlanTimes(serviceTypeId, plan.id, creds);
    return times.some((pt) => [pt.startsAt, pt.endsAt].some((t) => t && localDay(new Date(t)) === today));
  } catch (e) {
    if (temporary(e)) throw e; // no answer isn't "not today": see activeService
    return false;
  }
}

// { service, plan }: the service that runs today, and its plan. `pco` is
// pco-client (or its shared cache); `cfg` can carry settings not saved yet
// (Sync Now). A second service whose plan is gone (a real answer, like a 404)
// leaves the main one in charge; the main one failing throws, as before there
// were two. A hiccup (no answer, too many requests) throws too, so pages keep
// what they show and the sync waits: falling back to the main service then
// renamed the mixes to Sunday's team in the middle of the second service,
// cleared team chat and could move phones to Sunday's mixes.
async function activeService(pco, creds, cfg = config.getAll(), now = new Date()) {
  const main = mainService(cfg), alt = altService(cfg);
  const [mainPlan, altPlan] = await Promise.all([
    main.serviceTypeId ? pco.nextPlan(main.serviceTypeId, creds) : null,
    alt ? pco.nextPlan(alt.serviceTypeId, creds).catch((e) => { if (temporary(e)) throw e; return null; }) : null,
  ]);
  if (alt && altPlan
    && await planIsToday(pco, alt.serviceTypeId, altPlan, creds, now)
    && !(await planIsToday(pco, main.serviceTypeId, mainPlan, creds, now))) {
    return { service: alt, plan: altPlan };
  }
  return { service: main, plan: mainPlan };
}

// Whether any Home page role is picked, in either service
function rolePicked(roleId, cfg = config.getAll()) {
  const role = homeRoles.get(roleId, cfg);
  return !!(role && (role.position || (obj(cfg.pcoAlt).enabled && str(obj(obj(obj(cfg.pcoAlt).roles)[roleId]).position))));
}

module.exports = { mainService, altService, layMapping, activeService, rolePicked };
