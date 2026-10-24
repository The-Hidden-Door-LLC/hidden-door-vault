#!/bin/bash
# Linux counterpart of Build.command: install the pinned dependencies, run the guards and tests, and package.
set -euo pipefail
cd "$(dirname "$0")"
if [ "$(uname -s)" != "Linux" ]; then
  echo "Build.sh creates a Linux build. Use Build.command on macOS."
  exit 1
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Install Node.js 22 or newer (for example from nodejs.org or your distribution), then run this script again."
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
npm run build:linux
echo "Done. The app is in dist/hidden-door-vault. Install it with: bash scripts/install-linux.sh"
echo "Quit any earlier instance (tray menu → Quit) before installing a rebuilt app."
