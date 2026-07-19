import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { panels } from '../registry.js'
import { CollectorToggle } from './Shell.js'

export function App() {
  return (
    <BrowserRouter>
      <div style={{ display: 'flex', height: '100vh' }}>
        <nav style={{
          width: 176, background: '#111827', borderRight: '1px solid #1f2937',
          display: 'flex', flexDirection: 'column', padding: '16px 8px', gap: 4
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', padding: '0 8px', marginBottom: 12 }}>
            mcpinv cockpit
          </div>
          {panels.map(p => (
            <NavLink
              key={p.id}
              to={p.route}
              style={({ isActive }) => ({
                padding: '6px 10px', borderRadius: 6, fontSize: 13, textDecoration: 'none',
                color: isActive ? '#f9fafb' : '#9ca3af',
                background: isActive ? '#1f2937' : 'transparent'
              })}
            >
              {p.label}
            </NavLink>
          ))}
          <div style={{ marginTop: 'auto', padding: '0 8px 8px', borderTop: '1px solid #1f2937', paddingTop: 12 }}>
            <CollectorToggle />
          </div>
        </nav>
        <main style={{ flex: 1, overflow: 'auto', padding: 24 }}>
          <Routes>
            <Route path="/" element={<Navigate to={panels[0].route} replace />} />
            {panels.map(p => (
              <Route key={p.id} path={p.route} element={<p.component />} />
            ))}
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
