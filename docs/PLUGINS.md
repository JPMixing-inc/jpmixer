# JPMixer plugins

A plugin adds something to JPMixer that it doesn’t do itself. Today a plugin can:

- put cards on **FOH Home**, or on every Home page, which can be moved and resized like any other card, with buttons and a text box that reach the plugin (more than one card, buttons, and other Home pages: JPMixer 2.0.19 and later);
- read the console’s channel, mix and control group names, and whether the console is connected;
- read the Planning Center plan, what’s live and what’s next;
- have a page of its own, listed with the Home pages (JPMixer 2.0.13 and later);
- have its own tab of settings in Settings, listed under **Plugins** in the sidebar.

Plugins can’t change anything on the console yet.

A plugin is a folder holding a `plugin.json` file and some JavaScript. A complete example is [`plugins/console-check`](../plugins/console-check), and [`docs/plugin-template`](plugin-template) is a starter to copy. [`plugins/patch`](../plugins/patch) is a bigger one, with a page of its own.

## Installing a plugin

Everything to do with plugins is in **Settings → Plugins**. Each plugin has its own switch, and a new one starts off. (Up to 2.0.14 there was also an **Allow plugins** switch for all of them; updating with it off turns off each plugin that isn't JPMixer's own, once.)

**JPMixer's own plugins** are marked *JPMixer Original*, as long as their files are the approved ones: Patch, and from 2.0.14 Shure wireless, Smaart SPL and Companion buttons. Those three used to be built in. Each installs from **Find plugins** (from the copy that comes with JPMixer, so no internet is needed) and then gets its own tab under **Plugins** in the sidebar, set up as before. Removing one turns it off and keeps its settings. Someone updating who already used one gets its plugin by itself, with their settings, even with no internet.

- **From the approved list:** **Find plugins** lists the plugins that have been reviewed for JPMixer, each with what it can do. Select **Install**.
  - JPMixer downloads it from GitHub and checks every file against the approved copy.
  - When a newer approved version comes out, the button says **Update**, and the plugin's row under Your plugins gets an **Update** button.
  - The list is fetched when you open the Plugins page or select Refresh. While any plugin is installed, JPMixer also looks a minute after it starts and then every 6 hours, and puts a red dot next to **Plugins** in the sidebar when one has an update.
- **From a file:**
  - **Import plugin…** takes a `.jpmplugin` or `.zip` file.
  - You can also drop the file anywhere on the Plugins page, or double-click a `.jpmplugin` in Finder or Explorer.
  - Plugins installed this way are labelled **Not reviewed**. Only install them if you trust whoever made them.
- **From a folder:** **Import folder…**, for people making plugins.

Before anything is installed, JPMixer shows the plugin's name, who made it and what it can do. A new plugin starts off. Its settings appear under **Plugins** in the sidebar, where you turn it on, then select **Save & Apply**.

### Trying the example

1. Under **Find plugins**, install **Console check**.
2. Open **Console check** under Plugins in the sidebar, turn it on, then select **Save & Apply**.
3. Open FOH Home. A **Console check** card shows whether the console is connected, and lists its mixes.

## Making a plugin

You don't need to know much JavaScript to make a plugin, and an AI assistant can write most of it for you (see "Making a plugin with an AI assistant" below).

1. **Copy the starter.** Copy the [`docs/plugin-template`](plugin-template) folder from this repository and rename it. It has a `plugin.json` and a commented `index.js` that puts a card on FOH Home.
2. **Name it.** In `plugin.json`, change `id` (lowercase, dashes, unique), `name`, `description` and `author`.
3. **Import it.** In JPMixer, open **Settings → Plugins**, select **Import folder…** and choose your folder.
4. **Turn it on.** Open your plugin under **Plugins** in the sidebar. Turn it on, tick **Restart when its files change**, then select **Save & Apply**.
5. **Edit and save.** Edit `index.js` (and `plugin.json`) in the plugins folder. **Open plugins folder** shows where it is. Every time you save, the plugin starts again with your changes. Anything it prints with `console.log()`, and any error, shows in the **Log** on its tab.

