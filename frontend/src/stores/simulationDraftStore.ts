import { create } from 'zustand'

export interface SimulationDraft {
  name: string
  seed_content: string
  simulation_requirement: string
  max_rounds: number
  source?: 'analysis' | 'manual'
  source_task_id?: string
}

interface SimulationDraftState {
  draft: SimulationDraft | null
  setDraft: (draft: SimulationDraft) => void
  clearDraft: () => void
}

export const useSimulationDraftStore = create<SimulationDraftState>((set) => ({
  draft: null,
  setDraft: (draft) => set({ draft }),
  clearDraft: () => set({ draft: null }),
}))
