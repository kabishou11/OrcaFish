import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { GeoJSON, MapContainer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

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
  country?: string
  countryIso?: string
  lat?: number
  lon?: number
  intensity?: number
  timestamp?: string
  description?: string
  source?: string
}

interface FlatWorldMapProps {
  ciiScores: CIIScore[]
  signals: Signal[]
  onCountryClick?: (iso: string) => void
  domain?: string
  onDomainChange?: (domain: string) => void
}

interface GeoFeatureProperties {
  name?: string
  iso_a2?: string
  ISO_A2?: string
  adcode?: string
  'ISO3166-1-Alpha-2'?: string
  _iso?: string
}

type CountryFeature = Feature<Geometry, GeoFeatureProperties>
type CountryFeatureCollection = FeatureCollection<Geometry, GeoFeatureProperties>

const CII_COLORS: Record<string, string> = {
  low: '#2cbf4a',
  normal: '#d6bf2c',
  elevated: '#f18a20',
  high: '#e24b34',
  critical: '#8c1020',
}

const DOMAIN_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'military', label: '军事冲突' },
  { value: 'economic', label: '经济金融' },
  { value: 'diplomatic', label: '外交政治' },
  { value: 'humanitarian', label: '人道社会' },
  { value: 'info', label: '信息网络' },
]

const SIGNAL_COLORS: Record<string, string> = {
  military: '#ff4d4f',
  conflict: '#ff4d4f',
  protest: '#ff8c42',
  internet_outage: '#7c3aed',
  diplomatic: '#2563eb',
  economic: '#14b8a6',
  humanitarian: '#16a34a',
  default: '#2563eb',
}

const MAP_STYLE_ID = 'orcafish-flat-map-styles'

type GeoDataStatus = 'loading' | 'ready' | 'error'

function normalizeIso(value?: string): string | undefined {
  if (!value) return undefined
  const normalized = value.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(normalized) ? normalized : undefined
}

function createTooltipContent(title: string, lines: string[]): HTMLElement {
  const container = document.createElement('div')
  const titleNode = document.createElement('b')
  titleNode.textContent = title
  container.appendChild(titleNode)

  lines.forEach((line) => {
    container.appendChild(document.createElement('br'))
    container.appendChild(document.createTextNode(line))
  })

  return container
}

