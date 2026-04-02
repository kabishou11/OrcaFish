import { useEffect, useState, useRef, useCallback } from 'react'
import GraphPanel from './GraphPanel'


interface SimulationRun {
  run_id: string; status: string; rounds_completed: number; convergence_achieved: boolean;
  final_states?: Array<{ id: string; position: [number, number]; belief: number; influence: number }>;
  duration_ms?: number; created_at?: string;
}

// ── KG types for local state ─────────────────────────────────────────────────
interface KGNode { id: string; name: string; type: string; labels?: string[]; properties?: Record<string, unknown> }
interface KGLink { source: string; target: string; type: string; name: string; weight?: number }

interface SimRunStatus {
  twitter_current_round: number; reddit_current_round: number; total_rounds: number
  twitter_completed: boolean; reddit_completed: boolean
  twitter_actions_count: number; reddit_actions_count: number
}


// ── SimulationStreamPanel ──────────────────────────────────────────────────────
interface SimAction {
  id: string; agent_id: string; agent_name: string; action_type: string
  platform: string; action_args: Record<string, unknown>; round_num: number; timestamp: string
}

function SimulationStreamPanel({ runId, runStatus: _runStatus }: { runId: string; runStatus: SimRunStatus | null }) {
  const [actions, setActions] = useState<SimAction[]>([])
  const timelineRef = useRef<HTMLDivElement>(null)
  const seenIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!runId) return
    seenIdsRef.current = new Set()
    setActions([])

    const poll = async () => {
      try {
        const acRes = await fetch(`/api/simulation/runs/${runId}/detail`)
        if (acRes.ok) {
          const ac = await acRes.json() as { all_actions?: SimAction[] }
          setActions(prev => {
            const newOnes = (ac.all_actions || []).filter(a => {
              if (seenIdsRef.current.has(a.id)) return false
              seenIdsRef.current.add(a.id); return true
            })
            return newOnes.length > 0 ? [...prev, ...newOnes] : prev
          })
        }
      } catch (_) { /* ignore network errors during polling */ }
    }

    poll()
    const id = setInterval(poll, 3000)
    return () => clearInterval(id)
  }, [runId])

  useEffect(() => {
    const el = timelineRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [actions])

  const ACTION_COLORS: Record<string, string> = {
    CREATE_POST: '#b0bec5', LIKE_POST: '#90a4ae', REPOST: '#78909c',
    COMMENT: '#607d8b', FOLLOW: '#546e7a', UNFOLLOW: '#455a64',
  }

  const formatTime = (ts: string) => {
    try { return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false }) }
    catch (_) { return ts }
  }

  const previewText = (action: SimAction) => {
    const args = action.action_args || {}
    if (args.content) return String(args.content).slice(0, 60)
    if (args.text) return String(args.text).slice(0, 60)
    if (args.target_user) return `@${args.target_user}`
    if (args.post_id) return `[帖子 ${args.post_id}]`
    return ''
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, fontFamily: 'var(--font-sans)' }}>

      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)', overflow: 'hidden', minHeight: 340,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 12px', borderBottom: '1px solid var(--border)',
          background: 'rgba(255,255,255,0.95)', flexShrink: 0,
        }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            代理体行动流
          </span>
          <span style={{ fontSize: '0.65rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)', opacity: 0.7 }}>
            {actions.length} 条行动
          </span>
        </div>

        <div ref={timelineRef} style={{ flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 440 }}>
          {actions.length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', gap: 8 }}>
              <PulseDot />
              等待行动推送...
            </div>
          )}
          {actions.map((action, idx) => (
            <div key={action.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 6, padding: '8px 10px',
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                background: 'var(--bg-overlay)', border: '1.5px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.68rem', fontWeight: 700, color: 'var(--accent)',
                fontFamily: 'var(--font-mono)', marginTop: 1,
              }}>
                {(action.agent_name || action.agent_id || '?')[0].toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                    {action.agent_name || action.agent_id}
                  </span>
                  <span style={{
                    fontSize: '0.6rem', fontFamily: 'var(--font-mono)', fontWeight: 600,
                    padding: '1px 5px', borderRadius: 3,
                    background: 'var(--bg-overlay)', color: ACTION_COLORS[action.action_type] || '#78909c',
                    letterSpacing: '0.04em', textTransform: 'uppercase',
                  }}>
                    {action.action_type}
                  </span>
                  <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    [{action.platform}]
                  </span>
                  {idx === actions.length - 1 && (
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
                  )}
                </div>
                {previewText(action) && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    {previewText(action)}
                  </div>
                )}
                <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                  R{action.round_num} · {formatTime(action.timestamp)}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{
          background: 'var(--bg-base)', borderTop: '1px solid var(--border)',
          padding: '6px 12px', flexShrink: 0,
        }}>
          <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>
            系统日志
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            [{formatTime(new Date().toISOString())}]
            {actions.length > 0
              ? ` 已捕获 ${actions.length} 个事件 · 流活跃`
              : ' 轮询仿真数据流中...'}
          </div>
        </div>
      </div>
    </div>
  )
}

