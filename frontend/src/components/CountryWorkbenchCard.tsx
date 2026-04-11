interface CountryWorkbenchCardProps {
  iso: string
  name?: string
  countryName?: string
  riskScore?: number
  score?: number
  riskLevel?: 'critical' | 'high' | 'normal' | 'low' | 'elevated' | string
  level?: 'critical' | 'high' | 'normal' | 'low' | 'elevated' | string
  newsCount?: number
  signalCount?: number
  focalCount?: number
  lastActivity?: string
  latestActivity?: string | null
  latestHeadline?: string
  latestSummary?: string
  narrative?: string
  topSignalTypes?: string[]
  headlines?: Array<{ id: string; title: string; source?: string; publishedAt?: string | null }>
  signals?: Array<{ id: string; description?: string; source?: string; timestamp?: string | null; type?: string }>
  focalPoint?: { narrative: string; focalScore: number } | null
  highlight?: boolean
  analysisLabel?: string
  simulationLabel?: string
  onClose?: () => void
  onAnalysis?: () => void
  onSimulation?: () => void
}

function riskBadgeClass(score: number, level?: string) {
  const normalized = String(level || '').toLowerCase()
  if (normalized === 'critical' || score >= 80) return 'badge-critical'
  if (normalized === 'high' || score >= 65) return 'badge-high'
  return 'badge-normal'
}

export default function CountryWorkbenchCard({
  iso,
  name,
  countryName,
  riskScore,
  score,
  riskLevel,
  level,
  newsCount = 0,
  signalCount = 0,
  focalCount = 0,
  lastActivity,
  latestActivity,
  latestHeadline,
  latestSummary,
  narrative,
  topSignalTypes = [],
  headlines = [],
  signals = [],
  focalPoint,
  highlight = false,
  analysisLabel = '发起议题研判',
  simulationLabel = '启动未来预测',
  onClose,
  onAnalysis,
  onSimulation,
}: CountryWorkbenchCardProps) {
  const displayName = name || countryName || iso
  const displayScore = typeof riskScore === 'number' ? riskScore : typeof score === 'number' ? score : 0
  const displayLevel = riskLevel || level
  const displayActivity = lastActivity || latestActivity || '刚刚'
  const displayHeadline = latestHeadline || headlines[0]?.title || narrative || '等待同步'
  const displaySummary = latestSummary || focalPoint?.narrative || signals[0]?.description || '监控启动后会持续同步全球观测热点。'
  const displaySignals = signals.length > 0 ? signals : []

  return (
    <div style={{
      padding: 'var(--sp-3)',
      borderRadius: 'var(--radius-sm)',
      border: '1px solid var(--border)',
      background: highlight ? 'linear-gradient(135deg, rgba(37,99,235,0.08), rgba(255,255,255,0.95))' : 'rgba(255,255,255,0.88)',
      boxShadow: highlight ? '0 10px 24px rgba(37,99,235,0.08)' : 'none',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.66rem', fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 700 }}>
              {iso}
            </span>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {displayName}
            </span>
            {highlight ? (
              <span style={{ fontSize: '0.58rem', fontFamily: 'var(--font-mono)', color: '#fff', background: '#16a34a', borderRadius: 999, padding: '2px 6px' }}>
                新增
              </span>
            ) : null}
          </div>
          <div style={{ marginTop: 4, fontSize: '0.68rem', color: 'var(--text-muted)' }}>
            {displayActivity} · {newsCount} 条新闻 · {signalCount} 条信号 · {focalCount} 个焦点
          </div>
        </div>
        <span className={`badge ${riskBadgeClass(displayScore, displayLevel)}`}>
          <span className="badge-dot" />CII {displayScore.toFixed(1)}
        </span>
      </div>
      <div style={{ marginTop: 8, fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.55 }}>
        {displayHeadline}
      </div>
      <div style={{ marginTop: 6, fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        {displaySummary}
      </div>
      {topSignalTypes.length > 0 ? (
        <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {topSignalTypes.slice(0, 4).map((signalType) => (
            <span key={signalType} style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', padding: '4px 8px', borderRadius: 999, background: 'rgba(37,99,235,0.05)', border: '1px solid rgba(37,99,235,0.1)' }}>
              {signalType}
            </span>
          ))}
        </div>
      ) : null}
      {focalPoint ? (
        <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 'var(--radius-sm)', background: 'rgba(37,99,235,0.04)', border: '1px solid rgba(37,99,235,0.12)' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-primary)' }}>智能体重点判断</div>
          <div style={{ marginTop: 4, fontSize: '0.7rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {focalPoint.narrative}
          </div>
        </div>
      ) : null}
      {displaySignals.length > 0 ? (
        <div style={{ marginTop: 8, fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
          最新信号：{displaySignals[0].description || displaySignals[0].type || '已同步'}
        </div>
      ) : null}
      {(onAnalysis || onSimulation) ? (
        <div style={{ marginTop: 10, display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          {onAnalysis ? (
            <button className="btn btn-primary btn-sm" onClick={onAnalysis}>
              {analysisLabel}
            </button>
          ) : null}
          {onSimulation ? (
            <button className="btn btn-secondary btn-sm" onClick={onSimulation}>
              {simulationLabel}
            </button>
          ) : null}
        </div>
      ) : null}
      {onClose ? (
        <div style={{ marginTop: 8 }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.68rem' }}>
            收起
          </button>
        </div>
      ) : null}
    </div>
  )
}
