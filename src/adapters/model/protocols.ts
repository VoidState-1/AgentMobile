import { createAssistantMessageEventStream, getCurrentSystemPrompt, getCurrentTools,
  type AssistantMessage, type Message, type Model, type Tool, type ToolCall, type ThinkingContent } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { ModelRunSnapshot } from '@/core/models/types';
import { geminiResource, modelEndpoint, modelHeaders, ProtocolError, requestStream, safeModelError } from './http';
import { contentLimits, defaultAgentLimits } from '@/core/agent/settings';

type Wire = Record<string, any>;
export type PublicThinking = ThinkingContent & { visibility?: 'reasoning' | 'summary' | 'unavailable' };
type NativeAssistant = AssistantMessage & { nativeParts?: { protocol: 'gemini'; parts: Wire[] }; chatReasoningField?: 'reasoning_content' | 'reasoning' };
const textOf = (parts: { type: string; text?: string }[]) => parts.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
const imageParts = (parts: { type: string; data?: string; mimeType?: string }[], allowed: boolean, protocol: ModelRunSnapshot['protocol']): Wire[] => {
  const images = parts.filter((part) => part.type === 'image');
  if (images.length && !allowed) throw new ProtocolError('此配置未开启图片输入，请在模型详情开启后再发送。');
  return images.map((part) => protocol === 'gemini' ? { inlineData: { mimeType: part.mimeType, data: part.data } } :
    protocol === 'anthropic-messages' ? { type: 'image', source: { type: 'base64', media_type: part.mimeType, data: part.data } } :
      { type: 'image_url', image_url: { url: 'data:' + part.mimeType + ';base64,' + part.data } });
};
function userParts(message: Extract<Message, { role: 'user' }>, config: ModelRunSnapshot): Wire[] {
  const content = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
  return content.flatMap((part) => part.type === 'text' ? [config.protocol === 'gemini' ? { text: part.text } : { type: 'text', text: part.text }] : imageParts([part], config.parameters.allowImages, config.protocol));
}

export function protocolModel(config: ModelRunSnapshot): Model<string> {
  return { id: config.apiModelId, name: config.modelName, api: 'mobile-' + config.protocol, provider: config.connectionId,
    baseUrl: config.baseUrl, reasoning: config.parameters.reasoning !== 'off', input: config.parameters.allowImages ? ['text', 'image'] : ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: config.contextTokens, maxTokens: config.parameters.maxOutputTokens };
}

