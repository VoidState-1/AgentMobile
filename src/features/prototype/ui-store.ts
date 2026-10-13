import { create } from 'zustand';

interface UiState {
  projectId?: string;
  tab: 'files' | 'agent' | 'history';
  selectProject: (projectId?: string) => void;
  selectTab: (tab: UiState['tab']) => void;
}

export const useUiStore = create<UiState>((set) => ({
  projectId: undefined, tab: 'files',
  selectProject: (projectId) => set({ projectId, tab: 'files' }),
  selectTab: (tab) => set({ tab }),
}));
