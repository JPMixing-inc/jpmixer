'use strict';

// Paced console writes for the dLive, KLANG and WING backends (DiGiCo has
// its own queue in osc-server.js). A full Ear Scene recall is ~768 writes;
// sent in one loop that is a burst the project avoids, and on UDP (KLANG,
// WING) a dropped packet is a level change that silently never happened.
//
// At most one write per intervalMs (5 ms = 200/s, a full recall in ~4 s).
// Not verified on real hardware — chosen as a middle ground between the
// burst and DiGiCo's proven 10/s, which would make a recall take ~77 s.
//
// - Idle: a write goes out immediately, so one fader move or mute has no
//   added delay. Only back-to-back writes are spread out.
// - Urgent (mute/solo) writes go before normal ones, and a key already
//   waiting as urgent stays urgent when a normal write replaces it.
// - Each key keeps only its latest write.
function createPacedWriter({ intervalMs = 5 } = {}) {
  const urgent = new Map(), normal = new Map();
  let timer = null;
  let lastSent = -Infinity;

  const run = (fn) => { try { fn(); } catch (_) { /* a bad write must not stop the queue */ } };

  function tick() {
    const lane = urgent.size ? urgent : normal;
    const next = lane.entries().next();
    if (next.done) { clearInterval(timer); timer = null; return; }
    const [key, fn] = next.value;
    lane.delete(key);
    lastSent = Date.now();
    run(fn);
  }

  function write(key, fn, isUrgent = false) {
    const keepUrgent = isUrgent || urgent.has(key);
    urgent.delete(key);
    normal.delete(key);
    if (!timer && Date.now() - lastSent >= intervalMs) {
      lastSent = Date.now();
      run(fn);
      timer = setInterval(tick, intervalMs);
      return;
    }
    (keepUrgent ? urgent : normal).set(key, fn);
    if (!timer) timer = setInterval(tick, intervalMs);
  }

  // A direct write (e.g. a musician's fader move) supersedes a queued one
  // to the same send, so a stale recall value can't land on top of it.
  function cancel(key) { urgent.delete(key); normal.delete(key); }

  // Send everything still queued, now — for stop(), where queued writes are
  // the state people asked for (same trade as osc-server.js's flush).
  function flush() {
    if (timer) { clearInterval(timer); timer = null; }
    const pending = [...urgent.values(), ...normal.values()];
    urgent.clear();
    normal.clear();
    for (const fn of pending) run(fn);
  }

  function clear() {
    if (timer) { clearInterval(timer); timer = null; }
    urgent.clear();
    normal.clear();
  }

  return { write, cancel, flush, clear, size: () => urgent.size + normal.size };
}

module.exports = { createPacedWriter };
