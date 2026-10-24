'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const G = require('../src/core/generators.cjs');
const R = require('../src/core/records.cjs');
const S = require('../src/core/ssh-agent.cjs');

function sendAgentMessage(socketPath, payload) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(socketPath);
    let buf = Buffer.alloc(0);
    sock.on('connect', () => {
      const frame = Buffer.alloc(4 + payload.length);
      frame.writeUInt32BE(payload.length, 0);
      payload.copy(frame, 4);
      sock.write(frame);
    });
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (buf.length >= 4 + len) {
          const reply = buf.subarray(4, 4 + len);
          sock.end();
          resolve(reply);
        }
      }
    });
    sock.on('error', reject);
  });
}

test('OpenSSH agent lists Ed25519 vault keys and signs challenges over Unix socket', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdv-ssh-'));
  const socketPath = path.join(dir, 'ssh.sock');
  const pair = G.ssh('agent-test@hdv');
  const item = R.normalize({
    kind: 'ssh',
    title: 'Prod SSH',
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    fingerprint: pair.fingerprint
  });

  const server = new S.SshAgentServer({
    socketPath,
    getUnlockedSshItems: () => [item]
  });
  await server.start();

  try {
    const mode = fs.statSync(socketPath).mode & 0o777;
    assert.equal(mode, 0o600);

    // 1. Request identities (11 -> 12)
    const idReply = await sendAgentMessage(socketPath, Buffer.from([S.SSH_AGENTC_REQUEST_IDENTITIES]));
    assert.equal(idReply[0], S.SSH_AGENT_IDENTITIES_ANSWER);
    const r1 = new S.BufferReader(idReply.subarray(1));
    const count = r1.readUInt32();
    assert.equal(count, 1);
    const pubBlob = r1.readString();
    const comment = r1.readString();
    assert.equal(comment.toString('utf8'), 'Prod SSH');

    // 2. Sign challenge (13 -> 14)
    const challenge = Buffer.from('git-ssh-authentication-data-987654');
    const signReq = Buffer.concat([
      Buffer.from([S.SSH_AGENTC_SIGN_REQUEST]),
      S.sshString(pubBlob),
      S.sshString(challenge),
      S.uint32(0)
    ]);
    const signReply = await sendAgentMessage(socketPath, signReq);
    assert.equal(signReply[0], S.SSH_AGENT_SIGN_RESPONSE);
    const r2 = new S.BufferReader(signReply.subarray(1));
    const sigBlob = r2.readString();
    const r3 = new S.BufferReader(sigBlob);
    const alg = r3.readString();
    const rawSig = r3.readString();
    assert.equal(alg.toString('utf8'), 'ssh-ed25519');
    assert.equal(rawSig.length, 64);

    // Verify signature using the parsed Ed25519 key
    const parsedKey = S.parseOpenSshEd25519(pair.privateKey);
    const pubKeyObj = crypto.createPublicKey(parsedKey.keyObject);
    assert.equal(crypto.verify(null, challenge, pubKeyObj, rawSig), true);
  } finally {
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
