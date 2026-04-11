import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import DOMPurify from 'dompurify'
import GraphPanel from './GraphPanel'
import { useSimulationDraftStore, type SimulationDraft } from '../../stores/simulationDraftStore'
import WorkflowGuide, { type WorkflowGuideStep } from '../WorkflowGuide'
import CountryWorkbenchCard from '../CountryWorkbenchCard'


interface SimulationRun {
  run_id: string; status: string; rounds_completed: number; convergence_achieved: boolean;
  final_states?: Array<{ id: string; position: [number, number]; belief: number; influence: number }>;
  duration_ms?: number; created_at?: string; started_at?: string | null; max_rounds?: number;
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
    let active = true
    const currentRunId = runId
    seenIdsRef.current = new Set()
    setActions([])

    const poll = async () => {
      try {
        const acRes = await fetch(`/api/simulation/runs/${currentRunId}/detail`)
        if (!acRes.ok || !active) return
        const ac = await acRes.json() as { all_actions?: SimAction[] }
        if (!active) return
        setActions(prev => {
          const newOnes = (ac.all_actions || []).filter(a => {
            if (seenIdsRef.current.has(a.id)) return false
            seenIdsRef.current.add(a.id)
            return true
          })
          return newOnes.length > 0 ? [...prev, ...newOnes] : prev
        })
      } catch (_) { /* ignore network errors during polling */ }
    }

    void poll()
    const id = setInterval(() => {
      void poll()
    }, 3000)
    return () => {
      active = false
      clearInterval(id)
    }
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

  const ACTION_TYPE_ZH: Record<string, string> = {
    CREATE_POST: '发帖', LIKE_POST: '点赞', REPOST: '转发',
    COMMENT: '评论', FOLLOW: '关注', UNFOLLOW: '取关',
    RETWEET: '转发', REPLY: '回复', SHARE: '分享', VIEW: '浏览',
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
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}>
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
                    letterSpacing: '0.04em',
                  }}>
                    {ACTION_TYPE_ZH[action.action_type] ?? action.action_type}
                  </span>
                  <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    [{action.platform === 'twitter' ? '广场' : '社区'}]
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
          <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', marginBottom: 3 }}>
            系统日志
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            [{formatTime(new Date().toISOString())}]
            {actions.length > 0
              ? ` 已捕获 ${actions.length} 个事件 · 流活跃`
              : ' 正在轮询未来演化数据流...'}
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
  const label = platform === 'twitter' ? '信息广场' : '话题社区'
  const platformName = platform === 'twitter' ? '信息广场' : '话题社区'
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
          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
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

function formatCountryContextTime(ts?: string | null) {
  if (!ts) return '等待新的观测同步'
  try {
    return new Date(ts).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return ts
  }
}

