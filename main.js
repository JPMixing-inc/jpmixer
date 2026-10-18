const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, dialog } = require('electron');
const path  = require('path');
const os    = require('os');
const fs    = require('fs');
const https = require('https');
const { exec } = require('child_process');

const GITHUB_REPO = 'JPMixing-inc/jpmixer';

// One copy only — a second would fight the first over the HTTP/OSC ports and
// the JSON data files. Launching again just brings up Settings in the first.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (app.isReady()) openSettings(); });
}

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

function checkForUpdates(silent = false) {
  const options = {
    hostname: 'api.github.com',
    path: `/repos/${GITHUB_REPO}/releases?per_page=1`,
    headers: { 'User-Agent': 'JPMixer-UpdateCheck' }
  };

  https.get(options, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try {
        const releases = JSON.parse(data);
        if (!Array.isArray(releases) || releases.length === 0) throw new Error('No releases');
        const release  = releases[0];
        const latest   = (release.tag_name || '').replace(/^v/, '');
        const current = app.getVersion();
        // Only when the release is actually newer — a plain !== also fired
        // for a build newer than the latest release (e.g. a local test build)
        if (latest && compareVersions(latest, current) > 0) {
          dialog.showMessageBox({
            type: 'info',
            title: 'Update Available',
            message: `JPMixer ${latest} is available`,
            detail: `You are running ${current}. Click Download to get the latest version.`,
            buttons: ['Download', 'Later'],
            defaultId: 0
          }).then(({ response }) => {
            if (response === 0) shell.openExternal(`https://github.com/${GITHUB_REPO}/releases/latest`);
          });
        } else if (!silent) {
          dialog.showMessageBox({
            type: 'info',
            title: 'Up to Date',
            message: `JPMixer ${current} is the latest version.`,
            buttons: ['OK']
          });
        }
      } catch (_) {
        if (!silent) dialog.showMessageBox({ type: 'error', title: 'Update Check Failed', message: 'Could not reach GitHub. Check your internet connection.', buttons: ['OK'] });
      }
    });
  }).on('error', () => {
    if (!silent) dialog.showMessageBox({ type: 'error', title: 'Update Check Failed', message: 'Could not reach GitHub. Check your internet connection.', buttons: ['OK'] });
  });
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

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
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

  apiServer = require('./src/server/api-server');
  apiServer.applyConfig(config.getAll());
  pcoClient  = require('./src/server/pco-client');

  createTray();

  if (config.get('autoStart')) {
    startServer();
  }

  // Silent update check on launch — only notifies if a newer version exists
  setTimeout(() => checkForUpdates(true), 3000);
});

app.on('window-all-closed', (e) => {
  // Keep the app alive even when all windows are closed (tray-only)
  e.preventDefault();
});

// ─── Tray ────────────────────────────────────────────────────────────────────

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'trayTemplate.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  tray.setToolTip('JPMixer');
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  const port = config.get('serverPort');
  const menu = Menu.buildFromTemplate([
    {
      label: serverRunning ? `● Running  —  port ${port}` : '○ Stopped',
      enabled: false
    },
    { type: 'separator' },
    {
      label: serverRunning ? 'Stop Server' : 'Start Server',
      click: () => (serverRunning ? stopServer() : startServer())
    },
    {
      label: 'Open Mixer in Browser',
      enabled: serverRunning,
      click: () => shell.openExternal(`http://localhost:${port}`)
    },
    {
      label: 'Open Monitor Engineer View',
      enabled: serverRunning,
      click: () => {
        const win = new BrowserWindow({
          width: 1400, height: 900,
          title: 'Monitor Engineer — JPMixer',
          webPreferences: { nodeIntegration: false, contextIsolation: true }
        });
        win.loadURL(`http://localhost:${port}/monitor.html`);
      }
    },
    {
      label: 'Open Console Controller',
      enabled: serverRunning,
      click: () => {
        const win = new BrowserWindow({
          width: 1600, height: 800,
          title: 'Console Controller — JPMixer',
          webPreferences: { nodeIntegration: false, contextIsolation: true }
        });
        win.loadURL(`http://localhost:${port}/console.html`);
      }
    },
    {
      label: 'Open Devices View',
      enabled: serverRunning,
      click: () => {
        const win = new BrowserWindow({
          width: 1000, height: 700,
          title: 'Devices — JPMixer',
          webPreferences: { nodeIntegration: false, contextIsolation: true }
        });
        win.loadURL(`http://localhost:${port}/devices.html`);
      }
    },
    { type: 'separator' },
    { label: 'Settings…', click: openSettings },
    { label: 'Check for Updates…', click: () => checkForUpdates(false) },
    { type: 'separator' },
    {
      label: 'Quit JPMixer',
      click: () => { stopServer(); app.exit(0); }
    }
  ]);
  tray.setContextMenu(menu);
}

