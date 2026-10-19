import type { AppServices } from '@/application/services';
import { summarizeChanges } from '@/adapters/git/change-summary';
import type { ModelConfigurationService } from '@/application/models/configuration';
import type { ConversationService } from '@/application/conversations/service';
import type { AgentSettingsService } from '@/application/settings/agent';
import type { SkillService } from '@/application/skills/library';
import { AppError, publicError } from '@/core/errors';
import type { WorkspaceApplication } from '@/application/workspace/service';
import type { McpRuntime } from '@/adapters/mcp/runtime';
import type { PreferencesService } from '@/application/settings/preferences';
import type { ProposalService } from '@/application/runs/proposals';
import type { RunKernel } from '@/application/runs/kernel';
import type { RunRepository } from '@/application/runs/repository';
import { runView } from './run-view';

export interface AppDependencies {
  workspace: WorkspaceApplication;
  models: ModelConfigurationService;
  conversations: ConversationService;
  agentSettings: AgentSettingsService;
  skills: SkillService;
  mcp: McpRuntime;
  agent: RunKernel;
  runs: RunRepository;
  preferences: PreferencesService;
  io: AppServices['io'];
  diagnose: AppServices['models']['diagnose'];
  skillPackage: Pick<AppServices['skills'], 'decodeText' | 'validateBundle' | 'importPackage'>;
  proposals?: ProposalService;
}

/** A real object projection, not a type cast: private methods/fields are absent at runtime. */
function expose<T extends object, K extends keyof T>(service: T, keys: readonly K[]): Pick<T, K> {
  const output: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    const original = service[key];
    if (typeof original !== 'function')
      throw new Error('Facade members must be commands or queries');
    output[key] = ((...args: unknown[]) => {
      try {
        const result = (original as (...parameters: unknown[]) => unknown).apply(service, args);
        return result instanceof Promise
          ? result.catch(error => {
              throw publicError(error);
            })
          : result;
      } catch (error) {
        throw publicError(error);
      }
    }) as T[K];
  }
  return output as Pick<T, K>;
}

