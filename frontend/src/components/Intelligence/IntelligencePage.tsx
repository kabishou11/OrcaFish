import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  useIntelligenceStore,
  type IntelligenceSignalsResponse,
  type ObservationCountryContext,
} from '../../stores/intelligenceStore'
import { useSimulationDraftStore } from '../../stores/simulationDraftStore'
import WorkflowGuide, { type WorkflowGuideStep } from '../WorkflowGuide'

const CountryWorkbenchCard = lazy(() => import('../CountryWorkbenchCard'))
const FlatWorldMap = lazy(() => import('./FlatWorldMap'))

interface Signal {
  id: string
  type: string
  country?: string
  countryIso?: string
  lat?: number
  lon?: number
  intensity?: number
  timestamp?: string
  cii_score?: number
  description?: string
  source?: string
}

interface NewsItem {
  id: string
  title: string
  summary?: string
  source?: string
  url?: string
  country_iso?: string
  signal_type?: string
  published_at?: string
}

interface CIIScore {
  iso: string
  name?: string
  score: number
  level: string
  lat?: number
  lon?: number
  components?: Record<string, number>
  monitoring?: {
    signal_count?: number
    source_count?: number
    source_diversity?: number
    freshness?: number
    escalation?: number
    convergence_score?: number
    top_signal_types?: string[]
    top_headlines?: string[]
    drivers?: string[]
    rationale?: string
    last_event?: string | null
    new_events_15m?: number
    momentum?: string
  }
}

interface WMStatus {
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
}

interface FocalPoint {
  entity_id: string
  entity_type: string
  focal_score: number
  urgency: string
  signal_types: string[]
  top_headlines: string[]
  narrative: string
}

interface LiveFeedItem {
  id: string
  kind: 'news' | 'focal' | 'signal'
  title: string
  description: string
  country?: string
  timestamp: string
  tone: 'watch' | 'high' | 'critical'
}

interface CountryContextPayload {
  iso: string
  country: {
    code: string
    name: string
    score: number
    level: string
    trend?: string
    change_24h?: number
    components?: Record<string, number>
    last_updated?: string
  }
  summary: {
    risk_level: string
    news_count: number
    signal_count: number
    focal_count: number
    top_signal_types: string[]
    top_headlines: string[]
    recent_news_time?: string | null
    recent_signal_time?: string | null
    latest_activity?: string | null
    narrative: string
    drivers?: string[]
    rationale?: string
    new_events_15m?: number
    momentum?: string
    source_count?: number
    source_diversity?: number
    freshness?: number
    escalation?: number
    convergence_score?: number
  }
  news: { count: number; items: NewsItem[] }
  signals: { count: number; items: Signal[] }
  focal_points: { count: number; items: FocalPoint[] }
  live_updates?: {
    count: number
    items: Array<{
      id: string
      kind: 'news' | 'signal'
      country_iso?: string
      signal_type?: string
      title: string
      description: string
      source?: string
      timestamp: string
      severity?: string
    }>
  }
}

const FEED_KIND_LABEL: Record<LiveFeedItem['kind'], string> = {
  news: '新闻',
  focal: '焦点',
  signal: '信号',
}

const SIGNAL_TYPE_ZH: Record<string, string> = {
  military: '军事',
  military_flight: '军事',
  military_vessel: '军事',
  protest: '抗议',
  conflict: '冲突',
  internet_outage: '网络',
  diplomatic: '外交',
  diplomatic_tension: '外交',
  economic: '经济',
  humanitarian: '人道',
  info: '信息',
}

const CII_COLORS: Record<string, string> = {
  low: '#28b43c',
  normal: '#dcc832',
  elevated: '#f08c1e',
  high: '#dc3214',
  critical: '#8c0a00',
}

const LEVEL_ZH: Record<string, string> = {
  low: '低',
  normal: '正常',
  elevated: '偏高',
  high: '高',
  critical: '紧急',
}

const MOMENTUM_ZH: Record<string, string> = {
  accelerating: '快速升温',
  building: '持续堆积',
  watch: '持续观察',
}

function relativeTime(ts?: string): string {
  if (!ts) return '刚刚'
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 0) return '刚刚'
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${Math.max(sec, 1)}秒前`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}小时前`
  return `${Math.floor(hr / 24)}天前`
}

function isRecent(ts?: string, windowMs = 5 * 60 * 1000): boolean {
  if (!ts) return false
  const diff = Date.now() - new Date(ts).getTime()
  return diff >= 0 && diff <= windowMs
}

function asPercent(value?: number): number {
  if (!value) return 0
  return Math.max(0, Math.min(100, Math.round(value * 100)))
}

function severityTone(severity?: string): 'watch' | 'high' | 'critical' {
  if (severity === 'high') return 'critical'
  if (severity === 'medium') return 'high'
  return 'watch'
}

function toSignalList(payload: any): Signal[] {
  const flat: Signal[] = []
  for (const cluster of payload?.clusters ?? []) {
    for (const sig of cluster.signals ?? []) {
      flat.push({
        id: `${cluster.country_iso}-${sig.signal_type}-${sig.timestamp ?? ''}-${sig.source ?? ''}`,
        type: sig.signal_type,
        country: cluster.country_iso,
        countryIso: cluster.country_iso,
        lat: sig.lat ?? undefined,
        lon: sig.lon ?? undefined,
        intensity: sig.count ?? sig.intensity ?? 1,
        timestamp: sig.timestamp ?? new Date().toISOString(),
        cii_score: cluster.convergence_score ?? 0,
        description: sig.description ?? sig.summary ?? `${SIGNAL_TYPE_ZH[sig.signal_type] ?? sig.signal_type}信号`,
        source: sig.source ?? 'OrcaFish Monitor',
      })
    }
  }
  flat.sort((a, b) => new Date(b.timestamp ?? 0).getTime() - new Date(a.timestamp ?? 0).getTime())
  return flat
}

function normalizeContextSignal(signal: any): Signal {
  return {
    id: signal.id ?? `${signal.country_iso ?? signal.country}-${signal.signal_type ?? signal.type}-${signal.timestamp ?? Date.now()}`,
    type: signal.type ?? signal.signal_type ?? 'info',
    country: signal.country ?? signal.country_iso,
    countryIso: signal.country_iso ?? signal.countryIso ?? signal.country,
    lat: signal.lat ?? undefined,
    lon: signal.lon ?? undefined,
    intensity: signal.intensity ?? signal.count ?? signal.value ?? 1,
    timestamp: signal.timestamp ?? new Date().toISOString(),
    cii_score: signal.cii_score ?? 0,
    description: signal.description ?? `${SIGNAL_TYPE_ZH[signal.type ?? signal.signal_type] ?? signal.type ?? signal.signal_type ?? '信息'}信号`,
    source: signal.source ?? 'OrcaFish Monitor',
  }
}

function getCountrySignals(items: Signal[], countryIso?: string, limit?: number): Signal[] {
  if (!countryIso) return []
  const matched = items.filter((signal) => (signal.countryIso ?? signal.country) === countryIso)
  return typeof limit === 'number' ? matched.slice(0, limit) : matched
}

