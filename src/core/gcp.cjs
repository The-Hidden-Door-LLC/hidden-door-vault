'use strict';
const { fetchJSON } = require('./network.cjs');
const crc32c = require('./crc32c.cjs');
const { contextOf } = require('./crypto.cjs');
class SecretManager {
  constructor({ project, vault, auth, fetcher = globalThis.fetch }) {
    contextOf(project, vault); this.project = project; this.vault = vault; this.auth = auth; this.fetcher = fetcher;
    this.root = `projects/${project}/secrets`; this.prefix = `hdv1-${vault}-`; this.projectNumber = null;
  }
  resource(id) {
    if (typeof id !== 'string' || !id.startsWith(this.prefix) || !/^[a-z0-9-]{1,200}$/.test(id)) throw new Error('Invalid vault secret ID.');
    return `${this.root}/${id}`;
  }
  // Secret Manager answers with `projects/<PROJECT_NUMBER>/secrets/<id>` even when the
  // request used the project ID (confirmed live 2026-10-14). Accept the configured ID or the
  // numeric project number, and pin the number once it has been seen so a response cannot
  // later point at a different project.
  secretId(name) {
    const match = typeof name === 'string' && /^projects\/([a-z0-9-]+)\/secrets\/([a-z0-9-]{1,255})$/.exec(name);
    if (!match) return null;
    const [, owner, id] = match;
    if (owner !== this.project) {
      if (!/^[0-9]{1,30}$/.test(owner)) return null;
      if (this.projectNumber && this.projectNumber !== owner) return null;
      this.projectNumber = owner;
    }
    if (!id.startsWith(this.prefix)) return null;
    // `hdv1-work-` is a prefix of `hdv1-work-x-…`: only the header or a UUID may follow the prefix.
    const rest = id.slice(this.prefix.length);
    return rest === 'header' || /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(rest) ? id : null;
  }
  owns(name) { return this.secretId(name) !== null; }
  async request(path, method = 'GET', body) {
    const root = /^projects\/([a-z0-9-]+)\/secrets(?=$|[/?])/.exec(path);
    if (!root || (root[1] !== this.project && root[1] !== this.projectNumber)) throw new Error('Unexpected resource.');
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.auth.token();
      try { return await fetchJSON(`https://secretmanager.googleapis.com/v1/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': this.project }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, this.fetcher); }
      catch (error) { if (error.status === 401 && attempt === 0) { this.auth.invalidate(); continue; } throw error; }
    }
  }
  async get(id) { return this.request(this.resource(id)); }
  async list() {
    const results = []; let pageToken = '', pages = 0;
    do {
      const params = new URLSearchParams({ pageSize: '100', filter: `labels.hdv_app="hidden-door-vault" AND labels.hdv_vault="${this.vault}"` });
      if (pageToken) params.set('pageToken', pageToken);
      const data = await this.request(`${this.root}?${params}`);
      if (data.secrets && !Array.isArray(data.secrets)) throw new Error('Invalid secret list.');
      for (const meta of data.secrets || []) if (this.owns(meta.name)) results.push(meta);
      pageToken = data.nextPageToken || ''; if (typeof pageToken !== 'string' || ++pages > 100) throw new Error('Vault is too large to load safely.');
    } while (pageToken);
    return results;
  }
  async create(id, role = 'item') {
    this.resource(id);
    return this.request(`${this.root}?${new URLSearchParams({ secretId: id })}`, 'POST', { replication: { automatic: {} }, labels: { hdv_app: 'hidden-door-vault', hdv_vault: this.vault, hdv_role: role } });
  }
  async access(meta) {
    const id = this.secretId(meta?.name); if (!id) throw new Error('Invalid vault secret ID.');
    const active = String(meta.versionAliases?.active || '');
    if (!/^[1-9][0-9]*$/.test(active)) throw new Error('A vault secret has no committed active version. Check for an interrupted first save in Cloud Console.');
    const data = await this.request(`${meta.name}/versions/${active}:access`);
    if (!data.payload || typeof data.payload.data !== 'string' || data.payload.data.length > 90000) throw new Error('Invalid Secret Manager payload.');
    const bytes = Buffer.from(data.payload.data, 'base64');
    if (bytes.length > 65536 || data.payload.dataCrc32c === undefined || crc32c(bytes) !== String(data.payload.dataCrc32c)) throw new Error('Secret Manager integrity check failed.');
    try { return JSON.parse(bytes.toString('utf8')); } finally { bytes.fill(0); }
  }
  // Version pruning. Secret Manager bills every ENABLED or DISABLED version; only DESTROYED is
  // free. With a versionDestroyTtl on the secret, :destroy disables the version and schedules
  // destruction (scheduledDestroyTime), and :enable before that time cancels it.
  versionNumber(name, meta) {
    const match = typeof name === 'string' && name.startsWith(`${meta.name}/versions/`) && /^[1-9][0-9]*$/.test(name.slice(meta.name.length + 10)) ? name.slice(meta.name.length + 10) : null;
    return match;
  }
  // `billable: true` also returns DISABLED versions (including those scheduled for destruction):
  // Google bills ENABLED and DISABLED alike; only DESTROYED is free.
  async listVersions(meta, { billable = false } = {}) {
    const id = this.secretId(meta?.name); if (!id) throw new Error('Invalid vault secret ID.');
    const results = [], states = billable ? ['ENABLED', 'DISABLED'] : ['ENABLED']; let pageToken = '', pages = 0;
    do {
      const params = new URLSearchParams({ pageSize: '100', filter: billable ? 'state:(ENABLED OR DISABLED)' : 'state:ENABLED' });
      if (pageToken) params.set('pageToken', pageToken);
      const data = await this.request(`${meta.name}/versions?${params}`);
      if (data.versions && !Array.isArray(data.versions)) throw new Error('Invalid version list.');
      for (const v of data.versions || []) {
        const number = this.versionNumber(v.name, meta);
        if (number && states.includes(v.state)) results.push({ name: v.name, number, state: v.state, createTime: v.createTime || '', etag: typeof v.etag === 'string' ? v.etag : '', scheduledDestroyTime: typeof v.scheduledDestroyTime === 'string' ? v.scheduledDestroyTime : '' });
      }
      pageToken = data.nextPageToken || ''; if (typeof pageToken !== 'string' || ++pages > 100) throw new Error('Too many secret versions to prune safely.');
    } while (pageToken);
    return results;
  }
  async destroyVersion(meta, number, etag) {
    const id = this.secretId(meta?.name); if (!id) throw new Error('Invalid vault secret ID.');
    if (!/^[1-9][0-9]*$/.test(String(number))) throw new Error('Invalid secret version.');
    // Independent of the caller: the committed version is never destroyed by this adapter.
    if (String(number) === String(meta.versionAliases?.active)) throw new Error('Refusing to destroy the active version.');
    return this.request(`${meta.name}/versions/${number}:destroy`, 'POST', etag ? { etag } : {});
  }
  async setDestroyTtl(meta, seconds) {
    const id = this.secretId(meta?.name); if (!id) throw new Error('Invalid vault secret ID.');
    if (typeof meta.etag !== 'string' || !meta.etag) throw new Error('Cannot update without a revision token.');
    if (!Number.isInteger(seconds) || seconds < 86400 || seconds > 1000 * 86400) throw new Error('Destroy delay must be between 1 and 1000 days.');
    return this.request(`${meta.name}?updateMask=version_destroy_ttl`, 'PATCH', { name: meta.name, etag: meta.etag, versionDestroyTtl: `${seconds}s` });
  }
  async commit(meta, payload) {
    const id = this.secretId(meta?.name); if (!id) throw new Error('Invalid vault secret ID.');
    if (typeof meta.etag !== 'string' || !meta.etag) throw new Error('Cannot save without a revision token.');
    const bytes = Buffer.from(JSON.stringify(payload));
    if (bytes.length > 65536) throw new Error('Encrypted item exceeds 64 KiB.');
    const version = await this.request(`${meta.name}:addVersion`, 'POST', { payload: { data: bytes.toString('base64'), dataCrc32c: crc32c(bytes) } });
    if (version.clientSpecifiedPayloadChecksum !== true) throw new Error('Google did not confirm the write checksum. The new version was not activated.');
    const number = version.name?.split('/').pop();
    if (!/^[1-9][0-9]*$/.test(number || '')) throw new Error('Invalid new secret version.');
    const aliases = { ...(meta.versionAliases || {}), active: number };
    // `active`, not `latest`, is authoritative. The ETag makes activation compare-and-swap.
    try { return await this.request(`${meta.name}?updateMask=versionAliases`, 'PATCH', { name: meta.name, etag: meta.etag, versionAliases: aliases }); }
    catch (error) {
      // Resolve a lost PATCH response without re-issuing a potentially stale mutation.
      try { const current = await this.get(id); if (String(current.versionAliases?.active) === number) return current; } catch (_) {}
      throw error;
    }
  }
  async deleteSecret(meta) {
    const id = this.secretId(meta?.name); if (!id) throw new Error('Invalid vault secret ID.');
    if (id === `${this.prefix}header`) throw new Error('Refusing to delete the vault header.');
    try {
      await this.request(meta.name, 'DELETE');
      return { deleted: true, mode: 'deleted' };
    } catch (error) {
      if (error.status === 404) return { deleted: true, mode: 'not-found' };
      if (error.status !== 403) throw error;
    }
    // Fallback if custom IAM role was created before secretmanager.secrets.delete was added:
    // Clear versionAliases, mark hdv_deleted=true, and destroy all enabled versions.
    const current = meta.etag ? meta : await this.get(id);
    const labels = { ...(current.labels || {}), hdv_deleted: 'true' };
    const updated = await this.request(`${current.name}?updateMask=versionAliases,labels`, 'PATCH', {
      name: current.name,
      etag: current.etag,
      versionAliases: {},
      labels
    });
    try {
      const versions = await this.listVersions(updated);
      for (const v of versions) {
        try { await this.destroyVersion(updated, v.number, v.etag); } catch (_) {}
      }
    } catch (_) {}
    return { deleted: true, mode: 'tombstoned' };
  }
}
module.exports = { SecretManager };
