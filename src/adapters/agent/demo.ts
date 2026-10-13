import { createAssistantMessageEventStream, type AssistantMessage, type Model, type JsonObject } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';

/** Scripted transport exercises Pi's real loop and host tools; it is not an LLM. */
export function demoTransport(prompt: string): { model: Model<string>; streamFn: StreamFn } {
  let round = 0;
  const model: Model<string> = {
    id: 'scripted-demo', name: '演示', api: 'mobile-demo', provider: 'local-demo', baseUrl: '',
    reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32000, maxTokens: 4096,
  };
  const streamFn: StreamFn = (_, context, options) => {
    const stream = createAssistantMessageEventStream();
    const message: AssistantMessage = {
      role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop', timestamp: Date.now(),
    };
    const call = (name: string, args: JsonObject) => {
      message.content.push({ type: 'toolCall', id: 'demo-call-' + round, name, arguments: args });
      message.stopReason = 'toolUse';
    };
    round++;
    if (round === 1) call('list_files', {});
    else {
      const listing = context.messages.find((item) => item.role === 'toolResult' && item.toolName === 'list_files');
      const text = listing?.role === 'toolResult' ? listing.content.filter((part) => part.type === 'text').map((part) => part.text).join('') : '[]';
      const files = JSON.parse(text) as { path: string; revision: string }[];
      if (round === 2) call('read_text', { path: files.find((file) => /\.md$/.test(file.path))?.path ?? 'documents/notes.md' });
      else if (round === 3) {
        const reading = context.messages.find((item) => item.role === 'toolResult' && item.toolName === 'read_text');
        const data = reading?.role === 'toolResult' && !reading.isError ?
          JSON.parse(reading.content.filter((part) => part.type === 'text').map((part) => part.text).join('')) : { text: '' };
        const output = '# 图文资料整理\n\n## 本次目标\n\n' + prompt +
          '\n\n## 原始资料摘录\n\n' + String(data.text).slice(0, 3000) +
          '\n\n## 下一步\n\n- 补充主题与背景\n- 核对文字与图片\n- 调整结构后导出\n\n> 这是预设演示流程，不进行语义理解。\n';
        call('write_text', {
          path: 'documents/summary.md', text: output,
          expectedRevision: files.find((file) => file.path === 'documents/summary.md')?.revision ?? null,
        });
      } else {
        const failed = context.messages.some((item) => item.role === 'toolResult' && item.isError);
        message.content.push({ type: 'text', text: failed ?
          '演示遇到工具错误，请检查任务记录。已完成的修改仍保留在项目中。' :
          '已完成演示任务：读取资料，并创建或更新 documents/summary.md。你可以查看文件变化和历史版本。\n\n演示模式使用预设步骤，不进行语义理解。' });
      }
    }
    void (async () => {
      stream.push({ type: 'start', partial: message });
      const text = message.content.find((part) => part.type === 'text');
      if (text?.type === 'text') {
        const fullText = text.text; text.text = '';
        stream.push({ type: 'text_start', contentIndex: 0, partial: message });
        for (let index = 0; index < fullText.length; index += 4) {
          if (options?.signal?.aborted) break;
          const delta = fullText.slice(index, index + 4);
          text.text += delta;
          stream.push({ type: 'text_delta', contentIndex: 0, delta, partial: message });
          await new Promise((resolve) => setTimeout(resolve, 15));
        }
      }
      if (options?.signal?.aborted) {
        message.stopReason = 'aborted'; message.errorMessage = '任务已取消';
        stream.push({ type: 'error', reason: 'aborted', error: message });
      } else {
        stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
      }
    })();
    return stream;
  };
  return { model, streamFn };
}
