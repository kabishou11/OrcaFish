import { useEffect, useState, useCallback } from 'react'
import { NavLink } from 'react-router-dom'
import { GlobeContainer } from './GlobeContainer'
import { useIntelligenceStore } from '../../stores/intelligenceStore'
import WorkflowGuide, { type WorkflowGuideStep } from '../WorkflowGuide'

interface Signal {
  id: string; type: string; country?: string; lat?: number; lon?: number;
  intensity?: number; timestamp?: string; cii_score?: number;
  description?: string
}
interface CIIScore {
  iso: string; name?: string; score: number; level: string;
  lat?: number; lon?: number; components?: Record<string, number>
}
interface WMStatus {
  running: boolean; last_poll: string | null; poll_interval: number;
  cii_threshold: number; data_sources?: string[]
}

const SIGNAL_TYPE_ZH: Record<string, string> = {
  military: '军事', protest: '冲突', conflict: '冲突',
  internet_outage: '网络', diplomatic: '外交',
  economic: '经济', humanitarian: '人道',
}

const CII_COLORS: Record<string, string> = {
  low: '#28b43c', normal: '#dcc832', elevated: '#f08c1e', high: '#dc3214', critical: '#8c0a00',
}
const LEVEL_ZH: Record<string, string> = {
  low: '低', normal: '正常', elevated: '偏高', high: '高', critical: '紧急',
}

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 0) return '刚刚'
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}秒前`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}小时前`
  return `${Math.floor(hr / 24)}天前`
}

