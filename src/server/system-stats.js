'use strict';

// ── Performance (Settings → System → Performance) ──────────────────────────
// How hard JPMixer and this computer are working, read in the main process:
//   - every JPMixer process (the app, each window, graphics, plugins): CPU
//     and memory, sampled every few seconds, with the peak of the last 10 min
//   - how responsive JPMixer is: the longest it was held up (event-loop
//     delay) in the last 10 seconds. Long pauses are what make faders lag.
//   - the console's traffic, messages a second each way (from the OSC log;
//     the console's own messages only, not iPads relayed through JPMixer)
//   - this computer: load, available memory, free disk, temperature state
//   - the size of JPMixer's own data folder (backups, logs), every minute
// main.js adds what only it knows (server, connections, integrations) and
// health() turns all of it into the plain-language summary at the top.
// Read-only: nothing here changes anything.

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { monitorEventLoopDelay } = require('perf_hooks');
const { app, webContents, powerMonitor } = require('electron');

const SAMPLE_MS = 3000;
const HISTORY_MS = 10 * 60 * 1000;
const LOOP_WINDOW_MS = 10000;
const FOLDER_EVERY_MS = 60000;
const startedAt = Date.now();

// ── Responsiveness ──
const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();
let loopLast = { meanMs: 0, maxMs: 0 };
let loopPeak = []; // [{ at, maxMs }] for the last 10 min
setInterval(() => {
  const ms = (ns) => Math.round(ns / 1e6);
  loopLast = { meanMs: ms(loop.mean || 0), maxMs: ms(loop.max || 0) };
  loop.reset();
  const now = Date.now();
  loopPeak.push({ at: now, maxMs: loopLast.maxMs });
  loopPeak = loopPeak.filter((p) => now - p.at < HISTORY_MS);
}, LOOP_WINDOW_MS).unref();

// ── Console traffic ──
let traffic = []; // [{ at, in, out }] one per batch from the OSC log
function noteTraffic(batch) {
  if (!Array.isArray(batch) || !batch.length) return;
  let inn = 0, out = 0;
  for (const e of batch) {
    if (!e || e.source !== 'desk') continue;
    if (e.dir === 'in') inn++; else if (e.dir === 'out') out++;
  }
  const now = Date.now();
  traffic.push({ at: now, in: inn, out });
  if (traffic.length > 2000 || now - traffic[0].at > 60000) traffic = traffic.filter((t) => now - t.at <= 60000);
}
function trafficRate() {
  const now = Date.now();
  const recent = traffic.filter((t) => now - t.at <= 10000);
  const sum = (k) => recent.reduce((a, t) => a + t[k], 0);
  return { inPerSec: Math.round(sum('in') / 10), outPerSec: Math.round(sum('out') / 10), seen: traffic.length > 0 };
}

// ── Processes ──
// Electron's own CPU figure is per core and "since the last call", so it's
// only ever read here, on a steady timer
let processList = [];
let history = []; // [{ at, cpu, memoryMB }] JPMixer as a whole
let pluginProcs = () => [];
function windowName(pid) {
  for (const wc of webContents.getAllWebContents()) {
    try {
      if (wc.getOSProcessId() !== pid) continue;
      const url = wc.getURL();
      if (/settings\/index\.html/.test(url)) return 'Settings window';
      if (/splash/.test(url)) return 'Opening screen';
      if (/update/.test(url)) return 'Update window';
      if (/prompt/.test(url)) return 'Message window';
      return wc.getTitle() || 'Window';
    } catch (_) { /* closing */ }
  }
  return 'Window';
}
const KIND = { Browser: 'JPMixer (main)', GPU: 'Graphics', Utility: 'Helper', Zygote: 'Helper', Sandbox: 'Helper', 'Pepper Plugin': 'Helper' };
// CPU and memory of plugin processes (not Electron's own, so Electron can't
// measure them). `ps` on Mac and Linux; Windows shows them without numbers.
function psStats(pids) {
  return new Promise((resolve) => {
    if (!pids.length || process.platform === 'win32') { resolve(new Map()); return; }
    execFile('ps', ['-o', 'pid=,pcpu=,rss=', '-p', pids.join(',')], { timeout: 2000 }, (err, stdout) => {
      const out = new Map();
      if (!err) for (const line of String(stdout).trim().split('\n')) {
        const [pid, cpu, rss] = line.trim().split(/\s+/).map(Number);
        if (Number.isFinite(pid)) out.set(pid, { cpu, memoryMB: Math.round(rss / 1024) });
      }
      resolve(out);
    });
  });
}
async function sample() {
  let metrics = [];
  try { metrics = app.getAppMetrics(); } catch (_) { return; }
  const list = metrics.map((m) => ({
    pid: m.pid,
    name: m.type === 'Tab' ? windowName(m.pid) : m.type === 'Utility' && m.serviceName ? `Helper (${String(m.serviceName).replace(/^.*\./, '')})` : KIND[m.type] || m.type,
    kind: m.type === 'Browser' ? 'main' : m.type === 'Tab' ? 'window' : 'helper',
    cpu: Math.max(0, Math.round((m.cpu && m.cpu.percentCPUUsage || 0) * 10) / 10),
    memoryMB: Math.round(((m.memory && m.memory.workingSetSize) || 0) / 1024),
  }));
  const plugins = pluginProcs();
  const ps = watching() ? await psStats(plugins.map((p) => p.pid)) : new Map();
  for (const p of plugins) {
    const s = ps.get(p.pid);
    list.push({ pid: p.pid, name: `Plugin: ${p.name}`, kind: 'plugin', cpu: s ? s.cpu : null, memoryMB: s ? s.memoryMB : null });
  }
  processList = list;
  const now = Date.now();
  history.push({ at: now, cpu: list.reduce((a, p) => a + (p.cpu || 0), 0), memoryMB: list.reduce((a, p) => a + (p.memoryMB || 0), 0) });
  history = history.filter((h) => now - h.at < HISTORY_MS);
}

