'use strict';
// Minimal stand-in for the `electron` module, used by the *.test.js files so
// they can run under plain `node` outside an actual Electron process.
// scenes.js/presets.js call app.getPath('userData') at module load time;
// this points that at the OS temp dir by default, or JPM_TEST_USERDATA if a
// test sets it first (for isolation from other concurrent test runs, or
// from a real presets.json/scenes.json sitting in the shared OS temp dir).
module.exports = { app: { getPath: () => process.env.JPM_TEST_USERDATA || require('os').tmpdir() } };
