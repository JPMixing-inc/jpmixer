# JPMixer

**Browser-based monitor mix controller for DiGiCo consoles**

JPMixer is a macOS and Windows desktop app that runs a local web server, letting musicians control their own in-ear monitor (IEM) mixes from any phone, tablet, or laptop on the same network — without touching the front-of-house console.

> **Beta** — v1.0.0-beta.2

---

## Screenshots

<p align="center">
  <img src="assets/ScreenShots/Aux Select Screen.png" width="280" alt="Aux select"/>
  <img src="assets/ScreenShots/PC Ear change Screen.png" width="280" alt="IEM mix control"/>
  <img src="assets/ScreenShots/Monitior Engineer Screen.png" width="280" alt="Monitor engineer view"/>
</p>
<p align="center">
  <img src="assets/ScreenShots/Phone Earchange.PNG" width="160" alt="Phone IEM control"/>
  <img src="assets/ScreenShots/Phone Solo channel.PNG" width="160" alt="Phone solo channel"/>
  <img src="assets/ScreenShots/Settings connection screen.png" width="280" alt="Settings"/>
</p>

---

## Features

- **Per-aux mix control** — each musician controls only their own IEM mix from their phone or tablet
- **Real-time faders** — instant OSC control of DiGiCo aux send levels, no lag
- **Mute & solo** — per-channel mute and solo via the browser UI
- **Ear scene recall** — save a mix snapshot per DiGiCo snapshot; mix is restored automatically when the snapshot changes
- **Monitor engineer view** — full overview of all mixes on one screen
- **Channel labels & icons** — customisable names and instrument icons per channel
- **Works on any device** — iOS, Android, Mac, Windows, any browser on the same WiFi
- **Auto-update check** — notifies you when a new version is available
- **Tray-bar app** — runs quietly in the menu bar / system tray, no dock clutter

---

## Download

Go to the [**Releases page**](https://github.com/JPMixing-inc/jpmixer/releases/latest) and download the installer for your platform:

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `JPMixer-x.x.x-arm64.dmg` |
| macOS (Intel) | `JPMixer-x.x.x.dmg` |
| Windows | `JPMixer.Setup.x.x.x.exe` |

**First launch on Mac:** If you see "damaged and can't be opened", run this in Terminal after dragging the app to Applications:
```
sudo xattr -rd com.apple.quarantine /Applications/JPMixer.app
```
Then open normally. This is a one-time step for unsigned apps downloaded via Chrome.

Alternatively, download via Safari — it adds a lighter quarantine flag that the standard right-click → Open → Open Anyway bypass works for.

**First launch on Windows:** Click "More info" → "Run anyway" on the SmartScreen prompt.

---

## Requirements

- DiGiCo console with OSC enabled (SD/Quantum/S series)
- Mac or Windows computer running JPMixer on the same network as the console
- Musicians connect via any web browser on the same WiFi — no app install needed

---

## Quick Setup

1. Open JPMixer — it appears in your menu bar / system tray
2. Click the icon → **Settings**
3. Enter your DiGiCo console's IP address and OSC port (default: `8000`)
4. Set the number of channels and auxes to match your patch
5. Click **Save & Apply** — the server starts automatically
6. Share the displayed URL with your musicians (e.g. `http://192.168.1.x:3000`)

Full setup guide and musician guide are available on the [Releases page](https://github.com/JPMixing-inc/jpmixer/releases/latest).

---

## How It Works

JPMixer runs an Express web server and a WebSocket bridge. When a musician moves a fader in their browser, JPMixer sends an OSC UDP message directly to the DiGiCo console. The console echoes back the confirmed value, which JPMixer forwards to all connected browsers to keep everything in sync.

Mute and solo are implemented by driving the aux send level to –∞ dB and restoring it, since DiGiCo OSC only exposes send levels — not discrete mute/solo commands.

---

## Built With

- [Electron](https://www.electronjs.org/)
- [Express](https://expressjs.com/)
- [ws](https://github.com/websockets/ws)
- [osc](https://github.com/colinbdclark/osc.js/)

---

*JPMixer is not affiliated with DiGiCo. DiGiCo is a trademark of DiGiCo UK Ltd.*
