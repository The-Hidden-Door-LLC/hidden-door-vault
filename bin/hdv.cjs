#!/usr/bin/env node
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { sendBridgeRequest, defaultSocketPath, defaultSshSocketPath } = require('../src/core/bridge.cjs');
const { installBrowserIntegration } = require('../src/core/browser-host.cjs');
const generators = require('../src/core/generators.cjs');

const BOOLEAN_FLAGS = new Set([
  'help', 'json', 'recovery', 'offline', 'archived', 'no-newline',
  'no-symbols', 'no-digits', 'no-upper', 'no-lower', 'avoid-ambiguous',
  'generate-password', 'generate-token', 'generate-ssh', 'favorite'
]);

function parseArgs(argv) {
  const dashDash = argv.indexOf('--');
  const mainArgs = dashDash === -1 ? argv : argv.slice(0, dashDash);
  const restCommand = dashDash === -1 ? [] : argv.slice(dashDash + 1);
  const positionals = [];
  const flags = {};
  for (let i = 0; i < mainArgs.length; i++) {
    const arg = mainArgs[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const key = arg.slice(2);
        const next = mainArgs[i + 1];
        if (!BOOLEAN_FLAGS.has(key) && next !== undefined) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (arg === '-f' && mainArgs[i + 1]) {
      flags.field = mainArgs[++i];
    } else if (arg === '-j') {
      flags.json = true;
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags, restCommand };
}

function printHelp() {
  process.stdout.write([
    'Hidden Door Vault CLI (hdv)',
    '',
    'Usage:',
    '  hdv status [--json]',
    '  hdv unlock [--password <pw>] [--recovery] [--offline]',
    '  hdv lock',
    '  hdv list [--kind <login|card|ssh|api|recovery|note>] [--search <query>] [--archived] [--json]',
    '  hdv get <id-or-title> [--field <field>] [--json]',
    '  hdv read hdv://<vault>/<item>/<field>',
    '  hdv totp <id-or-title> [--json]',
    '  hdv generate [password|token|ssh] [--length <16-128>] [--no-symbols] [--avoid-ambiguous] [--bytes <32|48|64>] [--format <base64url|hex>] [--comment <c>] [--json]',
    '  hdv create <login|api|recovery|note|ssh|card> --title <title> [--username <u>] [--password <p> | --generate-password] [--url <u>] [--totp <s>] [--token <t> | --generate-token] [--recovery-codes <c>] [--notes <n>] [--tags <t>] [--favorite] [--json]',
    '  hdv edit <id-or-title> [--title <t>] [--username <u>] [--password <p> | --generate-password] [--url <u>] [--totp <s>] [--recovery-codes <c>] [--notes <n>] [--tags <t>] [--json]',
    '  hdv run [--env-file <path>] -- <command> [args...]',
    '  hdv ssh-env',
    '  hdv install-browser [--extension-id <id>] [--json]',
    ''
  ].join('\n'));
}

function parseEnvFile(content) {
  const out = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const cleaned = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = cleaned.indexOf('=');
    if (eq === -1) continue;
    const key = cleaned.slice(0, eq).trim();
    let val = cleaned.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

async function runCli(argv = process.argv.slice(2)) {
  const { positionals, flags, restCommand } = parseArgs(argv);
  const cmd = positionals[0] || (flags.help ? 'help' : '');
  if (!cmd || cmd === 'help' || flags.help) {
    printHelp();
    return 0;
  }

  if (cmd === 'ssh-env') {
    const sock = defaultSshSocketPath();
    process.stdout.write(`export SSH_AUTH_SOCK=${JSON.stringify(sock)}\n`);
    return 0;
  }

  if (cmd === 'install-browser') {
    const extraIds = flags['extension-id'] ? String(flags['extension-id']).split(',').map(s => s.trim()) : [];
    const result = await installBrowserIntegration({ extensionIds: extraIds });
    if (flags.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      process.stdout.write(`Installed Native Messaging host (${result.hostName})\n`);
      process.stdout.write(`Unpacked Extension Path: ${result.extensionDir}\n`);
      process.stdout.write(`Extension ID:            ${result.extensionId}\n`);
      process.stdout.write(`CLI Binary (PATH):       ${result.cliLinkPath}\n`);
      process.stdout.write(`CLI Wrapper:             ${result.cliWrapper}\n`);
      for (const item of result.installed) {
        process.stdout.write(`  [${item.browser}] ${item.manifestPath}\n`);
      }
    }
    return 0;
  }

  if (cmd === 'generate') {
    const sub = positionals[1] || 'password';
    let res;
    if (sub === 'password') {
      res = generators.password({
        length: flags.length ? Number(flags.length) : 32,
        symbols: flags['no-symbols'] ? false : true,
        digits: flags['no-digits'] ? false : true,
        upper: flags['no-upper'] ? false : true,
        lower: flags['no-lower'] ? false : true,
        avoidAmbiguous: Boolean(flags['avoid-ambiguous'])
      });
      if (flags.json) process.stdout.write(JSON.stringify(res, null, 2) + '\n');
      else process.stdout.write(res.value + '\n');
      return 0;
    }
    if (sub === 'token') {
      res = generators.token({
        bytes: flags.bytes ? Number(flags.bytes) : 32,
        format: flags.format || 'base64url'
      });
      if (flags.json) process.stdout.write(JSON.stringify(res, null, 2) + '\n');
      else process.stdout.write(res.value + '\n');
      return 0;
    }
    if (sub === 'ssh') {
      res = generators.ssh(flags.comment ? String(flags.comment) : 'hidden-door-vault');
      if (flags.json) process.stdout.write(JSON.stringify(res, null, 2) + '\n');
      else process.stdout.write(`${res.publicKey}\n${res.fingerprint}\n`);
      return 0;
    }
    throw new Error(`Unknown generator type "${sub}". Use password, token, or ssh.`);
  }

  if (cmd === 'status') {
    const data = await sendBridgeRequest('status', {});
    if (flags.json) {
      process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    } else {
      process.stdout.write([
        `Vault:      ${data.vault || '(unconfigured)'} (${data.unlocked ? (data.offline ? 'unlocked offline' : 'unlocked') : 'locked'})`,
        `Project:    ${data.project || '(none)'}`,
        `Items:      ${data.unlocked ? data.itemCount : '(locked)'}`,
        `IPC Socket: ${data.socketPath || defaultSocketPath()}`,
        `SSH Agent:  ${data.sshSocketPath || defaultSshSocketPath()}`
      ].join('\n') + '\n');
    }
    return 0;
  }

  if (cmd === 'lock') {
    await sendBridgeRequest('lock', {});
    if (flags.json) process.stdout.write(JSON.stringify({ unlocked: false }) + '\n');
    else process.stdout.write('Vault locked.\n');
    return 0;
  }

  if (cmd === 'unlock') {
    const credential = typeof flags.password === 'string' ? flags.password : (typeof flags.recovery === 'string' ? flags.recovery : '');
    const recovery = Boolean(flags.recovery);
    const data = await sendBridgeRequest('unlock', {
      credential,
      recovery,
      offline: Boolean(flags.offline)
    });
    if (flags.json) process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    else process.stdout.write(`Vault unlocked (${data.count} items).\n`);
    return 0;
  }

  if (cmd === 'list' || cmd === 'ls') {
    const items = await sendBridgeRequest('list', {
      kind: flags.kind || '',
      search: flags.search || positionals[1] || '',
      includeArchived: Boolean(flags.archived)
    });
    if (flags.json) {
      process.stdout.write(JSON.stringify(items, null, 2) + '\n');
    } else if (!items.length) {
      process.stdout.write('No matching items.\n');
    } else {
      for (const item of items) {
        const badge = item.hasPasskey ? ' [passkey]' : '';
        process.stdout.write(`${item.id.slice(0, 8)}  [${item.kind.padEnd(5)}]  ${item.title.padEnd(28)}  ${item.subtitle}${badge}\n`);
      }
    }
    return 0;
  }

  if (cmd === 'get') {
    const target = positionals[1];
    if (!target) throw new Error('Usage: hdv get <id-or-title> [--field <field>] [--json]');
    const data = await sendBridgeRequest('get', {
      id: target,
      title: target,
      field: flags.field || ''
    });
    if (flags.field) {
      if (flags.json) process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      else process.stdout.write(String(data.value) + '\n');
    } else if (flags.json) {
      process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    } else {
      process.stdout.write(`Title:    ${data.title}\nKind:     ${data.kind}\nID:       ${data.id}\n`);
      if (data.username) process.stdout.write(`Username: ${data.username}\n`);
      if (data.url) process.stdout.write(`URL:      ${data.url}\n`);
      if (data.passkeyId) process.stdout.write(`Passkey:  ${data.passkeyRpId} (${data.passkeyAlgorithm || 'ES256'}, ID ${data.passkeyId.slice(0, 12)}…)\n`);
      if (data.fingerprint) process.stdout.write(`SSH FP:   ${data.fingerprint}\n`);
      if (data.tags) process.stdout.write(`Tags:     ${data.tags}\n`);
      if (data.notes) process.stdout.write(`Notes:    ${data.notes}\n`);
    }
    return 0;
  }

  if (cmd === 'read') {
    const ref = positionals[1];
    if (!ref) throw new Error('Usage: hdv read hdv://<vault>/<item>/<field>');
    const data = await sendBridgeRequest('read-ref', { ref });
    if (flags.json) process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    else process.stdout.write(String(data.value) + (flags['no-newline'] ? '' : '\n'));
    return 0;
  }

  if (cmd === 'totp' || cmd === 'otp') {
    const target = positionals[1];
    if (!target) throw new Error('Usage: hdv totp <id-or-title>');
    const data = await sendBridgeRequest('totp', { id: target, title: target });
    if (flags.json) process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    else process.stdout.write(`${data.value}\n`);
    return 0;
  }

  if (cmd === 'create' || cmd === 'add') {
    const kind = flags.kind ? String(flags.kind) : (positionals[1] || 'login');
    const title = flags.title || (flags.kind ? positionals[1] : positionals[2]);
    if (!title) throw new Error('Usage: hdv create <login|api|recovery|note|ssh|card> --title <title> [options]');
    const item = {
      kind,
      title: String(title),
      username: flags.username ? String(flags.username) : '',
      url: flags.url ? String(flags.url) : '',
      password: flags.password ? String(flags.password) : (flags['generate-password'] ? generators.password({ length: flags.length ? Number(flags.length) : 32 }).value : ''),
      totpSecret: flags.totp ? String(flags.totp) : '',
      token: flags.token ? String(flags.token) : (flags['generate-token'] ? generators.token().value : ''),
      recoveryCodes: flags['recovery-codes'] ? String(flags['recovery-codes']) : '',
      notes: flags.notes ? String(flags.notes) : '',
      tags: flags.tags ? String(flags.tags) : '',
      favorite: Boolean(flags.favorite)
    };
    if (kind === 'ssh' && flags['generate-ssh'] !== false && !flags['private-key']) {
      const pair = generators.ssh(flags.comment ? String(flags.comment) : String(title));
      item.publicKey = pair.publicKey;
      item.privateKey = pair.privateKey;
      item.fingerprint = pair.fingerprint;
    }
    const saved = await sendBridgeRequest('save-item', { item });
    if (flags.json) process.stdout.write(JSON.stringify(saved, null, 2) + '\n');
    else process.stdout.write(`Created ${saved.kind} "${saved.title}" (${saved.id})\n`);
    return 0;
  }

  if (cmd === 'edit' || cmd === 'update') {
    const target = positionals[1];
    if (!target) throw new Error('Usage: hdv edit <id-or-title> [--title ...] [--password ... | --generate-password] [options]');
    const patch = {};
    for (const k of ['title', 'username', 'url', 'notes', 'tags']) {
      if (flags[k] !== undefined) patch[k] = String(flags[k]);
    }
    if (flags['recovery-codes'] !== undefined) patch.recoveryCodes = String(flags['recovery-codes']);
    if (flags.password !== undefined) patch.password = String(flags.password);
    else if (flags['generate-password']) patch.password = generators.password({ length: flags.length ? Number(flags.length) : 32 }).value;
    if (flags.totp !== undefined) patch.totpSecret = String(flags.totp);
    if (flags.token !== undefined) patch.token = String(flags.token);
    else if (flags['generate-token']) patch.token = generators.token().value;
    if (flags.favorite !== undefined) patch.favorite = Boolean(flags.favorite);

    const saved = await sendBridgeRequest('save-item', { target, item: patch });
    if (flags.json) process.stdout.write(JSON.stringify(saved, null, 2) + '\n');
    else process.stdout.write(`Updated ${saved.kind} "${saved.title}" (${saved.id})\n`);
    return 0;
  }

  if (cmd === 'run') {
    const command = restCommand.length ? restCommand : positionals.slice(1);
    if (!command.length) throw new Error('Usage: hdv run [--env-file <file>] -- <command> [args...]');
    const baseEnv = { ...process.env };
    if (flags['env-file']) {
      const fileEnv = parseEnvFile(fs.readFileSync(String(flags['env-file']), 'utf8'));
      Object.assign(baseEnv, fileEnv);
    }
    const refs = {};
    for (const [k, v] of Object.entries(baseEnv)) {
      if (typeof v === 'string' && v.startsWith('hdv://')) {
        refs[k] = v;
      }
    }
    if (Object.keys(refs).length > 0) {
      const { resolved } = await sendBridgeRequest('resolve-env', { refs });
      Object.assign(baseEnv, resolved);
    }
    return await new Promise((resolve, reject) => {
      const child = spawn(command[0], command.slice(1), {
        env: baseEnv,
        stdio: 'inherit'
      });
      child.on('error', reject);
      child.on('exit', (code, signal) => {
        if (signal) process.kill(process.pid, signal);
        else resolve(code ?? 0);
      });
    });
  }

  throw new Error(`Unknown command "${cmd}". Run "hdv --help" for usage.`);
}

if (require.main === module) {
  runCli().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(`hdv: ${error?.message || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { runCli, parseArgs, parseEnvFile };
