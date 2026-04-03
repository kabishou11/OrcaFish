/**
 * 情报全局状态
 * 分析结果 → 信号注入 → 情报地球
 */
import { create } from 'zustand'

export interface InjectedSignal {
  id: string
  type: string
  lat?: number
  lon?: number
  intensity?: number
  timestamp?: string
  description?: string
  source: 'analysis' | 'live'
  query?: string  // 来源议题
}

interface IntelligenceState {
  injectedSignals: InjectedSignal[]
  injectSignal: (signal: InjectedSignal) => void
  clearInjected: () => void
}

export const useIntelligenceStore = create<IntelligenceState>((set) => ({
  injectedSignals: [],
  injectSignal: (signal) =>
    set((s) => ({
      injectedSignals: [
        { ...signal, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` },
        ...s.injectedSignals,
      ].slice(0, 100),
    })),
  clearInjected: () => set({ injectedSignals: [] }),
}))
