import { supabase } from './supabase'
import type { WorkstationId } from './constants'

export type Settings = {
  id: number
  max_capacity: number
  opening_hours_by_day: Record<string, { open: string; close: string; enabled: boolean }>
  min_slot_minutes: number
  max_slot_minutes: number
  booking_horizon_days: number
}

export type Reservation = {
  id: string
  workstation_id: WorkstationId
  user_id: string | null
  first_name: string
  last_name: string
  start_time: string
  end_time: string
  created_at: string
  status: 'ACTIVE' | 'CANCELLED'
}

export async function getSettings(): Promise<Settings> {
  const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single()
  if (error) throw error
  return data
}

export async function updateSettings(patch: Partial<Settings>) {
  const { error } = await supabase.from('settings').update(patch).eq('id', 1)
  if (error) throw error
}

/**
 * Lists reservations that overlap [startISO, endISO).
 * Overlap condition: start_time < endISO AND end_time > startISO.
 */
export async function listReservations(params: {
  workstationId?: WorkstationId
  startISO: string
  endISO: string
  includeCancelled?: boolean
}) {
  let q = supabase
    .from('reservations')
    .select('*')
    .lt('start_time', params.endISO)
    .gt('end_time', params.startISO)
    .order('start_time', { ascending: true })

  if (params.workstationId) q = q.eq('workstation_id', params.workstationId)
  if (!params.includeCancelled) q = q.eq('status', 'ACTIVE')

  const { data, error } = await q
  if (error) throw error
  return data as Reservation[]
}

export async function deleteReservation(id: string) {
  const { error } = await supabase.from('reservations').delete().eq('id', id)
  if (error) throw error
}

export async function createReservationRPC(args: {
  workstation_id: WorkstationId
  start_time: string
  end_time: string
  first_name: string
  last_name: string
}) {
  const { data, error } = await supabase.rpc('create_reservation', args)
  if (error) throw error
  // The RPC now returns { reservation_id: string } instead of { id: string }
  return data as { reservation_id: string }
}