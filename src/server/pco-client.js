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

// Trimmed here so every caller gets it: a pasted secret with a trailing
// space or newline worked for Settings (which trimmed) but made Green Room,
// FOH Home and phone assignments (which didn't) fail with 401.
function authHeader(appId, secret) {
  return 'Basic ' + Buffer.from(`${String(appId ?? '').trim()}:${String(secret ?? '').trim()}`).toString('base64');
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
// or future) does that correctly as a first pass: mid-service, that
// service's own plan is still closest.
//
// But raw sort_date distance alone isn't enough for a multi-day weekend
// plan: once Sunday's last service has actually ended, sort_date (the
// plan's earliest service, Saturday) sits further in the past than the
// midpoint toward next week's plan — so the just-finished weekend would
// stay "closest" for another day or two after it's genuinely over. Once the
// closest-by-distance plan is a past one AND a later plan exists, this
// checks that past plan's own PlanTimes (confirmed to carry a real `ends_at`
// — see listPlanTimes) and, if its last service has truly concluded,
// returns the upcoming plan instead; while it's still running it stays
// selected, even if the next plan is closer. One extra request, only when a
// recent (under 36h) past plan and an upcoming plan both exist.
const PAST_PLAN_WINDOW_MS = 36 * 60 * 60 * 1000;
// A plan as the Home pages show it. planning_center_url is the plan's page on
// Planning Center (CONFIRMED on a live account: services.planningcenteronline.com/plans/<id>).
const PCO_WEB = 'https://services.planningcenteronline.com';
function planEntry(d, date) {
  const a = d.attributes || {};
  const url = typeof a.planning_center_url === 'string' && a.planning_center_url.startsWith(PCO_WEB + '/') ? a.planning_center_url : null;
  return { id: d.id, date, title: a.title || null, seriesTitle: a.series_title || null, url };
}
async function nextPlan(serviceTypeId, creds) {
  const now = Date.now();
  let url = `/services/v2/service_types/${encodeURIComponent(serviceTypeId)}/plans?order=-sort_date&per_page=25`;
  let best = null, bestDistance = Infinity;
  let mostRecentPast = null, mostRecentPastTime = -Infinity;
  let soonestFuture = null, soonestFutureTime = Infinity;
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
      const entry = planEntry(d, date);
      const distance = Math.abs(time - now);
      if (distance < bestDistance) { best = entry; bestDistance = distance; }
      if (time <= now) {
        reachedPast = true;
        if (time > mostRecentPastTime) { mostRecentPastTime = time; mostRecentPast = entry; }
      } else if (time < soonestFutureTime) {
        soonestFutureTime = time; soonestFuture = entry;
      }
    }
    if (reachedPast) {
      if (!best || !mostRecentPast || !soonestFuture) return best;
      // A past plan that started over 36h ago is over — longer than any
      // weekend's span — so no request needed.
      if (now - mostRecentPastTime > PAST_PLAN_WINDOW_MS) return soonestFuture;
      // Otherwise check whether it's still running. Checked even when the
      // next plan is closer: with 9am and 11am as separate plans, 11am is
      // closer at 10:05, but 9am hasn't finished.
      const times = await listPlanTimes(serviceTypeId, mostRecentPast.id, creds);
      let lastServiceEnd = -Infinity;
      for (const pt of times) {
        const t = new Date(pt.endsAt || pt.startsAt).getTime();
        if (Number.isFinite(t) && t > lastServiceEnd) lastServiceEnd = t;
      }
      // No PlanTimes at all means a plain single-service plan — nothing
      // more precise than sort_date to check against, so trust `best`.
      if (lastServiceEnd === -Infinity) return best;
      return now <= lastServiceEnd ? mostRecentPast : soonestFuture;
    }
    url = (json.links && json.links.next) || null;
  }
  if (url) throw new Error('Planning Center plan search exceeded 50 pages; no current plan was reached.');
  return best;
}

// The next few plans after today, soonest first (CONFIRMED: filter=future
// with order=sort_date works on a live account). For the Home pages'
// Planning Center card.
async function upcomingPlans(serviceTypeId, creds, count = 4) {
  const json = await pcoFetch(`/services/v2/service_types/${encodeURIComponent(serviceTypeId)}/plans?filter=future&order=sort_date&per_page=${Math.max(1, Math.min(10, count))}`, creds);
  return (json.data || [])
    .map(d => planEntry(d, d.attributes && (d.attributes.sort_date || d.attributes.dates)))
    .filter(p => p.date);
}

// A Plan covering a full weekend (Saturday + Sunday, or any multi-day
// schedule) has multiple PlanTimes — confirmed as a real PCO resource via
// their own API reference, with `starts_at`/`name`/`time_type` attributes.
// Used to resolve which calendar day each scheduled person belongs to, for
// day-of-week filtering (Settings' "Day" selector, Green Room + Sync Now).
async function listPlanTimes(serviceTypeId, planId, creds) {
  const { data } = await pcoFetchAll(
    `/services/v2/service_types/${encodeURIComponent(serviceTypeId)}/plans/${encodeURIComponent(planId)}/plan_times`,
    creds
  );
  return data.map(d => ({
    id: d.id,
    name: (d.attributes && d.attributes.name) || null,
    startsAt: (d.attributes && d.attributes.starts_at) || null,
    endsAt: (d.attributes && d.attributes.ends_at) || null, // CONFIRMED real + populated against a live account
    timeType: (d.attributes && d.attributes.time_type) || null, // 'service' | 'rehearsal' | 'other' (confirmed on a live account)
  }));
}

