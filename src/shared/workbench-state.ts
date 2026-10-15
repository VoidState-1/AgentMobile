import { create } from 'zustand';

export type AppearanceMode = 'system' | 'light' | 'dark';
export type WorkbenchTab = 'agent' | 'files' | 'history' | 'settings';

interface WorkbenchUi {
  projectId?: string;
  conversationId?: string;
  tab: WorkbenchTab;
  appearance: AppearanceMode;
  commitDrafts: Record<string, string>;
  setCommitDraft: (projectId: string, text: string) => void;
  selectProject: (projectId?: string, conversationId?: string) => void;
  selectConversation: (conversationId: string) => void;
  selectTab: (tab: WorkbenchTab) => void;
  setAppearance: (appearance: AppearanceMode) => void;
}

export const useWorkbenchUi = create<WorkbenchUi>(set => ({
  tab: 'agent',
  appearance: 'system',
  commitDrafts: {},
  setCommitDraft: (projectId, text) =>
    set(state => ({ commitDrafts: { ...state.commitDrafts, [projectId]: text } })),
  selectProject: (projectId, conversationId) => set({ projectId, conversationId, tab: 'agent' }),
  selectConversation: conversationId => set({ conversationId, tab: 'agent' }),
  selectTab: tab => set({ tab }),
  setAppearance: appearance => set({ appearance }),
}));
