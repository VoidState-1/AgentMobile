import type { CredentialStore, MetadataStore } from '../storage/contracts';
import { canonical, mcpEndpoint, validateMcpServer } from './rules';
import { emptyMcpConfiguration, type McpConfiguration, type McpLease, type McpServer, type McpServerInput, type McpServerSnapshot, type McpTool } from './types';

interface KeyIntent { id: string; newRef?: string; retireRef?: string; closed?: boolean }
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const freeze = <T>(value: T): T => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export class McpConfigurationService {
  private state = freeze(emptyMcpConfiguration()); private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>(); private leases = new Map<string, number>();
  constructor(private metadata: MetadataStore, private credentials: CredentialStore, private id: () => string) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private exclusive<T>(work: () => Promise<T>): Promise<T> { const next = this.queue.then(work, work); this.queue = next.catch(() => {}); return next; }
  private async persist(next: McpConfiguration) {
    next.revision = this.state.revision + 1; await this.metadata.put('mcp-config', 'configuration', next);
    this.state = freeze(clone(next)); for (const listener of this.listeners) { try { listener(); } catch { /* A view cannot roll back a committed configuration. */ } }
  }
  async initialize() {
    await this.exclusive(async () => {
      const saved = await this.metadata.get<McpConfiguration>('mcp-config', 'configuration');
      if (saved) { if (saved.schemaVersion !== 1) throw new Error('MCP 配置格式需要更新应用后读取。'); this.state = freeze(clone(saved)); }
      await this.cleanup();
    });
  }
  private referenced(ref: string) { return this.state.servers.some((server) => server.credentialRef === ref) || !!this.leases.get(ref); }
  private async cleanup() {
    for (const intent of await this.metadata.all<KeyIntent>('mcp-key-intents')) {
      if (intent.closed) continue;
      try {
        if (intent.newRef && !this.referenced(intent.newRef)) await this.credentials.set('', intent.newRef);
        if (intent.retireRef && this.referenced(intent.retireRef)) continue;
        if (intent.retireRef) await this.credentials.set('', intent.retireRef);
        await this.metadata.put('mcp-key-intents', intent.id, { ...intent, closed: true });
      } catch { /* Retry recoverable cleanup on next initialization/release. */ }
    }
  }
  async saveServer(input: McpServerInput, token: { value?: string; remove?: boolean }, expectedRevision?: number): Promise<McpServer> {
    const value = clone(input);
    return this.exclusive(async () => {
      validateMcpServer(value); const next = clone(this.state); const old = value.id ? next.servers.find((item) => item.id === value.id) : undefined;
      if (value.id && !old) throw new Error('MCP 连接已删除。');
      if (old && old.revision !== expectedRevision) throw new Error('MCP 配置已变化，请重新打开后编辑。');
      const server: McpServer = { ...value, id: old?.id ?? this.id(), name: value.name.trim(), url: mcpEndpoint(value.url),
        revision: (old?.revision ?? 0) + 1, credentialRef: old?.credentialRef, tools: old?.tools ?? [], catalogAt: old?.catalogAt,
        check: old?.check, serverInfo: old?.serverInfo, protocolVersion: old?.protocolVersion };
      const originChanged = old && (new URL(old.url).origin !== new URL(server.url).origin || old.auth !== server.auth);
      if (originChanged || token.remove || server.auth === 'none') server.credentialRef = undefined;
      const secret = server.auth === 'bearer' ? token.value?.trim() : undefined;
      if (secret && (secret.length > 8192 || /[\r\n]/.test(secret))) throw new Error('MCP Token 不得包含换行，且最多 8,192 字符。');
      if (secret || server.credentialRef !== old?.credentialRef) {
        const intent: KeyIntent = { id: this.id(), newRef: secret ? 'mcp-' + this.id() : undefined, retireRef: old?.credentialRef };
        await this.metadata.put('mcp-key-intents', intent.id, intent);
        if (secret) { await this.credentials.set(secret, intent.newRef); server.credentialRef = intent.newRef; }
      }
      if (old && (old.url !== server.url || old.credentialRef !== server.credentialRef || old.auth !== server.auth)) {
        server.tools = []; server.catalogAt = undefined; server.check = undefined;
        for (const grants of Object.values(next.grants)) delete grants[server.id];
      }
      next.servers = [...next.servers.filter((item) => item.id !== server.id), server];
      try { await this.persist(next); } catch (error) { await this.cleanup(); throw error; }
      await this.cleanup(); return clone(server);
    });
  }
  async removeServer(id: string) {
    await this.exclusive(async () => {
      const next = clone(this.state); const server = next.servers.find((item) => item.id === id);
      if (server?.credentialRef) { const intent: KeyIntent = { id: this.id(), retireRef: server.credentialRef }; await this.metadata.put('mcp-key-intents', intent.id, intent); }
      next.servers = next.servers.filter((item) => item.id !== id); for (const grants of Object.values(next.grants)) delete grants[id];
      await this.persist(next); await this.cleanup();
    });
  }
  async recordCatalog(id: string, revision: number, tools: McpTool[], info?: string, protocolVersion?: string) {
    await this.exclusive(async () => {
      const next = clone(this.state); const server = next.servers.find((item) => item.id === id);
      if (!server || server.revision !== revision) throw new Error('连接已变化，发现结果未写入，请重新检测。');
      server.tools = clone(tools); server.catalogAt = new Date().toISOString(); server.serverInfo = info; server.protocolVersion = protocolVersion;
      server.check = { status: 'passed', at: server.catalogAt, message: '发现 ' + tools.length + ' 个工具；尚未调用。' };
      for (const grants of Object.values(next.grants)) for (const [name, fingerprint] of Object.entries(grants[id] ?? {})) {
        if (!tools.some((tool) => tool.name === name && tool.fingerprint === fingerprint && !tool.unavailableReason)) delete grants[id][name];
      }
      await this.persist(next);
    });
  }
  async recordFailure(id: string, revision: number, message: string) {
    await this.exclusive(async () => { const next = clone(this.state); const server = next.servers.find((item) => item.id === id);
      if (!server || server.revision !== revision) return;
      server.check = { status: 'failed', message, at: new Date().toISOString() }; await this.persist(next);
    });
  }
  async grant(projectId: string, serverId: string, name: string, allow: boolean, fingerprint: string) {
    await this.exclusive(async () => {
      const next = clone(this.state); const tool = next.servers.find((server) => server.id === serverId)?.tools.find((tool) => tool.name === name);
      if (!tool || tool.fingerprint !== fingerprint || tool.unavailableReason) throw new Error('工具定义已变化或尚不支持，请重新发现。');
      if (['__proto__', 'constructor', 'prototype'].includes(name) || ['__proto__', 'constructor', 'prototype'].includes(projectId)) throw new Error('特殊名称暂不支持。');
      next.grants[projectId] ??= {}; next.grants[projectId][serverId] ??= {};
      if (allow) next.grants[projectId][serverId][name] = fingerprint; else delete next.grants[projectId][serverId][name];
      const count = next.servers.filter((server) => server.enabled).reduce((total, server) => total + Object.keys(next.grants[projectId]?.[server.id] ?? {}).length, 0);
      if (allow && count > 32) throw new Error('单个项目最多启用 32 个 MCP 工具。');
      await this.persist(next);
    });
  }
  async keyReady(id: string) { const server = this.state.servers.find((item) => item.id === id); return server?.auth === 'none' || !!(server?.credentialRef && await this.credentials.get(server.credentialRef)); }
  async acquireServer(id: string): Promise<McpLease> { return this.exclusive(() => this.lease(id)); }
  async acquireProject(projectId: string): Promise<McpLease[]> {
    return this.exclusive(async () => {
      const selected = this.state.servers.filter((server) => server.enabled && Object.keys(this.state.grants[projectId]?.[server.id] ?? {}).length);
      const total = selected.reduce((n, server) => n + Object.keys(this.state.grants[projectId][server.id]).length, 0);
      if (total > 32) throw new Error('单个项目最多启用 32 个 MCP 工具。');
      const leases: McpLease[] = [];
      try { for (const server of selected) leases.push(await this.lease(server.id, projectId)); return leases; }
      catch (error) { for (const lease of leases) this.drop(lease.snapshot.id); throw error; }
    });
  }
  private drop(id: string, ref?: string) {
    const key = ref ?? this.state.servers.find((item) => item.id === id)?.credentialRef;
    if (key) { const count = (this.leases.get(key) ?? 1) - 1; if (count > 0) this.leases.set(key, count); else this.leases.delete(key); }
  }
  private async lease(id: string, projectId?: string): Promise<McpLease> {
    const server = this.state.servers.find((item) => item.id === id); if (!server) throw new Error('MCP 连接已删除。');
    const secret = server.auth === 'none' ? '' : server.credentialRef ? await this.credentials.get(server.credentialRef) : '';
    if (server.auth === 'bearer' && !secret) throw new Error('请填写 MCP Token；浏览器刷新后需要重新填写。');
    const { credentialRef, check: _check, catalogAt: _at, ...publicServer } = server;
    const snapshot: McpServerSnapshot = clone(publicServer);
    if (projectId) snapshot.tools = snapshot.tools.filter((tool) => this.state.grants[projectId]?.[id]?.[tool.name] === tool.fingerprint && !tool.unavailableReason);
    if (credentialRef) this.leases.set(credentialRef, (this.leases.get(credentialRef) ?? 0) + 1);
    let released = false;
    return { snapshot: freeze(snapshot), secret, release: async () => {
      if (released) return; released = true; await this.exclusive(async () => { this.drop(id, credentialRef); await this.cleanup(); });
    } };
  }
  fingerprint = (server: McpServer) => canonical([server.url, server.auth, server.credentialRef]);
}
