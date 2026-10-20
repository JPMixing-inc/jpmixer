'use strict';

// ── Menu bar icon with a status dot ─────────────────────────────────────────
// The JP icon gets a small dot at its top right: green while the server is
// running and the console is connected, red otherwise.
// macOS only tints "template" images (black or white to suit the menu bar),
// and a template can't hold a colour, so the icon is drawn here in the
// menu bar's own colour (`dark` = white glyph) with the dot added. On
// macOS the canvas is widened so the dot sits beside the P, not over it;
// Windows/Linux tray icons are square, so it goes on the icon's corner.

const { nativeImage } = require('electron');

const COLORS = { green: [52, 199, 89], red: [255, 59, 48] }; // macOS system green/red

// Raw bitmaps are BGRA on macOS and Windows (Skia's native order), premultiplied
function put(buf, o, [r, g, b], alpha) {
  buf[o] = Math.round(b * alpha);
  buf[o + 1] = Math.round(g * alpha);
  buf[o + 2] = Math.round(r * alpha);
  buf[o + 3] = Math.round(255 * alpha);
}

function drawRep(base, scale, { color, dark, widen }) {
  const size = base.getSize();
  const w = Math.round(size.width * scale), h = Math.round(size.height * scale);
  const src = base.toBitmap({ scaleFactor: scale });
  if (src.length !== w * h * 4) return null;
  const extra = widen ? Math.round(6 * scale) : 0;
  const W = w + extra;
  const buf = Buffer.alloc(W * h * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, o = (y * W + x) * 4;
      if (widen) {
        // A template glyph: only its alpha matters; paint it in the menu bar's colour
        const a = src[i + 3] / 255;
        put(buf, o, dark ? [255, 255, 255] : [0, 0, 0], a);
      } else {
        src.copy(buf, o, i, i + 4);
      }
    }
  }

  // The dot, anti-aliased by 4×4 supersampling. On a square icon it gets a
  // clear ring so it stands out from the artwork underneath.
  const r = (widen ? 2.75 : 3.5) * scale;
  const ring = widen ? 0 : 1.25 * scale;
  const cx = W - r - (widen ? 0.25 : 0) * scale, cy = r + (widen ? 0.5 : 0) * scale;
  const rgb = COLORS[color] || COLORS.red;
  const top = Math.max(0, Math.floor(cy - r - ring)), bottom = Math.min(h, Math.ceil(cy + r + ring));
  const left = Math.max(0, Math.floor(cx - r - ring));
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < W; x++) {
      let inDot = 0, inRing = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const d = Math.hypot(x + (sx + 0.5) / 4 - cx, y + (sy + 0.5) / 4 - cy);
        if (d <= r) inDot++; else if (d <= r + ring) inRing++;
      }
      const o = (y * W + x) * 4;
      const keep = 1 - (inDot + inRing) / 16; // what's left of the glyph under it
      for (let k = 0; k < 4; k++) buf[o + k] = Math.round(buf[o + k] * keep);
      const cov = inDot / 16;
      if (cov) {
        buf[o] += Math.round(rgb[2] * cov);
        buf[o + 1] += Math.round(rgb[1] * cov);
        buf[o + 2] += Math.round(rgb[0] * cov);
        buf[o + 3] += Math.round(255 * cov);
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: W, height: h, scaleFactor: scale });
}

// `base` is the plain icon; returns it with the dot, or null if it can't be drawn
function withStatusDot(base, { color, dark, widen }) {
  try {
    const out = nativeImage.createEmpty();
    for (const scale of base.getScaleFactors()) {
      const rep = drawRep(base, scale, { color, dark, widen });
      if (!rep) return null;
      out.addRepresentation({ scaleFactor: scale, buffer: rep.toPNG({ scaleFactor: scale }) });
    }
    return out.isEmpty() ? null : out;
  } catch (e) {
    console.error('[JPMixer] Tray icon status dot failed:', e);
    return null;
  }
}

module.exports = { withStatusDot };
