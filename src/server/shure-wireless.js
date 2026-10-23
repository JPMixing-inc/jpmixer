'use strict';

// ── Shure wireless monitoring (read-only) ─────────────────────────────────
// Shows each Shure wireless channel's name, battery and transmitter on the
// Settings → Integrations → Shure wireless tab and the FOH Home Wireless card, like Wireless
// Workbench's monitoring, by talking to the receivers directly.
//
// Finding receivers only listens. Shure receivers announce themselves on the
// ACN discovery group (UDP 8427, multicast 239.255.254.253) while Wireless
// Workbench or another controller is looking for them; each announcement
// names the model (acn-fctn) and carries the receiver's address. Nothing is
// ever sent to that group from here. CONFIRMED on a real network with WWB 6
// and QLX-D receivers.
//
// Reading a receiver uses Shure's published command strings: plain ASCII on
// TCP 2202 (Shure, "Command Strings for QLX-D Receivers", rev 11/2/2023):
//   < GET 1 ALL >                → every parameter as < REP 1 KEY value > lines
//   < REP 1 BATT_BARS 004 >      → also sent by the receiver on its own when a
//                                  value changes (front panel, WWB, a new pack)
// Only receivers ticked in Settings are connected to, one connection each,
// and only GET strings are ever sent (see send()): nothing here can change a
// receiver. ULX-D, SLX-D and Axient Digital use the same strings; QLX-D's
// are checked against Shure's document and a real receiver.
//
// Every 15 s the name, battery, run time and transmitter type are asked for
// again (as Micboard does every 10 s): a missed report still shows up, and
// the replies prove the connection is alive. A receiver that says nothing
// for 60 s is reconnected (as Bitfocus Companion's Shure module does).
//
// Metering (METER_RATE) is never turned on. Micboard's notes (docs/qlxd.md)
// say QLX-D firmware 2.2.11 and later locks up when a packet is missed
// while it streams meter SAMPLEs, and Shure never fixed it. A GET-only
// session was fine on a real QLXD4 on 2.3.22.0 (2026-10-23). This is still
// off by default, per receiver, and Settings says so.
//
// Battery like Micboard: 4–5 bars good, 3 replace, 0–2 critical. When a
// transmitter switches off the receiver reports 255 ("unknown"); its last
// battery is kept for 30 minutes so the card can show what it was.
//
// Every receiver seen is remembered (wirelessKnown, saved through the saver
// main.js sets), so after a restart they're all listed even with Wireless
// Workbench closed. Each is known by its hardware id: the first part of the
// cid it announces, which is the end of its MAC address (cid DD4D3C7A-… ↔
// MAC 00:0E:DD:4D:3C:7A, CONFIRMED on a real QLXD4). If a receiver turns up
// at a new address, JPMixer follows it, ticked or not.
//
// A channel can belong to an aux mix (wirelessAux { "id/1": aux }); the
// musician's phone mixer and Monitor Engineer then show that mic's battery
// (/wireless-aux, see mixesForPages).

const net = require('net');
const dgram = require('dgram');
const os = require('os');

const DISCOVERY_GROUP = '239.255.254.253';
const DISCOVERY_PORT = 8427;
let commandPort = 2202;          // tests point this at a stand-in receiver
const SEEN_FOR_MS = 2 * 60 * 1000;
const RECONNECT_MIN_MS = 5000, RECONNECT_MAX_MS = 60000, CONNECT_TIMEOUT_MS = 5000;
let POLL_MS = 15000, SILENT_MS = 60000;   // tests shorten these
const LAST_BATTERY_MS = 30 * 60 * 1000;
const POLLED = ['CHAN_NAME', 'BATT_BARS', 'BATT_RUN_TIME', 'TX_TYPE'];
const IP = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

