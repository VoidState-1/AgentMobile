import type { Conversation } from '@/core/conversations/types';
import type { RunView } from '@/core/runs/queries';
import type { useConversationDraft } from '@/features/conversations/use-draft';
import { useCallback, useState, useSyncExternalStore } from 'react';
import type { GitCloneInput, GitCredentialInput } from '@/core/git/repository';
import type { ActionContext, EditorSession, WorkbenchSheet } from './types';

interface NavigationContext extends ActionContext {
  draft: Pick<ReturnType<typeof useConversationDraft>, 'flushDraft' | 'installConversation'>;
  setEditor: EditorSession['setEditor'];
  guard(next: () => void): void;
  setSheet(value?: WorkbenchSheet): void;
  active?: RunView;
}

/** Project and conversation navigation owns draft handoff and the project drawer. */
export function useProjectNavigation(context: NavigationContext) {
  const {
    runtime,
    ui,
    action,
    refresh,
    setError,
    setNotice,
    setConfirmation,
    setEditor,
    guard,
    setSheet,
    active,
    draft,
  } = context;
  const { flushDraft, installConversation } = draft;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [conversationName, setConversationName] = useState('');
  const [conversationToRename, setConversationToRename] = useState<string>();
  const transfer = useSyncExternalStore(
    useCallback(
      (notify: () => void) =>
        runtime ? runtime.workspace.subscribeGitTransfer(() => notify()) : () => {},
      [runtime],
    ),
    useCallback(() => runtime?.workspace.gitTransfer(), [runtime]),
    () => undefined,
  );
  const cloneTransfer = transfer?.method === 'clone' ? transfer : undefined;
  const cancelClone = () => {
    if (cloneTransfer?.state === 'running')
      runtime?.workspace.cancelGitTransfer(cloneTransfer.projectId);
  };
  async function cloneProject(input: GitCloneInput, credential?: GitCredentialInput) {
    if (!runtime) return;
    await action(async () => {
      await flushDraft();
      const created = await runtime.workspace.cloneProject(input, credential);
      const conversation = await runtime.conversations.ensureProject(created.id);
      installConversation(conversation);
      setEditor(undefined);
      setSheet(undefined);
      setProjectName('');
      ui.selectProject(created.id, conversation.id);
      await refresh(created.id);
      setNotice('仓库已克隆。');
    });
  }
  async function selectConversation(
    id: string,
    projectId = ui.projectId,
    navigateToConversation = true,
  ) {
    const select = () =>
      action(async () => {
        if (!runtime || !projectId) return;
        await flushDraft();
        if (runtime.conversations.getSnapshot().selected[projectId] !== id)
          await runtime.conversations.select(id, projectId);
        const conversation = runtime.conversations
          .getSnapshot()
          .conversations.find(item => item.id === id)!;
        installConversation(conversation);
        if (projectId !== ui.projectId) {
          setEditor(undefined);
          ui.selectProject(projectId, id, navigateToConversation);
        } else ui.selectConversation(id, navigateToConversation);
        setSheet(undefined);
        if (navigateToConversation) setDrawerOpen(false);
        setError('');
      });
    if (projectId !== ui.projectId)
      guard(() => {
        void select();
      });
    else await select();
  }
  async function newConversation(projectId = ui.projectId) {
    const create = () =>
      action(async () => {
        if (!runtime || !projectId) return;
        await flushDraft();
        const conversation = await runtime.conversations.create(projectId);
        installConversation(conversation);
        if (projectId !== ui.projectId) {
          setEditor(undefined);
          ui.selectProject(projectId, conversation.id);
        } else ui.selectConversation(conversation.id);
        setSheet(undefined);
        setDrawerOpen(false);
      });
    if (projectId !== ui.projectId)
      guard(() => {
        void create();
      });
    else await create();
  }
  function startRenameConversation(conversation: Conversation) {
    setDrawerOpen(false);
    setConversationToRename(conversation.id);
    setConversationName(conversation.title);
    setSheet('conversation-name');
  }
  async function renameConversation() {
    await action(async () => {
      if (!runtime || !conversationToRename) return;
      await runtime.conversations.rename(conversationToRename, conversationName);
      setSheet(undefined);
      setNotice('对话名称已保存。');
    });
  }
  async function saveConversationTitle(conversation: Conversation, title: string) {
    return action(async () => {
      if (!runtime) return;
      await runtime.conversations.rename(conversation.id, title);
    });
  }
  function archiveConversation(conversation: Conversation) {
    setDrawerOpen(false);
    setConfirmation({
      title: '归档“' + conversation.title + '”？',
      description: '归档后保留消息和草稿，可在已归档列表恢复。',
      label: '归档对话',
      perform: async () => {
        if (!runtime || !ui.projectId) return;
        await flushDraft();
        await runtime.conversations.archive(conversation.id);
        if (ui.conversationId === conversation.id) {
          const selected = await runtime.conversations.ensureProject(ui.projectId);
          installConversation(selected);
          ui.selectConversation(selected.id);
        }
        setSheet(undefined);
        setNotice('对话已归档。');
      },
    });
  }
  async function restoreConversation(conversation: Conversation, navigateToConversation = true) {
    const restore = () =>
      action(async () => {
        if (!runtime) return;
        await flushDraft();
        await runtime.conversations.restore(conversation.id);
        installConversation(conversation);
        if (conversation.projectId !== ui.projectId) setEditor(undefined);
        ui.selectProject(conversation.projectId, conversation.id, navigateToConversation);
        setSheet(undefined);
        if (navigateToConversation) setDrawerOpen(false);
        setNotice('对话已恢复。');
      });
    if (conversation.projectId !== ui.projectId)
      guard(() => {
        void restore();
      });
    else await restore();
  }
  function returnToActiveConversation(target = active) {
    if (!target?.conversationId) return;
    if (target.projectId === ui.projectId) {
      void selectConversation(target.conversationId);
      return;
    }
    guard(() => {
      void action(async () => {
        if (!runtime || !target.conversationId) return;
        await flushDraft();
        await runtime.conversations.select(target.conversationId, target.projectId);
        const conversation = runtime.conversations
          .getSnapshot()
          .conversations.find(item => item.id === target.conversationId)!;
        installConversation(conversation);
        setEditor(undefined);
        ui.selectProject(target.projectId, target.conversationId);
      });
    });
  }

  async function createProject() {
    if (!runtime || !projectName.trim()) return;
    await action(async () => {
      await flushDraft();
      const created = await runtime.workspace.create(projectName);
      const conversation = await runtime.conversations.ensureProject(created.id);
      installConversation(conversation);
      setEditor(undefined);
      setSheet(undefined);
      setProjectName('');
      ui.selectProject(created.id, conversation.id);
      await refresh(created.id);
    });
  }

  function newProject() {
    guard(() => {
      setDrawerOpen(false);
      setEditor(undefined);
      setProjectName('');
      setSheet('create');
    });
  }

  return {
    drawerOpen,
    setDrawerOpen,
    projectName,
    setProjectName,
    conversationName,
    setConversationName,
    selectConversation,
    newConversation,
    startRenameConversation,
    renameConversation,
    saveConversationTitle,
    archiveConversation,
    restoreConversation,
    returnToActiveConversation,
    createProject,
    cloneProject,
    cloneTransfer,
    cancelClone,
    newProject,
  };
}
