const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jpm', {
  getConfig:   ()    => ipcRenderer.invoke('get-config'),
  getStatus:   ()    => ipcRenderer.invoke('get-server-status'),
  getLocalIP:      ()    => ipcRenderer.invoke('get-local-ip'),
  getChannelNames: ()    => ipcRenderer.invoke('get-channel-names'),
  getAuxNames:     ()    => ipcRenderer.invoke('get-aux-names'),
  setupPort80: (port) => ipcRenderer.invoke('setup-port-80', port),
  saveConfig:  (cfg) => ipcRenderer.invoke('save-config', cfg),
  startServer: ()    => ipcRenderer.invoke('start-server'),
  stopServer:  ()    => ipcRenderer.invoke('stop-server'),
  onStatus:         (cb) => ipcRenderer.on('server-status',  (_, data) => cb(data)),
  getConsoleStatus:       ()  => ipcRenderer.invoke('get-console-status'),
  onConsoleStatus:        (cb) => ipcRenderer.on('console-status', (_, data) => cb(data)),
  getInstrumentIconPaths: ()   => ipcRenderer.invoke('get-instrument-icon-paths'),
  openMonitor:            ()   => ipcRenderer.invoke('open-monitor'),
  openConsole:            ()   => ipcRenderer.invoke('open-console'),
  getConnectionCount:     ()   => ipcRenderer.invoke('get-connection-count'),
  onConnectionCount:      (cb) => ipcRenderer.on('connection-count', (_, data) => cb(data))
});
