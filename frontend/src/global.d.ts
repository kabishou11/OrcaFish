/// <reference types="vite/client" />
/* OrcaFish — Global Type Declarations */

// globe.gl dynamic import types
declare module 'globe.gl' {
  export interface GlobeInstance {
    (container: HTMLElement, config?: Record<string, unknown>): GlobeInstance
    globeImageUrl(url: string): GlobeInstance
    backgroundImageUrl(url: string): GlobeInstance
    atmosphereColor(color: string): GlobeInstance
    atmosphereAltitude(alt: number): GlobeInstance
    showGraticules(show: boolean): GlobeInstance
    width(w: number): GlobeInstance
    height(h: number): GlobeInstance
    polygonsData(data: unknown[]): GlobeInstance
    polygonsSideColor(fn: () => string): GlobeInstance
    polygonStrokeColor(fn: () => string): GlobeInstance
    polygonCapColor(fn: (feat: Record<string, unknown>) => string): GlobeInstance
    polygonCapCurvatureRemainder(val: boolean): GlobeInstance
    polygonLabel(fn: (feat: Record<string, unknown>) => string): GlobeInstance
    htmlElementsData(data: unknown[]): GlobeInstance
    htmlLat(fn: (d: Record<string, unknown>) => number): GlobeInstance
    htmlLng(fn: (d: Record<string, unknown>) => number): GlobeInstance
    htmlAltitude(fn: (d: Record<string, unknown>) => number): GlobeInstance
    htmlElement(fn: (d: Record<string, unknown>) => HTMLElement): GlobeInstance
    arcsData(data: unknown[]): GlobeInstance
    pathsData(data: unknown[]): GlobeInstance
    onGlobeClick(handler: (point: { lat: number; lng: number }) => void): GlobeInstance
    controls(): {
      autoRotate: boolean; autoRotateSpeed: number
      enableZoom: boolean; minDistance: number; maxDistance: number
      enablePan?: boolean; zoomSpeed?: number
    }
    pointOfView(point: { lat: number; lng: number; altitude?: number }, duration?: number): GlobeInstance
    stopAutoRotation(): void
    pauseAnimate(): void
    destroy(): void
  }
  const Globe: {
    (): GlobeInstance
    (container: HTMLElement): GlobeInstance
  }
  export default Globe
}

// Vite env — types provided by vite/client
