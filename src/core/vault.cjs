'use strict';
const { createHeader, rekeyHeader, unlockHeader, contextOf, validateHeader, encryptItem, decryptItem, encryptBackup, decryptBackup, seal, unseal } = require('./crypto.cjs');
const { normalize, summary, validId } = require('./records.cjs');
const { isDocumentRecord, manifestOf, failure } = require('./document-format.cjs');
const SKIP_PREFIX = 'Skipped items: ';
async function mapLimit(values, limit, task) {
  let cursor = 0; const results = new Array(values.length);
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => { for (;;) { const index = cursor++; if (index >= values.length) return; results[index] = await task(values[index], index); } }));
  return results;
}
class Vault {
  constructor({ project, vault, cloud, cache }) {
    this.project = project; this.vault = vault; this.context = contextOf(project, vault); this.cloud = cloud; this.cache = cache;
    this.prefix = `hdv1-${vault}-`; this.headerId = `${this.prefix}header`; this.header = null; this.key = null; this.records = new Map(); this.packets = new Map(); this.epoch = 0; this.offline = false; this.warnings = []; this.skipped = []; this.writing = false; this.stale = false;
    // Version pruning: 0 = off; otherwise keep this many ENABLED versions per secret after a save.
    this.pruneKeep = 0; this.pruneGraceSeconds = 3 * 86400; this.pruneDenied = false; this.lastPrune = null;
  }
  get unlocked() { return Boolean(this.key); }
  requireUnlocked() { if (!this.key) throw new Error('The vault is locked.'); }
  current(epoch) { if (epoch !== this.epoch) throw new Error('The vault was locked while this operation was in progress.'); }
  lock() { this.epoch++; this.key?.fill(0); this.key = null; this.header = null; this.records.clear(); this.packets.clear(); this.warnings = []; this.skipped = []; this.stale = false; }
  async probe(offline = false) {
    if (offline) { const cache = await this.cache.read(); return { exists: Boolean(cache?.header), offline: true }; }
    try { await this.cloud.get(this.headerId); return { exists: true, offline: false }; }
    catch (error) { if (error.status === 404) return { exists: false, offline: false }; throw error; }
  }
  async create(password) {
    if (this.writing) throw new Error('An operation is already in progress.');
    this.writing = true; this.lock(); const epoch = this.epoch; let created;
    try {
      created = await createHeader(password, this.context); this.current(epoch);
      const meta = await this.cloud.create(this.headerId, 'header'); this.current(epoch);
      await this.cloud.commit(meta, created.header);
      // From here the vault exists in Google. Never lose the recovery code after this point.
      if (this.epoch !== epoch) { created.key.fill(0); return { recoveryCode: created.recoveryCode, locked: true, warnings: ['The vault was created, but it was locked before the session opened. Unlock it with your master password.'] }; }
      this.header = created.header; this.key = created.key; this.offline = false;
      try { await this.writeCache(); } catch (_) { this.warnings = ['Vault created in Google, but the offline cache could not be written. Check local disk access.']; }
      return { recoveryCode: created.recoveryCode, warnings: this.warnings };
    } catch (error) { created?.key.fill(0); if (this.epoch === epoch) this.lock(); throw error; }
    finally { this.writing = false; }
  }
  // The vault key is already in memory while unlocked; the current credential is only a confirmation
  // that the caller owns the vault. Either wrapper counts: the master password or the HDV1- recovery
  // code, so a forgotten password can be replaced by whoever still holds the recovery code.
  async rekey(currentCredential, newPassword, recovery = false) {
    this.requireUnlocked();
    if (this.offline) throw new Error('Unlock online to change the master password.');
    if (this.writing) throw new Error('An operation is already in progress.');
    const epoch = this.epoch;
    let verified;
    try {
      verified = await unlockHeader(this.header, currentCredential, this.context, recovery === true);
    } catch (_) {
      throw new Error(recovery ? 'Recovery code is incorrect.' : 'Current master password is incorrect.');
    } finally {
      verified?.fill(0);
    }
    this.current(epoch);
    const rekeyed = await rekeyHeader(this.header, this.key, newPassword, this.context);
    this.current(epoch);
    this.writing = true;
    try {
      const meta = await this.cloud.get(this.headerId); this.current(epoch);
      if ((meta && this.header.generation && Number(this.header.generation) < 1)) throw new Error('Invalid header state.');
      await this.cloud.commit(meta, rekeyed.header); this.current(epoch);
      this.header = rekeyed.header;
      try { await this.writeCache(); } catch (_) { this.warnings = ['Master password updated in Google, but the offline cache could not be updated. Check local disk access.']; }
      this.current(epoch);
      if (this.pruneKeep > 0) { try { await this.pruneSecret(this.headerId, this.pruneKeep, epoch); } catch (_) {} }
      this.current(epoch);
      return { recoveryCode: rekeyed.recoveryCode, generation: rekeyed.header.generation };
    } finally {
      this.writing = false;
    }
  }
  async unlock(credential, recovery = false, offline = false) {
    this.lock(); const epoch = this.epoch; let key;
    try {
      let header, packets;
      if (offline) {
        const cache = await this.cache.read(); this.current(epoch);
        if (!cache || cache.schema !== 1 || cache.project !== this.project || cache.vault !== this.vault || !Array.isArray(cache.packets)) throw new Error('No compatible offline cache. Connect to Google and unlock once first.');
        header = validateHeader(cache.header); packets = cache.packets;
      } else {
        const meta = await this.cloud.get(this.headerId); this.current(epoch);
        header = validateHeader(await this.cloud.access(meta)); this.current(epoch);
      }
      key = await unlockHeader(header, credential, this.context, recovery); this.current(epoch);
      this.header = header; this.key = key; this.offline = offline;
      const fromCache = await this.openSession(packets, offline, epoch);
      this.current(epoch);
      return { count: this.records.size, offline, warnings: this.warnings, fromCache };
    } catch (error) { key?.fill(0); if (this.epoch === epoch) this.lock(); throw error; }
  }
  // Biometric convenience path. The caller is responsible for keeping `material` in
  // OS-protected storage; this only proves the key belongs to this vault before using it.
  exportKeyMaterial() {
    this.requireUnlocked();
    return { project: this.project, vault: this.vault, vaultId: this.header.vaultId, key: this.key.toString('base64'), check: seal(this.key, Buffer.from('hdv-biometric-ok'), `${this.context}:${this.header.vaultId}:biometric`) };
  }
  async unlockWithKeyMaterial(material, offline = false) {
    this.lock(); const epoch = this.epoch; let key;
    try {
      if (!material || material.project !== this.project || material.vault !== this.vault || typeof material.key !== 'string') throw new Error('Biometric unlock is not set up for this vault.');
      key = Buffer.from(material.key, 'base64'); if (key.length !== 32) throw new Error('Stored biometric key is invalid.');
      let header, packets;
      if (offline) {
        const cache = await this.cache.read(); this.current(epoch);
        if (!cache || cache.schema !== 1 || cache.project !== this.project || cache.vault !== this.vault || !Array.isArray(cache.packets)) throw new Error('No compatible offline cache. Connect to Google and unlock once first.');
        header = validateHeader(cache.header); packets = cache.packets;
      } else {
        const meta = await this.cloud.get(this.headerId); this.current(epoch);
        header = validateHeader(await this.cloud.access(meta)); this.current(epoch);
      }
      if (header.vaultId !== material.vaultId) throw new Error('The vault was re-created since biometric unlock was set up. Unlock with the master password and enable it again.');
      try { unseal(key, material.check, `${this.context}:${header.vaultId}:biometric`, 64); } catch (_) { throw new Error('Stored biometric key does not match this vault. Unlock with the master password and enable it again.'); }
      this.header = header; this.key = key; this.offline = offline;
      const fromCache = await this.openSession(packets, offline, epoch);
      this.current(epoch);
      return { count: this.records.size, offline, warnings: this.warnings, fromCache };
    } catch (error) { key?.fill(0); if (this.epoch === epoch) this.lock(); throw error; }
  }
  // Open the session as fast as possible. Offline: the snapshot is the data. Online: if the
  // encrypted snapshot belongs to this exact vault (same vaultId), install it immediately and
  // report fromCache=true so the caller can sync in the background; otherwise do a full refresh.
  async openSession(offlinePackets, offline, epoch) {
    if (offline) { this.installPackets(offlinePackets, epoch); return false; }
    let cache = null; try { cache = await this.cache.read(); } catch (_) { cache = null; }
    this.current(epoch);
    if (cache && cache.schema === 1 && cache.project === this.project && cache.vault === this.vault && cache.header?.vaultId === this.header.vaultId) {
      if ((cache.header?.generation || 1) > (this.header.generation || 1)) {
        throw new Error('Vault header rollback detected: cloud header generation is older than the local cached generation.');
      }
      if (Array.isArray(cache.packets)) {
        try { this.installPackets(cache.packets, epoch); this.stale = true; return true; } catch (_) { /* fall through to a full refresh */ }
      }
    }
    await this.refresh(epoch); return false;
  }
  installPackets(packets, epoch) {
    this.current(epoch); this.requireUnlocked();
    if (!Array.isArray(packets) || packets.length > 1000) throw new Error('Vault supports up to 1,000 items in this release.');
    // The header is fail-closed (a wrong key never gets here). Individual items are
    // fail-soft but loud: one corrupted, tampered or malformed record must not make
    // every other credential unreachable. Skipped IDs are reported, never hidden.
    const records = new Map(), packetMap = new Map(), skipped = [];
    for (const packet of packets) {
      const id = typeof packet?.id === 'string' ? packet.id.slice(0, 36) : '(no id)';
      try {
        if (!validId(packet.id) || records.has(packet.id) || this.cloud.secretId(packet.meta?.name) !== `${this.prefix}${packet.id}`) throw new Error('Invalid or duplicate encrypted item.');
        const item = decryptItem(this.key, this.header, this.context, packet.id, packet.envelope);
        normalize(item, item); // Validate untrusted decrypted schema without rewriting timestamps.
        records.set(item.id, item); packetMap.set(item.id, packet);
      } catch (_) { skipped.push(id); }
    }
    this.records = records; this.packets = packetMap; this.skipped = skipped;
    this.warnings = this.warnings.filter(w => !w.startsWith(SKIP_PREFIX));
    if (skipped.length) this.warnings.push(`${SKIP_PREFIX}${skipped.length} encrypted item(s) could not be decrypted or validated and were skipped: ${skipped.join(', ')}. This can mean corruption or tampering. They are excluded from backups exported now. Inspect them in Cloud Console before editing.`);
  }
  async refresh(expectedEpoch = this.epoch) {
    this.requireUnlocked(); if (this.offline) throw new Error('This vault is open offline. Lock and unlock online to sync.');
    if (this.writing) throw new Error('A save is in progress. Refresh after it finishes.');
    const metadata = await this.cloud.list(); this.current(expectedEpoch);
    const items = metadata.filter(m => this.cloud.secretId(m.name) !== this.headerId && m.labels?.hdv_deleted !== 'true');
    if (items.length > 1000) throw new Error('Vault supports up to 1,000 items in this release.');
    const committed = items.filter(m => m.versionAliases?.active);
    this.warnings = items.length !== committed.length ? [`${items.length - committed.length} uncommitted cloud secret(s) were skipped. Inspect interrupted first saves in Cloud Console.`] : [];
    // Incremental: an item whose metadata etag and active alias match the packet we already
    // hold has not changed (every save PATCHes the alias, which bumps the etag), so skip the
    // versions:access call. Unchanged vaults cost one list call, not one call per item.
    let fetched = 0;
    const packets = await mapLimit(committed, 8, async meta => {
      this.current(expectedEpoch);
      const id = (this.cloud.secretId(meta.name) || '').slice(this.prefix.length);
      if (!validId(id)) throw new Error('Unexpected item in the vault namespace.');
      const held = this.packets.get(id);
      if (held && held.meta?.etag === meta.etag && String(held.meta?.versionAliases?.active) === String(meta.versionAliases.active)) return { id, meta, envelope: held.envelope };
      const envelope = await this.cloud.access(meta); this.current(expectedEpoch); fetched++;
      return { id, meta, envelope };
    });
    this.lastRefresh = { total: committed.length, fetched };
    this.current(expectedEpoch); this.installPackets(packets, expectedEpoch);
    try { await this.writeCache(); } catch (_) { this.warnings.push('Opened from Google, but the offline cache could not be updated. Check local disk access.'); }
    this.current(expectedEpoch); this.stale = false;
    return { count: this.records.size, warnings: this.warnings, fetched };
  }
  list() { this.requireUnlocked(); return [...this.records.values()].map(summary).sort((a, b) => a.title.localeCompare(b.title)); }
  get(id) { this.requireUnlocked(); if (!validId(id) || !this.records.has(id)) throw new Error('Credential not found.'); return { ...this.records.get(id) }; }
  async save(input, options = {}) {
    this.requireUnlocked(); if (this.offline) throw new Error('Offline browsing is read-only. Unlock online to save.');
    if (this.writing) throw new Error('A save is already in progress.');
    if (input.id && (!validId(input.id) || !this.records.has(input.id))) throw new Error('This item is not in the current vault. Refresh before saving.');
    const existing = input.id ? this.records.get(input.id) : null;
    if ((isDocumentRecord(input) || isDocumentRecord(existing)) && options.documentWrite !== true) throw failure('document_read_only', 'Document manifests cannot be edited as credential notes. Use the document interface.');
    if (!existing && this.records.size >= 1000) throw new Error('This release supports up to 1,000 items.');
    const item = normalize(input, existing), epoch = this.epoch;
    if (options.documentWrite === true) {
      manifestOf(item);
      if (!existing && options.documentId !== undefined) {
        if (!validId(options.documentId) || this.records.has(options.documentId)) throw failure('invalid_document', 'Invalid new document identity.');
        item.id = options.documentId;
      }
    }
    const envelope = encryptItem(this.key, this.header, this.context, item); this.writing = true;
    try {
      const meta = existing ? this.packets.get(item.id).meta : await this.cloud.create(`${this.prefix}${item.id}`); this.current(epoch);
      const updated = await this.cloud.commit(meta, envelope); this.current(epoch);
      this.records.set(item.id, item); this.packets.set(item.id, { id: item.id, meta: updated, envelope });
      try { await this.writeCache(); } catch (_) { this.warnings = ['Saved to Google, but the offline cache could not be updated. Export a backup and check local disk access.']; }
      this.current(epoch);
      // The save is complete and cached. Pruning is best-effort and never fails the save.
      if (this.pruneKeep > 0 && existing) { try { await this.pruneSecret(item.id, this.pruneKeep, epoch); } catch (_) {} }
      this.current(epoch); return { ...item };
    } finally { this.writing = false; }
  }
  // Keep the newest `keep` ENABLED versions of one secret (the committed `active` version is
  // always among them) and schedule the rest for destruction. `active`, not version number, is
  // authoritative: a stale writer's higher-numbered candidate is pruned like any old version.
  // Destruction is delayed by the secret's versionDestroyTtl, set here on first contact, so a
  // pruned version can still be re-enabled inside the grace window.
  async pruneSecret(id, keep = this.pruneKeep, epoch = this.epoch) {
    this.requireUnlocked(); if (this.offline) throw new Error('Unlock online to prune versions.');
    if (!Number.isInteger(keep) || keep < 1 || keep > 100) throw new Error('Keep between 1 and 100 versions.');
    const isHeader = id === this.headerId;
    if (!isHeader && (!validId(id) || !this.packets.has(id))) throw new Error('Credential not found.');
    let meta = isHeader ? await this.cloud.get(this.headerId) : this.packets.get(id).meta; this.current(epoch);
    const active = String(meta.versionAliases?.active || '');
    if (!/^[1-9][0-9]*$/.test(active)) throw new Error('This secret has no committed active version.');
    const result = { id, destroyed: 0, kept: 0, failed: 0, scheduled: Boolean(meta.versionDestroyTtl) };
    const versions = await this.cloud.listVersions(meta); this.current(epoch);
    const candidates = versions.filter(v => v.number !== active).sort((a, b) => Number(b.number) - Number(a.number));
    const doomed = candidates.slice(Math.max(0, keep - 1));
    result.kept = versions.length - doomed.length;
    if (!doomed.length) return result;
    if (!meta.versionDestroyTtl) {
      try { meta = await this.cloud.setDestroyTtl(meta, this.pruneGraceSeconds); this.current(epoch); result.scheduled = true; if (!isHeader) this.packets.get(id).meta = meta; }
      catch (error) { if (error.status === 403) this.pruneDenied = true; throw error; }
    }
    for (const v of doomed) {
      this.current(epoch);
      if (v.number === active) continue; // belt and braces; the adapter refuses too
      try { await this.cloud.destroyVersion(meta, v.number, v.etag); result.destroyed++; }
      catch (error) {
        if (error.status === 403) { this.pruneDenied = true; result.failed++; break; }
        if (error.status === 400 || error.status === 409 || error.status === 404) continue; // already scheduled, changed or gone
        result.failed++;
      }
    }
    if (this.pruneDenied) this.noteWarning('Pruning: ', 'Pruning: this Google account may not destroy secret versions. Re-run scripts/setup-gcp.sh to update the IAM role, then prune again.');
    else if (result.failed) this.noteWarning('Pruning: ', `Pruning: ${result.failed} old version(s) could not be scheduled for destruction. They remain billed; prune again later.`);
    return result;
  }
  noteWarning(prefix, text) { this.warnings = this.warnings.filter(w => !w.startsWith(prefix)); this.warnings.push(text); }
  async pruneAll(keep = this.pruneKeep, onProgress = null) {
    this.requireUnlocked(); if (this.offline) throw new Error('Unlock online to prune versions.');
    if (this.writing) throw new Error('A save is in progress. Prune after it finishes.');
    const epoch = this.epoch, ids = [this.headerId, ...this.packets.keys()], totals = { scanned: 0, destroyed: 0, kept: 0, failed: 0, total: ids.length, stopped: false };
    this.stopPrune = false; this.pruneDenied = false; this.writing = true;
    try {
      await mapLimit(ids, 4, async id => {
        if (this.stopPrune || this.pruneDenied) { totals.stopped = totals.stopped || this.stopPrune; return; }
        try { const r = await this.pruneSecret(id, keep, epoch); totals.destroyed += r.destroyed; totals.kept += r.kept; totals.failed += r.failed; }
        catch (error) { if (error.message.includes('locked')) throw error; totals.failed++; }
        totals.scanned++; onProgress?.({ done: totals.scanned, total: ids.length, destroyed: totals.destroyed });
      });
    } finally { this.writing = false; }
    this.current(epoch); this.lastPrune = { ...totals, at: new Date().toISOString() };
    return totals;
  }
  requestStopPrune() { this.stopPrune = true; }
  // Cost estimate: count every billable (ENABLED or DISABLED) version across the header and all
  // items. Counts and times only; no payload is read. Published list price, automatic
  // replication: $0.06 per version-month, six free versions per billing account.
  async countVersions(onProgress = null) {
    this.requireUnlocked(); if (this.offline) throw new Error('Unlock online to count versions.');
    const epoch = this.epoch, ids = [this.headerId, ...this.packets.keys()]; let done = 0, billable = 0, scheduled = [];
    const header = await this.cloud.get(this.headerId); this.current(epoch);
    await mapLimit(ids, 8, async id => {
      const meta = id === this.headerId ? header : this.packets.get(id).meta;
      const versions = await this.cloud.listVersions(meta, { billable: true }); this.current(epoch);
      billable += versions.length; for (const v of versions) if (v.scheduledDestroyTime) scheduled.push(v.scheduledDestroyTime);
      done++; onProgress?.({ done, total: ids.length });
    });
    scheduled.sort();
    return { at: new Date().toISOString(), secrets: ids.length, billable, scheduled };
  }
  async archive(id, archived) { const item = this.get(id); return this.save({ ...item, archived: archived === true }); }
  async delete(id) {
    this.requireUnlocked(); if (this.offline) throw new Error('Offline browsing is read-only. Unlock online to delete.');
    if (this.writing) throw new Error('A save is already in progress.');
    if (!validId(id) || !this.records.has(id) || !this.packets.has(id)) throw new Error('Credential not found.');
    const item = this.records.get(id);
    const packet = this.packets.get(id);
    const epoch = this.epoch;
    this.writing = true;
    try {
      await this.cloud.deleteSecret(packet.meta);
      this.current(epoch);
      this.records.delete(id);
      this.packets.delete(id);
      try { await this.writeCache(); } catch (_) { this.warnings = ['Deleted from Google, but the offline cache could not be updated. Check local disk access.']; }
      this.current(epoch);
      return { deleted: true, id, title: item.title };
    } finally { this.writing = false; }
  }
  async writeCache() {
    this.requireUnlocked();
    return this.cache.write({ schema: 1, project: this.project, vault: this.vault, cachedAt: new Date().toISOString(), header: this.header, packets: [...this.packets.values()] });
  }
  exportBackup() {
    this.requireUnlocked();
    return { format: 'hidden-door-vault-backup', schema: 1, project: this.project, vault: this.vault, exportedAt: new Date().toISOString(), header: this.header, payload: encryptBackup(this.key, this.header, this.context, [...this.records.values()]) };
  }
  async importItems(items, onProgress = null) {
    this.requireUnlocked(); if (this.offline) throw new Error('Unlock online before importing.');
    if (!Array.isArray(items) || items.length + this.records.size > 1000) throw new Error('Import would exceed the 1,000-item vault limit.');
    // Validate the whole batch before any cloud write.
    const clean = items.map(item => { const value = normalize(item); if (isDocumentRecord(value)) manifestOf(value); return value; });
    let saved = 0; this.stopImport = false;
    for (const item of clean) {
      if (this.stopImport) return { saved, total: clean.length, stopped: true };
      onProgress?.({ done: saved, total: clean.length, title: item.title });
      try { const { id, ...input } = item; await this.save(input, { documentWrite: isDocumentRecord(item) }); saved++; }
      catch (error) { throw new Error(`Import stopped after ${saved} of ${clean.length} items. Already imported items were kept; retrying the whole file may duplicate them. ${error.message}`); }
      onProgress?.({ done: saved, total: clean.length, title: item.title });
    }
    return { saved, total: clean.length, stopped: false };
  }
  requestStopImport() { this.stopImport = true; }
}
async function readBackup(backup, credential, recovery = false) {
  if (!backup || backup.format !== 'hidden-door-vault-backup' || backup.schema !== 1) throw new Error('Unsupported backup format.');
  const context = contextOf(backup.project, backup.vault), header = validateHeader(backup.header);
  const key = await unlockHeader(header, credential, context, recovery);
  try {
    const items = decryptBackup(key, header, context, backup.payload);
    if (!Array.isArray(items) || items.length > 1000) throw new Error('Backup item count exceeds the limit.');
    return items.map(item => normalize(item));
  } finally { key.fill(0); }
}
module.exports = { Vault, readBackup, mapLimit };
