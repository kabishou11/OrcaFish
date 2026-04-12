/**
 * 舆情分析全局状态
 * 使用 zustand 存储分析结果，切换路由不会丢失
 */
import { create } from 'zustand'

const ANALYSIS_RESULT_STORAGE_KEY = 'orcafish-analysis-result'
const ANALYSIS_DRAFT_QUERY_STORAGE_KEY = 'orcafish-analysis-draft-query'

export interface AnalysisResult {
  task_id: string
  query?: string
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
  draftQuery: string
  setResult: (data: AnalysisResult | null) => void
  setDraftQuery: (query: string) => void
  clearResult: () => void
}

function readStoredResult(): AnalysisResult | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(ANALYSIS_RESULT_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as AnalysisResult
  } catch {
    return null
  }
}

function writeStoredResult(data: AnalysisResult | null) {
  if (typeof window === 'undefined') return
  try {
    if (data) {
      window.localStorage.setItem(ANALYSIS_RESULT_STORAGE_KEY, JSON.stringify(data))
    } else {
      window.localStorage.removeItem(ANALYSIS_RESULT_STORAGE_KEY)
    }
  } catch {
    // ignore storage failures
  }
}

function readStoredDraftQuery(): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(ANALYSIS_DRAFT_QUERY_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function writeStoredDraftQuery(query: string) {
  if (typeof window === 'undefined') return
  try {
    if (query) {
      window.localStorage.setItem(ANALYSIS_DRAFT_QUERY_STORAGE_KEY, query)
    } else {
      window.localStorage.removeItem(ANALYSIS_DRAFT_QUERY_STORAGE_KEY)
    }
  } catch {
    // ignore storage failures
  }
}

export const useAnalysisStore = create<AnalysisState>((set) => ({
  result: readStoredResult(),
  draftQuery: readStoredDraftQuery(),
  setResult: (data) => {
    writeStoredResult(data)
    if (data?.query) {
      writeStoredDraftQuery(data.query)
    }
    set((state) => ({ result: data, draftQuery: data?.query ?? state.draftQuery }))
  },
  setDraftQuery: (query) => {
    writeStoredDraftQuery(query)
    set({ draftQuery: query })
  },
  clearResult: () => {
    writeStoredResult(null)
    set({ result: null })
  },
}))