Import folder… copies your folder into JPMixer's plugins folder, so edit the copy there, or import again after changing the original.

### Making a plugin with an AI assistant

An AI assistant (ChatGPT, Claude, Copilot and others) can write a plugin from this guide. This page tells it everything a plugin can do, and everything it can't, so give it the whole page.

1. Open the assistant, and paste in this whole guide, or give it this page's address: `https://github.com/JPMixing-inc/jpmixer/blob/main/docs/PLUGINS.md`.
2. Paste in this message, with your own idea in the middle:

```text
Using the JPMixer plugin guide above, write a complete JPMixer plugin.

What it should do: <describe it: what it reads or connects to, and what the FOH Home card should show>

Follow the guide exactly:
- Give me two files, plugin.json and index.js, in full.
- plugin.json needs an id, name, version, description, author, main, permissions and at least one setting.
- Ask only for the permissions it uses: card, console and/or planningCenter.
- Put anything I'd need to change (addresses, ports, passwords, options) in "settings", not in the code.
- Use only Node.js 20 built-ins (fetch, net, dgram, http, https), no npm packages unless I ask for one.
- Never read or write files outside jp.plugin.folder and jp.plugin.dataFolder, and don't start other programs.
- Catch every error, including from the network, so the plugin keeps running when a device is off. Show what's wrong on the card or with jp.status().
- Clean up timers and connections in jp.onStop().
```

3. Put the two files in a folder, and try it as in steps 3 to 5 above.
4. If something doesn't work, copy what the **Log** on the plugin's tab says and paste it back to the assistant.

Read through what the assistant wrote before you turn it on, the same as any plugin you didn't write yourself. Check what it connects to, and that it only does what you asked.

### Sharing it

A `.jpmplugin` file is a zip of the plugin's folder, renamed.

1. Zip the plugin's folder: on a Mac, right-click it and choose **Compress**; on Windows, choose **Send to → Compressed (zipped) folder**.
2. Rename the `.zip` to `<id>.jpmplugin`. A plain `.zip` imports just as well; the `.jpmplugin` name lets people double-click it.
3. The folder can be at the top of the zip, or be the only thing in it.

To have it listed for everyone under **Find plugins**, see "Getting your plugin approved" below.

## The folder

```
my-plugin/
  plugin.json   what the plugin is, what it asks to do, its settings
  index.js      the code
```

You can add other files, including a `node_modules` folder for npm packages, as long as they're plain JavaScript (see "What a plugin can't do").

JPMixer keeps its plugins in its own plugins folder. **Open plugins folder** in Settings shows it. On a Mac it's in `~/Library/Application Support/JPMixer/plugins`.

Installing copies the plugin there. You can also put a plugin's folder there yourself, then select **Reload plugins**.

## plugin.json

```json
{
  "id": "stage-clock",
  "name": "Stage clock",
  "version": "1.0.0",
  "description": "The time and the service countdown, on FOH Home.",
  "author": "Your name",
  "homepage": "https://example.com/stage-clock",
  "main": "index.js",
  "permissions": ["card", "planningCenter"],
  "card": { "title": "Clock" },
  "settings": [
    { "key": "host", "label": "Clock’s address", "type": "text", "placeholder": "192.168.1.70" },
    { "key": "port", "label": "Port", "type": "number", "default": 4000, "min": 1, "max": 65535 },
    { "key": "password", "label": "Password", "type": "password" },
    { "key": "seconds", "label": "Show seconds", "type": "checkbox", "default": true },
    { "key": "style", "label": "Style", "type": "select", "default": "big",
      "options": [{ "value": "big", "label": "Big" }, { "value": "small", "label": "Small" }] }
  ]
}
```

