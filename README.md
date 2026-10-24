# Hidden Door Vault

A client-encrypted credential vault for the macOS menu bar and Linux system tray.
It stores encrypted records in a Google Secret Manager project selected by the
user, with an encrypted local cache for offline reading.

Supported records include logins, payment cards, SSH keys, API tokens, recovery
codes, secure notes, and login-associated WebAuthn passkeys. The repository also
includes a local CLI, SSH-agent integration, and an unpacked Chromium extension.

## Build and run

Requires Node.js 22 or newer and npm. Dependencies, including Electron, are pinned
by `package-lock.json`; the first build downloads those public packages.

```sh
npm ci
npm run check
npm test
```

On Linux:

```sh
npm run build:linux
bash scripts/install-linux.sh
```

The installer uses the current user's directories. On systems restricting user
namespaces it asks to install an AppArmor profile for this application binary;
`--no-sudo` prints the required system commands instead. Do not disable the
Chromium sandbox to work around installation issues. Launch the app from the
desktop menu after installation.

On macOS:

```sh
npm run build:mac
open "dist/Hidden Door Vault.app"
```

The macOS packager produces an ad-hoc signed development application, not a
notarized distribution. `Build.sh` / `Build.command` combine dependency installation,
checks, tests, and packaging for their respective platforms.

## Google Cloud setup

Choose your own dedicated Google Cloud project and account. The application has
no preconfigured project, OAuth client, service account, or live vault data.

1. Enable Secret Manager for that project and grant the intended account only the
   required permissions. `scripts/gcp-role.yaml` lists the application's custom
   role permissions. The optional setup helper modifies IAM only after displaying
   the supplied project/account and asking for confirmation:

   ```sh
   bash scripts/setup-gcp.sh YOUR_PROJECT_ID YOUR_GOOGLE_EMAIL
   ```

2. Configure the project's OAuth consent screen and create a **Desktop app** OAuth
   client. Import its downloaded JSON through the app's setup screen.
3. Select the project ID and vault name, sign in to Google, and create a master
   password. Keep the generated recovery code somewhere separate and protected.

Google sign-in grants access to encrypted cloud records; it does not replace the
master password or recovery code. OAuth credentials are protected with Electron's
OS-backed secure storage. Linux refuses the plaintext `basic_text` fallback.

## CLI and browser extension

With the app configured, use **Settings → Integrations → Install Browser Host & CLI
Wrapper**, then load the unpacked `extension/` directory in a supported native
Chromium browser. Sandboxed Snap/Flatpak browser native-host access is not included.

The local `hdv` CLI can inspect status, list records, read selected fields, create
and edit records, generate passwords/tokens, and inject selected references into
command environments. Run `hdv --help` for commands. Avoid placing secret values
in command arguments or shell history. The desktop app must be running and the
vault unlocked for record access; locked requests can raise its unlock window.

The bridge uses an owner-only Unix socket. It is accessible to processes running
as the same OS user, so an unlocked vault does not protect against a compromised
user session. macOS Touch ID can unlock when explicitly enabled. Linux uses the
master-password unlock screen.

## Encrypted document and image attachments

Connected Markdown and image apps can list, open, and save files through the
local desktop bridge. In **Settings → Cloud & Billing**, lock the vault and enter
an existing Google Cloud Storage bucket name. Leave this setting blank to disable
file operations. The current Google account needs object read/create permissions
on that bucket and any required requester-project permissions; the app does not
create a bucket, grant IAM roles, or change public access settings.

Files are encrypted before upload. Each immutable object has a random name and
contains only an AES-256-GCM envelope. A purpose-separated HKDF key is derived
from a random per-object seed; the seed is stored only inside the encrypted Vault
record. Authenticated context binds the source vault, immutable attachment identity,
media type, byte count, and SHA-256 digest. Titles, filenames, storage references,
and the seed are in the encrypted manifest, not public GCS object metadata.

The desktop socket accepts `documents-list`, `documents-read`, and `documents-write`.
Lists return safe metadata, and reads additionally return base64 bytes. File keys
are not returned. Updates require the revision from the latest read; new saves
create new document IDs. Supported media types are Markdown/plain text and
PNG/JPEG/WebP, up to 16 MiB per file. Requests and responses are bounded to 24 MiB.
Large files are intentionally unavailable over browser-extension Native Messaging.
Locked requests fail with an instruction to unlock the Vault app; connected apps
do not collect a master password.

The Vault backend stages no attachment plaintext on disk. Document manifests are
read-only in its ordinary credential editor, and generic credential get/field/edit
methods do not expose their internal keys. Offline cache snapshots contain encrypted
manifests; file bytes are not cached locally, so opening attachments requires an
online unlock. Cloud writes always require an online session.

An encrypted `.hdvault` backup includes attachment references and encrypted key
material, **not the attachment bytes themselves**. It can restore file access after
record IDs or the destination vault key change, provided the referenced GCS objects
and generations remain available and the Google account can read them. Keep the
bucket and objects: the backup alone is not a complete file backup.

Updates retain prior ciphertext objects. Failed or interrupted uploads/metadata
commits can leave orphan encrypted objects; they are reported and never automatically
deleted. If a commit cannot be confirmed, refresh before retrying. There is no
automatic attachment garbage collection, and storage/network charges can apply.
The test suite uses in-memory Google adapters; no live bucket acceptance is claimed.

## Storage and recovery

Records use AES-256-GCM with a master key wrapped using scrypt-derived password
material and a separate recovery key. The cloud project and local cache contain
encrypted record envelopes; decrypted records exist in process memory while the
vault is unlocked. Locking clears the app's active record/key state, with the usual
limitations of managed-runtime memory.

Export an encrypted `.hdvault` backup before maintenance. Offline emergency
recovery is available through `scripts/recover-backup.cjs`; it prompts in an
interactive terminal and requires an explicit flag before writing a new,
owner-only plaintext output file. Keep backups, OAuth client downloads, credentials,
and plaintext exports outside the repository.

This is development software. The automated suite uses mock cloud responses and
temporary local fixtures; passing tests are not an independent security audit or
proof of a particular user's Google permissions, browser host, or OS keyring setup.

## License

MIT; see `LICENSE`. Bundled Sora and Atkinson Hyperlegible fonts retain their SIL
Open Font License notices in `src/ui/fonts/` and `extension/fonts/`.
