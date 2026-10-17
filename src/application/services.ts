import type { Project } from '@/core/projects';
import type { ProjectFile, ContentPreview, FileKind } from '@/core/workspace/types';
import type { Version } from '@/core/git/types';
import type { RunListQuery, RunPage, RunDetail, RunView, RunChange } from '@/core/runs/queries';
import type { TracePage, TextPage } from '@/core/runs/trace-storage';
import type {
  GitStatus,
  GitFileStatus,
  GitHistoryQuery,
  GitHistoryPage,
} from '@/core/git/contracts';
import type {
  CheckKind,
  DiagnosticResult,
  ModelConfiguration,
  ConnectionInput,
  ProviderConnection,
  ProviderIcon,
  ModelInput,
  ModelEntry,
} from '@/core/models/types';
import type { McpAttempt, McpConfiguration, McpServerInput, McpServer } from '@/core/mcp/types';
import type { SkillBundle, SkillConfiguration, SkillVersionPage } from '@/core/skills/types';
import type {
  ConversationState,
  Conversation,
  ConversationDraft,
} from '@/core/conversations/types';
import type { AgentSettings } from '@/core/agent/settings';
import type { WorkbenchPreferences } from '@/core/preferences';
import type { ProposalState } from '@/core/runs/proposals';

export interface FilePreview extends ContentPreview {
  revision: string;
  size: number;
}
export interface ReviewFile {
  path: string;
  status: NonNullable<GitFileStatus['staged']>;
  stagedOnly?: boolean;
  before: string;
  after: string;
  kind: FileKind;
  beforeSize: number | null;
  afterSize: number | null;
  unavailableReason?: string;
}
export interface FileChangeSummary {
  path: string;
  status: NonNullable<GitFileStatus['staged']>;
  stagedOnly: boolean;
  kind: FileKind;
  added?: number;
  removed?: number;
}
export interface WorkspaceOperationSummary {
  id: string;
  projectId: string;
  ownerRootRunId?: string;
  actorRunId?: string;
  proposalId?: string;
  phase: 'prepared' | 'applied' | 'checkpointed' | 'committed' | 'recorded';
  changedPaths: string[];
}
export interface WorkspaceSnapshot {
  files: ProjectFile[];
  versions: Version[];
  gitStatus: GitStatus;
  operations: WorkspaceOperationSummary[];
  preview?: FilePreview & { path: string };
  historyCursor?: string;
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
  historyPage(projectId: string, query?: GitHistoryQuery): Promise<GitHistoryPage>;
  write(
    projectId: string,
    path: string,
    bytes: Uint8Array,
    revision: string | null,
    options?: { message?: string },
  ): Promise<string>;
  writeText(
    projectId: string,
    path: string,
    bytes: Uint8Array,
    revision: string | null,
  ): Promise<string>;
  remove(projectId: string, path: string, revision: string): Promise<string>;
  move(projectId: string, from: string, to: string, revision: string): Promise<string>;
  restore(projectId: string, ref: string, expectedHead: string): Promise<string>;
  changes(projectId: string, before: string | undefined, after: string): Promise<ReviewFile[]>;
  taskChanges(runId: string): Promise<ReviewFile[]>;
  taskChangeSummary(runId: string): Promise<FileChangeSummary[]>;
  undoTask(runId: string): Promise<void>;
  status(projectId: string): Promise<GitStatus>;
  stage(
    projectId: string,
    paths: string[],
    expected: Pick<GitStatus, 'head' | 'indexRevision'> & {
      revisions: Record<string, string | null>;
    },
  ): Promise<void>;
  unstage(
    projectId: string,
    paths: string[],
    expected: Pick<GitStatus, 'head' | 'indexRevision'>,
  ): Promise<void>;
  commitStaged(
    projectId: string,
    message: string,
    expected: Pick<GitStatus, 'head' | 'indexRevision'>,
  ): Promise<string>;
  diff(projectId: string, area: 'staged' | 'unstaged', paths?: string[]): Promise<ReviewFile[]>;
  discard(projectId: string, paths: string[], expected: GitStatus): Promise<void>;
  subscribe(
    listener: (change: { projectId: string; paths: readonly string[]; commit: string }) => void,
  ): () => void;
}
export interface ModelsApi {
  readonly recoveryIssues: readonly string[];
  getSnapshot(): ModelConfiguration;
  subscribe(listener: () => void): () => void;
  prepareIcon(file: { name: string; bytes: Uint8Array }): ProviderIcon;
  setProviderOrder(order: string[], revision: number): Promise<void>;
  saveConnection(
    input: ConnectionInput,
    key?: { value?: string; remove?: boolean },
    revision?: number,
  ): Promise<ProviderConnection>;
  copyConnection(id: string): Promise<ProviderConnection>;
  removeConnection(id: string): Promise<void>;
  keyReady(id: string): Promise<boolean>;
  saveModel(input: ModelInput, revision?: number): Promise<ModelEntry>;
  removeModel(id: string): Promise<void>;
  setSelection(
    scope: 'global' | 'project' | 'session',
    modelId: string | undefined,
    ownerId?: string,
  ): Promise<void>;
  affectedDefaults(connectionId: string): number;
  diagnose(
    connectionId: string,
    modelId: string | undefined,
    kind: CheckKind,
    signal?: AbortSignal,
  ): Promise<DiagnosticResult>;
}
export interface ConversationsApi {
  getSnapshot(): ConversationState;
  subscribe(listener: () => void): () => void;
  ensureProject(projectId: string): Promise<Conversation>;
  create(projectId: string): Promise<Conversation>;
  select(id: string, projectId: string): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  archive(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  saveDraft(id: string, input: Omit<ConversationDraft, 'revision'>): Promise<ConversationDraft>;
}
export interface McpSettingsApi {
  getSnapshot(): McpConfiguration;
  subscribe(listener: () => void): () => void;
  saveServer(
    input: McpServerInput,
    token: { value?: string; remove?: boolean },
    revision?: number,
  ): Promise<McpServer>;
  removeServer(id: string): Promise<void>;
  keyReady(id: string): Promise<boolean>;
  grant(
    projectId: string,
    serverId: string,
    name: string,
    allow: boolean,
    fingerprint: string,
  ): Promise<void>;
}
export interface SkillsApi {
  getSnapshot(): SkillConfiguration;
  subscribe(listener: () => void): () => void;
  install(bundles: SkillBundle[], expectedCommit: string): Promise<void>;
  remove(name: string, expectedCommit: string): Promise<void>;
  grant(projectId: string, name: string, allow: boolean, revision: string): Promise<void>;
  bundle(commit: string, name: string): Promise<SkillBundle>;
  versions(name: string, cursor?: string, limit?: number): Promise<SkillVersionPage>;
  decodeText(bytes: Uint8Array): string;
  validateBundle(files: SkillBundle['files'], folderName?: string): SkillBundle;
  importPackage(name: string, bytes: Uint8Array): SkillBundle[];
}
export interface AgentSettingsApi {
  getSnapshot(): AgentSettings;
  save(
    input: Pick<AgentSettings, 'systemPrompt' | 'limits'>,
    revision: number,
  ): Promise<AgentSettings>;
}
export interface PreferencesApi {
  getWorkbench(): Promise<WorkbenchPreferences | undefined>;
  saveWorkbench(value: WorkbenchPreferences): Promise<void>;
}
export interface AgentApi {
  getSnapshot(): {
    active?: RunView;
    completed?: RunView;
    runs: readonly RunView[];
    error?: string;
    starting: boolean;
    availability: 'ready' | 'recovery_required';
  };
  subscribe(listener: () => void): () => void;
  start(
    projectId: string,
    prompt: string,
    imageAttached?: boolean,
    conversationId?: string,
    draftRevision?: number,
  ): Promise<void>;
  cancel(runId?: string): void | Promise<void>;
}
export interface RunsApi {
  list(query: RunListQuery): Promise<RunPage>;
  getDetail(runId: string): Promise<RunDetail>;
  listChildren(rootRunId: string, cursor?: string): Promise<RunPage>;
  listTrace(runId: string, cursor?: string): Promise<TracePage>;
  readTraceText(nodeId: string, offset?: number): Promise<TextPage>;
  subscribe(listener: (change: RunChange) => void): () => void;
}
export interface AppServices {
  proposals?: {
    preview(
      rootRunId: string,
      id: string,
    ): Promise<{
      id: string;
      state: ProposalState;
      paths: string[];
      conflicts?: string[];
      files: ReviewFile[];
    }>;
  };
  workspace: WorkspaceApi;
  models: ModelsApi;
  conversations: ConversationsApi;
  agentSettings: AgentSettingsApi;
  agent: AgentApi;
  skills: SkillsApi;
  mcp: {
    configuration: McpSettingsApi;
    discover(id: string, signal?: AbortSignal): Promise<void>;
    unknown(serverId?: string): Promise<McpAttempt[]>;
    acknowledge(id: string): Promise<void>;
  };
  preferences: PreferencesApi;
  runs: RunsApi;
  io: {
    pickFile(kind?: 'image'): Promise<{ name: string; bytes: Uint8Array } | undefined>;
    pickSkillPackage(): Promise<{ name: string; bytes: Uint8Array } | undefined>;
    exportFile(projectId: string, path: string): Promise<void>;
    exportSkill(name: string, commit: string): Promise<void>;
  };
}