| Field | |
|---|---|
| `id` | **Required.** 2–30 lowercase letters, numbers and dashes, starting with a letter. It must be unique; adding a plugin with the same id replaces the one already there. |
| `name` | The name of its tab under Plugins in the Settings sidebar, and in the Plugins list (up to 40 characters). |
| `version`, `description`, `author` | Shown on its tab. `description` is also the line under the tab's title. |
| `homepage` | An `https://` address. Settings shows a Website button that opens it. |
| `main` | The JavaScript file to run, inside the folder. Defaults to `index.js`. |
| `permissions` | What the plugin uses from JPMixer (see below). |
| `card.title` | The card's heading on FOH Home. Defaults to `name`. |
| `card.homePages` | `"all"` puts the card on every Home page (ProPresenter, Lighting, Switcher, Producer and those a church adds), not only FOH Home. JPMixer 2.0.19 and later. |
| `card.size` | Its starting size on the pages: `"standard"` (the default), `"tall"`, `"wide"` or `"large"` (half the page wide, tall enough for a controller). Arrange page can change it. JPMixer 2.0.19 and later. |
| `cards` | Several cards instead of one: up to 6, each `{ "id", "title", "homePages", "size" }`. `id` is up to 12 lowercase letters, numbers and dashes, starting with a letter, and the plugin's id and a card's id together can be up to 29 characters. JPMixer 2.0.19 and later. |
| `page.title`, `page.entry` | With the `page` permission: the page's name on the Home pages list (defaults to `name`), and its HTML file inside the folder (defaults to `page/index.html`). |
| `page.listed` | `false` keeps the page off the Home pages list: it opens from its link, or from its tab in Settings. JPMixer 2.0.16 and later. |
| `minJPMixer` | The oldest JPMixer version it works with, like `"2.1.0"`. Find plugins won't offer it to older versions. |
| `settings` | **Required: at least one field**, up to 24. They make the plugin's own tab under Plugins in Settings, and reach the plugin as `jp.settings`. |

### Permissions

The person turning the plugin on sees this list before it's turned on.

| Permission | Lets the plugin |
|---|---|
| `card` | Show cards on the Home pages, with buttons that reach the plugin (`jp.card`) |
| `console` | See channel, control group and mix names, each channel's 48V, and whether the console is connected (`jp.console`) |
| `planningCenter` | See the plan’s title, what’s live and what’s next (`jp.planningCenter`) |
| `page` | Show a page of its own, listed with the Home pages (`jp.page`; see "A page of its own"). JPMixer 2.0.13 and later. |
| `timers` | Show its running timers at the top of every Home page and on the Green Room screen (`jp.timers`). JPMixer 2.0.19 and later. |

A plugin that uses something it didn't ask for gets an error.

`integration` is JPMixer's own: it lets the official Shure, Smaart and Companion plugins feed JPMixer's pages and Settings. Another plugin that asks for it isn't loaded.

`faders` and `companion` are JPMixer's own too: they let the official Custom Pages plugin move the console's channel and control group faders and mutes (on DiGiCo, dLive and LV1), and show Companion buttons through the Companion buttons plugin, only while its files are the approved ones. Another plugin that asks for either isn't loaded.

### Settings fields

Every plugin needs at least one setting. A plugin with none won't load, and the Plugins tab says why. Each plugin gets its own tab, named after it and listed under **Plugins** in the sidebar, much like Smaart and Shure wireless have theirs. The tab shows:

- the plugin's on/off switch;
- what it can do;
- these fields;
- its status line and log.

Each field has a `key` (letters, numbers and `_`), a `label` and a `type`. Each can also have a `default`, a `placeholder` and `help`, a line of text shown under the field.

| `type` | Shows | Value |
|---|---|---|
| `text` | a text box | string |
| `password` | a hidden text box | string |
| `number` | a number box; `min` and `max` are optional | number |
| `checkbox` | a switch | `true` / `false` |
| `select` | a menu; `options` lists `{ "value", "label" }` | string |

Saving the settings with **Save & Apply** stops the plugin and starts it again with the new values. A plugin never has to watch for settings changes.

## The code

`main` exports one function. JPMixer calls it with `jp` when the plugin starts. The function can be `async`.

