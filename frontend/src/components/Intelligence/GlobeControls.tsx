interface globeControlsProps {
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
  domain = 'all',
  onDomainChange,
}: globeControlsProps) {
  return (
    <div style={{
      position: 'absolute',
      top: '16px',
      right: '16px',
      background: 'rgba(255,255,255,0.92)',
      border: '1px solid var(--border-bright)',
      borderRadius: 'var(--radius)',
      padding: '12px',
      minWidth: '160px',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.72rem',
      color: 'var(--text-primary)',
      backdropFilter: 'blur(8px)',
      boxShadow: 'var(--shadow)',
    }}>
      <div style={{ marginBottom: 10, fontWeight: 700, color: 'var(--accent)', fontSize: '0.7rem', letterSpacing: '0.04em' }}>图层控制</div>

      {[
        { key: 'cii' as const, label: 'CII 热力图' },
        { key: 'signals' as const, label: '信号标记' },
        { key: 'convergence' as const, label: '汇聚区域' },
      ].map(({ key, label }) => (
        <label key={key} style={{ display: 'flex', alignItems: 'center', marginBottom: 7, cursor: 'pointer', gap: 6 }}>
          <input
            type="checkbox"
            checked={layers[key]}
            onChange={() => onLayerToggle(key)}
            style={{ accentColor: 'var(--accent)' }}
          />
          {label}
        </label>
      ))}

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
        <div style={{ marginBottom: 6, color: 'var(--text-muted)', fontSize: '0.65rem' }}>领域筛选</div>
        <select
          value={domain}
          onChange={e => onDomainChange?.(e.target.value)}
          style={{
            width: '100%',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            borderRadius: 'var(--radius-sm)',
            padding: '4px 6px',
            fontSize: '0.7rem',
            fontFamily: 'var(--font-mono)',
            cursor: 'pointer',
          }}
        >
          {DOMAIN_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: 6 }}>
          <input
            type="checkbox"
            checked={autoRotate}
            onChange={onAutoRotateToggle}
            style={{ accentColor: 'var(--accent)' }}
          />
          自动旋转
        </label>
      </div>
    </div>
  )
}
