import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWorkspace } from '../src/bootstrap/workspace';
import { testStorage } from './storage';
import { AppError } from '../src/core/errors';
import { gitModes, sameEntry, type GitTree } from '../src/core/git/objects';
import type { GitConflict } from '../src/core/git/repository';
import type { GitStateFiles, GitMergePlan } from '../src/core/git/merge';

/** Application recovery tests; native stage serialization is tested separately on Android. */
export async function mergeFixture() {
  const f = await testStorage();
  const workspace = createWorkspace(f.files, f.metadata, randomUUID);
  const project = await workspace.create('合并恢复');
  const git = workspace.git;
  const empty = (): GitStateFiles => ({
    MERGE_HEAD: null,
    MERGE_MSG: null,
    MERGE_MODE: null,
    ORIG_HEAD: null,
  });
  const states = new Map<string, GitStateFiles>(),
    conflicts = new Map<string, GitConflict[]>(),
    receipts = new Map<string, string>();
  const run = (id: string, args: string[]) =>
    execFileSync('git', args, {
      cwd: f.root + git.dir(id),
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: f.root + '/no-user-config',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const originalInfo = git.repositoryInfo,
    originalIndex = git.index,
    originalSetIndex = git.setIndex;
  git.repositoryInfo = async id => ({
    ...(await originalInfo(id)),
    state: states.get(id)?.MERGE_HEAD ? 'merge' : 'none',
    conflicts: conflicts.get(id) ?? [],
    capabilities: {
      fetch: false,
      push: false,
      clone: false,
      merge: true,
      rebase: false,
    },
  });
  git.gitState = async id => structuredClone(states.get(id) ?? empty());
  git.applyGitState = async (id, before, after) => {
    const actual = await git.gitState(id);
    if (
      Object.keys(after).some(
        key =>
          actual[key as keyof GitStateFiles] !== before[key as keyof GitStateFiles] &&
          actual[key as keyof GitStateFiles] !== after[key as keyof GitStateFiles],
      )
    )
      throw new AppError('CONFLICT', 'git state changed');
    states.set(id, structuredClone(after));
  };
  git.indexState = async id => ({
    entries: await originalIndex(id),
    conflicts: structuredClone(conflicts.get(id) ?? []),
  });
  git.index = async id => {
    if (conflicts.get(id)?.length) throw new AppError('CONFLICT', 'unmerged index');
    return originalIndex(id);
  };
  git.setIndexState = async (id, entries, _before, after) => {
    await originalSetIndex(id, entries);
    conflicts.set(id, structuredClone(after));
  };
  git.completeOperation = async (id, operationId, checkpoint) => {
    receipts.set(id + '/' + operationId, checkpoint);
  };
  git.operationReceipt = async (id, operationId) => receipts.get(id + '/' + operationId);
  git.filterEntries = async (_id, entries) => entries;
  git.mergeCommit = async (id, entries, parents, message) => {
    const snapshot = await git.checkpoint(id, entries, 'test/' + randomUUID(), parents[0] ?? null);
    const tree = run(id, ['rev-parse', snapshot + '^{tree}']).trim();
    return run(id, [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit-tree',
      tree,
      ...parents.flatMap(parent => ['-p', parent]),
      '-m',
      message,
    ]).trim();
  };
  const ancestor = (id: string, first: string, next: string) => {
    try {
      run(id, ['merge-base', '--is-ancestor', first, next]);
      return true;
    } catch {
      return false;
    }
  };
  git.mergePlan = async (id, target, message): Promise<GitMergePlan> => {
    const ours = (await git.head(id))!,
      branch = await git.branch(id),
      state = await git.gitState(id);
    if (ours === target || ancestor(id, target, ours))
      return {
        kind: 'up-to-date',
        changes: [],
        index: await git.indexState(id),
        stateAfter: state,
      };
    let next: string | undefined,
      desired: GitTree,
      stage0: GitTree,
      unmerged: GitConflict[] = [],
      kind: GitMergePlan['kind'];
    if (ancestor(id, ours, target)) {
      desired = await git.tree(id, target);
      stage0 = desired;
      next = target;
      kind = 'fast-forward';
    } else {
      let output: string;
      try {
        output = run(id, ['merge-tree', '--write-tree', ours, target]);
      } catch (error) {
        const result = error as { status?: number; stdout?: string };
        if (result.status !== 1 || !result.stdout) throw error;
        output = result.stdout;
      }
      const [tree, ...lines] = output.split('\n');
      desired = Object.create(null);
      for (const entry of run(id, ['ls-tree', '-rz', tree]).split('\0').filter(Boolean)) {
        const match = /^(\d+) \w+ ([a-f0-9]+)\t(.+)$/.exec(entry)!;
        desired[match[3]] = { revision: match[2], mode: Number.parseInt(match[1], 8) };
      }
      const grouped = new Map<string, GitConflict>();
      for (const line of lines) {
        if (!line) break;
        const match = /^(\d+) ([a-f0-9]+) ([123])\t(.+)$/.exec(line)!;
        const path = match[4],
          value = grouped.get(path) ?? { path, base: null, ours: null, theirs: null };
        const key = ({ 1: 'base', 2: 'ours', 3: 'theirs' } as const)[Number(match[3]) as 1 | 2 | 3];
        value[key] = { path, oid: match[2], mode: Number.parseInt(match[1], 8) };
        grouped.set(path, value);
      }
      unmerged = [...grouped.values()];
      stage0 = { ...desired };
      for (const conflict of unmerged) delete stage0[conflict.path];
      kind = unmerged.length ? 'conflicts' : 'merged';
      if (!unmerged.length) next = await git.mergeCommit(id, stage0, [ours, target], message);
    }
    const before = await git.tree(id, ours),
      current = await git.workingTree(id);
    const paths = [...new Set([...Object.keys(before), ...Object.keys(desired)])];
    return {
      kind,
      index: { entries: stage0, conflicts: unmerged },
      ...(unmerged.length ? { baseOid: run(id, ['merge-base', ours, target]).trim() } : {}),
      changes: paths
        .filter(path => !sameEntry(current[path], desired[path]))
        .map(path => ({ path, before: current[path] ?? null, after: desired[path] ?? null })),
      stateAfter: {
        ...state,
        ORIG_HEAD: ours + '\n',
        ...(unmerged.length
          ? { MERGE_HEAD: target + '\n', MERGE_MSG: message, MERGE_MODE: '' }
          : {}),
      },
      ...(next ? { headAfter: { branch, oid: next } } : {}),
    };
  };
  git.status = async id => {
    const head = await git.head(id),
      branch = await git.branch(id),
      committed = await git.tree(id, head),
      index = await git.indexState(id),
      working = await git.workingTree(id);
    const change = (a: unknown, b: unknown) =>
      !a ? ('added' as const) : !b ? ('deleted' as const) : ('modified' as const);
    const files = [
      ...new Set([
        ...Object.keys(committed),
        ...Object.keys(index.entries),
        ...Object.keys(working),
        ...index.conflicts.map(conflict => conflict.path),
      ]),
    ].flatMap(path => {
      const cf = index.conflicts.some(conflict => conflict.path === path),
        a = committed[path],
        b = index.entries[path],
        c = working[path];
      return !cf && sameEntry(a, b) && sameEntry(b, c)
        ? []
        : [
            {
              path,
              headRevision: a?.revision ?? null,
              indexRevision: b?.revision ?? null,
              workingRevision: c?.revision ?? null,
              conflict: cf,
              ...(sameEntry(a, b) ? {} : { staged: change(a, b) }),
              ...(sameEntry(b, c) ? {} : { unstaged: change(b, c) }),
            },
          ];
    });
    return {
      head,
      branch,
      state: (await git.repositoryInfo(id)).state,
      files,
      indexRevision: await git.revision(Buffer.from(JSON.stringify(index))),
      workingRevision: await git.revision(Buffer.from(JSON.stringify(working))),
    };
  };
  const id = project.id;
  const save = async (path: string, text: string) => {
    const file = (await git.workingTree(id, [path]))[path];
    await workspace.writeText(id, path, Buffer.from(text), file?.revision ?? null);
  };
  const commit = async (paths: string[]) => {
    const status = await workspace.status(id);
    await workspace.stage(id, paths, {
      ...status,
      revisions: Object.fromEntries(status.files.map(file => [file.path, file.workingRevision])),
    });
    return workspace.commitStaged(id, 'fixture', await workspace.status(id));
  };
  await save('a.txt', 'base-a\n');
  await save('b.txt', 'base-b\n');
  const base = await commit(['a.txt', 'b.txt']);
  const theirs = await git.tree(id, base);
  theirs['a.txt'] = {
    revision: await git.writeBlob(id, Buffer.from('theirs-a\n')),
    mode: gitModes.file,
  };
  const source = await git.mergeCommit(id, theirs, [base], 'source');
  await workspace.gitCommand(
    id,
    { method: 'branchCreate', name: 'feature', ref: source },
    await workspace.status(id),
  );
  await save('a.txt', 'ours-a\n');
  const ours = await commit(['a.txt']);
  return { ...f, workspace, git, project, source, ours, base, save, commit };
}
