import { getCurrentSystemPrompt, type Message, type Tool } from '@earendil-works/pi-ai';
import type { ModelRunSnapshot } from '@/core/models/types';
import { ProtocolError } from '../http';
import { imageParts, userParts, textOf, number, argsObject, type Wire, type PublicThinking } from './shared';
import type { ProtocolDecoder } from './decoder';

function anthropicMessages(messages: Message[], config: ModelRunSnapshot): Wire[] {
  const result: Wire[] = [];
  const push = (role: string, content: Wire[]) => { const last = result.at(-1); if (last?.role === role) last.content.push(...content); else result.push({ role, content }); };
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'user') push('user', userParts(message, config));
    else if (message.role === 'toolResult') push('user', [{ type: 'tool_result', tool_use_id: message.toolCallId, is_error: message.isError,
      content: [{ type: 'text', text: textOf(message.content) || '已完成' }, ...imageParts(message.content, config.parameters.allowImages, config.protocol)] }]);
    else push('assistant', message.content.flatMap((part): Wire[] => {
      if (part.type === 'text') return part.text ? [{ type: 'text', text: part.text }] : [];
      if (part.type === 'toolCall') return [{ type: 'tool_use', id: part.id, name: part.name, input: part.arguments }];
      if (part.type === 'thinking' && message.api === 'mobile-anthropic-messages' && part.thinkingSignature) return [part.redacted ?
        { type: 'redacted_thinking', data: part.thinkingSignature } : { type: 'thinking', thinking: part.thinking, signature: part.thinkingSignature }];
      return [];
    }));
  }
  return result;
}

export function anthropicBody(config: ModelRunSnapshot, messages: Message[], tools: Tool[]): Wire {
  const system = getCurrentSystemPrompt(messages); const p = config.parameters;
  return {
    model: config.apiModelId, stream: true, max_tokens: p.maxOutputTokens, ...(p.temperature !== undefined ? { temperature: p.temperature } : {}),
    ...(p.reasoning === 'off' ? { thinking: { type: 'disabled' } } : p.reasoning === 'on' ? {
      thinking: p.reasoningStrategy === 'adaptive' ? { type: 'adaptive' } : { type: 'enabled', budget_tokens: p.reasoningBudget ?? 1024 },
    } : {}),
    ...(system ? { system } : {}), messages: anthropicMessages(messages, config),
    ...(tools.length ? { tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) } : {}),
  };
}

export const anthropicDecoder: ProtocolDecoder = {
  consume(event, context, state) {
if (event.type === 'message_start') {
              state.began = true; context.message.responseId = event.message?.id;
              context.message.usage.input = number(event.message?.usage?.input_tokens);
              context.message.usage.cacheRead = number(event.message?.usage?.cache_read_input_tokens);
              context.message.usage.cacheWrite = number(event.message?.usage?.cache_creation_input_tokens);
            } else if (event.type === 'content_block_start') {
              if (!state.began || !Number.isInteger(event.index) || event.index < 0 || event.index > 127 || state.blocks.has(event.index)) throw new ProtocolError('内容块序号无效。');
              const block = event.content_block; const index = context.message.content.length;
              if (block.type === 'text') { context.message.content.push({ type: 'text', text: block.text ?? '' }); context.stream.push({ type: 'text_start', contentIndex: index, partial: context.message }); }
              else if (block.type === 'tool_use') context.message.content.push({ type: 'toolCall', id: block.id, name: block.name, arguments: block.input ?? {} });
              else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
                context.message.content.push({ type: 'thinking', thinking: block.type === 'thinking' ? block.thinking ?? '' : '',
                  redacted: block.type === 'redacted_thinking', thinkingSignature: block.signature ?? block.data ?? '',
                  visibility: block.type === 'redacted_thinking' ? 'unavailable' : context.visibility } as PublicThinking);
                context.stream.push({ type: 'thinking_start', contentIndex: index, partial: context.message });
              }
              else throw new ProtocolError('服务返回尚未支持的内容块。');
              state.blocks.set(event.index, { type: block.type, index, json: '', closed: false });
            } else if (event.type === 'content_block_delta') {
              const block = state.blocks.get(event.index); if (!block || block.closed) throw new ProtocolError('内容块分片缺少开始标记。');
              const part = context.message.content[block.index]; const delta = event.delta;
              if (delta.type === 'text_delta' && part.type === 'text') { part.text += delta.text; context.stream.push({ type: 'text_delta', contentIndex: block.index, delta: delta.text, partial: context.message }); }
              else if (delta.type === 'input_json_delta' && part.type === 'toolCall') block.json += delta.partial_json;
              else if (delta.type === 'thinking_delta' && part.type === 'thinking') {
                part.thinking += delta.thinking; context.stream.push({ type: 'thinking_delta', contentIndex: block.index, delta: delta.thinking, partial: context.message });
              }
              else if (delta.type === 'signature_delta' && part.type === 'thinking') part.thinkingSignature = (part.thinkingSignature ?? '') + delta.signature;
              else throw new ProtocolError('内容块分片类型不匹配。');
            } else if (event.type === 'content_block_stop') {
              const block = state.blocks.get(event.index); if (!block || block.closed) throw new ProtocolError('内容块结束标记无效。');
              block.closed = true; const part = context.message.content[block.index];
              context.closeContent(block.index);
              if (part.type === 'toolCall') part.arguments = argsObject(block.json ? JSON.parse(block.json) : part.arguments);
            } else if (event.type === 'message_delta') {
              state.reason = event.delta?.stop_reason ?? state.reason; context.message.usage.output = number(event.usage?.output_tokens);
            } else if (event.type === 'message_stop') { state.terminal = true; return true; }
  },
  finish(context, state) {
if (!state.began || !state.terminal || !state.reason || [...state.blocks.values()].some((b) => !b.closed) || !['end_turn', 'tool_use', 'max_tokens', 'stop_sequence'].includes(state.reason)) throw new ProtocolError('Anthropic 响应不完整；未执行工具。');
          context.message.stopReason = state.reason === 'max_tokens' ? 'length' : state.reason === 'tool_use' ? 'toolUse' : 'stop';
          context.message.usage.totalTokens = context.message.usage.input + context.message.usage.output + context.message.usage.cacheRead + context.message.usage.cacheWrite;
  },
};
