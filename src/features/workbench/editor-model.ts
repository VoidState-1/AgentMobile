import type { FilePreview } from '@/application/services';
import {
  initialEditorState,
  normalizeText,
  textLineEnding,
  type EditorDraftRecord,
  type TextEditorState,
} from '@/core/documents/state';
import type { EditorDocument } from './types';
import { fileName } from '@/shared/format';
import { AppError } from '@/core/errors';

export function confirmedEditorSave(preview: FilePreview, expectedText: string): FilePreview {
  if (preview.kind !== 'text' || preview.unavailableReason || preview.content !== expectedText)
    throw new AppError('CONFLICT', '文件在保存后又有变化，草稿已保留，请核对最新内容。');
  return preview;
}

export const editorIdentity = () => `editor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const stateOfEditor = (document: EditorDocument): TextEditorState => ({
  ...document.editState,
  base: document.savedText,
  text: document.text,
});
export function editorStateFields(
  state: TextEditorState,
): Pick<EditorDocument, 'savedText' | 'text' | 'editState'> {
  const { base, text, ...editState } = state;
  return { savedText: base, text, editState };
}
export function withEditorState(document: EditorDocument, state: TextEditorState): EditorDocument {
  return { ...document, ...editorStateFields(state) };
}
export function openedEditor(
  projectId: string,
  path: string,
  value: FilePreview,
  record: EditorDraftRecord,
): EditorDocument {
  const text = value.kind === 'text' ? normalizeText(value.content) : value.content;
  const draft = value.kind === 'text' && !value.unavailableReason ? record.draft : null;
  const completed =
    draft?.pendingSave && draft.pendingSave.base.replace(/\n/g, draft.lineEnding) === value.content
      ? draft.pendingSave
      : undefined;
  const state = completed ?? draft?.state ?? initialEditorState(text);
  const currentBase =
    state.base === text &&
    (!draft ||
      !!completed ||
      draft.baseRevision === value.revision ||
      state.base.replace(/\n/g, draft.lineEnding) === value.content);
  return {
    identity: editorIdentity(),
    projectId,
    path,
    name: draft?.name ?? fileName(path),
    savedName: fileName(path),
    revision: currentBase ? value.revision : (draft?.baseRevision ?? value.revision),
    ...editorStateFields(state),
    lineEnding: draft?.lineEnding ?? textLineEnding(value.content),
    kind: value.kind,
    size: value.size,
    unavailableReason: value.unavailableReason,
    fresh: false,
    externalChanged: !currentBase,
    draftPath: path,
    draftRevision: record.revision,
    pendingSave: completed ? undefined : draft?.pendingSave,
    saveOperationId: completed ? undefined : draft?.saveOperationId,
    savePath: completed ? undefined : draft?.savePath,
  };
}