function ReportViewer({
  runId,
  onClose,
  countryContext,
}: {
  runId: string
  onClose: () => void
  countryContext?: CountryContextDraftSummary | null
}) {
  const [report, setReport] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const processedReport = useMemo(() => {
    if (!report) {
      return { html: null as string | null, sections: [] as ReportSection[] }
    }

    const sanitizedHtml = DOMPurify.sanitize(report, { USE_PROFILES: { html: true } })
    const parser = new DOMParser()
    const doc = parser.parseFromString(sanitizedHtml, 'text/html')
    const headings = Array.from(doc.querySelectorAll('h1, h2, h3, h4'))
    const usedIds = new Set<string>()

    const sections = headings.map((heading, index) => {
      const text = heading.textContent?.trim() || ''
      const key = text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
      const label = REPORT_SECTION_LABELS[key] || text || `章节 ${index + 1}`
      const fallbackId = `section-${index}`
      let id = heading.id || key || fallbackId

      while (usedIds.has(id)) {
        id = `${fallbackId}-${usedIds.size}`
      }

      usedIds.add(id)
      heading.id = id

      return { id, label }
    })

    return {
      html: doc.body.innerHTML,
      sections,
    }
  }, [report])

  // Load report
  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/simulation/report/${runId}`)
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
      const el = contentRef.current.ownerDocument.getElementById(id)
      if (el && contentRef.current.contains(el)) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } else {
        contentRef.current.scrollTop = 0
      }
    }
  }, [])

  const sanitizedReport = processedReport.html
  const sections = processedReport.sections
  // Unique sections preserving order
  const uniqueSections = sections.filter((s: ReportSection, i: number) => sections.findIndex((x: ReportSection) => x.label === s.label) === i)
  const countryMetricItems = [
    { label: '新闻', value: countryContext?.news_count ?? 0 },
    { label: '信号', value: countryContext?.signal_count ?? 0 },
    { label: '焦点', value: countryContext?.focal_count ?? 0 },
  ]

  return (
    <div className="report-drawer-overlay" onClick={onClose}>
      <div className="report-drawer" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="report-drawer-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
            <FileIcon />
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>未来预测报告</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
                {runId}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            {uniqueSections.length > 0 && (
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginRight: 'var(--sp-2)' }}>
                {uniqueSections.length} 个章节
              </div>
            )}
            <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ color: 'var(--text-secondary)', padding: '6px 10px' }}>
              <CloseIcon />
            </button>
          </div>
        </div>
        {countryContext?.iso ? (
          <div style={{
            padding: '10px 16px',
            borderBottom: '1px solid var(--border)',
            background: 'linear-gradient(135deg, rgba(37,99,235,0.06), rgba(255,255,255,0.98))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}>
            <div>
              <div style={{ fontSize: '0.68rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', marginBottom: 4 }}>
                观察包来源
              </div>
              <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                {(countryContext.country_name || countryContext.name || countryContext.iso)} · {countryContext.iso}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {typeof countryContext.score === 'number' ? (
                <span className={`badge ${String(countryContext.level || '').toLowerCase() === 'critical' ? 'badge-critical' : String(countryContext.level || '').toLowerCase() === 'high' ? 'badge-high' : 'badge-normal'}`}>
                  <span className="badge-dot" />CII {countryContext.score.toFixed(1)}
                </span>
              ) : null}
              {countryContext.latest_activity ? (
                <span style={{ fontSize: '0.66rem', color: 'var(--text-secondary)', padding: '4px 8px', borderRadius: 999, background: 'rgba(37,99,235,0.05)', border: '1px solid rgba(37,99,235,0.1)' }}>
                  最新活动 {new Date(countryContext.latest_activity).toLocaleString('zh-CN', { hour12: false })}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Body: sidebar + content */}
        <div className="report-drawer-body">
          {/* Section Nav */}
          <div className="report-section-nav">
            <div className="report-section-nav-title">导航</div>
            {countryContext?.iso ? (
              <div style={{
                margin: '0 0 var(--sp-3)',
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid rgba(37,99,235,0.12)',
                background: 'linear-gradient(135deg, rgba(37,99,235,0.05), rgba(255,255,255,0.96))',
                display: 'grid',
                gap: 8,
              }}>
                <div>
                  <div style={{ fontSize: '0.66rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', marginBottom: 4 }}>
                    观察包摘要
                  </div>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                    {(countryContext.country_name || countryContext.name || countryContext.iso)} · {countryContext.iso}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {typeof countryContext.score === 'number' ? (
                    <span className={`badge ${String(countryContext.level || '').toLowerCase() === 'critical' ? 'badge-critical' : String(countryContext.level || '').toLowerCase() === 'high' ? 'badge-high' : 'badge-normal'}`}>
                      <span className="badge-dot" />CII {countryContext.score.toFixed(1)}
                    </span>
                  ) : null}
                  {countryMetricItems.map((item) => (
                    <span key={item.label} style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', padding: '4px 8px', borderRadius: 999, background: 'rgba(37,99,235,0.05)', border: '1px solid rgba(37,99,235,0.1)' }}>
                      {item.label} {item.value}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {countryContext.narrative || '该报告沿着全球观测的国家观察包继续展开。'}
                </div>
              </div>
            ) : null}
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
                  正在整理未来预测报告...
                </div>
              </div>
            ) : error ? (
              <div className="report-error">
                <div style={{ color: 'var(--critical)', fontWeight: 600, marginBottom: 'var(--sp-2)' }}>加载失败</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{error}</div>
              </div>
            ) : sanitizedReport ? (
              <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
                {countryContext?.iso ? (
                  <div style={{
                    border: '1px solid rgba(37,99,235,0.12)',
                    borderRadius: 'var(--radius)',
                    background: 'linear-gradient(135deg, rgba(37,99,235,0.05), rgba(255,255,255,0.98))',
                    padding: '14px 16px',
                  }}>
                    <div style={{ fontSize: '0.68rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', marginBottom: 8 }}>
                      OBSERVATION PACKAGE CONTEXT
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                          {(countryContext.country_name || countryContext.name || countryContext.iso)} 的未来预测
                        </div>
                        <div style={{ marginTop: 4, fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                          该报告基于全球观测阶段的国家观察包生成，保留新闻、信号与 Agent 焦点上下文。
                        </div>
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'right' }}>
                        <div>最近活动</div>
                        <div style={{ marginTop: 4, color: 'var(--text-primary)', fontWeight: 700 }}>
                          {formatCountryContextTime(countryContext.latest_activity)}
                        </div>
                      </div>
                    </div>
                    <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {typeof countryContext.score === 'number' ? (
                        <span className={`badge ${String(countryContext.level || '').toLowerCase() === 'critical' ? 'badge-critical' : String(countryContext.level || '').toLowerCase() === 'high' ? 'badge-high' : 'badge-normal'}`}>
                          <span className="badge-dot" />CII {countryContext.score.toFixed(1)}
                        </span>
                      ) : null}
                      {countryMetricItems.map((item) => (
                        <span key={item.label} style={{ fontSize: '0.66rem', color: 'var(--text-secondary)', padding: '4px 8px', borderRadius: 999, background: 'rgba(37,99,235,0.05)', border: '1px solid rgba(37,99,235,0.1)' }}>
                          {item.label} {item.value}
                        </span>
                      ))}
                      {(countryContext.top_signal_types ?? []).slice(0, 4).map((item) => (
                        <span key={item} style={{ fontSize: '0.66rem', color: 'var(--text-secondary)', padding: '4px 8px', borderRadius: 999, background: 'rgba(22,163,74,0.05)', border: '1px solid rgba(22,163,74,0.1)' }}>
                          {item}
                        </span>
                      ))}
                    </div>
                    {countryContext.narrative ? (
                      <div style={{ marginTop: 10, fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.75 }}>
                        {countryContext.narrative}
                      </div>
                    ) : null}
                    {(countryContext.top_headlines ?? []).length > 0 ? (
                      <div style={{ marginTop: 10, fontSize: '0.74rem', color: 'var(--text-primary)', lineHeight: 1.7 }}>
                        <strong>观测起点：</strong>{countryContext.top_headlines?.[0]}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div
                  className="report-body"
                  dangerouslySetInnerHTML={{ __html: sanitizedReport }}
                />
              </div>
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

interface CountryContextDraftSummary {
  iso: string
  country_name?: string
  name?: string
  score?: number
  level?: string
  news_count?: number
  signal_count?: number
  focal_count?: number
  latest_activity?: string | null
  narrative?: string
  top_signal_types?: string[]
  top_headlines?: string[]
}

type SimulationDraftWithCountryContext = SimulationDraft & {
  country_context?: CountryContextDraftSummary
  countryContext?: CountryContextDraftSummary
  context?: CountryContextDraftSummary
  summary?: CountryContextDraftSummary
  country?: CountryContextDraftSummary
  source_country?: CountryContextDraftSummary
}

export default function SimulationPage() {
  const draft = useSimulationDraftStore((s) => s.draft)
  const clearDraft = useSimulationDraftStore((s) => s.clearDraft)
  const [runs, setRuns] = useState<SimulationRun[]>([])
  const [loadingRuns, setLoadingRuns] = useState(true)
  const [creating, setCreating] = useState(false)
  const [config, setConfig] = useState<CreateConfig>({
    seed_content: '',
    simulation_requirement: '',
    max_rounds: 40,
    name: '未来预测',
  })
  const [selectedRun, setSelectedRun] = useState<SimulationRun | null>(null)
  const [showReport, setShowReport] = useState(false)
  const [viewMode, setViewMode] = useState<'graph' | 'split' | 'workbench'>('split')
  const [startingRun, setStartingRun] = useState(false)
  const [stoppingRun, setStoppingRun] = useState(false)
  const [runStatus, setRunStatus] = useState<SimRunStatus | null>(null)
  const [graphData, setGraphData] = useState<{ nodes: KGNode[]; edges: KGLink[] } | null>(null)
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphRefreshKey, setGraphRefreshKey] = useState(0)
  const draftPayload = draft as SimulationDraftWithCountryContext | null
  const draftCountryContext =
    draftPayload?.country_context ??
    draftPayload?.countryContext ??
    draftPayload?.context ??
    draftPayload?.summary ??
    draftPayload?.country ??
    draftPayload?.source_country

  const hasCountryContext = Boolean(draftCountryContext?.iso)
  const draftCountryName = draftCountryContext?.country_name || draftCountryContext?.name || draftCountryContext?.iso
  const countryContextMetrics = [
    { label: '新闻', value: draftCountryContext?.news_count ?? 0 },
    { label: '信号', value: draftCountryContext?.signal_count ?? 0 },
    { label: '焦点', value: draftCountryContext?.focal_count ?? 0 },
  ]

  useEffect(() => {
    if (!draft) return
    setConfig((prev) => ({
      ...prev,
      name: draft.name || prev.name,
      seed_content: draft.seed_content || prev.seed_content,
      simulation_requirement: draft.simulation_requirement || prev.simulation_requirement,
      max_rounds: draft.max_rounds || prev.max_rounds,
    }))
  }, [draft])

  // Fetch graph data when selected run changes or while prediction keeps evolving
  useEffect(() => {
    if (!selectedRun?.run_id) {
      setGraphData(null)
      setGraphLoading(false)
      return
    }

    let active = true

    const loadGraph = async () => {
      setGraphLoading(true)
      try {
        const response = await fetch(`/api/simulation/runs/${selectedRun.run_id}/graph`)
        if (!response.ok) throw new Error('graph fetch failed')
        const data = await response.json() as { nodes?: KGNode[]; edges?: KGLink[] }
        if (!active) return
        setGraphData({
          nodes: Array.isArray(data.nodes) ? data.nodes : [],
          edges: Array.isArray(data.edges) ? data.edges : [],
        })
      } catch {
        if (!active) return
        setGraphData(null)
      } finally {
        if (active) setGraphLoading(false)
      }
    }

    setGraphData(null)
    void loadGraph()
    const id = setInterval(() => {
      void loadGraph()
    }, selectedRun.status === 'running' ? 3000 : 10000)

    return () => {
      active = false
      clearInterval(id)
    }
  }, [selectedRun?.run_id, selectedRun?.status, graphRefreshKey])

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
    if (!selectedRun?.run_id) return
    let active = true
    const currentRunId = selectedRun.run_id

    const poll = async () => {
      try {
        const response = await fetch(`/api/simulation/runs/${currentRunId}`)
        if (!response.ok || !active) return
        const data = await response.json() as Partial<SimulationRun>
        if (!active) return
        setSelectedRun(prev => prev?.run_id === currentRunId ? { ...prev, ...data } : prev)
        setRuns(prev => prev.map(r => r.run_id === currentRunId ? { ...r, ...data } : r))
      } catch (_) { /* ignore network errors during polling */ }
    }

    void poll()
    const t = setInterval(() => {
      void poll()
    }, 3000)
    return () => {
      active = false
      clearInterval(t)
    }
  }, [selectedRun?.run_id])

  // Poll platform status (runStatus) for Action Stream & Platform Status Cards
  useEffect(() => {
    if (!selectedRun?.run_id) {
      setRunStatus(null)
      return
    }

    let active = true
    const currentRunId = selectedRun.run_id

    const poll = async () => {
      try {
        const stRes = await fetch(`/api/simulation/runs/${currentRunId}/status`)
        if (!stRes.ok || !active) return
        const status = await stRes.json() as SimRunStatus
        if (!active) return
        setRunStatus(status)
      } catch (_) { /* ignore */ }
    }

    void poll()
    const id = setInterval(() => {
      void poll()
    }, 3000)
    return () => {
      active = false
      clearInterval(id)
    }
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
          name: config.name || config.seed_content.slice(0, 40) || '未来预测',
          seed_content: config.seed_content,
          simulation_requirement: config.simulation_requirement || `分析并预测以下议题的演化趋势：${config.seed_content}`,
          max_rounds: config.max_rounds,
        }),
      })
      if (!res.ok) throw new Error('创建失败')
      const run: SimulationRun = await res.json()
      setRuns(prev => [run, ...prev]); setSelectedRun(run)
      clearDraft()
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
  const getRunStatusLabel = (status?: string) => {
    const statusLabels: Record<string, string> = {
      completed: '已完成',
      running: '运行中',
      failed: '失败',
      created: '待启动',
      paused: '已暂停',
    }
    return status ? (statusLabels[status] ?? status) : '未选择'
  }

  const inputStyle = (focused = false) => ({
    width: '100%', padding: '8px 12px',
    backgroundColor: 'var(--bg-base)', border: `1px solid ${focused ? 'var(--accent)' : 'var(--border-bright)'}`,
    borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
    fontFamily: 'inherit', fontSize: '0.875rem', outline: 'none',
    transition: 'border-color var(--t-fast)',
  })

  const totalRounds = selectedRun?.max_rounds ?? runStatus?.total_rounds ?? config.max_rounds
  const progress = selectedRun?.status === 'running' && selectedRun?.rounds_completed
    ? Math.min((selectedRun.rounds_completed / totalRounds) * 100, 100)
    : selectedRun?.status === 'completed' ? 100 : 0
  const estimateRemaining = () => {
    if (!selectedRun) return '等待创建预测记录'
    if (selectedRun.status === 'completed' && selectedRun.duration_ms) {
      return `已完成 · ${(selectedRun.duration_ms / 1000).toFixed(1)} 秒`
    }
    if (selectedRun.status !== 'running') {
      return '创建后可估算未来路径生成时间'
    }
    if (selectedRun.started_at && selectedRun.rounds_completed > 0) {
      const elapsedMs = Date.now() - new Date(selectedRun.started_at).getTime()
      const avgPerRound = elapsedMs / selectedRun.rounds_completed
      const remainingRounds = Math.max(totalRounds - selectedRun.rounds_completed, 0)
      const remainingMs = Math.max(avgPerRound * remainingRounds, 0)
      if (remainingMs >= 60000) return `预计还需约 ${(remainingMs / 60000).toFixed(1)} 分钟`
      return `预计还需约 ${Math.max(1, Math.round(remainingMs / 1000))} 秒`
    }
    return `预计总轮次 ${totalRounds}，正在建立未来路径`
  }
  const workflowSteps: WorkflowGuideStep[] = [
    {
      label: 'STEP 1',
      title: '先创建预测记录',
      description: '把图谱种子、预测目标和轮次先固化成一条可操作记录。',
      status: runs.length > 0 ? 'done' : 'active' as const,
    },
    {
      label: 'STEP 2',
      title: '再启动未来预测',
      description: '选中一条记录后手动启动，让未来路径从知识图谱开始逐步展开。',
      status: selectedRun?.status === 'running' ? 'active' : selectedRun?.status === 'completed' ? 'done' : 'pending' as const,
    },
    {
      label: 'STEP 3',
      title: '最后看图谱与报告',
      description: '行动流、关系图谱和预测报告会随着未来演化逐步成形。',
      status: selectedRun?.status === 'completed' ? 'active' : 'pending' as const,
    },
  ]

  const leftPaneVisible = viewMode !== 'graph'
  const centerPaneVisible = viewMode !== 'workbench'
  const rightPaneVisible = viewMode !== 'graph'
  const graphPaneColumns = viewMode === 'graph'
    ? 'minmax(0, 1fr)'
    : viewMode === 'workbench'
      ? 'minmax(320px, 0.92fr) minmax(320px, 1.08fr)'
      : '240px minmax(0, 1.72fr) 320px'
  const activeModeMeta = {
    graph: {
      label: '图谱主视图',
      description: '把未来关系图谱切成页面主舞台，专注读边、看路径、检查节点与关系，不再需要额外全屏遮罩。',
      status: '图谱主视图',
    },
    split: {
      label: '双栏推演台',
      description: '左侧保留输入与记录，中间图谱主导，右侧工作台同步服务当前预测过程。',
      status: '双栏协同中',
    },
    workbench: {
      label: '工作台模式',
      description: '把图谱退到后台，集中处理记录、启动、平台态势与预测详情。',
      status: '工作台处理中',
    },
  }[viewMode]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>

      {/* ── MiroFish-style Header ───────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--sp-4)',
        padding: 'var(--sp-5) var(--sp-6)',
        background: 'linear-gradient(135deg, rgba(15,23,42,0.02), rgba(37,99,235,0.06))',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            MiroFish 风格未来预测台 · {activeModeMeta.label}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>
            {activeModeMeta.description} 当前状态：{selectedRun?.status === 'running' ? '未来路径生成中' : selectedRun?.status === 'completed' ? '已完成，可查看报告' : selectedRun ? '记录已就绪，等待启动' : activeModeMeta.status}
          </div>
          {draft && (
            <div style={{ marginTop: 10, fontSize: '0.74rem', color: 'var(--accent)', fontWeight: 600 }}>
              已接收来自议题研判的预测输入，创建后即可进入未来预测闭环
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: 4,
            borderRadius: 999,
            background: 'rgba(255,255,255,0.82)',
            border: '1px solid var(--border)',
          }}>
            {[
              ['graph', '图谱'],
              ['split', '双栏'],
              ['workbench', '工作台'],
            ].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode as 'graph' | 'split' | 'workbench')}
                style={{
                  border: 'none',
                  borderRadius: 999,
                  padding: '6px 12px',
                  background: viewMode === mode ? 'var(--accent)' : 'transparent',
                  color: viewMode === mode ? '#fff' : 'var(--text-secondary)',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--sp-2)',
            padding: '8px 12px',
            background: 'rgba(255,255,255,0.8)',
            border: '1px solid var(--border)',
            borderRadius: 999,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: selectedRun?.status === 'running' ? 'var(--accent)' : 'var(--text-muted)' }} />
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {selectedRun?.status === 'running' ? '未来路径生成中' : activeModeMeta.status}
            </span>
          </div>
          <span className="badge badge-active"><span className="badge-dot" />{runs.length} 条记录</span>
        </div>
      </div>

      <WorkflowGuide
        eyebrow="FUTURE FORECAST PLAYBOOK"
        title="先建记录，再启动预测，再读未来路径"
        description="这一页已经按 MiroFish 的工作台节奏收口。先把输入固化，再启动未来预测，最后查看图谱、行动流和报告，会比直接一把梭更稳。"
        steps={workflowSteps}
        actions={
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              查看创建区
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!selectedRun || selectedRun.status === 'running' || selectedRun.status === 'completed' || startingRun}
              onClick={() => selectedRun && handleStart(selectedRun.run_id)}
              style={{ opacity: (!selectedRun || selectedRun.status === 'running' || selectedRun.status === 'completed') ? 0.45 : 1 }}
            >
              立即启动当前预测
            </button>
          </>
        }
      />

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
              <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>选择一条未来预测记录进行操作</span>
            )}
          </div>

          {/* Right: action buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
            {hasCountryContext && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                justifyContent: 'flex-end',
                padding: '6px 10px',
                borderRadius: 999,
                background: 'rgba(37,99,235,0.06)',
                border: '1px solid rgba(37,99,235,0.12)',
                color: 'var(--text-secondary)',
                fontSize: '0.68rem',
                fontFamily: 'var(--font-mono)',
              }}>
                <span>来源 {draftCountryName}</span>
                <span>风险 {draftCountryContext?.level ? draftCountryContext.level.toUpperCase() : 'UNKNOWN'}</span>
                <span>
                  最新活动 {draftCountryContext?.latest_activity
                    ? new Date(draftCountryContext.latest_activity).toLocaleString('zh-CN', { hour12: false })
                    : '暂无最新活动'}
                </span>
              </div>
            )}
            <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => selectedRun && handleStart(selectedRun.run_id)}
                disabled={!selectedRun || selectedRun.status === 'running' || selectedRun.status === 'completed' || startingRun}
                title={!selectedRun ? '先选择一条预测记录' : selectedRun.status === 'running' ? '预测正在进行中' : selectedRun.status === 'completed' ? '预测已完成' : '启动未来预测'}
                style={{ opacity: (!selectedRun || selectedRun.status === 'running' || selectedRun.status === 'completed') ? 0.45 : 1 }}
              >
                <PlayIcon />
                {startingRun ? '启动中...' : '启动预测'}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => selectedRun && handleStop(selectedRun.run_id)}
                disabled={!selectedRun || selectedRun.status !== 'running' || stoppingRun}
                title={!selectedRun ? '先选择一条预测记录' : selectedRun.status !== 'running' ? '当前状态无法停止' : '停止预测'}
                style={{ opacity: (!selectedRun || selectedRun.status !== 'running') ? 0.45 : 1 }}
              >
                <StopIcon />
                {stoppingRun ? '停止中...' : '停止预测'}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => selectedRun && setShowReport(true)}
                disabled={!selectedRun || selectedRun.status !== 'completed'}
                title={!selectedRun ? '先选择一条预测记录' : selectedRun.status !== 'completed' ? '仅在预测完成后可用' : hasCountryContext ? `查看 ${draftCountryName} 的未来预测报告` : '查看预测报告'}
                style={{ opacity: (!selectedRun || selectedRun.status !== 'completed') ? 0.45 : 1 }}
              >
                <FileIcon />
                {hasCountryContext ? `查看 ${draftCountryName} 报告` : '查看预测报告'}
              </button>
            </div>
            {hasCountryContext && (
              <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textAlign: 'right', lineHeight: 1.5 }}>
                这条预测带着国家观察包进入工作台，启动后会沿着该上下文继续展开。
              </div>
            )}
          </div>
        </div>
          {draft && !selectedRun && (
            <div style={{
              marginTop: 'var(--sp-4)',
              paddingTop: 'var(--sp-4)',
              borderTop: '1px solid var(--border)',
              display: 'grid',
              gridTemplateColumns: hasCountryContext ? '1.1fr 0.95fr 0.95fr 120px' : '1.2fr 1fr 120px',
              gap: 'var(--sp-3)',
              alignItems: 'center',
            }}>
              <div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: 4, letterSpacing: '0.06em' }}>来自研判的议题</div>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{draft.name}</div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                  {draft.simulation_requirement}
                </div>
                {hasCountryContext && (
                  <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(37,99,235,0.14)', background: 'linear-gradient(135deg, rgba(37,99,235,0.06), rgba(255,255,255,0.98))' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                      <div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', marginBottom: 3 }}>
                          来自全球观测的上下文包
                        </div>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                          {draftCountryName} · {draftCountryContext?.iso}
                        </div>
                      </div>
                      {typeof draftCountryContext?.score === 'number' && (
                        <span className={`badge ${String(draftCountryContext.level || '').toLowerCase() === 'critical' ? 'badge-critical' : String(draftCountryContext.level || '').toLowerCase() === 'high' ? 'badge-high' : 'badge-normal'}`}>
                          <span className="badge-dot" />
                          CII {draftCountryContext.score.toFixed(1)}
                        </span>
                      )}
                    </div>
                    {draftCountryContext?.narrative && (
                      <div style={{ marginTop: 8, fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                        {draftCountryContext.narrative}
                      </div>
                    )}
                    {draftCountryContext?.top_signal_types?.length ? (
                      <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {draftCountryContext.top_signal_types.slice(0, 4).map((signalType) => (
                          <span key={signalType} style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', padding: '4px 8px', borderRadius: 999, background: 'rgba(37,99,235,0.05)', border: '1px solid rgba(37,99,235,0.1)' }}>
                            {signalType}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {draftCountryContext?.top_headlines?.length ? (
                      <div style={{ marginTop: 8, fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
                        {draftCountryContext.top_headlines[0]}
                      </div>
                    ) : null}
                    <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {countryContextMetrics.map((item) => (
                        <span key={item.label} style={{ fontSize: '0.66rem', color: 'var(--text-secondary)', padding: '4px 8px', borderRadius: 999, background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.12)' }}>
                          {item.label} {item.value}
                        </span>
                      ))}
                      {draftCountryContext?.latest_activity ? (
                        <span style={{ fontSize: '0.66rem', color: 'var(--text-secondary)', padding: '4px 8px', borderRadius: 999, background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.12)' }}>
                          最新活动 {new Date(draftCountryContext.latest_activity).toLocaleString('zh-CN', { hour12: false })}
                        </span>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                <div>种子长度: {draft.seed_content.length}</div>
                <div>最大轮次: {draft.max_rounds}</div>
                <div>来源: {draft.source === 'analysis' ? '议题研判' : '手动'}</div>
              </div>
              {hasCountryContext && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', lineHeight: 1.7 }}>
                  <div>国家: {draftCountryName}</div>
                  <div>状态: {draftCountryContext?.level || 'unknown'}</div>
                  <div>路径: 直接沿着这组上下文进入未来预测</div>
                </div>
              )}
              <button className="btn btn-secondary btn-sm" onClick={clearDraft} style={{ justifyContent: 'center' }}>
                清空草稿
              </button>
            </div>
          )}
      </div>

      {/* ── Workflow Steps ─────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 'var(--sp-3)' }}>
        {[
          {
            key: 'step-1',
            title: 'Step 1 图谱种子',
            desc: draft ? '已接收议题研判摘要，可直接构图' : '填写议题、背景与预测目标',
            active: !selectedRun,
            done: Boolean(selectedRun || draft),
            accent: 'var(--accent)',
          },
          {
            key: 'step-2',
            title: 'Step 2 创建预测',
            desc: selectedRun ? `已创建 ${selectedRun.run_id}` : '生成运行记录与配置文件',
            active: Boolean(selectedRun && selectedRun.status === 'created'),
            done: Boolean(selectedRun),
            accent: '#0ea5e9',
          },
          {
            key: 'step-3',
            title: 'Step 3 启动预测',
            desc: selectedRun?.status === 'running' ? '双平台未来路径生成中' : '启动代理体并观察行动流',
            active: selectedRun?.status === 'running',
            done: selectedRun?.status === 'completed',
            accent: 'var(--medium)',
          },
          {
            key: 'step-4',
            title: 'Step 4 生成报告',
            desc: selectedRun?.status === 'completed' ? '可查看未来预测报告与收敛结果' : '完成后生成预测报告',
            active: selectedRun?.status === 'completed',
            done: false,
            accent: 'var(--low)',
          },
        ].map((step, index) => (
          <div
            key={step.key}
            style={{
              position: 'relative',
              padding: 'var(--sp-4)',
              borderRadius: 'var(--radius)',
              border: `1px solid ${step.active ? `${step.accent}55` : 'var(--border)'}`,
              background: step.active ? `linear-gradient(135deg, ${step.accent}14, rgba(255,255,255,0.92))` : 'rgba(255,255,255,0.86)',
              boxShadow: step.active ? `0 10px 22px ${step.accent}18` : 'var(--shadow-sm)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--sp-3)' }}>
              <div>
                <div style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: step.accent, marginBottom: 5 }}>
                  0{index + 1}
                </div>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{step.title}</div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{step.desc}</div>
              </div>
              <div style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                marginTop: 4,
                background: step.active ? step.accent : step.done ? 'var(--low)' : 'var(--border-bright)',
                boxShadow: step.active ? `0 0 10px ${step.accent}` : 'none',
                flexShrink: 0,
              }} />
            </div>
          </div>
        ))}
      </div>

      {/* ── Main Layout: 280px left (controls) | 1fr center (graph) | 300px right (status) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: graphPaneColumns, gap: 'var(--sp-4)', alignItems: 'start', minHeight: viewMode === 'graph' ? 820 : 780 }}>

        {/* ── Left: Controls + Runs ────────────────────────────────── */}
        {leftPaneVisible && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>

          {/* Runs List */}
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">预测记录</span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{runs.length}</span>
            </div>
            {loadingRuns ? (
              <div className="empty-state"><div className="spinner" /></div>
            ) : runs.length === 0 ? (
              <div className="empty-state"><FishEmptyIcon /><p>暂无预测记录</p></div>
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
            <div className="panel-header"><span className="panel-title">Step 1 / 创建未来预测</span><FishIcon /></div>
            <div className="panel-body">
              <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                <div style={{
                  padding: 'var(--sp-3)',
                  background: 'linear-gradient(135deg, rgba(37,99,235,0.05), rgba(14,165,233,0.02))',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
                    FUTURE SEED
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    这里输入事件背景、关键参与方、已有研判或报道正文。创建后会先生成预测记录，再由你决定何时启动未来预测。
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>议题种子</label>
                  <textarea
                    value={config.seed_content}
                    onChange={e => setConfig(p => ({ ...p, seed_content: e.target.value }))}
                    placeholder="输入预测议题、报道摘要或来自研判页的综合结论..."
                    rows={4}
                    style={{ ...inputStyle() as React.CSSProperties, resize: 'vertical' as const }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>预测目标</label>
                  <textarea
                    value={config.simulation_requirement}
                    onChange={e => setConfig(p => ({ ...p, simulation_requirement: e.target.value }))}
                    placeholder="例如：预测未来72小时内，关键参与方在舆情与行动层面的演化路径。"
                    rows={3}
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
                  {creating ? <><div className="spinner-sm" /> 创建中...</> : <><PlayIcon /> 创建预测记录</>}
                </button>
              </form>
            </div>
          </div>

          {/* Selected Run Controls */}
          {selectedRun && (
            <div className="panel">
              <div className="panel-header">
                <span className="panel-title">Step 2 / Step 3 预测控制台</span>
                {statusBadge(selectedRun.status)}
              </div>
              <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
                  {selectedRun.run_id}
                </div>
                <button className="btn btn-primary btn-sm"
                  onClick={() => handleStart(selectedRun.run_id)}
                  disabled={!selectedRun || selectedRun.status === 'running' || selectedRun.status === 'completed' || startingRun}
                  style={{ width: '100%', justifyContent: 'center' }}>
                  <PlayIcon /> {startingRun ? '启动中...' : '启动预测'}
                </button>
                <button className="btn btn-secondary btn-sm"
                  onClick={() => handleStop(selectedRun.run_id)}
                  disabled={!selectedRun || selectedRun.status !== 'running' || stoppingRun}
                  style={{ width: '100%', justifyContent: 'center' }}>
                  <StopIcon /> {stoppingRun ? '停止中...' : '停止预测'}
                </button>
                <button className="btn btn-ghost btn-sm"
                  onClick={() => setShowReport(true)}
                  disabled={!selectedRun || selectedRun.status !== 'completed'}
                  style={{ width: '100%', justifyContent: 'center' }}>
                  <FileIcon /> {hasCountryContext ? `查看 ${draftCountryName} 报告` : '查看预测报告'}
                </button>
                {hasCountryContext && (
                  <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textAlign: 'center', lineHeight: 1.5 }}>
                    报告将继续沿着 {draftCountryName} 的观察包展开。
                  </div>
                )}
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
        )}

        {/* ── Center: Knowledge Graph — 最大展示 ────────────────────── */}
        {centerPaneVisible && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)', alignItems: 'stretch' }}>
          <div>
            {/* Section header */}
            {viewMode !== 'graph' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', fontFamily: 'var(--font-mono)' }}>
                  未来关系图谱
                </span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                {selectedRun && (
                  <span style={{ fontSize: '0.65rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                    {selectedRun.status === 'running' && <><PulseDot /> 实时生成中 · </>}
                    {(graphData?.nodes?.length ?? 0)} 个节点 / {(graphData?.edges?.length ?? 0)} 条关系
                  </span>
                )}
                {selectedRun ? (
                  <button className="btn btn-secondary btn-sm" onClick={() => setViewMode('graph')}>
                    进入图谱主视图
                  </button>
                ) : null}
              </div>
            )}
            {hasCountryContext && viewMode !== 'graph' && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                marginBottom: 10,
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid rgba(37,99,235,0.12)',
                background: 'linear-gradient(135deg, rgba(37,99,235,0.06), rgba(255,255,255,0.96))',
                flexWrap: 'wrap',
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', marginBottom: 2 }}>
                    图谱来源
                  </div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {draftCountryName} 观察包
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', fontSize: '0.66rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                  <span style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.12)' }}>
                    风险 {draftCountryContext?.level ? draftCountryContext.level.toUpperCase() : 'UNKNOWN'}
                  </span>
                  <span style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.12)' }}>
                    最新活动 {draftCountryContext?.latest_activity
                      ? new Date(draftCountryContext.latest_activity).toLocaleString('zh-CN', { hour12: false })
                      : '暂无最新活动'}
                  </span>
                </div>
              </div>
            )}
            <div style={{
              height: viewMode === 'graph' ? 'calc(100vh - 148px)' : 760,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: viewMode === 'graph' ? '20px' : 'var(--radius)',
              overflow: 'hidden',
              boxShadow: 'var(--shadow-sm)',
            }}>
              {selectedRun ? (
                <GraphPanel
                  graphData={graphData ?? undefined}
                  loading={graphLoading}
                  onRefresh={() => setGraphRefreshKey(value => value + 1)}
                  isSimulating={selectedRun.status === 'running'}
                  onToggleMaximize={() => setViewMode(viewMode === 'graph' ? 'split' : 'graph')}
                  isFullscreen={viewMode === 'graph'}
                />
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
                      选择一条预测记录
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      未来关系图谱将在此中央展示
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        )}

        {/* ── Right: Platform Status + Simulation Details ───────────── */}
        {rightPaneVisible && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)', alignItems: 'stretch' }}>
          {viewMode === 'workbench' && (
            <div style={{
              padding: 'var(--sp-4)',
              borderRadius: 'var(--radius)',
              border: '1px solid rgba(37,99,235,0.12)',
              background: 'linear-gradient(135deg, rgba(37,99,235,0.07), rgba(255,255,255,0.95))',
              boxShadow: 'var(--shadow-sm)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', marginBottom: 4 }}>
                    工作台状态
                  </div>
                  <div style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    当前处于工作台模式
                  </div>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setViewMode('split')}>
                  返回双栏
                </button>
              </div>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.65 }}>
                图谱已退到后台，你可以先处理预测记录、平台态势与报告阅读；需要重新观察关系路径时，随时切回双栏或图谱主视图。
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                <span style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.12)', fontSize: '0.66rem', color: 'var(--text-secondary)' }}>
                  节点 {(graphData?.nodes?.length ?? 0)}
                </span>
                <span style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(14,165,233,0.06)', border: '1px solid rgba(14,165,233,0.12)', fontSize: '0.66rem', color: 'var(--text-secondary)' }}>
                  关系 {(graphData?.edges?.length ?? 0)}
                </span>
                <span style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.12)', fontSize: '0.66rem', color: 'var(--text-secondary)' }}>
                  状态 {selectedRun ? getRunStatusLabel(selectedRun.status) : '未选择'}
                </span>
              </div>
              <div style={{ marginTop: 10, fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                建议先处理当前记录与平台态势，再回到图谱主视图核对证据、关系与动作路径。
              </div>
            </div>
          )}

          {hasCountryContext && (
            <CountryWorkbenchCard
              iso={draftCountryContext?.iso || 'GLOBAL'}
              countryName={draftCountryName}
              score={draftCountryContext?.score ?? 0}
              level={draftCountryContext?.level}
              newsCount={draftCountryContext?.news_count ?? 0}
              signalCount={draftCountryContext?.signal_count ?? 0}
              focalCount={draftCountryContext?.focal_count ?? 0}
              latestActivity={draftCountryContext?.latest_activity ?? null}
              narrative={draftCountryContext?.narrative || '这条未来预测直接继承了全球观测阶段的国家观察包。'}
              topSignalTypes={draftCountryContext?.top_signal_types ?? []}
              headlines={(draftCountryContext?.top_headlines ?? []).map((title, index) => ({
                id: `${draftCountryContext?.iso ?? 'ctx'}-${index}`,
                title,
                publishedAt: draftCountryContext?.latest_activity ?? null,
              }))}
              highlight={selectedRun?.status === 'running'}
              analysisLabel="查看预测来源"
            />
          )}

          {selectedRun ? (
            <div style={{
              padding: 'var(--sp-4)',
              borderRadius: 'var(--radius)',
              border: '1px solid rgba(37,99,235,0.12)',
              background: 'linear-gradient(135deg, rgba(37,99,235,0.06), rgba(255,255,255,0.96))',
              boxShadow: 'var(--shadow-sm)',
            }}>
              <div style={{ fontSize: '0.68rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', marginBottom: 8 }}>
                预测摘要
              </div>
              <div style={{ fontSize: '0.96rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>
                {selectedRun.status === 'running'
                  ? '未来路径正在展开'
                  : selectedRun.status === 'completed'
                    ? '未来预测已完成'
                    : selectedRun.status === 'created'
                      ? '预测记录已就绪'
                      : '等待继续处理'}
              </div>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.65 }}>
                {selectedRun.status === 'running'
                  ? `当前已推进 ${selectedRun.rounds_completed} / ${totalRounds} 轮，${estimateRemaining()}。`
                  : selectedRun.status === 'completed'
                    ? `${selectedRun.convergence_achieved ? '未来路径已趋稳' : '未来路径仍有波动'}，现在可以阅读报告并回看图谱。`
                    : '先启动这条记录，再观察图谱、行动流和预测报告逐步成形。'}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                <span style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.12)', fontSize: '0.66rem', color: 'var(--text-secondary)' }}>
                  节点 {(graphData?.nodes?.length ?? 0)}
                </span>
                <span style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(14,165,233,0.06)', border: '1px solid rgba(14,165,233,0.12)', fontSize: '0.66rem', color: 'var(--text-secondary)' }}>
                  关系 {(graphData?.edges?.length ?? 0)}
                </span>
                <span style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.12)', fontSize: '0.66rem', color: 'var(--text-secondary)' }}>
                  状态 {getRunStatusLabel(selectedRun.status)}
                </span>
              </div>
            </div>
          ) : null}

          {/* Platform Status */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', fontFamily: 'var(--font-mono)' }}>
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
              <span className="panel-title">预测详情</span>
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
                      <span>未来路径进度</span>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{selectedRun.rounds_completed} / {totalRounds}</span>
                    </div>
                    <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
                    <div style={{ marginTop: 6, fontSize: '0.68rem', color: 'var(--text-muted)' }}>{estimateRemaining()}</div>
                  </div>
                )}
                {/* Meta grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-3)', fontSize: '0.75rem' }}>
                  {[
                    ['完成轮次', selectedRun.rounds_completed],
                    ['收敛', selectedRun.convergence_achieved ? <span style={{ color: 'var(--low)' }}>已收敛</span> : '—'],
                    ['时间估计', estimateRemaining()],
                  ].map(([label, value]) => (
                    <div key={label as string}>
                      <div style={{ color: 'var(--text-muted)', marginBottom: 2, fontSize: '0.62rem', letterSpacing: '0.04em' }}>{label}</div>
                      <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{value}</div>
                    </div>
                  ))}
                </div>
                {/* Agent table */}
                {selectedRun.final_states && selectedRun.final_states.length > 0 && (
                  <div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '0.04em' }}>
                      关键观察角色 ({selectedRun.final_states.length})
                    </div>
                    <div style={{ maxHeight: 200, overflowY: 'auto', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                      <table className="data-table" style={{ fontSize: '0.68rem' }}>
                        <thead><tr><th>角色</th><th>信念</th><th>影响</th></tr></thead>
                        <tbody>
                          {selectedRun.final_states.slice(0, 15).map((agent, index) => (
                            <tr key={agent.id}>
                              <td style={{ fontSize: '0.66rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                                {formatFutureRoleName(agent.id, index)}
                              </td>
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
                      <div style={{ fontWeight: 600, color: 'var(--low)', fontSize: '0.78rem' }}>预测已完成</div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                        {selectedRun.convergence_achieved ? '未来路径已趋稳' : '未来路径仍存在波动'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        )}
      </div>

      {/* Report Viewer Drawer */}
      {showReport && selectedRun && (
        <ReportViewer runId={selectedRun.run_id} onClose={() => setShowReport(false)} countryContext={draftCountryContext} />
      )}
    </div>
  )
}

function formatFutureRoleName(id: string, index: number) {
  if (!id) return `观察角色 ${index + 1}`
  if (id.includes('agent_tw')) return `信息广场角色 ${index + 1}`
  if (id.includes('agent_rd')) return `话题社区角色 ${index + 1}`
  return `观察角色 ${index + 1}`
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
