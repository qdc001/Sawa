import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User, Workspace, Pipeline } from '../lib/api';

interface AuthStore {
  token: string | null;
  user: User | null;
  workspace: Workspace | null;
  isAuthenticated: boolean;
  login: (token: string, user: User, workspace: Workspace) => void;
  logout: () => void;
  updateUser: (user: Partial<User>) => void;
  updateWorkspace: (workspace: Partial<Workspace>) => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      workspace: null,
      isAuthenticated: false,
      login: (token, user, workspace) => {
        localStorage.setItem('token', token);
        set({ token, user, workspace, isAuthenticated: true });
      },
      logout: () => {
        localStorage.removeItem('token');
        set({ token: null, user: null, workspace: null, isAuthenticated: false });
      },
      updateUser: (updates) => set((state) => ({ user: state.user ? { ...state.user, ...updates } : null })),
      updateWorkspace: (updates) => set((state) => ({ workspace: state.workspace ? { ...state.workspace, ...updates } : null })),
    }),
    { name: 'auth-store', partialize: (state) => ({ token: state.token, user: state.user, workspace: state.workspace, isAuthenticated: state.isAuthenticated }) }
  )
);

interface UIStore {
  sidebarOpen: boolean;
  activePipelineId: string | null;
  globalSearchQuery: string;
  toggleSidebar: () => void;
  setActivePipeline: (id: string) => void;
  setGlobalSearchQuery: (q: string) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: true,
  activePipelineId: null,
  globalSearchQuery: '',
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setActivePipeline: (id) => set({ activePipelineId: id }),
  setGlobalSearchQuery: (q) => set({ globalSearchQuery: q }),
}));

interface PipelineStore {
  pipelines: Pipeline[];
  setPipelines: (pipelines: Pipeline[]) => void;
  updatePipeline: (pipeline: Pipeline) => void;
}

export const usePipelineStore = create<PipelineStore>((set) => ({
  pipelines: [],
  setPipelines: (pipelines) => set({ pipelines }),
  updatePipeline: (pipeline) => set((state) => ({
    pipelines: state.pipelines.map((p) => (p.id === pipeline.id ? pipeline : p)),
  })),
}));
