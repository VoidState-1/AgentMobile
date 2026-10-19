import type { SetStateAction } from 'react';
import type { AppServices, ReviewFile } from '@/application/services';
import type { RunView } from '@/core/runs/queries';
import type { FileKind } from '@/core/workspace/types';
import type { useWorkbenchUi } from '@/shared/workbench-state';
import type { EditorDraft, TextEditorState } from '@/core/documents/state';
import type { DocumentEditorHandle } from '@/features/document/document-host';

export interface EditorDocument {
  /** Distinguishes reopening the same path while an earlier save is in flight. */
  identity: string;
  projectId: string;
  path: string;
  revision: string | null;
  text: string;
  savedText: string;
  name: string;
  savedName: string;
  kind: FileKind;
  size: number;
  unavailableReason?: string;
  editState: Omit<TextEditorState, 'base' | 'text'>;
  lineEnding: EditorDraft['lineEnding'];
  draftPath: string;
  draftRevision: number;
  pendingSave?: TextEditorState;
  saveOperationId?: string;
  savePath?: string;
  saveUncertain?: boolean;
  fresh: boolean;
  externalChanged?: boolean;
}
export interface Review {
  title: string;
  files: ReviewFile[];
  restoreRef?: string;
  expectedHead?: string | null;
  task?: RunView;
  area?: 'staged' | 'unstaged';
  description?: string;
  initialPath?: string;
}
export type Confirmation = {
  title: string;
  description: string;
  label: string;
  danger?: boolean;
  perform: () => Promise<void>;
  afterPerform?: () => void;
  saveFirst?: boolean;
  saveLabel?: string;
};
export type WorkbenchSheet =
  'create' | 'attach' | 'rename' | 'models' | 'conversation-name' | 'skills';
export type WorkbenchUi = ReturnType<typeof useWorkbenchUi.getState>;
export interface ActionContext {
  runtime?: AppServices;
  ui: WorkbenchUi;
  action(work: () => Promise<void>): Promise<boolean>;
  refresh(projectId?: string): Promise<void>;
  setError(error: string): void;
  setNotice(notice: string): void;
  setConfirmation(value?: Confirmation): void;
}
export interface EditorSession {
  editor?: EditorDocument;
  editorRef: { readonly current: EditorDocument | undefined };
  setEditor(value: SetStateAction<EditorDocument | undefined>): void;
  dirty: boolean;
  editorPort: { current: DocumentEditorHandle | null };
  flushEditor(): Promise<void>;
  flushEditorDraft(): Promise<void>;
  forgetEditor(): Promise<void>;
}
