import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppServices, WorkspaceOperationSummary } from '@/application/services';
import type { Project } from '@/core/projects';
import type { ProjectFile } from '@/core/workspace/types';
import type { Version } from '@/core/git/types';
import type { GitStatus } from '@/core/git/contracts';
import type { RunView, RunSummary } from '@/core/runs/queries';
import type { Conversation } from '@/core/conversations/types';
import { emptyConversationState } from '@/core/conversations/types';
import { emptyModelConfiguration } from '@/core/models/types';
import { getAppServices, rebuildDevelopmentData } from '@/bootstrap';
import { publicError } from '@/core/errors';
import { useWorkbenchUi } from '@/shared/workbench-state';
import type { EditorSession, WorkbenchUi } from './types';

interface DataContext { ui: WorkbenchUi; runtimeRef: { current: AppServices | undefined }; editorRef: EditorSession['editorRef']; setEditor: EditorSession['setEditor']; installConversation(value: Conversation): void; setError(value: string): void }
export function useWorkbenchData(context: DataContext) {
  const { ui, runtimeRef, editorRef, setEditor, installConversation, setError } = context;
  const [runtime, setRuntime] = useState<AppServices>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [versionCursor, setVersionCursor] = useState<string>();
  const [versionsBusy, setVersionsBusy] = useState(false);
  const versionHistory = useRef<{ projectId?: string; rows: Version[]; cursor?: string; paging: boolean }>({ rows: [], paging: false });
  const [gitStatus, setGitStatus] = useState<GitStatus>();
  const [snapshotProjectId, setSnapshotProjectId] = useState<string>();
  const [tasks, setTasks] = useState<RunSummary[]>([]);
  const [taskCursor, setTaskCursor] = useState<string>();
  const [taskScope, setTaskScope] = useState('');
  const [historyBusy, setHistoryBusy] = useState(false);
  const historyRequest = useRef(0);
  const invalidateHistory = useCallback(() => { historyRequest.current++; }, []);
  const history = useRef<{ scope: string; rows: RunSummary[]; cursor?: string; paging: boolean }>({ scope: '', rows: [], paging: false });
  const [operations, setOperations] = useState<WorkspaceOperationSummary[]>([]);
  const [configuration, setConfiguration] = useState(emptyModelConfiguration());
  const [conversationState, setConversationState] = useState(emptyConversationState());
  const [loading, setLoading] = useState(true);
  const [projectLoading, setProjectLoading] = useState(false);
  const [formatMismatch, setFormatMismatch] = useState(false);
  const [startupRevision, setStartupRevision] = useState(0);
  const [active, setActive] = useState<RunView>();
  const [runs, setRuns] = useState<readonly RunView[]>([]);
  const refreshId = useRef(0);
  const loadOlderVersions = async () => {
    const value = runtimeRef.current; const projectId = useWorkbenchUi.getState().projectId;
    const cursor = versionHistory.current.cursor;
    if (!value || !projectId || !cursor || versionsBusy) return;
    versionHistory.current.paging = true; setVersionsBusy(true);
    try {
      const page = await value.workspace.historyPage(projectId, { cursor });
      if (useWorkbenchUi.getState().projectId !== projectId || versionHistory.current.cursor !== cursor) return;
      const rows = [...versionHistory.current.rows, ...page.versions.filter(version => !versionHistory.current.rows.some(item => item.oid === version.oid))];
      versionHistory.current = { projectId, rows, cursor: page.cursor, paging: true }; setVersions(rows); setVersionCursor(page.cursor);
    } catch (error) { setError(publicError(error).message); }
    finally { setVersionsBusy(false); }
  };

  const refreshRuns = useCallback(async (projectId: string, conversationId?: string) => {
    const value = runtimeRef.current; if (!value || !conversationId) return;
    const request = ++historyRequest.current;
    const page = await value.runs.list({ projectId, conversationId });
    const selected = useWorkbenchUi.getState();
    if (request !== historyRequest.current || selected.projectId !== projectId || selected.conversationId !== conversationId) return;
    const scope = projectId + '/' + conversationId;
    const previous = history.current;
    const rows = previous.scope === scope && previous.paging ? [...page.runs, ...previous.rows.filter(run => !page.runs.some(item => item.id === run.id))]
      .sort((a, b) => b.admissionSequence - a.admissionSequence) : page.runs;
    const cursor = previous.scope === scope && previous.paging ? previous.cursor : page.cursor;
    history.current = { scope, rows, cursor, paging: previous.scope === scope && previous.paging };
    setTasks(rows); setTaskCursor(cursor); setTaskScope(scope);
  }, [runtimeRef]);
  const loadOlderRuns = async () => {
    const selected = useWorkbenchUi.getState(); const value = runtimeRef.current;
    if (!value || !selected.projectId || !selected.conversationId || !taskCursor || historyBusy) return;
    const scope = selected.projectId + '/' + selected.conversationId; const cursor = taskCursor;
    history.current.paging = true; setHistoryBusy(true);
    try {
      const page = await value.runs.list({ projectId: selected.projectId, conversationId: selected.conversationId, cursor: taskCursor });
      if (history.current.scope !== scope || history.current.cursor !== cursor) return;
      const rows = [...history.current.rows, ...page.runs.filter(run => !history.current.rows.some(item => item.id === run.id))];
      history.current = { scope, rows, cursor: page.cursor, paging: true }; setTasks(rows); setTaskCursor(page.cursor);
    } catch (error) { setError(publicError(error).message); }
    finally { setHistoryBusy(false); }
  };

  const refresh = useCallback(async (projectId?: string) => {
    const value = runtimeRef.current;
    if (!value) return;
    const request = ++refreshId.current;
    if (!projectId) { const nextProjects = await value.workspace.projects(); if (request === refreshId.current) setProjects(nextProjects); return; }
    const open = editorRef.current;
    const [snapshot, nextProjects] = await Promise.all([
      value.workspace.snapshot(projectId, open?.projectId === projectId && !open.fresh ? open.path : undefined), value.workspace.projects(),
    ]);
    if (request !== refreshId.current || useWorkbenchUi.getState().projectId !== projectId) return;
    setProjects(nextProjects); setFiles(snapshot.files.filter((file) => file.path !== 'project.json'));
    const previous = versionHistory.current;
    const paging = previous.projectId === projectId && previous.paging;
    const rows = paging ? [...snapshot.versions, ...previous.rows.filter(version => !snapshot.versions.some(item => item.oid === version.oid))] : snapshot.versions;
    const cursor = paging ? previous.cursor : snapshot.historyCursor;
    versionHistory.current = { projectId, rows, cursor, paging }; setVersions(rows); setVersionCursor(cursor);
    setGitStatus(snapshot.gitStatus); setOperations(snapshot.operations); setSnapshotProjectId(projectId);
    const document = editorRef.current;
    if (document && document.projectId === projectId && !document.fresh && open?.identity === document.identity && open.revision === document.revision) {
      const current = snapshot.files.find((file) => file.path === document.path);
      if (current?.revision !== document.revision) {
        const modified = document.text !== document.savedText || document.name !== document.savedName;
        if (modified) { const next = { ...document, externalChanged: true }; setEditor(next); }
        else if (!current) { setEditor(undefined); }
        else if (snapshot.preview?.path === document.path) {
          const latest = snapshot.preview;
          const next = { ...document, text: latest.content, savedText: latest.content, revision: latest.revision, externalChanged: false };
          setEditor(next);
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
      runtimeRef.current = value; setRuntime(value); setProjects(list); setConfiguration(value.models.getSnapshot()); setConversationState(value.conversations.getSnapshot()); setActive(value.agent.getSnapshot().active); setRuns(value.agent.getSnapshot().runs ?? []);
      if (preference?.appearance) useWorkbenchUi.getState().setAppearance(preference.appearance);
      const selected = preference?.projectId && list.some((item) => item.id === preference.projectId) ? preference.projectId : list[0]?.id;
      const conversation = selected ? await value.conversations.ensureProject(selected) : undefined;
      if (!mounted) return;
      if (conversation) installConversation(conversation);
      useWorkbenchUi.getState().selectProject(selected, conversation?.id);
      if (value.workspace.recoveryIssues.length) setError(value.workspace.recoveryIssues.join('\n'));
    }).catch(error => { if (mounted) { const safe = publicError(error); setFormatMismatch(safe.code === 'DATA_FORMAT'); setError(safe.message); } })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [installConversation, runtimeRef, setError, startupRevision]);

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
      const state = runtime.agent.getSnapshot(); setActive(state.active); setRuns(state.runs ?? []);
      // Only recorded workspace notifications refresh files/Git. A run state
      // or text delta is not evidence that the project contents changed.
      if (state.error || (state.completed?.error && state.completed.projectId === useWorkbenchUi.getState().projectId)) setError(state.error ?? state.completed?.error?.message ?? '');
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
    if (!runtime || !ui.projectId || !ui.conversationId) return;
    history.current = { scope: ui.projectId + '/' + ui.conversationId, rows: [], paging: false };
    void refreshRuns(ui.projectId, ui.conversationId).catch(error => setError(publicError(error).message));
    const unsubscribe = runtime.runs.subscribe(change => {
      const selected = useWorkbenchUi.getState();
      if (change.projectId === selected.projectId && change.conversationId === selected.conversationId && change.runId === change.rootRunId)
        void refreshRuns(change.projectId, change.conversationId).catch(error => setError(publicError(error).message));
    });
    return () => { invalidateHistory(); unsubscribe(); };
  }, [runtime, ui.projectId, ui.conversationId, refreshRuns, setError, invalidateHistory]);

  useEffect(() => {
    if (!runtime) return;
    void runtime.preferences.saveWorkbench({ projectId: ui.projectId, appearance: ui.appearance }).catch(() => {});
  }, [runtime, ui.projectId, ui.appearance]);

  const rebuildData = async () => {
    await rebuildDevelopmentData();
    setError(''); setFormatMismatch(false); setLoading(true); setStartupRevision(value => value + 1);
  };
  const selectedProjectView = useMemo(() => snapshotProjectId === ui.projectId ? { files, versions, versionCursor, gitStatus, operations } :
    { files: [], versions: [], versionCursor: undefined, gitStatus: undefined, operations: [] },
  [snapshotProjectId, ui.projectId, files, versions, versionCursor, gitStatus, operations]);
  const selectedTasks = useMemo(() => taskScope === ui.projectId + '/' + ui.conversationId ? tasks : [], [taskScope, ui.projectId, ui.conversationId, tasks]);
  return { runtime, projects, ...selectedProjectView, versionsBusy, loadOlderVersions, tasks: selectedTasks, taskCursor: taskScope === ui.projectId + '/' + ui.conversationId ? taskCursor : undefined,
    historyBusy, loadOlderRuns, configuration, conversationState, loading, projectLoading: projectLoading || (!!ui.projectId && snapshotProjectId !== ui.projectId), active, runs, refresh, formatMismatch, rebuildData };
}