// Channels per receiver, by the model name it announces
const CHANNELS = { QLXD4: 1, 'QLXD: Rx': 1, ULXD4: 1, ULXD4D: 2, ULXD4Q: 4, SLXD4: 1, SLXD4D: 2, AD4D: 2, AD4Q: 4 };
const channelsFor = (model) => CHANNELS[model] || (/Q$/.test(model || '') ? 4 : /D$/.test(model || '') ? 2 : 1);

let enabled = false;
let watched = new Map();        // ip -> Receiver
const discovered = new Map();   // ip -> { model, cid, id, lastSeen }
let known = new Map();          // hardware id -> { id, ip, model } — every receiver ever seen (wirelessKnown)
let ticked = [];                // [{ ip, id }] — the receivers to read (wirelessReceivers)
let auxOf = {};                 // "id/channel" -> aux number (wirelessAux)
let discoverySocket = null;
let onChange = () => {};
let saver = null;               // (patch) => saves config keys; set by main.js
let saveTimer = null;
let noDiscovery = false;        // tests: don't open the discovery socket

// The hardware id: 8 hex digits, from an announcement's cid or a MAC address
const idFromCid = (cid) => (/^[0-9A-F]{8}-/i.test(cid || '') ? cid.slice(0, 8).toUpperCase() : null);
const idFromMac = (mac) => { const h = String(mac || '').replace(/[^0-9a-f]/gi, ''); return h.length === 12 ? h.slice(4).toUpperCase() : null; };
const ID = /^[0-9A-F]{8}$/;

// What's remembered changed: save it (shortly, so a burst of announcements
// saves once; stop() saves straight away anything still waiting)
function saveNow() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!saver) return;
  try { saver({ wirelessKnown: [...known.values()].map(({ id, ip, model }) => ({ id, ip, model })), wirelessReceivers: ticked.map(({ ip, id }) => (id ? { ip, id } : { ip })), wirelessAux: { ...auxOf } }); }
  catch (e) { console.error('[JPMixer/Wireless] could not save receivers:', e.message); }
}
function persist() {
  if (!saver) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
  if (saveTimer.unref) saveTimer.unref();
}

// A receiver seen (announced, or read by address): remember it, and follow it to a new address
function remember(id, ip, model) {
  if (!ID.test(id || '') || !IP.test(ip || '')) return;
  const was = known.get(id);
  let changed = !was || was.ip !== ip || (model && was.model !== model);
  known.set(id, { id, ip, model: model || (was && was.model) || null });
  // A mix chosen while only its address was known (added by address) now
  // follows its hardware id, so it survives the address changing
  for (const key of Object.keys(auxOf)) {
    const [where, n] = key.split('/');
    if (where !== ip) continue;
    if (!auxOf[`${id}/${n}`]) auxOf[`${id}/${n}`] = auxOf[key];
    delete auxOf[key];
    changed = true;
  }
  for (const t of ticked) {
    if (t.id === id && t.ip !== ip) { moveReceiver(t.ip, ip); t.ip = ip; changed = true; }
    else if (!t.id && t.ip === ip) { t.id = id; changed = true; }
  }
  if (changed) { persist(); onChange(); }
}
function moveReceiver(fromIp, toIp) {
  const r = watched.get(fromIp);
  if (!r) return;
  r.close();
  watched.delete(fromIp);
  if (!watched.has(toIp)) watched.set(toIp, new Receiver(toIp));
}

// ── Discovery (listen only) ───────────────────────────────────────────────
// An SLP attribute reply: "(cid=…),(acn-fctn=QLXD4),(acn-uacn=…),(csl-esta.dmp=esta.sdt/192.168.1.40:57383;…)"
function parseAnnouncement(buf, fromIp) {
  if (!Buffer.isBuffer(buf) || buf.length < 16 || buf[0] !== 2) return null;
  const text = buf.toString('latin1');
  const attr = (name) => { const m = text.match(new RegExp(`\\(${name}=([^),]*)\\)`)); return m ? m[1].trim() : null; };
  const model = attr('acn-fctn');
  if (!model || /^WWB/i.test(model)) return null; // Wireless Workbench announces itself too
  const sdt = text.match(/esta\.sdt\/(\d+\.\d+\.\d+\.\d+):\d+/);
  const ip = sdt ? sdt[1] : fromIp;
  if (!IP.test(String(ip || ''))) return null;
  const cid = attr('cid');
  return { ip, model, cid, id: idFromCid(cid) };
}

