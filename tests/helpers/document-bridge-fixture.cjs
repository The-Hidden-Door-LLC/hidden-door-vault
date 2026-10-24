'use strict';
// Synthetic end-to-end fixture: real Vault encryption and Unix bridge, in-memory cloud adapters.
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { BridgeServer } = require('../../src/core/bridge.cjs');
const { fixture } = require('./document-fixture.cjs');

(async () => {
  const socketPath = process.env.HDV_SOCKET;
  if (!socketPath || !path.isAbsolute(socketPath) || !path.resolve(socketPath).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Fixture requires HDV_SOCKET under the temporary directory.');
  await fs.mkdir(path.dirname(socketPath), { recursive: true, mode: 0o700 });
  const { vault } = await fixture();
  const bridge = new BridgeServer({ socketPath, getVault: () => vault });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    const timer = setTimeout(() => process.exit(1), 5000); timer.unref();
    vault.lock();
    await bridge.stop();
    clearTimeout(timer);
    process.exit(0);
  };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  await bridge.start();
  process.stdout.write('ready\n');
})().catch(() => { process.stderr.write('Synthetic document bridge failed to start.\n'); process.exitCode = 1; });
