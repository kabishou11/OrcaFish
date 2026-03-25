# Globe Visualization System

Replicated from WorldMonitor's Globe visualization architecture.

## Components

### GlobeVisualization.tsx
Main 3D globe using globe.gl with:
- Earth texture and night sky background
- CII country heatmap with 5-level color gradient
- Signal markers with pulse animations
- Country click interactions
- Auto-rotation controls

### SignalLayer.tsx
Signal visualization for deck.gl:
- 10 signal types with distinct colors
- Scatterplot layer with intensity-based sizing
- Tooltip with signal details

### CIIHeatmap.tsx
CII heatmap for deck.gl:
- GeoJSON country polygons
- 5-level color mapping (low/normal/elevated/high/critical)
- Country tooltips with CII scores

### GlobeControls.tsx
Control panel UI:
- Layer toggles (CII/Signals/Convergence)
- Auto-rotate switch
- Optional timeline slider

### GlobeContainer.tsx
Integrated container managing state and layout

### DeckGLGlobe.tsx
Alternative deck.gl-based implementation (2D map mode)

## Usage

```tsx
import { GlobeContainer } from '@/components/Intelligence'

<GlobeContainer
  ciiScores={ciiScores}
  signals={signals}
  onCountryClick={(iso) => console.log(iso)}
/>
```

## API Integration

Connect to backend endpoints:
- `/api/intelligence/cii` - CII scores
- `/api/intelligence/signals` - Signal data

## Dependencies

- globe.gl ^2.45.1
- @deck.gl/core ^9.0.16
- @deck.gl/layers ^9.0.16
- @deck.gl/geo-layers ^9.0.16
