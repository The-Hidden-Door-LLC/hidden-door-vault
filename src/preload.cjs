'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const CHANNELS = new Set(['status', 'configure', 'import-oauth', 'google-login', 'google-cancel', 'google-logout', 'vault-probe', 'vault-create', 'vault-rekey', 'vault-unlock', 'vault-lock', 'biometric-enable', 'biometric-disable', 'biometric-unlock', 'vault-list', 'vault-get', 'vault-save', 'vault-archive', 'vault-delete', 'vault-refresh', 'generate-password', 'generate-token', 'generate-ssh', 'passkey-create', 'bridge-config', 'install-browser', 'totp', 'copy', 'open-website', 'backup-export', 'backup-restore', 'csv-import', 'cards-csv-import', 'import-preview', 'import-run', 'import-stop', 'import-cancel', 'ssh-export', 'ssh-local', 'ssh-local-key', 'ssh-local-remove', 'config-local', 'config-local-file', 'config-local-remove', 'prune-config', 'prune-run', 'prune-stop', 'cost-recount', 'set-startup']);
contextBridge.exposeInMainWorld('vaultAPI', Object.freeze({
  platform: process.platform,
  call(channel, payload) { if (!CHANNELS.has(channel)) return Promise.reject(new Error('Unknown action.')); return ipcRenderer.invoke(`hdv:${channel}`, payload); },
  activity() { ipcRenderer.send('hdv:activity'); },
  onSynced(callback) { if (typeof callback !== 'function') return; const listener = (_event, payload) => callback(payload); ipcRenderer.on('hdv:synced', listener); return () => ipcRenderer.removeListener('hdv:synced', listener); },
  onProgress(callback) { if (typeof callback !== 'function') return; const listener = (_event, payload) => callback(payload); ipcRenderer.on('hdv:progress', listener); return () => ipcRenderer.removeListener('hdv:progress', listener); },
  onLock(callback) { if (typeof callback !== 'function') return; const listener = () => callback(); ipcRenderer.on('hdv:locked', listener); return () => ipcRenderer.removeListener('hdv:locked', listener); },
  onAutoTouchId(callback) { if (typeof callback !== 'function') return; const listener = () => callback(); ipcRenderer.on('hdv:auto-touchid', listener); return () => ipcRenderer.removeListener('hdv:auto-touchid', listener); }
}));
