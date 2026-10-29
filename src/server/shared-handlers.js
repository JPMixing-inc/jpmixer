'use strict';

// Browser-facing WebSocket handlers that are the same on every console
// backend (DiGiCo, dLive, KLANG, WING): My Mixes storage and sync, Find My
// Mixes, and the Devices view's activity feed. None of these touch a console,
// so each backend calls into one copy instead of keeping its own — the
// backends only differ in how a mix is *applied* to the desk (apply-preset).

const WebSocket = require('ws');
const presets   = require('./presets');
const config    = require('./config');

// Saved mixes and Ear Scenes use the browser's 0..1 fader position on every
// backend. Only values sent to the console (and cached OSC levels) use dB.
// Out-of-range input is made safe here as well as rejected by callers: a
// negative or NaN position used to reach the desk as NaN, and anything above
// 1 as more than +10 dB.
function sliderToDb(value) {
  if (!Number.isFinite(value) || value <= 0) return -150;
  return 50 * Math.log10(Math.min(value, 1) * 100) - 90;
}

function send(ws, msg) {
  try { ws.send(JSON.stringify(msg)); } catch (_) {}
}

// Handles one parsed client message. Returns true when it was one of these
// shared types (the caller then stops), false to let the backend handle it.
// ctx.logEvent(type, detail) — the backend's event log.
// ctx.onActivity(msg, ws)     — publish a device-activity notice (see broadcastActivity).
function handleSharedMessage(ws, msg, ctx) {
  switch (msg.type) {
    // Personal named mixes — stored per-device, aux-agnostic. Levels and pans
    // are stored without an aux so they work whichever aux the performer is
    // on; the aux (and owner) are recorded only so Find My Mixes and Settings
    // can tell groups apart.
    case 'save-preset': {
      const name = (msg.name || '').trim();
      if (!name || !msg.deviceId) return true;
      ctx.logEvent('preset-save', `device:${String(msg.deviceId).slice(0, 8)} name:"${name}"`);
      const owner = typeof msg.owner === 'string' ? msg.owner.trim().slice(0, 64) : '';
      const presetAux = parseInt(msg.aux, 10);
      const saved = presets.savePreset(msg.deviceId, name, msg.levels, msg.pans, {
        owner,
        aux: isNaN(presetAux) ? (ws._activeAux ?? null) : presetAux
      });
      if (!saved) { send(ws, { type: 'preset-sync-error', deviceId: msg.deviceId, name, seq: msg.seq }); return true; }
      // Confirm to the phone so it can drop this from its unsynced queue
      send(ws, { type: 'preset-synced', deviceId: msg.deviceId, name, seq: msg.seq });
      ws._lastActivityAt = Date.now();
      ctx.onActivity({ type: 'device-activity', deviceId: ws._deviceId || null, aux: ws._activeAux ?? null, kind: 'save-mix', name }, ws);
      return true;
    }
    case 'delete-preset': {
      if (!msg.deviceId) return true;
      ctx.logEvent('preset-delete', `device:${String(msg.deviceId).slice(0, 8)} name:"${msg.name}"`);
      if (!presets.deletePreset(msg.deviceId, msg.name)) {
        send(ws, { type: 'preset-sync-error', deviceId: msg.deviceId, name: msg.name, seq: msg.seq });
        return true;
      }
      send(ws, { type: 'preset-synced', deviceId: msg.deviceId, name: msg.name, seq: msg.seq });
      return true;
    }
    // The phone's server backup, merged into its list on every connect
    case 'request-device-presets':
      if (msg.deviceId) send(ws, { type: 'device-presets', deviceId: msg.deviceId, presets: presets.getByDevice(msg.deviceId) });
      return true;
    // Find My Mixes — search every device's backed-up mixes by owner or mix
    // name, then fetch one picked result's mixes to copy onto this phone.
    // Read-only: the original device's backup is never changed.
    case 'find-presets':
      send(ws, { type: 'found-presets', query: msg.query || '', groups: presets.findGroups(msg.query, msg.deviceId) });
      return true;
    case 'request-found-presets':
      // deviceId here is the requester's own identity at request time (see
      // mixer.js's confirmImportGroup) — echoed back so a reply that arrives
      // after the requester switched identity can be told apart from one
      // meant for whichever identity is active now.
      if (msg.fromDeviceId) send(ws, { type: 'found-device-presets', fromDeviceId: msg.fromDeviceId, deviceId: msg.requesterDeviceId, presets: presets.getByDevice(msg.fromDeviceId) });
      return true;
    // Devices view asking for the activity feed (see broadcastActivity)
    case 'subscribe-activity':
      ws._wantsActivity = true;
      return true;
    default:
      return false;
  }
}

// device-activity only drives the Devices view's activity dots, so it goes
// just to sockets that sent subscribe-activity — relaying every fader move as
// a second message to every phone grew with performers². Fader/pan notices
// are also capped at one per sender per 250ms; save notices always go out.
const ACTIVITY_MIN_INTERVAL_MS = 250;
function broadcastActivity(connections, msg, fromWs) {
  if (fromWs && (msg.kind === 'level' || msg.kind === 'pan')) {
    const now = Date.now();
    if (now - (fromWs._lastActivityBroadcastAt || 0) < ACTIVITY_MIN_INTERVAL_MS) return;
    fromWs._lastActivityBroadcastAt = now;
  }
  const payload = JSON.stringify(msg);
  for (const conn of connections) {
    if (conn._wantsActivity && conn.readyState === WebSocket.OPEN) {
      try { conn.send(payload); } catch (_) {}
    }
  }
}

