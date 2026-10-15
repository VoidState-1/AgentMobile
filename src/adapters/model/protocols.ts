import { AppError } from '@/core/errors';
import { chatBody, chatDecoder } from './protocols/chat';
import { anthropicBody, anthropicDecoder } from './protocols/anthropic';
import { geminiBody, geminiDecoder } from './protocols/gemini';
import { decoderState } from './protocols/decoder';
import type { NativeAssistant, PublicThinking, Wire } from './protocols/shared';
import { createAssistantMessageEventStream, getCurrentTools, type Message, type Model, type Tool, type ToolCall } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { ModelRunSnapshot } from '@/core/models/types';
import { geminiResource, modelEndpoint, modelHeaders, requestStream, safeModelError } from './http';
import { contentLimits, defaultAgentLimits } from '@/core/agent/settings';
export type { PublicThinking } from './protocols/shared';
const bodies = { 'chat-completions': chatBody, 'anthropic-messages': anthropicBody, gemini: geminiBody };
const decoders = { 'chat-completions': chatDecoder, 'anthropic-messages': anthropicDecoder, gemini: geminiDecoder };

export function protocolModel(config: ModelRunSnapshot): Model<string> {
  return { id: config.apiModelId, name: config.modelName, api: 'mobile-' + config.protocol, provider: config.connectionId,
    baseUrl: config.baseUrl, reasoning: config.parameters.reasoning !== 'off', input: config.parameters.allowImages ? ['text', 'image'] : ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: config.contextTokens, maxTokens: config.parameters.maxOutputTokens };
}

export function protocolBody(config: ModelRunSnapshot, messages: Message[], tools: Tool[]): Wire {
  return bodies[config.protocol](config, messages, tools);
}

export function protocolTransport(config: ModelRunSnapshot, secret: string, web = false, timeoutMs = defaultAgentLimits.requestTimeoutMs): StreamFn {
  let requestSequence = 0;
  const headers = modelHeaders(config, secret, web);
  const endpoint = modelEndpoint(config, config.protocol === 'gemini' ? geminiResource(config.apiModelId) + ':streamGenerateContent?alt=sse' :
    config.protocol === 'anthropic-messages' ? 'messages' : 'chat/completions');
  return (model, context, options) => {
    const requestId = ++requestSequence;
    const stream = createAssistantMessageEventStream();
    const message: NativeAssistant = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop', timestamp: Date.now() };
    void (async () => {
      try {
        const body = protocolBody(config, context.messages, getCurrentTools(context.messages));
        stream.push({ type: 'start', partial: message });
        const ended = new Set<number>();
        const closeContent = (index: number) => {
          const part = message.content[index]; if (!part || ended.has(index)) return;
          if (part.type === 'text') stream.push({ type: 'text_end', contentIndex: index, content: part.text, partial: message });
          else if (part.type === 'thinking') stream.push({ type: 'thinking_end', contentIndex: index, content: part.redacted ? '' : part.thinking, partial: message });
          ended.add(index);
        };
        const append = (kind: 'text' | 'thinking', delta: string, visibility?: PublicThinking['visibility']) => {
          let index = message.content.length - 1;
          const last = message.content[index];
          if (!last || last.type !== kind || ended.has(index) || (kind === 'thinking' && (last as PublicThinking).visibility !== visibility)) {
            closeContent(index); index = message.content.length;
            message.content.push(kind === 'text' ? { type: 'text', text: '' } : { type: 'thinking', thinking: '', visibility } as PublicThinking);
            if (kind === 'text') stream.push({ type: 'text_start', contentIndex: index, partial: message });
            else stream.push({ type: 'thinking_start', contentIndex: index, partial: message });
          }
          const part = message.content[index];
          if (part.type === 'text') { part.text += delta; stream.push({ type: 'text_delta', contentIndex: index, delta, partial: message }); }
          else if (part.type === 'thinking') { part.thinking += delta; stream.push({ type: 'thinking_delta', contentIndex: index, delta, partial: message }); }
        };
        const text = (delta: string) => append('text', delta);
        const visibility = config.parameters.reasoningDisplay ?? (config.protocol === 'chat-completions' ? 'reasoning' : 'summary');
        const decoderContext = { config, message, stream, requestId, visibility, closeContent, append, text };
        const state = decoderState(); const decoder = decoders[config.protocol];
        await requestStream(endpoint, headers, body, options?.signal, (data) => {
          if (data === '[DONE]') { state.terminal = true; return true; }
          const event: Wire = JSON.parse(data);
          if (!event || typeof event !== 'object' || Array.isArray(event)) throw new AppError('REMOTE', '服务流数据格式与所选协议不匹配。');
          if (event.error || event.type === 'error') throw new AppError('REMOTE', '服务在流中返回错误，请检查模型与服务状态。');
          decoder.consume(event, decoderContext, state);
          return false;
        }, timeoutMs);
        if (options?.signal?.aborted) throw new AppError('REMOTE', '请求已取消。');
        decoder.finish(decoderContext, state);
        const toolCalls = message.content.filter((p): p is ToolCall => p.type === 'toolCall');
        if (message.stopReason === 'toolUse' && !toolCalls.length) throw new AppError('REMOTE', '响应缺少工具内容。');
        if (config.protocol === 'anthropic-messages' && toolCalls.length && message.stopReason === 'stop') throw new AppError('REMOTE', '工具调用缺少完整结束标记。');
        if (toolCalls.length > contentLimits.toolCallsPerRound) throw new AppError('REMOTE', '单轮工具调用超过限制。');
        if (toolCalls.some((p) => !p.id || !/^[a-zA-Z0-9_-]{1,128}$/.test(p.name)) || new Set(toolCalls.map((p) => p.id)).size !== toolCalls.length) throw new AppError('REMOTE', '工具调用标识无效。');
        if (message.stopReason === 'length') message.content = message.content.filter((p) => p.type !== 'toolCall');
        if (message.stopReason === 'stop' && !message.content.some((p) => p.type === 'text' && p.text.trim())) throw new AppError('REMOTE', '模型没有返回可用回答。');
        message.rawStopReason = state.reason;
        message.content.forEach((_, index) => closeContent(index));
        stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse' | 'length', message });
      } catch (error) {
        message.content = message.content.filter((p) => p.type !== 'toolCall');
        delete message.nativeParts;
        message.stopReason = options?.signal?.aborted ? 'aborted' : 'error'; message.errorMessage = safeModelError(error, options?.signal?.aborted);
        stream.push({ type: 'error', reason: message.stopReason, error: message });
      }
    })();
    return stream;
  };
}
