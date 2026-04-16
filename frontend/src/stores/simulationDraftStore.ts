import { create } from 'zustand'

export interface SimulationDraft {
  name: string
  seed_content: string
  simulation_requirement: string
  max_rounds: number
  source?: 'analysis' | 'manual'
  source_task_id?: string
  graph_context?: {
    graph_id?: string
    graph_source_mode?: string
    graph_queries?: string[]
    graph_facts?: string[]
    analysis_stage?: string
    analysis_quality?: string
    analysis_summary?: string
    news_digest?: Array<{
      title?: string
      summary?: string
      source?: string
      country?: string
      published_at?: string
      signal_type?: string
    }>
    selected_digest?: {
      title?: string
      summary?: string
      source?: string
      country?: string
      published_at?: string
      signal_type?: string
    } | null
    graph_edges?: Array<{
      source?: string
      target?: string
      type?: string
      fact?: string
      weight?: number
    }>
    graph_nodes?: Array<{
      id?: string
      name?: string
      type?: string
      summary?: string
    }>
  }
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
