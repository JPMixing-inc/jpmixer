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

const config = require('./config');
const pco = require('./pco-client');

function mountGreenRoom(app) {
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
      const plan = await pco.nextPlan(serviceTypeId, creds);
      if (!plan) { res.json({ ok: true, plan: null, members: [] }); return; }

      const members = await pco.planTeamMembers(serviceTypeId, plan.id, creds);
      const includeUnconfirmed = !!config.get('pcoIncludeUnconfirmed');
      // Hidden positions are an exclusion list (not an allowlist) so the
      // unconfigured default is unambiguous: an empty/missing list hides
      // nothing, same as before this option existed.
      const hidden = new Set((config.get('pcoGreenRoomHidden') || []).map((p) => p.toLowerCase()));

      const teamId = config.get('pcoTeamId');
      let positionTeam = null;
      if (teamId) {
        const positions = await pco.listPositions(serviceTypeId, creds);
        positionTeam = new Map(positions.map((p) => [p.name.toLowerCase(), p.teamId]));
      }

      const relevant = members
        .filter((m) => {
          if (!(includeUnconfirmed || m.confirmed)) return false;
          if (hidden.has((m.positionName || '').toLowerCase())) return false;
          if (positionTeam && positionTeam.get((m.positionName || '').toLowerCase()) !== teamId) return false;
          return true;
        })
        .map((m) => ({ name: m.personName, position: m.positionName || 'Team', photoUrl: m.photoUrl }));

      res.json({ ok: true, plan: { title: plan.title, date: plan.date }, members: relevant });
    } catch (err) {
      res.json({ ok: false, error: err.message, status: err.status || null });
    }
  });
}

module.exports = { mountGreenRoom };
