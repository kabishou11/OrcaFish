import { useEffect, useRef, useState } from 'react'
import Globe from 'globe.gl'
import type { GlobeInstance } from 'globe.gl'

interface CIIScore {
  iso: string
  score: number
  level: string
  lat?: number
  lon?: number
}

interface Signal {
  id: string
  type: string
  lat?: number
  lon?: number
  intensity?: number
}

interface GlobeVisualizationProps {
  ciiScores: CIIScore[]
  signals: Signal[]
  onCountryClick?: (iso: string) => void
  autoRotate?: boolean
}

const CII_COLORS: Record<string, string> = {
  low: '#28b43c',
  normal: '#dcc832',
  elevated: '#f08c1e',
  high: '#dc3214',
  critical: '#8c0a00',
}

const SIGNAL_COLORS: Record<string, string> = {
  military: '#ff3b5c',
  protest: '#ff8c42',
  internet_outage: '#ffd166',
  diplomatic: '#5eb8ff',
  economic: '#c084fc',
  humanitarian: '#44ff88',
  cyber: '#ff66ff',
  natural: '#66ffcc',
  conflict: '#ff1a1a',
  default: '#5eb8ff',
}

export function GlobeVisualization({ ciiScores, signals, onCountryClick, autoRotate = true }: GlobeVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const globeRef = useRef<GlobeInstance | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    let destroyed = false
    let globe: GlobeInstance | null = null

    const init = async () => {
      try {
        const geoRes = await fetch('https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson')
        const countriesData = await geoRes.json()

        if (destroyed || !containerRef.current) return

        globe = Globe()(containerRef.current)
          .globeImageUrl('//unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
          .backgroundImageUrl('//unpkg.com/three-globe/example/img/blue-sky.png')
          .atmosphereColor('#4466cc')
          .atmosphereAltitude(0.18)
          .width(containerRef.current.clientWidth)
          .height(containerRef.current.clientHeight)

        globe
          .polygonsData(countriesData.features)
          .polygonsSideColor(() => 'rgba(0,0,0,0)')
          .polygonStrokeColor(() => 'rgba(40,100,160,0.3)')
          .polygonCapColor((feat: any) => {
            const code = feat.properties?.ISO_A2
            if (!code || code === '-99') return 'rgba(0,0,0,0)'
            const score = ciiScores.find(c => c.iso === code)
            if (!score) return 'rgba(15,30,50,0.4)'
            return CII_COLORS[score.level] + '88'
          })
          .polygonLabel((feat: any) => {
            const code = feat.properties?.ISO_A2
            if (!code) return ''
            const score = ciiScores.find(c => c.iso === code)
            if (!score) return ''
            return `<div style="background:#f0f4f8;border:1px solid ${CII_COLORS[score.level]};border-radius:6px;padding:6px 10px;font-family:monospace;font-size:12px;color:#1a2332">
              <b style="color:${CII_COLORS[score.level]}">${code}</b><br/>
              CII <b>${score.score.toFixed(1)}</b><br/>
              <span style="color:${CII_COLORS[score.level]};font-size:10px">${score.level.toUpperCase()}</span>
            </div>`
          })
          ;(globe as any).onPolygonClick((feat: any) => {
            const code = feat.properties?.ISO_A2
            if (code && onCountryClick) onCountryClick(code)
          })

        const signalMarkers = signals
          .filter(s => s.lat != null && s.lon != null)
          .map(s => ({ ...s, _lat: s.lat!, _lng: s.lon! }))

        if (signalMarkers.length > 0) {
          globe
            .htmlElementsData(signalMarkers)
            .htmlLat((d: any) => d._lat)
            .htmlLng((d: any) => d._lng)
            .htmlAltitude(() => 0.015)
            .htmlElement((d: any) => {
              const el = document.createElement('div')
              const color = SIGNAL_COLORS[d.type] || SIGNAL_COLORS.default
              el.innerHTML = `<div style="width:10px;height:10px;border-radius:50%;background:${color};box-shadow:0 0 8px ${color};animation:pulse-signal 1.5s ease-in-out infinite"></div>`
              return el
            })
        }

        const ctrl = globe.controls()
        ctrl.autoRotate = autoRotate
        ctrl.autoRotateSpeed = 0.4
        ctrl.enableZoom = true
        ctrl.minDistance = 150
        ctrl.maxDistance = 600

        globeRef.current = globe
        setError(null)

        if (!document.getElementById('globe-anim')) {
          const style = document.createElement('style')
          style.id = 'globe-anim'
          style.textContent = '@keyframes pulse-signal{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.6;transform:scale(0.7)}}'
          document.head.appendChild(style)
        }
      } catch (err) {
        if (!destroyed) setError(err instanceof Error ? err.message : 'Globe load failed')
      }
    }

    init()
    return () => {
      destroyed = true
      if (globeRef.current) {
        try { (globeRef.current as any)._destructor?.() } catch {}
        globeRef.current = null
      }
    }
  }, [ciiScores, signals, autoRotate, onCountryClick])

  if (error) return <div style={{ color: '#ff3b5c', padding: '20px' }}>Error: {error}</div>

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
