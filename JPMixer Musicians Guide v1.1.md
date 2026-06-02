# JPMixer
## MUSICIAN GUIDE
### Your Personal Monitor Mix — In Your Hands

Control your own stage monitor or IEM mix from your iPhone or iPad. No app to download. No cables. Just open Safari and dial in your sound.

**V1.1.0-BETA.1**

---

## CONTENTS

1. Getting Connected
2. Installing on Your Home Screen
3. Selecting Your Mix
4. Adjusting Your Levels
5. Mute & Solo
6. Saving Your Mix Per Song
7. If You Lose Connection
8. Tips for a Better Experience
9. Troubleshooting

---

## 1. Getting Connected

JPMixer works entirely in your web browser — no app to download from the App Store. All you need is your phone on the right WiFi network.

1. Connect your phone or tablet to the **stage WiFi network** — ask your monitor engineer for the network name and password
2. Open **Safari** on your iPhone or iPad
3. Type the mixer address into the address bar — your engineer will give you this (it looks like `http://192.168.x.x:8080`)
4. The JPMixer page loads — you're in

> **Use Safari.** JPMixer is built for Safari on iPhone and iPad. Chrome and other browsers will work but won't give you the best experience — some features like adding to your home screen won't work properly.

> **Can't reach the page?** Make sure your phone is on the stage WiFi, not your mobile data or a different network. The mixer only works on the same local network as the console.

---

## 2. Installing on Your Home Screen

You can save JPMixer to your iPhone home screen so it opens like a real app — full screen, no browser bar, and it remembers your mix. This is the best way to use it.

1. Open the mixer in Safari
2. Tap the **Share** button at the bottom of the screen — it looks like a box with an arrow pointing up
3. Scroll down in the share sheet and tap **Add to Home Screen**
4. Tap **Add** in the top right corner
5. The JPMixer icon appears on your home screen — tap it any time to open your mix

### Why add it to your home screen?

When you open JPMixer from your home screen icon it runs full-screen with no browser chrome — just your mix. More importantly, the connection stays alive even when your phone screen locks or you switch apps. When you come back, it reconnects instantly.

If you open it in Safari as a regular tab, iOS may suspend the connection when you switch away. From the home screen icon it behaves like a native app.

---

## 3. Selecting Your Mix

When you first open JPMixer you'll see the mix picker — a list of all the monitor mixes on the show. Each mix is one aux bus on the console (your wedge, your IEM, your side-fill, etc.).

Tap your name or your mix name to enter it. Your mix fills the screen and you're ready to go.

### Switching Mixes

Tap the mix name bar at the top of the screen at any time to go back to the picker and choose a different mix. This is useful if you're covering multiple positions or want to check someone else's mix.

> **Your mix is remembered.** Once you've selected a mix, JPMixer remembers it. Next time you open the app — even after closing it or losing WiFi — it goes straight back to your mix without you needing to tap anything.

---

## 4. Adjusting Your Levels

Each channel in your mix has a fader you can drag to set the level. The channel name and icon are shown at the left of each row.

### Moving a Fader

- Drag **right** to turn a channel up
- Drag **left** to turn a channel down
- The dB value updates live as you move it
- Dragging all the way left takes the channel to silence (–∞ dB)

| Control | Location | What it does |
|---------|----------|-------------|
| Mix name bar | Top centre | Shows your current mix. Tap to switch to a different mix. |
| Connection dot | Top right | Green = live connection to the console. Grey = reconnecting. |
| PAN button | Top right | Tap to reveal pan controls alongside each fader for left/right positioning. |
| Save button 💾 | Top right | Saves your entire mix for the current song snapshot. See Section 6. |

> **Your changes go straight to the console.** Every fader move is sent to the DiGiCo console in real time. There is no "apply" button — what you hear is what you set.

---

## 5. Mute & Solo

Every channel row has two small buttons on the right side: **M** and **S**. These let you quickly silence or isolate channels in your mix without moving any faders.

### Mute — M

Tap **M** to mute a channel. The channel goes to silence and the row dims. The button lights red while active.

Tap it again to unmute — the fader snaps back to exactly where it was before you muted. Your levels are never lost.

### Solo — S

Tap **S** to solo a channel. Every other channel in your mix goes silent — only the soloed channel plays. The button lights amber. Tap again to release the solo and bring everything back.

You can solo multiple channels at once — all soloed channels play, everything else is silent.

> **Good for dialling in one instrument.** Solo is useful when you want to set the level of one specific channel without everything else competing. Solo it, set the level, then release.

