import { Buffer } from 'buffer';
import { randomUUID } from 'expo-crypto';
import type { RunView } from '@/core/runs/queries';
import { AppError, publicError } from '@/core/errors';
import {
  initialEditorState,
  validateEditorState,
  type TextEditorState,
} from '@/core/documents/state';
import type { ProjectFile } from '@/core/workspace/types';
import type { WorkbenchSheet, ActionContext, EditorSession } from './types';
import { safePath } from '@/core/workspace/path';
import { describeContent } from '@/core/workspace/content';
import { fileName } from '@/shared/format';
import {
  openedEditor,
  editorIdentity,
  stateOfEditor,
  withEditorState,
  editorStateFields,
  confirmedEditorSave,
} from './editor-model';

interface EditorContext extends ActionContext, EditorSession {
  active?: RunView;
  setSheet(value?: WorkbenchSheet): void;
  setAttachment(value?: string): void;
}
export function useEditorActions(context: EditorContext) {
  const {
    runtime,
    ui,
    action,
    refresh,
    setNotice,
    setConfirmation,
    editor,
    editorRef,
    setEditor,
    active,
    setSheet,
    setAttachment,
    setError,
    editorPort,
    flushEditor,
    flushEditorDraft,
    forgetEditor,
  } = context;
  async function commitEditor(
    identity: string,
    text: string,
    state: TextEditorState,
    nextState: TextEditorState,
  ) {
    const document = editorRef.current;
    if (!runtime || !document || document.identity !== identity)
      throw new AppError('CONFLICT', '文件会话已变化，保存已取消。');
    validateEditorState(state);
    validateEditorState(nextState);
    if (
      state.base !== document.savedText ||
      nextState.base !== text ||
      nextState.text !== state.text
    )
      throw new AppError('CONFLICT', '保存基线已变化，草稿已保留。');
    if (document.kind !== 'text' || document.unavailableReason)
      throw new AppError('VALIDATION', '当前文件不能编辑。');
    if (active?.projectId === document.projectId)
      throw new AppError('CONFLICT', '任务仍在运行，请停止或等待完成后保存。');
    const name = safePath(document.name.trim());
    if (name.includes('/')) throw new Error('请输入文件名称，不包含文件夹路径。');
    const target = document.fresh ? 'documents/' + name : document.path;
    const targetDraft =
      target === document.draftPath
        ? undefined
        : await runtime.workspace.editorDraft(document.projectId, target);
    const operationId =
      document.pendingSave?.base === text && document.savePath === target
        ? (document.saveOperationId ?? randomUUID())
        : randomUUID();
    setEditor(current =>
      current?.identity === identity
        ? {
            ...current,
            pendingSave: nextState,
            saveOperationId: operationId,
            savePath: target,
            saveUncertain: false,
          }
        : current,
    );
    await flushEditorDraft();
    const finish = async (current: Awaited<ReturnType<typeof runtime.workspace.preview>>) => {
      setEditor(latest =>
        latest?.identity === identity
          ? {
              ...withEditorState(latest, nextState),
              path: target,
              revision: current.revision,
              fresh: false,
              savedName: fileName(target),
              name: latest.name === document.name ? fileName(target) : latest.name,
              size: current.size,
              kind: current.kind,
              externalChanged: false,
              pendingSave: undefined,
              saveOperationId: undefined,
              savePath: undefined,
              saveUncertain: false,
              draftPath: target,
              draftRevision: targetDraft?.revision ?? latest.draftRevision,
            }
          : latest,
      );
      // A completed workspace write must be acknowledged even if its draft cleanup fails.
      await flushEditorDraft().catch(error =>
        setError('文件已保存，草稿清理失败：' + publicError(error).message),
      );
      setNotice('文件已保存，可在 Git 面板暂存并提交。');
      await refresh(ui.projectId).catch(error =>
        setError('文件已保存，列表刷新失败：' + publicError(error).message),
      );
    };
    try {
      if (document.fresh || text !== document.savedText)
        await runtime.workspace.writeText(
          document.projectId,
          target,
          Buffer.from(text.replace(/\n/g, document.lineEnding)),
          document.fresh ? null : document.revision,
          { operationId },
        );
      await finish(
        confirmedEditorSave(
          await runtime.workspace.preview(document.projectId, target),
          text.replace(/\n/g, document.lineEnding),
        ),
      );
    } catch (error) {
      const actual = await runtime.workspace
        .preview(document.projectId, target)
        .catch(() => undefined);
      if (actual?.kind === 'text' && actual.content === text.replace(/\n/g, document.lineEnding)) {
        await finish(actual);
        return;
      }
      const absent =
        document.fresh &&
        (await runtime.workspace.files(document.projectId).catch(() => undefined))?.every(
          file => file.path !== target,
        );
      if (actual || absent)
        setEditor(current =>
          current?.identity === identity
            ? {
                ...current,
                pendingSave: undefined,
                saveOperationId: undefined,
                savePath: undefined,
                externalChanged: actual
                  ? actual.revision !== document.revision
                  : current.externalChanged,
              }
            : current,
        );
      else
        setEditor(current =>
          current?.identity === identity ? { ...current, saveUncertain: true } : current,
        );
      throw error;
    }
  }
  const retryEditorSave = () =>
    action(async () => {
      const document = editorRef.current;
      if (!document?.pendingSave) return;
      await commitEditor(
        document.identity,
        document.pendingSave.base,
        stateOfEditor(document),
        document.pendingSave,
      );
      setEditor(current =>
        current?.identity === document.identity
          ? { ...current, identity: editorIdentity() }
          : current,
      );
    });
  function requestEditorMode(mode: TextEditorState['mode']) {
    const identity = editorRef.current?.identity;
    if (!identity) return;
    setConfirmation({
      title: '切换编辑方式前保存？',
      description: '当前修改尚未保存。可以保存后切换，或放弃这次修改。',
      label: '放弃并切换',
      danger: true,
      saveFirst: true,
      saveLabel: '保存并切换',
      perform: async () => {
        if (editorRef.current?.identity !== identity || !editorPort.current)
          throw new AppError('CONFLICT', '文件会话已变化，请重新选择编辑方式。');
        await editorPort.current.flush();
        const current = editorRef.current;
        if (current && current.text !== current.savedText) await editorPort.current.discard();
        await editorPort.current.mode(mode);
      },
    });
  }
  async function persistEditor(close = false) {
    await flushEditor();
    const document = editorRef.current;
    if (!document) return;
    if (editorPort.current) {
      await editorPort.current.save();
      const latest = editorRef.current;
      // A fresh empty document can be in reading mode with no open region.
      // Creating its file is still an explicit Save, not an editing gesture.
      if (latest?.identity === document.identity && latest.fresh)
        await commitEditor(
          latest.identity,
          latest.text,
          stateOfEditor(latest),
          initialEditorState(latest.text),
        );
    } else {
      const state = stateOfEditor(document);
      const next = initialEditorState(document.text);
      await commitEditor(document.identity, document.text, state, next);
    }
    await flushEditorDraft();
    if (close) await forgetEditor();
  }
  function guard(next: () => void) {
    void (async () => {
      await flushEditor();
      const document = editorRef.current;
      if (
        document &&
        (document.fresh ||
          document.text !== document.savedText ||
          document.name !== document.savedName)
      ) {
        setConfirmation({
          title: '有尚未保存的修改',
          description: '离开前保存文件，或放弃这次编辑。',
          label: '放弃修改',
          danger: true,
          saveFirst: true,
          perform: forgetEditor,
          afterPerform: next,
        });
      } else next();
    })().catch(error => setError(publicError(error).message));
  }
  function closeEditor() {
    guard(() => {
      void forgetEditor().catch(error => setError(publicError(error).message));
    });
  }
  async function installFile(file: ProjectFile) {
    if (!runtime || !ui.projectId) return;
    const [value, draft] = await Promise.all([
      runtime.workspace.preview(ui.projectId, file.path),
      runtime.workspace.editorDraft(ui.projectId, file.path),
    ]);
    setEditor(openedEditor(ui.projectId, file.path, value, draft));
  }
  async function openFile(file: ProjectFile) {
    guard(() => {
      void action(() => installFile(file));
    });
  }
  function newFile() {
    if (!runtime || !ui.projectId) return;
    guard(() => {
      void action(async () => {
        const path = '.new-document';
        const record = await runtime.workspace.editorDraft(ui.projectId!, path);
        const draft = record.draft;
        const state = draft?.state ?? initialEditorState('', true);
        setEditor({
          identity: editorIdentity(),
          projectId: ui.projectId!,
          path: 'documents/untitled.md',
          name: draft?.name ?? 'untitled.md',
          savedName: '',
          revision: null,
          ...editorStateFields(state),
          kind: 'text',
          size: 0,
          lineEnding: draft?.lineEnding ?? '\n',
          fresh: true,
          draftPath: path,
          draftRevision: record.revision,
          pendingSave: draft?.pendingSave,
          saveOperationId: draft?.saveOperationId,
          savePath: draft?.savePath,
        });
      });
    });
  }
  function reloadEditor() {
    const document = editorRef.current;
    if (!document || !runtime) return;
    setConfirmation({
      title: '重新载入文件？',
      description: '放弃当前草稿，读取文件的最新内容。',
      label: '放弃并重新载入',
      danger: true,
      perform: async () => {
        await forgetEditor();
        const files = await runtime.workspace.files(document.projectId);
        const file = files.find(file => file.path === document.path);
        if (!file) throw new Error('文件已被移除。');
        await installFile(file);
      },
    });
  }
  async function importFile(attach = false) {
    if (!runtime || !ui.projectId) return;
    await action(async () => {
      const selection = await runtime.io.pickFile();
      if (!selection) return;
      const kind = describeContent(selection.name, selection.bytes).kind;
      const path = (kind === 'text' ? 'documents/' : 'assets/') + safePath(selection.name);
      await runtime.workspace.write(ui.projectId!, path, selection.bytes, null, {
        message: '导入 ' + selection.name,
      });
      setNotice('已导入 ' + selection.name);
      await refresh(ui.projectId);
      if (attach) {
        setAttachment(path);
        setSheet(undefined);
      }
    });
  }

  function deleteEditor() {
    if (!runtime || !editor || editor.fresh) return;
    const document = editor;
    setConfirmation({
      title: '删除 ' + document.name + '？',
      description: '文件会从工作区移除，删除作为未暂存更改保留。',
      label: '删除文件',
      danger: true,
      perform: async () => {
        await runtime.workspace.remove(document.projectId, document.path, document.revision!);
        await forgetEditor();
        await refresh(ui.projectId);
        setNotice('文件已删除。');
      },
    });
  }

  async function renameEditor(name: string) {
    if (!runtime || !editor || editor.fresh) return;
    const document = editor;
    await action(async () => {
      const targetName = safePath(name.trim());
      if (targetName.includes('/')) throw new Error('请输入文件名称，不包含文件夹路径。');
      const target = document.path.slice(0, document.path.lastIndexOf('/') + 1) + targetName;
      await runtime.workspace.move(document.projectId, document.path, target, document.revision!);
      const current = await runtime.workspace.preview(document.projectId, target);
      const draft = await runtime.workspace.editorDraft(document.projectId, target);
      const saved = {
        ...document,
        path: target,
        name: targetName,
        savedName: targetName,
        draftPath: target,
        draftRevision: draft.revision,
        revision: current.revision,
        kind: current.kind,
        size: current.size,
        unavailableReason: current.unavailableReason,
      };
      const latest = editorRef.current;
      if (latest?.identity === document.identity) setEditor({ ...saved, text: latest.text });
      setSheet(undefined);
      await refresh(ui.projectId);
      setNotice('文件已重命名。');
    });
  }
  return {
    persistEditor,
    commitEditor,
    reloadEditor,
    retryEditorSave,
    requestEditorMode,
    guard,
    closeEditor,
    openFile,
    newFile,
    importFile,
    deleteEditor,
    renameEditor,
  };
}
