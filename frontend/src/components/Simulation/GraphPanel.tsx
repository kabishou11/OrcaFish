import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'

// ── Types ────────────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string
  name: string
  type: string
  labels?: string[]
  rawData?: Record<string, unknown>
  // D3 simulation fields
  x?: number; y?: number; fx?: number | null; fy?: number | null
}

interface GraphEdge {
  source: string | GraphNode
  target: string | GraphNode
  uuid?: string
  type?: string
  name?: string
  label?: string
  fact_type?: string
  labels?: string[]
  source_node_uuid?: string
  target_node_uuid?: string
  fact?: string
  episodes?: string[]
  created_at?: string
  // D3 computed
  isSelfLoop?: boolean
  curvature?: number
  pairIndex?: number
  pairTotal?: number
  rawData?: Record<string, unknown>
}

interface EntityType { name: string; count: number; color: string }
interface SelectedItem {
  type: 'node' | 'edge'
  data: Record<string, unknown>
  entityType?: string
  color?: string
}

interface RelationInspectorItem {
  id: string
  direction: 'incoming' | 'outgoing'
  sourceId: string
  targetId: string
  sourceName: string
  targetName: string
  relation: string
  relationType: string
  fact: string
  color: string
  edgeData: Record<string, unknown>
}

interface GraphPanelProps {
  graphData?: { nodes: GraphNode[]; edges: GraphEdge[] }
  loading?: boolean
  onRefresh?: () => void
  isSimulating?: boolean
  onToggleMaximize?: () => void
  isFullscreen?: boolean
}

function EmptyGraphState({
  loading,
  isSimulating,
  onRefresh,
}: {
  loading: boolean
  isSimulating: boolean
  onRefresh?: () => void
}) {
  const title = loading
    ? '未来关系图谱加载中'
    : isSimulating
      ? '预测进行中，图谱正在逐步成形'
      : '当前还没有可展示的关系图谱'
  const description = loading
    ? '正在拉取最新节点与关系，请稍候。'
    : isSimulating
      ? '行动流已启动后，议题、平台、代理体与动作会陆续映射到图谱中。'
      : '请先创建并启动一次推演，或点击刷新重新拉取图谱数据。'

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 14,
        padding: '0 24px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          border: loading ? '3px solid #dbe7f3' : '1px solid #dbe7f3',
          borderTopColor: loading ? '#7B2D8E' : '#dbe7f3',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#7B2D8E',
          background: '#f8fbff',
          animation: loading ? 'spin 1s linear infinite' : 'none',
          fontSize: 24,
          fontWeight: 700,
        }}
      >
        {loading ? '' : '✦'}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 360 }}>
        <div style={{ color: '#0f172a', fontSize: 15, fontWeight: 700 }}>{title}</div>
        <div style={{ color: '#64748b', fontSize: 13, lineHeight: 1.6 }}>{description}</div>
      </div>
      {!loading && onRefresh ? (
        <button onClick={onRefresh} style={toolBtnStyle(false)}>
          <span style={{ fontSize: 14 }}>↻</span>
          <span style={{ fontSize: 12 }}>重新拉取图谱</span>
        </button>
      ) : null}
    </div>
  )
}

// ── Color palette for entity types ─────────────────────────────────────────────
const ENTITY_COLORS = [
  '#FF6B35', '#004E89', '#7B2D8E', '#1A936F', '#C5283D',
  '#E9724C', '#3498db', '#9b59b6', '#27ae60', '#f39c12',
]

const NODE_TYPE_LABELS: Record<string, string> = {
  Event: '议题',
  Episode: '证据片段',
  Goal: '预测目标',
  Actor: '关键参与方',
  Region: '重点地区',
  Concept: '关键话题',
  Platform: '传播平台',
  Agent: '观察角色',
  Action: '最新动作',
  Entity: '实体',
}

const EDGE_TYPE_LABELS: Record<string, string> = {
  focuses_on: '指向预测目标',
  spreads_on: '在此平台发酵',
  relates_to: '关联核心实体',
  appears_on: '平台高频出现',
  observes: '持续关注议题',
  active_on: '活跃于平台',
  interacts_with: '发生互动',
  discusses: '围绕其发言',
  initiates: '发起动作',
  published_on: '发布到平台',
  targets: '作用于对象',
  references: '提及实体',
  contributes_to: '推动路径演化',
  stance_similarity: '预测立场接近',
  co_occurs_with: '共同卷入议题',
  drives: '驱动议题热度',
  responds_to: '回应对方动作',
  amplifies: '放大该话题',
  signals: '释放风险信号',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDateTime(dateStr: string): string {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    })
  } catch { return dateStr }
}

function getNodeLabel(node: GraphNode): string {
  const n = node.name || 'Unnamed'
  return n.length > 16 ? n.slice(0, 16) + '…' : n
}

function getNodeType(node: GraphNode): string {
  return node.labels?.find(l => l !== 'Entity') || node.type || 'Entity'
}

function getLaneX(type: string, width: number): number {
  if (type === 'Event' || type === 'Goal') return width * 0.12
  if (type === 'Episode') return width * 0.28
  if (type === 'Actor' || type === 'Region' || type === 'Concept') return width * 0.46
  if (type === 'Platform') return width * 0.63
  if (type === 'Agent') return width * 0.79
  if (type === 'Action') return width * 0.92
  return width * 0.5
}

function getLaneY(index: number, total: number, height: number): number {
  const usable = Math.max(height - 140, 120)
  const step = usable / Math.max(total, 1)
  return 90 + step * index + step / 2
}

function getEdgeLabel(edge: GraphEdge): string {
  const raw = String(edge.rawData?.type || edge.fact_type || edge.name || edge.rawData?.label || 'RELATED')
  return EDGE_TYPE_LABELS[raw] || edge.name || edge.fact_type || (edge.rawData?.label as string) || '关联'
}

function getEdgeColor(edge: GraphEdge): string {
  const type = ((edge.rawData?.type as string) || edge.fact_type || edge.name || '').toLowerCase()
  if (type.includes('interacts') || type.includes('mention') || type.includes('targets')) return '#2563eb'
  if (type.includes('respond')) return '#0284c7'
  if (type.includes('similarity') || type.includes('stance')) return '#7c3aed'
  if (type.includes('focus') || type.includes('relates') || type.includes('observe') || type.includes('drives')) return '#f97316'
  if (type.includes('active') || type.includes('appear') || type.includes('spread') || type.includes('amplif')) return '#16a34a'
  if (type.includes('signal')) return '#dc2626'
  if (type.includes('initiate') || type.includes('publish') || type.includes('reference')) return '#0f766e'
  return '#64748b'
}

function getNodeTypeLabel(type: string): string {
  return NODE_TYPE_LABELS[type] || type || '实体'
}

function getNodeRadius(type: string): number {
  if (type === 'Event') return 16
  if (type === 'Platform') return 13
  if (type === 'Episode') return 10
  if (type === 'Action') return 8
  return 11
}

function formatRelationSentence(data: Record<string, unknown>): string {
  const source = String(data.source_name || '').trim() || '未知节点'
  const target = String(data.target_name || '').trim() || '未知节点'
  const relationKey = String(data.type || data.fact_type || data.name || '')
  const relation = EDGE_TYPE_LABELS[relationKey] || String(data.name || data.label || '关联')
  return `${source} → ${relation} → ${target}`
}

function formatPropertyValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '暂无'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2)
  if (Array.isArray(value)) return value.map(item => formatPropertyValue(item)).join('、')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function getEpisodeReferenceTokens(node: GraphNode): string[] {
  const rawData = (node.rawData || {}) as Record<string, unknown>
  const attributes = (rawData.attributes || {}) as Record<string, unknown>
  const summary = String(rawData.summary || attributes.summary || '').trim()
  const sourceDescription = String(attributes.source_description || '').trim()
  const contentPreview = String(attributes.content_preview || '').trim()
  return [node.id, node.name, summary, sourceDescription, contentPreview]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
}

function matchEpisodeNode(node: GraphNode, refs: string[]): boolean {
  if (getNodeType(node) !== 'Episode' || refs.length === 0) return false
  const tokens = getEpisodeReferenceTokens(node)
  return refs.some((ref) => tokens.some((token) => token === ref || token.includes(ref) || ref.includes(token)))
}

// ── Path helpers ────────────────────────────────────────────────────────────────

