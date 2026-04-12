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

export interface IntelligenceCIIScore {
  score?: number
  level?: string
  name?: string
  components?: Record<string, number>
  monitoring?: Record<string, unknown>
}

export interface IntelligenceCIIResponse {
  scores?: Record<string, IntelligenceCIIScore>
  watchlist?: Array<Record<string, unknown>>
  monitor?: IntelligenceWMStatus
  timestamp?: string
}

export interface IntelligenceWMStatus {
  running: boolean
  last_poll: string | null
  poll_interval: number
  cii_threshold: number
  data_sources?: string[]
  cycle?: number
  active_countries?: number
  news_count?: number
  signal_count?: number
  focal_count?: number
  latest_event?: {
    id: string
    kind: 'news' | 'signal'
    country_iso?: string
    signal_type?: string
    title: string
    description: string
    source?: string
    timestamp: string
    severity?: string
  } | null
  briefing?: string
  watchlist?: Array<Record<string, unknown>>
}

export interface IntelligenceNewsItem {
  id: string
  title: string
  summary?: string
  source?: string
  url?: string
  country_iso?: string
  signal_type?: string
  published_at?: string
}

export interface IntelligenceFocalPoint {
  entity_id: string
  entity_type?: string
  focal_score: number
  urgency: string
  signal_types?: string[]
  top_headlines: string[]
  narrative: string
}

export interface IntelligenceSignalsResponse {
  clusters?: Array<Record<string, unknown>>
  regional?: Array<Record<string, unknown>>
  news?: IntelligenceNewsItem[]
  activity?: Array<Record<string, unknown>>
  watchlist?: Array<Record<string, unknown>>
  domain?: string
}

export interface IntelligenceOverviewCache {
  cii: IntelligenceCIIResponse | null
  wmStatus: IntelligenceWMStatus | null
  newsItems: IntelligenceNewsItem[]
  focalPoints: IntelligenceFocalPoint[]
  fetchedAt: number | null
}

export interface IntelligenceSignalsCacheEntry {
  payload: IntelligenceSignalsResponse | null
  fetchedAt: number | null
}

interface IntelligenceState {
  injectedSignals: InjectedSignal[]
  activeCountryContext: ObservationCountryContext | null
  overviewCache: IntelligenceOverviewCache
  signalsCache: Record<string, IntelligenceSignalsCacheEntry>
  injectSignal: (signal: InjectedSignal) => void
  setActiveCountryContext: (context: ObservationCountryContext | null) => void
  refreshOverviewCache: (force?: boolean) => Promise<void>
  warmOverviewCache: (force?: boolean) => Promise<void>
  refreshSignalsCache: (domain?: string, force?: boolean) => Promise<void>
  ensureWorldMonitorRunning: () => Promise<void>
  clearOverviewCache: () => void
  clearSignalsCache: () => void
  clearInjected: () => void
}

export const INTELLIGENCE_OVERVIEW_CACHE_TTL_MS = 15_000
export const INTELLIGENCE_SIGNALS_CACHE_TTL_MS = 12_000

export function isIntelligenceOverviewCacheFresh(
  fetchedAt: number | null,
  ttl = INTELLIGENCE_OVERVIEW_CACHE_TTL_MS,
): boolean {
  if (!fetchedAt) return false
  return Date.now() - fetchedAt <= ttl
}

function isIntelligenceSignalsCacheFresh(
  fetchedAt: number | null,
  ttl = INTELLIGENCE_SIGNALS_CACHE_TTL_MS,
): boolean {
  if (!fetchedAt) return false
  return Date.now() - fetchedAt <= ttl
}

const EMPTY_OVERVIEW_CACHE: IntelligenceOverviewCache = {
  cii: null,
  wmStatus: null,
  newsItems: [],
  focalPoints: [],
  fetchedAt: null,
}

let overviewRefreshPromise: Promise<void> | null = null
let monitorStartPromise: Promise<void> | null = null
const signalRefreshPromises = new Map<string, Promise<void>>()

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  const response = await fetch(url, init)
  if (!response.ok) return null
  return response.json() as Promise<T>
}

