import { AppError } from '@/core/errors';
import type { AssistantMessage, Message, ThinkingContent, ToolCall } from '@earendil-works/pi-ai';
import type { ModelRunSnapshot } from '@/core/models/types';

export type Wire = Record<string, any>;
export type PublicThinking = ThinkingContent & {
  visibility?: 'reasoning' | 'summary' | 'unavailable';
};
export type NativeAssistant = AssistantMessage & {
  nativeParts?: { protocol: 'gemini'; parts: Wire[] };
  chatReasoningField?: 'reasoning_content' | 'reasoning';
};
export const textOf = (parts: { type: string; text?: string }[]) =>
  parts
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('\n');
export const imageParts = (
  parts: { type: string; data?: string; mimeType?: string }[],
  allowed: boolean,
  protocol: ModelRunSnapshot['protocol'],
): Wire[] => {
  const images = parts.filter(part => part.type === 'image');
  if (images.length && !allowed)
    throw new AppError('REMOTE', '此配置未开启图片输入，请在模型详情开启后再发送。');
  return images.map(part =>
    protocol === 'gemini'
      ? { inlineData: { mimeType: part.mimeType, data: part.data } }
      : protocol === 'anthropic-messages'
        ? { type: 'image', source: { type: 'base64', media_type: part.mimeType, data: part.data } }
        : {
            type: 'image_url',
            image_url: { url: 'data:' + part.mimeType + ';base64,' + part.data },
          },
  );
};
export function userParts(
  message: Extract<Message, { role: 'user' }>,
  config: ModelRunSnapshot,
): Wire[] {
  const content =
    typeof message.content === 'string'
      ? [{ type: 'text', text: message.content }]
      : message.content;
  return content.flatMap(part =>
    part.type === 'text'
      ? [config.protocol === 'gemini' ? { text: part.text } : { type: 'text', text: part.text }]
      : imageParts([part], config.parameters.allowImages, config.protocol),
  );
}

export const number = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
export const argsObject = (value: unknown): ToolCall['arguments'] => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AppError('REMOTE', '工具参数格式无效；未执行工具。');
  return value as ToolCall['arguments'];
};
