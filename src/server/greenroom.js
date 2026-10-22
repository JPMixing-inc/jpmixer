'use strict';

// ── Green Room display data ─────────────────────────────────────────────
// One shared route (`GET /greenroom-data`), mounted with a single call from
// each of the four console backends' start() — this logic exists in exactly
// one place rather than duplicated four times. Backs src/mixer/greenroom.html,
// a full-screen, read-only "who's playing today" display meant for an
// iPad/TV in the green room.
//
// Deliberately UNAUTHENTICATED, unlike the External Control API — this is
// informational only (photos + role names), not a control surface, and the
// point is that someone can just open a bookmarked URL on a green-room
// iPad without dealing with a token. It reuses the Planning Center
// credentials + Service Type already configured in Settings' Planning
// Center tab (see pco-client.js for what's confirmed vs. assumed about
// Planning Center's API), and shows every scheduled team member for the
// next upcoming plan by default — narrowed to one Team if Settings' Team
// dropdown has a selection saved (pcoTeamId), same filter the Position
// mapping table already uses for display, now also applied here.
//
// Planning Center's team_members response doesn't carry team info directly
// (see pco-client.js), so team filtering here works by cross-referencing
// each member's position name against listPositions()'s own team
// resolution — reusing already-proven parsing rather than guessing at a
// second, deeper `include` path.
//
// A weekend plan (Saturday + Sunday, or any multi-day schedule) can have
// "split team" scheduling, where different people serve different days —
// Settings' Day selector (pcoDay) narrows to one. A person with no
// day-specific scheduling info (most plans aren't split-team) always
// passes the filter rather than being hidden — see pco-client.js's days
// field.

const config = require('./config');
const pco = require('./pco-client').shared; // 20s shared cache — see pco-client.js
const pcoServices = require('./pco-services'); // the main service, or the second one on its day

// What Planning Center Live is on now and the next item, for the TV's Now /
// Up next strip. Its own route so the strip can follow the service every few
// seconds while the team refreshes every 2 minutes. The live item isn't in
// the shared 20 s cache (FOH Home follows it live too), so it's kept here for
// a few seconds: every Green Room screen asking at once makes one request.
const LIVE_CACHE_MS = 8000;
let liveCache = { at: 0, key: '', value: null };
const itemOut = (it) => it && { title: it.title, keyName: it.keyName, length: it.length, type: it.type };
async function liveNow(creds) {
  const { service, plan } = await pcoServices.activeService(pco, creds);
  if (!plan) return null;
  const key = `${service.serviceTypeId}:${plan.id}`;
  if (liveCache.key === key && Date.now() - liveCache.at < LIVE_CACHE_MS) return liveCache.value;
  const [items, liveId] = await Promise.all([
    pco.listPlanItems(service.serviceTypeId, plan.id, creds),
    pco.getLiveItemId(service.serviceTypeId, plan.id, creds),
  ]);
  const at = liveId ? items.findIndex((it) => it.id === liveId) : -1;
  // Up next skips section headers ("WORSHIP"), as FOH Home's Live card does
  const next = at < 0 ? null : items.slice(at + 1).find((it) => it.type !== 'header') || null;
  const value = at < 0 ? null : { now: itemOut(items[at]), next: itemOut(next) };
  liveCache = { at: Date.now(), key, value };
  return value;
}

function mountGreenRoom(app) {
  app.get('/greenroom-live', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const appId = config.get('pcoAppId'), secret = config.get('pcoSecret');
    if (!appId || !secret || !config.get('pcoServiceTypeId')) { res.json({ ok: true, live: null }); return; }
    try { res.json({ ok: true, live: await liveNow({ appId, secret }) }); }
    catch (err) { res.json({ ok: false, live: null, error: err.message }); }
  });

  app.get('/greenroom-data', async (req, res) => {
    const appId = config.get('pcoAppId');
    const secret = config.get('pcoSecret');
    const serviceTypeId = config.get('pcoServiceTypeId');

    if (!appId || !secret || !serviceTypeId) {
      res.json({ ok: false, error: 'Planning Center isn’t set up yet — see Settings → Planning Center.' });
      return;
    }

    try {
      const creds = { appId, secret };
      const { service, plan } = await pcoServices.activeService(pco, creds);
      if (!plan) { res.json({ ok: true, plan: null, members: [] }); return; }
      const serviceTypeId = service.serviceTypeId;

      const members = await pco.planTeamMembers(serviceTypeId, plan.id, creds);
      const includeUnconfirmed = !!config.get('pcoIncludeUnconfirmed');
      // Hidden positions are an exclusion list (not an allowlist) so the
      // unconfigured default is unambiguous: an empty/missing list hides
      // nothing, same as before this option existed.
      const hidden = new Set((config.get('pcoGreenRoomHidden') || []).map((p) => p.toLowerCase()));

      const teamId = service.teamId;
      let positionTeam = null;
      if (teamId) {
        const positions = await pco.listPositions(serviceTypeId, creds);
        positionTeam = new Map(positions.map((p) => [p.name.toLowerCase(), p.teamId]));
      }

      // "auto" resolves against this plan's own PlanTimes (whichever is
      // closest to right now), not literally today's calendar date — see
      // pco-client.js's resolveAutoDay() for why that distinction matters.
      const rawDay = service.day;
      const day = rawDay === 'auto' ? await pco.resolveAutoDay(serviceTypeId, plan.id, creds) : rawDay;

      const relevant = members
        .filter((m) => {
          // A decline is a definite no — never shown, regardless of
          // includeUnconfirmed (that setting means "also show people who
          // haven't responded yet," not "also show people who said no").
          if (m.declined) return false;
          if (!(includeUnconfirmed || m.confirmed)) return false;
          if (hidden.has((m.positionName || '').toLowerCase())) return false;
          if (positionTeam && positionTeam.get((m.positionName || '').toLowerCase()) !== teamId) return false;
          if (day && m.days.length > 0 && !m.days.includes(day)) return false;
          return true;
        });

      // One card per person: someone on two positions (Vocal 2 and Acoustic
      // Guitar) shows once with both, in schedule order. Matched by their
      // Planning Center id, or by name when there's no id.
      const people = new Map();
      for (const m of relevant) {
        const key = m.personId ? `id:${m.personId}` : `name:${String(m.personName || '').toLowerCase()}`;
        const role = m.positionName || 'Team';
        const person = people.get(key);
        if (!person) people.set(key, { name: m.personName, position: role, positions: [role], photoUrl: m.photoUrl });
        else {
          if (!person.positions.includes(role)) person.positions.push(role);
          if (!person.photoUrl && m.photoUrl) person.photoUrl = m.photoUrl;
        }
      }
      res.json({ ok: true, plan: { title: plan.title, date: plan.date }, members: [...people.values()] });
    } catch (err) {
      res.json({ ok: false, error: err.message, status: err.status || null });
    }
  });
}

module.exports = { mountGreenRoom };
