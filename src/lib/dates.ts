import {
  addDays,
  differenceInCalendarDays,
  format,
  isSameDay,
  isValid,
  parseISO,
  startOfDay,
} from "date-fns"
import type { Ev } from "./types"

/** "YYYY-MM-DD" in local time. */
export const dayKey = (d: Date) => format(d, "yyyy-MM-dd")

/** Local midnight for a "YYYY-MM-DD" string (never UTC-shifted). */
export function parseDay(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number)
  return new Date(y!, (m ?? 1) - 1, d ?? 1)
}

export function evStart(e: Pick<Ev, "start" | "allDay">): Date {
  return e.allDay ? parseDay(e.start) : parseISO(e.start)
}
export function evEnd(e: Pick<Ev, "end" | "allDay">): Date {
  return e.allDay ? parseDay(e.end) : parseISO(e.end)
}

/** Serialise Dates back to the storage format. */
export function toStore(start: Date, end: Date, allDay: boolean) {
  if (allDay) {
    const s = startOfDay(start)
    let e = startOfDay(end)
    if (e <= s) e = addDays(s, 1)
    return { start: dayKey(s), end: dayKey(e), allDay: true }
  }
  return { start: start.toISOString(), end: (end < start ? start : end).toISOString(), allDay: false }
}

/** Last day the event touches (inclusive). */
export function lastDay(e: Pick<Ev, "end" | "allDay" | "start">): Date {
  const end = evEnd(e)
  if (e.allDay) return addDays(end, -1)
  // A timed event ending exactly at midnight belongs to the previous day.
  if (end.getHours() === 0 && end.getMinutes() === 0 && end > evStart(e)) return addDays(startOfDay(end), -1)
  return startOfDay(end)
}

export function coversDay(e: Ev, day: Date): boolean {
  const d = startOfDay(day)
  return startOfDay(evStart(e)) <= d && lastDay(e) >= d
}

export function spanDays(e: Ev): number {
  return differenceInCalendarDays(lastDay(e), startOfDay(evStart(e))) + 1
}

export function daysOf(e: Ev): Date[] {
  const n = Math.min(spanDays(e), 366)
  const s = startOfDay(evStart(e))
  return Array.from({ length: n }, (_, i) => addDays(s, i))
}

export function rangeLabel(e: Ev): string {
  const s = evStart(e)
  const last = lastDay(e)
  if (e.allDay) {
    if (isSameDay(s, last)) return format(s, "EEE, d MMM yyyy")
    const sameYear = s.getFullYear() === last.getFullYear()
    return `${format(s, sameYear ? "d MMM" : "d MMM yyyy")} - ${format(last, "d MMM yyyy")}`
  }
  const end = evEnd(e)
  if (isSameDay(s, end)) return `${format(s, "EEE, d MMM")} · ${format(s, "HH:mm")}-${format(end, "HH:mm")}`
  return `${format(s, "d MMM HH:mm")} - ${format(end, "d MMM HH:mm")}`
}

/** Value for <input type="date"> from an event (inclusive end). */
export function inputDates(e: Pick<Ev, "start" | "end" | "allDay">) {
  const s = evStart(e)
  const last = lastDay(e as Ev)
  return {
    startDate: dayKey(s),
    endDate: dayKey(last),
    startTime: e.allDay ? "09:00" : format(s, "HH:mm"),
    endTime: e.allDay ? "10:00" : format(evEnd(e), "HH:mm"),
  }
}

/** Build stored start/end from form fields (end date inclusive in the form). */
export function fromInputs(v: {
  startDate: string
  endDate: string
  startTime: string
  endTime: string
  allDay: boolean
}) {
  const sd = parseDay(v.startDate)
  let ed = parseDay(v.endDate || v.startDate)
  if (ed < sd) ed = sd
  if (v.allDay) return { start: dayKey(sd), end: dayKey(addDays(ed, 1)), allDay: true }
  const [sh, sm] = v.startTime.split(":").map(Number)
  const [eh, em] = v.endTime.split(":").map(Number)
  const s = new Date(sd)
  s.setHours(sh ?? 9, sm ?? 0, 0, 0)
  const e = new Date(ed)
  e.setHours(eh ?? 10, em ?? 0, 0, 0)
  return { start: s.toISOString(), end: (e <= s ? new Date(s.getTime() + 30 * 60000) : e).toISOString(), allDay: false }
}

export function safeDate(v: unknown): Date | null {
  if (v instanceof Date) return isValid(v) ? v : null
  if (typeof v === "number") {
    // Google Sheets serial date (days since 1899-12-30).
    const d = new Date(Date.UTC(1899, 11, 30) + v * 864e5)
    return isValid(d) ? new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : null
  }
  if (typeof v !== "string" || !v.trim()) return null
  const s = v.trim()
  const iso = /^\d{4}-\d{2}-\d{2}/.test(s) ? (s.length === 10 ? parseDay(s) : parseISO(s)) : null
  if (iso && isValid(iso)) return iso
  // d/m/yyyy (Malaysian style) first, then whatever the browser understands.
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/)
  if (m) {
    const y = Number(m[3]!.length === 2 ? `20${m[3]}` : m[3])
    const d = new Date(y, Number(m[2]) - 1, Number(m[1]))
    if (isValid(d)) return d
  }
  const d = new Date(s)
  return isValid(d) ? d : null
}

export const relTime = (iso: string) => {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return "just now"
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`
  return format(new Date(iso), "d MMM yyyy")
}