```js
module.exports = async (jp) => {
  jp.card.show({ value: 'Hello', label: jp.settings.host });
};
```

### `jp`

| | |
|---|---|
| `jp.plugin` | `{ id, name, version, folder, dataFolder }` |
| `jp.settings` | Its settings, as `{ key: value }` |
| `jp.card.show(card, id)` | Sets what's on a card (see "The card"). `id` is which of its `cards`; left out, its first or only one. |
| `jp.card.clear(id)` | Takes everything off that card. The card is hidden until it shows something again. |
| `jp.timers.show(list)` | Its running timers, at the top of every Home page (under the header) and on the Green Room screen (next to the clock): `[{ name: 'Countdown', time: '4:57', over: false }]`, up to 8. `time` is shown as written; `over: true` shows it in red (past zero). Show `[]` when none is running, and nothing shows. JPMixer 2.0.19 and later. |
| `jp.card.image(name, data, { card, type })` | A picture for the card's `images` entry `name`: a Buffer of a JPEG, PNG or WebP (`type`, `'image/jpeg'` by default) of up to 600 kB, or `null` to take it away. `card` is which of its cards. The pages fetch each picture once, when it changes. JPMixer 2.0.19 and later. |
| `jp.card.onPress(fn)` | Calls `fn({ card, button, text })` when someone uses a button or the text box on one of its cards: `card` is the card's `id` (`''` for a plugin's only card), `button` the button's or text box's `id`, and `text` what was typed. JPMixer 2.0.19 and later. |
| `jp.status(text, level)` | One line on the plugin's tab in Settings. `level` is `'ok'` (the default), `'warn'` or `'error'`. |
| `jp.console.get()` | A promise of the console's state (see below) |
| `jp.console.onChange(fn)` | Calls `fn(state)` when that changes. JPMixer checks about every 3 seconds. |
| `jp.planningCenter.get()` | A promise of the plan (see below) |
| `jp.planningCenter.onChange(fn)` | Calls `fn(plan)` when that changes. JPMixer checks about every 15 seconds. |
| `jp.page.handle(name, fn)` | Answers its page's call `name` with whatever `fn(body, from)` returns (or a promise of it). `from.local` is `true` when the page was opened on the JPMixer computer (from JPMixer, or from its tab in Settings), and then `from.base` is the address phones use, as Settings shows it. Use it for anything only the engineer should do. JPMixer 2.0.16 and later; earlier versions pass only `body`. See "A page of its own". |
| `jp.onSettings(fn)` | Takes new settings without a restart: when they change in Settings, JPMixer calls `fn(settings)` (and `jp.settings` has them) instead of stopping and starting the plugin. Without it, a settings change restarts the plugin. JPMixer 2.0.14 and later. |
| `jp.onStop(fn)` | Runs `fn` before the plugin is stopped, for closing connections. It has about a second and a half. |

`console.log()` and `console.error()` lines show in the **Log** on the plugin's tab in Settings, which keeps the last 200 lines.

### The card

```js
jp.card.show({
  value: '12:34',          // the big text
  unit: 'min',             // small text after it
  label: 'until 9:00 AM',  // a line under it
  color: 'green',          // the big text's color: green, yellow, red, blue or gray
  rows: [                  // up to 20 rows: label on the left, value on the right
    { label: 'Battery', value: '80%', color: 'green' },
    { label: 'Countdown', value: '05:00', buttons: [{ id: 'start', label: 'Start' }] },  // up to 3 small buttons of its own (2.0.19)
  ],
  text: 'Verse 1\nLine two', // a block of text, line breaks kept (up to 600 characters)
  buttons: [               // up to 24 buttons; a press calls jp.card.onPress
    { id: 'next', label: 'Next', color: 'blue' },          // id: letters, numbers and _ . : -
    { id: 'live', label: 'Live', active: true },           // active: drawn as on
    { id: 'off', label: 'Off', disabled: true },           // disabled: can't be pressed
    { id: 'open', label: 'Open', page: true },             // page: opens the plugin's own page instead of pressing (2.0.21)
  ],
  input: { id: 'msg', placeholder: 'Message', button: 'Send' },  // a text box with its button
  images: [                // up to 4 pictures side by side (2.0.19), sent with jp.card.image
    { name: 'current', label: 'Now', caption: 'Verse 1' },
  ],
  sections: [              // up to 6 parts with a heading each (2.0.19); each can have
    { title: 'Controls', buttons: [{ id: 'next', label: 'Next' }] },  // text, rows, images, input, buttons
  ],
  note: 'Updated just now', // small text at the bottom
  title: 'Clock',          // changes the card's heading
});
```

