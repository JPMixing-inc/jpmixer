# JPMixer
## Live Monitor Mix Controller — User Guide

**VERSION 1.7.3 · DIGICO SD / QUANTUM**

---

## CONTENTS

1. Overview
2. What's New Since v1.1
3. Installation
4. First Launch & the Menu Bar / Tray Icon
5. Settings Window Overview
6. Setup Tab — Server, Console Connection & Startup
7. Channels Tab — Icons, Labels & Groups
8. Auxes Tab — Naming, Colours & Per-Aux EQ
9. Views Tab — Opening Monitor, Console & Devices Views
10. Using the Mixer (Musicians)
11. Mute & Solo
12. Built-In Aux EQ
13. My Mixes — Personal Saved Mixes
14. Ear Scenes — Save, Lock, Recall & Edit
15. Menu Drawer & Fader Layout Size
16. Monitor Engineer View
17. Console Controller
18. Devices View
19. iPad OSC Connections
20. Installing on iPhone / iPad (Home Screen App)
21. My Mixes Tab (Settings) — Managing Performer Mixes
22. Backup Tab — Backups, Ear Scene Recall & Reset
23. OSC Log Tab — Live Traffic & Recording
24. Demo Mode
25. Diagnostics & Event Log
26. Troubleshooting

---

## 1. Overview

JPMixer is a Mac and Windows application that bridges a DiGiCo SD or Quantum console to any web browser on the same network. Musicians open a webpage on their iPhone, Android phone, or tablet and control their own monitor mix — no App Store download required.

The system works over your stage network using OSC (Open Sound Control). JPMixer runs in the menu bar (Mac) or system tray (Windows), serves the mixer page to any connected device, and relays fader moves to the console in real time.

### What you can do

- Each musician controls their own aux send levels, pan, mute, and solo from their phone
- Each musician can shape their own tone with a built-in 8-band aux EQ
- Musicians can save personal named mixes (**My Mixes**) that persist forever, and save a per-snapshot mix (**Ear Scenes**) that recalls automatically with the show
- A musician can browse and edit their saved Ear Scene for *any* snapshot — even one the console isn't currently on — without touching the live sound
- Once an Ear Scene is saved, faders lock automatically to protect against accidental bumps
- The engineer can watch every connected musician's device in real time in the **Devices View** — which mix they've picked, when they last touched a fader, and their connection quality
- The monitor engineer sees every aux mix on one full-screen grid with full control
- The console engineer controls main channel faders, mutes, solos, and control groups from the Console Controller
- Fire DiGiCo snapshots (previous / next) directly from the Mixer, Monitor View, or Console Controller
- Explore the entire app with simulated console data in **Demo Mode** — no desk required
- Automatic and manual backups of your setup and My Mixes, with one-click export/import
- A live OSC traffic terminal with start/stop recording to a file, for troubleshooting
- Relay console data to iPad OSC apps (TouchOSC, Lemur, etc.)
- Install the mixer as a home screen app on iPhone / iPad (PWA)

> **DiGiCo OSC Note:** JPMixer uses the DiGiCo Pad OSC protocol, which exposes aux send levels, pan, main channel faders, mutes, solos, and control groups. JPMixer implements musician mute and solo by driving aux send levels to –∞ dB via OSC, so it operates within each musician's monitor mix without touching the channel mute on the desk.

---

## 2. What's New Since v1.1

If you're upgrading from an earlier version, here's what's changed:

- **My Mixes** — personal named mixes, independent of any snapshot, saved permanently per device
- **Built-in aux EQ** — an 8-band parametric EQ per aux, available right on the performer's phone
- **Ear Scene locking** — faders now lock automatically once a scene is saved, with a status banner showing locked / unlocked / unsaved-changes state
- **Ear Scenes editor** — browse, edit, or delete a saved mix for any snapshot, even one the console isn't currently on
- **Ear Scenes now reset every launch** — they always start fresh for a new show. My Mixes remain permanent
- **Devices View** — a brand-new page showing every connected musician's device, their selected mix, live activity, and connection quality
- **Reorganised menu drawer** — the mixer's ☰ menu is now split into a main page (**Save Mix**, **Ear Scenes**, fader layout) and an **Ear Scenes** submenu (Save/Delete Ear Scene, Browse Ear Scenes)
- **Demo Mode** — simulate a full console with fake data, no hardware required, great for exploring the app or demoing it to a client
- **Automatic + manual backups** — scheduled backups plus one-click export/import from Settings
- **OSC Log** — a live terminal view of raw OSC traffic in Settings, with start/stop recording to a text file
- **Live channel/aux count sync** — the Channels and Auxes tabs now auto-correct against the console's actual reported counts, so a mismatched Settings field can't hide channels or aux EQ
- **Settings reorganised** into Setup / Channels / Auxes / Views / My Mixes / Backup / OSC Log tabs

