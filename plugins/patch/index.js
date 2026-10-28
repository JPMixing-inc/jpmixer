'use strict';

// Patch: patch screens for stage boxes (page/). This process keeps the patch
// in its data folder (patch.json), so every screen that opens the Patch page
// sees and edits the same one, and answers the page:
//   load  → { rev, boxes, locked, console: { type, connected, channels, groups, mixes } }
//         (a DiGiCo's channels also carry phantom: true/false, the desk's 48V)
//   change { ops } → { rev, boxes }: each change on its own (setPort,
//         setBox, putBox, removeBox), applied to the latest patch, so
//         screens editing at the same time never undo each other's changes.
//         setBox changes a box's details and keeps its sockets as saved;
//         putBox adds a box, or replaces it (an import). At most 200 a call.
// The FOH card's summary is counted here, from the saved patch, with the
// page's own drawings (page/boxes.js) for how many sockets each box has.
// "Lock the patch" in its settings makes it view-only. With "Show a patch
// summary on FOH Home" on, the card shows how much is patched.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MAX_BOXES = 40, MAX_PORTS = 400, MAX_OPS = 200;
const KINDS = new Set(['ch', 'cg', 'mix']);
const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '');
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);

// A box's details, tidied (everything but its sockets)
function cleanDetails(b, id) {
  const box = { id, model: str(b.model, 40), name: str(b.name, 40), location: str(b.location, 40) };
  if (b.cards && typeof b.cards === 'object') {
    box.cards = {};
    for (const [slot, card] of Object.entries(b.cards).slice(0, 20)) if (/^\d{1,2}$/.test(slot)) box.cards[slot] = str(card, 30);
  }
  if (b.options && typeof b.options === 'object') {
    box.options = {};
    for (const [key, value] of Object.entries(b.options).slice(0, 10)) if (/^[a-z0-9]{1,20}$/.test(key)) box.options[key] = str(value, 30);
  }
  if (b.generic && typeof b.generic === 'object') box.generic = { inputs: int(b.generic.inputs, 0, 128) ?? 16, outputs: int(b.generic.outputs, 0, 128) ?? 8 };
  return box;
}

// A tidy copy of what a page sent: only what the page draws, nothing huge
function cleanBoxes(list) {
  const out = [];
  const ids = new Set();
  for (const b of (Array.isArray(list) ? list : []).slice(0, MAX_BOXES)) {
    if (!b || typeof b !== 'object') continue;
    const id = str(b.id, 40);
    if (!/^[a-z0-9-]{1,40}$/.test(id) || ids.has(id)) continue;
    ids.add(id);
    const box = cleanDetails(b, id);
    box.ports = {};
    for (const [key, p] of Object.entries(b.ports && typeof b.ports === 'object' ? b.ports : {}).slice(0, MAX_PORTS)) {
      if (!/^[a-z0-9]{1,12}\.\d{1,3}$/.test(key) || !p || typeof p !== 'object') continue;
      const port = { name: str(p.name, 40), note: str(p.note, 120) };
      // side: which side of a stereo channel or mix this socket is (two sockets, one source)
      if (p.src && KINDS.has(p.src.kind) && int(p.src.n, 1, 999)) port.src = { kind: p.src.kind, n: p.src.n, ...(p.src.side === 'L' || p.src.side === 'R' ? { side: p.src.side } : {}) };
      if (p.phantom === true) port.phantom = true; // needs 48V
      // fed: patched on the console to something JPMixer can't choose (a dLive
      // stereo aux, say), as an import found it
      if (p.fed === true && !port.src) port.fed = true;
      if (port.name || port.note || port.src || port.phantom || port.fed) box.ports[key] = port;
    }
    out.push(box);
  }
  return out;
}

// The page's drawings, for counting sockets (null if they can't be read:
// then the card counts patched sockets only)
function loadLibrary(folder) {
  try {
    const sandbox = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(folder, 'page', 'boxes.js'), 'utf8'), sandbox, { timeout: 1000 });
    return sandbox.window.PATCH_LIBRARY || null;
  } catch (e) {
    console.error('Couldn’t read the stage box drawings:', e.message);
    return null;
  }
}

