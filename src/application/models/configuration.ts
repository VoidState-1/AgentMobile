import { cloneJsonDto as clone, freezeJsonDto as freeze } from '@/core/json-dto';
import { SerialQueue } from '@/core/serial-queue';
import { AppError } from '@/core/errors';
import { Signal } from '@/core/signal';
import type { CredentialStore, MetadataStore } from '@/core/storage/contracts';
import type { ContentCodec } from '@/core/storage/codec';
import { createProviderIcon, validateProviderIcon } from '@/core/models/provider-icon';
import { orderedProviderKeys, providerKeys } from '@/core/models/provider-order';
import {
  configurationFingerprint,
  normalizedServiceAddress,
  runSnapshot,
  selectedModelId,
  serviceOrigin,
  validateConnectionEntity,
  validateModelEntity,
  validateReasoningParameters,
} from '@/core/models/rules';
import { presetModelEvidence } from '@/core/models/presets';
import {
  defaultModelParameters,
  emptyModelConfiguration,
  unknownCapabilities,
} from '@/core/models/types';
import type {
  ConnectionInput,
  ModelInput,
  CheckKind,
  DiagnosticResult,
  DiscoveredModel,
  ModelConfiguration,
  ModelEntry,
  ModelRunLease,
  ProviderConnection,
} from '@/core/models/types';

interface KeyOperation {
  id: string;
  newRef?: string;
  retireRef?: string;
  state: 'prepared' | 'closed';
}

/** One atomic metadata record holds the graph; credentials use recoverable intents. */
export class ModelConfigurationService {
  private state = freeze(emptyModelConfiguration());
  private readonly signal = new Signal();
  private readonly queue = new SerialQueue();
  private leases = new Map<string, number>();
  recoveryIssues: string[] = [];
  constructor(
    private metadata: MetadataStore,
    private credentials: CredentialStore,
    private id: () => string,
    private codec: ContentCodec,
    private now: () => string = () => new Date().toISOString(),
  ) {}

