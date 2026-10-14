import { fetch } from 'expo/fetch';
import { Client, StreamableHTTPClientTransport, type FetchLike } from '@modelcontextprotocol/client';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/client/validators/cf-worker';
import type { McpLease, McpTool } from '@/core/mcp/types';
import { canonical, schemaIssue, scrub, toolFingerprint } from '@/core/mcp/rules';

export class McpError extends Error { constructor(message: string, readonly uncertain = false) { super(message); } }
export function safeMcpError(error: unknown, aborted = false): string {
  if (error instanceof McpError) return error.message;
  return aborted ? 'MCP 调用已停止。' : 'MCP 连接失败，请检查端点、Token、服务状态或浏览器跨域设置。';
}
export const sanitizeMcp = <T>(value: T, secret: string): T => {
  if (typeof value === 'string') return scrub(value, secret) as T;
  if (Array.isArray(value)) return value.map((part) => sanitizeMcp(part, secret)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, part]) => [scrub(key, secret), sanitizeMcp(part, secret)])) as T;
  return value;
};
function boundedResponse(response: Response): Response {
  if (!response.body) return response;
  const reader = response.body.getReader(); let size = 0;
  const body = new ReadableStream<Uint8Array>({ async pull(controller) {
    try { const chunk = await reader.read(); if (chunk.done) { controller.close(); return; }
      size += chunk.value.byteLength; if (size > 2 * 1024 * 1024) throw new McpError('MCP 响应超过 2 MB，请分段查询。');
      controller.enqueue(chunk.value);
    } catch (error) { await reader.cancel().catch(() => {}); controller.error(error); }
  }, cancel: () => reader.cancel() });
  const text = async () => { const decoder = new TextDecoder(); const input = body.getReader(); let value = '';
    try { for (;;) { const chunk = await input.read(); if (chunk.done) break; value += decoder.decode(chunk.value, { stream: true }); } return value + decoder.decode(); }
    finally { input.releaseLock(); }
  };
  // Expo's native Response constructor does not accept every web stream type.
  // Preserve its branded accessors while bounding both JSON and SSE reads.
  return new Proxy(response, { get(target, key) {
    if (key === 'body') return body;
    if (key === 'text') return text;
    if (key === 'json') return async () => JSON.parse(await text());
    if (key === 'clone') return () => { throw new McpError('MCP 响应不能重复读取。'); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
}
export class McpSession {
  private client: Client;
  private transport: StreamableHTTPClientTransport;
  private connected?: Promise<void>;
  private sending?: () => Promise<void>;
  private sent = false;
  private httpRejected = false;
  constructor(readonly lease: McpLease) {
    const { snapshot, secret } = lease;
    const boundedFetch: FetchLike = async (input, init) => {
      const url = typeof input === 'string' ? input : input.href;
      if (new URL(url).href !== snapshot.url) throw new McpError('MCP 重定向或额外地址未获授权，请配置最终端点。');
      const body = typeof init?.body === 'string' ? init.body : '';
      if (new TextEncoder().encode(body).byteLength > 512 * 1024) throw new McpError('MCP 参数超过 512 KB，请分段处理。');
      const method = body ? JSON.parse(body).method : '';
      if (method === 'tools/call') {
        if (this.sent) throw new McpError('远端调用已发送，禁止自动重复发送。', true);
        await this.sending?.(); this.sent = true;
      }
      const response = await fetch(input, { ...init, redirect: 'error' });
      if (method === 'tools/call' && [400, 401, 403, 404].includes(response.status)) this.httpRejected = true;
      if (response.status === 401 || response.status === 403) throw new McpError('MCP 认证失败；请检查 Token。需要 OAuth 的服务暂未支持。');
      return boundedResponse(response as Response);
    };
    this.transport = new StreamableHTTPClientTransport(new URL(snapshot.url), { fetch: boundedFetch,
      requestInit: { headers: snapshot.auth === 'bearer' ? { Authorization: 'Bearer ' + secret } : {} } });
    this.client = new Client({ name: 'AgentMobile', version: '0.1.0' }, {
      capabilities: {}, versionNegotiation: { mode: 'auto', probe: { maxRetries: 0 } },
      jsonSchemaValidator: new CfWorkerJsonSchemaValidator(), inputRequired: { autoFulfill: false }, listMaxPages: 5,
    });
  }
  async connect(signal?: AbortSignal) {
    this.connected ??= this.client.connect(this.transport, { signal, timeout: this.lease.snapshot.timeoutMs });
    await this.connected;
  }
  async discover(signal?: AbortSignal): Promise<{ tools: McpTool[]; info?: string; version?: string }> {
    await this.connect(signal);
    const result = await this.client.listTools(undefined, { signal, timeout: this.lease.snapshot.timeoutMs, cacheMode: 'refresh' });
    if (result.tools.length > 64) throw new McpError('MCP 目录超过 64 个工具，请使用更小的服务目录。');
    if (new Set(result.tools.map((tool) => tool.name)).size !== result.tools.length) throw new McpError('MCP 目录存在重复工具名称，请修复服务器目录。');
    const tools = result.tools.map((raw): McpTool => {
      const value = sanitizeMcp(raw, this.lease.secret); const inputSchema = value.inputSchema as Record<string, unknown>;
      const descriptor = { name: value.name, title: value.title?.slice(0, 100), description: (value.description ?? '').slice(0, 2000),
        inputSchema, ...(value.outputSchema ? { outputSchema: value.outputSchema as Record<string, unknown> } : {}), readOnlyHint: value.annotations?.readOnlyHint };
      const unavailableReason = ['__proto__', 'constructor', 'prototype'].includes(value.name) ? '特殊名称暂不支持' : canonical(inputSchema).length > 24_000 || canonical(value.outputSchema).length > 24_000 ? '工具定义过大' :
        schemaIssue(inputSchema) ?? schemaIssue(value.outputSchema) ?? (value.execution?.taskSupport === 'required' ? '此工具要求 Tasks 扩展，当前未支持' : undefined);
      return { ...descriptor, fingerprint: toolFingerprint(descriptor), unavailableReason };
    });
    const info = this.client.getServerVersion();
    return { tools, info: info ? scrub(info.name + ' · ' + info.version, this.lease.secret) : undefined, version: this.client.getNegotiatedProtocolVersion() };
  }
  async call(tool: McpTool, args: Record<string, unknown>, signal: AbortSignal | undefined, onSending: () => Promise<void>, onProgress: (text: string) => void) {
    this.sent = false; this.httpRejected = false;
    const current = (await this.discover(signal)).tools.find((value) => value.name === tool.name);
    if (!current || current.fingerprint !== tool.fingerprint || current.unavailableReason) throw new McpError('MCP 工具定义已变化，请重新发现并为项目授权。');
    // The interpreter annotates schemas during compilation; run snapshots stay immutable.
    const validation = new CfWorkerJsonSchemaValidator().getValidator(JSON.parse(JSON.stringify(tool.inputSchema)))(args);
    if (!validation.valid) throw new McpError('MCP 工具参数不符合输入定义，本次未发送。');
    this.sending = onSending;
    try {
      const result = await this.client.callTool({ name: tool.name, arguments: args }, {
        signal, timeout: this.lease.snapshot.timeoutMs,
        // Pin the definition already checked above; suppress SDK header-mismatch retries.
        toolDefinition: JSON.parse(JSON.stringify({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema })),
        onprogress: (progress) => onProgress(scrub(progress.message ?? '进度 ' + progress.progress + (progress.total ? '/' + progress.total : ''), this.lease.secret).slice(0, 1000)),
      });
      return sanitizeMcp(result, this.lease.secret);
    } catch {
      if (this.sent && !this.httpRejected) throw new McpError('远端调用结果未知；可能已执行，请先核对服务器状态。同一参数不会自动重试。', true);
      throw new McpError(signal?.aborted ? '调用在发送前已取消。' : 'MCP 调用未被接受，请检查服务、参数或认证。');
    } finally { this.sending = undefined; }
  }
  close = async () => { await this.client.close().catch(() => {}); };
}
