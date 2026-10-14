import { getCurrentSystemPrompt, type Message, type Tool } from '@earendil-works/pi-ai';
import type { ModelRunSnapshot } from '@/core/models/types';
import { ProtocolError } from '../http';
import { contentLimits } from '@/core/agent/settings';
import { imageParts, userParts, textOf, number, argsObject, type Wire, type NativeAssistant, type PublicThinking } from './shared';
import type { ProtocolDecoder } from './decoder';

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

export function geminiBody(config: ModelRunSnapshot, messages: Message[], tools: Tool[]): Wire {
  const system = getCurrentSystemPrompt(messages); const p = config.parameters;
  return {
    contents: geminiMessages(messages, config), ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig: { maxOutputTokens: p.maxOutputTokens, ...(p.temperature !== undefined ? { temperature: p.temperature } : {}),
      ...(p.reasoning === 'on' ? { thinkingConfig: { includeThoughts: true, ...(p.reasoningStrategy === 'level' ?
        { thinkingLevel: p.reasoningEffort ?? 'high' } : { thinkingBudget: p.reasoningBudget ?? 1024 }) } } :
        p.reasoning === 'off' ? { thinkingConfig: { thinkingBudget: 0 } } : { thinkingConfig: { includeThoughts: true } }) },
    ...(tools.length ? { tools: [{ functionDeclarations: tools.map((tool) => ({ name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters })) }] } : {}),
  };
}

export const geminiDecoder: ProtocolDecoder = {
  consume(event, context, state) {
if (event.promptFeedback?.blockReason) throw new ProtocolError('服务拒绝了测试输入，请检查模型限制。');
            const candidate = event.candidates?.[0];
            context.message.nativeParts ??= { protocol: 'gemini', parts: [] };
            for (const part of candidate?.content?.parts ?? []) {
              context.message.nativeParts.parts.push(part);
              if (typeof part.text === 'string') {
                if (!part.thought) context.text(part.text);
                else {
                  context.append('thinking', part.text, context.visibility);
                  if (part.thoughtSignature) (context.message.content.at(-1) as PublicThinking).thinkingSignature = part.thoughtSignature;
                }
              }
              if (part.functionCall) {
                context.closeContent(context.message.content.length - 1);
                const call = part.functionCall;
                if (context.message.content.filter((p) => p.type === 'toolCall').length >= contentLimits.toolCallsPerRound) throw new ProtocolError('工具调用超过限制。');
                context.message.content.push({ type: 'toolCall', id: 'gemini-' + context.requestId + '-' + context.message.content.length, name: call.name,
                  arguments: argsObject(call.args ?? {}), thoughtSignature: part.thoughtSignature });
              }
            }
            if (candidate?.finishReason) { state.reason = candidate.finishReason; state.terminal = true; }
            if (event.usageMetadata) {
              const u = event.usageMetadata; context.message.usage.cacheRead = number(u.cachedContentTokenCount);
              context.message.usage.input = Math.max(0, number(u.promptTokenCount) - context.message.usage.cacheRead); context.message.usage.output = number(u.candidatesTokenCount) + number(u.thoughtsTokenCount);
              context.message.usage.totalTokens = number(u.totalTokenCount) || context.message.usage.input + context.message.usage.output + context.message.usage.cacheRead;
            }
  },
  finish(context, state) {
if (!state.terminal || !['STOP', 'MAX_TOKENS'].includes(state.reason)) throw new ProtocolError('Gemini 响应不完整或被服务拒绝；未执行工具。');
          context.message.stopReason = state.reason === 'MAX_TOKENS' ? 'length' : context.message.content.some((p) => p.type === 'toolCall') ? 'toolUse' : 'stop';
  },
};
