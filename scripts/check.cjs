'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'); let files = 0;
function walk(directory) { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const filename = path.join(directory, entry.name); if (entry.isDirectory()) walk(filename); else if (/\.(cjs|js)$/.test(filename)) { execFileSync(process.execPath, ['--check', filename], { stdio: 'pipe' }); files++; } } }
for (const folder of ['src', 'bin', 'extension', 'scripts', 'tests']) walk(path.join(root, folder));
const main = fs.readFileSync(path.join(root, 'src/main.cjs'), 'utf8'), preload = fs.readFileSync(path.join(root, 'src/preload.cjs'), 'utf8'), ui = fs.readFileSync(path.join(root, 'src/ui/app.js'), 'utf8'), html = fs.readFileSync(path.join(root, 'src/ui/index.html'), 'utf8');
for (const required of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'webSecurity: true', 'setWindowOpenHandler', 'setPermissionRequestHandler', 'frame && frame === win.webContents.mainFrame', 'lock-screen', 'setContentProtection(true)']) if (!main.includes(required)) throw new Error(`Missing static security guard: ${required}`);
if (!preload.includes('CHANNELS.has(channel)')) throw new Error('IPC channel allowlist missing.');
for (const bad of ['innerHTML', 'eval(', 'Math.random(', 'localStorage', 'sessionStorage']) if (ui.includes(bad)) throw new Error(`Unsafe/unexpected renderer pattern: ${bad}`);
if (!html.includes("connect-src 'none'") || !html.includes("default-src 'none'")) throw new Error('Restrictive CSP missing.');
console.log(`PASS: ${files} JavaScript files parsed; static renderer/IPC/lock/CSP guards present. This is not a security audit.`);
