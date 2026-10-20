import type { Calendar, EventType as EngineEvent, RemoteCalendar } from '@/services/engine/scheduling'
import type { Connection } from '@/services/engine/account'
import type { BookingAction } from '@/services/engine/assistant-booking'
import type { OperatorBooking } from '@/services/engine/booking-operations'

export type CalendarOption = {
  id: string
  email: string
  provider: Calendar['provider']
  timezone: string
  calendar?: Calendar
  remote?: { connection: Connection; calendar: RemoteCalendar }
}

declare module '@/domain/types' {
  interface SchedulingAction { engineBookingActions?: BookingAction[] }
  interface EventType { engineEvent?: EngineEvent }
  interface Booking { engineBooking?: OperatorBooking }
  interface DemoDB {
    engineScheduling?: { calendars: CalendarOption[]; publicBaseUrl: string; bookingsReadable: boolean }
  }
}

export {}
