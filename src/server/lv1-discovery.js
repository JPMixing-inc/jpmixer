'use strict';

// ── Finding LV1 on the network ──────────────────────────────────────────────
// LV1 picks a new TCP port for its MyMon service every time it starts, and
// announces it about once a second, the way Waves' apps find it:
//
//   UDP multicast 225.1.1.1:13337 (and ff02::fb:13337), an OSC message
//   /zDNS ,ssisi s s i …  [service, id, 1, computer name, port,
//                          then (address, interface, index) per interface …]
//
// LV1 17.3 announces two services: _waveslv113._tcp is the MyMon service
// JPMixer uses; _wavesremotelv1._tcp is MyFOH's screen mirroring.
//
// find(host) resolves to { host, port } or null. host blank = any LV1 on
// the network, this computer's first. A candidate only counts once LV1
// itself answers on it: the MyMon service greets every new connection with
// /Notify/ServiceVersion straight away.
//
// When no announcement is heard:
//   - LV1 on this computer: the ports LV1's own processes listen on
//     (lsof / Get-NetTCPConnection)
//   - LV1 at an address from Settings: that computer's ports, checked
//     directly. Multicast doesn't cross routers, so an LV1 on another
//     network never announces itself here. Only the address in Settings is
//     checked, the range Mac and Windows pick from (49152-65535) and
//     nearest the last port first, at most once a minute while LV1 can't be found.

const net = require('net');
const os = require('os');
const dgram = require('dgram');
const { execFile } = require('child_process');
const P = require('./lv1-protocol');

const GROUP = '225.1.1.1', PORT = 13337;
const FRESH_MS = 10000;
const announcements = new Map(); // `${sender}|${service}` -> { sender, service, name, port, addresses, at }
const lastGood = new Map();      // wanted host ('' = any) -> { host, port }
const lastScan = new Map();      // host -> when its ports were last checked
const SCAN_EVERY_MS = 60000;
// Listing this computer's own LV1 ports spawns lsof or PowerShell: not on
// every retry while LV1 isn't open (an LV1 that starts announces itself)
let lastLocalList = 0;
const LOCAL_LIST_EVERY_MS = 15000;
let socket = null;

// → { service, name, port, addresses } from /zDNS args, or null
function parseAnnouncement(args) {
  if (!Array.isArray(args) || typeof args[0] !== 'string' || !Number.isInteger(args[4])) return null;
  const addresses = [];
  for (let o = 5; o + 2 < args.length && typeof args[o] === 'string' && typeof args[o + 1] === 'string'; o += 3) addresses.push(args[o]);
  return { service: args[0], name: typeof args[3] === 'string' ? args[3] : '', port: args[4], addresses };
}

function noteAnnouncement(args, sender) {
  const a = parseAnnouncement(args);
  if (!a || a.port < 1 || a.port > 65535) return;
  announcements.set(`${sender}|${a.service}`, { ...a, sender, at: Date.now() });
}

// Listening for announcements. Joins the group on every IPv4 network this
// computer is on, and on ones that appear later (JPMixer opened at login
// before Wi-Fi or Ethernet was up). If nothing at all is heard for a while
// the socket is opened afresh, in case a network came back and dropped the
// group on the way.
let joined = new Set(), bound = false, openedAt = 0, heardAt = 0;
const REOPEN_MS = 30000;
function joinNetworks() {
  if (!socket || !bound) return;
  const local = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  for (const address of [...local, '127.0.0.1']) {
    if (joined.has(address)) continue;
    try { socket.addMembership(GROUP, address); joined.add(address); } catch (_) {}
  }
  if (!joined.size) { try { socket.addMembership(GROUP); joined.add('default'); } catch (_) {} }
}
function listen({ port = PORT } = {}) {
  if (socket) {
    if (Date.now() - heardAt > REOPEN_MS && Date.now() - openedAt > REOPEN_MS) { closeSocket(); } else { joinNetworks(); return; }
  }
  const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  socket = s; bound = false; joined = new Set(); openedAt = Date.now();
  s.on('error', () => { if (socket === s) socket = null; try { s.close(); } catch (_) {} });
  s.on('message', (buf, rinfo) => {
    heardAt = Date.now();
    try { const m = P.decodeMessage(buf); if (m.address === '/zDNS') noteAnnouncement(m.args, rinfo.address); } catch (_) {}
  });
  s.bind(port, () => { bound = true; joinNetworks(); });
}
function closeSocket() {
  if (socket) { try { socket.close(); } catch (_) {} socket = null; }
  bound = false; joined = new Set();
}
function close() {
  closeSocket();
  announcements.clear();
  lastLocalList = 0;
}

// True once whatever listens on host:port greets like LV1's MyMon service
function isLv1(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const conn = net.connect({ host, port });
    const reader = new P.FrameReader();
    let done = false;
    const finish = (ok) => { if (done) return; done = true; clearTimeout(timer); conn.destroy(); resolve(ok); };
    const timer = setTimeout(() => finish(false), timeoutMs);
    conn.on('data', (chunk) => { if (reader.push(chunk).some(m => m.address === '/Notify/ServiceVersion')) finish(true); });
    conn.on('error', () => finish(false));
    conn.on('close', () => finish(false));
  });
}

