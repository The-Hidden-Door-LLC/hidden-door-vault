'use strict';
const net = require('node:net');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');

const SSH_AGENT_FAILURE = 5;
const SSH_AGENTC_REQUEST_IDENTITIES = 11;
const SSH_AGENT_IDENTITIES_ANSWER = 12;
const SSH_AGENTC_SIGN_REQUEST = 13;
const SSH_AGENT_SIGN_RESPONSE = 14;
const OPENSSH_MAGIC = Buffer.from('openssh-key-v1\0', 'utf8');

function uint32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; }
function sshString(value) { const b = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8'); return Buffer.concat([uint32(b.length), b]); }
function frameMessage(type, payload = Buffer.alloc(0)) {
  const body = Buffer.concat([Buffer.from([type]), payload]);
  return Buffer.concat([uint32(body.length), body]);
}

class BufferReader {
  constructor(buf) { this.buf = buf; this.offset = 0; }
  remaining() { return this.buf.length - this.offset; }
  readBytes(len) {
    if (len < 0 || this.offset + len > this.buf.length) throw new Error('Truncated SSH buffer.');
    const slice = this.buf.subarray(this.offset, this.offset + len);
    this.offset += len;
    return slice;
  }
  readUInt32() {
    const b = this.readBytes(4);
    return b.readUInt32BE(0);
  }
  readString() {
    const len = this.readUInt32();
    if (len > 256 * 1024) throw new Error('SSH string exceeds limit.');
    return this.readBytes(len);
  }
}

function parseOpenSshEd25519(privateKeyPem) {
  if (typeof privateKeyPem !== 'string') throw new Error('Missing SSH private key.');
  const match = /-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]+?)-----END OPENSSH PRIVATE KEY-----/.exec(privateKeyPem);
  if (!match) throw new Error('Unsupported SSH private key format (expected OpenSSH private key).');
  const raw = Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
  try {
    const r = new BufferReader(raw);
    const magic = r.readBytes(OPENSSH_MAGIC.length);
    if (!magic.equals(OPENSSH_MAGIC)) throw new Error('Invalid OpenSSH key magic.');
    const cipher = r.readString().toString('utf8');
    const kdf = r.readString().toString('utf8');
    r.readString(); // kdf options
    if (cipher !== 'none' || kdf !== 'none') throw new Error('Passphrase-encrypted OpenSSH keys must be decrypted before importing.');
    const numKeys = r.readUInt32();
    if (numKeys !== 1) throw new Error('Expected a single SSH key.');
    const publicBlob = Buffer.from(r.readString());
    const inner = Buffer.from(r.readString());
    try {
      const ir = new BufferReader(inner);
      const check1 = ir.readUInt32();
      const check2 = ir.readUInt32();
      if (check1 !== check2) throw new Error('Corrupted OpenSSH private key checksum.');
      const keyType = ir.readString().toString('utf8');
      if (keyType !== 'ssh-ed25519') throw new Error(`Unsupported SSH key type: ${keyType}`);
      const pub = Buffer.from(ir.readString());
      const priv = Buffer.from(ir.readString());
      const comment = ir.readString().toString('utf8');
      if (pub.length !== 32 || priv.length !== 64) throw new Error('Invalid Ed25519 key lengths.');
      const seed = priv.subarray(0, 32);
      if (!priv.subarray(32, 64).equals(pub)) throw new Error('Ed25519 public half mismatch.');
      const keyObject = crypto.createPrivateKey({
        key: { kty: 'OKP', crv: 'Ed25519', d: seed.toString('base64url'), x: pub.toString('base64url') },
        format: 'jwk'
      });
      priv.fill(0);
      return { keyType, publicBlob, pub, comment, keyObject };
    } finally {
      inner.fill(0);
    }
  } finally {
    raw.fill(0);
  }
}

function extractPublicBlob(item) {
  if (typeof item.publicKey === 'string' && item.publicKey.trim()) {
    const parts = item.publicKey.trim().split(/\s+/);
    if (parts[0] === 'ssh-ed25519' && parts[1]) {
      const blob = Buffer.from(parts[1], 'base64');
      const r = new BufferReader(blob);
      const kt = r.readString().toString('utf8');
      const pk = r.readString();
      if (kt === 'ssh-ed25519' && pk.length === 32 && r.remaining() === 0) {
        return { publicBlob: blob, comment: parts.slice(2).join(' ') || item.title };
      }
    }
  }
  if (item.privateKey) {
    const parsed = parseOpenSshEd25519(item.privateKey);
    return { publicBlob: parsed.publicBlob, comment: item.title || parsed.comment || 'hidden-door-vault' };
  }
  throw new Error('No valid Ed25519 key found.');
}

function signSshChallenge(privateKeyPem, data) {
  const parsed = parseOpenSshEd25519(privateKeyPem);
  const sig = crypto.sign(null, data, parsed.keyObject);
  return Buffer.concat([sshString('ssh-ed25519'), sshString(sig)]);
}

class SshAgentServer {
  constructor({ socketPath, getVault, getUnlockedSshItems, ensureUnlocked, onActivity }) {
    this.socketPath = socketPath;
    this.getVault = getVault;
    this.getUnlockedSshItems = getUnlockedSshItems;
    this.ensureUnlocked = ensureUnlocked;
    this.onActivity = onActivity;
    this.server = null;
    this.enabled = false;
  }

