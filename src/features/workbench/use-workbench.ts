import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Buffer } from 'buffer';
import * as Crypto from 'expo-crypto';
import type { ModelSettings, Operation, Project, ProjectFile, TaskRecord, Version } from '@/core/prototype/types';
import { defaultSettings } from '@/core/prototype/types';
import { safePath, isImage, mimeFor } from '@/core/workspace/path';
import { getRuntime, type Runtime } from '@/adapters/runtime';
import { startAgent } from '@/adapters/agent/runner';
import { deepseekSettings, testModelConnection, validateConnection } from '@/adapters/model/settings';
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

export function useWorkbench() {
  const ui = useWorkbenchUi();
  const [runtime, setRuntime] = useState<Runtime>();
  const runtimeRef = useRef<Runtime | undefined>(undefined);
  const [projects, setProjects] = useState<Project[]>([]);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [settings, setSettings] = useState<ModelSettings>(defaultSettings);
  const [settingsDraft, setSettingsDraft] = useState<ModelSettings>(defaultSettings);
  const [secret, setSecret] = useState('');
  const [connectionResult, setConnectionResult] = useState('');
  const [testingConnection, setTestingConnection] = useState(false);
  const [loading, setLoading] = useState(true);
  const [projectLoading, setProjectLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [active, setActive] = useState<TaskRecord>();
  const [editor, setEditor] = useState<EditorDocument>();
  const editorRef = useRef<EditorDocument | undefined>(undefined);
  useEffect(() => { editorRef.current = editor; }, [editor]);
  const [sheet, setSheet] = useState<'create' | 'projects' | 'settings' | 'attach' | 'rename'>();
  const [projectName, setProjectName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [attachment, setAttachment] = useState<string>();
  const drafts = useRef<Record<string, { text: string; attachment?: string }>>({});
  const [review, setReview] = useState<Review>();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const cancellation = useRef<(() => void) | undefined>(undefined);
  const refreshId = useRef(0);
  const selectedProject = projects.find((project) => project.id === ui.projectId);
  const dirty = !!editor && (editor.fresh || editor.text !== editor.savedText || editor.name !== editor.savedName);
  const projectActive = active?.projectId === ui.projectId ? active : undefined;

  const refresh = useCallback(async (projectId?: string) => {
    const value = runtimeRef.current;
    if (!value) return;
    const request = ++refreshId.current;
    setProjects(await value.workspace.projects());
    if (!projectId) return;
    const [nextFiles, nextVersions, nextTasks, nextOperations] = await Promise.all([
      value.workspace.files(projectId), value.workspace.git.log(projectId), value.tasks(projectId),
      value.metadata.all<Operation>('operations'),
    ]);
    if (request !== refreshId.current || useWorkbenchUi.getState().projectId !== projectId) return;
    setFiles(nextFiles.filter((file) => file.path !== 'project.json'));
    setVersions(nextVersions); setTasks(nextTasks);
    setOperations(nextOperations.filter((operation) => operation.projectId === projectId && operation.phase === 'recorded'));
    const document = editorRef.current;
    if (document && document.projectId === projectId && !document.fresh) {
      const current = nextFiles.find((file) => file.path === document.path);
      if (current?.revision !== document.revision) {
        const modified = document.text !== document.savedText || document.name !== document.savedName;
        if (modified) setEditor((value) => value ? { ...value, externalChanged: true } : value);
        else if (!current) { editorRef.current = undefined; setEditor(undefined); }
        else {
          const latest = await value.workspace.preview(projectId, document.path);
          if (editorRef.current === document) {
            const next = { ...document, text: latest.content, savedText: latest.content, revision: latest.revision, externalChanged: false };
            editorRef.current = next; setEditor(next);
          }
        }
      }
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    getRuntime().then(async (value) => {
      const [list, config, preference] = await Promise.all([
        value.workspace.projects(), value.settings(),
        value.metadata.get<{ projectId?: string; appearance?: AppearanceMode }>('preferences', 'workbench'),
      ]);
      if (!mounted) return;
      runtimeRef.current = value; setRuntime(value); setProjects(list); setSettings(config);
      if (preference?.appearance) useWorkbenchUi.getState().setAppearance(preference.appearance);
      const selected = preference?.projectId && list.some((item) => item.id === preference.projectId) ? preference.projectId : list[0]?.id;
      useWorkbenchUi.getState().selectProject(selected);
      if (value.workspace.recoveryIssues.length) setError(value.workspace.recoveryIssues.join('\n'));
    }).catch(() => { if (mounted) setError('暂时无法打开本地资料。请保留本地数据后重新打开应用。'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; cancellation.current?.(); };
  }, []);

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
    if (Platform.OS !== 'web' || !dirty) return;
    const handle = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handle);
    return () => window.removeEventListener('beforeunload', handle);
  }, [dirty]);

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
      if (ui.projectId) drafts.current[ui.projectId] = { text: prompt, attachment };
      const draft = drafts.current[id];
      setEditor(undefined); setAttachment(draft?.attachment); setPrompt(draft?.text ?? ''); setSheet(undefined); ui.selectProject(id);
    });
  }

  function closeEditor() { guard(() => { setEditor(undefined); }); }

  async function createProject() {
    if (!runtime || !projectName.trim()) return;
    await action(async () => {
      const created = await runtime.workspace.create(projectName);
      if (ui.projectId) drafts.current[ui.projectId] = { text: prompt, attachment };
      setEditor(undefined); setPrompt(''); setAttachment(undefined);
      setSheet(undefined); setProjectName(''); ui.selectProject(created.id); await refresh(created.id);
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
    if (!runtime || !ui.projectId || !prompt.trim() || active) return;
      if (settings.mode === 'remote' && !await runtime.credentials.get()) {
        setSettingsDraft({ ...settings }); setSecret(''); setSheet('settings');
        throw new Error('请先填写模型服务的密钥。');
      }
      const projectId = ui.projectId!;
      const text = prompt.trim() + (attachment ? '\n\n参考文件：' + attachment : '');
      const started = await startAgent(runtime.workspace, projectId, text, settings,
        await runtime.credentials.get(), Crypto.randomUUID, (task) => setActive({ ...task, events: [...task.events] }));
      cancellation.current = started.cancel; setPrompt(''); setAttachment(undefined); ui.selectTab('agent');
      void started.done.then(async (task) => {
        await refresh(useWorkbenchUi.getState().projectId);
        setActive(undefined); cancellation.current = undefined;
        if (task.error) setError(task.error);
      }).catch(() => {
        setActive(undefined); cancellation.current = undefined; setError('任务状态保存失败，请重新打开应用恢复。');
      });
  }

  async function submit() {
    if (dirty) {
      setConfirmation({ title: '先保存修改再发送？', description: 'Agent 将基于最新的资料执行任务。先保存正在编辑的文件。',
        label: '保存并发送', perform: async () => { await persistEditor(); await beginTask(); } });
      return;
    }
    await action(beginTask);
  }

  async function openSettings() {
    if (!runtime) return;
    await action(async () => {
      setConnectionResult('');
      setSettingsDraft({ ...settings }); setSecret(await runtime.credentials.get()); setSheet('settings');
    });
  }

  function updateSettingsDraft(value: ModelSettings) {
    setConnectionResult(''); setError('');
    setSettingsDraft(value.mode === 'remote' && settingsDraft.mode !== 'remote' && !value.baseUrl ? { ...deepseekSettings, ...value,
      baseUrl: deepseekSettings.baseUrl, model: deepseekSettings.model, imageInput: true } : value);
  }

  function updateSecret(value: string) { setSecret(value); setConnectionResult(''); setError(''); }

  async function checkConnection() {
    if (active) return;
    await action(async () => {
      setConnectionResult(''); setTestingConnection(true);
      try { setConnectionResult(await testModelConnection(settingsDraft, secret)); }
      finally { setTestingConnection(false); }
    });
  }

  async function saveSettings() {
    if (!runtime) return;
    await action(async () => {
      if (settingsDraft.mode === 'remote') {
        validateConnection(settingsDraft, secret);
      }
      const config = { ...settingsDraft, baseUrl: settingsDraft.baseUrl.trim().replace(/\/+$/, ''), model: settingsDraft.model.trim() };
      await runtime.credentials.set(secret.trim());
      await runtime.metadata.put('settings', 'model', config);
      setSettings(config); setSecret(''); setSheet(undefined); setNotice('设置已保存。');
    });
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
    ...ui, runtime, projects, selectedProject, files, versions, tasks, active, projectActive, operations, loading, projectLoading, busy,
    error, notice, setError, settings, settingsDraft, setSettingsDraft: updateSettingsDraft, secret, setSecret: updateSecret, editor, setEditor, dirty,
    connectionResult, testingConnection, checkConnection,
    sheet, setSheet, projectName, setProjectName, prompt, setPrompt, attachment, setAttachment, review, setReview,
    confirmation, setConfirmation, selectProject, createProject, newProject, openFile, newFile, closeEditor, importFile, submit, renameEditor,
    stop: () => cancellation.current?.(), openSettings, saveSettings, reviewTask, reviewVersion, confirmRestore, deleteEditor,
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
