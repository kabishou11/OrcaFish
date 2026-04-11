/**
 * 情报全局状态
 * 分析结果 → 信号注入 → 情报地球
 */
import { create } from 'zustand'

export interface InjectedSignal {
  id: string
  type: string
  country?: string
  countryIso?: string
  lat?: number
  lon?: number
  intensity?: number
  timestamp?: string
  description?: string
  source: 'analysis' | 'live'
  query?: string  // 来源议题
}

export interface ObservationCountryContext {
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

interface IntelligenceState {
  injectedSignals: InjectedSignal[]
  activeCountryContext: ObservationCountryContext | null
  injectSignal: (signal: InjectedSignal) => void
  setActiveCountryContext: (context: ObservationCountryContext | null) => void
  clearInjected: () => void
}

export const useIntelligenceStore = create<IntelligenceState>((set) => ({
  injectedSignals: [],
  activeCountryContext: null,
  injectSignal: (signal) =>
    set((s) => ({
      injectedSignals: [
        {
          ...signal,
          id: signal.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
        ...s.injectedSignals,
      ].slice(0, 100),
    })),
  setActiveCountryContext: (context) => set({ activeCountryContext: context }),
  clearInjected: () => set({ injectedSignals: [], activeCountryContext: null }),
}))
