const path = require('path');
const { app } = require('electron');
const { writeFileAtomic, loadJsonObject } = require('./safe-write');

const DEFAULTS = {
  autoStart: true,
  serverPort: 8080,
  consoleType: 'digico',
  deskIp: '192.168.1.100',
  deskSendPort: 8000,
  deskListenPort: 8001,
  channels: 48,
  auxes: 16,
  groups: 8,
  matrices: 8,
  channelGroups: [],
  channelOverrides: {},
  auxOverrides: {},
  sceneRecallEnabled: false,
  clearScenesOnLaunch: false,
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
  // KLANG (for dLive consoles) — only read when consoleType is 'klang'. The
  // dLive* fields above are reused for this mode's optional secondary
  // connection (channel names + Ear Scene sync) — see klang-server.js.
  klangIp: '',
  klangPort: 0, // 0 = use the documented default (9110)
  // Behringer WING — only read when consoleType is 'wing'. Reuses deskIp
  // above for the console's address, same as the DiGiCo/dLive paths do —
  // WING is self-contained, no secondary connection needed.
  wingPort: 0, // 0 = use the documented default (2223)
  // External Control API (Companion/Stream Deck/Planning Center) — a
  // separate always-on server, independent of the console backend. See
  // api-server.js. Off by default; apiToken is generated on first enable.
  apiEnabled: false,
  apiPort: 9096,
  apiToken: '',
  // Planning Center Services — auto-labels aux mixes from the schedule
  // (Settings' "Planning Center" tab). Credentials stored the same way
  // dlivePassword/apiToken already are; see pco-client.js.
  pcoAppId: '',
  pcoSecret: '',
  pcoServiceTypeId: '',
  pcoTeamId: '',           // '' = all teams. Narrows both the Position mapping table (display only)
                           // and the Green Room display (actually filters who's shown there).
  pcoPositionMapping: {}, // { "PCO position name": auxNumber }
  pcoIncludeUnconfirmed: false,
  pcoGreenRoomHidden: [] // PCO position names to exclude from the Green Room display; empty = show everyone
};

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
  if (data) _config = { ...DEFAULTS, ...data };
  if (corrupt) save(_config);
}

function save(incoming) {
  _config = { ...DEFAULTS, ...incoming };
  try {
    writeFileAtomic(configPath(), JSON.stringify(_config, null, 2));
  } catch (e) {
    console.error('Config save error:', e);
  }
}

function get(key) {
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
  const key = kind === 'aux' ? 'auxOverrides' : 'channelOverrides';
  const bucket = { ..._config[key] };
  bucket[String(n)] = { ...(bucket[String(n)] || {}), ...patch };
  _config = { ..._config, [key]: bucket };
  try {
    writeFileAtomic(configPath(), JSON.stringify(_config, null, 2));
  } catch (e) {
    console.error('Config save error:', e);
  }
}

load();
module.exports = { get, getAll, save, updateOverride };
