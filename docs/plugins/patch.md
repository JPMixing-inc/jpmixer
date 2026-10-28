# Patch

**A JPMixer Original plugin** · version 1.1.2 · needs JPMixer 2.0.13 or later

Patch screens for your stage boxes. Every box on your stage is drawn to scale. Tap a socket to name it and choose the channel, control group or mix it's patched to. Anyone on the team can open it on a phone, iPad or computer, and every screen shows and edits the same patch.

<p align="center"><img src="img/patch-stage-box.png" alt="A Waves IONIC 24 stage box in Patch, every socket named, with 48V marks" width="900" /></p>

<sub>Pictures on this page: an LV1 session imported into Patch.</sub>

## What it does

- **Your boxes, drawn as they are.** DiGiCo racks (D-Rack, D2-Rack, DQ-Rack, MQ-Rack, SD-Rack, SD-MiNi, SD-Nano and the 4REA4 boxes), Waves SoundGrid boxes for eMotion LV1 (IONIC 16 and 24, DiGiGrid IOX and IOS), Allen & Heath boxes for dLive (the CDM32, CDM48 and CDM64 MixRacks and the DX168), and the back of the console itself: every current DiGiCo, the LV1 Classic and the dLive S7000. A generic box can have any number of inputs and outputs.
- **Dante and network devices.** Something with no sockets to plug into (a Dante card, a playback computer, MADI, USB or SoundGrid) is drawn as a panel of tiles, one per channel, each showing its name and the console channel it goes to. On a phone there are 4 to a row, so the names stay readable.
- **Tap a socket to patch it.** Give it a name and choose what it's patched to. The lists use your console's own channel and mix names. With a mouse, hover over a socket to see what's on it.
- **Import a session.** Choose an LV1 session (`.emo`), a DiGiCo session (`.ses`) or a dLive show (`.tar.gz`), and its stage boxes come in with every socket named and patched. The file is read in your browser; nothing is sent anywhere.
- **48V at a glance.** Mark a mic input as needing 48V; an import marks it where the session has 48V on. On a DiGiCo or LV1, JPMixer also hears each channel's 48V from the desk, and warns when a socket needs 48V that's off at the desk.
- **Checks.** A channel patched from two sockets is marked in red.
- **A patch sheet** to print, or download as a spreadsheet (CSV).
- **Lock the patch** to make it view-only during a service.
- **A summary on FOH Home**, if you want one.

<p align="center"><img src="img/patch-socket.png" alt="A socket open in Patch: its name, the channel it's patched to, and 48V" width="900" /></p>

## Install it

1. In JPMixer, open **Settings → Plugins**.
2. Under **Find plugins**, click **Install** next to **Patch**.
3. Select **Patch** under Plugins in the sidebar, turn it on, and click **Save & Apply**.
4. Open **Patch** from the Home pages list on any phone, iPad or computer, or click **Open Patch** in its Settings tab.

It's marked **JPMixer Original**, as long as it's the approved copy.

<p align="center"><img src="img/patch-settings.png" alt="Settings → Plugins → Patch: on, Lock the patch, and the FOH Home summary" width="760" /></p>

## Add your stage boxes

- **From a session:** click **Import session** and choose the session file.
  - **LV1:** every stage box in the session is added, drawn as itself, with stereo channels across two sockets. Importing again updates those boxes and keeps your own notes and 48V marks.
  - **DiGiCo:** the console's own I/O comes in as the back of that console. A session doesn't say which rack is on each port, so the preview asks (a DQ-Rack by default). Channels from playback computers and other Dante devices go on a Dante or network device of their own, or can be left off.
  - **dLive:** choose a show saved on the dLive or in dLive Director. Inputs and outputs both come in. The MixRack is drawn as the smallest CDM that holds every socket the show uses; if yours is bigger, or a DM, choose the CDM with the same sockets in the preview. The surface's own sockets and AES go on the back of an S7000, and each DX expander on a DX168. Each I/O port's channels (Dante, say) go on a network device of their own, with a note saying which port channel each is. An output gets the mix, direct out or tie line patched to it, named as in the show; a direct out or a mono aux is also patched to that channel or aux in JPMixer, and anything else (a stereo aux, a matrix, a tie line) shows as Patched on the console. Anything without a socket to go on (the surface's USB recording, an input fed from a mix) is listed in the preview.
- **By hand:** click **Add stage box**, choose the model, and patch each socket.

<p align="center"><img src="img/patch-console.png" alt="The back of an LV1 Classic in Patch" width="900" /></p>

## On a phone

Each box fits the screen; zoom in to tap a socket.

<p align="center">
  <img src="img/patch-phone.png" alt="Patch on a phone" width="300" />&nbsp;&nbsp;
  <img src="img/patch-foh-card.png" alt="The Patch summary card on FOH Home" width="360" />
</p>

## What it can do

- Show a page of its own, listed with the Home pages.
- See channel, control group and mix names, each channel's 48V, and whether the console is connected.
- Show a card on FOH Home.

It can't read JPMixer's settings or passwords, and it never changes anything on the console.

## Updating and removing

When a new version is out, a red dot appears next to **Plugins** in the sidebar, and its row has an **Update** button. Your patch is kept. To remove it, click **Remove…** on its row, in its tab, or in Find plugins.

---

[All plugins](README.md) · [User Manual](../MANUAL.md) · [JPMixer on GitHub](../../README.md)