---

## 3. Installation

### Which file do I use?

| File | Use For |
|------|---------|
| `JPMixer-1.7.3-arm64.dmg` | Apple Silicon Macs — M1, M2, M3, M4 (drag & drop install) |
| `JPMixer-1.7.3.dmg` | Intel Macs — drag & drop install |
| `JPMixer.Setup.1.7.3.exe` | Windows 10 / 11 — installer wizard |

### Installing on Mac (DMG)

1. Double-click the `.dmg` file to mount it
2. Drag JPMixer into the Applications shortcut
3. Eject the DMG and open JPMixer from Applications or Spotlight

> **Gatekeeper Warning:** Because JPMixer is not signed with an Apple Developer certificate, macOS may block it on first open. To allow it: right-click (or Control-click) the app in Finder → **Open** → **Open Anyway**. You only need to do this once. Alternatively go to System Settings → Privacy & Security → scroll down → **Open Anyway**.
>
> If macOS says the app is "damaged," run this in Terminal after dragging it to Applications:
> `sudo xattr -rd com.apple.quarantine /Applications/JPMixer.app`

### Installing on Windows (EXE)

1. Double-click `JPMixer.Setup.1.7.3.exe`
2. If Windows SmartScreen appears, click **More info** → **Run anyway**
3. Follow the installer — click Next, Install
4. JPMixer launches automatically when installation completes and appears in the system tray

> **Windows Firewall:** On first launch, Windows may ask to allow JPMixer through the firewall. Click **Allow** so musicians on the same network can reach the mixer page.

---

## 4. First Launch & the Menu Bar / Tray Icon

When JPMixer launches it appears in two places:

- **Menu bar (Mac) / System tray (Windows)** — the JPMixer icon gives you a quick menu for starting/stopping the server, opening views, and accessing settings
- **Dock (Mac) / Taskbar (Windows)** — the app appears while running so it can be force-quit if it ever becomes unresponsive

Click the icon to open the tray menu:

| Item | What it does |
|------|---------------|
| **● Running / ○ Stopped** | Status readout — not clickable |
| **Start / Stop Server** | Toggle the web server on or off |
| **Open Mixer in Browser** | Opens the mixer page on the local machine |
| **Open Monitor Engineer View** | Opens the full monitor grid in its own window |
| **Open Console Controller** | Opens the full-screen console fader controller |
| **Open Devices View** | Opens the live grid of connected musician devices |
| **Settings…** | Opens the Settings panel |
| **Check for Updates…** | Manually check GitHub for a newer version of JPMixer |
| **Quit JPMixer** | Stops the server and exits |

JPMixer also checks for updates automatically 3 seconds after launch. If a newer version is available, a dialog appears with a Download button that opens the releases page.

---

## 5. Settings Window Overview

Click the menu bar / tray icon → **Settings…**

The top-right of the Settings window shows two status indicators:

- **Device count badge** — shows how many browsers are currently connected to the mixer (e.g. "3 devices"). Updates live as people connect and disconnect.
- **Status pill** — green "Running" or grey "Stopped" for the web server

### Settings Tabs

| Tab | What it does |
|-----|-------------|
| **Setup** | Start/stop the server, console IP and OSC ports, console type and counts, iPad OSC connections, auto-start on launch, and Demo Mode. |
| **Channels** | Create channel groups, assign instrument icons, add label overrides, and control which channels appear in the mixer. |
| **Auxes** | Name each aux bus, assign a colour, toggle visibility, and enable per-aux EQ. |
| **Views** | Open the Monitor, Console, and Devices views, and copy their direct browser links. |
| **My Mixes** | See and delete every performer's saved mixes, organized by device. |
| **Backup** | Ear Scene auto-recall toggle, automatic backups, manual export/import, and layout reset. |
| **OSC Log** | A live terminal of raw OSC traffic between JPMixer and the console, with recording. |

Every tab (except Views, My Mixes, and OSC Log, which act immediately) needs **Save & Apply** at the bottom of the window to take effect. The server restarts automatically and all connected devices update within seconds.

