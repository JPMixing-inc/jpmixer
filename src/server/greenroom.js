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
// Up next strip and the Home pages' time left. Its own route so pages can
// follow the service every few seconds while the team refreshes every 2
// minutes. The live item isn't in the shared 20 s cache (FOH Home follows it
// live too), so it's kept here for a few seconds: every screen asking at
// once makes one request.
//
// `startedAt` is when the live item went live, for "2:14 left": Planning
// Center's own time when it gives one, or else when JPMixer first saw that
// item live (so within a poll of the real moment, or later if JPMixer
// started mid-item). `index` is the item's place in the order of service,
// the same list /foh-data sends, so a Home page can tell its Live card is
// behind.
const LIVE_CACHE_MS = 8000;
let liveCache = { at: 0, key: '', value: null };
let firstSeen = { key: '', at: 0 };
const itemOut = (it) => it && { title: it.title, keyName: it.keyName, length: it.length, type: it.type };
async function liveNow(creds, active) {
  const { service, plan } = active || await pcoServices.activeService(pco, creds);
  if (!plan) return null;
  const key = `${service.serviceTypeId}:${plan.id}`;
  if (liveCache.key === key && Date.now() - liveCache.at < LIVE_CACHE_MS) return liveCache.value;
  const [items, live] = await Promise.all([
    pco.listPlanItems(service.serviceTypeId, plan.id, creds),
    pco.getLive(service.serviceTypeId, plan.id, creds),
  ]);
  const at = live ? items.findIndex((it) => it.id === live.itemId) : -1;
  // Up next skips section headers ("WORSHIP"), as FOH Home's Live card does
  const next = at < 0 ? null : items.slice(at + 1).find((it) => it.type !== 'header') || null;
  let value = null;
  if (at >= 0) {
    const seenKey = `${key}:${live.itemId}`;
    if (firstSeen.key !== seenKey) firstSeen = { key: seenKey, at: Date.now() };
    value = { now: itemOut(items[at]), next: itemOut(next), index: at, startedAt: live.startedAt || new Date(firstSeen.at).toISOString() };
  }
  liveCache = { at: Date.now(), key, value };
  return value;
}

// The next service time still to come on the current plan (a weekend plan
// has several), for "Service starts in 12:34". PlanTime starts_at is real
// UTC (unlike a plan's sort_date). Rehearsals don't count, unless no time
// is marked as a service. Nothing while a service is on (until its end
// time, or 90 minutes without one): 9 AM's service isn't "11 AM starts in
// 1 h 59 min".
const SERVICE_LENGTH_MS = 90 * 60 * 1000;
async function nextServiceAt(creds, active) {
  const { service, plan } = active || await pcoServices.activeService(pco, creds);
  if (!plan) return null;
  const all = await pco.listPlanTimes(service.serviceTypeId, plan.id, creds);
  const services = all.filter((pt) => pt.timeType === 'service');
  const now = Date.now();
  const times = (services.length ? services : all)
    .map((pt) => ({ start: Date.parse(pt.startsAt), end: Date.parse(pt.endsAt) }))
    .filter((pt) => Number.isFinite(pt.start));
  if (times.some((pt) => pt.start <= now && now < (Number.isFinite(pt.end) && pt.end > pt.start ? pt.end : pt.start + SERVICE_LENGTH_MS))) return null;
  const upcoming = times.map((pt) => pt.start).filter((t) => t > now).sort((a, b) => a - b);
  return upcoming.length ? new Date(upcoming[0]).toISOString() : null;
}

// ── "Scan for your mix" ──
// A QR code on the TV that opens the aux picker on a phone. It points at the
// address the TV itself typed in (its Host header), which phones on the same
// network can reach too; with Port 80 the forwarder on this computer makes
// that the only reliable clue. A TV showing localhost (the Green Room open
// on this computer) gets this computer's network address instead,
// preferring the one on the console's network, as the app window does.
function sameSubnet(a, b, mask) {
  const toNum = (ip) => ip.split('.').reduce((acc, oct) => ((acc << 8) >>> 0) + parseInt(oct, 10), 0);
  return (toNum(a) & toNum(mask)) === (toNum(b) & toNum(mask));
}
function lanAddress() {
  const deskIp = config.get('deskIp');
  let fallback = null;
  for (const list of Object.values(require('os').networkInterfaces())) {
    for (const iface of list || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      if (!fallback) fallback = iface.address;
      if (deskIp && iface.netmask && /^\d+\.\d+\.\d+\.\d+$/.test(deskIp) && sameSubnet(iface.address, deskIp, iface.netmask)) return iface.address;
    }
  }
  return fallback;
}
const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0)$/i;
function pickerUrl(req) {
  const host = String(req.headers.host || '');
  const m = host.match(/^([a-z0-9.-]{1,253})(?::(\d{1,5}))?$/i); // a name or IPv4, never [IPv6] or anything odd
  if (m && !LOCAL_HOST.test(m[1])) return `http://${m[1].toLowerCase()}${m[2] && m[2] !== '80' ? ':' + m[2] : ''}/`;
  const ip = lanAddress();
  if (!ip) return null;
  const port = Number(config.get('serverPort')) || 8080;
  return `http://${ip}${port === 80 ? '' : ':' + port}/`;
}
// The QR code as SVG, black on white with the standard quiet zone
let qrCache = { text: '', svg: '' };
function qrSvg(text) {
  if (qrCache.text === text) return qrCache.svg;
  const qr = require('qrcode-generator')(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), quiet = 4, size = n + quiet * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" aria-hidden="true"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  qrCache = { text, svg };
  return svg;
}

