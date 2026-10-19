import type { WorkspaceContext } from './context';
import { WorkspaceReader } from './reader';
import { MutationCoordinator } from './mutations';
import { FileCommands } from './files';
import { GitService } from './git';
import { RunSnapshots } from './run-snapshots';
import { EditorDrafts } from './editor-drafts';
import { RepositoryService } from './repository';
import { RepositoryClones } from './repository-clones';
import { MergeService } from './merges';
import { RebaseService } from './rebases';

/** Host facade composed from one shared project mutation coordinator. */
export class WorkspaceApplication {
  private readonly reader: WorkspaceReader;
  private readonly mutations: MutationCoordinator;
  private readonly commands: FileCommands;
  private readonly versions: GitService;
  private readonly runs: RunSnapshots;
  private readonly drafts: EditorDrafts;
  private readonly repositoryService: RepositoryService;
  private readonly clones: RepositoryClones;
  private readonly merges: MergeService;
  private readonly rebases: RebaseService;
  constructor(private readonly context: WorkspaceContext) {
    this.drafts = new EditorDrafts(context.metadata, context.projectBucket);
    this.reader = new WorkspaceReader(context);
    this.mutations = new MutationCoordinator(context, this.reader);
    this.commands = new FileCommands(context, this.reader, this.mutations);
    this.versions = new GitService(context, this.mutations);
    this.merges = new MergeService(context, this.mutations, this.versions, this.drafts);
    this.rebases = new RebaseService(context, this.mutations, this.versions, this.drafts);
    this.repositoryService = new RepositoryService(
      context,
      this.mutations,
      this.versions,
      this.drafts,
      this.merges,
      this.rebases,
    );
    this.runs = new RunSnapshots(context, this.mutations, this.versions);
    this.clones = new RepositoryClones(context, this.mutations, this.repositoryService.transport);
  }
  editorDraft = (...args: Parameters<EditorDrafts['get']>) => this.drafts.get(...args);
  saveEditorDraft = (...args: Parameters<EditorDrafts['save']>) => this.drafts.save(...args);
  get git() {
    return this.context.git;
  }
  get metadata() {
    return this.context.metadata;
  }
  get journal() {
    return this.context.journal;
  }
  historyPage = (...args: Parameters<WorkspaceContext['git']['historyPage']>) =>
    this.context.git.historyPage(...args);
  get recoveryIssues() {
    return this.mutations.recoveryIssues;
  }
  projects = (...args: Parameters<WorkspaceReader['projects']>) => this.reader.projects(...args);
  files = (...args: Parameters<WorkspaceReader['files']>) => this.reader.files(...args);
  read = (...args: Parameters<WorkspaceReader['read']>) => this.reader.read(...args);
  readText = (...args: Parameters<WorkspaceReader['readText']>) => this.reader.readText(...args);
  preview = (...args: Parameters<WorkspaceReader['preview']>) => this.reader.preview(...args);
  subscribe = (...args: Parameters<MutationCoordinator['subscribe']>) =>
    this.mutations.subscribe(...args);
  claim = (...args: Parameters<MutationCoordinator['claim']>) => this.mutations.claim(...args);
  release = (...args: Parameters<MutationCoordinator['release']>) =>
    this.mutations.release(...args);
  needsRecovery = (...args: Parameters<MutationCoordinator['needsRecovery']>) =>
    this.mutations.needsRecovery(...args);
  recover = async () => {
    const projectRepositories = this.context.journal.namespace === 'projects';
    if (projectRepositories) await this.clones.recover();
    await this.mutations.recover();
    if (projectRepositories) {
      await this.merges.recover();
      await this.rebases.recover();
      await this.repositoryService.recover();
    }
  };
  repository = (...args: Parameters<RepositoryService['info']>) =>
    this.repositoryService.info(...args);
  gitCommand = (...args: Parameters<RepositoryService['command']>) =>
    this.repositoryService.command(...args);
  cloneProject = (...args: Parameters<RepositoryClones['clone']>) => this.clones.clone(...args);
  mergeBranch = (...args: Parameters<MergeService['merge']>) => this.merges.merge(...args);
  conflictPreview = async (...args: Parameters<MergeService['preview']>) =>
    (await this.rebases.sessionInfo(args[0]))
      ? this.rebases.preview(...args)
      : this.merges.preview(...args);
  resolveConflict = async (...args: Parameters<MergeService['resolve']>) =>
    (await this.rebases.sessionInfo(args[0]))
      ? this.rebases.resolve(...args)
      : this.merges.resolve(...args);
  rebaseBranch = (...args: Parameters<RebaseService['start']>) => this.rebases.start(...args);
  continueRebase = (...args: Parameters<RebaseService['continue']>) =>
    this.rebases.continue(...args);
  skipRebase = (...args: Parameters<RebaseService['skip']>) => this.rebases.skip(...args);
  abortRebase = (...args: Parameters<RebaseService['abort']>) => this.rebases.abort(...args);
  continueMerge = (id: string, expected: import('@/core/git/contracts').GitStatus) =>
    this.merges.finish(id, 'continue', expected);
  abortMerge = (id: string, expected: import('@/core/git/contracts').GitStatus) =>
    this.merges.finish(id, 'abort', expected);
  saveGitCredential = (...args: Parameters<RepositoryService['transport']['save']>) =>
    this.repositoryService.transport.save(...args);
  gitTransfer = (...args: Parameters<RepositoryService['transport']['state']>) =>
    this.repositoryService.transport.state(...args);
  subscribeGitTransfer = (...args: Parameters<RepositoryService['transport']['subscribe']>) =>
    this.repositoryService.transport.subscribe(...args);
  cancelGitTransfer = (projectId: string) => this.repositoryService.transport.cancel(projectId);
  create = (...args: Parameters<FileCommands['create']>) => this.commands.create(...args);
  write = (...args: Parameters<FileCommands['write']>) => this.commands.write(...args);
  writeText = (...args: Parameters<FileCommands['writeText']>) => this.commands.writeText(...args);
  editText = (...args: Parameters<FileCommands['editText']>) => this.commands.editText(...args);
  remove = (...args: Parameters<FileCommands['remove']>) => this.commands.remove(...args);
  move = (...args: Parameters<FileCommands['move']>) => this.commands.move(...args);
  saveSkillRevision = (...args: Parameters<FileCommands['saveSkillRevision']>) =>
    this.commands.saveSkillRevision(...args);
  mergeCandidate = (...args: Parameters<FileCommands['mergeCandidate']>) =>
    this.commands.mergeCandidate(...args);
  restore = (...args: Parameters<GitService['restore']>) => this.versions.restore(...args);
  changes = (...args: Parameters<GitService['changes']>) => this.versions.changes(...args);
  status = (...args: Parameters<GitService['status']>) => this.versions.status(...args);
  stage = (...args: Parameters<GitService['stage']>) => this.versions.stage(...args);
  unstage = (...args: Parameters<GitService['unstage']>) => this.versions.unstage(...args);
  commitStaged = (...args: Parameters<GitService['commitStaged']>) =>
    this.versions.commitStaged(...args);
  diff = (...args: Parameters<GitService['diff']>) => this.versions.diff(...args);
  discard = (...args: Parameters<GitService['discard']>) => this.versions.discard(...args);
  taskBaseline = (...args: Parameters<RunSnapshots['taskBaseline']>) =>
    this.runs.taskBaseline(...args);
  inputSnapshot = (...args: Parameters<RunSnapshots['inputSnapshot']>) =>
    this.runs.inputSnapshot(...args);
  candidateSnapshot = (...args: Parameters<RunSnapshots['candidateSnapshot']>) =>
    this.runs.candidateSnapshot(...args);
  taskFinal = (...args: Parameters<RunSnapshots['taskFinal']>) => this.runs.taskFinal(...args);
  taskChanges = (...args: Parameters<RunSnapshots['taskChanges']>) =>
    this.runs.taskChanges(...args);
  undoTask = (...args: Parameters<RunSnapshots['undoTask']>) => this.runs.undoTask(...args);
  snapshot(projectId: string, openPath?: string) {
    return this.mutations.query(projectId, async () => {
      const [view, history, operations, repository] = await Promise.all([
        this.reader.view(projectId, openPath),
        this.context.git.historyPage(projectId),
        this.context.journal.list({ scope: this.context.journal.scope(projectId), limit: 100 }),
        this.repositoryService.infoValue(projectId),
      ]);
      return {
        ...view,
        versions: history.versions,
        historyCursor: history.cursor,
        repository,
        gitStatus: await this.versions.statusValue(projectId, view.files),
        operations: operations.filter(operation => operation.phase === 'recorded'),
      };
    });
  }
}
