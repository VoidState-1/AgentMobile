import type { WorkspaceContext } from './context';
import { WorkspaceReader } from './reader';
import { MutationCoordinator } from './mutations';
import { FileCommands } from './files';
import { GitService } from './git';
import { RunSnapshots } from './run-snapshots';
import type { Operation } from '@/core/workspace/types';

/** Host facade composed from one shared project mutation coordinator. */
export class WorkspaceApplication {
  private readonly reader: WorkspaceReader;
  private readonly mutations: MutationCoordinator;
  private readonly commands: FileCommands;
  private readonly versions: GitService;
  private readonly runs: RunSnapshots;
  constructor(private readonly context: WorkspaceContext) {
    this.reader = new WorkspaceReader(context); this.mutations = new MutationCoordinator(context, this.reader);
    this.commands = new FileCommands(context, this.reader, this.mutations); this.versions = new GitService(context, this.reader, this.mutations);
    this.runs = new RunSnapshots(context, this.reader, this.mutations, this.versions);
  }
  get git() { return this.context.git; }
  get metadata() { return this.context.metadata; }
  get recoveryIssues() { return this.mutations.recoveryIssues; }
  projects = (...args: Parameters<WorkspaceReader['projects']>) => this.reader.projects(...args);
  files = (...args: Parameters<WorkspaceReader['files']>) => this.reader.files(...args);
  read = (...args: Parameters<WorkspaceReader['read']>) => this.reader.read(...args);
  readText = (...args: Parameters<WorkspaceReader['readText']>) => this.reader.readText(...args);
  preview = (...args: Parameters<WorkspaceReader['preview']>) => this.reader.preview(...args);
  subscribe = (...args: Parameters<MutationCoordinator['subscribe']>) => this.mutations.subscribe(...args);
  claim = (...args: Parameters<MutationCoordinator['claim']>) => this.mutations.claim(...args);
  release = (...args: Parameters<MutationCoordinator['release']>) => this.mutations.release(...args);
  needsRecovery = (...args: Parameters<MutationCoordinator['needsRecovery']>) => this.mutations.needsRecovery(...args);
  recover = (...args: Parameters<MutationCoordinator['recover']>) => this.mutations.recover(...args);
  create = (...args: Parameters<FileCommands['create']>) => this.commands.create(...args);
  write = (...args: Parameters<FileCommands['write']>) => this.commands.write(...args);
  remove = (...args: Parameters<FileCommands['remove']>) => this.commands.remove(...args);
  move = (...args: Parameters<FileCommands['move']>) => this.commands.move(...args);
  replaceFiles = (...args: Parameters<FileCommands['replaceFiles']>) => this.commands.replaceFiles(...args);
  mergeCandidate = (...args: Parameters<FileCommands['mergeCandidate']>) => this.commands.mergeCandidate(...args);
  restore = (...args: Parameters<GitService['restore']>) => this.versions.restore(...args);
  changes = (...args: Parameters<GitService['changes']>) => this.versions.changes(...args);
  status = (...args: Parameters<GitService['status']>) => this.versions.status(...args);
  stage = (...args: Parameters<GitService['stage']>) => this.versions.stage(...args);
  unstage = (...args: Parameters<GitService['unstage']>) => this.versions.unstage(...args);
  commitStaged = (...args: Parameters<GitService['commitStaged']>) => this.versions.commitStaged(...args);
  diff = (...args: Parameters<GitService['diff']>) => this.versions.diff(...args);
  discard = (...args: Parameters<GitService['discard']>) => this.versions.discard(...args);
  taskBaseline = (...args: Parameters<RunSnapshots['taskBaseline']>) => this.runs.taskBaseline(...args);
  inputSnapshot = (...args: Parameters<RunSnapshots['inputSnapshot']>) => this.runs.inputSnapshot(...args);
  candidateSnapshot = (...args: Parameters<RunSnapshots['candidateSnapshot']>) => this.runs.candidateSnapshot(...args);
  taskFinal = (...args: Parameters<RunSnapshots['taskFinal']>) => this.runs.taskFinal(...args);
  taskChanges = (...args: Parameters<RunSnapshots['taskChanges']>) => this.runs.taskChanges(...args);
  undoTask = (...args: Parameters<RunSnapshots['undoTask']>) => this.runs.undoTask(...args);
  snapshot(projectId: string, openPath?: string) {
    return this.mutations.query(projectId, async () => {
      const [files, versions, operations] = await Promise.all([
        this.reader.files(projectId), this.context.git.log(projectId), this.context.metadata.all<Operation>('operations'),
      ]);
      const preview = openPath && files.some((file) => file.path === openPath) ?
        { path: openPath, ...await this.reader.preview(projectId, openPath) } : undefined;
      return { files, versions, gitStatus: await this.versions.statusValue(projectId), operations: operations.filter((operation) => operation.projectId === projectId && operation.phase === 'recorded'), preview };
    });

  }
}
