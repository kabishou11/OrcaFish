import { useEffect, useState, useRef } from 'react'
import * as echarts from 'echarts'
import { graphic } from 'echarts'
import { useAnalysisStore, type AnalysisResult } from '../../stores/analysisStore'

// ── Sentiment Chart ────────────────────────────────────────────────────────────
function SentimentChart({ query }: { query: string }) {
  const chartRef = useRef<HTMLDivElement>(null)
  const chartInst = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!chartRef.current) return
    chartInst.current = echarts.init(chartRef.current)

    // Generate mock sentiment data based on query
    const sentimentData = [
      { name: '支持 / 正面', value: 35 + Math.floor(Math.random() * 15), itemStyle: { color: '#16a34a' } },
      { name: '中立 / 观望', value: 25 + Math.floor(Math.random() * 10), itemStyle: { color: '#2563eb' } },
      { name: '质疑 / 反对', value: 20 + Math.floor(Math.random() * 15), itemStyle: { color: '#dc2626' } },
      { name: '恐慌 / 焦虑', value: 8 + Math.floor(Math.random() * 8), itemStyle: { color: '#f97316' } },
    ]

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item', backgroundColor: 'rgba(255,255,255,0.97)', borderColor: '#e2e8f0', textStyle: { color: '#1a2332', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 } },
      legend: { bottom: 0, textStyle: { color: '#8fa3b8', fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" } },
      series: [{
        type: 'pie', radius: ['42%', '70%'], center: ['50%', '45%'],
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 6, borderColor: '#f0f4f8', borderWidth: 2 },
        label: { show: true, color: '#4a5d73', fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", formatter: '{b}\n{d}%' },
        labelLine: { lineStyle: { color: 'rgba(37,99,235,0.3)' } },
        data: sentimentData,
        emphasis: {
          itemStyle: { shadowBlur: 12, shadowColor: 'rgba(37,99,235,0.2)' },
          scale: true, scaleSize: 6,
        },
      }],
    }

    chartInst.current.setOption(option)
    const observer = new ResizeObserver(() => chartInst.current?.resize())
    observer.observe(chartRef.current!)
    return () => { chartInst.current?.dispose(); observer.disconnect() }
  }, [query])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>舆情立场分布</div>
      <div ref={chartRef} style={{ width: '100%', height: 200 }} />
    </div>
  )
}

// ── CII Trend Line Chart ───────────────────────────────────────────────────────
function CIITrendChart() {
  const chartRef = useRef<HTMLDivElement>(null)
  const chartInst = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!chartRef.current) return
    chartInst.current = echarts.init(chartRef.current)

    const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis', backgroundColor: 'rgba(255,255,255,0.97)', borderColor: '#e2e8f0',
        textStyle: { color: '#1a2332', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 },
        axisPointer: { lineStyle: { color: 'rgba(37,99,235,0.2)' } },
      },
      legend: { top: 0, right: 0, textStyle: { color: '#8fa3b8', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" } },
      grid: { left: 38, right: 12, top: 28, bottom: 28 },
      xAxis: { type: 'category', data: days, axisLine: { lineStyle: { color: '#e2e8f0' } }, axisLabel: { color: '#8fa3b8', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }, splitLine: { show: false } },
      yAxis: {
        type: 'value', min: 0, max: 100,
        axisLine: { show: false }, axisLabel: { color: '#8fa3b8', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" },
        splitLine: { lineStyle: { color: '#e2e8f0', type: 'dashed' } },
      },
      series: [
        {
          name: 'CII', type: 'line', smooth: true,
          data: [42, 48, 51, 55, 53, 58, 61],
          lineStyle: { color: '#ff3b5c', width: 2 },
          itemStyle: { color: '#ff3b5c' },
          areaStyle: {
            color: new graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(255,59,92,0.3)' },
              { offset: 1, color: 'rgba(255,59,92,0.02)' },
            ]),
          },
          symbol: 'circle', symbolSize: 5,
        },
        {
          name: '预警线', type: 'line', data: [65, 65, 65, 65, 65, 65, 65],
          lineStyle: { color: 'rgba(255,59,92,0.5)', width: 1, type: 'dashed' },
          itemStyle: { color: 'rgba(255,59,92,0.5)' },
          symbol: 'none',
        },
      ],
    }

    chartInst.current.setOption(option)
    const observer = new ResizeObserver(() => chartInst.current?.resize())
    observer.observe(chartRef.current!)
    return () => { chartInst.current?.dispose(); observer.disconnect() }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>CII 趋势</div>
      <div ref={chartRef} style={{ width: '100%', height: 220 }} />
    </div>
  )
}

