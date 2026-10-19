import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mergeFixture } from './merge-fixture';
import { AppError } from '../src/core/errors';
import { sameEntry, type GitTree } from '../src/core/git/objects';
import type { GitConflict } from '../src/core/git/repository';

/** Git CLI supplies plans for application recovery tests; real libgit2 runs on Android. */
export async function rebaseFixture() {
  const f = await mergeFixture(),
    git = f.git;
  const run = (id: string, args: string[], input?: string, env = {}) =>
    execFileSync('git', args, {
      cwd: f.resolve(git.dir(id)),
      encoding: 'utf8',
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: f.root + '/no-user-config',
        ...env,
      },
    });
  const originalInfo = git.repositoryInfo,
    changeHead = git.changeHead;
  git.repositoryInfo = async id => {
    const info = await originalInfo(id),
      state = await git.gitState(id);
    return {
      ...info,
      state:
        state['rebase-merge/interactive'] !== undefined &&
        state['rebase-merge/interactive'] !== null
          ? 'rebase'
          : info.state,
      capabilities: { ...info.capabilities, rebase: true },
    };
  };
  git.changeHead = async (id, before, after, guard) => {
    if (!guard) return changeHead(id, before, after);
    const actual = { oid: await git.head(id), branch: await git.branch(id) };
    if (JSON.stringify(actual) === JSON.stringify(after)) return;
    if (actual.oid !== before.oid || actual.branch !== before.branch)
      throw new AppError('CONFLICT', 'head changed');
    const ref = 'refs/heads/' + guard.name,
      value = run(id, ['rev-parse', ref]).trim();
    if (value !== guard.oid && value !== after.oid)
      throw new AppError('CONFLICT', 'original branch changed');
    if (value !== after.oid) run(id, ['update-ref', ref, after.oid!, guard.oid]);
    run(id, ['symbolic-ref', 'HEAD', ref]);
  };
  const describe = (id: string, oid: string) => {
    const value = run(id, ['cat-file', 'commit', oid]),
      boundary = value.indexOf('\n\n');
    const header = value.slice(0, boundary),
      author = /^author (.*) <(.*)> (-?\d+) ([+-])(\d\d)(\d\d)$/m.exec(header)!;
    return {
      oid,
      message: value.slice(boundary + 2),
      parent: /^parent ([a-f0-9]+)$/m.exec(header)?.[1] ?? null,
      author: {
        name: author[1],
        email: author[2],
        time: Number(author[3]),
        offset: (author[4] === '-' ? -1 : 1) * (Number(author[5]) * 60 + Number(author[6])),
      },
    };
  };
  git.rebasePlan = async (id, target) => {
    const head = (await git.head(id))!;
    const ancestor = (old: string, next: string) => {
      try {
        run(id, ['merge-base', '--is-ancestor', old, next]);
        return true;
      } catch {
        return false;
      }
    };
    if (head === target || ancestor(target, head))
      return { kind: 'up-to-date', onto: target, commits: [] };
    if (ancestor(head, target)) return { kind: 'fast-forward', onto: target, commits: [] };
    return {
      kind: 'replay',
      onto: target,
      commits: run(id, ['rev-list', '--reverse', '--no-merges', head, '--not', target])
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(oid => describe(id, oid)),
    };
  };
  git.rebaseStep = async (id, commit, current) => {
    const original = describe(id, commit);
    let base = original.parent;
    if (!base) base = await git.checkpoint(id, {}, 'empty/' + randomUUID(), null);
    let output: string;
    try {
      output = run(id, ['merge-tree', '--write-tree', '--merge-base=' + base, current, commit]);
    } catch (error) {
      const result = error as { status?: number; stdout?: string };
      if (result.status !== 1 || !result.stdout) throw error;
      output = result.stdout;
    }
    const [treeOid, ...lines] = output.split('\n');
    const desired: GitTree = Object.create(null);
    for (const row of run(id, ['ls-tree', '-rz', treeOid]).split('\0').filter(Boolean)) {
      const match = /^(\d+) \w+ ([a-f0-9]+)\t(.+)$/.exec(row)!;
      desired[match[3]] = { revision: match[2], mode: Number.parseInt(match[1], 8) };
    }
    const conflicts = new Map<string, GitConflict>();
    for (const row of lines) {
      if (!row) break;
      const match = /^(\d+) ([a-f0-9]+) ([123])\t(.+)$/.exec(row)!;
      const path = match[4],
        value = conflicts.get(path) ?? { path, base: null, ours: null, theirs: null };
      value[(['base', 'ours', 'theirs'] as const)[Number(match[3]) - 1]] = {
        path,
        oid: match[2],
        mode: Number.parseInt(match[1], 8),
      };
      conflicts.set(path, value);
    }
    const entries = Object.assign(Object.create(null), desired);
    for (const path of conflicts.keys()) delete entries[path];
    const before = await git.tree(id, current),
      working = await git.workingTree(id);
    const changes = [...new Set([...Object.keys(before), ...Object.keys(desired)])]
      .filter(path => !sameEntry(before[path], desired[path]))
      .map(path => {
        if (!sameEntry(before[path], working[path]))
          throw new AppError('CONFLICT', 'user edit would be replaced');
        return { path, before: working[path] ?? null, after: desired[path] ?? null };
      });
    return { changes, index: { entries, conflicts: [...conflicts.values()] } };
  };
  git.rebaseCommit = async (id, entries, original, parent) => {
    const old = describe(id, original),
      snapshot = await git.checkpoint(id, entries, 'rebase-test/' + randomUUID(), parent);
    const tree = run(id, ['rev-parse', snapshot + '^{tree}']).trim();
    const oldTree = run(id, ['rev-parse', original + '^{tree}']).trim(),
      originalParentTree = old.parent ? run(id, ['rev-parse', old.parent + '^{tree}']).trim() : '';
    if (
      oldTree !== originalParentTree &&
      tree === run(id, ['rev-parse', parent + '^{tree}']).trim()
    )
      return null;
    const identity = (await git.repositoryInfo(id)).identity;
    const zone =
      (old.author.offset < 0 ? '-' : '+') +
      String(Math.floor(Math.abs(old.author.offset) / 60)).padStart(2, '0') +
      String(Math.abs(old.author.offset) % 60).padStart(2, '0');
    return run(id, ['commit-tree', tree, '-p', parent, '-F', '-'], old.message, {
      GIT_AUTHOR_NAME: old.author.name,
      GIT_AUTHOR_EMAIL: old.author.email,
      GIT_AUTHOR_DATE: '@' + old.author.time + ' ' + zone,
      GIT_COMMITTER_NAME: identity.name,
      GIT_COMMITTER_EMAIL: identity.email,
    }).trim();
  };
  return {
    ...f,
    cli: (...args: string[]) => run(f.project.id, args),
    describe: (oid: string) => describe(f.project.id, oid),
  };
}
