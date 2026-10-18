# JPMixer

**Browser-based monitor mix controller for DiGiCo, Allen & Heath dLive, KLANG, and Behringer WING**

JPMixer is a Mac and Windows desktop app that runs a local web server, letting musicians control their own in-ear monitor (IEM) or wedge mixes from any phone, tablet, or laptop on the same network — without touching the front-of-house console.

> **v1.7.9**

---

## Screenshots

<p align="center">
  <img src="assets/ScreenShots/Aux Select Screen.png" width="220" alt="Aux select"/>
  <img src="assets/ScreenShots/PC Ear change Screen.png" width="220" alt="IEM mix control"/>
  <img src="assets/ScreenShots/Monitior Engineer Screen.png" width="220" alt="Monitor engineer view"/>
</p>
<p align="center">
  <img src="assets/ScreenShots/Phone Earchange.PNG" width="160" alt="Phone IEM control"/>
  <img src="assets/ScreenShots/Phone Solo channel.PNG" width="160" alt="Phone solo channel"/>
  <img src="assets/ScreenShots/Settings connection screen.png" width="220" alt="Settings"/>
</p>

---

## Features

### Musician Mix Control
- **Per-aux mix control** — each musician controls only their own IEM or wedge mix from their phone
- **Real-time faders, mute & solo, pan** — per-channel, per-aux, from the browser UI
- **Ear scene recall** — save a full mix per snapshot; it pushes to the console and every screen automatically when the snapshot fires, then locks the faders against accidental bumps until unlocked
- **Ear Scenes editor** — browse and edit a saved mix for any snapshot without touching the live sound; resets fresh every launch (unlike My Mixes)
- **My Mixes** — personal named mixes musicians can save anytime, backed up per-device on JPMixer's side
- **Built-in aux EQ** — optional 8-band parametric EQ per aux (DiGiCo only — see [Console Support](#console-support))
- **Hidden, link-only aux mixes** — hide an aux from the public picker, reachable only via its own direct URL
- **Works on any device, no app install** — iOS, Android, Mac, Windows, any browser on the same WiFi; installs as a full-screen PWA on iPhone/iPad

### Monitor Engineer
- Full-screen grid of every aux mix at once, fully interactive
- ±0.5 dB buttons to trim an entire mix in one tap
- Live presence indicators — who's currently mixing what
- Snapshot fire controls

### Devices View
- Live grid of connected musician devices, showing each one's selected mix
- Activity dot + short description of the last change ("Turned up Kick", "Saved mix \"Soundcheck\"")
- Last-active time and connection quality per device

### Console Controller
*(DiGiCo only — see [Console Support](#console-support))*
- Input channel strips, control groups, and aux output masters — faders, mute, solo
- Thumb-only fader drag (touching elsewhere scrolls instead of jumping the fader)
- Snapshot fire controls

### System
- Channel labels & instrument icon library
- Demo Mode — explore the full UI with simulated data, no desk required
- Automatic + manual backups, one-click export/import
- Live OSC traffic log in Settings, with optional recording to a file
- iPad OSC relay (TouchOSC, Lemur, etc.)
- [External Control API](#external-control-api) — token-gated HTTP endpoints for Bitfocus Companion, Elgato Stream Deck, and other external tools
- [Planning Center Services integration](#planning-center-services) — auto-label aux mixes from who's actually scheduled
- Auto-update check, tray app, optional port-80 forwarding

---

## Download

Go to the [**Releases page**](https://github.com/JPMixing-inc/jpmixer/releases/latest) and download the installer for your platform:

| Platform | File |
|----------|------|
| macOS Apple Silicon (M1/M2/M3/M4) | `JPMixer-x.x.x-arm64.dmg` |
| macOS Intel | `JPMixer-x.x.x.dmg` |
| Windows 10 / 11 | `JPMixer.Setup.x.x.x.exe` |

**First launch on Mac:** If macOS says the app is "damaged and can't be opened", run this in Terminal after dragging it to Applications:
```
sudo xattr -rd com.apple.quarantine /Applications/JPMixer.app
```

**First launch on Windows:** Click **More info → Run anyway** on the SmartScreen prompt. Allow the firewall dialog so musicians on the same network can reach the mixer page.

---

## Console Support

| | DiGiCo (SD / Quantum / S series) | Allen & Heath dLive | KLANG (paired with dLive) | Behringer WING |
|---|---|---|---|---|
| Connection | OSC / DiGiCo Pad external control | MIDI over TCP/IP | OSC (direct to the KLANG processor) | OSC (direct to the console, UDP port 2223) |
| Musician mix control (levels, mute, solo) | ✅ | ✅ | ✅ — controls KLANG's own mix, not the console | ✅ — real per-send mute, not a level trick |
| My Mixes / Ear Scenes / Devices View | ✅ | ✅ | ✅ | ✅ My Mixes / Devices View — ❌ no Ear Scenes (WING's protocol has no scene recall at all) |
| Per-send pan | ✅ | ❌ not exposed by dLive's protocol | ✅ — KLANG stereo-mode azimuth | ✅ real per-send pan, but the value scale is **unconfirmed on real hardware** — see [WING Setup](#wing-setup) |
| Built-in aux EQ | ✅ | ❌ | ❌ | ❌ |
| Console Controller | ✅ | ❌ | ❌ | ❌ |
| Status | Stable | **New — unvalidated on real hardware** | **New — unvalidated on real hardware** | **New — unvalidated on real hardware** |

dLive, KLANG, and WING each run as fully independent backends — selecting any one in Settings never touches DiGiCo's own connection or behavior. Full setup walkthroughs, including console-side steps and troubleshooting, are below: **[dLive Setup](#dlive-setup)** · **[KLANG Setup](#klang-setup)** · **[WING Setup](#wing-setup)**.

---

## Requirements

- A DiGiCo console with OSC / DiGiCo Pad external control enabled, **or** an Allen & Heath dLive MixRack with MIDI/TCP enabled, **or** a KLANG 3D in-ear processor paired with a dLive console, **or** a Behringer WING console — see [Console Support](#console-support)
- Mac or Windows computer running JPMixer on the same network as the console
- Musicians connect via any web browser on the same WiFi — no app install needed

---

## Quick Setup

1. Open JPMixer — it appears in the menu bar / system tray
2. Click the icon → **Settings**
3. **Setup tab** — pick your **Console Type** and enter the connection details. DiGiCo needs OSC ports (send `8000` / listen `8001` by default); dLive/KLANG/WING need a bit more — see [dLive Setup](#dlive-setup) / [KLANG Setup](#klang-setup) / [WING Setup](#wing-setup)
4. **Channels tab** — assign icons and labels; set channel/aux counts to match your patch
5. **Auxes tab** — name each aux bus, assign colours, turn on EQ per aux if wanted (DiGiCo only), mark any aux **Link** to hide it from the public picker
6. Click **Save & Apply** — the server starts automatically
7. Share the URL shown in the Setup tab with your musicians (e.g. `http://192.168.1.10:8080`)

No console handy yet? Turn on **Demo Mode** in the Setup tab to explore the full UI with simulated data first.

For the full engineer setup guide and musician handout guide, see the [Releases page](https://github.com/JPMixing-inc/jpmixer/releases/latest).

---

## How It Works

JPMixer runs an Express web server and a WebSocket bridge inside an Electron shell.

- A musician's fader move sends a WebSocket message to JPMixer, which relays it to the console (OSC/UDP for DiGiCo, MIDI/TCP for dLive, OSC/UDP to a paired KLANG processor, or OSC/UDP direct to a WING console) and broadcasts the confirmed value back to every connected screen.
- On DiGiCo and dLive, mute/solo are emulated by driving the send to –∞ dB rather than touching a real mute flag. KLANG and WING both expose a real per-send mute the console applies directly, so nothing needs to be faked there.
- Ear Scenes are stored as JSON, keyed by snapshot name (DiGiCo) or scene number (dLive/KLANG), and replayed automatically when a matching snapshot/scene fires. They reset fresh on every launch — My Mixes are the permanent ones. WING doesn't support Ear Scenes at all — its OSC layer never exposes scene/snapshot recall.
- Browser clients can only touch their own aux sends/EQ — a server-side allowlist blocks everything else, so a mixer page can't fire snapshots or reach other console parameters.
- dLive, KLANG, and WING each run as a completely separate backend, but present the exact same WebSocket interface to the browser — every screen works identically regardless of which one is active, and JPMixer only ever talks to one at a time.

---

## Built With

- [Electron](https://www.electronjs.org/)
- [Express](https://expressjs.com/)
- [ws](https://github.com/websockets/ws)
- [osc](https://github.com/colinbdclark/osc.js/)

---

<details>
<summary><b>📖 dLive Setup — click to expand</b></summary>

### dLive Setup

Applies to both the **Allen & Heath dLive** and **KLANG (paired with dLive)** console types — they share the same console-side connection. New this cycle and unvalidated on real hardware.

**On the console, before opening JPMixer:**

1. Go to **Utility → Control → MIDI** and turn **MIDI/TCP On**. Nothing can connect until this is enabled — the same way DiGiCo needs DiGiCo Pad turned on.
2. Note the **Base MIDI Channel** shown there (**0–11**, i.e. MIDI channel 1–12). It must match exactly in JPMixer's Settings. This is a protocol addressing offset, *not* your channel/aux count.
3. If **Secure Mode** is on for MIDI/TCP, note its username/password — you'll need them if you enable TLS in JPMixer.
4. Confirm firmware is **V1.91 or later** (this integration targets **V2.0**).

**In JPMixer's Settings (Setup tab):**

- **Console Type** → dLive, or KLANG if you're also running a KLANG processor.
- **Console IP Address** → the dLive **MixRack's** IP, not the Surface's. (Optional in KLANG mode — see [KLANG Setup](#klang-setup).)
- **Base MIDI Channel** → must match the console exactly.
- **Use TLS/SSL** → only if Secure Mode is on; fill in the username/password fields that appear.
- **MIDI/TCP Port Override** → leave at `0` for the default (51325, or 51327 with TLS). Try `51328` if nothing responds — an alternate port some third-party tools use; not fully settled which is correct without real hardware to confirm.
- **Listen for live send-level updates** / **Poll send levels as a backup** → both on by default. It's unconfirmed whether the console pushes live aux-send updates the way it's documented to for faders/mutes; polling is the safety net. Turn polling off once you've confirmed live updates work, to cut console traffic.

**Connection model:** unlike DiGiCo Pad (one connection at a time), dLive's MixRack supports up to **40 simultaneous connections** — Surface, IP6/IP8/IP1/IP4 remotes, Director, MixPad/OneMix/4You, and third-party tools all at once. JPMixer just takes one of those 40 slots.

**What works today:** aux send levels, mute/solo (emulated), Ear Scene recall, My Mixes, Devices View. **Not implemented:** per-send pan (not exposed by the protocol), built-in aux EQ, Console Controller.

**Troubleshooting:**
- *"Not connected"* — recheck MIDI/TCP is On, the IP is the MixRack's, and the Base MIDI Channel matches.
- *Connects but nothing responds* — try port `51328`.
- *Levels seem stale* — confirm "Poll send levels as a backup" is on.
- Aux send levels are the single most load-bearing message type here — the first thing worth confirming works.

</details>

<details>
<summary><b>🎧 KLANG Setup — click to expand</b></summary>

### KLANG Setup

This is the part that actually carries musician mix control in KLANG mode — the dLive connection ([dLive Setup](#dlive-setup)) is only for optional channel-name sync and Ear Scene snapshot-following. Skipping this section is the most likely reason KLANG mode "connects" but nobody hears anything change.

**Before anything else — audio routing.** KLANG needs its own dedicated multitrack audio feed (MADI, Dante, or analog) patched directly from the console to the KLANG processor. That's a physical decision made at the console/patchbay, entirely outside JPMixer — the app only ever sends control messages, never audio.

1. **Find the KLANG processor's IP** — check **KLANG:app → CONFIG → CONNECT**, or the unit's own network info. No DHCP on that network means it defaults to a link-local `169.254.x.y` address; assign it a fixed IP for a stable setup.
2. Enter that IP in JPMixer's **KLANG Processor IP Address** field. Leave **KLANG Port Override** at `0` (default 9110).
3. **Match channel numbers** — JPMixer's channel *N* must line up with the same input channel *N* under **KLANG:app → CONFIG → CHANNELS → INPUT**.
4. **Match mix numbers** — JPMixer's aux *N* is KLANG's **MIX *N*** (USER1–USER8 on the analog outputs).
5. **Set each mix to Stereo mode in KLANG:app** — JPMixer's pan only works in KLANG's stereo placement mode (-90°/0°/+90°); in 3D/i3D mode azimuth means a full spatial position instead. JPMixer never sets this itself.

**Troubleshooting:**
- *dLive connected but KLANG silent* — check the KLANG IP separately; the two connections are independent.
- *Levels move but nothing's audible* — almost always the audio routing step above.
- *Pan does nothing* — confirm Stereo mode in KLANG:app.
- *No way to confirm it's working from JPMixer alone* — KLANG's protocol has no read-back (see [Console Support](#console-support)), so JPMixer trusts its own last-sent value. Watching KLANG:app on another device is the most reliable way to confirm control end to end.

</details>

<details>
<summary><b>🅱️ WING Setup — click to expand</b></summary>

### WING Setup

Behringer WING is self-contained — unlike KLANG, there's no secondary console connection to configure, and unlike DiGiCo/dLive, there's no documented console-side toggle to switch on first. WING's OSC server listens on UDP port 2223 by default.

**In JPMixer's Settings (Setup tab):**

- **Console Type** → Behringer WING.
- **Console IP Address** → the WING console's own IP. Same field DiGiCo/dLive use — WING needs nothing else.
- **WING Port Override** → leave at `0` for the documented default (`2223`).

Unlike dLive/KLANG, WING confirms it's actually reachable with a real round-trip request on connect, not just "did the local network socket open" — the Console status pill in Settings reflects that directly.

**What works today:** aux send levels, a real per-send mute (WING's own on/off flag, not a level trick), real per-send pan, My Mixes, Devices View. **Not implemented:** built-in aux EQ, Console Controller, and Ear Scenes — WING's OSC layer doesn't expose scene/snapshot recall at all, so there's nothing to hook Ear Scenes into.

**⚠️ Pan scale is unconfirmed.** WING's own OSC documentation shows the per-send pan parameter exists and defaults to `0`, but never documents its actual valid range or units — there's no worked example for it the way there is for fader level. JPMixer currently sends pan as degrees (-90 full left to +90 full right), the same convention KLANG documents, but WING may use a different scale internally. Test pan carefully the first time you connect to real WING hardware — if it doesn't reach full left/right, or reads as if reversed, that's the value scale, not a wiring problem.

**Troubleshooting:**
- *"Not connected"* — recheck the IP address and that the console is powered on and reachable on the network JPMixer is running on.
- *Levels work but mute doesn't* — confirm you're on Console Type "Behringer WING" and not accidentally "Custom OSC".
- *Pan seems clipped or reversed* — see the pan scale note above.
- *No Ear Scenes tab behavior* — expected; WING has no scene recall to hook into.

</details>

<details>
<summary><b>🔌 External Control API — click to expand</b></summary>

### External Control API

A token-gated HTTP API for external tools — Bitfocus Companion, Elgato Stream Deck, a Planning Center Services connector, or anything that can make an HTTP request. It runs as a separate, always-on server, completely independent of whichever console backend is active: enabling/disabling it, or regenerating its token, never restarts or interrupts the console connection, and vice versa.

**Setup:** Settings → **Control API** tab → **Enable Control API** → **Regenerate** to create a token. Anyone with that token can rename channels, mute mixes, and fire snapshots — treat it like a password.

**Auth:** send the token as `Authorization: Bearer <token>`, or as a `?token=` query parameter if your tool can't set custom headers (covers most Stream Deck HTTP actions and Companion's generic HTTP module).

**Endpoints** (all under `http://<this Mac's IP>:<port>/api/v1/`, port `9096` by default):

| Method & path | Body | What it does |
|---|---|---|
| `GET /status` | — | Connection state, console type, channel/aux counts |
| `GET /channels` / `GET /auxes` | — | Current label overrides |
| `POST /channels/:n/label` | `{"label": "..."}` | Rename channel *n* — live, no restart |
| `POST /auxes/:n/label` | `{"label": "..."}` | Rename aux *n* — live, no restart |
| `POST /auxes/:n/mute` | `{"channel": N, "muted": true}` | Mute/unmute one channel's send into aux *n* |
| `POST /auxes/:n/solo` | `{"channel": N, "soloed": true}` | Solo/unsolo one channel within aux *n* |
| `POST /scenes/fire` | `{"action": "next"}` or `"prev"` | Relative snapshot navigation — same as the mixer UI's own prev/next |

A relabel takes effect immediately on every connected musician's/monitor engineer's screen with no reconnect needed — this is what makes the Planning Center use case work: name aux mixes after who's actually playing them for a given service, without touching the console connection at all.

**Not implemented:** recalling a specific snapshot by name/number directly (only relative prev/next exists today, matching the mixer UI's own capability). If the console backend isn't currently running, endpoints other than `/status` return `503` rather than erroring.

</details>

<details>
<summary><b>📅 Planning Center Services — click to expand</b></summary>

### Planning Center Services

Pulls who's scheduled on the current or next service and renames the matching aux mixes for you — "Acoustic Guitar - John Smith" instead of just "AUX 3". Runs entirely inside JPMixer (Settings → **Planning Center** tab) — no separate tool.

**Auto-sync on launch:** once set up, JPMixer re-applies your saved position mapping automatically every time the console connection starts — on app launch (with Start server automatically on), and on every manual Start Server too. You never have to open Settings or click Sync Now for it to stay current; it's there if you want to force a re-check (e.g. right before a service, if PCO's schedule changed since launch) or see a summary of what got applied. Settings itself also auto-selects your saved Service Type and Team the moment you open the Planning Center tab, with no Refresh clicks needed.

**Setup:**
1. Generate a Personal Access Token at `api.planningcenteronline.com/personal_access_tokens` — the App ID and Secret it gives you go in the Application ID / Secret fields. Stored the same way JPMixer already stores your console password: locally, in plain text, in JPMixer's own config file. This is a credential to your Planning Center account specifically, so treat it accordingly.
2. **Refresh Service Types**, then pick the one you run services under.
3. **Refresh Teams**, then optionally pick one (e.g. "Worship") to narrow the Position mapping list below, and — once saved with **Save & Apply** — the Green Room display too. Leave it on "— All Teams —" to see everything. Either way, this never changes what Sync Now applies — every saved position mapping still fires regardless of which team is selected here.
4. **Refresh Positions** — lists every Team Position under the selected Team (or all of them), each with a dropdown to map it to one of your JPMixer aux mixes ("— unmapped —" by default). Switching the Team dropdown afterward just re-filters this same list instantly — no new fetch needed. This mapping is saved with **Save & Apply**, the same as everything else in Settings.
5. That's it — this mapping now auto-applies every time the console connects (see above). **Sync Now** is there for a manual re-check any time. Either way, it finds the plan closest to right now for your Service Type — currently running or next upcoming, not just "soonest future" — pulls who's scheduled, and relabels every aux with a mapped position live, with no console restart, the same mechanism the [External Control API](#external-control-api) uses.

**What it does and doesn't do:** only confirmed team members are included by default ("Include unconfirmed team members" changes that); anyone scheduled to a position you haven't mapped is skipped and listed as a warning after syncing, rather than silently doing nothing; it only ever reads from Planning Center, never writes back to it.

**Green Room display** — open `http://<this Mac's IP>:<server port>/greenroom.html` on an iPad, TV, or any browser on the network (e.g. a computer set up in front of the green room mics) for a full-screen, read-only grid of everyone scheduled for the next service — photo, name, and role. No token needed, unlike the Control API — it's informational, not a control surface. Auto-refreshes every 2 minutes, so it can just be left open. Uses the same Service Type and "Include unconfirmed" setting configured above; if a **Team** is selected and saved (e.g. "Worship"), only that team shows here — leave it on "— All Teams —" to keep showing everyone scheduled, the default. Each row in the Position → Aux Mapping table also has a **Hide from Green Room** checkbox for excluding individual positions regardless of team.

**Multiple same-day services (e.g. Saturday 5pm/7pm, Sunday 9am/11am):** handled automatically. JPMixer always picks whichever plan is closest to right now — currently running or next up — rather than just the soonest future one, so it doesn't jump ahead to the 7pm plan the moment 5pm starts. The switch happens right at the midpoint between two services, not at either one's start time.

**Multiple teams (Worship, Production, etc.):** fully supported. Refresh Positions and Sync Now both follow Planning Center's pagination, so every team's positions and everyone scheduled show up regardless of how many teams a Service Type has — earlier versions only read the first page and could silently cut off a team. The **Team** dropdown lets you narrow the Position → Aux Mapping table to just one team (e.g. Worship only, hiding Production/Host positions) instead of scrolling through everyone at once — applied instantly against the already-fetched list, no new fetch needed when switching teams. Once saved, it also narrows the Green Room display to that same team.

**Note on API details:** Planning Center's endpoint/field names here are based on their stable, documented schema, but weren't independently re-verified against a live response line-by-line (their interactive API explorer is a JS app, not a static doc). If Refresh Service Types or Sync Now ever shows an error with a raw status code and response body instead of working normally, that's most likely a real mismatch worth reporting.

</details>

---

*JPMixer is not affiliated with DiGiCo, Allen & Heath, KLANG:technologies, Behringer/MUSIC Tribe, or Planning Center. DiGiCo is a trademark of DiGiCo UK Ltd. dLive is a trademark of Allen & Heath Limited. KLANG is a trademark of KLANG:technologies GmbH. WING is a trademark of MUSIC Tribe Global Brands Ltd. Planning Center is a trademark of Ministry Centered Technologies.*
