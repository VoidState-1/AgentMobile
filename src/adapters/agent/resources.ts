import { AppError } from '@/core/errors';
import type { RunResourceFactory, PreparedRun } from '@/application/runs/resources';
import type { ModelConfigurationService } from '@/application/models/configuration';
import type { SkillService } from '@/application/skills/library';
import type { ModelRunLease } from '@/core/models/types';
import type { McpRun, McpRuntime } from '@/adapters/mcp/runtime';
import { createSkillRun } from '@/adapters/skills/run';
import { contentCodec } from '@/adapters/storage/codec';
import { protocolModel, protocolTransport } from '@/adapters/model/protocols';
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
        lease = await models.acquireSelection(request.projectId, request.conversationId);
        const snapshot = lease.snapshot;
        if (request.imageAttached && !snapshot.parameters.allowImages)
          throw new AppError(
            'VALIDATION',
            '所选模型配置未开启图片输入。请开启图片输入，或移除图片后发送；草稿已保留。',
          );
        const skillRun = createSkillRun(
          skills.repository,
          await skills.capture(request.projectId, request.prompt),
        );
        mcpRun = mcp.createRun(await mcp.configuration.acquireProject(request.projectId));
        const transport = {
          model: protocolModel(snapshot),
          streamFn: protocolTransport(
            snapshot,
            lease.secret,
            web,
            request.settings.limits.requestTimeoutMs,
          ),
        };
        const reasoningDisplay =
          snapshot.parameters.reasoningDisplay ??
          (snapshot.protocol !== 'chat-completions' ? 'summary' : 'reasoning');
        return {
          launch: {
            imageInput: snapshot.parameters.allowImages,
            modelSnapshot: snapshot,
            contextTokens: transport.model.contextWindow,
            outputTokens: transport.model.maxTokens,
          },
          engine: new PiEngineAdapter(transport, reasoningDisplay),
          resources: { codec: contentCodec, notifications, mcp: mcpRun, skills: skillRun },
          release,
          createChild: async () => ({
            engine: new PiEngineAdapter(transport, reasoningDisplay),
            resources: {
              codec: contentCodec,
              notifications,
              skills: createSkillRun(skills.repository, {
                skills: skillRun.snapshots,
                explicit: [],
              }),
            },
          }),
        };
      } catch (error) {
        await release();
        throw error;
      }
    },
  };
}
