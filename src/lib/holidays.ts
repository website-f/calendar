import { parseDay } from "./dates"
import type { Holiday } from "./types"

export const holidayStart = (h: Holiday) => parseDay(h.date)
export const holidayEnd = (h: Holiday) => parseDay(h.end > h.date ? h.end : h.date)

/** Days that should be shaded as non-working: national holidays, or every listed holiday
 *  once the workspace has picked a single state. */
export function offDayDates(holidays: Holiday[], region: string): Date[] {
  return holidays.filter((h) => h.national || region !== "ALL").map((h) => parseDay(h.date))
}

export function holidayWhere(h: Holiday): string {
  if (h.national) return "National public holiday"
  if (h.states.length > 4) return `Public holiday in ${h.states.slice(0, 4).join(", ")} and ${h.states.length - 4} more`
  return `Public holiday in ${h.states.join(", ")}`
}

export function holidaysOn(holidays: Holiday[], day: string): Holiday[] {
  return holidays.filter((h) => h.date <= day && (h.end > day || h.date === day))
}
