const { app, BrowserWindow, Tray, Menu, nativeImage, nativeTheme, ipcMain, shell, dialog, powerSaveBlocker } = require('electron');
const path  = require('path');
const os    = require('os');
const fs    = require('fs');
const { exec } = require('child_process');

const GITHUB_REPO = 'JPMixing-inc/jpmixer';

// Last-resort net: an error nothing else caught is logged to errors.log in
// the app's data folder, instead of Electron's modal error dialog popping
// up on the engineer's screen mid-service.
function logFatal(kind, err) {
  const line = `${new Date().toISOString()} ${kind}: ${(err && err.stack) || String(err)}\n`;
  console.error('[JPMixer]', line.trim());
  try { if (app.isReady()) fs.appendFileSync(path.join(app.getPath('userData'), 'errors.log'), line); } catch (_) {}
}
process.on('uncaughtException', (err) => logFatal('uncaughtException', err));
process.on('unhandledRejection', (err) => logFatal('unhandledRejection', err));

// One copy only — a second would fight the first over the HTTP/OSC ports and
// the JSON data files. Launching again just brings up Settings in the first.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  // During the launch splash nothing is loaded yet; open it once startup ends
  app.on('second-instance', () => { if (startupDone) openSettings(); else settingsRequestedDuringStartup = true; });
}
let startupDone = false;
let settingsRequestedDuringStartup = false;

// > 0 when a is newer than b. Handles x.y.z and x.y.z-prerelease (a
// prerelease sorts before its release, e.g. 1.1.6-beta.1 < 1.1.6).
function compareVersions(a, b) {
  const parse = (v) => {
    const [core, pre] = String(v).split('-', 2);
    return { nums: core.split('.').map(n => parseInt(n, 10) || 0), pre: pre || null };
  };
  const A = parse(a), B = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (A.nums[i] || 0) - (B.nums[i] || 0);
    if (d) return d;
  }
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1;
  if (!B.pre) return -1;
  return A.pre.localeCompare(B.pre, undefined, { numeric: true });
}

// ─── Message boxes ───────────────────────────────────────────────────────────
// A native message box with no parent window is app-modal on macOS: it
// blocks the main process, so the phone server stopped answering (and every
// timer stopped) until someone clicked it. The launch update check left one
// up unattended. Messages now go to Settings as a sheet when it's open, and
// otherwise to JPMixer's own small window (src/windows/prompt). Same
// options and { response } result as dialog.showMessageBox.
const promptChoices = new Map(); // webContents id -> finish(index)
ipcMain.on('prompt-choice', (e, index) => { const finish = promptChoices.get(e.sender.id); if (finish) finish(index); });
ipcMain.on('prompt-resize', (e, height) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || !promptChoices.has(e.sender.id)) return;
  win.setContentSize(460, Math.min(Math.max(120, Math.round(Number(height) || 0)), 640));
  win.center();
  if (!win.isVisible()) { win.show(); app.focus({ steal: true }); }
});

function showPrompt(options) {
  const opts = { type: 'info', buttons: ['OK'], defaultId: 0, ...options };
  if (!Number.isInteger(opts.cancelId)) opts.cancelId = opts.buttons.length > 1 ? 1 : 0;
  if (settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible()) {
    return dialog.showMessageBox(settingsWindow, opts); // a sheet: doesn't block
  }
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 460, height: 200, show: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      title: opts.title || 'JPMixer', backgroundColor: '#15171c',
      icon: path.join(__dirname, 'assets', 'brand', 'app-icon.png'),
      webPreferences: { preload: path.join(__dirname, 'src', 'windows', 'prompt', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    const id = win.webContents.id;
    let settled = false;
    const finish = (index) => {
      if (settled) return;
      settled = true;
      promptChoices.delete(id);
      if (!win.isDestroyed()) win.destroy();
      resolve({ response: Number.isInteger(index) && index >= 0 && index < opts.buttons.length ? index : opts.cancelId });
    };
    promptChoices.set(id, finish);
    win.on('closed', () => finish(opts.cancelId));
    win.webContents.once('did-finish-load', () => {
      const view = { title: opts.title, type: opts.type, message: opts.message, detail: opts.detail, buttons: opts.buttons, defaultId: opts.defaultId, cancelId: opts.cancelId };
      win.webContents.executeJavaScript(`render(${JSON.stringify(view)})`).catch(() => finish(opts.cancelId));
    });
    win.loadFile(path.join(__dirname, 'src', 'windows', 'prompt', 'index.html'));
  });
}

// ─── Updates ─────────────────────────────────────────────────────────────────
// Checks GitHub Releases and, when a newer version is out, offers to install
// it in place: download, verify against GitHub's published SHA-256, swap the
// app and reopen (see src/server/updater.js). Falls back to opening the
// release page when this build can't install itself.
const updater = require('./src/server/updater');
const RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases/latest`;
// For testing the install flow against a local feed; loopback only
const TEST_UPDATE_FEED = updater.isLoopbackUrl(process.env.JPMIXER_UPDATE_FEED) ? process.env.JPMIXER_UPDATE_FEED : null;
// releases/latest is the newest full release: drafts and pre-releases (betas)
// are never offered to everyone. A beta build (a version like 2.0.0-beta.1)
// also looks at the pre-releases, so testers get the next beta or the final.
const UPDATE_FEED = TEST_UPDATE_FEED || `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const BETA_UPDATE_FEED = TEST_UPDATE_FEED || `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=20`;
const isBetaBuild = () => /-/.test(app.getVersion());
let updateInProgress = false;

function updateCheckFailed(silent) {
  if (!silent) showPrompt({ type: 'error', title: 'Update Check Failed', message: 'Could not reach GitHub. Check your internet connection.', buttons: ['OK'] });
}

