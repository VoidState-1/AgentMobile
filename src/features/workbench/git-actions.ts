import type { GitStatus } from '@/core/git/contracts';
import type { RunView } from '@/core/runs/queries';
import type { Version } from '@/core/git/types';
import type { ActionContext, EditorDocument, Review } from '@/features/workbench/types';
import { fileName } from '@/shared/format';

interface GitContext extends ActionContext {
  gitStatus?: GitStatus; dirty: boolean; review?: Review;
  setReview(value?: Review): void; setEditor(value?: EditorDocument): void; guard(next: () => void): void;
}

export function useGitActions(context: GitContext) {
  const { runtime, ui, action, refresh, setError, setNotice, setConfirmation, gitStatus, dirty, review, setReview, setEditor, guard } = context;
  async function reviewTask(task: RunView) {
    if (!runtime) return;
    await action(async () => {
      const head = await runtime.workspace.head(task.projectId);
      const scoped = await runtime.workspace.taskChanges(task.id);
      setReview({ title: '任务的文件变化', files: scoped, task,
        restoreRef: scoped.length ? task.baseSnapshot ?? task.baseCommit : undefined, expectedHead: head });
    });
  }

  async function reviewVersion(version: Version) {
    if (!runtime || !ui.projectId) return;
    guard(() => { void action(async () => {
      const head = await runtime.workspace.head(ui.projectId!);
      const value = await runtime.workspace.changes(ui.projectId!, version.parentOid, version.oid);
      setReview({ title: '版本 · ' + version.message.split('\n')[0], files: value,
        restoreRef: version.oid !== head ? version.oid : undefined, expectedHead: head });
    }); });
  }

  function confirmRestore() {
    if (!runtime || !ui.projectId || !review?.restoreRef || !review.expectedHead) return;
    if (dirty) { setError('请先保存或关闭正在编辑的文件，再恢复版本。'); return; }
    const value = review;
    setConfirmation({
      title: value.task ? '撤销这次任务的修改？' : '恢复这个版本？',
      description: value.task ? '将恢复本任务涉及文件及其暂存状态。已有提交历史保留；后续冲突会阻止撤销。' : '将这个提交的完整内容恢复到工作区。请先处理未提交更改，恢复后可自行暂存并提交。', label: '确认恢复',
      perform: async () => {
        if (value.task) await runtime.workspace.undoTask(value.task.id);
        else await runtime.workspace.restore(ui.projectId!, value.restoreRef!, value.expectedHead!);
        setReview(undefined); setEditor(undefined); await refresh(ui.projectId); setNotice('内容已恢复，历史记录已保留。');
      },
    });
  }

  async function reviewGit(area: 'staged' | 'unstaged', paths?: string[]) {
    if (!runtime || !ui.projectId) return;
    await action(async () => setReview({ title: area === 'staged' ? '已暂存的更改' : '未暂存的更改', area, files: await runtime.workspace.diff(ui.projectId!, area, paths) }));
  }

  async function changeStage(paths: string[], stage: boolean) {
    if (!runtime || !ui.projectId || !gitStatus) return;
    if (dirty) { setError('请先保存或关闭编辑器中的修改。'); return; }
    const expected = gitStatus;
    await action(async () => {
      if (stage) await runtime.workspace.stage(ui.projectId!, paths, { ...expected, revisions: Object.fromEntries(expected.files.filter((file) => paths.includes(file.path)).map((file) => [file.path, file.workingRevision])) });
      else await runtime.workspace.unstage(ui.projectId!, paths, expected);
      await refresh(ui.projectId);
    });
  }

  async function commitGit(message: string) {
    if (!runtime || !ui.projectId || !gitStatus) return;
    if (dirty) { setError('请先保存或关闭编辑器中的修改。'); return; }
    const projectId = ui.projectId; const expected = gitStatus;
    await action(async () => { await runtime.workspace.commitStaged(projectId, message, expected); ui.setCommitDraft(projectId, ''); await refresh(projectId); setNotice('已提交暂存更改。'); });
  }

  function discardGit(path: string) {
    if (!runtime || !ui.projectId || !gitStatus) return;
    if (dirty) { setError('请先保存或关闭编辑器中的修改。'); return; }
    const projectId = ui.projectId; const expected = gitStatus;
    setConfirmation({ title: '丢弃 ' + fileName(path) + ' 的未暂存更改？', description: '将恢复为暂存区内容。未跟踪文件会被移除。', label: '丢弃更改', danger: true,
      perform: async () => { await runtime.workspace.discard(projectId, [path], expected); await refresh(projectId); setNotice('已丢弃未暂存更改。'); } });
  }
  return { reviewTask, reviewVersion, confirmRestore, reviewGit, changeStage, commitGit, discardGit };
}
