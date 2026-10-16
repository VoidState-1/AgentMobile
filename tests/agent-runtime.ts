import { testNotifications } from './notifications';
import { createWorkspace } from '../src/bootstrap/workspace';
import { randomUUID } from 'node:crypto';
import { RunKernel } from '../src/application/runs/kernel';
import { RunRepository } from '../src/application/runs/repository';
import { ConversationService } from '../src/application/conversations/service';
import { AgentSettingsService } from '../src/application/settings/agent';
import { ModelConfigurationService } from '../src/application/models/configuration';
import { McpConfigurationService } from '../src/application/mcp/configuration';
import { McpRuntime } from '../src/adapters/mcp/runtime';
import { SkillService } from '../src/application/skills/library';
import { GitSkillRepository } from '../src/adapters/skills/repository';
import { runResourceFactory } from '../src/adapters/agent/resources';
import { PiEngineAdapter } from '../src/adapters/agent/pi-engine';
import { workspaceFixtureTransport } from './fixture-transport';
import { protocolModel, protocolTransport } from '../src/adapters/model/protocols';
import { contentCodec } from '../src/adapters/storage/codec';
import type { WorkspaceApplication } from '../src/application/workspace/service';
import type { RunResourceFactory } from '../src/application/runs/resources';
import type { ModelRunSnapshot } from '../src/core/models/types';
import type { AgentSettings } from '../src/core/agent/settings';
import type { ExecutionView } from '../src/core/runs/types';
import type { McpRunPort } from '../src/core/mcp/run';
import type { SkillRunPort } from '../src/core/skills/run';
import type { HostFileSystem } from '../src/core/storage/contracts';

interface RuntimeOptions {
  models?: ModelConfigurationService;
  conversations?: ConversationService;
  settings?: AgentSettingsService;
  mcp?: McpRuntime;
  skills?: SkillService;
  factory?: RunResourceFactory;
  files?: HostFileSystem;
}

/** Integration fixtures use the same queue, budget and current persistence as bootstrap. */
export async function createTestRuntime(
  workspace: WorkspaceApplication,
  options: RuntimeOptions = {},
) {
  const repository = new RunRepository(workspace.metadata);
  const conversations =
    options.conversations ?? new ConversationService(workspace.metadata, randomUUID);
  const projects = await workspace.projects();
  if (!options.conversations)
    await conversations.initialize(projects, (projectId, conversationId, revision) =>
      repository.acceptedDraft(projectId, conversationId, revision),
    );
  const settings = options.settings ?? new AgentSettingsService(workspace.metadata);
  if (!options.settings) await settings.initialize();
  let factory = options.factory;
  if (!factory) {
    const credentials = { get: async () => '', set: async () => {} };
    const models =
      options.models ??
      new ModelConfigurationService(workspace.metadata, credentials, randomUUID, contentCodec);
    if (!options.models) await models.initialize();
    const configuration = new McpConfigurationService(workspace.metadata, credentials, randomUUID);
    if (!options.mcp) await configuration.initialize();
    const mcp =
      options.mcp ??
      new McpRuntime(configuration, workspace.metadata, randomUUID, async value => value);
    if (!options.skills && !options.files)
      throw new Error('Production resource fixtures require a host filesystem');
    const skills =
      options.skills ??
      new SkillService(
        workspace.metadata,
        new GitSkillRepository(
          createWorkspace(options.files!, workspace.metadata, randomUUID, { namespace: 'skills' }),
        ),
      );
    if (!options.skills) await skills.initialize();
    factory = runResourceFactory(models, mcp, skills, false, testNotifications);
  }
  const kernel = new RunKernel(workspace, repository, factory, conversations, settings, randomUUID);
  return { kernel, repository, conversations, settings };
}

interface RunOptions {
  model?: ModelRunSnapshot;
  secret?: string;
  web?: boolean;
  settings?: AgentSettings;
  mcp?: McpRunPort;
  skills?: SkillRunPort;
  update?: (task: ExecutionView) => void;
}

/** Only transport/resources are injected; execution remains the production RunKernel. */
export async function startTestRun(
  workspace: WorkspaceApplication,
  projectId: string,
  prompt: string,
  options: RunOptions = {},
) {
  const factory: RunResourceFactory = {
    async prepare(request) {
      const model = options.model;
      const transport = model
        ? {
            model: protocolModel(model),
            streamFn: protocolTransport(
              model,
              options.secret ?? 'fixture',
              options.web,
              request.settings.limits.requestTimeoutMs,
            ),
          }
        : workspaceFixtureTransport(request.prompt);
      return {
        launch: {
          imageInput: model?.parameters.allowImages ?? false,
          modelSnapshot: model,
          contextTokens: transport.model.contextWindow,
          outputTokens: transport.model.maxTokens,
        },
        engine: new PiEngineAdapter(
          transport,
          model?.parameters.reasoningDisplay ??
            (model && model.protocol !== 'chat-completions' ? 'summary' : 'reasoning'),
        ),
        resources: {
          codec: contentCodec,
          notifications: testNotifications,
          mcp: options.mcp,
          skills: options.skills,
        },
        release: async () => {
          await options.mcp?.close();
        },
      };
    },
  };
  const { kernel, settings } = await createTestRuntime(workspace, { factory });
  if (options.settings) settings.getSnapshot = () => options.settings!;
  let resolve!: (task: ExecutionView) => void;
  let reject!: (error: Error) => void;
  const done = new Promise<ExecutionView>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const detach = kernel.subscribe(() => {
    const state = kernel.getSnapshot();
    const task = state.active ?? state.completed;
    if (task) options.update?.(task);
    if (state.completed && !state.runs.length) {
      detach();
      resolve(state.completed);
    } else if (state.error && !state.starting && !state.runs.length) {
      detach();
      reject(new Error(state.error));
    }
  });
  try {
    await kernel.start(projectId, prompt);
  } catch (error) {
    detach();
    throw error;
  }
  return { done, cancel: () => kernel.cancel(), kernel };
}