function startDiscovery() {
  if (discoverySocket) return;
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  discoverySocket = sock;
  sock.on('error', (e) => { console.error('[JPMixer/Wireless] discovery:', e.message); stopDiscovery(); });
  sock.on('message', (msg, rinfo) => onAnnouncement(msg, rinfo.address));
  sock.bind(DISCOVERY_PORT, () => {
    const addresses = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
    for (const address of addresses.length ? addresses : [undefined]) {
      try { sock.addMembership(DISCOVERY_GROUP, address); } catch (_) {}
    }
  });
}
function onAnnouncement(msg, fromIp) {
  const found = parseAnnouncement(msg, fromIp);
  if (!found) return;
  const seen = discovered.get(found.ip);
  discovered.set(found.ip, { model: found.model, cid: found.cid, id: found.id, lastSeen: Date.now() });
  const r = watched.get(found.ip);
  if (r && !r.model) { r.model = found.model; r.resizeChannels(); }
  if (found.id) remember(found.id, found.ip, found.model);
  if (!seen) onChange();
}
function stopDiscovery() {
  if (!discoverySocket) return;
  try { discoverySocket.close(); } catch (_) {}
  discoverySocket = null;
}

// ── One receiver ──────────────────────────────────────────────────────────
// Command-string values as the pages show them; Shure's "not available"
// codes (255, 65535 …) become null.
const NA3 = new Set([252, 253, 254, 255]), NA5 = new Set([65532, 65533, 65534, 65535]);
const num = (v) => (/^\d+$/.test(v) ? Number(v) : NaN);
function applyValue(ch, key, raw) {
  const v = raw.replace(/^\{|\}$/g, '').trim();
  const n = num(v);
  switch (key) {
    case 'CHAN_NAME': ch.name = v; break;
    case 'BATT_BARS': {
      const bars = Number.isFinite(n) && !NA3.has(n) && n <= 5 ? n : null;
      // Remember the last real reading for when the transmitter goes off
      if (bars === null && ch.battBars !== null && ch.battBars !== undefined) ch.lastBatt = { bars: ch.battBars, at: Date.now() };
      if (bars !== null) ch.lastBatt = null;
      ch.battBars = bars;
      break;
    }
    case 'BATT_RUN_TIME': ch.runTimeMin = Number.isFinite(n) && !NA5.has(n) ? n : null; break;
    case 'BATT_CHARGE': ch.charge = Number.isFinite(n) && !NA3.has(n) && n <= 100 ? n : null; break;
    case 'BATT_TYPE': ch.battType = v === 'UNKN' ? null : v; break;
    case 'TX_TYPE': ch.txType = v === 'UNKN' ? null : v; break;
    case 'TX_RF_PWR': ch.txPower = ['LOW', 'NORMAL', 'HIGH'].includes(v) ? v : null; break;
    case 'FREQUENCY': ch.frequency = /^\d{6}$/.test(v) ? `${v.slice(0, 3)}.${v.slice(3)}` : null; break;
    case 'GROUP_CHAN': ch.groupChan = /\d/.test(v) ? v : null; break;
    case 'AUDIO_GAIN': ch.gainDb = Number.isFinite(n) && n <= 60 ? n - 18 : null; break;
    case 'TX_MUTE_STATUS': ch.txMuted = v === 'ON' ? true : v === 'OFF' ? false : null; break;
    case 'ENCRYPTION_WARNING': ch.encryptionWarning = v === 'ON'; break;
    default: return false;
  }
  return true;
}
const blankChannel = (n) => ({ n, name: '', battBars: null, lastBatt: null, runTimeMin: null, charge: null, battType: null, txType: null, txPower: null, frequency: null, groupChan: null, gainDb: null, txMuted: null, encryptionWarning: false });
const batteryState = (bars) => (bars === null || bars === undefined ? null : bars >= 4 ? 'good' : bars === 3 ? 'replace' : 'critical');

