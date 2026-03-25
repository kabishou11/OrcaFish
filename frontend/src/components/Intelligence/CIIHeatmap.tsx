import { GeoJsonLayer } from '@deck.gl/layers'
import type { PickingInfo } from '@deck.gl/core'

interface CIIScore {
  iso: string
  name?: string
  score: number
  level: string
}

const CII_COLORS: Record<string, [number, number, number, number]> = {
  low: [40, 180, 60, 136],
  normal: [220, 200, 50, 136],
  elevated: [240, 140, 30, 136],
  high: [220, 50, 20, 136],
  critical: [140, 10, 0, 136],
}

export function createCIIHeatmapLayer(countriesGeoJson: any, ciiScores: CIIScore[], visible = true) {
  return new GeoJsonLayer({
    id: 'cii-heatmap',
    data: countriesGeoJson,
    visible,
    pickable: true,
    stroked: true,
    filled: true,
    lineWidthMinPixels: 1,
    getFillColor: (f: any) => {
      const code = f.properties?.ISO_A2
      if (!code || code === '-99') return [0, 0, 0, 0]
      const score = ciiScores.find(c => c.iso === code)
      if (!score) return [15, 30, 50, 64]
      return CII_COLORS[score.level] || [15, 30, 50, 64]
    },
    getLineColor: [40, 100, 160, 76],
    getLineWidth: 1,
    updateTriggers: { getFillColor: ciiScores.length },
  })
}

export function getCIITooltip(info: PickingInfo, ciiScores: CIIScore[]): string | null {
  if (!info.object) return null
  const code = info.object.properties?.ISO_A2
  if (!code) return null
  const score = ciiScores.find(c => c.iso === code)
  if (!score) return null
  const color = CII_COLORS[score.level]
  return `<div style="background:rgba(7,9,15,0.95);border:1px solid rgb(${color[0]},${color[1]},${color[2]});border-radius:4px;padding:8px;font-family:monospace;font-size:11px;color:#dce8f5">
    <b style="color:rgb(${color[0]},${color[1]},${color[2]})">${code}</b> ${score.name || ''}<br/>
    CII Score: <b>${score.score.toFixed(1)}</b><br/>
    Level: <span style="color:rgb(${color[0]},${color[1]},${color[2]})">${score.level.toUpperCase()}</span>
  </div>`
}
