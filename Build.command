#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ "$(uname -s)" != "Darwin" ]; then
  echo "Build.command creates a macOS app. Run it on your Mac."
  exit 1
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Install Node.js 22 or newer, reopen Terminal, and run this script again."
  echo "No administrator password, Google password, or vault password is needed for the build."
  exit 1
fi
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Node.js 22 or newer is required."); process.exit(1); }'
echo "Installing pinned Electron dependency. First build requires internet access."
if [ ! -f package-lock.json ]; then
  echo "package-lock.json is missing. Restore it from the repository; this build refuses to resolve dependencies without the reviewed lockfile."
  exit 1
fi
npm ci --no-audit --no-fund
npm run check
npm test
npm run build:mac
echo "Done. The app is in dist/Hidden Door Vault.app."
echo "Close any earlier instance before opening a rebuilt app."