  async start() {
    if (this.server) return;
    // sun_path is 108 bytes on Linux and 104 on macOS; a longer path silently fails or truncates.
    if (Buffer.byteLength(this.socketPath) > 100) throw new Error(`Socket path is too long for a Unix domain socket: ${this.socketPath}`);
    try { await fs.unlink(this.socketPath); } catch (_) {}
    this.server = net.createServer(socket => this.handleConnection(socket));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.socketPath, () => {
        this.server.removeListener('error', reject);
        resolve();
      });
    });
    await fs.chmod(this.socketPath, 0o600);
    this.enabled = true;
  }

  async stop() {
    this.enabled = false;
    if (!this.server) return;
    const s = this.server;
    this.server = null;
    await new Promise(resolve => s.close(() => resolve()));
    try { await fs.unlink(this.socketPath); } catch (_) {}
  }

  listSshRecords() {
    if (typeof this.getUnlockedSshItems === 'function') {
      const items = this.getUnlockedSshItems() || [];
      const out = [];
      for (const full of items) {
        if (!full || full.kind !== 'ssh' || full.archived || !full.privateKey) continue;
        try {
          const { publicBlob, comment } = extractPublicBlob(full);
          out.push({ item: full, publicBlob, comment: full.title || comment });
        } catch (_) {}
      }
      return out;
    }
    const vault = this.getVault?.();
    if (!vault || !vault.unlocked) return [];
    const out = [];
    for (const summary of vault.list()) {
      if (summary.kind !== 'ssh' || summary.archived) continue;
      try {
        const full = vault.get(summary.id);
        if (!full.privateKey) continue;
        const { publicBlob, comment } = extractPublicBlob(full);
        out.push({ item: full, publicBlob, comment: full.title || comment });
      } catch (_) {}
    }
    return out;
  }

  handleConnection(socket) {
    let buffer = Buffer.alloc(0);
    let processing = false;
    const queue = [];

    const drain = async () => {
      if (processing) return;
      processing = true;
      try {
        while (queue.length && !socket.destroyed) {
          const msg = queue.shift();
          const reply = await this.processMessage(msg);
          if (!socket.destroyed) socket.write(reply);
        }
      } catch (_) {
        if (!socket.destroyed) socket.destroy();
      } finally {
        processing = false;
      }
    };

    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 512 * 1024) { socket.destroy(); return; }
      while (buffer.length >= 4) {
        const msgLen = buffer.readUInt32BE(0);
        if (msgLen < 1 || msgLen > 256 * 1024) { socket.destroy(); return; }
        if (buffer.length < 4 + msgLen) break;
        const msg = buffer.subarray(4, 4 + msgLen);
        buffer = buffer.subarray(4 + msgLen);
        queue.push(msg);
      }
      drain();
    });
    socket.on('error', () => {});
  }

  async processMessage(msg) {
    const type = msg[0];
    const payload = msg.subarray(1);
    try {
      if (type === SSH_AGENTC_REQUEST_IDENTITIES) {
        const vault = this.getVault?.();
        if (vault && !vault.unlocked && this.ensureUnlocked) {
          try { await this.ensureUnlocked('list SSH keys for SSH agent'); } catch (_) {}
        }
        const entries = this.listSshRecords();
        const parts = [uint32(entries.length)];
        for (const entry of entries) {
          parts.push(sshString(entry.publicBlob), sshString(entry.comment));
        }
        return frameMessage(SSH_AGENT_IDENTITIES_ANSWER, Buffer.concat(parts));
      }
      if (type === SSH_AGENTC_SIGN_REQUEST) {
        const r = new BufferReader(payload);
        const keyBlob = r.readString();
        const data = r.readString();
        r.readUInt32(); // flags
        const vault = this.getVault?.();
        if (!this.getUnlockedSshItems) {
          if (!vault) return frameMessage(SSH_AGENT_FAILURE);
          if (!vault.unlocked && this.ensureUnlocked) {
            try { await this.ensureUnlocked('sign an SSH challenge'); } catch (_) {}
          }
          if (!vault.unlocked) return frameMessage(SSH_AGENT_FAILURE);
        }
        const entries = this.listSshRecords();
        const match = entries.find(e => e.publicBlob.equals(keyBlob));
        if (!match) return frameMessage(SSH_AGENT_FAILURE);
        this.onActivity?.();
        const sigBlob = signSshChallenge(match.item.privateKey, data);
        return frameMessage(SSH_AGENT_SIGN_RESPONSE, sshString(sigBlob));
      }
      return frameMessage(SSH_AGENT_FAILURE);
    } catch (_) {
      return frameMessage(SSH_AGENT_FAILURE);
    }
  }
}

module.exports = {
  SshAgentServer,
  BufferReader,
  SSH_AGENT_FAILURE,
  SSH_AGENTC_REQUEST_IDENTITIES,
  SSH_AGENT_IDENTITIES_ANSWER,
  SSH_AGENTC_SIGN_REQUEST,
  SSH_AGENT_SIGN_RESPONSE,
  parseOpenSshEd25519,
  extractPublicBlob,
  signSshChallenge,
  sshString,
  uint32,
  frameMessage
};