// ── Media Flow Sankey ──────────────────────────────────────────────────────────
function MediaFlowSankey() {
  const chartRef = useRef<HTMLDivElement>(null)
  const chartInst = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!chartRef.current) return
    chartInst.current = echarts.init(chartRef.current)

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item', backgroundColor: 'rgba(255,255,255,0.97)', borderColor: '#e2e8f0', textStyle: { color: '#1a2332', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 } },
      series: [{
        type: 'sankey',
        emphasis: { focus: 'adjacency' },
        nodeAlign: 'justify',
        lineStyle: { color: 'gradient', curveness: 0.5 },
        data: [
          { name: '官方发布', itemStyle: { color: '#2563eb' } },
          { name: '主流媒体', itemStyle: { color: '#16a34a' } },
          { name: '自媒体', itemStyle: { color: '#d97706' } },
          { name: '社交平台', itemStyle: { color: '#f97316' } },
          { name: '意见领袖', itemStyle: { color: '#c084fc' } },
          { name: '普通用户', itemStyle: { color: '#8fa3b8' } },
        ],
        links: [
          { source: '官方发布', target: '主流媒体', value: 45 },
          { source: '主流媒体', target: '自媒体', value: 32 },
          { source: '主流媒体', target: '社交平台', value: 28 },
          { source: '自媒体', target: '意见领袖', value: 22 },
          { source: '社交平台', target: '意见领袖', value: 18 },
          { source: '意见领袖', target: '普通用户', value: 55 },
          { source: '社交平台', target: '普通用户', value: 35 },
        ],
        itemStyle: { borderWidth: 0 },
        label: { color: '#4a5d73', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10 },
      }],
    }

    chartInst.current.setOption(option)
    const observer = new ResizeObserver(() => chartInst.current?.resize())
    observer.observe(chartRef.current!)
    return () => { chartInst.current?.dispose(); observer.disconnect() }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>舆情传播路径</div>
      <div ref={chartRef} style={{ width: '100%', height: 200 }} />
    </div>
  )
}

// ── Keyword Bar Chart ──────────────────────────────────────────────────────────
function KeywordChart() {
  const chartRef = useRef<HTMLDivElement>(null)
  const chartInst = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!chartRef.current) return
    chartInst.current = echarts.init(chartRef.current)

    const keywords = ['局势紧张', '军事行动', '外交谈判', '经济制裁', '人道危机', '能源供应', '难民潮', '停火协议']
    const values = [92, 78, 65, 58, 52, 45, 38, 28]

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(255,255,255,0.97)', borderColor: '#e2e8f0', textStyle: { color: '#1a2332', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }, axisPointer: { type: 'shadow' } },
      grid: { left: 8, right: 16, top: 8, bottom: 8 },
      xAxis: { show: false },
      yAxis: { type: 'category', data: keywords, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#8fa3b8', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }, splitLine: { show: false } },
      series: [{
        type: 'bar',
        data: values.map((v, i) => ({
          value: v,
          itemStyle: {
            color: new graphic.LinearGradient(0, 0, 1, 0, [
              { offset: 0, color: ['#dc2626', '#f97316', '#d97706', '#16a34a', '#2563eb', '#c084fc', '#dc2626', '#d97706'][i] },
              { offset: 1, color: ['rgba(220,38,38,0.3)', 'rgba(249,115,22,0.3)', 'rgba(217,119,6,0.3)', 'rgba(22,163,74,0.3)', 'rgba(37,99,235,0.3)', 'rgba(192,132,252,0.3)', 'rgba(220,38,38,0.3)', 'rgba(217,119,6,0.3)'][i] },
            ]),
          },
        })),
        barWidth: 10,
        label: { show: true, position: 'right', color: '#8fa3b8', fontSize: 9, fontFamily: "'IBM Plex Mono', monospace" },
        showBackground: true,
        backgroundStyle: { color: '#e2e8f0', borderRadius: 3 },
        itemStyle: { borderRadius: [0, 3, 3, 0] },
      }],
    }

    chartInst.current.setOption(option)
    const observer = new ResizeObserver(() => chartInst.current?.resize())
    observer.observe(chartRef.current!)
    return () => { chartInst.current?.dispose(); observer.disconnect() }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>热词频次</div>
      <div ref={chartRef} style={{ width: '100%', height: 200 }} />
    </div>
  )
}

