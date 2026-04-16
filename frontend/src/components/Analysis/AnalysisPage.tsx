import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAnalysisStore, type AnalysisResult } from '../../stores/analysisStore'
import { useIntelligenceStore, type ObservationCountryContext } from '../../stores/intelligenceStore'
import { useSimulationDraftStore } from '../../stores/simulationDraftStore'
import WorkflowGuide, { type WorkflowGuideStep } from '../WorkflowGuide'
import useViewportMatch from '../../hooks/useViewportMatch'

const TOPIC_COORDS: Record<string, [number, number]> = {
  台海: [23.7, 121.0],
  台湾: [23.7, 121.0],
  中美: [39.9, 116.4],
  中国: [35.9, 104.2],
  南海: [14.0, 115.0],
  朝鲜: [40.3, 127.5],
  朝鲜半岛: [38.0, 127.0],
  俄乌: [48.4, 31.2],
  乌克兰: [48.4, 31.2],
  俄罗斯: [61.5, 105.3],
  中东: [29.3, 47.5],
  伊朗: [32.4, 53.7],
  欧洲: [50.1, 10.5],
  美国: [37.1, -95.7],
  日本: [36.2, 138.2],
  韩国: [35.9, 127.8],
}

const AGENTS = [
  { key: 'query', name: '搜索代理体', desc: '全网线索与事实抽取', color: '#2563eb' },
  { key: 'media', name: '媒体代理体', desc: '正文清洗与叙事脉络', color: '#16a34a' },
  { key: 'insight', name: '洞察代理体', desc: '情绪与立场结构识别', color: '#d97706' },
] as const

const REPORT_SECTIONS = [
  { key: 'query_report', title: '搜索研判流', color: '#2563eb' },
  { key: 'media_report', title: '媒体脉络流', color: '#16a34a' },
  { key: 'insight_report', title: '洞察结构流', color: '#d97706' },
  { key: 'final_report', title: '综合结论流', color: '#7c3aed' },
] as const

const STOPWORDS = new Set([
  '我们', '你们', '他们', '这个', '那个', '以及', '如果', '因为', '因此', '对于', '正在',
  '进行', '相关', '当前', '可能', '已经', '需要', '通过', '问题', '情况', '方面', '进一步',
  '分析', '报告', '媒体', '社交', '平台', '网络', '观点', '内容', '其中', '由于', '以下',
  '出现', '一个', '没有', '可以', '应该', '议题', '未来', '推演', '预测', '结果', '当前局势',
])

const LEVEL_TEXT: Record<string, string> = {
  low: '低',
  normal: '正常',
  elevated: '偏高',
  high: '高',
  critical: '紧急',
}

function extractSignalCoords(q: string): { lat: number; lon: number } | null {
  for (const [kw, coord] of Object.entries(TOPIC_COORDS)) {
    if (q.includes(kw)) return { lat: coord[0], lon: coord[1] }
  }
  return null
}

function stripHtml(html?: string): string {
  return html?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ?? ''
}

function getCombinedText(result: AnalysisResult | null, query: string) {
  return [
    query,
    result?.query_report ?? '',
    result?.media_report ?? '',
    result?.insight_report ?? '',
    result?.final_report ?? '',
    stripHtml(result?.html_report),
  ].join('\n')
}