// The first part of the release write-up, as plain text for the dialog
function releaseSummary(body) {
  const text = String(body || '').replace(/\r/g, '').replace(/^#+\s*/gm, '').replace(/\*\*|__|`/g, '').replace(/\n{3,}/g, '\n\n').trim();
  // The dialog already says "What's new"; drop the release's own heading for it
  const lines = text.split('\n');
  if (/^what.?s new:?$/i.test((lines[0] || '').trim())) lines.shift();
  const textOut = lines.join('\n').trim();
  return textOut.length > 600 ? textOut.slice(0, 600).replace(/\s+\S*$/, '') + '…' : textOut;
}

async function checkForUpdates(silent = false) {
  if (updateInProgress) return;
  let release;
  try {
    const beta = isBetaBuild();
    const feed = await updater.getJson(beta ? BETA_UPDATE_FEED : UPDATE_FEED, { allowLoopback: !!TEST_UPDATE_FEED });
    // Newest version among the releases this build may be offered (a list for
    // betas and test feeds; releases/latest is a single release)
    const offered = (Array.isArray(feed) ? feed : [feed]).filter(r => r && r.tag_name && !r.draft && (beta || !r.prerelease));
    offered.sort((a, b) => compareVersions(String(b.tag_name).replace(/^v/, ''), String(a.tag_name).replace(/^v/, '')));
    release = offered[0];
    if (!release) throw new Error('No releases');
  } catch (_) {
    return updateCheckFailed(silent);
  }
  const latest = String(release.tag_name || '').replace(/^v/, '');
  const current = app.getVersion();
  // Only when the release is actually newer — a plain !== also fired
  // for a build newer than the latest release (e.g. a local test build)
  if (!latest || compareVersions(latest, current) <= 0) {
    if (!silent) showPrompt({ type: 'info', title: 'Up to Date', message: `JPMixer ${current} is the latest version.`, buttons: ['OK'] });
    return;
  }

  const asset = updater.pickAsset(release);
  const canInstall = app.isPackaged && !!asset && !!updater.expectedSha256(asset) && ['darwin', 'win32'].includes(process.platform);
  const phones = serverRunning && server ? server.getConnectionCount() : 0;
  const summary = releaseSummary(release.body);
  const detail = [
    `You're running ${current}.`,
    canInstall
      ? `Install & Restart downloads it from GitHub, checks it, and reopens JPMixer${phones ? ` — the ${phones} connected device${phones === 1 ? '' : 's'} will reconnect after about a minute` : ''}.`
      : 'Click Download to get it from GitHub.',
    summary ? `\nWhat's new:\n${summary}` : ''
  ].filter(Boolean).join('\n');
  const buttons = canInstall ? ['Install & Restart', 'Later', 'Release Notes'] : ['Download', 'Later'];
  for (;;) {
    const { response } = await showPrompt({ type: 'info', title: 'Update Available', message: `JPMixer ${latest} is available`, detail, buttons, defaultId: 0, cancelId: 1 });
    if (!canInstall) { if (response === 0) shell.openExternal(release.html_url || RELEASES_PAGE); return; }
    if (response === 2) { shell.openExternal(release.html_url || RELEASES_PAGE); continue; } // then ask again
    if (response === 0) installUpdate(release, asset, latest);
    return;
  }
}

async function installUpdate(release, asset, version) {
  if (updateInProgress) return;
  updateInProgress = true;
  const win = new BrowserWindow({
    width: 420, height: 190, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    title: 'Updating JPMixer', backgroundColor: '#15171c', show: false,
    icon: path.join(__dirname, 'assets', 'brand', 'app-icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'src', 'windows', 'update', 'index.html'));
  await loaded;
  const show = (fraction, text, title) => {
    if (!win.isDestroyed()) win.webContents.executeJavaScript(`show(${JSON.stringify(fraction)}, ${JSON.stringify(text)}, ${JSON.stringify(title || null)})`).catch(() => {});
  };
  show(0, 'Downloading…', `Updating to JPMixer ${version}`);

  const workDir = updater.makeWorkDir();
  try {
    const file = path.join(workDir, asset.name.replace(/[^\w.-]/g, '_'));
    const mb = Math.round((asset.size || 0) / 1e6);
    let shown = -1;
    await updater.download(asset, file, {
      allowLoopback: !!TEST_UPDATE_FEED,
      onProgress: (f) => { const pct = Math.floor(f * 100); if (pct !== shown) { shown = pct; show(f, `Downloading… ${pct}% of ${mb} MB`); } }
    });

    if (process.platform === 'darwin') {
      const target = updater.currentMacBundle(app.getPath('exe'));
      if (!target) {
        // Not somewhere it can replace itself (run from the DMG, or a folder
        // this account can't write to): hand over the verified installer
        if (!win.isDestroyed()) win.destroy();
        updateInProgress = false;
        await shell.openPath(file);
        showPrompt({ type: 'info', title: 'Finish Installing', message: `JPMixer ${version} has been downloaded and checked.`, detail: 'JPMixer can’t replace itself from where it’s running, so the installer is open now. Quit JPMixer, then drag the new JPMixer into Applications.', buttons: ['OK'] });
        return;
      }
      show(null, 'Checking the download…');
      // Once this JPMixer is signed, only an update from the same developer is installed
      const requireTeam = await updater.macSigningTeam(target);
      const staged = await updater.stageMacApp(file, workDir, version, { requireTeam });
      show(1, 'Restarting JPMixer…', `Installing JPMixer ${version}`);
      updater.launchMacSwap({ pid: process.pid, target, staged, workDir });
    } else {
      show(null, 'Starting the installer…', `Installing JPMixer ${version}`);
      updater.launchWindowsInstaller(file);
    }
    // Quitting stops the server the usual way first (muted sends restored)
    setTimeout(() => app.quit(), 800);
  } catch (err) {
    updateInProgress = false;
    if (!win.isDestroyed()) win.destroy();
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
    console.error('[JPMixer] Update failed:', err);
    const { response } = await showPrompt({
      type: 'error', title: 'Update Failed', message: 'JPMixer couldn’t install the update.',
      detail: `${err.message}\n\nNothing was changed. You can download it from GitHub instead.`,
      buttons: ['Open Release Page', 'OK'], defaultId: 0, cancelId: 1
    });
    if (response === 0) shell.openExternal(release.html_url || RELEASES_PAGE);
  }
}

function sameSubnet(a, b, mask) {
  const toNum = ip => ip.split('.').reduce((acc, oct) => ((acc << 8) >>> 0) + parseInt(oct, 10), 0);
  const m = toNum(mask);
  return (toNum(a) & m) === (toNum(b) & m);
}

function getLocalIP() {
  // Prefer the interface whose subnet contains the configured console IP — avoids
  // returning a VPN or Ethernet address when the desk is on Wi-Fi (or vice versa).
  const deskIp = config ? config.get('deskIp') : null;
  let fallback = null;
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      if (!fallback) fallback = iface.address;
      if (deskIp && iface.netmask && sameSubnet(iface.address, deskIp, iface.netmask)) return iface.address;
    }
  }
  return fallback;
}

let tray = null;
let settingsWindow = null;
let serverRunning = false;
let serverStopping = null; // the in-flight stop, so startServer() can wait it out

// Lazy-require so config uses app.getPath after app is ready
let config, server, presets, scenes, autoBackup;
// All four console backends are required up front but only one is ever
// started — `server` is just a reference picked by console type in
// startServer(). Each is a fully separate module from the others; picking
// between them here is the only place any of them meet.
let oscServer, dliveServer, klangServer, wingServer;
// External Control API (Companion/Stream Deck/Planning Center) — a
// separate, always-on server independent of the console backend above.
// See api-server.js's file header for why it's kept entirely decoupled.
let apiServer;
// Planning Center Services client — pure HTTP wrapper, no server lifecycle
// of its own (unlike apiServer above), just required alongside everything
// else for consistency.
let pcoClient;
// Tracks which Ear Scenes keying scheme ('name' vs 'number') was last
// active, so a Console Type change that crosses that boundary (not just a
// Start/Stop of the same one) can clear stale entries — see startServer().
let lastSceneKeyScheme = null;

// ─── Launch splash ───────────────────────────────────────────────────────────
// The app lives in the menu bar, so a launch otherwise shows nothing at all.
// The JPMixer wordmark pops up on a transparent, click-through window while
// startup runs, then fades out (see src/windows/splash). Skipped when macOS
// opens the app at login.
const SPLASH_MIN_MS = 2900; // long enough for the pop and both glare sweeps
const SPLASH_MAX_MS = 6000;
const SPLASH_FADE_MS = 900; // matches .stage.out in the splash page

function showSplash() {
  if (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin) return null;
  const splash = new BrowserWindow({
    width: 640, height: 240, show: false, frame: false, transparent: true, hasShadow: false,
    backgroundColor: '#00000000', resizable: false, movable: false, focusable: false,
    alwaysOnTop: true, skipTaskbar: true, fullscreenable: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  splash.setIgnoreMouseEvents(true);
  const shownAt = Date.now();
  const loaded = new Promise((resolve) => {
    splash.once('ready-to-show', () => { if (!splash.isDestroyed()) splash.showInactive(); resolve(); });
    setTimeout(resolve, 1500); // never hold up startup on it
  });
  // Always the JPMixer wordmark, even with custom branding set
  splash.loadFile(path.join(__dirname, 'src', 'windows', 'splash', 'index.html'));
  let closing = false;
  function close() {
    if (closing || splash.isDestroyed()) return;
    closing = true;
    splash.webContents.executeJavaScript("document.getElementById('stage').classList.add('out')").catch(() => {});
    setTimeout(() => { if (!splash.isDestroyed()) splash.destroy(); }, SPLASH_FADE_MS + 100);
  }
  const maxTimer = setTimeout(close, SPLASH_MAX_MS);
  return {
    loaded,
    // Called once startup is done; waits out the rest of the animation
    done() { clearTimeout(maxTimer); setTimeout(close, Math.max(0, SPLASH_MIN_MS - (Date.now() - shownAt))); }
  };
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  if (process.platform === 'darwin') app.dock.setIcon(path.join(__dirname, 'assets', 'brand', 'app-icon.png'));
  // Requiring the backends below blocks the main process for a moment; let
  // the splash load first so it isn't stuck waiting on that
  const splash = showSplash();
  if (splash) await splash.loaded;
  config     = require('./src/server/config');
  oscServer  = require('./src/server/osc-server');
  dliveServer = require('./src/server/dlive-server');
  klangServer = require('./src/server/klang-server');
  wingServer  = require('./src/server/wing-server');
  server     = oscServer;
  presets    = require('./src/server/presets');
  scenes     = require('./src/server/scenes');
  autoBackup = require('./src/server/auto-backup');
  autoBackup.start();
  for (const s of [oscServer, dliveServer, klangServer, wingServer]) {
    s.setConsoleStatusCallback(broadcastConsoleStatus);
    s.setConnectionCountCallback(broadcastConnectionCount);
    s.setServerErrorCallback(handleServerError);
    s.setOscTrafficCallback(broadcastOscTraffic);
  }

  syncOpenAtLoginFromOs();
  require('./src/server/branding').pruneLogos(); // uploaded in Settings but never saved
  apiServer = require('./src/server/api-server');
  apiServer.applyConfig(config.getAll());
  require('./src/server/companion-satellite').applyConfig(config.getAll());
  pcoClient  = require('./src/server/pco-client');

  createTray();

  if (config.get('autoStart')) {
    startServer();
  }
  if (splash) splash.done();
  startupDone = true;
  if (settingsRequestedDuringStartup) openSettings();

  // Silent update check on launch — only notifies if a newer version exists
  setTimeout(() => checkForUpdates(true), 3000);
});

app.on('window-all-closed', (e) => {
  // Keep the app alive even when all windows are closed (tray-only)
  e.preventDefault();
});

// Every quit path (tray Quit, Cmd+Q, Dock, logout, shutdown) comes through
// here. Stopping sends muted channels' real levels back to the desk; quitting
// without it left them at -150. Capped at 1s so a quit can never hang.
let quitting = false;
app.on('before-quit', (e) => {
  try { require('./src/server/companion-satellite').stop(); } catch (_) {} // tells Companion to drop the surfaces
  if (quitting || !serverRunning || !server) return;
  e.preventDefault();
  quitting = true;
  Promise.race([stopServer(), new Promise(r => setTimeout(r, 1000))])
    .catch((err) => console.error('[JPMixer] Stop on quit failed:', err))
    .finally(() => app.exit(0));
});

// ─── Tray ────────────────────────────────────────────────────────────────────

function createTray() {
  const iconPath = path.join(__dirname, 'assets', process.platform === 'darwin' ? 'trayTemplate.png' : 'brand/app-icon.png');
  const source = nativeImage.createFromPath(iconPath);
  const icon = process.platform === 'darwin' ? source : source.resize({ width: 24, height: 24 });
  icon.setTemplateImage(process.platform === 'darwin');
  trayBaseIcon = icon;
  tray = new Tray(icon);
  tray.setToolTip('JPMixer');
  // The dotted icon is drawn in the menu bar's colour: redraw on light/dark changes
  nativeTheme.on('updated', () => { trayIconKey = ''; updateTrayIcon(); });
  rebuildTrayMenu();
}

// Green dot: server running and console connected. Red: anything else.
let trayBaseIcon = null, trayIconKey = '';
function updateTrayIcon() {
  if (!tray || !trayBaseIcon) return;
  const color = trayConsoleConnected ? 'green' : 'red';
  const dark = nativeTheme.shouldUseDarkColors;
  const key = `${color}:${dark}`;
  if (key === trayIconKey) return;
  const icon = require('./src/tray-icon').withStatusDot(trayBaseIcon, { color, dark, widen: process.platform === 'darwin' });
  if (!icon) return; // keep the plain icon rather than none
  trayIconKey = key;
  tray.setImage(icon);
}

// One window per view: picking a view that's already open brings it forward
const viewWindows = new Map();
function openView(page, title, width, height) {
  const open = viewWindows.get(page);
  if (open && !open.isDestroyed()) { if (open.isMinimized()) open.restore(); open.focus(); return; }
  const win = new BrowserWindow({
    icon: path.join(__dirname, 'assets', 'brand', 'app-icon.png'),
    width, height,
    title: `${title} — JPMixer`,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  viewWindows.set(page, win);
  win.on('closed', () => { if (viewWindows.get(page) === win) viewWindows.delete(page); });
  win.loadURL(`http://localhost:${config.get('serverPort')}/${page}`);
}

const CONSOLE_NAMES = { digico: 'DiGiCo', dlive: 'dLive', klang: 'KLANG', wing: 'WING' };

function rebuildTrayMenu() {
  const port = config.get('serverPort');
  const consoleName = CONSOLE_NAMES[config.get('consoleType')] || 'Console';
  trayConsoleConnected = serverRunning && !!(server && server.isConsoleConnected());
  updateTrayIcon();
  tray.setToolTip(`JPMixer — ${!serverRunning ? 'server stopped' : trayConsoleConnected ? consoleName + ' connected' : consoleName + ' not connected'}`);
  const view = (label, page, width, height) => ({ label, click: () => openView(page, label, width, height) });
  const menu = Menu.buildFromTemplate([
    { label: serverRunning ? `● Running on port ${port}` : '○ Stopped', enabled: false },
    { label: trayConsoleConnected ? `● ${consoleName} connected` : `○ ${consoleName} not connected`, enabled: false },
    { type: 'separator' },
    {
      label: 'Open',
      enabled: serverRunning,
      submenu: [
        view('Monitor Engineer', 'monitor.html', 1400, 900),
        view('Console Controller', 'console.html', 1600, 800),
        view('Devices', 'devices.html', 1280, 940),
        { type: 'separator' },
        view('Production View Select', 'home.html', 1100, 760),
        view('FOH Home', 'foh.html', 1100, 760),
        view('ProPresenter Home', 'propresenter.html', 1100, 760),
        view('Lighting Home', 'lighting.html', 1100, 760),
        view('Switcher Home', 'switcher.html', 1100, 760),
        { type: 'separator' },
        { label: 'Phone Mixer in Browser', click: () => shell.openExternal(`http://localhost:${port}`) }
      ]
    },
    { label: 'Settings…', click: openSettings },
    { type: 'separator' },
    { label: serverRunning ? 'Stop Server' : 'Start Server', click: () => (serverRunning ? stopServer() : startServer()) },
    { label: 'Check for Updates…', click: () => checkForUpdates(false) },
    // The before-quit handler restores the desk before exiting
    { label: 'Quit JPMixer', click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
}

// ─── Server lifecycle ─────────────────────────────────────────────────────────

// DiGiCo keys Ear Scenes by snapshot name; dLive, KLANG and WING by number.
function sceneKeySchemeFor(consoleType) {
  return ['dlive', 'klang', 'wing'].includes(consoleType) ? 'number' : 'name';
}

function startServer({ pcoSync = true } = {}) {
  // Start while already running, or while a stop is still closing sockets
  // (e.g. tray Start during a Save & Apply restart), bound the ports twice;
  // the second bind's error then stopped the first server too.
  if (serverRunning || serverStopping) return;
  const consoleType = config.get('consoleType');
  const family = consoleType === 'dlive' ? 'dlive' : consoleType === 'klang' ? 'klang' : consoleType === 'wing' ? 'wing' : 'digico';
  // Ear Scenes are keyed by snapshot *name* for DiGiCo and scene *number*
  // for dLive/KLANG (KLANG's backend reuses the paired dLive console's scene
  // number for the same reason the plain dLive backend does) — two
  // incompatible schemes sharing the same in-memory store, which normally
  // never matters (only one console type is ever active). But that store
  // only auto-clears once per app launch, not per server restart (by design
  // — Ear Scenes should survive a Start/Stop of the *same* console
  // mid-session). Switching between the name-keyed and number-keyed schemes
  // is the one case that would otherwise leave stale entries lingering,
  // mixed in with the new ones — dlive<->klang doesn't cross that boundary,
  // since both key by number, so only compare the *keying scheme*, not the
  // exact family, to avoid an unnecessary clear on that specific switch.
  // WING never produces a snapshot key at all (no scene/snapshot signal
  // over its OSC layer — see wing-protocol.js), so save-scene/recall-scene
  // are permanent no-ops there regardless of which scheme it's grouped
  // with; 'number' is picked arbitrarily for consistency with dlive/klang.
  const keyScheme = sceneKeySchemeFor(consoleType);
  // Ear Scenes always start empty on launch (see scenes.js's load()), so
  // there's nothing left over from a previous session's scheme for a fresh
  // launch to need to compare against — lastSceneKeyScheme starts null every
  // launch and this only ever fires for a scheme change *within* the
  // current running session (a Console Type switch via Settings).
  if (lastSceneKeyScheme !== null && lastSceneKeyScheme !== keyScheme && scenes) {
    if (Object.keys(scenes.getAll()).length > 0) {
      autoBackup.writeBackup('before-console-switch')
        .catch((err) => console.error('[JPMixer] Backup before console switch failed:', err));
    }
    scenes.clearForSchemeChange();
  }
  lastSceneKeyScheme = keyScheme;

  server = family === 'dlive' ? dliveServer : family === 'klang' ? klangServer : family === 'wing' ? wingServer : oscServer;
  try {
    server.start(config.getAll());
    serverRunning = true;
    apiServer.setActiveBackend(server);
    // Fire-and-forget — a Planning Center round trip shouldn't block the
    // tray menu/status broadcast below. Covers both auto-launch (autoStart)
    // and a manual Start Server click uniformly, so a saved setup stays in
    // sync without anyone needing to open Settings. Skipped for a Save &
    // Apply restart that didn't touch Planning Center settings — otherwise
    // it overwrote aux names the engineer had just edited (dLive/KLANG/WING
    // restart on every save).
    if (pcoSync) autoSyncPlanningCenter().catch((err) => console.error('[JPMixer/PCO] auto-sync error:', err));
  } catch (err) {
    console.error('Server start failed:', err);
    serverRunning = false;
    apiServer.setActiveBackend(null);
    // A throw part-way through start() left the HTTP server listening, so
    // the next Start failed with the port already in use.
    try { server.stop(); } catch (_) {}
  }
  rebuildTrayMenu();
  broadcastStatus();
}

// Resolves once the backend's sockets are closed (osc-server's UDP close is
// deferred a tick so its final sends go out) — await it before starting
// again on the same ports
async function stopServer() {
  if (!server) return;
  const closed = Promise.resolve(server.stop());
  serverStopping = closed;
  serverRunning = false;
  apiServer.setActiveBackend(null);
  rebuildTrayMenu();
  broadcastStatus();
  try { await closed; } finally { if (serverStopping === closed) serverStopping = null; }
}

// ─── Keep awake / open at login ──────────────────────────────────────────────
// While the server runs (and keepAwake is on), the Mac isn't allowed to
// sleep. A sleeping booth Mac drops every phone. The display can still turn off.
let awakeBlocker = null;
function updateKeepAwake() {
  const want = serverRunning && !!config && config.get('keepAwake') !== false;
  const active = awakeBlocker !== null && powerSaveBlocker.isStarted(awakeBlocker);
  if (want && !active) awakeBlocker = powerSaveBlocker.start('prevent-app-suspension');
  else if (!want && active) { powerSaveBlocker.stop(awakeBlocker); awakeBlocker = null; }
}

// The OS login item is the source of truth (it can be removed in System
// Settings → General → Login Items); only the installed app registers one,
// since a dev run would register the bare Electron binary.
function applyOpenAtLogin(enabled) {
  if (!app.isPackaged) return { ok: true, skipped: true };
  try { app.setLoginItemSettings({ openAtLogin: !!enabled }); } catch (e) { return { ok: false, error: e.message }; }
  const now = app.getLoginItemSettings();
  if (!!enabled === !!now.openAtLogin) return { ok: true };
  return now.status === 'requires-approval'
    ? { ok: false, needsApproval: true, error: 'Allow JPMixer in System Settings → General → Login Items to finish turning this on.' }
    : { ok: false, error: 'macOS didn’t accept the login item change.' };
}

function syncOpenAtLoginFromOs() {
  if (!app.isPackaged) return;
  const inOs = !!app.getLoginItemSettings().openAtLogin;
  if (inOs !== !!config.get('openAtLogin')) config.save({ ...config.getAll(), openAtLogin: inOs });
}

function broadcastStatus() {
  updateKeepAwake(); // every start, stop and failure comes through here
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('server-status', { running: serverRunning });
  }
}

let trayConsoleConnected = null; // what the tray menu last showed
function broadcastConsoleStatus(connected) {
  if (tray && !!connected !== trayConsoleConnected) rebuildTrayMenu();
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('console-status', { connected });
  }
}

function broadcastConnectionCount(count) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('connection-count', { count });
  }
}

function broadcastOscTraffic(batch) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('osc-traffic', batch);
  }
}

function handleServerError(err) {
  serverRunning = false;
  // The backend has stopped itself; without this the Control API kept
  // answering ok:true while nothing reached the console.
  apiServer.setActiveBackend(null);
  rebuildTrayMenu();
  broadcastStatus();
  showPrompt({
    type: 'error',
    title: 'Server Error',
    message: 'JPMixer’s server failed to start.',
    detail: `${err.message}\n\nCheck that no other app is using this port, then try again from Settings.`,
    buttons: ['OK']
  });
}

// ─── Settings window ──────────────────────────────────────────────────────────

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    icon: path.join(__dirname, 'assets', 'brand', 'app-icon.png'),
    width: 980,
    height: 820,
    minWidth: 760,
    minHeight: 640,
    resizable: true,
    title: 'JPMixer Settings',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'src', 'windows', 'settings', 'preload.js')
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'src', 'windows', 'settings', 'index.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ─── IPC ──────────────────────────────────────────────────────────────────────

ipcMain.handle('get-config', () => config.getAll());
ipcMain.handle('get-version', () => app.getVersion());
ipcMain.handle('get-server-status', () => ({ running: serverRunning }));
ipcMain.handle('get-local-ip', () => getLocalIP());
ipcMain.handle('get-channel-names',   () => serverRunning ? server.getChannelNames()     : {});
ipcMain.handle('get-aux-names',       () => serverRunning ? server.getAuxNames()         : {});
ipcMain.handle('get-channel-count',   () => serverRunning ? server.getChannelCount()      : null);
ipcMain.handle('get-aux-count',       () => serverRunning ? server.getAuxCount()          : null);
ipcMain.handle('get-console-status',      () => ({ connected: server ? server.isConsoleConnected() : false }));
ipcMain.handle('get-connection-count',    () => ({ count: server ? server.getConnectionCount() : 0 }));
ipcMain.handle('get-osc-log',             () => server ? server.getOscLog() : []);
ipcMain.handle('start-osc-log-recording',      () => server ? server.startOscLogRecording()      : { ok: false, error: 'Server not ready' });
ipcMain.handle('stop-osc-log-recording',       () => server ? server.stopOscLogRecording()       : { ok: false, error: 'Server not ready' });
ipcMain.handle('get-osc-log-recording-status', () => server ? server.getOscLogRecordingStatus()  : { recording: false });
ipcMain.handle('open-osc-logs-folder', () => {
  if (server) shell.openPath(server.oscLogRecordsFolder());
  return { ok: true };
});

ipcMain.handle('open-performer', async () => {
  if (!serverRunning) return { error: 'Server not running' };
  const port = Number(config.get('serverPort'));
  const host = getLocalIP() || 'localhost';
  const [target, listening] = await Promise.all([port80ForwardTarget(), port80Listening()]);
  // Use the same canonical address as Settings, so browser-saved mixes stay
  // on one origin whether the port-80 helper is active or not.
  const base = listening && target === port && host !== 'localhost' ? `http://${host}` : `http://${host}:${port}`;
  await shell.openExternal(base + '/');
  return { ok: true };
});

ipcMain.handle('open-monitor', () => {
  if (!serverRunning) return { error: 'Server not running' };
  const cfg = config.getAll();
  const win = new BrowserWindow({
    icon: path.join(__dirname, 'assets', 'brand', 'app-icon.png'),
    width: 1400, height: 900,
    title: 'Monitor Engineer — JPMixer',
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  win.loadURL(`http://localhost:${cfg.serverPort}/monitor.html`);
});

ipcMain.handle('open-console', () => {
  if (!serverRunning) return { error: 'Server not running' };
  const cfg = config.getAll();
  const win = new BrowserWindow({
    icon: path.join(__dirname, 'assets', 'brand', 'app-icon.png'),
    width: 1600, height: 800,
    title: 'Console Controller — JPMixer',
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  win.loadURL(`http://localhost:${cfg.serverPort}/console.html`);
});

ipcMain.handle('open-devices', () => {
  if (!serverRunning) return { error: 'Server not running' };
  const cfg = config.getAll();
  const win = new BrowserWindow({
    icon: path.join(__dirname, 'assets', 'brand', 'app-icon.png'),
    width: 1280, height: 940,
    title: 'Devices — JPMixer',
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  win.loadURL(`http://localhost:${cfg.serverPort}/devices.html`);
});

const PORT80_PROXY_DEST   = '/usr/local/bin/jpmixing-proxy.py';
const PORT80_PROXY_MARKER = 'jpmixing-proxy v2 (TCP_NODELAY)';

// Whether the port-80 helper is installed, and (macOS) whether it's the
// current proxy script. Settings uses this to show performers the port-80
// URL — http://<ip>/ and http://<ip>:8080/ are separate sites to a browser,
// each with its own My Mixes — and to offer re-running setup when the
// installed proxy predates TCP_NODELAY (updating it needs admin rights, so it
// can't be done silently).
const PORT80_PLIST_DEST = '/Library/LaunchDaemons/com.jpmixing.port80.plist';

// Is anything accepting connections on port 80 right now?
function port80Listening() {
  return new Promise(resolve => {
    const sock = require('net').connect({ host: '127.0.0.1', port: 80 });
    const done = (ok) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(500, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

// Which server port the installed helper forwards port 80 to (null if unknown)
function port80ForwardTarget() {
  return new Promise(resolve => {
    if (process.platform === 'win32') {
      exec('netsh interface portproxy show v4tov4', (err, stdout) => {
        const m = !err && /\b0\.0\.0\.0\s+80\s+\S+\s+(\d+)/.exec(stdout || '');
        resolve(m ? Number(m[1]) : null);
      });
      return;
    }
    // ProgramArguments = python3, the proxy script, the port
    fs.readFile(PORT80_PLIST_DEST, 'utf8', (err, text) => {
      const m = !err && /jpmixing-proxy\.py<\/string>\s*<string>(\d+)<\/string>/.exec(text || '');
      resolve(m ? Number(m[1]) : null);
    });
  });
}

// Port-80 helper state for Settings. Settings gives performers the port-80
// address — http://<ip>/ and http://<ip>:8080/ are separate sites to a
// browser, each with its own My Mixes — but only when the helper is actually
// running and forwards to the current server port; a stale helper (server
// port changed since, daemon unloaded) would otherwise send phones to a dead
// address. Also flags a macOS proxy from before the TCP_NODELAY fix
// (updating it needs admin rights, so it can't be done silently).
ipcMain.handle('get-port80-status', async () => {
  let installed, upToDate = true;
  if (process.platform === 'win32') {
    installed = (await port80ForwardTarget()) !== null;
  } else {
    try {
      const text = await fs.promises.readFile(PORT80_PROXY_DEST, 'utf8');
      installed = true;
      upToDate = text.includes(PORT80_PROXY_MARKER);
    } catch (_) {
      installed = false;
    }
  }
  if (!installed) return { installed: false, upToDate: false, running: false, forwardsTo: null, matches: false };
  const [forwardsTo, running] = await Promise.all([port80ForwardTarget(), port80Listening()]);
  const serverPort = Number(config.get('serverPort'));
  return { installed, upToDate, running, forwardsTo, matches: running && forwardsTo === serverPort };
});

ipcMain.handle('setup-port-80', async (_, serverPort) => {
  // Validate before embedding in scripts that run as root
  if (typeof serverPort !== 'number' || !Number.isInteger(serverPort) || serverPort < 1024 || serverPort > 65535) {
    return { ok: false, error: 'Invalid port number' };
  }

  if (process.platform === 'win32') {
    // Windows: netsh portproxy forwards port 80 → server port at the TCP level.
    // Stored in registry so it survives reboots. Runs elevated via UAC prompt.
    // Use a process-private temp directory to avoid TOCTOU race on shared /tmp.
    let tmpDir;
    try { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-')); } catch (e) { return { ok: false, error: e.message }; }
    const scriptPath = path.join(tmpDir, 'jpmixer-port80.ps1');
    const script = [
      `netsh interface portproxy delete v4tov4 listenport=80 listenaddress=0.0.0.0 2>$null`,
      `netsh interface portproxy add v4tov4 listenport=80 listenaddress=0.0.0.0 connectport=${serverPort} connectaddress=127.0.0.1`,
      `netsh advfirewall firewall delete rule name="JPMixer Port 80" | Out-Null`,
      `netsh advfirewall firewall add rule name="JPMixer Port 80" protocol=TCP dir=in localport=80 action=allow`
    ].join('\r\n');

    try { fs.writeFileSync(scriptPath, script, 'utf8'); }
    catch (e) { try { fs.rmSync(tmpDir, { recursive: true }); } catch (_) {} return { ok: false, error: e.message }; }

    return new Promise(resolve => {
      const escaped = scriptPath.replace(/\\/g, '\\\\');
      exec(
        `powershell -NoProfile -Command "Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \\"${escaped}\\"' -Verb RunAs -Wait"`,
        (err, _out, stderr) => {
          try { fs.rmSync(tmpDir, { recursive: true }); } catch (_) {}
          resolve({ ok: !err, error: err ? (stderr || err.message) : null });
        }
      );
    });
  }

  // Use a process-private temp directory to avoid TOCTOU race on shared /tmp.
  let macTmpDir;
  try { macTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jpmixer-')); } catch (e) { return { ok: false, error: e.message }; }
  const proxyScript = path.join(macTmpDir, 'jpmixing-proxy.py');
  const plistTmp    = path.join(macTmpDir, 'com.jpmixing.port80.plist');
  const setupTmp    = path.join(macTmpDir, 'jpmixing-setup.sh');
  const proxyDest   = PORT80_PROXY_DEST;
  const plistDest   = PORT80_PLIST_DEST;

  // Raw TCP proxy — forwards port 80 → server port, handles HTTP + WebSocket
  // TCP_NODELAY on both legs — without it Nagle's algorithm can hold back the
  // small WebSocket frames fader moves are made of. PORT80_PROXY_MARKER lets
  // Settings spot an installed copy from before this fix (see get-port80-status).
  const proxyPy = `#!/usr/bin/env python3
# ${PORT80_PROXY_MARKER}
import socket, threading, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else ${serverPort}

def nodelay(sock):
    try: sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    except Exception: pass

def pipe(src, dst):
    try:
        while True:
            data = src.recv(4096)
            if not data:
                break
            dst.sendall(data)
    except Exception:
        pass
    finally:
        for s in (src, dst):
            try: s.close()
            except Exception: pass

def handle(client):
    try:
        srv = socket.create_connection(('127.0.0.1', PORT), timeout=10)
        srv.settimeout(None)
        nodelay(client)
        nodelay(srv)
        threading.Thread(target=pipe, args=(client, srv), daemon=True).start()
        threading.Thread(target=pipe, args=(srv, client), daemon=True).start()
    except Exception:
        client.close()

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(('0.0.0.0', 80))
    s.listen(100)
    while True:
        try:
            client, _ = s.accept()
            client.settimeout(None)
            threading.Thread(target=handle, args=(client,), daemon=True).start()
        except Exception:
            pass
`;

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.jpmixing.port80</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>${proxyDest}</string>
        <string>${serverPort}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardErrorPath</key>
    <string>/var/log/jpmixing-port80.log</string>
    <key>StandardOutPath</key>
    <string>/var/log/jpmixing-port80.log</string>
</dict>
</plist>`;

  const setupScript = `#!/bin/sh
mkdir -p /usr/local/bin
cp '${proxyScript}' '${proxyDest}'
chmod +x '${proxyDest}'
cp '${plistTmp}' '${plistDest}'
chown root:wheel '${plistDest}'
chmod 644 '${plistDest}'
launchctl bootout system '${plistDest}' 2>/dev/null || launchctl unload '${plistDest}' 2>/dev/null || true
launchctl bootstrap system '${plistDest}' 2>/dev/null || launchctl load -w '${plistDest}' 2>/dev/null
`;

  try {
    fs.writeFileSync(proxyScript, proxyPy);
    fs.writeFileSync(plistTmp, plistContent);
    fs.writeFileSync(setupTmp, setupScript);
    fs.chmodSync(setupTmp, '755');
  } catch (e) {
    return { ok: false, error: e.message };
  }

  return new Promise(resolve => {
    const appleScript = `do shell script "${setupTmp}" with administrator privileges`;
    exec(`osascript -e '${appleScript}'`, (err, _stdout, stderr) => {
      try { fs.rmSync(macTmpDir, { recursive: true }); } catch (_) {}
      resolve({ ok: !err, error: err ? (stderr || err.message) : null });
    });
  });
});

// Settings that only take effect by restarting the server: its sockets and
// ports, the desk connection, the iPad relay list, and demo mode's fake
// console. Everything else (labels, colours, icons, order, groups, scene
// recall…) is pushed to connected pages live. Restarting for every change
// dropped every phone and re-primed the whole console — minutes, mid-service.
const RESTART_KEYS = [
  // (ipadConnections is applied live by osc-server — adding or fixing an iPad
  // mid-service no longer drops every phone)
  'serverPort', 'deskIp', 'deskSendPort', 'deskListenPort', 'consoleType', 'demoMode',
  // dLive / KLANG / WING connection settings
  'dliveBaseChannel', 'dliveTlsEnabled', 'dliveUsername', 'dlivePassword', 'dliveMidiPort',
  'dliveListenSendLevels', 'dlivePollSendLevels', 'klangIp', 'klangPort', 'wingPort'
];
// What the aux-name sync reads. The Team filter and the Green Room's hidden
// positions only shape the Green Room display, which reads Planning Center
// itself on each load — changing them shouldn't re-run a rename.
const PCO_KEYS = ['pcoAppId', 'pcoSecret', 'pcoServiceTypeId', 'pcoPositionMapping', 'pcoIncludeUnconfirmed', 'pcoDay', 'pcoUpdateAuxNames'];

function needsRestart(prev, next) {
  if (RESTART_KEYS.some(k => JSON.stringify(prev[k]) !== JSON.stringify(next[k]))) return true;
  const countsChanged = prev.channels !== next.channels || prev.auxes !== next.auxes;
  // Demo mode builds its fake console from these counts at start. dLive,
  // KLANG and WING fetch names and levels for that many channels and auxes
  // when they connect; DiGiCo reads the counts from the desk itself.
  return countsChanged && (!!next.demoMode || next.consoleType !== 'digico');
}

// Applies a just-saved config to the running server; returns whether it restarted
async function applySavedConfig(prev) {
  if (!serverRunning) return false;
  const next = config.getAll();
  const pcoChanged = PCO_KEYS.some(k => JSON.stringify(prev[k]) !== JSON.stringify(next[k]));
  if (needsRestart(prev, next) || !server.applyConfigLive) {
    await stopServer();
    startServer({ pcoSync: pcoChanged || prev.consoleType !== next.consoleType }); // a new backend starts unlabelled
    return true;
  }
  server.applyConfigLive(next);
  // Planning Center changes used to take effect through the restart's
  // auto-sync; run it now that most saves don't restart
  if (pcoChanged) {
    autoSyncPlanningCenter().catch((err) => console.error('[JPMixer/PCO] auto-sync error:', err));
  }
  return false;
}

ipcMain.handle('save-config', async (_, incoming) => {
  const prev = config.getAll();
  const saved = config.save(incoming);
  if (!saved) {
    // config.save() already rolled _config back to prev on failure — nothing
    // actually changed, so there's nothing to restart/reconcile either.
    return { ok: false, restarted: false, error: 'Could not save settings to disk — check available disk space and file permissions. Nothing was changed.' };
  }
  const restarted = await applySavedConfig(prev);
  // Reconciled separately from the console-backend restart above — the
  // Control API's own enable/port state should never force a console
  // reconnect, and vice versa. See api-server.js's file header.
  apiServer.applyConfig(config.getAll());
  require('./src/server/companion-satellite').applyConfig(config.getAll());
  rebuildTrayMenu();
  updateKeepAwake();
  if (prev.brandLogo !== config.get('brandLogo')) require('./src/server/branding').pruneLogos();
  const loginItem = prev.openAtLogin !== config.get('openAtLogin') ? applyOpenAtLogin(config.get('openAtLogin')) : null;
  if (loginItem && !loginItem.ok && !loginItem.needsApproval) config.save({ ...config.getAll(), openAtLogin: !!app.getLoginItemSettings().openAtLogin });
  return { ok: true, restarted, loginItem };
});

// Companion buttons' connection, for Settings → Pages
ipcMain.handle('get-companion-status', () => require('./src/server/companion-satellite').getStatus());

// iPad relay health for Settings — DiGiCo backend only (the others have no relay)
ipcMain.handle('get-ipad-status', () => (serverRunning && server.getIpadStatus) ? server.getIpadStatus() : null);

ipcMain.handle('start-server', () => startServer());
ipcMain.handle('stop-server', () => stopServer());

// Generates and persists a new Control API token — the crypto.randomBytes
// call lives here (not in the Settings renderer) since Node's crypto isn't
// exposed to a contextIsolated renderer, and a token shouldn't be
// generated client-side anyway.
ipcMain.handle('generate-api-token', () => {
  const token = require('crypto').randomBytes(24).toString('hex');
  if (!config.save({ ...config.getAll(), apiToken: token })) {
    // Don't hand back a token that isn't actually the one saved to disk —
    // the renderer would otherwise show/use a token api-server.js's auth
    // check (which reads config fresh on every request) will never accept.
    return { ok: false, error: 'Could not save the new token to disk — nothing was changed.' };
  }
  apiServer.applyConfig(config.getAll());
  return { ok: true, token };
});

// ── Planning Center Services ────────────────────────────────────────────
// See pco-client.js's file header for what's confirmed vs. assumed about
// Planning Center's API. Every handler here returns { ok:false, error,
// status, body } on failure rather than throwing across the IPC boundary,
// so the Settings UI can show the raw status/body for diagnosis if a real
// account's response shape doesn't match what pco-client.js expects.

// Prefers credentials passed explicitly from the Settings renderer (the
// live App ID/Secret field values, so Refresh/Sync work immediately without
// requiring Save & Apply first) and trims whitespace — a pasted secret with
// a trailing space/newline is a common, silent cause of a 401 that looks
// identical to genuinely wrong credentials. Falls back to the persisted
// config only if the renderer didn't pass anything (defensive, shouldn't
// normally happen since settings.js always passes the live fields).
function pcoCreds(explicit) {
  const appId  = (explicit && explicit.appId)  || config.get('pcoAppId')  || '';
  const secret = (explicit && explicit.secret) || config.get('pcoSecret') || '';
  return { appId: appId.trim(), secret: secret.trim() };
}

function lookupAux(mapping, positionName) {
  const key = Object.keys(mapping || {}).find(k => k.toLowerCase() === positionName.toLowerCase());
  return key !== undefined ? mapping[key] : undefined;
}

ipcMain.handle('pco-list-service-types', async (_, creds) => {
  try {
    return { ok: true, types: await pcoClient.listServiceTypes(pcoCreds(creds)) };
  } catch (err) {
    return { ok: false, error: err.message, status: err.status || null, body: err.body || null };
  }
});

ipcMain.handle('pco-list-teams', async (_, serviceTypeId, creds) => {
  try {
    return { ok: true, teams: await pcoClient.listTeams(serviceTypeId, pcoCreds(creds)) };
  } catch (err) {
    return { ok: false, error: err.message, status: err.status || null, body: err.body || null };
  }
});

ipcMain.handle('pco-list-positions', async (_, serviceTypeId, creds) => {
  try {
    return { ok: true, positions: await pcoClient.listPositions(serviceTypeId, pcoCreds(creds)) };
  } catch (err) {
    return { ok: false, error: err.message, status: err.status || null, body: err.body || null };
  }
});

// Shared by the manual "Sync Now" IPC handler and autoSyncPlanningCenter()
// (fired automatically when the console backend starts, see startServer())
// — one implementation either way applies to.
async function runPcoSync({ serviceTypeId, mapping, includeUnconfirmed, day, creds }) {
  try {
    const plan = await pcoClient.nextPlan(serviceTypeId, creds);
    if (!plan) return { ok: false, error: 'No upcoming plan found for this Service Type.' };

    // "auto" resolves against this plan's own PlanTimes (whichever is
    // closest to right now) rather than literally today's calendar date —
    // see pco-client.js's resolveAutoDay() for why.
    const resolvedDay = day === 'auto' ? await pcoClient.resolveAutoDay(serviceTypeId, plan.id, creds) : day;

    const members = await pcoClient.planTeamMembers(serviceTypeId, plan.id, creds);
    // A person with no day-specific scheduling info (most plans aren't
    // "split team") always passes — see pco-client.js's `days` field.
    // A decline is a definite no — never renames an aux after them, even
    // with includeUnconfirmed on (that means "also include people who
    // haven't responded yet," not "also include people who said no").
    const relevant = members.filter(m =>
      !m.declined && (includeUnconfirmed || m.confirmed) && !(resolvedDay && m.days.length > 0 && !m.days.includes(resolvedDay))
    );

    const applied = [], unmapped = [], errors = [];
    for (const m of relevant) {
      if (!m.positionName) continue;
      const auxNum = lookupAux(mapping, m.positionName);
      if (auxNum === undefined) {
        if (!unmapped.includes(m.positionName)) unmapped.push(m.positionName);
        continue;
      }
      if (!serverRunning || !server) { errors.push(`${m.positionName}: no console backend is running`); continue; }
      const label = `${m.positionName} - ${m.personName}`;
      if (server.setAuxLabel(auxNum, label)) applied.push({ aux: auxNum, label });
      else errors.push(`Aux ${auxNum}: rejected (out of range?)`);
    }

    return { ok: true, plan: { id: plan.id, title: plan.title, date: plan.date }, resolvedDay, applied, unmapped, errors };
  } catch (err) {
    return { ok: false, error: err.message, status: err.status || null, body: err.body || null };
  }
}

// Fires automatically whenever the console backend (re)starts — see
// startServer() — so a saved Planning Center setup is always in sync
// without anyone needing to open Settings and click Sync Now. Silently
// does nothing if Planning Center isn't configured yet, or nothing is
// mapped yet (a fresh setup with an empty pcoPositionMapping would
// otherwise "succeed" at applying zero labels, which isn't worth a log
// line or a wasted API call).
async function autoSyncPlanningCenter() {
  const appId = config.get('pcoAppId');
  const secret = config.get('pcoSecret');
  const serviceTypeId = config.get('pcoServiceTypeId');
  const mapping = config.get('pcoPositionMapping') || {};
  if (!appId || !secret || !serviceTypeId || Object.keys(mapping).length === 0) return;
  // The Green Room display reads Planning Center directly on every page
  // load (see greenroom.js) — it never depends on this function running.
  // This only renames aux channels, so it's the one part this setting can
  // skip while leaving the Green Room fully functional.
  if (config.get('pcoUpdateAuxNames') === false) return;

  const result = await runPcoSync({
    serviceTypeId,
    mapping,
    includeUnconfirmed: !!config.get('pcoIncludeUnconfirmed'),
    day: config.get('pcoDay') || '',
    creds: pcoCreds(),
  });
  if (result.ok) {
    const dayNote = result.resolvedDay ? ` (${result.resolvedDay})` : '';
    console.log(`[JPMixer/PCO] auto-sync: ${result.applied.length} aux label(s) updated from "${result.plan.title || result.plan.id}"${dayNote}`);
  } else {
    console.log(`[JPMixer/PCO] auto-sync skipped: ${result.error}`);
  }
}

ipcMain.handle('pco-sync-now', async (_, { serviceTypeId, mapping, includeUnconfirmed, day, creds: explicitCreds }) => {
  return runPcoSync({ serviceTypeId, mapping, includeUnconfirmed, day, creds: pcoCreds(explicitCreds) });
});

// Opens the Green Room display in the system's default browser (not an
// in-app BrowserWindow, unlike Open Monitor/Open Devices) — this is meant
// for a separate iPad/TV on the network, so a preview in the system browser
// makes more sense than an Electron window only the engineer sees.
ipcMain.handle('open-greenroom', (_, url) => { shell.openExternal(url); return { ok: true }; });
// Same shape as open-greenroom — the FOH Engineer Home page is also meant to
// be opened externally (the engineer's own laptop/iPad, a browser bookmark),
// not only from the tray menu's in-app BrowserWindow below.
ipcMain.handle('open-foh', (_, url) => { shell.openExternal(url); return { ok: true }; });

ipcMain.handle('get-presets',       () => presets.getAll());
ipcMain.handle('delete-preset', (_, deviceId, name) => ({ ok: presets.deletePreset(deviceId, name) }));

ipcMain.handle('get-auto-backup-status', () => autoBackup.getStatus());
ipcMain.handle('open-auto-backups-folder', () => {
  shell.openPath(autoBackup.backupsDir());
  return { ok: true };
});

// File pickers attach to the window that asked (a sheet). getFocusedWindow()
// is null when that window isn't focused, which made the picker app-modal and
// blocked the main process — see showPrompt above.
function dialogParent(event) {
  return BrowserWindow.fromWebContents(event.sender) || settingsWindow || undefined;
}

// ── Branding (Settings → Branding) ───────────────────────────────
// The chosen image is copied in right away so Settings can preview it; it's
// used once Save & Apply stores its name (see branding.js). The preview is a
// data: URL so Settings can read colors from it.
ipcMain.handle('branding-choose-logo', async (event) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(dialogParent(event), {
    title: 'Choose a logo', properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'svg', 'jpg', 'jpeg', 'webp', 'gif'] }]
  });
  if (canceled || !filePaths?.[0]) return { ok: false, canceled: true };
  try {
    const branding = require('./src/server/branding');
    const file = branding.importLogo(filePaths[0]);
    return { ok: true, file, dataUrl: branding.dataUrl(file) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('branding-get', () => {
  const branding = require('./src/server/branding');
  const file = config.get('brandLogo') || '';
  return { file: branding.logoPath(file) ? file : '', dataUrl: branding.dataUrl(file), accent: branding.accent() || '' };
});

ipcMain.handle('export-backup', async (event, options) => {
  const win = dialogParent(event);
  const defaultName = `JPMixer-Backup-${new Date().toISOString().slice(0, 10)}.json`;
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export JPMixer Backup',
    defaultPath: defaultName,
    filters: [{ name: 'JPMixer Backup', extensions: ['json'] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };

  // Same format as auto-backups (includes Ear Scenes), but passwords and
  // keys only when asked for
  const data = autoBackup.buildBackupData({ includeCredentials: options?.includeCredentials === true });
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: data.credentialsIncluded ? 0o600 : 0o644 });
    return { ok: true, filePath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// One loader inspects all supported backup types before any changes are made.
let pendingRestore = null;
let restoreBusy = false;
let restoreSequence = 0;
ipcMain.handle('inspect-backup', async (event) => {
  if (restoreBusy) return { ok:false,error:'A restore is already in progress.' };
  const { canceled,filePaths } = await dialog.showOpenDialog(dialogParent(event), {
    title:'Load JPMixer Backup',properties:['openFile'],filters:[{ name:'JPMixer backups, saved mixes, or extracted files',extensions:['json','zip'] }]
  });
  if (canceled || !filePaths?.[0]) return { ok:false,canceled:true };
  try {
    const restore = require('./src/server/backup-restore');
    const data = await restore.read(filePaths[0]);
    const preview = restore.describe(data,path.basename(filePaths[0]));
    const id = String(++restoreSequence);
    pendingRestore = { id,data,owner:event.sender.id };
    return { ok:true,id,...preview };
  } catch (error) { return { ok:false,error:error.message }; }
});
ipcMain.handle('cancel-backup-restore', (event) => {
  if (!restoreBusy && pendingRestore?.owner === event.sender.id) pendingRestore = null;
  return { ok:true };
});
ipcMain.handle('restore-backup', async (event, request) => {
  if (restoreBusy) return { ok:false,error:'A restore is already in progress.' };
  if (!pendingRestore || pendingRestore.id !== request?.id || pendingRestore.owner !== event.sender.id) return { ok:false,error:'Choose a backup file again before restoring.' };
  restoreBusy = true;
  let dataCommitted = false;
  try {
    const result = await require('./src/server/backup-restore').apply(pendingRestore.data,request.sections,request.mixMode,{ config,presets,scenes,autoBackup,homeLayouts:require('./src/server/home-layouts') });
    if (!result.ok) return result;
    dataCommitted = true;
    pendingRestore = null;
    if (result.configChanged) {
      // Restored scenes belong to the restored console type, so the restart
      // must not see a "console switch" and wipe the scenes it just wrote.
      if (result.scenesChanged) lastSceneKeyScheme = sceneKeySchemeFor(config.get('consoleType'));
      await applySavedConfig(result.previousConfig);
      apiServer.applyConfig(config.getAll()); rebuildTrayMenu();
    } else if (result.scenesChanged && serverRunning && server.applyConfigLive) server.applyConfigLive(config.getAll());
    if (result.mixes && serverRunning && server.pushDevicePresets) for (const id of result.mixes.deviceIds) server.pushDevicePresets(id);
    return { ok:true,selected:result.selected,configChanged:result.configChanged,mixes:result.mixes,safetyBackup:result.safetyBackup };
  } catch (error) { return { ok:false,error:dataCommitted ? 'Selected data was saved, but the running connection could not refresh. Restart JPMixer to load the restored data. ' + error.message : error.message }; }
  finally { restoreBusy = false; }
});

// ── Settings → Performers (My Mixes admin) ──────────────────────────────────────────────

// Mix-only transfer does not change config, scenes, or live console levels.
ipcMain.handle('export-mix-backup', async (event) => {
  const { canceled, filePath } = await dialog.showSaveDialog(dialogParent(event), {
    title: 'Back Up My Mixes',
    defaultPath: `JPMixer-My-Mixes-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JPMixer My Mixes', extensions: ['json'] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try {
    require('./src/server/mix-backup').write(filePath, presets.getAll(), presets.getAliases(), app.getVersion());
    return { ok: true, filePath };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('get-preset-aliases', () => presets.getAliases());

// Settings' per-group summary (owners, last aux, last saved) — the same one
// Find My Mixes uses, every group, newest first
ipcMain.handle('get-preset-groups', () => presets.findGroups('', null, Infinity));

// Settings clipboard is local to this app session and never touches hardware.
let mixClipboard = null;
ipcMain.handle('get-mix-devices', () => serverRunning && server.getConnectedDevicesInfo ? server.getConnectedDevicesInfo().map(device => ({ ...device, deviceId: device.deviceId ? presets.resolve(device.deviceId) : null })) : []);
ipcMain.handle('copy-presets', (_, deviceId, names) => {
  const copied = presets.copyMixes(deviceId, names);
  if (!copied.ok) return copied;
  mixClipboard = copied;
  return { ok: true, sourceId: copied.sourceId, names: Object.keys(copied.mixes) };
});
ipcMain.handle('clear-preset-clipboard', () => { mixClipboard = null; return { ok: true }; });
ipcMain.handle('paste-presets', async (_, deviceId) => {
  if (!mixClipboard) return { ok: false, error: 'Copy a saved mix first.' };
  // Capture the clipboard before awaiting the backup so a later Copy cannot
  // change the content of a paste that is already in progress.
  const copied = mixClipboard;
  try { await autoBackup.writeBackup('before-mix-paste'); }
  catch (e) { return { ok: false, error: 'Could not back up saved mixes first: ' + e.message }; }
  const result = presets.pasteMixes(deviceId, copied);
  if (result.ok && result.copied && serverRunning && server.pushDevicePresets) server.pushDevicePresets(result.toId);
  return result;
});

ipcMain.handle('set-preset-owner', (_, deviceId, owner) => presets.setOwner(deviceId, owner));

ipcMain.handle('merge-presets', async (_, fromId, toId) => {
  // Merging removes the source group — back up first so it can be undone
  try { await autoBackup.writeBackup('before-merge'); }
  catch (e) { return { ok: false, error: 'Could not write a backup first: ' + e.message }; }
  const result = presets.mergeDevices(fromId, toId);
  if (result.ok && serverRunning && server.pushDevicePresets) server.pushDevicePresets(result.toId);
  return result;
});
