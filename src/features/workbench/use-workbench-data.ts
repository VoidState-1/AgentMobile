import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppServices, WorkspaceOperationSummary } from '@/application/services';
import type { Project } from '@/core/projects/types';
import type { ProjectFile } from '@/core/workspace/types';
import type { Version } from '@/core/git/types';
import type { GitStatus } from '@/core/git/contracts';
import type { TaskRecord } from '@/core/runs/types';
import type { Conversation } from '@/core/conversations/types';
import { emptyConversationState } from '@/core/conversations/types';
import { emptyModelConfiguration } from '@/core/models/types';
import { getAppServices } from '@/bootstrap';
import { useWorkbenchUi } from '@/shared/state/workbench';
import type { EditorSession, WorkbenchUi } from './types';

interface DataContext { ui: WorkbenchUi; runtimeRef: { current: AppServices | undefined }; editorRef: EditorSession['editorRef']; setEditor: EditorSession['setEditor']; installConversation(value: Conversation): void; setError(value: string): void }
export function useWorkbenchData(context: DataContext) {
  const { ui, runtimeRef, editorRef, setEditor, installConversation, setError } = context;
  const [runtime, setRuntime] = useState<AppServices>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [gitStatus, setGitStatus] = useState<GitStatus>();
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [operations, setOperations] = useState<WorkspaceOperationSummary[]>([]);
  const [configuration, setConfiguration] = useState(emptyModelConfiguration());
  const [conversationState, setConversationState] = useState(emptyConversationState());
  const [loading, setLoading] = useState(true);
  const [projectLoading, setProjectLoading] = useState(false);
  const [active, setActive] = useState<TaskRecord>();
  const refreshId = useRef(0);

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
    setVersions(snapshot.versions); setGitStatus(snapshot.gitStatus); setTasks(nextTasks); setOperations(snapshot.operations);
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
  }, [setEditor, editorRef, runtimeRef]);

  useEffect(() => {
    let mounted = true;
    getAppServices().then(async (value) => {
      const [list, preference] = await Promise.all([
        value.workspace.projects(),
        value.preferences.getWorkbench(),
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
  }, [installConversation, runtimeRef, setError]);

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
  }, [runtime, refresh, setError]);

  useEffect(() => {
    if (!runtime || !ui.projectId) return;
    let current = true;
    Promise.resolve().then(() => { if (current) setProjectLoading(true); });
    refresh(ui.projectId).catch(() => { if (current) setError('读取项目失败，请重新打开项目。'); })
      .finally(() => { if (current) setProjectLoading(false); });
    return () => { current = false; };
  }, [runtime, ui.projectId, refresh, setError]);

  useEffect(() => {
    if (!runtime) return;
    void runtime.preferences.saveWorkbench({ projectId: ui.projectId, appearance: ui.appearance }).catch(() => {});
  }, [runtime, ui.projectId, ui.appearance]);

  return { runtime, projects, files, versions, gitStatus, tasks, operations, configuration, conversationState, loading, projectLoading, active, refresh };
}