function extractKeywords(result: AnalysisResult | null, text: string) {
  const counts = new Map<string, number>()
  for (const term of result?.matched_terms ?? []) {
    const word = term.trim()
    if (word.length < 2 || STOPWORDS.has(word)) continue
    counts.set(word, (counts.get(word) ?? 0) + 6)
  }
  for (const item of result?.news_digest ?? []) {
    const matches = `${item.title} ${item.summary}`.match(/[\u4e00-\u9fff]{2,8}/g) ?? []
    for (const raw of matches) {
      const word = raw.trim()
      if (word.length < 2 || STOPWORDS.has(word)) continue
      counts.set(word, (counts.get(word) ?? 0) + 2)
    }
  }
  const matches = text.match(/[\u4e00-\u9fff]{2,8}/g) ?? []
  for (const raw of matches) {
    const word = raw.trim()
    if (word.length < 2 || STOPWORDS.has(word)) continue
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
}

function computeSentiment(text: string) {
  const positiveWords = ['缓和', '合作', '谈判', '修复', '稳定', '停火', '降温', '共识', '回落']
  const negativeWords = ['升级', '冲突', '制裁', '威胁', '攻击', '失控', '危机', '对抗', '紧张']
  const uncertainWords = ['可能', '观察', '不确定', '待定', '博弈', '分歧', '震荡', '摇摆']
  const count = (terms: string[]) => terms.reduce((sum, term) => sum + (text.match(new RegExp(term, 'g'))?.length ?? 0), 0)
  const calm = count(positiveWords)
  const risk = count(negativeWords)
  const uncertain = count(uncertainWords)
  const total = Math.max(calm + risk + uncertain, 1)
  return [
    { label: '升温信号', value: Math.round((risk / total) * 100), color: '#dc2626' },
    { label: '缓和信号', value: Math.round((calm / total) * 100), color: '#16a34a' },
    { label: '不确定信号', value: Math.max(100 - Math.round((risk / total) * 100) - Math.round((calm / total) * 100), 0), color: '#2563eb' },
  ]
}

function getCoverage(result: AnalysisResult | null) {
  const metrics = result?.agent_metrics
  if (metrics) {
    return [
      { label: '搜索', value: metrics.query?.source_count ?? metrics.query?.progress ?? 0, color: '#2563eb' },
      { label: '媒体', value: metrics.media?.source_count ?? metrics.media?.progress ?? 0, color: '#16a34a' },
      { label: '洞察', value: metrics.insight?.source_count ?? metrics.insight?.progress ?? 0, color: '#d97706' },
    ]
  }
  if (result?.source_count || result?.agent_status) {
    return [
      { label: '搜索', value: result.agent_status?.query === 'done' ? Math.max(result.source_count ?? 0, 1) : result.agent_status?.query === 'fallback' ? 1 : 0, color: '#2563eb' },
      { label: '媒体', value: result.agent_status?.media === 'done' ? Math.max(Math.round((result.source_count ?? 0) * 0.75), 1) : result.agent_status?.media === 'fallback' ? 1 : 0, color: '#16a34a' },
      { label: '洞察', value: result.agent_status?.insight === 'done' ? Math.max(Math.round((result.source_count ?? 0) * 0.6), 1) : result.agent_status?.insight === 'fallback' ? 1 : 0, color: '#d97706' },
    ]
  }
  return [
    { label: '搜索', value: result?.query_report?.length ?? 0, color: '#2563eb' },
    { label: '媒体', value: result?.media_report?.length ?? 0, color: '#16a34a' },
    { label: '洞察', value: result?.insight_report?.length ?? 0, color: '#d97706' },
  ]
}

function getQualityTone(result: AnalysisResult | null) {
  if (result?.status === 'degraded' || result?.data_quality === 'degraded') {
    return { text: '当前为观察版', color: '#d97706' }
  }
  if (result?.data_quality === 'mixed') {
    return { text: '当前为混合质量', color: '#2563eb' }
  }
  if (result?.data_quality === 'live') {
    return { text: '当前为实时研判', color: '#16a34a' }
  }
  return { text: '等待研判启动', color: '#64748b' }
}

function getStructuredSentiment(result: AnalysisResult | null, combinedText: string) {
  if (result?.sentiment_hint) {
    const positive = result.sentiment_hint.positive ?? 0
    const negative = result.sentiment_hint.negative ?? 0
    const uncertain = result.sentiment_hint.uncertain ?? 0
    const total = Math.max(positive + negative + uncertain, 1)
    return [
      { label: '升温信号', value: Math.round((negative / total) * 100), color: '#dc2626' },
      { label: '缓和信号', value: Math.round((positive / total) * 100), color: '#16a34a' },
      { label: '不确定信号', value: Math.max(100 - Math.round((negative / total) * 100) - Math.round((positive / total) * 100), 0), color: '#2563eb' },
    ]
  }
  return computeSentiment(combinedText)
}

function getSectionSummary(text?: string) {
  if (!text) return '等待该板块输出。'
  return text.replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').trim().slice(0, 140) || '该板块已完成。'
}

function pickDefaultDigest(result: AnalysisResult | null) {
  const digest = result?.news_digest ?? []
  return digest.length ? digest[0] : null
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function renderMarkdown(md?: string) {
  if (!md?.trim()) return '<p>该模块仍在等待输出。</p>'
  const source = escapeHtml(md.trim())
  const blocks = source.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
  return blocks.map((block) => {
    if (/^###\s+/.test(block)) return `<h3>${block.replace(/^###\s+/, '')}</h3>`
    if (/^##\s+/.test(block)) return `<h2>${block.replace(/^##\s+/, '')}</h2>`
    if (/^#\s+/.test(block)) return `<h1>${block.replace(/^#\s+/, '')}</h1>`
    if (/^-\s+/m.test(block)) {
      const items = block.split('\n').filter((line) => /^-\s+/.test(line)).map((line) => `<li>${line.replace(/^-\s+/, '')}</li>`).join('')
      return `<ul>${items}</ul>`
    }
    if (/^\d+\.\s+/m.test(block)) {
      const items = block.split('\n').filter((line) => /^\d+\.\s+/.test(line)).map((line) => `<li>${line.replace(/^\d+\.\s+/, '')}</li>`).join('')
      return `<ol>${items}</ol>`
    }
    return `<p>${block.replace(/\n/g, '<br/>')}</p>`
  }).join('')
}

function StageMetric({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.9)', padding: '12px 14px' }}>
      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: 4, letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: '1.15rem', fontWeight: 800, color }}>{value}</div>
    </div>
  )
}

function MiniBarChart({ title, rows }: { title: string; rows: Array<{ label: string; value: number; color: string }> }) {
  const max = Math.max(...rows.map((row) => row.value), 1)
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">{title}</span>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
        {rows.map((row) => (
          <div key={row.label} style={{ display: 'grid', gridTemplateColumns: '96px 1fr 42px', gap: 'var(--sp-3)', alignItems: 'center' }}>
            <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>{row.label}</div>
            <div style={{ height: 8, borderRadius: 999, overflow: 'hidden', background: 'var(--bg-overlay)' }}>
              <div style={{ width: `${(row.value / max) * 100}%`, height: '100%', background: row.color, borderRadius: 999 }} />
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: row.color, textAlign: 'right' }}>{row.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function FlowCard({
  title,
  status,
  summary,
  color,
  metric,
}: {
  title: string
  status: 'waiting' | 'running' | 'done' | 'fallback'
  summary: string
  color: string
  metric?: {
    progress: number
    source_count: number
    fallback_used: boolean
    summary: string
  }
}) {
  const badgeText = status === 'done' ? '已到达' : status === 'fallback' ? '观察版' : status === 'running' ? '输出中' : '待输出'
  return (
    <div style={{
      border: `1px solid ${status === 'running' || status === 'fallback' ? `${color}55` : 'var(--border)'}`,
      borderRadius: 'var(--radius-sm)',
      background: status === 'running' || status === 'fallback' ? `linear-gradient(135deg, ${color}10, rgba(255,255,255,0.96))` : 'rgba(255,255,255,0.92)',
      padding: 'var(--sp-4)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--sp-3)',
      minHeight: 150,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-3)' }}>
        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
        <span style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', padding: '2px 8px', borderRadius: 999, background: `${color}14`, color }}>
          {badgeText}
        </span>
      </div>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>{summary}</div>
      {metric ? (
        <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          <span>进度 {metric.progress}%</span>
          <span>来源 {metric.source_count ?? 0}</span>
          {metric.fallback_used ? <span style={{ color }}>{'观察摘要'}</span> : null}
        </div>
      ) : null}
      <div style={{ marginTop: 'auto', height: 3, borderRadius: 999, overflow: 'hidden', background: 'var(--bg-overlay)' }}>
        <div style={{ width: status === 'done' ? '100%' : status === 'fallback' ? '82%' : status === 'running' ? `${Math.max(metric?.progress ?? 62, 18)}%` : '18%', height: '100%', background: color, borderRadius: 999, transition: 'width 0.3s ease' }} />
      </div>
    </div>
  )
}

function SectionStreamCard({ title, content, color, active, status, summary }: { title: string; content?: string; color: string; active: boolean; status?: string; summary?: string }) {
  return (
    <div style={{ border: `1px solid ${active ? `${color}44` : 'var(--border)'}`, borderRadius: 'var(--radius-sm)', background: active ? `linear-gradient(135deg, ${color}10, rgba(255,255,255,0.96))` : 'rgba(255,255,255,0.94)', boxShadow: active ? `0 10px 30px ${color}12` : 'var(--shadow-sm)', overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {status ? <span style={{ fontSize: '0.68rem', color: active ? color : 'var(--text-muted)' }}>{status === 'fallback' ? '观察摘要' : status === 'done' ? '已到达' : status === 'running' ? '输出中' : status === 'degraded' ? '观察版' : '待输出'}</span> : null}
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: content ? color : 'var(--border-bright)', boxShadow: content ? `0 0 10px ${color}` : 'none' }} />
        </div>
      </div>
      {summary ? (
        <div style={{ padding: '10px 16px 0', fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>{summary}</div>
      ) : null}
      <div
        className="analysis-stream-markdown"
        style={{ padding: '14px 16px', fontSize: '0.82rem', lineHeight: 1.8, color: '#28435c', minHeight: 120 }}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
      />
    </div>
  )
}

function TimelineCard({ events }: { events: NonNullable<AnalysisResult['timeline']> }) {
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">阶段时间线</span>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
        {events.length === 0 ? (
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>等待议题启动后展示阶段事件。</div>
        ) : events.map((event) => (
          <div key={event.key} style={{ display: 'grid', gridTemplateColumns: '10px 1fr', gap: 'var(--sp-3)' }}>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: event.status === 'done' ? '#16a34a' : event.status === 'fallback' || event.status === 'warning' ? '#d97706' : event.status === 'failed' ? '#dc2626' : '#2563eb', marginTop: 5 }} />
            </div>
            <div style={{ paddingBottom: 'var(--sp-3)', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.82rem' }}>{event.title}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-muted)' }}>{new Date(event.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
              </div>
              <div style={{ marginTop: 4, fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>{event.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function StagePulse({ events }: { events: NonNullable<AnalysisResult['timeline']> }) {
  const latest = events.slice(-4).reverse()
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">阶段脉冲</span>
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 'var(--sp-3)' }}>
        {latest.length === 0 ? (
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>提交议题后，这里会先显示监控摘要接入、多代理启动和各板块到达的事件。</div>
        ) : latest.map((event) => (
          <div
            key={`${event.key}-${event.created_at}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '84px 1fr',
              gap: 'var(--sp-3)',
              padding: '10px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: event.status === 'fallback' || event.status === 'warning'
                ? 'linear-gradient(135deg, rgba(217,119,6,0.08), rgba(255,255,255,0.96))'
                : event.status === 'done'
                  ? 'linear-gradient(135deg, rgba(22,163,74,0.08), rgba(255,255,255,0.96))'
                  : 'linear-gradient(135deg, rgba(37,99,235,0.08), rgba(255,255,255,0.96))',
            }}
          >
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {event.created_at ? new Date(event.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '实时'}
            </div>
            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{event.title}</div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.65 }}>{event.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ResultArrivalRail({
  sections,
}: {
  sections: Array<{
    key: string
    title: string
    status: string
    summary?: string
    content?: string
  }>
}) {
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">结果到达轨道</span>
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 'var(--sp-3)' }}>
        {sections.map((section, index) => {
          const color = REPORT_SECTIONS.find((item) => item.title === section.title)?.color ?? '#2563eb'
          const arrived = Boolean(section.content)
          const running = !arrived && (section.status === 'running' || section.status === 'assembling')
          const fallback = section.status === 'fallback'
          return (
            <div key={section.key} style={{ display: 'grid', gridTemplateColumns: '84px 18px 1fr', gap: 'var(--sp-3)', alignItems: 'stretch' }}>
              <div style={{ fontSize: '0.68rem', color: arrived || running || fallback ? color : 'var(--text-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', paddingTop: 2 }}>
                0{index + 1}
              </div>
              <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
                <div style={{ position: 'absolute', top: 0, bottom: index === sections.length - 1 ? '50%' : -14, width: 2, background: arrived || running || fallback ? `${color}55` : 'var(--border)' }} />
                <div style={{
                  position: 'relative',
                  marginTop: 2,
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: arrived ? color : fallback ? color : running ? '#fff' : 'var(--bg-overlay)',
                  border: running ? `2px solid ${color}` : `2px solid ${arrived || fallback ? color : 'var(--border)'}`,
                  boxShadow: running ? `0 0 0 4px ${color}18` : 'none',
                }} />
              </div>
              <div style={{
                border: `1px solid ${arrived || running || fallback ? `${color}33` : 'var(--border)'}`,
                borderRadius: 'var(--radius-sm)',
                background: arrived || running || fallback ? `linear-gradient(135deg, ${color}10, rgba(255,255,255,0.96))` : 'rgba(255,255,255,0.9)',
                padding: '10px 12px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.8rem' }}>{section.title}</div>
                  <span style={{ fontSize: '0.66rem', color: arrived || running || fallback ? color : 'var(--text-muted)' }}>
                    {arrived ? '已到达' : fallback ? '观察摘要' : running ? '输出中' : '等待中'}
                  </span>
                </div>
                <div style={{ marginTop: 6, fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  {section.summary || '该板块会在前序结果稳定后继续到达。'}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CountryContextBrief({
  context,
  latestHeadline,
}: {
  context: ObservationCountryContext
  latestHeadline?: string | null
}) {
  return (
    <div style={{
      padding: '12px 14px',
      borderRadius: 'var(--radius-sm)',
      border: '1px solid rgba(14,165,233,0.16)',
      background: 'linear-gradient(135deg, rgba(14,165,233,0.07), rgba(255,255,255,0.96))',
      display: 'grid',
      gap: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '0.68rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', marginBottom: 4 }}>
            国家观察包
          </div>
          <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
            {context.country_name} · CII {context.score.toFixed(1)}
          </div>
        </div>
        <span className="badge badge-normal">
          <span className="badge-dot" />{LEVEL_TEXT[context.level] ?? context.level}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        <div style={{ padding: '8px 10px', borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.88)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>新闻</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)' }}>{context.news_count}</div>
        </div>
        <div style={{ padding: '8px 10px', borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.88)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>信号</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)' }}>{context.signal_count}</div>
        </div>
        <div style={{ padding: '8px 10px', borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.88)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>焦点</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)' }}>{context.focal_count}</div>
        </div>
      </div>
      {context.narrative ? (
        <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.65 }}>{context.narrative}</div>
      ) : null}
      {latestHeadline ? (
        <div style={{ fontSize: '0.72rem', color: 'var(--text-primary)', lineHeight: 1.6 }}>
          最新标题：{latestHeadline}
        </div>
      ) : null}
    </div>
  )
}

export default function AnalysisPage() {
  const isCompact = useViewportMatch(1180)
  const isNarrow = useViewportMatch(860)
  const navigate = useNavigate()
  const result = useAnalysisStore((s) => s.result)
  const setResult = useAnalysisStore((s) => s.setResult)
  const storedDraftQuery = useAnalysisStore((s) => s.draftQuery)
  const setDraftQuery = useAnalysisStore((s) => s.setDraftQuery)
  const [query, setQuery] = useState(storedDraftQuery)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const injectSignal = useIntelligenceStore((s) => s.injectSignal)
  const injectedSignals = useIntelligenceStore((s) => s.injectedSignals)
  const activeCountryContext = useIntelligenceStore((s) => s.activeCountryContext)
  const setSimulationDraft = useSimulationDraftStore((s) => s.setDraft)
  const latestInjectedSignal = injectedSignals[0] ?? null
  const latestCountryHeadline = activeCountryContext?.top_headlines?.[0] ?? null
  const activeQuery = query.trim() || result?.query?.trim() || storedDraftQuery.trim()

  useEffect(() => {
    if (query.trim()) return
    const restoredQuery = storedDraftQuery || result?.query || ''
    if (restoredQuery) {
      setQuery(restoredQuery)
      return
    }
    const injectedQuery = latestInjectedSignal?.query?.trim()
    if (injectedQuery) {
      setQuery(injectedQuery)
      return
    }
    if (activeCountryContext?.country_name) {
      setQuery(`${activeCountryContext.country_name} 风险升温`)
    }
  }, [activeCountryContext?.country_name, latestInjectedSignal?.query, query, result?.query, storedDraftQuery])

  const combinedText = useMemo(() => getCombinedText(result, activeQuery), [activeQuery, result])
  const keywordRows = useMemo(() => extractKeywords(result, combinedText).map(([label, value], index) => ({
    label,
    value,
    color: ['#2563eb', '#16a34a', '#d97706', '#7c3aed', '#dc2626', '#0ea5e9', '#059669', '#f97316'][index % 8],
  })), [combinedText, result])
  const sentimentRows = useMemo(() => getStructuredSentiment(result, combinedText), [combinedText, result])
  const coverageRows = useMemo(() => getCoverage(result), [result])
  const qualityTone = useMemo(() => getQualityTone(result), [result])
  const timelineEvents = result?.timeline ?? []
  const sectionRows = result?.sections?.length
    ? [...result.sections].sort((a, b) => a.order - b.order)
    : REPORT_SECTIONS.map((item) => ({
      key: item.key,
      title: item.title,
      order: 0,
      status: 'queued',
      summary: getSectionSummary(result?.[item.key as keyof AnalysisResult] as string | undefined),
      content: result?.[item.key as keyof AnalysisResult] as string | undefined ?? '',
    }))
  const degraded = result?.status === 'degraded' || result?.data_quality === 'degraded'

  const workflowSteps: WorkflowGuideStep[] = [
    { label: 'STEP 1', title: '先输入议题', description: '输入要追踪的地区、政策或冲突议题，系统会立即发起并行研判。', status: activeQuery ? 'done' : 'active' as const },
    { label: 'STEP 2', title: '看多路结果依次到达', description: '搜索、媒体、洞察三条流会分段返回，不需要等所有内容一次性生成。', status: result?.status === 'running' || result?.status === 'assembling' ? 'active' : result?.status === 'completed' || result?.status === 'degraded' ? 'done' : 'pending' as const },
    { label: 'STEP 3', title: '启动未来预测', description: '综合结论稳定后，直接把摘要与预测任务带入未来推演工作台。', status: result?.status === 'completed' || result?.status === 'degraded' ? 'active' : 'pending' as const },
  ]

  const isAnalysisRunning = result?.status === 'running' || result?.status === 'assembling'

  useEffect(() => {
    if (query === storedDraftQuery) return
    setDraftQuery(query)
  }, [query, setDraftQuery, storedDraftQuery])

  useEffect(() => {
    if (!result?.task_id || result.task_id.startsWith('pending-') || result.task_id.startsWith('failed-') || result.status === 'completed' || result.status === 'failed' || result.status === 'degraded') return
    let cancelled = false
    const poll = async () => {
      while (!cancelled) {
        await new Promise((resolve) => setTimeout(resolve, 1500))
        try {
          const res = await fetch(`/api/analysis/${result.task_id}`)
          if (!res.ok) break
          const data: AnalysisResult = await res.json()
          if (cancelled) break
          setResult(data)
          if (data.status === 'completed' || data.status === 'failed' || data.status === 'degraded') break
        } catch {
          break
        }
      }
    }
    poll()
    return () => { cancelled = true }
  }, [result?.task_id, result?.status, setResult])

  useEffect(() => {
    if ((result?.status !== 'completed' && result?.status !== 'degraded') || !activeQuery) return
    const alreadyInjected = injectedSignals.some((signal) => signal.id === `analysis-${result.task_id}`)
    if (alreadyInjected) return
    const coords = extractSignalCoords(activeQuery)
    injectSignal({
      id: `analysis-${result.task_id}`,
      type: 'diplomatic',
      lat: coords?.lat,
      lon: coords?.lon,
      intensity: 0.9,
      timestamp: new Date().toISOString(),
      description: `议题研判：${activeQuery}`,
      source: 'analysis',
      query: activeQuery,
    })
  }, [activeQuery, injectSignal, injectedSignals, result?.status, result?.task_id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const nextQuery = query.trim()
    if (!nextQuery) return
    setLoading(true)
    setError(null)
    const pendingTimestamp = Date.now()
    setResult({
      task_id: `pending-${pendingTimestamp}`,
      query: nextQuery,
      status: 'running',
      progress: 2,
      data_quality: 'unknown',
      query_report: '',
      media_report: '',
      insight_report: '',
      final_report: '',
      html_report: '',
      ui_message: '议题已提交，正在创建多代理并行任务。',
      agent_status: { query: 'queued', media: 'queued', insight: 'queued', report: 'queued' },
      agent_metrics: {
        query: { key: 'query', label: '搜索代理体', status: 'queued', progress: 0, source_count: 0, summary: `正在为“${nextQuery}”锁定公开线索。`, fallback_used: false },
        media: { key: 'media', label: '媒体代理体', status: 'queued', progress: 0, source_count: 0, summary: '正在排队启动媒体任务。', fallback_used: false },
        insight: { key: 'insight', label: '洞察代理体', status: 'queued', progress: 0, source_count: 0, summary: '正在排队启动洞察任务。', fallback_used: false },
        report: { key: 'report', label: '综合报告', status: 'queued', progress: 0, source_count: 0, summary: '等待三路结果汇总。', fallback_used: false },
      },
      sections: REPORT_SECTIONS.map((section, index) => ({
        key: section.key,
        title: section.title,
        order: index + 1,
        status: 'queued',
        summary: index === 0 ? `正在为“${nextQuery}”锁定公开线索。` : '等待前序结果到达后继续输出。',
        content: '',
      })),
      timeline: [{
        key: `pending-${pendingTimestamp}`,
        stage: 'queued',
        title: '议题已提交',
        detail: `“${nextQuery}”已送出，系统正在建立搜索、媒体、洞察三路并行任务。`,
        status: 'running',
        created_at: new Date().toISOString(),
      }],
      last_update_at: new Date().toISOString(),
    })
    try {
      const res = await fetch('/api/analysis/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: nextQuery }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail ?? '分析请求失败')
      }
      const data: AnalysisResult = await res.json()
      setResult({ ...data, query: data.query ?? nextQuery })
    } catch (err) {
      setResult({
        task_id: `failed-${Date.now()}`,
        query: nextQuery,
        status: 'failed',
        progress: 0,
        error: err instanceof Error ? err.message : '未知错误',
        ui_message: '议题提交失败，请检查服务后重试。',
        timeline: [{
          key: `failed-${Date.now()}`,
          stage: 'failed',
          title: '议题提交失败',
          detail: err instanceof Error ? err.message : '未知错误',
          status: 'failed',
          created_at: new Date().toISOString(),
        }],
        last_update_at: new Date().toISOString(),
      })
      setError(err instanceof Error ? err.message : '未知错误')
    } finally {
      setLoading(false)
    }
  }

  const handleSendToSimulation = () => {
    const topic = activeQuery || '议题预测'
    const seed = result?.final_report?.trim() || result?.query_report?.trim() || stripHtml(result?.html_report) || topic
    const defaultDigest = pickDefaultDigest(result)
    setSimulationDraft({
      name: `${topic} 未来预测`,
      seed_content: seed,
      simulation_requirement: `请基于以下研判内容，构建关键参与方关系图谱，并预测未来72小时内的事件演化、舆论波动与行动链路：${topic}`,
      max_rounds: 48,
      source: 'analysis',
      source_task_id: result?.task_id,
      graph_context: {
        graph_id: result?.graph_id ?? undefined,
        graph_source_mode: result?.graph_source_mode ?? undefined,
        graph_queries: result?.graph_queries ?? [],
        graph_facts: result?.graph_facts ?? [],
        analysis_stage: currentStage,
        analysis_quality: qualityTone.text,
        analysis_summary: result?.ui_message ?? result?.degraded_reason ?? getSectionSummary(result?.final_report ?? result?.query_report ?? ''),
        news_digest: result?.news_digest ?? [],
        selected_digest: defaultDigest,
        graph_edges: result?.graph_edges ?? [],
        graph_nodes: result?.graph_nodes ?? [],
      },
      country_context: activeCountryContext ?? undefined,
    })
    navigate('/simulation')
  }

  const currentProgress = result?.progress ?? 0
  const currentStage = result?.ui_message
    ?? (degraded
      ? '当前报告已先生成观察版，可继续查看重点结论'
      : result?.final_report ? '综合结论正在收口' : result?.insight_report ? '洞察结构已到达' : result?.media_report ? '媒体脉络已到达' : result?.query_report ? '搜索流已到达' : loading || isAnalysisRunning ? '多代理并行启动中' : '等待发起议题')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)', maxWidth: 1480 }}>
      <div className="page-header">
        <div>
          <div className="page-title">议题研判</div>
          <div className="page-subtitle">
            输入、处理中间态与分段结果现在在同一工作台里连续呈现。当前状态：
            <span style={{ color: 'var(--text-primary)', fontWeight: 700, marginLeft: 6 }}>{currentStage}</span>
          </div>
        </div>
        <div className="flex gap-3">
          <span className="badge badge-active"><span className="badge-dot" />分段输出</span>
          <span className="badge badge-normal"><span className="badge-dot" />多代理并行</span>
        </div>
      </div>

      <WorkflowGuide
        eyebrow="研判工作流"
        title="先锁定议题，再看结果一段一段长出来"
        description="这页不再等所有内容一次性出现。现在会先返回搜索流、再到媒体流、洞察流和综合结论，让输入、过程和结果始终贴在一起。"
        steps={workflowSteps}
        actions={(
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setQuery('台海局势升级后的舆论演化')}>使用演示议题</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={!result || (result.status !== 'completed' && result.status !== 'degraded')} onClick={handleSendToSimulation} style={{ opacity: !result || (result.status !== 'completed' && result.status !== 'degraded') ? 0.45 : 1 }}>
              启动未来预测
            </button>
          </>
        )}
      />

      <div style={{ display: 'grid', gridTemplateColumns: isCompact ? '1fr' : 'minmax(340px, 380px) minmax(0, 1fr)', gap: 'var(--sp-4)', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)', position: isCompact ? 'relative' : 'sticky', top: isCompact ? undefined : 12 }}>
          <div className="panel" style={{ overflow: 'hidden' }}>
            <div style={{ padding: 'var(--sp-5)', background: 'linear-gradient(135deg, rgba(37,99,235,0.06), rgba(124,58,237,0.04), rgba(22,163,74,0.03))', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.12em', marginBottom: 8 }}>研判工作台</div>
              <div style={{ fontSize: '1.12rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>输入议题后，结果就在右侧持续长出来</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>输入框、过程可视化和分析结果现在贴得更近。你可以边看分段输出，边观察关键词、情绪和覆盖情况如何随结果变化。</div>
            </div>
            <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
              {latestInjectedSignal ? (
                <div style={{
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid rgba(37,99,235,0.14)',
                  background: 'linear-gradient(135deg, rgba(37,99,235,0.06), rgba(255,255,255,0.96))',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', marginBottom: 4 }}>
                        来自全球观测的议题入口
                      </div>
                      <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                        {latestInjectedSignal.query || latestInjectedSignal.description || '已接收国家观察信号'}
                      </div>
                    </div>
                    <span className="badge badge-active">
                      <span className="badge-dot" />实时导入
                    </span>
                  </div>
                  <div style={{ marginTop: 8, fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    这条议题来自全球观测或总览工作台，已自动带入输入框。你可以直接继续研判，完成后再送入未来预测。
                  </div>
                </div>
              ) : null}
              {activeCountryContext ? (
                <CountryContextBrief context={activeCountryContext} latestHeadline={latestCountryHeadline} />
              ) : null}
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                <textarea value={query} onChange={(e) => setQuery(e.target.value)} placeholder="输入要研判的议题，例如：台海局势、中东冲突升级、对华技术限制进一步收紧……" rows={5} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', padding: '14px 16px', color: 'var(--text-primary)', resize: 'vertical', fontSize: '0.9rem', lineHeight: 1.7, outline: 'none' }} />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
                  {['俄乌冲突', '台海局势', '朝鲜半岛', '中东油价风险', '南海争端'].map((topic) => (
                    <button key={topic} type="button" className="btn btn-ghost btn-sm" onClick={() => setQuery(topic)}>{topic}</button>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', justifyContent: 'space-between' }}>
                  <button type="submit" className="btn btn-primary" disabled={loading || isAnalysisRunning || !query.trim()}>
                    {loading ? <><div className="spinner-sm" /> 已提交，正在接入阶段反馈...</> : isAnalysisRunning ? <><div className="spinner-sm" /> 研判进行中...</> : <><PlayIcon /> 启动议题研判</>}
                  </button>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>当前阶段: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{currentStage}</span></div>
                </div>
              </form>

              <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : isCompact ? 'repeat(2, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))', gap: 'var(--sp-3)' }}>
                <StageMetric label="整体进度" value={`${currentProgress}%`} color="#2563eb" />
                <StageMetric label="已到达板块" value={sectionRows.filter((section) => Boolean(section.content)).length} color="#7c3aed" />
                <StageMetric label="来源数" value={result?.source_count ?? keywordRows.length} color="#16a34a" />
              </div>

              <div style={{ padding: '12px 14px', borderRadius: 'var(--radius-sm)', border: `1px solid ${qualityTone.color}22`, background: `linear-gradient(135deg, ${qualityTone.color}10, rgba(255,255,255,0.96))` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 700, color: qualityTone.color }}>{qualityTone.text}</div>
                  {result?.last_update_at ? <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>最近更新 {new Date(result.last_update_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div> : null}
                </div>
                <div style={{ marginTop: 6, fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  {result?.degraded_reason || currentStage}
                </div>
                {result && result.status !== 'completed' && result.status !== 'failed' && (
                  <div style={{ marginTop: 8, fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    即使临时切换到别的页面，回来后也会继续显示当前议题的阶段进度与已到达内容。
                  </div>
                )}
              </div>

              <div style={{ height: 6, borderRadius: 999, overflow: 'hidden', background: 'var(--bg-overlay)' }}>
                <div style={{ width: `${currentProgress}%`, height: '100%', background: 'linear-gradient(90deg, #2563eb, #7c3aed, #16a34a)', borderRadius: 999, transition: 'width 0.4s ease' }} />
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--sp-4)' }}>
            <MiniBarChart title="关键词热度" rows={keywordRows.length > 0 ? keywordRows : [{ label: '等待内容', value: 1, color: '#94a3b8' }]} />
            <MiniBarChart title="情绪结构" rows={sentimentRows} />
          </div>

          <MiniBarChart title="三路覆盖情况" rows={coverageRows.map((row) => ({ ...row, value: Math.max(row.value, 0) }))} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--sp-3)' }}>
            {AGENTS.map((agent) => {
              const sectionKey = `${agent.key}_report` as keyof AnalysisResult
              const content = result?.[sectionKey]
              const metric = result?.agent_metrics?.[agent.key]
              const hasContent = Boolean(content)
              const running = !hasContent && Boolean(result && result.status !== 'failed' && result.status !== 'completed' && result.status !== 'degraded')
              const flowStatus = metric?.status === 'fallback'
                ? 'fallback'
                : hasContent
                  ? 'done'
                  : running
                    ? 'running'
                    : 'waiting'
              return (
                <FlowCard key={agent.key} title={agent.name} status={flowStatus} summary={metric?.summary || (result?.agent_status?.[agent.key] === 'fallback' ? '当前先展示观察摘要，等待更多真实素材补强。' : getSectionSummary(typeof content === 'string' ? content : undefined))} color={agent.color} metric={metric} />
              )
            })}
          </div>

          <TimelineCard events={timelineEvents} />

          {error && (
            <div className="panel" style={{ borderColor: '#dc2626' }}>
              <div className="panel-body" style={{ color: '#dc2626', fontSize: '0.82rem' }}>{error}</div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <div className="panel" style={{ overflow: 'hidden' }}>
            <div style={{ padding: 'var(--sp-5)', background: 'linear-gradient(135deg, rgba(15,23,42,0.02), rgba(37,99,235,0.06), rgba(124,58,237,0.05))', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.12em', marginBottom: 8 }}>研判主舞台</div>
                  <div style={{ fontSize: '1.08rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>主舞台只做一件事：让研判结果按时间顺序长出来</div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.75 }}>
                    左侧负责输入与监控当前阶段，右侧专注看搜索流、媒体流、洞察流和综合结论如何逐段到达，避免输入和结果被拆成两套视线。
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="badge badge-active"><span className="badge-dot" />{currentStage}</span>
                  <span className={`badge ${degraded ? 'badge-high' : 'badge-normal'}`}><span className="badge-dot" />{qualityTone.text}</span>
                  {(result?.status === 'completed' || result?.status === 'degraded') ? (
                    <button type="button" className="btn btn-primary btn-sm" onClick={handleSendToSimulation} style={{ opacity: degraded ? 0.88 : 1 }}>
                      {degraded ? '以观察版启动未来预测' : '启动未来预测'}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : 'repeat(3, minmax(0, 1fr))', gap: 'var(--sp-3)' }}>
              <StageMetric label="最新阶段" value={currentStage} color="#2563eb" />
              <StageMetric label="当前质量" value={qualityTone.text} color={qualityTone.color} />
              <StageMetric label="最近更新" value={result?.last_update_at ? new Date(result.last_update_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '等待中'} color="#7c3aed" />
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">结果流</span>
              <div className="flex gap-3" style={{ alignItems: 'center' }}>
                {result?.task_id && <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-muted)' }}>{result.task_id}</span>}
                <span className={`badge ${result?.status === 'completed' ? 'badge-done' : result?.status === 'degraded' ? 'badge-high' : result?.status === 'failed' ? 'badge-failed' : 'badge-active'}`}>
                  <span className="badge-dot" />
                  {result?.status === 'completed' ? '已完成' : result?.status === 'degraded' ? '观察版' : result?.status === 'failed' ? '失败' : result ? '输出中' : '待开始'}
                </span>
              </div>
            </div>
            <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--sp-4)' }}>
              {sectionRows.map((section, index) => {
                const content = section.content
                const priorDone = index === 0 ? true : Boolean(sectionRows[index - 1]?.content)
                const color = REPORT_SECTIONS.find((item) => item.title === section.title)?.color ?? '#2563eb'
                return (
                  <SectionStreamCard key={section.key} title={section.title} content={typeof content === 'string' ? content : undefined} color={color} active={Boolean(content) || (priorDone && result?.status !== 'failed' && result?.status !== 'completed' && result?.status !== 'degraded')} status={section.status} summary={section.summary} />
                )
              })}
            </div>
          </div>

          <ResultArrivalRail sections={sectionRows.map((section) => ({
            key: section.key,
            title: section.title,
            status: section.status,
            summary: section.summary,
            content: typeof section.content === 'string' ? section.content : undefined,
          }))} />

          <StagePulse events={timelineEvents} />

          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">综合报告版面</span>
              {(result?.status === 'completed' || result?.status === 'degraded') && (
                <button type="button" className="btn btn-primary btn-sm" onClick={handleSendToSimulation} style={{ opacity: degraded ? 0.82 : 1 }}>
                  {degraded ? '以观察版启动未来预测' : '启动未来预测'}
                </button>
              )}
            </div>
            <div className="panel-body">
              {activeCountryContext ? (
                <div style={{
                  marginBottom: 'var(--sp-4)',
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid rgba(37,99,235,0.14)',
                  background: 'linear-gradient(135deg, rgba(37,99,235,0.06), rgba(255,255,255,0.96))',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', marginBottom: 4 }}>
                        国家观察包
                      </div>
                      <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                        {activeCountryContext.country_name} · CII {activeCountryContext.score.toFixed(1)} · 新闻 {activeCountryContext.news_count} · 信号 {activeCountryContext.signal_count}
                      </div>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {activeCountryContext.latest_activity ? `最近活动 ${activeCountryContext.latest_activity}` : '等待更多同步'}
                    </div>
                  </div>
                  {activeCountryContext.narrative ? (
                    <div style={{ marginTop: 8, fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                      {activeCountryContext.narrative}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {degraded ? (
                <div style={{
                  marginBottom: 'var(--sp-4)',
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid rgba(217,119,6,0.22)',
                  background: 'linear-gradient(135deg, rgba(217,119,6,0.08), rgba(255,255,255,0.98))',
                  color: '#8a4b02',
                  fontSize: '0.78rem',
                  lineHeight: 1.7,
                }}>
                  {result?.degraded_reason || '当前报告已先基于监控摘要与结构化线索生成观察版，适合继续查看重点结论、补充素材并进入未来预测。'}
                </div>
              ) : null}
              {result?.news_digest?.length ? (
                <div style={{ marginBottom: 'var(--sp-4)', display: 'grid', gap: 'var(--sp-2)' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}>实时新闻摘录</div>
                  {result.news_digest.slice(0, 3).map((item) => (
                    <div key={`${item.title}-${item.published_at}`} style={{ padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'rgba(255,255,255,0.9)' }}>
                      <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.78rem', marginBottom: 4 }}>{item.title}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4 }}>{item.country} · {item.source} · {item.published_at}</div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>{item.summary}</div>
                    </div>
                  ))}
                </div>
              ) : null}
              {result?.status === 'failed' ? (
                <div style={{ color: '#dc2626', fontSize: '0.84rem' }}>{result.error ?? '分析失败，请重试。'}</div>
              ) : result?.html_report ? (
                <div className="report-body" style={{ maxHeight: 780, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.98)', padding: 'var(--sp-5)' }} dangerouslySetInnerHTML={{ __html: result.html_report }} />
              ) : (
                <div style={{ minHeight: 220, border: '1px dashed var(--border)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 'var(--sp-3)', color: 'var(--text-muted)' }}>
                  <div className="spinner" style={{ width: 24, height: 24, opacity: result ? 1 : 0.3 }} />
                  <div style={{ fontSize: '0.82rem' }}>{result ? '综合报告仍在收口，板块结果会先在上方持续到达。' : '发起一个议题后，这里会出现完整报告版面。'}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function PlayIcon() {
  return <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><polygon points="4,2 14,8 4,14" /></svg>
}

const analysisPageCSS = `
  .analysis-stream-markdown h1,
  .analysis-stream-markdown h2,
  .analysis-stream-markdown h3 {
    margin: 0 0 10px;
    color: #102a56;
    line-height: 1.45;
  }
  .analysis-stream-markdown h1 { font-size: 1rem; }
  .analysis-stream-markdown h2 { font-size: 0.94rem; }
  .analysis-stream-markdown h3 { font-size: 0.88rem; }
  .analysis-stream-markdown p {
    margin: 0 0 10px;
    color: #334e68;
    line-height: 1.8;
  }
  .analysis-stream-markdown ul,
  .analysis-stream-markdown ol {
    margin: 0 0 10px 18px;
    color: #334e68;
  }
  .analysis-stream-markdown li {
    margin-bottom: 6px;
    line-height: 1.7;
  }
  .report-body {
    color: #1f3651;
  }
  .report-body h1,
  .report-body h2,
  .report-body h3,
  .report-body h4 {
    color: #102a56 !important;
  }
  .report-body p,
  .report-body li,
  .report-body div,
  .report-body span {
    color: inherit;
  }
`

if (typeof document !== 'undefined') {
  const styleId = 'orcafish-analysis-render-styles'
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = analysisPageCSS
    document.head.appendChild(style)
  }
}
