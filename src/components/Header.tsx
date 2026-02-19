import React, { useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'

export function Header() {
  const location = useLocation()

  const subtitle = useMemo(() => {
    if (location.pathname.startsWith('/workstations/')) return 'Calendar'
    return 'Dashboard'
  }, [location.pathname])

  return (
    <header className="header" role="banner">
      <div className="header-inner">
        <Link className="brand" to="/" aria-label="Go to dashboard">
          <img className="brand-logo" src="/logo.svg" alt="Logo" />
          <div className="brand-title">
            <div className="title">Workstation Reservations</div>
            <div className="subtitle">{subtitle}</div>
          </div>
        </Link>

        <nav className="nav" aria-label="Primary">
          <Link className="btn" to="/">Dashboard</Link>
        </nav>
      </div>
    </header>
  )
}
