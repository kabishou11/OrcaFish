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
      { name: '支持 / 正面', value: 35 + Math.floor(Math.random() * 15), itemStyle: { color: '#44ff88' } },
      { name: '中立 / 观望', value: 25 + Math.floor(Math.random() * 10), itemStyle: { color: '#5eb8ff' } },
      { name: '质疑 / 反对', value: 20 + Math.floor(Math.random() * 15), itemStyle: { color: '#ff3b5c' } },
      { name: '恐慌 / 焦虑', value: 8 + Math.floor(Math.random() * 8), itemStyle: { color: '#ff8c42' } },
    ]

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item', backgroundColor: 'rgba(7,9,15,0.92)', borderColor: 'var(--border-bright)', textStyle: { color: '#dce8f5', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 } },
      legend: { bottom: 0, textStyle: { color: '#7a92a8', fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" } },
      series: [{
        type: 'pie', radius: ['42%', '70%'], center: ['50%', '45%'],
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 6, borderColor: '#07090f', borderWidth: 2 },
        label: { show: true, color: '#dce8f5', fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", formatter: '{b}\n{d}%' },
        labelLine: { lineStyle: { color: 'rgba(94,184,255,0.4)' } },
        data: sentimentData,
        emphasis: {
          itemStyle: { shadowBlur: 12, shadowColor: 'rgba(94,184,255,0.4)' },
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
        trigger: 'axis', backgroundColor: 'rgba(7,9,15,0.92)', borderColor: 'var(--border-bright)',
        textStyle: { color: '#dce8f5', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 },
        axisPointer: { lineStyle: { color: 'rgba(94,184,255,0.3)' } },
      },
      legend: { top: 0, right: 0, textStyle: { color: '#7a92a8', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" } },
      grid: { left: 38, right: 12, top: 28, bottom: 28 },
      xAxis: { type: 'category', data: days, axisLine: { lineStyle: { color: '#1c2d40' } }, axisLabel: { color: '#3d5266', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }, splitLine: { show: false } },
      yAxis: {
        type: 'value', min: 0, max: 100,
        axisLine: { show: false }, axisLabel: { color: '#3d5266', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" },
        splitLine: { lineStyle: { color: '#1c2d40', type: 'dashed' } },
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
      <div ref={chartRef} style={{ width: '100%', height: 180 }} />
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
      tooltip: { trigger: 'item', backgroundColor: 'rgba(7,9,15,0.92)', borderColor: 'var(--border-bright)', textStyle: { color: '#dce8f5', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 } },
      series: [{
        type: 'sankey',
        emphasis: { focus: 'adjacency' },
        nodeAlign: 'justify',
        lineStyle: { color: 'gradient', curveness: 0.5 },
        data: [
          { name: '官方发布', itemStyle: { color: '#5eb8ff' } },
          { name: '主流媒体', itemStyle: { color: '#44ff88' } },
          { name: '自媒体', itemStyle: { color: '#ffd166' } },
          { name: '社交平台', itemStyle: { color: '#ff8c42' } },
          { name: '意见领袖', itemStyle: { color: '#c084fc' } },
          { name: '普通用户', itemStyle: { color: '#7a92a8' } },
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
        label: { color: '#dce8f5', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10 },
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
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(7,9,15,0.92)', borderColor: 'var(--border-bright)', textStyle: { color: '#dce8f5', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }, axisPointer: { type: 'shadow' } },
      grid: { left: 8, right: 16, top: 8, bottom: 8 },
      xAxis: { show: false },
      yAxis: { type: 'category', data: keywords, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#7a92a8', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }, splitLine: { show: false } },
      series: [{
        type: 'bar',
        data: values.map((v, i) => ({
          value: v,
          itemStyle: {
            color: new graphic.LinearGradient(0, 0, 1, 0, [
              { offset: 0, color: ['#ff3b5c', '#ff8c42', '#ffd166', '#44ff88', '#5eb8ff', '#c084fc', '#ff3b5c', '#ffd166'][i] },
              { offset: 1, color: ['rgba(255,59,92,0.4)', 'rgba(255,140,66,0.4)', 'rgba(255,209,102,0.4)', 'rgba(68,255,136,0.4)', 'rgba(94,184,255,0.4)', 'rgba(192,132,252,0.4)', 'rgba(255,59,92,0.4)', 'rgba(255,209,102,0.4)'][i] },
            ]),
          },
        })),
        barWidth: 10,
        label: { show: true, position: 'right', color: '#3d5266', fontSize: 9, fontFamily: "'IBM Plex Mono', monospace" },
        showBackground: true,
        backgroundStyle: { color: '#1c2d40', borderRadius: 3 },
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

// ── Main Analysis Page ────────────────────────────────────────────────────────
export default function AnalysisPage() {
  // Use location key to prevent state corruption on navigation
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const result = useAnalysisStore((s) => s.result)
  const setResult = useAnalysisStore((s) => s.setResult)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setLoading(true); setError(null); setResult(null)
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
          if (data.status === 'completed' || data.status === 'failed') break
        }
      } catch { break }
    }
  }

  const statusBadge = (status: string) => {
    const cls = status === 'completed' ? 'badge-done' : status === 'failed' ? 'badge-failed' : 'badge-active'
    return <span className={`badge ${cls}`}><span className="badge-dot" />{status.toUpperCase()}</span>
  }

  const inputStyle = (focused = false) => ({
    width: '100%', padding: '10px 14px',
    backgroundColor: 'var(--bg-base)', border: `1px solid ${focused ? 'var(--accent)' : 'var(--border-bright)'}`,
    borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
    fontFamily: 'inherit', fontSize: '0.875rem', resize: 'vertical' as const, outline: 'none',
    transition: 'border-color var(--t-fast), box-shadow var(--t-fast)',
    boxShadow: focused ? '0 0 0 3px rgba(94,184,255,0.15)' : 'none',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)', maxWidth: 1200 }}>

      {/* ── Page Header ─────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <div className="page-title">舆情分析</div>
          <div className="page-subtitle">多源舆情聚合 · 情感分析 · 实体抽取 · 综合报告生成</div>
        </div>
        <div className="flex gap-3">
          <span className="badge badge-normal">
            <span className="badge-dot" />多智能体团队
          </span>
          <span className="badge badge-active">
            <span className="badge-dot" />ModelScope Qwen3.5
          </span>
        </div>
      </div>

      {/* ── Charts Row ─────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">舆情态势</span>
            <span className="badge badge-active"><span className="badge-dot" />LIVE</span>
          </div>
          <div className="panel-body">
            <SentimentChart query={query} />
          </div>
        </div>
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">热词分析</span>
            <span className="badge badge-normal">TOP 8</span>
          </div>
          <div className="panel-body">
            <KeywordChart />
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">CII 趋势</span>
          </div>
          <div className="panel-body">
            <CIITrendChart />
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

      {/* ── Query Form ──────────────────────────────────────────── */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">发起多智能体分析</span>
          <SearchIcon />
        </div>
        <div className="panel-body">
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
            <textarea
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="输入分析主题，例如：台海局势 · 中美关系 · 南海争端 · 朝鲜半岛 · 俄乌冲突..."
              rows={4}
              style={inputStyle()}
              onFocus={e => { (e.target as HTMLTextAreaElement).style.borderColor = 'var(--accent)'; (e.target as HTMLTextAreaElement).style.boxShadow = '0 0 0 3px rgba(94,184,255,0.15)' }}
              onBlur={e => { (e.target as HTMLTextAreaElement).style.borderColor = 'var(--border-bright)'; (e.target as HTMLTextAreaElement).style.boxShadow = 'none' }}
            />
            <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="submit" className="btn btn-primary" disabled={loading || !query.trim()}>
                {loading ? <><div className="spinner-sm" /> 分析中...</> : <><PlayIcon /> 启动多智能体分析</>}
              </button>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Query × Media × Insight 并行 · ModelScope Qwen3.5-35B · 最长等待 15 分钟
              </span>
            </div>
          </form>

          {/* Quick topic chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
            {['俄乌冲突', '中美关系', '台海局势', '南海争端', '朝鲜半岛'].map(t => (
              <button key={t} onClick={() => setQuery(t)} style={{
                padding: '4px 10px', fontSize: '0.75rem', fontWeight: 500,
                background: 'var(--bg-overlay)', border: '1px solid var(--border-bright)',
                borderRadius: 99, color: 'var(--text-secondary)', cursor: 'pointer',
                transition: 'all var(--t-fast)',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-bright)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
              >{t}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Agent Status Row ─────────────────────────────────── */}
      {loading && (
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">多智能体团队状态</span>
            <span className="badge badge-active"><span className="badge-dot" />RUNNING</span>
          </div>
          <div className="panel-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--sp-4)' }}>
              {[
                { name: 'Query Agent', desc: '深度网络舆情搜索', icon: <QueryIcon />, color: '#5eb8ff' },
                { name: 'Media Agent', desc: '媒体报道与多媒体分析', icon: <MediaIcon />, color: '#44ff88' },
                { name: 'Insight Agent', desc: '社交媒体情感分析', icon: <InsightIcon />, color: '#ffd166' },
              ].map(agent => (
                <div key={agent.name} style={{
                  padding: 'var(--sp-4)', background: 'var(--bg-overlay)', borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${agent.color}33`, display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
                }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: `${agent.color}22`, border: `1px solid ${agent.color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: agent.color, flexShrink: 0 }}>
                    {agent.icon}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.8rem', color: agent.color }}>{agent.name}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>{agent.desc}</div>
                  </div>
                  <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
                    <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Error ─────────────────────────────────────────────── */}
      {error && (
        <div className="panel" style={{ borderColor: 'var(--critical)', borderWidth: 1 }}>
          <div className="panel-body">
            <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', color: 'var(--critical)' }}>
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
                <p>多智能体分析进行中，Query × Media × Insight 并行处理中...</p>
              </div>
            ) : result.status === 'failed' ? (
              <div style={{ color: 'var(--critical)', fontSize: '0.875rem' }}>{result.error ?? '分析失败，请重试'}</div>
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
function SearchIcon() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" width="15" height="15" style={{ color: 'var(--text-muted)' }}>
    <circle cx="7" cy="7" r="5" /><line x1="11" y1="11" x2="15" y2="15" />
  </svg>
}
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
