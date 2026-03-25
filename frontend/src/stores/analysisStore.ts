/**
 * 舆情分析全局状态
 * 使用 zustand 存储分析结果，切换路由不会丢失
 */
import { create } from 'zustand'

export interface AnalysisResult {
  task_id: string
  status: string
  query_report?: string
  html_report?: string
  error?: string
}

interface AnalysisState {
  result: AnalysisResult | null
  setResult: (data: AnalysisResult | null) => void
  clearResult: () => void
}

export const useAnalysisStore = create<AnalysisState>((set) => ({
  result: null,
  setResult: (data) => set({ result: data }),
  clearResult: () => set({ result: null }),
}))