function getLinkPath(d: GraphEdge & { source: GraphNode; target: GraphNode }): string {
  const sx = d.source.x ?? 0, sy = d.source.y ?? 0
  const tx = d.target.x ?? 0, ty = d.target.y ?? 0

  if (d.isSelfLoop) {
    // Self-loop: draw a small arc
    const loopRadius = 28
    const x1 = sx + 10, y1 = sy - 5
    const x2 = sx + 10, y2 = sy + 5
    return `M${x1},${y1} A${loopRadius},${loopRadius} 0 1,1 ${x2},${y2}`
  }
  if (!d.curvature || d.curvature === 0) return `M${sx},${sy} L${tx},${ty}`

  const dx = tx - sx, dy = ty - sy
  const dist = Math.sqrt(dx * dx + dy * dy) || 1
  const pairTotal = d.pairTotal || 1
  const offsetRatio = 0.25 + pairTotal * 0.05
  const baseOffset = Math.max(35, dist * offsetRatio)
  const offsetX = (-dy / dist) * d.curvature * baseOffset
  const offsetY = (dx / dist) * d.curvature * baseOffset
  const cx = (sx + tx) / 2 + offsetX
  const cy = (sy + ty) / 2 + offsetY
  return `M${sx},${sy} Q${cx},${cy} ${tx},${ty}`
}

function getLinkMidpoint(d: GraphEdge & { source: GraphNode; target: GraphNode }) {
  const sx = d.source.x ?? 0, sy = d.source.y ?? 0
  const tx = d.target.x ?? 0, ty = d.target.y ?? 0

  if (d.isSelfLoop) return { x: sx + 70, y: sy }

  if (!d.curvature || d.curvature === 0) return { x: (sx + tx) / 2, y: (sy + ty) / 2 }

  const dx = tx - sx, dy = ty - sy
  const dist = Math.sqrt(dx * dx + dy * dy) || 1
  const pairTotal = d.pairTotal || 1
  const offsetRatio = 0.25 + pairTotal * 0.05
  const baseOffset = Math.max(35, dist * offsetRatio)
  const offsetX = (-dy / dist) * d.curvature! * baseOffset
  const offsetY = (dx / dist) * d.curvature! * baseOffset
  const cx = (sx + tx) / 2 + offsetX
  const cy = (sy + ty) / 2 + offsetY

  // Quadratic bezier midpoint
  return {
    x: 0.25 * sx + 0.5 * cx + 0.25 * tx,
    y: 0.25 * sy + 0.5 * cy + 0.25 * ty,
  }
}

// ── Self-loop detail panel content ─────────────────────────────────────────────

