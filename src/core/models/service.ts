import type { CredentialStore, MetadataStore } from '../storage/contracts';
import type { ModelSettings } from '../prototype/types';
import { configurationFingerprint, normalizedServiceAddress, runSnapshot, selectedModelId, serviceOrigin, validateConnectionEntity, validateModelEntity, validateReasoningParameters } from './rules';
import { presetModelEvidence } from './presets';
import { defaultModelParameters, emptyModelConfiguration, unknownCapabilities } from './types';
import type { CapabilityName, CheckKind, DiagnosticResult, DiscoveredModel, ModelConfiguration, ModelEntry, ModelRunLease, ModelSupport, ProviderConnection } from './types';

type ConnectionInput = Omit<ProviderConnection, 'id' | 'credentialRef' | 'revision' | 'createdAt' | 'updatedAt' | 'check' | 'checkHistory' | 'catalogAt'> & { id?: string };
export interface ModelInput {
  id?: string; connectionId: string; apiId: string; name: string; enabled: boolean; favorite: boolean;
  capabilities: Record<CapabilityName, ModelSupport>; parameters: ModelEntry['parameters'];
}
interface KeyOperation { id: string; newRef?: string; retireRef?: string; retireLegacy?: boolean; state: 'prepared' | 'closed' }
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** One atomic metadata record holds the graph; credentials use recoverable intents. */
export class ModelConfigurationService {
  private state = freeze(emptyModelConfiguration());
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private leases = new Map<string, number>();
  recoveryIssues: string[] = [];
  constructor(private metadata: MetadataStore, private credentials: CredentialStore,
    private id: () => string, private now: () => string = () => new Date().toISOString()) {}

