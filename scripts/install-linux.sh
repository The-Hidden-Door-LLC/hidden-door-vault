#!/bin/bash
# Installs the packaged Linux build (dist/hidden-door-vault) for the current user and enables the Chromium
# sandbox. User-level files go under $HDV_PREFIX (default ~/.local). The only system-level change is the
# sandbox step, which needs sudo on kernels that restrict unprivileged user namespaces (Ubuntu 24.04+):
# an AppArmor profile naming this binary, in the same form Ubuntu ships for Chrome, VS Code and 1Password.
#
#   bash scripts/install-linux.sh             install or update, then enable the sandbox (asks for sudo if needed)
#   bash scripts/install-linux.sh --no-sudo   install without touching the system; print the sudo commands instead
#   bash scripts/install-linux.sh --dev       only enable the sandbox for node_modules/electron (for `npm start`)
#   bash scripts/install-linux.sh --uninstall remove the app, launcher, icons and sandbox profile (keeps vault data)
set -euo pipefail
cd "$(dirname "$0")/.."
APP_ID="hidden-door-vault"
PREFIX="${HDV_PREFIX:-$HOME/.local}"
APP_DIR="${PREFIX:?}/opt/${APP_ID:?}"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
DESKTOP_DIR="${DATA_HOME:?}/applications"
ICON_ROOT="${DATA_HOME:?}/icons/hicolor"
MODE=install; NO_SUDO=0
for arg in "$@"; do
  case "$arg" in
    --dev) MODE=dev ;;
    --uninstall) MODE=uninstall ;;
    --no-sudo) NO_SUDO=1 ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done
if [ "$(uname -s)" != "Linux" ]; then echo "install-linux.sh is for Linux. Use Launch.command on macOS."; exit 1; fi
command -v node >/dev/null 2>&1 || { echo "Node.js 22 or newer is required (for hdv, the Native Messaging host and this installer)."; exit 1; }
GEN="src/core/linux-integration.cjs"

sudo_run() {
  if [ "$NO_SUDO" = 1 ]; then echo "  (skipped; run yourself) sudo $*"; return 0; fi
  echo "  sudo $*"; sudo "$@"
}
# Decide how the Chromium sandbox can run on this kernel and apply it for one binary.
sandbox_setup() {
  local binary="$1" profile_name="$2" dir
  dir="$(dirname "$binary")"
  local restrict=0 userns_clone=1 max_userns=1
  [ -r /proc/sys/kernel/apparmor_restrict_unprivileged_userns ] && restrict="$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)"
  [ -r /proc/sys/kernel/unprivileged_userns_clone ] && userns_clone="$(cat /proc/sys/kernel/unprivileged_userns_clone)"
  [ -r /proc/sys/user/max_user_namespaces ] && max_userns="$(cat /proc/sys/user/max_user_namespaces)"
  if [ "$restrict" = 1 ] && command -v apparmor_parser >/dev/null 2>&1 && aa-enabled -q 2>/dev/null; then
    echo "Sandbox: this kernel restricts unprivileged user namespaces (AppArmor). Installing profile /etc/apparmor.d/$profile_name"
    # The generated profile is kept next to the build so the printed command stays reproducible.
    mkdir -p dist; local profile="$PWD/dist/$profile_name.apparmor"
    node "$GEN" apparmor-profile "$binary" "$profile_name" > "$profile"
    if [ "$NO_SUDO" = 1 ]; then
      echo "  (skipped; run yourself)"; echo "  sudo install -m 644 '$profile' /etc/apparmor.d/$profile_name && sudo apparmor_parser -r /etc/apparmor.d/$profile_name"
      echo "  Profile contents:"; sed 's/^/    /' "$profile"
    else
      sudo_run install -m 644 "$profile" "/etc/apparmor.d/$profile_name"
      sudo_run apparmor_parser -r "/etc/apparmor.d/$profile_name"
    fi
  elif [ "$userns_clone" = 0 ] || [ "$max_userns" = 0 ]; then
    echo "Sandbox: user namespaces are disabled on this kernel. Using the setuid sandbox helper instead."
    sudo_run chown root:root "$dir/chrome-sandbox"
    sudo_run chmod 4755 "$dir/chrome-sandbox"
  else
    echo "Sandbox: unprivileged user namespaces are available; no system change needed."
  fi
}
sandbox_remove() {
  local profile_name="${1:?}"
  if [ -f "/etc/apparmor.d/$profile_name" ]; then
    sudo_run apparmor_parser -R "/etc/apparmor.d/$profile_name" || true
    sudo_run rm -f "/etc/apparmor.d/$profile_name"
  fi
}

