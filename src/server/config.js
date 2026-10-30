const path = require('path');
const { app } = require('electron');
const { writeFileAtomic, loadJsonObject } = require('./safe-write');

const DEFAULTS = {
  autoStart: true,
  // Custom branding (Settings → Branding): a logo file stored in
  // userData/branding, and an accent color. '' = the JPMixer logo and red.
  brandLogo: '',
  brandAccent: '',
  // Stop the Mac sleeping while the server runs: a sleeping booth Mac drops
  // every phone mid-service. The display can still turn off.
  keepAwake: true,
  // Mirrors the OS login item (main.js reconciles it at launch, since it can
  // also be removed in System Settings). Not restored from backups: it
  // belongs to this Mac.
  openAtLogin: false,
  serverPort: 8080,
  consoleType: 'digico',
  deskIp: '192.168.1.100',
  deskSendPort: 8000,
  deskListenPort: 8001,
  channels: 48,
  auxes: 16,
  groups: 8, // DiGiCo Control Groups — a fallback until the desk reports its own count
  channelGroups: [],
  channelOverrides: {},
  auxOverrides: {},
  sceneRecallEnabled: false,
  // false hides Ear Scenes (menu item and the Saved / Not Saved button) on
  // performers' phones. Saved Ear Scenes are kept; see mixer.js hasSavedScene.
  performerEarScenes: true,
  ipadConnections: [],
  autoBackupEnabled: true,
  autoBackupIntervalDays: 7,
  demoMode: false,
  // dLive (MIDI over TCP/IP) — only read when consoleType is 'dlive'. Reuses
  // deskIp above for the console's address, same as the DiGiCo path does.
  dliveBaseChannel: 0,
  dliveTlsEnabled: false,
  dliveUsername: '',
  dlivePassword: '',
  // 0 = use the spec-documented default (51325, or 51327 with TLS). Override
  // if that port doesn't respond on real hardware — see the port note in
  // dlive-client.js's file header.
  dliveMidiPort: 0,
  // How to keep aux send levels in sync — see dlive-server.js's file header.
  // Both on by default until push is confirmed reliable on real hardware.
  dliveListenSendLevels: true,
  dlivePollSendLevels: true,
  // A musician's mute: the send's own on/off (true), or its level to -inf and back (false)
  dliveMuteBySendOff: true,
  // Pan on the stereo mixes, through the protocol dLive's own apps use (TCP 51321)
  dlivePan: true,
  // How many FX returns (0-16) every mix has after the inputs, as channels 129 on
  dliveFxReturns: 0,
  // KLANG (for dLive consoles) — only read when consoleType is 'klang'. The
  // dLive* fields above are reused for this mode's optional secondary
  // connection (channel names + Ear Scene sync) — see klang-server.js.
  klangIp: '',
  klangPort: 0, // 0 = use the documented default (9110)
  // Behringer WING — only read when consoleType is 'wing'. Reuses deskIp
  // above for the console's address, same as the DiGiCo/dLive paths do —
  // WING is self-contained, no secondary connection needed.
  wingPort: 0, // 0 = use the documented default (2223)
  // Waves eMotion LV1 — only read when consoleType is 'lv1'. deskIp is the
  // LV1 computer (blank = this computer). LV1 picks its MyMon port at launch,
  // so 0 finds it; a number pins it. See lv1-server.js.
  lv1Port: 0,
  // External Control API (Companion/Stream Deck/Planning Center) — a
  // separate always-on server, independent of the console backend. See
  // api-server.js. Off by default; apiToken is generated on first enable.
  apiEnabled: false,
  apiPort: 9096,
  apiToken: '',
  // Planning Center Services — auto-labels aux mixes from the schedule
  // (Settings' "Planning Center" tab). Credentials stored the same way
  // dlivePassword/apiToken already are; see pco-client.js.
  // Planning Center as a whole (Settings → Planning Center → Use Planning
  // Center). Off: get() answers '' for its credentials, so JPMixer never
  // contacts it and everything that needs it hides as when it isn't set up;
  // the credentials and the rest stay saved for when it's turned back on.
  pcoEnabled: true,
  pcoAppId: '',
  pcoSecret: '',
  pcoServiceTypeId: '',
  pcoTeamId: '',           // '' = all teams. Narrows both the Position mapping table (display only)
                           // and the Green Room display (actually filters who's shown there).
  pcoDay: 'auto',          // 'auto' = follow the plan's services each time it's checked: the one
                           // on now (until 90 min after it ends), else the next (not literally
                           // today's date; see pco-client.js serviceDays). '' = every day. "Saturday"/"Sunday"/etc pins one
                           // explicitly. Narrows both the Green Room display and Sync Now's aux
                           // labeling — for a weekend plan with multiple PlanTimes. See pco-client.js.
  pcoPositionMapping: {}, // { "PCO position name": auxNumber }
  // An optional second service (a Wednesday night, another event) that takes
  // over on a day it has a plan and the main one doesn't — see pco-services.js.
  // { enabled, serviceTypeId, teamId, positionMapping: { position: aux, 0 = not
  // on a mix }, roles: { <Home page role id, see home-roles.js>: { team, position } } }
  pcoAlt: { enabled: false, serviceTypeId: '', teamId: '', positionMapping: {}, roles: {} },
  pcoIncludeUnconfirmed: false,
  pcoGreenRoomHidden: [], // PCO position names to exclude from the Green Room display; empty = show everyone
  greenRoomQr: true, // the Green Room shows a QR code that opens the aux picker on a phone (greenroom.js)
  greenRoomMics: true,    // the Green Room shows each person's mic battery while it's on (Shure wireless, by their mix)
  greenRoomSpl: false,    // the Green Room shows an SPL reading from Smaart (needs smaartEnabled)
  greenRoomSplMetric: '', // which reading; '' = automatic (LAeq 10, then SPL A Slow)
  greenRoomSplInput: '',  // which Smaart input ("device/channel"); '' = the first one FOH Home's card shows
  pcoPhoneAssignments: false, // opt-in person identity and automatic phone aux selection
  pcoUpdateAuxNames: true, // false = Planning Center only drives the Green Room display; Sync Now and
                           // the automatic sync at launch/save skip renaming aux channels entirely.
  pcoFohPositionName: '', // '' = FOH Engineer Home page not set up. A Team Position name (e.g. "Audio
                          // Engineer FOH") — can be from any team, independent of pcoTeamId (which
                          // only filters the musician aux-mapping table/Green Room). See foh.js.
  pcoFohTeamId: '',       // paired with pcoFohPositionName — disambiguates the same position name
                          // existing on more than one team (real in this account's own schedule,
                          // e.g. "Team Lead").
  // The same pairing for the ProPresenter, Lighting and Switcher Home pages
  // (role.html via foh.js): who is welcomed and whose team is shown.
  pcoProPresenterPositionName: '',
  pcoProPresenterTeamId: '',
  pcoLightingPositionName: '',
  pcoLightingTeamId: '',
  pcoSwitcherPositionName: '',
  pcoSwitcherTeamId: '',
  pcoProducerPositionName: '',
  pcoProducerTeamId: '',
  // Home pages the church adds for other roles (Settings → Planning Center →
  // Home pages): [{ id: 10 hex characters, name, position, team }] — see home-roles.js
  pcoHomePages: [],
  // Optional code for FOH Home on other devices ('' = open). See foh.js.
  fohAccessCode: '',
  consoleAccessCode: '', // the Console Controller's code (access.js); '' = none
  // Companion buttons on the Home pages: JPMixer connects to Companion as a
  // Satellite and registers one surface per Home page. See companion-satellite.js.
  // Shure wireless monitoring (read-only, off by default) — see shure-wireless.js.
  // wirelessReceivers: [{ ip }], the receivers to read; others are only listed.
  wirelessEnabled: false,
  wirelessReceivers: [],
  companionEnabled: false,
  companionHome: true, // the Home pages' surfaces; off: Companion for Custom Pages only
  companionHost: '',
  companionPort: 16622,
  companionColumns: 8,
  companionRows: 4,
  // Smaart SPL on FOH Home: JPMixer reads levels from Smaart's API (read-only). See smaart.js.
  // Shure wireless (shure-wireless.js): receivers remembered, and which mix each channel belongs to
  wirelessKnown: [], // [{ id, ip, model }] every receiver seen; saved by shure-wireless.js
  wirelessAux: {},   // { "id/channel": aux }
  smaartEnabled: false,
  // Plugins (plugins.js): which ones are on, and their settings, are in
  // plugins.json. This was the Allow plugins switch; since 2.0.15 it only
  // marks that main.js has done its once-only move over (see save()).
  pluginsEnabled: false,
  smaartHost: '',
  smaartPort: 26000,
  smaartPassword: '', // Smaart's API password, only if one is set in Smaart
  smaartMetric: '',   // the big reading on the card; '' = automatic (LAeq 10, then SPL A Slow)
  smaartLiveMetric: '', // the smaller live reading under it; '' = automatic (SPL A Slow), 'none' = off
  smaartHiddenInputs: [] // "device/channel" of Smaart inputs left off the card (its options button)
};

