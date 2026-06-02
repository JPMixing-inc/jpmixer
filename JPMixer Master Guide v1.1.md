# JPMixer
## Live Monitor Mix Controller — User Guide
### BETA RELEASE

**VERSION 1.1.0-BETA.1 · DIGICO SD / QUANTUM**

---

## CONTENTS

1. Overview
2. Installation
3. First Launch & Settings
4. Connecting to the Console
5. Setting Up Channels
6. Setting Up Aux Mixes
7. Using the Mixer (Musicians)
8. Mute & Solo
9. Ear Scenes — Save & Recall
10. Monitor Engineer View
11. Console Controller
12. iPad OSC Connections
13. Installing on iPhone / iPad
14. Diagnostics & Event Log
15. Troubleshooting

---

## 1. Overview

JPMixer is a Mac and Windows application that bridges a DiGiCo SD or Quantum console to any web browser on the same network. Musicians open a webpage on their iPhone or iPad and control their own monitor mix — no App Store download required.

The system works over your stage network using OSC (Open Sound Control). JPMixer runs in the menu bar (Mac) or system tray (Windows), serves the mixer page to any connected device, and relays fader moves to the console in real time.

### What you can do

- Each musician controls their own aux send levels from their phone
- Mute or solo individual channels per aux mix — server applies it to the console
- Save "ear scenes" per snapshot so mixes recall automatically with the show
- Monitor engineer sees every aux mix on one full-screen grid with full control
- Console engineer controls main channel faders, mutes, solos, and control groups from the Console Controller
- Fire DiGiCo snapshots (previous / next) directly from the Monitor View or Console Controller
- See how many devices are connected at a glance in the Settings header
- Relay console data to iPad OSC apps (TouchOSC, Lemur, etc.)
- Install the mixer as a home screen app on iPhone / iPad (PWA)

> **DiGiCo OSC Note:** JPMixer uses the DiGiCo Pad OSC protocol, which exposes aux send levels, pan, main channel faders, mutes, solos, and control groups. JPMixer implements musician mute and solo by driving aux send levels to –∞ dB via OSC, so it operates within each musician's monitor mix without touching the channel mute on the desk.

---

## 2. Installation

### Which file do I use?

| File | Use For |
|------|---------|
| `JPMixer-1.1.0-beta.1-arm64.dmg` | Apple Silicon Macs — M1, M2, M3, M4 (drag & drop install) |
| `JPMixer-1.1.0-beta.1.dmg` | Intel Macs — drag & drop install |
| `JPMixer.Setup.1.1.0-beta.1.exe` | Windows 10 / 11 — installer wizard |

### Installing on Mac (DMG)

1. Double-click the `.dmg` file to mount it
2. Drag JPMixer into the Applications shortcut
3. Eject the DMG and open JPMixer from Applications or Spotlight

> **Gatekeeper Warning:** Because JPMixer is not signed with an Apple Developer certificate, macOS may block it on first open. To allow it: right-click (or Control-click) the app in Finder → **Open** → **Open Anyway**. You only need to do this once. Alternatively go to System Settings → Privacy & Security → scroll down → **Open Anyway**.
>
> If macOS says the app is "damaged," run this in Terminal after dragging it to Applications:
> `sudo xattr -rd com.apple.quarantine /Applications/JPMixer.app`

### Installing on Windows (EXE)

1. Double-click `JPMixer.Setup.1.1.0-beta.1.exe`
2. If Windows SmartScreen appears, click **More info** → **Run anyway**
3. Follow the installer — click Next, Install
4. JPMixer launches automatically when installation completes and appears in the system tray

> **Windows Firewall:** On first launch, Windows may ask to allow JPMixer through the firewall. Click **Allow** so musicians on the same network can reach the mixer page.

---

## 3. First Launch & Settings

When JPMixer launches it appears in two places:

- **Menu bar / System tray** — the JPMixer icon gives you a quick menu for starting/stopping the server, opening views, and accessing settings
- **Dock (Mac) / Taskbar (Windows)** — the app appears while running so it can be force-quit if it ever becomes unresponsive

### Opening Settings

Click the menu bar / tray icon → **Settings…**

### Tray Menu Options