// After Settings merges device groups, hand the merged mixes to any phone that
// is connected under one of the merged ids — mixer.js merges them into its list
function pushDevicePresets(connections, deviceId) {
  const target = presets.resolve(deviceId);
  for (const conn of connections) {
    if (conn._deviceId && presets.resolve(conn._deviceId) === target && conn.readyState === WebSocket.OPEN) {
      send(conn, { type: 'device-presets', deviceId: conn._deviceId, presets: presets.getByDevice(target) });
    }
  }
}

// Live relabeling — the External Control API's main use case (e.g. a Planning
// Center connector naming aux mixes after who's playing them). Updates the
// backend's in-memory config, persists via config.updateOverride() (not the
// full save-config path, which would restart the backend), and tells
// connected pages so labels change with no reconnect. JPMixer's own label
// only: nothing is ever written to the console's channel or mix names.
// `max` is how many channels/auxes exist: the count the console reports
// when it reports one (DiGiCo, LV1), else Settings'. Preferring Settings'
// number rejected renames of mixes the console had but Settings didn't.
function relabel(serverCfg, kind, n, label, max, broadcastToClients) {
  const num = parseInt(n, 10);
  if (!Number.isInteger(num) || num < 1 || num > max || typeof label !== 'string') return false;
  const key = kind === 'aux' ? 'auxOverrides' : 'channelOverrides';
  if (!serverCfg[key]) serverCfg[key] = {};
  serverCfg[key][String(num)] = { ...(serverCfg[key][String(num)] || {}), label };
  config.updateOverride(kind, num, { label });
  broadcastToClients(kind === 'aux'
    ? { type: 'aux-relabeled', aux: num, label }
    : { type: 'channel-relabeled', channel: num, label });
  return true;
}

// Wraps a phone/browser message handler so a malformed message logs an
// error instead of throwing out of the socket's event handler and taking
// the server down mid-service (osc-server.js has its own try/catch).
function guarded(logEvent, handler) {
  return (...args) => {
    try { handler(...args); }
    catch (err) { logEvent('ws-error', (err && err.message) || String(err)); }
  };
}

// The channel groups a mix shows by default on performers' phones (Settings
// → Aux mixes), as group names to match the channel list's `group`. Stored
// as group ids so a renamed group keeps its place; a removed one drops out.
function auxGroupNames(ov, cfg) {
  const ids = new Set((Array.isArray(ov && ov.groups) ? ov.groups : []).map(String));
  return (cfg.channelGroups || []).filter(g => ids.has(String(g.id))).map(g => g.name);
}

// The phone/monitor channel list, the same on every console: Settings'
// overrides applied, sorted by group then custom order, with each group's
// name as a heading on its first channel. `consoleName(n)` gives the desk's
// own name for channel n. This used to be copied into all four backends.
// A console name for channel or mix n: the live one the console reported
// (even '' — a name it cleared), else the one it last reported, remembered
// on this computer while the console is off (console-names.js), else
// undefined. A name typed in JPMixer is laid over this by the callers.
function consoleNameOr(cfg, kind, n, live) {
  if (live !== undefined && live !== null) return live;
  return require('./console-names').remembered(cfg && cfg.consoleType || 'digico', kind, n);
}

// `extra`: more channel numbers after 1..chCount (dLive's FX returns in the mixes, 129 on);
// `skip(n)`: channels left out (a dLive stereo input's right half)
function buildChannelList(chCount, cfg, consoleName, extra = [], skip = null) {
  const groups = cfg.channelGroups || [];
  const overrides = cfg.channelOverrides || {};
  const groupOrder = {};
  groups.forEach((g, i) => { groupOrder[String(g.id)] = i; });

  const raw = [];
  for (const i of [...Array.from({ length: chCount }, (_, k) => k + 1), ...extra]) {
    if (skip && skip(i)) continue;
    const ov = overrides[String(i)] || {};
    raw.push({
      channel: i,
      enabled: ov.enabled !== false,
      label:   ov.label || consoleNameOr(cfg, 'channels', i, consoleName(i)) || '',
      icon:    ov.icon || '',
      groupId: ov.groupId || null,
      order:   ov.order !== undefined ? ov.order : i,
    });
  }
  raw.sort((a, b) => {
    const ga = a.groupId !== null ? (groupOrder[String(a.groupId)] ?? 9999) : 9999;
    const gb = b.groupId !== null ? (groupOrder[String(b.groupId)] ?? 9999) : 9999;
    if (ga !== gb) return ga - gb;
    return a.order - b.order;
  });

  let lastGroupId;
  return raw.map((ch, idx) => {
    const isFirst = ch.groupId !== lastGroupId;
    lastGroupId = ch.groupId;
    const group = groups.find(g => String(g.id) === String(ch.groupId));
    // `group` on every channel (not only the heading's first one) lets the
    // phone page filter by group; '' for channels in no group
    return { enabled: ch.enabled, label: ch.label, channel: ch.channel, order: idx, title: (isFirst && group) ? group.name : '', group: group ? group.name : '', icon: ch.icon };
  });
}

module.exports = { handleSharedMessage, broadcastActivity, pushDevicePresets, relabel, sliderToDb, guarded, buildChannelList, auxGroupNames, consoleNameOr };
