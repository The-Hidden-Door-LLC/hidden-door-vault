'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
async function atomicWrite(filename, bytes) {
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const tmp = `${filename}.${crypto.randomUUID()}.tmp`; let handle;
  try {
    handle = await fs.open(tmp, 'wx', 0o600); await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
    await fs.rename(tmp, filename); await fs.chmod(filename, 0o600);
  } finally { await handle?.close().catch(() => {}); await fs.unlink(tmp).catch(() => {}); }
}
async function readLimited(filename, maxBytes = 32 * 1024 * 1024) {
  const handle = await fs.open(filename, 'r');
  try { const stat = await handle.stat(); if (!stat.isFile() || stat.size > maxBytes) throw new Error('File exceeds the safety limit.'); const bytes = await handle.readFile(); if (bytes.length > maxBytes) throw new Error('File exceeds the safety limit.'); return bytes; }
  finally { await handle.close(); }
}
class ProtectedStore {
  constructor(directory, safeStorage, platform = process.platform) { this.directory = directory; this.safeStorage = safeStorage; this.platform = platform; }
  file(name) { if (!/^[a-z-]+$/.test(name)) throw new Error('Invalid protected storage name.'); return path.join(this.directory, `${name}.bin`); }
  available() {
    if (!this.safeStorage.isEncryptionAvailable() || (this.platform === 'linux' && this.safeStorage.getSelectedStorageBackend() === 'basic_text')) throw new Error('OS-protected credential storage is unavailable. Refusing to store Google tokens in plaintext.');
  }
  async get(name) {
    let bytes; try { bytes = await readLimited(this.file(name), 128 * 1024); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    this.available();
    try { return JSON.parse(this.safeStorage.decryptString(bytes)); }
    catch (_) { throw new Error(this.platform === 'darwin' ? 'Cannot read macOS-protected sign-in credentials. Check Keychain access or reconnect the Google account.' : 'Cannot read OS-protected sign-in credentials. Check that the system keyring (Secret Service / KWallet) is unlocked, or reconnect the Google account.'); }
  }
  async set(name, value) { this.available(); await atomicWrite(this.file(name), this.safeStorage.encryptString(JSON.stringify(value))); }
  async delete(name) { await fs.unlink(this.file(name)).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
class CipherCache {
  constructor(directory, project, vault) { this.filename = path.join(directory, `${crypto.createHash('sha256').update(`${project}:${vault}`).digest('hex')}.json`); }
  async read() { try { return JSON.parse((await readLimited(this.filename, 96 * 1024 * 1024)).toString('utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw new Error('The encrypted offline cache is unreadable. Connect online to refresh it.'); } }
  async write(value) { await atomicWrite(this.filename, Buffer.from(JSON.stringify(value))); }
  async clear() { await fs.unlink(this.filename).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
module.exports = { atomicWrite, readLimited, ProtectedStore, CipherCache };
