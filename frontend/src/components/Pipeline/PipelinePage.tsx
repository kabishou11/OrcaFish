import { useEffect, useState, useRef } from 'react'
import { NavLink } from 'react-router-dom'
import WorkflowGuide, { type WorkflowGuideStep } from '../WorkflowGuide'

interface PipelineEvent { event_type: string; pipeline_id: string; data: Record<string, unknown>; timestamp: string }
interface Pipeline {
  pipeline_id: string; country_iso: string; country_name: string; cii_score: number;
  triggered_by: string[]; signal_types: string[]; stage: string;
  stage_progress: number; error_message: string | null; created_at: string; completed_at: string | null
}

const STAGE_LABELS: Record<string, string> = {
  detected: '已检测', analysis: '舆情分析', simulation: '仿真预测', completed: '已完成', failed: '失败',
}
const STAGE_BADGE: Record<string, string> = {
  detected: 'badge-active', analysis: 'badge-active', simulation: 'badge-medium',
  completed: 'badge-done', failed: 'badge-failed',
}

export default function PipelinePage() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [events, setEvents] = useState<PipelineEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [wsConnected, setWsConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const eventsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fetchPipelines = async () => {
      try {
        const res = await fetch('/api/pipeline/')
        if (res.ok) { const d = await res.json(); setPipelines(d.pipelines ?? []) }
      } catch { /* silent */ }
      setLoading(false)
    }
    fetchPipelines()
    const t = setInterval(fetchPipelines, 10000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = import.meta.env.DEV
      ? 'ws://localhost:8080/ws/global'
      : `${wsProtocol}//${window.location.host}/ws/global`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws
    ws.onopen = () => setWsConnected(true)
    ws.onclose = () => setWsConnected(false)
    ws.onerror = () => setWsConnected(false)
    ws.onmessage = (evt) => {
      try {
        const event: PipelineEvent = JSON.parse(evt.data)
        if (event.event_type?.startsWith('pipeline')) {
          setEvents(prev => [event, ...prev].slice(0, 200))
        }
      } catch { /* silent */ }
    }
    return () => ws.close()
  }, [])

  useEffect(() => { eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [events])

  const stageCounts = {
    detected: pipelines.filter((p) => p.stage === 'detected').length,
    analysis: pipelines.filter((p) => p.stage === 'analysis').length,
    simulation: pipelines.filter((p) => p.stage === 'simulation').length,
    completed: pipelines.filter((p) => p.stage === 'completed').length,
    failed: pipelines.filter((p) => p.stage === 'failed').length,
  }
  const activeCount = pipelines.filter((p) => !['completed', 'failed'].includes(p.stage)).length
  const latestPipeline = pipelines[0]
  const workflowSteps: WorkflowGuideStep[] = [
    {
      label: 'STEP 1',
      title: '先等待信号触发',
      description: '世界监测器会先把高风险地区和异常聚合成一条可编排流水线。',
      status: pipelines.length > 0 ? 'done' : 'active' as const,
    },
    {
      label: 'STEP 2',
      title: '再进入议题研判',
      description: '当阶段进入 analysis，就说明抓取、正文抽取和研判正在推进。',
      status: stageCounts.analysis > 0 ? 'active' : stageCounts.simulation + stageCounts.completed > 0 ? 'done' : 'pending' as const,
    },
    {
      label: 'STEP 3',
      title: '最后把结果送去推演',
      description: '当阶段进入 simulation 或 completed，说明链路已经推进到推演闭环。',
      status: stageCounts.simulation > 0 ? 'active' : stageCounts.completed > 0 ? 'done' : 'pending' as const,
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>

      {/* ── Page Header ─────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <div className="page-title">自动流程</div>
          <div className="page-subtitle">信号发现 · 议题研判 · 群体推演 · 三阶段自动编排</div>
        </div>
        <div className="flex gap-3">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: wsConnected ? 'var(--low)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: wsConnected ? 'var(--low)' : 'var(--text-muted)', boxShadow: wsConnected ? '0 0 6px var(--low)' : 'none', display: 'inline-block' }} />
            {wsConnected ? '实时连接' : '连接断开'}
          </span>
          <span className="badge badge-active"><span className="badge-dot" />{pipelines.length} 条流水线</span>
        </div>
      </div>

      <WorkflowGuide
        eyebrow="PIPELINE PLAYBOOK"
        title="先发现异常，再研判，再推进推演"
        description="自动流程页不是独立功能，而是全链路编排总线。这里更适合回答“系统现在推进到了哪一步”，而不是手动做分析本身。"
        steps={workflowSteps}
        actions={
          <>
            <NavLink to="/analysis" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>
              打开研判台
            </NavLink>
            <NavLink to="/simulation" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>
              打开推演台
            </NavLink>
          </>
        }
      />

      {/* ── Workflow Summary ───────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr', gap: 'var(--sp-4)' }}>
        <div className="panel" style={{ overflow: 'hidden' }}>
          <div className="panel-body" style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--sp-3)',
            background: 'linear-gradient(135deg, rgba(37,99,235,0.05), rgba(14,165,233,0.02))',
          }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}>
              ORCHESTRATION BUS
            </div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              观测、研判、推演已串成一条自动化总线
            </div>
            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              当前共有 {pipelines.length} 条流水线记录，{activeCount} 条正在推进。系统会把触发信号送入议题研判，再把可用结论送入未来推演。
            </div>
            <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <NavLink to="/analysis" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>进入议题研判</NavLink>
              <NavLink to="/simulation" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>进入未来推演</NavLink>
            </div>
            {latestPipeline && (
              <div style={{
                padding: 'var(--sp-3)',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(255,255,255,0.82)',
                border: '1px solid var(--border)',
                fontSize: '0.74rem',
                color: 'var(--text-secondary)',
              }}>
                最近一条: <span style={{ fontWeight: 700 }}>{latestPipeline.country_name || latestPipeline.country_iso || latestPipeline.pipeline_id}</span>
                {' · '}
                <span style={{ color: 'var(--accent)' }}>{STAGE_LABELS[latestPipeline.stage] ?? latestPipeline.stage}</span>
              </div>
            )}
            <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <NavLink to="/analysis" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>前往议题研判</NavLink>
              <NavLink to="/simulation" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>前往未来推演</NavLink>
            </div>
          </div>
        </div>
        {[
          { label: '待研判', value: stageCounts.analysis, accent: 'var(--accent)' },
          { label: '推演中', value: stageCounts.simulation, accent: 'var(--medium)' },
          { label: '已完成', value: stageCounts.completed, accent: 'var(--low)' },
        ].map((item) => (
          <div key={item.label} className="panel">
            <div className="panel-body" style={{ textAlign: 'center', padding: 'var(--sp-5)' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '0.06em' }}>{item.label}</div>
              <div style={{ fontSize: '2rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: item.accent }}>{item.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Stage Diagram ───────────────────────────────────────── */}
      <div className="panel">
        <div className="panel-header"><span className="panel-title">三阶段流水线</span></div>
        <div className="panel-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--sp-4)' }}>
            {[
              { step: 1, name: '信号发现', desc: '全球观测 CII 计算 + 信号汇聚触发', icon: <RadarIcon />, color: 'var(--accent)', glow: 'rgba(37,99,235,0.08)' },
              { step: 2, name: '议题研判', desc: '多引擎搜索 + 情感分析 + 研判报告', icon: <SearchIcon />, color: 'var(--low)', glow: 'rgba(22,163,74,0.08)' },
              { step: 3, name: '群体推演', desc: 'OASIS 群体智能 · 关系图谱推演', icon: <FishIcon />, color: 'var(--medium)', glow: 'rgba(217,119,6,0.08)' },
            ].map((s, i) => (
              <div key={s.step} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', padding: 'var(--sp-4)', borderRadius: 'var(--radius)', border: `1px solid ${s.color}44`, background: s.glow }}>
                {/* Step number */}
                <div style={{ width: 36, height: 36, borderRadius: 10, background: `${s.color}33`, border: `1px solid ${s.color}66`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: s.color, flexShrink: 0 }}>
                  {s.icon}
                </div>
                {/* Step info */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: s.color, marginBottom: 2 }}>{s.name}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>{s.desc}</div>
                </div>
                {/* Arrow */}
                {i < 2 && <div style={{ color: 'var(--border-bright)', fontSize: '1.2rem', flexShrink: 0 }}>→</div>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)', alignItems: 'start' }}>

        {/* ── Pipeline list ────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            运行中的流水线
          </div>

          {loading ? (
            <div className="empty-state"><div className="spinner" /></div>
          ) : pipelines.length === 0 ? (
            <div className="panel">
              <div className="empty-state" style={{ padding: 'var(--sp-8)' }}>
                <RadarEmptyIcon />
                <p>暂无运行中的流水线<br />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>WorldMonitor 检测到触发条件后自动启动</span>
                </p>
              </div>
            </div>
          ) : (
            pipelines.map(p => (
              <div key={p.pipeline_id} className="panel">
                <div className="panel-body" style={{ padding: 'var(--sp-4)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--sp-3)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 3 }}>
                        {p.country_name || p.country_iso || p.pipeline_id}
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--accent)', marginBottom: 4 }}>
                        {p.pipeline_id}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.5 }}>
                        {p.stage === 'detected' && '已完成信号聚合，等待进入议题研判。'}
                        {p.stage === 'analysis' && '正在进行正文抓取、线索融合与综合研判。'}
                        {p.stage === 'simulation' && '已进入未来推演，正在等待代理体行动和状态收敛。'}
                        {p.stage === 'completed' && '整条流水线已闭环完成，可回看研判与推演结果。'}
                        {p.stage === 'failed' && '流水线在处理中断，需要检查事件流与错误信息。'}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', alignItems: 'center' }}>
                        <span className={`badge ${STAGE_BADGE[p.stage] ?? 'badge-pending'}`}>
                          <span className="badge-dot" />{STAGE_LABELS[p.stage] ?? p.stage}
                        </span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: p.cii_score >= 65 ? 'var(--critical)' : p.cii_score >= 45 ? 'var(--high)' : 'var(--low)' }}>
                          CII {p.cii_score.toFixed(1)}
                        </span>
                        {p.signal_types.slice(0, 2).map(t => (
                          <span key={t} style={{ fontSize: '0.7rem', color: 'var(--text-muted)', padding: '2px 6px', background: 'var(--bg-overlay)', borderRadius: 4 }}>{t}</span>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)', flexWrap: 'wrap' }}>
                        <NavLink to="/analysis" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>
                          查看研判台
                        </NavLink>
                        <NavLink to="/simulation" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>
                          打开推演台
                        </NavLink>
                      </div>
                    </div>
                  </div>

                  {/* Progress bar for active stages */}
                  {!['completed', 'failed'].includes(p.stage) && (
                    <div style={{ marginTop: 'var(--sp-3)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                        <span>进度</span><span style={{ fontFamily: 'var(--font-mono)' }}>{p.stage_progress}%</span>
                      </div>
                      <div className="progress-track">
                        <div className="progress-fill" style={{ width: `${p.stage_progress}%` }} />
                      </div>
                    </div>
                  )}

                  {p.error_message && (
                    <div style={{ marginTop: 'var(--sp-2)', fontSize: '0.75rem', color: 'var(--critical)', padding: 'var(--sp-2)', background: 'var(--critical-d)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,59,92,0.2)' }}>
                      ✕ {p.error_message}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* ── Event Stream ──────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              实时事件流
            </div>
            {events.length > 0 && (
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {events.length} 条事件
              </span>
            )}
          </div>

          <div className="panel" style={{ overflow: 'hidden' }}>
            <div className="log-stream" style={{ maxHeight: 520, padding: 'var(--sp-3)' }}>
              {events.length === 0 ? (
                <div className="empty-state" style={{ padding: 'var(--sp-8)' }}>
                  <LiveIcon />
                  <p style={{ fontSize: '0.78rem' }}>等待实时事件推送...</p>
                </div>
              ) : (
                events.map((evt, i) => {
                  const color = evt.event_type.includes('failed') ? 'var(--critical)'
                    : evt.event_type.includes('completed') ? 'var(--low)'
                    : evt.event_type.includes('progress') ? 'var(--medium)'
                    : 'var(--accent)'
                  const time = new Date(evt.timestamp).toLocaleTimeString('zh-CN')
                  return (
                    <div key={`${evt.pipeline_id}-${evt.timestamp}-${i}`} className="log-entry" style={{ borderLeft: `2px solid ${color}`, paddingLeft: 'var(--sp-2)' }}>
                      <span className="log-time" style={{ color }}>{time}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color, fontWeight: 600, marginBottom: 1 }}>{evt.event_type}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {evt.pipeline_id}
                          {evt.data && Object.keys(evt.data).length > 0 && (
                            <span style={{ marginLeft: 4 }}>{JSON.stringify(evt.data).slice(0, 80)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={eventsEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Icons ─────────────────────────────────────────────────────────────────── */
function RadarIcon() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" width="18" height="18">
    <circle cx="10" cy="10" r="8" /><circle cx="10" cy="10" r="4.5" /><circle cx="10" cy="10" r="2" fill="currentColor" />
  </svg>
}
function SearchIcon() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" width="18" height="18">
    <circle cx="9" cy="9" r="6" /><line x1="14" y1="14" x2="18" y2="18" />
  </svg>
}
function FishIcon() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
    <path d="M2 10 Q6 5 12 10 Q6 15 2 10Z" /><circle cx="14" cy="10" r="1.5" fill="currentColor" /><path d="M15 7 L18 10 L15 13" />
  </svg>
}
function RadarEmptyIcon() {
  return <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" width="52" height="52" opacity="0.3">
    <circle cx="32" cy="32" r="26" /><circle cx="32" cy="32" r="16" /><circle cx="32" cy="32" r="6" />
    <line x1="32" y1="6" x2="32" y2="14" /><line x1="32" y1="50" x2="32" y2="58" />
    <line x1="6" y1="32" x2="14" y2="32" /><line x1="50" y1="32" x2="58" y2="32" />
  </svg>
}
function LiveIcon() {
  return <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" width="40" height="40" opacity="0.3">
    <circle cx="32" cy="32" r="24" strokeDasharray="4 4" />
    <circle cx="32" cy="32" r="8" />
  </svg>
}