function mountGreenRoom(app) {
  // SPL from Smaart on the TV (Settings → Pages → Green Room), when Smaart SPL is on
  app.get('/greenroom-spl', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const enabled = config.get('greenRoomSpl') === true && config.get('smaartEnabled') === true;
    res.json({ ok: true, enabled, reading: enabled ? require('./smaart').singleReading(String(config.get('greenRoomSplMetric') || ''), String(config.get('greenRoomSplInput') || '')) : null });
  });

  app.get('/greenroom-qr', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (config.get('greenRoomQr') === false) { res.json({ ok: true, enabled: false }); return; }
    const url = pickerUrl(req);
    res.json({ ok: true, enabled: true, url, svg: url ? qrSvg(url) : null });
  });

  app.get('/greenroom-live', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const appId = config.get('pcoAppId'), secret = config.get('pcoSecret');
    // serverTime lets a page count down on JPMixer's clock, not its own
    const serverTime = () => new Date().toISOString();
    if (!appId || !secret || !config.get('pcoServiceTypeId')) { res.json({ ok: true, live: null, nextServiceAt: null, serverTime: serverTime() }); return; }
    try {
      const creds = { appId, secret };
      const active = await pcoServices.activeService(pco, creds);
      const [live, next] = await Promise.all([liveNow(creds, active), nextServiceAt(creds, active).catch(() => null)]);
      res.json({ ok: true, live, nextServiceAt: next, serverTime: serverTime() });
    }
    catch (err) { res.json({ ok: false, live: null, nextServiceAt: null, serverTime: serverTime(), error: err.message }); }
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

      // Which day's team: one answer from the plan's own times, the same as
      // the Home pages (pco-client.js serviceDays). "auto" follows the
      // services: the one on now (until 90 min after it ends), else the next.
      const rawDay = service.day;
      const schedule = require('./pco-client').serviceDays(await pco.listPlanTimes(serviceTypeId, plan.id, creds), rawDay);
      const day = schedule.day;

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
      // `auxes`: the mixes their positions are mapped to (Planning Center tab),
      // so the TV can show the mic battery of whoever is on that mix.
      const mapping = new Map(Object.entries(service.mapping || {}).map(([p, aux]) => [p.toLowerCase(), Number(aux)]));
      const auxFor = (role) => { const aux = mapping.get(String(role).toLowerCase()); return Number.isInteger(aux) && aux >= 1 && aux <= 64 ? aux : null; };
      const people = new Map();
      for (const m of relevant) {
        const key = m.personId ? `id:${m.personId}` : `name:${String(m.personName || '').toLowerCase()}`;
        const role = m.positionName || 'Team';
        const person = people.get(key);
        const aux = auxFor(role);
        if (!person) people.set(key, { name: m.personName, position: role, positions: [role], photoUrl: m.photoUrl, auxes: aux ? [aux] : [] });
        else {
          if (!person.positions.includes(role)) person.positions.push(role);
          if (aux && !person.auxes.includes(aux)) person.auxes.push(aux);
          if (!person.photoUrl && m.photoUrl) person.photoUrl = m.photoUrl;
        }
      }
      // The day being served (a weekend plan's Sunday once Saturday is over)
      const { days, current } = schedule;
      res.json({ ok: true, plan: { title: plan.title, date: current >= 0 ? days[current].times[0] : plan.date }, members: [...people.values()], mics: config.get('greenRoomMics') !== false });
    } catch (err) {
      res.json({ ok: false, error: err.message, status: err.status || null });
    }
  });
}

// _resetLive(false) only drops the few-second cache (tests)
module.exports = { mountGreenRoom, _resetLive: (all = true) => { liveCache = { at: 0, key: '', value: null }; if (all) firstSeen = { key: '', at: 0 }; } };