class Receiver {
  constructor(ip) {
    this.ip = ip;
    this.model = discovered.get(ip)?.model || [...known.values()].find((k) => k.ip === ip)?.model || null;
    this.id = null;              // hardware id, from its MAC address
    this.channels = [];
    this.resizeChannels();
    this.status = 'connecting';
    this.error = null;
    this.firmware = null;
    this.socket = null;
    this.buffer = '';
    this.retryMs = RECONNECT_MIN_MS;
    this.retryTimer = null;
    this.pollTimer = null;
    this.lastHeard = 0;
    this.closed = false;
    this.connect();
  }
  resizeChannels() {
    const count = channelsFor(this.model);
    const had = this.channels.length;
    while (this.channels.length < count) this.channels.push(blankChannel(this.channels.length + 1));
    this.channels.length = count;
    // The model arrived after connecting (a quad found later): read the new channels
    if (this.status === 'connected') for (let n = had + 1; n <= count; n++) this.send(`< GET ${n} ALL >`);
  }
  // The only way anything reaches a receiver: GET strings, nothing else
  send(command) {
    if (!/^< GET (\d )?[A-Z_]+ >$/.test(command)) throw new Error(`refusing to send "${command}"`);
    if (this.socket && !this.socket.destroyed) this.socket.write(command);
  }
  connect() {
    if (this.closed) return;
    const sock = net.createConnection({ host: this.ip, port: commandPort });
    this.socket = sock;
    this.buffer = '';
    sock.setEncoding('latin1');
    sock.setTimeout(CONNECT_TIMEOUT_MS, () => { if (this.status !== 'connected') sock.destroy(new Error('no answer')); });
    sock.on('connect', () => {
      sock.setTimeout(0);
      sock.setKeepAlive(true, 10000);
      this.status = 'connected'; this.error = null; this.retryMs = RECONNECT_MIN_MS;
      this.lastHeard = Date.now();
      this.send('< GET FW_VER >');
      // Model unknown (added by address with Wireless Workbench closed):
      // channel 1 as always, then every channel at once, as Companion's
      // Shure module asks, taking as many channels as the receiver reports
      // (receive). A receiver that ignores the second still gives channel 1.
      for (const ch of this.channels) this.send(`< GET ${ch.n} ALL >`);
      if (!this.model) this.send('< GET 0 ALL >');
      clearInterval(this.pollTimer);
      this.pollTimer = setInterval(() => this.poll(sock), POLL_MS);
      onChange();
    });
    sock.on('data', (chunk) => this.receive(chunk));
    sock.on('error', (e) => { this.error = e.code === 'ECONNREFUSED' ? 'Refused on port 2202' : e.code === 'EHOSTUNREACH' || e.message === 'no answer' ? 'Not answering' : e.message; });
    sock.on('close', () => {
      if (this.socket !== sock) return;
      this.socket = null;
      clearInterval(this.pollTimer); this.pollTimer = null;
      if (this.closed) return;
      const was = this.status;
      this.status = 'offline';
      if (was !== 'offline') onChange();
      this.retryTimer = setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(RECONNECT_MAX_MS, this.retryMs * 2);
    });
  }
  // The regular re-read, which is also the heartbeat: silence means a
  // receiver (or the network) has gone away without closing the connection
  poll(sock) {
    if (sock !== this.socket || this.status !== 'connected') return;
    if (Date.now() - this.lastHeard > SILENT_MS) { this.error = 'Stopped answering'; sock.destroy(); return; }
    for (const ch of this.channels) for (const key of POLLED) this.send(`< GET ${ch.n} ${key} >`);
  }
  // Strings arrive as "< REP 1 KEY value >", possibly several per packet or
  // split across packets; names are in braces and may contain spaces
  receive(chunk) {
    this.lastHeard = Date.now();
    this.buffer += chunk;
    if (this.buffer.length > 65536) this.buffer = this.buffer.slice(-4096);
    let changed = false, m;
    const re = /<\s*((?:[^<>{}]|\{[^}]*\})*?)\s*>/g;
    let consumed = 0;
    while ((m = re.exec(this.buffer))) {
      consumed = re.lastIndex;
      const parts = m[1].match(/\{[^}]*\}|\S+/g) || [];
      if (parts[0] !== 'REP' && parts[0] !== 'REPORT') continue;
      if (/^\d+$/.test(parts[1] || '')) {
        const n = Number(parts[1]);
        if (!this.model && n > this.channels.length && n <= 4) while (this.channels.length < n) this.channels.push(blankChannel(this.channels.length + 1));
        const ch = this.channels[n - 1];
        if (ch && parts[2]) changed = applyValue(ch, parts[2], parts.slice(3).join(' ')) || changed;
      } else if (parts[1] === 'FW_VER') {
        this.firmware = (parts.slice(2).join(' ').replace(/^\{|\}$/g, '').trim()) || null; changed = true;
      } else if (parts[1] === 'MAC_ADDR') {
        const id = idFromMac(parts[2]);
        if (id && id !== this.id) { this.id = id; remember(id, this.ip, this.model); changed = true; }
      }
    }
    if (consumed) this.buffer = this.buffer.slice(consumed);
    if (changed) onChange();
  }
  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.pollTimer);
    if (this.socket) { try { this.socket.destroy(); } catch (_) {} this.socket = null; }
  }
  toJSON() {
    const id = this.id || [...known.values()].find((k) => k.ip === this.ip)?.id || null;
    return { ip: this.ip, id, model: this.model, status: this.status, error: this.status === 'connected' ? null : this.error, firmware: this.firmware,
      channels: this.channels.map(c => ({ ...c, key: channelKey(id, this.ip, c.n), aux: auxFor(id, this.ip, c.n) })) };
  }
}