// How much is patched, and console channels fed from two input sockets (a
// stereo channel's left and right aren't a mistake), named as the page does
function countPatch(boxes, library, consoleNow) {
  const named = (list, n) => { const item = (list || []).find((x) => x.number === n); return item && item.name && !/^(cg|dca|aux|ch|channel)\s*\d+$/i.test(String(item.name).trim()) ? ` · ${item.name}` : ''; };
  const all = [];
  for (const box of boxes) {
    let ports = [];
    try { ports = library ? library.layoutFor(box).ports : Object.keys(box.ports).map((key) => ({ key, kind: key.startsWith('in') ? 'in' : 'out' })); } catch (_) { ports = []; }
    for (const p of ports) all.push({ box, port: p, data: box.ports[p.key] || {} });
  }
  const seen = new Map();
  for (const x of all) if (x.port.kind === 'in' && x.data.src && x.data.src.kind === 'ch') seen.set(x.data.src.n, [...(seen.get(x.data.src.n) || []), x]);
  const stereoPair = (v) => v.length === 2 && v.every((x) => x.data.src.side) && new Set(v.map((x) => x.data.src.side)).size === 2;
  const doubles = [...seen].filter(([, v]) => v.length > 1 && !stereoPair(v)).map(([n]) => `Ch ${n}${named(consoleNow && consoleNow.channels, n)}`);
  return {
    ports: all.length,
    patched: all.filter((x) => x.data.src || x.data.fed).length,
    boxes: boxes.map((b) => {
      const own = all.filter((x) => x.box === b);
      const model = library && library.BOXES.find((m) => m.id === b.model);
      return { name: b.name || (model ? model.name : 'Stage box'), ports: own.length, patched: own.filter((x) => x.data.src || x.data.fed).length };
    }),
    doubles,
  };
}

