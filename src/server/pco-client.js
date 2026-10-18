'use strict';

// ── Planning Center Services API client ─────────────────────────────────────
// Pure HTTP wrapper, no Electron dependency — testable with fixture JSON and
// zero network access (see pco-client.test.js). Used by main.js's
// pco-* IPC handlers to power the Settings "Planning Center" tab.
//
// CONFIRMED against Planning Center's own docs (fetched live, not from
// memory): base URL is api.planningcenteronline.com; a Personal Access
// Token authenticates via HTTP Basic Auth (appId as username, secret as
// password) — PCO's own docs state PATs are explicitly for single-
// organization scripts, not multi-org integrations, which matches this
// feature exactly. A descriptive User-Agent is required or requests get a
// 403. Rate limit is 100 req/20s (a non-issue at this call volume).
//
// ASSUMED, NOT DOC-VERIFIED: exact endpoint paths and attribute names below
// — Planning Center's interactive API explorer is a JS app that couldn't be
// scraped for field names. Based on their stable, long-standing JSON:API
// schema, but the real verification step is the first live sync against a
// real account (see README's Planning Center section). Every parsing
// function below is written defensively — trying a direct convenience
// attribute first, falling back to resolving JSON:API relationships via the
// response's `included` array — specifically so a wrong assumption in one
// of those two paths degrades to the other rather than breaking outright,
// and any request failure surfaces the raw status + body rather than a
// generic message, so a real mismatch is fast to spot and fix here.

const BASE = 'https://api.planningcenteronline.com';
const USER_AGENT = 'JPMixer (https://github.com/JPMixing-inc/jpmixer)';

function authHeader(appId, secret) {
  return 'Basic ' + Buffer.from(`${appId}:${secret}`).toString('base64');
}

const REQUEST_TIMEOUT_MS = 15000;

async function pcoFetch(pathOrUrl, creds) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  // links.next (used by pcoFetchAll below) comes back as a full URL, not a
  // path — accept either so pagination doesn't need its own request logic.
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE}${pathOrUrl}`;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: authHeader(creds.appId, creds.secret),
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error(`Planning Center didn't respond within ${REQUEST_TIMEOUT_MS / 1000}s — check your network connection.`);
      err.status = null;
      err.body = null;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Planning Center request failed: ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  try { return JSON.parse(text); } catch (e) {
    const err = new Error('Planning Center returned a response that was not valid JSON');
    err.status = res.status;
    err.body = text;
    throw err;
  }
}

function findIncluded(included, type, id) {
  if (!Array.isArray(included)) return null;
  return included.find(r => r.type === type && r.id === id) || null;
}

// Follows JSON:API `links.next` until exhausted, concatenating `data` and
// `included` across every page. Planning Center paginates by default (a
// service type with multiple teams — Worship, Production, Host, etc. — can
// easily have more positions or scheduled people than fit on one page), and
// a single pcoFetch() call was silently only ever seeing page 1. The 50-page
// cap is just a runaway-loop guard, not an expected real limit.
async function pcoFetchAll(path, creds) {
  let url = path;
  let data = [];
  let included = [];
  let guard = 0;
  while (url && guard < 50) {
    const json = await pcoFetch(url, creds);
    data = data.concat(json.data || []);
    if (Array.isArray(json.included)) included = included.concat(json.included);
    url = (json.links && json.links.next) || null;
    guard++;
  }
  return { data, included };
}

async function listServiceTypes(creds) {
  const { data } = await pcoFetchAll('/services/v2/service_types', creds);
  return data.map(d => ({ id: d.id, name: (d.attributes && d.attributes.name) || `Service Type ${d.id}` }));
}

// Positions belong to a Team (Worship, Production, Host, ...) within a
// Service Type — `include=team` pulls that relationship in on the same
// already-proven-working call rather than guessing at a separate nested
// per-team endpoint. Returns every position for the Service Type, each
// tagged with teamId/teamName so the caller can filter by team without a
// second round trip per team.
async function listTeams(serviceTypeId, creds) {
  const { data } = await pcoFetchAll(`/services/v2/service_types/${encodeURIComponent(serviceTypeId)}/teams`, creds);
  return data.map(d => ({ id: d.id, name: (d.attributes && d.attributes.name) || `Team ${d.id}` }));
}

async function listPositions(serviceTypeId, creds) {
  const { data, included } = await pcoFetchAll(
    `/services/v2/service_types/${encodeURIComponent(serviceTypeId)}/team_positions?include=team`,
    creds
  );
  return data.map(d => {
    const attrs = d.attributes || {};
    const rel = d.relationships && d.relationships.team && d.relationships.team.data;
    let teamId = rel ? rel.id : null;
    let teamName = attrs.team_name || null;
    if (!teamName && rel) {
      const team = findIncluded(included, 'Team', rel.id);
      if (team) teamName = (team.attributes && team.attributes.name) || null;
    }
    return { id: d.id, name: attrs.name || `Position ${d.id}`, teamId, teamName };
  });
}

