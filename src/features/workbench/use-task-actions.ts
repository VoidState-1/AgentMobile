import type { WorkspaceOperationSummary } from '@/application/services';
import type { RunView } from '@/core/runs/queries';
import { isImage } from '@/core/workspace/path';
import type { useConversationDraft } from '@/features/conversations/use-draft';
import type { ActionContext, Review } from './types';

interface TaskContext extends Pick<
  ActionContext,
  'runtime' | 'ui' | 'action' | 'setError' | 'setConfirmation'
> {
  draft: Pick<ReturnType<typeof useConversationDraft>, 'composerRef' | 'flushDraft' | 'clear'>;
  prompt: string;
  conversationActive?: RunView;
  active?: RunView;
  dirty: boolean;
  persistEditor(): Promise<void>;
  operations: WorkspaceOperationSummary[];
  setReview(value: Review): void;
}

/** Task submission keeps the persisted draft revision and editor guard together. */
export function useTaskActions(context: TaskContext) {
  const {
    runtime,
    ui,
    draft,
    prompt,
    conversationActive,
    active,
    dirty,
    persistEditor,
    action,
    setError,
    setConfirmation,
    setReview,
    operations,
  } = context;
  async function beginTask() {
    if (!runtime || !ui.projectId || !ui.conversationId || !prompt.trim() || conversationActive)
      return;
    ui.selectTab('agent');
    const submitted = draft.composerRef.current;
    const saved = await draft.flushDraft(submitted);
    if (submitted.conversationId !== ui.conversationId)
      throw new Error('对话已切换，请确认当前输入后发送。');
    const projectId = ui.projectId;
    const text =
      submitted.text.trim() + (submitted.attachment ? '\n\n参考文件：' + submitted.attachment : '');
    await runtime.agent.start(
      projectId,
      text,
      !!submitted.attachment && isImage(submitted.attachment),
      ui.conversationId,
      saved?.revision,
    );
    if (draft.composerRef.current === submitted) {
      draft.clear();
    }
  }

  async function submit() {
    if (dirty) {
      setConfirmation({
        title: '先保存修改再发送？',
        description: 'Agent 将基于最新的资料执行任务。先保存正在编辑的文件。',
        label: '保存并发送',
        perform: async () => {
          await persistEditor();
          await beginTask();
        },
      });
      return;
    }
    await action(beginTask);
  }

  async function reviewProposal(rootId: string, proposalId: string) {
    if (!runtime?.proposals) return;
    await action(async () => {
      const value = await runtime.proposals!.preview(rootId, proposalId);
      const state = {
        draft: '编辑中',
        ready: '待合入',
        conflicted: '存在冲突',
        applying: '合入中',
        applied: '已合入',
        cancelled: '已停止',
        interrupted: '已中断',
      }[value.state];
      setReview({
        title: '隔离写作提案 · ' + state,
        files: value.files,
        description: '输入基线与候选内容 · 合入由主 Agent 执行',
      });
    });
  }
  const changedPaths = (task: RunView) =>
    task.changedPaths ?? [
      ...new Set(
        operations
          .filter(operation => operation.ownerRootRunId === task.id)
          .flatMap(operation => operation.changedPaths),
      ),
    ];

  function stop() {
    void Promise.resolve(runtime?.agent.cancel(conversationActive?.id ?? active?.id)).catch(() =>
      setError('停止状态保存失败，请重新打开应用恢复。'),
    );
  }
  function cancelChild(id: string) {
    void Promise.resolve(runtime?.agent.cancel(id)).catch(() =>
      setError('子任务取消状态保存失败，请重新打开应用恢复。'),
    );
  }
  return { submit, reviewProposal, stop, cancelChild, changedPaths };
}