// Console types with a backend. Settings once offered X32/M32, Yamaha and
// Custom OSC too, which quietly ran the DiGiCo backend — a config (or
// restored backup) still naming one of those is read as DiGiCo, which is
// what it was actually running.
const CONSOLE_TYPES = ['digico', 'dlive', 'klang', 'wing', 'lv1'];

function normalize(cfg) {
  if (!CONSOLE_TYPES.includes(cfg.consoleType)) cfg.consoleType = 'digico';
  delete cfg.matrices; // never read by anything
  return cfg;
}

let _config = { ...DEFAULTS };
let _configPath = null;

function configPath() {
  if (!_configPath) {
    _configPath = path.join(app.getPath('userData'), 'config.json');
  }
  return _configPath;
}

function load() {
  // An unreadable config.json used to fall back to defaults silently, and the
  // next Save & Apply then overwrote it — losing channel names, groups and
  // console settings. Now it's moved aside and the newest auto-backup's copy used.
  let corrupt = false;
  const data = loadJsonObject(configPath(), app.getPath('userData'), 'config',
    (msg) => { corrupt = true; console.error('[JPMixer] ' + msg); });
  if (data) _config = normalize({ ...DEFAULTS, ...data });
  if (corrupt) save(_config);
}

// Returns true/false (and rolls the in-memory config back on failure) —
// same pattern as presets.js's persist()/savePreset(). Previously this
// swallowed a write failure silently: Settings' Save & Apply would still
// report success to the user even if config.json didn't actually get
// written (full disk, permissions), so the change would silently not
// survive a restart with no indication anything went wrong.
function save(incoming) {
  const previous = _config;
  _config = normalize({ ...DEFAULTS, ...incoming });
  // Settings doesn't send pluginsEnabled any more, and an older backup has it
  // off: once true it stays true, or the next launch would turn the plugins
  // that aren't JPMixer's own off again
  if (previous && previous.pluginsEnabled === true) _config.pluginsEnabled = true;
  try {
    writeFileAtomic(configPath(), JSON.stringify(_config, null, 2));
    return true;
  } catch (e) {
    console.error('Config save error:', e);
    _config = previous;
    return false;
  }
}

