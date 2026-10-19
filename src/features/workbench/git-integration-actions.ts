import { useState } from 'react';
import { AppError } from '@/core/errors';
import type { GitStatus } from '@/core/git/contracts';
import type { GitConflictChoice } from '@/core/git/merge';
import type { GitConflictPreview } from '@/application/services';
import type { ActionContext } from './types';

export function useGitIntegrationActions(
  context: ActionContext & {
    gitStatus?: GitStatus;
    dirty: boolean;
    openFile(path: string): Promise<void>;
  },
) {
  const { runtime, ui, action, refresh, setNotice, setConfirmation, gitStatus, dirty } = context;
  const [storedReview, setConflictReview] = useState<GitConflictPreview>();
  const conflictReview = storedReview?.projectId === ui.projectId ? storedReview : undefined;
  function ready() {
    if (!runtime || !ui.projectId || !gitStatus) throw new AppError('VALIDATION', '请先打开项目。');
    if (dirty) throw new AppError('CONFLICT', '请先保存或放弃编辑器中的修改。');
    return { api: runtime.workspace, id: ui.projectId, expected: gitStatus };
  }
  async function perform(work: () => Promise<unknown>) {
    try {
      return await work();
    } finally {
      await refresh(ui.projectId).catch(() => {});
    }
  }
  const mergeBranch = (name: string, oid: string) =>
    action(async () => {
      const { api, id, expected } = ready();
      const result = await perform(() => api.mergeBranch(id, { name, oid }, expected));
      setNotice(
        result === 'conflicts'
          ? '合并存在冲突，请逐项处理。'
          : result === 'up-to-date'
            ? '当前分支已包含该版本。'
            : '合并已完成。',
      );
    });
  const reviewConflict = (path: string) =>
    action(async () => {
      const { api, id } = ready();
      setConflictReview(await api.conflictPreview(id, path));
    });
  const resolveConflict = (choice: GitConflictChoice) =>
    action(async () => {
      const { api, id } = ready();
      if (!conflictReview) return;
      await perform(() =>
        api.resolveConflict(id, conflictReview.path, choice, conflictReview.status),
      );
      setConflictReview(undefined);
      setNotice('该冲突已解决。');
    });
  const editConflict = async () => {
    if (!conflictReview) return;
    const path = conflictReview.path;
    setConflictReview(undefined);
    await context.openFile(path);
  };
  const continueMerge = () =>
    action(async () => {
      const { api, id, expected } = ready();
      await perform(() => api.continueMerge(id, expected));
      setNotice('合并已提交。');
    });
  function confirmAbortMerge() {
    if (!gitStatus) return;
    const expected = gitStatus;
    setConfirmation({
      title: '中止当前合并？',
      description: '恢复这次合并涉及的文件和暂存状态，放弃这些路径上的合并结果。无关文件保留。',
      label: '中止合并',
      danger: true,
      perform: async () => {
        const { api, id } = ready();
        await perform(() => api.abortMerge(id, expected));
        setConflictReview(undefined);
        setNotice('已中止合并。');
      },
    });
  }
  function confirmRebaseBranch(name: string, oid: string) {
    if (!gitStatus) return;
    const expected = gitStatus;
    setConfirmation({
      title: '变基至 ' + name + '？',
      description: '将当前分支的提交逐个重放到目标分支上，保留作者和说明。重放后的提交 ID 会改变。',
      label: '开始变基',
      perform: async () => {
        const { api, id } = ready();
        const result = await perform(() => api.rebaseBranch(id, { name, oid }, expected));
        setNotice(
          result === 'conflicts'
            ? '变基遇到冲突，请处理后继续或跳过当前提交。'
            : result === 'up-to-date'
              ? '当前分支已在该版本之上。'
              : '变基已完成。',
        );
      },
    });
  }
  const continueRebase = () =>
    action(async () => {
      const { api, id, expected } = ready();
      const result = await perform(() => api.continueRebase(id, expected));
      setNotice(result === 'conflicts' ? '后续提交存在冲突，请继续处理。' : '变基已完成。');
    });
  function confirmRebaseAction(kind: 'skip' | 'abort') {
    if (!gitStatus) return;
    const expected = gitStatus,
      abort = kind === 'abort';
    setConfirmation({
      title: abort ? '中止当前变基？' : '跳过当前提交？',
      description: abort
        ? '恢复变基前的分支和文件，放弃整个变基涉及路径上的修改。无关文件保留。'
        : '放弃当前提交及其冲突解决结果，再重放后续提交。',
      label: abort ? '中止变基' : '跳过当前提交',
      danger: true,
      perform: async () => {
        const { api, id } = ready();
        const result = await perform(() =>
          abort ? api.abortRebase(id, expected) : api.skipRebase(id, expected),
        );
        setConflictReview(undefined);
        setNotice(
          abort
            ? '已中止变基。'
            : result === 'conflicts'
              ? '后续提交存在冲突，请继续处理。'
              : '变基已完成。',
        );
      },
    });
  }
  return {
    conflictReview,
    mergeBranch,
    reviewConflict,
    resolveConflict,
    editConflict,
    continueMerge,
    confirmAbortMerge,
    confirmRebaseBranch,
    continueRebase,
    confirmSkipRebase: () => confirmRebaseAction('skip'),
    confirmAbortRebase: () => confirmRebaseAction('abort'),
    closeConflict: () => setConflictReview(undefined),
  };
}
