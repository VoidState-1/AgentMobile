import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Model,
} from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { workspaceReply, type FixtureReply } from './workspace-replies';

export function fixtureTransport(
  respond: (round: number, context: Parameters<StreamFn>[1]) => FixtureReply,
): { model: Model<string>; streamFn: StreamFn } {
  let round = 0;
  const model: Model<string> = {
    id: 'fixture',
    name: 'Fixture',
    api: 'test-fixture',
    provider: 'test-fixture',
    baseUrl: '',
    reasoning: false,
    input: ['text'],
    contextWindow: 32000,
    maxTokens: 4096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const streamFn: StreamFn = (_, context, options) => {
    const stream = createAssistantMessageEventStream();
    const reply = respond(++round, context);
    const message: AssistantMessage = {
      role: 'assistant',
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: reply.calls?.length ? 'toolUse' : 'stop',
      timestamp: Date.now(),
    };
    if (reply.text) message.content.push({ type: 'text', text: reply.text });
    for (const [index, call] of (reply.calls ?? []).entries())
      message.content.push({
        type: 'toolCall',
        id: 'fixture-' + round + '-' + index,
        name: call.name,
        arguments: call.arguments,
      });
    void (async () => {
      stream.push({ type: 'start', partial: message });
      await new Promise(resolve => setTimeout(resolve, 5));
      if (options?.signal?.aborted) {
        message.stopReason = 'aborted';
        message.errorMessage = 'cancelled';
        stream.push({ type: 'error', reason: 'aborted', error: message });
      } else
        stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
    })();
    return stream;
  };
  return { model, streamFn };
}

export function workspaceFixtureTransport(prompt: string) {
  return fixtureTransport((_, context) =>
    workspaceReply(
      prompt,
      context.messages.flatMap(message =>
        message.role === 'toolResult'
          ? [
              {
                name: message.toolName,
                text: message.content
                  .filter(part => part.type === 'text')
                  .map(part => part.text)
                  .join(''),
              },
            ]
          : [],
      ),
    ),
  );
}