function chatMessages(messages: Message[], config: ModelRunSnapshot): Wire[] {
  const result: Wire[] = []; let images: Wire[] = [];
  const flush = () => { if (images.length) result.push({ role: 'user', content: [{ type: 'text', text: '工具读取的项目图片：' }, ...images] }); images = []; };
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role !== 'toolResult') flush();
    if (message.role === 'user') result.push({ role: 'user', content: typeof message.content === 'string' ? message.content : userParts(message, config) });
    else if (message.role === 'toolResult') {
      result.push({ role: 'tool', tool_call_id: message.toolCallId, content: textOf(message.content) });
      images.push(...imageParts(message.content, config.parameters.allowImages, config.protocol));
    } else {
      const calls = message.content.filter((part) => part.type === 'toolCall');
      const field = (message as NativeAssistant).chatReasoningField;
      result.push({ role: 'assistant', content: textOf(message.content) || null,
        ...(field && message.api === 'mobile-chat-completions' && message.provider === config.connectionId ? {
          [field]: message.content.filter((part): part is ThinkingContent => part.type === 'thinking' && !part.redacted).map((part) => part.thinking).join(''),
        } : {}),
        ...(calls.length ? { tool_calls: calls.map((part) => ({ id: part.id, type: 'function', function: { name: part.name, arguments: JSON.stringify(part.arguments) } })) } : {}) });
    }
  }
  flush(); return result;
}
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
function geminiMessages(messages: Message[], config: ModelRunSnapshot): Wire[] {
  const result: Wire[] = []; const nativeIds = new Map<string, string>();
  const push = (role: string, parts: Wire[]) => { const last = result.at(-1); if (last?.role === role) last.parts.push(...parts); else result.push({ role, parts }); };
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'user') push('user', userParts(message, config));
    else if (message.role === 'toolResult') push('user', [
      { functionResponse: { name: message.toolName, ...(nativeIds.get(message.toolCallId) ? { id: nativeIds.get(message.toolCallId) } : {}),
        response: { [message.isError ? 'error' : 'result']: textOf(message.content) || '已完成' } } },
      ...imageParts(message.content, config.parameters.allowImages, config.protocol),
    ]);
    else {
      const native = (message as NativeAssistant).nativeParts;
      if (message.api === 'mobile-gemini' && native?.protocol === 'gemini') {
        const calls = message.content.filter((part) => part.type === 'toolCall'); let index = 0;
        for (const part of native.parts) if (part.functionCall) { if (part.functionCall.id && calls[index]) nativeIds.set(calls[index].id, part.functionCall.id); index++; }
        push('model', native.parts);
      } else push('model', message.content.flatMap((part): Wire[] => part.type === 'text' ? [{ text: part.text }] : part.type === 'toolCall' ?
        [{ functionCall: { name: part.name, args: part.arguments } }] : []));
    }
  }
  return result;
}
export function protocolBody(config: ModelRunSnapshot, messages: Message[], tools: Tool[]): Wire {
  const system = getCurrentSystemPrompt(messages); const p = config.parameters;
  if (config.protocol === 'anthropic-messages') return {
    model: config.apiModelId, stream: true, max_tokens: p.maxOutputTokens, ...(p.temperature !== undefined ? { temperature: p.temperature } : {}),
    ...(p.reasoning === 'off' ? { thinking: { type: 'disabled' } } : p.reasoning === 'on' ? {
      thinking: p.reasoningStrategy === 'adaptive' ? { type: 'adaptive' } : { type: 'enabled', budget_tokens: p.reasoningBudget ?? 1024 },
    } : {}),
    ...(system ? { system } : {}), messages: anthropicMessages(messages, config),
    ...(tools.length ? { tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) } : {}),
  };
  if (config.protocol === 'gemini') return {
    contents: geminiMessages(messages, config), ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig: { maxOutputTokens: p.maxOutputTokens, ...(p.temperature !== undefined ? { temperature: p.temperature } : {}),
      ...(p.reasoning === 'on' ? { thinkingConfig: { includeThoughts: true, ...(p.reasoningStrategy === 'level' ?
        { thinkingLevel: p.reasoningEffort ?? 'high' } : { thinkingBudget: p.reasoningBudget ?? 1024 }) } } :
        p.reasoning === 'off' ? { thinkingConfig: { thinkingBudget: 0 } } : { thinkingConfig: { includeThoughts: true } }) },
    ...(tools.length ? { tools: [{ functionDeclarations: tools.map((tool) => ({ name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters })) }] } : {}),
  };
  return { model: config.apiModelId, stream: true, max_tokens: p.maxOutputTokens,
    ...(p.temperature !== undefined ? { temperature: p.temperature } : {}),
    ...(config.compatibility === 'deepseek' ? { ...(p.reasoning === 'provider-default' ? {} : { thinking: { type: p.reasoning === 'on' ? 'enabled' : 'disabled' } }), stream_options: { include_usage: true } } : {}),
    messages: [...(system ? [{ role: 'system', content: system }] : []), ...chatMessages(messages, config)],
    ...(tools.length ? { tools: tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) } : {}),
  };
}
const number = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
const argsObject = (value: unknown): ToolCall['arguments'] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProtocolError('工具参数格式无效；未执行工具。');
  return value as ToolCall['arguments'];
};

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
        const calls = new Map<number, { id: string; name: string; json: string }>();
        const blocks = new Map<number, { type: string; index: number; json: string; closed: boolean }>();
        let reason = ''; let terminal = false; let began = false;
        await requestStream(endpoint, headers, body, options?.signal, (data) => {
          if (data === '[DONE]') { terminal = true; return true; }
          const event: Wire = JSON.parse(data);
          if (!event || typeof event !== 'object' || Array.isArray(event)) throw new ProtocolError('服务流数据格式与所选协议不匹配。');
          if (event.error || event.type === 'error') throw new ProtocolError('服务在流中返回错误，请检查模型与服务状态。');
          if (config.protocol === 'chat-completions') {
            const choice = event.choices?.[0]; const delta = choice?.delta;
            if (choice?.finish_reason) reason = choice.finish_reason;
            for (const field of ['reasoning_content', 'reasoning'] as const) if (typeof delta?.[field] === 'string' && delta[field]) {
              message.chatReasoningField = field; append('thinking', delta[field], visibility);
            }
            if (typeof delta?.reasoning_summary === 'string' && delta.reasoning_summary) append('thinking', delta.reasoning_summary, 'summary');
            if (typeof delta?.content === 'string') text(delta.content);
            for (const update of delta?.tool_calls ?? []) {
              if (!Number.isInteger(update.index) || update.index < 0 || update.index >= contentLimits.toolCallsPerRound) throw new ProtocolError('工具调用序号无效。');
              const call = calls.get(update.index) ?? { id: '', name: '', json: '' };
              if (update.id) call.id = update.id;
              call.name += update.function?.name ?? ''; call.json += update.function?.arguments ?? ''; calls.set(update.index, call);
            }
            if (event.usage) {
              message.usage.cacheRead = number(event.usage.prompt_cache_hit_tokens ?? event.usage.prompt_tokens_details?.cached_tokens);
              message.usage.cacheWrite = number(event.usage.prompt_tokens_details?.cache_write_tokens);
              message.usage.input = Math.max(0, number(event.usage.prompt_tokens) - message.usage.cacheRead - message.usage.cacheWrite); message.usage.output = number(event.usage.completion_tokens);
              message.usage.totalTokens = number(event.usage.total_tokens) || message.usage.input + message.usage.output + message.usage.cacheRead + message.usage.cacheWrite;
            }
          } else if (config.protocol === 'anthropic-messages') {
            if (event.type === 'message_start') {
              began = true; message.responseId = event.message?.id;
              message.usage.input = number(event.message?.usage?.input_tokens);
              message.usage.cacheRead = number(event.message?.usage?.cache_read_input_tokens);
              message.usage.cacheWrite = number(event.message?.usage?.cache_creation_input_tokens);
            } else if (event.type === 'content_block_start') {
              if (!began || !Number.isInteger(event.index) || event.index < 0 || event.index > 127 || blocks.has(event.index)) throw new ProtocolError('内容块序号无效。');
              const block = event.content_block; const index = message.content.length;
              if (block.type === 'text') { message.content.push({ type: 'text', text: block.text ?? '' }); stream.push({ type: 'text_start', contentIndex: index, partial: message }); }
              else if (block.type === 'tool_use') message.content.push({ type: 'toolCall', id: block.id, name: block.name, arguments: block.input ?? {} });
              else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
                message.content.push({ type: 'thinking', thinking: block.type === 'thinking' ? block.thinking ?? '' : '',
                  redacted: block.type === 'redacted_thinking', thinkingSignature: block.signature ?? block.data ?? '',
                  visibility: block.type === 'redacted_thinking' ? 'unavailable' : visibility } as PublicThinking);
                stream.push({ type: 'thinking_start', contentIndex: index, partial: message });
              }
              else throw new ProtocolError('服务返回尚未支持的内容块。');
              blocks.set(event.index, { type: block.type, index, json: '', closed: false });
            } else if (event.type === 'content_block_delta') {
              const block = blocks.get(event.index); if (!block || block.closed) throw new ProtocolError('内容块分片缺少开始标记。');
              const part = message.content[block.index]; const delta = event.delta;
              if (delta.type === 'text_delta' && part.type === 'text') { part.text += delta.text; stream.push({ type: 'text_delta', contentIndex: block.index, delta: delta.text, partial: message }); }
              else if (delta.type === 'input_json_delta' && part.type === 'toolCall') block.json += delta.partial_json;
              else if (delta.type === 'thinking_delta' && part.type === 'thinking') {
                part.thinking += delta.thinking; stream.push({ type: 'thinking_delta', contentIndex: block.index, delta: delta.thinking, partial: message });
              }
              else if (delta.type === 'signature_delta' && part.type === 'thinking') part.thinkingSignature = (part.thinkingSignature ?? '') + delta.signature;
              else throw new ProtocolError('内容块分片类型不匹配。');
            } else if (event.type === 'content_block_stop') {
              const block = blocks.get(event.index); if (!block || block.closed) throw new ProtocolError('内容块结束标记无效。');
              block.closed = true; const part = message.content[block.index];
              closeContent(block.index);
              if (part.type === 'toolCall') part.arguments = argsObject(block.json ? JSON.parse(block.json) : part.arguments);
            } else if (event.type === 'message_delta') {
              reason = event.delta?.stop_reason ?? reason; message.usage.output = number(event.usage?.output_tokens);
            } else if (event.type === 'message_stop') { terminal = true; return true; }
          } else {
            if (event.promptFeedback?.blockReason) throw new ProtocolError('服务拒绝了测试输入，请检查模型限制。');
            const candidate = event.candidates?.[0];
            message.nativeParts ??= { protocol: 'gemini', parts: [] };
            for (const part of candidate?.content?.parts ?? []) {
              message.nativeParts.parts.push(part);
              if (typeof part.text === 'string') {
                if (!part.thought) text(part.text);
                else {
                  append('thinking', part.text, visibility);
                  if (part.thoughtSignature) (message.content.at(-1) as PublicThinking).thinkingSignature = part.thoughtSignature;
                }
              }
              if (part.functionCall) {
                closeContent(message.content.length - 1);
                const call = part.functionCall;
                if (message.content.filter((p) => p.type === 'toolCall').length >= contentLimits.toolCallsPerRound) throw new ProtocolError('工具调用超过限制。');
                message.content.push({ type: 'toolCall', id: 'gemini-' + requestId + '-' + message.content.length, name: call.name,
                  arguments: argsObject(call.args ?? {}), thoughtSignature: part.thoughtSignature });
              }
            }
            if (candidate?.finishReason) { reason = candidate.finishReason; terminal = true; }
            if (event.usageMetadata) {
              const u = event.usageMetadata; message.usage.cacheRead = number(u.cachedContentTokenCount);
              message.usage.input = Math.max(0, number(u.promptTokenCount) - message.usage.cacheRead); message.usage.output = number(u.candidatesTokenCount) + number(u.thoughtsTokenCount);
              message.usage.totalTokens = number(u.totalTokenCount) || message.usage.input + message.usage.output + message.usage.cacheRead;
            }
          }
          return false;
        }, timeoutMs);
        if (options?.signal?.aborted) throw new ProtocolError('请求已取消。');
        if (config.protocol === 'chat-completions') {
          if (!reason || !['stop', 'tool_calls', 'function_call', 'length'].includes(reason)) throw new ProtocolError('模型响应不完整；未执行工具。');
          if (reason !== 'length') for (const call of calls.values()) {
            if (!call.id || !call.name || !['tool_calls', 'function_call'].includes(reason)) throw new ProtocolError('工具调用缺少完整结束标记。');
            message.content.push({ type: 'toolCall', id: call.id, name: call.name, arguments: argsObject(JSON.parse(call.json)) });
          }
          if (['tool_calls', 'function_call'].includes(reason) && !calls.size) throw new ProtocolError('模型未返回声明的工具调用。');
          message.stopReason = reason === 'length' ? 'length' : calls.size ? 'toolUse' : 'stop';
        } else if (config.protocol === 'anthropic-messages') {
          if (!began || !terminal || !reason || [...blocks.values()].some((b) => !b.closed) || !['end_turn', 'tool_use', 'max_tokens', 'stop_sequence'].includes(reason)) throw new ProtocolError('Anthropic 响应不完整；未执行工具。');
          message.stopReason = reason === 'max_tokens' ? 'length' : reason === 'tool_use' ? 'toolUse' : 'stop';
          message.usage.totalTokens = message.usage.input + message.usage.output + message.usage.cacheRead + message.usage.cacheWrite;
        } else {
          if (!terminal || !['STOP', 'MAX_TOKENS'].includes(reason)) throw new ProtocolError('Gemini 响应不完整或被服务拒绝；未执行工具。');
          message.stopReason = reason === 'MAX_TOKENS' ? 'length' : message.content.some((p) => p.type === 'toolCall') ? 'toolUse' : 'stop';
        }
        const toolCalls = message.content.filter((p): p is ToolCall => p.type === 'toolCall');
        if (message.stopReason === 'toolUse' && !toolCalls.length) throw new ProtocolError('响应缺少工具内容。');
        if (config.protocol === 'anthropic-messages' && toolCalls.length && message.stopReason === 'stop') throw new ProtocolError('工具调用缺少完整结束标记。');
        if (toolCalls.length > contentLimits.toolCallsPerRound) throw new ProtocolError('单轮工具调用超过限制。');
        if (toolCalls.some((p) => !p.id || !/^[a-zA-Z0-9_-]{1,128}$/.test(p.name)) || new Set(toolCalls.map((p) => p.id)).size !== toolCalls.length) throw new ProtocolError('工具调用标识无效。');
        if (message.stopReason === 'length') message.content = message.content.filter((p) => p.type !== 'toolCall');
        if (message.stopReason === 'stop' && !message.content.some((p) => p.type === 'text' && p.text.trim())) throw new ProtocolError('模型没有返回可用回答。');
        message.rawStopReason = reason;
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
