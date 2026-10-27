# Approved plugins

Every plugin in this folder has been reviewed. JPMixer lists them in **Settings → Plugins → Find plugins**, where anyone can install one with a click.

Each has a page with pictures and how to set it up: **[Patch](../docs/plugins/patch.md)**, **[Shure wireless](../docs/plugins/shure.md)**, **[Smaart SPL](../docs/plugins/smaart.md)**, **[Companion buttons](../docs/plugins/companion.md)** and **[Console check](../docs/plugins/console-check.md)** ([all plugins](../docs/plugins/README.md)).

- Each plugin is in a folder named after its `id`, with its `plugin.json` and its code.
- `catalog.json` is the list JPMixer reads. It gives each plugin's name, version and what it can do, and every file's size and SHA-256. JPMixer refuses a download that doesn't match.

## JPMixer's own

`patch`, `shure`, `smaart` and `companion` are JPMixer's own (official) plugins. They run without Allow plugins as long as their files match what was installed from this list, and JPMixer carries a copy of each (and of `catalog.json`) in the app, for moving people over from versions where Shure, Smaart and Companion were built in, with no internet. Only `shure`, `smaart` and `companion` may ask for the `integration` permission; their settings are JPMixer's own, set in their tabs in Settings.

## Adding or updating a plugin

1. Review it. See the checklist in [docs/PLUGINS.md](../docs/PLUGINS.md#getting-your-plugin-approved).
2. Put its folder here as `plugins/<id>/`. For an update, replace the folder, with a higher `version` in its `plugin.json`.
3. Run `node scripts/build-plugin-catalog.js` and commit `catalog.json` with it. The tests fail while `catalog.json` is out of date.

JPMixer reads this folder from the `main` branch, so a plugin is listed once it's merged there. JPMixer offers an update to anyone who installed an older version from this list.

To submit a plugin, use the **Submit a plugin** form under [Issues](https://github.com/JPMixing-inc/jpmixer/issues/new?template=plugin-submission.yml).