function ensureMapCss() {
  if (document.getElementById(MAP_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = MAP_STYLE_ID
  style.textContent = `
    @keyframes orcafishPulse {
      0%   { transform: scale(1); opacity: 0.85; }
      70%  { transform: scale(2.4); opacity: 0; }
      100% { transform: scale(2.4); opacity: 0; }
    }

    .orcafish-pulse {
      position: relative;
      width: 14px;
      height: 14px;
    }

    .orcafish-pulse::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background: var(--pulse-color, #2563eb);
      transform-origin: center center;
      animation: orcafishPulse 1.8s ease-out infinite;
    }

    .orcafish-pulse-core {
      position: absolute;
      border-radius: 50%;
      z-index: 1;
    }

    .orcafish-tooltip {
      background: rgba(255,255,255,0.96) !important;
      border: 1px solid #dbe7f3 !important;
      border-radius: 6px !important;
      color: #0f172a !important;
      font-size: 12px !important;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08) !important;
    }

    .orcafish-tooltip::before {
      display: none !important;
    }

    .leaflet-container {
      background: transparent !important;
    }

    .leaflet-control-zoom a {
      background: rgba(255,255,255,0.9) !important;
      color: #1e293b !important;
      border-color: #e2e8f0 !important;
    }

    .leaflet-control-attribution {
      display: none !important;
    }
  `
  document.head.appendChild(style)
}

function matchesDomain(signal: Signal, domain: string): boolean {
  if (domain === 'all') return true
  const type = signal.type.toLowerCase()

  switch (domain) {
    case 'military':
      return ['military', 'conflict', 'war', 'strike'].some((token) => type.includes(token))
    case 'economic':
      return ['economic', 'finance', 'trade', 'sanction', 'market'].some((token) => type.includes(token))
    case 'diplomatic':
      return ['diplomatic', 'politic', 'election', 'summit', 'negotiation'].some((token) => type.includes(token))
    case 'humanitarian':
      return ['humanitarian', 'protest', 'refugee', 'health', 'disaster'].some((token) => type.includes(token))
    case 'info':
      return ['info', 'internet', 'cyber', 'outage', 'disinformation'].some((token) => type.includes(token))
    default:
      return true
  }
}

function MapBridge({ onMapReady }: { onMapReady: (map: L.Map) => void }) {
  const map = useMap()

  useEffect(() => {
    onMapReady(map)
  }, [map, onMapReady])

  return null
}

export default function FlatWorldMap({
  ciiScores,
  signals,
  onCountryClick,
  domain = 'all',
  onDomainChange,
}: FlatWorldMapProps) {
  const [layers, setLayers] = useState({ cii: true, signals: true })
  const [geoData, setGeoData] = useState<CountryFeatureCollection | null>(null)
  const [geoDataStatus, setGeoDataStatus] = useState<GeoDataStatus>('loading')
  const markersLayerRef = useRef<L.LayerGroup | null>(null)
  const [mapReady, setMapReady] = useState(false)

  const scoreMap = useMemo(
    () => new Map(ciiScores.map((score) => [normalizeIso(score.iso) ?? score.iso, score])),
    [ciiScores]
  )

  const filteredSignals = useMemo(
    () => signals.filter((signal) => matchesDomain(signal, domain)),
    [signals, domain]
  )

  useEffect(() => {
    ensureMapCss()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setGeoDataStatus('loading')

    fetch('/data/countries.geojson', { signal: controller.signal })
      .then((response) => response.json() as Promise<CountryFeatureCollection>)
      .then((data) => {
        const features = (data.features ?? []).map((feature) => {
          const properties = feature.properties ?? {}
          const iso =
            normalizeIso(properties['ISO3166-1-Alpha-2']) ||
            normalizeIso(properties.iso_a2) ||
            normalizeIso(properties.ISO_A2) ||
            normalizeIso(properties.adcode) ||
            ''

          return {
            ...feature,
            properties: {
              ...properties,
              _iso: iso,
              name: properties.name || iso,
            },
          }
        })

        setGeoData({ ...data, features })
        setGeoDataStatus('ready')
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setGeoData(null)
        setGeoDataStatus('error')
      })

    return () => {
      controller.abort()
    }
  }, [])

  const handleMapReady = useCallback((map: L.Map) => {
    if (!markersLayerRef.current) {
      markersLayerRef.current = L.layerGroup().addTo(map)
    }
    setMapReady(true)
  }, [])

  const getCountryStyle = useCallback(
    (feature?: CountryFeature) => {
      const iso = feature?.properties?._iso ?? ''
      const score = scoreMap.get(iso)

      if (score && layers.cii) {
        return {
          fillColor: CII_COLORS[score.level] ?? '#cccccc',
          fillOpacity: 0.75,
          color: 'rgba(106,132,160,0.5)',
          weight: 0.7,
        }
      }

      return {
        fillColor: '#e8eef4',
        fillOpacity: layers.cii ? 0.55 : 0.35,
        color: 'rgba(106,132,160,0.5)',
        weight: 0.7,
      }
    },
    [layers.cii, scoreMap]
  )

  const bindCountryFeature = useCallback(
    (feature: CountryFeature, layer: L.Layer) => {
      if (!(layer instanceof L.Path)) return

      const iso = feature.properties?._iso ?? ''
      const score = scoreMap.get(iso)

      if (iso && onCountryClick) {
        layer.on('click', () => {
          onCountryClick(iso)
        })
      }

      layer.on('mouseover', () => {
        if (score) {
          layer.bindTooltip(
            createTooltipContent(score.name ?? iso, [`CII ${score.score.toFixed(1)} / 100`, score.level]),
            { sticky: true, className: 'orcafish-tooltip' }
          ).openTooltip()
          return
        }

        layer.bindTooltip(createTooltipContent(iso, ['暂无 CII 数据']), {
          sticky: true,
          className: 'orcafish-tooltip',
        }).openTooltip()
      })
    },
    [onCountryClick, scoreMap]
  )

  useEffect(() => {
    const group = markersLayerRef.current
    if (!group || !mapReady) return

    group.clearLayers()

    if (!layers.signals) return

    filteredSignals.forEach((signal) => {
      if (signal.lat == null || signal.lon == null) return

      const color = SIGNAL_COLORS[signal.type] ?? SIGNAL_COLORS.default
      const size = Math.max(8, Math.min((signal.intensity ?? 1) * 10, 22))
      const offset = (14 - size) / 2
      const safeDescription = signal.description?.trim() || signal.country?.trim() || signal.id

      const icon = L.divIcon({
        className: '',
        html: `<div class="orcafish-pulse" style="--pulse-color:${color}"><div class="orcafish-pulse-core" style="width:${size}px;height:${size}px;background:${color};top:${offset}px;left:${offset}px"></div></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      })

      const marker = L.marker([signal.lat, signal.lon], { icon })
      const signalIso = normalizeIso(signal.countryIso) ?? normalizeIso(signal.country)
      const signalTitle = signalIso ?? signal.country?.trim() ?? '热点'

      marker.bindTooltip(createTooltipContent(signalTitle, [safeDescription]), {
        className: 'orcafish-tooltip',
      })

      marker.on('click', () => {
        if (signalIso && onCountryClick) {
          onCountryClick(signalIso)
        }
      })

      group.addLayer(marker)
    })

    return () => {
      group.clearLayers()
    }
  }, [filteredSignals, layers.signals, mapReady, onCountryClick])

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: 'linear-gradient(180deg, #f8fbff, #eef5fb)',
      }}
    >
      {geoDataStatus !== 'ready' || !geoData ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted, #94a3b8)',
            fontSize: '0.82rem',
            zIndex: 400,
          }}
        >
          {geoDataStatus === 'error' ? '世界平面地图加载失败' : '正在加载世界平面地图…'}
        </div>
      ) : (
        <>
          <MapContainer
            crs={L.CRS.EPSG3857}
            center={[20, 10]}
            zoom={1.5}
            minZoom={1}
            maxZoom={8}
            style={{ width: '100%', height: '100%' }}
            zoomControl
            attributionControl={false}
          >
            <MapBridge onMapReady={handleMapReady} />
            {geoData ? <GeoJSON data={geoData} style={getCountryStyle} onEachFeature={bindCountryFeature} /> : null}
          </MapContainer>

          <div
            style={{
              position: 'absolute',
              top: 16,
              right: 16,
              minWidth: 196,
              background: 'rgba(255,255,255,0.95)',
              border: '1px solid var(--border, #e2e8f0)',
              borderRadius: 'var(--radius, 8px)',
              boxShadow: '0 1px 8px rgba(0,0,0,0.08)',
              backdropFilter: 'blur(8px)',
              padding: 12,
              display: 'grid',
              gap: 10,
              zIndex: 1000,
            }}
          >
            <div
              style={{
                fontSize: '0.68rem',
                color: 'var(--accent, #2563eb)',
                fontFamily: 'monospace',
                letterSpacing: '0.08em',
              }}
            >
              地图控制
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary, #64748b)', lineHeight: 1.5 }}>
              用平面世界地图查看风险热区与实时推送，不再使用旋转地球。
            </div>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: '0.74rem',
                color: 'var(--text-secondary, #64748b)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={layers.cii}
                onChange={() => setLayers((previous) => ({ ...previous, cii: !previous.cii }))}
              />
              风险热区
            </label>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: '0.74rem',
                color: 'var(--text-secondary, #64748b)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={layers.signals}
                onChange={() => setLayers((previous) => ({ ...previous, signals: !previous.signals }))}
              />
              实时信号
            </label>
            <div style={{ borderTop: '1px solid var(--border, #e2e8f0)', paddingTop: 10 }}>
              <div style={{ fontSize: '0.66rem', color: 'var(--text-muted, #94a3b8)', marginBottom: 6 }}>
                领域筛选
              </div>
              <select
                value={domain}
                onChange={(event) => onDomainChange?.(event.target.value)}
                style={{
                  width: '100%',
                  background: 'var(--bg-surface, #fff)',
                  border: '1px solid var(--border, #e2e8f0)',
                  color: 'var(--text-primary, #1e293b)',
                  borderRadius: '4px',
                  padding: '6px 8px',
                  fontSize: '0.72rem',
                }}
              >
                {DOMAIN_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