// Returns the plan closest to right now — currently running or the next
// upcoming one — for a service type, or null if it has no plans at all.
// Sorted DESCENDING (`-sort_date`, most-future-first) rather than trusting
// one specific server-side "only future plans" filter param whose exact
// name isn't doc-verified — see file header. Descending matters: ascending
// would put the OLDEST plans on page 1 for any account with real history,
// pushing anything relevant thousands of plans deep. Descending lets us
// traverse the future schedule and stop on reaching the first past plan.
//
// Deliberately NOT "soonest plan with a future date" — a church running
// several same-day services (e.g. Saturday 5pm/7pm, Sunday 9am/11am) needs
// whichever one is actually happening right now to stay selected for its
// whole duration, not jump to the next slot the moment its start time
// passes. Picking the plan with the smallest absolute distance to now (past
// or future) does that correctly: mid-service, that service's own plan is
// still closest; between services, the next one becomes closest instead —
// the transition happens right at the midpoint of the gap between them.
async function nextPlan(serviceTypeId, creds) {
  const now = Date.now();
  let url = `/services/v2/service_types/${encodeURIComponent(serviceTypeId)}/plans?order=-sort_date&per_page=25`;
  let best = null, bestDistance = Infinity;
  // Future schedules can span many pages. Follow descending pages until we
  // reach the present; after the first past plan, subsequent pages can only
  // be further away. This avoids fetching years of historical services.
  for (let page = 0; url && page < 50; page++) {
    const json = await pcoFetch(url, creds);
    let reachedPast = false;
    for (const d of json.data || []) {
      const date = d.attributes && (d.attributes.sort_date || d.attributes.dates);
      const time = date ? new Date(date).getTime() : NaN;
      if (!Number.isFinite(time)) continue;
      const distance = Math.abs(time - now);
      if (distance < bestDistance) {
        best = { id: d.id, date, title: (d.attributes && d.attributes.title) || null };
        bestDistance = distance;
      }
      if (time <= now) reachedPast = true;
    }
    if (reachedPast) return best;
    url = (json.links && json.links.next) || null;
  }
  if (url) throw new Error('Planning Center plan search exceeded 50 pages; no current plan was reached.');
  return best;
}

// Returns [{ personName, positionName, status, confirmed }] for everyone
// scheduled on a plan. `confirmed` is true unless the status is explicitly
// recognizable as declined/unconfirmed — see file header on why this is
// deliberately lenient rather than an exact enum match.
async function planTeamMembers(serviceTypeId, planId, creds) {
  const { data, included } = await pcoFetchAll(
    `/services/v2/service_types/${encodeURIComponent(serviceTypeId)}/plans/${encodeURIComponent(planId)}/team_members?include=person,team_position`,
    creds
  );

  return data.map((d) => {
    const attrs = d.attributes || {};

    const personRel = d.relationships && d.relationships.person && d.relationships.person.data;
    const person = personRel && findIncluded(included, 'Person', personRel.id);

    let personName = attrs.name || null;
    if (!personName && person) {
      personName = (person.attributes && person.attributes.name)
        || [person.attributes && person.attributes.first_name, person.attributes && person.attributes.last_name].filter(Boolean).join(' ')
        || null;
    }

    let positionName = attrs.team_position_name || null;
    if (!positionName) {
      const rel = d.relationships && d.relationships.team_position && d.relationships.team_position.data;
      const position = rel && findIncluded(included, 'TeamPosition', rel.id);
      if (position) positionName = (position.attributes && position.attributes.name) || null;
    }

    // Photo: tried in priority order since the exact field name isn't
    // doc-verified (see file header) — a direct convenience attribute on
    // the team_member resource first, then the included Person's likely
    // attribute names. Falls back to null (the green-room display shows an
    // initials placeholder rather than a broken image).
    let photoUrl = attrs.photo_thumbnail_url || attrs.photo_url || attrs.avatar || null;
    if (!photoUrl && person && person.attributes) {
      photoUrl = person.attributes.photo_thumbnail_url || person.attributes.avatar
        || person.attributes.photo_url || person.attributes.avatar_url || null;
    }

    const status = attrs.status != null ? String(attrs.status) : null;
    const declined = status != null && /^d(eclined)?$/i.test(status);
    const unconfirmed = status != null && /^u(nconfirmed)?$/i.test(status);

    return {
      personName: personName || '(unnamed)',
      positionName: positionName || null,
      photoUrl,
      status,
      confirmed: !declined && !unconfirmed,
    };
  });
}

module.exports = { listServiceTypes, listTeams, listPositions, nextPlan, planTeamMembers, USER_AGENT };
