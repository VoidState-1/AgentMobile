import { useConversationDraft } from '@/features/conversations/use-draft';
import { useWorkbenchData } from './use-workbench-data';
import { useGitActions } from '@/features/workbench/git-actions';
import { useEditorActions } from './editor-actions';
import { useEditorSession } from './use-editor-session';
import type { Confirmation, Review, WorkbenchSheet } from './types';
import type { AppServices } from '@/application/services';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import type { RunView } from '@/core/runs/queries';
import { selectedModelId, selectedModelMode } from '@/core/models/rules';
import type { Conversation } from '@/core/conversations/types';
import { isImage } from '@/core/workspace/path';
import { publicError } from '@/core/errors';
import { useWorkbenchUi } from '@/shared/workbench-state';

function useWorkbenchState() {
  const ui = useWorkbenchUi();
  const router = useRouter();

  const runtimeRef = useRef<AppServices | undefined>(undefined);

  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const editorSession = useEditorSession();
  const { editor, editorRef, setEditor, dirty } = editorSession;
  const [sheet, setSheet] = useState<WorkbenchSheet>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [conversationName, setConversationName] = useState('');
  const [conversationToRename, setConversationToRename] = useState<string>();

  const [review, setReview] = useState<Review>();
  const [confirmation, setConfirmation] = useState<Confirmation>();

  const draft = useConversationDraft(runtimeRef, ui.conversationId, setError);
  const {
    composer,
    composerRef,
    draftSaved,
    draftSaving,
    installConversation,
    setPrompt,
    setAttachment,
    flushDraft,
  } = draft;
  const {
    runtime,
    projects,
    files,
    versions,
    versionCursor,
    versionsBusy,
    loadOlderVersions,
    gitStatus,
    tasks,
    taskCursor,
    historyBusy,
    loadOlderRuns,
    operations,
    configuration,
    conversationState,
    loading,
    projectLoading,
    active,
    runs,
    refresh,
    formatMismatch,
    rebuildData,
  } = useWorkbenchData({ ui, runtimeRef, editorRef, setEditor, installConversation, setError });

  const selectedProject = projects.find(project => project.id === ui.projectId);
  const projectActive = runs.find(run => run.projectId === ui.projectId && run.state !== 'queued');
  const selectedConversation = conversationState.conversations.find(
    item => item.id === ui.conversationId && item.projectId === ui.projectId && !item.archivedAt,
  );
  const conversationActive = runs.find(
    run => run.projectId === ui.projectId && run.conversationId === ui.conversationId,
  );
  const prompt = composer.conversationId === ui.conversationId ? composer.text : '';
  const attachment =
    composer.conversationId === ui.conversationId ? composer.attachment : undefined;
  const modelId = selectedModelId(configuration, ui.projectId, ui.conversationId);
  const selectedModel = configuration.models.find(model => model.id === modelId);
  const selectedConnection = configuration.connections.find(
    connection => connection.id === selectedModel?.connectionId,
  );
  const settings = useMemo(
    () => ({
      mode: selectedModelMode(configuration, ui.conversationId),
      model: selectedModel?.name ?? '选择模型',
      baseUrl: selectedConnection?.baseUrl ?? '',
      imageInput: selectedModel?.parameters.allowImages ?? false,
    }),
    [configuration, ui.conversationId, selectedModel, selectedConnection],
  );
  const modelLabel =
    settings.mode === 'demo'
      ? '演示模式'
      : selectedModel
        ? (selectedConnection?.name ?? '') + ' · ' + selectedModel.name
        : '选择模型';

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (Platform.OS !== 'web' || (!dirty && (draftSaved || (!prompt && !attachment)))) return;
    const handle = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handle);
    return () => window.removeEventListener('beforeunload', handle);
  }, [dirty, draftSaved, prompt, attachment]);

  async function action(work: () => Promise<void>): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
      return true;
    } catch (reason) {
      setError(publicError(reason).message);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function selectConversation(id: string, projectId = ui.projectId) {
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
          ui.selectProject(projectId, id);
        } else ui.selectConversation(id);
        setSheet(undefined);
        setDrawerOpen(false);
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
  async function restoreConversation(conversation: Conversation) {
    const restore = () =>
      action(async () => {
        if (!runtime) return;
        await flushDraft();
        await runtime.conversations.restore(conversation.id);
        installConversation(conversation);
        if (conversation.projectId !== ui.projectId) setEditor(undefined);
        ui.selectProject(conversation.projectId, conversation.id);
        setSheet(undefined);
        setDrawerOpen(false);
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

  async function beginTask() {
    if (!runtime || !ui.projectId || !ui.conversationId || !prompt.trim() || conversationActive)
      return;
    ui.selectTab('agent');
    const submitted = composerRef.current;
    const saved = await flushDraft(submitted);
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
    if (composerRef.current === submitted) {
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
  function openModelConfig() {
    guard(() => {
      setEditor(undefined);
      setSheet(undefined);
      requestAnimationFrame(() => router.push('/models'));
    });
  }
  function openModels() {
    setSheet('models');
  }
  function openMcpConfig() {
    guard(() => {
      setEditor(undefined);
      setSheet(undefined);
      requestAnimationFrame(() => router.push('/mcp'));
    });
  }
  function openSkills() {
    guard(() => {
      setEditor(undefined);
      setSheet(undefined);
      requestAnimationFrame(() => router.push('/skills'));
    });
  }
  function openAgentSettings() {
    guard(() => {
      setEditor(undefined);
      setSheet(undefined);
      requestAnimationFrame(() => router.push('/settings/agent'));
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

  const editorActions = useEditorActions({
    runtime,
    ui,
    action,
    refresh,
    setError,
    setNotice,
    setConfirmation,
    ...editorSession,
    active: projectActive,
    setSheet,
    setAttachment,
  });
  const {
    persistEditor,
    guard,
    closeEditor,
    openFile,
    newFile,
    importFile,
    deleteEditor,
    renameEditor,
  } = editorActions;
  const {
    reviewTask,
    reviewVersion,
    confirmRestore,
    reviewGit,
    changeStage,
    commitGit,
    discardGit,
  } = useGitActions({
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
  });

  return {
    ...ui,
    runtime,
    projects,
    selectedProject,
    files,
    versions,
    gitStatus,
    reviewGit,
    changeStage,
    commitGit,
    discardGit,
    tasks,
    taskCursor,
    historyBusy,
    loadOlderRuns,
    versionCursor,
    versionsBusy,
    loadOlderVersions,
    active,
    runs,
    projectActive,
    conversationActive,
    allConversations: conversationState.conversations,
    conversationDrafts: conversationState.drafts,
    drawerOpen,
    setDrawerOpen,
    selectedConversation,
    operations,
    loading,
    projectLoading,
    busy,
    formatMismatch,
    rebuildData,
    error,
    notice,
    setError,
    settings,
    configuration,
    modelLabel,
    selectedModel,
    selectedConnection,
    editor,
    setEditor,
    dirty,
    sheet,
    setSheet,
    projectName,
    setProjectName,
    prompt,
    setPrompt,
    attachment,
    setAttachment,
    review,
    setReview,
    conversationName,
    setConversationName,
    draftSaved,
    draftSaving,
    newConversation,
    selectConversation,
    startRenameConversation,
    renameConversation,
    saveConversationTitle,
    archiveConversation,
    restoreConversation,
    returnToActiveConversation,
    confirmation,
    setConfirmation,
    createProject,
    newProject,
    openFile,
    newFile,
    closeEditor,
    importFile,
    submit,
    renameEditor,
    reviewProposal,
    stop: () => {
      void Promise.resolve(runtime?.agent.cancel(conversationActive?.id ?? active?.id)).catch(() =>
        setError('停止状态保存失败，请重新打开应用恢复。'),
      );
    },
    openModelConfig,
    openAgentSettings,
    openMcpConfig,
    openSkills,
    openModels,
    reviewTask,
    reviewVersion,
    confirmRestore,
    deleteEditor,
    saveEditor: () => action(() => persistEditor()),
    action,
    saveAndLeave: async () => {
      const next = confirmation;
      const saved = await action(async () => {
        await persistEditor();
        const latest = editorRef.current;
        if (latest && (latest.text !== latest.savedText || latest.name !== latest.savedName))
          throw new Error('保存期间又有新输入，请再次保存后离开。');
        await next?.perform();
        setConfirmation(undefined);
      });
      if (saved) next?.afterPerform?.();
      return saved;
    },
    confirm: async () => {
      const next = confirmation;
      const done = await action(async () => {
        await next?.perform();
        setConfirmation(undefined);
      });
      if (done) next?.afterPerform?.();
    },
    exportEditor: () =>
      action(async () => {
        if (runtime && editor) await runtime.io.exportFile(editor.projectId, editor.path);
      }),
    changedPaths,
    cancelChild: (id: string) => {
      void Promise.resolve(runtime?.agent.cancel(id)).catch(() =>
        setError('子任务取消状态保存失败，请重新打开应用恢复。'),
      );
    },
  };
}

type WorkbenchState = ReturnType<typeof useWorkbenchState>;
type CommandKey = {
  [K in keyof WorkbenchState]-?: WorkbenchState[K] extends (...args: never[]) => unknown
    ? K
    : never;
}[keyof WorkbenchState];

class CommandBindings {
  readonly commands: Pick<WorkbenchState, CommandKey>;
  constructor(private current: WorkbenchState) {
    this.commands = Object.fromEntries(
      Object.entries(current)
        .filter(([, value]) => typeof value === 'function')
        .map(([key]) => [
          key,
          (...args: unknown[]) => {
            const command = this.current[key as CommandKey] as (...values: unknown[]) => unknown;
            return command(...args);
          },
        ]),
    ) as Pick<WorkbenchState, CommandKey>;
  }
  update(value: WorkbenchState): void {
    this.current = value;
  }
}

function useCommands(state: WorkbenchState): Pick<WorkbenchState, CommandKey> {
  const [bindings] = useState(() => new CommandBindings(state));
  useLayoutEffect(() => {
    bindings.update(state);
  }, [bindings, state]);
  return bindings.commands;
}

export function useWorkbench() {
  const state = useWorkbenchState();
  const commands = useCommands(state);
  const projectActive = !!state.projectActive;
  const editorOpen = !!state.editor;
  const reviewOpen = !!state.review;
  const activitySignature = JSON.stringify(
    state.runs.map(run => ({
      id: run.id,
      projectId: run.projectId,
      conversationId: run.conversationId,
      kind: run.kind,
      state: run.state,
      prompt: run.prompt,
      mode: run.mode,
      createdAt: run.createdAt,
      response: '',
    })),
  );
  // The signature contains every selected field. Streaming text/trace does not
  // change the compact activity indicators or their subscription identity.
  const activity = useMemo(() => JSON.parse(activitySignature) as RunView[], [activitySignature]);
  const conversation = useMemo(
    () => ({
      active: state.active,
      attachment: state.attachment,
      busy: state.busy,
      cancelChild: commands.cancelChild,
      changedPaths: commands.changedPaths,
      conversationActive: state.conversationActive,
      conversationId: state.conversationId,
      draftSaved: state.draftSaved,
      draftSaving: state.draftSaving,
      historyBusy: state.historyBusy,
      loadOlderRuns: commands.loadOlderRuns,
      modelLabel: state.modelLabel,
      openModels: commands.openModels,
      openFile: commands.openFile,
      files: state.files,
      projectActive: projectActive,
      projectLoading: state.projectLoading,
      prompt: state.prompt,
      returnToActiveConversation: commands.returnToActiveConversation,
      reviewProposal: commands.reviewProposal,
      reviewTask: commands.reviewTask,
      runsApi: state.runtime?.runs,
      selectedConversation: state.selectedConversation,
      setAttachment: commands.setAttachment,
      setPrompt: commands.setPrompt,
      setSheet: commands.setSheet,
      settings: state.settings,
      stop: commands.stop,
      submit: commands.submit,
      taskCursor: state.taskCursor,
      tasks: state.tasks,
    }),
    [
      state.active,
      state.attachment,
      state.busy,
      commands.cancelChild,
      commands.changedPaths,
      state.conversationActive,
      state.conversationId,
      state.draftSaved,
      state.draftSaving,
      state.historyBusy,
      commands.loadOlderRuns,
      state.modelLabel,
      commands.openModels,
      commands.openFile,
      state.files,
      projectActive,
      state.projectLoading,
      state.prompt,
      commands.returnToActiveConversation,
      commands.reviewProposal,
      commands.reviewTask,
      state.runtime?.runs,
      state.selectedConversation,
      commands.setAttachment,
      commands.setPrompt,
      commands.setSheet,
      state.settings,
      commands.stop,
      commands.submit,
      state.taskCursor,
      state.tasks,
    ],
  );
  const editor = useMemo(
    () => ({
      busy: state.busy,
      closeEditor: commands.closeEditor,
      confirmation: state.confirmation,
      deleteEditor: commands.deleteEditor,
      dirty: state.dirty,
      editor: state.editor,
      error: state.error,
      exportEditor: commands.exportEditor,
      files: state.files,
      preview: state.runtime?.workspace.preview,
      projectActive: projectActive,
      renameEditor: commands.renameEditor,
      review: state.review,
      saveEditor: commands.saveEditor,
      setEditor: commands.setEditor,
      setSheet: commands.setSheet,
      sheet: state.sheet,
    }),
    [
      state.busy,
      commands.closeEditor,
      state.confirmation,
      commands.deleteEditor,
      state.dirty,
      state.editor,
      state.error,
      commands.exportEditor,
      state.files,
      state.runtime?.workspace.preview,
      projectActive,
      commands.renameEditor,
      state.review,
      commands.saveEditor,
      commands.setEditor,
      commands.setSheet,
      state.sheet,
    ],
  );
  const files = useMemo(
    () => ({
      busy: state.busy,
      gitStatus: state.gitStatus,
      files: state.files,
      importFile: commands.importFile,
      newFile: commands.newFile,
      openFile: commands.openFile,
      openPath: state.editor?.path,
      preview: state.runtime?.workspace.preview,
      projectActive: projectActive,
      projectId: state.projectId,
      projectLoading: state.projectLoading,
    }),
    [
      state.busy,
      state.files,
      commands.importFile,
      state.gitStatus,
      commands.newFile,
      commands.openFile,
      state.editor?.path,
      state.runtime?.workspace.preview,
      projectActive,
      state.projectId,
      state.projectLoading,
    ],
  );
  const git = useMemo(
    () => ({
      busy: state.busy,
      changeStage: commands.changeStage,
      commitDrafts: state.commitDrafts,
      commitGit: commands.commitGit,
      confirmRestore: commands.confirmRestore,
      dirty: state.dirty,
      discardGit: commands.discardGit,
      error: state.error,
      gitStatus: state.gitStatus,
      loadOlderVersions: commands.loadOlderVersions,
      projectActive: projectActive,
      projectId: state.projectId,
      projectLoading: state.projectLoading,
      review: state.review,
      reviewGit: commands.reviewGit,
      reviewVersion: commands.reviewVersion,
      setCommitDraft: commands.setCommitDraft,
      setReview: commands.setReview,
      versionCursor: state.versionCursor,
      versions: state.versions,
      versionsBusy: state.versionsBusy,
    }),
    [
      state.busy,
      commands.changeStage,
      state.commitDrafts,
      commands.commitGit,
      commands.confirmRestore,
      state.dirty,
      commands.discardGit,
      state.error,
      state.gitStatus,
      commands.loadOlderVersions,
      projectActive,
      state.projectId,
      state.projectLoading,
      state.review,
      commands.reviewGit,
      commands.reviewVersion,
      commands.setCommitDraft,
      commands.setReview,
      state.versionCursor,
      state.versions,
      state.versionsBusy,
    ],
  );
  const runs = useMemo(
    () => ({
      busy: state.busy,
      conversationId: state.conversationId,
      projects: state.projects,
      returnToActiveConversation: commands.returnToActiveConversation,
      runs: activity,
    }),
    [
      state.busy,
      state.conversationId,
      state.projects,
      commands.returnToActiveConversation,
      activity,
    ],
  );
  const dialogs = useMemo(
    () => ({
      action: commands.action,
      allConversations: state.allConversations,
      conversationDrafts: state.conversationDrafts,
      appearance: state.appearance,
      archiveConversation: commands.archiveConversation,
      busy: state.busy,
      configuration: state.configuration,
      confirm: commands.confirm,
      confirmation: state.confirmation,
      conversationId: state.conversationId,
      conversationName: state.conversationName,
      drawerOpen: state.drawerOpen,
      createProject: commands.createProject,
      editorOpen: editorOpen,
      error: state.error,
      formatMismatch: state.formatMismatch,
      loading: state.loading,
      modelsApi: state.runtime?.models,
      newConversation: commands.newConversation,
      newProject: commands.newProject,
      notice: state.notice,
      openAgentSettings: commands.openAgentSettings,
      openMcpConfig: commands.openMcpConfig,
      openModelConfig: commands.openModelConfig,
      openSkills: commands.openSkills,
      projectActive: projectActive,
      projectId: state.projectId,
      projectName: state.projectName,
      projects: state.projects,
      rebuildData: commands.rebuildData,
      renameConversation: commands.renameConversation,
      saveConversationTitle: commands.saveConversationTitle,
      restoreConversation: commands.restoreConversation,
      reviewOpen: reviewOpen,
      runs: activity,
      saveAndLeave: commands.saveAndLeave,
      selectConversation: commands.selectConversation,
      selectTab: commands.selectTab,
      selectedConversation: state.selectedConversation,
      selectedProject: state.selectedProject,
      setAppearance: commands.setAppearance,
      setConfirmation: commands.setConfirmation,
      setConversationName: commands.setConversationName,
      setError: commands.setError,
      setDrawerOpen: commands.setDrawerOpen,
      setProjectName: commands.setProjectName,
      setSheet: commands.setSheet,
      sheet: state.sheet,
      startRenameConversation: commands.startRenameConversation,
      tab: state.tab,
    }),
    [
      commands.action,
      state.allConversations,
      state.conversationDrafts,
      state.appearance,
      commands.archiveConversation,
      state.busy,
      state.configuration,
      commands.confirm,
      state.confirmation,
      state.conversationId,
      state.conversationName,
      state.drawerOpen,
      commands.createProject,
      editorOpen,
      state.error,
      state.formatMismatch,
      state.loading,
      state.runtime?.models,
      commands.newConversation,
      commands.newProject,
      state.notice,
      commands.openAgentSettings,
      commands.openMcpConfig,
      commands.openModelConfig,
      commands.openSkills,
      projectActive,
      state.projectId,
      state.projectName,
      state.projects,
      commands.rebuildData,
      commands.renameConversation,
      commands.saveConversationTitle,
      commands.restoreConversation,
      reviewOpen,
      activity,
      commands.saveAndLeave,
      commands.selectConversation,
      commands.selectTab,
      state.selectedConversation,
      state.selectedProject,
      commands.setAppearance,
      commands.setConfirmation,
      commands.setConversationName,
      commands.setError,
      commands.setDrawerOpen,
      commands.setProjectName,
      commands.setSheet,
      state.sheet,
      commands.startRenameConversation,
      state.tab,
    ],
  );
  return { conversation, editor, files, git, runs, dialogs };
}

export type ConversationCapability = ReturnType<typeof useWorkbench>['conversation'];
export type EditorCapability = ReturnType<typeof useWorkbench>['editor'];
export type FilesCapability = ReturnType<typeof useWorkbench>['files'];
export type GitCapability = ReturnType<typeof useWorkbench>['git'];
export type RunsCapability = ReturnType<typeof useWorkbench>['runs'];
export type DialogsCapability = ReturnType<typeof useWorkbench>['dialogs'];
