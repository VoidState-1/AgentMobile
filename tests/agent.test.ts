import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspace } from '../src/bootstrap/workspace';
import { startTestRun } from './agent-runtime';
import { chatSnapshot } from './protocol-fixtures';
import { SseDecoder } from '../src/adapters/model/sse';
import { protocolTransport, protocolModel } from '../src/adapters/model/protocols';
import { normalizeContext } from '@earendil-works/pi-ai';
import { testStorage } from './storage';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe('Pi Agent 真实执行循环', () => {
  it('演示经过工具读取和写入，产生真实 Git 修改，并可整次撤销', async () => {
    const storage = await testStorage();
    cleanups.push(storage.cleanup);
    const workspace = createWorkspace(storage.files, storage.metadata, randomUUID);
    const project = await workspace.create('原型测试');
    const started = await startTestRun(workspace, project.id, '整理我的资料');
    const task = await started.done;
    expect(task.state).toBe('completed');
    expect(
      task.trace!.filter(item => item.kind === 'tool').map(item => [item.tool, item.state]),
    ).toEqual([
      ['list_files', 'completed'],
      ['read_text', 'completed'],
      ['write_text', 'completed'],
    ]);
    expect((await workspace.readText(project.id, 'documents/summary.md')).text).toContain(
      '整理我的资料',
    );
    expect(task.finalCommit).toBe(task.baseCommit);
    expect(task.finalSnapshot).not.toBe(task.baseSnapshot);
    expect(task.uncommittedPaths).toEqual(['documents/summary.md']);
    expect((await workspace.git.historyPage(project.id, { limit: 100 })).versions).toHaveLength(1);
    await workspace.undoTask(task);
    await expect(workspace.readText(project.id, 'documents/summary.md')).rejects.toThrow();
  });

  it('取消会停止新的工具动作并释放工作区', async () => {
    const storage = await testStorage();
    cleanups.push(storage.cleanup);
    const workspace = createWorkspace(storage.files, storage.metadata, randomUUID);
    const project = await workspace.create('取消测试');
    const started = await startTestRun(workspace, project.id, '整理资料');
    started.cancel();
    expect((await started.done).state).toBe('cancelled');
    workspace.claim(project.id, 'another-run');
    workspace.release(project.id, 'another-run');
  });

  it('下一条消息保留上一次目标和回复，不重放过去的工具调用', async () => {
    const storage = await testStorage();
    cleanups.push(storage.cleanup);
    const workspace = createWorkspace(storage.files, storage.metadata, randomUUID);
    const project = await workspace.create('连续会话');
    const requests: { role: string; content: string }[][] = [];
    vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)).messages);
      return new Response(
        'data: {"choices":[{"delta":{"content":"建议保留两段内容。"},"finish_reason":"stop"}]}\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    });
    const settings = chatSnapshot({ baseUrl: 'https://example.test/v1', apiModelId: 'test' });
    const first = await startTestRun(workspace, project.id, '请整理我的旅行资料', {
      model: settings,
      secret: 'test-only',
    });
    await first.done;
    const second = await startTestRun(workspace, project.id, '把上一个建议再简短一些', {
      model: settings,
      secret: 'test-only',
    });
    await second.done;
    expect(
      requests[1].some(
        message => message.role === 'user' && message.content === '请整理我的旅行资料',
      ),
    ).toBe(true);
    expect(
      requests[1].some(
        message => message.role === 'assistant' && message.content === '建议保留两段内容。',
      ),
    ).toBe(true);
    expect(JSON.stringify(requests[1].at(-1)?.content)).toContain('把上一个建议再简短一些');
  });

  it('多轮工具执行后回复只保留最终答案，完整过程保存在 transcript', async () => {
    const storage = await testStorage();
    cleanups.push(storage.cleanup);
    const workspace = createWorkspace(storage.files, storage.metadata, randomUUID);
    const project = await workspace.create('回复排版');
    let round = 0;
    vi.stubGlobal('fetch', async () => {
      round++;
      const event =
        round === 1
          ? {
              choices: [
                {
                  delta: {
                    content: '我先查看项目。',
                    tool_calls: [
                      {
                        index: 0,
                        id: 'list-once',
                        function: { name: 'list_files', arguments: '{}' },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
            }
          : { choices: [{ delta: { content: '已查看项目资料。' }, finish_reason: 'stop' }] };
      return new Response('data: ' + JSON.stringify(event) + '\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });
    const settings = chatSnapshot({ baseUrl: 'https://example.test/v1', apiModelId: 'test' });
    const started = await startTestRun(workspace, project.id, '查看资料', {
      model: settings,
      secret: 'test-only',
    });
    const task = await started.done;
    expect(task.response).toBe('已查看项目资料。');
    expect(task.trace!.filter(item => item.kind === 'tool')).toMatchObject([
      { tool: 'list_files', state: 'completed' },
    ]);
    const transcript = await storage.metadata.transcriptFrames(task.id, -1, 100);
    expect(JSON.stringify(transcript)).toContain('我先查看项目。');
  });
});

describe('流式协议', () => {
  it('在 CRLF 和数据之间任意分片仍正确组帧', () => {
    const decoder = new SseDecoder();
    expect(decoder.push('data: {"a":')).toEqual([]);
    expect(decoder.push('1}\r\n\r')).toEqual([]);
    expect(decoder.push('\ndata: [DONE]\n\n')).toEqual(['{"a":1}', '[DONE]']);
  });

  it('缺少完成标记的工具参数不会交给执行器', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"x","function":{"name":"write_text","arguments":"{\\"path\\":\\"x"}}]}}]}\n\n',
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
    );
    const settings = chatSnapshot({ baseUrl: 'https://example.test/v1', apiModelId: 'test' });
    const stream = await protocolTransport(settings, 'test-only')(
      protocolModel(settings),
      normalizeContext({
        messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }],
      }),
    );
    const final = await stream.result();
    expect(final.stopReason).toBe('error');
    expect(final.content.some(part => part.type === 'toolCall')).toBe(false);
  });

  it('图片输入只有开启后才进入请求，凭证不会进入消息正文', async () => {
    let requestBody = '';
    vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
      requestBody = String(init.body);
      return new Response(
        'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    });
    const settings = chatSnapshot({ baseUrl: 'https://example.test/v1', apiModelId: 'test' });
    const context = normalizeContext({
      messages: [
        {
          role: 'toolResult',
          toolCallId: 'img',
          toolName: 'inspect_image',
          isError: false,
          timestamp: Date.now(),
          content: [
            { type: 'text', text: '资料' },
            { type: 'image', mimeType: 'image/png', data: 'test-image-base64' },
          ],
        },
      ],
    });
    const disabled = await protocolTransport(settings, 'not-in-body')(
      protocolModel(settings),
      context,
    );
    await disabled.result();
    expect(requestBody).not.toContain('test-image-base64');
    expect(requestBody).not.toContain('not-in-body');
    const enabledSettings = {
      ...settings,
      parameters: { ...settings.parameters, allowImages: true },
    };
    const enabled = await protocolTransport(enabledSettings, 'not-in-body')(
      protocolModel(enabledSettings),
      context,
    );
    await enabled.result();
    expect(requestBody).toContain('data:image/png;base64,test-image-base64');
  });
});