// ── Memory available on this computer ──
// macOS counts its file cache as used, so os.freemem() looks alarmingly low
// on a healthy Mac; vm_stat's free + inactive + speculative pages is closer
// to what Activity Monitor calls available
let available = null;
function readAvailable() {
  if (process.platform !== 'darwin') { available = os.freemem(); return; }
  execFile('vm_stat', [], { timeout: 2000 }, (err, stdout) => {
    if (err) { available = os.freemem(); return; }
    const page = Number((String(stdout).match(/page size of (\d+)/) || [])[1]) || 4096;
    const pages = (label) => Number((String(stdout).match(new RegExp(`${label}:\\s+(\\d+)`)) || [])[1]) || 0;
    available = (pages('Pages free') + pages('Pages inactive') + pages('Pages speculative')) * page;
  });
}

// ── JPMixer's data folder ──
let folder = { bytes: null, backupsBytes: null, at: 0, measuring: false };
async function folderSize(dir, depth = 0) {
  let total = 0;
  let entries = [];
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (_) { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) { if (depth < 8) total += await folderSize(p, depth + 1); }
    else { try { total += (await fs.promises.stat(p)).size; } catch (_) {} }
  }
  return total;
}
let backupsDir = () => null;
async function measureFolder() {
  const root = app.getPath('userData');
  const backups = backupsDir();
  folder = { bytes: await folderSize(root), backupsBytes: backups ? await folderSize(backups) : null, at: Date.now() };
}

// Electron's own process numbers are sampled all the time (in-process, and
// what the peaks need). The rest (vm_stat, ps for plugins, walking the data
// folder) only runs while the Performance tab is being looked at.
let started = false;
let lookedAt = 0; // the last collect()
const watching = () => Date.now() - lookedAt < 10000;
function start(given = {}) {
  if (started) return;
  started = true;
  if (typeof given.pluginProcesses === 'function') pluginProcs = given.pluginProcesses;
  if (typeof given.backupsDir === 'function') backupsDir = given.backupsDir;
  sample();
  setInterval(() => { sample(); if (watching()) readAvailable(); }, SAMPLE_MS).unref();
}

function diskFree(dir) {
  try { const s = fs.statfsSync(dir); return { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize }; }
  catch (_) { return { freeBytes: null, totalBytes: null }; }
}