  getSnapshot = (): ModelConfiguration => this.state;
  prepareIcon(file: { name: string; bytes: Uint8Array }) {
    return createProviderIcon(file, this.codec);
  }
  subscribe = (listener: () => void): (() => void) => this.signal.subscribe(listener);
  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    return this.queue.run(work);
  }
  private async persist(next: ModelConfiguration) {
    next.providerOrder = orderedProviderKeys(next.providerOrder, next.connections);
    next.revision = this.state.revision + 1;
    await this.metadata.put('model-config', 'configuration', next);
    this.state = freeze(clone(next));
    this.signal.publish();
  }
  async initialize(): Promise<void> {
    await this.exclusive(async () => {
      const saved = await this.metadata.get<ModelConfiguration>('model-config', 'configuration');
      if (saved) {
        if (saved.schemaVersion !== 2)
          throw new AppError('STORAGE', '模型配置格式需要更新应用后读取。');
        this.state = freeze(clone(saved));
      } else await this.persist(emptyModelConfiguration());
      await this.cleanupCredentials();
    });
  }
  async setProviderOrder(order: string[], expectedRevision: number): Promise<void> {
    const requested = [...order];
    await this.exclusive(async () => {
      const available = providerKeys(this.state.connections);
      if (
        expectedRevision !== this.state.revision ||
        requested.length !== available.length ||
        new Set(requested).size !== requested.length ||
        requested.some(key => !available.includes(key))
      )
        throw new AppError('CONFLICT', '供应商列表已变化，请重新拖拽排序。');
      await this.persist({ ...clone(this.state), providerOrder: requested });
    });
  }
  private referenced(ref: string): boolean {
    return (
      this.state.connections.some(item => item.credentialRef === ref) || !!this.leases.get(ref)
    );
  }
  private async cleanupCredentials() {
    const operations = await this.metadata.all<KeyOperation>('model-key-ops');
    for (const operation of operations.filter(item => item.state === 'prepared')) {
      try {
        if (operation.newRef && !this.referenced(operation.newRef))
          await this.credentials.set('', operation.newRef);
        if (operation.retireRef && this.referenced(operation.retireRef)) continue;
        if (operation.retireRef) await this.credentials.set('', operation.retireRef);

        await this.metadata.put('model-key-ops', operation.id, { ...operation, state: 'closed' });
      } catch {
        this.recoveryIssues.push('一项旧模型凭证的清理尚未完成，将在下次启动重试。');
      }
    }
  }

  async saveConnection(
    input: ConnectionInput,
    key: { value?: string; remove?: boolean } = {},
    expectedRevision?: number,
  ): Promise<ProviderConnection> {
    return this.exclusive(async () => {
      const next = clone(this.state);
      const previous = input.id ? next.connections.find(item => item.id === input.id) : undefined;
      if (input.id && !previous) throw new AppError('VALIDATION', '连接已删除，请重新打开配置。');
      if (previous && expectedRevision !== undefined && previous.revision !== expectedRevision)
        throw new AppError('CONFLICT', '连接已被修改，请重新打开后再保存。');
      const time = this.now();
      const connection: ProviderConnection = {
        ...input,
        id: previous?.id ?? this.id(),
        name: input.name.trim(),
        baseUrl: normalizedServiceAddress(input.baseUrl),
        credentialRef: previous?.credentialRef,
        revision: (previous?.revision ?? 0) + 1,
        createdAt: previous?.createdAt ?? time,
        updatedAt: time,
        check: previous?.check,
        checkHistory: previous?.checkHistory,
        catalogAt: previous?.catalogAt,
      };
      validateConnectionEntity(connection);
      validateProviderIcon(connection.icon, this.codec);
      const bindingChanged =
        previous &&
        (serviceOrigin(previous.baseUrl) !== serviceOrigin(connection.baseUrl) ||
          previous.auth !== connection.auth);
      if (bindingChanged || key.remove || connection.auth === 'none')
        connection.credentialRef = undefined;
      const value = connection.auth === 'key' ? key.value?.trim() : undefined;
      let operation: KeyOperation | undefined;
      if (value || connection.credentialRef !== previous?.credentialRef) {
        const newRef = value ? this.id() : undefined;
        operation = {
          id: this.id(),
          newRef,
          retireRef: previous?.credentialRef,
          state: 'prepared',
        };
        await this.metadata.put('model-key-ops', operation.id, operation);
        if (value && newRef) {
          await this.credentials.set(value, newRef);
          connection.credentialRef = newRef;
        }
      }
      if (previous && configurationFingerprint(previous) !== configurationFingerprint(connection)) {
        connection.check = undefined;
        connection.checkHistory = undefined;
        connection.catalogAt = undefined;
        for (const model of next.models.filter(item => item.connectionId === connection.id)) {
          model.checks = {};
          model.checkHistory = undefined;
          for (const capability of ['tools', 'images', 'reasoning'] as const)
            if (model.capabilities[capability].source === 'verified') {
              model.capabilities[capability] = presetModelEvidence(
                connection.presetId,
                model.apiId,
              )[capability] ?? { support: 'unknown', source: 'user' };
            }
        }
      }
      next.connections = [
        ...next.connections.filter(item => item.id !== connection.id),
        connection,
      ];
      try {
        await this.persist(next);
      } catch (error) {
        await this.cleanupCredentials();
        throw error;
      }
      if (operation) await this.cleanupCredentials();
      return clone(connection);
    });
  }
  async copyConnection(id: string): Promise<ProviderConnection> {
    return this.exclusive(async () => {
      const next = clone(this.state);
      const source = next.connections.find(item => item.id === id);
      if (!source) throw new AppError('VALIDATION', '连接已删除。');
      const time = this.now();
      const copied = {
        ...source,
        id: this.id(),
        name: source.name + ' 副本',
        credentialRef: undefined,
        check: undefined,
        checkHistory: undefined,
        revision: 1,
        createdAt: time,
        updatedAt: time,
      };
      next.connections.push(copied);
      next.models.push(
        ...next.models
          .filter(model => model.connectionId === id)
          .map(model => ({
            ...clone(model),
            id: this.id(),
            connectionId: copied.id,
            checks: {},
            checkHistory: undefined,
            revision: 1,
            createdAt: time,
            updatedAt: time,
            capabilities: Object.fromEntries(
              Object.entries(model.capabilities).map(([name, evidence]) => [
                name,
                evidence.source === 'verified' ? { support: 'unknown', source: 'user' } : evidence,
              ]),
            ) as ModelEntry['capabilities'],
          })),
      );
      await this.persist(next);
      return clone(copied);
    });
  }
  async removeConnection(id: string): Promise<void> {
    await this.exclusive(async () => {
      const next = clone(this.state);
      const connection = next.connections.find(item => item.id === id);
      if (!connection) return;
      if (connection.credentialRef) {
        const op: KeyOperation = {
          id: this.id(),
          retireRef: connection.credentialRef,
          state: 'prepared',
        };
        await this.metadata.put('model-key-ops', op.id, op);
      }
      next.connections = next.connections.filter(item => item.id !== id);
      next.models = next.models.filter(item => item.connectionId !== id);
      // Preserve dangling explicit selections, so deleting a pin cannot silently
      // route the next prompt to a different vendor through a fallback.
      await this.persist(next);
      await this.cleanupCredentials();
    });
  }
  async keyReady(connectionId: string): Promise<boolean> {
    const connection = this.state.connections.find(item => item.id === connectionId);
    if (!connection) return false;
    if (connection.auth === 'none') return true;
    return !!connection.credentialRef && !!(await this.credentials.get(connection.credentialRef));
  }

  async saveModel(input: ModelInput, expectedRevision?: number): Promise<ModelEntry> {
    return this.exclusive(async () => {
      const next = clone(this.state);
      const connection = next.connections.find(item => item.id === input.connectionId);
      if (!connection) throw new AppError('VALIDATION', '所属连接已删除。');
      const previous = input.id ? next.models.find(item => item.id === input.id) : undefined;
      if (input.id && !previous) throw new AppError('VALIDATION', '模型已删除。');
      if (previous && expectedRevision !== undefined && previous.revision !== expectedRevision)
        throw new AppError('CONFLICT', '模型已被修改，请重新打开后保存。');
      if (previous && previous.connectionId !== input.connectionId)
        throw new AppError('VALIDATION', '模型不能直接移到其他连接。');
      const time = this.now();
      const apiId = input.apiId.trim();
      const identityChanged = previous && previous.apiId !== apiId;
      const evidence = {
        ...unknownCapabilities(),
        ...presetModelEvidence(connection.presetId, apiId),
      };
      const capabilities = Object.fromEntries(
        (['tools', 'images', 'reasoning'] as const).map(name => [
          name,
          !identityChanged && previous?.capabilities[name].support === input.capabilities[name]
            ? previous.capabilities[name]
            : evidence[name].support === input.capabilities[name]
              ? evidence[name]
              : { support: input.capabilities[name], source: 'user' },
        ]),
      ) as ModelEntry['capabilities'];
      const model: ModelEntry = {
        id: previous?.id ?? this.id(),
        connectionId: connection.id,
        apiId,
        name: input.name.trim(),
        enabled: input.enabled,
        favorite: input.favorite,
        capabilities,
        parameters: clone(input.parameters),
        limits: identityChanged ? undefined : previous?.limits,
        revision: (previous?.revision ?? 0) + 1,
        catalog: identityChanged
          ? { source: 'manual', missing: false }
          : (previous?.catalog ?? { source: 'manual', missing: false }),
        checks:
          !identityChanged &&
          previous &&
          configurationFingerprint(connection, previous) ===
            configurationFingerprint(connection, { ...previous, parameters: input.parameters })
            ? previous.checks
            : {},
        checkHistory:
          !identityChanged &&
          previous &&
          configurationFingerprint(connection, previous) ===
            configurationFingerprint(connection, { ...previous, parameters: input.parameters })
            ? previous.checkHistory
            : undefined,
        createdAt: previous?.createdAt ?? time,
        updatedAt: time,
      };
      validateModelEntity(model);
      validateReasoningParameters(connection, model);
      if (connection.protocol === 'anthropic-messages' && (model.parameters.temperature ?? 0) > 1)
        throw new AppError('VALIDATION', 'Anthropic 温度范围为 0–1。');
      if (
        next.models.some(
          item =>
            item.id !== model.id &&
            item.connectionId === connection.id &&
            item.apiId === model.apiId,
        )
      )
        throw new AppError('VALIDATION', '此连接已经包含这个模型 ID。');
      next.models = [...next.models.filter(item => item.id !== model.id), model];
      await this.persist(next);
      return clone(model);
    });
  }
  async removeModel(id: string): Promise<void> {
    await this.exclusive(async () => {
      const next = clone(this.state);
      next.models = next.models.filter(item => item.id !== id);
      await this.persist(next);
    });
  }
  async mergeCatalog(
    connectionId: string,
    models: DiscoveredModel[],
    fingerprint: string,
  ): Promise<void> {
    await this.exclusive(async () => {
      const next = clone(this.state);
      const connection = next.connections.find(item => item.id === connectionId);
      if (!connection || configurationFingerprint(connection) !== fingerprint)
        throw new AppError('VALIDATION', '连接已变更，请重新获取模型目录。');
      const time = this.now();
      const found = new Set(models.map(model => model.apiId));
      for (const old of next.models.filter(
        item => item.connectionId === connectionId && item.catalog.source === 'discovered',
      ))
        old.catalog.missing = !found.has(old.apiId);
      for (const entry of models) {
        let model = next.models.find(
          item => item.connectionId === connectionId && item.apiId === entry.apiId,
        );
        if (!model) {
          model = {
            id: this.id(),
            connectionId,
            apiId: entry.apiId,
            name: entry.name,
            enabled: true,
            favorite: false,
            revision: 1,
            capabilities: {
              ...unknownCapabilities(),
              ...presetModelEvidence(connection.presetId, entry.apiId),
            },
            parameters: {
              ...defaultModelParameters,
              maxOutputTokens: Math.min(
                defaultModelParameters.maxOutputTokens,
                entry.limits?.outputTokens ?? defaultModelParameters.maxOutputTokens,
              ),
            },
            catalog: { source: 'discovered', missing: false },
            checks: {},
            createdAt: time,
            updatedAt: time,
          };
          validateModelEntity(model);
          next.models.push(model);
        }
        for (const name of ['tools', 'images', 'reasoning'] as const)
          if (
            entry.capabilities?.[name] &&
            (model.capabilities[name].support === 'unknown' ||
              !['user', 'verified'].includes(model.capabilities[name].source))
          ) {
            model.capabilities[name] = {
              support: entry.capabilities[name]!,
              source: 'discovery',
              checkedAt: time,
            };
          }
        model.limits = entry.limits ?? model.limits;
        model.catalog.lastSeenAt = time;
        model.catalog.missing = false;
      }
      connection.catalogAt = time;
      await this.persist(next);
    });
  }
  async setSelection(
    scope: 'global' | 'project' | 'session',
    modelId: string | undefined,
    ownerId?: string,
  ): Promise<void> {
    await this.exclusive(async () => {
      const next = clone(this.state);
      if (modelId && !next.models.some(model => model.id === modelId))
        throw new AppError('VALIDATION', '模型已删除，请重新选择。');
      if (scope === 'global') next.defaults.global = modelId;
      else {
        if (!ownerId) throw new AppError('VALIDATION', '缺少选择范围。');
        const map = scope === 'project' ? next.defaults.projects : next.defaults.sessions;
        if (modelId) map[ownerId] = modelId;
        else delete map[ownerId];
      }
      if (modelId) {
        next.recent = [modelId, ...next.recent.filter(id => id !== modelId)].slice(0, 8);
      }
      await this.persist(next);
    });
  }
  async recordCheck(
    connectionId: string,
    modelId: string | undefined,
    kind: CheckKind,
    result: DiagnosticResult,
  ): Promise<void> {
    await this.exclusive(async () => {
      const next = clone(this.state);
      const connection = next.connections.find(item => item.id === connectionId);
      const model = next.models.find(item => item.id === modelId);
      if (
        !connection ||
        configurationFingerprint(connection, modelId ? model : undefined) !== result.fingerprint
      )
        throw new AppError('CONFLICT', '检测期间配置已修改，结果没有覆盖新配置。');
      const history = (items: DiagnosticResult[] = []) =>
        [result, ...items.filter(r => r.platform !== result.platform)].slice(0, 4);
      if (kind === 'connection') {
        connection.checkHistory = history(
          connection.checkHistory ?? (connection.check ? [connection.check] : []),
        );
        connection.check = result;
      } else if (model) {
        model.checkHistory = {
          ...model.checkHistory,
          [kind]: history(
            model.checkHistory?.[kind] ?? (model.checks[kind] ? [model.checks[kind]!] : []),
          ),
        };
        model.checks[kind] = result;
        if (result.status === 'passed' && (kind === 'tools' || kind === 'images'))
          model.capabilities[kind] = {
            support: 'supported',
            source: 'verified',
            checkedAt: result.at,
          };
      }
      await this.persist(next);
    });
  }
  async acquireModel(modelId: string, forAgent = true): Promise<ModelRunLease> {
    return this.exclusive(() => this.leaseModel(modelId, forAgent));
  }
  private async leaseModel(modelId: string, forAgent: boolean): Promise<ModelRunLease> {
    const model = this.state.models.find(item => item.id === modelId);
    if (!model) throw new AppError('VALIDATION', '所选模型已删除或尚未配置，请重新选择。');
    const connection = this.state.connections.find(item => item.id === model.connectionId);
    if (!connection || (forAgent && (!connection.enabled || !model.enabled)))
      throw new AppError('VALIDATION', '所选连接或模型已停用，请重新选择。');
    if (forAgent && model.capabilities.tools.support === 'unsupported')
      throw new AppError('VALIDATION', '此模型不支持工具调用，不能执行工作区任务。');
    validateConnectionEntity(connection);
    validateModelEntity(model);
    validateReasoningParameters(connection, model);
    if (connection.protocol === 'anthropic-messages' && (model.parameters.temperature ?? 0) > 1)
      throw new AppError('VALIDATION', 'Anthropic 温度范围为 0–1，请调整模型参数。');
    const ref = connection.credentialRef;
    const secret = connection.auth === 'none' ? '' : ref ? await this.credentials.get(ref) : '';
    if (connection.auth === 'key' && !secret)
      throw new AppError('VALIDATION', '此连接需要填写 API Key；浏览器重开后需重新填写。');
    if (ref) this.leases.set(ref, (this.leases.get(ref) ?? 0) + 1);
    let released = false;
    return {
      snapshot: freeze(clone(runSnapshot(connection, model))),
      secret,
      release: async () => {
        if (released) return;
        released = true;
        await this.exclusive(async () => {
          if (ref) {
            const count = (this.leases.get(ref) ?? 1) - 1;
            if (count) this.leases.set(ref, count);
            else this.leases.delete(ref);
          }
          await this.cleanupCredentials();
        });
      },
    };
  }
  async acquireConnection(
    connectionId: string,
  ): Promise<{ connection: ProviderConnection; secret: string; release(): Promise<void> }> {
    return this.exclusive(async () => {
      const connection = this.state.connections.find(item => item.id === connectionId);
      if (!connection) throw new AppError('VALIDATION', '连接已删除。');
      validateConnectionEntity(connection);
      const ref = connection.credentialRef;
      const secret = connection.auth === 'none' ? '' : ref ? await this.credentials.get(ref) : '';
      if (connection.auth === 'key' && !secret)
        throw new AppError('VALIDATION', '此连接尚未填写 API Key。');
      if (ref) this.leases.set(ref, (this.leases.get(ref) ?? 0) + 1);
      let released = false;
      return {
        connection: freeze(clone(connection)),
        secret,
        release: async () => {
          if (released) return;
          released = true;
          await this.exclusive(async () => {
            if (ref) {
              const count = (this.leases.get(ref) ?? 1) - 1;
              if (count) this.leases.set(ref, count);
              else this.leases.delete(ref);
            }
            await this.cleanupCredentials();
          });
        },
      };
    });
  }
  async acquireSelection(projectId?: string, sessionId?: string): Promise<ModelRunLease> {
    return this.exclusive(async () => {
      const id = selectedModelId(this.state, projectId, sessionId);
      if (!id) throw new AppError('VALIDATION', '还没有默认模型，请先添加或选择一个模型。');
      return this.leaseModel(id, true);
    });
  }
  affectedDefaults(connectionId: string): number {
    const ids = new Set(
      this.state.models.filter(model => model.connectionId === connectionId).map(model => model.id),
    );
    return [
      this.state.defaults.global,
      ...Object.values(this.state.defaults.projects),
      ...Object.values(this.state.defaults.sessions),
    ].filter(id => !!id && ids.has(id)).length;
  }
}
