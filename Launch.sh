#!/bin/bash
# Linux counterpart of Launch.command: build once, install for this user, then start the installed app.
# Pass --rebuild to force a new build. The installer asks for sudo only for the one-time sandbox step.
set -euo pipefail
cd "$(dirname "$0")"
APP_ID="hidden-door-vault"
PREFIX="${HDV_PREFIX:-$HOME/.local}"
if [ "${1:-}" = "--rebuild" ] || [ ! -x "./dist/$APP_ID/$APP_ID" ]; then
  bash ./Build.sh
  bash ./scripts/install-linux.sh
elif [ ! -x "$PREFIX/opt/$APP_ID/$APP_ID" ]; then
  bash ./scripts/install-linux.sh
fi
if pgrep -x "$APP_ID" >/dev/null 2>&1; then
  # Already running: the single-instance lock makes this second launch just raise the window.
  exec "$PREFIX/opt/$APP_ID/$APP_ID"
fi
setsid "$PREFIX/opt/$APP_ID/$APP_ID" >/dev/null 2>&1 < /dev/null &
echo "Started Hidden Door Vault. It lives in the system tray; the tray icon (or launching it again) opens the window."