- **Start / Stop Server** — toggle the web server on or off
- **Open Mixer in Browser** — opens the mixer page on the local machine
- **Open Monitor Engineer View** — opens the full monitor grid in a window
- **Open Console Controller** — opens the full-screen console fader controller
- **Settings…** — opens the Settings panel
- **Check for Updates…** — manually check GitHub for a newer version of JPMixer
- **Quit JPMixer** — stops the server and exits

JPMixer also checks for updates automatically 3 seconds after launch. If a newer version is available, a dialog appears with a Download button that opens the releases page.

### Settings Header

The top-right of the Settings window shows two status indicators:

- **Device count badge** — shows how many browsers are currently connected to the mixer (e.g. "3 devices"). Updates live as people connect and disconnect.
- **Status pill** — green "Running" or grey "Stopped" for the web server

### Settings Tabs

| Tab | What it does |
|-----|-------------|
| **Connection** | Start/stop the server, enter console IP and OSC ports, view your IP address, enable port 80 forwarding. |
| **Channels** | Create channel groups, assign instrument icons, add label overrides, and control which channels appear in the mixer. |
| **Auxes** | Name each aux bus, assign a colour, and toggle visibility. Hidden auxes don't appear in the musician's mix picker. |
| **iPad OSC** | Add iPad connections for relaying console OSC data to TouchOSC, Lemur, or similar apps. |
| **Monitor** | Open the Monitor Engineer View and see the direct browser link for the full-screen grid. |
| **Console** | Open the Console Controller and see the direct browser link for the console fader page. |
| **General** | Console type, channel/aux counts, auto-start server on launch, and ear scene recall toggle. |

---

## 4. Connecting to the Console

### Network Setup

JPMixer, the DiGiCo console, and all musician devices must be on the same network. This is typically your dedicated stage WiFi or wired LAN. The Mac or PC running JPMixer should have a static IP or a DHCP reservation so the address doesn't change between shows.

### Required Settings

1. Open Settings → **Connection** tab
2. Enter the console's IP address in **Console IP Address**
3. Set **Send Port** — the OSC port JPMixer sends commands to the desk (typically 8000)
4. Set **Listen Port** — the OSC port JPMixer receives data from the desk (typically 9000)
5. Set your **Server Port** — the port musicians use to open the mixer in their browser (default 8080)
6. Click **Save & Apply**
7. Click **Start** — the status dot turns green when the console responds to OSC

> **Sharing the URL with musicians:** Your IP is shown in the Connection tab under "This Mac's IP." Musicians open `http://[IP]:8080` in Safari on their phone. If you enable port 80 (see below) they can just type the IP with no port number.

### Use Port 80 (Optional)

Click **Use Port 80** to install a background service that forwards port 80 to your server port. Musicians can then open the mixer by typing just the IP address with no colon or number — much easier to hand out on the night.

- **Mac:** Requires your admin password and installs a persistent LaunchDaemon that survives reboots.
- **Windows:** Uses `netsh portproxy` to redirect port 80. Requires running JPMixer as administrator on first setup.

### Auto-Start on Launch

In Settings → **General**, enable **Start server automatically on launch**. JPMixer will start the web server and connect to the console as soon as the app opens.

---

## 5. Setting Up Channels

### Channel Groups

Groups organise channels into labelled sections in the mixer (e.g. Drums, Guitars, Keys, Vocals). Click **+ Add Group**, give it a name and colour, then assign channels to it. Groups appear as section headers in the musician's mixer view.

### Channel Settings

In the Channels tab, each row is one input channel. You can configure:

- **Icon** — pick from a library of instrument icons to identify the channel at a glance
- **Label Override** — rename the channel in the mixer (the console name is used by default)
- **Group** — assign to a group for section ordering
- **On/Off toggle** — hide a channel completely from the mixer and monitor view

> **Tip:** Channel names are pulled automatically from the console when the server starts. You only need a label override if you want a different name from what's on the desk.

---

## 6. Setting Up Aux Mixes

Each aux bus becomes one selectable "mix" in the musician's browser. In the **Auxes** tab:

- **Name** — rename the aux (e.g. "Drums IEM", "Sarah — Wedge", "FOH Reference")
- **Color** — choose a colour shown in the mixer header when that aux is selected
- **Show toggle** — hide unused auxes so they don't clutter the picker

Click **Save & Apply** after making changes. The server restarts automatically and all connected devices update within seconds.

---

## 7. Using the Mixer — Musicians

### Opening the Mixer