// ─── Server lifecycle ─────────────────────────────────────────────────────────

function startServer({ pcoSync = true } = {}) {
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
  const keyScheme = family === 'digico' ? 'name' : 'number';
  // Ear Scenes now persist across launches, so the scheme they were saved
  // under has to persist too — otherwise quitting on DiGiCo and relaunching
  // on dLive would mix name-keyed scenes in with number-keyed ones.
  const previousScheme = lastSceneKeyScheme !== null ? lastSceneKeyScheme : (scenes && scenes.getKeyScheme());
  if (previousScheme && previousScheme !== keyScheme && scenes) {
    if (Object.keys(scenes.getAll()).length > 0) {
      autoBackup.writeBackup('before-console-switch')
        .catch((err) => console.error('[JPMixer] Backup before console switch failed:', err));
    }
    scenes.clearForSchemeChange();
  }
  lastSceneKeyScheme = keyScheme;
  if (scenes) scenes.setKeyScheme(keyScheme);

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
  }
  rebuildTrayMenu();
  broadcastStatus();
}

function stopServer() {
  server.stop();
  serverRunning = false;
  apiServer.setActiveBackend(null);
  rebuildTrayMenu();
  broadcastStatus();
}

function broadcastStatus() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('server-status', { running: serverRunning });
  }
}

