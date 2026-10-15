import { AppError } from '@/core/errors';
import {
  getCurrentSystemPrompt,
  type Message,
  type Tool,
  type ThinkingContent,
} from '@earendil-works/pi-ai';
import type { ModelRunSnapshot } from '@/core/models/types';

import { contentLimits } from '@/core/agent/settings';
import {
  imageParts,
  userParts,
  textOf,
  number,
  argsObject,
  type Wire,
  type NativeAssistant,
} from './shared';
import type { ProtocolDecoder } from './decoder';

function chatMessages(messages: Message[], config: ModelRunSnapshot): Wire[] {
  const result: Wire[] = [];
  let images: Wire[] = [];
  const flush = () => {
    if (images.length)
      result.push({
        role: 'user',
        content: [{ type: 'text', text: '工具读取的项目图片：' }, ...images],
      });
    images = [];
  };
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role !== 'toolResult') flush();
    if (message.role === 'user')
      result.push({
        role: 'user',
        content: typeof message.content === 'string' ? message.content : userParts(message, config),
      });
    else if (message.role === 'toolResult') {
      result.push({
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: textOf(message.content),
      });
      images.push(...imageParts(message.content, config.parameters.allowImages, config.protocol));
    } else {
      const calls = message.content.filter(part => part.type === 'toolCall');
      const field = (message as NativeAssistant).chatReasoningField;
      result.push({
        role: 'assistant',
        content: textOf(message.content) || null,
        ...(field &&
        message.api === 'mobile-chat-completions' &&
        message.provider === config.connectionId
          ? {
              [field]: message.content
                .filter(
                  (part): part is ThinkingContent => part.type === 'thinking' && !part.redacted,
                )
                .map(part => part.thinking)
                .join(''),
            }
          : {}),
        ...(calls.length
          ? {
              tool_calls: calls.map(part => ({
                id: part.id,
                type: 'function',
                function: { name: part.name, arguments: JSON.stringify(part.arguments) },
              })),
            }
          : {}),
      });
    }
  }
  flush();
  return result;
}

export function chatBody(config: ModelRunSnapshot, messages: Message[], tools: Tool[]): Wire {
  const system = getCurrentSystemPrompt(messages);
  const p = config.parameters;
  return {
    model: config.apiModelId,
    stream: true,
    max_tokens: p.maxOutputTokens,
    ...(p.temperature !== undefined ? { temperature: p.temperature } : {}),
    ...(config.compatibility === 'deepseek'
      ? {
          ...(p.reasoning === 'provider-default'
            ? {}
            : { thinking: { type: p.reasoning === 'on' ? 'enabled' : 'disabled' } }),
          stream_options: { include_usage: true },
        }
      : {}),
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...chatMessages(messages, config),
    ],
    ...(tools.length
      ? {
          tools: tools.map(tool => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
        }
      : {}),
  };
}

export const chatDecoder: ProtocolDecoder = {
  consume(event, context, state) {
    const choice = event.choices?.[0];
    const delta = choice?.delta;
    if (choice?.finish_reason) state.reason = choice.finish_reason;
    for (const field of ['reasoning_content', 'reasoning'] as const)
      if (typeof delta?.[field] === 'string' && delta[field]) {
        context.message.chatReasoningField = field;
        context.append('thinking', delta[field], context.visibility);
      }
    if (typeof delta?.reasoning_summary === 'string' && delta.reasoning_summary)
      context.append('thinking', delta.reasoning_summary, 'summary');
    if (typeof delta?.content === 'string') context.text(delta.content);
    for (const update of delta?.tool_calls ?? []) {
      if (
        !Number.isInteger(update.index) ||
        update.index < 0 ||
        update.index >= contentLimits.toolCallsPerRound
      )
        throw new AppError('REMOTE', '工具调用序号无效。');
      const call = state.calls.get(update.index) ?? { id: '', name: '', json: '' };
      if (update.id) call.id = update.id;
      call.name += update.function?.name ?? '';
      call.json += update.function?.arguments ?? '';
      state.calls.set(update.index, call);
    }
    if (event.usage) {
      context.message.usage.cacheRead = number(
        event.usage.prompt_cache_hit_tokens ?? event.usage.prompt_tokens_details?.cached_tokens,
      );
      context.message.usage.cacheWrite = number(
        event.usage.prompt_tokens_details?.cache_write_tokens,
      );
      context.message.usage.input = Math.max(
        0,
        number(event.usage.prompt_tokens) -
          context.message.usage.cacheRead -
          context.message.usage.cacheWrite,
      );
      context.message.usage.output = number(event.usage.completion_tokens);
      context.message.usage.totalTokens =
        number(event.usage.total_tokens) ||
        context.message.usage.input +
          context.message.usage.output +
          context.message.usage.cacheRead +
          context.message.usage.cacheWrite;
    }
  },
  finish(context, state) {
    if (!state.reason || !['stop', 'tool_calls', 'function_call', 'length'].includes(state.reason))
      throw new AppError('REMOTE', '模型响应不完整；未执行工具。');
    if (state.reason !== 'length')
      for (const call of state.calls.values()) {
        if (!call.id || !call.name || !['tool_calls', 'function_call'].includes(state.reason))
          throw new AppError('REMOTE', '工具调用缺少完整结束标记。');
        context.message.content.push({
          type: 'toolCall',
          id: call.id,
          name: call.name,
          arguments: argsObject(JSON.parse(call.json)),
        });
      }
    if (['tool_calls', 'function_call'].includes(state.reason) && !state.calls.size)
      throw new AppError('REMOTE', '模型未返回声明的工具调用。');
    context.message.stopReason =
      state.reason === 'length' ? 'length' : state.calls.size ? 'toolUse' : 'stop';
  },
};