- Every part is optional.
- Everything is shown as plain text; HTML isn't read.
- Calling `show` again replaces the whole card.
- About four updates a second reach the Home pages, and each page checks every second. Each update always carries the latest card.
- Only a button (or text box) the card is showing at that moment can be pressed, and not a disabled one.
- A button with `page: true` opens the plugin's own page in a new tab, and isn't sent to `jp.card.onPress`. It needs the `page` permission; without it the button isn't shown. JPMixer before 2.0.21 sends it to `jp.card.onPress` like any other button.
- On FOH Home, with an FOH code set, the cards and their buttons need the code. The other Home pages are open to the whole team, so a card with `"homePages": "all"` can be used by anyone who can open one. Buttons, text, `text` and `input`: JPMixer 2.0.19 and later.

### `jp.console.get()`

```js
{
  type: 'digico',          // digico, dlive, klang, wing, lv1 or m32
  demo: false,             // demo mode's made-up console
  running: true,           // JPMixer's server is running
  connected: true,         // the console is connected
  channels: [{ number: 1, name: 'Kick', phantom: true }, …],   // phantom: the channel's 48V (DiGiCo and LV1, once the desk has reported it)
  mixes: [{ number: 1, name: 'Vocal 1' }, …],
  groups: [{ number: 1, name: 'Drums' }, …]   // control groups (DCAs on dLive and LV1); empty while the server is off
}
```

Each channel and mix name is the one every page shows. That's a name typed in JPMixer, else the console's own, else the last one the console reported. `phantom` is left out for a channel whose 48V JPMixer hasn't heard from the desk (on LV1, a channel whose input isn't a preamp), and on consoles other than DiGiCo and LV1.

### `jp.planningCenter.get()`

```js
{
  connected: true,         // Planning Center is set up in JPMixer
  plan: { title: 'Sunday', seriesTitle: 'Hope', date: '2026-11-01T09:00:00Z' } | null,
  live: {                  // null when nothing is live
    now:  { title: 'Welcome', type: 'item', length: 300, keyName: null },
    next: { title: 'Song 1', type: 'song', length: 240, keyName: 'G' } | null,
    startedAt: '2026-11-01T14:02:11.000Z'
  } | null,
  nextServiceAt: '2026-11-01T15:00:00.000Z' | null   // null while a service is on
}
```

- `length` is in seconds.
- Plugins never see people's names or photos.

## A page of its own

With the `page` permission, a plugin can have a page: HTML, scripts, styles and images in its folder (`page/` unless `page.entry` says otherwise). JPMixer serves it at `/p/<id>/`, and lists it with the Home pages, so anyone on the network can open it on a phone, tablet or computer. Its tab in Settings has a button that opens it.

The page talks to its plugin, and only to its plugin. It calls a name with some JSON; the plugin answers with `jp.page.handle`:

```js
// index.js (the plugin)
module.exports = (jp) => {
  let notes = [];
  jp.page.handle('load', () => ({ notes }));
  jp.page.handle('add', (body) => { notes.push(String(body.text).slice(0, 200)); return { notes }; });
};
```

