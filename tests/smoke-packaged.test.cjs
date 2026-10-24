'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { smokePackaged } = require('../scripts/smoke-packaged.cjs');
const fixture = path.join(__dirname, 'helpers', 'smoke-child.cjs');
const options = mode => ({ binary: process.execPath, args: [fixture, mode], timeoutMs: 5000, shutdownMs: 1000 });

test('smoke harness isolates the profile, requires ready bridge and removes its profile', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hdv-smoke-test-'));
  const receipt = path.join(directory, 'receipt');
  const previous = process.env.HDV_SMOKE_RECEIPT;
  process.env.HDV_SMOKE_RECEIPT = receipt;
  try {
    await smokePackaged(options('ready'));
    const recorded = JSON.parse(await fs.readFile(receipt, 'utf8'));
    assert.equal(path.dirname(recorded.profile), recorded.home);
    assert.equal(recorded.socketOverride, undefined);
    await assert.rejects(fs.stat(recorded.home), { code: 'ENOENT' });
  } finally {
    if (previous === undefined) delete process.env.HDV_SMOKE_RECEIPT;
    else process.env.HDV_SMOKE_RECEIPT = previous;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('smoke rejects a missing renderer, an unexpected configured vault and early child exit', async () => {
  for (const mode of ['no-ui', 'configured', 'exit']) await assert.rejects(smokePackaged({ ...options(mode), timeoutMs: 1000 }), /did not become ready/);
});

test('smoke forcibly reaps a stalled child and fails the run', async () => {
  await assert.rejects(smokePackaged(options('ignore-term')), /forced termination/);
});
