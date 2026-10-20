'use strict';

// ── DiGiCo input channel processing (Console Controller → channel panel) ───
// The controls below are the ones a real SD sent and accepted when moved from
// the DiGiCo iPad app through JPMixer's relay (OSC Log recording, 2026-10-19):
// each address is /Input_Channels/<n>/<path>. Nothing outside this table is
// ever sent, and every value is clamped to its range first.
//
// Ranges: the recording showed the values each control took but not every
// end stop, so these stay inside what an SD accepts (a value the desk won't
// take comes back as the desk's own value, which the page then shows).
// Left out until their meaning is confirmed: EQ curve types (eq_curve_n),
// dynamic-EQ over/under, the gate key filter width, and anything not seen.
//
// kind: 'bool' (0/1), 'num' (min..max), 'enum' (one of values)
// scale: 'log' for frequency and time controls; unit is for display only.

const PARAMS = {};
function add(path, def) { PARAMS[path] = def; }

// Input
add('Channel_Input/analog_gain', { kind: 'num', min: 0, max: 60, unit: 'dB', label: 'Gain', section: 'input' });
add('Channel_Input/trim', { kind: 'num', min: -20, max: 20, unit: 'dB', label: 'Trim', section: 'input' });
add('Channel_Input/phantom', { kind: 'bool', label: '48V', section: 'input' });
add('Channel_Input/phase', { kind: 'bool', label: 'Phase Ø', section: 'input' });
add('Panner/pan', { kind: 'num', min: 0, max: 1, unit: 'pan', label: 'Pan', section: 'input' });
add('Filters/lo_filter_in', { kind: 'bool', label: 'High-pass', section: 'input' });
add('Filters/lo_filter_freq', { kind: 'num', min: 20, max: 1000, unit: 'Hz', scale: 'log', label: 'High-pass', section: 'input' });
add('Filters/hi_filter_in', { kind: 'bool', label: 'Low-pass', section: 'input' });
add('Filters/hi_filter_freq', { kind: 'num', min: 1000, max: 20000, unit: 'Hz', scale: 'log', label: 'Low-pass', section: 'input' });
add('Channel_Delay/delay_on', { kind: 'bool', label: 'Delay', section: 'input' });
add('Channel_Delay/delay', { kind: 'num', min: 0, max: 0.5, unit: 's', label: 'Delay', section: 'input' });
add('Insert/insert_A_in', { kind: 'bool', label: 'Insert A', section: 'input' });
add('Insert/insert_B_in', { kind: 'bool', label: 'Insert B', section: 'input' });

// EQ: four bands (band 1 is the top band on an SD, band 4 the bottom)
add('EQ/eq_in', { kind: 'bool', label: 'EQ', section: 'eq' });
for (let b = 1; b <= 4; b++) {
  add(`EQ/eq_gain_${b}`, { kind: 'num', min: -18, max: 18, unit: 'dB', label: 'Gain', section: 'eq', band: b });
  add(`EQ/eq_freq_${b}`, { kind: 'num', min: 20, max: 20000, unit: 'Hz', scale: 'log', label: 'Frequency', section: 'eq', band: b });
  add(`EQ/eq_Q_${b}`, { kind: 'num', min: 0.1, max: 10, unit: 'Q', scale: 'log', label: 'Q', section: 'eq', band: b });
  add(`EQ/dynamic_eq_on_${b}`, { kind: 'bool', label: 'Dynamic', section: 'eq', band: b });
  add(`EQ/eq_thresh_${b}`, { kind: 'num', min: -60, max: 0, unit: 'dB', label: 'Threshold', section: 'eq', band: b, dynamic: true });
  add(`EQ/eq_ratio_${b}`, { kind: 'num', min: 1, max: 20, unit: ':1', scale: 'log', label: 'Ratio', section: 'eq', band: b, dynamic: true });
  add(`EQ/eq_attack_${b}`, { kind: 'num', min: 0.001, max: 0.1, unit: 's', scale: 'log', label: 'Attack', section: 'eq', band: b, dynamic: true });
  add(`EQ/eq_release_${b}`, { kind: 'num', min: 0.01, max: 3, unit: 's', scale: 'log', label: 'Release', section: 'eq', band: b, dynamic: true });
}

