import type { AppServices } from '@/application/services';
import { PreferencesService } from '@/application/settings/preferences';
import { createAppServices } from './facade';
import { runDiagnostic } from '@/adapters/model/diagnostics';
import { pickFile, exportFile } from '@/adapters/io/files';
import { pickSkillPackage, shareSkillPackage } from '@/adapters/skills/io';
import {
  decodeSkillText,
  validateBundle,
  importSkillPackage,
  exportSkillPackage,
} from '@/adapters/skills/package';
import '@/adapters/polyfills';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { AgentSettingsService } from '@/application/settings/agent';
import { ModelConfigurationService } from '@/application/models/configuration';
import { ConversationService } from '@/application/conversations/service';
import { McpConfigurationService } from '@/application/mcp/configuration';
import { McpRuntime } from '@/adapters/mcp/runtime';
import { SkillService } from '@/application/skills/library';
import { GitSkillRepository } from '@/adapters/skills/repository';
import { runResourceFactory } from '@/adapters/agent/resources';
import { RunKernel } from '@/application/runs/kernel';
import { RunRepository } from '@/application/runs/repository';
import { recoverRuns } from '@/application/runs/recovery';
import { bindRunLifecycle } from '@/adapters/agent/lifecycle';
import { ProposalService } from '@/application/runs/proposals';
import { contentCodec } from '@/adapters/storage/codec';
import { createStorage, rebuildDevelopmentStorage } from '@/adapters/storage/platform';
import { AppError } from '@/core/errors';
import { notifications } from '@/adapters/agent/notifications';
import { createWorkspace } from '@/bootstrap/workspace';

let instance: Promise<AppServices> | undefined;
let initializationFailure: unknown;
let rebuilding = false;

async function initialize() {
  const storage = await createStorage();
  const workspace = createWorkspace(storage.fs, storage.metadata, Crypto.randomUUID);
  const models = new ModelConfigurationService(
    storage.metadata,
    storage.credentials,
    Crypto.randomUUID,
  );
  await models.initialize();
  const agentSettings = new AgentSettingsService(storage.metadata);
  await agentSettings.initialize();
  const mcpConfiguration = new McpConfigurationService(
    storage.metadata,
    storage.credentials,
    Crypto.randomUUID,
  );
  await mcpConfiguration.initialize();
  const mcp = new McpRuntime(mcpConfiguration, storage.metadata, Crypto.randomUUID, value =>
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value),
  );
  await workspace.recover();
  await mcp.recover();
  const unknownMcp = await mcp.unknown();
  const skills = new SkillService(
    storage.metadata,
    new GitSkillRepository(
      createWorkspace(storage.fs, storage.metadata, Crypto.randomUUID, { namespace: 'skills' }),
    ),
  );
  await skills.initialize();
  const runs = new RunRepository(storage.metadata);
  const proposals = new ProposalService(workspace, runs, contentCodec);
  await proposals.recover();
  await recoverRuns(
    runs,
    workspace,
    unknownMcp,
    async id => (await proposals.repository.get(id))?.candidateSnapshot,
  );
  const conversations = new ConversationService(storage.metadata, Crypto.randomUUID);
  const projects = await workspace.projects();
  await conversations.initialize(projects, (projectId, conversationId, revision) =>
    runs.acceptedDraft(projectId, conversationId, revision),
  );
  const agent = new RunKernel(
    workspace,
    runs,
    runResourceFactory(models, mcp, skills, Platform.OS === 'web', notifications),
    conversations,
    agentSettings,
    Crypto.randomUUID,
  );
  bindRunLifecycle(agent);
  return createAppServices({
    workspace,
    models,
    conversations,
    agentSettings,
    mcp,
    skills,
    agent,
    proposals,
    runs,
    preferences: new PreferencesService(storage.metadata),
    diagnose: (connectionId, modelId, kind, signal) =>
      runDiagnostic(
        models,
        connectionId,
        modelId,
        kind,
        Platform.OS === 'web' ? 'web' : Platform.OS === 'ios' ? 'ios' : 'android',
        signal,
      ),
    skillPackage: {
      decodeText: decodeSkillText,
      validateBundle,
      importPackage: importSkillPackage,
    },
    io: {
      pickFile,
      pickSkillPackage,
      exportFile: (projectId, path) => exportFile(workspace, projectId, path),
      exportSkill: async (name, commit) =>
        shareSkillPackage(name, exportSkillPackage([await skills.repository.bundle(commit, name)])),
    },
  });
}

export function getAppServices(): Promise<AppServices> {
  if (rebuilding) return Promise.reject(new AppError('CONFLICT', '开发数据正在重建。'));
  instance ??= initialize().catch(error => {
    instance = undefined;
    initializationFailure = error;
    throw error;
  });
  return instance;
}

export async function rebuildDevelopmentData(): Promise<void> {
  if (
    instance ||
    rebuilding ||
    !(initializationFailure instanceof AppError) ||
    initializationFailure.code !== 'DATA_FORMAT'
  )
    throw new AppError('CONFLICT', '仅允许在格式不匹配、运行服务尚未建立时重建开发数据。');
  rebuilding = true;
  try {
    await rebuildDevelopmentStorage();
    initializationFailure = undefined;
  } finally {
    rebuilding = false;
  }
}
