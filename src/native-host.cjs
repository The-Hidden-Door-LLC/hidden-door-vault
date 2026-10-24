#!/usr/bin/env node
'use strict';
const { sendBridgeRequest } = require('./core/bridge.cjs');

function writeMessage(obj) {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]));
}

let buffer = Buffer.alloc(0);
let pending = 0;
let stdinEnded = false;

function maybeExit() {
  if (stdinEnded && pending === 0) process.exit(0);
}

async function handleMessage(rawJson) {
  pending++;
  let req;
  try {
    req = JSON.parse(rawJson.toString('utf8'));
  } catch {
    writeMessage({ ok: false, error: 'Invalid Native Messaging JSON.' });
    pending--;
    maybeExit();
    return;
  }
  const id = req.id ?? null;
  try {
    if (typeof req.action === 'string' && req.action.startsWith('documents-')) throw new Error('Document files use the local desktop socket, not browser-extension Native Messaging.');
    const data = await sendBridgeRequest(req.action, req.payload || {});
    writeMessage({ id, ok: true, data, result: data });
  } catch (error) {
    writeMessage({ id, ok: false, error: String(error?.message || 'Vault communication failed.') });
  } finally {
    pending--;
    maybeExit();
  }
}

process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const len = buffer.readUInt32LE(0);
    if (len > 4 * 1024 * 1024) {
      writeMessage({ ok: false, error: 'Native message exceeds 4 MiB limit.' });
      process.exit(1);
    }
    if (buffer.length < 4 + len) break;
    const msg = buffer.subarray(4, 4 + len);
    buffer = buffer.subarray(4 + len);
    handleMessage(msg);
  }
});

process.stdin.on('end', () => {
  stdinEnded = true;
  maybeExit();
});
