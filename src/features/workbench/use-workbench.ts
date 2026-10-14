import { useConversationDraft } from '@/features/conversations/use-draft';
import { useWorkbenchData } from './use-workbench-data';
import { useGitActions } from '@/features/git/actions';
import { useEditorActions } from './editor-actions';
import { useEditorSession } from './use-editor-session';
import type { Confirmation, Review, WorkbenchSheet } from './types';
import type { AppServices } from '@/application/services';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import type { TaskRecord } from '@/core/runs/types';
import { selectedModelId, selectedModelMode } from '@/core/models/rules';
import type { Conversation } from '@/core/conversations/types';
import { isImage } from '@/core/workspace/path';
import { useWorkbenchUi } from '@/shared/state/workbench';

export function useWorkbench() {
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
  const [projectName, setProjectName] = useState('');
  const [conversationName, setConversationName] = useState('');
  const [conversationToRename, setConversationToRename] = useState<string>();

  const [review, setReview] = useState<Review>();
  const [confirmation, setConfirmation] = useState<Confirmation>();

  const draft = useConversationDraft(runtimeRef, ui.conversationId, setError);
  const { composer, composerRef, draftSaved, draftSaving, installConversation, setPrompt, setAttachment, flushDraft } = draft;
  const { runtime, projects, files, versions, gitStatus, tasks, operations, configuration, conversationState, loading, projectLoading, active, runs, refresh } =
    useWorkbenchData({ ui, runtimeRef, editorRef, setEditor, installConversation, setError });

  const selectedProject = projects.find((project) => project.id === ui.projectId);
  const projectActive = runs.find((run) => run.projectId === ui.projectId && run.state !== 'queued');
  const selectedConversation = conversationState.conversations.find((item) => item.id === ui.conversationId && item.projectId === ui.projectId && !item.archivedAt);
  const conversations = conversationState.conversations.filter((item) => item.projectId === ui.projectId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const conversationActive = runs.find((run) => run.projectId === ui.projectId && run.conversationId === ui.conversationId);
  const prompt = composer.conversationId === ui.conversationId ? composer.text : '';
  const attachment = composer.conversationId === ui.conversationId ? composer.attachment : undefined;
  const modelId = selectedModelId(configuration, ui.projectId, ui.conversationId);
  const selectedModel = configuration.models.find((model) => model.id === modelId);
  const selectedConnection = configuration.connections.find((connection) => connection.id === selectedModel?.connectionId);
  const settings = { mode: selectedModelMode(configuration, ui.conversationId), model: selectedModel?.name ?? '选择模型', baseUrl: selectedConnection?.baseUrl ?? '', imageInput: selectedModel?.parameters.allowImages ?? false };
  const modelLabel = settings.mode === 'demo' ? '演示模式' : selectedModel ? (selectedConnection?.name ?? '') + ' · ' + selectedModel.name : '选择模型';

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (Platform.OS !== 'web' || (!dirty && (draftSaved || (!prompt && !attachment)))) return;
    const handle = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handle);
    return () => window.removeEventListener('beforeunload', handle);
  }, [dirty, draftSaved, prompt, attachment]);

  async function action(work: () => Promise<void>): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true); setError('');
    try { await work(); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败，请重试。'); return false; }
    finally { busyRef.current = false; setBusy(false); }
  }

  function selectProject(id: string) {
    guard(() => {
      void action(async () => {
        if (!runtime) return; await flushDraft();
        const conversation = await runtime.conversations.ensureProject(id); installConversation(conversation);
        setEditor(undefined); editorRef.current = undefined; setSheet(undefined); ui.selectProject(id, conversation.id);
      });
    });
  }
  async function selectConversation(id: string) {
    await action(async () => {
      if (!runtime || !ui.projectId) return; await flushDraft();
      await runtime.conversations.select(id, ui.projectId);
      const conversation = runtime.conversations.getSnapshot().conversations.find((item) => item.id === id)!;
      installConversation(conversation); ui.selectConversation(id); setSheet(undefined); setError('');
    });
  }
  async function newConversation() {
    await action(async () => {
      if (!runtime || !ui.projectId) return; await flushDraft();
      const conversation = await runtime.conversations.create(ui.projectId); installConversation(conversation);
      ui.selectConversation(conversation.id); setSheet(undefined);
    });
  }
  function startRenameConversation(conversation: Conversation) {
    setConversationToRename(conversation.id); setConversationName(conversation.title); setSheet('conversation-name');
  }
  async function renameConversation() {
    await action(async () => {
      if (!runtime || !conversationToRename) return;
      await runtime.conversations.rename(conversationToRename, conversationName); setSheet(undefined); setNotice('对话名称已保存。');
    });
  }
  function archiveConversation(conversation: Conversation) {
    setConfirmation({ title: '归档“' + conversation.title + '”？', description: '归档后保留消息和草稿，可在已归档列表恢复。', label: '归档对话', perform: async () => {
      if (!runtime || !ui.projectId) return; await flushDraft(); await runtime.conversations.archive(conversation.id);
      if (ui.conversationId === conversation.id) {
        const selected = await runtime.conversations.ensureProject(ui.projectId); installConversation(selected); ui.selectConversation(selected.id);
      }
      setSheet(undefined); setNotice('对话已归档。');
    } });
  }
  async function restoreConversation(conversation: Conversation) {
    await action(async () => {
      if (!runtime) return; await flushDraft(); await runtime.conversations.restore(conversation.id);
      installConversation(conversation); ui.selectConversation(conversation.id); setSheet(undefined); setNotice('对话已恢复。');
    });
  }
  function returnToActiveConversation(target = active) {
    if (!target?.conversationId) return;
    if (target.projectId === ui.projectId) { void selectConversation(target.conversationId); return; }
    guard(() => { void action(async () => {
      if (!runtime || !target.conversationId) return; await flushDraft(); await runtime.conversations.select(target.conversationId, target.projectId);
      const conversation = runtime.conversations.getSnapshot().conversations.find((item) => item.id === target.conversationId)!;
      installConversation(conversation); setEditor(undefined); editorRef.current = undefined; ui.selectProject(target.projectId, target.conversationId);
    }); });
  }

  async function createProject() {
    if (!runtime || !projectName.trim()) return;
    await action(async () => {
      await flushDraft();
      const created = await runtime.workspace.create(projectName);
      const conversation = await runtime.conversations.ensureProject(created.id); installConversation(conversation); setEditor(undefined);
      setSheet(undefined); setProjectName(''); ui.selectProject(created.id, conversation.id); await refresh(created.id);
    });
  }

  function newProject() {
    guard(() => { setEditor(undefined); setProjectName(''); setSheet('create'); });
  }

  async function beginTask() {
    if (!runtime || !ui.projectId || !ui.conversationId || !prompt.trim() || conversationActive) return;
    ui.selectTab('agent');
    const submitted = composerRef.current;
    const saved = await flushDraft(submitted);
    if (submitted.conversationId !== ui.conversationId) throw new Error('对话已切换，请确认当前输入后发送。');
    const projectId = ui.projectId;
    const text = submitted.text.trim() + (submitted.attachment ? '\n\n参考文件：' + submitted.attachment : '');
    await runtime.agent.start(projectId, text, !!submitted.attachment && isImage(submitted.attachment), ui.conversationId, saved?.revision);
    if (composerRef.current === submitted) {
      draft.clear();
    }
  }

  async function submit() {
    if (dirty) {
      setConfirmation({ title: '先保存修改再发送？', description: 'Agent 将基于最新的资料执行任务。先保存正在编辑的文件。',
        label: '保存并发送', perform: async () => { await persistEditor(); await beginTask(); } });
      return;
    }
    await action(beginTask);
  }

  function openSettings() { setSheet('settings'); }
  async function reviewProposal(rootId: string, proposalId: string) {
    if (!runtime?.proposals) return;
    await action(async () => {
      const value = await runtime.proposals!.preview(rootId, proposalId);
      const state = { draft: '编辑中', ready: '待合入', conflicted: '存在冲突', applying: '合入中', applied: '已合入', cancelled: '已停止', interrupted: '已中断' }[value.state];
      setReview({ title: '隔离写作提案 · ' + state, files: value.files, description: '输入基线与候选内容 · 合入由主 Agent 执行' });
    });
  }
  function openModelConfig() {
    guard(() => { setEditor(undefined); editorRef.current = undefined; setSheet(undefined);
      requestAnimationFrame(() => router.push('/models')); });
  }
  function openModels() { setSheet('models'); }
  function openMcpConfig() {
    guard(() => { setEditor(undefined); editorRef.current = undefined; setSheet(undefined);
      requestAnimationFrame(() => router.push('/mcp')); });
  }
  function openSkills() {
    guard(() => { setEditor(undefined); editorRef.current = undefined; setSheet(undefined);
      requestAnimationFrame(() => router.push('/skills')); });
  }
  function openAgentSettings() {
    guard(() => { setEditor(undefined); editorRef.current = undefined; setSheet(undefined);
      requestAnimationFrame(() => router.push('/settings/agent')); });
  }

  const changedPaths = (task: TaskRecord) => task.changedPaths ?? [...new Set(operations.filter((operation) => operation.runId === task.id)
    .flatMap((operation) => operation.changes.map((change) => change.path)))];

  const editorActions = useEditorActions({ runtime, ui, action, refresh, setError, setNotice, setConfirmation, ...editorSession, active: projectActive, setSheet, setAttachment });
  const { persistEditor, guard, closeEditor, openFile, newFile, importFile, deleteEditor, renameEditor } = editorActions;
  const { reviewTask, reviewVersion, confirmRestore, reviewGit, changeStage, commitGit, discardGit } = useGitActions({ runtime, ui, action, refresh, setError, setNotice, setConfirmation, gitStatus, dirty, review, setReview, setEditor, guard });

  return {
    ...ui, runtime, projects, selectedProject, files, versions, gitStatus, reviewGit, changeStage, commitGit, discardGit,
    tasks: tasks.filter((task) => task.projectId === ui.projectId && task.conversationId === ui.conversationId),
    active, runs, projectActive, conversationActive, conversations, selectedConversation, operations, loading, projectLoading, busy,
    error, notice, setError, settings, configuration, modelLabel, selectedModel, selectedConnection, editor, setEditor, dirty,
    sheet, setSheet, projectName, setProjectName, prompt, setPrompt, attachment, setAttachment, review, setReview,
    conversationName, setConversationName, draftSaved, draftSaving, newConversation, selectConversation,
    startRenameConversation, renameConversation, archiveConversation, restoreConversation, returnToActiveConversation,
    confirmation, setConfirmation, selectProject, createProject, newProject, openFile, newFile, closeEditor, importFile, submit, renameEditor,
    reviewProposal, stop: () => { void Promise.resolve(runtime?.agent.cancel(conversationActive?.id ?? active?.id)).catch(() => setError('停止状态保存失败，请重新打开应用恢复。')); },
    openSettings, openModelConfig, openAgentSettings, openMcpConfig, openSkills, openModels, reviewTask, reviewVersion, confirmRestore, deleteEditor,
    saveEditor: () => action(() => persistEditor()), action,
    saveAndLeave: async () => {
      const next = confirmation;
      const saved = await action(async () => { await persistEditor(); await next?.perform(); setConfirmation(undefined); });
      if (saved) next?.afterPerform?.();
      return saved;
    },
    confirm: async () => { const next = confirmation; const done = await action(async () => { await next?.perform(); setConfirmation(undefined); }); if (done) next?.afterPerform?.(); },
    exportEditor: () => action(async () => { if (runtime && editor) await runtime.io.exportFile(editor.projectId, editor.path); }),
    changedPaths,
  };
}

export type Workbench = ReturnType<typeof useWorkbench>;
