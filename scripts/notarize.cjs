'use strict';

// electron-builder afterSign hook (package.json → build.afterSign): sends the
// signed Mac app to Apple for notarization, so Gatekeeper opens it without
// the "unidentified developer" warning, and staples the ticket to it.
//
// It only runs when there's something to do:
//   - the app was actually signed with a Developer ID certificate (with no
//     certificate installed, the build stays unsigned and this skips), and
//   - notarization credentials are set up, in one of two ways:
//       JPM_NOTARY_PROFILE=<name>   a profile saved once with
//                                   `xcrun notarytool store-credentials <name>`
//                                   (the password stays in the keychain), or
//       APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID.
// Credentials are never written to the project or printed.

const { execFileSync } = require('child_process');
const path = require('path');

function signingInfo(appPath) {
  try {
    // codesign writes its details to stderr
    execFileSync('/usr/bin/codesign', ['-dv', '--verbose=2', appPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (err) {
    return { signed: false, detail: String(err.stderr || err.message) };
  }
  const out = String(execFileSync('/bin/sh', ['-c', '/usr/bin/codesign -dv --verbose=2 "$1" 2>&1', 'sh', appPath]));
  const team = (/^TeamIdentifier=(.+)$/m.exec(out) || [])[1];
  const adhoc = /Signature=adhoc/.test(out);
  return { signed: !adhoc && !!team && team !== 'not set', team };
}

exports.default = async function notarizeApp(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  // A universal build signs its x64/arm64 halves in temporary folders first; only the final app is sent
  if (/-temp$/.test(context.appOutDir)) return;

  const sig = signingInfo(appPath);
  if (!sig.signed) {
    console.log('  • notarize        skipped: the app isn’t signed with a Developer ID certificate');
    return;
  }

  let credentials = null;
  if (process.env.JPM_NOTARY_PROFILE) credentials = { keychainProfile: process.env.JPM_NOTARY_PROFILE };
  else if (process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID) {
    credentials = { appleId: process.env.APPLE_ID, appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD, teamId: process.env.APPLE_TEAM_ID };
  }
  if (!credentials) {
    console.warn('  • notarize        skipped: signed, but no notarization credentials are set (see scripts/notarize.cjs). Gatekeeper will still warn on other Macs.');
    return;
  }

  console.log(`  • notarize        sending to Apple (team ${sig.team}) — this usually takes a few minutes`);
  const { notarize } = require('@electron/notarize');
  await notarize({ tool: 'notarytool', appPath, ...credentials });
  console.log('  • notarize        done; ticket stapled');
};
