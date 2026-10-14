import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { Platform } from 'react-native';
import { Buffer } from 'buffer';
import { useRouter } from 'expo-router';
import type { Operation, Project, ProjectFile, TaskRecord, Version } from '@/core/prototype/types';
import { emptyModelConfiguration } from '@/core/models/types';
import { selectedModelId, selectedModelMode } from '@/core/models/rules';
import { emptyConversationState, type Conversation } from '@/core/conversations/types';
import { safePath, isImage, mimeFor } from '@/core/workspace/path';
import { getRuntime, type Runtime } from '@/adapters/runtime';
import { pickFile, exportFile } from '@/adapters/io/files';
import { useWorkbenchUi, type AppearanceMode } from './ui-store';
import { fileName } from './format';

export interface EditorDocument {
  projectId: string; path: string; revision: string | null; text: string; savedText: string;
  name: string; savedName: string; image: boolean; reading: boolean; fresh: boolean;
  externalChanged?: boolean;
}
export interface ReviewFile { path: string; kind: string; before: string; after: string }
export interface Review { title: string; files: ReviewFile[]; restoreRef?: string; expectedHead?: string; task?: TaskRecord }
type Confirmation = { title: string; description: string; label: string; danger?: boolean; perform: () => Promise<void>; saveFirst?: boolean };
type ComposerDraft = { conversationId?: string; text: string; attachment?: string };

