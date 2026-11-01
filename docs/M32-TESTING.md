# Testing JPMixer on a Midas M32 or Behringer X32

Thank you for trying JPMixer on your console. M32 and X32 support is new: it was built from the published protocol, and your console is one of the first it has met. This page says how to set it up, what to try, and how to send us what happened.

It works the same on every M32 (M32, M32R, M32C) and every X32.

## Before you start

- JPMixer 2.0.19 or later on a Mac or Windows computer.
- The computer and the console on the same network. The console's IP address is under **Setup → Network** on the console.
- Try it at a rehearsal or on a spare evening first, not in the middle of a service.

## Set it up

1. In JPMixer, open **Settings → Console**.
2. Set **Console Type** to **Midas M32 / Behringer X32**.
3. Enter the console's IP address in **Console IP Address**. Leave **M32 Port Override** at 0.
4. Set **Channels** (up to 48: 1–32 are the inputs, 33–40 the aux ins, 41–48 the FX returns) and **Auxes** (up to 16: the mix buses).
5. Select **Save & Apply**. The Console status at the top should say connected within a few seconds.

Nothing needs switching on at the console: JPMixer connects the way M32-Edit and the M32 Mix app do.

## Record what happens

Before you start testing:

1. Open **Settings → OSC Log** and select **Start Logging**.
2. Test (see below).
3. Select **Stop Logging**, then **Show Logs Folder**. The file is named `m32-log-` and the date.

The log has what JPMixer sent the console and what the console sent back. It has no passwords, but it does have your channel and mix names.

## What to try

Please try each of these and note what happened, especially anything that didn't do what you expected.

1. **Names.** Do the channel and mix names on a phone match the console's?
2. **A phone fader.** Move a channel up and down on a phone. Does the console's send move with it, smoothly, and does the phone fader stay where you left it?
3. **The console's fader.** Move a send on the console (or in M32-Edit). Does the phone follow?
4. **Mute and solo on a phone.** Mute a channel, then unmute it. Solo one, then un-solo. Do the console's sends switch off and back on? A send you'd switched off on the console should stay off after an unmute.
5. **A stereo mix.** If two mix buses are linked on the console, they should appear as one mix with pan. Do pan and mute work on both sides?
6. **Scenes.** Recall a scene on the console. Does the phone show the new scene number? If you've saved an Ear Scene for that scene (with automatic recall on), was it applied?
7. **The Console Controller.** Open it from Settings → Pages. Do the channel, mix and DCA faders, mutes and solos match the console and move it? Do the ‹ › buttons step through scenes?
8. **Start-up.** After JPMixer connects, how long until every mix shows its levels on a phone?
9. **Unplug and plug back.** Unplug the console's network cable for 10 seconds, then plug it back in. Does JPMixer say it lost the console, and reconnect by itself? Do muted sends stay muted?

## Send it to us

Send the log file, your console's model (and its firmware version, if you know it), and your notes on the list above. Open a [new issue on GitHub](https://github.com/JPMixing-inc/jpmixer/issues/new) and attach the log, or send it to whoever gave you JPMixer.

If something goes wrong during a test, switch **Console Type** back to what you had, or quit JPMixer: the console keeps working on its own. When JPMixer stops, it switches back on every send it had muted.