---

## 6. Setup Tab — Server, Console Connection & Startup

### Network Setup

JPMixer, the DiGiCo console, and all musician devices must be on the same network. This is typically your dedicated stage WiFi or wired LAN. The Mac or PC running JPMixer should have a static IP or a DHCP reservation so the address doesn't change between shows.

### Required Settings

1. Open Settings → **Setup** tab
2. Enter the console's IP address in **Console IP Address**
3. Set **Send Port (to desk)** — the OSC port JPMixer sends commands to the desk (default `8000`)
4. Set **Listen Port (from desk)** — the OSC port JPMixer receives data from the desk (default `8001`)
5. Set your **Server Port** — the port musicians use to open the mixer in their browser (default `8080`)
6. Click **Save & Apply**
7. Watch the **Console** status pill at the top of the tab — it turns green ("Connected") when the console responds to OSC

> **Sharing the URL with musicians:** Your IP is shown under "This Mac's IP" at the top of the Setup tab. Musicians open `http://[IP]:8080` in their browser. If you enable port 80 (see below) they can just type the IP with no port number.

### Console Type & Counts

Under **Console**, set:
- **Console Type** — DiGiCo SD/Quantum, Behringer X32/Midas M32, Yamaha CL/QL, or Custom OSC
- **Channels** / **Auxes / Buses** / **Groups** — how many of each your session uses

> **These fields auto-correct.** Once JPMixer connects to a live DiGiCo desk, the Channels and Auxes tabs check the console's actual reported counts and silently correct these numbers if they're out of sync — so a stale field here can't hide channels or aux EQ from the mixer. You still need a sensible starting value before the console connects, or when using Demo Mode.

### Use Port 80 (Optional)

Click **Use Port 80** to install a background service that forwards port 80 to your server port. Musicians can then open the mixer by typing just the IP address with no colon or number — much easier to hand out on the night.

- **Mac:** Requires your admin password and installs a persistent LaunchDaemon that survives reboots.
- **Windows:** Uses `netsh portproxy` to redirect port 80. Requires running JPMixer as administrator on first setup.

### Startup

Enable **Start server automatically on launch** so JPMixer starts the web server and connects to the console as soon as the app opens — recommended for a dedicated show laptop.

### Demo / Simulate

See [Section 24 — Demo Mode](#24-demo-mode) below. The toggle lives at the bottom of the Setup tab.

---

## 7. Channels Tab — Icons, Labels & Groups

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

## 8. Auxes Tab — Naming, Colours & Per-Aux EQ

Each aux bus becomes one selectable "mix" in the musician's browser. In the **Auxes** tab:

- **Name** — rename the aux (e.g. "Drums IEM", "Sarah — Wedge", "FOH Reference")
- **Colour** — choose a colour shown in the mixer header, Devices View cards, and Monitor View when that aux is selected
- **Show toggle** — hide unused auxes so they don't clutter the picker
- **EQ toggle** — turn on the built-in 8-band aux EQ for that aux, letting performers shape their own tone from their phone

Click **Save & Apply** after making changes.

---

## 9. Views Tab — Opening Monitor, Console & Devices Views

The **Views** tab is the fastest way to open and share JPMixer's three engineer-facing pages. Each has an **Open [View]** button and a **Direct link** you can copy and send to whoever needs it (e.g. a monitor engineer's iPad, or a second FOH laptop).

| View | Purpose | Direct link |
|------|---------|--------------|
| **Monitor Engineer View** | Full-screen grid of every aux mix, all channels, fully interactive | `http://[ip]:8080/monitor.html` |
| **Console Controller** | Main faders, mutes, solos, control groups, aux masters | `http://[ip]:8080/console.html` |
| **Devices View** | Live grid of connected musician devices and their activity | `http://[ip]:8080/devices.html` |

> **Console Controller sends real commands to the desk.** Unlike the musician mixer (which only touches aux sends), the Console Controller's main faders, mutes, and solos affect the console for **everyone**, FOH included. Only hand this link to engineers.

Buttons are disabled with a "Start the server first to open" hint until the server is running.

---

## 10. Using the Mixer — Musicians

### Opening the Mixer

1. Connect your phone or tablet to the stage WiFi
2. Open a browser (Safari is strongly recommended on iPhone/iPad)
3. Type the Mac/PC's IP address and port: `http://192.168.x.x:8080`
4. The mixer loads — tap the aux bar at the top ("Select Mix") to choose your mix
5. Your last-used mix is remembered — next time you open it you go straight in

