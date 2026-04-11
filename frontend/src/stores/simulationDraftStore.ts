import { create } from 'zustand'

export interface SimulationDraft {
  name: string
  seed_content: string
  simulation_requirement: string
  max_rounds: number
  source?: 'analysis' | 'manual'
  source_task_id?: string
  country_context?: {
    iso: string
    country_name: string
    score: number
    level: string
    news_count: number
    signal_count: number
    focal_count: number
    latest_activity?: string | null
    top_signal_types?: string[]
    narrative?: string
    top_headlines?: string[]
  }
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
