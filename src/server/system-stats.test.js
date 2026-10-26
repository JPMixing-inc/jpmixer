'use strict';
// system-stats.js: the summary at the top of Settings → Performance, and the
// console traffic rate.

const path = require('path');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return path.join(__dirname, '_fake-electron-for-tests.js');
  return origResolve.call(this, request, ...args);
};

const test = require('node:test');
const assert = require('node:assert/strict');
const stats = require('./system-stats');

const GB = 1024 ** 3;
const healthy = () => ({
  jpmixer: { cpuOfComputer: 3, memoryMB: 400, responsiveness: { meanMs: 1, maxMs: 20, peakMaxMs: 40 } },
  computer: { thermal: 'nominal', load: 20, memoryTotalBytes: 16 * GB, memoryAvailableBytes: 8 * GB, disk: { freeBytes: 100 * GB, totalBytes: 500 * GB }, onBattery: false },
  extra: {
    server: { running: true }, console: { demo: false, connected: true },
    pco: { last20s: 12, limitPer20s: 100, lastFailure: null }, plugins: [],
  },
});

test('a healthy setup has nothing to report', () => {
  assert.deepEqual(stats.health(healthy()), []);
});

test('problems are listed worst first, in plain words', () => {
  const s = healthy();
  s.jpmixer.responsiveness.maxMs = 620;
  s.computer.memoryAvailableBytes = 1 * GB; // 6%
  s.computer.thermal = 'serious';
  s.extra.console.connected = false;
  s.extra.pco = { last20s: 85, limitPer20s: 100, lastFailure: { at: new Date().toISOString(), status: 429, message: 'Too many requests' } };
  s.extra.plugins = [{ name: 'Clock', state: 'crashed' }];
  const h = stats.health(s);
  assert.equal(h[0].level, 'error');
  assert.match(h[0].text, /held up for 620 ms/);
  const texts = h.map((x) => x.text).join('\n');
  assert.match(texts, /running hot/);
  assert.match(texts, /low on memory/);
  assert.match(texts, /console isn’t connected/);
  assert.match(texts, /85 requests in the last 20 seconds/);
  assert.match(texts, /asked JPMixer to slow down/);
  assert.match(texts, /Clock plugin stopped/);
  assert.ok(h.every((x, i) => i === 0 || ['error', 'warn', 'info'].indexOf(h[i - 1].level) <= ['error', 'warn', 'info'].indexOf(x.level)), 'errors, then warnings, then notes');
});

test('demo mode and a stopped server aren’t reported as a missing console', () => {
  const s = healthy();
  s.extra.console = { demo: true, connected: false };
  assert.deepEqual(stats.health(s), []);
  s.extra.server.running = false;
  assert.deepEqual(stats.health(s).map((x) => x.level), ['info']);
});

test('console traffic is counted each way, a second over the last 10 s', () => {
  stats.noteTraffic([{ dir: 'in', source: 'desk' }, { dir: 'in', source: 'desk' }, { dir: 'out', source: 'desk' }]);
  stats.noteTraffic(Array.from({ length: 97 }, () => ({ dir: 'in', source: 'desk' })).concat(Array.from({ length: 19 }, () => ({ dir: 'out', source: 'desk' }))));
  // iPads relayed through JPMixer, and unknown senders, aren't the console
  stats.noteTraffic(Array.from({ length: 500 }, () => ({ dir: 'in', source: 'ipad:FOH iPad' })).concat([{ dir: 'in', source: 'unknown:10.0.0.9' }]));
  const t = stats.collect().traffic;
  assert.deepEqual(t, { inPerSec: 10, outPerSec: 2, seen: true });
});
