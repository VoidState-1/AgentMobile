import { AppError } from '@/core/errors';
import { normalizeContext, type Message, type Tool } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { ModelConfigurationService } from '@/application/models/configuration';
import type { CheckKind, DiagnosticResult } from '@/core/models/types';
import { configurationFingerprint } from '@/core/models/rules';
import { discoverModels } from './catalog';
import { safeModelError, withRequest } from './http';
import { protocolModel, protocolTransport } from './protocols';

// Generated 64×64 PNG: red/green upper quadrants, blue/yellow lower quadrants.
export const diagnosticImage =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAbklEQVR4nO3PwQkAUQhDQftv2q3hH9wQGHhnzczOnHZ7/YfyCwDKyy8AKC+/AKC8/AKA8vILAMrLLwAoL78AoLz8AoDy8gsAyssvACjv/sHxh905DQAAAAAAAAAAAAAAAAAAAAAAAAAAAABgXgEf+wXtHgs59/wAAAAASUVORK5CYII=';

export async function runDiagnostic(
  service: ModelConfigurationService,
  connectionId: string,
  modelId: string | undefined,
  kind: CheckKind,
  platform: DiagnosticResult['platform'],
  signal?: AbortSignal,
): Promise<DiagnosticResult> {
  const connectionLease = await service.acquireConnection(connectionId);
  const connection = connectionLease.connection;
  const model = service.getSnapshot().models.find(item => item.id === modelId);
  const fingerprint = configurationFingerprint(
    connection,
    kind === 'connection' ? undefined : model,
  );
  let requests = 0;
  let totalTokens = 0;
  let result: DiagnosticResult;
  try {
    const message = await withRequest(
      signal,
      async requestSignal => {
        if (kind === 'connection') {
          requests++;
          const catalog = await discoverModels(
            connection,
            connectionLease.secret,
            requestSignal,
            platform === 'web',
          );
          await service.mergeCatalog(connection.id, catalog, fingerprint);
          return '目录检测通过，发现 ' + catalog.length + ' 个生成模型；尚未验证生成能力。';
        }
        if (!model || model.connectionId !== connectionId)
          throw new AppError('REMOTE', '请先保存模型再检测。');
        const lease = await service.acquireModel(model.id, false);
        try {
          if (
            lease.snapshot.connectionRevision !== connection.revision ||
            configurationFingerprint(
              connection,
              service.getSnapshot().models.find(m => m.id === model.id),
            ) !== fingerprint
          )
            throw new AppError('REMOTE', '配置已改变，请重新检测。');
          const snapshot = {
            ...lease.snapshot,
            parameters: {
              ...lease.snapshot.parameters,
              reasoning: 'off' as const,
              reasoningBudget: undefined,
              maxOutputTokens: Math.min(
                128,
                lease.snapshot.parameters.maxOutputTokens,
                model.limits?.outputTokens ?? 128,
              ),
              allowImages: kind === 'images' || lease.snapshot.parameters.allowImages,
            },
          };
          const transport = protocolTransport(snapshot, lease.secret, platform === 'web');
          const piModel = protocolModel(snapshot);
          const marker = 'host_' + Math.random().toString(36).slice(2, 10);
          const tools: Tool[] =
            kind === 'tools'
              ? [
                  {
                    name: 'diagnostic_echo',
                    description: '获取宿主生成的验证字符串，返回后原样输出。',
                    parameters: Type.Object({}, { additionalProperties: false }),
                  },
                ]
              : [];
          const prompt =
            kind === 'tools'
              ? '必须调用 diagnostic_echo 一次，然后仅输出工具返回的字符串。不要编造返回值。'
              : kind === 'images'
                ? '按左上、右上、左下、右下顺序给出图片四个色块的英文颜色名称，仅用逗号分隔。'
                : '仅回复 MOBILE_OK';
          const messages: Message[] = [
            {
              role: 'user',
              timestamp: Date.now(),
              content:
                kind === 'images'
                  ? [
                      { type: 'text', text: prompt },
                      { type: 'image', data: diagnosticImage, mimeType: 'image/png' },
                    ]
                  : prompt,
            },
          ];
          const context = normalizeContext({
            messages,
            tools,
            systemPrompt: '你在进行一个无副作用的连接诊断。严格按要求回答。',
          });
          requests++;
          const first = await (
            await transport(piModel, context, { signal: requestSignal })
          ).result();
          totalTokens += first.usage.totalTokens;
          if (
            first.stopReason === 'error' ||
            first.stopReason === 'aborted' ||
            first.stopReason === 'length'
          )
            throw new AppError('REMOTE', first.errorMessage ?? '生成未完整结束。');
          let answer = first;
          if (kind === 'tools') {
            const calls = first.content.filter(p => p.type === 'toolCall');
            if (
              first.stopReason !== 'toolUse' ||
              calls.length !== 1 ||
              calls[0].name !== 'diagnostic_echo'
            )
              throw new AppError('REMOTE', '模型没有完成指定的测试工具调用；能力仍保留原声明。');
            context.messages.push(first, {
              role: 'toolResult',
              toolCallId: calls[0].id,
              toolName: calls[0].name,
              content: [{ type: 'text', text: marker }],
              isError: false,
              timestamp: Date.now(),
            });
            requests++;
            answer = await (await transport(piModel, context, { signal: requestSignal })).result();
            totalTokens += answer.usage.totalTokens;
          }
          const output = answer.content
            .filter(p => p.type === 'text')
            .map(p => p.text)
            .join('')
            .trim();
          if (answer.stopReason !== 'stop')
            throw new AppError('REMOTE', answer.errorMessage ?? '模型未完成测试回答。');
          const expected =
            kind === 'tools' ? marker : kind === 'images' ? 'red,green,blue,yellow' : 'MOBILE_OK';
          const actual = kind === 'images' ? output.toLowerCase().replace(/\s/g, '') : output;
          if (actual !== expected)
            throw new AppError('REMOTE', '回答与验证样本不符；未判定该能力不支持。');
          return kind === 'tools'
            ? '工具调用 → 宿主返回 → 模型继续回答已通过。'
            : kind === 'images'
              ? '模型正确识别了内置图片的四个色块。'
              : '指定模型的完整文本生成通过。';
        } finally {
          await lease.release();
        }
      },
      30_000,
    );
    result = {
      status: 'passed',
      message,
      at: new Date().toISOString(),
      fingerprint,
      platform,
      requests,
      totalTokens,
    };
  } catch (error) {
    result = {
      status: signal?.aborted ? 'cancelled' : 'failed',
      message: safeModelError(error, signal?.aborted),
      at: new Date().toISOString(),
      fingerprint,
      platform,
      requests,
      totalTokens,
    };
  } finally {
    await connectionLease.release();
  }
  await service.recordCheck(connectionId, modelId, kind, result);
  return result;
}
