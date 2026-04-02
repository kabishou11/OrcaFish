import { ScatterplotLayer } from '@deck.gl/layers'
import type { PickingInfo } from '@deck.gl/core'

interface Signal {
  id: string
  type: string
  lat: number
  lon: number
  intensity?: number
  timestamp?: string
}

const SIGNAL_COLORS: Record<string, [number, number, number]> = {
  military: [255, 59, 92],
  protest: [255, 140, 66],
  internet_outage: [255, 209, 102],
  diplomatic: [94, 184, 255],
  economic: [192, 132, 252],
  humanitarian: [68, 255, 136],
  cyber: [255, 102, 255],
  natural: [102, 255, 204],
  conflict: [255, 26, 26],
  default: [94, 184, 255],
}

export function createSignalLayer(signals: Signal[], visible = true) {
  return new ScatterplotLayer({
    id: 'signals',
    data: signals.filter(s => s.lat != null && s.lon != null),
    visible,
    pickable: true,
    opacity: 0.8,
    radiusScale: 1000,
    radiusMinPixels: 4,
    radiusMaxPixels: 12,
    getPosition: (d: Signal) => [d.lon, d.lat, 0],
    getRadius: (d: Signal) => (d.intensity || 50) * 100,
    getFillColor: (d: Signal) => SIGNAL_COLORS[d.type] || SIGNAL_COLORS.default,
    updateTriggers: { getPosition: signals.length, getFillColor: signals.length },
  })
}

export function getSignalTooltip(info: PickingInfo): string | null {
  if (!info.object) return null
  const s = info.object as Signal
  const color = SIGNAL_COLORS[s.type] || SIGNAL_COLORS.default
  return `<div style="background:#f0f4f8;border:1px solid rgb(${color.join(',')});border-radius:4px;padding:8px;font-family:monospace;font-size:11px;color:#1a2332">
    <b style="color:rgb(${color.join(',')})">${s.type.toUpperCase()}</b><br/>
    强度: ${s.intensity || 'N/A'}<br/>
    ${s.timestamp ? `时间: ${new Date(s.timestamp).toLocaleString()}` : ''}
  </div>`
}
