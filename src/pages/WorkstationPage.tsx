import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { DateSelectArg, EventClickArg } from '@fullcalendar/core'

import { WORKSTATIONS, type WorkstationId } from '../lib/constants'
import { createReservationRPC, getSettings, listReservations, type Reservation, type Settings } from '../lib/api'
import { Modal } from '../components/Modal'
import { supabase } from '../lib/supabase'

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  const yyyy = d.getFullYear()
  const mm = pad(d.getMonth() + 1)
  const dd = pad(d.getDate())
  const hh = pad(d.getHours())
  const min = pad(d.getMinutes())
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`
}

function minutesBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 60000)
}

function dayKey(d: Date) {
  // 0=Sun..6=Sat
  return String(d.getDay())
}

export function WorkstationPage() {
  const params = useParams()
  const wsId = (params.id ?? 'A') as WorkstationId
  const ws = WORKSTATIONS.find((w) => w.id === wsId) ?? WORKSTATIONS[0]
  // Public booking: users do not sign in.

  const [settings, setSettings] = useState<Settings | null>(null)
  const [range, setRange] = useState<{ start: Date; end: Date } | null>(null)
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [error, setError] = useState<string | null>(null)

  // modal state
  const [createModal, setCreateModal] = useState<{ start: Date; end: Date } | null>(null)
  const [detailModal, setDetailModal] = useState<Reservation | null>(null)
  const [saving, setSaving] = useState(false)
  const [occupancyByDate, setOccupancyByDate] = useState<Record<string, 'free' | 'partial' | 'full'>>({})

  useEffect(() => {
    getSettings().then(setSettings).catch(() => setSettings(null))
  }, [])

  const load = async (start: Date, end: Date) => {
    setError(null)
    try {
      const data = await listReservations({ workstationId: ws.id, startISO: start.toISOString(), endISO: end.toISOString() })
      setReservations(data)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load reservations.')
    }
  }

  useEffect(() => {
    if (!range) return
    load(range.start, range.end)
    // realtime updates on this workstation
    const channel = supabase
      .channel(`reservations-${ws.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reservations', filter: `workstation_id=eq.${ws.id}` },
        () => load(range.start, range.end)
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range?.start?.toISOString(), range?.end?.toISOString(), ws.id])

  const events = useMemo(() => {
    return reservations.map((r) => ({
      id: r.id,
      title: `${r.first_name} ${r.last_name}`,
      start: r.start_time,
      end: r.end_time,
      classNames: ['event-public']
    }))
  }, [reservations])

  useEffect(() => {
    if (!settings || !range) return
    setOccupancyByDate(computeOccupancyByDate({ settings, reservations, rangeStart: range.start, rangeEnd: range.end }))
  }, [settings, reservations, range])

  const validateClientSide = (start: Date, end: Date): string | null => {
    if (!settings) return null

    const mins = minutesBetween(start, end)
    if (mins < settings.min_slot_minutes) return `Minimum reservation is ${settings.min_slot_minutes} minutes.`
    if (mins > settings.max_slot_minutes) return `Maximum reservation is ${settings.max_slot_minutes} minutes.`

    const horizon = new Date()
    horizon.setDate(horizon.getDate() + settings.booking_horizon_days)
    if (start > horizon) return `Bookings are limited to ${settings.booking_horizon_days} days in advance.`

    const key = dayKey(start)
    const rule = settings.opening_hours_by_day?.[key]
    if (!rule?.enabled) return `This day is closed.`

    const [openH, openM] = rule.open.split(':').map(Number)
    const [closeH, closeM] = rule.close.split(':').map(Number)

    const open = new Date(start)
    open.setHours(openH, openM, 0, 0)
    const close = new Date(start)
    close.setHours(closeH, closeM, 0, 0)

    if (start < open || end > close) {
      return `Reservations must be within opening hours (${rule.open}–${rule.close}).`
    }

    return null
  }

  const onSelect = (arg: DateSelectArg) => {
    setError(null)
    const start = arg.start
    const end = arg.end
    const msg = validateClientSide(start, end)
    if (msg) {
      setError(msg)
      return
    }
    setCreateModal({ start, end })
  }

  const onEventClick = (arg: EventClickArg) => {
    const id = arg.event.id
    const r = reservations.find((x) => x.id === id)
    if (r) setDetailModal(r)
  }

  return (
    <main className="container">
      <h1 className="h1">{ws.name}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Drag to select a time range. Click a reservation for details.
      </p>

      {error && (
        <div className="alert" role="alert" aria-live="polite" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div className="card" style={{ padding: 12 }}>
        <FullCalendar
          plugins={[timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'timeGridDay,timeGridWeek' }}
          height="auto"
          selectable
          selectMirror
          nowIndicator
          allDaySlot={false}
          slotMinTime={settings ? minOpen(settings) : '07:00:00'}
          slotMaxTime={settings ? maxClose(settings) : '21:00:00'}
          weekends
          select={onSelect}
          events={events}
          eventClick={onEventClick}
          dayHeaderContent={(arg) => {
            const k = isoDateKey(arg.date)
            const state = occupancyByDate[k]
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{arg.text}</span>
                <span className={`daydot ${state ? `daydot-${state}` : 'daydot-free'}`} aria-label={state ?? 'free'} />
              </div>
            )
          }}
          datesSet={(arg) => {
            const start = arg.start
            const end = arg.end
            setRange({ start, end })
          }}
        />
      </div>

      {createModal && (
        <Modal title="Create reservation" onClose={() => setCreateModal(null)}>
          <CreateReservationForm
            start={createModal.start}
            end={createModal.end}
            onSubmit={async (payload) => {
              setSaving(true)
              setError(null)
              try {
                await createReservationRPC({
                  workstation_id: ws.id,
                  start_time: payload.start.toISOString(),
                  end_time: payload.end.toISOString(),
                  first_name: payload.firstName,
                  last_name: payload.lastName
                })
                setCreateModal(null)
                if (range) await load(range.start, range.end)
              } catch (e: any) {
                setError(e?.message ?? 'Could not create reservation.')
              } finally {
                setSaving(false)
              }
            }}
            saving={saving}
          />
        </Modal>
      )}

      {detailModal && (
        <Modal title="Reservation details" onClose={() => setDetailModal(null)}>
          <ReservationDetails
            reservation={detailModal}
            saving={saving}
          />
        </Modal>
      )}
    </main>
  )
}