function broadcastConsoleStatus(connected) {
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
  rebuildTrayMenu();
  broadcastStatus();
  dialog.showMessageBox({
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
    width: 600,
    height: 740,
    minWidth: 560,
    minHeight: 620,
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

ipcMain.handle('open-monitor', () => {
  if (!serverRunning) return { error: 'Server not running' };
  const cfg = config.getAll();
  const win = new BrowserWindow({
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
    width: 1000, height: 700,
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
  'serverPort', 'deskIp', 'deskSendPort', 'deskListenPort', 'consoleType', 'demoMode', 'ipadConnections',
  // dLive / KLANG / WING connection settings
  'dliveBaseChannel', 'dliveTlsEnabled', 'dliveUsername', 'dlivePassword', 'dliveMidiPort',
  'dliveListenSendLevels', 'dlivePollSendLevels', 'klangIp', 'klangPort', 'wingPort'
];
const PCO_KEYS = ['pcoAppId', 'pcoSecret', 'pcoServiceTypeId', 'pcoTeamId', 'pcoPositionMapping', 'pcoIncludeUnconfirmed', 'pcoGreenRoomHidden'];

function needsRestart(prev, next) {
  if (RESTART_KEYS.some(k => JSON.stringify(prev[k]) !== JSON.stringify(next[k]))) return true;
  // Demo mode builds its fake console from these counts at start
  return !!next.demoMode && (prev.channels !== next.channels || prev.auxes !== next.auxes);
}

// Applies a just-saved config to the running server; returns whether it restarted
function applySavedConfig(prev) {
  if (!serverRunning) return false;
  const next = config.getAll();
  const pcoChanged = PCO_KEYS.some(k => JSON.stringify(prev[k]) !== JSON.stringify(next[k]));
  if (needsRestart(prev, next) || !server.applyConfigLive) {
    // dLive/KLANG/WING have no live-update path yet, so they restart on every save
    stopServer();
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

ipcMain.handle('save-config', (_, incoming) => {
  const prev = config.getAll();
  config.save(incoming);
  const restarted = applySavedConfig(prev);
  // Reconciled separately from the console-backend restart above — the
  // Control API's own enable/port state should never force a console
  // reconnect, and vice versa. See api-server.js's file header.
  apiServer.applyConfig(config.getAll());
  rebuildTrayMenu();
  return { ok: true, restarted };
});

ipcMain.handle('start-server', () => startServer());
ipcMain.handle('stop-server', () => stopServer());

// Generates and persists a new Control API token — the crypto.randomBytes
// call lives here (not in the Settings renderer) since Node's crypto isn't
// exposed to a contextIsolated renderer, and a token shouldn't be
// generated client-side anyway.
ipcMain.handle('generate-api-token', () => {
  const token = require('crypto').randomBytes(24).toString('hex');
  config.save({ ...config.getAll(), apiToken: token });
  apiServer.applyConfig(config.getAll());
  return { token };
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
async function runPcoSync({ serviceTypeId, mapping, includeUnconfirmed, creds }) {
  try {
    const plan = await pcoClient.nextPlan(serviceTypeId, creds);
    if (!plan) return { ok: false, error: 'No upcoming plan found for this Service Type.' };

    const members = await pcoClient.planTeamMembers(serviceTypeId, plan.id, creds);
    const relevant = members.filter(m => includeUnconfirmed || m.confirmed);

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

    return { ok: true, plan: { id: plan.id, title: plan.title, date: plan.date }, applied, unmapped, errors };
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

  const result = await runPcoSync({
    serviceTypeId,
    mapping,
    includeUnconfirmed: !!config.get('pcoIncludeUnconfirmed'),
    creds: pcoCreds(),
  });
  if (result.ok) {
    console.log(`[JPMixer/PCO] auto-sync: ${result.applied.length} aux label(s) updated from "${result.plan.title || result.plan.id}"`);
  } else {
    console.log(`[JPMixer/PCO] auto-sync skipped: ${result.error}`);
  }
}

ipcMain.handle('pco-sync-now', async (_, { serviceTypeId, mapping, includeUnconfirmed, creds: explicitCreds }) => {
  return runPcoSync({ serviceTypeId, mapping, includeUnconfirmed, creds: pcoCreds(explicitCreds) });
});

// Opens the Green Room display in the system's default browser (not an
// in-app BrowserWindow, unlike Open Monitor/Open Devices) — this is meant
// for a separate iPad/TV on the network, so a preview in the system browser
// makes more sense than an Electron window only the engineer sees.
ipcMain.handle('open-greenroom', (_, url) => { shell.openExternal(url); return { ok: true }; });

ipcMain.handle('get-presets',       () => presets.getAll());
ipcMain.handle('delete-preset', (_, deviceId, name) => ({ ok: presets.deletePreset(deviceId, name) }));

ipcMain.handle('get-auto-backup-status', () => autoBackup.getStatus());
ipcMain.handle('open-auto-backups-folder', () => {
  shell.openPath(autoBackup.backupsDir());
  return { ok: true };
});

ipcMain.handle('export-backup', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const defaultName = `JPMixer-Backup-${new Date().toISOString().slice(0, 10)}.json`;
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export JPMixer Backup',
    defaultPath: defaultName,
    filters: [{ name: 'JPMixer Backup', extensions: ['json'] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };

  const data = autoBackup.buildBackupData(); // same format as auto-backups — includes Ear Scenes
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return { ok: true, filePath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('import-backup', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import JPMixer Backup',
    properties: ['openFile'],
    filters: [{ name: 'JPMixer Backup', extensions: ['json'] }]
  });
  if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
  } catch (e) {
    return { ok: false, error: 'That file isn’t valid JSON.' };
  }
  if (!data || data.app !== "JPMixer" || data.type !== "backup" || !data.config) {
    return { ok: false, error: "That doesn’t look like a JPMixer backup file." };
  }
  if (typeof data.version !== "number" || data.version > autoBackup.BACKUP_VERSION) {
    return { ok: false, error: "This backup was created by a newer version of JPMixer (format v" + data.version + "). Please update the app first." };
  }

  // Import replaces everything — take a safety backup of the current state
  // first, so "cannot be undone" has an undo in the auto-backups folder
  try { await autoBackup.writeBackup('before-import'); }
  catch (e) { return { ok: false, error: 'Could not back up the current settings first: ' + e.message }; }

  const prev = config.getAll();
  config.save(data.config);
  if (data.presets) presets.replaceAll(data.presets, data.presetAliases);
  // v1 backups have no scenes — leave the current Ear Scenes alone rather than wipe them
  if (data.scenes) scenes.replaceAll(data.scenes);
  applySavedConfig(prev);
  apiServer.applyConfig(config.getAll());
  rebuildTrayMenu();
  return { ok: true };
});

// ── Settings → My Mixes admin ──────────────────────────────────────────────

ipcMain.handle('get-preset-aliases', () => presets.getAliases());

// Settings' per-group summary (owners, last aux, last saved) — the same one
// Find My Mixes uses, every group, newest first
ipcMain.handle('get-preset-groups', () => presets.findGroups('', null, Infinity));

ipcMain.handle('set-preset-owner', (_, deviceId, owner) => presets.setOwner(deviceId, owner));

ipcMain.handle('merge-presets', async (_, fromId, toId) => {
  // Merging removes the source group — back up first so it can be undone
  try { await autoBackup.writeBackup('before-merge'); }
  catch (e) { return { ok: false, error: 'Could not write a backup first: ' + e.message }; }
  const result = presets.mergeDevices(fromId, toId);
  if (result.ok && serverRunning && server.pushDevicePresets) server.pushDevicePresets(result.toId);
  return result;
});
