import type { SetStateAction } from 'react';
import type { AppServices, ReviewFile } from '@/application/services';
import type { RunView } from '@/core/runs/queries';
import type { FileKind } from '@/core/workspace/types';
import type { useWorkbenchUi } from '@/shared/workbench-state';

export interface EditorDocument {
  /** Distinguishes reopening the same path while an earlier save is in flight. */
  identity: symbol;
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
  reading: boolean;
  fresh: boolean;
  externalChanged?: boolean;
}
export interface Review {
  title: string;
  files: ReviewFile[];
  restoreRef?: string;
  expectedHead?: string;
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
}