function minOpen(settings: Settings) {
  // earliest open time among enabled days
  const vals = Object.values(settings.opening_hours_by_day || {}).filter((v) => v.enabled).map((v) => v.open)
  return (vals.sort()[0] ?? '07:00') + ':00'
}

function maxClose(settings: Settings) {
  const vals = Object.values(settings.opening_hours_by_day || {}).filter((v) => v.enabled).map((v) => v.close)
  return (vals.sort().slice(-1)[0] ?? '21:00') + ':00'
}

function CreateReservationForm({
  start,
  end,
  onSubmit,
  saving
}: {
  start: Date
  end: Date
  onSubmit: (payload: { start: Date; end: Date; firstName: string; lastName: string }) => Promise<void>
  saving: boolean
}) {
  const [startLocal, setStartLocal] = useState(toLocalInputValue(start))
  const [endLocal, setEndLocal] = useState(toLocalInputValue(end))
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const s = new Date(startLocal)
    const ee = new Date(endLocal)
    await onSubmit({ start: s, end: ee, firstName, lastName })
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="row">
        <label>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>First name</div>
          <input className="input" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </label>
        <label>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Last name</div>
          <input className="input" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </label>
      </div>
      <div className="row">
        <label>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Start</div>
          <input className="input" type="datetime-local" required value={startLocal} onChange={(e) => setStartLocal(e.target.value)} />
        </label>
        <label>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>End</div>
          <input className="input" type="datetime-local" required value={endLocal} onChange={(e) => setEndLocal(e.target.value)} />
        </label>
      </div>
      <button className="btn btn-primary" type="submit" disabled={saving}>
        {saving ? 'Booking…' : 'Book'}
      </button>
      <div className="muted" style={{ fontSize: 12 }}>
        Times are shown in your local timezone.
      </div>
    </form>
  )
}

function ReservationDetails({
  reservation,
  saving
}: {
  reservation: Reservation
  saving: boolean
}) {
  const start = new Date(reservation.start_time)
  const end = new Date(reservation.end_time)

  return (
    <div className="form">
      <div className="card" style={{ borderRadius: 14, padding: 12 }}>
        <div style={{ display: 'grid', gap: 8 }}>
          <div>
            <div className="muted" style={{ fontSize: 12, fontWeight: 800 }}>Reserved for</div>
            <div style={{ fontWeight: 800 }}>{reservation.first_name} {reservation.last_name}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12, fontWeight: 800 }}>Start</div>
            <div style={{ fontWeight: 800 }}>{start.toLocaleString()}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12, fontWeight: 800 }}>End</div>
            <div style={{ fontWeight: 800 }}>{end.toLocaleString()}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12, fontWeight: 800 }}>Status</div>
            <div style={{ fontWeight: 800 }}>{reservation.status}</div>
          </div>
        </div>
      </div>

      <div className="muted" style={{ fontSize: 12 }}>
        If a reservation looks suspicious, the administrator can delete it.
      </div>
    </div>
  )
}

function isoDateKey(d: Date) {
  // YYYY-MM-DD in local time
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function computeOccupancyByDate(params: {
  settings: Settings
  reservations: Reservation[]
  rangeStart: Date
  rangeEnd: Date
}): Record<string, 'free' | 'partial' | 'full'> {
  const { settings, reservations, rangeStart, rangeEnd } = params
  const out: Record<string, 'free' | 'partial' | 'full'> = {}

  const day = new Date(rangeStart)
  day.setHours(0, 0, 0, 0)

  const endDay = new Date(rangeEnd)
  endDay.setHours(0, 0, 0, 0)

  while (day <= endDay) {
    const key = String(day.getDay())
    const rule = settings.opening_hours_by_day?.[key]
    const k = isoDateKey(day)

    if (!rule?.enabled) {
      out[k] = 'free'
      day.setDate(day.getDate() + 1)
      continue
    }

    const [openH, openM] = rule.open.split(':').map(Number)
    const [closeH, closeM] = rule.close.split(':').map(Number)
    const open = new Date(day)
    open.setHours(openH, openM, 0, 0)
    const close = new Date(day)
    close.setHours(closeH, closeM, 0, 0)

    const availableMinutes = Math.max(0, Math.round((close.getTime() - open.getTime()) / 60000))

    let reservedMinutes = 0
    for (const r of reservations) {
      if (r.status !== 'ACTIVE') continue
      const rs = new Date(r.start_time)
      const re = new Date(r.end_time)
      // same date bucket
      if (isoDateKey(rs) !== k) continue
      const segStart = new Date(Math.max(rs.getTime(), open.getTime()))
      const segEnd = new Date(Math.min(re.getTime(), close.getTime()))
      const mins = Math.max(0, Math.round((segEnd.getTime() - segStart.getTime()) / 60000))
      reservedMinutes += mins
    }

    if (reservedMinutes <= 0) out[k] = 'free'
    else if (reservedMinutes >= availableMinutes && availableMinutes > 0) out[k] = 'full'
    else out[k] = 'partial'

    day.setDate(day.getDate() + 1)
  }
  return out
}
