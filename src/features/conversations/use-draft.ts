import { useCallback, useRef, useState } from 'react';
import type { AppServices } from '@/application/services';
import type { Conversation } from '@/core/conversations/types';

interface ComposerDraft { conversationId?: string; text: string; attachment?: string }
export function useConversationDraft(runtimeRef: { current: AppServices | undefined }, conversationId: string | undefined, setError: (value: string) => void) {
  const [composer, setComposer] = useState<ComposerDraft>({ text: '' });
  const composerRef = useRef<ComposerDraft>({ text: '' });
  const draftWrites = useRef(new Map<string, Promise<unknown>>());
  const [draftSaved, setDraftSaved] = useState(true);
  const [draftSaving, setDraftSaving] = useState(false);

  const installConversation = useCallback((conversation: Conversation) => {
    const draft = runtimeRef.current?.conversations.getSnapshot().drafts[conversation.id];
    const next = { conversationId: conversation.id, text: draft?.text ?? '', attachment: draft?.attachment };
    composerRef.current = next; setComposer(next); setDraftSaved(true); setDraftSaving(false);
  }, [runtimeRef]);

function writeComposer(next: ComposerDraft) {
    composerRef.current = next; setComposer(next); const value = runtimeRef.current;
    if (!value || !next.conversationId) return;
    setDraftSaved(false); setDraftSaving(true);
    const pending = value.conversations.saveDraft(next.conversationId, { text: next.text, attachment: next.attachment });
    draftWrites.current.set(next.conversationId, pending);
    void pending.then(() => { if (composerRef.current === next) { setDraftSaved(true); setDraftSaving(false); } }).catch(() => {
      if (composerRef.current === next) { setDraftSaved(false); setDraftSaving(false); }
      setError('草稿保存失败，请重试或复制输入内容后保留。');
    });
  }

function setPrompt(text: string) {
    if (composerRef.current.conversationId !== conversationId) return;
    writeComposer({ ...composerRef.current, text });
  }

function setAttachment(path?: string) {
    if (composerRef.current.conversationId !== conversationId) return;
    writeComposer({ ...composerRef.current, attachment: path });
  }

async function flushDraft(draft = composerRef.current) {
    const value = runtimeRef.current;
    if (!value || !draft.conversationId) return;
    await draftWrites.current.get(draft.conversationId)?.catch(() => {});
    const saved = await value.conversations.saveDraft(draft.conversationId, { text: draft.text, attachment: draft.attachment });
    if (composerRef.current === draft) { setDraftSaved(true); setDraftSaving(false); }
    return saved;
  }
  return { composer, composerRef, draftSaved, draftSaving, installConversation, writeComposer, setPrompt, setAttachment, flushDraft, clear: () => { const next = { conversationId, text: '' }; composerRef.current = next; setComposer(next); setDraftSaved(true); setDraftSaving(false); } };
}
