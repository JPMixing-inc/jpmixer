'use strict';

// ── FOH Engineer Home ────────────────────────────────────────────────────
// One shared route (`GET /foh-data`), mounted alongside Green Room's from
// each of the four console backends' start(). Backs src/mixer/foh.html — a
// personal landing page for whoever Planning Center has scheduled into the
// Team Position configured in Settings' Planning Center tab as the "FOH
// Engineer" role (pcoFohPositionName/pcoFohTeamId), with a "Welcome, <name>"
// greeting + photo, console/connection status, a scrollable team roster
// card, a scrollable order-of-service card, and quick links to Monitor
// Engineer / Devices / Console Controller.
//
// `status` is `{ isConsoleConnected, getConnectionCount }` — each backend's
// own functions, passed in at mount time since this module has no backend
// of its own to ask (mirrors how api-server.js is handed the active
// backend rather than importing one directly).
//
// Deliberately UNAUTHENTICATED, same reasoning as greenroom.js — this page
// itself is just a greeting + a set of links; the pages it links to are
// already unauthenticated on the local network, same as the rest of the app.
//
// Reuses nextPlan/resolveAutoDay/planTeamMembers exactly as greenroom.js
// does, including pcoDay for which weekend day's roster applies, so a
// split-team weekend correctly greets Saturday's FOH engineer on Saturday
// and Sunday's on Sunday. The roster card mirrors greenroom.js's own filter
// exactly (same confirmed/declined/day rules, same pcoTeamId/
// pcoGreenRoomHidden settings) so "who's serving" is one consistent answer
// across both pages, not a second independent list to keep in sync.
// `rosterTeamName` is pcoTeamId's actual team name (e.g. "Worship Team"),
// resolved the same way listPositions() already resolves it, so the
// roster card's heading can say which team it is instead of a generic
// "Team" — null when pcoTeamId isn't set (roster spans every team).
//
// `liveItem`/`order[].live` surface Planning Center's Services LIVE state
// (whichever item is currently marked live during the actual service) —
// see pco-client.js's getLiveItemId() for what's confirmed vs. untested
// about that resource. Best-effort: resolves to "nothing live" rather
// than erroring if Live's own API hiccups. `previousItem`/`nextItem` are
// derived locally from the already-fetched `order` (no extra PCO request)
// — the nearest non-header item on either side of the live one.

//
// The same page also serves the ProPresenter, Lighting and Switcher
// operators: /propresenter.html etc. (one shared role.html) read
// /role-data?role=…, built by the same code from that role's own Team
// Position setting. Only FOH Home has the console status and engineer links.
//
// /home.html lists the Home pages (like the performer page's mix picker),
// from GET /home-pages: each page, whether it's set up, and who's on today.
//
// FOH Home can need an access code (Settings → Pages → FOH Home). Without
// it /foh-data answers 401 and the page asks for the code; POST /foh-unlock
// with the right one sets a cookie derived from the code, so changing the
// code signs every device out. Requests from this computer itself never
// need it. Guesses are limited per device.

const path = require('path');
const os = require('os');
const crypto = require('crypto');
const express = require('express');
const config = require('./config');
const pco = require('./pco-client').shared; // 20s shared cache — see pco-client.js
const pcoServices = require('./pco-services'); // the main service, or the second one on its day

const ROLES = {
  foh:          { label: 'FOH Engineer', page: 'FOH Engineer Home', positionKey: 'pcoFohPositionName', teamKey: 'pcoFohTeamId' },
  propresenter: { label: 'ProPresenter', page: 'ProPresenter Home', positionKey: 'pcoProPresenterPositionName', teamKey: 'pcoProPresenterTeamId' },
  lighting:     { label: 'Lighting', page: 'Lighting Home', positionKey: 'pcoLightingPositionName', teamKey: 'pcoLightingTeamId' },
  switcher:     { label: 'Switcher', page: 'Switcher Home', positionKey: 'pcoSwitcherPositionName', teamKey: 'pcoSwitcherTeamId' },
};

// ── FOH Home access code ──
const COOKIE = 'jpm_foh';
const accessCode = () => String(config.get('fohAccessCode') || '').trim();
const cookieFor = (code) => crypto.createHmac('sha256', code).update('jpmixer-foh-home-v1').digest('hex').slice(0, 40);

