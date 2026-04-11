/**
 * 舆情分析全局状态
 * 使用 zustand 存储分析结果，切换路由不会丢失
 */
import { create } from 'zustand'

export interface AnalysisResult {
  task_id: string
  status: string
  progress?: number
  data_quality?: string
  degraded_reason?: string | null
  ui_message?: string | null
  fallback_used?: boolean
  source_count?: number
  matched_terms?: string[]
  sentiment_hint?: Record<string, number>
  news_digest?: Array<{
    title: string
    summary: string
    source: string
    country: string
    published_at: string
    signal_type: string
  }>
  agent_status?: Record<string, string>
  agent_metrics?: Record<string, {
    key: string
    label: string
    status: string
    progress: number
    source_count: number
    summary: string
    fallback_used: boolean
    updated_at?: string | null
  }>
  sections?: Array<{
    key: string
    title: string
    order: number
    status: string
    summary: string
    content: string
    source_count?: number
    fallback_used?: boolean
    updated_at?: string | null
  }>
  timeline?: Array<{
    key: string
    stage: string
    title: string
    detail: string
    status: string
    created_at: string
  }>
  last_update_at?: string | null
  query_report?: string
  media_report?: string
  insight_report?: string
  final_report?: string
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
