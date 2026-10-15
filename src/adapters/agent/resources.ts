import { AppError } from '@/core/errors';
import type { RunResourceFactory, PreparedRun } from '@/application/runs/resources';
import type { ModelConfigurationService } from '@/application/models/configuration';
import type { SkillService } from '@/application/skills/library';
import type { ModelRunLease } from '@/core/models/types';
import { selectedModelMode } from '@/core/models/rules';
import type { McpRun, McpRuntime } from '@/adapters/mcp/runtime';
import { createSkillRun } from '@/adapters/skills/run';
import { contentCodec } from '@/adapters/storage/codec';
import { protocolModel, protocolTransport } from '@/adapters/model/protocols';
import { demoTransport } from './demo';
import { PiEngineAdapter } from './pi-engine';
import type { NotificationScheduler } from '@/core/agent/engine';

export function runResourceFactory(
  models: ModelConfigurationService,
  mcp: McpRuntime,
  skills: SkillService,
  web: boolean,
  notifications: NotificationScheduler,
): RunResourceFactory {
  return {
    async prepare(request): Promise<PreparedRun> {
      let lease: ModelRunLease | undefined;
      let mcpRun: McpRun | undefined;
      let closing: Promise<void> | undefined;
      const release = () =>
        (closing ??= (async () => {
          try {
            await mcpRun?.close();
          } finally {
            await lease?.release();
          }
        })());
      try {
        const mode = selectedModelMode(models.getSnapshot(), request.conversationId);
        const skillRun = createSkillRun(
          skills.repository,
          await skills.capture(request.projectId, request.prompt),
        );
        if (mode === 'remote') {
          lease = await models.acquireSelection(request.projectId, request.conversationId);
          mcpRun = mcp.createRun(await mcp.configuration.acquireProject(request.projectId));
        }
        const snapshot = lease?.snapshot;
        if (request.imageAttached && mode === 'remote' && !snapshot?.parameters.allowImages)
          throw new AppError(
            'VALIDATION',
            '所选模型配置未开启图片输入。请开启图片输入，或移除图片后发送；草稿已保留。',
          );
        const transport = snapshot
          ? {
              model: protocolModel(snapshot),
              streamFn: protocolTransport(
                snapshot,
                lease!.secret,
                web,
                request.settings.limits.requestTimeoutMs,
              ),
            }
          : demoTransport(request.prompt);
        return {
          launch: {
            mode,
            imageInput: snapshot?.parameters.allowImages ?? false,
            modelSnapshot: snapshot,
            contextTokens: transport.model.contextWindow,
            outputTokens: transport.model.maxTokens,
          },
          engine: new PiEngineAdapter(
            transport,
            snapshot?.parameters.reasoningDisplay ??
              (snapshot && snapshot.protocol !== 'chat-completions' ? 'summary' : 'reasoning'),
          ),
          resources: { codec: contentCodec, notifications, mcp: mcpRun, skills: skillRun },
          release,
          createChild: async (prompt, workspace = 'snapshot') => {
            const childTransport = snapshot
              ? {
                  model: protocolModel(snapshot),
                  streamFn: protocolTransport(
                    snapshot,
                    lease!.secret,
                    web,
                    request.settings.limits.requestTimeoutMs,
                  ),
                }
              : demoTransport(prompt, workspace === 'snapshot');
            return {
              engine: new PiEngineAdapter(
                childTransport,
                snapshot?.parameters.reasoningDisplay ??
                  (snapshot && snapshot.protocol !== 'chat-completions' ? 'summary' : 'reasoning'),
              ),
              resources: {
                codec: contentCodec,
                notifications,
                skills: createSkillRun(skills.repository, {
                  skills: skillRun.snapshots,
                  explicit: [],
                }),
              },
            };
          },
        };
      } catch (error) {
        await release();
        throw error;
      }
    },
  };
}
