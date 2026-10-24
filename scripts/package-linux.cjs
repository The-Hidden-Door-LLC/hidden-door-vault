'use strict';
// Local Linux packager. Copies the pinned Electron build, installs this application's assets, renames the
// executable and flips the same Electron fuses as the macOS packager. Linux has no code-signing step; the
// Chromium sandbox is enabled at install time by scripts/install-linux.sh (AppArmor profile or SUID helper).
const fs = require('node:fs/promises');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const APP_ID = 'hidden-door-vault';
async function exists(filename) { try { await fs.access(filename); return true; } catch { return false; } }
(async () => {
  if (process.platform !== 'linux') throw new Error('Run the Linux packager on the Linux machine where you intend to use the app.');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required.');
  const electron = path.join(ROOT, 'node_modules/electron/dist');
  const sourcePackage = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const installedElectron = JSON.parse(await fs.readFile(path.join(ROOT, 'node_modules/electron/package.json'), 'utf8')).version;
  if (installedElectron !== sourcePackage.devDependencies.electron) throw new Error('Installed Electron does not match the pinned package version. Reinstall dependencies.');
  // Electron 42+ downloads its binary on first use rather than during npm ci.
  // Resolve through the pinned package so fresh installs initialize its dist.
  require('electron');
  if (!await exists(path.join(electron, 'electron'))) throw new Error('Electron binary is unavailable after initialization.');
  const output = path.join(ROOT, 'dist', APP_ID);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.rm(output, { recursive: true, force: true });
  await fs.cp(electron, output, { recursive: true, dereference: false, verbatimSymlinks: true });
  const resources = path.join(output, 'resources');
  for (const name of ['default_app.asar', 'app.asar', 'app']) await fs.rm(path.join(resources, name), { recursive: true, force: true });
  const appDir = path.join(resources, 'app'); await fs.mkdir(appDir, { recursive: true });
  for (const folder of ['src', 'assets', 'bin', 'extension']) await fs.cp(path.join(ROOT, folder), path.join(appDir, folder), { recursive: true });
  const appPackage = { name: sourcePackage.name, productName: sourcePackage.productName, version: sourcePackage.version, main: sourcePackage.main, description: sourcePackage.description, author: sourcePackage.author, license: sourcePackage.license };
  await fs.writeFile(path.join(appDir, 'package.json'), JSON.stringify(appPackage, null, 2));
  await fs.copyFile(path.join(ROOT, 'LICENSE'), path.join(appDir, 'LICENSE'));
  // Rename the main executable. Electron reports app.isPackaged=false while the executable is still
  // called "electron", which would leave DevTools enabled and launch-at-login disabled.
  const binary = path.join(output, APP_ID);
  await fs.rename(path.join(output, 'electron'), binary);
  await fs.copyFile(path.join(ROOT, 'assets/linux/icons/hicolor/512x512/apps', `${APP_ID}.png`), path.join(output, `${APP_ID}.png`));
  await fs.writeFile(path.join(output, 'version.txt'), `${sourcePackage.productName} ${sourcePackage.version} (Electron ${installedElectron}, ${process.arch})\n`);
  // Close the binary to foreign code: no ELECTRON_RUN_AS_NODE, no NODE_OPTIONS, no --inspect. Anything that
  // could run attacker code under this app's keyring identity.
  const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
  await flipFuses(binary, { version: FuseVersion.V1, [FuseV1Options.RunAsNode]: false, [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, [FuseV1Options.EnableNodeCliInspectArguments]: false, [FuseV1Options.EnableCookieEncryption]: true, [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false, [FuseV1Options.OnlyLoadAppFromAsar]: false });
  console.log(`\nBuilt for ${process.arch}: ${output}`);
  console.log('Unsigned local development build. Install it for this user and enable the Chromium sandbox with:');
  console.log('  bash scripts/install-linux.sh');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
