'use strict';
// Minimal stand-in for the `electron` module, used only by the dlive-*.test.js
// files so they can run under plain `node` outside an actual Electron
// process. scenes.js/presets.js call app.getPath('userData') at module load
// time; this points that at the OS temp dir instead.
module.exports = { app: { getPath: () => require('os').tmpdir() } };