### Mixer Controls

- **Aux bar (top centre)** — shows your current mix name; tap to switch to a different aux
- **Faders** — drag up to increase a channel's level in your mix, drag down to reduce
- **M button** — mutes that channel in your mix (fader drives to –∞ dB on the console)
- **S button** — solos that channel (all other channels go to –∞ dB, solo channel stays)
- **PAN toggle (top right)** — shows pan knobs alongside each fader for stereo positioning
- **Connection dot (top right)** — green = live, and a "Reconnecting…" overlay appears after 2.5 seconds if the connection drops
- **☰ menu (top right)** — Save Mix, Ear Scenes, and fader layout size — see [Section 15](#15-menu-drawer--fader-layout-size)
- **Snapshot bar** — shows the console's current snapshot name, and (once an aux is selected) a status banner for your Ear Scene — see [Section 14](#14-ear-scenes--save-lock-recall--edit)

### Reconnection Behaviour

If WiFi drops or the phone goes to sleep, JPMixer reconnects automatically when the connection is restored. Your previously selected aux is remembered — you don't need to re-select your mix. The "Reconnecting…" overlay appears only after 2.5 seconds of no connection, so brief interruptions don't cause a visible flash.

> **Best experience on iOS:** Add the mixer to your home screen (see Section 20) for a full-screen experience that works like a native app. The connection stays alive even when your phone screen locks — native WebSocket ping frames keep the session open regardless of whether JavaScript is running.

---

## 11. Mute & Solo

Every channel row in the musician mixer, Monitor View, and Console Controller has two small buttons: **M** and **S**.

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

The monitor engineer can mute and solo any channel on any aux from the Monitor View. Changes are reflected immediately on the musician's mixer for that aux, and vice versa — both views stay in sync.

---

## 12. Built-In Aux EQ

If the engineer has enabled EQ for an aux (Settings → Auxes tab → EQ toggle), musicians get an 8-band parametric EQ for that mix.

### Opening the EQ

1. Select your aux
2. Tap ☰ → **Equalizer**
3. The EQ curve and band handles appear on a graph; tap a band handle to select it

### Editing a Band

Once a band is selected, three sliders appear:
- **FREQ** — the band's centre frequency
- **GAIN** — boost or cut in dB (−18 to +18)
- **Q** — bandwidth/resonance

Drag the handle directly on the curve for quick adjustments, or use the sliders for precise control. Tap **Reset** to return the selected band to flat (0 dB).

EQ changes apply live to your aux mix immediately — there's nothing to save separately. EQ settings persist with your Ear Scene and My Mixes the same as fader levels.

---

## 13. My Mixes — Personal Saved Mixes

My Mixes are personal, permanent, named presets — independent of any console snapshot. A musician can save as many as they like and reload them anytime, on any aux, even weeks later.

### Saving a Mix

1. Dial in your levels and pans exactly how you want them
2. Tap ☰ → **Save Mix** — this opens the **My Mixes** panel
3. Tap **+ Save Current Mix As…**
4. Type a name and tap **Save**

### Loading or Deleting a Mix

Open ☰ → **Save Mix** to see every mix you've saved. Tap a mix's name to load it onto your **currently selected aux** — the values apply regardless of which aux they were originally saved from. Tap the 🗑 next to a mix to delete it (with a confirmation prompt).

### Where Mixes Are Stored

My Mixes are saved in your browser's local storage on your device, so they survive across sessions and app restarts. JPMixer also keeps a server-side backup keyed to your device, so if your browser cache gets cleared, reopening the mixer page automatically restores your saved mixes from the backup.

> **My Mixes never expire and are never wiped automatically** — unlike Ear Scenes (Section 14), which reset every time JPMixer launches. This makes My Mixes the right tool for "my personal in-ear sound," and Ear Scenes the right tool for "this song's mix."

The engineer can view and delete any performer's saved mixes from Settings → **My Mixes** tab (Section 21).

---

## 14. Ear Scenes — Save, Lock, Recall & Edit

An Ear Scene is a saved snapshot of your entire aux mix — levels, pan, and EQ — tied to one specific DiGiCo console snapshot. When that snapshot fires on the desk, JPMixer instantly pushes your saved mix to the console and moves your faders — so each song has exactly the right monitor mix with no action needed.

> **Ear Scenes reset every launch.** They're intentionally session-only, so every show starts fresh — nobody accidentally plays last week's mixes over tonight's set. If you want a mix that's always there no matter when you open JPMixer, use **My Mixes** (Section 13) instead.

### Saving an Ear Scene

1. Fire the console snapshot you want to save a mix for — the snapshot name appears in the mixer's snapshot bar
2. Adjust your mix in the browser to exactly how you want it for that song
3. Tap ☰ → **Ear Scenes** → **Save Ear Scene**

A toast confirms the save, and the status banner under the snapshot name changes to **🔒 Mix Locked for [snapshot]**.

### Fader Locking

Once a scene is saved for the currently-live snapshot, faders **lock** automatically to protect against accidental bumps mid-show. Trying to move a locked fader shows a toast: *"Mix locked — tap the banner above to unlock."*

The status banner has four states:

| Banner | Meaning |
|--------|---------|
| **Not Saved** | No Ear Scene exists yet for this snapshot/aux |
| **🔒 Mix Locked for [snapshot]** | A scene is saved and faders are locked. Tap the banner to unlock |
| **🔓 Unlocked — Editing** | You've unlocked the banner and can freely move faders. Tap again to re-lock |
| **↺ Changed Since Save — Tap to Revert** | You've moved a fader since the last save. Tap the banner to revert back to your last saved mix |

To delete a saved scene, tap ☰ → **Ear Scenes** → **Delete Ear Scene** (the menu item swaps to this once a scene exists for the current snapshot).

> **Check the snapshot name before saving.** If the snapshot bar shows "—" or is blank, JPMixer hasn't received the snapshot name from the console yet — wait for it to populate before saving.

### Browsing & Editing Other Snapshots' Scenes

Tap ☰ → **Ear Scenes** → **Browse Ear Scenes** to see every saved scene for your currently selected aux, across every snapshot — not just the live one. The snapshot the console is currently on is marked **LIVE**.

- Tapping the **LIVE** snapshot's name just closes the list — its mix is already what your faders show
- Tapping any **other** snapshot's name opens the **Ear Scene editor** — a dedicated screen where you can adjust that saved mix's faders without touching the live sound. Nothing you do here reaches the console until you tap **Save**
- Tapping 🗑 next to any snapshot deletes that saved scene (with a confirmation prompt)

This is the answer to "the engineer fired a different snapshot, but I want to fix tomorrow's opener's mix right now" — you can edit any snapshot's saved mix at any time, regardless of what the console is currently doing.

### Enabling Automatic Recall

Auto-recall is **off by default**. To turn it on:

1. Open Settings → **Backup** tab
2. Enable **Auto-recall scenes on snapshot change**
3. Click **Save & Apply**

Now whenever the console fires a new snapshot, JPMixer checks every aux for a saved scene matching that snapshot name, sends those fader values to the console, and immediately moves faders on every connected musician's screen.

### Snapshot Name Matching

Scenes are matched by the exact snapshot name the console sends via OSC — case-sensitive, including spaces. If a snapshot is renamed on the desk, any scene saved under the old name won't fire automatically anymore (though it will still appear under its old name in the Ear Scenes browser, and can still be edited there). Use the event log at `/api/events` (Section 25) to see exactly which snapshot name was received.

---

## 15. Menu Drawer & Fader Layout Size

Tap the ☰ icon (top right of the mixer) to open the menu drawer. It has two pages:

**Main page:**
- **Equalizer** — opens the built-in aux EQ (only shown if EQ is enabled for your aux)
- **Save Mix** — opens the My Mixes panel (Section 13)
- **Ear Scenes** — opens the Ear Scenes submenu (below)
- **Fader Layout** — three size buttons: **Compact**, **Normal**, **Large**. Choose whichever fits your screen and finger size best; your choice is remembered on this device

**Ear Scenes submenu** (tap **Ear Scenes** from the main page, or **‹** to go back):
- **Save Ear Scene** / **Delete Ear Scene** — for the currently live snapshot (Section 14)
- **Browse Ear Scenes** — the full list across every snapshot for your current aux (Section 14)

The menu always reopens on the main page, even if you left it on the Ear Scenes submenu last time.

---

## 16. Monitor Engineer View

The Monitor Engineer View is a full-screen grid showing every aux mix at once — all channels, all faders, fully interactive. Designed for a second screen or a dedicated iPad or laptop at the monitor position.

### Opening the Monitor View

- From the menu bar: click the JPMixer icon → **Open Monitor Engineer View**
- From Settings: **Views** tab → Open Monitor View
- From any browser: `http://[ip]:8080/monitor.html`

### Monitor View Features

- **Column per aux** — scroll horizontally to see all mixes side by side
- **Fully interactive faders** — the monitor engineer can adjust any channel in any mix
- **M and S buttons** — mute and solo any channel on any aux directly from the monitor view
- **±0.5 dB buttons** — each aux column header has **−0.5** and **+0.5** buttons. One tap shifts every channel in that mix by half a dB — useful for quick level trims without touching individual faders
- **Snapshot controls** — ⏮ and ⏭ buttons in the header fire the previous or next snapshot on the console
- **Device count** — the header shows how many browser devices are currently connected
- **Snapshot name** — the current console snapshot name is shown in the header
- **Live presence badge** — a small "● N" badge appears on an aux column header whenever one or more performers currently have that aux open on their own mixer
- **Live sync** — all changes sync instantly between the monitor view, the musician's mixer, and the Console Controller

> **Tip:** The monitor view works well on a large iPad in landscape mode. Add it to the home screen as a PWA for a full-screen experience with no browser chrome.

---

## 17. Console Controller

The Console Controller is a full-screen engineer page for controlling main channel faders, mutes, solos, and DiGiCo control groups directly from a phone or tablet. It communicates with the desk via the DiGiCo Pad OSC protocol.

### Opening the Console Controller

- From the menu bar: click the JPMixer icon → **Open Console Controller**
- From Settings: **Views** tab → Open Console View
- From any browser: `http://[ip]:8080/console.html`

> The Views tab in Settings also shows the direct link URL so you can send it to whoever needs it.

### Tabs

The Console Controller has three full-screen tabs:

#### Inputs
Vertical fader strips for every input channel on the desk. Each strip shows:
- Channel number at the top
- Vertical fader with fill indicator
- dB readout
- **M** (mute) and **S** (solo) buttons
- Channel name at the bottom (pulled from the desk)

> **Fader behaviour:** You must grab the white handle to move a fader — touching anywhere else on the strip scrolls the channel list instead of jumping the fader, matching the same touch behaviour as the musician mixer.

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

If faders aren't responding, check `/api/osc-all` (Section 25) in a browser on the machine running JPMixer, after moving a fader on the desk, to verify the exact addresses your firmware uses.

---

## 18. Devices View

The Devices View gives the engineer a live, at-a-glance picture of every musician currently connected — without needing to walk over and ask anyone what they're doing.

### Opening the Devices View

- From the menu bar: click the JPMixer icon → **Open Devices View**
- From Settings: **Views** tab → Open Devices View
- From any browser: `http://[ip]:8080/devices.html`

### What Each Device Card Shows

One card appears per connected musician device (any device that has selected an aux mix — the Devices View, Monitor View, and Console Controller don't count themselves):

- **Aux banner** — the mix that device currently has selected, in that aux's colour and label ("No mix selected" if they haven't picked one yet)
- **Device tag** — a stable "Device 1", "Device 2", etc. label for the life of the window (numbers may be reassigned if you close and reopen the Devices View)
- **Activity dot** — lights up green the moment that device moves a fader or pan, saves a mix, or saves an Ear Scene, then fades out
- **Action description** — a short text description of the most recent action, e.g. *"Turned up Kick"*, *"Panned Vocal left"*, *"Saved mix \"Soundcheck\""*, *"Saved Ear Scene"*. During a continuous fader drag this only updates once the fader is actually released, so it never flickers
- **Last active** — a live-updating "Active just now" / "12s ago" / "3m ago" readout, or "No activity yet" for a device that's connected but hasn't touched anything
- **Connection quality** — a coloured dot + label:

  | Status | Meaning |
  |--------|---------|
  | 🟢 **Connected** | A ping response has been received within the last 30 seconds — normal |
  | 🟡 **Weak signal** | 30–60 seconds since the last ping response — the device likely has a shaky WiFi connection |
  | 🔴 **Reconnecting…** | 60+ seconds since the last ping response — about to be dropped (JPMixer gives up after 75 seconds) |

> **This view adds zero load on the console.** All of it — the aux selection, the activity light, the description text — is pure browser-to-browser messaging over JPMixer's existing connection hub. Nothing here ever sends extra OSC traffic to the desk.

---

## 19. iPad OSC Connections

JPMixer can relay DiGiCo OSC data to one or more iPads running OSC apps such as TouchOSC or Lemur. This allows a custom iPad layout to run alongside JPMixer — both receive console data and both can send commands to the console.

### Adding an iPad

1. Open Settings → **Setup** tab → **iPad OSC Connections**
2. Click **+ Add iPad**
3. Enter a name, the iPad's IP address, the send port (JPMixer → iPad), and the listen port (iPad → JPMixer)
4. Toggle the connection **On**
5. Click **Save & Apply**

JPMixer creates a dedicated UDP OSC connection for each enabled iPad. Console messages are forwarded to all connected iPads, and commands from any iPad are forwarded to the console.

---

## 20. Installing on iPhone / iPad (Home Screen App)

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

## 21. My Mixes Tab (Settings) — Managing Performer Mixes

Settings → **My Mixes** shows every mix every performer has saved, organized by device, so the engineer can review or clean up saved mixes without needing each musician's phone.

- Click **Refresh** to pull the latest list
- Delete any individual mix directly from this tab

This is a read/delete view for the engineer — musicians save and load their own mixes from the mixer page itself (Section 13).

---

## 22. Backup Tab — Backups, Ear Scene Recall & Reset

### Ear Scene Recall

See [Section 14](#14-ear-scenes--save-lock-recall--edit) — the **Auto-recall scenes on snapshot change** toggle lives here.

### Automatic Backups

Enable **Automatically back up** to have JPMixer periodically save your console settings, channel/aux setup, and My Mixes to disk on a schedule (Day / 3 Days / Week / 2 Weeks / Month). Backups older than a month are deleted automatically. Click **Show in Finder** to browse existing backup files.

### Export Backup

Click **Export Backup…** to save your console settings, channel/aux setup, and My Mixes to a single file you choose the location for. Useful before an app update, or to move your whole setup to a new computer.

### Import / Restore

Click **Choose Backup File…** to restore from a previously exported (or automatic) backup file.

> **Import replaces your current console settings, channel/aux setup, and My Mixes.** It does **not** affect Ear Scenes, which always start fresh on launch regardless of any backup.

### Reset Layout & Icons

Click **Reset Layout & Icons…** to clear all channel groups, icon assignments, and label overrides, restoring the Channels tab to its default state.

> This does **not** affect console network settings, aux visibility, or saved Ear Scenes/My Mixes — only the Channels tab's cosmetic layout.

---

## 23. OSC Log Tab — Live Traffic & Recording

Settings → **OSC Log** shows a live terminal of every OSC message flowing between JPMixer and the console while this window is open.

- **← in** (from the desk) and **→ out** (to the desk) messages are colour-coded
- Type in the **Filter by address…** box to narrow the log to matching addresses
- **Pause** freezes the display without stopping capture; **Clear** empties it
- The log is kept in memory only — closing the Settings window or restarting JPMixer clears it

### Recording to a File

Click **Start Logging** to begin writing all OSC traffic to a text file on disk — useful for sending a trace to support, or reviewing exactly what happened during a show after the fact. Click **Show Logs Folder** to open the folder where recordings are saved. Click the button again (now labelled to stop) to end the recording.

---

## 24. Demo Mode

Demo Mode lets you explore the entire JPMixer UI — mixer, Monitor View, Console Controller, Devices View, everything — with realistic simulated channel and aux data, **without a DiGiCo console connected at all**. Nothing is sent to hardware; all fader moves stay local to JPMixer.

This is useful for:
- Learning the app before your first real show
- Demoing JPMixer to a client, band, or venue
- Testing a new phone or tablet's connection before doors open

### Enabling Demo Mode

1. Open Settings → **Setup** tab
2. Scroll to **Demo / Simulate** → enable **Simulate console (no desk connection)**
3. Click **Save & Apply**

The server starts with fake channel names, aux buses, and plausible starting levels. Turn the toggle off and Save & Apply again to return to normal console connection.

---

## 25. Diagnostics & Event Log

JPMixer keeps a live log of internal server events — connections, disconnections, ping timeouts, session changes, and more.

> **Diagnostic endpoints are localhost-only.** For security, `/api/events`, `/api/osc-all`, `/api/osc-cache`, and `/api/osc-clear` only respond to requests from the same machine running JPMixer — not from musicians' phones or other devices on the network, even though they're on the same WiFi. Open them in a browser **on the Mac/PC running JPMixer itself.**

### Viewing the Event Log

While the server is running, open a browser **on the JPMixer machine** and go to: `http://localhost:8080/api/events`

The page auto-refreshes every 3 seconds and shows the last 100 events with timestamps and detail.

### OSC Address Inspector

To see every OSC address the desk has sent since the server started: `http://localhost:8080/api/osc-all`

This is useful for verifying Console Controller addresses — move a fader on the desk and look for the address it sends back.

> **Clearing the tracker requires a POST request**, not a plain browser visit — for example, from a terminal: `curl -X POST http://localhost:8080/api/osc-clear`. This resets the list so you can isolate new messages.

### Common Event Types

| Event | What it means |
|-------|---------------|
| `client-connect` / `ws-connect` | A browser device connected to the mixer |
| `ws-disconnect` | A browser device disconnected |
| `ping-timeout` | A device didn't respond to pings within 75 seconds — connection terminated |
| `session-change` | The console sent a session change notification; JPMixer is reloading console metadata |
| `session-reload` | Cache cleared and metadata reload started after session change |
| `metadata-loaded` | All console metadata loaded; server is fully live |
| `scene-save` | A musician saved an Ear Scene |
| `scene-recall` / `scene-recall-manual` | A scene was found and applied to the console |
| `scene-skip` | Scene recall was skipped — shows whether recall is disabled or no scene was saved for that snapshot name |
| `preset-save` | A musician saved a My Mix |
| `http-error` | The web server failed to (re)start, most often because the port is already in use |

> **Diagnosing scene recall issues:** A `scene-skip` entry will tell you exactly why recall was skipped — either auto-recall is disabled, or it will show the snapshot name received vs the names saved. This makes name mismatch easy to spot.

---

## 26. Troubleshooting

### Console status shows Offline
- Check the console IP address is correct in Settings → Setup
- Confirm the DiGiCo console has OSC enabled and the send/listen ports match both sides
- Make sure JPMixer and the console are on the same network segment
- Try stopping and restarting the server from the Setup tab

### Mixer page won't load on a phone
- Confirm the phone is on the same WiFi as the Mac/PC
- Double-check the IP address shown in Settings → Setup under "This Mac's IP"
- Make sure the server is running
- Try opening in Safari on iPhone — Chrome on iOS may behave differently

### Faders move on screen but don't affect the console
- The Console status pill in Settings → Setup must be green
- Confirm the correct aux numbers in the Auxes tab match your DiGiCo session
- Verify the desk's OSC send port and receive port aren't swapped

### Console Controller faders don't move the desk
- Check `/api/osc-all` (from the JPMixer machine — see Section 25) after moving a fader on the desk; verify the address your firmware sends matches what JPMixer expects
- Confirm you are using the DiGiCo Pad external control protocol on the desk (not the standard OSC mode)

### Ear scenes not recalling automatically
- Enable **Auto-recall scenes on snapshot change** in Settings → Backup — it is off by default
- Confirm a scene is saved for that snapshot — the ☰ → Ear Scenes menu shows **Delete Ear Scene** (instead of Save) when one exists
- Check the snapshot name is showing in the snapshot bar before you save — if it shows "—" the name hasn't loaded yet
- Names are case-sensitive and must match exactly including spaces
- Open `/api/events` (from the JPMixer machine) and look for `scene-skip` entries

### A musician's faders are locked and they can't move them
- This is expected once an Ear Scene is saved for the live snapshot — tap the status banner under the snapshot name to unlock
- If they want to edit a *different* snapshot's saved mix instead, use ☰ → Ear Scenes → Browse Ear Scenes (Section 14) rather than unlocking the live one

### A musician's Ear Scenes disappeared
- This is expected — Ear Scenes intentionally reset every time JPMixer launches, so every show starts fresh
- If they wanted something permanent, that's what **My Mixes** (Section 13) is for — those never get wiped

### Devices View shows "Reconnecting…" for someone
- This reflects that device's real network connection, not JPMixer itself — check their WiFi signal at their position on stage
- If it stays red for more than ~15 seconds, the device will drop off the list entirely and they'll need to reload the mixer page

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
- View the event log at `/api/events` (from the JPMixer machine) to see what caused the disconnect

---

*JPMixer v1.7.3 · Built for DiGiCo SD / Quantum · Mac + Windows*