1. Connect your phone or tablet to the stage WiFi
2. Open Safari (strongly recommended on iPhone/iPad)
3. Type the Mac's IP address and port: `http://192.168.x.x:8080`
4. The mixer loads — tap your aux name at the top to select your mix
5. Your last-used mix is remembered — next time you open it you go straight in

### Mixer Controls

- **Aux bar (top centre)** — shows your current mix name; tap to switch to a different aux
- **Faders** — drag up to increase a channel's level in your mix, drag down to reduce
- **M button** — mutes that channel in your mix (fader drives to –∞ dB on the console)
- **S button** — solos that channel (all other channels go to –∞ dB, solo channel stays)
- **PAN toggle (top right)** — shows pan knobs alongside each fader for stereo positioning
- **Connection dot (top right)** — green = live, pulsing grey = reconnecting
- **Save button (💾)** — saves your current mix as an ear scene for the active snapshot

### Reconnection Behaviour

If WiFi drops or the phone goes to sleep, JPMixer reconnects automatically when the connection is restored. Your previously selected aux is remembered — you don't need to re-select your mix. The "Reconnecting…" overlay appears only after 2.5 seconds of no connection, so brief interruptions don't cause a visible flash.

> **Best experience on iOS:** Add the mixer to your home screen (see Section 13) for a full-screen experience that works like a native app. The connection stays alive even when your phone screen locks — native WebSocket ping frames keep the session open regardless of whether JavaScript is running.

---

## 8. Mute & Solo

Every channel row in both the musician mixer and the monitor engineer view has two small buttons: **M** and **S**.

### How Mute Works

Tapping **M** mutes that channel in your aux mix. JPMixer drives the channel's aux send level to –∞ dB on the console. The channel row dims to show it is muted. The button lights red while active.

When you unmute, JPMixer restores the fader to exactly where it was before you muted — including any adjustments made while it was muted.

### How Solo Works

Tapping **S** solos that channel. Every other channel in the aux mix is silenced — only the soloed channel is heard. The button lights amber while active. You can solo multiple channels at once; all soloed channels play, everything else is silent.

### Mute + Solo Together

Mute and solo work independently. A channel that is both muted and soloed stays silent (mute takes priority).

### Scope

Mute and solo are per-aux — muting a channel in your drum IEM mix has no effect on anyone else's mix. Each musician's mute/solo state is completely independent.

### Monitor Engineer Control

The monitor engineer can mute and solo any channel on any aux from the monitor view. Changes are reflected immediately on the musician's mixer for that aux, and vice versa — both views stay in sync.

---

## 9. Ear Scenes — Save & Recall

An ear scene is a saved snapshot of your entire aux mix for a specific console snapshot. When a snapshot fires, JPMixer instantly pushes your saved mix to the console and moves all faders on the musician's screen — so each song has exactly the right monitor mix without anyone touching their phone.

> **Auto-recall is off by default.** Ear scenes won't recall automatically until you enable the setting. Go to Settings → **General** → turn on **Auto-recall scenes on snapshot change** → click **Save & Apply**. This must be done once after installing JPMixer.

### Saving a Scene

1. Fire the console snapshot you want to save a mix for — the snapshot name appears in the mixer header
2. Adjust your mix in the browser to exactly how you want it for that song
3. Tap the 💾 button — a confirmation toast confirms the save with the snapshot name

When a scene is already saved for the current snapshot, the button shows 🗑 — tap it to delete the saved scene for that snapshot and aux.

> **Check the snapshot name before saving.** If the header shows "—" or is blank, JPMixer hasn't received the snapshot name from the console yet — wait for it to populate before saving.

### Enabling Automatic Recall

1. Open Settings → **General** tab
2. Enable **Auto-recall scenes on snapshot change**
3. Click **Save & Apply**

Now whenever the console fires a new snapshot, JPMixer checks every aux for a saved scene matching that snapshot name, sends those fader values to the console, and immediately moves faders on every connected musician's screen.

### Snapshot Name Matching

Scenes are matched by the exact snapshot name the console sends via OSC — case-sensitive, including spaces. If a snapshot is renamed on the desk, any scene saved under the old name won't fire. Use the event log at `/api/events` to see exactly which snapshot name was received and whether a scene was found for it.

---

## 10. Monitor Engineer View

The Monitor Engineer View is a full-screen grid showing every aux mix at once — all channels, all faders, fully interactive. Designed for a second screen or a dedicated iPad or laptop at the monitor position.

