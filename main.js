const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, dialog } = require('electron');
const path  = require('path');
const os    = require('os');
const fs    = require('fs');
const https = require('https');
const { exec } = require('child_process');

const GITHUB_REPO = 'JPMixing-inc/jpmixer';

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
        if (latest && latest !== current) {
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
let config, server, presets, autoBackup;

app.whenReady().then(() => {
  config     = require('./src/server/config');
  server     = require('./src/server/osc-server');
  presets    = require('./src/server/presets');
  autoBackup = require('./src/server/auto-backup');
  autoBackup.start();
  server.setConsoleStatusCallback(broadcastConsoleStatus);
  server.setConnectionCountCallback(broadcastConnectionCount);
  server.setServerErrorCallback(handleServerError);
  server.setOscTrafficCallback(broadcastOscTraffic);

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

function startServer() {
  try {
    server.start(config.getAll());
    serverRunning = true;
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
  const proxyDest   = '/usr/local/bin/jpmixing-proxy.py';
  const plistDest   = '/Library/LaunchDaemons/com.jpmixing.port80.plist';

  // Raw TCP proxy — forwards port 80 → server port, handles HTTP + WebSocket
  const proxyPy = `#!/usr/bin/env python3
import socket, threading, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else ${serverPort}

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

ipcMain.handle('save-config', (_, incoming) => {
  config.save(incoming);
  if (serverRunning) {
    stopServer();
    startServer();
  }
  rebuildTrayMenu();
  return { ok: true };
});

ipcMain.handle('start-server', () => startServer());
ipcMain.handle('stop-server', () => stopServer());

ipcMain.handle('get-presets',       () => presets.getAll());
ipcMain.handle('delete-preset', (_, deviceId, name) => { presets.deletePreset(deviceId, name); return { ok: true }; });

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

  const data = {
    app: 'JPMixer',
    type: 'backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    config: config.getAll(),
    presets: presets.getAll()
  };
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
  if (typeof data.version !== "number" || data.version > 1) {
    return { ok: false, error: "This backup was created by a newer version of JPMixer (format v" + data.version + "). Please update the app first." };
  }

  config.save(data.config);
  if (data.presets) presets.replaceAll(data.presets);
  if (serverRunning) { stopServer(); startServer(); }
  rebuildTrayMenu();
  return { ok: true };
});