function get(key) {
  if ((key === 'pcoAppId' || key === 'pcoSecret') && get('pcoEnabled') === false) return '';
  return _config[key] !== undefined ? _config[key] : DEFAULTS[key];
}

function getAll() {
  return { ..._config };
}

// Targeted write for one channel/aux override field — used by the Control
// API's live relabeling path (api-server.js + each backend's
// setChannelLabel/setAuxLabel). Deliberately separate from save(): it patches
// just one entry in-place rather than replacing the whole config, so callers
// never need to go through the main.js save-config IPC path that restarts
// the active console backend.
function updateOverride(kind, n, patch) {
  return updateOverrides(kind, { [n]: patch });
}
// Several entries in one write: { n: patch }. A patch value of undefined
// removes that field.
function updateOverrides(kind, patches) {
  const key = kind === 'aux' ? 'auxOverrides' : 'channelOverrides';
  const previous = _config;
  const bucket = { ..._config[key] };
  for (const [n, patch] of Object.entries(patches)) {
    const entry = { ...(bucket[String(n)] || {}), ...patch };
    for (const [field, value] of Object.entries(patch)) if (value === undefined) delete entry[field];
    bucket[String(n)] = entry;
  }
  _config = { ..._config, [key]: bucket };
  try {
    writeFileAtomic(configPath(), JSON.stringify(_config, null, 2));
    return true;
  } catch (e) {
    console.error('Config save error:', e);
    _config = previous;
    return false;
  }
}

load();
module.exports = { get, getAll, save, updateOverride, updateOverrides, CONSOLE_TYPES };
