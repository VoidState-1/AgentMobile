import type { SetStateAction } from 'react';
import type { AppServices } from '@/application/services';
import type { TaskRecord } from '@/core/runs/types';
import type { useWorkbenchUi } from '@/shared/state/workbench';

export interface EditorDocument {
  projectId: string; path: string; revision: string | null; text: string; savedText: string;
  name: string; savedName: string; image: boolean; reading: boolean; fresh: boolean; externalChanged?: boolean;
}
export interface ReviewFile { path: string; kind: string; before: string; after: string }
export interface Review { title: string; files: ReviewFile[]; restoreRef?: string; expectedHead?: string; task?: TaskRecord; area?: 'staged' | 'unstaged'; description?: string }
export type Confirmation = { title: string; description: string; label: string; danger?: boolean; perform: () => Promise<void>; afterPerform?: () => void; saveFirst?: boolean };
export type WorkbenchSheet = 'create' | 'projects' | 'settings' | 'attach' | 'rename' | 'models' | 'conversations' | 'conversation-name' | 'skills';
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
  editorRef: { current: EditorDocument | undefined };
  setEditor(value: SetStateAction<EditorDocument | undefined>): void;
  dirty: boolean;
}