### Opening the Monitor View

- From the menu bar: click the JPMixer icon → **Open Monitor Engineer View**
- From Settings: **Monitor** tab → Open Monitor View
- From any browser: `http://[ip]:8080/monitor.html`

### Monitor View Features

- **Column per aux** — scroll horizontally to see all mixes side by side
- **Fully interactive faders** — the monitor engineer can adjust any channel in any mix
- **M and S buttons** — mute and solo any channel on any aux directly from the monitor view
- **±0.5 dB buttons** — each aux column header has **−0.5** and **+0.5** buttons. One tap shifts every channel in that mix by half a dB — useful for quick level trims without touching individual faders
- **Snapshot controls** — ⏮ and ⏭ buttons in the header fire the previous or next snapshot on the console
- **Device count** — the header shows how many browser devices are currently connected
- **Snapshot name** — the current console snapshot name is shown in the header
- **Live sync** — all changes sync instantly between the monitor view and the musician's mixer

> **Tip:** The monitor view works well on a large iPad in landscape mode. Add it to the home screen as a PWA for a full-screen experience with no browser chrome.

---

## 11. Console Controller

The Console Controller is a full-screen engineer page for controlling main channel faders, mutes, solos, and DiGiCo control groups directly from a phone or tablet. It communicates with the desk via the DiGiCo Pad OSC protocol.

### Opening the Console Controller

- From the menu bar: click the JPMixer icon → **Open Console Controller**
- From Settings: **Console** tab → Open Console View
- From any browser: `http://[ip]:8080/console.html`

> The Console tab in Settings also shows the direct link URL so you can send it to whoever needs it.

### Tabs

The Console Controller has three full-screen tabs:

#### Inputs
Vertical fader strips for every input channel on the desk. Each strip shows:
- Channel number at the top
- Vertical fader with fill indicator
- dB readout
- **M** (mute) and **S** (solo) buttons
- Channel name at the bottom (pulled from the desk)

> **Fader behaviour:** You must grab the white handle to move the fader. Tapping anywhere on the fader track does not jump the value — this prevents accidental moves on a touchscreen.

#### Control Groups
The same vertical fader layout for each DiGiCo control group (shown in teal). Group names are pulled live from the desk. Use these to ride whole sections (e.g. "Drums", "Vocals") with one fader.

#### Aux Outputs
A full-width vertical list of all aux output buses with a horizontal fader and mute button per row. Useful for trimming aux master levels.

### Snapshot Controls

The ⏮ and ⏭ buttons in the header fire the previous or next snapshot on the console, the same as in the Monitor View.

### OSC Address Note

The Console Controller uses the DiGiCo Pad OSC protocol addresses:
- Input channels: `/Input_Channels/N/fader`, `/mute`, `/solo`
- Aux outputs: `/Aux_Outputs/N/fader`, `/mute`
- Control groups: `/Control_Groups/N/fader`, `/mute`, `/solo`

If faders aren't responding, check `/api/osc-all` in a browser after moving a fader on the desk to verify the exact addresses your firmware uses.

---

## 12. iPad OSC Connections

JPMixer can relay DiGiCo OSC data to one or more iPads running OSC apps such as TouchOSC or Lemur. This allows a custom iPad layout to run alongside JPMixer — both receive console data and both can send commands to the console.

### Adding an iPad

1. Open Settings → **iPad OSC** tab
2. Click **+ Add iPad**
3. Enter a name, the iPad's IP address, the send port (JPMixer → iPad), and the listen port (iPad → JPMixer)
4. Toggle the connection **On**
5. Click **Save & Apply**

JPMixer creates a dedicated UDP OSC connection for each enabled iPad. Console messages are forwarded to all connected iPads, and commands from any iPad are forwarded to the console.

---

## 13. Installing on iPhone / iPad

The JPMixer web page can be installed as a home screen app — no App Store required. It opens full-screen with no browser address bar, just like a native app. The JPMixer logo appears on the home screen.

### Adding to Home Screen (Safari on iOS)

1. Open the mixer URL in Safari on your iPhone or iPad
2. Tap the **Share** button (box with arrow at the bottom of the screen)
3. Scroll down and tap **Add to Home Screen**
4. Tap **Add** — the JPMixer icon appears on your home screen

### Connection Stability on iOS

