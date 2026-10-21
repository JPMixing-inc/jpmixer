'use strict';
// Performer names Planning Center puts on aux mixes ("Vocal 1 - Sam"), and
// taking them off again. Turning off Settings → Planning Center → "Show
// performer names on aux mixes" used to stop new renames only: the names a
// sync had already written stayed as the mixes' labels, so the aux picker
// kept showing last week's people. The Green Room and the production Home
// pages read Planning Center themselves and never depend on these names.
//
// These names live only in JPMixer's own aux labels (Settings → Aux mixes),
// shown on phones and the pages JPMixer serves: nothing is ever written to
// the console's own mix names.
//
// Which labels a sync wrote, and the name each mix had before, are kept in
// their own file, not in the aux settings: Settings → Save writes the aux
// settings back whole from what it loaded, so a record kept there went
// stale whenever a sync ran with Settings open.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { writeFileAtomic } = require('./safe-write');

const recordFile = () => path.join(require('electron').app.getPath('userData'), 'pco-aux-names.json');
let records = null; // aux -> { label: what the sync wrote, before: the name it had }
// No record file yet: names from syncs made before records existed can only
// be told by their shape (see isPcoLabel). Once a sync or a clear has
// written the file, the shape alone no longer counts, so a name someone
// types that happens to look like one is left alone.
let legacy = false;
function load() {
  if (records) return records;
  records = {};
  legacy = true;
  try {
    const raw = JSON.parse(fs.readFileSync(recordFile(), 'utf8'));
    legacy = false;
    for (const [n, r] of Object.entries(raw || {})) if (r && typeof r.label === 'string') records[n] = { label: r.label, before: typeof r.before === 'string' ? r.before : '' };
  } catch (_) {}
  return records;
}
function save() {
  try { writeFileAtomic(recordFile(), JSON.stringify(records)); legacy = false; }
  catch (e) { console.error('[JPMixer/PCO] could not save aux name records:', e.message); }
}

// Whether aux `n`'s label is one a sync wrote: the one on record, or — for
// syncs from before the record existed — the "<position> - <name>" shape
// for a position mapped to this aux (matched ignoring case, as the sync
// matches positions). A name someone typed since matches neither, and is kept.
function isPcoLabel(n, ov, mapping) {
  if (!ov || typeof ov.label !== 'string' || !ov.label) return false;
  const rec = load()[String(n)];
  if (rec) return ov.label === rec.label;
  if (!legacy) return false;
  const label = ov.label.toLowerCase();
  return Object.entries(mapping || {}).some(([position, aux]) => Number(aux) === Number(n) && label.startsWith(position.toLowerCase() + ' - '));
}

// The name aux `n` had before Planning Center named it: what it has now,
// unless that's itself a performer name from an earlier sync. `mapping` is
// the one the sync is about to apply (Sync Now can pass one not saved yet).
function beforeSync(n, mapping = config.get('pcoPositionMapping')) {
  const ov = (config.get('auxOverrides') || {})[String(n)] || {};
  if (isPcoLabel(n, ov, mapping)) return load()[String(n)]?.before ?? '';
  return typeof ov.label === 'string' ? ov.label : '';
}
// After a sync: [{ aux, label, before }], saved in one write
function recordSync(entries) {
  if (!entries.length) return;
  load();
  for (const { aux, label, before } of entries) records[String(aux)] = { label, before };
  save();
}

// Puts every aux that still shows a performer name back to the name it had
// before (or the console's own name), in one settings write. Returns the
// auxes it changed. Safe to run on every save with names off: a mix whose
// name isn't on record is left alone.
function clear() {
  const mapping = config.get('pcoPositionMapping') || {};
  const recs = load();
  const patches = {}, changed = [];
  for (const [n, ov] of Object.entries(config.get('auxOverrides') || {})) {
    // Fields an earlier build kept in the aux settings themselves
    const stray = ov && (ov.pcoLabel !== undefined || ov.labelBeforePco !== undefined);
    if (isPcoLabel(n, ov, mapping)) {
      const before = recs[n] ? recs[n].before : (typeof ov.labelBeforePco === 'string' ? ov.labelBeforePco : '');
      patches[n] = { label: before, pcoLabel: undefined, labelBeforePco: undefined };
      changed.push(Number(n));
    } else if (stray) {
      patches[n] = { pcoLabel: undefined, labelBeforePco: undefined };
    }
  }
  if (Object.keys(patches).length) config.updateOverrides('aux', patches);
  // An empty record file marks that the names from before records existed
  // have been dealt with, so the shape fallback above stops here
  if (Object.keys(recs).length || legacy) { records = {}; save(); }
  return changed;
}

module.exports = { isPcoLabel, beforeSync, recordSync, clear, _reset: () => { records = null; legacy = false; } };
