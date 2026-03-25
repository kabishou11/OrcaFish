import { useEffect, useState, useRef, useCallback } from 'react'
import * as d3 from 'd3'


interface SimulationRun {
  run_id: string; status: string; rounds_completed: number; convergence_achieved: boolean;
  final_states?: Array<{ id: string; position: [number, number]; belief: number; influence: number }>;
  duration_ms?: number; created_at?: string;
}
interface GraphNode extends d3.SimulationNodeDatum {
  id: string; name: string; type: string; belief?: number; influence?: number; rawData?: Record<string, unknown>
}
interface GraphEdge extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode; target: string | GraphNode; type: string; name: string; curvature?: number
}
interface KGData { nodes: GraphNode[]; edges: GraphEdge[] }

function KnowledgeGraphPanel({ run }: { run: SimulationRun }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [graphData, setGraphData] = useState<KGData | null>(null)
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [showEdgeLabels, setShowEdgeLabels] = useState(true)
  const simRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null)
  const linkLabelsRef = useRef<d3.Selection<SVGTextElement, GraphEdge, SVGGElement, unknown> | null>(null)
  const linkLabelBgRef = useRef<d3.Selection<SVGRectElement, GraphEdge, SVGGElement, unknown> | null>(null)
  const linkGroupRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null)
  const nodeGroupRef = useRef<d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown> | null>(null)
  const linkRef = useRef<d3.Selection<SVGLineElement, GraphEdge, SVGGElement, unknown> | null>(null)

  // Build knowledge graph from simulation agent states
  const buildGraph = useCallback((): KGData => {
    if (!run.final_states || run.final_states.length === 0) return { nodes: [], edges: [] }

    const nodes: GraphNode[] = run.final_states.map(agent => ({
      id: agent.id,
      name: agent.id.length > 12 ? agent.id.slice(0, 12) + '…' : agent.id,
      type: agent.belief > 0.65 ? 'high-risk' : agent.belief < 0.35 ? 'low-risk' : 'moderate',
      belief: agent.belief,
      influence: agent.influence,
    }))

    // Build edges from agent influence relationships (belief similarity → connection)
    const edges: GraphEdge[] = []
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j]
        const beliefDiff = Math.abs((a.belief ?? 0) - (b.belief ?? 0))
        if (beliefDiff < 0.2) {
          edges.push({
            source: a.id, target: b.id,
            type: 'similarity', name: `相似度 ${((1 - beliefDiff) * 100).toFixed(0)}%`,
            curvature: 0.2,
          })
        }
        if ((a.influence ?? 0) > 0.5 || (b.influence ?? 0) > 0.5) {
          edges.push({
            source: a.id, target: b.id,
            type: 'influence', name: '影响力连接',
            curvature: -0.15,
          })
        }
      }
    }

    return { nodes, edges }
  }, [run])

  const nodeColor = (type: string) =>
    type === 'high-risk' ? '#ff3b5c' : type === 'low-risk' ? '#44ff88' : '#5eb8ff'

  // Render D3 force-directed graph
  useEffect(() => {
    const data = buildGraph()
    if (data.nodes.length === 0) { setGraphData(null); return }
    setGraphData(data)

    if (!svgRef.current) return
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const width = svgRef.current.clientWidth || 700
    const height = svgRef.current.clientHeight || 400

    const edgeColor = (type: string) => {
      if (type === 'influence') return '#ffd166'
      return 'rgba(94,184,255,0.4)'
    }

    // Defs: filters + arrow markers (must be before use)
    const defs = svg.append('defs')

    // Glow filter
    const glowFilter = defs.append('filter').attr('id', 'glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%')
    glowFilter.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'coloredBlur')
    const feMerge = glowFilter.append('feMerge')
    feMerge.append('feMergeNode').attr('in', 'coloredBlur')
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic')

    // Influence arrow (yellow)
    defs.append('marker')
      .attr('id', 'arrow-influence')
      .attr('viewBox', '-0 -5 10 10')
      .attr('refX', 20).attr('refY', 0)
      .attr('orient', 'auto')
      .attr('markerWidth', 7).attr('markerHeight', 7)
      .append('path')
      .attr('d', 'M 0,-5 L 10,0 L 0,5')
      .attr('fill', 'rgba(255,209,102,0.7)')

    // Similarity arrow (blue)
    defs.append('marker')
      .attr('id', 'arrow-similarity')
      .attr('viewBox', '-0 -5 10 10')
      .attr('refX', 18).attr('refY', 0)
      .attr('orient', 'auto')
      .attr('markerWidth', 6).attr('markerHeight', 6)
      .append('path')
      .attr('d', 'M 0,-5 L 10,0 L 0,5')
      .attr('fill', 'rgba(94,184,255,0.4)')

    // Main group (for zoom/pan)
    const g = svg.append('g')
    linkGroupRef.current = g.append('g').attr('class', 'links')
    nodeGroupRef.current = g.append('g').attr('class', 'nodes') as unknown as typeof nodeGroupRef.current

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => g.attr('transform', event.transform))
    svg.call(zoom)
    svg.on('dblclick.zoom', null)

    // Simulation
    const simulation = d3.forceSimulation<GraphNode>(data.nodes)
      .force('link', d3.forceLink<GraphNode, GraphEdge>(data.edges)
        .id(d => d.id)
        .distance(d => d.type === 'influence' ? 60 : 90)
        .strength(d => d.type === 'influence' ? 0.8 : 0.4)
      )
      .force('charge', d3.forceManyBody().strength(-220))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(28))
      .force('x', d3.forceX(width / 2).strength(0.05))
      .force('y', d3.forceY(height / 2).strength(0.05))
    simRef.current = simulation

    // Helper: midpoint for edge label
    const getMidpoint = (d: GraphEdge) => {
      const sx = (d.source as GraphNode).x ?? 0, sy = (d.source as GraphNode).y ?? 0
      const tx = (d.target as GraphNode).x ?? 0, ty = (d.target as GraphNode).y ?? 0
      const dx = tx - sx, dy = ty - sy
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const offsetRatio = 0.2
      const baseOffset = Math.max(30, dist * offsetRatio)
      const offsetX = -dy / dist * (d.curvature ?? 0) * baseOffset
      const offsetY = dx / dist * (d.curvature ?? 0) * baseOffset
      return { x: (sx + tx) / 2 + offsetX, y: (sy + ty) / 2 + offsetY }
    }

    // Edges
    const link = linkGroupRef.current.append('g')
      .selectAll<SVGLineElement, GraphEdge>('line')
      .data(data.edges)
      .join('line')
      .attr('stroke', d => edgeColor(d.type))
      .attr('stroke-width', d => d.type === 'influence' ? 1.5 : 0.8)
      .attr('stroke-dasharray', d => d.type === 'influence' ? '5,3' : 'none')
      .attr('marker-end', d => `url(#arrow-${d.type === 'influence' ? 'influence' : 'similarity'})`)
    linkRef.current = link

    // Edge label backgrounds
    const linkLabelBg = linkGroupRef.current.append('g')
      .selectAll<SVGRectElement, GraphEdge>('rect')
      .data(data.edges)
      .join('rect')
      .attr('fill', 'rgba(7,9,15,0.88)')
      .attr('rx', 3).attr('ry', 3)
      .attr('display', showEdgeLabels ? 'block' : 'none')
    linkLabelBgRef.current = linkLabelBg

    // Edge labels
    const linkLabels = linkGroupRef.current.append('g')
      .selectAll<SVGTextElement, GraphEdge>('text')
      .data(data.edges)
      .join('text')
      .text(d => d.name)
      .attr('font-size', '9px')
      .attr('fill', 'rgba(94,184,255,0.85)')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-family', "'IBM Plex Mono', monospace")
      .attr('display', showEdgeLabels ? 'block' : 'none')
    linkLabelsRef.current = linkLabels

    // Edge hover — thicken
    link.on('mouseenter', function(_event, _d) {
      d3.select(this).attr('stroke-width', (_d as GraphEdge).type === 'influence' ? 3 : 2)
    }).on('mouseleave', function(_event, d) {
      d3.select(this).attr('stroke-width', (d as GraphEdge).type === 'influence' ? 1.5 : 0.8)
    })

    linkLabelBg.on('mouseenter', function(_event, _d) {
      d3.select(this).attr('fill', 'rgba(94,184,255,0.15)')
    }).on('mouseleave', function(_event, _d) {
      d3.select(this).attr('fill', 'rgba(7,9,15,0.88)')
    })

    // Node groups
    const node = nodeGroupRef.current!.selectAll<SVGGElement, GraphNode>('g')
      .data(data.nodes)
      .join('g')
      .attr('cursor', 'pointer')
      .call(d3.drag<SVGGElement, GraphNode>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart()
          d.fx = d.x; d.fy = d.y
        })
        .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0)
          d.fx = null; d.fy = null
        })
      )

    // Node glow halo
    node.append('circle')
      .attr('r', d => 12 + (d.influence ?? 0) * 10 + 4)
      .attr('fill', d => nodeColor(d.type))
      .attr('opacity', 0.12)
      .style('pointer-events', 'none')

    // Node main circle
    node.append('circle')
      .attr('r', d => 12 + (d.influence ?? 0) * 10)
      .attr('fill', d => nodeColor(d.type) + '33')
      .attr('stroke', d => nodeColor(d.type))
      .attr('stroke-width', d => (d.influence ?? 0) > 0.5 ? 2 : 1.5)
      .attr('filter', 'url(#glow)')

    // Belief arc (blue ring showing belief degree)
    node.append('circle')
      .attr('r', d => 12 + (d.influence ?? 0) * 10)
      .attr('fill', 'none')
      .attr('stroke', '#5eb8ff')
      .attr('stroke-width', 1.5)
      .attr('opacity', 0.7)
      .attr('stroke-dasharray', d => {
        const circ = 2 * Math.PI * (12 + (d.influence ?? 0) * 10)
        const arc = (d.belief ?? 0.5) * circ
        return `${arc} ${circ}`
      })
      .attr('stroke-dashoffset', 0)
      .attr('transform', d => {
        const r = 12 + (d.influence ?? 0) * 10
        return `rotate(-90) translate(-${r},0)`
      })

    // Node labels
    node.append('text')
      .text(d => d.name)
      .attr('dy', d => (12 + (d.influence ?? 0) * 10) + 14)
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--text-secondary, #7a92a8)')
      .attr('font-size', '10px')
      .attr('font-family', "'IBM Plex Mono', monospace")
      .style('pointer-events', 'none')

    // Tooltip on hover
    node.on('mouseenter', function(_event, _d) {
      d3.select(this).select('circle:nth-child(2)').attr('stroke-width', 3)
    }).on('mouseleave', function(_event, d) {
      d3.select(this).select('circle:nth-child(2)').attr('stroke-width', (d.influence ?? 0) > 0.5 ? 2 : 1.5)
    }).on('click', (event, d) => {
      setSelectedNode(d)
      event.stopPropagation()
    })

    // Click on background to deselect
    svg.on('click', () => setSelectedNode(null))

    // Tick
    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as GraphNode).x ?? 0)
        .attr('y1', d => (d.source as GraphNode).y ?? 0)
        .attr('x2', d => (d.target as GraphNode).x ?? 0)
        .attr('y2', d => (d.target as GraphNode).y ?? 0)

      linkLabels.each(function(d) {
        const mid = getMidpoint(d)
        d3.select(this).attr('x', mid.x).attr('y', mid.y)
      })
      linkLabelBg.each(function(d, i) {
        const mid = getMidpoint(d)
        const textEl = linkLabels.nodes()[i]
        if (!textEl) return
        const bbox = textEl.getBBox()
        d3.select(this)
          .attr('x', mid.x - bbox.width / 2 - 3)
          .attr('y', mid.y - bbox.height / 2 - 1)
          .attr('width', bbox.width + 6)
          .attr('height', bbox.height + 3)
      })
      node.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    return () => { simulation.stop() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run])

  // Toggle edge labels reactively
  useEffect(() => {
    if (linkLabelsRef.current) linkLabelsRef.current.attr('display', showEdgeLabels ? 'block' : 'none')
    if (linkLabelBgRef.current) linkLabelBgRef.current.attr('display', showEdgeLabels ? 'block' : 'none')
  }, [showEdgeLabels])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Top-right controls */}
      <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 6, zIndex: 10 }}>
        {/* Edge labels toggle */}
        <button
          onClick={() => setShowEdgeLabels(v => !v)}
          style={{
            background: showEdgeLabels ? 'rgba(94,184,255,0.15)' : 'rgba(7,9,15,0.88)',
            border: `1px solid ${showEdgeLabels ? 'rgba(94,184,255,0.5)' : 'rgba(94,184,255,0.2)'}`,
            borderRadius: 6, padding: '4px 10px',
            color: showEdgeLabels ? '#5eb8ff' : 'rgba(122,146,168,0.7)',
            cursor: 'pointer', fontSize: '0.72rem',
            fontFamily: "'IBM Plex Mono', monospace",
          }}
        >LABELS</button>
        <button onClick={() => setSelectedNode(null)}
          style={{ background: 'rgba(7,9,15,0.88)', border: '1px solid rgba(94,184,255,0.2)', borderRadius: 6, padding: '4px 10px', color: 'rgba(122,146,168,0.7)', cursor: 'pointer', fontSize: '0.72rem', fontFamily: "'IBM Plex Mono', monospace" }}>
          RESET
        </button>
      </div>

      {/* Legend — bottom-right */}
      <div style={{ position: 'absolute', bottom: 8, right: 8, background: 'rgba(7,9,15,0.94)', border: '1px solid rgba(94,184,255,0.15)', borderRadius: 8, padding: '10px 14px', fontSize: '0.68rem', backdropFilter: 'blur(8px)', zIndex: 10 }}>
        <div style={{ color: 'rgba(122,146,168,0.5)', marginBottom: 6, fontFamily: "'IBM Plex Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '0.6rem' }}>Legend</div>
        {[['high-risk', '#ff3b5c', '高风险'], ['moderate', '#5eb8ff', '中风险'], ['low-risk', '#44ff88', '低风险']].map(([type, color, label]) => (
          <div key={type as string} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: color as string, boxShadow: `0 0 4px ${color as string}`, flexShrink: 0, display: 'inline-block' }} />
            <span style={{ color: 'rgba(122,146,168,0.8)' }}>{label as string}</span>
          </div>
        ))}
        <div style={{ borderTop: '1px solid rgba(94,184,255,0.1)', marginTop: 6, paddingTop: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <svg width="18" height="4" viewBox="0 0 18 4" style={{ flexShrink: 0 }}>
              <line x1="0" y1="2" x2="18" y2="2" stroke="rgba(255,209,102,0.7)" strokeWidth="1.5" strokeDasharray="5,3" />
            </svg>
            <span style={{ color: 'rgba(122,146,168,0.8)' }}>影响力</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="18" height="4" viewBox="0 0 18 4" style={{ flexShrink: 0 }}>
              <line x1="0" y1="2" x2="18" y2="2" stroke="rgba(94,184,255,0.4)" strokeWidth="0.8" />
            </svg>
            <span style={{ color: 'rgba(122,146,168,0.8)' }}>相似度</span>
          </div>
        </div>
      </div>

      {/* SVG Graph */}
      {graphData && graphData.nodes.length > 0 ? (
        <svg ref={svgRef} style={{ width: '100%', height: '100%', background: 'var(--bg-surface, #0d1520)' }} />
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 'var(--sp-3, 12px)', background: 'var(--bg-surface, #0d1520)' }}>
          <svg viewBox="0 0 64 64" fill="none" stroke="rgba(94,184,255,0.25)" strokeWidth="1.5" width="56" height="56">
            <circle cx="20" cy="20" r="5" />
            <circle cx="44" cy="16" r="4" />
            <circle cx="32" cy="44" r="6" />
            <circle cx="52" cy="38" r="3" />
            <circle cx="10" cy="44" r="3" />
            <line x1="23" y1="23" x2="40" y2="19" />
            <line x1="26" y1="26" x2="29" y2="40" />
            <line x1="46" y1="18" x2="50" y2="36" />
            <line x1="36" y1="43" x2="50" y2="39" />
          </svg>
          <span style={{ color: 'rgba(122,146,168,0.5)', fontSize: '0.8rem' }}>仿真完成后显示知识图谱</span>
        </div>
      )}

      {/* Node detail panel — bottom-left */}
      {selectedNode && (
        <div style={{
          position: 'absolute', bottom: 8, left: 8, width: 230,
          background: 'rgba(7,9,15,0.94)', border: `1px solid ${nodeColor(selectedNode.type)}66`,
          borderRadius: 10, padding: 14,
          backdropFilter: 'blur(12px)',
          boxShadow: `0 0 20px ${nodeColor(selectedNode.type)}22`,
          zIndex: 20,
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width: 10, height: 10, borderRadius: '50%',
                background: nodeColor(selectedNode.type),
                boxShadow: `0 0 6px ${nodeColor(selectedNode.type)}`,
                flexShrink: 0, display: 'inline-block',
              }} />
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: '0.82rem', color: nodeColor(selectedNode.type) }}>
                {selectedNode.name}
              </span>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              style={{
                background: 'none', border: 'none', color: 'rgba(122,146,168,0.6)',
                cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '0 2px',
                fontFamily: 'monospace',
              }}
              title="关闭"
            >×</button>
          </div>

          {/* Agent ID */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: '0.62rem', color: 'rgba(122,146,168,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2, fontFamily: "'IBM Plex Mono', monospace" }}>Agent ID</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.7rem', color: 'rgba(122,146,168,0.8)', wordBreak: 'break-all' }}>
              {run.final_states?.find(s => s.id === selectedNode.id)?.id ?? selectedNode.id}
            </div>
          </div>

          {/* Belief */}
          {selectedNode.belief != null && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: '0.62rem', color: 'rgba(122,146,168,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: "'IBM Plex Mono', monospace" }}>Belief</span>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.72rem', color: '#5eb8ff' }}>{(selectedNode.belief).toFixed(4)}</span>
              </div>
              <div style={{ height: 4, background: 'rgba(94,184,255,0.12)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(selectedNode.belief) * 100}%`, background: `linear-gradient(90deg, ${nodeColor(selectedNode.type)}88, ${nodeColor(selectedNode.type)})`, borderRadius: 99, transition: 'width 0.3s' }} />
              </div>
            </div>
          )}

          {/* Influence */}
          {selectedNode.influence != null && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: '0.62rem', color: 'rgba(122,146,168,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: "'IBM Plex Mono', monospace" }}>Influence</span>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.72rem', color: '#ffd166' }}>{(selectedNode.influence).toFixed(4)}</span>
              </div>
              <div style={{ height: 4, background: 'rgba(255,209,102,0.12)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(selectedNode.influence) * 100}%`, background: 'linear-gradient(90deg, rgba(255,209,102,0.5), #ffd166)', borderRadius: 99, transition: 'width 0.3s' }} />
              </div>
            </div>
          )}

          {/* Position */}
          {selectedNode.x != null && selectedNode.y != null && (
            <div>
              <div style={{ fontSize: '0.62rem', color: 'rgba(122,146,168,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2, fontFamily: "'IBM Plex Mono', monospace" }}>Position</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.68rem', color: 'rgba(122,146,168,0.6)' }}>
                x: {(selectedNode.x ?? 0).toFixed(1)} &nbsp; y: {(selectedNode.y ?? 0).toFixed(1)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── SimulationStreamPanel ──────────────────────────────────────────────────────
interface SimAction {
  id: string; agent_id: string; agent_name: string; action_type: string
  platform: string; action_args: Record<string, unknown>; round_num: number; timestamp: string
}
interface SimRunStatus {
  twitter_current_round: number; reddit_current_round: number; total_rounds: number
  twitter_completed: boolean; reddit_completed: boolean
  twitter_actions_count: number; reddit_actions_count: number
}

function SimulationStreamPanel({ runId }: { runId: string }) {
  const [runStatus, setRunStatus] = useState<SimRunStatus | null>(null)
  const [actions, setActions] = useState<SimAction[]>([])
  const timelineRef = useRef<HTMLDivElement>(null)
  const seenIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!runId) return
    seenIdsRef.current = new Set()
    setActions([]); setRunStatus(null)

    const poll = async () => {
      try {
        const [stRes, acRes] = await Promise.all([
          fetch(`/api/simulation/runs/${runId}/status`),
          fetch(`/api/simulation/runs/${runId}/detail`),
        ])
        if (stRes.ok) setRunStatus(await stRes.json() as SimRunStatus)
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

  const formatTime = (ts: string) => {
    try { return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false }) }
    catch (_) { return ts }
  }

  const previewText = (action: SimAction) => {
    const args = action.action_args || {}
    if (args.content) return String(args.content).slice(0, 60)
    if (args.text) return String(args.text).slice(0, 60)
    if (args.target_user) return `@${args.target_user}`
    if (args.post_id) return `[post ${args.post_id}]`
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
          background: 'rgba(7,9,15,0.6)', flexShrink: 0,
        }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Agent Action Stream
          </span>
          <span style={{ fontSize: '0.65rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)', opacity: 0.7 }}>
            {actions.length} actions
          </span>
        </div>

        <div ref={timelineRef} style={{ flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320 }}>
          {actions.length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', gap: 8 }}>
              <PulseDot />
              waiting for actions...
            </div>
          )}
          {actions.map((action, idx) => (
            <div key={action.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              background: '#ffffff', border: '1px solid #e8edf2',
              borderRadius: 6, padding: '8px 10px',
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                background: '#1a1f2e', border: '1.5px solid #3a4255',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.68rem', fontWeight: 700, color: '#5eb8ff',
                fontFamily: 'var(--font-mono)', marginTop: 1,
              }}>
                {(action.agent_name || action.agent_id || '?')[0].toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#1a1f2e', fontFamily: 'var(--font-mono)' }}>
                    {action.agent_name || action.agent_id}
                  </span>
                  <span style={{
                    fontSize: '0.6rem', fontFamily: 'var(--font-mono)', fontWeight: 600,
                    padding: '1px 5px', borderRadius: 3,
                    background: '#f0f3f7', color: ACTION_COLORS[action.action_type] || '#78909c',
                    letterSpacing: '0.04em', textTransform: 'uppercase',
                  }}>
                    {action.action_type}
                  </span>
                  <span style={{ fontSize: '0.62rem', color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>
                    [{action.platform}]
                  </span>
                  {idx === actions.length - 1 && (
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#5eb8ff', flexShrink: 0 }} />
                  )}
                </div>
                {previewText(action) && (
                  <div style={{ fontSize: '0.72rem', color: '#374151', lineHeight: 1.4 }}>
                    {previewText(action)}
                  </div>
                )}
                <div style={{ fontSize: '0.62rem', color: '#94a3b8', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                  R{action.round_num} · {formatTime(action.timestamp)}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{
          background: '#000', borderTop: '1px solid #1a1f2e',
          padding: '6px 12px', flexShrink: 0,
        }}>
          <div style={{ fontSize: '0.6rem', color: '#3a4a5a', fontFamily: 'JetBrains Mono, var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>
            system log
          </div>
          <div style={{ fontSize: '0.68rem', color: '#2a3a4a', fontFamily: 'JetBrains Mono, var(--font-mono)' }}>
            [{formatTime(new Date().toISOString())}]
            {actions.length > 0
              ? ` ${actions.length} events captured · stream active`
              : ' polling simulation stream...'}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
        {(['twitter', 'reddit'] as const).map(plat => {
          const ps = platformStatus(plat)
          return (
            <div key={plat} style={{
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', padding: '10px 12px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {plat === 'twitter' ? 'Info Plaza' : 'Topic Community'}
                </span>
                {ps.completed && (
                  <span style={{ fontSize: '0.6rem', color: 'var(--low)', fontFamily: 'var(--font-mono)' }}>done</span>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px' }}>
                <div>
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginBottom: 1 }}>Round</div>
                  <div style={{ fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>
                    {ps.round}<span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>/{ps.total}</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginBottom: 1 }}>Actions</div>
                  <div style={{ fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 600 }}>
                    {ps.actions}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 6, height: 2, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 99,
                  background: ps.completed ? 'var(--low)' : 'var(--accent)',
                  width: `${ps.total > 0 ? Math.min((ps.round / ps.total) * 100, 100) : 0}%`,
                  transition: 'width 0.4s ease',
                }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PulseDot() {
  return (
    <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', animation: 'pulse 1.2s ease-in-out infinite' }} />
  )
}

// ── Report Viewer ──────────────────────────────────────────────────────────────
interface ReportSection {
  id: string
  label: string
}

const REPORT_SECTION_LABELS: Record<string, string> = {
  'executive-summary': 'Executive Summary',
  'summary': 'Executive Summary',
  'background': 'Background',
  'analysis': 'Analysis',
  'prediction': 'Prediction',
  'recommendations': 'Recommendations',
  'recommendation': 'Recommendations',
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
  const uniqueSections = sections.filter((s, i) => sections.findIndex(x => x.label === s.label) === i)

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
                {sections.length} sections
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
              uniqueSections.map(section => (
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
    return <span className={`badge ${cls}`}><span className="badge-dot" />{status.toUpperCase()}</span>
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
          <div className="page-title">群体仿真</div>
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

      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 'var(--sp-4)', alignItems: 'start' }}>

        {/* ── Left: Controls ───────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>

          {/* Create Form */}
          <div className="panel">
            <div className="panel-header"><span className="panel-title">新建仿真</span><FishIcon /></div>
            <div className="panel-body">
              <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 'var(--sp-1)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>仿真主题</label>
                  <textarea
                    value={config.seed_content}
                    onChange={e => setConfig(p => ({ ...p, seed_content: e.target.value }))}
                    placeholder="例如：朝鲜半岛局势演化、中美贸易战走向、欧洲能源危机..."
                    rows={4}
                    style={{ ...inputStyle() as React.CSSProperties, resize: 'vertical' as const, lineHeight: 1.6 }}
                  />
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    输入任意议题，系统将自动构建知识图谱并推演演化趋势
                  </p>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 'var(--sp-1)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>最大轮次</label>
                  <input type="number" value={config.max_rounds} min={1} max={200}
                    onChange={e => setConfig(p => ({ ...p, max_rounds: parseInt(e.target.value) || 1 }))}
                    style={inputStyle()} />
                </div>
                <button type="submit" className="btn btn-primary" disabled={creating} style={{ width: '100%', justifyContent: 'center' }}>
                  {creating ? <><div className="spinner-sm" /> 创建中...</> : <><PlayIcon /> 启动仿真</>}
                </button>
              </form>
            </div>
          </div>

          {/* Runs List */}
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">仿真历史</span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{runs.length}</span>
            </div>
            {loadingRuns ? (
              <div className="empty-state"><div className="spinner" /></div>
            ) : runs.length === 0 ? (
              <div className="empty-state"><FishEmptyIcon /><p>暂无仿真记录<br />创建第一个仿真开始推演</p></div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: 'var(--sp-2)' }}>
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
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {run.run_id}
                        </span>
                        {statusBadge(run.status)}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {run.rounds_completed} 轮 · {run.convergence_achieved ? '已收敛 ✓' : '未收敛'}
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
        </div>

        {/* ── Right: Run Detail ─────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>

          {/* Knowledge Graph */}
          <div className="panel" style={{ height: 440 }}>
            <div className="panel-header">
              <span className="panel-title">知识图谱</span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {selectedRun ? `${selectedRun.final_states?.length ?? 0} agents` : '—'}
              </span>
            </div>
            <div style={{ height: 'calc(100% - 44px)', borderRadius: '0 0 var(--radius) var(--radius)', overflow: 'hidden' }}>
              {selectedRun ? (
                <KnowledgeGraphPanel run={selectedRun} />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 'var(--sp-3)', background: 'var(--bg-surface)' }}>
                  <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" width="56" height="56" opacity="0.3" style={{ color: 'var(--text-muted)' }}>
                    <path d="M8 32 Q20 18 40 32 Q20 46 8 32Z" /><circle cx="44" cy="32" r="5" /><path d="M48 24 L58 32 L48 40" />
                  </svg>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>选择一个仿真运行查看知识图谱</span>
                </div>
              )}
            </div>
          </div>

          {/* Simulation Stream Panel — visible while simulation is running OR just created */}
          {selectedRun && (selectedRun.status === 'running' || selectedRun.status === 'created') && (
            <div className="panel" style={{ height: 480 }}>
              <div className="panel-header">
                <span className="panel-title">仿真动作流</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                  <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', marginRight: 6, verticalAlign: 'middle', animation: 'pulse 1.2s ease-in-out infinite' }} />
                  LIVE
                </span>
              </div>
              <div style={{ height: 'calc(100% - 44px)', borderRadius: '0 0 var(--radius) var(--radius)', overflow: 'hidden', padding: 'var(--sp-2)' }}>
                <SimulationStreamPanel runId={selectedRun.run_id} />
              </div>
            </div>
          )}

          {/* Meta + Agent States */}
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">仿真详情</span>
              {selectedRun && statusBadge(selectedRun.status)}
            </div>
            {!selectedRun ? (
              <div className="empty-state" style={{ minHeight: 200 }}><FishEmptyIcon /><p>选择一个仿真运行查看详情</p></div>
            ) : (
              <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>

                {/* Progress */}
                {selectedRun.status === 'running' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 'var(--sp-2)' }}>
                      <span>仿真进度</span><span style={{ fontFamily: 'var(--font-mono)' }}>{selectedRun.rounds_completed} / {config.max_rounds}</span>
                    </div>
                    <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
                  </div>
                )}

                {/* Meta */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--sp-4)', fontSize: '0.83rem' }}>
                  {[
                    ['运行 ID', <span key="id" style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{selectedRun.run_id}</span>],
                    ['状态', statusBadge(selectedRun.status)],
                    ['完成轮次', selectedRun.rounds_completed],
                    ['收敛', selectedRun.convergence_achieved ? <span style={{ color: 'var(--low)' }}>已收敛</span> : '未收敛'],
                    ['耗时', selectedRun.duration_ms ? `${(selectedRun.duration_ms / 1000).toFixed(2)}s` : '—'],
                    ['创建时间', selectedRun.created_at ? new Date(selectedRun.created_at).toLocaleString('zh-CN') : '—'],
                  ].map(([label, value]) => (
                    <div key={label as string}>
                      <div style={{ color: 'var(--text-muted)', marginBottom: 3, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                      <div>{value}</div>
                    </div>
                  ))}
                </div>

                {/* Agent States Table */}
                {selectedRun.final_states && selectedRun.final_states.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--sp-3)' }}>
                      代理最终状态 ({selectedRun.final_states.length} agents)
                    </div>
                    <div style={{ overflowX: 'auto', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                      <table className="data-table">
                        <thead><tr><th>Agent</th><th>Belief</th><th>Influence</th><th>Lon</th><th>Lat</th></tr></thead>
                        <tbody>
                          {selectedRun.final_states.map(agent => (
                            <tr key={agent.id}>
                              <td className="mono text-accent">{agent.id}</td>
                              <td style={{ color: agent.belief > 0.7 ? 'var(--critical)' : agent.belief < 0.3 ? 'var(--low)' : 'inherit' }}>
                                {agent.belief.toFixed(4)}
                              </td>
                              <td>{agent.influence.toFixed(4)}</td>
                              <td className="mono">{agent.position[0].toFixed(4)}</td>
                              <td className="mono">{agent.position[1].toFixed(4)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Completed state viz */}
                {selectedRun.status === 'completed' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', padding: 'var(--sp-4)', background: 'var(--low-d)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(68,255,136,0.2)' }}>
                    <CheckIcon />
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--low)', fontSize: '0.875rem' }}>仿真已完成</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
                        {selectedRun.convergence_achieved ? '系统已达到均衡收敛' : '仿真完成，未达收敛条件'}
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
    background: rgba(7, 9, 15, 0.75);
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
