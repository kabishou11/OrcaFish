import { useEffect, useState } from 'react'

interface CIIOverview {
  cii: number
  level: string
  countries: Array<{ iso: string; score: number }>
  timestamp?: string
}

interface WMStatus {
  running: boolean
  last_poll: string | null
  poll_interval: number
  cii_threshold: number
}

interface SimRun { run_id: string; status: string; rounds_completed: number; created_at: string }
interface Pipeline { pipeline_id: string; stage: string; country_name: string; cii_score: number; created_at: string }

const STAGE_LABELS: Record<string, string> = {
  detected: '已检测', analysis: '研判中', simulation: '推演中', completed: '已完成', failed: '失败',
}

/* ── ScoreRing (enlarged) ───────────────────────────────────────────── */
function ScoreRing({ score, level, size = 160 }: { score: number; level: string; size?: number }) {
  const color =
    level === 'critical' ? 'var(--critical)' :
    level === 'high'     ? 'var(--high)'     :
    level === 'medium'   ? 'var(--medium)'   :
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

/* ── Dashboard ──────────────────────────────────────────────────────── */
export default function Dashboard() {
  const [cii, setCii] = useState<CIIOverview | null>(null)
  const [wmStatus, setWmStatus] = useState<WMStatus | null>(null)
  const [simRuns, setSimRuns] = useState<SimRun[]>([])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [loading, setLoading] = useState(true)
  const [ciiHistory, setCiiHistory] = useState<number[]>([])

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [ciiRes, wmRes, simRes, pipeRes] = await Promise.all([
          fetch('/api/intelligence/cii'),
          fetch('/api/intelligence/world-monitor/status'),
          fetch('/api/simulation/runs'),
          fetch('/api/pipeline/'),
        ])
        if (ciiRes.ok) {
          const d = await ciiRes.json()
          setCii(d)
          // accumulate history (keep last 7 values for sparkline)
          setCiiHistory(prev => {
            const next = [...prev, d.cii ?? 0]
            return next.length > 7 ? next.slice(-7) : next
          })
        }
        if (wmRes.ok)   setWmStatus(await wmRes.json())
        if (simRes.ok)  { const d = await simRes.json(); setSimRuns(d.runs ?? []) }
        if (pipeRes.ok) { const d = await pipeRes.json(); setPipelines(d.pipelines ?? []) }
      } catch { /* silent */ }
      setLoading(false)
    }
    fetchAll()
    const t = setInterval(fetchAll, 20000)
    return () => clearInterval(t)
  }, [])

  const levelBadgeClass =
    cii?.level === 'critical' ? 'badge-critical' :
    cii?.level === 'high'     ? 'badge-high'     :
    cii?.level === 'medium'   ? 'badge-medium'   : 'badge-low'

  if (loading) {
    return (
      <div className="empty-state" style={{ minHeight: '60vh' }}>
        <div className="spinner" style={{ width: 32, height: 32 }} />
        <p>正在连接 OrcaFish 后端...</p>
      </div>
    )
  }

  const runningSims = simRuns.filter(r => r.status === 'running').length
  const activePipelines = pipelines.filter(p => p.stage !== 'completed' && p.stage !== 'failed').length
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

  // sparkline fallback: if no history, create mock from country scores
  const sparkData = ciiHistory.length >= 2
    ? ciiHistory
    : (cii?.countries?.slice(0, 7).map(c => c.score) ?? [30, 35, 40, 38, 42])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>

      {/* ═══════════════════════════════════════════════════════════════
           1. HERO AREA — full-width gradient
         ═══════════════════════════════════════════════════════════════ */}
      <div style={{
        background: 'linear-gradient(135deg, #eef2ff 0%, #f0f4f8 60%, #e8f4f8 100%)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)',
        padding: 'var(--sp-8)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* decorative circles */}
        <div style={{ position: 'absolute', top: -60, right: -60, width: 200, height: 200, borderRadius: '50%', background: 'rgba(37,99,235,0.04)' }} />
        <div style={{ position: 'absolute', bottom: -40, left: -40, width: 160, height: 160, borderRadius: '50%', background: 'rgba(124,58,237,0.03)' }} />

        {/* top row: title + badge */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--sp-6)', position: 'relative' }}>
          <div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              预测总览
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
              OrcaFish 预见中枢 · 全球观测 · 议题研判 · 未来推演
            </div>
            {cii?.timestamp && (
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 8, fontFamily: 'var(--font-mono)' }}>
                数据更新于 {new Date(cii.timestamp).toLocaleString('zh-CN')}
              </div>
            )}
          </div>
          <div className="flex gap-3" style={{ alignItems: 'center' }}>
            <span
              className={`badge ${wmStatus?.running ? 'badge-done' : 'badge-pending'}`}
              style={wmStatus?.running ? { boxShadow: '0 0 10px var(--accent-dim)' } : undefined}
            >
              <span className="badge-dot" />
              {wmStatus?.running ? '监测引擎运行中' : '监测引擎已停止'}
            </span>
          </div>
        </div>

        {/* main hero content: CII ring + KPI cards */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-8)', flexWrap: 'wrap', position: 'relative' }}>
          {/* CII Ring + Level */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--sp-3)' }}>
            <ScoreRing score={cii?.cii ?? 0} level={cii?.level ?? 'low'} size={180} />
            <span className={`badge ${levelBadgeClass}`} style={{ fontSize: '0.8rem', padding: '4px 14px' }}>
              <span className="badge-dot" />
              全球危机指数 · {cii?.level?.toUpperCase() ?? '—'}
            </span>
          </div>

          {/* 3 KPI glass cards */}
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--sp-4)', minWidth: 320 }}>
            <StatCard label="活跃信号" value={signalsTotal(pipelines)} sub="全球情报源" accent="var(--accent)" />
            <StatCard label="推演次数" value={simRuns.length} sub={runningSims > 0 ? `${runningSims} 运行中` : '全部完成'} accent="var(--stage-active)" />
            <StatCard label="自动流程" value={activePipelines} sub={`共 ${pipelines.length} 条流程`} accent="var(--medium)" />
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
           2. QUICK LINKS — colored left bar + arrow
         ═══════════════════════════════════════════════════════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--sp-4)' }}>
        {([
          { href: '/intelligence', title: '全球观测', desc: '实时信号监控与危机指数计算', icon: <IconRadar />, accent: 'var(--accent)' },
          { href: '/analysis',    title: '议题研判', desc: '多源舆情聚合与情感分析',     icon: <IconSearch />, accent: 'var(--high)' },
          { href: '/simulation',  title: '未来推演', desc: '群体智能仿真与情景预测',     icon: <IconChart />, accent: 'var(--low)' },
          { href: '/pipeline',    title: '自动流程', desc: '三阶段自动化流程编排',       icon: <IconPipeline />, accent: 'var(--medium)' },
        ] as const).map(item => (
          <a key={item.href} href={item.href} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div
              className="panel"
              style={{
                display: 'flex',
                overflow: 'hidden',
                transition: 'box-shadow var(--t-base), transform var(--t-base)',
                cursor: 'pointer',
                height: '100%',
              }}
              onMouseEnter={e => { const el = e.currentTarget; el.style.boxShadow = `0 8px 24px rgba(15,23,42,0.10), inset 4px 0 0 ${item.accent}`; el.style.transform = 'translateY(-3px)' }}
              onMouseLeave={e => { const el = e.currentTarget; el.style.boxShadow = 'var(--shadow-sm)'; el.style.transform = 'translateY(0)' }}
            >
              {/* colored left bar */}
              <div style={{ width: 4, background: item.accent, flexShrink: 0 }} />
              <div style={{ flex: 1, padding: 'var(--sp-4) var(--sp-4)', display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10,
                  background: 'var(--bg-overlay)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: item.accent, flexShrink: 0,
                }}>
                  {item.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: 2 }}>{item.title}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{item.desc}</div>
                </div>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" style={{ flexShrink: 0 }}>
                  <path d="M6 3l5 5-5 5" />
                </svg>
              </div>
            </div>
          </a>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════
           3. DATA OVERVIEW ROW — sparkline + pipeline progress + sim stats
         ═══════════════════════════════════════════════════════════════ */}
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

      {/* ═══════════════════════════════════════════════════════════════
           4. RECENT PIPELINES TABLE — improved header
         ═══════════════════════════════════════════════════════════════ */}
      {pipelines.length > 0 && (
        <div className="panel">
          <div className="panel-header" style={{
            background: 'linear-gradient(135deg, var(--bg-raised) 0%, #f0f4ff 100%)',
          }}>
            <span className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 4h12M2 8h12M2 12h12" />
              </svg>
              最近流水线
            </span>
            <a href="/pipeline" style={{ fontSize: '0.78rem', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
              查看全部
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 3l5 5-5 5" /></svg>
            </a>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ background: 'linear-gradient(135deg, var(--bg-raised) 0%, #f0f4ff 100%)' }}>地区</th>
                  <th style={{ background: 'linear-gradient(135deg, var(--bg-raised) 0%, #f0f4ff 100%)' }}>CII</th>
                  <th style={{ background: 'linear-gradient(135deg, var(--bg-raised) 0%, #f0f4ff 100%)' }}>阶段</th>
                  <th style={{ background: 'linear-gradient(135deg, var(--bg-raised) 0%, #f0f4ff 100%)' }}>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {pipelines.slice(0, 8).map(p => {
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
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
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

function signalsTotal(pipelines: Pipeline[]): number | string {
  const count = pipelines.reduce((acc, p) => acc + (p.cii_score > 0 ? 1 : 0), 0)
  return count > 0 ? count : '—'
}