function ownAddresses() {
  const out = new Set(['127.0.0.1', '::1']);
  for (const list of Object.values(os.networkInterfaces())) for (const iface of list || []) out.add(iface.address);
  return out;
}
const clientAddress = (req) => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
const fromThisComputer = (req) => ownAddresses().has(clientAddress(req));

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}
function sameText(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function hasFohAccess(req) {
  const code = accessCode();
  return !code || fromThisComputer(req) || sameText(readCookie(req, COOKIE), cookieFor(code));
}

const UNLOCK_TRIES = 8, UNLOCK_WINDOW_MS = 5 * 60 * 1000;
const unlockTries = new Map(); // address -> { count, resetAt }
function tooManyTries(address) {
  const now = Date.now();
  if (unlockTries.size > 500) for (const [k, v] of unlockTries) if (v.resetAt < now) unlockTries.delete(k);
  const entry = unlockTries.get(address);
  if (!entry || entry.resetAt < now) { unlockTries.set(address, { count: 1, resetAt: now + UNLOCK_WINDOW_MS }); return false; }
  entry.count++;
  return entry.count > UNLOCK_TRIES;
}

function mountFoh(app, status) {
  require('./chat').mountChat(app); // the Home pages' Team chat card (chat.js)
  require('./device-stage').mountDeviceStage(app); // the Devices page's shared stage arrangement
  // The FOH Home Wireless card (shure-wireless.js); behind FOH's access code like the rest of FOH Home
  app.get('/wireless-data', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!hasFohAccess(req)) { res.status(401).json({ ok: false, needCode: true }); return; }
    const wireless = require('./shure-wireless');
    res.json({ ok: true, enabled: wireless.getStatus().enabled, channels: wireless.channelsForPages() });
  });
  // Each mix's mic batteries, for the musician's phone mixer and Monitor
  // Engineer (no code: names and batteries only, no addresses)
  app.get('/wireless-aux', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const wireless = require('./shure-wireless');
    const enabled = wireless.getStatus().enabled;
    res.json({ ok: true, enabled, mixes: enabled ? wireless.mixesForPages() : {} });
  });
  // The Home pages' Companion card (companion-satellite.js); FOH's needs its access code
  require('./companion-satellite').mountCompanion(app, { canUse: (req, role) => role !== 'foh' || hasFohAccess(req) });
  // FOH Home's SPL card (smaart.js): the levels need no code; changing the card's options does
  require('./smaart').mountSmaart(app, {
    canChange: hasFohAccess,
    save: (o) => {
      if (!config.save({ ...config.getAll(), smaartMetric: o.main, smaartLiveMetric: o.live, smaartHiddenInputs: o.hidden })) return false;
      require('./smaart').applyConfig(config.getAll());
      require('./integrations').applyConfig(config.getAll()); // the plugin: new settings, no reconnect
      return true;
    },
  });
  // Plugins' own pages, sandboxed, and their calls to their plugin (plugins.js)
  require('./plugins').mountPluginPages(app);
  // Plugins' cards (plugins.js). The page loads the list as a script before
  // foh-layout.js, so the cards are there to arrange like any other; what's
  // on them needs FOH's access code.
  app.get('/plugin-cards.js', (req, res) => {
    const list = require('./plugins').cards().map((c) => ({ id: c.cardId, title: c.title }));
    res.set('Cache-Control', 'no-store');
    res.type('application/javascript').send(`window.JPM_PLUGIN_CARDS = ${JSON.stringify(list).replace(/</g, '\\u003c')};\n`);
  });
  app.get('/plugin-cards', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!hasFohAccess(req)) { res.status(401).json({ ok: false, needCode: true }); return; }
    res.json({ ok: true, cards: require('./plugins').cards().map((c) => ({ id: c.cardId, title: c.title, card: c.card, state: c.state })) });
  });
  app.get('/foh-data', async (req, res) => {
    if (!hasFohAccess(req)) { res.status(401).json({ ok: false, needCode: true, role: { id: 'foh', label: ROLES.foh.label, page: ROLES.foh.page } }); return; }
    res.json(await roleData('foh', status));
  });
  app.post('/foh-unlock', express.json({ limit: '2kb' }), (req, res) => {
    const code = accessCode();
    if (!code) { res.json({ ok: true }); return; }
    if (tooManyTries(clientAddress(req))) { res.status(429).json({ ok: false, error: 'Too many tries. Wait a few minutes and try again.' }); return; }
    if (!sameText(String(req.body?.code || '').trim(), code)) { res.status(403).json({ ok: false, error: 'That code isn’t right.' }); return; }
    unlockTries.delete(clientAddress(req));
    res.set('Set-Cookie', `${COOKIE}=${cookieFor(code)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`);
    res.json({ ok: true });
  });
  // Saved layouts, per page and per scheduled team member (home-layouts.js).
  // A save is only taken for the person scheduled on that page right now, so
  // one page can't overwrite another person's layout; FOH Home also needs
  // its access code.
  app.get('/home-layout', (req, res) => {
    const roleId = String(req.query.role || '');
    res.set('Cache-Control', 'no-store');
    if (!Object.hasOwn(ROLES, roleId) || (roleId === 'foh' && !hasFohAccess(req))) { res.status(403).json({ ok: false }); return; }
    // Theirs for this page, or the one they saved last on another Home page
    const saved = require('./home-layouts').forPerson(roleId, String(req.query.person || ''));
    res.json({ ok: true, layout: saved ? saved.layout : null, savedAt: saved ? saved.savedAt : null, fromRole: saved ? saved.fromRole : null, fromPage: saved && saved.fromRole !== roleId ? ROLES[saved.fromRole].page : null });
  });
  app.post('/home-layout', express.json({ limit: '16kb' }), async (req, res) => {
    const roleId = String(req.body?.role || '');
    if (!Object.hasOwn(ROLES, roleId)) { res.status(400).json({ ok: false, error: 'Unknown page.' }); return; }
    if (roleId === 'foh' && !hasFohAccess(req)) { res.status(403).json({ ok: false, error: 'Enter the FOH Home access code first.' }); return; }
    const data = await roleData(roleId, null).catch(() => null);
    const person = data && data.ok && data.engineer;
    if (!person || !person.personId) { res.status(409).json({ ok: false, error: 'Nobody is scheduled on this page right now, so there’s no one to save it for.' }); return; }
    if (String(req.body?.personId || '') !== person.personId) { res.status(409).json({ ok: false, error: `This page is now scheduled for ${person.name}. Reload to save for them.` }); return; }
    const saved = require('./home-layouts').set(roleId, person.personId, person.name, req.body?.layout);
    if (!saved) { res.status(400).json({ ok: false, error: 'That layout couldn’t be saved. Try again.' }); return; }
    res.json({ ok: true, name: person.name });
  });

  // The station picker: every Home page, whether it's set up, and who's on
  app.get('/home-pages', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const pages = await Promise.all(Object.entries(ROLES).map(async ([id, role]) => {
      const locked = id === 'foh' && !!accessCode();
      // Set up = Planning Center connected and this page's role picked
      const configured = !!(config.get('pcoAppId') && config.get('pcoSecret') && config.get('pcoServiceTypeId') && pcoServices.rolePicked(id));
      let person = null;
      // A locked FOH Home doesn't give its schedule away here either
      if (configured && !(locked && !hasFohAccess(req))) {
        const data = await roleData(id, null).catch(() => null);
        person = data && data.ok && data.engineer ? data.engineer.name : null;
      }
      // Planning Center turned off on purpose: said so, rather than "not set up"
      const note = config.get('pcoEnabled') === false ? 'Planning Center is off' : undefined;
      return { id, page: role.page, label: role.label, href: `/${id}.html`, configured, person, locked, ...(note ? { note } : {}) };
    }));
    res.json({ ok: true, pages, plugins: require('./plugins').pages() }); // plugins' own pages, listed after the Home pages
  });
  app.get('/role-data', async (req, res) => {
    const roleId = String(req.query.role || '');
    if (!Object.hasOwn(ROLES, roleId) || roleId === 'foh') { res.status(404).json({ ok: false, error: 'Unknown page.' }); return; }
    res.json(await roleData(roleId, null));
  });
  const rolePage = path.join(__dirname, '..', 'mixer', 'role.html');
  for (const roleId of Object.keys(ROLES)) {
    if (roleId !== 'foh') app.get(`/${roleId}.html`, (req, res) => res.sendFile(rolePage));
  }
}

