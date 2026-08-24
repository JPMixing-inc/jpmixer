# JPMixer

**Browser-based monitor mix controller for DiGiCo and Allen & Heath dLive consoles**

JPMixer is a Mac and Windows desktop app that runs a local web server, letting musicians control their own in-ear monitor (IEM) or wedge mixes from any phone, tablet, or laptop on the same network — without touching the front-of-house console.

> **v1.7.8**

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
- **Real-time faders** — instant OSC control of DiGiCo aux send levels with zero noticeable lag
- **Mute & solo** — per-channel, per-aux mute and solo from the browser UI
- **Pan control** — left/right pan per channel per aux for stereo IEM users
- **Ear scene recall** — save a full mix per DiGiCo snapshot; it's pushed to the console and every screen automatically when the snapshot fires. Once saved, faders lock to protect against accidental bumps — tap the status banner to unlock, edit, or revert to the saved mix
- **Ear Scenes editor** — browse and edit a saved mix for *any* snapshot, even one the console isn't currently on, without touching the live sound; scenes reset fresh every time JPMixer launches (unlike My Mixes, which are permanent)
- **My Mixes** — musicians can also save personal named mixes anytime, independent of any snapshot; backed up per-device on JPMixer's side in case local storage gets cleared
- **Built-in aux EQ** — optional 8-band parametric EQ per aux, adjustable right from the performer's phone (DiGiCo only — see [Console Support](#console-support))
- **Hidden, link-only aux mixes** — mark an aux "Link" in Settings to hide it from the public mix picker; it's reachable only via its own direct URL, for a private reference mix, a guest, or a monitor you don't want cluttering the picker
- **Works on any device** — iOS, Android, Mac, Windows — any browser on the same WiFi, no app download required
- **Add to home screen (PWA)** — installs as a full-screen app on iPhone/iPad; connection stays alive when the screen locks

### Monitor Engineer
- **Monitor Engineer View** — full-screen grid of every aux mix side by side, fully interactive
- **±0.5 dB aux buttons** — trim an entire mix up or down by half a dB with one tap
- **Live presence indicators** — see at a glance how many performers currently have each aux mix open
- **Snapshot fire controls** — ⏮ ⏭ buttons to fire previous/next snapshot directly from the monitor view

### Devices View
- **Live device grid** — one card per connected musician device, showing which aux mix they've currently got selected
- **Activity indicator** — a dot lights up the moment someone moves a fader or pan, alongside a short description of what changed (e.g. "Turned up Kick", "Panned Vocal left", "Saved mix \"Soundcheck\"", "Saved Ear Scene")
- **Last active & connection quality** — see how recently each device did something, and whether its connection is solid, weak, or reconnecting

