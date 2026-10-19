import type { GitStatus } from '@/core/git/contracts';
import type { RunView } from '@/core/runs/queries';
import type { Version } from '@/core/git/types';
import type { ActionContext, EditorDocument, Review } from '@/features/workbench/types';
import { fileName } from '@/shared/format';
import type {
  GitRepositoryCommand,
  GitCredentialInput,
  GitTransferState,
} from '@/core/git/repository';
import { useCallback, useSyncExternalStore } from 'react';

interface GitContext extends ActionContext {
  gitStatus?: GitStatus;
  dirty: boolean;
  review?: Review;
  setReview(value?: Review): void;
  setEditor(value?: EditorDocument): void;
  guard(next: () => void): void;
}

export function useGitActions(context: GitContext) {
  const {
    runtime,
    ui,
    action,
    refresh,
    setError,
    setNotice,
    setConfirmation,
    gitStatus,
    dirty,
    review,
    setReview,
    setEditor,
    guard,
  } = context;
  const projectId = ui.projectId;
  const transfer = useSyncExternalStore(
    useCallback(
      (notify: () => void) =>
        runtime
          ? runtime.workspace.subscribeGitTransfer(value => {
              if (value.projectId === projectId) notify();
            })
          : () => {},
      [runtime, projectId],
    ),
    useCallback(
      (): GitTransferState | undefined =>
        projectId ? runtime?.workspace.gitTransfer(projectId) : undefined,
      [runtime, projectId],
    ),
    () => undefined,
  );
  const cancelTransfer = () => {
    if (runtime && projectId) runtime.workspace.cancelGitTransfer(projectId);
  };
  async function saveCredential(name: string, url: string, input: GitCredentialInput | null) {
    if (!runtime || !projectId) return;
    let saved = false;
    await action(async () => {
      await runtime.workspace.saveGitCredential(projectId, name, url, input);
      await refresh(projectId);
      setNotice(input ? 'Git 认证已保存。' : 'Git 认证已移除。');
      saved = true;
    });
    return saved;
  }
  async function reviewTask(task: RunView, path?: string) {
    if (!runtime) return;
    await action(async () => {
      const head = await runtime.workspace.head(task.projectId);
      const scoped = await runtime.workspace.taskChanges(task.id);
      setReview({
        title: '任务的文件变化',
        files: scoped,
        task,
        initialPath: path,
        restoreRef: scoped.length ? (task.baseSnapshot ?? task.baseCommit) : undefined,
        expectedHead: head,
      });
    });
  }

  async function reviewVersion(version: Version) {
    if (!runtime || !ui.projectId) return;
    guard(() => {
      void action(async () => {
        const head = await runtime.workspace.head(ui.projectId!);
        const value = await runtime.workspace.changes(
          ui.projectId!,
          version.parents[0],
          version.oid,
        );
        setReview({
          title: '版本 · ' + version.message.split('\n')[0],
          files: value,
          restoreRef: version.oid !== head ? version.oid : undefined,
          expectedHead: head,
        });
      });
    });
  }

  function confirmRestore() {
    if (!runtime || !ui.projectId || !review?.restoreRef || !review.expectedHead) return;
    if (dirty) {
      setError('请先保存或关闭正在编辑的文件，再恢复版本。');
      return;
    }
    const value = review;
    setConfirmation({
      title: value.task ? '撤销这次任务的修改？' : '恢复这个版本？',
      description: value.task
        ? '将恢复本任务涉及文件及其暂存状态。已有提交历史保留；后续冲突会阻止撤销。'
        : '将这个提交的完整内容恢复到工作区。请先处理未提交更改，恢复后可自行暂存并提交。',
      label: '确认恢复',
      perform: async () => {
        if (value.task) await runtime.workspace.undoTask(value.task.id);
        else await runtime.workspace.restore(ui.projectId!, value.restoreRef!, value.expectedHead!);
        setReview(undefined);
        setEditor(undefined);
        await refresh(ui.projectId);
        setNotice('内容已恢复，历史记录已保留。');
      },
    });
  }

  async function reviewGit(area: 'staged' | 'unstaged', paths?: string[]) {
    if (!runtime || !ui.projectId) return;
    await action(async () =>
      setReview({
        title: area === 'staged' ? '已暂存的更改' : '未暂存的更改',
        area,
        files: await runtime.workspace.diff(ui.projectId!, area, paths),
      }),
    );
  }

  async function changeStage(paths: string[], stage: boolean) {
    if (!runtime || !ui.projectId || !gitStatus) return;
    if (dirty) {
      setError('请先保存或关闭编辑器中的修改。');
      return;
    }
    const expected = gitStatus;
    await action(async () => {
      if (stage)
        await runtime.workspace.stage(ui.projectId!, paths, {
          ...expected,
          revisions: Object.fromEntries(
            expected.files
              .filter(file => paths.includes(file.path))
              .map(file => [file.path, file.workingRevision]),
          ),
        });
      else await runtime.workspace.unstage(ui.projectId!, paths, expected);
      await refresh(ui.projectId);
    });
  }

  async function commitGit(message: string) {
    if (!runtime || !ui.projectId || !gitStatus) return;
    if (dirty) {
      setError('请先保存或关闭编辑器中的修改。');
      return;
    }
    const projectId = ui.projectId;
    const expected = gitStatus;
    await action(async () => {
      await runtime.workspace.commitStaged(projectId, message, expected);
      ui.setCommitDraft(projectId, '');
      await refresh(projectId);
      setNotice('已提交暂存更改。');
    });
  }

  function discardGit(path: string) {
    if (!runtime || !ui.projectId || !gitStatus) return;
    if (dirty) {
      setError('请先保存或关闭编辑器中的修改。');
      return;
    }
    const projectId = ui.projectId;
    const expected = gitStatus;
    setConfirmation({
      title: '丢弃 ' + fileName(path) + ' 的未暂存更改？',
      description: '将恢复为暂存区内容。未跟踪文件会被移除。',
      label: '丢弃更改',
      danger: true,
      perform: async () => {
        await runtime.workspace.discard(projectId, [path], expected);
        await refresh(projectId);
        setNotice('已丢弃未暂存更改。');
      },
    });
  }
  async function performRepositoryCommand(command: GitRepositoryCommand) {
    if (!runtime || !ui.projectId || !gitStatus) return;
    if (dirty) {
      setError('请先保存或放弃编辑器中的修改。');
      return;
    }
    const projectId = ui.projectId;
    setNotice('');
    const result = await runtime.workspace
      .gitCommand(projectId, command, gitStatus)
      .catch(async error => {
        // Failed network commands may still have changed refs or created a pending push receipt.
        await refresh(projectId).catch(() => {});
        throw error;
      });
    if (command.method === 'checkout') setEditor(undefined);
    await refresh(projectId);
    setNotice(
      result?.verification
        ? result.verification.matched
          ? '已确认远程分支指向这次推送的提交。'
          : '核对完成：远程分支当前为 ' +
            (result.verification.actual?.slice(0, 12) ?? '不存在') +
            '，与推送目标不同。'
        : 'Git 操作已完成。',
    );
  }
  async function repositoryCommand(command: GitRepositoryCommand) {
    await action(() => performRepositoryCommand(command));
  }
  function confirmRepositoryCommand(
    command: Extract<GitRepositoryCommand, { method: 'branchDelete' | 'tagDelete' }>,
  ) {
    setConfirmation({
      title: `删除${command.method === 'branchDelete' ? '分支' : '标签'} ${command.name}？`,
      description:
        command.method === 'branchDelete'
          ? '只允许删除已经合入当前分支的本地分支。'
          : '删除这个标签引用。',
      label: '确认删除',
      danger: true,
      perform: () => performRepositoryCommand(command),
    });
  }
  return {
    transfer: transfer?.projectId === projectId ? transfer : undefined,
    cancelTransfer,
    saveCredential,
    reviewTask,
    reviewVersion,
    confirmRestore,
    reviewGit,
    changeStage,
    commitGit,
    discardGit,
    repositoryCommand,
    confirmRepositoryCommand,
  };
}
