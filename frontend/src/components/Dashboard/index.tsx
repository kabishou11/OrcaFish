import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useSimulationDraftStore } from '../../stores/simulationDraftStore'
import {
  useIntelligenceStore,
  type IntelligenceCIIResponse,
  type IntelligenceFocalPoint,
  type IntelligenceNewsItem,
  type IntelligenceWMStatus,
  type ObservationCountryContext,
} from '../../stores/intelligenceStore'
import CountryWorkbenchCard from '../CountryWorkbenchCard'

interface CIIOverview {
  cii: number
  level: string
  countries: Array<{ iso: string; score: number }>
  timestamp?: string
}

interface RawCIIScore {
  score?: number
  level?: string
  name?: string
}

interface RawCIIResponse extends IntelligenceCIIResponse {
  scores?: Record<string, RawCIIScore>
  timestamp?: string
}

interface WMStatus extends IntelligenceWMStatus {}

interface SimRun { run_id: string; status: string; rounds_completed: number; created_at: string }
interface Pipeline { pipeline_id: string; stage: string; country_name: string; cii_score: number; created_at: string }
interface NewsItem extends IntelligenceNewsItem {}
interface FocalPoint extends IntelligenceFocalPoint { entity_id: string; focal_score: number; urgency: string; narrative: string; top_headlines: string[] }
interface CountryContextPayload {
  iso: string
  country: { name: string; score: number; level: string }
  summary: {
    news_count: number
    signal_count: number
    focal_count: number
    latest_activity?: string | null
    top_signal_types: string[]
    narrative: string
    top_headlines: string[]
  }
}
interface WorkbenchCountry {
  iso: string
  name: string
  newsCount: number
  focalCount: number
  riskScore: number
  lastPublished?: string
  latestHeadline: string
  latestSummary: string
  urgency: string
}

const STAGE_LABELS: Record<string, string> = {
  detected: '已检测', analysis: '研判中', simulation: '推演中', completed: '已完成', failed: '失败',
}

const COUNTRY_NAME_MAP: Record<string, string> = {
  UA: '乌克兰', RU: '俄罗斯', CN: '中国', IR: '伊朗', IL: '以色列', TW: '台湾', KP: '朝鲜', SA: '沙特', TR: '土耳其',
  PK: '巴基斯坦', IN: '印度', US: '美国', GB: '英国', FR: '法国', DE: '德国', MM: '缅甸', IQ: '伊拉克', AF: '阿富汗',
  VE: '委内瑞拉', BY: '白俄罗斯', SY: '叙利亚', JO: '约旦', LB: '黎巴嫩', YE: '也门', EG: '埃及', SD: '苏丹',
  ET: '埃塞俄比亚', LY: '利比亚', MD: '摩尔多瓦', RS: '塞尔维亚', PS: '巴勒斯坦', QA: '卡塔尔', AE: '阿联酋',
  TH: '泰国', PH: '菲律宾', VN: '越南', MY: '马来西亚', NG: '尼日利亚', ML: '马里', NE: '尼日尔',
}

function isRecent(ts?: string, windowMs = 5 * 60 * 1000): boolean {
  if (!ts) return false
  const diff = Date.now() - new Date(ts).getTime()
  return diff >= 0 && diff <= windowMs
}

