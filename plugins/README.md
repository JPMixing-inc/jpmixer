# Approved plugins

Every plugin in this folder has been reviewed. JPMixer lists them in **Settings → Integrations → Plugins → Find plugins**, where anyone can install one with a click.

- Each plugin is in a folder named after its `id`, with its `plugin.json` and its code.
- `catalog.json` is the list JPMixer reads. It gives each plugin's name, version and what it can do, and every file's size and SHA-256. JPMixer refuses a download that doesn't match.

## Adding or updating a plugin

1. Review it. See the checklist in [docs/PLUGINS.md](../docs/PLUGINS.md#getting-your-plugin-approved).
2. Put its folder here as `plugins/<id>/`. For an update, replace the folder, with a higher `version` in its `plugin.json`.
3. Run `node scripts/build-plugin-catalog.js` and commit `catalog.json` with it. The tests fail while `catalog.json` is out of date.

JPMixer reads this folder from the `main` branch, so a plugin is listed once it's merged there. JPMixer offers an update to anyone who installed an older version from this list.

To submit a plugin, use the **Submit a plugin** form under [Issues](https://github.com/JPMixing-inc/jpmixer/issues/new?template=plugin-submission.yml).
