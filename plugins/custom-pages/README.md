# Custom Pages

A JPMixer Original plugin. It makes link-only pages for a youth night, a
women's event or anything else that runs its own sound. Each page has just
the faders that group needs, and every fader has its own highest level, so
nobody on the page can push it past that.

- **Faders:** console channels and control groups (DCAs), on DiGiCo, dLive and
  LV1, the consoles with JPMixer's Console Controller.
- **The highest level** is checked by JPMixer, not by the page. If the engineer
  has a fader above it on the desk, the page can bring it down but not back up.
- **Mute buttons** and **Companion buttons** can be added to each page. Each
  page with Companion buttons is its own surface in Companion, named
  "JPMixer" and the page's name. They go through the Companion buttons
  plugin, which has the connection to Companion: install it and set it up
  first.
- **Links:** each page has a secret link and a QR code. New link stops the old
  one working straight away. A page that's off shows that it isn't available.
- **Setting up** is in JPMixer, on the JPMixer computer only: Settings →
  Plugins → Custom Pages, under Pages.

Needs JPMixer 2.0.16 or later.

## Settings

| Setting | What it's for |
|---|---|
| Highest level for a new fader (dB) | What a fader added to a page starts with. Each fader's own can be changed under Pages, in the same tab. |

## Files

- `index.js`: the pages, their links, and the level checks.
- `pages.js`: the rules (kept apart so they're easy to test).
- `page/`: the custom page people open from its link. The editor is part of
  JPMixer's Settings (src/windows/settings/custom-pages.js).
