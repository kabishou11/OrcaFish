import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

interface Node {
  id: string;
  label: string;
  type: 'Person' | 'Organization' | 'Event' | 'Location';
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface Link {
  source: string | Node;
  target: string | Node;
  label: string;
  type: string;
}

interface GraphCanvasProps {
  nodes: Node[];
  links: Link[];
  onNodeClick?: (node: Node) => void;
  onLinkClick?: (link: Link) => void;
}

export const GraphCanvas: React.FC<GraphCanvasProps> = ({ nodes, links, onNodeClick, onLinkClick: _onLinkClick }) => {
  const svgRef = useRef<SVGSVGElement>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [_selectedNode, setSelectedNode] = useState<string | null>(null)

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    const g = svg.append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    const simulation = d3.forceSimulation(nodes as any)
      .force('link', d3.forceLink(links).id((d: any) => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(30));

    const link = g.append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', '#999')
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', 2);

    const linkLabel = g.append('g')
      .selectAll('text')
      .data(links)
      .join('text')
      .attr('font-size', 10)
      .attr('fill', '#666')
      .text((d) => d.label);

    const node = g.append('g')
      .selectAll('circle')
      .data(nodes)
      .join('circle')
      .attr('r', 8)
      .attr('fill', (d) => {
        const colors = { Person: '#4CAF50', Organization: '#2196F3', Event: '#FF9800', Location: '#9C27B0' };
        return colors[d.type];
      })
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .style('cursor', 'pointer')
      .call(d3.drag<any, Node>()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended) as any);

    const nodeLabel = g.append('g')
      .selectAll('text')
      .data(nodes)
      .join('text')
      .attr('font-size', 12)
      .attr('dx', 12)
      .attr('dy', 4)
      .text((d) => d.label);

    node.on('click', (_event, d) => {
      setSelectedNode(d.id);
      onNodeClick?.(d);
    });

    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      linkLabel
        .attr('x', (d: any) => (d.source.x + d.target.x) / 2)
        .attr('y', (d: any) => (d.source.y + d.target.y) / 2);

      node
        .attr('cx', (d: any) => d.x)
        .attr('cy', (d: any) => d.y);

      nodeLabel
        .attr('x', (d: any) => d.x)
        .attr('y', (d: any) => d.y);
    });

    function dragstarted(event: any, d: any) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event: any, d: any) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event: any, d: any) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

    return () => {
      simulation.stop();
    };
  }, [nodes, links, onNodeClick]);

  return (
    <div className="relative w-full h-full">
      <div className="absolute top-4 left-4 z-10">
        <input
          type="text"
          placeholder="搜索节点..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="px-4 py-2 bg-gray-800 text-white rounded-lg border border-gray-600"
        />
      </div>
      <svg ref={svgRef} className="w-full h-full bg-gray-900" />
    </div>
  );
};
