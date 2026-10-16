import type { JsonObject } from '@earendil-works/pi-ai';

export interface FixtureReply {
  text?: string;
  calls?: { name: string; arguments: JsonObject }[];
}

/** Protocol fixtures for workspace integration tests, never imported by the app. */
export function workspaceReply(
  prompt: string,
  results: { name: string; text: string }[],
): FixtureReply {
  const listing = results.find(result => result.name === 'list_files');
  if (!listing) return { text: '读取项目文件。', calls: [{ name: 'list_files', arguments: {} }] };
  const files: { path: string; revision: string }[] = JSON.parse(listing.text).files ?? [];
  const reading = results.find(result => result.name === 'read_text');
  if (!reading)
    return {
      text: '读取资料内容。',
      calls: [
        {
          name: 'read_text',
          arguments: {
            path: files.find(file => /\.md$/.test(file.path))?.path ?? 'documents/notes.md',
          },
        },
      ],
    };
  if (!results.some(result => result.name === 'write_text'))
    return {
      text: '保存整理结果。',
      calls: [
        {
          name: 'write_text',
          arguments: {
            path: 'documents/summary.md',
            text:
              '# 测试资料整理\n\n' +
              prompt +
              '\n\n## 原始资料摘录\n\n' +
              String(JSON.parse(reading.text).text ?? ''),
            expectedRevision:
              files.find(file => file.path === 'documents/summary.md')?.revision ?? null,
          },
        },
      ],
    };
  return { text: '测试模型已整理资料并保存文件。' };
}

interface FixtureMessage {
  role: string;
  content: unknown;
  tool_call_id?: string;
  tool_calls?: { id: string; function: { name: string } }[];
}

/** Model endpoint fixture shared by Web interception and the local test server. */
export function workspaceChatEvent(messages: FixtureMessage[]) {
  const start = messages.findLastIndex(message => message.role === 'user');
  const current = messages.slice(start);
  const calls = new Map(
    current.flatMap(message =>
      (message.tool_calls ?? []).map(call => [call.id, call.function.name] as const),
    ),
  );
  const reply = workspaceReply(
    String(current[0]?.content ?? ''),
    current.flatMap(message =>
      message.role === 'tool'
        ? [{ name: calls.get(message.tool_call_id ?? '') ?? '', text: String(message.content) }]
        : [],
    ),
  );
  return {
    choices: [
      {
        delta: {
          content: reply.text,
          tool_calls: reply.calls?.map((call, index) => ({
            index,
            id: 'workspace-' + current.length + '-' + index,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          })),
        },
        finish_reason: reply.calls?.length ? 'tool_calls' : 'stop',
      },
    ],
  };
}