iOS Safari suspends JavaScript when an app goes to the background. JPMixer handles this correctly — the server uses native WebSocket ping frames at the protocol level, which iOS responds to automatically even with JavaScript suspended. Your connection stays alive while the screen is off.

> **This feature requires Safari on iOS.** Chrome and other browsers on iPhone do not support Add to Home Screen with full PWA behaviour or the same background connection stability.

---

## 14. Diagnostics & Event Log

JPMixer keeps a live log of internal server events — connections, disconnections, ping timeouts, session changes, and more.

### Viewing the Event Log

While the server is running, open any browser and go to: `http://[ip]:8080/api/events`

The page auto-refreshes every 3 seconds and shows the last 100 events with timestamps and detail.

### OSC Address Inspector

To see every OSC address the desk has sent since the server started: `http://[ip]:8080/api/osc-all`

This is useful for verifying Console Controller addresses — move a fader on the desk and look for the address it sends back. Use `http://[ip]:8080/api/osc-clear` to reset the list so you can isolate new messages.

### Common Event Types

| Event | What it means |
|-------|---------------|
| `ws-connect` | A browser device connected to the mixer |
| `ws-disconnect` | A browser device disconnected |
| `ping-timeout` | A device didn't respond to pings within 75 seconds — connection terminated |
| `session-change` | The console sent a session change notification; JPMixer is reloading console metadata |
| `session-reload` | Cache cleared and metadata reload started after session change |
| `metadataloaded` | All console metadata loaded; server is fully live |
| `scene-save` | A musician saved an ear scene |
| `scene-recall` | A scene was found and applied to the console |
| `scene-skip` | Scene recall was skipped — shows whether recall is disabled or no scene was saved for that snapshot name |

> **Diagnosing scene recall issues:** A `scene-skip` entry will tell you exactly why recall was skipped — either auto-recall is disabled, or it will show the snapshot name received vs the names saved. This makes name mismatch easy to spot.

---

## 15. Troubleshooting

### Console status shows Offline
- Check the console IP address is correct in Settings → Connection
- Confirm the DiGiCo console has OSC enabled and the send/listen ports match both sides
- Make sure JPMixer and the console are on the same network segment
- Try stopping and restarting the server from the Connection tab

### Mixer page won't load on iPhone
- Confirm the iPhone is on the same WiFi as the Mac/PC
- Double-check the IP address shown in Settings → Connection under "This Mac's IP"
- Make sure the server is running
- Try opening in Safari — Chrome on iOS may behave differently

### Faders move on screen but don't affect the console
- The Console status dot in Settings must be green
- Confirm the correct aux numbers in the Auxes tab match your DiGiCo session
- Verify the desk's OSC send port and receive port aren't swapped

### Console Controller faders don't move the desk
- Check `/api/osc-all` after moving a fader on the desk — verify the address your firmware sends matches what JPMixer expects
- Confirm you are using the DiGiCo Pad external control protocol on the desk (not the standard OSC mode)

### Ear scenes not recalling
- Enable **Auto-recall scenes on snapshot change** in Settings → General — it is off by default
- Confirm a scene is saved for that snapshot — the 💾 button shows 🗑 when a saved scene exists
- Check the snapshot name is showing in the mixer header before you save — if it shows "—" the name hasn't loaded yet
- Names are case-sensitive and must match exactly including spaces
- Open `/api/events` and look for `scene-skip` entries

### App blocked by macOS Gatekeeper
Right-click the app in Finder → **Open** → **Open Anyway**. You only need to do this once.
If it says "damaged": `sudo xattr -rd com.apple.quarantine /Applications/JPMixer.app`

### Windows SmartScreen blocks the installer
Click **More info** → **Run anyway**. You only need to do this once.

### App won't open after installing a new version over an old one
- Quit the running version first (menu bar / tray icon → Quit JPMixer)
- Delete the old copy from Applications (Mac) or uninstall from Add/Remove Programs (Windows)
- Then install the new version

### Mixer shows "Reconnecting…" and stays that way
- Check the server is still running from the menu bar / tray icon
- Check the Mac/PC hasn't gone to sleep
- If the IP changed (DHCP renewal), reload the mixer page with the new IP
- View the event log at `/api/events` to see what caused the disconnect

---

*JPMixer v1.1.0-beta.1 · Built for DiGiCo SD / Quantum · Mac + Windows · Last updated June 2026*
