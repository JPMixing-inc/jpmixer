# JPMixer branding

Custom angular JPMIXER lettering and JP emblem inspired by the supplied CFX reference. The red gradient runs from #ff2858 to JPMixer red #e8003c; the application tile uses the existing charcoal palette.

- `jpmixer-wordmark.svg` / `.png`: transparent full wordmark.
- `jp-monogram.svg` / `.png`: transparent JP emblem.
- `app-icon.svg` / `.png`: macOS/Windows application artwork.

Edit the vector glyphs in `scripts/build-brand.cjs`, then run `node scripts/build-brand.cjs` from the repository root. This exports the SVG/PNG assets, macOS icon set and ICNS, Windows ICO, menu-bar template images, browser favicon, and phone/PWA icons. The script uses local Chrome to rasterize the vectors, `iconutil` for ICNS, and the existing `png-to-ico` dependency for ICO. Set `JPMIXER_CHROME_PATH` if Chrome is installed elsewhere.

Web logo copies are in `src/mixer/brand`. Shared responsive placement is in `src/mixer/original-theme.css`. Settings loads the same assets using relative paths.