// Settings' Day selector can be set to "auto" instead of a fixed weekday.
// Resolves to whichever of the plan's own PlanTimes is closest to right
// now — right vs. literally "today's calendar date" — because this app is
// sometimes booted ahead of the actual show (e.g. prepping gear on a
// weekday for a Sat/Sun service): literal "today" would resolve to a day
// nobody is scheduled for and filter out everyone. Same "closest to now"
// reasoning nextPlan() already uses to pick the plan itself, just applied
// one level down to its individual service times. Returns '' (no
// filtering) if the plan has no PlanTimes at all — a single-service plan
// with no day split, where "auto" has nothing to resolve against.
async function resolveAutoDay(serviceTypeId, planId, creds) {
  const all = await listPlanTimes(serviceTypeId, planId, creds);
  // Services only: a Thursday rehearsal on a weekend plan resolved "auto"
  // to Thursday, hiding everyone scheduled for the weekend services. Falls
  // back to every time if none are tagged as services.
  const services = all.filter(pt => pt.timeType === 'service');
  const times = services.length ? services : all;
  const now = Date.now();
  let best = null, bestDistance = Infinity;
  for (const pt of times) {
    if (!pt.startsAt) continue;
    const distance = Math.abs(new Date(pt.startsAt).getTime() - now);
    if (distance < bestDistance) { bestDistance = distance; best = pt; }
  }
  return best ? new Date(best.startsAt).toLocaleDateString('en-US', { weekday: 'long' }) : '';
}

// A Plan's order of service — CONFIRMED against a real account: the `Item`
// resource (`item_type`: 'header'/'item'/'song'), with `title`,
// `description` (free-text notes — who's singing what part, etc.),
// `length` in seconds, and `key_name` populated for songs. Returned in
// Planning Center's own order (ascending `sequence`) — the actual service
// rundown an FOH engineer would want to see at a glance.
async function listPlanItems(serviceTypeId, planId, creds) {
  const { data } = await pcoFetchAll(
    `/services/v2/service_types/${encodeURIComponent(serviceTypeId)}/plans/${encodeURIComponent(planId)}/items`,
    creds
  );
  return data
    .map(d => {
      const attrs = d.attributes || {};
      return {
        id: d.id,
        type: attrs.item_type || 'item', // 'header' | 'item' | 'song'
        title: attrs.title || null,
        description: attrs.description || null,
        length: typeof attrs.length === 'number' ? attrs.length : null, // seconds
        keyName: attrs.key_name || null,
        sequence: typeof attrs.sequence === 'number' ? attrs.sequence : 0,
      };
    })
    .sort((a, b) => a.sequence - b.sequence);
}

// Services LIVE — CONFIRMED the `Live` resource itself is real and reachable
// with this app's existing credentials and URL convention (GET
// /service_types/{st}/plans/{plan}/live — the series-scoped path PCO's own
// docs show isn't actually required). NOT verified end-to-end: the account
// this was built against had no in-progress live session, only the idle
// state (`current_item_time` link is null when nobody's pressed "Go Live").
// Unlike every other resource in this file, Live exposes its associations
// as `links` (URLs to fetch) rather than `relationships.data` — confirmed
// `include=` does nothing useful on it, `included` stays empty regardless.
//
// Returns the live item's id, or null if nothing is live. Deliberately
// returns null on any failure too (bad shape, network hiccup) rather than
// throwing — a Live-resource problem should never take down the rest of
// the FOH Home page. The caller cross-references the id against its own
// already-fetched item list (listPlanItems()) rather than this function
// making a second round trip to re-fetch the same Item.
async function getLiveItemId(serviceTypeId, planId, creds) {
  try {
    const json = await pcoFetch(
      `/services/v2/service_types/${encodeURIComponent(serviceTypeId)}/plans/${encodeURIComponent(planId)}/live`,
      creds
    );
    const currentItemTimeUrl = json.data && json.data.links && json.data.links.current_item_time;
    if (!currentItemTimeUrl) return null;

    const itemTimeJson = await pcoFetch(currentItemTimeUrl, creds);
    const itemRel = itemTimeJson.data && itemTimeJson.data.relationships
      && itemTimeJson.data.relationships.item && itemTimeJson.data.relationships.item.data;
    return itemRel ? itemRel.id : null;
  } catch (_) {
    return null;
  }
}

