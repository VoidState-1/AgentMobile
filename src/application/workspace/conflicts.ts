import { AppError } from '@/core/errors';
import { safePath } from '@/core/workspace/path';
import {
  gitModes,
  sameEntry,
  assertTreeShape,
  cloneTree,
  type GitEntry,
  type GitTree,
} from '@/core/git/objects';
import type { GitConflictChoice } from '@/core/git/merge';
import type { GitConflict } from '@/core/git/repository';
import type { GitConflictPreview, FilePreview } from '@/application/services';
import type { WorkspaceContext } from './context';
import type { MutationCoordinator } from './mutations';
import type { GitService } from './git';
import { previewContent } from './content';

export interface ConflictScope {
  kind: 'merge' | 'rebase';
  base: string | null;
  ours: string | null;
  theirs: string;
  paths: string[];
  artifacts: string[];
}
export const related = (left: string, right: string) =>
  left === right || left.startsWith(right + '/') || right.startsWith(left + '/');
export const indexChanges = (before: GitTree, after: GitTree) =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(path => !sameEntry(before[path], after[path]))
    .map(path => ({ path, before: before[path] ?? null, after: after[path] ?? null }));

/** Callers hold the project queue and validate the owning merge/rebase session. */
export class ConflictService {
  constructor(
    private readonly context: WorkspaceContext,
    private readonly mutations: MutationCoordinator,
    private readonly versions: GitService,
  ) {}
  async preview(
    projectId: string,
    path: string,
    scope: ConflictScope,
  ): Promise<GitConflictPreview> {
    safePath(path);
    const index = await this.context.git.indexState(projectId);
    const conflict = index.conflicts.find(value => value.path === path);
    if (!conflict) throw new AppError('CONFLICT', '该路径已不再有冲突，请刷新。');
    const working = await this.context.git.workingTree(projectId, [path]);
    const view = async (entry: GitEntry | undefined): Promise<FilePreview | null> => {
      if (!entry) return null;
      if (entry.mode === gitModes.gitlink)
        return {
          kind: 'binary',
          mimeType: 'application/octet-stream',
          content: '',
          revision: entry.revision,
          size: 0,
          mode: entry.mode,
          unavailableReason: '子模块提交',
        };
      const size = (await this.context.git.blobInfo(projectId, entry.revision)).size;
      if (size > 2 * 1024 * 1024)
        return {
          kind: 'binary',
          mimeType: 'application/octet-stream',
          content: '',
          revision: entry.revision,
          size,
          mode: entry.mode,
          unavailableReason: '文件较大，请选择版本或导出后处理。',
        };
      return {
        ...previewContent(
          path,
          await this.context.git.blob(projectId, entry.revision),
          this.context.codec,
        ),
        revision: entry.revision,
        size,
        mode: entry.mode,
      };
    };
    const side = (entry: GitConflict['ours']) =>
      view(entry ? { revision: entry.oid, mode: entry.mode } : undefined);
    const [base, ours, theirs, result] = await Promise.all([
      side(conflict.base),
      side(conflict.ours),
      side(conflict.theirs),
      view(working[path]),
    ]);
    return {
      status: await this.versions.statusValue(projectId),
      projectId,
      path,
      conflict,
      base,
      ours,
      theirs,
      working: result,
      relatedPaths: scope.paths.filter(
        candidate =>
          related(candidate, path) ||
          (scope.artifacts.includes(candidate) && candidate.startsWith(path + '~')),
      ),
    };
  }
  async resolve(
    projectId: string,
    path: string,
    choice: GitConflictChoice,
    scope: ConflictScope,
  ): Promise<void> {
    safePath(path);
    if (!['ours', 'theirs', 'base', 'delete', 'working'].includes(choice))
      throw new AppError('VALIDATION', '冲突解决方式无效。');
    const index = await this.context.git.indexState(projectId);
    const conflict = index.conflicts.find(value => value.path === path);
    if (!conflict) throw new AppError('CONFLICT', '该路径已不再有冲突。');
    const id = this.context.id(),
      working = await this.context.git.workingTree(projectId);
    const key = scope.kind + 's/' + id;
    const attrs = await this.context.git.checkpoint(
      projectId,
      working,
      key + '/attributes',
      scope.ours,
    );
    const cleared = index.conflicts.filter(value => related(value.path, path));
    const artifacts = scope.artifacts.filter(artifact =>
      cleared.some(value => artifact.startsWith(value.path + '~')),
    );
    const affected = [
      ...new Set([
        ...scope.paths.filter(candidate => related(candidate, path)),
        ...artifacts,
        path,
      ]),
    ];
    const desiredEntries = cloneTree(index.entries);
    let raw: GitTree;
    for (const candidate of Object.keys(desiredEntries))
      if (related(candidate, path)) delete desiredEntries[candidate];
    if (choice === 'working') {
      raw = cloneTree(
        Object.fromEntries(
          Object.entries(working).filter(
            ([candidate]) => affected.includes(candidate) && !artifacts.includes(candidate),
          ),
        ),
      );
    } else {
      if (choice !== 'delete') {
        const selected = await this.context.git.tree(projectId, scope[choice]);
        for (const [candidate, entry] of Object.entries(selected)) {
          if (!related(candidate, path)) continue;
          if (entry.mode === gitModes.gitlink)
            throw new AppError('VALIDATION', '子模块冲突需要单独管理。');
          desiredEntries[candidate] = entry;
        }
        if (choice === 'base')
          for (const item of cleared) {
            delete desiredEntries[item.path];
            if (item.base)
              desiredEntries[item.base.path] = { revision: item.base.oid, mode: item.base.mode };
          }
      }
      raw = await this.context.git.filterEntries(
        projectId,
        Object.fromEntries(
          Object.entries(desiredEntries).filter(([candidate]) => affected.includes(candidate)),
        ),
        attrs,
        'smudge',
      );
    }
    const targetWorking = cloneTree(working);
    for (const candidate of affected) {
      if (raw[candidate]) targetWorking[candidate] = raw[candidate];
      else delete targetWorking[candidate];
    }
    assertTreeShape(targetWorking);
    const attributes = await this.context.git.checkpoint(
      projectId,
      targetWorking,
      key + '/result',
      scope.ours,
    );
    const clean = await this.context.git.filterEntries(projectId, raw, attributes, 'clean');
    for (const candidate of affected) {
      if (clean[candidate]) desiredEntries[candidate] = clean[candidate];
      else delete desiredEntries[candidate];
    }
    const changes = affected
      .filter(candidate => !sameEntry(working[candidate], raw[candidate]))
      .map(candidate => ({
        path: candidate,
        before: working[candidate] ?? null,
        after: raw[candidate] ?? null,
      }));
    await this.mutations.prepare(
      projectId,
      changes,
      (scope.kind === 'merge' ? '解决合并冲突 ' : '解决变基冲突 ') + path,
      id,
      undefined,
      undefined,
      scope.kind,
      {
        indexChanges: indexChanges(index.entries, desiredEntries),
        conflictsChange: {
          before: index.conflicts,
          after: index.conflicts.filter(value => !cleared.includes(value)),
        },
        completionReceipt: true,
      },
    );
  }
}
