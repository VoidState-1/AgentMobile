import type { ModelProtocol, ModelRunSnapshot } from '../src/core/models/types';
import { defaultOutputTokens } from '../src/core/agent/settings';
export const protocols: ModelProtocol[] = ['chat-completions', 'anthropic-messages', 'gemini'];
export const snapshot = (protocol: ModelProtocol): ModelRunSnapshot => ({
  connectionId: 'test-connection',
  connectionName: '测试服务',
  connectionRevision: 1,
  modelEntryId: 'test-model',
  modelName: '测试模型',
  modelRevision: 1,
  apiModelId: protocol === 'gemini' ? 'models/test-model' : 'test-model',
  protocol,
  baseUrl: 'https://example.test/v1',
  compatibility: 'standard',
  apiVersion: '2023-06-01',
  auth: 'key',
  parameters: { maxOutputTokens: 512, temperature: 0.7, allowImages: true, reasoning: 'off' },
  contextTokens: 32000,
});
export const chatSnapshot = (overrides: Partial<ModelRunSnapshot> = {}): ModelRunSnapshot => ({
  ...snapshot('chat-completions'),
  parameters: { maxOutputTokens: defaultOutputTokens, allowImages: false, reasoning: 'off' },
  ...overrides,
});
export const sse = (events: unknown[]) =>
  events
    .map(event => 'data: ' + (typeof event === 'string' ? event : JSON.stringify(event)) + '\n\n')
    .join('');
export function answerEvents(protocol: ModelProtocol, text: string): unknown[] {
  if (protocol === 'chat-completions')
    return [
      { choices: [{ delta: { content: text }, finish_reason: 'stop' }] },
      {
        choices: [],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          prompt_cache_hit_tokens: 3,
        },
      },
      '[DONE]',
    ];
  if (protocol === 'gemini')
    return [
      {
        candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      },
    ];
  return [
    {
      type: 'message_start',
      message: { id: 'msg-test', usage: { input_tokens: 10, cache_read_input_tokens: 3 } },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ];
}
export function toolEvents(protocol: ModelProtocol, name: string, args: unknown = {}): unknown[] {
  const json = JSON.stringify(args);
  if (protocol === 'chat-completions')
    return [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'tool-test', function: { name, arguments: json.slice(0, 4) } },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: { tool_calls: [{ index: 0, function: { arguments: json.slice(4) } }] },
            finish_reason: 'tool_calls',
          },
        ],
      },
      '[DONE]',
    ];
  if (protocol === 'gemini')
    return [
      {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: { id: 'native-call', name, args },
                  thoughtSignature: 'opaque-signature',
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      },
    ];
  return [
    { type: 'message_start', message: { id: 'msg-tool', usage: { input_tokens: 12 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: '查看资料' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'signature_delta', signature: 'anthropic-signature' },
    },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', id: 'tool-test', name, input: {} },
    },
    {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'input_json_delta', partial_json: json.slice(0, 3) },
    },
    {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'input_json_delta', partial_json: json.slice(3) },
    },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 8 } },
    { type: 'message_stop' },
  ];
}
export function streamed(events: unknown[]): Response {
  const bytes = new TextEncoder().encode(sse(events));
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
        controller.close();
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}
