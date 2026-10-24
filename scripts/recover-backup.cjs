'use strict';
// Emergency offline decryption. No Electron, Google login or cloud access needed.
// Writes plaintext ONLY after the caller explicitly supplies the warning flag.
const fs = require('node:fs/promises');
const readline = require('node:readline');
const { Writable } = require('node:stream');
const { readLimited } = require('../src/core/storage.cjs');
const { readBackup } = require('../src/core/vault.cjs');
async function hiddenPrompt(prompt) {
  if (!process.stdin.isTTY) throw new Error('Use an interactive terminal. Do not pass a master password through arguments or environment variables.');
  process.stderr.write(prompt);
  const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const rl = readline.createInterface({ input: process.stdin, output: muted, terminal: true });
  return new Promise((resolve, reject) => {
    rl.once('SIGINT', () => { rl.close(); process.stderr.write('\n'); reject(new Error('Cancelled.')); });
    rl.question('', answer => { rl.close(); process.stderr.write('\n'); resolve(answer); });
  });
}
(async () => {
  const [source, destination, ...flags] = process.argv.slice(2);
  if (!source || !destination || !flags.includes('--i-understand-plaintext')) throw new Error('Usage: node scripts/recover-backup.cjs BACKUP.hdvault OUTPUT.json --i-understand-plaintext [--recovery]\nWARNING: OUTPUT.json will contain unencrypted credentials. Do not use a cloud-synced folder.');
  if (flags.some(flag => !['--i-understand-plaintext', '--recovery'].includes(flag))) throw new Error('Unknown argument. Never put the password or recovery code on the command line.');
  const recovery = flags.includes('--recovery');
  const credential = await hiddenPrompt(recovery ? 'Recovery code (hidden): ' : 'Master password (hidden): ');
  const backup = JSON.parse((await readLimited(source, 96 * 1024 * 1024)).toString('utf8'));
  const records = await readBackup(backup, credential, recovery);
  // Refuse to overwrite an existing file. Owner-only permissions on macOS/Linux.
  await fs.writeFile(destination, JSON.stringify({ warning: 'PLAINTEXT CREDENTIALS - PROTECT THIS FILE', items: records }, null, 2), { mode: 0o600, flag: 'wx' });
  process.stderr.write(`Recovered ${records.length} item(s) into the explicitly requested plaintext file. Protect or securely handle that file.\n`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
