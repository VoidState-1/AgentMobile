import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { AppState } from 'react-native';
import type { AppServices } from '@/application/services';
import { publicError } from '@/core/errors';
import type { EditorDraft } from '@/core/documents/state';
import type { DocumentEditorHandle } from '@/features/document/document-host';
import type { EditorDocument, EditorSession } from './types';

export function useEditorSession(
  runtimeRef: { current: AppServices | undefined },
  setError: (message: string) => void,
): EditorSession {
  const [editor, setEditorState] = useState<EditorDocument>();
  const editorRef = useRef<EditorDocument | undefined>(undefined);
  const editorPort = useRef<DocumentEditorHandle | null>(null);
  const writes = useRef(Promise.resolve());
  const versions = useRef(new Map<string, number>());
  const failure = useRef<unknown>(undefined);
  const queueDraft = useCallback(
    (document: EditorDocument, clear = false) => {
      if (document.kind !== 'text' || document.unavailableReason) return;
      const api = runtimeRef.current;
      if (!api) return;
      const key = document.projectId + '/' + document.draftPath;
      const hasDraft =
        !clear &&
        (document.fresh ||
          document.text !== document.savedText ||
          document.name !== document.savedName ||
          document.editState.regions.length ||
          document.editState.mode === 'full');
      const draft: EditorDraft | null = hasDraft
        ? {
            format: 1,
            name: document.name,
            fresh: document.fresh,
            baseRevision: document.revision,
            lineEnding: document.lineEnding,
            state: { ...document.editState, base: document.savedText, text: document.text },
            pendingSave: document.pendingSave,
            saveOperationId: document.saveOperationId,
            savePath: document.savePath,
          }
        : null;
      writes.current = writes.current
        .catch(() => {})
        .then(async () => {
          const record = await api.workspace.saveEditorDraft(
            document.projectId,
            document.draftPath,
            draft,
            versions.current.get(key) ?? document.draftRevision,
          );
          versions.current.set(key, record.revision);
          failure.current = undefined;
        })
        .catch(error => {
          failure.current = error;
          setError('文件草稿尚未保留：' + publicError(error).message);
        });
    },
    [runtimeRef, setError],
  );
  const setEditor = useCallback(
    (value: SetStateAction<EditorDocument | undefined>) => {
      const previous = editorRef.current;
      const next = typeof value === 'function' ? value(editorRef.current) : value;
      if (next === previous) return;
      if (next && (next.identity !== previous?.identity || next.draftPath !== previous.draftPath)) {
        const key = next.projectId + '/' + next.draftPath;
        versions.current.set(key, Math.max(versions.current.get(key) ?? 0, next.draftRevision));
      }
      editorRef.current = next;
      setEditorState(next);
      if (next) queueDraft(next);
      if (
        previous &&
        (!next || previous.projectId !== next.projectId || previous.draftPath !== next.draftPath)
      )
        queueDraft(previous, true);
    },
    [queueDraft],
  );
  const flushEditorDraft = useCallback(async () => {
    await writes.current;
    if (failure.current) throw failure.current;
  }, []);
  const flushEditor = useCallback(async () => {
    if (
      editorRef.current?.kind === 'text' &&
      !editorRef.current.unavailableReason &&
      editorPort.current
    )
      await editorPort.current.flush();
    await flushEditorDraft();
  }, [flushEditorDraft]);
  const forgetEditor = useCallback(async () => {
    const document = editorRef.current;
    if (document) {
      queueDraft(document, true);
      await flushEditorDraft();
    }
    editorRef.current = undefined;
    setEditorState(undefined);
  }, [queueDraft, flushEditorDraft]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active')
        void flushEditor().catch(error => setError(publicError(error).message));
    });
    return () => subscription.remove();
  }, [flushEditor, setError]);
  const dirty =
    !!editor &&
    (editor.fresh || editor.text !== editor.savedText || editor.name !== editor.savedName);
  return {
    editor,
    editorRef,
    setEditor,
    dirty,
    editorPort,
    flushEditor,
    flushEditorDraft,
    forgetEditor,
  };
}