// A channel's key for its mix: the receiver's hardware id (or, until that's
// known, its address) and the channel number
const channelKey = (id, ip, n) => `${id || ip}/${n}`;
const auxFor = (id, ip, n) => (id && auxOf[`${id}/${n}`]) || auxOf[`${ip}/${n}`] || null;

// ── Settings ──────────────────────────────────────────────────────────────
// wirelessEnabled: listen for receivers and read the ticked ones.
// wirelessReceivers: [{ ip, id }] — the receivers to read; id follows a receiver to a new address.
// wirelessKnown: [{ id, ip, model }] — every receiver seen, remembered.
// wirelessAux: { "id/channel": aux } — which mix each channel belongs to.
function applyConfig(cfg) {
  enabled = !!cfg.wirelessEnabled;
  known = new Map((Array.isArray(cfg.wirelessKnown) ? cfg.wirelessKnown : [])
    .filter((k) => k && ID.test(String(k.id || '')) && IP.test(String(k.ip || '')))
    .map((k) => [k.id, { id: k.id, ip: k.ip, model: typeof k.model === 'string' ? k.model.slice(0, 40) : null }]));
  ticked = (Array.isArray(cfg.wirelessReceivers) ? cfg.wirelessReceivers : [])
    .map((r) => ({ ip: String(r && r.ip || '').trim(), id: ID.test(String(r && r.id || '')) ? r.id : null }))
    .filter((r) => IP.test(r.ip))
    // a remembered receiver at a newer address is read there
    .map((r) => (r.id && known.get(r.id) ? { ...r, ip: known.get(r.id).ip } : r));
  auxOf = {};
  for (const [key, aux] of Object.entries(cfg.wirelessAux && typeof cfg.wirelessAux === 'object' ? cfg.wirelessAux : {})) {
    if (/^[0-9A-Za-z.]{1,40}\/\d$/.test(key) && Number.isInteger(aux) && aux >= 1 && aux <= 64) auxOf[key] = aux;
  }
  const want = new Set(enabled ? ticked.map((r) => r.ip) : []);
  for (const [ip, r] of watched) if (!want.has(ip)) { r.close(); watched.delete(ip); }
  for (const ip of want) if (!watched.has(ip)) watched.set(ip, new Receiver(ip));
  if (enabled && !noDiscovery) startDiscovery(); else if (!enabled) { stopDiscovery(); discovered.clear(); }
  onChange();
}

