import { useEffect, useState, useRef, useCallback } from 'react'

interface Signal {
  id: string; type: string; country?: string; lat?: number; lon?: number;
  intensity?: number; timestamp?: string; cii_score?: number;
  description?: string
}
interface CIIScore {
  iso: string; name?: string; score: number; level: string;
  lat?: number; lon?: number; components?: Record<string, number>
}
interface WMStatus {
  running: boolean; last_poll: string | null; poll_interval: number;
  cii_threshold: number; data_sources?: string[]
}

// ── CII globe colors (matches WorldMonitor aesthetic) ──────────────────────────
const CII_GLOBE_COLORS: Record<string, string> = {
  low:      '#28b43c',
  normal:   '#dcc832',
  elevated: '#f08c1e',
  high:     '#dc3214',
  critical: '#8c0a00',
}

const SIGNAL_COLORS: Record<string, string> = {
  military: 'var(--critical)', protest: 'var(--high)', internet_outage: 'var(--medium)',
  diplomatic: 'var(--accent)', economic: '#c084fc', humanitarian: 'var(--low)',
}

const LEVEL_ZH: Record<string, string> = {
  low: '低', normal: '正常', elevated: '偏高', high: '高', critical: '紧急',
}

// ── Signal feed constants ─────────────────────────────────────────────────────
const SIGNAL_TYPE_DOT: Record<string, string> = {
  military: '#dc3214', protest: '#dc3214', conflict: '#dc3214',
  economic: '#28b43c', diplomatic: '#3b82f6',
  humanitarian: '#9ca3af',
}
const SIGNAL_TYPE_ZH: Record<string, string> = {
  military: '军事', protest: '冲突', conflict: '冲突',
  internet_outage: '网络', diplomatic: '外交',
  economic: '经济', humanitarian: '人道',
}

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 0) return '刚刚'
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}秒前`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}小时前`
  return `${Math.floor(hr / 24)}天前`
}

// Inject signal-feed CSS once
if (typeof document !== 'undefined' && !document.getElementById('signal-feed-css')) {
  const s = document.createElement('style')
  s.id = 'signal-feed-css'
  s.textContent = `
    @keyframes signal-slide-in {
      0% { opacity: 0; transform: translateY(-18px); max-height: 0; }
      100% { opacity: 1; transform: translateY(0); max-height: 120px; }
    }
    @keyframes live-pulse {
      0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(34,197,94,0.5); }
      50% { opacity: 0.7; box-shadow: 0 0 0 6px rgba(34,197,94,0); }
    }
    .signal-feed-item { animation: signal-slide-in 0.35s ease-out both; }
    .live-pulse-dot {
      width: 8px; height: 8px; border-radius: 50%; background: #22c55e;
      display: inline-block; animation: live-pulse 2s ease-in-out infinite;
    }
  `
  document.head.appendChild(s)
}

// ISO-3166-1 alpha-2 → approximate lat/lon (centroid)
const COUNTRY_COORDS: Record<string, [number, number]> = {
  UA: [48.4, 31.2], RU: [61.5, 105.3], CN: [35.9, 104.2], US: [37.1, -95.7],
  IR: [32.4, 53.7], KP: [40.3, 127.5], TW: [23.7, 121.0], IN: [20.6, 78.9],
  PK: [30.4, 69.3], TR: [38.9, 35.2], SA: [23.9, 45.1], EG: [26.8, 30.8],
  NG: [9.1, 8.7], ZA: [-30.6, 22.9], KE: [-0.0, 37.9], ET: [9.1, 40.5],
  GB: [55.4, -3.4], FR: [46.2, 2.2], DE: [51.2, 10.4], IT: [41.9, 12.6],
  ES: [40.5, -3.7], PL: [51.9, 19.1], BR: [-14.2, -51.9], AR: [-38.4, -63.6],
  MX: [23.6, -102.6], CA: [56.1, -106.3], AU: [-25.3, 133.8], NZ: [-40.9, 174.9],
  JP: [36.2, 138.2], KR: [35.9, 127.8], TH: [15.9, 100.9], VN: [14.1, 108.3],
  ID: [-0.8, 113.9], MY: [4.2, 108.0], PH: [12.9, 121.8], MM: [21.9, 95.9],
  BD: [23.7, 90.4], AF: [33.9, 67.7], IQ: [33.2, 43.7], SY: [34.8, 39.0],
  YE: [15.6, 48.5], LY: [26.3, 17.2], SD: [12.9, 30.2], MR: [21.0, 10.9],
  VE: [6.4, -66.6], CO: [4.6, -74.1], PE: [-9.2, -75.0], CL: [-35.7, -71.5],
  AZ: [40.1, 47.6], GE: [42.3, 43.4], AM: [40.1, 45.0], BY: [53.7, 28.0],
  LT: [55.2, 23.9], LV: [56.9, 24.6], EE: [58.6, 25.0], FI: [61.9, 25.7],
  SE: [60.1, 18.6], NO: [60.5, 8.5], DK: [56.3, 9.5], NL: [52.1, 5.3],
  BE: [50.5, 4.5], AT: [47.5, 14.6], CH: [46.8, 8.2], PT: [39.4, -8.2],
  GR: [39.1, 21.8], CZ: [49.8, 15.5], HU: [47.2, 19.5], RO: [45.9, 24.9],
  BG: [42.7, 25.5], RS: [44.0, 21.0], HR: [45.1, 15.5], BA: [43.9, 17.7],
  AL: [41.2, 20.2], MK: [41.5, 21.7], ME: [42.7, 19.3], MD: [47.4, 28.4],
  SK: [48.7, 19.7], SI: [46.1, 14.8], MN: [46.8, 103.0], KZ: [48.0, 66.9],
  UZ: [41.4, 64.6], TM: [40.1, 59.4], TJ: [38.9, 71.0], KG: [41.2, 74.8],
  AZ2: [40.1, 47.6], TM2: [40.1, 59.4], // duplicate aliases
}