export function createAppServices(value: AppDependencies): AppServices {
  const runRecord = async (id: string) => {
    const run = await value.runs.get(id);
    if (!run) throw new AppError('VALIDATION', '运行不存在。');
    return run;
  };
  const workspace = {
    ...expose(value.workspace, [
      'projects',
      'files',
      'read',
      'preview',
      'restore',
      'changes',
      'status',
      'diff',
      'discard',
      'subscribe',
      'historyPage',
      'repository',
      'gitCommand',
      'mergeBranch',
      'rebaseBranch',
      'continueRebase',
      'skipRebase',
      'abortRebase',
      'conflictPreview',
      'resolveConflict',
      'continueMerge',
      'abortMerge',
      'cloneProject',
      'saveGitCredential',
      'gitTransfer',
      'subscribeGitTransfer',
      'cancelGitTransfer',
      'editorDraft',
      'saveEditorDraft',
    ]),
    ...expose(
      {
        taskChanges: async (id: string) => value.workspace.taskChanges(await runRecord(id)),
        taskChangeSummary: async (id: string) =>
          summarizeChanges(await value.workspace.taskChanges(await runRecord(id))),
        undoTask: async (id: string) => value.workspace.undoTask(await runRecord(id)),
      },
      ['taskChanges', 'taskChangeSummary', 'undoTask'],
    ),
    ...expose(
      {
        create: (name: string) => value.workspace.create(name),
        write: (
          id: string,
          path: string,
          bytes: Uint8Array,
          revision: string | null,
          options?: { message?: string },
        ) => value.workspace.write(id, path, bytes, revision, { message: options?.message }),
        writeText: (
          id: string,
          path: string,
          bytes: Uint8Array,
          revision: string | null,
          options?: { operationId?: string },
        ) =>
          value.workspace.writeText(id, path, bytes, revision, {
            operationId: options?.operationId,
          }),
        remove: (id: string, path: string, revision: string) =>
          value.workspace.remove(id, path, revision),
        move: (id: string, from: string, to: string, revision: string) =>
          value.workspace.move(id, from, to, revision),
        stage: (
          id: string,
          paths: string[],
          expected: Parameters<AppServices['workspace']['stage']>[2],
        ) => value.workspace.stage(id, paths, expected),
        unstage: (
          id: string,
          paths: string[],
          expected: Parameters<AppServices['workspace']['unstage']>[2],
        ) => value.workspace.unstage(id, paths, expected),
        commitStaged: (
          id: string,
          message: string,
          expected: Parameters<AppServices['workspace']['commitStaged']>[2],
        ) => value.workspace.commitStaged(id, message, expected),
      },
      ['create', 'write', 'writeText', 'remove', 'move', 'stage', 'unstage', 'commitStaged'],
    ),
    head: expose({ head: (id: string) => value.workspace.git.head(id) }, ['head']).head,
    snapshot: async (id: string, path?: string) => {
      const snapshot = await expose(value.workspace, ['snapshot']).snapshot(id, path);
      return {
        files: snapshot.files,
        versions: snapshot.versions,
        repository: snapshot.repository,
        historyCursor: snapshot.historyCursor,
        gitStatus: snapshot.gitStatus,
        preview: snapshot.preview,
        operations: snapshot.operations.map(
          ({ id, scope, ownerRootRunId, actorRunId, proposalId, phase, changedPaths }) => ({
            id,
            projectId: scope.projectId,
            ownerRootRunId,
            actorRunId,
            proposalId,
            phase,
            changedPaths,
          }),
        ),
      };
    },
    get recoveryIssues() {
      return [...value.workspace.recoveryIssues];
    },
  };
  const services: AppServices = {
    proposals: value.proposals ? Object.freeze(expose(value.proposals, ['preview'])) : undefined,
    workspace: Object.freeze(workspace),
    models: Object.freeze({
      ...expose(value.models, [
        'getSnapshot',
        'subscribe',
        'saveConnection',
        'prepareIcon',
        'setProviderOrder',
        'copyConnection',
        'removeConnection',
        'keyReady',
        'saveModel',
        'removeModel',
        'setSelection',
        'affectedDefaults',
      ]),
      ...expose({ diagnose: value.diagnose }, ['diagnose']),
      get recoveryIssues() {
        return [...value.models.recoveryIssues];
      },
    }),
    conversations: Object.freeze(
      expose(value.conversations, [
        'getSnapshot',
        'subscribe',
        'ensureProject',
        'create',
        'select',
        'rename',
        'archive',
        'restore',
        'saveDraft',
      ]),
    ),
    agentSettings: Object.freeze(expose(value.agentSettings, ['getSnapshot', 'save'])),
    agent: Object.freeze({
      ...expose(value.agent, ['subscribe', 'start', 'cancel']),
      getSnapshot: () => {
        const snapshot = value.agent.getSnapshot();
        return {
          ...snapshot,
          active: snapshot.active && runView(snapshot.active),
          completed: snapshot.completed && runView(snapshot.completed),
          runs: snapshot.runs.map(runView),
        };
      },
    }),
    runs: Object.freeze({
      ...expose(value.runs, [
        'getDetail',
        'listChildren',
        'listTrace',
        'readTraceText',
        'subscribe',
      ]),
      ...expose(
        {
          list: (query: Parameters<AppServices['runs']['list']>[0]) =>
            value.runs.list(query.projectId, query.conversationId, query.cursor, query.limit),
        },
        ['list'],
      ),
    }),
    preferences: Object.freeze(expose(value.preferences, ['getWorkbench', 'saveWorkbench'])),
    io: Object.freeze(
      expose(value.io, ['pickFile', 'pickSkillPackage', 'exportFile', 'exportSkill']),
    ),
    mcp: Object.freeze({
      ...expose(value.mcp, ['discover', 'unknown', 'acknowledge']),
      configuration: Object.freeze(
        expose(value.mcp.configuration, [
          'getSnapshot',
          'subscribe',
          'saveServer',
          'removeServer',
          'keyReady',
          'grant',
        ]),
      ),
    }),
    skills: Object.freeze({
      ...expose(value.skills, ['getSnapshot', 'subscribe', 'install', 'remove', 'grant']),
      ...expose(value.skills.repository, ['bundle', 'versions']),
      ...expose(value.skillPackage, ['decodeText', 'validateBundle', 'importPackage']),
    }),
  };
  return Object.freeze(services);
}
