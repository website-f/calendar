import type { CalendarView } from "@/components/reui/event-calendar/event-calendar-types"
import type { GanttScale } from "@/components/reui/gantt/gantt-types"
import type { Ev, Holiday, Project, User } from "@/lib/types"

export type BoardMode = "calendar" | "gantt"
export const NONE = "__none"
export const HOLIDAY_ROW = "__holidays"
export const FALLBACK = "#6b7280"

export interface BoardProps {
  mode: BoardMode
  events: Ev[]
  projects: Project[]
  users: User[]
  readOnly?: boolean
  dayMarks?: Set<string>
  date: Date
  onDateChange: (d: Date) => void
  calView: CalendarView
  onCalViewChange: (v: CalendarView) => void
  scale: GanttScale
  onScaleChange: (s: GanttScale) => void
  onOpenEvent?: (id: string) => void
  onOpenDay?: (day: Date) => void
  onCreateRange?: (r: { start: string; end: string; allDay: boolean; projectId?: string | null }) => void
  onMove?: (id: string, r: { start: string; end: string; allDay: boolean }) => void
  onReorderEvents?: (changes: { id: string; sort: number; projectId: string | null }[]) => void
  onReorderProjects?: (ids: string[]) => void
  /** Public holidays to overlay (already filtered by region and visibility). */
  holidays?: Holiday[]
  /** Dates to shade as non-working days. */
  offDates?: Date[]
  className?: string
}

export function colorOf(e: Ev, projects: Project[]) {
  return e.color ?? projects.find((p) => p.id === e.projectId)?.color ?? FALLBACK
}

