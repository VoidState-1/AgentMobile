import { AppError } from '@/core/errors';
import { Buffer } from 'buffer';
import type { MetadataStore } from '@/core/storage/contracts';
import type { McpConfigurationService } from '@/application/mcp/configuration';
import type { McpAttempt, McpLease } from '@/core/mcp/types';
import { canonical } from '@/core/mcp/rules';
import { validateImage } from '@/core/workspace/image';
import { McpSession, safeMcpError, sanitizeMcp } from './client';
import { RemoteDispatchCoordinator } from '@/application/mcp/dispatch';

const clippedText = (value: string) =>
  value.length > 100_000
    ? value.slice(0, 100_000) + '\n[MCP 内容已截断，请缩小查询范围或分段读取。]'
    : value;

export class McpRuntime {
  private readonly dispatch = new RemoteDispatchCoordinator();
  constructor(
    readonly configuration: McpConfigurationService,
    private metadata: MetadataStore,
    private id: () => string,
    private digest: (value: string) => Promise<string>,
  ) {}
  async discover(id: string, signal?: AbortSignal) {
    const lease = await this.configuration.acquireServer(id);
    const session = new McpSession(lease);
    try {
      const result = await session.discover(signal);
      await this.configuration.recordCatalog(
        id,
        lease.snapshot.revision,
        result.tools,
        result.info,
        result.version,
      );
    } catch (error) {
      const message = safeMcpError(error, signal?.aborted);
      await this.configuration.recordFailure(id, lease.snapshot.revision, message);
      throw new AppError('REMOTE', message);
    } finally {
      await session.close();
      await lease.release();
    }
  }
  async recover() {
    for (const attempt of await this.metadata.all<McpAttempt>('mcp-attempts')) {
      if (attempt.state === 'dispatched' || attempt.state === 'prepared')
        await this.metadata.put('mcp-attempts', attempt.id, {
          ...attempt,
          state: attempt.state === 'dispatched' ? 'unknown' : 'cancelled',
          endedAt: new Date().toISOString(),
        });
    }
  }
  unknown = async (serverId?: string) =>
    (await this.metadata.all<McpAttempt>('mcp-attempts')).filter(
      value =>
        ['unknown', 'dispatched'].includes(value.state) &&
        !value.retryAllowedAt &&
        (!serverId || value.serverId === serverId),
    );
  async acknowledge(id: string) {
    const attempt = await this.metadata.get<McpAttempt>('mcp-attempts', id);
    if (attempt?.state === 'unknown')
      await this.metadata.put('mcp-attempts', id, {
        ...attempt,
        retryAllowedAt: new Date().toISOString(),
      });
  }
  createRun(leases: McpLease[]) {
    const sessions = new Map<string, McpSession>();
    let closing: Promise<void> | undefined;
    return {
      snapshots: leases.map(lease => lease.snapshot),
      sanitize: <T>(value: T): T =>
        leases.reduce((result, lease) => sanitizeMcp(result, lease.secret), value),
      tools: leases.flatMap((lease, serverIndex) =>
        lease.snapshot.tools.map((tool, toolIndex) => ({
          alias: 'mcp_' + serverIndex + '_' + toolIndex,
          label: 'MCP · ' + lease.snapshot.name + ' · ' + (tool.title || tool.name),
          tool,
          execute: async (
            taskId: string,
            traceId: string,
            args: Record<string, unknown>,
            allowImages: boolean,
            signal?: AbortSignal,
            progress?: (text: string) => void,
          ) => {
            const argsHash = await this.digest(canonical(args));
            const permit = this.dispatch.acquire(
              canonical([lease.snapshot.url, tool.name, argsHash]),
            );
            if (!permit)
              return this.error('同一远程调用正在其他运行中派发或等待回执，本次未重复发送。', true);
            try {
              if (
                (await this.unknown()).some(
                  attempt =>
                    attempt.url === lease.snapshot.url &&
                    attempt.tool === tool.name &&
                    attempt.argsHash === argsHash,
                )
              ) {
                return this.error(
                  '同一调用仍有结果未知记录，本次未重新发送。请在 MCP 设置中核对后解除限制。',
                  true,
                );
              }
              const attempt: McpAttempt = {
                id: this.id(),
                taskId,
                traceId,
                serverId: lease.snapshot.id,
                serverName: lease.snapshot.name,
                url: lease.snapshot.url,
                tool: tool.name,
                argsHash,
                preview: JSON.stringify(sanitizeMcp(args, lease.secret), (key, value) =>
                  /token|secret|password|authorization|api.?key/i.test(key) ? '[已隐藏]' : value,
                ).slice(0, 1000),
                state: 'prepared',
                createdAt: new Date().toISOString(),
              };
              await this.metadata.put('mcp-attempts', attempt.id, attempt);
              let session = sessions.get(lease.snapshot.id);
              if (!session) {
                session = new McpSession(lease);
                sessions.set(lease.snapshot.id, session);
              }
              let dispatched = false;
              let responseReceived = false;
              try {
                const result = await session.call(
                  tool,
                  args,
                  signal,
                  async () => {
                    await this.metadata.put('mcp-attempts', attempt.id, {
                      ...attempt,
                      state: 'dispatched',
                    });
                    dispatched = true;
                  },
                  progress ?? (() => {}),
                );
                responseReceived = true;
                const content: (
                  { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
                )[] = [];
                for (const part of result.content ?? []) {
                  if (part.type === 'text')
                    content.push({ type: 'text', text: clippedText(part.text) });
                  else if (
                    part.type === 'image' &&
                    allowImages &&
                    ['image/png', 'image/jpeg', 'image/webp'].includes(part.mimeType)
                  ) {
                    try {
                      const bytes = Buffer.from(part.data, 'base64');
                      validateImage(
                        'mcp.' +
                          (part.mimeType === 'image/jpeg' ? 'jpg' : part.mimeType.split('/')[1]),
                        bytes,
                      );
                      content.push({ type: 'image', data: part.data, mimeType: part.mimeType });
                    } catch {
                      content.push({
                        type: 'text',
                        text: 'MCP 返回的图片无效或超过限制，未转发给模型。',
                      });
                    }
                  } else if (part.type === 'resource' && 'text' in part.resource)
                    content.push({ type: 'text', text: clippedText(String(part.resource.text)) });
                  else
                    content.push({
                      type: 'text',
                      text: 'MCP 返回了 ' + part.type + ' 内容；未自动读取外部地址或导入文件。',
                    });
                }
                if (result.structuredContent !== undefined)
                  content.push({
                    type: 'text',
                    text: clippedText(JSON.stringify(result.structuredContent)),
                  });
                if (!content.length)
                  content.push({ type: 'text', text: 'MCP 工具已返回，无文本结果。' });
                await this.metadata.put('mcp-attempts', attempt.id, {
                  ...attempt,
                  state: result.isError ? 'failed' : 'completed',
                  endedAt: new Date().toISOString(),
                });
                return {
                  content,
                  details: { mcpStatus: result.isError ? 'failed' : 'completed' },
                  isError: !!result.isError,
                };
              } catch (error) {
                const uncertain =
                  responseReceived ||
                  (error instanceof AppError && ['REMOTE', 'UNKNOWN'].includes(error.code)
                    ? error.uncertain
                    : dispatched);
                // Never turn a missing receipt into proof that a remote side effect did not happen.
                await this.metadata
                  .put('mcp-attempts', attempt.id, {
                    ...attempt,
                    state: uncertain ? 'unknown' : signal?.aborted ? 'cancelled' : 'failed',
                    endedAt: new Date().toISOString(),
                  })
                  .catch(() => {});
                return this.error(
                  uncertain
                    ? '远端结果未知或回执未能保存；可能已执行，请先核对服务器状态。同一参数不会自动重试。'
                    : safeMcpError(error, signal?.aborted),
                  uncertain,
                );
              }
            } finally {
              permit.release();
            }
          },
        })),
      ),
      close: () =>
        (closing ??= (async () => {
          await Promise.allSettled([...sessions.values()].map(session => session.close()));
          await Promise.allSettled(leases.map(lease => lease.release()));
        })()),
    };
  }
  private error(text: string, uncertain: boolean) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text }],
      details: { mcpStatus: uncertain ? 'unknown' : 'failed' },
    };
  }
}
export type McpRun = ReturnType<McpRuntime['createRun']>;
