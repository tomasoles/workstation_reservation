import React, { useEffect } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { applyThemeFromLogo } from './lib/theme'
import { Header } from './components/Header'
import { DashboardPage } from './pages/DashboardPage'
import { WorkstationPage } from './pages/WorkstationPage'
import { NotFoundPage } from './pages/NotFoundPage'

export function App() {
  useEffect(() => {
    applyThemeFromLogo('/logo.svg')
  }, [])

  return (
    <HashRouter>
      <div className="app-shell">
        <Header />

        <main className="main-content">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/workstations/:id" element={<WorkstationPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>

        <footer className="footer">
        <div className="footer-inner">
          Ⓒ Tomáš Oleš
        </div>
        </footer>
      </div>
    </HashRouter>
  )
}
