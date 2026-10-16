import type { AppServices } from '@/application/services';
import { selectedModelId } from '@/core/models/rules';
import { useConversationDraft } from '@/features/conversations/use-draft';
import { useGitActions } from '@/features/workbench/git-actions';
import { useAction } from '@/shared/use-action';
import { useWorkbenchUi } from '@/shared/workbench-state';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useBeforeUnload } from '@/shared/use-before-unload';
import { useEditorActions } from './editor-actions';
import type { Confirmation, Review, WorkbenchSheet } from './types';
import { useDialogActions } from './use-dialog-actions';
import { useEditorSession } from './use-editor-session';
import { useProjectNavigation } from './use-project-navigation';
import { useTaskActions } from './use-task-actions';
import { useWorkbenchData } from './use-workbench-data';

export function useWorkbench() {
  const ui = useWorkbenchUi();

  const runtimeRef = useRef<AppServices | undefined>(undefined);

  const { busy, error, setError, action } = useAction();
  const [notice, setNotice] = useState('');

  const editorSession = useEditorSession();
  const { editor, editorRef, setEditor, dirty } = editorSession;
  const [sheet, setSheet] = useState<WorkbenchSheet>();
  const [review, setReview] = useState<Review>();
  const [confirmation, setConfirmation] = useState<Confirmation>();

  const draft = useConversationDraft(runtimeRef, ui.conversationId, setError);
  const { composer, draftSaved, draftSaving, installConversation, setPrompt, setAttachment } =
    draft;
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
      model: selectedModel?.name ?? '选择模型',
      baseUrl: selectedConnection?.baseUrl ?? '',
      imageInput: selectedModel?.parameters.allowImages ?? false,
    }),
    [selectedModel, selectedConnection],
  );
  const modelLabel = selectedModel
    ? (selectedConnection?.name ?? '') + ' · ' + selectedModel.name
    : '选择模型';

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  useBeforeUnload(dirty || (!draftSaved && !!(prompt || attachment)));

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

  const shared = { runtime, ui, action, refresh, setError, setNotice, setConfirmation };
  const navigation = useProjectNavigation({ ...shared, draft, setEditor, guard, setSheet, active });
  const taskActions = useTaskActions({
    ...shared,
    draft,
    prompt,
    conversationActive,
    active,
    dirty,
    persistEditor,
    operations,
    setReview,
  });
  const dialogs = useDialogActions({
    action,
    guard,
    persistEditor,
    editor: editorSession,
    confirmation,
    setConfirmation,
    setSheet,
  });
  const saveEditor = () => action(() => persistEditor());
  const exportEditor = () =>
    action(async () => {
      if (runtime && editor) await runtime.io.exportFile(editor.projectId, editor.path);
    });

  return {
    shell: {
      tab: ui.tab,
      selectTab: ui.selectTab,
      projectId: ui.projectId,
      conversationId: ui.conversationId,
      projects,
      selectedProject,
      selectedConversation,
      gitStatus,
      runs,
      drawerOpen: navigation.drawerOpen,
      setDrawerOpen: navigation.setDrawerOpen,
      newProject: navigation.newProject,
      newConversation: navigation.newConversation,
      saveConversationTitle: navigation.saveConversationTitle,
      loading,
      busy,
      error,
      setError,
      notice,
      formatMismatch,
      rebuildData,
      action,
      editorOpen: !!editor,
      reviewOpen: !!review,
    },
    navigation: {
      ...navigation,
      busy,
      projectId: ui.projectId,
      conversationId: ui.conversationId,
      projects,
      allConversations: conversationState.conversations,
      conversationDrafts: conversationState.drafts,
      runs,
    },
    settings: {
      projectId: ui.projectId,
      appearance: ui.appearance,
      setAppearance: ui.setAppearance,
      modelLabel,
      openModelConfig: dialogs.openModelConfig,
      openAgentSettings: dialogs.openAgentSettings,
      openMcpConfig: dialogs.openMcpConfig,
      openSkills: dialogs.openSkills,
    },
    sheets: {
      sheet,
      setSheet,
      busy,
      error,
      confirmation,
      setConfirmation,
      confirm: dialogs.confirm,
      saveAndLeave: dialogs.saveAndLeave,
      modelsApi: runtime?.models,
      configuration,
      projectId: ui.projectId,
      conversationId: ui.conversationId,
      openModelConfig: dialogs.openModelConfig,
      openSkills: dialogs.openSkills,
      projectName: navigation.projectName,
      setProjectName: navigation.setProjectName,
      createProject: navigation.createProject,
      conversationName: navigation.conversationName,
      setConversationName: navigation.setConversationName,
      renameConversation: navigation.renameConversation,
    },
    conversation: {
      ...taskActions,
      active,
      attachment,
      busy,
      conversationActive,
      conversationId: ui.conversationId,
      draftSaved,
      draftSaving,
      historyBusy,
      loadOlderRuns,
      modelLabel,
      openModels: () => setSheet('models'),
      openFile,
      files,
      projectActive: !!projectActive,
      projectLoading,
      prompt,
      returnToActiveConversation: navigation.returnToActiveConversation,
      reviewTask,
      runsApi: runtime?.runs,
      taskChangeSummary: runtime?.workspace.taskChangeSummary,
      selectedConversation,
      setAttachment,
      setPrompt,
      setSheet,
      settings,
      taskCursor,
      tasks,
    },
    editor: {
      busy,
      closeEditor,
      confirmation,
      deleteEditor,
      dirty,
      editor,
      error,
      exportEditor,
      files,
      preview: runtime?.workspace.preview,
      projectActive: !!projectActive,
      renameEditor,
      review,
      saveEditor,
      setEditor,
      setSheet,
      sheet,
    },
    files: {
      busy,
      gitStatus,
      files,
      importFile,
      newFile,
      openFile,
      openPath: editor?.path,
      preview: runtime?.workspace.preview,
      projectActive: !!projectActive,
      projectId: ui.projectId,
      projectLoading,
    },
    git: {
      busy,
      changeStage,
      commitDrafts: ui.commitDrafts,
      commitGit,
      confirmRestore,
      dirty,
      discardGit,
      error,
      gitStatus,
      loadOlderVersions,
      projectActive: !!projectActive,
      projectId: ui.projectId,
      projectLoading,
      review,
      reviewGit,
      reviewVersion,
      setCommitDraft: ui.setCommitDraft,
      setReview,
      versionCursor,
      versions,
      versionsBusy,
    },
    runs: {
      busy,
      conversationId: ui.conversationId,
      projects,
      runs,
      returnToActiveConversation: navigation.returnToActiveConversation,
    },
  };
}

export type ConversationCapability = ReturnType<typeof useWorkbench>['conversation'];
export type EditorCapability = ReturnType<typeof useWorkbench>['editor'];
export type FilesCapability = ReturnType<typeof useWorkbench>['files'];
export type GitCapability = ReturnType<typeof useWorkbench>['git'];
export type RunsCapability = ReturnType<typeof useWorkbench>['runs'];
export type NavigationCapability = ReturnType<typeof useWorkbench>['navigation'];
export type ShellCapability = ReturnType<typeof useWorkbench>['shell'];
export type SettingsCapability = ReturnType<typeof useWorkbench>['settings'];
export type SheetsCapability = ReturnType<typeof useWorkbench>['sheets'];
