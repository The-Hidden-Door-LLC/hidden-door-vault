'use strict';
// Local macOS packager. Uses the pinned Electron installation and built-in tools.
// No cloud credential or Apple Developer credential is required to build locally.
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
async function exists(filename) { try { await fs.access(filename); return true; } catch { return false; } }
function plist(filename, key, type, value) {
  try { execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, filename], { stdio: 'pipe' }); }
  catch { execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} ${type} ${value}`, filename], { stdio: 'pipe' }); }
}
(async () => {
  if (process.platform !== 'darwin') throw new Error('Run the macOS packager on the Mac where you intend to use the app.');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required.');
  const electron = path.join(ROOT, 'node_modules/electron/dist/Electron.app');
  const sourcePackage = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const installedElectron = JSON.parse(await fs.readFile(path.join(ROOT, 'node_modules/electron/package.json'), 'utf8')).version;
  if (installedElectron !== sourcePackage.devDependencies.electron) throw new Error('Installed Electron does not match the pinned package version. Reinstall dependencies.');
  // Electron 42+ downloads its binary on first use rather than during npm ci.
  // Resolve through the pinned package so fresh installs initialize its dist.
  require('electron');
  if (!await exists(electron)) throw new Error('Electron binary is unavailable after initialization.');
  const output = path.join(ROOT, 'dist', 'Hidden Door Vault.app');
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.rm(output, { recursive: true, force: true });
  await fs.cp(electron, output, { recursive: true, dereference: false, verbatimSymlinks: true });
  const resources = path.join(output, 'Contents', 'Resources');
  for (const name of ['default_app.asar', 'app.asar', 'app']) await fs.rm(path.join(resources, name), { recursive: true, force: true });
  const appDir = path.join(resources, 'app'); await fs.mkdir(appDir, { recursive: true });
  for (const folder of ['src', 'assets', 'bin', 'extension']) await fs.cp(path.join(ROOT, folder), path.join(appDir, folder), { recursive: true });
  const appPackage = { name: sourcePackage.name, productName: sourcePackage.productName, version: sourcePackage.version, main: sourcePackage.main, description: sourcePackage.description, author: sourcePackage.author, license: sourcePackage.license };
  await fs.writeFile(path.join(appDir, 'package.json'), JSON.stringify(appPackage, null, 2));
  await fs.copyFile(path.join(ROOT, 'LICENSE'), path.join(appDir, 'LICENSE'));
  await fs.copyFile(path.join(ROOT, 'assets/icon.icns'), path.join(resources, 'vault.icns'));
  // Rename the main executable. Electron reports app.isPackaged=false while the executable is
  // still called "Electron", which would leave DevTools enabled and launch-at-login disabled.
  const macos = path.join(output, 'Contents', 'MacOS');
  await fs.rename(path.join(macos, 'Electron'), path.join(macos, 'Hidden Door Vault'));
  const info = path.join(output, 'Contents', 'Info.plist');
  plist(info, 'CFBundleExecutable', 'string', 'Hidden Door Vault');
  plist(info, 'CFBundleIdentifier', 'string', 'ai.thehiddendoor.vault');
  plist(info, 'CFBundleName', 'string', 'Hidden Door Vault');
  plist(info, 'CFBundleDisplayName', 'string', 'Hidden Door Vault');
  plist(info, 'CFBundleShortVersionString', 'string', sourcePackage.version);
  plist(info, 'CFBundleVersion', 'string', sourcePackage.version);
  plist(info, 'CFBundleIconFile', 'string', 'vault.icns');
  plist(info, 'LSUIElement', 'bool', 'true');
  plist(info, 'NSHighResolutionCapable', 'bool', 'true');
  // Close the binary to foreign code before signing: no ELECTRON_RUN_AS_NODE, no NODE_OPTIONS,
  // no --inspect. Anything that could run attacker code under this app's keychain identity.
  const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
  await flipFuses(path.join(macos, 'Hidden Door Vault'), { version: FuseVersion.V1, resetAdHocDarwinSignature: true, [FuseV1Options.RunAsNode]: false, [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, [FuseV1Options.EnableNodeCliInspectArguments]: false, [FuseV1Options.EnableCookieEncryption]: true, [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false, [FuseV1Options.OnlyLoadAppFromAsar]: false });
  // Development-only signature (ad-hoc) but with the hardened runtime, so DYLD injection and
  // debugger attachment are refused. Not Developer-ID signed or notarized.
  const entitlements = path.join(ROOT, 'assets/entitlements.plist');
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', '--options', 'runtime', '--entitlements', entitlements, output], { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', output], { stdio: 'inherit' });
  console.log(`\nBuilt for ${process.arch}: ${output}`);
  console.log('This is a locally signed development build, not a notarized distribution.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
