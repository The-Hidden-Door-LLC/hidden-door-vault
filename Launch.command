#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
# Build once; afterwards just open the built app. Pass --rebuild to force a new build.
if [ "${1:-}" = "--rebuild" ] || [ ! -d "./dist/Hidden Door Vault.app" ]; then
  bash ./Build.command
fi
open "./dist/Hidden Door Vault.app"
