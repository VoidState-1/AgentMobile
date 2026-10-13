import { create } from 'zustand';

export type AppearanceMode = 'system' | 'light' | 'dark';
export type WorkbenchTab = 'agent' | 'files' | 'history';

interface WorkbenchUi {
  projectId?: string;
  tab: WorkbenchTab;
  appearance: AppearanceMode;
  selectProject: (projectId?: string) => void;
  selectTab: (tab: WorkbenchTab) => void;
  setAppearance: (appearance: AppearanceMode) => void;
}

export const useWorkbenchUi = create<WorkbenchUi>((set) => ({
  tab: 'agent', appearance: 'system',
  selectProject: (projectId) => set({ projectId, tab: 'agent' }),
  selectTab: (tab) => set({ tab }),
  setAppearance: (appearance) => set({ appearance }),
}));
