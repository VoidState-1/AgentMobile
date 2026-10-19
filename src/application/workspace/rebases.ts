import { AppError } from '@/core/errors';
import type { GitStatus } from '@/core/git/contracts';
import type { GitRefState } from '@/core/git/repository';
import { sameHead } from '@/core/git/repository';
import type { GitRebaseCommit, GitRebaseSessionInfo } from '@/core/git/rebase';
import { gitStateNames, type GitStateFiles, type GitConflictChoice } from '@/core/git/merge';
import { cloneTree, sameEntry } from '@/core/git/objects';
import type { FileChange } from '@/core/workspace/types';
import type { OperationBody } from '@/core/workspace/journal';
import type { WorkspaceContext } from './context';
import type { MutationCoordinator } from './mutations';
import type { GitService } from './git';
import type { EditorDrafts } from './editor-drafts';
import { ConflictService, indexChanges } from './conflicts';

interface Progress {
  state: 'prepared' | 'active' | 'completed';
  position: number;
  currentOid: string;
  phase: 'ready' | 'conflicts';
  paths: string[];
  stepPaths: string[];
  artifacts: string[];
  rewritten: [string, string][];
  skipped: string[];
}
interface RebaseSession extends Progress {
  id: string;
  projectId: string;
  original: GitRefState & { oid: string };
  originalWorking: string;
  ontoName: string;
  ontoOid: string;
  commits: GitRebaseCommit[];
  pending?: { operationId: string; after: Progress };
}
const unique = (values: string[]) => [...new Set(values)];
const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
function authorScript(commit: GitRebaseCommit) {
  const { name, email, time, offset } = commit.author;
  const minutes = Math.abs(offset);
  const timezone =
    (offset < 0 ? '-' : '+') +
    String(Math.floor(minutes / 60)).padStart(2, '0') +
    String(minutes % 60).padStart(2, '0');
  return (
    'GIT_AUTHOR_NAME=' +
    quote(name) +
    '\nGIT_AUTHOR_EMAIL=' +
    quote(email) +
    '\nGIT_AUTHOR_DATE=' +
    quote('@' + time + ' ' + timezone) +
    '\n'
  );
}