// Everything this module measures, as one object
function collect() {
  if (!watching()) { available = null; readAvailable(); } // first look in a while: os.freemem() until vm_stat answers, never an old figure
  lookedAt = Date.now();
  if (Date.now() - folder.at > FOLDER_EVERY_MS && !folder.measuring) { folder.measuring = true; measureFolder().catch(() => { folder.measuring = false; }); }
  const cores = os.cpus().length || 1;
  const peak = (key) => history.reduce((m, h) => Math.max(m, h[key]), 0);
  const total = { cpu: processList.reduce((a, p) => a + (p.cpu || 0), 0), memoryMB: processList.reduce((a, p) => a + (p.memoryMB || 0), 0) };
  let thermal = 'unknown', onBattery = false;
  try { thermal = powerMonitor.getCurrentThermalState ? powerMonitor.getCurrentThermalState() : 'unknown'; } catch (_) {}
  try { onBattery = powerMonitor.isOnBatteryPower ? powerMonitor.isOnBatteryPower() : false; } catch (_) {}
  const cpus = os.cpus();
  return {
    at: new Date().toISOString(),
    jpmixer: {
      version: app.getVersion(),
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      cpuOfComputer: Math.round((total.cpu / cores) * 10) / 10,   // % of the whole computer
      cpuPeakOfComputer: Math.round((peak('cpu') / cores) * 10) / 10,
      memoryMB: total.memoryMB,
      memoryPeakMB: peak('memoryMB'),
      responsiveness: { ...loopLast, peakMaxMs: loopPeak.reduce((m, p) => Math.max(m, p.maxMs), 0) },
      processes: processList.slice().sort((a, b) => (b.memoryMB || 0) - (a.memoryMB || 0)),
      versions: { electron: process.versions.electron || '', node: process.versions.node, chrome: process.versions.chrome || '' },
    },
    traffic: trafficRate(),
    computer: {
      name: os.hostname(),
      os: `${process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : os.type()} ${process.getSystemVersion ? process.getSystemVersion() : os.release()}`,
      arch: os.arch(),
      cpuModel: cpus[0] ? cpus[0].model.trim() : '',
      cores,
      load: process.platform === 'win32' ? null : Math.round((os.loadavg()[0] / cores) * 100), // % of the computer, last minute
      memoryTotalBytes: os.totalmem(),
      memoryAvailableBytes: available === null ? os.freemem() : available,
      disk: diskFree(app.getPath('userData')),
      uptimeSec: Math.round(os.uptime()),
      thermal,
      onBattery,
    },
    folder: { path: app.getPath('userData'), bytes: folder.bytes, backupsBytes: folder.backupsBytes },
  };
}

// The summary at the top: each thing worth knowing, worst first.
// level: 'error' (needs attention now), 'warn' (keep an eye on it), 'info'
function health(s) {
  const out = [];
  const add = (level, text) => out.push({ level, text });
  const j = s.jpmixer, c = s.computer, x = s.extra || {};
  if (c.thermal === 'critical') add('error', 'This computer is very hot and is slowing itself down. Check its vents and airflow.');
  else if (c.thermal === 'serious') add('warn', 'This computer is running hot and may slow down. Check its vents and airflow.');
  if (j.responsiveness.maxMs >= 500) add('error', `JPMixer was held up for ${j.responsiveness.maxMs} ms in the last 10 seconds. Faders and mutes can lag while that happens.`);
  else if (j.responsiveness.maxMs >= 200) add('warn', `JPMixer was held up for ${j.responsiveness.maxMs} ms in the last 10 seconds.`);
  if (j.cpuOfComputer >= 60) add('warn', `JPMixer is using ${Math.round(j.cpuOfComputer)}% of this computer’s processor.`);
  if (c.load !== null && c.load >= 90) add('warn', `This computer is very busy (${c.load}% load). Other apps may be slowing JPMixer down.`);
  const availPct = c.memoryTotalBytes ? (c.memoryAvailableBytes / c.memoryTotalBytes) * 100 : 100;
  if (availPct < 5) add('error', 'This computer is almost out of memory. Quit apps you don’t need.');
  else if (availPct < 12) add('warn', 'This computer is low on memory.');
  if (j.memoryMB >= 2048) add('warn', `JPMixer is using ${(j.memoryMB / 1024).toFixed(1)} GB of memory. Restarting it would free that.`);
  if (c.disk.freeBytes !== null && c.disk.freeBytes < 1024 ** 3) add('error', 'This computer’s disk is almost full. Backups and logs may stop saving.');
  else if (c.disk.freeBytes !== null && c.disk.freeBytes < 5 * 1024 ** 3) add('warn', 'This computer’s disk is getting full.');
  if (c.onBattery) add('warn', 'This computer is running on battery.');
  if (x.pco && x.pco.last20s >= 80) add('warn', `Planning Center: ${x.pco.last20s} requests in the last 20 seconds (the limit is ${x.pco.limitPer20s}).`);
  if (x.pco && x.pco.lastFailure && x.pco.lastFailure.status === 429 && Date.now() - Date.parse(x.pco.lastFailure.at) < 10 * 60 * 1000) add('warn', 'Planning Center asked JPMixer to slow down in the last 10 minutes.');
  if (x.server && !x.server.running) add('info', 'The server is stopped, so phones and pages can’t connect.');
  else if (x.console && !x.console.demo && !x.console.connected) add('warn', 'The console isn’t connected.');
  for (const p of (x.plugins || [])) if (p.state === 'crashed') add('warn', `The ${p.name} plugin stopped after crashing.`);
  const order = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

module.exports = { start, collect, health, noteTraffic };
