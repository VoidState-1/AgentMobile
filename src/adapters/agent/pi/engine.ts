import { Agent } from '@earendil-works/pi-agent-core';
import type { AgentEvent, StreamFn } from '@earendil-works/pi-agent-core';
import type { Message, AssistantMessage, Model } from '@earendil-works/pi-ai';
import type { AgentEnginePort, EngineControls, EngineEvent, EngineInput, EngineSession } from '@/core/agent/engine';
import type { PublicThinking } from '@/adapters/model/protocols';

export class PiEngineAdapter implements AgentEnginePort {
  constructor(private readonly transport: { model: Model<string>; streamFn: StreamFn }, private readonly visibility: 'reasoning' | 'summary' = 'reasoning') {}
  create(input: EngineInput, receive: (event: EngineEvent) => void, controls: EngineControls): EngineSession {
    const model = this.transport.model;
    const messages: Message[] = input.history.flatMap((item): Message[] => [
      { role: 'user', content: item.prompt, timestamp: new Date(item.createdAt).getTime() },
      { role: 'assistant', content: [{ type: 'text', text: item.response }], api: model.api, provider: model.provider, model: model.id, stopReason: 'stop',
        timestamp: new Date(item.createdAt).getTime(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
    ]);
    const agent = new Agent({ initialState: { model, tools: input.tools, thinkingLevel: input.reasoning ? 'medium' : 'off', messages, systemPrompt: input.systemPrompt },
      streamFn: this.transport.streamFn, toolExecution: 'sequential', beforeToolCall: controls.beforeTool,
      prepareRequest: (_, signal) => controls.beforeRequest?.(signal) });
    let round = 0; let cancelled = false;
    const response = (message: AssistantMessage) => message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n\n');
    const content = (message: AssistantMessage, index: number, ended: boolean) => {
      const part = message.content[index]; if (!part || part.type === 'toolCall') return;
      const thinking = part as PublicThinking;
      receive({ type: 'content', round, index, kind: part.type === 'text' ? 'text' : 'reasoning', text: part.type === 'text' ? part.text : part.redacted ? '' : part.thinking,
        visibility: part.type === 'thinking' ? part.redacted ? 'unavailable' : thinking.visibility ?? this.visibility : undefined, ended, response: response(message) });
    };
    agent.subscribe((event: AgentEvent) => {
      if (event.type === 'message_start' && event.message.role === 'assistant') receive({ type: 'assistant_start', round: ++round });
      if (event.type === 'message_update' && event.message.role === 'assistant' && 'contentIndex' in event.assistantMessageEvent) {
        const delta = event.assistantMessageEvent; content(event.message, delta.contentIndex, delta.type === 'text_end' || delta.type === 'thinking_end');
      }
      if (event.type === 'tool_execution_start') receive({ type: 'tool_start', round, callId: event.toolCallId, tool: event.toolName, args: event.args });
      if (event.type === 'tool_execution_update') receive({ type: 'tool_update', round, callId: event.toolCallId, output: event.partialResult.content.filter((part: { type: string }) => part.type === 'text').map((part: { text: string }) => part.text).join('\n').slice(0, 6000) });
      if (event.type === 'tool_execution_end') receive({ type: 'tool_end', round, callId: event.toolCallId, output: (event.result?.content ?? []).filter((part: { type: string }) => part.type === 'text').map((part: { text: string }) => part.text).join('\n').slice(0, 6000),
        error: event.isError, unknown: event.result?.details?.mcpStatus === 'unknown', durationMs: event.durationMs });
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        const message = event.message; message.content.forEach((_, index) => content(message, index, !['error', 'aborted'].includes(message.stopReason)));
        receive({ type: 'assistant_end', round, response: response(message), transcript: JSON.parse(JSON.stringify({ messages: agent.state.messages })) });
      }
    });
    return { get round() { return round; }, cancel: () => { cancelled = true; agent.abort(); }, execute: async () => {
      if (cancelled) return { stopReason: 'aborted' };
      await agent.prompt(input.prompt); const last = [...agent.state.messages].reverse().find((message) => message.role === 'assistant');
      const reason = last?.role === 'assistant' ? last.stopReason : undefined;
      if (cancelled && (reason === undefined || reason === 'pending' || reason === 'deferred')) return { stopReason: 'aborted' };
      if (reason === undefined || reason === 'pending' || reason === 'deferred') return { stopReason: 'error', error: '模型未返回完整结束状态。' };
      return { stopReason: reason, error: agent.state.errorMessage };
    } };
  }
}