/** Replays commits through the same file/index/state/ref journal used by merge. */
export class RebaseService {
  private readonly conflicts: ConflictService;
  constructor(
    private readonly context: WorkspaceContext,
    private readonly mutations: MutationCoordinator,
    private readonly versions: GitService,
    private readonly drafts: EditorDrafts,
  ) {
    this.conflicts = new ConflictService(context, mutations, versions);
  }
  async sessionInfo(projectId: string): Promise<GitRebaseSessionInfo | undefined> {
    const value = await this.context.metadata.get<RebaseSession>('git-rebases', projectId);
    if (!value || value.state === 'completed') return undefined;
    const current = value.commits[value.position];
    return {
      id: value.id,
      branch: value.original.branch,
      ontoName: value.ontoName,
      ontoOid: value.ontoOid,
      position: value.position,
      total: value.commits.length,
      phase: value.phase,
      ...(current
        ? { current: { oid: current.oid, message: current.message.split('\n')[0].slice(0, 240) } }
        : {}),
    };
  }
  private async check(projectId: string, expected: GitStatus) {
    const status = await this.versions.statusValue(projectId);
    if (
      status.head !== expected.head ||
      status.branch !== expected.branch ||
      status.indexRevision !== expected.indexRevision ||
      status.workingRevision !== expected.workingRevision
    )
      throw new AppError('CONFLICT', 'VERSION_CONFLICT：仓库已变化，请刷新后重试。');
    if (await this.drafts.hasUnsaved(projectId))
      throw new AppError('CONFLICT', '项目中有未保存的文件草稿，请先保存或放弃。');
    return status;
  }
  private async save(session: RebaseSession) {
    try {
      await this.context.metadata.put('git-rebases', session.projectId, session);
    } catch (error) {
      this.mutations.block(session.projectId, '变基回执需要恢复，已暂停项目写入。');
      throw error;
    }
  }
  private async active(projectId: string): Promise<RebaseSession> {
    const session = await this.context.metadata.get<RebaseSession>('git-rebases', projectId);
    if (!session || session.state !== 'active' || session.pending)
      throw new AppError('CONFLICT', '没有可继续的变基，或变基需要先恢复。');
    const info = await this.context.git.repositoryInfo(projectId),
      state = await this.context.git.gitState(projectId);
    if (
      info.state !== 'rebase' ||
      info.head.branch !== null ||
      info.head.oid !== session.currentOid ||
      state['rebase-merge/orig-head'] !== session.original.oid + '\n' ||
      state['rebase-merge/onto'] !== session.ontoOid + '\n' ||
      state['rebase-merge/head-name'] !==
        (session.original.branch ? 'refs/heads/' + session.original.branch : 'detached HEAD') +
          '\n' ||
      (session.original.branch &&
        info.branches.find(branch => !branch.remote && branch.name === session.original.branch)
          ?.oid !== session.original.oid)
    )
      throw new AppError('CONFLICT', '变基基线、原分支或 Git 状态已变化，请保留现场。');
    const expected = this.gitState(session, this.progress(session), state);
    if (gitStateNames.some(name => (state[name] ?? null) !== (expected[name] ?? null)))
      throw new AppError('CONFLICT', '变基步骤或待重放列表已变化，请保留现场。');
    return session;
  }
  private progress(session: RebaseSession): Progress {
    const { state, position, currentOid, phase, paths, stepPaths, artifacts, rewritten, skipped } =
      session;
    return { state, position, currentOid, phase, paths, stepPaths, artifacts, rewritten, skipped };
  }
  private gitState(
    session: RebaseSession,
    progress: Progress,
    before: GitStateFiles,
  ): GitStateFiles {
    const after = { ...before };
    if (progress.state === 'completed') {
      for (const name of gitStateNames)
        if (name === 'REBASE_HEAD' || name.startsWith('rebase-merge/')) after[name] = null;
      return after;
    }
    const stopped = progress.phase === 'conflicts' ? session.commits[progress.position] : undefined;
    const done = progress.position + (stopped ? 1 : 0);
    return {
      ...after,
      ORIG_HEAD: session.original.oid + '\n',
      REBASE_HEAD: stopped ? stopped.oid + '\n' : null,
      'rebase-merge/interactive': '',
      'rebase-merge/quiet': '',
      'rebase-merge/head-name':
        (session.original.branch ? 'refs/heads/' + session.original.branch : 'detached HEAD') +
        '\n',
      'rebase-merge/orig-head': session.original.oid + '\n',
      'rebase-merge/onto': session.ontoOid + '\n',
      'rebase-merge/git-rebase-todo': session.commits
        .slice(done)
        .map(commit => 'pick ' + commit.oid + '\n')
        .join(''),
      'rebase-merge/done': session.commits
        .slice(0, done)
        .map(commit => 'pick ' + commit.oid + '\n')
        .join(''),
      'rebase-merge/msgnum': done + '\n',
      'rebase-merge/end': session.commits.length + '\n',
      'rebase-merge/stopped-sha': stopped ? stopped.oid + '\n' : null,
      'rebase-merge/message': stopped?.message ?? null,
      'rebase-merge/author-script': stopped ? authorScript(stopped) : null,
      'rebase-merge/rewritten-list': progress.rewritten
        .map(([old, next]) => old + ' ' + next + '\n')
        .join(''),
    };
  }
  private async record(
    session: RebaseSession,
    after: Progress,
    changes: FileChange[],
    body: Omit<OperationBody, 'changes'>,
    message: string,
  ): Promise<RebaseSession> {
    const operationId = this.context.id();
    const pending = { ...session, pending: { operationId, after } };
    await this.save(pending);
    try {
      await this.mutations.prepare(
        session.projectId,
        changes,
        message,
        operationId,
        undefined,
        undefined,
        'rebase',
        { ...body, completionReceipt: true },
      );
    } catch (error) {
      try {
        const operation = await this.context.journal.get(session.projectId, operationId);
        if (!operation)
          await this.save({
            ...session,
            state: session.state === 'prepared' ? 'completed' : session.state,
            pending: undefined,
          });
        else this.mutations.block(session.projectId, '变基意图需要恢复，已暂停项目写入。');
      } catch {
        this.mutations.block(session.projectId, '变基意图需要恢复，已暂停项目写入。');
      }
      throw error;
    }
    const next = { ...session, ...after, pending: undefined };
    await this.save(next);
    return next;
  }
  start(
    projectId: string,
    source: { name: string; oid: string },
    expected: GitStatus,
  ): Promise<'up-to-date' | 'fast-forward' | 'completed' | 'conflicts'> {
    return this.mutations.serial(projectId, undefined, async () => {
      const status = await this.check(projectId, expected),
        info = await this.context.git.repositoryInfo(projectId);
      if (!info.capabilities.rebase)
        throw new AppError('VALIDATION', '变基请使用支持该能力的原生应用。');
      if (status.state !== 'none' || (await this.sessionInfo(projectId)))
        throw new AppError('CONFLICT', '请先完成或中止正在进行的 Git 操作。');
      if (!status.head || status.files.length)
        throw new AppError('CONFLICT', '请先提交或处理未提交更改，再变基。');
      if (!info.branches.some(branch => branch.name === source.name && branch.oid === source.oid))
        throw new AppError('CONFLICT', '目标分支已变化，请刷新。');
      const plan = await this.context.git.rebasePlan(projectId, source.oid);
      if (plan.kind === 'up-to-date') return plan.kind;
      const initial = await this.context.git.switchPlan(projectId, plan.onto),
        index = await this.context.git.indexState(projectId),
        state = await this.context.git.gitState(projectId);
      const original = { oid: status.head, branch: status.branch };
      if (plan.kind === 'fast-forward') {
        await this.mutations.prepare(
          projectId,
          initial.changes,
          '快进变基至 ' + source.name,
          this.context.id(),
          undefined,
          undefined,
          'rebase',
          {
            indexChanges: indexChanges(index.entries, initial.index),
            conflictsChange: { before: index.conflicts, after: [] },
            gitStateChange: { before: state, after: { ...state, ORIG_HEAD: status.head + '\n' } },
            headChange: { before: original, after: { branch: status.branch, oid: plan.onto } },
            completionReceipt: true,
          },
        );
        return plan.kind;
      }
      const id = this.context.id();
      const session: RebaseSession = {
        id,
        projectId,
        original,
        originalWorking: await this.context.git.checkpoint(
          projectId,
          await this.context.git.workingTree(projectId),
          'rebases/' + id + '/original',
          status.head,
        ),
        ontoName: source.name,
        ontoOid: plan.onto,
        commits: plan.commits,
        state: 'prepared',
        position: 0,
        currentOid: status.head,
        phase: 'ready',
        paths: initial.changes.map(change => change.path),
        stepPaths: [],
        artifacts: [],
        rewritten: [],
        skipped: [],
      };
      const progress: Progress = {
        ...this.progress(session),
        state: 'active',
        currentOid: plan.onto,
      };
      const ready = await this.record(
        session,
        progress,
        initial.changes,
        {
          indexChanges: indexChanges(index.entries, initial.index),
          conflictsChange: { before: index.conflicts, after: [] },
          gitStateChange: { before: state, after: this.gitState(session, progress, state) },
          headChange: { before: original, after: { branch: null, oid: plan.onto } },
          commitDependencies: [status.head, plan.onto],
        },
        '开始变基至 ' + source.name,
      );
      return this.drive(ready);
    });
  }
  private async advance(
    session: RebaseSession,
    entries: import('@/core/git/objects').GitTree,
    changes: FileChange[],
    conflicts: import('@/core/git/repository').GitConflict[],
    artifacts: string[],
    paths: string[],
  ) {
    const id = session.projectId,
      original = session.commits[session.position];
    const beforeIndex = await this.context.git.indexState(id),
      before = await this.context.git.gitState(id);
    const commit = conflicts.length
      ? null
      : await this.context.git.rebaseCommit(id, entries, original.oid, session.currentOid);
    const after: Progress = {
      ...this.progress(session),
      phase: conflicts.length ? 'conflicts' : 'ready',
      position: session.position + (conflicts.length ? 0 : 1),
      currentOid: commit ?? session.currentOid,
      paths: unique([...session.paths, ...paths]),
      stepPaths: conflicts.length ? paths : [],
      artifacts: unique([...session.artifacts, ...artifacts]),
      rewritten: conflicts.length
        ? session.rewritten
        : [...session.rewritten, [original.oid, commit ?? session.currentOid]],
      skipped: !conflicts.length && !commit ? [...session.skipped, original.oid] : session.skipped,
    };
    return this.record(
      session,
      after,
      changes,
      {
        indexChanges: indexChanges(beforeIndex.entries, entries),
        conflictsChange: { before: beforeIndex.conflicts, after: conflicts },
        gitStateChange: { before, after: this.gitState(session, after, before) },
        commitDependencies: [original.oid],
        ...(commit
          ? {
              headChange: {
                before: { branch: null, oid: session.currentOid },
                after: { branch: null, oid: commit },
              },
            }
          : {}),
      },
      conflicts.length
        ? '变基冲突 ' + original.oid.slice(0, 7)
        : '重放提交 ' + original.oid.slice(0, 7),
    );
  }
  private async drive(session: RebaseSession): Promise<'completed' | 'conflicts'> {
    while (session.position < session.commits.length) {
      await this.active(session.projectId);
      const plan = await this.context.git.rebaseStep(
        session.projectId,
        session.commits[session.position].oid,
        session.currentOid,
      );
      const beforeIndex = await this.context.git.indexState(session.projectId),
        conflictPaths = new Set(plan.index.conflicts.map(value => value.path));
      const paths = unique([
        ...plan.changes.map(change => change.path),
        ...indexChanges(beforeIndex.entries, plan.index.entries).map(change => change.path),
        ...conflictPaths,
      ]);
      const artifacts = plan.changes
        .filter(
          change =>
            change.after && !plan.index.entries[change.path] && !conflictPaths.has(change.path),
        )
        .map(change => change.path);
      session = await this.advance(
        session,
        plan.index.entries,
        plan.changes,
        plan.index.conflicts,
        artifacts,
        paths,
      );
      if (session.phase === 'conflicts') return 'conflicts';
    }
    await this.finish(session, false);
    return 'completed';
  }
  private async finish(session: RebaseSession, abort: boolean) {
    await this.active(session.projectId);
    const id = session.projectId,
      index = await this.context.git.indexState(id),
      before = await this.context.git.gitState(id);
    const entries = cloneTree(index.entries),
      changes: FileChange[] = [];
    if (abort) {
      const original = await this.context.git.tree(id, session.originalWorking),
        originalIndex = await this.context.git.tree(id, session.original.oid),
        working = await this.context.git.workingTree(id);
      for (const path of session.paths) {
        if (!sameEntry(working[path], original[path]))
          changes.push({ path, before: working[path] ?? null, after: original[path] ?? null });
        if (originalIndex[path]) entries[path] = originalIndex[path];
        else delete entries[path];
      }
    }
    const target = {
        branch: session.original.branch,
        oid: abort ? session.original.oid : session.currentOid,
      },
      current = { branch: null, oid: session.currentOid };
    const after: Progress = {
      ...this.progress(session),
      state: 'completed',
      phase: 'ready',
      stepPaths: [],
    };
    await this.record(
      session,
      after,
      changes,
      {
        indexChanges: indexChanges(index.entries, entries),
        conflictsChange: { before: index.conflicts, after: [] },
        gitStateChange: { before, after: this.gitState(session, after, before) },
        ...(!sameHead(current, target)
          ? {
              headChange: {
                before: current,
                after: target,
                ...(session.original.branch
                  ? { branchGuard: { name: session.original.branch, oid: session.original.oid } }
                  : {}),
              },
            }
          : {}),
      },
      abort ? '中止变基' : '完成变基',
    );
  }
  continue(projectId: string, expected: GitStatus) {
    return this.mutations.serial(projectId, undefined, async () => {
      await this.check(projectId, expected);
      let session = await this.active(projectId);
      if (session.phase === 'conflicts') {
        const index = await this.context.git.indexState(projectId);
        if (index.conflicts.length)
          throw new AppError('CONFLICT', '请先解决全部冲突，再继续变基。');
        session = await this.advance(session, index.entries, [], [], [], session.stepPaths);
      }
      return this.drive(session);
    });
  }
  skip(projectId: string, expected: GitStatus) {
    return this.mutations.serial(projectId, undefined, async () => {
      await this.check(projectId, expected);
      const session = await this.active(projectId),
        id = session.projectId;
      if (session.phase !== 'conflicts') throw new AppError('CONFLICT', '没有需要跳过的冲突提交。');
      const index = await this.context.git.indexState(id),
        before = await this.context.git.gitState(id),
        clean = await this.context.git.tree(id, session.currentOid);
      const raw = await this.context.git.filterEntries(id, clean, session.currentOid, 'smudge'),
        working = await this.context.git.workingTree(id),
        entries = cloneTree(index.entries);
      const changes: FileChange[] = [];
      for (const path of session.stepPaths) {
        if (!sameEntry(working[path], raw[path]))
          changes.push({ path, before: working[path] ?? null, after: raw[path] ?? null });
        if (clean[path]) entries[path] = clean[path];
        else delete entries[path];
      }
      const original = session.commits[session.position];
      const after: Progress = {
        ...this.progress(session),
        position: session.position + 1,
        phase: 'ready',
        stepPaths: [],
        rewritten: [...session.rewritten, [original.oid, session.currentOid]],
        skipped: [...session.skipped, original.oid],
      };
      const next = await this.record(
        session,
        after,
        changes,
        {
          indexChanges: indexChanges(index.entries, entries),
          conflictsChange: { before: index.conflicts, after: [] },
          gitStateChange: { before, after: this.gitState(session, after, before) },
        },
        '跳过提交 ' + original.oid.slice(0, 7),
      );
      return this.drive(next);
    });
  }
  abort(projectId: string, expected: GitStatus) {
    return this.mutations.serial(projectId, undefined, async () => {
      await this.check(projectId, expected);
      await this.finish(await this.active(projectId), true);
    });
  }
  private scope(session: RebaseSession) {
    if (session.phase !== 'conflicts')
      throw new AppError('CONFLICT', '当前变基没有待处理的冲突提交。');
    const commit = session.commits[session.position];
    return {
      kind: 'rebase' as const,
      base: commit.parent,
      ours: session.currentOid,
      theirs: commit.oid,
      paths: session.stepPaths,
      artifacts: session.artifacts,
    };
  }
  preview(projectId: string, path: string) {
    return this.mutations.query(projectId, async () =>
      this.conflicts.preview(projectId, path, this.scope(await this.active(projectId))),
    );
  }
  resolve(projectId: string, path: string, choice: GitConflictChoice, expected: GitStatus) {
    return this.mutations.serial(projectId, undefined, async () => {
      await this.check(projectId, expected);
      await this.conflicts.resolve(
        projectId,
        path,
        choice,
        this.scope(await this.active(projectId)),
      );
    });
  }
  async recover() {
    for (let session of await this.context.metadata.all<RebaseSession>('git-rebases')) {
      if (session.state === 'completed' || this.mutations.needsRecovery(session.projectId))
        continue;
      if (session.pending) {
        const operation = await this.context.journal.get(
          session.projectId,
          session.pending.operationId,
        );
        if (operation?.phase === 'recorded')
          session = { ...session, ...session.pending.after, pending: undefined };
        else if (!operation)
          session = {
            ...session,
            state: session.state === 'prepared' ? 'completed' : session.state,
            pending: undefined,
          };
        else {
          this.mutations.block(session.projectId, '变基操作尚未恢复，已暂停项目写入。');
          continue;
        }
        await this.save(session);
      }
      if (session.state === 'active')
        try {
          await this.active(session.projectId);
        } catch {
          this.mutations.block(session.projectId, '变基基线或状态不匹配，已暂停项目写入。');
        }
    }
  }
}
