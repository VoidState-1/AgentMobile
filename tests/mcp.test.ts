import { createHash, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpConfigurationService } from '../src/core/mcp/service';
import { mcpEndpoint } from '../src/core/mcp/rules';
import { McpRuntime } from '../src/adapters/mcp/runtime';
import type { CredentialStore } from '../src/core/storage/contracts';
import type { McpAttempt } from '../src/core/mcp/types';
import { testStorage } from './storage';
import { mcpFixture, fixtureTools } from './mcp-fixtures';
import { WorkspaceService } from '../src/adapters/workspace/service';
import { startAgent } from '../src/adapters/agent/runner';
import { defaultAgentSettings } from '../src/core/agent/settings';
import { answerEvents, toolEvents, sse } from './protocol-fixtures';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function setup() {
  const storage = await testStorage(); cleanups.push(storage.cleanup); const keys = new Map<string, string>();
  const credentials: CredentialStore = { get: async (ref) => keys.get(ref ?? '') ?? '', set: async (value, ref) => { if (value) keys.set(ref!, value); else keys.delete(ref!); } };
  const configuration = new McpConfigurationService(storage.metadata, credentials, randomUUID); await configuration.initialize();
  const runtime = new McpRuntime(configuration, storage.metadata, randomUUID, async (value) => createHash('sha256').update(value).digest('hex'));
  const server = await configuration.saveServer({ name: '资料', url: 'https://mcp.example.test/mcp', auth: 'bearer', enabled: true, timeoutMs: 5000 }, { value: 'mcp-fixture-secret' });
  return { ...storage, keys, credentials, configuration, runtime, server };
}
async function grant(f: Awaited<ReturnType<typeof setup>>, projectId = 'project-A') {
  await f.runtime.discover(f.server.id);
  const tool = f.configuration.getSnapshot().servers[0].tools[0];
  await f.configuration.grant(projectId, f.server.id, tool.name, true, tool.fingerprint);
  return tool;
}
describe('MCP 配置与凭证', () => {
  it('端点校验拒绝明文远端、URL 凭证和查询令牌', () => {
    for (const url of ['http://192.168.1.1/mcp', 'https://user:pass@example.test/mcp', 'https://example.test/mcp?token=x', 'file:///data']) expect(() => mcpEndpoint(url)).toThrow();
    expect(mcpEndpoint('http://127.0.0.1:4181/mcp')).toBe('http://127.0.0.1:4181/mcp');
  });
  it('授权按项目隔离，工具定义变更撤销授权，运行租约保留旧 Token', async () => {
    const f = await setup(); const fixture = mcpFixture({ token: 'mcp-fixture-secret' }); vi.stubGlobal('fetch', fixture.handle);
    await grant(f); expect(await f.configuration.acquireProject('project-B')).toHaveLength(0);
    const leases = await f.configuration.acquireProject('project-A'); expect(leases[0].snapshot.tools).toHaveLength(1);
    const changed = await f.configuration.saveServer({ ...f.server, name: '新名称' }, { value: 'replacement-secret' }, f.server.revision);
    expect(leases[0].secret).toBe('mcp-fixture-secret'); expect(Object.isFrozen(leases[0].snapshot.tools)).toBe(true);
    expect([...f.keys.values()]).toContain('mcp-fixture-secret'); await leases[0].release(); expect([...f.keys.values()]).not.toContain('mcp-fixture-secret');
    expect(f.configuration.getSnapshot().servers[0].tools).toHaveLength(0);
    const lease = await f.configuration.acquireServer(changed.id); expect(lease.secret).toBe('replacement-secret'); await lease.release();
    expect(JSON.stringify([...f.records])).not.toContain('replacement-secret');
  });
  it('目录变更只保留相同定义，新增工具不自动启用', async () => {
    const f = await setup(); const fixture = mcpFixture(); vi.stubGlobal('fetch', fixture.handle); await grant(f);
    fixture.setTools([{ ...fixtureTools[0], description: '新权限说明' }, fixtureTools[1]]); await f.runtime.discover(f.server.id);
    expect(await f.configuration.acquireProject('project-A')).toHaveLength(0);
  });
  it('删除连接的凭证等待租约释放；保存失败和清理中断可恢复', async () => {
    const f = await setup(); const lease = await f.configuration.acquireServer(f.server.id);
    await f.configuration.removeServer(f.server.id); expect([...f.keys.values()]).toContain('mcp-fixture-secret'); await lease.release(); expect(f.keys.size).toBe(0);
    const intents = await f.metadata.all<{ closed: boolean }>('mcp-key-intents'); expect(intents.every((intent) => intent.closed)).toBe(true);
    const old = await f.configuration.saveServer({ ...f.server, id: undefined }, { value: 'old-secret' });
    const put = f.metadata.put; f.metadata.put = async (bucket, id, value) => { if (bucket === 'mcp-config') throw new Error('storage failed'); await put(bucket, id, value); };
    await expect(f.configuration.saveServer(old, { value: 'new-secret' }, old.revision)).rejects.toThrow(); f.metadata.put = put;
    const restarted = new McpConfigurationService(f.metadata, f.credentials, randomUUID); await restarted.initialize();
    expect((await restarted.acquireServer(old.id)).secret).toBe('old-secret'); expect([...f.keys.values()]).not.toContain('new-secret');
    await expect(restarted.saveServer(old, { value: 'invalid\r\ntoken' }, old.revision)).rejects.toThrow('换行');
  });
});
describe('官方 MCP SDK 协议与持久化边界', () => {
  for (const modern of [false, true]) for (const streamed of [false, true]) it(`${modern ? '2026' : '2025'} 协议、${streamed ? 'SSE' : 'JSON'}、分页与进度`, async () => {
    const f = await setup(); const fixture = mcpFixture({ modern, sse: streamed, paginated: true, token: 'mcp-fixture-secret' }); vi.stubGlobal('fetch', fixture.handle);
    const tool = await grant(f); const server = f.configuration.getSnapshot().servers[0];
    expect(server.tools).toHaveLength(2); expect(server.protocolVersion).toBe(modern ? '2026-07-28' : '2025-11-25');
    const run = f.runtime.createRun(await f.configuration.acquireProject('project-A')); cleanups.push(run.close); const progress: string[] = [];
    const result = await run.tools[0].execute('task', 'trace', { query: 'notes' }, false, undefined, (message) => progress.push(message));
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('查询成功') }); expect(result.details.mcpStatus).toBe('completed');
    expect(fixture.calls).toBe(1); if (streamed) expect(progress).toContain('正在查询远端资料');
    expect(fixture.requests.some((request) => request.method === 'initialize')).toBe(!modern);
    const request = fixture.requests.find((request) => request.method === 'tools/call')!;
    expect(request.headers.get('authorization')).toBe('Bearer mcp-fixture-secret');
    if (modern) expect(request.params?._meta?.['io.modelcontextprotocol/protocolVersion']).toBe('2026-07-28');
    else expect(request.headers.get('mcp-session-id')).toBe('fixture-session');
    expect(JSON.stringify(await f.metadata.all('mcp-attempts'))).not.toContain('mcp-fixture-secret'); expect(tool.name).toBe('lookup');
  });
  it('参数和目录变化在发送前拒绝；认证拒绝与未知执行区分', async () => {
    const f = await setup(); const fixture = mcpFixture(); vi.stubGlobal('fetch', fixture.handle); await grant(f);
    const run = f.runtime.createRun(await f.configuration.acquireProject('project-A')); cleanups.push(run.close);
    expect((await run.tools[0].execute('task', 'bad', {}, false)).details.mcpStatus).toBe('failed'); expect(fixture.calls).toBe(0);
    fixture.setTools([{ ...fixtureTools[0], description: 'changed' }]);
    expect((await run.tools[0].execute('task', 'changed', { query: 'q' }, false)).details.mcpStatus).toBe('failed'); expect(fixture.calls).toBe(0);
    fixture.setTools(fixtureTools); fixture.setStatus(401);
    expect((await run.tools[0].execute('task', 'denied', { query: 'q' }, false)).details.mcpStatus).toBe('failed');
    expect(await f.runtime.unknown()).toHaveLength(0);
    fixture.setStatus(500);
    expect((await run.tools[0].execute('task', 'unknown', { query: 'q' }, false)).details.mcpStatus).toBe('unknown');
    const count = fixture.calls; await run.tools[0].execute('task', 'blocked', { query: 'q' }, false); expect(fixture.calls).toBe(count);
    await f.runtime.acknowledge((await f.runtime.unknown())[0].id); fixture.setStatus(200);
    expect((await run.tools[0].execute('task', 'retry', { query: 'q' }, false)).details.mcpStatus).toBe('completed'); expect(fixture.calls).toBe(count + 1);
  });
  it('回执保存失败仍阻止重复调用，重启区分未发送与已发送', async () => {
    const f = await setup(); const fixture = mcpFixture(); vi.stubGlobal('fetch', fixture.handle); await grant(f);
    const run = f.runtime.createRun(await f.configuration.acquireProject('project-A')); cleanups.push(run.close);
    const put = f.metadata.put; f.metadata.put = async (bucket, id, value) => {
      if (bucket === 'mcp-attempts' && ['completed', 'unknown'].includes((value as McpAttempt).state)) throw new Error('save receipt failed'); await put(bucket, id, value);
    };
    expect((await run.tools[0].execute('task', 'trace', { query: 'q' }, false)).details.mcpStatus).toBe('unknown');
    await run.tools[0].execute('task', 'second', { query: 'q' }, false); expect(fixture.calls).toBe(1); f.metadata.put = put;
    const attempt = (await f.metadata.all<McpAttempt>('mcp-attempts'))[0];
    await f.metadata.put('mcp-attempts', 'before-send', { ...attempt, id: 'before-send', state: 'prepared' }); await f.runtime.recover();
    expect((await f.metadata.get<McpAttempt>('mcp-attempts', attempt.id))?.state).toBe('unknown');
    expect((await f.metadata.get<McpAttempt>('mcp-attempts', 'before-send'))?.state).toBe('cancelled');
  });
  it('结果、描述和预览过滤凭证，无效图片不改变已执行事实', async () => {
    const f = await setup(); const fixture = mcpFixture(); vi.stubGlobal('fetch', fixture.handle);
    fixture.setTools([{ ...fixtureTools[0], description: 'echo mcp-fixture-secret' }]); await grant(f);
    fixture.setResult({ content: [{ type: 'text', text: 'mcp-fixture-secret' }, { type: 'image', data: 'AA==', mimeType: 'image/png' }, { type: 'resource_link', name: 'external', uri: 'https://example.test/private' }] });
    const run = f.runtime.createRun(await f.configuration.acquireProject('project-A')); cleanups.push(run.close);
    const result = await run.tools[0].execute('task', 'trace', { query: 'mcp-fixture-secret' }, true);
    expect(result.details.mcpStatus).toBe('completed'); expect(JSON.stringify(result)).not.toContain('mcp-fixture-secret');
    expect(JSON.stringify([...f.records])).not.toContain('mcp-fixture-secret'); expect(fixture.calls).toBe(1);
  });
  for (const stop of ['cancel', 'timeout'] as const) it(`已发送调用 ${stop} 后显示结果未知，不重复请求`, async () => {
    const f = await setup(); const fixture = mcpFixture(); vi.stubGlobal('fetch', fixture.handle); await grant(f);
    const run = f.runtime.createRun(await f.configuration.acquireProject('project-A')); cleanups.push(run.close);
    let received!: () => void; const sent = new Promise<void>((resolve) => { received = resolve; }); let calls = 0;
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      if (String(init?.body).includes('"tools/call"')) {
        calls++; const response = new Response(new ReadableStream({ start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(new Error('disconnected')), { once: true });
        } }), { headers: { 'Content-Type': 'text/event-stream' } }); received(); return response;
      }
      return fixture.handle(url, init);
    });
    if (stop === 'timeout') vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const abort = new AbortController(); const pending = run.tools[0].execute('task', 'trace', { query: 'wait' }, false, abort.signal); await sent;
    if (stop === 'cancel') abort.abort(); else await vi.advanceTimersByTimeAsync(5001);
    expect((await pending).details.mcpStatus).toBe('unknown'); expect(await f.runtime.unknown()).toHaveLength(1);
    await run.tools[0].execute('task', 'retry', { query: 'wait' }, false); expect(calls).toBe(1);
  });
  it('请求发送日志失败阻止网络，超大回执不会泄漏或误记成功', async () => {
    const f = await setup(); const fixture = mcpFixture(); vi.stubGlobal('fetch', fixture.handle); await grant(f);
    const run = f.runtime.createRun(await f.configuration.acquireProject('project-A')); cleanups.push(run.close); const put = f.metadata.put;
    f.metadata.put = async (bucket, id, value) => { if (bucket === 'mcp-attempts' && (value as McpAttempt).state === 'dispatched') throw new Error('db offline'); await put(bucket, id, value); };
    expect((await run.tools[0].execute('task', 'log-failed', { query: 'q' }, false)).details.mcpStatus).toBe('failed'); expect(fixture.calls).toBe(0); f.metadata.put = put;
    fixture.setResult({ content: [{ type: 'text', text: 'x'.repeat(2 * 1024 * 1024) }] });
    expect((await run.tools[0].execute('task', 'large', { query: 'q' }, false)).details.mcpStatus).toBe('unknown'); expect(fixture.calls).toBe(1);
  });
  it('Pi 在已发送 MCP 调用期间取消，轨迹保留结果未知而非声称未执行', async () => {
    const f = await setup(); const fixture = mcpFixture(); vi.stubGlobal('fetch', fixture.handle);
    const workspace = new WorkspaceService(f.files, f.metadata, randomUUID); const project = await workspace.create('取消'); await grant(f, project.id);
    const run = f.runtime.createRun(await f.configuration.acquireProject(project.id)); let received!: () => void; const sent = new Promise<void>((resolve) => { received = resolve; });
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('mcp.example')) {
        if (String(init?.body).includes('"tools/call"')) {
          const response = new Response(new ReadableStream({ start(controller) { init?.signal?.addEventListener('abort', () => controller.error(new Error('stop')), { once: true }); } }), { headers: { 'Content-Type': 'text/event-stream' } }); received(); return response;
        } return fixture.handle(url, init);
      }
      return new Response(sse(toolEvents('chat-completions', 'mcp_0_0', { query: 'wait' })), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const started = await startAgent(workspace, project.id, '取消测试', { mode: 'remote', baseUrl: 'https://model.example/v1', model: 'fixture', imageInput: false }, 'model-secret', randomUUID,
      () => {}, undefined, false, undefined, undefined, defaultAgentSettings(), run);
    await sent; started.cancel(); const task = await started.done;
    expect(task.state).toBe('cancelled'); expect(task.trace?.find((entry) => entry.kind === 'tool')?.state).toBe('unknown');
    expect((await f.metadata.all<McpAttempt>('mcp-attempts'))[0].state).toBe('unknown');
  });
  it('真实 Pi 循环仅获得授权工具，将远程结果写入本地 Git，并保存工作轨迹', async () => {
    const f = await setup(); const fixture = mcpFixture({ modern: true, sse: true });
    vi.stubGlobal('fetch', fixture.handle); const workspace = new WorkspaceService(f.files, f.metadata, randomUUID); const project = await workspace.create('MCP'); await grant(f, project.id);
    const run = f.runtime.createRun(await f.configuration.acquireProject(project.id)); const modelRequests: any[] = [];
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('mcp.example')) return fixture.handle(url, init);
      const body = JSON.parse(String(init?.body)); modelRequests.push(body);
      const events = modelRequests.length === 1 ? toolEvents('chat-completions', 'mcp_0_0', { query: 'notes' }) : modelRequests.length === 2 ?
        toolEvents('chat-completions', 'write_text', { path: 'documents/mcp.md', text: '远程资料：MCP 查询成功。', expectedRevision: null }) : answerEvents('chat-completions', '已保存远程资料。');
      return new Response(sse(events), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const updates: string[] = [];
    const started = await startAgent(workspace, project.id, '查询并保存资料', { mode: 'remote', baseUrl: 'https://model.example/v1', model: 'fixture', imageInput: false }, 'model-secret', randomUUID,
      (task) => updates.push(JSON.stringify(task.trace)), undefined, false, undefined, undefined, defaultAgentSettings(), run);
    const task = await started.done; expect(task.state).toBe('completed'); expect(task.finalCommit).not.toBe(task.baseCommit);
    expect((await workspace.readText(project.id, 'documents/mcp.md')).text).toContain('MCP 查询成功');
    expect(modelRequests[0].tools.filter((tool: any) => tool.function.name.startsWith('mcp_'))).toHaveLength(1);
    expect(JSON.stringify(modelRequests)).not.toContain('side_effect'); expect(JSON.stringify(modelRequests)).not.toContain('mcp-fixture-secret');
    expect(task.trace?.filter((item) => item.kind === 'tool')[0]).toMatchObject({ label: 'MCP · 资料 · 资料查询', state: 'completed' });
    expect(updates.some((value) => value.includes('正在查询远端资料'))).toBe(true); expect(JSON.stringify(task)).not.toContain('credentialRef');
  });
});