// ── Globe Panel ──────────────────────────────────────────────────────────────
function GlobePanel({ ciiScores, signals }: { ciiScores: CIIScore[]; signals: Signal[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const globeRef = useRef<{ stopAutoRotation: () => void; pauseAnimate: () => void } | null>(null)
  const [globeReady, setGlobeReady] = useState(false)
  const [globeError, setGlobeError] = useState<string | null>(null)
  const [selectedCountry, setSelectedCountry] = useState<CIIScore | null>(null)

  useEffect(() => {
    if (!containerRef.current || !ciiScores.length) return
    let globe: ReturnType<typeof import('globe.gl')['default']> | null = null
    let destroyed = false

    const init = async () => {
      try {
        // Load globe.gl library
        const mod = await import('globe.gl')
        if (destroyed) return
        const Globe = mod.default

        // Fetch country GeoJSON with fallback URLs
        let countriesData: { features: unknown[] } | null = null
        const geoUrls = [
          'https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson',
          'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json',
        ]
        for (const url of geoUrls) {
          try {
            const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
            if (r.ok) {
              const json = await r.json()
              if (json.type === 'Topology' && json.objects?.countries) {
                // TopoJSON → GeoJSON conversion
                const { feature } = await import('topojson-client') as { feature: (t: unknown, o: unknown) => { type: string; features: unknown[] } }
                countriesData = feature(json as unknown as Parameters<typeof feature>[0], json.objects.countries as Parameters<typeof feature>[1]) as { features: unknown[] }
              } else if (json.features) {
                // Already GeoJSON
                countriesData = json as { features: unknown[] }
              }
              if (countriesData?.features?.length) break
            }
          } catch { /* try next */ }
        }
        if (destroyed) return

        // Build globe if we have data
        if (!containerRef.current || !countriesData?.features?.length) {
          setGlobeError('无法加载地理数据，请检查网络连接')
          return
        }

        // Use new Globe(element, config) constructor like WorldMonitor
        globe = new (Globe as any)(containerRef.current, { animateIn: false })

        globe!
          .globeImageUrl('//unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
          .backgroundImageUrl('//unpkg.com/three-globe/example/img/blue-sky.png')
          .atmosphereColor('#4466cc')
          .atmosphereAltitude(0.18)
          .showGraticules(false)
          .width(containerRef.current!.clientWidth || 600)
          .height(containerRef.current!.clientHeight || 420)

        // Polygon setup — cast to any like WorldMonitor does
        ;(globe as any)
          .polygonsData(countriesData.features)
          .polygonSideColor(() => 'rgba(0,0,0,0)')
          .polygonStrokeColor(() => 'rgba(40,100,160,0.3)')
          .polygonCapColor((feat: Record<string, unknown>) => {
            const props = feat.properties as Record<string, string> | undefined
            const code = props?.['ISO_A2']
            if (!code || code === '-99') return 'rgba(0,0,0,0)'
            const score = ciiScores.find(c => c.iso === code)
            if (!score) return 'rgba(15,30,50,0.4)'
            return CII_GLOBE_COLORS[score.level] + '88'
          })
          .polygonLabel((feat: Record<string, unknown>) => {
            const props = feat.properties as Record<string, string> | undefined
            const code = props?.['ISO_A2']
            if (!code || code === '-99') return ''
            const score = ciiScores.find(c => c.iso === code)
            if (!score) return ''
            return `<div style="background:rgba(255,255,255,0.95);border:1px solid ${CII_GLOBE_COLORS[score.level]};border-radius:6px;padding:6px 10px;font-family:'IBM Plex Mono',monospace;font-size:12px;line-height:1.6;color:var(--text-primary)">
              <b style="color:${CII_GLOBE_COLORS[score.level]}">${code}</b>
              <br/>CII <b>${score.score.toFixed(1)}</b>
              <br/><span style="color:${CII_GLOBE_COLORS[score.level]};font-size:10px">${score.level.toUpperCase()}</span>
            </div>`
          })

        // Signal markers
        const signalMarkers = signals
          .filter(s => s.lat != null && s.lon != null)
          .map(s => ({ ...s, _lat: s.lat!, _lng: s.lon! }))

        if (signalMarkers.length > 0) {
          ;(globe as any)
            .htmlElementsData(signalMarkers)
            .htmlLat((d: Record<string, unknown>) => d._lat as number)
            .htmlLng((d: Record<string, unknown>) => d._lng as number)
            .htmlAltitude(() => 0.015)
            .htmlElement((d: Record<string, unknown>) => {
              const el = document.createElement('div')
              const color = SIGNAL_COLORS[d.type as string] || 'var(--accent)'
              el.innerHTML = `<div style="
                width:10px;height:10px;border-radius:50%;
                background:${color};
                box-shadow:0 0 8px ${color};
                animation:pulse-signal 1.5s ease-in-out infinite;
              "></div>`
              return el
            })
        }

        globe!.onGlobeClick(({ lat, lng }: { lat: number; lng: number }) => {
          let nearest: CIIScore | null = null
          let minDist = Infinity
          for (const c of ciiScores) {
            const [clat, clon] = COUNTRY_COORDS[c.iso] || []
            if (clat == null) continue
            const dist = Math.hypot(lat - clat, lng - clon)
            if (dist < minDist) { minDist = dist; nearest = c }
          }
          if (nearest && minDist < 30) setSelectedCountry(nearest)
        })

        const ctrl = globe!.controls()
        ctrl.autoRotate = true
        ctrl.autoRotateSpeed = 0.4
        ctrl.enableZoom = true
        ctrl.minDistance = 150
        ctrl.maxDistance = 600

        if (selectedCountry) {
          const coords = COUNTRY_COORDS[selectedCountry.iso]
          if (coords) globe!.pointOfView({ lat: coords[0], lng: coords[1], altitude: 2.0 }, 1000)
        }

        if (destroyed) {
          try { (globe as unknown as { destroy: () => void }).destroy() } catch { /* noop */ }
          return
        }

        globeRef.current = globe
        setGlobeError(null)
        setGlobeReady(true)

        if (!document.getElementById('globe-css')) {
          const style = document.createElement('style')
          style.id = 'globe-css'
          style.textContent = `
            @keyframes pulse-signal {
              0%,100% { opacity:1; transform:scale(1); }
              50% { opacity:0.6; transform:scale(0.7); }
            }
          `
          document.head.appendChild(style)
        }

      } catch (err) {
        if (destroyed) return
        const msg = err instanceof Error ? err.message : '未知错误'
        console.error('[GlobePanel] init error:', err)
        setGlobeError(`地球加载失败: ${msg}`)
      }
    }

    init()
    return () => {
      destroyed = true
      if (globeRef.current) {
        try { (globeRef.current as unknown as { destroy: () => void }).destroy() } catch { /* noop */ }
        globeRef.current = null
      }
      setGlobeReady(false)
    }
  }, [ciiScores.length, signals.length]) // re-init only when data changes

  // Resize handler
  useEffect(() => {
    if (!globeReady || !containerRef.current || !globeRef.current) return
    const observer = new ResizeObserver(() => {
      if (containerRef.current && globeRef.current) {
        try {
          const el = containerRef.current.querySelector('canvas')
          if (el) {
            const w = containerRef.current.clientWidth
            const h = containerRef.current.clientHeight
            el.setAttribute('width', String(w))
            el.setAttribute('height', String(h))
          }
        } catch { /* noop */ }
      }
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [globeReady])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', borderRadius: 'var(--radius)', overflow: 'hidden' }} />
      {!globeReady && !globeError && ciiScores.length > 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-surface)', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          <div className="spinner" />
          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>正在加载 3D 地球...</span>
        </div>
      )}
      {globeError && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 'var(--sp-3)', background: 'var(--bg-surface)' }}>
          <GlobeEmptyIcon />
          <span style={{ color: 'var(--high)', fontSize: '0.8rem', textAlign: 'center', maxWidth: 280 }}>{globeError}</span>
          <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '4px 12px' }}
            onClick={() => { setGlobeError(null); setGlobeReady(false) }}>
            重试
          </button>
        </div>
      )}
      {ciiScores.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          <GlobeEmptyIcon />
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>启动监控以加载 CII 数据</span>
        </div>
      )}
      {/* CII Legend */}
      <div style={{
        position: 'absolute', bottom: 16, left: 16,
        background: 'rgba(255,255,255,0.95)', border: '1px solid var(--border-bright)',
        borderRadius: 'var(--radius-sm)', padding: 'var(--sp-3)',
        backdropFilter: 'blur(8px)', fontSize: '0.7rem',
      }}>
        <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '0.65rem' }}>风险层级</div>
        {Object.entries(CII_GLOBE_COLORS).map(([level, color]) => (
          <div key={level} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}`, flexShrink: 0, display: 'inline-block' }} />
            <span style={{ color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{level}</span>
          </div>
        ))}
      </div>
      {/* Selected country panel */}
      {selectedCountry && (
        <div style={{
          position: 'absolute', top: 16, right: 16, width: 220,
          background: 'rgba(255,255,255,0.95)', border: `1px solid ${CII_GLOBE_COLORS[selectedCountry.level] || 'var(--accent)'}`,
          borderRadius: 'var(--radius)', padding: 'var(--sp-4)',
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1rem', color: CII_GLOBE_COLORS[selectedCountry.level] }}>
              {selectedCountry.iso}
            </span>
            <button onClick={() => setSelectedCountry(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }}>
              <CloseIcon />
            </button>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '2rem', fontWeight: 700, color: CII_GLOBE_COLORS[selectedCountry.level], lineHeight: 1 }}>
            {selectedCountry.score.toFixed(1)}
            <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>/100</span>
          </div>
          <div style={{ marginTop: 6, fontSize: '0.72rem', color: CII_GLOBE_COLORS[selectedCountry.level], textTransform: 'uppercase' }}>
            {selectedCountry.level}
          </div>
          {selectedCountry.components && (
            <div style={{ marginTop: 'var(--sp-3)', borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-2)' }}>
              {Object.entries(selectedCountry.components).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', marginBottom: 2 }}>
                  <span style={{ color: 'var(--text-muted)', textTransform: 'capitalize' }}>{k}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: CII_GLOBE_COLORS[selectedCountry.level] }}>
                    {(v as number).toFixed(3)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Intelligence Page ────────────────────────────────────────────────────
export default function Intelligence() {
  const [signals, setSignals] = useState<Signal[]>([])
  const [ciiScores, setCiiScores] = useState<CIIScore[]>([])
  const [wmStatus, setWmStatus] = useState<WMStatus>({ running: false, last_poll: null, poll_interval: 300, cii_threshold: 65 })
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'signals' | 'cii' | 'monitor'>('signals')
  const [selectedCountry, setSelectedCountry] = useState<CIIScore | null>(null)
  const [domain, setDomain] = useState('all')
  const [feedSignals, setFeedSignals] = useState<Signal[]>([])
  const feedSeenIds = useRef(new Set<string>())

  // ── Independent 10s signal feed polling ─────────────────────────
  const fetchFeed = useCallback(async () => {
    try {
      const res = await fetch(`/api/intelligence/signals${domain && domain !== 'all' ? `?domain=${domain}` : ''}`)
      if (!res.ok) return
      const d = await res.json()
      const flat: Signal[] = []
      for (const cluster of d.clusters ?? []) {
        for (const sig of cluster.signals ?? []) {
          const id = `${cluster.country_iso}-${sig.signal_type}-${sig.timestamp ?? ''}`
          flat.push({
            id,
            type: sig.signal_type,
            country: cluster.country_iso,
            lat: sig.lat ?? undefined,
            lon: sig.lon ?? undefined,
            intensity: sig.count ?? sig.intensity ?? 1,
            timestamp: sig.timestamp ?? new Date().toISOString(),
            cii_score: cluster.convergence_score ?? 0,
            description: sig.description ?? sig.summary ?? `${SIGNAL_TYPE_ZH[sig.signal_type] ?? sig.signal_type}信号`,
          })
        }
      }
      // Sort by timestamp descending
      flat.sort((a, b) => new Date(b.timestamp!).getTime() - new Date(a.timestamp!).getTime())
      setFeedSignals(prev => {
        const merged = [...flat]
        // Keep old items that are not in new batch
        for (const old of prev) {
          if (!flat.find(f => f.id === old.id)) merged.push(old)
        }
        merged.sort((a, b) => new Date(b.timestamp!).getTime() - new Date(a.timestamp!).getTime())
        return merged.slice(0, 50)
      })
      // Track which IDs we've seen for "new" animation
      for (const s of flat) feedSeenIds.current.add(s.id)
    } catch { /* silent */ }
  }, [domain])

  useEffect(() => {
    fetchFeed()
    const t = setInterval(fetchFeed, 10000)
    return () => clearInterval(t)
  }, [fetchFeed])

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [sigRes, ciiRes, wmRes] = await Promise.all([
          fetch(`/api/intelligence/signals${domain && domain !== 'all' ? `?domain=${domain}` : ''}`),
          fetch(`/api/intelligence/cii`),
          fetch('/api/intelligence/world-monitor/status'),
        ])
        if (sigRes.ok) {
          const d = await sigRes.json()
          // Flatten cluster signals into flat Signal[] for the globe map
          const flat: Signal[] = []
          for (const cluster of d.clusters ?? []) {
            for (const sig of cluster.signals ?? []) {
              flat.push({
                id: `${cluster.country_iso}-${sig.signal_type}`,
                type: sig.signal_type,
                country: cluster.country_iso,
                lat: sig.lat ?? undefined,
                lon: sig.lon ?? undefined,
                intensity: sig.count ?? 1,
                timestamp: sig.timestamp ?? undefined,
                cii_score: cluster.convergence_score ?? 0,
              })
            }
          }
          setSignals(flat)
        }
        if (ciiRes.ok) {
          const d = await ciiRes.json()
          const scores: CIIScore[] = []
          for (const [iso, val] of Object.entries<Record<string, unknown>>(d.scores ?? {})) {
            const v = val as Record<string, unknown>
            const coord = COUNTRY_COORDS[iso]
            scores.push({
              iso, name: v.name as string,
              score: (v.score as number) ?? 0,
              level: (v.level as string) ?? 'low',
              lat: coord?.[0], lon: coord?.[1],
              components: v.components as Record<string, number>,
            })
          }
          // Sort by score descending
          scores.sort((a, b) => b.score - a.score)
          setCiiScores(scores)
        }
        if (wmRes.ok) setWmStatus(await wmRes.json())
      } catch { /* silent */ }
      setLoading(false)
    }
    fetchData()
    const t = setInterval(fetchData, 15000)
    return () => clearInterval(t)
  }, [domain])

  const toggleMonitor = async () => {
    const ep = wmStatus.running ? '/api/intelligence/world-monitor/stop' : '/api/intelligence/world-monitor/start'
    await fetch(ep, { method: 'POST' })
    const res = await fetch('/api/intelligence/world-monitor/status')
    if (res.ok) setWmStatus(await res.json())
  }

  const levelBadge = (level: string) => {
    const cls = level === 'critical' ? 'badge-critical' : level === 'high' ? 'badge-high' : level === 'medium' || level === 'elevated' ? 'badge-medium' : 'badge-low'
    return <span className={`badge ${cls}`}><span className="badge-dot" />{LEVEL_ZH[level] ?? level}</span>
  }

  const scoreColor = (score: number) =>
    score >= 65 ? 'var(--critical)' : score >= 45 ? 'var(--high)' : score >= 25 ? 'var(--medium)' : 'var(--low)'

  // Top countries for globe
  const topCountries = ciiScores.slice(0, 15)
  const criticalCount = ciiScores.filter(c => c.level === 'critical' || c.level === 'high').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>

      {/* ── Page Header ────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <div className="page-title">全球观测</div>
          <div className="page-subtitle">全球地缘信号实时监控 · 危机强度指数 · 信号汇聚分析</div>
        </div>
        <div className="flex gap-3">
          <span className="badge badge-active"><span className="badge-dot" />{ciiScores.length} 国</span>
          <select
            value={domain}
            onChange={e => setDomain(e.target.value)}
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-bright)',
              color: 'var(--text-primary)',
              borderRadius: 'var(--radius-sm)',
              padding: '4px 8px',
              fontSize: '0.75rem',
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
            }}
          >
            <option value="all">全部领域</option>
            <option value="military">军事 / 冲突</option>
            <option value="economic">经济 / 金融</option>
            <option value="diplomatic">外交 / 政治</option>
            <option value="humanitarian">人道 / 社会</option>
            <option value="info">信息 / 网络</option>
          </select>
          {criticalCount > 0 && (
            <span className="badge badge-critical"><span className="badge-dot" />{criticalCount} 高风险</span>
          )}
          <span className={`badge ${wmStatus.running ? 'badge-done' : 'badge-pending'}`}>
            <span className="badge-dot" />{wmStatus.running ? '监控中' : '已停止'}
          </span>
          <button className={`btn ${wmStatus.running ? 'btn-secondary' : 'btn-primary'}`} onClick={toggleMonitor}>
            <SignalIcon />
            {wmStatus.running ? '停止监控' : '启动监控'}
          </button>
        </div>
      </div>

      {/* ── Globe Map + CII Sidebar ─────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 'var(--sp-4)', height: 480, alignItems: 'start' }}>
        {/* Globe Map */}
        <div className="panel" style={{ height: 480 }}>
          <div className="panel-header">
            <span className="panel-title">3D 地球 CII 态势</span>
            <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {ciiScores.length} 个国家
              </span>
              <span className="live-dot" style={{ marginLeft: 4 }} />
            </div>
          </div>
          <div style={{ height: 'calc(100% - 44px)', borderRadius: '0 0 var(--radius) var(--radius)', overflow: 'hidden' }}>
            <GlobePanel ciiScores={ciiScores} signals={signals} />
          </div>
        </div>

        {/* CII Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', height: 480, overflow: 'hidden' }}>
          {/* Top risks */}
          <div className="panel" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="panel-header">
              <span className="panel-title">高风险国家</span>
              <span style={{ fontSize: '0.72rem', color: 'var(--critical)', fontFamily: 'var(--font-mono)' }}>{criticalCount}</span>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: '0 var(--sp-3) var(--sp-3)' }}>
              {topCountries.filter(c => c.score >= 45).length === 0 && !loading ? (
                <div style={{ textAlign: 'center', padding: 'var(--sp-6)', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                  暂无高风险国家
                </div>
              ) : (
                topCountries.filter(c => c.score >= 45).map(c => (
                  <div key={c.iso} onClick={() => setSelectedCountry(c)}
                    style={{
                      padding: 'var(--sp-2) var(--sp-3)', marginBottom: 4, borderRadius: 'var(--radius-sm)',
                      background: selectedCountry?.iso === c.iso ? CII_GLOBE_COLORS[c.level] + '22' : 'transparent',
                      border: `1px solid ${selectedCountry?.iso === c.iso ? CII_GLOBE_COLORS[c.level] : 'transparent'}`,
                      cursor: 'pointer', transition: 'all var(--t-fast)',
                      display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
                    }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.9rem', width: 36, color: CII_GLOBE_COLORS[c.level] }}>{c.iso}</span>
                    <div style={{ flex: 1, height: 3, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${c.score}%`, background: CII_GLOBE_COLORS[c.level], borderRadius: 99, boxShadow: `0 0 4px ${CII_GLOBE_COLORS[c.level]}88` }} />
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.85rem', color: CII_GLOBE_COLORS[c.level], width: 38, textAlign: 'right' }}>{c.score.toFixed(1)}</span>
                  </div>
                ))
              )}
              {topCountries.filter(c => c.score >= 45).length > 0 && topCountries.filter(c => c.score < 45).length > 0 && (
                <div style={{ borderTop: '1px solid var(--border)', marginTop: 'var(--sp-2)', paddingTop: 'var(--sp-2)' }}>
                  {topCountries.filter(c => c.score < 45).slice(0, 5).map(c => (
                    <div key={c.iso} onClick={() => setSelectedCountry(c)}
                      style={{
                        padding: 'var(--sp-1) var(--sp-3)', marginBottom: 2, borderRadius: 'var(--radius-sm)',
                        background: selectedCountry?.iso === c.iso ? CII_GLOBE_COLORS[c.level] + '22' : 'transparent',
                        cursor: 'pointer', transition: 'all var(--t-fast)',
                        display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', fontSize: '0.8rem',
                      }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, width: 36, color: 'var(--text-secondary)' }}>{c.iso}</span>
                      <div style={{ flex: 1, height: 2, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${c.score}%`, background: CII_GLOBE_COLORS[c.level], borderRadius: 99 }} />
                      </div>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: CII_GLOBE_COLORS[c.level], width: 38, textAlign: 'right' }}>{c.score.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Signal count */}
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">信号概览</span>
            </div>
            <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-3)' }}>
              {Object.entries(
                signals.reduce<Record<string, number>>((acc, s) => {
                  acc[s.type] = (acc[s.type] || 0) + 1
                  return acc
                }, {})
              ).slice(0, 4).map(([type, count]) => (
                <div key={type} style={{ padding: 'var(--sp-2)', background: 'var(--bg-overlay)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.4rem', fontWeight: 700, color: SIGNAL_COLORS[type] || 'var(--accent)' }}>{count}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: 2 }}>{type}</div>
                </div>
              ))}
              <div style={{ padding: 'var(--sp-2)', background: 'var(--bg-overlay)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.4rem', fontWeight: 700, color: 'var(--accent)' }}>{signals.length}</div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: 2 }}>总计</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Globe Statistics Bar ──────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 'var(--sp-5)', padding: 'var(--sp-3) var(--sp-4)',
        background: 'var(--bg-surface)', border: '1px solid var(--border-bright)',
        borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', fontFamily: 'var(--font-mono)',
        color: 'var(--text-muted)', alignItems: 'center',
      }}>
        <span>信号总数 <b style={{ color: 'var(--accent)' }}>{signals.length}</b></span>
        <span style={{ width: 1, height: 14, background: 'var(--border)' }} />
        <span>活跃国家 <b style={{ color: 'var(--text-primary)' }}>{new Set(signals.map(s => s.country).filter(Boolean)).size}</b></span>
        <span style={{ width: 1, height: 14, background: 'var(--border)' }} />
        <span>高危国家 <b style={{ color: 'var(--critical)' }}>{criticalCount}</b></span>
        <span style={{ width: 1, height: 14, background: 'var(--border)' }} />
        <span>信号流 <b style={{ color: 'var(--text-primary)' }}>{feedSignals.length}</b> 条</span>
      </div>

      {/* ── Real-time Signal Feed Panel ───────────────────────────── */}
      <div className="panel">
        <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="panel-title">实时信号流</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="live-pulse-dot" />
            <span style={{ fontSize: '0.72rem', color: '#22c55e', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>实时</span>
          </div>
        </div>
        <div style={{ height: 300, overflowY: 'auto', padding: '0 var(--sp-3) var(--sp-3)' }}>
          {feedSignals.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              暂无信号，等待数据采集...
            </div>
          ) : feedSignals.map((s, idx) => {
            const dotColor = SIGNAL_TYPE_DOT[s.type] ?? '#9ca3af'
            const intensityPct = Math.min((s.intensity ?? 0) * (s.intensity && s.intensity > 1 ? 1 : 100), 100)
            return (
              <div key={s.id} className="signal-feed-item" style={{
                padding: 'var(--sp-2) var(--sp-3)', marginBottom: 4,
                borderRadius: 'var(--radius-sm)', background: idx === 0 ? 'rgba(59,130,246,0.04)' : 'transparent',
                border: '1px solid var(--border)', transition: 'background 0.2s',
                animationDelay: `${Math.min(idx * 30, 300)}ms`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                  {/* Type dot */}
                  <span style={{
                    width: 10, height: 10, borderRadius: '50%', background: dotColor, flexShrink: 0,
                    boxShadow: `0 0 6px ${dotColor}88`,
                  }} />
                  {/* Country + description */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {s.country ?? '??'}
                      </span>
                      <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.description ?? `${SIGNAL_TYPE_ZH[s.type] ?? s.type}信号`}
                      </span>
                    </div>
                  </div>
                  {/* Timestamp */}
                  <span style={{
                    fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
                    whiteSpace: 'nowrap', flexShrink: 0,
                  }}>
                    {s.timestamp ? relativeTime(s.timestamp) : '—'}
                  </span>
                </div>
                {/* Intensity bar */}
                <div style={{ marginTop: 4, height: 2, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: `${intensityPct}%`, background: dotColor,
                    borderRadius: 99, transition: 'width 0.3s ease',
                  }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────── */}
      <div className="tab-nav">
        {(['signals', 'cii', 'monitor'] as const).map(tab => (
          <button key={tab} className={`tab-btn${activeTab === tab ? ' active' : ''}`} onClick={() => setActiveTab(tab)}>
            {tab === 'signals' ? '信号列表' : tab === 'cii' ? 'CII 详情' : '监控状态'}
          </button>
        ))}
      </div>

      {/* ── Signals Tab ────────────────────────────────────────────── */}
      {activeTab === 'signals' && (
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">情报信号</span>
            <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
              <span className="badge badge-active">{signals.length} 条</span>
            </div>
          </div>
          {loading ? (
            <div className="empty-state"><div className="spinner" /></div>
          ) : signals.length === 0 ? (
            <div className="empty-state">
              <RadarEmptyIcon />
              <p>暂无情报信号，请启动监控以采集数据</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead><tr><th>ID</th><th>类型</th><th>国家</th><th>CII</th><th>强度</th><th>时间</th></tr></thead>
                <tbody>
                  {signals.map(s => (
                    <tr key={s.id}>
                      <td className="mono text-accent">{s.id.slice(0, 16)}</td>
                      <td><SignalTypeBadge type={s.type} /></td>
                      <td>{s.country ?? '—'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: s.cii_score ? scoreColor(s.cii_score) : 'inherit' }}>
                        {s.cii_score ? s.cii_score.toFixed(1) : '—'}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: s.intensity && s.intensity > 0.7 ? 'var(--critical)' : 'inherit' }}>
                        {s.intensity?.toFixed(3) ?? '—'}
                      </td>
                      <td className="mono text-muted">{s.timestamp ? new Date(s.timestamp).toLocaleString('zh-CN') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── CII Detail Tab ──────────────────────────────────────── */}
      {activeTab === 'cii' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--sp-3)' }}>
          {ciiScores.length === 0 && !loading && (
            <div className="panel" style={{ gridColumn: '1/-1' }}>
              <div className="empty-state"><p>暂无 CII 数据</p></div>
            </div>
          )}
          {ciiScores.map(c => (
            <div key={c.iso} className="panel" onClick={() => setSelectedCountry(c)}
              style={{ cursor: 'pointer', borderColor: selectedCountry?.iso === c.iso ? CII_GLOBE_COLORS[c.level] : undefined }}>
              <div className="panel-body">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--sp-3)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1.1rem' }}>{c.iso}</span>
                  {levelBadge(c.level)}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '2.2rem', fontWeight: 700, color: CII_GLOBE_COLORS[c.level], lineHeight: 1, marginBottom: 'var(--sp-3)' }}>
                  {c.score.toFixed(1)}<span style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>/100</span>
                </div>
                {/* Mini CII bar */}
                <div style={{ height: 3, background: 'var(--border)', borderRadius: 99, overflow: 'hidden', marginBottom: 'var(--sp-3)' }}>
                  <div style={{ height: '100%', width: `${c.score}%`, background: CII_GLOBE_COLORS[c.level], borderRadius: 99 }} />
                </div>
                {c.components && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)', borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-2)' }}>
                    {Object.entries(c.components).map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem' }}>
                        <span style={{ color: 'var(--text-muted)', textTransform: 'capitalize' }}>{k}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', color: CII_GLOBE_COLORS[c.level] }}>{(v as number).toFixed(3)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Monitor Status Tab ─────────────────────────────────────── */}
      {activeTab === 'monitor' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
          <div className="panel">
            <div className="panel-header"><span className="panel-title">运行时状态</span></div>
            <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)', fontSize: '0.85rem' }}>
              {[
                ['引擎状态', <span key="s" className={`badge ${wmStatus.running ? 'badge-done' : 'badge-pending'}`}><span className="badge-dot" />{wmStatus.running ? '运行中' : '已停止'}</span>],
                ['上次轮询', wmStatus.last_poll ? new Date(wmStatus.last_poll).toLocaleString('zh-CN') : '无记录'],
                ['轮询间隔', `${wmStatus.poll_interval} 秒`],
                ['CII 触发阈值', `${wmStatus.cii_threshold}`],
              ].map(([label, value]) => (
                <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                  <span>{value}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="panel">
            <div className="panel-header"><span className="panel-title">数据源</span></div>
            <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              {(wmStatus.data_sources || ['ACLED', 'UCDP', 'FlightRadar24', 'VesselFinder', 'OONI']).map(ds => (
                <div key={ds} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', fontSize: '0.85rem' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--low)', boxShadow: '0 0 6px var(--low)', flexShrink: 0 }} />
                  <span>{ds}</span>
                  <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.72rem', fontFamily: 'var(--font-mono)' }}>活跃</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Sub-components ──────────────────────────────────────────────────────── */
function SignalTypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    military: 'badge-critical', protest: 'badge-high', internet_outage: 'badge-medium',
    diplomatic: 'badge-normal', economic: 'badge-warning', humanitarian: 'badge-low',
  }
  return <span className={`badge ${map[type] ?? 'badge-pending'}`}>{type}</span>
}

function SignalIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" width="15" height="15">
      <circle cx="8" cy="8" r="5" />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
      <line x1="8" y1="3" x2="8" y2="1" />
    </svg>
  )
}

function RadarEmptyIcon() {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" width="56" height="56" opacity="0.4">
      <circle cx="32" cy="32" r="26" /><circle cx="32" cy="32" r="16" /><circle cx="32" cy="32" r="6" />
      <line x1="32" y1="6" x2="32" y2="14" /><line x1="32" y1="50" x2="32" y2="58" />
      <line x1="6" y1="32" x2="14" y2="32" /><line x1="50" y1="32" x2="58" y2="32" />
    </svg>
  )
}

function GlobeEmptyIcon() {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" width="64" height="64" opacity="0.3">
      <circle cx="32" cy="32" r="26" />
      <ellipse cx="32" cy="32" rx="10" ry="26" />
      <line x1="6" y1="32" x2="58" y2="32" />
      <line x1="32" y1="6" x2="32" y2="58" />
      <path d="M12 20 Q32 26 52 20" />
      <path d="M12 44 Q32 38 52 44" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" width="12" height="12">
      <line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" />
    </svg>
  )
}

