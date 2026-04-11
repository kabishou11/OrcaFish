import { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'

const Dashboard = lazy(() => import('./components/Dashboard'))
const Intelligence = lazy(() => import('./components/Intelligence/IntelligencePage'))
const AnalysisPage = lazy(() => import('./components/Analysis/AnalysisPage'))
const SimulationPage = lazy(() => import('./components/Simulation/SimulationPage'))
const PipelinePage = lazy(() => import('./components/Pipeline/PipelinePage'))

/* ── Inline SVG icons ────────────────────────────────────────────────── */
const IconRadar = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="8" cy="8" r="6" />
    <circle cx="8" cy="8" r="3" />
    <line x1="8" y1="2" x2="8" y2="4" />
    <path d="M5.5 10.5 L4 12" />
  </svg>
)

const IconSearch = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="7" cy="7" r="4.5" />
    <line x1="10.5" y1="10.5" x2="14" y2="14" />
  </svg>
)

const IconChart = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="2,11 6,6 9,8.5 14,3" />
    <line x1="2" y1="14" x2="14" y2="14" />
  </svg>
)

const IconPipeline = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="3" cy="8" r="1.5" fill="currentColor" />
    <line x1="4.5" y1="8" x2="7" y2="8" />
    <circle cx="9" cy="8" r="1.5" />
    <line x1="10.5" y1="8" x2="12.5" y2="8" />
    <circle cx="14" cy="8" r="1.5" fill="currentColor" />
  </svg>
)

const IconDashboard = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="5" height="5" rx="1" />
    <rect x="9" y="2" width="5" height="5" rx="1" />
    <rect x="2" y="9" width="5" height="5" rx="1" />
    <rect x="9" y="9" width="5" height="5" rx="1" />
  </svg>
)

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <header className="app-header">
          {/* Logo */}
          <div className="header-logo">
            <div className="header-logo-icon">
              <svg viewBox="0 0 14 14" fill="white" width="14" height="14">
                <path d="M2 7 Q5 3.5 8 7 Q5 10.5 2 7Z" />
                <circle cx="9.5" cy="7" r="1.2" />
                <path d="M10.5 4.5 L13 7 L10.5 9.5" />
              </svg>
            </div>
            <div>
              <span className="header-logo-name">Orca<span>Fish</span></span>
              <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', fontWeight: 400, marginTop: 1, letterSpacing: '0.04em' }}>预见中枢</div>
            </div>
          </div>

          {/* Nav */}
          <nav className="app-nav">
            <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <IconDashboard />
              预测总览
            </NavLink>
            <NavLink to="/intelligence" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <IconRadar />
              全球观测
            </NavLink>
            <NavLink to="/analysis" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <IconSearch />
              议题研判
            </NavLink>
            <NavLink to="/simulation" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <IconChart />
              未来推演
            </NavLink>
            <NavLink to="/pipeline" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <IconPipeline />
              自动流程
            </NavLink>
          </nav>

          {/* 实时状态 */}
          <div className="header-status">
            <span className="live-dot" />
            <span>实时</span>
          </div>
        </header>

        <main className="app-main">
          <Suspense fallback={(
            <div className="empty-state" style={{ minHeight: '60vh' }}>
              <div className="spinner" style={{ width: 32, height: 32 }} />
              <p>正在载入工作台...</p>
            </div>
          )}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/intelligence" element={<Intelligence />} />
              <Route path="/analysis" element={<AnalysisPage />} />
              <Route path="/simulation" element={<SimulationPage />} />
              <Route path="/pipeline" element={<PipelinePage />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </BrowserRouter>
  )
}