function PulseDot() {
  return (
    <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', animation: 'pulse 1.2s ease-in-out infinite' }} />
  )
}

// ── PlatformStatusCard ────────────────────────────────────────────────────────
function PlatformStatusCard({ platform, status, runStatus }: {
  platform: 'twitter' | 'reddit'
  status: { round: number; total: number; actions: number; completed: boolean }
  runStatus: SimRunStatus | null
}) {
  const accentColor = platform === 'twitter' ? 'var(--accent)' : '#ff8c42'
  const label = platform === 'twitter' ? 'Info Plaza' : 'Topic Community'
  const platformName = platform === 'twitter' ? 'X / Twitter' : 'Reddit'
  const iconPath = platform === 'twitter'
    ? 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'
    : 'M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm4.327 9.873c.02-.449-.322-.827-.77-.844-3.493-.133-6.468-1.708-6.468-5.137 0-.462.052-.912.156-1.343a.94.94 0 0 0-.534-.777.955.955 0 0 0-.884.142C5.606 4.052 4.854 6.264 5.22 8.24c.017.091.027.184.027.28 0 2.494-1.25 4.18-2.772 4.18-1.396 0-2.102-1.11-2.102-2.24 0-2.833 2.528-5.76 7.104-5.76 3.772 0 6.16 2.728 6.16 6.08 0 3.104-1.73 5.612-4.328 5.612-.91 0-1.67-.462-2.028-.977l-1.96 1.06c.603 1.168 1.894 1.95 3.988 1.95 2.96 0 5.532-2.326 5.532-5.21 0-2.86-1.86-4.954-3.98-4.954z'
  const progressPct = status.total > 0 ? Math.min((status.round / status.total) * 100, 100) : 0
  const isLive = runStatus !== null && !status.completed

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)', padding: '12px 14px',
      borderTopWidth: 3, borderTopStyle: 'solid',
      borderTopColor: accentColor,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <svg viewBox="0 0 24 24" fill={accentColor} width="14" height="14" style={{ flexShrink: 0 }}>
            <path d={iconPath} />
          </svg>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {label}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {isLive && (
            <span style={{
              display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
              background: accentColor, animation: 'pulse 1.2s ease-in-out infinite',
            }} />
          )}
          {status.completed ? (
            <span style={{ fontSize: '0.6rem', color: 'var(--low)', fontFamily: 'var(--font-mono)' }}>已完成</span>
          ) : (
            <span style={{ fontSize: '0.6rem', color: accentColor, fontFamily: 'var(--font-mono)', opacity: 0.75 }}>{platformName}</span>
          )}
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginBottom: 1 }}>轮次</div>
          <div style={{ fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>
            {status.round}<span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>/{status.total}</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginBottom: 1 }}>行动数</div>
          <div style={{ fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: accentColor, fontWeight: 600 }}>
            {status.actions}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{
        height: 3, background: 'var(--border)', borderRadius: 99, overflow: 'hidden',
        boxShadow: status.completed ? 'none' : `0 0 6px ${accentColor}55`,
      }}>
        <div style={{
          height: '100%', borderRadius: 99,
          background: `linear-gradient(90deg, ${accentColor}88, ${accentColor})`,
          width: `${progressPct}%`,
          transition: 'width 0.4s ease',
        }} />
      </div>
    </div>
  )
}

// ── Report Viewer ──────────────────────────────────────────────────────────────
interface ReportSection {
  id: string
  label: string
}

const REPORT_SECTION_LABELS: Record<string, string> = {
  'executive-summary': '执行摘要',
  'summary': '执行摘要',
  'background': '背景',
  'analysis': '分析',
  'prediction': '预测',
  'recommendations': '建议',
  'recommendation': '建议',
}