module.exports = async (jp) => {
  const file = path.join(jp.plugin.dataFolder, 'patch.json');
  const library = loadLibrary(jp.plugin.folder);
  let patch = { rev: 0, boxes: [], summary: null };
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved && Array.isArray(saved.boxes)) patch = { rev: Number.isInteger(saved.rev) ? saved.rev : 0, boxes: cleanBoxes(saved.boxes), summary: saved.summary || null };
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Couldn’t read the saved patch:', e.message);
  }

  // Saved first, then kept: if the file can't be written, the patch stays as it was
  function save(next) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next));
    fs.renameSync(tmp, file);
    patch = next;
  }

  // The FOH Home card (only with "Show a patch summary on FOH Home" on)
  function showCard() {
    if (!jp.settings.showCard) { jp.card.clear(); return; }
    const s = patch.summary;
    if (!s || !s.ports) { jp.card.show({ value: '—', label: 'No stage boxes yet. Open the Patch page to add them.' }); return; }
    jp.card.show({
      value: `${s.patched}`,
      unit: `of ${s.ports}`,
      label: 'sockets patched',
      color: s.doubles && s.doubles.length ? 'yellow' : s.patched === s.ports ? 'green' : '',
      rows: [
        ...(s.boxes || []).slice(0, 12).map((b) => ({ label: str(b.name, 40), value: `${b.patched} / ${b.ports}` })),
        ...(s.doubles || []).slice(0, 6).map((d) => ({ label: str(d, 40), value: 'patched twice', color: 'red' })),
      ],
      note: jp.settings.locked ? 'The patch is locked.' : '',
    });
  }

  async function consoleNow() {
    try { return await jp.console.get(); } catch (_) { return null; }
  }

  let lastConsole = null;
  jp.page.handle('load', async () => ({ rev: patch.rev, boxes: patch.boxes, locked: !!jp.settings.locked, console: await consoleNow() }));


  // One change at a time, on top of whatever is saved now
  function applyOp(boxes, op) {
    if (!op || typeof op !== 'object') return boxes;
    if (op.op === 'removeBox') return boxes.filter((b) => b.id !== op.box);
    // A box's details (name, location, model, cards, options, size): its
    // sockets stay as saved, less any the page says are gone or now mean
    // something else (a socket that isn't on the new drawing, a card changed)
    if (op.op === 'setBox') {
      const at = boxes.findIndex((b) => b.id === (op.box && op.box.id));
      if (at < 0) return boxes;
      const box = { ...cleanDetails(op.box, boxes[at].id), ports: { ...boxes[at].ports } };
      for (const key of (Array.isArray(op.drop) ? op.drop : []).slice(0, MAX_PORTS)) if (typeof key === 'string') delete box.ports[key];
      return boxes.map((b, i) => (i === at ? box : b));
    }
    if (op.op === 'putBox') {
      const [box] = cleanBoxes([op.box]);
      if (!box) return boxes;
      const at = boxes.findIndex((b) => b.id === box.id);
      if (at < 0) return boxes.length < MAX_BOXES ? [...boxes, box] : boxes;
      return boxes.map((b, i) => (i === at ? box : b));
    }
    if (op.op === 'setPort') {
      const at = boxes.findIndex((b) => b.id === op.box);
      if (at < 0 || typeof op.key !== 'string') return boxes;
      const box = { ...boxes[at], ports: { ...boxes[at].ports } };
      delete box.ports[op.key];
      if (op.port) {
        // Tidied the same way as a whole box
        const [one] = cleanBoxes([{ id: box.id, model: box.model, ports: { [op.key]: op.port } }]);
        if (one && one.ports[op.key]) box.ports[op.key] = one.ports[op.key];
      }
      if (Object.keys(box.ports).length > MAX_PORTS) return boxes;
      return boxes.map((b, i) => (i === at ? box : b));
    }
    return boxes;
  }

  jp.page.handle('change', async (body) => {
    if (jp.settings.locked) throw new Error('The patch is locked. Unlock it in JPMixer Settings → Integrations → Plugins → Patch.');
    const ops = body && Array.isArray(body.ops) ? body.ops : [];
    // The page sends at most this many at once; more is refused, not cut short
    if (ops.length > MAX_OPS) throw new Error(`Too many changes at once (${ops.length}; at most ${MAX_OPS}).`);
    // Applied and saved before anything is awaited, so two screens' changes
    // arriving together can't miss each other
    let boxes = patch.boxes;
    for (const op of ops) boxes = applyOp(boxes, op);
    try {
      save({ rev: patch.rev + 1, boxes, summary: countPatch(boxes, library, lastConsole) });
    } catch (e) {
      throw new Error(`The patch couldn’t be saved (${e.code || e.message}). Nothing was changed.`);
    }
    showCard();
    showStatus();
    const answer = { rev: patch.rev, boxes: patch.boxes };
    recount();
    return answer;
  });
  // The summary again with the console's names, once it answers (if the patch hasn't moved on)
  async function recount() {
    try {
      const rev = patch.rev;
      lastConsole = await consoleNow();
      const summary = countPatch(patch.boxes, library, lastConsole);
      if (patch.rev !== rev || JSON.stringify(summary) === JSON.stringify(patch.summary)) return;
      save({ ...patch, summary });
      showCard();
      showStatus();
    } catch (e) {
      console.error('Couldn’t update the patch summary:', e.message); // the card shows the last one
    }
  }

  // The line under the plugin in Settings
  function showStatus() {
    const n = patch.boxes.length;
    jp.status(n ? `${n} stage box${n === 1 ? '' : 'es'}${patch.summary ? `, ${patch.summary.patched} of ${patch.summary.ports} sockets patched` : ''}${jp.settings.locked ? ' · locked' : ''}` : 'No stage boxes yet: open the Patch page to add them');
  }
  showCard();
  showStatus();
  recount(); // a patch saved by an older version: counted here now
};