function getStatus() {
  const now = Date.now();
  const seenNow = new Map([...discovered].filter(([, d]) => now - d.lastSeen < SEEN_FOR_MS));
  const found = [...seenNow].map(([ip, d]) => ({ ip, id: d.id || null, model: d.model, seenNow: true, watched: watched.has(ip) }));
  // Remembered receivers not announcing right now are listed too
  for (const k of known.values()) if (!seenNow.has(k.ip)) found.push({ ip: k.ip, id: k.id, model: k.model, seenNow: false, watched: watched.has(k.ip) });
  found.sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
  return { enabled, discovered: found, receivers: [...watched.values()].map(r => r.toJSON()) };
}

// What the FOH Home Wireless card shows: every channel of every receiver read
function channelsForPages() {
  const out = [];
  const now = Date.now();
  for (const r of watched.values()) {
    for (const ch of r.channels) {
      const transmitter = r.status === 'connected' ? (ch.txType || ch.battBars !== null ? 'on' : 'off') : 'unknown';
      const last = ch.lastBatt && now - ch.lastBatt.at < LAST_BATTERY_MS ? ch.lastBatt : null;
      const id = r.id || [...known.values()].find((k) => k.ip === r.ip)?.id || null;
      out.push({
        name: ch.name || `${r.model || 'Receiver'} ${r.channels.length > 1 ? ch.n : ''}`.trim(),
        model: r.model, ip: r.ip, status: r.status, transmitter, aux: auxFor(id, r.ip, ch.n),
        battBars: ch.battBars, battState: batteryState(ch.battBars),
        // the battery before the transmitter went off, for half an hour
        lastBatt: transmitter === 'off' && last ? { bars: last.bars, state: batteryState(last.bars), minutesAgo: Math.floor((now - last.at) / 60000) } : null,
        runTimeMin: ch.runTimeMin, charge: ch.charge, battType: ch.battType, txType: ch.txType, txPower: ch.txPower, frequency: ch.frequency, txMuted: ch.txMuted,
      });
    }
  }
  return out;
}

// The phone mixer and Monitor Engineer: each mix's mics, without addresses
function mixesForPages() {
  const mixes = {};
  for (const ch of channelsForPages()) {
    if (!ch.aux) continue;
    (mixes[ch.aux] ||= []).push({ name: ch.name, status: ch.status, transmitter: ch.transmitter, battBars: ch.battBars, battState: ch.battState, lastBatt: ch.lastBatt, runTimeMin: ch.runTimeMin, txType: ch.txType });
  }
  return mixes;
}

function stop() { if (saveTimer) saveNow(); for (const r of watched.values()) r.close(); watched.clear(); stopDiscovery(); discovered.clear(); }

module.exports = {
  applyConfig, getStatus, channelsForPages, mixesForPages, stop, parseAnnouncement, applyValue,
  setSaver: (fn) => { saver = typeof fn === 'function' ? fn : null; },
  _idFromMac: idFromMac,
  _announce: onAnnouncement,          // tests: an announcement, without the network
  _noDiscovery: (v) => { noDiscovery = !!v; },
  setChangeListener: (fn) => { onChange = typeof fn === 'function' ? fn : () => {}; },
  _setCommandPort: (p) => { commandPort = p; },
  _setTimings: (poll, silent) => { POLL_MS = poll; SILENT_MS = silent; },
  batteryState,
};
