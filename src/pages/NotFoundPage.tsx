import React from 'react'
import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <main className="container" style={{ maxWidth: 720 }}>
      <h1 className="h1">Page not found</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        That route doesn’t exist.
      </p>
      <Link className="btn btn-primary" to="/">Back to dashboard</Link>
    </main>
  )
}
