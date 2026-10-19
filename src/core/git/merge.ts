import type { GitTree } from './objects';
import type { GitConflict, GitRefState } from './repository';
import type { FileChange } from '../workspace/types';

export interface GitIndexState {
  entries: GitTree;
  conflicts: GitConflict[];
}
export const gitStateNames = [
  'MERGE_HEAD',
  'MERGE_MSG',
  'MERGE_MODE',
  'ORIG_HEAD',
  'REBASE_HEAD',
  'rebase-merge/interactive',
  'rebase-merge/head-name',
  'rebase-merge/orig-head',
  'rebase-merge/onto',
  'rebase-merge/git-rebase-todo',
  'rebase-merge/done',
  'rebase-merge/msgnum',
  'rebase-merge/end',
  'rebase-merge/stopped-sha',
  'rebase-merge/message',
  'rebase-merge/author-script',
  'rebase-merge/rewritten-list',
  'rebase-merge/quiet',
] as const;
export type GitStateFiles = Record<
  'MERGE_HEAD' | 'MERGE_MSG' | 'MERGE_MODE' | 'ORIG_HEAD',
  string | null
> &
  Partial<Record<(typeof gitStateNames)[number], string | null>>;
export interface GitMergePlan {
  kind: 'up-to-date' | 'fast-forward' | 'merged' | 'conflicts';
  changes: FileChange[];
  index: GitIndexState;
  baseOid?: string;
  headAfter?: GitRefState;
  stateAfter: GitStateFiles;
}
export interface GitMergeSessionInfo {
  id: string;
  sourceName: string;
  sourceOid: string;
}
export type GitConflictChoice = 'ours' | 'theirs' | 'base' | 'delete' | 'working';
export function sameConflicts(
  left: readonly GitConflict[],
  right: readonly GitConflict[],
): boolean {
  const canonical = (values: readonly GitConflict[]) =>
    JSON.stringify(
      values
        .map(value => [
          value.path,
          ...[value.base, value.ours, value.theirs].map(entry =>
            entry ? [entry.path, entry.oid, entry.mode] : null,
          ),
        ])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
  return canonical(left) === canonical(right);
}