// ── Agent status type ─────────────────────────────────────────────────────────
type AgentStatus = 'idle' | 'running' | 'done'

const AGENTS = [
  { name: '搜索代理体', desc: '全网检索与线索发现', icon: 'query' as const, color: '#2563eb' },
  { name: '媒体代理体', desc: '正文抽取与媒体脉络整理', icon: 'media' as const, color: '#16a34a' },
  { name: '洞察代理体', desc: '情绪变化与观点结构分析', icon: 'insight' as const, color: '#d97706' },
] as const

// ── Main Analysis Page ────────────────────────────────────────────────────────
export default function AnalysisPage() {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const result = useAnalysisStore((s) => s.result)
  const setResult = useAnalysisStore((s) => s.setResult)
  const [error, setError] = useState<string | null>(null)
  const [agentStatuses, setAgentStatuses] = useState<AgentStatus[]>(['idle', 'idle', 'idle'])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setLoading(true); setError(null); setResult(null)
    // Stagger agent activation for visual effect
    setAgentStatuses(['running', 'idle', 'idle'])
    setTimeout(() => setAgentStatuses(s => [s[0], 'running', s[2]]), 600)
    setTimeout(() => setAgentStatuses(s => [s[0], s[1], 'running']), 1200)

    try {
      const res = await fetch('/api/analysis/trigger', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      })
      if (!res.ok) { const err = await res.json(); throw new Error(err.detail ?? '分析请求失败') }
      const data: AnalysisResult = await res.json()
      setResult(data)
      if (data.task_id) pollResult(data.task_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误')
      setAgentStatuses(['idle', 'idle', 'idle'])
    } finally { setLoading(false) }
  }

  const pollResult = async (taskId: string) => {
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000))
      try {
        const res = await fetch(`/api/analysis/${taskId}`)
        if (res.ok) {
          const data: AnalysisResult = await res.json()
          setResult(data)
          if (data.status === 'completed' || data.status === 'failed') {
            setAgentStatuses(['done', 'done', 'done'])
            break
          }
        }
      } catch { break }
    }
  }

  const statusBadge = (status: string) => {
    const cls = status === 'completed' ? 'badge-done' : status === 'failed' ? 'badge-failed' : 'badge-active'
    const statusLabels: Record<string, string> = { completed: '已完成', failed: '失败', running: '进行中', created: '已创建' }
    return <span className={`badge ${cls}`}><span className="badge-dot" />{statusLabels[status] ?? status}</span>
  }

  const agentStatusLabel = (s: AgentStatus) => {
    if (s === 'idle') return '就绪'
    if (s === 'running') return '运行中'
    return '完成'
  }

  const agentStatusDotColor = (s: AgentStatus) => {
    if (s === 'idle') return '#8fa3b8'
    if (s === 'running') return '#f59e0b'
    return '#16a34a'
  }

  const inputStyle = (focused = false) => ({
    width: '100%', padding: '12px 16px',
    backgroundColor: 'var(--bg-surface)', border: `1.5px solid ${focused ? 'var(--accent)' : 'var(--border)'}`,
    borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
    fontFamily: 'inherit', fontSize: '0.9rem', resize: 'vertical' as const, outline: 'none',
    transition: 'border-color var(--t-fast), box-shadow var(--t-fast)',
    boxShadow: focused ? '0 0 0 3px var(--accent-dim)' : 'none',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)', maxWidth: 1200 }}>

      {/* ── Page Header ─────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <div className="page-title">议题研判</div>
          <div className="page-subtitle">多源信息汇聚 · 正文抽取 · 情绪分析 · 综合研判报告</div>
        </div>
        <div className="flex gap-3">
          <span className="badge badge-normal">
            <span className="badge-dot" />研判协同
          </span>
          <span className="badge badge-active">
            <span className="badge-dot" />本地模型
          </span>
        </div>
      </div>

      {/* ── Hero Input Area ─────────────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(37,99,235,0.04) 0%, rgba(192,132,252,0.04) 50%, rgba(22,163,74,0.03) 100%)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--sp-6)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Subtle decorative accent line at top */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 3,
          background: 'linear-gradient(90deg, #2563eb, #c084fc, #16a34a)',
          opacity: 0.6,
        }} />

        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
            发起议题研判
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            多路抓取并行 · 正文抽取与清洗 · 本地模型推理 · 最长等待 15 分钟
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <textarea
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="输入分析主题，例如：台海局势 · 中美关系 · 南海争端 · 朝鲜半岛 · 俄乌冲突..."
            rows={3}
            style={inputStyle()}
            onFocus={e => { (e.target as HTMLTextAreaElement).style.borderColor = 'var(--accent)'; (e.target as HTMLTextAreaElement).style.boxShadow = '0 0 0 3px var(--accent-dim)' }}
            onBlur={e => { (e.target as HTMLTextAreaElement).style.borderColor = 'var(--border)'; (e.target as HTMLTextAreaElement).style.boxShadow = 'none' }}
          />

          {/* Quick topic chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginRight: 4 }}>快捷话题</span>
            {['俄乌冲突', '中美关系', '台海局势', '南海争端', '朝鲜半岛'].map(t => (
              <button key={t} type="button" onClick={() => setQuery(t)} style={{
                padding: '4px 12px', fontSize: '0.75rem', fontWeight: 500,
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                borderRadius: 99, color: 'var(--text-secondary)', cursor: 'pointer',
                transition: 'all var(--t-fast)',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.background = 'rgba(37,99,235,0.06)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--bg-surface)' }}
              >{t}</button>
            ))}
          </div>

          <div>
            <button type="submit" className="btn btn-primary" disabled={loading || !query.trim()} style={{ minWidth: 160, height: 40 }}>
              {loading ? <><div className="spinner-sm" /> 研判中...</> : <><PlayIcon /> 启动议题研判</>}
            </button>
          </div>
        </form>
      </div>

      {/* ── Agent Cards (always visible) ────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--sp-4)' }}>
        {AGENTS.map((agent, i) => {
          const status = agentStatuses[i]
          const isRunning = status === 'running'
          return (
            <div key={agent.name} style={{
              padding: 'var(--sp-4)',
              background: isRunning
                ? `linear-gradient(135deg, ${agent.color}08, ${agent.color}04)`
                : 'var(--bg-surface)',
              borderRadius: 'var(--radius-sm)',
              border: `1px solid ${isRunning ? agent.color + '44' : 'var(--border)'}`,
              display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
              transition: 'all 0.3s ease',
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: `${agent.color}15`,
                border: `1px solid ${agent.color}33`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: agent.color, flexShrink: 0,
              }}>
                {agent.icon === 'query' && <QueryIcon />}
                {agent.icon === 'media' && <MediaIcon />}
                {agent.icon === 'insight' && <InsightIcon />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-primary)' }}>{agent.name}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>{agent.desc}</div>
              </div>
              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                {isRunning ? (
                  <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                ) : (
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    backgroundColor: agentStatusDotColor(status),
                    boxShadow: status === 'done' ? `0 0 6px ${agentStatusDotColor(status)}66` : 'none',
                  }} />
                )}
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {agentStatusLabel(status)}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Data Dashboard ──────────────────────────────────────── */}
      {/* Row 1: CII Trend (2fr) + Sentiment Pie (1fr) */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--sp-4)' }}>
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">CII 趋势</span>
            <span className="badge badge-active"><span className="badge-dot" />实时</span>
          </div>
          <div className="panel-body">
            <CIITrendChart />
          </div>
        </div>
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">舆情态势</span>
          </div>
          <div className="panel-body">
            <SentimentChart query={query} />
          </div>
        </div>
      </div>

      {/* Row 2: Keywords (1fr) + Sankey (1fr) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">热词分析</span>
            <span className="badge badge-normal">TOP 8</span>
          </div>
          <div className="panel-body">
            <KeywordChart />
          </div>
        </div>
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">舆情传播路径</span>
          </div>
          <div className="panel-body">
            <MediaFlowSankey />
          </div>
        </div>
      </div>

      {/* ── Error ─────────────────────────────────────────────── */}
      {error && (
        <div className="panel" style={{ borderColor: '#ff3b5c', borderWidth: 1 }}>
          <div className="panel-body">
            <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', color: '#ff3b5c' }}>
              <ErrorIcon />
              <span style={{ fontSize: '0.875rem' }}>{error}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Result ────────────────────────────────────────────── */}
      {result && (
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">分析结果</span>
            <div className="flex gap-3" style={{ alignItems: 'center' }}>
              <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{result.task_id}</span>
              {statusBadge(result.status)}
            </div>
          </div>
          <div className="panel-body">
            {result.status === 'running' || result.status === 'created' ? (
              <div className="empty-state">
                <div className="spinner" style={{ width: 28, height: 28 }} />
                <p>议题研判进行中，多路抓取、正文抽取与洞察分析正在并行处理...</p>
              </div>
            ) : result.status === 'failed' ? (
              <div style={{ color: '#ff3b5c', fontSize: '0.875rem' }}>{result.error ?? '分析失败，请重试'}</div>
            ) : result.html_report ? (
              <div
                className="report-body"
                style={{ fontSize: '0.875rem', lineHeight: 1.9, color: 'var(--text-secondary)', maxHeight: 600, overflowY: 'auto', padding: 'var(--sp-4)', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                dangerouslySetInnerHTML={{ __html: result.html_report }}
              />
            ) : (
              <div className="empty-state"><p>暂无报告内容</p></div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Agent Icons ─────────────────────────────────────────────────────────────── */
function PlayIcon() {
  return <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><polygon points="4,2 14,8 4,14" /></svg>
}
function ErrorIcon() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" width="16" height="16">
    <circle cx="8" cy="8" r="7" /><line x1="8" y1="5" x2="8" y2="8.5" /><circle cx="8" cy="11" r="0.5" fill="currentColor" />
  </svg>
}
function QueryIcon() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" width="16" height="16">
    <circle cx="7" cy="7" r="5" /><line x1="11" y1="11" x2="15" y2="15" />
  </svg>
}
function MediaIcon() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" width="16" height="16">
    <rect x="2" y="3" width="12" height="9" rx="1.5" /><circle cx="5.5" cy="6" r="1" fill="currentColor" />
    <path d="M2 10 L6 8 L10 11 L14 9" />
  </svg>
}
function InsightIcon() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" width="16" height="16">
    <path d="M8 2 L9.5 6 L14 6 L10.5 9 L12 14 L8 11 L4 14 L5.5 9 L2 6 L6.5 6 Z" fill="currentColor" opacity="0.3" />
  </svg>
}
