import { useEffect, useRef, useState } from 'react'
import { Deck } from '@deck.gl/core'
import { createCIIHeatmapLayer, getCIITooltip } from './CIIHeatmap'
import { createSignalLayer, getSignalTooltip } from './SignalLayer'

interface CIIScore {
  iso: string
  name?: string
  score: number
  level: string
}

interface Signal {
  id: string
  type: string
  lat: number
  lon: number
  intensity?: number
  timestamp?: string
}

interface DeckGLGlobeProps {
  ciiScores: CIIScore[]
  signals: Signal[]
  layersVisible: { cii: boolean; signals: boolean }
  onCountryClick?: (iso: string) => void
}

export function DeckGLGlobe({ ciiScores, signals, layersVisible, onCountryClick }: DeckGLGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const deckRef = useRef<Deck | null>(null)
  const [countriesGeoJson, setCountriesGeoJson] = useState<any>(null)

  useEffect(() => {
    fetch('https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson')
      .then(r => r.json())
      .then(setCountriesGeoJson)
      .catch(console.error)
  }, [])

  useEffect(() => {
    if (!containerRef.current || !countriesGeoJson) return

    const deck = new Deck({
      canvas: 'deck-canvas',
      width: '100%',
      height: '100%',
      initialViewState: {
        longitude: 0,
        latitude: 20,
        zoom: 1,
        pitch: 0,
        bearing: 0,
      },
      controller: true,
      layers: [
        createCIIHeatmapLayer(countriesGeoJson, ciiScores, layersVisible.cii),
        createSignalLayer(signals, layersVisible.signals),
      ],
      getTooltip: ({ object, layer }: any) => {
        if (layer?.id === 'cii-heatmap') return getCIITooltip({ object } as any, ciiScores)
        if (layer?.id === 'signals') return getSignalTooltip({ object } as any)
        return null
      },
      onClick: ({ object, layer }: any) => {
        if (layer?.id === 'cii-heatmap' && object && onCountryClick) {
          const code = object.properties?.ISO_A2
          if (code) onCountryClick(code)
        }
      },
    })

    deckRef.current = deck
    return () => {
      deck.finalize()
      deckRef.current = null
    }
  }, [countriesGeoJson, ciiScores, signals, layersVisible, onCountryClick])

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas id="deck-canvas" style={{ width: '100%', height: '100%' }} />
    </div>
  )
}