const lastLiveId = new Map(); // "serviceType:plan" -> the live item id Planning Center last gave
async function roleData(roleId, status) {
  const role = ROLES[roleId];
  const roleInfo = { id: roleId, label: role.label, page: role.page };
  const consoleConnected = !!(status && status.isConsoleConnected && status.isConsoleConnected());
  const connectionCount = (status && status.getConnectionCount) ? status.getConnectionCount() : 0;
  const reply = (body) => ({ role: roleInfo, ...body });

  const appId = config.get('pcoAppId');
  const secret = config.get('pcoSecret');
  const notSetUp = () => reply({ ok: false, error: config.get('pcoEnabled') === false
    ? `Planning Center is turned off in JPMixer Settings, so the ${role.page} page has no schedule to show.`
    : `The ${role.page} page isn’t set up yet — choose who it welcomes in JPMixer Settings → Pages.`, consoleConnected, connectionCount });

  if (!appId || !secret || !config.get('pcoServiceTypeId') || !pcoServices.rolePicked(roleId)) return notSetUp();

  try {
    const creds = { appId, secret };
    // The main service, or the second one on its day — with its own roles
    const { service, plan } = await pcoServices.activeService(pco, creds);
    const serviceTypeId = service.serviceTypeId;
    const positionName = service.roles[roleId].position;
    if (!positionName) return notSetUp();
    if (!plan) { return reply({ ok: true, plan: null, engineer: null, roster: [], order: [], liveItem: null, previousItem: null, nextItem: null, consoleConnected, connectionCount }); }

    // The Planning Center card's next few plans are fetched alongside the
    // rest, not after; a failure there only empties that list
    const [members, items, liveItemId, upcomingPlans, planTimes] = await Promise.all([
      pco.planTeamMembers(serviceTypeId, plan.id, creds),
      pco.listPlanItems(serviceTypeId, plan.id, creds),
      // A moment Planning Center doesn't answer about Live: what it said last
      // for this plan (nothing, if it hasn't said yet), never the whole page
      pco.getLiveItemId(serviceTypeId, plan.id, creds).then(
        (id) => { lastLiveId.set(`${serviceTypeId}:${plan.id}`, id); return id; },
        () => lastLiveId.get(`${serviceTypeId}:${plan.id}`) ?? null),
      pco.upcomingPlans(serviceTypeId, creds, 4).catch(() => []),
      pco.listPlanTimes(serviceTypeId, plan.id, creds),
    ]);
    // Which day's team, and the day the Planning Center card shows: one
    // answer from the plan's own times (see pco-client.js serviceDays), so
    // the roster and the card always agree. "auto" follows the services:
    // the one on now (until 90 min after it ends), else the next.
    const rawDay = service.day;
    const schedule = require('./pco-client').serviceDays(planTimes, rawDay);
    const day = schedule.day;
    const includeUnconfirmed = !!config.get('pcoIncludeUnconfirmed');
    const fohTeamId = service.roles[roleId].team; // this role's team (named for FOH, which came first)
    const rosterTeamId = service.teamId;
    const hidden = new Set((config.get('pcoGreenRoomHidden') || []).map((p) => p.toLowerCase()));

    // One listPositions() round trip covers both the FOH pairing and the
    // roster's own team filter, whichever (or both) are actually set —
    // also where the roster card's "Worship Team" heading comes from,
    // rather than a generic "Team" that doesn't say which one.
    let positionTeam = null;
    let rosterTeamName = null;
    if (fohTeamId || rosterTeamId) {
      const positions = await pco.listPositions(serviceTypeId, creds);
      positionTeam = new Map(positions.map((p) => [p.name.toLowerCase(), p.teamId]));
      if (rosterTeamId) {
        const teamMatch = positions.find((p) => p.teamId === rosterTeamId);
        rosterTeamName = teamMatch ? teamMatch.teamName : null;
      }
    }

    // A decline is a definite no — never shown, regardless of
    // includeUnconfirmed (that setting means "also show people who
    // haven't responded yet," not "also show people who said no").
    const match = members.find((m) => {
      if ((m.positionName || '').toLowerCase() !== positionName.toLowerCase()) return false;
      if (m.declined) return false;
      if (!(includeUnconfirmed || m.confirmed)) return false;
      if (fohTeamId && positionTeam && positionTeam.get((m.positionName || '').toLowerCase()) !== fohTeamId) return false;
      if (day && m.days.length > 0 && !m.days.includes(day)) return false;
      return true;
    });

    // One row per person, as on the Green Room: someone on two positions
    // (Vocal 2 and Acoustic Guitar) shows once with both, in schedule order.
    // Matched by their Planning Center id, or by name when there's no id.
    const people = new Map();
    for (const m of members) {
      if (m.declined) continue;
      if (!(includeUnconfirmed || m.confirmed)) continue;
      if (hidden.has((m.positionName || '').toLowerCase())) continue;
      if (rosterTeamId && positionTeam && positionTeam.get((m.positionName || '').toLowerCase()) !== rosterTeamId) continue;
      if (day && m.days.length > 0 && !m.days.includes(day)) continue;
      const key = m.personId ? `id:${m.personId}` : `name:${String(m.personName || '').toLowerCase()}`;
      const role = m.positionName || 'Team';
      const person = people.get(key);
      if (!person) people.set(key, { name: m.personName, position: role, positions: [role], photoUrl: m.photoUrl });
      else {
        if (!person.positions.includes(role)) person.positions.push(role);
        if (!person.photoUrl && m.photoUrl) person.photoUrl = m.photoUrl;
      }
    }
    const roster = [...people.values()];

    const order = items.map((it) => ({
      type: it.type,
      title: it.title,
      description: it.description,
      length: it.length,
      keyName: it.keyName,
      live: it.id === liveItemId,
    }));
    const liveIndex = order.findIndex((it) => it.live);
    const liveItem = liveIndex >= 0 ? order[liveIndex] : null;
    // Nearest actual content item on either side of the live one — skips
    // section headers (e.g. "WORSHIP"), which have no description worth
    // showing, so "previous/next" means the last/next song or item.
    const nearestContentItem = (step) => {
      if (liveIndex < 0) return null;
      for (let i = liveIndex + step; i >= 0 && i < order.length; i += step) {
        if (order[i].type !== 'header') return order[i];
      }
      return null;
    };
    const previousItem = nearestContentItem(-1);
    const nextItem = nearestContentItem(1);
    // The Planning Center card. A weekend plan's days (Sat 5 PM; Sun 9 and
    // 11 AM) are told apart: "This service" is the day being served now, with
    // its times, and Coming up starts with the plan's later days, then the
    // next plans.
    const { days, current } = schedule;
    const thisDay = current >= 0 ? days[current] : null;
    const laterDays = current >= 0 ? days.slice(current + 1) : [];
    const upcoming = [
      ...laterDays.map((d) => ({ title: plan.title, seriesTitle: plan.seriesTitle, date: d.times[0], times: d.times, url: plan.url })),
      ...upcomingPlans.filter((p) => p.id !== plan.id).map((p) => ({ title: p.title, seriesTitle: p.seriesTitle, date: p.date, url: p.url })),
    ].slice(0, 3);

    return reply({
      ok: true,
      plan: { title: plan.title, seriesTitle: plan.seriesTitle || null, date: thisDay ? thisDay.times[0] : plan.date, times: thisDay ? thisDay.times : [], url: plan.url || null },
      upcoming,
      pcoHome: require('./pco-client').PCO_WEB,
      engineer: match ? { name: match.personName, photoUrl: match.photoUrl, personId: match.personId || null } : null,
      roster,
      rosterTeamName,
      order,
      liveItem,
      previousItem,
      nextItem,
      consoleConnected,
      connectionCount,
    });
  } catch (err) {
    // temporary: worth keeping what's showing (no answer, too many requests);
    // otherwise (a wrong login, a plan that's gone) the page shows the error
    return reply({ ok: false, error: err.message, status: err.status || null, temporary: require('./pco-client').isTemporary(err), consoleConnected, connectionCount });
  }
}

module.exports = { mountFoh, ROLES, hasFohAccess };