function getCountryNews(items: NewsItem[], countryIso?: string, limit?: number): NewsItem[] {
  if (!countryIso) return []
  const matched = items.filter((item) => item.country_iso === countryIso)
  return typeof limit === 'number' ? matched.slice(0, limit) : matched
}

function getCountryFocalPoint(items: FocalPoint[], countryIso?: string): FocalPoint | null {
  if (!countryIso) return null
  return items.find((point) => point.entity_id === countryIso) ?? null
}

function parseCiiScores(payload: unknown): CIIScore[] {
  const rawScores = payload && typeof payload === 'object' && 'scores' in payload
    ? (payload as { scores?: unknown }).scores
    : null

  if (!rawScores || typeof rawScores !== 'object') return []

  const scores: CIIScore[] = []
  for (const [iso, value] of Object.entries(rawScores as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const item = value as {
      name?: unknown
      score?: unknown
      level?: unknown
      components?: unknown
      monitoring?: unknown
    }

    const components = item.components && typeof item.components === 'object'
      ? Object.entries(item.components as Record<string, unknown>).reduce<Record<string, number>>((accumulator, [componentKey, componentValue]) => {
          if (typeof componentValue === 'number') {
            accumulator[componentKey] = componentValue
          }
          return accumulator
        }, {})
      : undefined

    scores.push({
      iso,
      name: typeof item.name === 'string' ? item.name : undefined,
      score: typeof item.score === 'number' ? item.score : Number(item.score ?? 0),
      level: typeof item.level === 'string' ? item.level : 'low',
      components,
      monitoring: item.monitoring && typeof item.monitoring === 'object'
        ? (item.monitoring as CIIScore['monitoring'])
        : undefined,
    })
  }

  scores.sort((a, b) => b.score - a.score)
  return scores
}

function toObservationCountryContext(payload: CountryContextPayload): ObservationCountryContext {
  return {
    iso: payload.iso,
    country_name: payload.country.name,
    score: payload.country.score,
    level: payload.country.level,
    news_count: payload.summary.news_count,
    signal_count: payload.summary.signal_count,
    focal_count: payload.summary.focal_count,
    latest_activity: payload.summary.latest_activity,
    top_signal_types: payload.summary.top_signal_types,
    narrative: payload.summary.narrative,
    top_headlines: payload.summary.top_headlines,
  }
}

function MapWorkbenchFallback() {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(180deg, #f8fbff, #eef5fb)',
      color: 'var(--text-muted)',
      fontSize: '0.82rem',
    }}>
      正在载入世界平面地图...
    </div>
  )
}

function CountryCardFallback() {
  return (
    <div style={{
      padding: 'var(--sp-3)',
      borderRadius: 'var(--radius-sm)',
      border: '1px solid var(--border)',
      background: 'rgba(255,255,255,0.9)',
      color: 'var(--text-muted)',
      fontSize: '0.76rem',
    }}>
      正在载入国家工作台...
    </div>
  )
}