> **This only affects your mix.** Muting or soloing a channel only affects your own monitor mix. It has no effect on FOH, other musicians' mixes, or the main PA. You can't accidentally mute something for the audience.

---

## 6. Saving Your Mix Per Song

JPMixer can save a snapshot of your entire mix for each song — so when the engineer recalls a snapshot on the console, your mix changes automatically to match what you saved for that song. No tapping needed during the show.

### How to Save a Mix for a Song

1. Make sure the **song name** appears in the bar just below the mix name — this is the current console snapshot. If it shows "—" wait a moment for it to load.
2. Set your mix exactly the way you want it for that song
3. Tap the 💾 **Save** button — a confirmation message appears at the bottom of the screen showing which snapshot it was saved for
4. Repeat for each song you want to save a mix for

Once saved, the button changes to 🗑 — tap that if you want to delete the saved mix for that song.

### During the Show

When the engineer fires a snapshot, JPMixer automatically pushes your saved mix to the console and your faders move to the saved positions. You don't need to do anything — just play.

> **Check with your engineer first.** Auto-recall needs to be enabled by the engineer in JPMixer settings. If your mixes aren't recalling automatically during the show, let your monitor engineer know and they can turn it on.

> **Save during soundcheck.** The best time to save your mixes is during soundcheck. Go through each song's snapshot with the engineer, dial in your mix for each one, and save. By showtime your mixes are locked in.

---

## 7. If You Lose Connection

If your phone loses WiFi or goes to sleep, JPMixer reconnects automatically as soon as the connection is restored. You don't need to refresh the page or re-select your mix — it picks up exactly where it left off.

### What the Overlays Mean

| Overlay / Indicator | What it means |
|--------------------|---------------|
| "Connecting to console…" | JPMixer is starting up, wait a few seconds |
| "Reconnecting…" | Brief WiFi drop, reconnecting automatically |
| Grey connection dot | No connection right now, trying to reconnect |
| Green connection dot | Live and connected |

> **If it stays on "Reconnecting…" for more than 30 seconds:** Check that your phone is still on the stage WiFi — it may have switched to mobile data. Toggle WiFi off and back on in your phone settings and it should reconnect within a few seconds.

---

## 8. Tips for a Better Experience

- **Always use Safari on iPhone/iPad** — Chrome and other iOS browsers don't support all the features JPMixer uses
- **Add it to your home screen** — keeps the connection alive when your screen locks, much more reliable than a browser tab
- **Stay on stage WiFi** — if your phone switches to mobile data the mixer will disconnect. Keep WiFi on and avoid areas with poor WiFi coverage
- **Don't force-close the app mid-show** — if you swipe it away on iOS, it will need to reconnect when you reopen it. Leave it running in the background instead
- **Save your mix before the show, not during** — saving a scene sends data to the console which is fine, but it's cleaner to do it during soundcheck
- **Brightness** — turn your screen brightness up in dim stage lighting so you can read the faders clearly

---

## 9. Troubleshooting

### The page won't load
- Make sure you're on the stage WiFi, not mobile data
- Double-check the address your engineer gave you — it needs to be typed exactly including the port number (e.g. `:8080` at the end)
- Ask your engineer to confirm the server is running

### I moved a fader but didn't hear anything change
- Check the green connection dot — if it's grey you're not connected and moves aren't being sent
- Make sure you have the right mix selected — tap the mix name bar to confirm
- Ask your engineer to check the console is connected (green dot in their settings)

### My saved mixes aren't recalling automatically
- Ask your monitor engineer to enable **Auto-recall scenes on snapshot change** in JPMixer Settings → General
- Make sure you saved your mix while the correct song name was showing in the snapshot bar — if it showed "—" when you saved, the save may not have attached to the right snapshot

### The faders jumped to wrong positions
- This can happen if a snapshot fired and you have a saved mix for it — that's expected behaviour
- If it happens unexpectedly, check with your engineer whether auto-recall is enabled

### The mixer is showing "Reconnecting…" during the show
- Check your WiFi signal — move closer to the access point if possible
- Toggle WiFi off and back on on your phone
- If you added JPMixer to your home screen, close and reopen the app — it will reconnect in seconds

### I accidentally muted everything
- If you hit **Solo** on a channel that has no signal, your mix will appear silent — tap the lit S button to release the solo
- Check for any lit **M** buttons — tap them to unmute

---

*JPMixer v1.1.0-beta.1 · Musician Guide · For questions speak to your monitor engineer*
