import { diffLines } from 'diff';
import { isImage } from '@/core/workspace/path';
import type { FileChangeSummary, ReviewFile } from '@/application/services';

/** Project diff-library results from the task's frozen snapshots into the public summary. */
export function summarizeChanges(files: readonly ReviewFile[]): FileChangeSummary[] {
  return files.map(file => {
    const image = isImage(file.path);
    const counts = image
      ? undefined
      : diffLines(file.before, file.after, { timeout: 25, maxEditLength: 4096 })?.reduce(
          (sum, part) => ({
            added: sum.added + (part.added ? (part.count ?? 0) : 0),
            removed: sum.removed + (part.removed ? (part.count ?? 0) : 0),
          }),
          { added: 0, removed: 0 },
        );
    return {
      path: file.path,
      status: file.status,
      stagedOnly: !!file.stagedOnly,
      image,
      ...counts,
    };
  });
}