export function useWorkbench() {
  const ui = useWorkbenchUi();
  const router = useRouter();
  const [runtime, setRuntime] = useState<Runtime>();
  const runtimeRef = useRef<Runtime | undefined>(undefined);
  const [projects, setProjects] = useState<Project[]>([]);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [configuration, setConfiguration] = useState(emptyModelConfiguration());
  const [conversationState, setConversationState] = useState(emptyConversationState());
  const [loading, setLoading] = useState(true);
  const [projectLoading, setProjectLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [active, setActive] = useState<TaskRecord>();
  const [editor, setEditorState] = useState<EditorDocument>();
  const editorRef = useRef<EditorDocument | undefined>(undefined);
  const setEditor = useCallback((value: SetStateAction<EditorDocument | undefined>) => {
    const next = typeof value === 'function' ? value(editorRef.current) : value;
    editorRef.current = next; setEditorState(next);
  }, []);
  const [sheet, setSheet] = useState<'create' | 'projects' | 'settings' | 'attach' | 'rename' | 'models' | 'conversations' | 'conversation-name'>();
  const [projectName, setProjectName] = useState('');
  const [conversationName, setConversationName] = useState('');
  const [conversationToRename, setConversationToRename] = useState<string>();
  const [composer, setComposer] = useState<ComposerDraft>({ text: '' });
  const composerRef = useRef<ComposerDraft>({ text: '' });
  const draftWrites = useRef(new Map<string, Promise<unknown>>());
  const [draftSaved, setDraftSaved] = useState(true);
  const [draftSaving, setDraftSaving] = useState(false);
  const [review, setReview] = useState<Review>();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const refreshId = useRef(0);
  const selectedProject = projects.find((project) => project.id === ui.projectId);
  const dirty = !!editor && (editor.fresh || editor.text !== editor.savedText || editor.name !== editor.savedName);
  const projectActive = active?.projectId === ui.projectId ? active : undefined;
  const selectedConversation = conversationState.conversations.find((item) => item.id === ui.conversationId && item.projectId === ui.projectId && !item.archivedAt);
  const conversations = conversationState.conversations.filter((item) => item.projectId === ui.projectId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const conversationActive = projectActive?.conversationId === ui.conversationId ? projectActive : undefined;
  const prompt = composer.conversationId === ui.conversationId ? composer.text : '';
  const attachment = composer.conversationId === ui.conversationId ? composer.attachment : undefined;
  const modelId = selectedModelId(configuration, ui.projectId, ui.conversationId);
  const selectedModel = configuration.models.find((model) => model.id === modelId);
  const selectedConnection = configuration.connections.find((connection) => connection.id === selectedModel?.connectionId);
  const settings = { mode: selectedModelMode(configuration, ui.conversationId), model: selectedModel?.name ?? '选择模型', baseUrl: selectedConnection?.baseUrl ?? '', imageInput: selectedModel?.parameters.allowImages ?? false };
  const modelLabel = settings.mode === 'demo' ? '演示模式' : selectedModel ? (selectedConnection?.name ?? '') + ' · ' + selectedModel.name : '选择模型';

  function installConversation(conversation: Conversation) {
    const draft = runtimeRef.current?.conversations.getSnapshot().drafts[conversation.id];
    const next = { conversationId: conversation.id, text: draft?.text ?? '', attachment: draft?.attachment };
    composerRef.current = next; setComposer(next); setDraftSaved(true); setDraftSaving(false);
  }
  function writeComposer(next: ComposerDraft) {
    composerRef.current = next; setComposer(next); const value = runtimeRef.current;
    if (!value || !next.conversationId) return;
    setDraftSaved(false); setDraftSaving(true);
    const pending = value.conversations.saveDraft(next.conversationId, { text: next.text, attachment: next.attachment });
    draftWrites.current.set(next.conversationId, pending);
    void pending.then(() => { if (composerRef.current === next) { setDraftSaved(true); setDraftSaving(false); } }).catch(() => {
      if (composerRef.current === next) { setDraftSaved(false); setDraftSaving(false); }
      setError('草稿保存失败，请重试或复制输入内容后保留。');
    });
  }
  function setPrompt(text: string) {
    if (composerRef.current.conversationId !== ui.conversationId) return;
    writeComposer({ ...composerRef.current, text });
  }
  function setAttachment(path?: string) {
    if (composerRef.current.conversationId !== ui.conversationId) return;
    writeComposer({ ...composerRef.current, attachment: path });
  }
  async function flushDraft(draft = composerRef.current) {
    const value = runtimeRef.current;
    if (!value || !draft.conversationId) return;
    await draftWrites.current.get(draft.conversationId)?.catch(() => {});
    const saved = await value.conversations.saveDraft(draft.conversationId, { text: draft.text, attachment: draft.attachment });
    if (composerRef.current === draft) { setDraftSaved(true); setDraftSaving(false); }
    return saved;
  }

  const refresh = useCallback(async (projectId?: string) => {
    const value = runtimeRef.current;
    if (!value) return;
    const request = ++refreshId.current;
    if (!projectId) { const nextProjects = await value.workspace.projects(); if (request === refreshId.current) setProjects(nextProjects); return; }
    const open = editorRef.current;
    const [snapshot, nextTasks, nextProjects] = await Promise.all([
      value.workspace.snapshot(projectId, open?.projectId === projectId && !open.fresh ? open.path : undefined), value.tasks(projectId), value.workspace.projects(),
    ]);
    if (request !== refreshId.current || useWorkbenchUi.getState().projectId !== projectId) return;
    setProjects(nextProjects); setFiles(snapshot.files.filter((file) => file.path !== 'project.json'));
    setVersions(snapshot.versions); setTasks(nextTasks); setOperations(snapshot.operations);
    const document = editorRef.current;
    if (document && document.projectId === projectId && !document.fresh && open?.path === document.path && open.revision === document.revision) {
      const current = snapshot.files.find((file) => file.path === document.path);
      if (current?.revision !== document.revision) {
        const modified = document.text !== document.savedText || document.name !== document.savedName;
        if (modified) { const next = { ...document, externalChanged: true }; editorRef.current = next; setEditor(next); }
        else if (!current) { editorRef.current = undefined; setEditor(undefined); }
        else if (snapshot.preview?.path === document.path) {
          const latest = snapshot.preview;
          const next = { ...document, text: latest.content, savedText: latest.content, revision: latest.revision, externalChanged: false };
          editorRef.current = next; setEditor(next);
        }
      }
    }
  }, [setEditor]);

  useEffect(() => {
    let mounted = true;
    getRuntime().then(async (value) => {
      const [list, preference] = await Promise.all([
        value.workspace.projects(),
        value.metadata.get<{ projectId?: string; appearance?: AppearanceMode }>('preferences', 'workbench'),
      ]);
      if (!mounted) return;
      runtimeRef.current = value; setRuntime(value); setProjects(list); setConfiguration(value.models.getSnapshot()); setConversationState(value.conversations.getSnapshot()); setActive(value.agent.getSnapshot().active);
      if (preference?.appearance) useWorkbenchUi.getState().setAppearance(preference.appearance);
      const selected = preference?.projectId && list.some((item) => item.id === preference.projectId) ? preference.projectId : list[0]?.id;
      const conversation = selected ? await value.conversations.ensureProject(selected) : undefined;
      if (!mounted) return;
      if (conversation) installConversation(conversation);
      useWorkbenchUi.getState().selectProject(selected, conversation?.id);
      if (value.workspace.recoveryIssues.length) setError(value.workspace.recoveryIssues.join('\n'));
    }).catch(() => { if (mounted) setError('暂时无法打开本地资料。请保留本地数据后重新打开应用。'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!runtime) return;
    let disposed = false; let needed = false; let refreshing = false;
    const requestRefresh = () => {
      needed = true; if (refreshing) return; refreshing = true;
      void (async () => {
        while (needed && !disposed) {
          needed = false;
          try { await refresh(useWorkbenchUi.getState().projectId); }
          catch { if (!disposed) setError('读取最新资料失败，请重新打开项目。'); }
        }
      })().finally(() => { refreshing = false; });
    };
    const workspaceSubscription = runtime.workspace.subscribe((change) => {
      if (change.projectId === useWorkbenchUi.getState().projectId) requestRefresh();
    });
    const configSubscription = runtime.models.subscribe(() => setConfiguration(runtime.models.getSnapshot()));
    const conversationSubscription = runtime.conversations.subscribe(() => setConversationState(runtime.conversations.getSnapshot()));
    const taskSubscription = runtime.agent.subscribe(() => {
      const state = runtime.agent.getSnapshot(); setActive(state.active);
      if (!state.active && !state.starting) {
        requestRefresh();
        if (state.error || state.completed?.error) setError(state.error ?? state.completed?.error ?? '');
      }
    });
    return () => { disposed = true; refreshId.current = refreshId.current + 1; workspaceSubscription(); configSubscription(); conversationSubscription(); taskSubscription(); };
  }, [runtime, refresh]);

  useEffect(() => {
    if (!runtime || !ui.projectId) return;
    let current = true;
    Promise.resolve().then(() => { if (current) setProjectLoading(true); });
    refresh(ui.projectId).catch(() => { if (current) setError('读取项目失败，请重新打开项目。'); })
      .finally(() => { if (current) setProjectLoading(false); });
    return () => { current = false; };
  }, [runtime, ui.projectId, refresh]);

  useEffect(() => {
    if (!runtime) return;
    void runtime.metadata.put('preferences', 'workbench', { projectId: ui.projectId, appearance: ui.appearance }).catch(() => {});
  }, [runtime, ui.projectId, ui.appearance]);

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

  async function persistEditor(close = false) {
    const document = editorRef.current;
    if (!runtime || !document) return;
    if (active?.projectId === document.projectId) throw new Error('任务仍在运行，请停止或等待完成后保存。');
    const name = document.name.trim();
    if (!/^[^/\\]+\.(md|txt)$/i.test(name) && !document.image) throw new Error('文件名称请以 .md 或 .txt 结尾。');
    let target = document.path;
    if (document.fresh) {
      target = 'documents/' + safePath(name);
      await runtime.workspace.write(document.projectId, target, Buffer.from(document.text), null);
    } else {
      if (document.text !== document.savedText && !document.image) {
        await runtime.workspace.write(document.projectId, document.path, Buffer.from(document.text), document.revision);
      }
      if (name !== document.savedName) {
        target = document.path.slice(0, document.path.lastIndexOf('/') + 1) + safePath(name);
        const current = await runtime.workspace.read(document.projectId, document.path);
        await runtime.workspace.move(document.projectId, document.path, target, current.revision);
      }
    }
    const current = await runtime.workspace.preview(document.projectId, target);
    const saved = { ...document, path: target, revision: current.revision, fresh: false,
      savedText: document.text, name: fileName(target), savedName: fileName(target) };
    editorRef.current = saved; setEditor(close ? undefined : saved);
    setNotice('文件已保存，历史版本已记录。');
    await refresh(ui.projectId);
  }

  function guard(next: () => void) {
    const document = editorRef.current;
    if (document && (document.fresh || document.text !== document.savedText || document.name !== document.savedName)) {
      setConfirmation({
        title: '有尚未保存的修改', description: '离开前保存文件，或放弃这次编辑。', label: '放弃修改',
        danger: true, saveFirst: true,
        perform: async () => { setEditor(undefined); editorRef.current = undefined; next(); },
      });
    } else next();
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
  function returnToActiveConversation() {
    if (!active?.conversationId) return;
    if (active.projectId === ui.projectId) { void selectConversation(active.conversationId); return; }
    guard(() => { void action(async () => {
      if (!runtime || !active.conversationId) return; await flushDraft(); await runtime.conversations.select(active.conversationId, active.projectId);
      const conversation = runtime.conversations.getSnapshot().conversations.find((item) => item.id === active.conversationId)!;
      installConversation(conversation); setEditor(undefined); editorRef.current = undefined; ui.selectProject(active.projectId, active.conversationId);
    }); });
  }

  function closeEditor() { guard(() => { setEditor(undefined); }); }

  async function createProject() {
    if (!runtime || !projectName.trim()) return;
    await action(async () => {
      await flushDraft();
      const created = await runtime.workspace.create(projectName);
      const conversation = await runtime.conversations.ensureProject(created.id); installConversation(conversation); setEditor(undefined);
      setSheet(undefined); setProjectName(''); ui.selectProject(created.id, conversation.id); await refresh(created.id);
    });
  }

  async function openFile(file: ProjectFile) {
    guard(() => {
      void action(async () => {
        if (!runtime || !ui.projectId) return;
        const value = await runtime.workspace.preview(ui.projectId, file.path);
        setEditor({ projectId: ui.projectId, path: file.path, name: fileName(file.path), savedName: fileName(file.path),
          text: value.content, savedText: value.content, revision: value.revision, image: isImage(file.path), reading: true, fresh: false });
      });
    });
  }

  function newFile() {
    if (!ui.projectId) return;
    guard(() => setEditor({ projectId: ui.projectId!, path: 'documents/untitled.md', name: 'untitled.md', savedName: '',
      text: '', savedText: '', revision: null, image: false, reading: false, fresh: true }));
  }

  function newProject() {
    guard(() => { setEditor(undefined); setProjectName(''); setSheet('create'); });
  }

  async function importFile(attach = false) {
    if (!runtime || !ui.projectId) return;
    await action(async () => {
      const selection = await pickFile();
      if (!selection) return;
      if (!/\.(md|txt|png|jpg|jpeg|webp)$/i.test(selection.name)) throw new Error('支持 Markdown、文本和 PNG/JPEG/WebP 图片。');
      const path = (isImage(selection.name) ? 'assets/' : 'documents/') + safePath(selection.name);
      await runtime.workspace.write(ui.projectId!, path, selection.bytes, null, { message: '导入 ' + selection.name });
      setNotice('已导入 ' + selection.name); await refresh(ui.projectId);
      if (attach) { setAttachment(path); setSheet(undefined); }
    });
  }

  async function beginTask() {
    if (!runtime || !ui.projectId || !ui.conversationId || !prompt.trim() || active) return;
    ui.selectTab('agent');
    const submitted = composerRef.current;
    const saved = await flushDraft(submitted);
    if (submitted.conversationId !== ui.conversationId) throw new Error('对话已切换，请确认当前输入后发送。');
    const projectId = ui.projectId;
    const text = submitted.text.trim() + (submitted.attachment ? '\n\n参考文件：' + submitted.attachment : '');
    await runtime.agent.start(projectId, text, !!submitted.attachment && isImage(submitted.attachment), ui.conversationId, saved?.revision);
    if (composerRef.current === submitted) {
      const next = { conversationId: ui.conversationId, text: '' }; composerRef.current = next; setComposer(next); setDraftSaved(true); setDraftSaving(false);
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
  function openModelConfig() {
    guard(() => { setEditor(undefined); editorRef.current = undefined; setSheet(undefined);
      requestAnimationFrame(() => router.push('/models')); });
  }
  function openModels() { setSheet('models'); }
  function openAgentSettings() {
    guard(() => { setEditor(undefined); editorRef.current = undefined; setSheet(undefined);
      requestAnimationFrame(() => router.push('/settings/agent')); });
  }
  async function reviewTask(task: TaskRecord) {
    if (!runtime) return;
    await action(async () => {
      const head = await runtime.workspace.git.head(task.projectId);
      const value = await runtime.workspace.changes(task.projectId, task.baseCommit, task.finalCommit ?? head);
      setReview({ title: '任务的文件变化', files: value, task,
        restoreRef: task.finalCommit === head && task.finalCommit !== task.baseCommit ? task.baseCommit : undefined, expectedHead: head });
    });
  }

  async function reviewVersion(version: Version) {
    if (!runtime || !ui.projectId) return;
    guard(() => { void action(async () => {
      const head = await runtime.workspace.git.head(ui.projectId!);
      const value = await runtime.workspace.changes(ui.projectId!, head, version.oid);
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
      description: '将恢复相关项目内容，并保存一个新版本。已有历史和会话会保留。', label: '确认恢复',
      perform: async () => {
        await runtime.workspace.restore(ui.projectId!, value.restoreRef!, value.expectedHead!);
        setReview(undefined); setEditor(undefined); await refresh(ui.projectId); setNotice('内容已恢复，历史记录已保留。');
      },
    });
  }

  function deleteEditor() {
    if (!runtime || !editor || editor.fresh) return;
    const document = editor;
    setConfirmation({ title: '删除 ' + document.name + '？', description: '文件会从当前项目移除，仍可从历史版本恢复。',
      label: '删除文件', danger: true,
      perform: async () => {
        await runtime.workspace.remove(document.projectId, document.path, document.revision!);
        setEditor(undefined); await refresh(ui.projectId); setNotice('文件已删除。');
      } });
  }

  async function renameEditor(name: string) {
    if (!runtime || !editor || editor.fresh) return;
    const document = editor;
    await action(async () => {
      const targetName = safePath(name.trim());
      if (targetName.includes('/')) throw new Error('请输入文件名称，不包含文件夹路径。');
      if (document.image ? mimeFor(targetName) !== mimeFor(document.path) : !/\.(md|txt)$/i.test(targetName)) {
        throw new Error(document.image ? '请保留图片的原始格式扩展名。' : '文本文件请使用 .md 或 .txt。');
      }
      const target = document.path.slice(0, document.path.lastIndexOf('/') + 1) + targetName;
      await runtime.workspace.move(document.projectId, document.path, target, document.revision!);
      const current = await runtime.workspace.preview(document.projectId, target);
      const saved = { ...document, path: target, name: targetName, savedName: targetName, revision: current.revision };
      editorRef.current = saved; setEditor(saved); setSheet(undefined); await refresh(ui.projectId); setNotice('文件已重命名。');
    });
  }

  const changedPaths = (task: TaskRecord) => [...new Set(operations.filter((operation) => operation.runId === task.id)
    .flatMap((operation) => operation.changes.map((change) => change.path)))];

  return {
    ...ui, runtime, projects, selectedProject, files, versions,
    tasks: tasks.filter((task) => task.projectId === ui.projectId && task.conversationId === ui.conversationId),
    active, projectActive, conversationActive, conversations, selectedConversation, operations, loading, projectLoading, busy,
    error, notice, setError, settings, configuration, modelLabel, selectedModel, selectedConnection, editor, setEditor, dirty,
    sheet, setSheet, projectName, setProjectName, prompt, setPrompt, attachment, setAttachment, review, setReview,
    conversationName, setConversationName, draftSaved, draftSaving, newConversation, selectConversation,
    startRenameConversation, renameConversation, archiveConversation, restoreConversation, returnToActiveConversation,
    confirmation, setConfirmation, selectProject, createProject, newProject, openFile, newFile, closeEditor, importFile, submit, renameEditor,
    stop: () => runtime?.agent.cancel(), openSettings, openModelConfig, openAgentSettings, openModels, reviewTask, reviewVersion, confirmRestore, deleteEditor,
    saveEditor: () => action(() => persistEditor()), action,
    saveAndLeave: async () => {
      const next = confirmation;
      const saved = await action(async () => { await persistEditor(); await next?.perform(); setConfirmation(undefined); });
      return saved;
    },
    confirm: async () => { await action(async () => { await confirmation?.perform(); setConfirmation(undefined); }); },
    exportEditor: () => action(async () => { if (runtime && editor) await exportFile(runtime.workspace, editor.projectId, editor.path); }),
    changedPaths,
  };
}

export type Workbench = ReturnType<typeof useWorkbench>;
