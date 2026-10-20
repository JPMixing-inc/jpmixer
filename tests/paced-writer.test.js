'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src/server/paced-writer.js'), 'utf8');

// Loads paced-writer.js against a fake clock so pacing is deterministic.
function pacer(intervalMs = 5) {
  let now = 1000;
  const timers = new Set();
  const context = vm.createContext({
    module: { exports: {} },
    Date: { now: () => now },
    setInterval: (fn, ms) => { const t = { fn, ms, due: now + ms }; timers.add(t); return t; },
    clearInterval: t => timers.delete(t),
  });
  vm.runInContext(source, context);
  const writer = context.module.exports.createPacedWriter({ intervalMs });
  const sent = [];
  return {
    writer, sent,
    w: (key, value, urgent) => writer.write(key, () => sent.push(value), urgent),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].filter(t => t.due <= end).sort((a, b) => a.due - b.due)[0];
        if (!next) break;
        now = next.due;
        next.due += next.ms;
        next.fn();
      }
      now = end;
    },
  };
}

test('a write to an idle pacer goes out immediately; back-to-back writes are spread one per interval', () => {
  const p = pacer();
  p.w('a', 1); p.w('b', 2); p.w('c', 3);
  assert.deepEqual(p.sent, [1], 'the first write has no added delay');
  p.advance(5);
  assert.deepEqual(p.sent, [1, 2]);
  p.advance(5);
  assert.deepEqual(p.sent, [1, 2, 3]);
});

test('urgent writes go before normal writes that were queued first', () => {
  const p = pacer();
  p.w('busy', 0);
  for (let i = 1; i <= 5; i++) p.w(`recall${i}`, `r${i}`);
  p.w('mute', 'M', true);
  p.advance(5);
  assert.deepEqual(p.sent, [0, 'M']);
});

test('each key keeps only its latest write, and a waiting urgent key stays urgent', () => {
  const p = pacer();
  p.w('busy', 0);
  p.w('x', 'x1');
  p.w('m', 'mute', true);
  p.w('m', 'recall-value'); // a recall touching the same send
  p.w('x', 'x2');
  p.advance(20);
  assert.deepEqual(p.sent, [0, 'recall-value', 'x2']);
});

test('cancel drops a queued write; flush sends the rest at once, urgent first', () => {
  const p = pacer();
  p.w('busy', 0);
  p.w('a', 'a'); p.w('b', 'b'); p.w('u', 'u', true);
  p.writer.cancel('a');
  p.writer.flush();
  assert.deepEqual(p.sent, [0, 'u', 'b']);
  assert.equal(p.writer.size(), 0);
  p.advance(50);
  assert.deepEqual(p.sent, [0, 'u', 'b'], 'nothing left to send after a flush');
});

test('a write that throws does not stop the queue', () => {
  const p = pacer();
  p.w('busy', 0);
  p.writer.write('bad', () => { throw new Error('send failed'); });
  p.w('good', 'ok');
  p.advance(10);
  assert.deepEqual(p.sent, [0, 'ok']);
});