function SelfLoopContent({ edge }: { edge: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const selfLoops = (edge.selfLoopEdges as Array<Record<string, unknown>>) || []

  return (
    <div style={{ padding: 16, overflowY: 'auto' as const, flex: 1 }}>
      <div style={{
        background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 12px',
        marginBottom: 16, fontSize: 13, fontWeight: 500, color: '#166534', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        {String(edge.source_name)} · 自关联关系
        <span style={{ fontSize: 11, color: '#6b7280', background: '#fff', padding: '2px 8px', borderRadius: 10 }}>
          {selfLoops.length} 条
        </span>
      </div>
      {selfLoops.map((loop, idx) => {
        const isOpen = expanded.has(idx)
        return (
          <div key={idx} style={{ marginBottom: 8, border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
            <div
              onClick={() => {
                const next = new Set(expanded)
                next.has(idx) ? next.delete(idx) : next.add(idx)
                setExpanded(next)
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                background: isOpen ? '#f3f4f6' : '#f9fafb', cursor: 'pointer', fontSize: 12,
              }}
            >
              <span style={{ fontSize: 10, fontWeight: 600, color: '#9ca3af', background: '#e5e7eb', padding: '1px 5px', borderRadius: 4 }}>
                #{idx + 1}
              </span>
              <span style={{ flex: 1, color: '#374151', fontWeight: 500 }}>
                {EDGE_TYPE_LABELS[String(loop.fact_type || loop.name || '')] || String(loop.fact_type || loop.name || '关联')}
              </span>
              <span style={{ fontSize: 14, color: '#9ca3af' }}>{isOpen ? '−' : '+'}</span>
            </div>
            {isOpen && (
              <div style={{ padding: 12, borderTop: '1px solid #e5e7eb', fontSize: 12 }}>
                {loop.fact ? <DetailRow label="关系说明" value={String(loop.fact)} /> : null}
                {loop.fact_type ? <DetailRow label="关系类型" value={EDGE_TYPE_LABELS[String(loop.fact_type)] || String(loop.fact_type)} /> : null}
                {loop.created_at ? <DetailRow label="产生时间" value={formatDateTime(String(loop.created_at))} /> : null}
                {(loop.episodes as string[])?.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6, fontWeight: 600, letterSpacing: '0.05em' }}>关联片段</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
                      {(loop.episodes as string[]).map((ep, ei) => (
                        <span key={ei} style={{ fontSize: 10, padding: '3px 8px', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 6, color: '#6b7280', fontFamily: 'monospace' }}>{ep}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Detail row helper ─────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 8, fontSize: 12 }}>
      <span style={{ color: '#9ca3af', minWidth: 80, fontWeight: 500 }}>{label}:</span>
      <span style={{ color: '#374151', wordBreak: 'break-all' }}>{value}</span>
    </div>
  )
}

// ── Main GraphPanel Component ──────────────────────────────────────────────────

export default function GraphPanel({
  graphData,
  loading = false,
  onRefresh,
  isSimulating = false,
  onToggleMaximize,
  isFullscreen = false,
}: GraphPanelProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const simRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null)

  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null)
  const [showEdgeLabels, setShowEdgeLabels] = useState(true)
  const [relationFilter, setRelationFilter] = useState<'all' | string>('all')
  const [focusCurrentPath, setFocusCurrentPath] = useState(false)
  const [entityTypes, setEntityTypes] = useState<EntityType[]>([])
  const [showFinishedHint, setShowFinishedHint] = useState(false)
  const [wasSimulating, setWasSimulating] = useState(false)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linkLabelRef = useRef<d3.Selection<SVGTextElement, any, SVGGElement, unknown> | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linkLabelBgRef = useRef<d3.Selection<SVGRectElement, any, SVGGElement, unknown> | null>(null)
  const linkGroupRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null)

  // Detect simulation end
  useEffect(() => {
    if (wasSimulating && !isSimulating) setShowFinishedHint(true)
    setWasSimulating(isSimulating)
  }, [isSimulating, wasSimulating])

  // Compute entity types for legend
  useEffect(() => {
    if (!graphData?.nodes) { setEntityTypes([]); return }
    const typeMap: Record<string, EntityType> = {}
    graphData.nodes.forEach((node) => {
      const type = getNodeType(node)
      if (!typeMap[type]) {
        typeMap[type] = { name: type, count: 0, color: ENTITY_COLORS[Object.keys(typeMap).length % ENTITY_COLORS.length] }
      }
      typeMap[type].count++
    })
    setEntityTypes(Object.values(typeMap))
  }, [graphData])

  const availableRelationTypes = useMemo(() => {
    const buckets = new Map<string, number>()
    for (const edge of graphData?.edges ?? []) {
      const type = String((edge.rawData?.type as string) || edge.type || edge.fact_type || edge.name || edge.label || '关联')
      buckets.set(type, (buckets.get(type) ?? 0) + 1)
    }
    return Array.from(buckets.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({
        type,
        count,
        label: EDGE_TYPE_LABELS[type] || type || '关联',
      }))
  }, [graphData])

  useEffect(() => {
    if (relationFilter === 'all') return
    if (!availableRelationTypes.some((item) => item.type === relationFilter)) {
      setRelationFilter('all')
    }
  }, [availableRelationTypes, relationFilter])

  // Render graph
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || !graphData?.nodes?.length) return

    // Stop previous simulation
    if (simRef.current) { simRef.current.stop(); simRef.current = null }

    const container = containerRef.current
    const width = container.clientWidth || 600
    const height = container.clientHeight || 400

    const svg = d3.select(svgRef.current)
      .attr('width', width).attr('height', height)

    svg.selectAll('*').remove()

    const nodesData = graphData.nodes || []
    const edgesData = graphData.edges || []
    const nodeMap: Record<string, GraphNode> = {}
    nodesData.forEach(n => { nodeMap[n.id] = n })

    // Build nodes
    const nodes: GraphNode[] = nodesData.map(n => ({ ...n }))
    const nodeIds = new Set(nodes.map(n => n.id))
    const laneGroups = new Map<string, GraphNode[]>()
    nodes.forEach((node) => {
      const type = getNodeType(node)
      const list = laneGroups.get(type) ?? []
      list.push(node)
      laneGroups.set(type, list)
    })
    laneGroups.forEach((group, type) => {
      group.forEach((node, index) => {
        node.x = getLaneX(type, width)
        node.y = getLaneY(index, group.length, height)
      })
    })

    // Build edges with pair counting + self-loop grouping
    const edgePairCount: Record<string, number> = {}
    const selfLoopMap: Record<string, GraphEdge[]> = {}
    const selectedNodeId = selectedItem?.type === 'node' ? String(selectedItem.data?.id || '') : ''
    const tempEdges = edgesData.filter((e: GraphEdge) => {
      const sid = String(e.source), tid = String(e.target)
      const relationType = String((e.rawData?.type as string) || e.type || e.fact_type || e.name || e.label || '关联')
      if (!nodeIds.has(sid) || !nodeIds.has(tid)) return false
      if (relationFilter !== 'all' && relationType !== relationFilter) return false
      if (focusCurrentPath && selectedNodeId) return sid === selectedNodeId || tid === selectedNodeId
      return true
    })

    tempEdges.forEach(e => {
      const sid = String(e.source), tid = String(e.target)
      if (sid === tid) {
        if (!selfLoopMap[sid]) selfLoopMap[sid] = []
        selfLoopMap[sid].push(e)
      } else {
        const key = [sid, tid].sort().join('_')
        edgePairCount[key] = (edgePairCount[key] || 0) + 1
      }
    })

    const pairIndex: Record<string, number> = {}
    const processedSelfLoops = new Set<string>()

    const edges: (GraphEdge & { source: GraphNode; target: GraphNode })[] = []
    tempEdges.forEach((e: GraphEdge) => {
      const sid = String(e.source), tid = String(e.target)
      if (sid === tid) {
        if (processedSelfLoops.has(sid)) return
        processedSelfLoops.add(sid)
        const loops = selfLoopMap[sid] || []
        edges.push({
          ...e, source: nodeMap[sid], target: nodeMap[sid],
          isSelfLoop: true, curvature: 0,
          rawData: {
            isSelfLoopGroup: true,
            source_name: nodeMap[sid]?.name,
            selfLoopCount: loops.length,
            selfLoopEdges: loops.map(l => ({ ...l, source_name: nodeMap[sid]?.name })),
          },
        })
        return
      }
      const key = [sid, tid].sort().join('_')
      if (!(key in pairIndex)) pairIndex[key] = 0
      const idx = pairIndex[key]++
      const total = edgePairCount[key]
      const reversed = sid > tid
      let curvature = 0
      if (total > 1) {
        const range = Math.min(1.2, 0.6 + total * 0.15)
        curvature = ((idx / (total - 1)) * 2 * range - range)
        if (reversed) curvature = -curvature
      }
      edges.push({
        ...e, source: nodeMap[sid], target: nodeMap[tid],
        curvature, isSelfLoop: false, pairIndex: idx, pairTotal: total,
        rawData: {
          ...e,
          source_name: nodeMap[sid]?.name,
          target_name: nodeMap[tid]?.name,
          label: (e as any).label || e.name || e.fact_type || 'RELATED',
          type: (e as any).type || e.fact_type || e.name || 'RELATED',
          weight: (e as any).weight,
        },
      })
    })

    const colorMap: Record<string, string> = {}
    entityTypes.forEach(t => { colorMap[t.name] = t.color })
    const getColor = (type: string) => colorMap[type] || '#999'

    // D3 simulation
    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges).id((d: any) => d.id).distance(d => {
        const edgeType = ((d as any).rawData?.type as string) || ''
        const base = edgeType.includes('initiates') ? 110 : edgeType.includes('references') ? 90 : 150
        const cnt = (d as any).pairTotal || 1
        return base + (cnt - 1) * 50
      }))
      .force('charge', d3.forceManyBody().strength(d => {
        const type = getNodeType(d as GraphNode)
        if (type === 'Action') return -120
        if (type === 'Episode') return -170
        return -260
      }))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide(d => {
        const type = getNodeType(d as GraphNode)
        if (type === 'Action') return 30
        if (type === 'Episode') return 34
        return 44
      }))
      .force('x', d3.forceX(d => getLaneX(getNodeType(d as GraphNode), width)).strength(0.28))
      .force('y', d3.forceY((d, i) => {
        const type = getNodeType(d as GraphNode)
        const group = laneGroups.get(type) ?? []
        const index = Math.max(group.findIndex(node => node.id === (d as GraphNode).id), i)
        return getLaneY(index, group.length || 1, height)
      }).strength(0.22))
    simRef.current = simulation

    const g = svg.append('g')

    const laneSpecs = [
      { label: '议题层', x: 0.02, width: 0.18, color: 'rgba(37,99,235,0.05)' },
      { label: '证据层', x: 0.20, width: 0.16, color: 'rgba(14,165,233,0.05)' },
      { label: '实体层', x: 0.36, width: 0.20, color: 'rgba(249,115,22,0.05)' },
      { label: '平台层', x: 0.56, width: 0.14, color: 'rgba(22,163,74,0.05)' },
      { label: '观察角色层', x: 0.70, width: 0.18, color: 'rgba(124,58,237,0.05)' },
      { label: '动作层', x: 0.88, width: 0.10, color: 'rgba(15,118,110,0.05)' },
    ]

    const laneLayer = g.append('g')
    laneSpecs.forEach((lane) => {
      laneLayer.append('rect')
        .attr('x', width * lane.x)
        .attr('y', 62)
        .attr('width', width * lane.width)
        .attr('height', Math.max(height - 110, 120))
        .attr('rx', 18)
        .attr('fill', lane.color)
        .attr('stroke', 'rgba(148,163,184,0.12)')
        .attr('stroke-width', 1)
      laneLayer.append('text')
        .attr('x', width * lane.x + 14)
        .attr('y', 84)
        .attr('fill', '#64748b')
        .attr('font-size', 11)
        .attr('font-weight', 700)
        .attr('font-family', 'IBM Plex Mono, monospace')
        .text(lane.label)
    })

    // Zoom
    svg.call(d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => g.attr('transform', event.transform as any)))

    linkGroupRef.current = g.append('g')

    // Links
    const defs = svg.append('defs')
    defs.append('marker')
      .attr('id', 'graph-arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 24)
      .attr('refY', 0)
      .attr('markerWidth', 9)
      .attr('markerHeight', 9)
      .attr('orient', 'auto')
      .append('path')
      .attr('fill', '#64748b')
      .attr('d', 'M0,-5L10,0L0,5')

    const link = linkGroupRef.current.selectAll<SVGPathElement, GraphEdge>('path')
      .data(edges).join('path')
      .attr('stroke', d => getEdgeColor(d)).attr('stroke-width', d => Math.max(2.8, (((d.rawData?.weight as number) ?? 1)) * 3.2))
      .attr('stroke-opacity', 0.98)
      .attr('fill', 'none').style('cursor', 'pointer')
      .attr('marker-end', 'url(#graph-arrow)')
      .on('click', (event, d) => {
        event.stopPropagation()
        resetHighlight()
        const edgeEpisodeRefs = (((d.rawData?.episodes as string[] | undefined) ?? []) as string[])
          .map((item) => String(item || '').trim())
          .filter(Boolean)
        nodeEls.attr('opacity', (node) => {
          if (node.id === d.source.id || node.id === d.target.id) return 1
          return matchEpisodeNode(node, edgeEpisodeRefs) ? 1 : 0.18
        })
        nodeEls.attr('r', (node) => {
          const base = getNodeRadius(getNodeType(node))
          if (node.id === d.source.id || node.id === d.target.id) return base + 4
          return matchEpisodeNode(node, edgeEpisodeRefs) ? base + 5 : base
        })
        nodeLabels.attr('opacity', (node) => {
          if (node.id === d.source.id || node.id === d.target.id) return 1
          return matchEpisodeNode(node, edgeEpisodeRefs) ? 1 : 0.24
        })
        link.attr('stroke-opacity', (edge) => edge === d ? 1 : 0.12)
        d3.select(event.currentTarget as Element).attr('stroke', '#0f172a').attr('stroke-width', 3.2)
        nodeEls
          .filter(node => node.id === d.source.id || node.id === d.target.id)
          .attr('stroke', '#0f172a')
          .attr('stroke-width', 4)
        if (edgeEpisodeRefs.length > 0) {
          nodeEls
            .filter(node => matchEpisodeNode(node, edgeEpisodeRefs))
            .attr('stroke', '#0ea5e9')
            .attr('stroke-width', 4)
        }
        linkLabelBg?.attr('fill', 'rgba(255,255,255,0.95)')
        linkLabel?.attr('fill', '#666')
        setSelectedItem({ type: 'edge', data: d.rawData || {} })
      })

    // Link label backgrounds
    const linkLabelBg = linkGroupRef.current.selectAll<SVGRectElement, GraphEdge>('rect')
      .data(edges).join('rect')
      .attr('fill', 'rgba(255,255,255,0.95)').attr('rx', 5).attr('ry', 5)
      .style('cursor', 'pointer').style('pointer-events', 'all')
      .style('display', showEdgeLabels ? 'block' : 'none')
      .on('click', (event, d) => {
        event.stopPropagation()
        resetHighlight()
        const edgeEpisodeRefs = (((d.rawData?.episodes as string[] | undefined) ?? []) as string[])
          .map((item) => String(item || '').trim())
          .filter(Boolean)
        nodeEls.attr('opacity', (node) => {
          if (node.id === d.source.id || node.id === d.target.id) return 1
          return matchEpisodeNode(node, edgeEpisodeRefs) ? 1 : 0.18
        })
        nodeEls.attr('r', (node) => {
          const base = getNodeRadius(getNodeType(node))
          if (node.id === d.source.id || node.id === d.target.id) return base + 4
          return matchEpisodeNode(node, edgeEpisodeRefs) ? base + 5 : base
        })
        nodeLabels.attr('opacity', (node) => {
          if (node.id === d.source.id || node.id === d.target.id) return 1
          return matchEpisodeNode(node, edgeEpisodeRefs) ? 1 : 0.24
        })
        link.attr('stroke-opacity', (edge) => edge === d ? 1 : 0.12)
        d3.select(event.currentTarget as Element).attr('fill', 'rgba(52,152,219,0.1)')
        if (edgeEpisodeRefs.length > 0) {
          nodeEls
            .filter(node => matchEpisodeNode(node, edgeEpisodeRefs))
            .attr('stroke', '#0ea5e9')
            .attr('stroke-width', 4)
        }
        setSelectedItem({ type: 'edge', data: d.rawData || {} })
      })
    linkLabelBgRef.current = linkLabelBg as any

    // Link labels
    const linkLabel = linkGroupRef.current.selectAll<SVGTextElement, any>('text')
      .data(edges).join('text')
      .text(d => getEdgeLabel(d))
      .attr('font-size', 11).attr('fill', '#1f2937')
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
      .style('cursor', 'pointer').style('pointer-events', 'all')
      .style('display', showEdgeLabels ? 'block' : 'none')
      .style('font-family', 'system-ui, sans-serif')
      .on('click', (event, d) => {
        event.stopPropagation()
        resetHighlight()
        const edgeEpisodeRefs = (((d.rawData?.episodes as string[] | undefined) ?? []) as string[])
          .map((item) => String(item || '').trim())
          .filter(Boolean)
        nodeEls.attr('opacity', (node) => {
          if (node.id === d.source.id || node.id === d.target.id) return 1
          return matchEpisodeNode(node, edgeEpisodeRefs) ? 1 : 0.18
        })
        nodeEls.attr('r', (node) => {
          const base = getNodeRadius(getNodeType(node))
          if (node.id === d.source.id || node.id === d.target.id) return base + 4
          return matchEpisodeNode(node, edgeEpisodeRefs) ? base + 5 : base
        })
        nodeLabels.attr('opacity', (node) => {
          if (node.id === d.source.id || node.id === d.target.id) return 1
          return matchEpisodeNode(node, edgeEpisodeRefs) ? 1 : 0.24
        })
        link.attr('stroke-opacity', (edge) => edge === d ? 1 : 0.12)
        d3.select(event.currentTarget as Element).attr('fill', '#3498db')
        if (edgeEpisodeRefs.length > 0) {
          nodeEls
            .filter(node => matchEpisodeNode(node, edgeEpisodeRefs))
            .attr('stroke', '#0ea5e9')
            .attr('stroke-width', 4)
        }
        setSelectedItem({ type: 'edge', data: d.rawData || {} })
      })
    linkLabelRef.current = linkLabel as any

    // Nodes
    const nodeGroup = g.append('g')
    const nodeEls = nodeGroup.selectAll<SVGCircleElement, GraphNode>('circle')
      .data(nodes).join('circle')
      .attr('r', d => getNodeRadius(getNodeType(d)))
      .attr('fill', d => getColor(getNodeType(d)))
      .attr('stroke', '#fff').attr('stroke-width', 2.5)
      .style('cursor', 'pointer')
      .call(d3.drag<SVGCircleElement, GraphNode>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart()
          d.fx = d.x; d.fy = d.y
        })
        .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0)
          d.fx = null; d.fy = null
        }) as any
      )
      .on('click', (event, d) => {
        event.stopPropagation()
        resetHighlight()
        nodeEls.attr('opacity', (node) => (node.id === d.id ? 1 : 0.24))
        nodeEls.attr('r', (node) => {
          const base = getNodeRadius(getNodeType(node))
          return node.id === d.id ? base + 4 : base
        })
        nodeLabels.attr('opacity', (node) => (node.id === d.id ? 1 : 0.28))
        link.attr('stroke-opacity', (edge) => (edge.source.id === d.id || edge.target.id === d.id ? 0.98 : 0.12))
        d3.select(event.currentTarget as SVGCircleElement).attr('stroke', '#E91E63').attr('stroke-width', 4)
        link.filter(l => l.source.id === d.id || l.target.id === d.id)
          .attr('stroke', '#E91E63').attr('stroke-width', 2.5)
        setSelectedItem({
          type: 'node', data: d.rawData || d as unknown as Record<string, unknown>,
          entityType: getNodeType(d),
          color: getColor(getNodeType(d)),
        })
      })
      .on('mouseenter', (event, d) => {
        if (!selectedItem || (selectedItem.data as any)?.id !== d.id)
          d3.select(event.currentTarget as SVGCircleElement).attr('stroke-width', 3)
      })
      .on('mouseleave', (event, d) => {
        if (!selectedItem || (selectedItem.data as any)?.id !== d.id)
          d3.select(event.currentTarget as SVGCircleElement).attr('stroke-width', 2.5)
      })

    // Node labels
    const nodeLabels = nodeGroup.selectAll<SVGTextElement, GraphNode>('text')
      .data(nodes).join('text')
      .text(d => getNodeLabel(d))
      .attr('font-size', d => {
        const type = getNodeType(d)
        if (type === 'Action') return 10
        if (type === 'Episode') return 10
        return 11
      }).attr('fill', '#334155').attr('font-weight', d => getNodeType(d) === 'Action' ? '400' : '600')
      .attr('dx', d => {
        const type = getNodeType(d)
        if (type === 'Action') return 11
        if (type === 'Episode') return 13
        return 15
      }).attr('dy', 4)
      .style('pointer-events', 'none').style('font-family', 'system-ui, sans-serif')

    // Highlight reset helper
    function resetHighlight() {
      nodeEls.attr('stroke', '#fff').attr('stroke-width', 2.5)
      nodeEls.attr('r', (d) => getNodeRadius(getNodeType(d)))
      nodeEls.attr('opacity', 1)
      nodeLabels.attr('opacity', 1)
      link
        .attr('stroke', d => getEdgeColor(d))
        .attr('stroke-width', d => Math.max(2.8, (((d.rawData?.weight as number) ?? 1)) * 3.2))
        .attr('stroke-opacity', 0.98)
      linkLabelBg.attr('fill', 'rgba(255,255,255,0.95)')
      linkLabel.attr('fill', '#666')
    }

    // Click background to deselect
    svg.on('click', () => { setSelectedItem(null); resetHighlight() })

    // Tick
    simulation.on('tick', () => {
      link.attr('d', d => getLinkPath(d as any))
      linkLabel?.attr('x', d => getLinkMidpoint(d as any).x).attr('y', d => getLinkMidpoint(d as any).y)
      linkLabelBg?.each(function(d) {
        const mid = getLinkMidpoint(d as any)
        const textEl = (d3.select(this.parentNode as Element).select('text').node() as SVGTextElement)
        if (!textEl) return
        const bbox = textEl.getBBox()
        d3.select(this)
          .attr('x', mid.x - bbox.width / 2 - 4).attr('y', mid.y - bbox.height / 2 - 2)
          .attr('width', bbox.width + 8).attr('height', bbox.height + 4)
      })
      nodeEls.attr('cx', d => d.x ?? 0).attr('cy', d => d.y ?? 0)
      nodeLabels.attr('x', d => d.x ?? 0).attr('y', d => d.y ?? 0)
    })

    return () => { simulation.stop() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCurrentPath, graphData, entityTypes, relationFilter, selectedItem])

  // Toggle edge labels reactively
  useEffect(() => {
    linkLabelRef?.current?.style('display', showEdgeLabels ? 'block' : 'none')
    linkLabelBgRef?.current?.style('display', showEdgeLabels ? 'block' : 'none')
  }, [showEdgeLabels])

  // Resize
  useEffect(() => {
    const obs = new ResizeObserver(() => {
      if (svgRef.current && containerRef.current && graphData?.nodes?.length) {
        const el = svgRef.current
        d3.select(el).attr('width', containerRef.current.clientWidth).attr('height', containerRef.current.clientHeight)
      }
    })
    if (containerRef.current) obs.observe(containerRef.current)
    return () => obs.disconnect()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData])

  const nodeTypeColor = selectedItem?.type === 'node' ? selectedItem.color : undefined
  const selfLoopData = selectedItem?.type === 'edge' && selectedItem.data?.isSelfLoopGroup ? selectedItem.data : null
  const colorMap = useMemo(() => {
    return entityTypes.reduce<Record<string, string>>((acc, item) => {
      acc[item.name] = item.color
      return acc
    }, {})
  }, [entityTypes])
  const selectNodeById = useMemo(() => {
    return (nodeId: string) => {
      if (!graphData?.nodes?.length) return
      const node = graphData.nodes.find(item => item.id === nodeId)
      if (!node) return
      const type = getNodeType(node)
      setSelectedItem({
        type: 'node',
        data: {
          id: node.id,
          name: node.name,
          type,
          labels: node.labels ?? [],
          properties: (node.rawData?.properties as Record<string, unknown> | undefined)
            ?? (node.rawData?.attributes as Record<string, unknown> | undefined)
            ?? {},
          ...node.rawData,
        },
        entityType: type,
        color: colorMap[type] || '#999',
      })
    }
  }, [colorMap, graphData])
  const selectedNodeRelations = useMemo<RelationInspectorItem[]>(() => {
    if (selectedItem?.type !== 'node' || !graphData?.edges?.length || !graphData?.nodes?.length) return []
    const nodeId = String(selectedItem.data?.id || '')
    return graphData.edges
      .filter(edge => {
        const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id
        const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id
        const relationType = String((edge.rawData?.type as string) || edge.type || edge.fact_type || edge.name || edge.label || '关联')
        if (relationFilter !== 'all' && relationType !== relationFilter) return false
        return String(sourceId) === nodeId || String(targetId) === nodeId
      })
      .slice(0, 8)
      .map((edge, index) => {
        const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id
        const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id
        const sourceNode = graphData.nodes.find(node => node.id === String(sourceId))
        const targetNode = graphData.nodes.find(node => node.id === String(targetId))
        const relationKey = String(edge.type || edge.name || edge.label || '')
        return {
          id: `${nodeId}-${index}`,
          direction: String(sourceId) === nodeId ? 'outgoing' : 'incoming',
          sourceId: sourceNode?.id || String(sourceId),
          targetId: targetNode?.id || String(targetId),
          sourceName: sourceNode?.name || String(sourceId),
          targetName: targetNode?.name || String(targetId),
          relation: EDGE_TYPE_LABELS[relationKey] || edge.name || edge.label || relationKey || '关联',
          relationType: relationKey || '关联',
          fact: edge.fact || '',
          color: getEdgeColor({
            ...edge,
            rawData: { ...edge, type: relationKey },
          } as GraphEdge),
          edgeData: {
            ...edge,
            source_name: sourceNode?.name || String(edge.source),
            target_name: targetNode?.name || String(edge.target),
            type: relationKey || edge.type || edge.name || edge.label || 'RELATED',
            properties: (edge.rawData as Record<string, unknown> | undefined)?.properties
              ?? (edge.rawData as Record<string, unknown> | undefined)?.attributes
              ?? edge.rawData
              ?? {},
          },
        }
      })
  }, [graphData, selectedItem])
  const selectedEdgeNodeActions = useMemo(() => {
    if (selectedItem?.type !== 'edge') return null
    const sourceId = String(
      selectedItem.data?.source_node_uuid
      ?? selectedItem.data?.source
      ?? ''
    )
    const targetId = String(
      selectedItem.data?.target_node_uuid
      ?? selectedItem.data?.target
      ?? ''
    )
    const sourceName = String(selectedItem.data?.source_name || '')
    const targetName = String(selectedItem.data?.target_name || '')
    return {
      sourceId,
      targetId,
      sourceName,
      targetName,
    }
  }, [selectedItem])
  const selectedEdgeEvidenceNodes = useMemo(() => {
    if (selectedItem?.type !== 'edge' || !graphData?.nodes?.length) return []
    const refs = (((selectedItem.data?.episodes as string[] | undefined) ?? []) as string[])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
    if (refs.length === 0) return []
    return graphData.nodes.filter((node) => matchEpisodeNode(node as GraphNode, refs)).slice(0, 6)
  }, [graphData, selectedItem])
  const groupedSelectedNodeRelations = useMemo(() => {
    return {
      outgoing: selectedNodeRelations.filter(item => item.direction === 'outgoing'),
      incoming: selectedNodeRelations.filter(item => item.direction === 'incoming'),
    }
  }, [selectedNodeRelations])
  const evidenceRelationPreview = useMemo(() => {
    if (selectedItem?.type !== 'node' || String(selectedItem.data?.type || '') !== 'Episode') return []
    return groupedSelectedNodeRelations.outgoing.slice(0, 4)
  }, [groupedSelectedNodeRelations.outgoing, selectedItem])
  const selectionGuide = useMemo(() => {
    if (!selectedItem) {
      return {
        title: '当前建议',
        detail: '先点议题节点，再顺着关系线读证据与动作路径。',
        tone: '#2563eb',
      }
    }
    if (selectedItem.type === 'edge') {
      return {
        title: '正在查看关系',
        detail: selectedEdgeEvidenceNodes.length > 0
          ? `这条关系已命中 ${selectedEdgeEvidenceNodes.length} 个证据片段，建议先点右侧证据卡，再回看两端节点。`
          : '建议先回到源节点或目标节点，再继续追读上下文。',
        tone: '#0f766e',
      }
    }
    if (String(selectedItem.data?.type || '') === 'Episode') {
      return {
        title: '正在查看证据片段',
        detail: evidenceRelationPreview.length > 0
          ? `该证据当前支撑 ${evidenceRelationPreview.length} 条可见关系，建议先切到关系检查器继续追读。`
          : '先阅读证据摘要，再查看该节点发出的关系。',
        tone: '#0369a1',
      }
    }
    return {
      title: '正在查看节点',
      detail: selectedNodeRelations.length > 0
        ? `该节点当前可看到 ${selectedNodeRelations.length} 条关联关系，建议从右侧关系卡继续下钻。`
        : '当前节点关系较少，可以切回全图继续选点。',
      tone: '#7c3aed',
    }
  }, [evidenceRelationPreview.length, selectedEdgeEvidenceNodes.length, selectedItem, selectedNodeRelations.length])
  const selectionSummary = useMemo(() => {
    if (!selectedItem) return null
    if (selectedItem.type === 'edge') {
      return {
        label: '当前关系',
        value: formatRelationSentence(selectedItem.data),
      }
    }
    return {
      label: String(selectedItem.data?.type || '') === 'Episode' ? '当前证据' : '当前节点',
      value: String(selectedItem.data?.name || selectedItem.data?.id || '未命名节点'),
    }
  }, [selectedItem])
  const inspectorWidth = isFullscreen ? 420 : 360
  const edgeToggleRight = selectedItem ? inspectorWidth + 32 : 20
  const relationPillStyle: React.CSSProperties = {
    border: '1px solid #dbe7f3',
    background: 'rgba(255,255,255,0.94)',
    color: '#334155',
    borderRadius: 999,
    padding: '6px 10px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', fontFamily: "'IBM Plex Sans', system-ui, sans-serif", background: isFullscreen ? '#f8fbff' : 'transparent' }}>

      {/* Header */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, padding: '14px 20px', zIndex: 10,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: 'linear-gradient(to bottom, rgba(255,255,255,0.95), rgba(255,255,255,0))',
        pointerEvents: 'none',
      }}>
        <div style={{ pointerEvents: 'auto' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>未来关系图谱</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
            按议题、证据、实体、平台、观察角色与最新动作分层展示。先看议题，再顺着证据与关系往下读。
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, pointerEvents: 'auto' }}>
          {onRefresh && (
            <button onClick={onRefresh} disabled={loading} style={toolBtnStyle(loading)} title="刷新图谱">
              <span style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }}>↻</span>
              <span style={{ fontSize: 12 }}>刷新</span>
            </button>
          )}
          {onToggleMaximize ? (
            <button onClick={onToggleMaximize} style={toolBtnStyle(false)} title={isFullscreen ? '退出全屏' : '最大化图谱'}>
              <span style={{ fontSize: 14 }}>{isFullscreen ? '▣' : '⛶'}</span>
              <span style={{ fontSize: 12 }}>{isFullscreen ? '退出全屏' : '最大化'}</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* Graph area */}
      <div ref={containerRef} style={{ width: '100%', height: '100%', paddingTop: 50 }}>
        {graphData?.nodes?.length ? (
          <svg
            ref={svgRef}
            style={{ width: '100%', height: '100%', display: 'block', background: 'radial-gradient(circle at top, #f8fbff 0%, #eef5fb 58%, #f7fafc 100%)' }}
          />
        ) : (
          <EmptyGraphState loading={loading} isSimulating={isSimulating} onRefresh={onRefresh} />
        )}
      </div>

      {/* Simulation building hint */}
      {isSimulating && (
        <div style={buildingHintStyle(false)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#4CAF50" strokeWidth={2} style={{ width: 18, height: 18, animation: 'breathe 2s ease-in-out infinite' }}>
            <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-4.04z" />
            <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-4.04z" />
          </svg>
          未来关系图谱实时生成中...
        </div>
      )}

      {/* Finished hint */}
      {showFinishedHint && (
        <div style={{ ...buildingHintStyle(true), animation: 'fade-in 0.3s ease' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} style={{ width: 18, height: 18 }}>
            <circle cx={12} cy={12} r={10} /><line x1={12} y1={8} x2={12} y2={12} /><circle cx={12} cy={16} r={0.5} fill="#fff" />
          </svg>
          <span style={{ flex: 1 }}>关系图谱已更新，可继续观察未来路径</span>
          <button onClick={() => setShowFinishedHint(false)} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', cursor: 'pointer', borderRadius: '50%', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
            ×
          </button>
        </div>
      )}

      {/* Legend */}
      {entityTypes.length > 0 && (
        <div style={{
          position: 'absolute', bottom: 24, left: 24, background: 'rgba(255,255,255,0.95)',
          padding: '12px 16px', borderRadius: 8, border: '1px solid #eaeaea',
          boxShadow: '0 4px 16px rgba(0,0,0,0.06)', zIndex: 10,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#E91E63', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>图谱分层</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 16px', maxWidth: 320 }}>
            {entityTypes.map(t => (
              <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
                <span>{t.name} <span style={{ color: '#999' }}>({t.count})</span></span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edge labels toggle */}
      {graphData?.nodes?.length ? (
        <div style={{
          position: 'absolute', top: 56, right: edgeToggleRight, display: 'flex', alignItems: 'center', gap: 10,
          background: '#fff', padding: '8px 14px', borderRadius: 20, border: '1px solid #e0e0e0',
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)', zIndex: 10,
          transition: 'right 0.2s ease',
        }}>
          <label style={{ position: 'relative', display: 'inline-block', width: 40, height: 22, cursor: 'pointer' }}>
            <input type="checkbox" checked={showEdgeLabels} onChange={e => setShowEdgeLabels(e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
            <span style={{
              position: 'absolute', inset: 0, backgroundColor: showEdgeLabels ? '#7B2D8E' : '#e0e0e0', borderRadius: 22,
              transition: '0.3s',
            }} />
            <span style={{
              position: 'absolute', top: 3, left: showEdgeLabels ? 19 : 3, width: 16, height: 16,
              backgroundColor: '#fff', borderRadius: '50%', transition: '0.3s',
            }} />
          </label>
          <span style={{ fontSize: 12, color: '#666' }}>显示关系说明</span>
        </div>
      ) : null}

      {graphData?.nodes?.length ? (
        <div style={{
          position: 'absolute', top: 100, right: edgeToggleRight, display: 'flex', alignItems: 'center', gap: 8,
          background: 'rgba(255,255,255,0.96)', padding: '8px 10px', borderRadius: 14, border: '1px solid #dbe7f3',
          boxShadow: '0 4px 14px rgba(15,23,42,0.06)', zIndex: 10, flexWrap: 'wrap', maxWidth: 380,
          transition: 'right 0.2s ease',
        }}>
          <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'IBM Plex Mono, monospace' }}>关系过滤</span>
          <select
            value={relationFilter}
            onChange={(event) => setRelationFilter(event.target.value)}
            style={{
              border: '1px solid #dbe7f3',
              borderRadius: 999,
              padding: '5px 10px',
              fontSize: 11,
              color: '#334155',
              background: '#fff',
              outline: 'none',
            }}
          >
            <option value="all">全部关系</option>
            {availableRelationTypes.map((item) => (
              <option key={item.type} value={item.type}>
                {item.label} · {item.count}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setFocusCurrentPath((value) => !value)}
            style={{
              border: '1px solid #dbe7f3',
              background: focusCurrentPath ? 'rgba(37,99,235,0.1)' : '#fff',
              color: focusCurrentPath ? '#2563eb' : '#475569',
              borderRadius: 999,
              padding: '5px 10px',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {focusCurrentPath ? '仅当前路径' : '显示全图'}
          </button>
        </div>
      ) : null}

      {graphData?.nodes?.length ? (
        <div style={{
          position: 'absolute', top: 56, left: 20, display: 'flex', gap: 8, zIndex: 10, flexWrap: 'wrap',
          maxWidth: '60%',
        }}>
          {[
            ['议题层', graphData.nodes.filter(node => ['Event', 'Goal'].includes(getNodeType(node))).length],
            ['证据层', graphData.nodes.filter(node => getNodeType(node) === 'Episode').length],
            ['实体层', graphData.nodes.filter(node => ['Actor', 'Region', 'Concept'].includes(getNodeType(node))).length],
            ['平台层', graphData.nodes.filter(node => getNodeType(node) === 'Platform').length],
            ['代理体层', graphData.nodes.filter(node => getNodeType(node) === 'Agent').length],
            ['动作层', graphData.nodes.filter(node => getNodeType(node) === 'Action').length],
          ].map(([label, value]) => (
            <div key={label as string} style={{
              background: 'rgba(255,255,255,0.92)', border: '1px solid #dbe7f3', borderRadius: 999,
              padding: '6px 10px', fontSize: 11, color: '#475569', display: 'flex', gap: 6, alignItems: 'center',
            }}>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#2563eb' }}>{label}</span>
              <span style={{ fontWeight: 700, color: '#0f172a' }}>{value}</span>
            </div>
          ))}
        </div>
      ) : null}

      {graphData?.nodes?.length ? (
        <div style={{
          position: 'absolute',
          top: 140,
          left: 20,
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          maxWidth: '58%',
          zIndex: 10,
        }}>
          {['先看议题', '再读证据', '再看实体与平台', '最后追动作路径'].map((item, index) => (
            <div
              key={item}
              style={{
                background: 'rgba(255,255,255,0.94)',
                border: '1px solid #dbe7f3',
                borderRadius: 999,
                padding: '6px 10px',
                fontSize: 11,
                color: index === 0 ? '#2563eb' : '#475569',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 4px 14px rgba(15,23,42,0.04)',
              }}
            >
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#94a3b8' }}>0{index + 1}</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      ) : null}

      {graphData?.nodes?.length ? (
        <div style={{
          position: 'absolute',
          top: 180,
          left: 20,
          maxWidth: 380,
          zIndex: 10,
          background: 'rgba(255,255,255,0.95)',
          border: `1px solid ${selectionGuide.tone}22`,
          borderLeft: `4px solid ${selectionGuide.tone}`,
          borderRadius: 12,
          boxShadow: '0 6px 20px rgba(15,23,42,0.06)',
          padding: '10px 12px',
        }}>
          <div style={{ fontSize: 11, color: selectionGuide.tone, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 4 }}>
            {selectionGuide.title}
          </div>
          <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.6 }}>
            {selectionGuide.detail}
          </div>
        </div>
      ) : null}

      {graphData?.nodes?.length && selectionSummary ? (
        <div style={{
          position: 'absolute',
          top: 260,
          left: 20,
          maxWidth: 420,
          zIndex: 10,
          background: 'rgba(255,255,255,0.94)',
          border: '1px solid #dbe7f3',
          borderRadius: 12,
          boxShadow: '0 6px 20px rgba(15,23,42,0.05)',
          padding: '10px 12px',
        }}>
          <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 4 }}>
            {selectionSummary.label}
          </div>
          <div style={{ fontSize: 12, color: '#1e293b', lineHeight: 1.6, fontWeight: 600 }}>
            {selectionSummary.value}
          </div>
        </div>
      ) : null}

      {/* Detail panel */}
      {selectedItem && (
        <div style={{
          position: 'absolute', top: 56, right: 20, width: inspectorWidth, maxHeight: 'calc(100% - 100px)',
          background: '#fff', border: '1px solid #eaeaea', borderRadius: 10,
          boxShadow: '0 8px 32px rgba(0,0,0,0.1)', overflow: 'hidden', zIndex: 20,
          display: 'flex', flexDirection: 'column', fontSize: 13,
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', padding: '12px 16px',
            background: '#fafafa', borderBottom: '1px solid #eee', flexShrink: 0,
          }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: '#333' }}>
              {selectedItem.type === 'node' ? '节点检查器' : '关系检查器'}
            </span>
            {selectedItem.type === 'node' && nodeTypeColor && (
              <span style={{
                padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 500,
                background: nodeTypeColor, color: '#fff', marginLeft: 'auto', marginRight: 12,
              }}>
                {getNodeTypeLabel(String(selectedItem.entityType || 'Entity'))}
              </span>
            )}
            <button onClick={() => setSelectedItem(null)} style={{
              background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#aaa', lineHeight: 1, padding: '0 2px',
            }}>×</button>
          </div>

          {/* Self-loop content */}
          {selfLoopData ? (
            <SelfLoopContent edge={selfLoopData} />
          ) : (
            <div style={{ padding: 16, overflowY: 'auto' as const, flex: 1 }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '10px 12px',
                background: 'linear-gradient(135deg, rgba(37,99,235,0.06), rgba(255,255,255,0.96))',
                border: '1px solid #dbe7f3',
                borderRadius: 10,
                marginBottom: 14,
              }}>
                <div>
                  <div style={{ fontSize: 11, color: '#2563eb', fontWeight: 700, letterSpacing: '0.05em' }}>
                    {selectedItem.type === 'node' ? '读图路径' : '关系路径'}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, color: '#475569', lineHeight: 1.55 }}>
                    {selectedItem.type === 'node'
                      ? '先看节点身份，再顺着下方关系卡逐条钻取未来路径。'
                      : '先读关系句，再跳回源节点或目标节点继续检查上下文。'}
                  </div>
                </div>
                <div style={{
                  minWidth: 64,
                  textAlign: 'right',
                  fontSize: 10,
                  color: '#64748b',
                  fontFamily: 'IBM Plex Mono, monospace',
                }}>
                  {selectedItem.type === 'node' ? '节点' : '关系'}
                </div>
              </div>
              {selectedItem.type === 'edge' && (
                <div style={{
                  background: '#f8fafc', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 13,
                  fontWeight: 600, color: '#1e293b', lineHeight: 1.6, border: '1px solid #dbe7f3',
                }}>
                  {formatRelationSentence(selectedItem.data)}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                    <span style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(15,23,42,0.04)', border: '1px solid #dbe7f3', fontSize: 10, color: '#475569', fontWeight: 600 }}>
                      证据命中 {selectedEdgeEvidenceNodes.length}
                    </span>
                    {((selectedItem.data as any)?.episodes?.length ?? 0) > 0 ? (
                      <span style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(14,165,233,0.08)', border: '1px solid rgba(14,165,233,0.18)', fontSize: 10, color: '#0369a1', fontWeight: 600 }}>
                      片段引用 {((selectedItem.data as any)?.episodes?.length ?? 0)}
                    </span>
                  ) : null}
                </div>
                {((selectedItem.data as any)?.episodes?.length ?? 0) > 0 ? (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 10, color: '#64748b', marginBottom: 4 }}>
                      <span>证据关联强度</span>
                      <span>{selectedEdgeEvidenceNodes.length} / {((selectedItem.data as any)?.episodes?.length ?? 0)}</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 999, overflow: 'hidden', background: 'rgba(14,165,233,0.12)' }}>
                      <div
                        style={{
                          width: `${Math.min(100, Math.round((selectedEdgeEvidenceNodes.length / Math.max(((selectedItem.data as any)?.episodes?.length ?? 1), 1)) * 100))}%`,
                          height: '100%',
                          background: 'linear-gradient(90deg, #0ea5e9, #2563eb)',
                          borderRadius: 999,
                        }}
                      />
                    </div>
                  </div>
                ) : null}
                </div>
              )}
              {selectedItem.type === 'edge' && selectedEdgeEvidenceNodes.length > 0 && (
                <div style={{
                  marginBottom: 14,
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: '1px solid rgba(14,165,233,0.16)',
                  background: 'linear-gradient(135deg, rgba(14,165,233,0.08), rgba(255,255,255,0.96))',
                }}>
                  <div style={{ fontSize: 11, color: '#0369a1', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
                    关系证据
                  </div>
                  <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.65, marginBottom: 10 }}>
                    这条关系当前可回溯到以下证据片段。点击后会切换到证据节点检查器，继续沿证据阅读整条未来路径。
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {selectedEdgeEvidenceNodes.map((node) => (
                      <button
                        key={node.id}
                        type="button"
                        onClick={() => selectNodeById(node.id)}
                        style={{
                          border: '1px solid #dbe7f3',
                          borderLeft: '4px solid #0ea5e9',
                          borderRadius: 8,
                          padding: '8px 10px',
                          background: 'rgba(255,255,255,0.95)',
                          textAlign: 'left',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', marginBottom: 3 }}>
                          {node.name}
                        </div>
                        {String((node.rawData as Record<string, unknown> | undefined)?.summary || '').trim() ? (
                          <div style={{ fontSize: 10, color: '#475569', lineHeight: 1.6 }}>
                            {String((node.rawData as Record<string, unknown>).summary).slice(0, 88)}
                          </div>
                        ) : (
                          <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.6 }}>
                            点击进入证据卡，查看来源、摘要与内容预览。
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {selectedItem.type === 'edge' && selectedEdgeNodeActions && (selectedEdgeNodeActions.sourceId || selectedEdgeNodeActions.targetId) && (
                <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 8, marginBottom: 14 }}>
                  {selectedEdgeNodeActions.sourceId ? (
                    <button
                      type="button"
                      onClick={() => selectNodeById(selectedEdgeNodeActions.sourceId)}
                      style={relationPillStyle}
                    >
                      返回源节点: {selectedEdgeNodeActions.sourceName || selectedEdgeNodeActions.sourceId}
                    </button>
                  ) : null}
                  {selectedEdgeNodeActions.targetId ? (
                    <button
                      type="button"
                      onClick={() => selectNodeById(selectedEdgeNodeActions.targetId)}
                      style={relationPillStyle}
                    >
                      查看目标节点: {selectedEdgeNodeActions.targetName || selectedEdgeNodeActions.targetId}
                    </button>
                  ) : null}
                </div>
              )}
              {selectedItem.type === 'node' && (selectedItem.data as any)?.name && (
                <DetailRow label="名称" value={String((selectedItem.data as any).name)} />
              )}
              {selectedItem.type === 'node' && (selectedItem.data as any)?.type && (
                <DetailRow label="类型" value={getNodeTypeLabel(String((selectedItem.data as any).type))} />
              )}
              {selectedItem.type === 'node' && String((selectedItem.data as any)?.type || '') === 'Episode' && (
                <div style={{
                  marginTop: 14,
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: '1px solid #dbe7f3',
                  background: 'linear-gradient(135deg, rgba(14,165,233,0.08), rgba(255,255,255,0.97))',
                }}>
                  <div style={{ fontSize: 11, color: '#0369a1', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
                    证据卡
                  </div>
                  {(selectedItem.data as any)?.summary ? (
                    <div style={{ fontSize: 12, color: '#1e293b', lineHeight: 1.7, marginBottom: 8 }}>
                      {String((selectedItem.data as any).summary)}
                    </div>
                  ) : null}
                  {(selectedItem.data as any)?.attributes?.content_preview ? (
                    <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.65, marginBottom: 8 }}>
                      {String((selectedItem.data as any).attributes.content_preview)}
                    </div>
                  ) : null}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {(selectedItem.data as any)?.attributes?.source_description ? (
                      <span style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(255,255,255,0.92)', border: '1px solid #dbe7f3', fontSize: 10, color: '#475569' }}>
                        来源 {String((selectedItem.data as any).attributes.source_description)}
                      </span>
                    ) : null}
                    {(selectedItem.data as any)?.created_at ? (
                      <span style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(255,255,255,0.92)', border: '1px solid #dbe7f3', fontSize: 10, color: '#475569' }}>
                        时间 {formatDateTime(String((selectedItem.data as any).created_at))}
                      </span>
                    ) : null}
                  </div>
                  {evidenceRelationPreview.length > 0 ? (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(14,165,233,0.14)' }}>
                      <div style={{ fontSize: 11, color: '#0369a1', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
                        该证据当前支撑的关系
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {evidenceRelationPreview.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setSelectedItem({ type: 'edge', data: item.edgeData })}
                            style={{
                              border: '1px solid #dbe7f3',
                              borderLeft: `4px solid ${item.color}`,
                              borderRadius: 8,
                              padding: '8px 10px',
                              background: 'rgba(255,255,255,0.94)',
                              textAlign: 'left',
                              cursor: 'pointer',
                            }}
                          >
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#1e293b', marginBottom: 3 }}>
                              {item.sourceName} → {item.relation} → {item.targetName}
                            </div>
                            {item.fact ? (
                              <div style={{ fontSize: 10, color: '#475569', lineHeight: 1.6 }}>
                                {item.fact}
                              </div>
                            ) : (
                              <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.6 }}>
                                点击切换到关系检查器，查看该证据如何支撑当前路径。
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
              {selectedItem.type === 'edge' && (selectedItem.data as any)?.type && (
                <DetailRow label="关系类型" value={EDGE_TYPE_LABELS[String((selectedItem.data as any).type)] || String((selectedItem.data as any).type)} />
              )}
              {selectedItem.type === 'edge' && (selectedItem.data as any)?.fact && (
                <DetailRow label="关系说明" value={String((selectedItem.data as any).fact)} />
              )}
              {(selectedItem.data as any)?.properties && Object.keys((selectedItem.data as any).properties).length > 0 && (
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #f0f0f0' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#666', marginBottom: 8, letterSpacing: '0.05em' }}>核心属性</div>
                  {Object.entries((selectedItem.data as any).properties).map(([key, value]) => (
                    <DetailRow key={key} label={String(key)} value={formatPropertyValue(value)} />
                  ))}
                </div>
              )}
              {(selectedItem.data as any)?.created_at && (
                <DetailRow label="创建时间" value={formatDateTime(String((selectedItem.data as any).created_at))} />
              )}
              {(selectedItem.data as any)?.labels?.length > 0 && (
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #f0f0f0' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#666', marginBottom: 8, letterSpacing: '0.05em' }}>标签</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
                    {(selectedItem.data as any).labels.map((l: string, i: number) => (
                      <span key={i} style={{ padding: '3px 10px', background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: 16, fontSize: 11, color: '#555' }}>{getNodeTypeLabel(l)}</span>
                    ))}
                  </div>
                </div>
              )}
              {selectedItem.type === 'node' && selectedNodeRelations.length > 0 && (
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #f0f0f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#666', letterSpacing: '0.05em' }}>关联关系</div>
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>点击可切换到关系检查器</div>
                  </div>
                  {([
                    ['outgoing', '从该节点发出的关系', groupedSelectedNodeRelations.outgoing],
                    ['incoming', '指向该节点的关系', groupedSelectedNodeRelations.incoming],
                  ] as const).map(([groupKey, title, items]) => (
                    items.length > 0 ? (
                      <div key={groupKey} style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.06em', marginBottom: 6 }}>
                          {title}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {items.map(item => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => setSelectedItem({ type: 'edge', data: item.edgeData })}
                              style={{
                                border: '1px solid #e2e8f0',
                                borderLeft: `4px solid ${item.color}`,
                                borderRadius: 8,
                                padding: '8px 10px',
                                background: '#f8fafc',
                                textAlign: 'left',
                                cursor: 'pointer',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: '#1f2937' }}>
                                  {item.sourceName} → {item.relation} → {item.targetName}
                                </div>
                                <span style={{ fontSize: 10, color: item.direction === 'outgoing' ? '#2563eb' : '#0f766e' }}>
                                  {item.direction === 'outgoing' ? '流出' : '流入'}
                                </span>
                              </div>
                              <div style={{ fontSize: 10, color: '#2563eb', marginBottom: item.fact ? 4 : 0 }}>
                                类型: {EDGE_TYPE_LABELS[item.relationType] || item.relationType || '关联'}
                              </div>
                              {item.fact ? (
                                <div style={{ fontSize: 11, lineHeight: 1.5, color: '#64748b' }}>{item.fact}</div>
                              ) : null}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null
                  ))}
                </div>
              )}
              {(selectedItem.data as any)?.episodes?.length > 0 && (
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #f0f0f0' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#666', marginBottom: 8, letterSpacing: '0.05em' }}>关联片段</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
                    {(selectedItem.data as any).episodes.map((ep: string, i: number) => {
                      const matchedNode = selectedEdgeEvidenceNodes.find((node) => matchEpisodeNode(node as GraphNode, [String(ep)]))
                      return (
                        <button
                          key={`${ep}-${i}`}
                          type="button"
                          onClick={() => matchedNode ? selectNodeById(matchedNode.id) : undefined}
                          style={{
                            padding: '5px 10px',
                            background: matchedNode ? 'rgba(14,165,233,0.08)' : '#f8f8f8',
                            border: matchedNode ? '1px solid rgba(14,165,233,0.18)' : '1px solid #e8e8e8',
                            borderRadius: 6,
                            fontSize: 10,
                            color: matchedNode ? '#0369a1' : '#666',
                            fontFamily: 'monospace',
                            cursor: matchedNode ? 'pointer' : 'default',
                          }}
                        >
                          {ep}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes fade-in { from { opacity: 0 } to { opacity: 1 } }
        @keyframes breathe { 0%,100% { opacity: 0.7; transform: scale(1); } 50% { opacity: 1; transform: scale(1.1); } }
      `}</style>
    </div>
  )
}

function toolBtnStyle(_spinning: boolean) {
  return {
    height: 32, padding: '0 12px', border: '1px solid #e0e0e0', background: '#fff',
    borderRadius: 6, display: 'flex' as const, alignItems: 'center', gap: 6, cursor: 'pointer', color: '#666',
    fontSize: 12, transition: 'all 0.2s',
  }
}

function buildingHintStyle(finished: boolean): React.CSSProperties {
  return {
    position: 'absolute', bottom: finished ? 80 : 160, left: '50%', transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)', color: '#fff',
    padding: '10px 20px', borderRadius: 30, fontSize: 13, display: 'flex', alignItems: 'center', gap: 10,
    boxShadow: '0 4px 20px rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.1)',
    fontWeight: 500, letterSpacing: '0.5px', zIndex: 100,
  }
}
