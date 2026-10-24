'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { sendBridgeRequest } = require('../src/core/bridge.cjs');

// Run only the supplied child and its descendants, with an empty temporary profile.
// A successful launch must render the local UI and answer the real desktop socket.
async function smokePackaged({ binary, args = [], timeoutMs = 30000, shutdownMs = 5000 }) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hdv-smoke-'));
  const profile = path.join(directory, 'profile');
  const socketPath = path.join(profile, 'hdv.sock');
  let child, closed = false, exit, forced = false;
  try {
    await fs.mkdir(profile, { mode: 0o700 });
    const env = { ...process.env, HOME: directory, XDG_CONFIG_HOME: path.join(directory, 'config'), XDG_CACHE_HOME: path.join(directory, 'cache'), XDG_DATA_HOME: path.join(directory, 'data'), HDV_USER_DATA: profile };
    delete env.HDV_SOCKET;
    delete env.HDV_SSH_AUTH_SOCK;
    child = spawn(binary, args, { env, detached: true, stdio: ['ignore', 'ignore', 'ignore'] });
    exit = new Promise(resolve => {
      child.once('error', () => { closed = true; resolve(); });
      child.once('close', () => { closed = true; resolve(); });
    });
    const deadline = Date.now() + timeoutMs;
    let ready = false;
    while (Date.now() < deadline && !closed) {
      try {
        const status = await sendBridgeRequest('status', {}, { socketPath, timeoutMs: Math.min(1000, Math.max(1, deadline - Date.now())) });
        if (status.running && status.configured === false && status.unlocked === false && status.runtime?.packaged === true && status.runtime?.uiReady === true) { ready = true; break; }
      } catch { /* Startup may not have bound the socket yet. */ }
      await delay(100);
    }
    if (!ready) throw new Error('Packaged GUI did not become ready with an empty, locked profile before the deadline.');
  } finally {
    if (child?.pid) {
      const signalGroup = signal => { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
      signalGroup('SIGTERM');
      if (!closed) await Promise.race([exit, delay(shutdownMs, undefined, { ref: false })]);
      if (!closed) {
        forced = true;
        signalGroup('SIGKILL');
        await Promise.race([exit, delay(1000, undefined, { ref: false })]);
      }
      // Reap any descendants even when the main process exited first.
      signalGroup('SIGKILL');
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
  if (forced) throw new Error('Packaged GUI required forced termination after its shutdown deadline.');
}

if (require.main === module) {
  const binary = process.argv[2];
  if (!binary) { console.error('Usage: node scripts/smoke-packaged.cjs <packaged-binary>'); process.exitCode = 1; }
  else smokePackaged({ binary: path.resolve(binary) }).then(() => console.log('PASS: packaged local UI and locked bridge ready; child shut down.')).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { smokePackaged };
