'use strict';

// A small read-only SQLite reader, for LV1 session files (.emo, which are
// SQLite databases). It reads a table's rows straight from the file's
// B-trees in the page: no library, nothing written, nothing sent anywhere.
// Enough for LV1's tables: rowid tables, UTF-8 text, overflow pages. Not
// read: indexes, WITHOUT ROWID tables and a -wal file next to the database
// (a session saved from LV1 has none).
//   const db = PatchSQLite.open(arrayBuffer); db.tables(); db.rows('device')
(() => {
  function open(buffer) {
    const bytes = new Uint8Array(buffer);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const utf8 = new TextDecoder('utf-8');
    if (bytes.length < 100 || utf8.decode(bytes.subarray(0, 15)) !== 'SQLite format 3') throw new Error('This isn’t an LV1 session file.');
    let pageSize = dv.getUint16(16);
    if (pageSize === 1) pageSize = 65536;
    if (pageSize < 512 || (pageSize & (pageSize - 1))) throw new Error('The session file looks damaged.');
    const usable = pageSize - bytes[20];
    const encoding = dv.getUint32(56);
    if (encoding && encoding !== 1) throw new Error('The session file’s text isn’t UTF-8.');
    const pageCount = Math.floor(bytes.length / pageSize);
    const pageAt = (n) => {
      if (!Number.isInteger(n) || n < 1 || n > pageCount) throw new Error('The session file looks damaged (a page is missing).');
      return (n - 1) * pageSize;
    };

    // A variable-length integer at o in arr: [value, length]
    function varint(arr, o) {
      let v = 0;
      for (let i = 0; i < 8; i++) {
        const b = arr[o + i];
        v = v * 128 + (b & 0x7f);
        if (b < 0x80) return [v, i + 1];
      }
      return [v * 256 + arr[o + 8], 9];
    }

    // A cell's payload, following its overflow pages if it doesn't fit
    function payload(o, total) {
      const X = usable - 35;
      if (total <= X) return bytes.subarray(o, o + total);
      const M = Math.floor(((usable - 12) * 32) / 255) - 23;
      const K = M + ((total - M) % (usable - 4));
      const local = K <= X ? K : M;
      const out = new Uint8Array(total);
      out.set(bytes.subarray(o, o + local));
      let got = local, next = dv.getUint32(o + local), hops = 0;
      while (got < total) {
        if (!next || ++hops > pageCount) throw new Error('The session file looks damaged (a long value is cut short).');
        const p = pageAt(next);
        const n = Math.min(usable - 4, total - got);
        out.set(bytes.subarray(p + 4, p + 4 + n), got);
        got += n;
        next = dv.getUint32(p);
      }
      return out;
    }

    // A record: its values in column order
    function record(rec) {
      const r = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
      const [headerLen, h] = varint(rec, 0);
      const types = [];
      for (let o = h; o < headerLen;) { const [t, n] = varint(rec, o); types.push(t); o += n; }
      const values = [];
      let o = headerLen;
      for (const t of types) {
        switch (t) {
          case 0: values.push(null); break;
          case 1: values.push(r.getInt8(o)); o += 1; break;
          case 2: values.push(r.getInt16(o)); o += 2; break;
          case 3: values.push(((r.getInt8(o) << 16) | r.getUint16(o + 1))); o += 3; break;
          case 4: values.push(r.getInt32(o)); o += 4; break;
          case 5: values.push(r.getInt16(o) * 2 ** 32 + r.getUint32(o + 2)); o += 6; break;
          case 6: values.push(r.getInt32(o) * 2 ** 32 + r.getUint32(o + 4)); o += 8; break; // exact up to 2^53 (MAC addresses fit)
          case 7: values.push(r.getFloat64(o)); o += 8; break;
          case 8: values.push(0); break;
          case 9: values.push(1); break;
          default: {
            if (t < 12) throw new Error('The session file looks damaged (an unknown value).');
            const len = Math.floor((t - 12) / 2);
            const part = rec.subarray(o, o + len);
            values.push(t % 2 ? utf8.decode(part) : part.slice());
            o += len;
          }
        }
      }
      return values;
    }

    // Every row of the table B-tree rooted at page `root`
    function walk(root, fn, depth = 0) {
      if (depth > 30) throw new Error('The session file looks damaged (a table loops).');
      const base = pageAt(root);
      const h = base + (root === 1 ? 100 : 0);
      const type = bytes[h];
      const cells = dv.getUint16(h + 3);
      if (type === 0x0d) { // leaf: rows
        for (let i = 0; i < cells; i++) {
          const c = base + dv.getUint16(h + 8 + i * 2);
          const [len, a] = varint(bytes, c);
          const [rowid, b] = varint(bytes, c + a);
          fn(rowid, record(payload(c + a + b, len)));
        }
      } else if (type === 0x05) { // interior: children, then the rightmost
        for (let i = 0; i < cells; i++) walk(dv.getUint32(base + dv.getUint16(h + 12 + i * 2)), fn, depth + 1);
        walk(dv.getUint32(h + 8), fn, depth + 1);
      } else {
        throw new Error('This table can’t be read (it isn’t a plain table).');
      }
    }

    // A table's column names from its CREATE TABLE, and which one is the
    // rowid (an INTEGER PRIMARY KEY is stored as the row's id, not in the row)
    function columns(sql) {
      const body = sql.slice(sql.indexOf('(') + 1, sql.lastIndexOf(')'));
      const parts = [];
      let depth = 0, cur = '';
      for (const ch of body) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
      }
      parts.push(cur);
      const cols = [];
      for (const part of parts) {
        const t = part.trim();
        if (!t || /^(constraint|primary\s+key|foreign\s+key|unique|check)\b/i.test(t)) continue;
        const m = t.match(/^(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][\w$]*))\s*([\s\S]*)$/);
        if (!m) continue;
        const rest = m[5] || '';
        cols.push({ name: m[1] || m[2] || m[3] || m[4], rowid: /^integer\b/i.test(rest) && /primary\s+key/i.test(rest) });
      }
      return cols;
    }

    const schema = new Map(); // table name -> { root, cols }
    walk(1, (rowid, [type, name, , root, sql]) => {
      if (type === 'table' && typeof sql === 'string' && Number.isInteger(root) && root > 0) schema.set(name, { root, cols: columns(sql) });
    });

    return {
      tables: () => [...schema.keys()],
      rows(name) {
        const t = schema.get(name);
        if (!t) return [];
        const out = [];
        walk(t.root, (rowid, values) => {
          const row = {};
          t.cols.forEach((c, i) => { row[c.name] = c.rowid && (values[i] === null || values[i] === undefined) ? rowid : values[i] ?? null; });
          out.push(row);
        });
        return out;
      },
    };
  }
  window.PatchSQLite = { open };
})();
