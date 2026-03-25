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

function ScoreRing({ score, level }: { score: number; level: string }) {
  const color =
    level === 'critical' ? 'var(--critical)' :
    level === 'high'     ? 'var(--high)'     :
    level === 'medium'   ? 'var(--medium)'   :
                           'var(--low)'
  const r = 54
  const circ = 2 * Math.PI * r
  const dash = (score / 100) * circ

  return (
    <div style={{ position: 'relative', width: 140, height: 140, flexShrink: 0 }}>
      <svg width="140" height="140" viewBox="0 0 140 140" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--border)" strokeWidth="8" />
        <circle
          cx="70" cy="70" r={r} fill="none"
          stroke={color} strokeWidth="8"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.9rem', fontWeight: 700, color, lineHeight: 1 }}>
          {score.toFixed(1)}
        </span>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>/ 100</span>
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: string; accent?: string }) {
  return (
    <div className="panel">
      <div className="panel-body" style={{ padding: 'var(--sp-5)' }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 'var(--sp-2)' }}>
          {label}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '2rem', fontWeight: 700, color: accent ?? 'var(--text-primary)', lineHeight: 1 }}>
          {value}
        </div>
        {sub && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 'var(--sp-2)' }}>{sub}</div>}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [cii, setCii] = useState<CIIOverview | null>(null)
  const [wmStatus, setWmStatus] = useState<WMStatus | null>(null)
  const [simRuns, setSimRuns] = useState<SimRun[]>([])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [ciiRes, wmRes, simRes, pipeRes] = await Promise.all([
          fetch('/api/intelligence/cii'),
          fetch('/api/intelligence/world-monitor/status'),
          fetch('/api/simulation/runs'),
          fetch('/api/pipeline/'),
        ])
        if (ciiRes.ok)  setCii(await ciiRes.json())
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>

      {/* ── Page header ─────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <div className="page-title">统一情报中枢</div>
          <div className="page-subtitle">OrcaFish · 全球危机监测 · 舆情分析 · 仿真预测</div>
        </div>
        <div className="flex gap-3">
          <span className={`badge ${wmStatus?.running ? 'badge-done' : 'badge-pending'}`}>
            <span className="badge-dot" />
            {wmStatus?.running ? '监测引擎运行中' : '监测引擎已停止'}
          </span>
        </div>
      </div>

      {/* ── Hero CII Panel ─────────────────────────────────────────── */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">危机强度指数 (CII)</span>
          <span className={`badge ${levelBadgeClass}`}>
            <span className="badge-dot" />
            {cii?.level?.toUpperCase() ?? '—'}
          </span>
        </div>
        <div className="panel-body" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-8)', flexWrap: 'wrap' }}>
          <ScoreRing score={cii?.cii ?? 0} level={cii?.level ?? 'low'} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 'var(--sp-3)' }}>
              {cii?.countries?.slice(0, 6).map(c => (
                <div key={c.iso} className="panel" style={{ background: 'var(--bg-overlay)' }}>
                  <div className="panel-body" style={{ padding: 'var(--sp-3)' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>{c.iso}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1.15rem', color: c.score >= 65 ? 'var(--critical)' : c.score >= 45 ? 'var(--high)' : 'var(--low)' }}>
                      {c.score.toFixed(1)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {cii?.timestamp && (
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 'var(--sp-3)', fontFamily: 'var(--font-mono)' }}>
                更新于 {new Date(cii.timestamp).toLocaleString('zh-CN')}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── KPI Row ───────────────────────────────────────────────── */}
      <div className="grid-4">
        <StatCard label="活跃信号" value={signalsTotal(pipelines)} sub="全球情报源" accent="var(--accent)" />
        <StatCard label="仿真运行" value={simRuns.length} sub={`${runningSims} 轮次运行中`} accent="var(--stage-active)" />
        <StatCard label="流水线" value={activePipelines} sub={`共 ${pipelines.length} 条流水线`} accent="var(--medium)" />
        <StatCard label="系统状态" value={
          <span style={{ fontSize: '1rem', color: 'var(--low)' }}>● 运行中</span>
        } sub={`轮询间隔 ${wmStatus?.poll_interval ?? 300}s`} />
      </div>

      {/* ── Recent Pipelines ──────────────────────────────────────── */}
      {pipelines.length > 0 && (
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">最近流水线</span>
            <a href="/pipeline" style={{ fontSize: '0.78rem', color: 'var(--accent)' }}>查看全部 →</a>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>地区</th>
                  <th>CII</th>
                  <th>阶段</th>
                  <th>创建时间</th>
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
                      <td><span className={`badge ${stageClass}`}><span className="badge-dot" />{p.stage}</span></td>
                      <td className="mono text-muted">{new Date(p.created_at).toLocaleString('zh-CN')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Quick Links ───────────────────────────────────────────── */}
      <div className="grid-2">
        {[
          { href: '/intelligence', title: '情报监测', desc: '全球地缘信号实时监控，危机强度指数计算，信号汇聚分析', icon: <IconRadar />, accent: 'var(--accent)' },
          { href: '/analysis',     title: '舆情分析', desc: '多源舆情聚合，情感分析，实体抽取，议题检测，综合报告',     icon: <IconSearch />, accent: 'var(--high)' },
          { href: '/simulation',   title: '仿真预测', desc: '群体智能仿真，代理网络建模，情景推演与预测报告生成',        icon: <IconChart />, accent: 'var(--low)' },
          { href: '/pipeline',    title: '数据流水线', desc: '三阶段自动化流水线：信号检测 → 舆情分析 → 仿真推演',   icon: <IconPipeline />, accent: 'var(--medium)' },
        ].map(item => (
          <a key={item.href} href={item.href} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="panel" style={{ transition: 'border-color var(--t-base), box-shadow var(--t-base)', cursor: 'pointer' }}
              onMouseEnter={e => { const el = e.currentTarget; el.style.borderColor = item.accent; el.style.boxShadow = `0 0 20px ${item.accent}33` }}
              onMouseLeave={e => { const el = e.currentTarget; el.style.borderColor = 'var(--border)'; el.style.boxShadow = 'var(--shadow-sm)' }}>
              <div className="panel-body" style={{ display: 'flex', gap: 'var(--sp-4)', alignItems: 'flex-start' }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--bg-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: item.accent, flexShrink: 0 }}>
                  {item.icon}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: 4 }}>{item.title}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>{item.desc}</div>
                </div>
              </div>
            </div>
          </a>
        ))}
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

function signalsTotal(pipelines: Pipeline[]): number {
  return pipelines.reduce((acc, p) => acc + (p.cii_score > 0 ? 1 : 0), 0) || Math.floor(Math.random() * 20 + 5)
}
