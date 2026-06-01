# JPMixer

**Browser-based monitor mix controller for DiGiCo consoles**

JPMixer is a Mac and Windows desktop app that runs a local web server, letting musicians control their own in-ear monitor (IEM) or wedge mixes from any phone, tablet, or laptop on the same network — without touching the front-of-house console.

> **Beta** — v1.1.0-beta.1

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
- **Ear scene recall** — save a full mix per DiGiCo snapshot; mix is pushed to the console and all screens automatically when the snapshot fires
- **Works on any device** — iOS, Android, Mac, Windows — any browser on the same WiFi, no app download required
- **Add to home screen (PWA)** — installs as a full-screen app on iPhone/iPad; connection stays alive when the screen locks

### Monitor Engineer
- **Monitor Engineer View** — full-screen grid of every aux mix side by side, fully interactive
- **±0.5 dB aux buttons** — trim an entire mix up or down by half a dB with one tap
- **Snapshot fire controls** — ⏮ ⏭ buttons to fire previous/next snapshot directly from the monitor view

### Console Controller *(new in v1.1.0)*
- **Input channel strips** — vertical faders for every channel on the desk with mute, solo, and dB readout
- **Control groups** — DiGiCo control group faders with mute and solo; names pulled live from the desk
- **Aux output masters** — fader and mute per aux output bus
- **Thumb-only fader drag** — must grab the handle to move; tapping the track does nothing, preventing accidental jumps on a touchscreen
- **Snapshot fire controls** — ⏮ ⏭ buttons in the console header

### System
- **Channel labels & icons** — customisable names and instrument icon library per channel
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

## Requirements

- DiGiCo console with OSC / DiGiCo Pad external control enabled (SD / Quantum / S series)
- Mac or Windows computer running JPMixer on the same network as the console
- Musicians connect via any web browser on the same WiFi — no app install needed

---

## Quick Setup

1. Open JPMixer — it appears in the menu bar / system tray
2. Click the icon → **Settings**
3. **Connection tab** — enter the DiGiCo console's IP address and OSC ports (send: `8000`, listen: `9000` by default)
4. **Channels tab** — assign icons and labels; set channel/aux counts to match your patch
5. **Auxes tab** — name each aux bus and assign colours
6. Click **Save & Apply** — the server starts automatically
7. Share the URL shown in the Connection tab with your musicians (e.g. `http://192.168.1.10:8080`)

For the full engineer setup guide and musician handout guide, see the [Releases page](https://github.com/JPMixing-inc/jpmixer/releases/latest).

---

## How It Works

JPMixer runs an Express web server and a WebSocket bridge inside an Electron shell.

- When a musician moves a fader, the browser sends a WebSocket message to JPMixer, which sends an OSC UDP packet to the DiGiCo console.
- The console echoes confirmed values back over OSC, which JPMixer caches and broadcasts to all connected browsers to keep every screen in sync.
- Musician mute and solo are implemented by driving aux send levels to –∞ dB, so they operate within each mix independently without touching the channel mute on the desk.
- The Console Controller uses the DiGiCo Pad external control OSC protocol, which exposes main channel faders, mutes, solos, and control groups in addition to aux sends.
- Ear scenes are stored as JSON on disk, matched to DiGiCo snapshot names, and replayed automatically when a matching snapshot fires.

---

## Built With

- [Electron](https://www.electronjs.org/)
- [Express](https://expressjs.com/)
- [ws](https://github.com/websockets/ws)
- [osc](https://github.com/colinbdclark/osc.js/)

---

*JPMixer is not affiliated with DiGiCo. DiGiCo is a trademark of DiGiCo UK Ltd.*
