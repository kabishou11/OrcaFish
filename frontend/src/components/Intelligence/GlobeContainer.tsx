import { useState } from 'react'
import { GlobeVisualization } from './GlobeVisualization'
import { GlobeControls } from './GlobeControls'

interface CIIScore {
  iso: string
  name?: string
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
  timestamp?: string
  description?: string
  source?: string
}

interface globeContainerProps {
  ciiScores: CIIScore[]
  signals: Signal[]
  onCountryClick?: (iso: string) => void
  domain?: string
  onDomainChange?: (domain: string) => void
}

export function GlobeContainer({ ciiScores, signals, onCountryClick, domain, onDomainChange }: globeContainerProps) {
  const [layers, setLayers] = useState({ cii: true, signals: true, convergence: false })
  const [autoRotate, setAutoRotate] = useState(true)

  const handleLayerToggle = (layer: 'cii' | 'signals' | 'convergence') => {
    setLayers(prev => ({ ...prev, [layer]: !prev[layer] }))
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <GlobeVisualization
        ciiScores={ciiScores}
        signals={signals}
        onCountryClick={onCountryClick}
        autoRotate={autoRotate}
        layers={layers}
      />
      <GlobeControls
        layers={layers}
        onLayerToggle={handleLayerToggle}
        autoRotate={autoRotate}
        onAutoRotateToggle={() => setAutoRotate(!autoRotate)}
        domain={domain}
        onDomainChange={onDomainChange}
      />
    </div>
  )
}
