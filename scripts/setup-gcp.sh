#!/bin/bash
# Run only after choosing a dedicated project. This changes that project's IAM.
# No service-account key is created and no credential value is supplied here.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT_ID="${1:-}"
GOOGLE_EMAIL="${2:-}"
if [[ ! "$PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || [[ ! "$GOOGLE_EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  echo "Usage: bash scripts/setup-gcp.sh YOUR_PROJECT_ID YOUR_GOOGLE_EMAIL"
  exit 1
fi
command -v gcloud >/dev/null 2>&1 || { echo "Use Google Cloud Shell or install the Google Cloud CLI first."; exit 1; }
echo "Project: $PROJECT_ID"
echo "Grant vault role to: user:$GOOGLE_EMAIL"
echo "This enables Secret Manager and creates/updates a custom IAM role in this project."
read -r -p "Continue? Type YES: " CONFIRM
[ "$CONFIRM" = "YES" ] || exit 1
gcloud services enable secretmanager.googleapis.com --project="$PROJECT_ID"
ROLE="hiddenDoorVaultUser"
if gcloud iam roles describe "$ROLE" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam roles update "$ROLE" --project="$PROJECT_ID" --file=scripts/gcp-role.yaml
else
  gcloud iam roles create "$ROLE" --project="$PROJECT_ID" --file=scripts/gcp-role.yaml
fi
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="user:$GOOGLE_EMAIL" \
  --role="projects/$PROJECT_ID/roles/$ROLE" \
  --condition=None
echo "Next: configure the OAuth consent screen and create a Desktop app OAuth client."
echo "Import that client JSON into Hidden Door Vault. See the Google Cloud setup section in README.md."