  getSnapshot = (): ModelConfiguration => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work); this.queue = next.catch(() => {}); return next;
  }
  private async persist(next: ModelConfiguration) {
    next.revision = this.state.revision + 1;
    await this.metadata.put('model-config', 'configuration', next);
    this.state = freeze(clone(next)); this.listeners.forEach((listener) => listener());
  }
  async initialize(): Promise<void> {
    await this.exclusive(async () => {
      const saved = await this.metadata.get<ModelConfiguration>('model-config', 'configuration');
      if (saved) {
        if (saved.schemaVersion !== 1) throw new Error('模型配置格式需要更新应用后读取。');
        this.state = freeze(clone(saved));
      } else await this.migrateLegacy();
      await this.cleanupCredentials();
    });
  }
  private async migrateLegacy() {
    const legacy = await this.metadata.get<ModelSettings>('settings', 'model');
    const next = emptyModelConfiguration(); next.migratedLegacy = true;
    if (!legacy?.baseUrl || !legacy.model) { await this.persist(next); return; }
    const time = this.now();
    const deepseek = new URL(legacy.baseUrl).hostname === 'api.deepseek.com';
    const connection: ProviderConnection = { id: 'legacy-connection', name: deepseek ? 'DeepSeek' : '原有服务',
      presetId: deepseek ? 'deepseek' : 'custom', baseUrl: normalizedServiceAddress(legacy.baseUrl), protocol: 'chat-completions',
      auth: 'key', compatibility: deepseek ? 'deepseek' : 'standard', apiVersion: '', enabled: true,
      revision: 1, createdAt: time, updatedAt: time };
    const model: ModelEntry = { id: 'legacy-model', connectionId: connection.id, apiId: legacy.model.trim(), name: legacy.model.trim(),
      enabled: true, favorite: true, revision: 1,
      capabilities: { ...unknownCapabilities(), ...presetModelEvidence(connection.presetId, legacy.model.trim()) },
      parameters: { ...defaultModelParameters, allowImages: legacy.imageInput },
      catalog: { source: 'manual', missing: false }, checks: {}, createdAt: time, updatedAt: time };
    if (legacy.imageInput && model.capabilities.images.support !== 'supported') model.capabilities.images = { support: 'supported', source: 'user' };
    next.mode = legacy.mode; next.connections = [connection]; next.models = [model]; next.defaults.global = model.id;
    const secret = await this.credentials.get();
    if (!secret) { await this.persist(next); return; }
    const operation: KeyOperation = { id: this.id(), newRef: this.id(), retireLegacy: true, state: 'prepared' };
    await this.metadata.put('model-key-ops', operation.id, operation);
    await this.credentials.set(secret, operation.newRef);
    connection.credentialRef = operation.newRef;
    await this.persist(next);
    await this.cleanupCredentials();
  }

  private referenced(ref: string): boolean {
    return this.state.connections.some((item) => item.credentialRef === ref) || !!this.leases.get(ref);
  }
  private async cleanupCredentials() {
    const operations = await this.metadata.all<KeyOperation>('model-key-ops');
    for (const operation of operations.filter((item) => item.state === 'prepared')) {
      try {
        if (operation.newRef && !this.referenced(operation.newRef)) await this.credentials.set('', operation.newRef);
        if (operation.retireRef && this.referenced(operation.retireRef)) continue;
        if (operation.retireRef) await this.credentials.set('', operation.retireRef);
        if (operation.retireLegacy) {
          // Only retire legacy after the graph using the new credential committed.
          if (!operation.newRef || !this.state.connections.some((item) => item.credentialRef === operation.newRef)) {
            await this.metadata.put('model-key-ops', operation.id, { ...operation, state: 'closed' }); continue;
          }
          await this.credentials.set('');
        }
        await this.metadata.put('model-key-ops', operation.id, { ...operation, state: 'closed' });
      } catch { this.recoveryIssues.push('一项旧模型凭证的清理尚未完成，将在下次启动重试。'); }
    }
  }

  async saveConnection(input: ConnectionInput, key: { value?: string; remove?: boolean } = {}, expectedRevision?: number): Promise<ProviderConnection> {
    return this.exclusive(async () => {
      const next = clone(this.state); const previous = input.id ? next.connections.find((item) => item.id === input.id) : undefined;
      if (input.id && !previous) throw new Error('连接已删除，请重新打开配置。');
      if (previous && expectedRevision !== undefined && previous.revision !== expectedRevision) throw new Error('连接已被修改，请重新打开后再保存。');
      const time = this.now();
      const connection: ProviderConnection = { ...input, id: previous?.id ?? this.id(), name: input.name.trim(),
        baseUrl: normalizedServiceAddress(input.baseUrl), credentialRef: previous?.credentialRef,
        revision: (previous?.revision ?? 0) + 1, createdAt: previous?.createdAt ?? time, updatedAt: time,
        check: previous?.check, checkHistory: previous?.checkHistory, catalogAt: previous?.catalogAt };
      validateConnectionEntity(connection);
      const bindingChanged = previous && (serviceOrigin(previous.baseUrl) !== serviceOrigin(connection.baseUrl) || previous.auth !== connection.auth);
      if (bindingChanged || key.remove || connection.auth === 'none') connection.credentialRef = undefined;
      const value = connection.auth === 'key' ? key.value?.trim() : undefined;
      let operation: KeyOperation | undefined;
      if (value || connection.credentialRef !== previous?.credentialRef) {
        operation = { id: this.id(), newRef: value ? this.id() : undefined, retireRef: previous?.credentialRef, state: 'prepared' };
        await this.metadata.put('model-key-ops', operation.id, operation);
        if (value) { await this.credentials.set(value, operation.newRef); connection.credentialRef = operation.newRef; }
      }
      if (previous && configurationFingerprint(previous) !== configurationFingerprint(connection)) {
        connection.check = undefined; connection.checkHistory = undefined; connection.catalogAt = undefined;
        for (const model of next.models.filter((item) => item.connectionId === connection.id)) {
          model.checks = {}; model.checkHistory = undefined;
          for (const capability of ['tools', 'images', 'reasoning'] as const) if (model.capabilities[capability].source === 'verified') {
            model.capabilities[capability] = presetModelEvidence(connection.presetId, model.apiId)[capability] ?? { support: 'unknown', source: 'user' };
          }
        }
      }
      next.connections = [...next.connections.filter((item) => item.id !== connection.id), connection];
      try { await this.persist(next); }
      catch (error) { await this.cleanupCredentials(); throw error; }
      if (operation) await this.cleanupCredentials();
      return clone(connection);
    });
  }
  async copyConnection(id: string): Promise<ProviderConnection> {
    return this.exclusive(async () => {
      const next = clone(this.state); const source = next.connections.find((item) => item.id === id);
      if (!source) throw new Error('连接已删除。');
      const time = this.now();
      const copied = { ...source, id: this.id(), name: source.name + ' 副本', credentialRef: undefined, check: undefined, checkHistory: undefined,
        revision: 1, createdAt: time, updatedAt: time };
      next.connections.push(copied);
      next.models.push(...next.models.filter((model) => model.connectionId === id).map((model) => ({ ...clone(model),
        id: this.id(), connectionId: copied.id, checks: {}, checkHistory: undefined, revision: 1, createdAt: time, updatedAt: time,
        capabilities: Object.fromEntries(Object.entries(model.capabilities).map(([name, evidence]) => [name,
          evidence.source === 'verified' ? { support: 'unknown', source: 'user' } : evidence])) as ModelEntry['capabilities'] })));
      await this.persist(next); return clone(copied);
    });
  }
  async removeConnection(id: string): Promise<void> {
    await this.exclusive(async () => {
      const next = clone(this.state); const connection = next.connections.find((item) => item.id === id);
      if (!connection) return;
      if (connection.credentialRef) {
        const op: KeyOperation = { id: this.id(), retireRef: connection.credentialRef, state: 'prepared' };
        await this.metadata.put('model-key-ops', op.id, op);
      }
      next.connections = next.connections.filter((item) => item.id !== id);
      next.models = next.models.filter((item) => item.connectionId !== id);
      // Preserve dangling explicit selections, so deleting a pin cannot silently
      // route the next prompt to a different vendor through a fallback.
      await this.persist(next); await this.cleanupCredentials();
    });
  }
  async keyReady(connectionId: string): Promise<boolean> {
    const connection = this.state.connections.find((item) => item.id === connectionId);
    if (!connection) return false;
    if (connection.auth === 'none') return true;
    return !!connection.credentialRef && !!await this.credentials.get(connection.credentialRef);
  }

  async saveModel(input: ModelInput, expectedRevision?: number): Promise<ModelEntry> {
    return this.exclusive(async () => {
      const next = clone(this.state); const connection = next.connections.find((item) => item.id === input.connectionId);
      if (!connection) throw new Error('所属连接已删除。');
      const previous = input.id ? next.models.find((item) => item.id === input.id) : undefined;
      if (input.id && !previous) throw new Error('模型已删除。');
      if (previous && expectedRevision !== undefined && previous.revision !== expectedRevision) throw new Error('模型已被修改，请重新打开后保存。');
      if (previous && previous.connectionId !== input.connectionId) throw new Error('模型不能直接移到其他连接。');
      const time = this.now(); const apiId = input.apiId.trim(); const identityChanged = previous && previous.apiId !== apiId;
      const evidence = { ...unknownCapabilities(), ...presetModelEvidence(connection.presetId, apiId) };
      const capabilities = Object.fromEntries((['tools', 'images', 'reasoning'] as const).map((name) => [name,
        !identityChanged && previous?.capabilities[name].support === input.capabilities[name] ? previous.capabilities[name] :
          evidence[name].support === input.capabilities[name] ? evidence[name] : { support: input.capabilities[name], source: 'user' }])) as ModelEntry['capabilities'];
      const model: ModelEntry = { id: previous?.id ?? this.id(), connectionId: connection.id, apiId, name: input.name.trim(),
        enabled: input.enabled, favorite: input.favorite, capabilities, parameters: clone(input.parameters),
        limits: identityChanged ? undefined : previous?.limits, revision: (previous?.revision ?? 0) + 1,
        catalog: identityChanged ? { source: 'manual', missing: false } : previous?.catalog ?? { source: 'manual', missing: false },
        checks: !identityChanged && previous && configurationFingerprint(connection, previous) === configurationFingerprint(connection, { ...previous, parameters: input.parameters }) ? previous.checks : {},
        checkHistory: !identityChanged && previous && configurationFingerprint(connection, previous) === configurationFingerprint(connection, { ...previous, parameters: input.parameters }) ? previous.checkHistory : undefined,
        createdAt: previous?.createdAt ?? time, updatedAt: time };
      validateModelEntity(model);
      validateReasoningParameters(connection, model);
      if (connection.protocol === 'anthropic-messages' && (model.parameters.temperature ?? 0) > 1) throw new Error('Anthropic 温度范围为 0–1。');
      if (next.models.some((item) => item.id !== model.id && item.connectionId === connection.id && item.apiId === model.apiId)) throw new Error('此连接已经包含这个模型 ID。');
      next.models = [...next.models.filter((item) => item.id !== model.id), model];
      await this.persist(next); return clone(model);
    });
  }
  async removeModel(id: string): Promise<void> {
    await this.exclusive(async () => { const next = clone(this.state); next.models = next.models.filter((item) => item.id !== id); await this.persist(next); });
  }
  async mergeCatalog(connectionId: string, models: DiscoveredModel[], fingerprint: string): Promise<void> {
    await this.exclusive(async () => {
      const next = clone(this.state); const connection = next.connections.find((item) => item.id === connectionId);
      if (!connection || configurationFingerprint(connection) !== fingerprint) throw new Error('连接已变更，请重新获取模型目录。');
      const time = this.now(); const found = new Set(models.map((model) => model.apiId));
      for (const old of next.models.filter((item) => item.connectionId === connectionId && item.catalog.source === 'discovered')) old.catalog.missing = !found.has(old.apiId);
      for (const entry of models) {
        let model = next.models.find((item) => item.connectionId === connectionId && item.apiId === entry.apiId);
        if (!model) {
          model = { id: this.id(), connectionId, apiId: entry.apiId, name: entry.name, enabled: true, favorite: false, revision: 1,
            capabilities: { ...unknownCapabilities(), ...presetModelEvidence(connection.presetId, entry.apiId) },
            parameters: { ...defaultModelParameters, maxOutputTokens: Math.min(4096, entry.limits?.outputTokens ?? 4096) },
            catalog: { source: 'discovered', missing: false }, checks: {}, createdAt: time, updatedAt: time };
          validateModelEntity(model); next.models.push(model);
        }
        for (const name of ['tools', 'images', 'reasoning'] as const) if (entry.capabilities?.[name] &&
          (model.capabilities[name].support === 'unknown' || !['user', 'verified'].includes(model.capabilities[name].source))) {
          model.capabilities[name] = { support: entry.capabilities[name]!, source: 'discovery', checkedAt: time };
        }
        model.limits = entry.limits ?? model.limits; model.catalog.lastSeenAt = time; model.catalog.missing = false;
      }
      connection.catalogAt = time; await this.persist(next);
    });
  }
  async setSelection(scope: 'global' | 'project' | 'session', modelId: string | undefined, ownerId?: string): Promise<void> {
    await this.exclusive(async () => {
      const next = clone(this.state);
      if (modelId && !next.models.some((model) => model.id === modelId)) throw new Error('模型已删除，请重新选择。');
      if (scope === 'global') next.defaults.global = modelId;
      else {
        if (!ownerId) throw new Error('缺少选择范围。');
        const map = scope === 'project' ? next.defaults.projects : next.defaults.sessions;
        if (modelId) map[ownerId] = modelId; else delete map[ownerId];
        if (scope === 'session') {
          next.sessionModes ??= {};
          if (modelId) next.sessionModes[ownerId] = 'remote'; else delete next.sessionModes[ownerId];
        }
      }
      if (modelId) { next.mode = 'remote'; next.recent = [modelId, ...next.recent.filter((id) => id !== modelId)].slice(0, 8); }
      await this.persist(next);
    });
  }
  async setMode(mode: ModelConfiguration['mode'], sessionId?: string): Promise<void> {
    await this.exclusive(async () => { const next = clone(this.state);
      if (sessionId) { next.sessionModes ??= {}; next.sessionModes[sessionId] = mode; } else next.mode = mode;
      await this.persist(next);
    });
  }
  async recordCheck(connectionId: string, modelId: string | undefined, kind: CheckKind, result: DiagnosticResult): Promise<void> {
    await this.exclusive(async () => {
      const next = clone(this.state); const connection = next.connections.find((item) => item.id === connectionId);
      const model = next.models.find((item) => item.id === modelId);
      if (!connection || configurationFingerprint(connection, modelId ? model : undefined) !== result.fingerprint) throw new Error('检测期间配置已修改，结果没有覆盖新配置。');
      const history = (items: DiagnosticResult[] = []) => [result, ...items.filter((r) => r.platform !== result.platform)].slice(0, 4);
      if (kind === 'connection') { connection.checkHistory = history(connection.checkHistory ?? (connection.check ? [connection.check] : [])); connection.check = result; }
      else if (model) {
        model.checkHistory = { ...model.checkHistory, [kind]: history(model.checkHistory?.[kind] ?? (model.checks[kind] ? [model.checks[kind]!] : [])) };
        model.checks[kind] = result;
        if (result.status === 'passed' && (kind === 'tools' || kind === 'images')) model.capabilities[kind] = { support: 'supported', source: 'verified', checkedAt: result.at };
      }
      await this.persist(next);
    });
  }
  async acquireModel(modelId: string, forAgent = true): Promise<ModelRunLease> {
    return this.exclusive(() => this.leaseModel(modelId, forAgent));
  }
  private async leaseModel(modelId: string, forAgent: boolean): Promise<ModelRunLease> {
      const model = this.state.models.find((item) => item.id === modelId);
      if (!model) throw new Error('所选模型已删除或尚未配置，请重新选择。');
      const connection = this.state.connections.find((item) => item.id === model.connectionId);
      if (!connection || (forAgent && (!connection.enabled || !model.enabled))) throw new Error('所选连接或模型已停用，请重新选择。');
      if (forAgent && model.capabilities.tools.support === 'unsupported') throw new Error('此模型不支持工具调用，不能执行工作区任务。');
      validateConnectionEntity(connection); validateModelEntity(model);
      validateReasoningParameters(connection, model);
      if (connection.protocol === 'anthropic-messages' && (model.parameters.temperature ?? 0) > 1) throw new Error('Anthropic 温度范围为 0–1，请调整模型参数。');
      const ref = connection.credentialRef;
      const secret = connection.auth === 'none' ? '' : ref ? await this.credentials.get(ref) : '';
      if (connection.auth === 'key' && !secret) throw new Error('此连接需要填写 API Key；浏览器重开后需重新填写。');
      if (ref) this.leases.set(ref, (this.leases.get(ref) ?? 0) + 1);
      let released = false;
      return { snapshot: freeze(clone(runSnapshot(connection, model))), secret,
        release: async () => {
          if (released) return; released = true;
          await this.exclusive(async () => {
            if (ref) { const count = (this.leases.get(ref) ?? 1) - 1; if (count) this.leases.set(ref, count); else this.leases.delete(ref); }
            await this.cleanupCredentials();
          });
        } };
  }
  async acquireConnection(connectionId: string): Promise<{ connection: ProviderConnection; secret: string; release(): Promise<void> }> {
    return this.exclusive(async () => {
      const connection = this.state.connections.find((item) => item.id === connectionId);
      if (!connection) throw new Error('连接已删除。');
      validateConnectionEntity(connection);
      const ref = connection.credentialRef;
      const secret = connection.auth === 'none' ? '' : ref ? await this.credentials.get(ref) : '';
      if (connection.auth === 'key' && !secret) throw new Error('此连接尚未填写 API Key。');
      if (ref) this.leases.set(ref, (this.leases.get(ref) ?? 0) + 1);
      let released = false;
      return { connection: freeze(clone(connection)), secret, release: async () => {
        if (released) return; released = true;
        await this.exclusive(async () => {
          if (ref) { const count = (this.leases.get(ref) ?? 1) - 1; if (count) this.leases.set(ref, count); else this.leases.delete(ref); }
          await this.cleanupCredentials();
        });
      } };
    });
  }
  async acquireSelection(projectId?: string, sessionId?: string): Promise<ModelRunLease> {
    return this.exclusive(async () => {
      const id = selectedModelId(this.state, projectId, sessionId);
      if (!id) throw new Error('还没有默认模型，请先添加或选择一个模型。');
      return this.leaseModel(id, true);
    });
  }
  affectedDefaults(connectionId: string): number {
    const ids = new Set(this.state.models.filter((model) => model.connectionId === connectionId).map((model) => model.id));
    return [this.state.defaults.global, ...Object.values(this.state.defaults.projects), ...Object.values(this.state.defaults.sessions)].filter((id) => !!id && ids.has(id)).length;
  }
}
