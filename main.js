const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, dialog } = require('electron');
const path  = require('path');
const os    = require('os');
const fs    = require('fs');
const https = require('https');
const { exec } = require('child_process');

const GITHUB_REPO = 'josiahpapovitch/jpmixer';

function checkForUpdates(silent = false) {
  const options = {
    hostname: 'api.github.com',
    path: `/repos/${GITHUB_REPO}/releases/latest`,
    headers: { 'User-Agent': 'JPMixer-UpdateCheck' }
  };

  https.get(options, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try {
        const release = JSON.parse(data);
        const latest  = (release.tag_name || '').replace(/^v/, '');
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

function getLocalIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

let tray = null;
let settingsWindow = null;
let serverRunning = false;

// Lazy-require so config uses app.getPath after app is ready
let config, server;

app.whenReady().then(() => {
  config = require('./src/server/config');
  server = require('./src/server/osc-server');
  server.setConsoleStatusCallback(broadcastConsoleStatus);
  server.setConnectionCountCallback(broadcastConnectionCount);

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
ipcMain.handle('get-server-status', () => ({ running: serverRunning }));
ipcMain.handle('get-local-ip', () => getLocalIP());
ipcMain.handle('get-channel-names',   () => serverRunning ? server.getChannelNames()     : {});
ipcMain.handle('get-aux-names',       () => serverRunning ? server.getAuxNames()         : {});
ipcMain.handle('get-console-status',      () => ({ connected: server ? server.isConsoleConnected() : false }));
ipcMain.handle('get-connection-count',    () => ({ count: server ? server.getConnectionCount() : 0 }));

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

ipcMain.handle('get-instrument-icon-paths', () => ({
  dir1: path.join(__dirname, 'assets', 'Icons For instruments', '1-To-70-SVG-Files-MusicalInstrumentsBundle'),
  dir2: path.join(__dirname, 'assets', 'Icons For instruments', '71-To-120-SVG-Files-MusicalInstrumentsBundle'),
}));

ipcMain.handle('setup-port-80', async (_, serverPort) => {
  const proxyScript = '/tmp/jpmixing-proxy.py';
  const plistTmp    = '/tmp/com.jpmixing.port80.plist';
  const setupTmp    = '/tmp/jpmixing-setup.sh';
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