const ownAddresses = () => Object.values(os.networkInterfaces()).flat().filter(Boolean).map(i => i.address);
function isThisComputer(host) {
  return !host || host === 'localhost' || host === '::1' || /^127\./.test(host) || ownAddresses().includes(host);
}

function run(cmd, args) {
  return new Promise((resolve) => execFile(cmd, args, { timeout: 4000, windowsHide: true }, (err, stdout) => resolve(err ? '' : String(stdout))));
}
// Ports LV1's own processes are listening on, on this computer
async function localPorts() {
  if (process.platform === 'darwin' || process.platform === 'linux') {
    const out = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN']);
    return out.split('\n').filter(l => /^(eMotion|MyRemote|MixTwin|LV1)/i.test(l))
      .map(l => Number((l.match(/:(\d+) \(LISTEN\)/) || [])[1])).filter(Boolean);
  }
  if (process.platform === 'win32') {
    const script = "Get-NetTCPConnection -State Listen | ForEach-Object { $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; if ($p.ProcessName -match 'eMotion|LV1|MyRemote|MixTwin') { $_.LocalPort } }";
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    return out.split(/\s+/).map(Number).filter(Boolean);
  }
  return [];
}

// Open TCP ports on host among `ports`, a few hundred at a time
function openPorts(host, ports, { timeoutMs = 400, parallel = 256 } = {}) {
  return new Promise((resolve) => {
    const open = []; let next = 0, running = 0;
    const launch = () => {
      if (next >= ports.length && running === 0) { resolve(open); return; }
      while (running < parallel && next < ports.length) {
        const port = ports[next++]; running++;
        const conn = net.connect({ host, port });
        let settled = false;
        const done = (ok) => { if (settled) return; settled = true; clearTimeout(timer); conn.destroy(); if (ok) open.push(port); running--; launch(); };
        const timer = setTimeout(() => done(false), timeoutMs);
        conn.on('connect', () => done(true));
        conn.on('error', () => done(false));
      }
    };
    launch();
  });
}
// LV1's MyMon port on host, by checking its ports directly
async function scan(host, { range = [49152, 65535], near = null, ports: only = null } = {}) {
  const ports = only ? [...only] : [];
  if (!only) for (let p = range[0]; p <= range[1]; p++) ports.push(p);
  if (near) ports.sort((a, b) => Math.abs(a - near) - Math.abs(b - near));
  for (let o = 0; o < ports.length; o += 2048) {
    for (const port of await openPorts(host, ports.slice(o, o + 2048))) if (await isLv1(host, port)) return port;
  }
  return null;
}

// Announcements for the wanted host ('' = any), best first: the MyMon
// service before the others, this computer's before other computers'
function candidates(wanted) {
  const own = new Set(ownAddresses());
  const fresh = [...announcements.values()].filter(a => Date.now() - a.at < FRESH_MS);
  const matching = wanted ? fresh.filter(a => a.sender === wanted || a.addresses.includes(wanted)) : fresh;
  const rank = a => (/^_waveslv1\d*\._tcp$/.test(a.service) ? 0 : 2) + (own.has(a.sender) ? 0 : 1);
  return matching.sort((x, y) => rank(x) - rank(y)).map(a => ({ host: wanted || (own.has(a.sender) ? '127.0.0.1' : a.sender), port: a.port }));
}

async function find(host = '', { waitMs = 2500, scanRange } = {}) {
  const wanted = (host || '').trim();
  listen();
  const tried = new Set();
  const attempt = async (t) => {
    const key = `${t.host}:${t.port}`;
    if (!t.port || tried.has(key)) return false;
    tried.add(key);
    if (await isLv1(t.host, t.port)) { lastGood.set(wanted, t); return true; }
    return false;
  };
  const last = lastGood.get(wanted);
  if (last && await attempt(last)) return last;
  // Announcements arrive about once a second
  const end = Date.now() + waitMs;
  while (true) {
    for (const t of candidates(wanted)) if (await attempt(t)) return t;
    if (Date.now() >= end) break;
    await new Promise(r => setTimeout(r, 250));
  }
  if (isThisComputer(wanted)) {
    if (Date.now() - lastLocalList < LOCAL_LIST_EVERY_MS) return null;
    lastLocalList = Date.now();
    const h = wanted && !/^127\.|^localhost$/.test(wanted) ? wanted : '127.0.0.1';
    for (const port of [...new Set(await localPorts())]) if (await attempt({ host: h, port })) return { host: h, port };
    return null;
  }
  if (!wanted || Date.now() - (lastScan.get(wanted) || 0) < SCAN_EVERY_MS) return null;
  lastScan.set(wanted, Date.now());
  const port = await scan(wanted, { range: scanRange, near: last && last.port });
  if (port) { const t = { host: wanted, port }; lastGood.set(wanted, t); return t; }
  return null;
}

// The last place LV1 was found, kept across JPMixer restarts: finding an LV1
// on another network takes a port check of up to half a minute, and LV1
// keeps its port until it restarts.
function remember(wanted, target) { lastGood.set((wanted || '').trim(), target); }
function remembered() { return Object.fromEntries(lastGood); }

module.exports = { find, isLv1, remember, remembered, listen, close, parseAnnouncement, _noteAnnouncement: noteAnnouncement, _announcements: announcements, _lastGood: lastGood, _lastScan: lastScan, _scan: scan };