export default function Intelligence() {
  const navigate = useNavigate()
  const [signals, setSignals] = useState<Signal[]>([])
  const [ciiScores, setCiiScores] = useState<CIIScore[]>([])
  const [wmStatus, setWmStatus] = useState<WMStatus>({ running: false, last_poll: null, poll_interval: 60, cii_threshold: 65 })
  const [loading, setLoading] = useState(true)
  const [selectedCountryIso, setSelectedCountryIso] = useState<string | null>(null)
  const [domain, setDomain] = useState('all')
  const [newsItems, setNewsItems] = useState<NewsItem[]>([])
  const [focalPoints, setFocalPoints] = useState<FocalPoint[]>([])
  const [liveFeed, setLiveFeed] = useState<LiveFeedItem[]>([])
  const [countryContext, setCountryContext] = useState<CountryContextPayload | null>(null)
  const [showAnalysisHint, setShowAnalysisHint] = useState(false)
  const feedSeenIds = useRef(new Set<string>())
  const autoStartedRef = useRef(false)
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const injectedSignals = useIntelligenceStore((state) => state.injectedSignals)
  const overviewCache = useIntelligenceStore((state) => state.overviewCache)
  const signalsCache = useIntelligenceStore((state) => state.signalsCache)
  const refreshOverviewCache = useIntelligenceStore((state) => state.refreshOverviewCache)
  const warmOverviewCache = useIntelligenceStore((state) => state.warmOverviewCache)
  const refreshSignalsCache = useIntelligenceStore((state) => state.refreshSignalsCache)
  const ensureWorldMonitorRunning = useIntelligenceStore((state) => state.ensureWorldMonitorRunning)
  const injectSignal = useIntelligenceStore((state) => state.injectSignal)
  const setActiveCountryContext = useIntelligenceStore((state) => state.setActiveCountryContext)
  const setDraft = useSimulationDraftStore((state) => state.setDraft)

  const refreshCountryContext = useCallback(async (countryIso: string, signal?: AbortSignal) => {
    const response = await fetch(`/api/intelligence/country-context/${countryIso}`, { signal })
    if (!response.ok) throw new Error('country-context')
    const payload = await response.json() as CountryContextPayload
    return {
      ...payload,
      signals: {
        ...payload.signals,
        items: (payload.signals?.items ?? []).map(normalizeContextSignal),
      },
    }
  }, [])

  const syncObservationFromCache = useCallback((signalPayload?: IntelligenceSignalsResponse | null) => {
    const flatSignals = signalPayload ? toSignalList(signalPayload) : []
    setSignals(flatSignals)
    setCiiScores(parseCiiScores(overviewCache.cii))
    setWmStatus((overviewCache.wmStatus as WMStatus | null) ?? { running: false, last_poll: null, poll_interval: 60, cii_threshold: 65 })
    setNewsItems((overviewCache.newsItems as NewsItem[]) ?? [])
    setFocalPoints((overviewCache.focalPoints as FocalPoint[]) ?? [])

    setLiveFeed(prev => {
      const next = [...prev]

      for (const signal of flatSignals.slice(0, 18)) {
        const key = `signal:${signal.id}`
        if (feedSeenIds.current.has(key)) continue
        feedSeenIds.current.add(key)
        next.unshift({
          id: key,
          kind: 'signal',
          title: `${signal.country || 'GLOBAL'} 出现${SIGNAL_TYPE_ZH[signal.type] ?? signal.type}信号`,
          description: signal.description || `${signal.source || 'OrcaFish Monitor'} 捕获到新的态势变化`,
          country: signal.country,
          timestamp: signal.timestamp || new Date().toISOString(),
          tone: (signal.cii_score ?? 0) >= 85 ? 'critical' : (signal.cii_score ?? 0) >= 60 ? 'high' : 'watch',
        })
      }

      if (overviewCache.wmStatus?.latest_event) {
        const event = overviewCache.wmStatus.latest_event
        const key = `status:${event.id}`
        if (!feedSeenIds.current.has(key)) {
          feedSeenIds.current.add(key)
          next.unshift({
            id: key,
            kind: (event.kind === 'signal' ? 'signal' : 'news') as 'signal' | 'news' | 'focal',
            title: event.title,
            description: event.description,
            country: event.country_iso,
            timestamp: event.timestamp,
            tone: severityTone(event.severity),
          })
        }
      }

      for (const item of overviewCache.newsItems ?? []) {
        const key = `news:${item.id}`
        if (feedSeenIds.current.has(key)) continue
        feedSeenIds.current.add(key)
        next.unshift({
          id: key,
          kind: 'news',
          title: item.title,
          description: item.summary || item.source || '监控新闻到达',
          country: item.country_iso,
          timestamp: item.published_at || new Date().toISOString(),
          tone: 'watch',
        })
      }

      for (const point of overviewCache.focalPoints ?? []) {
        const key = `focal:${point.entity_id}:${point.narrative}`
        if (feedSeenIds.current.has(key)) continue
        feedSeenIds.current.add(key)
        next.unshift({
          id: key,
          kind: 'focal',
          title: `${point.entity_id} 进入 Agent 关注焦点`,
          description: point.narrative,
          country: point.entity_id,
          timestamp: new Date().toISOString(),
          tone: point.urgency === 'critical' ? 'critical' : point.urgency === 'high' ? 'high' : 'watch',
        })
      }

      return next
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 40)
    })
  }, [overviewCache])

  const loadObservation = useCallback(async (force = false) => {
    try {
      if (!force) {
        await warmOverviewCache()
      }
      await Promise.all([
        refreshOverviewCache(force),
        refreshSignalsCache(domain, force),
      ])
    } catch {
      // keep previous frame when polling fails
    } finally {
      setLoading(false)
    }
  }, [domain, refreshOverviewCache, refreshSignalsCache, warmOverviewCache])

  useEffect(() => {
    const cachedSignals = signalsCache[domain]?.payload ?? null
    syncObservationFromCache(cachedSignals)
  }, [domain, signalsCache, syncObservationFromCache])

  useEffect(() => {
    void loadObservation()
  }, [loadObservation])

  useEffect(() => {
    const timer = setInterval(() => {
      void loadObservation(true)
    }, 15000)
    return () => clearInterval(timer)
  }, [loadObservation])

  useEffect(() => {
    if (injectedSignals.length > 0) setShowAnalysisHint(true)
  }, [injectedSignals.length])

  useEffect(() => {
    if (!timelineRef.current) return
    if (liveFeed.length === 0) return
    timelineRef.current.scrollTo({ top: 0, behavior: 'smooth' })
  }, [liveFeed.length])

  useEffect(() => {
    if (wmStatus.running || autoStartedRef.current) return
    autoStartedRef.current = true
    void ensureWorldMonitorRunning()
      .then(() => loadObservation())
      .catch(() => undefined)
  }, [ensureWorldMonitorRunning, loadObservation, wmStatus.running])

  useEffect(() => {
    if (!selectedCountryIso) {
      setCountryContext(null)
      return
    }

    const controller = new AbortController()
    const signalPayload = signalsCache[domain]?.payload
    const signalItems = signalPayload ? toSignalList(signalPayload) : []
    const selectedCountryScore = ciiScores.find((country) => country.iso === selectedCountryIso) ?? null
    const selectedCountryNewsItems = getCountryNews(overviewCache.newsItems as NewsItem[], selectedCountryIso, 4)
    const selectedCountryFocalPoint = getCountryFocalPoint(overviewCache.focalPoints as FocalPoint[], selectedCountryIso)

    setCountryContext((current) => {
      if (current?.iso === selectedCountryIso) return current
      if (!selectedCountryScore) return null
      return {
        iso: selectedCountryIso,
        country: {
          code: selectedCountryIso,
          name: selectedCountryScore.name ?? selectedCountryIso,
          score: selectedCountryScore.score,
          level: selectedCountryScore.level,
          components: selectedCountryScore.components,
        },
        monitor: overviewCache.wmStatus,
        summary: {
          risk_level: selectedCountryScore.level,
          news_count: selectedCountryNewsItems.length,
          signal_count: getCountrySignals(signalItems, selectedCountryIso).length,
          focal_count: selectedCountryFocalPoint ? 1 : 0,
          top_signal_types: selectedCountryScore.monitoring?.top_signal_types ?? [],
          top_headlines: selectedCountryScore.monitoring?.top_headlines ?? selectedCountryNewsItems.map((item) => item.title).slice(0, 3),
          latest_activity: selectedCountryScore.monitoring?.last_event ?? null,
          narrative: selectedCountryScore.monitoring?.rationale ?? selectedCountryFocalPoint?.narrative ?? '正在汇聚更多观测线索。',
          drivers: selectedCountryScore.monitoring?.drivers,
          rationale: selectedCountryScore.monitoring?.rationale,
          new_events_15m: selectedCountryScore.monitoring?.new_events_15m,
          momentum: selectedCountryScore.monitoring?.momentum,
          source_count: selectedCountryScore.monitoring?.source_count,
          source_diversity: selectedCountryScore.monitoring?.source_diversity,
          freshness: selectedCountryScore.monitoring?.freshness,
          escalation: selectedCountryScore.monitoring?.escalation,
          convergence_score: selectedCountryScore.monitoring?.convergence_score,
        },
        news: { count: selectedCountryNewsItems.length, items: selectedCountryNewsItems },
        signals: { count: getCountrySignals(signalItems, selectedCountryIso).length, items: getCountrySignals(signalItems, selectedCountryIso) },
        focal_points: { count: selectedCountryFocalPoint ? 1 : 0, items: selectedCountryFocalPoint ? [selectedCountryFocalPoint] : [] },
      }
    })

    void refreshCountryContext(selectedCountryIso, controller.signal)
      .then((payload) => {
        if (payload.iso !== selectedCountryIso) return
        setCountryContext(payload)
      })
      .catch(() => undefined)

    return () => controller.abort()
  }, [ciiScores, domain, overviewCache.focalPoints, overviewCache.newsItems, refreshCountryContext, selectedCountryIso, signalsCache])

  useEffect(() => {
    if (!selectedCountryIso) return
    const exists = ciiScores.some((country) => country.iso === selectedCountryIso)
    if (!exists) {
      setSelectedCountryIso(null)
      setCountryContext(null)
    }
  }, [ciiScores, selectedCountryIso])

  const toggleMonitor = async () => {
    if (wmStatus.running) {
      await fetch('/api/intelligence/world-monitor/stop', { method: 'POST' })
      await loadObservation(true)
      return
    }
    await ensureWorldMonitorRunning()
    await loadObservation(true)
  }

  const criticalCount = ciiScores.filter((country) => country.level === 'critical' || country.level === 'high').length
  const topCountries = ciiScores.slice(0, 12)
  const selectedCountry = useMemo(() => (
    selectedCountryIso ? ciiScores.find((country) => country.iso === selectedCountryIso) ?? null : null
  ), [ciiScores, selectedCountryIso])
  const activeCountryContext = useMemo(() => (
    countryContext?.iso === selectedCountryIso ? countryContext : null
  ), [countryContext, selectedCountryIso])
  const focusCountry = selectedCountry ?? topCountries[0] ?? null
  const leadFocalPoint = focalPoints[0] ?? null
  const selectedCountrySignals = useMemo(() => (
    getCountrySignals(signals, selectedCountryIso ?? undefined, 4)
  ), [selectedCountryIso, signals])
  const selectedCountryNews = useMemo(() => (
    getCountryNews(newsItems, selectedCountryIso ?? undefined, 4)
  ), [newsItems, selectedCountryIso])
  const selectedCountryFocal = useMemo(() => (
    getCountryFocalPoint(focalPoints, selectedCountryIso ?? undefined)
  ), [focalPoints, selectedCountryIso])
  const focusCountrySignals = useMemo(() => (
    getCountrySignals(signals, focusCountry?.iso, 5)
  ), [focusCountry?.iso, signals])
  const focusCountryNews = useMemo(() => (
    getCountryNews(newsItems, focusCountry?.iso, 4)
  ), [focusCountry?.iso, newsItems])
  const activeFeed = useMemo(() => (
    [...liveFeed]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 10)
  ), [liveFeed])
  const newestFeed = activeFeed[0] ?? null
  const selectedCountryDrivers = activeCountryContext?.summary.drivers
    ?? selectedCountry?.monitoring?.drivers
    ?? []
  const selectedCountryRationale = activeCountryContext?.summary.rationale
    ?? selectedCountry?.monitoring?.rationale
    ?? ''
  const mapSignals = useMemo(() => [
    ...signals,
    ...injectedSignals.map((signal) => ({
      ...signal,
      countryIso: signal.countryIso ?? signal.country,
      country: signal.country ?? signal.countryIso,
      source: 'analysis',
    })),
  ], [injectedSignals, signals])

  const resolveCountryContext = useCallback((countryCode?: string) => {
    if (!countryCode) return null
    return ciiScores.find((country) => country.iso === countryCode) ?? null
  }, [ciiScores])

  const pushCountryToAnalysis = useCallback((country: CIIScore) => {
    const context = countryContext && countryContext.iso === country.iso ? countryContext : null
    const fallbackSignals = getCountrySignals(signals, country.iso, 4)
    const fallbackNews = getCountryNews(newsItems, country.iso, 4)
    const fallbackFocal = getCountryFocalPoint(focalPoints, country.iso)

    setActiveCountryContext(context ? toObservationCountryContext(context) : {
      iso: country.iso,
      country_name: country.name ?? country.iso,
      score: country.score,
      level: country.level,
      news_count: fallbackNews.length,
      signal_count: fallbackSignals.length,
      focal_count: fallbackFocal ? 1 : 0,
      latest_activity: null,
      top_signal_types: [],
      narrative: fallbackFocal?.narrative,
      top_headlines: fallbackNews.map((item) => item.title).slice(0, 3),
    })
    injectSignal({
      id: `country-${country.iso}-${Date.now()}`,
      type: 'live',
      intensity: Math.round(country.score),
      timestamp: new Date().toISOString(),
      description: `${country.name ?? country.iso} 已进入议题研判优先队列，当前 CII ${country.score.toFixed(1)}`,
      source: 'live',
      query: `${country.name ?? country.iso} 风险升温`,
    })
    navigate('/analysis')
  }, [countryContext, focalPoints, injectSignal, navigate, newsItems, setActiveCountryContext, signals])

  const pushCountryToSimulation = useCallback((country: CIIScore) => {
    const context = countryContext && countryContext.iso === country.iso ? countryContext : null
    const fallbackSignals = getCountrySignals(signals, country.iso, 4)
    const fallbackNews = getCountryNews(newsItems, country.iso, 4)
    const fallbackFocal = getCountryFocalPoint(focalPoints, country.iso)

    setDraft({
      name: `${country.name ?? country.iso} 未来预测`,
      seed_content: `${country.name ?? country.iso} 当前危机指数为 ${country.score.toFixed(1)}，处于${LEVEL_ZH[country.level] ?? country.level}风险区。请结合全球观测新闻、热点信号与 Agent 焦点，预测未来 24-72 小时内的态势演化。`,
      simulation_requirement: `围绕 ${country.name ?? country.iso} 的风险升温路径，预测未来 24-72 小时的舆论、外交、安全与平台扩散变化。`,
      max_rounds: 40,
      source: 'manual',
      country_context: {
        iso: country.iso,
        country_name: country.name ?? country.iso,
        score: context?.country.score ?? country.score,
        level: context?.country.level ?? country.level,
        news_count: context?.summary.news_count ?? fallbackNews.length,
        signal_count: context?.summary.signal_count ?? fallbackSignals.length,
        focal_count: context?.summary.focal_count ?? (fallbackFocal ? 1 : 0),
        latest_activity: context?.summary.latest_activity ?? null,
        top_signal_types: context?.summary.top_signal_types ?? [],
        narrative: context?.summary.narrative ?? fallbackFocal?.narrative,
        top_headlines: context?.summary.top_headlines ?? fallbackNews.map((item) => item.title).slice(0, 3),
      },
    })
    navigate('/simulation')
  }, [countryContext, focalPoints, navigate, newsItems, setDraft, signals])

  const workflowSteps: WorkflowGuideStep[] = [
    {
      label: 'STEP 1',
      title: '先看平面态势图上的升温区域',
      description: '用世界平面地图和 CII 热区先锁定今天最值得追踪的国家或区域。',
      status: ciiScores.length > 0 ? 'active' : 'pending',
    },
    {
      label: 'STEP 2',
      title: '再接住实时新闻推送',
      description: '监控启动后持续接收新闻标题、摘要和热点信号，判断风险是否正在升级。',
      status: newsItems.length > 0 ? 'done' : 'pending',
    },
    {
      label: 'STEP 3',
      title: '最后送去议题研判与未来预测',
      description: '当观测对象足够清晰后，直接进入议题研判，再送到未来预测工作台。',
      status: injectedSignals.length > 0 ? 'active' : 'pending',
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div
        style={{
          padding: 'var(--sp-5) var(--sp-6)',
          background: 'linear-gradient(135deg, rgba(37,99,235,0.07), rgba(14,165,233,0.05), rgba(22,163,74,0.05))',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--sp-5)', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 280, flex: 1 }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.12em', marginBottom: 8 }}>
              全球观测工作台
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              全球观测
            </div>
            <div style={{ marginTop: 10, maxWidth: 920, fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              现在用世界平面地图接住全球风险热区、实时新闻标题和信号推送。这里负责先回答
              “哪里在升温、新闻在说什么、值不值得继续追踪”，再把重点地区送去议题研判与未来预测。
              当前状态：{wmStatus.running ? '实时接收中' : '监控已停止'}。
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', marginTop: 12 }}>
              <span className="badge badge-active"><span className="badge-dot" />{wmStatus.active_countries ?? ciiScores.length} 个监控国家</span>
              <span className="badge badge-critical"><span className="badge-dot" />{criticalCount} 个高风险地区</span>
              <span className="badge badge-done"><span className="badge-dot" />{wmStatus.news_count ?? newsItems.length} 条实时新闻</span>
              <span className="badge badge-normal"><span className="badge-dot" />{wmStatus.focal_count ?? focalPoints.length} 个 Agent 焦点</span>
              <span className={`badge ${wmStatus.running ? 'badge-done' : 'badge-pending'}`}>
                <span className="badge-dot" />{wmStatus.running ? '实时接收中' : '监控已停止'}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', minWidth: 240 }}>
            <NavLink to="/analysis" className="btn btn-primary" style={{ textDecoration: 'none', justifyContent: 'center' }}>
              发起议题研判
            </NavLink>
            <NavLink to="/simulation" className="btn btn-secondary" style={{ textDecoration: 'none', justifyContent: 'center' }}>
              启动未来预测
            </NavLink>
          </div>
        </div>
      </div>

      <div style={{ padding: 'var(--sp-4) var(--sp-6)', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.88)', flexShrink: 0 }}>
        <WorkflowGuide
          eyebrow="观测行动指南"
          title="先观测热区，再接新闻，再推进后续研判"
          description="全球观测页现在以平面世界地图为中心。先用热区和新闻锁定地区，再把值得深挖的对象转到议题研判和未来预测。"
          steps={workflowSteps}
          actions={
            <>
              <NavLink to="/analysis" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>
                发起议题研判
              </NavLink>
              <NavLink to="/simulation" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>
                启动未来预测
              </NavLink>
            </>
          }
        />
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sp-4)',
          padding: '10px 16px',
          background: 'rgba(255,255,255,0.94)',
          borderBottom: '1px solid var(--border)',
          backdropFilter: 'blur(8px)',
          flexShrink: 0,
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1.1rem', color: 'var(--accent)' }}>OrcaFish</span>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>全球观测</span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-5)', flex: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
          {[
            ['监控国家', wmStatus.active_countries ?? ciiScores.length, 'var(--accent)'],
            ['新闻推送', wmStatus.news_count ?? newsItems.length, '#16a34a'],
            ['活跃信号', wmStatus.signal_count ?? signals.length, 'var(--high)'],
            ['监控轮次', wmStatus.cycle ?? 0, 'var(--critical)'],
          ].map(([label, value, color]) => (
            <div key={label as string} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{label as string}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1rem', color: color as string }}>{value}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
            <span className={`badge ${wmStatus.running ? 'badge-done' : 'badge-pending'}`}>
              <span className="badge-dot" />{wmStatus.running ? '实时接收中' : '自动启动中'}
            </span>
            <span style={{ fontSize: '0.64rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
              {wmStatus.running
                ? `第 ${wmStatus.cycle ?? 0} 轮 · 最近轮询 ${wmStatus.last_poll ? relativeTime(wmStatus.last_poll) : '刚刚'} · 每 ${wmStatus.poll_interval} 秒刷新`
                : '页面会自动拉起监控引擎，也可手动控制'}
            </span>
          </div>
          <button className={`btn ${wmStatus.running ? 'btn-secondary' : 'btn-primary'} btn-sm`} onClick={toggleMonitor} style={{ height: 30, fontSize: '0.72rem' }}>
            {wmStatus.running ? '停止监控' : '立即启动'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <div
          style={{
            width: 280,
            flexShrink: 0,
            background: 'rgba(255,255,255,0.94)',
            borderRight: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div style={{ padding: '12px', borderBottom: '1px solid var(--border)', background: 'rgba(248,250,252,0.92)' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', marginBottom: 8 }}>
              风险梯队
            </div>
            <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>CII 风险排行</div>
            <div style={{ marginTop: 6, fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              从左侧快速锁定今天最需要跟踪的国家。每个国家都会直接告诉你它为什么排在这里。
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            {loading && ciiScores.length === 0 ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--sp-6)' }}>
                <div className="spinner" />
              </div>
            ) : topCountries.map((country, index) => (
              <button
                key={country.iso}
                onClick={() => setSelectedCountryIso(country.iso)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 10px',
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: 6,
                  cursor: 'pointer',
                  background: selectedCountryIso === country.iso ? `${CII_COLORS[country.level]}16` : 'rgba(255,255,255,0.72)',
                  border: `1px solid ${selectedCountryIso === country.iso ? CII_COLORS[country.level] : 'var(--border)'}`,
                  transition: 'all var(--t-fast)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--text-muted)', width: 14 }}>{index + 1}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.8rem', color: CII_COLORS[country.level], width: 30 }}>{country.iso}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: '0.74rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {country.name ?? country.iso}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', fontWeight: 700, color: CII_COLORS[country.level] }}>
                        {country.score.toFixed(1)}
                      </span>
                    </div>
                    <div style={{ marginTop: 6, height: 4, background: 'var(--border)', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(country.score, 100)}%`, height: '100%', background: CII_COLORS[country.level] }} />
                    </div>
                    {country.monitoring?.drivers?.length ? (
                      <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {country.monitoring.drivers.slice(0, 2).map((driver) => (
                          <span
                            key={driver}
                            style={{
                              fontSize: '0.58rem',
                              color: 'var(--text-secondary)',
                              borderRadius: 999,
                              padding: '2px 6px',
                              background: 'rgba(15,23,42,0.04)',
                              border: '1px solid rgba(148,163,184,0.18)',
                            }}
                          >
                            {driver}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div style={{ marginTop: 6, fontSize: '0.62rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
                      {country.monitoring?.rationale ?? '监控信号正在汇聚，等待更多线索进入。'}
                    </div>
                    <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.6rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      <span>{MOMENTUM_ZH[country.monitoring?.momentum ?? 'watch'] ?? '持续观察'}</span>
                      <span>
                        {country.monitoring?.new_events_15m ? `近15分钟 +${country.monitoring.new_events_15m}` : `${country.monitoring?.source_count ?? 0} 条新闻`}
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', background: 'rgba(248,250,252,0.9)' }}>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginBottom: 8, letterSpacing: '0.04em' }}>风险层级</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {Object.entries(CII_COLORS).map(([level, color]) => (
                <div key={level} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: `0 0 5px ${color}` }} />
                  <span style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>{LEVEL_ZH[level]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden', background: 'linear-gradient(180deg, #f8fbff, #edf5fc)' }}>
          <Suspense fallback={<MapWorkbenchFallback />}>
            <FlatWorldMap
              ciiScores={ciiScores}
              signals={mapSignals}
              onCountryClick={(iso) => {
                const exists = ciiScores.some((country) => country.iso === iso)
                if (exists) setSelectedCountryIso(iso)
              }}
              domain={domain}
              onDomainChange={setDomain}
            />
          </Suspense>

          <div
            style={{
              position: 'absolute',
              top: 14,
              left: 14,
              display: 'grid',
              gap: 10,
              width: 'min(360px, calc(100% - 28px))',
              zIndex: 6,
            }}
          >
            <div style={{ background: 'rgba(255,255,255,0.95)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', marginBottom: 8 }}>
                    监控值班台
                  </div>
                  <div style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                    {wmStatus.briefing ?? '监控已启动，正在等待下一轮观察线索。'}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', fontWeight: 800, color: '#16a34a' }}>
                    #{wmStatus.cycle ?? 0}
                  </div>
                  <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>轮次</div>
                </div>
              </div>
              {wmStatus.latest_event ? (
                <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(22,163,74,0.18)', background: 'linear-gradient(135deg, rgba(22,163,74,0.06), rgba(255,255,255,0.98))' }}>
                  <div style={{ fontSize: '0.66rem', color: '#15803d', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}>LATEST PUSH</div>
                  <div style={{ marginTop: 4, fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.55 }}>
                    {wmStatus.latest_event.title}
                  </div>
                  <div style={{ marginTop: 4, fontSize: '0.68rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    {wmStatus.latest_event.description}
                  </div>
                  <div style={{ marginTop: 6, fontSize: '0.62rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {(wmStatus.latest_event.country_iso || 'GLOBAL')} · {relativeTime(wmStatus.latest_event.timestamp)}
                  </div>
                </div>
              ) : null}
            </div>

            <div style={{ background: 'rgba(255,255,255,0.95)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: '12px 14px' }}>
              <div style={{ fontSize: '0.68rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', marginBottom: 8 }}>
                观测简报
              </div>
              {focusCountry ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', fontWeight: 800, color: CII_COLORS[focusCountry.level] }}>
                        {focusCountry.iso}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{focusCountry.name ?? '重点观测地区'}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', fontWeight: 800, color: CII_COLORS[focusCountry.level] }}>
                        {focusCountry.score.toFixed(1)}
                      </div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{LEVEL_ZH[focusCountry.level] ?? focusCountry.level}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 10, fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.65 }}>
                    {focusCountry.monitoring?.rationale
                      ?? (focusCountryNews.length > 0
                        ? `最近 ${focusCountryNews.length} 条新闻和 ${focusCountrySignals.length} 条信号同时集中在 ${focusCountry.iso}，已经具备继续做议题研判的条件。`
                        : `当前 ${focusCountry.iso} 位于高优先级观测区。建议继续监测新闻标题和信号密度，等待更明确的触发。`)}
                  </div>
                  {focusCountry.monitoring?.drivers?.length ? (
                    <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {focusCountry.monitoring.drivers.slice(0, 3).map((driver) => (
                        <span key={driver} style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', padding: '4px 8px', borderRadius: 999, background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.12)' }}>
                          {driver}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div style={{ marginTop: 10, display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                    <button className="btn btn-primary btn-sm" onClick={() => pushCountryToAnalysis(focusCountry)}>
                      发起议题研判
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => pushCountryToSimulation(focusCountry)}>
                      启动未来预测
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>等待监测国家载入。</div>
              )}
            </div>

            {selectedCountry ? (
              <Suspense fallback={<CountryCardFallback />}>
                <CountryWorkbenchCard
                  iso={selectedCountry.iso}
                  countryName={selectedCountry.name ?? selectedCountry.iso}
                  score={activeCountryContext?.country.score ?? selectedCountry.score}
                  level={activeCountryContext?.country.level ?? selectedCountry.level}
                  newsCount={activeCountryContext?.summary.news_count ?? selectedCountryNews.length}
                  signalCount={activeCountryContext?.summary.signal_count ?? selectedCountrySignals.length}
                  focalCount={activeCountryContext?.summary.focal_count ?? (selectedCountryFocal ? 1 : 0)}
                  latestActivity={activeCountryContext?.summary.latest_activity ?? null}
                  narrative={activeCountryContext?.summary?.narrative || (
                    selectedCountryNews.length > 0
                      ? `${selectedCountry.iso} 当前同步到 ${selectedCountryNews.length} 条新闻、${selectedCountrySignals.length} 条热点信号，可直接推进后续研判与预测。`
                      : `${selectedCountry.iso} 已进入重点监控列表，正在等待更多新闻与信号同步。`
                  )}
                  topSignalTypes={(activeCountryContext?.summary.top_signal_types ?? []).map((signalType) => SIGNAL_TYPE_ZH[signalType] ?? signalType)}
                  headlines={(activeCountryContext?.news.items.length ? activeCountryContext.news.items : selectedCountryNews).map((item) => ({
                    id: item.id,
                    title: item.title,
                    source: item.source,
                    publishedAt: item.published_at ?? null,
                  }))}
                  signals={(((activeCountryContext?.signals.items.length ?? 0) > 0) ? activeCountryContext!.signals.items : selectedCountrySignals).map((signal) => ({
                    id: signal.id,
                    description: signal.description ?? `${SIGNAL_TYPE_ZH[signal.type] ?? signal.type}信号`,
                    source: signal.source,
                    timestamp: signal.timestamp ?? null,
                    type: signal.type,
                  }))}
                  focalPoint={(activeCountryContext?.focal_points.items[0] ?? selectedCountryFocal)
                    ? {
                        narrative: (activeCountryContext?.focal_points.items[0] ?? selectedCountryFocal)!.narrative,
                        focalScore: (activeCountryContext?.focal_points.items[0] ?? selectedCountryFocal)!.focal_score,
                      }
                    : null}
                  analysisLabel="发起议题研判"
                  simulationLabel="发起未来预测"
                  onAnalysis={() => pushCountryToAnalysis(selectedCountry)}
                  onSimulation={() => pushCountryToSimulation(selectedCountry)}
                  onClose={() => setSelectedCountryIso(null)}
                />
              </Suspense>
            ) : null}
          </div>

          {showAnalysisHint && injectedSignals.length > 0 && (
            <div
              style={{
                position: 'absolute',
                bottom: 12,
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(22,163,74,0.92)',
                color: '#fff',
                borderRadius: 99,
                padding: '6px 16px',
                fontSize: '0.72rem',
                fontWeight: 600,
                backdropFilter: 'blur(8px)',
                boxShadow: '0 4px 12px rgba(22,163,74,0.3)',
                zIndex: 10,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
              onClick={() => setShowAnalysisHint(false)}
            >
              ✓ 议题「{injectedSignals[0].query ?? injectedSignals[0].description}」已注入观测态势图
            </div>
          )}
        </div>

        <div
          style={{
            width: 380,
            flexShrink: 0,
            background: 'rgba(255,255,255,0.94)',
            borderLeft: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div style={{ padding: '12px', borderBottom: '1px solid var(--border)', background: 'rgba(248,250,252,0.92)' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', marginBottom: 8 }}>
              实时监控
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', background: 'rgba(255,255,255,0.95)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-primary)' }}>监控状态</div>
                    <div style={{ marginTop: 4, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {wmStatus.last_poll ? `第 ${wmStatus.cycle ?? 0} 轮 · 上次刷新 ${relativeTime(wmStatus.last_poll)}` : '等待首次刷新'}
                    </div>
                  </div>
                  <span className={`badge ${wmStatus.running ? 'badge-done' : 'badge-pending'}`}>
                    <span className="badge-dot" />{wmStatus.running ? '实时接收中' : '未启动'}
                  </span>
                </div>
                <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                  {[
                    ['国家', wmStatus.active_countries ?? ciiScores.length],
                    ['新闻', wmStatus.news_count ?? newsItems.length],
                    ['信号', wmStatus.signal_count ?? signals.length],
                  ].map(([label, value]) => (
                    <div key={label as string} style={{ borderRadius: 'var(--radius-sm)', padding: '8px 10px', background: 'rgba(15,23,42,0.03)' }}>
                      <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>{label as string}</div>
                      <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {(wmStatus.data_sources ?? []).slice(0, 4).map((source) => (
                    <span key={source} style={{ fontSize: '0.64rem', color: 'var(--text-secondary)', padding: '4px 8px', borderRadius: 999, background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.12)' }}>
                      {source}
                    </span>
                  ))}
                </div>
                {wmStatus.briefing ? (
                  <div style={{ marginTop: 8, fontSize: '0.7rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    {wmStatus.briefing}
                  </div>
                ) : null}
              </div>
              {leadFocalPoint && (
                <div style={{ border: '1px solid rgba(37,99,235,0.14)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', background: 'linear-gradient(135deg, rgba(37,99,235,0.05), rgba(255,255,255,0.96))' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      Agent 观察焦点
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.64rem', color: 'var(--accent)' }}>
                      {leadFocalPoint.entity_id} · {Math.round(leadFocalPoint.focal_score * 100)}%
                    </span>
                  </div>
                  <div style={{ marginTop: 8, fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                    {leadFocalPoint.narrative}
                  </div>
                  {leadFocalPoint.top_headlines.length > 0 && (
                    <div style={{ marginTop: 8, fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                      {leadFocalPoint.top_headlines[0]}
                    </div>
                  )}
                </div>
              )}
              {selectedCountry && selectedCountryDrivers.length > 0 ? (
                <div style={{ border: '1px solid rgba(148,163,184,0.18)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', background: 'rgba(255,255,255,0.96)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {selectedCountry.iso} 为什么排在这里
                    </div>
                    <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {MOMENTUM_ZH[activeCountryContext?.summary.momentum ?? selectedCountry.monitoring?.momentum ?? 'watch'] ?? '持续观察'}
                    </span>
                  </div>
                  <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {selectedCountryDrivers.slice(0, 4).map((driver) => (
                      <span key={driver} style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', padding: '4px 8px', borderRadius: 999, background: 'rgba(15,23,42,0.04)', border: '1px solid rgba(148,163,184,0.18)' }}>
                        {driver}
                      </span>
                    ))}
                  </div>
                  <div style={{ marginTop: 8, fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.65 }}>
                    {selectedCountryRationale}
                  </div>
                  <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                    {[
                      ['来源数', activeCountryContext?.summary.source_diversity ?? selectedCountry.monitoring?.source_diversity ?? 0],
                      ['新鲜度', `${asPercent(activeCountryContext?.summary.freshness ?? selectedCountry.monitoring?.freshness)}%`],
                      ['升级度', `${asPercent(activeCountryContext?.summary.escalation ?? selectedCountry.monitoring?.escalation)}%`],
                    ].map(([label, value]) => (
                      <div key={label as string} style={{ padding: '8px 10px', borderRadius: 'var(--radius-sm)', background: 'rgba(248,250,252,0.92)', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: '0.56rem', color: 'var(--text-muted)' }}>{label as string}</div>
                        <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
                      </div>
                    ))}
                  </div>
                  {(activeCountryContext?.live_updates?.items.length ?? 0) > 0 ? (
                    <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                      {activeCountryContext!.live_updates!.items.slice(0, 3).map((item) => (
                        <div key={item.id} style={{ padding: '8px 10px', borderRadius: 'var(--radius-sm)', background: 'rgba(37,99,235,0.04)', border: '1px solid rgba(37,99,235,0.12)' }}>
                          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-primary)' }}>{item.title}</div>
                          <div style={{ marginTop: 4, fontSize: '0.64rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{item.description}</div>
                          <div style={{ marginTop: 4, fontSize: '0.58rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{relativeTime(item.timestamp)}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div style={{ border: '1px solid rgba(22,163,74,0.14)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', background: 'linear-gradient(135deg, rgba(22,163,74,0.05), rgba(255,255,255,0.98))' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    实时同步流
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.64rem', color: '#16a34a' }}>
                    {activeFeed.length} 条
                  </span>
                </div>
                <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>
                    {newestFeed ? `最新推送：${relativeTime(newestFeed.timestamp)}` : '等待新事件进入时间线'}
                  </span>
                  <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    轮询间隔 {wmStatus.poll_interval}s
                  </span>
                </div>
                <div ref={timelineRef} style={{ marginTop: 8, display: 'grid', gap: 10, maxHeight: 220, overflowY: 'auto', paddingRight: 4, position: 'relative' }}>
                  <div style={{ position: 'absolute', left: 3, top: 0, bottom: 0, width: 2, background: 'linear-gradient(180deg, rgba(22,163,74,0.32), rgba(148,163,184,0.12))', borderRadius: 999 }} />
                  {activeFeed.slice(0, 8).map((item) => (
                    <div key={item.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', position: 'relative' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.tone === 'critical' ? '#dc2626' : item.tone === 'high' ? '#f97316' : '#16a34a', boxShadow: `0 0 0 4px ${item.tone === 'critical' ? 'rgba(220,38,38,0.16)' : item.tone === 'high' ? 'rgba(249,115,22,0.16)' : 'rgba(22,163,74,0.16)'}`, flexShrink: 0, marginTop: 14, position: 'relative', zIndex: 1 }} />
                      <div style={{
                        minWidth: 0,
                        flex: 1,
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-sm)',
                        border: `1px solid ${isRecent(item.timestamp) ? (item.tone === 'critical' ? 'rgba(220,38,38,0.28)' : item.tone === 'high' ? 'rgba(249,115,22,0.26)' : 'rgba(22,163,74,0.22)') : 'rgba(148,163,184,0.18)'}`,
                        background: isRecent(item.timestamp)
                          ? item.tone === 'critical'
                            ? 'linear-gradient(135deg, rgba(220,38,38,0.09), rgba(255,255,255,0.98))'
                            : item.tone === 'high'
                              ? 'linear-gradient(135deg, rgba(249,115,22,0.08), rgba(255,255,255,0.98))'
                              : 'linear-gradient(135deg, rgba(22,163,74,0.08), rgba(255,255,255,0.98))'
                          : 'rgba(255,255,255,0.94)',
                        boxShadow: isRecent(item.timestamp) ? '0 10px 24px rgba(15,23,42,0.06)' : 'none',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{
                            fontSize: '0.55rem',
                            fontFamily: 'var(--font-mono)',
                            letterSpacing: '0.06em',
                            color: item.tone === 'critical' ? '#b91c1c' : item.tone === 'high' ? '#c2410c' : '#15803d',
                            background: item.tone === 'critical' ? 'rgba(220,38,38,0.1)' : item.tone === 'high' ? 'rgba(249,115,22,0.1)' : 'rgba(22,163,74,0.1)',
                            borderRadius: 999,
                            padding: '2px 6px',
                          }}>
                            {FEED_KIND_LABEL[item.kind]}
                          </span>
                          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.5 }}>{item.title}</div>
                          {isRecent(item.timestamp) ? (
                            <span style={{ fontSize: '0.58rem', fontFamily: 'var(--font-mono)', color: '#fff', background: item.tone === 'critical' ? '#dc2626' : '#16a34a', borderRadius: 999, padding: '2px 6px', letterSpacing: '0.04em' }}>
                              新增
                            </span>
                          ) : null}
                        </div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 2 }}>{item.description}</div>
                        <div style={{ marginTop: 4, fontSize: '0.62rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {item.country || 'GLOBAL'} · {relativeTime(item.timestamp)}
                        </div>
                        {(() => {
                          const context = resolveCountryContext(item.country)
                          if (!context) return null
                          return (
                            <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <button className="btn btn-primary btn-sm" onClick={() => pushCountryToAnalysis(context)}>
                                送去研判
                              </button>
                              <button className="btn btn-secondary btn-sm" onClick={() => pushCountryToSimulation(context)}>
                                送去预测
                              </button>
                            </div>
                          )
                        })()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {selectedCountry ? (
                <Suspense fallback={<CountryCardFallback />}>
                  <CountryWorkbenchCard
                    iso={selectedCountry.iso}
                    countryName={selectedCountry.name ?? selectedCountry.iso}
                    score={activeCountryContext?.country.score ?? selectedCountry.score}
                    level={activeCountryContext?.country.level ?? selectedCountry.level}
                    newsCount={activeCountryContext?.summary.news_count ?? selectedCountryNews.length}
                    signalCount={activeCountryContext?.summary.signal_count ?? selectedCountrySignals.length}
                    focalCount={activeCountryContext?.summary.focal_count ?? (selectedCountryFocal ? 1 : 0)}
                    latestActivity={activeCountryContext?.summary.latest_activity ?? undefined}
                    narrative={activeCountryContext?.summary?.narrative || (
                      selectedCountryNews.length > 0
                        ? `${selectedCountry.iso} 当前同步到 ${selectedCountryNews.length} 条新闻、${selectedCountrySignals.length} 条热点信号，可直接推进后续研判与预测。`
                        : `${selectedCountry.iso} 已进入重点监控列表，正在等待更多新闻与信号同步。`
                    )}
                    topSignalTypes={(activeCountryContext?.summary.top_signal_types ?? []).map((signalType) => SIGNAL_TYPE_ZH[signalType] ?? signalType)}
                    headlines={(activeCountryContext?.news.items.length ? activeCountryContext.news.items : selectedCountryNews).map((item) => ({
                      id: item.id,
                      title: item.title,
                      source: item.source,
                      publishedAt: item.published_at ?? null,
                    }))}
                    signals={(((activeCountryContext?.signals.items.length ?? 0) > 0) ? activeCountryContext!.signals.items : selectedCountrySignals).map((signal) => ({
                      id: signal.id,
                      description: signal.description ?? `${SIGNAL_TYPE_ZH[signal.type] ?? signal.type}信号`,
                      source: signal.source,
                      timestamp: signal.timestamp ?? null,
                      type: signal.type,
                    }))}
                    focalPoint={(activeCountryContext?.focal_points.items[0] ?? selectedCountryFocal) ? {
                      narrative: (activeCountryContext?.focal_points.items[0] ?? selectedCountryFocal)?.narrative ?? '',
                      focalScore: (activeCountryContext?.focal_points.items[0] ?? selectedCountryFocal)?.focal_score ?? 0,
                    } : null}
                    analysisLabel="发起议题研判"
                    simulationLabel="发起未来预测"
                    onAnalysis={() => pushCountryToAnalysis(selectedCountry)}
                    onSimulation={() => pushCountryToSimulation(selectedCountry)}
                    onClose={() => setSelectedCountryIso(null)}
                  />
                </Suspense>
              ) : null}
            </div>
          </div>

          <div style={{ padding: '10px 12px 6px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>实时新闻推送</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="live-pulse-dot" />
              <span style={{ fontSize: '0.62rem', color: '#22c55e', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>实时</span>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px 0' }}>
            {newsItems.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 180, color: 'var(--text-muted)', fontSize: '0.75rem', flexDirection: 'column', gap: 8, padding: 'var(--sp-6)' }}>
                暂无新闻推送，启动监控后将持续接收热点标题与摘要
              </div>
            ) : newsItems.map((item, index) => (
              <a
                key={item.id}
                href={item.url || undefined}
                target={item.url ? '_blank' : undefined}
                rel={item.url ? 'noreferrer' : undefined}
                style={{
                  display: 'block',
                  textDecoration: 'none',
                  padding: '10px 10px',
                  marginBottom: 8,
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${isRecent(item.published_at) ? 'rgba(22,163,74,0.24)' : index === 0 ? 'rgba(37,99,235,0.18)' : 'var(--border)'}`,
                  background: isRecent(item.published_at) ? 'linear-gradient(135deg, rgba(22,163,74,0.07), rgba(255,255,255,0.96))' : index === 0 ? 'rgba(37,99,235,0.05)' : 'rgba(255,255,255,0.88)',
                  boxShadow: isRecent(item.published_at) ? '0 10px 24px rgba(22,163,74,0.08)' : 'none',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--accent)', fontWeight: 700 }}>
                    {item.country_iso || 'GLOBAL'}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {isRecent(item.published_at) ? (
                      <span style={{ fontSize: '0.58rem', fontFamily: 'var(--font-mono)', color: '#fff', background: '#16a34a', borderRadius: 999, padding: '2px 6px' }}>
                        新增
                      </span>
                    ) : null}
                    <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>{relativeTime(item.published_at)}</span>
                  </div>
                </div>
                <div style={{ marginTop: 6, fontSize: '0.78rem', color: 'var(--text-primary)', fontWeight: 700, lineHeight: 1.55 }}>
                  {item.title}
                </div>
                <div style={{ marginTop: 6, fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {item.summary || '监控引擎已接收到新的动态，等待进一步确认。'}
                </div>
                <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>{item.source || 'OrcaFish Monitor'}</span>
                  <span style={{ fontSize: '0.64rem', color: 'var(--accent)' }}>{SIGNAL_TYPE_ZH[item.signal_type ?? ''] ?? (item.signal_type || '观察')}</span>
                </div>
              </a>
            ))}
          </div>

          <div style={{ padding: '10px 12px 6px', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(248,250,252,0.92)' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>热点信号流</div>
            <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{signals.length} 条</span>
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto', padding: '8px' }}>
            {signals.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', padding: '18px 8px' }}>暂无热点信号。</div>
            ) : signals.slice(0, 14).map((signal, index) => {
              const dotColor = signal.type === 'military' || signal.type === 'conflict' ? '#dc3214' : signal.type === 'protest' ? '#f08c1e' : '#2563eb'
              return (
                <div key={signal.id} style={{ padding: '8px 10px', marginBottom: 6, borderRadius: 'var(--radius-sm)', background: index === 0 ? 'rgba(37,99,235,0.05)' : 'rgba(255,255,255,0.88)', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, boxShadow: `0 0 5px ${dotColor}`, flexShrink: 0, marginTop: 4 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {signal.description ?? `${SIGNAL_TYPE_ZH[signal.type] ?? signal.type}信号`}
                      </div>
                      <div style={{ marginTop: 4, fontSize: '0.62rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {signal.country ?? 'GLOBAL'} · {signal.source ?? 'OrcaFish Monitor'} · {relativeTime(signal.timestamp)}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