/* ── ScoreRing (enlarged) ───────────────────────────────────────────── */
function ScoreRing({ score, level, size = 160 }: { score: number; level: string; size?: number }) {
  const color =
    level === 'critical' ? 'var(--critical)' :
    level === 'high'     ? 'var(--high)'     :
    level === 'elevated' ? 'var(--medium)'   :
                           'var(--low)'
  const r = size * 0.38
  const circ = 2 * Math.PI * r
  const dash = (score / 100) * circ
  const half = size / 2

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={half} cy={half} r={r} fill="none" stroke="var(--border)" strokeWidth="10" opacity={0.5} />
        <circle
          cx={half} cy={half} r={r} fill="none"
          stroke={color} strokeWidth="10"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 8px ${color})`, transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: size * 0.16, fontWeight: 700, color, lineHeight: 1 }}>
          {score.toFixed(1)}
        </span>
        <span style={{ fontSize: size * 0.065, color: 'var(--text-muted)', marginTop: 4 }}>/ 100</span>
      </div>
    </div>
  )
}

/* ── StatCard (glass style) ─────────────────────────────────────────── */
function StatCard({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: string; accent?: string }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.7)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      border: '1px solid rgba(255,255,255,0.6)',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--sp-5)',
      boxShadow: '0 4px 16px rgba(15,23,42,0.06)',
      textAlign: 'center' as const,
      minWidth: 140,
    }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.07em', marginBottom: 'var(--sp-2)' }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '2.2rem', fontWeight: 700, color: accent ?? 'var(--text-primary)', lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 'var(--sp-2)' }}>{sub}</div>}
    </div>
  )
}

/* ── Sparkline (inline SVG) ─────────────────────────────────────────── */
function Sparkline({ data, color = 'var(--accent)', width = 200, height = 48 }: {
  data: number[]
  color?: string
  width?: number
  height?: number
}) {
  if (data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const padY = 4
  const usableH = height - padY * 2

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = padY + usableH - ((v - min) / range) * usableH
    return `${x},${y}`
  })

  const areaPoints = [...points, `${width},${height}`, `0,${height}`].join(' ')

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.2} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill="url(#spark-fill)" />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* last point dot */}
      {(() => {
        const last = points[points.length - 1].split(',')
        return <circle cx={last[0]} cy={last[1]} r="3" fill={color} />
      })()}
    </svg>
  )
}

/* ── Mini Progress Bar ──────────────────────────────────────────────── */
function MiniProgress({ value, max, label, color }: { value: number; max: number; label: string; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div style={{ marginBottom: 'var(--sp-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{value}/{max}</span>
      </div>
      <div style={{ height: 5, borderRadius: 99, background: 'var(--bg-overlay)' }}>
        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 99, background: color, transition: 'width 0.5s ease' }} />
      </div>
    </div>
  )
}

function toCiiOverview(payload: RawCIIResponse): CIIOverview {
  const scoreEntries = Object.entries(payload.scores ?? {})
    .map(([iso, value]) => ({
      iso,
      score: value.score ?? 0,
      level: value.level ?? 'low',
    }))
    .sort((a, b) => b.score - a.score)

  const avgScore = scoreEntries.length > 0
    ? scoreEntries.reduce((sum, item) => sum + item.score, 0) / scoreEntries.length
    : 0
  const derivedLevel =
    avgScore >= 80 ? 'critical' :
    avgScore >= 65 ? 'high' :
    avgScore >= 45 ? 'elevated' :
    avgScore >= 25 ? 'normal' :
    'low'

  return {
    cii: avgScore,
    level: derivedLevel,
    countries: scoreEntries.map(({ iso, score }) => ({ iso, score })),
    timestamp: payload.timestamp,
  }
}

/* ── Dashboard ──────────────────────────────────────────────────────── */
export default function Dashboard() {
  const navigate = useNavigate()
  const setDraft = useSimulationDraftStore((state) => state.setDraft)
  const injectSignal = useIntelligenceStore((state) => state.injectSignal)
  const setActiveCountryContext = useIntelligenceStore((state) => state.setActiveCountryContext)
  const overviewCache = useIntelligenceStore((state) => state.overviewCache)
  const refreshOverviewCache = useIntelligenceStore((state) => state.refreshOverviewCache)
  const warmOverviewCache = useIntelligenceStore((state) => state.warmOverviewCache)
  const ensureWorldMonitorRunning = useIntelligenceStore((state) => state.ensureWorldMonitorRunning)
  const [cii, setCii] = useState<CIIOverview | null>(overviewCache.cii ? toCiiOverview(overviewCache.cii as RawCIIResponse) : null)
  const [wmStatus, setWmStatus] = useState<WMStatus | null>(overviewCache.wmStatus)
  const [simRuns, setSimRuns] = useState<SimRun[]>([])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [newsItems, setNewsItems] = useState<NewsItem[]>(overviewCache.newsItems)
  const [focalPoints, setFocalPoints] = useState<FocalPoint[]>(overviewCache.focalPoints)
  const [loading, setLoading] = useState(true)
  const [ciiHistory, setCiiHistory] = useState<number[]>([])
  const overviewHistoryRef = useRef<string | null>(overviewCache.cii?.timestamp ?? null)

  useEffect(() => {
    const cachePayload = overviewCache.cii as RawCIIResponse | null
    const nextOverview = cachePayload ? toCiiOverview(cachePayload) : null

    setCii(nextOverview)
    setWmStatus(overviewCache.wmStatus)
    setNewsItems(overviewCache.newsItems)
    setFocalPoints(overviewCache.focalPoints)

    if (nextOverview?.timestamp && overviewHistoryRef.current !== nextOverview.timestamp) {
      overviewHistoryRef.current = nextOverview.timestamp
      setCiiHistory(prev => {
        const next = [...prev, nextOverview.cii]
        return next.length > 7 ? next.slice(-7) : next
      })
    }
  }, [overviewCache])

  useEffect(() => {
    const fetchAll = async () => {
      try {
        await ensureWorldMonitorRunning()
        await warmOverviewCache()

        const [overviewResult, simRes, pipeRes] = await Promise.all([
          refreshOverviewCache(),
          fetch('/api/simulation/runs'),
          fetch('/api/pipeline/'),
        ])
        void overviewResult
        if (simRes.ok)  { const d = await simRes.json(); setSimRuns(d.runs ?? []) }
        if (pipeRes.ok) { const d = await pipeRes.json(); setPipelines(d.pipelines ?? []) }
      } catch { /* silent */ }
      setLoading(false)
    }
    fetchAll()
    const t = setInterval(fetchAll, 20000)
    return () => clearInterval(t)
  }, [ensureWorldMonitorRunning, refreshOverviewCache, warmOverviewCache])

  const levelBadgeClass =
    cii?.level === 'critical' ? 'badge-critical' :
    cii?.level === 'high'     ? 'badge-high'     :
    cii?.level === 'elevated' ? 'badge-medium'   : 'badge-low'

  const runningSims = simRuns.filter(r => r.status === 'running').length
  const completedPipelines = pipelines.filter(p => p.stage === 'completed').length
  const failedPipelines = pipelines.filter(p => p.stage === 'failed').length

  // pipeline stage distribution for mini chart
  const stageGroups = {
    detected: pipelines.filter(p => p.stage === 'detected').length,
    analysis: pipelines.filter(p => p.stage === 'analysis').length,
    simulation: pipelines.filter(p => p.stage === 'simulation').length,
    completed: completedPipelines,
    failed: failedPipelines,
  }

  // sim stats
  const completedSims = simRuns.filter(r => r.status === 'completed').length
  const failedSims = simRuns.filter(r => r.status === 'failed').length
  const highRiskCountries = cii?.countries?.filter(c => c.score >= 65).slice(0, 4) ?? []
  const recentPipelines = pipelines.slice(0, 6)
  const leadFocalPoints = focalPoints.slice(0, 3)
  const latestNews = newsItems.slice(0, 8)
  const countryWorkbench = useMemo<WorkbenchCountry[]>(() => {
    const map = new Map<string, WorkbenchCountry>()

    const upsert = (iso: string, patch: Partial<WorkbenchCountry>) => {
      const current = map.get(iso) ?? {
        iso,
        name: COUNTRY_NAME_MAP[iso] || iso,
        newsCount: 0,
        focalCount: 0,
        riskScore: cii?.countries.find(country => country.iso === iso)?.score ?? 0,
        lastPublished: undefined,
        latestHeadline: '等待同步',
        latestSummary: '监控启动后会持续同步全球观测热点。',
        urgency: 'watch',
      }
      map.set(iso, { ...current, ...patch })
    }

    for (const item of latestNews) {
      const iso = item.country_iso || 'GLOBAL'
      const existing = map.get(iso)
      upsert(iso, {
        newsCount: (existing?.newsCount ?? 0) + 1,
        lastPublished: item.published_at,
        latestHeadline: item.title,
        latestSummary: item.summary || '监控引擎已接收到新的全球观测动态。',
      })
    }

    for (const item of focalPoints) {
      const iso = item.entity_id || 'GLOBAL'
      const existing = map.get(iso)
      upsert(iso, {
        focalCount: (existing?.focalCount ?? 0) + 1,
        riskScore: cii?.countries.find(country => country.iso === iso)?.score ?? (item.focal_score * 100),
        urgency: item.urgency,
        latestHeadline: item.top_headlines?.[0] || item.narrative || existing?.latestHeadline || 'Agent 关注焦点',
        latestSummary: item.narrative || existing?.latestSummary || 'Agent 已提炼出新的关注对象。',
      })
    }

    for (const item of highRiskCountries) {
      upsert(item.iso, {
        riskScore: item.score,
        urgency: item.score >= 80 ? 'critical' : 'high',
      })
    }

    return Array.from(map.values()).sort((a, b) => {
      const activityA = a.newsCount + a.focalCount + (a.riskScore >= 65 ? 1 : 0)
      const activityB = b.newsCount + b.focalCount + (b.riskScore >= 65 ? 1 : 0)
      if (activityB !== activityA) return activityB - activityA
      return new Date(b.lastPublished || 0).getTime() - new Date(a.lastPublished || 0).getTime()
    }).slice(0, 6)
  }, [cii?.countries, focalPoints, highRiskCountries, latestNews])

  if (loading) {
    return (
      <div className="empty-state" style={{ minHeight: '60vh' }}>
        <div className="spinner" style={{ width: 32, height: 32 }} />
        <p>正在连接 OrcaFish 后端...</p>
      </div>
    )
  }

  const openCountryAnalysis = async (iso: string, score: number) => {
    const name = COUNTRY_NAME_MAP[iso] || iso
    let countryContext: CountryContextPayload | null = null
    try {
      const response = await fetch(`/api/intelligence/country-context/${iso}`)
      if (response.ok) countryContext = await response.json() as CountryContextPayload
    } catch {
      countryContext = null
    }
    const observationContext: ObservationCountryContext = countryContext ? {
      iso: countryContext.iso,
      country_name: countryContext.country.name,
      score: countryContext.country.score,
      level: countryContext.country.level,
      news_count: countryContext.summary.news_count,
      signal_count: countryContext.summary.signal_count,
      focal_count: countryContext.summary.focal_count,
      latest_activity: countryContext.summary.latest_activity,
      top_signal_types: countryContext.summary.top_signal_types,
      narrative: countryContext.summary.narrative,
      top_headlines: countryContext.summary.top_headlines,
    } : {
      iso,
      country_name: name,
      score,
      level: score >= 80 ? 'critical' : score >= 65 ? 'high' : 'normal',
      news_count: 0,
      signal_count: 0,
      focal_count: 0,
    }
    setActiveCountryContext(observationContext)
    injectSignal({
      id: `dashboard-${iso}-${Date.now()}`,
      type: 'live',
      intensity: Math.round(score),
      timestamp: new Date().toISOString(),
      description: `${name} 已从预测总览送入议题研判，当前 CII ${score.toFixed(1)}`,
      source: 'live',
      query: `${name} 风险升温`,
    })
    navigate('/analysis')
  }

  const openCountrySimulation = async (iso: string, score: number) => {
    const name = COUNTRY_NAME_MAP[iso] || iso
    let countryContext: CountryContextPayload | null = null
    try {
      const response = await fetch(`/api/intelligence/country-context/${iso}`)
      if (response.ok) countryContext = await response.json() as CountryContextPayload
    } catch {
      countryContext = null
    }
    setDraft({
      name: `${name} 未来预测`,
      seed_content: `${name} 当前危机指数为 ${score.toFixed(1)}。请结合全球观测同步、Agent 焦点和新闻推送，预测未来 24-72 小时的态势演化。`,
      simulation_requirement: `围绕 ${name} 的局势升温路径，预测未来 24-72 小时的外交、安全、平台扩散与舆论变化。`,
      max_rounds: 40,
      source: 'manual',
      country_context: countryContext ? {
        iso: countryContext.iso,
        country_name: countryContext.country.name,
        score: countryContext.country.score,
        level: countryContext.country.level,
        news_count: countryContext.summary.news_count,
        signal_count: countryContext.summary.signal_count,
        focal_count: countryContext.summary.focal_count,
        latest_activity: countryContext.summary.latest_activity,
        top_signal_types: countryContext.summary.top_signal_types,
        narrative: countryContext.summary.narrative,
        top_headlines: countryContext.summary.top_headlines,
      } : {
        iso,
        country_name: name,
        score,
        level: score >= 80 ? 'critical' : score >= 65 ? 'high' : 'normal',
        news_count: 0,
        signal_count: 0,
        focal_count: 0,
      },
    })
    navigate('/simulation')
  }

  // sparkline fallback: if no history, create mock from country scores
  const sparkData = ciiHistory.length >= 2
    ? ciiHistory
    : (cii?.countries?.slice(0, 7).map(c => c.score) ?? [30, 35, 40, 38, 42])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
      <div style={{
        background: 'linear-gradient(135deg, #eef4ff 0%, #f7fbff 46%, #eff7f5 100%)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--sp-8)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -70, right: -30, width: 220, height: 220, borderRadius: '50%', background: 'rgba(37,99,235,0.07)' }} />
        <div style={{ position: 'absolute', bottom: -50, left: -30, width: 180, height: 180, borderRadius: '50%', background: 'rgba(22,163,74,0.05)' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--sp-6)', position: 'relative', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 280, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 8 }}>
              <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', letterSpacing: '0.12em', color: 'var(--accent)' }}>
                OrcaFish · 总览工作台
              </span>
              <span className={`badge ${wmStatus?.running ? 'badge-done' : 'badge-pending'}`}>
                <span className="badge-dot" />
                {wmStatus?.running ? '监测引擎运行中' : '自动启动中'}
              </span>
            </div>
            <div style={{ fontSize: '1.9rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em', lineHeight: 1.1 }}>
              预测总览
            </div>
            <div style={{ marginTop: 10, fontSize: '0.92rem', color: 'var(--text-secondary)', maxWidth: 720, lineHeight: 1.7 }}>
              把观测信号先收拢成态势，再把研判结果送入推演，最后让自动流程把整条链路跑起来。
              这里是今天的总入口，也是你进入全球观测、议题研判、未来推演和自动流程的第一站。
            </div>
            <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
              <span className={`badge ${levelBadgeClass}`}>
                <span className="badge-dot" />
                全球危机指数 {cii?.level?.toUpperCase() ?? '—'}
              </span>
              <span className="badge badge-active">
                <span className="badge-dot" />
                {pipelines.length} 条自动流程
              </span>
              <span className="badge badge-normal">
                <span className="badge-dot" />
                {simRuns.length} 次推演记录
              </span>
              <span className="badge badge-done">
                <span className="badge-dot" />
                {countryWorkbench.length} 个国家工作台
              </span>
            </div>
            {cii?.timestamp && (
              <div style={{ marginTop: 10, fontSize: '0.74rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                数据更新于 {new Date(cii.timestamp).toLocaleString('zh-CN')}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', minWidth: 260 }}>
            <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <NavLink to="/analysis" className="btn btn-primary" style={{ textDecoration: 'none' }}>
                进入议题研判
              </NavLink>
              <NavLink to="/simulation" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
                进入未来推演
              </NavLink>
            </div>
            <NavLink to="/pipeline" className="btn btn-secondary" style={{ textDecoration: 'none', justifyContent: 'center' }}>
              查看自动流程
            </NavLink>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 320px) minmax(0, 1fr)', gap: 'var(--sp-6)', marginTop: 'var(--sp-6)', position: 'relative' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--sp-3)' }}>
            <ScoreRing score={cii?.cii ?? 0} level={cii?.level ?? 'low'} size={180} />
            <span className={`badge ${levelBadgeClass}`} style={{ fontSize: '0.8rem', padding: '4px 14px' }}>
              <span className="badge-dot" />
              全球危机指数 · {cii?.level?.toUpperCase() ?? '—'}
            </span>
            <div style={{
              width: '100%',
              padding: 'var(--sp-3)',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(255,255,255,0.78)',
              border: '1px solid var(--border)',
            }}>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '0.06em' }}>
                主线
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>研判先行，先把信号变成可读结论</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--low)' }} />
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>推演承接，把结论转成情景演化</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--medium)' }} />
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>自动流程把发现、分析、推演串成闭环</span>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateRows: 'auto auto', gap: 'var(--sp-4)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'var(--sp-4)' }}>
            <StatCard label="观测同步" value={countryWorkbench.length} sub={wmStatus?.running ? '监控已联动' : '等待联动'} accent="var(--accent)" />
              <StatCard label="推演次数" value={simRuns.length} sub={runningSims > 0 ? `${runningSims} 运行中` : '全部完成'} accent="var(--stage-active)" />
              <StatCard label="Agent 焦点" value={focalPoints.length} sub={`共 ${pipelines.length} 条流程`} accent="var(--medium)" />
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 'var(--sp-3)',
            }}>
              {[
                { label: '观测', value: pipelines.filter(p => p.stage === 'detected').length, color: 'var(--accent)' },
                { label: '研判', value: pipelines.filter(p => p.stage === 'analysis').length, color: 'var(--high)' },
                { label: '推演', value: pipelines.filter(p => p.stage === 'simulation').length, color: 'var(--low)' },
              ].map(step => (
                <div key={step.label} style={{
                  padding: 'var(--sp-4)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  background: 'rgba(255,255,255,0.78)',
                }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 8 }}>{step.label}</div>
                  <div style={{ fontSize: '1.6rem', fontFamily: 'var(--font-mono)', fontWeight: 800, color: step.color }}>{step.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 'var(--sp-4)' }}>
        {[
          { to: '/intelligence', title: '全球观测', desc: '实时信号监控与危机指数计算', icon: <IconRadar />, accent: 'var(--accent)' },
          { to: '/analysis', title: '议题研判', desc: '多源舆情聚合与情感分析', icon: <IconSearch />, accent: 'var(--high)' },
          { to: '/simulation', title: '未来推演', desc: '群体智能仿真与情景预测', icon: <IconChart />, accent: 'var(--low)' },
          { to: '/pipeline', title: '自动流程', desc: '三阶段自动化流程编排', icon: <IconPipeline />, accent: 'var(--medium)' },
        ].map(item => (
          <NavLink key={item.to} to={item.to} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="panel" style={{
              display: 'flex',
              alignItems: 'stretch',
              overflow: 'hidden',
              minHeight: 92,
              transition: 'transform var(--t-base), box-shadow var(--t-base)',
            }}>
              <div style={{ width: 4, background: item.accent, flexShrink: 0 }} />
              <div style={{ flex: 1, padding: 'var(--sp-4)', display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                <div style={{
                  width: 42, height: 42, borderRadius: 12,
                  background: 'var(--bg-overlay)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: item.accent, flexShrink: 0,
                }}>
                  {item.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.96rem', marginBottom: 3 }}>{item.title}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>{item.desc}</div>
                </div>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" style={{ flexShrink: 0 }}>
                  <path d="M6 3l5 5-5 5" />
                </svg>
              </div>
            </div>
          </NavLink>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--sp-4)' }}>
        {/* CII Trend sparkline */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">CII 走势</span>
            <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
              最近 {sparkData.length} 次采样
            </span>
          </div>
          <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {(cii?.cii ?? 0).toFixed(1)}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>当前值</span>
            </div>
            <Sparkline data={sparkData} color="var(--accent)" width={280} height={52} />
          </div>
        </div>

        {/* Pipeline progress */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">流水线进度</span>
            <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
              共 {pipelines.length} 条
            </span>
          </div>
          <div className="panel-body">
            <MiniProgress value={stageGroups.detected} max={pipelines.length || 1} label="已检测" color="var(--stage-pending)" />
            <MiniProgress value={stageGroups.analysis} max={pipelines.length || 1} label="研判中" color="var(--accent)" />
            <MiniProgress value={stageGroups.simulation} max={pipelines.length || 1} label="推演中" color="var(--medium)" />
            <MiniProgress value={stageGroups.completed} max={pipelines.length || 1} label="已完成" color="var(--low)" />
          </div>
        </div>

        {/* Simulation stats */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">推演统计</span>
            <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
              共 {simRuns.length} 次
            </span>
          </div>
          <div className="panel-body">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-3)' }}>
              <div style={{ textAlign: 'center', padding: 'var(--sp-3)', borderRadius: 'var(--radius)', background: 'var(--accent-dim)' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.4rem', fontWeight: 700, color: 'var(--accent)' }}>{runningSims}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>运行中</div>
              </div>
              <div style={{ textAlign: 'center', padding: 'var(--sp-3)', borderRadius: 'var(--radius)', background: 'var(--low-d)' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.4rem', fontWeight: 700, color: 'var(--low)' }}>{completedSims}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>已完成</div>
              </div>
              <div style={{ textAlign: 'center', padding: 'var(--sp-3)', borderRadius: 'var(--radius)', background: 'var(--critical-d)' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.4rem', fontWeight: 700, color: 'var(--critical)' }}>{failedSims}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>失败</div>
              </div>
              <div style={{ textAlign: 'center', padding: 'var(--sp-3)', borderRadius: 'var(--radius)', background: 'var(--bg-overlay)' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {simRuns.length > 0 ? Math.round(simRuns.reduce((s, r) => s + r.rounds_completed, 0) / simRuns.length) : 0}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>平均轮次</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 'var(--sp-4)' }}>
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">全球观测同步</span>
            <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
              {countryWorkbench.length} 个国家工作台
            </span>
          </div>
          <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--sp-3)' }}>
            {countryWorkbench.length > 0 ? countryWorkbench.map((item) => (
              <CountryWorkbenchCard
                key={`${item.iso}-${item.lastPublished || 'na'}`}
                iso={item.iso}
                name={item.name}
                riskScore={item.riskScore}
                riskLevel={item.urgency}
                newsCount={item.newsCount}
                focalCount={item.focalCount}
                signalCount={0}
                lastActivity={item.lastPublished ? new Date(item.lastPublished).toLocaleTimeString('zh-CN', { hour12: false }) : '刚刚'}
                latestHeadline={item.latestHeadline}
                latestSummary={item.latestSummary}
                highlight={isRecent(item.lastPublished)}
                onAnalysis={item.iso !== 'GLOBAL' ? () => openCountryAnalysis(item.iso, item.riskScore) : undefined}
                onSimulation={item.iso !== 'GLOBAL' ? () => openCountrySimulation(item.iso, item.riskScore) : undefined}
              />
            )) : (
              <div className="empty-state" style={{ minHeight: 180 }}>
                <p>监控启动后，这里会持续同步全球观测热点。</p>
              </div>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Agent 重点关注</span>
            <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
              {leadFocalPoints.length} 个工作台焦点
            </span>
          </div>
          <div className="panel-body" style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            {leadFocalPoints.length > 0 ? leadFocalPoints.map((item) => (
              <div key={`${item.entity_id}-${item.narrative}`} style={{
                padding: 'var(--sp-3)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                background: item.urgency === 'critical' ? 'rgba(220,50,20,0.06)' : item.urgency === 'high' ? 'rgba(240,140,30,0.06)' : 'rgba(22,163,74,0.05)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{item.entity_id}</div>
                  <span className={`badge ${item.urgency === 'critical' ? 'badge-critical' : item.urgency === 'high' ? 'badge-high' : 'badge-normal'}`}>
                    <span className="badge-dot" />{Math.round(item.focal_score * 100)}%
                  </span>
                </div>
                <div style={{ marginTop: 8, fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.65 }}>
                  {item.narrative}
                </div>
                {item.top_headlines?.[0] ? (
                  <div style={{ marginTop: 8, fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
                    {item.top_headlines[0]}
                  </div>
                ) : null}
                <div style={{ marginTop: 8, display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                  <button className="btn btn-primary btn-sm" onClick={() => openCountryAnalysis(item.entity_id, cii?.countries.find(country => country.iso === item.entity_id)?.score ?? item.focal_score * 100)}>
                    发起研判
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => openCountrySimulation(item.entity_id, cii?.countries.find(country => country.iso === item.entity_id)?.score ?? item.focal_score * 100)}>
                    发起预测
                  </button>
                </div>
              </div>
            )) : (
              <div className="empty-state" style={{ minHeight: 180 }}>
                <p>监控启动后，这里会同步 Agent 提炼出的焦点对象。</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 'var(--sp-4)' }}>
        <div className="panel">
          <div className="panel-header" style={{ background: 'linear-gradient(135deg, var(--bg-raised) 0%, #f4f7ff 100%)' }}>
            <span className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 4h12M2 8h12M2 12h12" />
              </svg>
              最近流水线
            </span>
            <NavLink to="/pipeline" style={{ fontSize: '0.78rem', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
              查看全部
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 3l5 5-5 5" /></svg>
            </NavLink>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ background: 'linear-gradient(135deg, var(--bg-raised) 0%, #f4f7ff 100%)' }}>地区</th>
                  <th style={{ background: 'linear-gradient(135deg, var(--bg-raised) 0%, #f4f7ff 100%)' }}>CII</th>
                  <th style={{ background: 'linear-gradient(135deg, var(--bg-raised) 0%, #f4f7ff 100%)' }}>阶段</th>
                  <th style={{ background: 'linear-gradient(135deg, var(--bg-raised) 0%, #f4f7ff 100%)' }}>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {recentPipelines.length > 0 ? recentPipelines.map(p => {
                  const stageClass =
                    p.stage === 'completed' ? 'badge-done' :
                    p.stage === 'failed'   ? 'badge-failed' :
                    p.stage === 'analysis' || p.stage === 'simulation' ? 'badge-active' : 'badge-pending'
                  return (
                    <tr key={p.pipeline_id}>
                      <td style={{ fontWeight: 500 }}>{p.country_name || p.pipeline_id}</td>
                      <td className="mono">{p.cii_score?.toFixed(1) ?? '—'}</td>
                      <td><span className={`badge ${stageClass}`}><span className="badge-dot" />{STAGE_LABELS[p.stage] ?? p.stage}</span></td>
                      <td className="mono text-muted">{new Date(p.created_at).toLocaleString('zh-CN')}</td>
                    </tr>
                  )
                }) : (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 'var(--sp-6)' }}>
                      暂无流水线记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">高风险地区</span>
            <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
              {highRiskCountries.length} 个重点关注
            </span>
          </div>
          <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
            {highRiskCountries.length > 0 ? highRiskCountries.map(country => (
              <div key={country.iso} style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--sp-3)',
                padding: 'var(--sp-3)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                background: 'rgba(255,255,255,0.8)',
              }}>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{COUNTRY_NAME_MAP[country.iso] || country.iso}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    {country.score.toFixed(1)} · 进入研判/推演优先队列
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <span className="badge badge-critical">
                    <span className="badge-dot" />
                    重点
                  </span>
                  <button className="btn btn-primary btn-sm" onClick={() => openCountryAnalysis(country.iso, country.score)}>
                    研判
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => openCountrySimulation(country.iso, country.score)}>
                    预测
                  </button>
                </div>
              </div>
            )) : (
              <div className="empty-state" style={{ minHeight: 180 }}>
                <p>当前没有超过阈值的高风险地区</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Inline Icons ──────────────────────────────────────────────────────── */
function IconRadar() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" width="20" height="20">
      <circle cx="10" cy="10" r="8" />
      <circle cx="10" cy="10" r="4.5" />
      <circle cx="10" cy="10" r="1.5" fill="currentColor" />
      <line x1="10" y1="2" x2="10" y2="5" />
      <path d="M7 13.5 L5.5 15.5" />
    </svg>
  )
}
function IconSearch() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" width="20" height="20">
      <circle cx="9" cy="9" r="6" />
      <line x1="14" y1="14" x2="18" y2="18" />
      <line x1="7" y1="9" x2="11" y2="9" />
      <line x1="9" y1="7" x2="9" y2="11" />
    </svg>
  )
}
function IconChart() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <polyline points="2,15 7,9 11,11.5 18,4" />
      <line x1="2" y1="18" x2="18" y2="18" />
      <line x1="2" y1="18" x2="2" y2="4" />
    </svg>
  )
}
function IconPipeline() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" width="20" height="20">
      <circle cx="4" cy="10" r="2" fill="currentColor" />
      <line x1="6" y1="10" x2="9" y2="10" />
      <circle cx="12" cy="10" r="2" />
      <line x1="14" y1="10" x2="16" y2="10" />
      <circle cx="18" cy="10" r="2" fill="currentColor" />
    </svg>
  )
}