// Dynamics: compressor (band 1 of the SD's compressor) and gate
add('Dynamics/comp_in', { kind: 'bool', label: 'Compressor', section: 'dynamics', group: 'comp' });
add('Dynamics/comp_thresh_1', { kind: 'num', min: -60, max: 0, unit: 'dB', label: 'Threshold', section: 'dynamics', group: 'comp' });
add('Dynamics/comp_ratio_1', { kind: 'num', min: 1, max: 20, unit: ':1', scale: 'log', label: 'Ratio', section: 'dynamics', group: 'comp' });
add('Dynamics/comp_attack_1', { kind: 'num', min: 0.0005, max: 0.1, unit: 's', scale: 'log', label: 'Attack', section: 'dynamics', group: 'comp' });
add('Dynamics/comp_release_1', { kind: 'num', min: 0.005, max: 3, unit: 's', scale: 'log', label: 'Release', section: 'dynamics', group: 'comp' });
add('Dynamics/comp_gain_1', { kind: 'num', min: 0, max: 24, unit: 'dB', label: 'Make-up', section: 'dynamics', group: 'comp' });
add('Dynamics/comp_knee_1', { kind: 'enum', values: [0, 1, 2], names: ['1', '2', '3'], label: 'Knee', section: 'dynamics', group: 'comp' });
add('Dynamics/comp_auto-gain_1', { kind: 'bool', label: 'Auto gain', section: 'dynamics', group: 'comp' });
add('Dynamics/gate_in', { kind: 'bool', label: 'Gate', section: 'dynamics', group: 'gate' });
add('Dynamics/gate_thresh', { kind: 'num', min: -80, max: 0, unit: 'dB', label: 'Threshold', section: 'dynamics', group: 'gate' });
add('Dynamics/gate_range', { kind: 'num', min: 0, max: 80, unit: 'dB', label: 'Range', section: 'dynamics', group: 'gate' });
add('Dynamics/gate_attack', { kind: 'num', min: 0.0001, max: 0.1, unit: 's', scale: 'log', label: 'Attack', section: 'dynamics', group: 'gate' });
add('Dynamics/gate_hold', { kind: 'num', min: 0.002, max: 2, unit: 's', scale: 'log', label: 'Hold', section: 'dynamics', group: 'gate' });
add('Dynamics/gate_release', { kind: 'num', min: 0.005, max: 3, unit: 's', scale: 'log', label: 'Release', section: 'dynamics', group: 'gate' });

const SECTIONS = ['input', 'eq', 'dynamics'];

// The value to send for `path`, or null if it isn't a control we send
function clampValue(path, value) {
  const def = PARAMS[path];
  const v = Number(value);
  if (!def || !Number.isFinite(v)) return null;
  if (def.kind === 'bool') return v >= 0.5 ? 1 : 0;
  if (def.kind === 'enum') return def.values.includes(v) ? v : null;
  return Math.min(def.max, Math.max(def.min, v));
}

// Every path, with the section the engineer is looking at first
function pathsInOrder(firstSection) {
  const order = SECTIONS.includes(firstSection) ? [firstSection, ...SECTIONS.filter(s => s !== firstSection)] : SECTIONS;
  return order.flatMap(s => Object.keys(PARAMS).filter(p => PARAMS[p].section === s));
}

const CACHE_RE = new RegExp('^/Input_Channels/\\d+/(' + Object.keys(PARAMS).map(p => p.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')).join('|') + ')$');

module.exports = { PARAMS, SECTIONS, clampValue, pathsInOrder, CACHE_RE };
