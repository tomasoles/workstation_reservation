import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { WORKSTATIONS, type WorkstationId } from '../lib/constants'
import { getSettings, type Reservation, type Settings } from '../lib/api'
import { supabase } from '../lib/supabase'

function fmt(dt: Date) {
  return dt.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

type CardState = {
  now: Reservation | null
  next: Reservation | null
  day: 'free' | 'partial' | 'full'
}

export function DashboardPage() {
  const [map, setMap] = useState<Record<WorkstationId, CardState>>({
    A: { now: null, next: null, day: 'free' },
    B: { now: null, next: null, day: 'free' },
    C: { now: null, next: null, day: 'free' },
    D: { now: null, next: null, day: 'free' }
  })
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => {
    getSettings().then(setSettings).catch(() => setSettings(null))
  }, [])

  const refresh = async () => {
    setError(null)
    try {
      const now = new Date()
      const startISO = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
      const endISO = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString()

      // Fetch all upcoming/active reservations in a window, then compute card states client-side.
      const { data, error: qerr } = await supabase
        .from('reservations')
        .select('*')
        .eq('status', 'ACTIVE')
        .lt('start_time', endISO)
        .gt('end_time', startISO)
        .order('start_time', { ascending: true })

      if (qerr) throw qerr
      const reservations = (data ?? []) as Reservation[]

      const nextMap: Record<WorkstationId, CardState> = {
        A: { now: null, next: null, day: 'free' },
        B: { now: null, next: null, day: 'free' },
        C: { now: null, next: null, day: 'free' },
        D: { now: null, next: null, day: 'free' }
      }

      for (const ws of WORKSTATIONS) {
        const wsRes = reservations.filter((r) => r.workstation_id === ws.id)
        const current = wsRes.find((r) => new Date(r.start_time) <= now && now < new Date(r.end_time)) ?? null
        const upcoming = wsRes.find((r) => new Date(r.start_time) > now) ?? null
        const day = settings ? computeDayState(settings, wsRes, now) : 'free'
        nextMap[ws.id] = { now: current, next: upcoming, day }
      }

      setMap(nextMap)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load reservations.')
    }
  }

  useEffect(() => {
    refresh()
    const t = window.setInterval(refresh, 45_000)

    // Realtime updates
    const channel = supabase
      .channel('reservations-dashboard')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reservations' },
        () => {
          refresh()
        }
      )
      .subscribe()

    return () => {
      window.clearInterval(t)
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cards = useMemo(() => {
    const now = new Date()
    return WORKSTATIONS.map((ws) => {
      const state = map[ws.id]
      const isReserved = !!state.now
      const nextText = state.next ? fmt(new Date(state.next.start_time)) : '—'
      const statusText = isReserved ? 'Reserved now' : 'Available now'
      return { ws, isReserved, statusText, nextText, day: state.day, now }
    })
  }, [map])

  return (
    <main className="container">
      <h1 className="h1">Workstations</h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 760 }}>
        Pick a workstation to reserve. Status refreshes automatically.
      </p>

      {error && (
        <div className="alert" role="alert" aria-live="polite" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      <section className="grid grid-2" aria-label="Workstation cards">
        {cards.map(({ ws, isReserved, statusText, nextText, day }) => (
          <div key={ws.id} className="card ws-card">
            <div style={{ display: 'flex', alignItems: 'right', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ fontWeight: 900, fontSize: 18 }}>{ws.name}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className={`daydot daydot-${day}`} title={day === 'full' ? 'Fully booked today' : day === 'partial' ? 'Has bookings today' : 'Free today'} aria-label={day} />
                <span className="badge" aria-label={statusText}>
                  <span className={`dot ${isReserved ? 'dot-red' : 'dot-blue'}`} aria-hidden="true" />
                  {statusText}
                </span>
              </div>
            </div>

            <div className="kv">
              <span className="muted">Next reservation</span>
              <span style={{ fontWeight: 800 }}>{nextText}</span>
            </div>

            <div className="card-actions" style={{ justifyContent: 'flex-end' }}>
            <Link
              className="btn btn-primary"
              to={`/workstations/${ws.id}`}
              aria-label={`Calendar ${ws.name}`}
              onMouseEnter={e => (e.currentTarget.style.background = '#04459d')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              Calendar
            </Link>
          </div>
          </div>
        ))}
      </section>
    </main>
  )
}

function isoDateKey(d: Date) {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function computeDayState(settings: Settings, wsRes: Reservation[], today: Date): 'free' | 'partial' | 'full' {
  const key = String(today.getDay())
  const rule = settings.opening_hours_by_day?.[key]
  if (!rule?.enabled) return 'free'
  const [openH, openM] = rule.open.split(':').map(Number)
  const [closeH, closeM] = rule.close.split(':').map(Number)
  const open = new Date(today)
  open.setHours(openH, openM, 0, 0)
  const close = new Date(today)
  close.setHours(closeH, closeM, 0, 0)
  const availableMinutes = Math.max(0, Math.round((close.getTime() - open.getTime()) / 60000))
  let reservedMinutes = 0
  const k = isoDateKey(today)
  for (const r of wsRes) {
    if (r.status !== 'ACTIVE') continue
    const rs = new Date(r.start_time)
    if (isoDateKey(rs) !== k) continue
    const re = new Date(r.end_time)
    const segStart = new Date(Math.max(rs.getTime(), open.getTime()))
    const segEnd = new Date(Math.min(re.getTime(), close.getTime()))
    reservedMinutes += Math.max(0, Math.round((segEnd.getTime() - segStart.getTime()) / 60000))
  }
  if (reservedMinutes <= 0) return 'free'
  if (availableMinutes > 0 && reservedMinutes >= availableMinutes) return 'full'
  return 'partial'
}