export const useIntelligenceStore = create<IntelligenceState>((set, get) => ({
  injectedSignals: [],
  activeCountryContext: null,
  overviewCache: EMPTY_OVERVIEW_CACHE,
  signalsCache: {},
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
  refreshOverviewCache: async (force = false) => {
    const { overviewCache } = get()
    if (
      !force
      && isIntelligenceOverviewCacheFresh(overviewCache.fetchedAt)
      && overviewCache.cii
      && overviewCache.wmStatus
    ) {
      return
    }

    if (overviewRefreshPromise) {
      return overviewRefreshPromise
    }

    overviewRefreshPromise = (async () => {
      const [cii, wmStatus, newsPayload, focalPayload] = await Promise.all([
        fetchJson<IntelligenceCIIResponse>('/api/intelligence/cii'),
        fetchJson<IntelligenceWMStatus>('/api/intelligence/world-monitor/status'),
        fetchJson<{ items?: IntelligenceNewsItem[] }>('/api/intelligence/news?limit=24'),
        fetchJson<{ items?: IntelligenceFocalPoint[] }>('/api/intelligence/focal-points'),
      ])

      if (!cii && !wmStatus && !newsPayload && !focalPayload) return

      set((state) => ({
        overviewCache: {
          cii: cii ?? state.overviewCache.cii,
          wmStatus: wmStatus ?? state.overviewCache.wmStatus,
          newsItems: newsPayload?.items ?? state.overviewCache.newsItems,
          focalPoints: focalPayload?.items ?? state.overviewCache.focalPoints,
          fetchedAt: Date.now(),
        },
      }))
    })().finally(() => {
      overviewRefreshPromise = null
    })

    return overviewRefreshPromise
  },
  warmOverviewCache: async (force = false) => {
    const { overviewCache } = get()
    if (
      !force
      && isIntelligenceOverviewCacheFresh(overviewCache.fetchedAt)
      && overviewCache.cii
      && overviewCache.wmStatus
    ) {
      return
    }

    if (overviewRefreshPromise) {
      return overviewRefreshPromise
    }

    overviewRefreshPromise = (async () => {
      const status = await fetchJson<IntelligenceWMStatus>('/api/intelligence/world-monitor/status')
      if (!status) return

      set((state) => ({
        overviewCache: {
          ...state.overviewCache,
          wmStatus: status,
          fetchedAt: state.overviewCache.fetchedAt,
        },
      }))
    })().finally(() => {
      overviewRefreshPromise = null
    })

    return overviewRefreshPromise
  },
  refreshSignalsCache: async (domain = 'all', force = false) => {
    const domainKey = domain || 'all'
    const cachedEntry = get().signalsCache[domainKey]
    if (
      !force
      && cachedEntry?.payload
      && isIntelligenceSignalsCacheFresh(cachedEntry.fetchedAt)
    ) {
      return
    }

    const existingPromise = signalRefreshPromises.get(domainKey)
    if (existingPromise) {
      return existingPromise
    }

    const requestUrl = domainKey === 'all'
      ? '/api/intelligence/signals'
      : `/api/intelligence/signals?domain=${encodeURIComponent(domainKey)}`

    const refreshPromise = (async () => {
      const payload = await fetchJson<IntelligenceSignalsResponse>(requestUrl)
      if (!payload) return

      set((state) => ({
        signalsCache: {
          ...state.signalsCache,
          [domainKey]: {
            payload,
            fetchedAt: Date.now(),
          },
        },
      }))
    })().finally(() => {
      signalRefreshPromises.delete(domainKey)
    })

    signalRefreshPromises.set(domainKey, refreshPromise)
    return refreshPromise
  },
  ensureWorldMonitorRunning: async () => {
    if (get().overviewCache.wmStatus?.running) {
      return
    }

    if (monitorStartPromise) {
      return monitorStartPromise
    }

    monitorStartPromise = (async () => {
      const response = await fetch('/api/intelligence/world-monitor/start', { method: 'POST' })
      if (!response.ok) return

      set((state) => ({
        overviewCache: {
          ...state.overviewCache,
          wmStatus: state.overviewCache.wmStatus
            ? { ...state.overviewCache.wmStatus, running: true }
            : { running: true, last_poll: null, poll_interval: 15, cii_threshold: 65 },
        },
      }))
    })().finally(() => {
      monitorStartPromise = null
    })

    return monitorStartPromise
  },
  clearOverviewCache: () => set({ overviewCache: EMPTY_OVERVIEW_CACHE }),
  clearSignalsCache: () => set({ signalsCache: {} }),
  clearInjected: () => set({ injectedSignals: [], activeCountryContext: null }),
}))
