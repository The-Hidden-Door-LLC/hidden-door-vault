'use strict';
const crc32c = require('../src/core/crc32c.cjs');
class FakeGoogle {
  // Live Secret Manager returns names as projects/<PROJECT_NUMBER>/secrets/<id> regardless of
  // whether the request used the project ID. The mock does the same so tests cannot pass on an
  // assumption the real API breaks (observed 2026-10-14 against a real project).
  constructor({ projectNumber = '553237645697', projectId = 'test-project-123' } = {}) { this.secrets = new Map(); this.calls = []; this.revision = 0; this.corruptAccess = false; this.failChecksum = false; this.denyDestroy = false; this.denyDelete = false; this.projectNumber = projectNumber; this.projectId = projectId; }
  canonical(route) { return route.replace(/^projects\/[^/]+\//, `projects/${this.projectNumber}/`); }
  meta(secret) { return structuredClone({ name: secret.name, labels: secret.labels, etag: secret.etag, versionAliases: secret.aliases, ...(secret.destroyTtl ? { versionDestroyTtl: secret.destroyTtl } : {}) }); }
  version(secret, i) { const v = secret.versions[i]; return { name: `${secret.name}/versions/${i + 1}`, createTime: v.createTime, state: v.state, etag: v.etag, ...(v.scheduledDestroyTime ? { scheduledDestroyTime: v.scheduledDestroyTime } : {}) }; }
  enabledVersions(secret) { return secret.versions.filter(v => v.state === 'ENABLED').length; }
  error(status) { return Response.json({ error: { code: status } }, { status }); }
  fetch = async (urlInput, options) => {
    const url = new URL(urlInput), route = this.canonical(url.pathname.replace('/v1/', '')), method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    this.calls.push({ url: url.toString(), method, body });
    if (options.headers.Authorization !== 'Bearer test-access-token') return this.error(401);
    if (method === 'POST' && /\/secrets$/.test(route)) {
      const id = url.searchParams.get('secretId'), name = `${route}/${id}`;
      if (this.secrets.has(name)) return this.error(409);
      const secret = { name, labels: body.labels, etag: `"${++this.revision}"`, aliases: {}, versions: [], destroyTtl: null }; this.secrets.set(name, secret); return Response.json(this.meta(secret));
    }
    if (method === 'GET' && /\/secrets$/.test(route)) {
      const name = /labels.hdv_vault="?([a-z0-9-]+)"?/.exec(url.searchParams.get('filter'))?.[1];
      const all = [...this.secrets.values()].filter(s => s.name.startsWith(`${route}/`) && s.labels.hdv_vault === name).map(s => this.meta(s));
      const start = Number(url.searchParams.get('pageToken') || 0), pageSize = 2;
      return Response.json({ secrets: all.slice(start, start + pageSize), ...(start + pageSize < all.length ? { nextPageToken: String(start + pageSize) } : {}) });
    }
    const access = /^(.*)\/versions\/([0-9]+):access$/.exec(route);
    if (access) {
      const secret = this.secrets.get(access[1]), version = secret?.versions[Number(access[2]) - 1]; if (!version) return this.error(404);
      if (version.state !== 'ENABLED') return this.error(400);
      const payload = { data: version.data, dataCrc32c: version.dataCrc32c }; if (this.corruptAccess) payload.dataCrc32c = '0';
      return Response.json({ name: `${secret.name}/versions/${access[2]}`, payload });
    }
    if (method === 'POST' && route.endsWith(':addVersion')) {
      const secret = this.secrets.get(route.slice(0, -11)); if (!secret) return this.error(404);
      if (crc32c(Buffer.from(body.payload.data, 'base64')) !== body.payload.dataCrc32c) return this.error(400);
      secret.versions.push({ ...structuredClone(body.payload), state: 'ENABLED', etag: `"v${++this.revision}"`, createTime: new Date(Date.UTC(2026, 0, 1) + secret.versions.length * 1000).toISOString() });
      return Response.json({ name: `${secret.name}/versions/${secret.versions.length}`, clientSpecifiedPayloadChecksum: !this.failChecksum });
    }
    const versions = /^(.*)\/versions$/.exec(route);
    if (method === 'GET' && versions) {
      const secret = this.secrets.get(versions[1]); if (!secret) return this.error(404);
      const filter = url.searchParams.get('filter') || '', want = (/state:\(?([A-Z OR]+)\)?/.exec(filter)?.[1] || '').split(/\s+OR\s+/).filter(Boolean);
      // Real API: newest first, filter is a substring match on the field; `state:(A OR B)` is the documented form.
      const all = secret.versions.map((v, i) => this.version(secret, i)).filter(v => !want.length || want.includes(v.state)).reverse();
      const start = Number(url.searchParams.get('pageToken') || 0), pageSize = 2;
      return Response.json({ versions: all.slice(start, start + pageSize), ...(start + pageSize < all.length ? { nextPageToken: String(start + pageSize) } : {}) });
    }
    const action = /^(.*)\/versions\/([0-9]+):(destroy|enable|disable)$/.exec(route);
    if (method === 'POST' && action) {
      const secret = this.secrets.get(action[1]), index = Number(action[2]) - 1, v = secret?.versions[index]; if (!v) return this.error(404);
      if (action[3] === 'destroy' && this.denyDestroy) return this.error(403);
      if (body?.etag && body.etag !== v.etag) return this.error(400);
      if (v.state === 'DESTROYED' || (action[3] === 'destroy' && v.scheduledDestroyTime)) return Response.json({ error: { code: 400, status: 'FAILED_PRECONDITION', message: 'SecretVersion is already scheduled for DESTRUCTION.' } }, { status: 400 });
      v.etag = `"v${++this.revision}"`;
      if (action[3] === 'destroy') { if (secret.destroyTtl) { v.state = 'DISABLED'; v.scheduledDestroyTime = new Date(Date.now() + Number.parseInt(secret.destroyTtl, 10) * 1000).toISOString(); } else { v.state = 'DESTROYED'; delete v.data; } }
      else if (action[3] === 'enable') { v.state = 'ENABLED'; delete v.scheduledDestroyTime; }
      else v.state = 'DISABLED';
      return Response.json(this.version(secret, index));
    }
    const secret = this.secrets.get(route); if (!secret) return this.error(404);
    if (method === 'DELETE') {
      if (this.denyDelete) return this.error(403);
      const etag = url.searchParams.get('etag');
      if (etag && etag !== secret.etag) return this.error(409);
      this.secrets.delete(route);
      return Response.json({});
    }
    if (method === 'PATCH') {
      if (body.etag !== secret.etag) return this.error(409);
      const mask = url.searchParams.get('updateMask') || '';
      if (mask === 'versionAliases') secret.aliases = structuredClone(body.versionAliases);
      else if (mask === 'versionAliases,labels') { secret.aliases = structuredClone(body.versionAliases || {}); secret.labels = structuredClone(body.labels || secret.labels); }
      else if (mask === 'version_destroy_ttl') { if (!/^[0-9]+s$/.test(body.versionDestroyTtl || '')) return this.error(400); secret.destroyTtl = body.versionDestroyTtl; }
      else return this.error(400);
      secret.etag = `"${++this.revision}"`; return Response.json(this.meta(secret));
    }
    if (method === 'GET') return Response.json(this.meta(secret));
    return this.error(400);
  };
}
class MemoryCache { constructor() { this.value = null; } async read() { return structuredClone(this.value); } async write(value) { this.value = structuredClone(value); } async clear() { this.value = null; } }
const fakeAuth = () => ({ token: async () => 'test-access-token', invalidate() {} });
module.exports = { FakeGoogle, MemoryCache, fakeAuth };
