interface GlobeControlsProps {
  layers: { cii: boolean; signals: boolean; convergence: boolean }
  onLayerToggle: (layer: 'cii' | 'signals' | 'convergence') => void
  autoRotate: boolean
  onAutoRotateToggle: () => void
  timeRange?: [number, number]
  onTimeChange?: (time: number) => void
  domain?: string
  onDomainChange?: (domain: string) => void
}

const DOMAIN_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'military', label: '军事冲突' },
  { value: 'economic', label: '经济金融' },
  { value: 'diplomatic', label: '外交政治' },
  { value: 'humanitarian', label: '人道社会' },
  { value: 'info', label: '信息网络' },
]

export function GlobeControls({
  layers,
  onLayerToggle,
  autoRotate,
  onAutoRotateToggle,
  timeRange,
  onTimeChange,
  domain = 'all',
  onDomainChange,
}: GlobeControlsProps) {
  return (
    <div style={{
      position: 'absolute',
      top: '16px',
      right: '16px',
      background: 'rgba(7,9,15,0.9)',
      border: '1px solid rgba(40,100,160,0.3)',
      borderRadius: '8px',
      padding: '12px',
      minWidth: '180px',
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#dce8f5',
    }}>
      <div style={{ marginBottom: '12px', fontWeight: 'bold', color: '#5eb8ff' }}>Globe Layers</div>

      <label style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={layers.cii}
          onChange={() => onLayerToggle('cii')}
          style={{ marginRight: '8px' }}
        />
        CII Heatmap
      </label>

      <label style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={layers.signals}
          onChange={() => onLayerToggle('signals')}
          style={{ marginRight: '8px' }}
        />
        Signals
      </label>

      <label style={{ display: 'flex', alignItems: 'center', marginBottom: '12px', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={layers.convergence}
          onChange={() => onLayerToggle('convergence')}
          style={{ marginRight: '8px' }}
        />
        Convergence
      </label>

      <div style={{ borderTop: '1px solid rgba(40,100,160,0.3)', paddingTop: '12px', marginBottom: '12px' }}>
        <div style={{ marginBottom: '6px', color: '#5eb8ff', fontSize: '0.7rem' }}>Domain Filter</div>
        <select
          value={domain}
          onChange={e => onDomainChange?.(e.target.value)}
          style={{
            width: '100%',
            background: 'rgba(7,9,15,0.9)',
            border: '1px solid rgba(40,100,160,0.3)',
            color: '#dce8f5',
            borderRadius: '4px',
            padding: '4px',
            fontSize: '11px',
            fontFamily: 'monospace',
            cursor: 'pointer',
          }}
        >
          {DOMAIN_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div style={{ borderTop: '1px solid rgba(40,100,160,0.3)', paddingTop: '12px' }}>
        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={autoRotate}
            onChange={onAutoRotateToggle}
            style={{ marginRight: '8px' }}
          />
          Auto Rotate
        </label>
      </div>

      {timeRange && onTimeChange && (
        <div style={{ borderTop: '1px solid rgba(40,100,160,0.3)', paddingTop: '12px', marginTop: '12px' }}>
          <div style={{ marginBottom: '8px', color: '#5eb8ff' }}>Timeline</div>
          <input
            type="range"
            min={timeRange[0]}
            max={timeRange[1]}
            defaultValue={timeRange[1]}
            onChange={(e) => onTimeChange(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
      )}
    </div>
  )
}
