import { useRouter, type Href } from 'expo-router';
import type { Confirmation, EditorSession, WorkbenchSheet } from './types';

interface DialogContext {
  action(work: () => Promise<void>): Promise<boolean>;
  guard(next: () => void): void;
  persistEditor(): Promise<void>;
  editor: Pick<EditorSession, 'setEditor' | 'editorRef'>;
  confirmation?: Confirmation;
  setConfirmation(value?: Confirmation): void;
  setSheet(value?: WorkbenchSheet): void;
}

/** Shared leave/confirm flow and configuration routes for every workbench entry. */
export function useDialogActions(context: DialogContext) {
  const router = useRouter();
  const { action, guard, persistEditor, editor, confirmation, setConfirmation, setSheet } = context;
  const openConfig = (path: Href) =>
    guard(() => {
      editor.setEditor(undefined);
      setSheet(undefined);
      requestAnimationFrame(() => router.push(path));
    });
  async function saveAndLeave() {
    const next = confirmation;
    const saved = await action(async () => {
      await persistEditor();
      const latest = editor.editorRef.current;
      if (latest && (latest.text !== latest.savedText || latest.name !== latest.savedName))
        throw new Error('保存期间又有新输入，请再次保存后离开。');
      await next?.perform();
      setConfirmation(undefined);
    });
    if (saved) next?.afterPerform?.();
    return saved;
  }
  async function confirm() {
    const next = confirmation;
    const done = await action(async () => {
      await next?.perform();
      setConfirmation(undefined);
    });
    if (done) next?.afterPerform?.();
  }
  return {
    saveAndLeave,
    confirm,
    openModelConfig: () => openConfig('/models'),
    openAgentSettings: () => openConfig('/settings/agent'),
    openMcpConfig: () => openConfig('/mcp'),
    openSkills: () => openConfig('/skills'),
  };
}