### Console Controller
*(DiGiCo only — see [Console Support](#console-support))*
- **Input channel strips** — vertical faders for every channel on the desk with mute, solo, and dB readout
- **Control groups** — DiGiCo control group faders with mute and solo; names pulled live from the desk
- **Aux output masters** — fader and mute per aux output bus
- **Thumb-only fader drag** — must grab the handle to move; touching elsewhere scrolls the channel strips instead of jumping the fader
- **Snapshot fire controls** — ⏮ ⏭ buttons in the console header

### System
- **Channel labels & icons** — customisable names and instrument icon library per channel
- **Demo Mode** — explore the full UI with simulated console data, no desk required
- **Automatic + manual backups** — config and My Mixes back themselves up on a schedule, plus one-click export/import
- **OSC Log** — a live terminal view of raw OSC traffic in Settings, with start/stop recording to a text file for troubleshooting
- **iPad OSC relay** — forwards DiGiCo OSC to one or more iPads running TouchOSC, Lemur, or similar apps
- **Auto-update check** — notifies when a new release is available on GitHub
- **Tray app** — runs quietly in the menu bar (Mac) or system tray (Windows)
- **Port 80 forwarding** — optional one-command setup so musicians type just the IP address, no port number

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

| | DiGiCo (SD / Quantum / S series) | Allen & Heath dLive | KLANG (paired with dLive) |
|---|---|---|---|
| Connection | OSC / DiGiCo Pad external control | MIDI over TCP/IP | OSC (direct to the KLANG processor) |
| Musician mix control (levels, mute, solo) | ✅ | ✅ | ✅ — controls KLANG's own mix, not the console |
| My Mixes / Ear Scenes / Devices View | ✅ | ✅ | ✅ |
| Per-send pan | ✅ | ❌ not exposed by dLive's MIDI protocol | ✅ — KLANG stereo-mode azimuth |
| Built-in aux EQ | ✅ | ❌ not implemented yet | ❌ not implemented yet |
| Console Controller | ✅ | ❌ not implemented yet | ❌ not implemented yet |
| Status | Stable | **New — not yet validated on real hardware** | **New — not yet validated on real hardware** |

dLive support talks to the MixRack directly over MIDI/TCP (Utility → Control → MIDI must be turned on at the console, the same way DiGiCo consoles need DiGiCo Pad enabled) and runs as a fully separate backend from the DiGiCo path — selecting it in Settings never touches DiGiCo's OSC connection or behavior. If you're trying it on a real console for the first time, start with aux send levels and keep an eye on the OSC-equivalent traffic; see the in-app warning on the Setup tab for the current known gaps.

KLANG support is for rigs running a KLANG 3D in-ear processor alongside a dLive console — it's a third, independent backend that talks directly to the KLANG processor over OSC (KLANG needs its own dedicated audio feed from the console, patched outside of JPMixer entirely). Musicians' faders control their KLANG mix directly, not the console's aux sends; an optional secondary connection to the paired dLive console supplies channel names and drives Ear Scene recall off the console's own snapshot changes. KLANG's own control protocol has no way to confirm back what value it actually applied, so JPMixer trusts its own last-sent value as the mix state — if someone also has the real KLANG:app open on the same mix, JPMixer won't notice the difference. See the in-app warning on the Setup tab.

---

## Requirements

- A DiGiCo console with OSC / DiGiCo Pad external control enabled (SD / Quantum / S series), **or** an Allen & Heath dLive MixRack with MIDI/TCP enabled, **or** a KLANG 3D in-ear processor paired with a dLive console — see [Console Support](#console-support)
- Mac or Windows computer running JPMixer on the same network as the console
- Musicians connect via any web browser on the same WiFi — no app install needed

---

## Quick Setup

1. Open JPMixer — it appears in the menu bar / system tray
2. Click the icon → **Settings**
3. **Setup tab** — pick your **Console Type** (DiGiCo or dLive), then enter the console's IP address and connection details (DiGiCo: OSC ports, send `8000` / listen `8001` by default; dLive: Base MIDI Channel and, if enabled, TLS credentials)
4. **Channels tab** — assign icons and labels; set channel/aux counts to match your patch
5. **Auxes tab** — name each aux bus, assign colours, turn on EQ per aux if you want musicians to have it (DiGiCo only), and mark any aux **Link** to hide it from the public mix picker
6. Click **Save & Apply** — the server starts automatically
7. Share the URL shown in the Setup tab with your musicians (e.g. `http://192.168.1.10:8080`)

No console handy yet? Turn on **Demo Mode** in the Setup tab to explore the full UI with simulated data first.

For the full engineer setup guide and musician handout guide, see the [Releases page](https://github.com/JPMixing-inc/jpmixer/releases/latest).

---

## How It Works

JPMixer runs an Express web server and a WebSocket bridge inside an Electron shell.

- When a musician moves a fader, the browser sends a WebSocket message to JPMixer, which sends an OSC UDP packet to the DiGiCo console.
- The console echoes confirmed values back over OSC, which JPMixer caches and broadcasts to all connected browsers to keep every screen in sync.
- Musician mute and solo are implemented by driving aux send levels to –∞ dB, so they operate within each mix independently without touching the channel mute on the desk.
- The Console Controller uses the DiGiCo Pad external control OSC protocol, which exposes main channel faders, mutes, solos, and control groups in addition to aux sends.
- Ear scenes are stored as JSON on disk, matched to DiGiCo snapshot names (or dLive scene numbers, which is all dLive's protocol exposes), and replayed automatically when a matching snapshot/scene fires. They're intentionally session-only and don't persist across an app restart.
- My Mixes are stored per device (levels + pan, no snapshot needed), with a server-side backup copy so they survive a cleared browser cache.
- Browser clients can only send OSC for their own aux sends and EQ — an address allowlist on the server blocks anything else, so a mixer page can't fire snapshots or touch other console parameters.
- The Devices view is a pure browser-to-browser notice over the existing WebSocket hub — it never sends anything to the console, so it adds zero extra OSC load on the desk.
- dLive support runs as a completely separate backend that speaks MIDI over TCP/IP to the console instead of OSC/UDP, but presents the exact same WebSocket interface to the browser — every screen (musician mixer, monitor view, devices view) works identically regardless of which console type is active, and JPMixer only ever talks to one backend at a time based on the Console Type set in Settings.

---

## Built With

- [Electron](https://www.electronjs.org/)
- [Express](https://expressjs.com/)
- [ws](https://github.com/websockets/ws)
- [osc](https://github.com/colinbdclark/osc.js/)

---

*JPMixer is not affiliated with DiGiCo, Allen & Heath, or KLANG:technologies. DiGiCo is a trademark of DiGiCo UK Ltd. dLive is a trademark of Allen & Heath Limited. KLANG is a trademark of KLANG:technologies GmbH.*