// Returns [{ personName, positionName, status, confirmed, days }] for
// everyone scheduled on a plan. `confirmed` is true unless the status is
// explicitly recognizable as declined/unconfirmed — deliberately lenient
// rather than an exact enum match (PCO's own reference confirms both a
// short form, 'C'/'U'/'D', and a spelled-out form, 'Confirmed'/
// 'Unconfirmed'/'Declined', are real values — this regex matches both).
//
// `days` is which weekday(s) (e.g. "Saturday") this person is scheduled
// for, resolved via PlanPerson's `times`/`service_times` relationships to
// PlanTime. CONFIRMED against a real split-team account: the relationship
// ids themselves are real and correct, but `include=times,service_times` on
// this endpoint is silently ignored by Planning Center — the `included`
// array never actually contains the PlanTime resources, so they have to be
// fetched separately via listPlanTimes() and resolved by id here instead.
// Both relationship names were confirmed to carry identical PlanTime ids on
// a real split-team plan, so both are merged into one set defensively
// rather than picking one. A person with neither relationship populated
// (not a "split team" scheduling setup — most plans aren't) gets an empty
// `days` array, which callers should treat as "applies to every day"
// rather than excluding them from a day filter.
async function planTeamMembers(serviceTypeId, planId, creds) {
  const [{ data, included }, planTimes] = await Promise.all([
    pcoFetchAll(
      `/services/v2/service_types/${encodeURIComponent(serviceTypeId)}/plans/${encodeURIComponent(planId)}/team_members?include=person,team_position`,
      creds
    ),
    listPlanTimes(serviceTypeId, planId, creds),
  ]);
  const dayByTimeId = new Map(
    planTimes
      .filter(pt => pt.startsAt)
      .map(pt => [pt.id, new Date(pt.startsAt).toLocaleDateString('en-US', { weekday: 'long' })])
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

    const timesData = (d.relationships && d.relationships.times && d.relationships.times.data) || [];
    const serviceTimesData = (d.relationships && d.relationships.service_times && d.relationships.service_times.data) || [];
    const timeIds = new Set([...timesData, ...serviceTimesData].map(ref => ref.id));
    const days = [...new Set(
      [...timeIds].map(id => dayByTimeId.get(id)).filter(Boolean)
    )];

    return {
      personId: personRel?.id != null ? String(personRel.id) : null,
      personName: personName || '(unnamed)',
      positionName: positionName || null,
      photoUrl,
      status,
      confirmed: !declined && !unconfirmed,
      declined, // distinct from "unconfirmed" (pending, no response yet) — a decline is a definite
                // no and must never be shown just because includeUnconfirmed is on. See callers.
      days, // e.g. ["Saturday"] — empty means "no day-specific scheduling info, applies to every day"
    };
  });
}

// ── Shared short cache for the display pages and phones ────────────────────
// Green Room screens, FOH Home and phone assignment all ask for the same plan.
// When they load together (a server restart, Wi-Fi coming back) each one
// fetched it separately, in parallel. These copies share one answer for 20s,
// and a request already in flight is joined rather than repeated. The
// Settings tab keeps calling the plain functions above, so its Refresh buttons
// always fetch fresh. getLiveItemId isn't cached: FOH Home follows it live.
const SHARED_CACHE_MS = 20000;
const sharedCache = new Map(); // key -> { at, promise }
function credsKey(creds) {
  return require('crypto').createHash('sha256').update(authHeader(creds && creds.appId, creds && creds.secret)).digest('hex');
}
// Credentials are hashed into the key wherever they sit in the argument list
// (upcomingPlans takes a count after them); the secret itself is never a key
const isCreds = (a) => !!a && typeof a === 'object' && ('appId' in a || 'secret' in a);
function sharedCall(name, fn) {
  return (...args) => {
    const key = name + ':' + JSON.stringify(args.map(a => isCreds(a) ? credsKey(a) : a));
    const now = Date.now();
    const hit = sharedCache.get(key);
    if (hit && now - hit.at < SHARED_CACHE_MS) return hit.promise;
    if (sharedCache.size > 100) for (const [k, v] of sharedCache) if (now - v.at >= SHARED_CACHE_MS) sharedCache.delete(k);
    const promise = fn(...args);
    sharedCache.set(key, { at: now, promise });
    // A failure isn't kept — the next request tries again
    promise.catch(() => { if (sharedCache.get(key)?.promise === promise) sharedCache.delete(key); });
    return promise;
  };
}
const shared = {
  nextPlan: sharedCall('nextPlan', nextPlan),
  planTeamMembers: sharedCall('planTeamMembers', planTeamMembers),
  listPositions: sharedCall('listPositions', listPositions),
  listPlanItems: sharedCall('listPlanItems', listPlanItems),
  resolveAutoDay: sharedCall('resolveAutoDay', resolveAutoDay),
  upcomingPlans: sharedCall('upcomingPlans', upcomingPlans),
  getLiveItemId,
  clear: () => sharedCache.clear(), // tests
};

module.exports = { listServiceTypes, listTeams, listPositions, listPlanTimes, listPlanItems, getLiveItemId, resolveAutoDay, nextPlan, upcomingPlans, planTeamMembers, shared, USER_AGENT, PCO_WEB };