// ── Main Intelligence Page ────────────────────────────────────────────────────
export default function Intelligence() {
  const [signals, setSignals] = useState<Signal[]>([])
  const [ciiScores, setCiiScores] = useState<CIIScore[]>([])
  const [wmStatus, setWmStatus] = useState<WMStatus>({ running: false, last_poll: null, poll_interval: 300, cii_threshold: 65 })
  const [loading, setLoading] = useState(true)
  const [selectedCountry, setSelectedCountry] = useState<CIIScore | null>(null)
  const [domain, setDomain] = useState('all')
  const [feedSignals, setFeedSignals] = useState<Signal[]>([])
  const [showAnalysisHint, setShowAnalysisHint] = useState(false)
  const feedSeenIds = { current: new Set<string>() }
  const injectedSignals = useIntelligenceStore(s => s.injectedSignals)

  // ── 10s signal feed polling ─────────────────────────────────
  const fetchFeed = useCallback(async () => {
    try {
      const res = await fetch(`/api/intelligence/signals${domain && domain !== 'all' ? `?domain=${domain}` : ''}`)
      if (!res.ok) return
      const d = await res.json()
      const flat: Signal[] = []
      for (const cluster of d.clusters ?? []) {
        for (const sig of cluster.signals ?? []) {
          const id = `${cluster.country_iso}-${sig.signal_type}-${sig.timestamp ?? ''}`
          flat.push({
            id, type: sig.signal_type, country: cluster.country_iso,
            lat: sig.lat ?? undefined, lon: sig.lon ?? undefined,
            intensity: sig.count ?? sig.intensity ?? 1,
            timestamp: sig.timestamp ?? new Date().toISOString(),
            cii_score: cluster.convergence_score ?? 0,
            description: sig.description ?? sig.summary ?? `${SIGNAL_TYPE_ZH[sig.signal_type] ?? sig.signal_type}信号`,
          })
        }
      }
      flat.sort((a, b) => new Date(b.timestamp!).getTime() - new Date(a.timestamp!).getTime())
      setFeedSignals(prev => {
        const merged = [...flat]
        for (const old of prev) {
          if (!flat.find(f => f.id === old.id)) merged.push(old)
        }
        merged.sort((a, b) => new Date(b.timestamp!).getTime() - new Date(a.timestamp!).getTime())
        return merged.slice(0, 80)
      })
      for (const s of flat) feedSeenIds.current.add(s.id)
    } catch { /* silent */ }
  }, [domain])

  useEffect(() => { fetchFeed() }, [fetchFeed])
  useEffect(() => {
    const t = setInterval(fetchFeed, 10000)
    return () => clearInterval(t)
  }, [fetchFeed])

  // ── 15s main data polling ─────────────────────────────────────
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [sigRes, ciiRes, wmRes] = await Promise.all([
          fetch(`/api/intelligence/signals`),
          fetch(`/api/intelligence/cii`),
          fetch('/api/intelligence/world-monitor/status'),
        ])
        if (sigRes.ok) {
          const d = await sigRes.json()
          const flat: Signal[] = []
          for (const cluster of d.clusters ?? []) {
            for (const sig of cluster.signals ?? []) {
              flat.push({
                id: `${cluster.country_iso}-${sig.signal_type}`,
                type: sig.signal_type, country: cluster.country_iso,
                lat: sig.lat ?? undefined, lon: sig.lon ?? undefined,
                intensity: sig.count ?? 1,
                timestamp: sig.timestamp ?? undefined,
                cii_score: cluster.convergence_score ?? 0,
              })
            }
          }
          setSignals(flat)
        }
        if (ciiRes.ok) {
          const d = await ciiRes.json()
          const scores: CIIScore[] = []
          for (const [iso, val] of Object.entries<Record<string, unknown>>(d.scores ?? {})) {
            const v = val as Record<string, unknown>
            scores.push({
              iso, name: v.name as string,
              score: (v.score as number) ?? 0,
              level: (v.level as string) ?? 'low',
              components: v.components as Record<string, number>,
            })
          }
          scores.sort((a, b) => b.score - a.score)
          setCiiScores(scores)
        }
        if (wmRes.ok) setWmStatus(await wmRes.json())
      } catch { /* silent */ }
      setLoading(false)
    }
    fetchData()
    const t = setInterval(fetchData, 15000)
    return () => clearInterval(t)
  }, [domain])

  // Show hint when new analysis signals appear
  useEffect(() => {
    if (injectedSignals.length > 0) setShowAnalysisHint(true)
  }, [injectedSignals.length])

  const toggleMonitor = async () => {
    const ep = wmStatus.running ? '/api/intelligence/world-monitor/stop' : '/api/intelligence/world-monitor/start'
    await fetch(ep, { method: 'POST' })
    const res = await fetch('/api/intelligence/world-monitor/status')
    if (res.ok) setWmStatus(await res.json())
  }

  const criticalCount = ciiScores.filter(c => c.level === 'critical' || c.level === 'high').length
  const topCountries = ciiScores.slice(0, 10)
  const selectedCountrySignals = selectedCountry
    ? feedSignals.filter((signal) => signal.country === selectedCountry.iso).slice(0, 4)
    : []
  const workflowSteps: WorkflowGuideStep[] = [
    {
      label: 'STEP 1',
      title: '先看哪里在升温',
      description: '用 CII 排行、球面信号和实时流先锁定今天最值得追踪的地区。',
      status: ciiScores.length > 0 ? 'active' : 'pending' as const,
    },
    {
      label: 'STEP 2',
      title: '再把议题送去研判',
      description: '选中高风险地区后，转入议题研判页补足正文、媒体脉络和综合结论。',
      status: injectedSignals.length > 0 ? 'done' : 'pending' as const,
    },
    {
      label: 'STEP 3',
      title: '最后进入未来推演',
      description: '当一个议题足够清晰，就把它送入推演工作台观察舆论与行动演化。',
      status: injectedSignals.length > 0 ? 'active' : 'pending' as const,
    },
  ]

  // Merge live signals with injected analysis signals for globe
  const globeSignals = [
    ...signals,
    ...injectedSignals.map(s => ({ ...s, source: 'analysis' as const })),
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── Page Hero ───────────────────────────────────────── */}
      <div style={{
        padding: 'var(--sp-5) var(--sp-6)',
        background: 'linear-gradient(135deg, rgba(37,99,235,0.05), rgba(14,165,233,0.04), rgba(22,163,74,0.03))',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--sp-5)', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 280, flex: 1 }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.12em', marginBottom: 8 }}>
              GLOBAL OBSERVATION WORKBENCH
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              全球观测
            </div>
            <div style={{ marginTop: 10, maxWidth: 880, fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              先把世界上的异常信号收进同一个视图，再把高风险地区送去议题研判与未来推演。
              这里是整个产品主线的起点，负责回答“哪里正在升温，为什么值得继续追踪”。
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', marginTop: 12 }}>
              <span className="badge badge-active"><span className="badge-dot" />{ciiScores.length} 个监控国家</span>
              <span className="badge badge-critical"><span className="badge-dot" />{criticalCount} 个高风险地区</span>
              <span className={`badge ${wmStatus.running ? 'badge-done' : 'badge-pending'}`}>
                <span className="badge-dot" />{wmStatus.running ? '监控引擎运行中' : '监控引擎已停止'}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', minWidth: 220 }}>
            <NavLink to="/analysis" className="btn btn-primary" style={{ textDecoration: 'none', justifyContent: 'center' }}>
              前往议题研判
            </NavLink>
            <NavLink to="/simulation" className="btn btn-secondary" style={{ textDecoration: 'none', justifyContent: 'center' }}>
              前往未来推演
            </NavLink>
          </div>
        </div>
      </div>

      <div style={{ padding: 'var(--sp-4) var(--sp-6)', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.86)', flexShrink: 0 }}>
        <WorkflowGuide
          eyebrow="OBSERVATION PLAYBOOK"
          title="先观测，再研判，再推演"
          description="全球观测页是整条产品主线的起点。这里优先解决“哪里有异常、哪些信号值得继续深挖”，然后再把议题交给后续页面。"
          steps={workflowSteps}
          actions={
            <>
              <NavLink to="/analysis" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>
                去做议题研判
              </NavLink>
              <NavLink to="/simulation" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>
                去看未来推演
              </NavLink>
            </>
          }
        />
      </div>

      {/* ── Top Stats Bar ─────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--sp-4)',
        padding: '8px 16px',
        background: 'rgba(255,255,255,0.92)',
        borderBottom: '1px solid var(--border)',
        backdropFilter: 'blur(8px)',
        flexShrink: 0,
        zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1.1rem', color: 'var(--accent)' }}>OrcaFish</span>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>全球观测</span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-5)', flex: 1, justifyContent: 'center' }}>
          {[
            ['监控国家', ciiScores.length, 'var(--accent)'],
            ['活跃信号', signals.length, 'var(--high)'],
            ['高风险', criticalCount, 'var(--critical)'],
            ['研判议题', injectedSignals.length, 'var(--low)'],
          ].map(([label, value, color]) => (
            <div key={label as string} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{label as string}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1rem', color: color as string }}>{value}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center' }}>
          {criticalCount > 0 && (
            <span className="badge badge-critical"><span className="badge-dot" />{criticalCount} 高风险</span>
          )}
          <span className={`badge ${wmStatus.running ? 'badge-done' : 'badge-pending'}`}>
            <span className="badge-dot" />{wmStatus.running ? '监控中' : '已停止'}
          </span>
          <button
            className={`btn ${wmStatus.running ? 'btn-secondary' : 'btn-primary'} btn-sm`}
            onClick={toggleMonitor}
            style={{ height: 30, fontSize: '0.72rem' }}
          >
            {wmStatus.running ? '停止监控' : '启动监控'}
          </button>
        </div>
      </div>

      {/* ── Globe + Side Panels ─────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

        {/* ── Left: CII Country Rankings ──────────────────── */}
        <div style={{
          width: 260, flexShrink: 0,
          background: 'rgba(255,255,255,0.92)',
          borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{ padding: '10px 12px 6px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>CII 风险排行</div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
            {loading && ciiScores.length === 0 ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--sp-6)' }}>
                <div className="spinner" />
              </div>
            ) : topCountries.map((c, idx) => (
              <div key={c.iso} onClick={() => setSelectedCountry(c)}
                style={{
                  padding: '6px 8px', borderRadius: 'var(--radius-sm)', marginBottom: 2, cursor: 'pointer',
                  background: selectedCountry?.iso === c.iso ? `${CII_COLORS[c.level]}18` : 'transparent',
                  border: `1px solid ${selectedCountry?.iso === c.iso ? CII_COLORS[c.level] : 'transparent'}`,
                  transition: 'all var(--t-fast)',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--text-muted)', width: 12 }}>{idx + 1}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.8rem', color: CII_COLORS[c.level], width: 32 }}>{c.iso}</span>
                  <div style={{ flex: 1, height: 3, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${c.score}%`, background: CII_COLORS[c.level], borderRadius: 99 }} />
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.75rem', color: CII_COLORS[c.level] }}>{c.score.toFixed(1)}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Level Legend */}
          <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '0.04em' }}>风险层级</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Object.entries(CII_COLORS).map(([level, color]) => (
                <div key={level} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: `0 0 4px ${color}`, flexShrink: 0 }} />
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{LEVEL_ZH[level]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Center: Globe ──────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden' }}>
          <GlobeContainer
            ciiScores={ciiScores}
            signals={globeSignals}
            onCountryClick={(iso) => {
              const found = ciiScores.find(c => c.iso === iso)
              if (found) setSelectedCountry(found)
            }}
            domain={domain}
            onDomainChange={setDomain}
          />

          {/* Selected Country Detail Overlay */}
          {selectedCountry && (
            <div style={{
              position: 'absolute', top: 12, left: 12,
              background: 'rgba(255,255,255,0.95)',
              border: `1px solid ${CII_COLORS[selectedCountry.level] || 'var(--accent)'}`,
              borderRadius: 'var(--radius)',
              padding: '12px 14px',
              backdropFilter: 'blur(8px)',
              boxShadow: 'var(--shadow)',
              minWidth: 200,
              zIndex: 10,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1rem', color: CII_COLORS[selectedCountry.level] }}>
                  {selectedCountry.iso}
                </span>
                <button onClick={() => setSelectedCountry(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" width="12" height="12">
                    <line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" />
                  </svg>
                </button>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '2rem', fontWeight: 700, color: CII_COLORS[selectedCountry.level], lineHeight: 1 }}>
                {selectedCountry.score.toFixed(1)}<span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>/100</span>
              </div>
              <div style={{ marginTop: 4, fontSize: '0.72rem', color: CII_COLORS[selectedCountry.level] }}>
                {LEVEL_ZH[selectedCountry.level] ?? selectedCountry.level}
              </div>
              {selectedCountrySignals.length > 0 && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 6 }}>
                    最近信号
                  </div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {selectedCountrySignals.map((signal) => (
                      <div key={signal.id} style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                        {signal.description ?? `${SIGNAL_TYPE_ZH[signal.type] ?? signal.type}信号`}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Analysis Hint */}
          {showAnalysisHint && injectedSignals.length > 0 && (
            <div style={{
              position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(22,163,74,0.9)',
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
              ✓ 议题「{injectedSignals[0].query ?? injectedSignals[0].description}」已注入情报地球
            </div>
          )}
        </div>

        {/* ── Right: Real-time Signal Feed ─────────────── */}
        <div style={{
          width: 300, flexShrink: 0,
          background: 'rgba(255,255,255,0.92)',
          borderLeft: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{ padding: '10px 12px 6px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>实时信号流</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="live-pulse-dot" />
              <span style={{ fontSize: '0.62rem', color: '#22c55e', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>实时</span>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
            {feedSignals.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '0.75rem', flexDirection: 'column', gap: 8, padding: 'var(--sp-6)' }}>
                <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" width="40" height="40" opacity="0.3">
                  <circle cx="32" cy="32" r="26" /><circle cx="32" cy="32" r="16" /><circle cx="32" cy="32" r="6" />
                  <line x1="32" y1="6" x2="32" y2="14" /><line x1="32" y1="50" x2="32" y2="58" />
                  <line x1="6" y1="32" x2="14" y2="32" /><line x1="50" y1="32" x2="58" y2="32" />
                </svg>
                暂无信号，启动监控采集数据
              </div>
            ) : feedSignals.map((s, idx) => {
              const dotColor = s.type === 'military' || s.type === 'conflict' ? '#dc3214' : s.type === 'protest' ? '#dc3214' : '#5eb8ff'
              const isNew = idx === 0 && feedSignals.length > 0
              return (
                <div key={s.id} style={{
                  padding: '6px 8px', marginBottom: 2, borderRadius: 'var(--radius-sm)',
                  background: isNew ? 'rgba(37,99,235,0.05)' : 'transparent',
                  border: `1px solid ${isNew ? 'var(--accent-dim)' : 'transparent'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, boxShadow: `0 0 5px ${dotColor}`, flexShrink: 0, marginTop: 4 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                        {s.description ?? `${SIGNAL_TYPE_ZH[s.type] ?? s.type}信号`}
                      </div>
                      <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                        {s.country ?? ''} · {s.timestamp ? relativeTime(s.timestamp) : ''}
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
