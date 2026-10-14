import type { Project } from '@/core/projects/types';
import type { Operation, ProjectFile } from '@/core/workspace/types';
import type { Version } from '@/core/git/types';
import type { TaskRecord } from '@/core/runs/types';
import type { GitStatus } from '@/core/git/contracts';
import type { ModelConfigurationService } from '@/application/models/configuration';
import type { CheckKind, DiagnosticResult } from '@/core/models/types';
import type { ConversationService } from '@/application/conversations/service';
import type { AgentSettingsService } from '@/application/settings/agent';
import type { McpConfigurationService } from '@/application/mcp/configuration';
import type { McpAttempt } from '@/core/mcp/types';
import type { SkillService } from '@/application/skills/library';
import type { SkillBundle, SkillRepository } from '@/core/skills/types';
import type { PreferencesService } from './settings/preferences';
import type { ProposalService } from './runs/proposals';

export interface FilePreview { revision: string; content: string }
export interface ReviewFile { path: string; kind: string; before: string; after: string }
export type WorkspaceOperationSummary = Pick<Operation, 'id' | 'projectId' | 'runId' | 'ownerRootRunId' | 'actorRunId' | 'proposalId' | 'phase'> & { changes: { path: string }[] };
export interface WorkspaceSnapshot {
  files: ProjectFile[]; versions: Version[]; gitStatus: GitStatus; operations: WorkspaceOperationSummary[];
  preview?: FilePreview & { path: string };
}
export interface WorkspaceApi {
  readonly recoveryIssues: readonly string[];
  projects(): Promise<Project[]>;
  create(name: string): Promise<Project>;
  files(projectId: string): Promise<ProjectFile[]>;
  read(projectId: string, path: string): Promise<{ bytes: Uint8Array; revision: string }>;
  preview(projectId: string, path: string): Promise<FilePreview>;
  head(projectId: string): Promise<string>;
  snapshot(projectId: string, openPath?: string): Promise<WorkspaceSnapshot>;
  write(projectId: string, path: string, bytes: Uint8Array, revision: string | null, options?: { message?: string }): Promise<string>;
  remove(projectId: string, path: string, revision: string): Promise<string>;
  move(projectId: string, from: string, to: string, revision: string): Promise<string>;
  restore(projectId: string, ref: string, expectedHead: string): Promise<string>;
  changes(projectId: string, before: string | undefined, after: string): Promise<ReviewFile[]>;
  taskChanges(task: TaskRecord): Promise<ReviewFile[]>;
  undoTask(task: TaskRecord): Promise<void>;
  status(projectId: string): Promise<GitStatus>;
  stage(projectId: string, paths: string[], expected: Pick<GitStatus, 'head' | 'indexRevision'> & { revisions: Record<string, string | null> }): Promise<void>;
  unstage(projectId: string, paths: string[], expected: Pick<GitStatus, 'head' | 'indexRevision'>): Promise<void>;
  commitStaged(projectId: string, message: string, expected: Pick<GitStatus, 'head' | 'indexRevision'>): Promise<string>;
  diff(projectId: string, area: 'staged' | 'unstaged', paths?: string[]): Promise<ReviewFile[]>;
  discard(projectId: string, paths: string[], expected: GitStatus): Promise<void>;
  subscribe(listener: (change: { projectId: string; paths: readonly string[]; commit: string }) => void): () => void;
}
export type ModelsApi = Pick<ModelConfigurationService, 'getSnapshot' | 'subscribe' | 'saveConnection' | 'copyConnection' | 'removeConnection' | 'keyReady' |
  'saveModel' | 'removeModel' | 'setSelection' | 'setMode' | 'affectedDefaults'> & {
  readonly recoveryIssues: readonly string[];
  diagnose(connectionId: string, modelId: string | undefined, kind: CheckKind, signal?: AbortSignal): Promise<DiagnosticResult>;
};
export type ConversationsApi = Pick<ConversationService, 'getSnapshot' | 'subscribe' | 'ensureProject' | 'create' | 'select' | 'rename' | 'archive' | 'restore' | 'saveDraft'>;
export type McpSettingsApi = Pick<McpConfigurationService, 'getSnapshot' | 'subscribe' | 'saveServer' | 'removeServer' | 'keyReady' | 'grant'>;
export type SkillsApi = Pick<SkillService, 'getSnapshot' | 'subscribe' | 'install' | 'remove' | 'grant'> & Pick<SkillRepository, 'bundle' | 'versions'> & {
  decodeText(bytes: Uint8Array): string;
  validateBundle(files: SkillBundle['files'], folderName?: string): SkillBundle;
  importPackage(name: string, bytes: Uint8Array): SkillBundle[];
};
export interface AgentApi {
  getSnapshot(): { active?: TaskRecord; completed?: TaskRecord; runs?: readonly TaskRecord[]; error?: string; starting: boolean };
  subscribe(listener: () => void): () => void;
  start(projectId: string, prompt: string, imageAttached?: boolean, conversationId?: string, draftRevision?: number): Promise<void>;
  cancel(runId?: string): void | Promise<void>;
}
export interface AppServices {
  proposals?: Pick<ProposalService, 'preview'>;
  workspace: WorkspaceApi;
  models: ModelsApi;
  conversations: ConversationsApi;
  agentSettings: Pick<AgentSettingsService, 'getSnapshot' | 'save'>;
  agent: AgentApi;
  skills: SkillsApi;
  mcp: { configuration: McpSettingsApi; discover(id: string, signal?: AbortSignal): Promise<void>; unknown(serverId?: string): Promise<McpAttempt[]>; acknowledge(id: string): Promise<void> };
  preferences: Pick<PreferencesService, 'getWorkbench' | 'saveWorkbench'>;
  tasks(projectId: string, conversationId?: string): Promise<TaskRecord[]>;
  io: {
    pickFile(): Promise<{ name: string; bytes: Uint8Array } | undefined>;
    pickSkillPackage(): Promise<{ name: string; bytes: Uint8Array } | undefined>;
    exportFile(projectId: string, path: string): Promise<void>;
    exportSkill(name: string, commit: string): Promise<void>;
  };
}