case "$MODE" in
  dev)
    [ -x node_modules/electron/dist/electron ] || { echo "node_modules/electron is missing. Run npm ci first."; exit 1; }
    sandbox_setup "$PWD/node_modules/electron/dist/electron" "$APP_ID-dev"
    echo "Done. 'npm start' can now run with the sandbox enabled."
    ;;
  uninstall)
    echo "Removing $APP_DIR, launcher, icons, autostart entry and the sandbox profile."
    rm -rf "${APP_DIR:?}"
    rm -f "${DESKTOP_DIR:?}/${APP_ID:?}.desktop" "${PREFIX:?}/bin/${APP_ID:?}" "${CONFIG_HOME:?}/autostart/${APP_ID:?}.desktop"
    find "${ICON_ROOT:?}" -path "*/apps/${APP_ID:?}.png" -delete 2>/dev/null || true
    sandbox_remove "$APP_ID"
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
    echo "Vault data was left in place: $CONFIG_HOME/Hidden Door Vault"
    echo "Native Messaging manifests (~/.config/<browser>/NativeMessagingHosts/ai.thehiddendoor.vault.json) and ~/.local/bin/hdv were left in place."
    ;;
  install)
    [ -x "dist/$APP_ID/$APP_ID" ] || { echo "dist/$APP_ID is missing. Run: npm run build:linux"; exit 1; }
    if pgrep -x "$APP_ID" >/dev/null 2>&1; then echo "Hidden Door Vault is running. Quit it from the tray menu, then run this again."; exit 1; fi
    echo "Installing to $APP_DIR"
    rm -rf "${APP_DIR:?}"; mkdir -p "$PREFIX/opt" "$PREFIX/bin" "$DESKTOP_DIR"
    cp -a "dist/$APP_ID" "$APP_DIR"
    ln -sfn "$APP_DIR/$APP_ID" "$PREFIX/bin/$APP_ID"
    for png in assets/linux/icons/hicolor/*/apps/$APP_ID.png; do
      size="$(basename "$(dirname "$(dirname "$png")")")"
      install -Dm644 "$png" "$ICON_ROOT/$size/apps/$APP_ID.png"
    done
    node "$GEN" desktop-entry "$APP_DIR/$APP_ID" > "$DESKTOP_DIR/$APP_ID.desktop"
    chmod 644 "$DESKTOP_DIR/$APP_ID.desktop"
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
    command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t -f "$ICON_ROOT" 2>/dev/null || true
    # Re-point an existing autostart entry at the new binary path (it is rewritten when the switch is toggled anyway).
    AUTOSTART="$CONFIG_HOME/autostart/$APP_ID.desktop"
    [ -f "$AUTOSTART" ] && node "$GEN" autostart-entry "$APP_DIR/$APP_ID" > "$AUTOSTART"
    sandbox_setup "$APP_DIR/$APP_ID" "$APP_ID"
    echo
    echo "Installed. Launch 'Hidden Door Vault' from your app menu, or run: $PREFIX/bin/$APP_ID"
    echo "Then use Settings → Integrations → Install Browser Host & CLI Wrapper (or 'hdv install-browser') for the extension and CLI."
    ;;
esac