```js
// page/app.js (the page)
// JPMixer puts the page's token in its <head> as it serves it
const TOKEN = document.querySelector('meta[name="jpmixer-token"]').content;
async function call(name, body) {
  const res = await fetch(`/plugin-api/my-plugin/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-JPMixer-Token': TOKEN },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error);
  return data.result;
}
const { notes } = await call('load');
```

- **Errors:** an error thrown in a handler goes back to the page as `data.error`, and doesn't stop the plugin. A call that isn't answered in 10 seconds fails.
- **Keeping things:** the page shows; the plugin keeps. Save in `jp.plugin.dataFolder`, so every screen that opens the page sees the same thing.
- **Size:** a call's JSON can be up to 512 KB.
- **Sandboxed:** the page is walled off from JPMixer's own pages. It can't read them or their cookies, and it has no browser storage (`localStorage` throws). It can't load scripts or styles from the internet either: put everything in its folder.
- **Other websites are refused:** they can't call a plugin through someone's browser. Each call needs the `X-JPMixer-Token` header with the token JPMixer writes into the page's HTML (`<meta name="jpmixer-token">`). Other sites can't read it, and each plugin's page has its own, so one plugin's page can't call another plugin. Your page's HTML needs a `<head>`.
- **Requirements:** plugin pages need JPMixer 2.0.13 or later. Set `"minJPMixer": "2.0.13"` in `plugin.json`.

## What a plugin can and can't do

- **Separate process:** each plugin runs in its own process. If it crashes, JPMixer and the console carry on.
  - JPMixer starts it again after a short pause.
  - After 5 crashes in 10 minutes it stays stopped until it's turned off and on again, or **Reload plugins** is selected.
  - An error the plugin doesn't catch, including a rejected promise nobody handles, counts as a crash.
- **Files:**
  - It can read files in its own folder.
  - It can read and write files in `jp.plugin.dataFolder`, which is kept when the plugin is updated.
  - It can't read or write anywhere else. That includes JPMixer's settings and passwords.
- **No other programs or native code:** it can't start other programs, or load native (compiled) npm packages.
- **Network:** it can use the network: `fetch`, `net`, `dgram` (UDP), `http`, and pure-JavaScript npm packages such as `ws`.
- **Node.js 20:** plugins run on Node.js 20, which is the Node version inside JPMixer.

These limits come from Node's permission model. It keeps a plugin to its own folder, but Node calls it a seat belt, not a full sandbox. Only add plugins from someone you trust.

## Updating a plugin

- **Approved plugins:** select **Update** on its row, or under Find plugins. A red dot next to **Plugins** in the sidebar says one is waiting.
- **Others:** import the newer `.jpmplugin`, `.zip` or folder. It replaces the old one and keeps its settings.
- **Edits made by hand:** if you edit files in the plugins folder yourself, select **Reload plugins**, or tick **Restart when its files change** on the plugin's tab.

## Getting your plugin approved

Approved plugins live in the [`plugins/`](../plugins) folder of JPMixer's GitHub repository. JPMixer lists them under **Find plugins** for anyone to install with a click.

**To submit one:** fill in the [Submit a plugin](https://github.com/JPMixing-inc/jpmixer/issues/new?template=plugin-submission.yml) form under Issues. The **Submit it for review** button on the Plugins page opens it.
- Link its code, or attach its `.jpmplugin`.
- You can also open a pull request that adds the plugin's folder as `plugins/<id>/`.

**What a reviewer checks:**

- `plugin.json` is valid and asks only for the permissions the plugin uses.
- The code is readable, not minified or obfuscated, and does what the description says.
- Everything it connects to is listed in the submission, and it only reads and shows things.
- It doesn't try to reach outside its own folder and `jp.plugin.dataFolder`, or start other programs.
- Any npm packages in it are plain JavaScript, from their usual source.
- It runs on the JPMixer version it says, and survives the device it talks to being off.

**Once it's approved,** a maintainer:

1. puts its folder in `plugins/<id>/`;
2. runs `node scripts/build-plugin-catalog.js`, which writes `plugins/catalog.json` with every file's size and SHA-256;
3. merges both into `main`.

JPMixer reads the list from `main`, so the plugin shows up within a few minutes. An update follows the same steps, with a higher `version`.
