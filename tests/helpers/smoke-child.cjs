'use strict';
// Synthetic child for testing the smoke harness lifecycle, not GUI acceptance.
const path = require('node:path');
const fs = require('node:fs');
const { BridgeServer } = require('../../src/core/bridge.cjs');
const mode = process.argv[2];
const profile = process.env.HDV_USER_DATA;
if (process.env.HDV_SMOKE_RECEIPT) fs.writeFileSync(process.env.HDV_SMOKE_RECEIPT, JSON.stringify({ profile, home: process.env.HOME, socketOverride: process.env.HDV_SOCKET }));
if (mode === 'exit') process.exit(1);
const bridge = new BridgeServer({
  socketPath: path.join(profile, 'hdv.sock'),
  getVault: () => mode === 'configured' ? { unlocked: false } : null,
  getRuntimeStatus: () => ({ packaged: true, uiReady: mode !== 'no-ui' })
});
bridge.start().catch(() => process.exit(1));
process.on('SIGTERM', () => {
  if (mode === 'ignore-term') return;
  bridge.stop().then(() => process.exit(0));
});
