import React, { useEffect, useRef, useState } from 'react'
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
  name?: string
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

interface GraphPanelProps {
  graphData?: { nodes: GraphNode[]; edges: GraphEdge[] }
  loading?: boolean
  onRefresh?: () => void
  isSimulating?: boolean
}

// ── Color palette for entity types ─────────────────────────────────────────────
const ENTITY_COLORS = [
  '#FF6B35', '#004E89', '#7B2D8E', '#1A936F', '#C5283D',
  '#E9724C', '#3498db', '#9b59b6', '#27ae60', '#f39c12',
]

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
  return n.length > 12 ? n.slice(0, 12) + '…' : n
}

function getEdgeLabel(edge: GraphEdge): string {
  return edge.name || edge.fact_type || 'RELATED'
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
        {String(edge.source_name)} — Self Relations
        <span style={{ fontSize: 11, color: '#6b7280', background: '#fff', padding: '2px 8px', borderRadius: 10 }}>
          {selfLoops.length} items
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
                {String(loop.fact_type || loop.name || 'RELATED')}
              </span>
              <span style={{ fontSize: 14, color: '#9ca3af' }}>{isOpen ? '−' : '+'}</span>
            </div>
            {isOpen && (
              <div style={{ padding: 12, borderTop: '1px solid #e5e7eb', fontSize: 12 }}>
                {loop.fact ? <DetailRow label="Fact" value={String(loop.fact)} /> : null}
                {loop.fact_type ? <DetailRow label="Type" value={String(loop.fact_type)} /> : null}
                {loop.created_at ? <DetailRow label="Created" value={formatDateTime(String(loop.created_at))} /> : null}
                {(loop.episodes as string[])?.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Episodes</div>
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
}: GraphPanelProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const simRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null)

  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null)
  const [showEdgeLabels, setShowEdgeLabels] = useState(true)
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
      const type = node.labels?.find(l => l !== 'Entity') || 'Entity'
      if (!typeMap[type]) {
        typeMap[type] = { name: type, count: 0, color: ENTITY_COLORS[Object.keys(typeMap).length % ENTITY_COLORS.length] }
      }
      typeMap[type].count++
    })
    setEntityTypes(Object.values(typeMap))
  }, [graphData])

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

    // Build edges with pair counting + self-loop grouping
    const edgePairCount: Record<string, number> = {}
    const selfLoopMap: Record<string, GraphEdge[]> = {}
    const tempEdges = edgesData.filter((e: GraphEdge) => {
      const sid = String(e.source), tid = String(e.target)
      return nodeIds.has(sid) && nodeIds.has(tid)
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
        rawData: { ...e, source_name: nodeMap[sid]?.name, target_name: nodeMap[tid]?.name },
      })
    })

    const colorMap: Record<string, string> = {}
    entityTypes.forEach(t => { colorMap[t.name] = t.color })
    const getColor = (type: string) => colorMap[type] || '#999'

    // D3 simulation
    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges).id((d: any) => d.id).distance(d => {
        const base = 150; const cnt = (d as any).pairTotal || 1
        return base + (cnt - 1) * 50
      }))
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide(50))
      .force('x', d3.forceX(width / 2).strength(0.04))
      .force('y', d3.forceY(height / 2).strength(0.04))
    simRef.current = simulation

    const g = svg.append('g')

    // Zoom
    svg.call(d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => g.attr('transform', event.transform as any)))

    linkGroupRef.current = g.append('g')

    // Links
    const link = linkGroupRef.current.selectAll<SVGPathElement, GraphEdge>('path')
      .data(edges).join('path')
      .attr('stroke', '#c0c0c0').attr('stroke-width', 1.5)
      .attr('fill', 'none').style('cursor', 'pointer')
      .on('click', (event, d) => {
        event.stopPropagation()
        resetHighlight()
        d3.select(event.currentTarget as Element).attr('stroke', '#3498db').attr('stroke-width', 3)
        linkLabelBg?.attr('fill', 'rgba(255,255,255,0.95)')
        linkLabel?.attr('fill', '#666')
        setSelectedItem({ type: 'edge', data: d.rawData || {} })
      })

    // Link label backgrounds
    const linkLabelBg = linkGroupRef.current.selectAll<SVGRectElement, GraphEdge>('rect')
      .data(edges).join('rect')
      .attr('fill', 'rgba(255,255,255,0.95)').attr('rx', 3).attr('ry', 3)
      .style('cursor', 'pointer').style('pointer-events', 'all')
      .style('display', showEdgeLabels ? 'block' : 'none')
      .on('click', (event, d) => {
        event.stopPropagation()
        resetHighlight()
        d3.select(event.currentTarget as Element).attr('fill', 'rgba(52,152,219,0.1)')
        setSelectedItem({ type: 'edge', data: d.rawData || {} })
      })
    linkLabelBgRef.current = linkLabelBg as any

    // Link labels
    const linkLabel = linkGroupRef.current.selectAll<SVGTextElement, any>('text')
      .data(edges).join('text')
      .text(d => getEdgeLabel(d))
      .attr('font-size', 9).attr('fill', '#666')
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
      .style('cursor', 'pointer').style('pointer-events', 'all')
      .style('display', showEdgeLabels ? 'block' : 'none')
      .style('font-family', 'system-ui, sans-serif')
      .on('click', (event, d) => {
        event.stopPropagation()
        resetHighlight()
        d3.select(event.currentTarget as Element).attr('fill', '#3498db')
        setSelectedItem({ type: 'edge', data: d.rawData || {} })
      })
    linkLabelRef.current = linkLabel as any

    // Nodes
    const nodeGroup = g.append('g')
    const nodeEls = nodeGroup.selectAll<SVGCircleElement, GraphNode>('circle')
      .data(nodes).join('circle')
      .attr('r', 10).attr('fill', d => getColor(d.labels?.find(l => l !== 'Entity') || 'Entity'))
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
        d3.select(event.currentTarget as SVGCircleElement).attr('stroke', '#E91E63').attr('stroke-width', 4)
        link.filter(l => l.source.id === d.id || l.target.id === d.id)
          .attr('stroke', '#E91E63').attr('stroke-width', 2.5)
        setSelectedItem({
          type: 'node', data: d.rawData || d as unknown as Record<string, unknown>,
          entityType: d.labels?.find(l => l !== 'Entity') || 'Entity',
          color: getColor(d.labels?.find(l => l !== 'Entity') || 'Entity'),
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
      .attr('font-size', 11).attr('fill', '#333').attr('font-weight', '500')
      .attr('dx', 14).attr('dy', 4)
      .style('pointer-events', 'none').style('font-family', 'system-ui, sans-serif')

    // Highlight reset helper
    function resetHighlight() {
      nodeEls.attr('stroke', '#fff').attr('stroke-width', 2.5)
      link.attr('stroke', '#c0c0c0').attr('stroke-width', 1.5)
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
  }, [graphData, entityTypes])

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

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>

      {/* Header */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, padding: '14px 20px', zIndex: 10,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: 'linear-gradient(to bottom, rgba(255,255,255,0.95), rgba(255,255,255,0))',
        pointerEvents: 'none',
      }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#333', pointerEvents: 'auto' }}>关系图谱</span>
        <div style={{ display: 'flex', gap: 10, pointerEvents: 'auto' }}>
          {onRefresh && (
            <button onClick={onRefresh} disabled={loading} style={toolBtnStyle(loading)} title="刷新图谱">
              <span style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }}>↻</span>
              <span style={{ fontSize: 12 }}>刷新</span>
            </button>
          )}
        </div>
      </div>

      {/* Graph area */}
      <div ref={containerRef} style={{ width: '100%', height: '100%', paddingTop: 50 }}>
        {graphData?.nodes?.length ? (
          <svg
            ref={svgRef}
            style={{ width: '100%', height: '100%', display: 'block', background: '#fafafa' }}
          />
        ) : loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
            <div style={{ width: 40, height: 40, border: '3px solid #e0e0e0', borderTopColor: '#7B2D8E', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            <p style={{ color: '#999', fontSize: 13 }}>图谱加载中...</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12 }}>
            <div style={{ fontSize: 48, color: '#e0e0e0' }}>❖</div>
            <p style={{ color: '#bbb', fontSize: 13 }}>等待本体生成...</p>
          </div>
        )}
      </div>

      {/* Simulation building hint */}
      {isSimulating && (
        <div style={buildingHintStyle(false)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#4CAF50" strokeWidth={2} style={{ width: 18, height: 18, animation: 'breathe 2s ease-in-out infinite' }}>
            <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-4.04z" />
            <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-4.04z" />
          </svg>
          图谱实时构建中...
        </div>
      )}

      {/* Finished hint */}
      {showFinishedHint && (
        <div style={{ ...buildingHintStyle(true), animation: 'fade-in 0.3s ease' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} style={{ width: 18, height: 18 }}>
            <circle cx={12} cy={12} r={10} /><line x1={12} y1={8} x2={12} y2={12} /><circle cx={12} cy={16} r={0.5} fill="#fff" />
          </svg>
          <span style={{ flex: 1 }}>图谱已生成，建议手动刷新</span>
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
          <div style={{ fontSize: 11, fontWeight: 600, color: '#E91E63', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Entity Types</div>
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
          position: 'absolute', top: 56, right: 20, display: 'flex', alignItems: 'center', gap: 10,
          background: '#fff', padding: '8px 14px', borderRadius: 20, border: '1px solid #e0e0e0',
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)', zIndex: 10,
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
          <span style={{ fontSize: 12, color: '#666' }}>显示关系标签</span>
        </div>
      ) : null}

      {/* Detail panel */}
      {selectedItem && (
        <div style={{
          position: 'absolute', top: 56, right: 20, width: 320, maxHeight: 'calc(100% - 100px)',
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
              {selectedItem.type === 'node' ? '节点详情' : '关系详情'}
            </span>
            {selectedItem.type === 'node' && nodeTypeColor && (
              <span style={{
                padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 500,
                background: nodeTypeColor, color: '#fff', marginLeft: 'auto', marginRight: 12,
              }}>
                {selectedItem.entityType}
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
              {selectedItem.type === 'edge' && (
                <div style={{
                  background: '#f8f9fa', padding: 10, borderRadius: 8, marginBottom: 16, fontSize: 13,
                  fontWeight: 500, color: '#333', lineHeight: 1.5,
                }}>
                  {String(selectedItem.data.source_name || '')} → {String(selectedItem.data.target_name || 'RELATED_TO')}
                </div>
              )}
              {selectedItem.type === 'node' && (selectedItem.data as any)?.name && (
                <DetailRow label="名称" value={String((selectedItem.data as any).name)} />
              )}
              {(selectedItem.data as any)?.uuid && (
                <DetailRow label="UUID" value={String((selectedItem.data as any).uuid)} />
              )}
              {(selectedItem.data as any)?.created_at && (
                <DetailRow label="创建时间" value={formatDateTime(String((selectedItem.data as any).created_at))} />
              )}
              {(selectedItem.data as any)?.fact && (
                <DetailRow label="Fact" value={String((selectedItem.data as any).fact)} />
              )}
              {(selectedItem.data as any)?.fact_type && (
                <DetailRow label="类型" value={String((selectedItem.data as any).fact_type)} />
              )}
              {(selectedItem.data as any)?.labels?.length > 0 && (
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #f0f0f0' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#666', marginBottom: 8, textTransform: 'uppercase' }}>Labels</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
                    {(selectedItem.data as any).labels.map((l: string, i: number) => (
                      <span key={i} style={{ padding: '3px 10px', background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: 16, fontSize: 11, color: '#555' }}>{l}</span>
                    ))}
                  </div>
                </div>
              )}
              {(selectedItem.data as any)?.episodes?.length > 0 && (
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #f0f0f0' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#666', marginBottom: 8, textTransform: 'uppercase' }}>Episodes</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
                    {(selectedItem.data as any).episodes.map((ep: string, i: number) => (
                      <span key={i} style={{ padding: '5px 10px', background: '#f8f8f8', border: '1px solid #e8e8e8', borderRadius: 6, fontSize: 10, color: '#666', fontFamily: 'monospace' }}>{ep}</span>
                    ))}
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
