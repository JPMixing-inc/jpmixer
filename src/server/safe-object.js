'use strict';

// Recursively rebuilds a plain-object tree using null-prototype containers
// at every level of object nesting. Used anywhere a store gets reassigned
// wholesale from data that either came from a network-reachable client
// (WS message-derived keys) or round-tripped through JSON.parse (which
// itself is safe from the classic `__proto__` pollution trick, but produces
// objects with a normal Object.prototype — reassigning that object's own
// prototype key downstream is not).
//
// Why this matters: with a normal {} prototype, an attacker-controlled key
// literally equal to "__proto__" turns `store[key][innerKey] = value` into
// `Object.prototype[innerKey] = value` — polluting every plain object in
// the running process, not just this store. A null-prototype object has no
// __proto__ accessor to hijack, so the same key is just an ordinary,
// harmless property name. See presets.js/scenes.js for the concrete
// exploitable path this closes (deviceId/name and snapshot/aux, both
// sourced directly from unvalidated browser WS messages).
//
// Arrays and primitives pass through unchanged — only object nesting needs
// null-prototyping, since only plain objects have the __proto__ accessor.
function toNullProto(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const out = Object.create(null);
  for (const key of Object.keys(value)) out[key] = toNullProto(value[key]);
  return out;
}

module.exports = { toNullProto };