function ReportViewer({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [report, setReport] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Extract sections from HTML headings
  const extractSections = useCallback((): ReportSection[] => {
    if (!report) return []
    const parser = new DOMParser()
    const doc = parser.parseFromString(report, 'text/html')
    const headings = doc.querySelectorAll('h1, h2, h3, h4')
    const sections: ReportSection[] = []
    headings.forEach((h, i) => {
      const text = h.textContent?.trim() || ''
      const id = h.id || `section-${i}`
      // Auto-generate stable IDs
      if (!h.id) h.setAttribute('id', id)
      // Map to known section labels
      const key = text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
      const label = REPORT_SECTION_LABELS[key] || text
      sections.push({ id, label })
    })
    return sections
  }, [report])

  // Load report
  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/report/${runId}`)
      .then(r => {
        if (!r.ok) throw new Error(`加载失败: ${r.status}`)
        return r.json()
      })
      .then(d => setReport(d.html_content || d.content || d.report || ''))
      .catch(err => setError(err.message || '加载报告失败'))
      .finally(() => setLoading(false))
  }, [runId])

  // Scroll to section
  const scrollToSection = useCallback((id: string) => {
    setActiveSection(id)
    if (contentRef.current) {
      const el = contentRef.current.querySelector(`#${id}`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } else {
        contentRef.current.scrollTop = 0
      }
    }
  }, [])

  const sections = extractSections()
  // Unique sections preserving order
  const uniqueSections = sections.filter((s: ReportSection, i: number) => sections.findIndex((x: ReportSection) => x.label === s.label) === i)

  return (
    <div className="report-drawer-overlay" onClick={onClose}>
      <div className="report-drawer" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="report-drawer-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
            <FileIcon />
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>仿真报告</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
                {runId}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            {sections.length > 0 && (
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginRight: 'var(--sp-2)' }}>
                {sections.length} 个章节
              </div>
            )}
            <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ color: 'var(--text-secondary)', padding: '6px 10px' }}>
              <CloseIcon />
            </button>
          </div>
        </div>

        {/* Body: sidebar + content */}
        <div className="report-drawer-body">
          {/* Section Nav */}
          <div className="report-section-nav">
            <div className="report-section-nav-title">导航</div>
            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--sp-6)' }}>
                <div className="spinner" />
              </div>
            ) : error ? (
              <div style={{ padding: 'var(--sp-4)', fontSize: '0.78rem', color: 'var(--critical)' }}>{error}</div>
            ) : uniqueSections.length > 0 ? (
              uniqueSections.map((section: ReportSection) => (
                <button
                  key={section.id}
                  onClick={() => scrollToSection(section.id)}
                  className={`report-section-btn${activeSection === section.id ? ' active' : ''}`}
                >
                  {section.label}
                </button>
              ))
            ) : (
              <div style={{ padding: 'var(--sp-4)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>未检测到章节</div>
            )}
          </div>

          {/* Content */}
          <div className="report-content-area" ref={contentRef}>
            {loading ? (
              <div className="report-loading">
                <div className="spinner" style={{ width: 28, height: 28 }} />
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  正在生成报告...
                </div>
              </div>
            ) : error ? (
              <div className="report-error">
                <div style={{ color: 'var(--critical)', fontWeight: 600, marginBottom: 'var(--sp-2)' }}>加载失败</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{error}</div>
              </div>
            ) : report ? (
              <div
                className="report-body"
                dangerouslySetInnerHTML={{ __html: report }}
              />
            ) : (
              <div style={{ padding: 'var(--sp-8)', textAlign: 'center', color: 'var(--text-muted)' }}>
                报告内容为空
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function FileIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      width="18" height="18" style={{ color: 'var(--accent)', flexShrink: 0 }}>
      <path d="M11 2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-6-5z" />
      <polyline points="11 2 11 7 6 7" />
      <line x1="7" y1="11" x2="13" y2="11" />
      <line x1="7" y1="14" x2="11" y2="14" />
    </svg>
  )
}

// ── Main Simulation Page ──────────────────────────────────────────────────────
interface CreateConfig { seed_content: string; simulation_requirement: string; max_rounds: number; name: string }

export default function SimulationPage() {
  const [runs, setRuns] = useState<SimulationRun[]>([])
  const [loadingRuns, setLoadingRuns] = useState(true)
  const [creating, setCreating] = useState(false)
  const [config, setConfig] = useState<CreateConfig>({
    seed_content: '',
    simulation_requirement: '',
    max_rounds: 40,
    name: '仿真推演',
  })
  const [selectedRun, setSelectedRun] = useState<SimulationRun | null>(null)
  const [showReport, setShowReport] = useState(false)
  const [startingRun, setStartingRun] = useState(false)
  const [stoppingRun, setStoppingRun] = useState(false)
  const [runStatus, setRunStatus] = useState<SimRunStatus | null>(null)
  const [graphData, setGraphData] = useState<{ nodes: KGNode[]; edges: KGLink[] } | null>(null)
  const [graphLoading, setGraphLoading] = useState(false)

  // Fetch graph data when selected run changes
  useEffect(() => {
    if (!selectedRun?.run_id) { setGraphData(null); return }
    setGraphLoading(true)
    fetch(`/api/simulation/runs/${selectedRun.run_id}/graph`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d && (d.nodes?.length > 0 || d.edges?.length > 0)) {
          setGraphData({ nodes: d.nodes as KGNode[], edges: d.edges as KGLink[] })
        }
      })
      .catch(() => {})
      .finally(() => setGraphLoading(false))
  }, [selectedRun?.run_id])

  // Poll runs list every 10s to keep status fresh; sync selected run status every 3s
  useEffect(() => {
    const loadRuns = () => {
      fetch('/api/simulation/runs')
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (d && d.runs) {
            setRuns(prev => {
              // Merge fresh data with local state
              const merged: SimulationRun[] = []
              const freshMap = new Map(d.runs.map((r: SimulationRun) => [r.run_id, r]))
              for (const old of prev) {
                const updated = freshMap.get(old.run_id)
                merged.push(updated ? { ...old, ...updated } : old)
              }
              for (const r of d.runs as SimulationRun[]) {
                if (!prev.find(p => p.run_id === r.run_id)) merged.push(r)
              }
              return merged
            })
          }
        })
        .catch(() => {})
    }
    loadRuns()
    setLoadingRuns(false)  // mark initial load done
    const t = setInterval(loadRuns, 10000)
    return () => clearInterval(t)
  }, [])

  // Sync selectedRun with backend every 3s
  useEffect(() => {
    if (!selectedRun) return
    const t = setInterval(() => {
      fetch(`/api/simulation/runs/${selectedRun.run_id}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (d) {
            setSelectedRun(prev => prev ? { ...prev, ...d } : prev)
            setRuns(prev => prev.map(r => r.run_id === selectedRun.run_id ? { ...r, ...d } : r))
          }
        })
        .catch(() => {})
    }, 3000)
    return () => clearInterval(t)
  }, [selectedRun?.run_id])

  // Poll platform status (runStatus) for Action Stream & Platform Status Cards
  useEffect(() => {
    if (!selectedRun) { setRunStatus(null); return }
    const poll = async () => {
      try {
        const stRes = await fetch(`/api/simulation/runs/${selectedRun.run_id}/status`)
        if (stRes.ok) setRunStatus(await stRes.json() as SimRunStatus)
      } catch (_) { /* ignore */ }
    }
    poll()
    const id = setInterval(poll, 3000)
    return () => clearInterval(id)
  }, [selectedRun?.run_id])

  const platformStatus = (platform: string) => {
    if (!runStatus) return { round: 0, total: 0, actions: 0, completed: false }
    if (platform === 'twitter') return {
      round: runStatus.twitter_current_round, total: runStatus.total_rounds,
      actions: runStatus.twitter_actions_count, completed: runStatus.twitter_completed,
    }
    return {
      round: runStatus.reddit_current_round, total: runStatus.total_rounds,
      actions: runStatus.reddit_actions_count, completed: runStatus.reddit_completed,
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!config.seed_content.trim() && !config.name.trim()) return
    setCreating(true)
    try {
      const res = await fetch('/api/simulation/runs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: config.name || config.seed_content.slice(0, 40) || '仿真推演',
          seed_content: config.seed_content,
          simulation_requirement: config.simulation_requirement || `分析并预测以下议题的演化趋势：${config.seed_content}`,
          max_rounds: config.max_rounds,
        }),
      })
      if (!res.ok) throw new Error('创建失败')
      const run: SimulationRun = await res.json()
      setRuns(prev => [run, ...prev]); setSelectedRun(run)
    } catch (err) { console.error(err) }
    finally { setCreating(false) }
  }

  const handleDelete = async (runId: string) => {
    await fetch(`/api/simulation/runs/${runId}`, { method: 'DELETE' })
    setRuns(prev => prev.filter(r => r.run_id !== runId))
    if (selectedRun?.run_id === runId) setSelectedRun(null)
  }

  const handleStart = async (runId: string) => {
    setStartingRun(true)
    try {
      const res = await fetch(`/api/simulation/runs/${runId}/start`, { method: 'POST' })
      if (!res.ok) throw new Error('启动失败')
      const updated: SimulationRun = await res.json()
      setRuns(prev => prev.map(r => r.run_id === runId ? updated : r))
      setSelectedRun(prev => prev?.run_id === runId ? updated : prev)
    } catch (err) {
      console.error(err)
    } finally {
      setStartingRun(false)
    }
  }

  const handleStop = async (runId: string) => {
    setStoppingRun(true)
    try {
      const res = await fetch(`/api/simulation/runs/${runId}/stop`, { method: 'POST' })
      if (!res.ok) throw new Error('停止失败')
      const updated: SimulationRun = await res.json()
      setRuns(prev => prev.map(r => r.run_id === runId ? updated : r))
      setSelectedRun(prev => prev?.run_id === runId ? updated : prev)
    } catch (err) {
      console.error(err)
    } finally {
      setStoppingRun(false)
    }
  }

  const statusBadge = (status: string) => {
    const cls = status === 'completed' ? 'badge-done' : status === 'running' ? 'badge-active' : status === 'failed' ? 'badge-failed' : 'badge-pending'
    const statusLabels: Record<string,string> = { completed:'已完成', running:'运行中', failed:'失败', created:'待启动', paused:'已暂停' }
    return <span className={`badge ${cls}`}><span className="badge-dot" />{statusLabels[status] ?? status}</span>
  }

  const inputStyle = (focused = false) => ({
    width: '100%', padding: '8px 12px',
    backgroundColor: 'var(--bg-base)', border: `1px solid ${focused ? 'var(--accent)' : 'var(--border-bright)'}`,
    borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
    fontFamily: 'inherit', fontSize: '0.875rem', outline: 'none',
    transition: 'border-color var(--t-fast)',
  })

  const progress = selectedRun?.status === 'running' && selectedRun?.rounds_completed
    ? Math.min((selectedRun.rounds_completed / config.max_rounds) * 100, 100)
    : selectedRun?.status === 'completed' ? 100 : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>

      {/* ── Page Header ─────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <div className="page-title">未来推演</div>
          <div className="page-subtitle">万物皆可推演 · OASIS 代理网络 · 知识图谱 · 情景预测</div>
        </div>
        <div className="flex gap-3">
          <span className="badge badge-active"><span className="badge-dot" />{runs.length} 条记录</span>
        </div>
      </div>

      {/* ── Control Bar ─────────────────────────────────────────── */}
      <div className="panel" style={{ padding: 'var(--sp-4) var(--sp-5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-4)' }}>
          {/* Left: selected run info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', minWidth: 0 }}>
            {selectedRun ? (
              <>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                  {selectedRun.run_id}
                </span>
                {statusBadge(selectedRun.status)}
                {selectedRun.status === 'running' && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {selectedRun.rounds_completed} / {config.max_rounds} 轮
                  </div>
                )}
                {selectedRun.duration_ms && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {(selectedRun.duration_ms / 1000).toFixed(1)}s
                  </div>
                )}
              </>
            ) : (
              <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>选择一条仿真记录进行操作</span>
            )}
          </div>

          {/* Right: action buttons */}
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexShrink: 0 }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => selectedRun && handleStart(selectedRun.run_id)}
              disabled={!selectedRun || selectedRun.status === 'running' || selectedRun.status === 'completed' || startingRun}
              title={!selectedRun ? '先选择一条仿真记录' : selectedRun.status === 'running' ? '仿真正在进行中' : selectedRun.status === 'completed' ? '仿真已完成' : '开始仿真'}
              style={{ opacity: (!selectedRun || selectedRun.status === 'running' || selectedRun.status === 'completed') ? 0.45 : 1 }}
            >
              <PlayIcon />
              {startingRun ? '启动中...' : '开始仿真'}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => selectedRun && handleStop(selectedRun.run_id)}
              disabled={!selectedRun || selectedRun.status !== 'running' || stoppingRun}
              title={!selectedRun ? '先选择一条仿真记录' : selectedRun.status !== 'running' ? '当前状态无法停止' : '停止仿真'}
              style={{ opacity: (!selectedRun || selectedRun.status !== 'running') ? 0.45 : 1 }}
            >
              <StopIcon />
              {stoppingRun ? '停止中...' : '停止仿真'}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => selectedRun && setShowReport(true)}
              disabled={!selectedRun || selectedRun.status !== 'completed'}
              title={!selectedRun ? '先选择一条仿真记录' : selectedRun.status !== 'completed' ? '仅在仿真完成后可用' : '查看报告'}
              style={{ opacity: (!selectedRun || selectedRun.status !== 'completed') ? 0.45 : 1 }}
            >
              <FileIcon />
              查看报告
            </button>
          </div>
        </div>
      </div>

      {/* ── Main Layout: 280px left (controls) | 1fr center (graph) | 300px right (status) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr 300px', gap: 'var(--sp-4)', alignItems: 'start', minHeight: 720 }}>

        {/* ── Left: Controls + Runs ────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>

          {/* Runs List */}
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">推演记录</span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{runs.length}</span>
            </div>
            {loadingRuns ? (
              <div className="empty-state"><div className="spinner" /></div>
            ) : runs.length === 0 ? (
              <div className="empty-state"><FishEmptyIcon /><p>暂无推演记录</p></div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: 'var(--sp-2)' }}>
                {runs.map(run => (
                  <div key={run.run_id} onClick={() => setSelectedRun(run)} style={{
                    padding: 'var(--sp-3)', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                    border: `1px solid ${selectedRun?.run_id === run.run_id ? 'var(--accent)' : 'transparent'}`,
                    background: selectedRun?.run_id === run.run_id ? 'var(--accent-dim)' : 'transparent',
                    transition: 'all var(--t-fast)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', marginBottom: 3 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
                          {run.run_id}
                        </span>
                        {statusBadge(run.status)}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {run.rounds_completed} 轮 · {run.convergence_achieved ? '已收敛' : '未收敛'}
                      </div>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); handleDelete(run.run_id) }}
                      style={{ color: 'var(--text-muted)', padding: '2px 6px' }}>
                      <CloseIcon />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Create Form */}
          <div className="panel">
            <div className="panel-header"><span className="panel-title">创建推演</span><FishIcon /></div>
            <div className="panel-body">
              <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                <div>
                  <textarea
                    value={config.seed_content}
                    onChange={e => setConfig(p => ({ ...p, seed_content: e.target.value }))}
                    placeholder="输入推演议题..."
                    rows={4}
                    style={{ ...inputStyle() as React.CSSProperties, resize: 'vertical' as const }}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-2)' }}>
                  <div>
                    <label style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>最大轮次</label>
                    <input type="number" value={config.max_rounds} min={1} max={200}
                      onChange={e => setConfig(p => ({ ...p, max_rounds: parseInt(e.target.value) || 1 }))}
                      style={inputStyle()} />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>任务名称</label>
                    <input type="text" value={config.name}
                      onChange={e => setConfig(p => ({ ...p, name: e.target.value }))}
                      style={inputStyle()} />
                  </div>
                </div>
                <button type="submit" className="btn btn-primary" disabled={creating}
                  style={{ width: '100%', justifyContent: 'center' }}>
                  {creating ? <><div className="spinner-sm" /> 创建中...</> : <><PlayIcon /> 启动推演</>}
                </button>
              </form>
            </div>
          </div>

          {/* Selected Run Controls */}
          {selectedRun && (
            <div className="panel">
              <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
                  {selectedRun.run_id}
                </div>
                {statusBadge(selectedRun.status)}
                <button className="btn btn-primary btn-sm"
                  onClick={() => handleStart(selectedRun.run_id)}
                  disabled={!selectedRun || selectedRun.status === 'running' || selectedRun.status === 'completed' || startingRun}
                  style={{ width: '100%', justifyContent: 'center' }}>
                  <PlayIcon /> {startingRun ? '启动中...' : '开始仿真'}
                </button>
                <button className="btn btn-secondary btn-sm"
                  onClick={() => handleStop(selectedRun.run_id)}
                  disabled={!selectedRun || selectedRun.status !== 'running' || stoppingRun}
                  style={{ width: '100%', justifyContent: 'center' }}>
                  <StopIcon /> {stoppingRun ? '停止中...' : '停止仿真'}
                </button>
                <button className="btn btn-ghost btn-sm"
                  onClick={() => setShowReport(true)}
                  disabled={!selectedRun || selectedRun.status !== 'completed'}
                  style={{ width: '100%', justifyContent: 'center' }}>
                  <FileIcon /> 查看报告
                </button>
              </div>
            </div>
          )}

          {/* Action Stream (live) */}
          {selectedRun && (selectedRun.status === 'running' || selectedRun.status === 'created') && (
            <div className="panel">
              <div className="panel-header">
                <span className="panel-title">行动流</span>
                <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', animation: 'pulse 1.2s ease-in-out infinite' }} />
              </div>
              <div style={{ height: 300 }}>
                <SimulationStreamPanel runId={selectedRun.run_id} runStatus={runStatus} />
              </div>
            </div>
          )}
        </div>

        {/* ── Center: Knowledge Graph — 最大展示 ────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)', alignItems: 'stretch' }}>
          <div>
            {/* Section header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)' }}>
                关系图谱
              </span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              {selectedRun && (
                <span style={{ fontSize: '0.65rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                  {selectedRun.status === 'running' && <><PulseDot /> 运行中 · </>}
                  {selectedRun.final_states?.length ?? 0} 个代理体
                </span>
              )}
            </div>
            <div style={{
              height: 640,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              overflow: 'hidden',
              boxShadow: 'var(--shadow-sm)',
            }}>
              {selectedRun ? (
                <GraphPanel graphData={graphData ?? undefined} loading={graphLoading} />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 'var(--sp-4)' }}>
                  <svg viewBox="0 0 80 80" fill="none" stroke="var(--accent-dim)" strokeWidth="1.5" width="80" height="80">
                    <circle cx="20" cy="20" r="6" />
                    <circle cx="60" cy="16" r="5" />
                    <circle cx="40" cy="52" r="8" />
                    <circle cx="68" cy="46" r="4" />
                    <circle cx="12" cy="52" r="4" />
                    <circle cx="44" cy="16" r="3" />
                    <line x1="25" y1="24" x2="53" y2="48" />
                    <line x1="29" y1="26" x2="36" y2="46" />
                    <line x1="63" y1="20" x2="65" y2="42" />
                    <line x1="43" y1="52" x2="64" y2="48" />
                    <line x1="20" y1="50" x2="34" y2="50" />
                    <line x1="16" y1="24" x2="57" y2="17" />
                  </svg>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 4 }}>
                      选择一条推演记录
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      关系图谱将在此中央展示
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Right: Platform Status + Simulation Details ───────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)', alignItems: 'stretch' }}>

          {/* Platform Status */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)' }}>
                平台态势
              </span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(['twitter', 'reddit'] as const).map(plat => (
                <PlatformStatusCard
                  key={plat}
                  platform={plat}
                  status={platformStatus(plat)}
                  runStatus={runStatus}
                />
              ))}
            </div>
          </div>

          {/* Simulation Details */}
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">仿真详情</span>
              {selectedRun && statusBadge(selectedRun.status)}
            </div>
            {!selectedRun ? (
              <div className="empty-state"><FishEmptyIcon /><p>选择记录查看</p></div>
            ) : (
              <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
                {/* Progress */}
                {selectedRun.status === 'running' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                      <span>仿真进度</span>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{selectedRun.rounds_completed} / {config.max_rounds}</span>
                    </div>
                    <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
                  </div>
                )}
                {/* Meta grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-3)', fontSize: '0.75rem' }}>
                  {[
                    ['完成轮次', selectedRun.rounds_completed],
                    ['收敛', selectedRun.convergence_achieved ? <span style={{ color: 'var(--low)' }}>已收敛</span> : '—'],
                    ['耗时', selectedRun.duration_ms ? `${(selectedRun.duration_ms / 1000).toFixed(1)}s` : '—'],
                  ].map(([label, value]) => (
                    <div key={label as string}>
                      <div style={{ color: 'var(--text-muted)', marginBottom: 2, fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                      <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{value}</div>
                    </div>
                  ))}
                </div>
                {/* Agent table */}
                {selectedRun.final_states && selectedRun.final_states.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      代理体 ({selectedRun.final_states.length})
                    </div>
                    <div style={{ maxHeight: 200, overflowY: 'auto', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                      <table className="data-table" style={{ fontSize: '0.68rem' }}>
                        <thead><tr><th>ID</th><th>信念</th><th>影响</th></tr></thead>
                        <tbody>
                          {selectedRun.final_states.slice(0, 15).map(agent => (
                            <tr key={agent.id}>
                              <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--accent)' }}>{agent.id.slice(0, 8)}</td>
                              <td style={{ color: agent.belief > 0.7 ? 'var(--critical)' : agent.belief < 0.3 ? 'var(--low)' : 'inherit' }}>
                                {agent.belief.toFixed(2)}
                              </td>
                              <td>{agent.influence.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {selectedRun.final_states.length > 15 && (
                        <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textAlign: 'center', padding: 4 }}>
                          还有 {selectedRun.final_states.length - 15} 个...
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {selectedRun.status === 'completed' && (
                  <div style={{ padding: 'var(--sp-3)', background: 'var(--low-d)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(68,255,136,0.15)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CheckIcon />
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--low)', fontSize: '0.78rem' }}>推演已完成</div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                        {selectedRun.convergence_achieved ? '已达均衡收敛' : '未达收敛'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Report Viewer Drawer */}
      {showReport && selectedRun && (
        <ReportViewer runId={selectedRun.run_id} onClose={() => setShowReport(false)} />
      )}
    </div>
  )
}

/* ── Icons ─────────────────────────────────────────────────────────────────── */
function FishIcon() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="15" height="15" style={{ color: 'var(--text-muted)' }}>
    <path d="M2 8 Q5 4.5 9 8 Q5 11.5 2 8Z" /><circle cx="10.5" cy="8" r="1" fill="currentColor" /><path d="M11.5 5.5 L14 8 L11.5 10.5" />
  </svg>
}
function FishEmptyIcon() {
  return <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" width="56" height="56" opacity="0.3">
    <path d="M8 32 Q20 18 40 32 Q20 46 8 32Z" /><circle cx="44" cy="32" r="5" /><path d="M48 24 L58 32 L48 40" />
  </svg>
}
function PlayIcon() {
  return <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><polygon points="4,2 14,8 4,14" /></svg>
}
function StopIcon() {
  return <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><rect x="3" y="3" width="10" height="10" rx="1" /></svg>
}
function CloseIcon() {
  return <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" width="12" height="12">
    <line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" />
  </svg>
}
function CheckIcon() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="var(--low)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" style={{ flexShrink: 0 }}>
    <circle cx="10" cy="10" r="9" /><polyline points="6,10 9,13 14,7" />
  </svg>
}

/* ── Report Drawer Styles ─────────────────────────────────────────────────── */
const reportDrawerCSS = `
  .report-drawer-overlay {
    position: fixed;
    inset: 0;
    z-index: 500;
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: flex;
    animation: fade-in 0.2s ease;
  }

  .report-drawer {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background: var(--bg-surface);
    border-left: 1px solid var(--border-bright);
    animation: slide-in 0.25s ease;
    overflow: hidden;
  }

  .report-drawer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-4) var(--sp-5);
    background: var(--bg-raised);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .report-drawer-body {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .report-section-nav {
    width: 220px;
    flex-shrink: 0;
    background: var(--bg-panel);
    border-right: 1px solid var(--border);
    overflow-y: auto;
    padding: var(--sp-3) 0;
  }

  .report-section-nav-title {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    padding: var(--sp-2) var(--sp-4);
    margin-bottom: var(--sp-2);
    font-family: var(--font-mono);
  }

  .report-section-btn {
    display: block;
    width: 100%;
    text-align: left;
    padding: 7px var(--sp-4);
    font-size: 0.8rem;
    color: var(--text-muted);
    border-left: 2px solid transparent;
    cursor: pointer;
    background: none;
    transition: all var(--t-fast);
    font-family: var(--font-sans);
    line-height: 1.4;
  }

  .report-section-btn:hover {
    color: var(--text-secondary);
    background: var(--bg-raised);
    border-left-color: var(--border-bright);
  }

  .report-section-btn.active {
    color: var(--accent);
    background: var(--accent-dim);
    border-left-color: var(--accent);
    font-weight: 600;
  }

  .report-content-area {
    flex: 1;
    overflow-y: auto;
    padding: var(--sp-5);
    scroll-behavior: smooth;
  }

  .report-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--sp-4);
    min-height: 300px;
  }

  .report-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--sp-2);
    min-height: 200px;
    padding: var(--sp-8);
    text-align: center;
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slide-in {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }
`

// Inject CSS once
if (typeof document !== 'undefined') {
  const styleId = 'orcafish-report-drawer-styles'
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = reportDrawerCSS
    document.head.appendChild(style)
  }
}
