import { useCallback, useRef, useState, type SetStateAction } from 'react';
import type { EditorDocument, EditorSession } from './types';

export function useEditorSession(): EditorSession {
  const [editor, setEditorState] = useState<EditorDocument>();
  const editorRef = useRef<EditorDocument | undefined>(undefined);
  const setEditor = useCallback((value: SetStateAction<EditorDocument | undefined>) => {
    const next = typeof value === 'function' ? value(editorRef.current) : value;
    editorRef.current = next;
    setEditorState(next);
  }, []);
  const dirty =
    !!editor &&
    (editor.fresh || editor.text !== editor.savedText || editor.name !== editor.savedName);
  return { editor, editorRef, setEditor, dirty };
}
