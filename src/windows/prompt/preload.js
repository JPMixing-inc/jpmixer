'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// The message window's only bridge: report the size it needs and the
// button that was chosen (see showPrompt in main.js)
contextBridge.exposeInMainWorld('jpmPrompt', {
  resize: (height) => ipcRenderer.send('prompt-resize', height),
  choose: (index) => ipcRenderer.send('prompt-choice', index),
});
