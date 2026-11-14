import { useMemo, useRef } from "react"
import { format } from "date-fns"
import { MapPinIcon, ListChecksIcon } from "lucide-react"
import { EventCalendar } from "@/components/reui/event-calendar/event-calendar"
import { EventCalendarContent } from "@/components/reui/event-calendar/event-calendar-content"
import {
  EventCalendarNavNext,
  EventCalendarNavPrev,
  EventCalendarNavToday,
  EventCalendarTitle,
  EventCalendarViewSwitcher,
} from "@/components/reui/event-calendar/event-calendar-nav"
import type {
  CalendarEvent,
  CalendarView,
  EventCalendarProposedUpdate,
} from "@/components/reui/event-calendar/event-calendar-types"
import { Gantt } from "@/components/reui/gantt/gantt"
import { GanttView } from "@/components/reui/gantt/gantt-view"
import {
  GanttNavNext,
  GanttNavPrev,
  GanttNavToday,
  GanttScaleSwitcher,
  GanttTitle,
} from "@/components/reui/gantt/gantt-nav"
import type {
  GanttEvent,
  GanttProposedUpdate,
  GanttResource,
  GanttResourceReorder,
  GanttScale,
} from "@/components/reui/gantt/gantt-types"
import { dayKey, evEnd, evStart, rangeLabel, toStore } from "@/lib/dates"
import { HOLIDAY_COLOR, type Ev, type Holiday, type Project, type User } from "@/lib/types"
import { holidayEnd, holidayStart, holidayWhere } from "@/lib/holidays"
import { useIsMobile } from "@/lib/use-media"
import { cn } from "@/lib/utils"
import { AvatarStack, StatusPill } from "./bits"

export type BoardMode = "calendar" | "gantt"
const NONE = "__none"
const HOLIDAY_ROW = "__holidays"
const FALLBACK = "#6b7280"

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

function colorOf(e: Ev, projects: Project[]) {
  return e.color ?? projects.find((p) => p.id === e.projectId)?.color ?? FALLBACK
}

export function Board(props: BoardProps) {
  return (
    <div
      className={cn("relative flex min-h-0 flex-1 flex-col", props.className)}
      style={{ viewTransitionName: "board" }}
    >
      {props.mode === "calendar" ? <CalendarBoard {...props} /> : <GanttBoard {...props} />}
    </div>
  )
}

// ---------------------------------------------------------------- calendar

function CalendarBoard({
  events,
  projects,
  users,
  readOnly,
  dayMarks,
  date,
  onDateChange,
  calView,
  onCalViewChange,
  onOpenEvent,
  onOpenDay,
  onCreateRange,
  onMove,
  holidays = [],
  offDates = [],
}: BoardProps) {
  const mobile = useIsMobile()
  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events])
  const holidayById = useMemo(() => new Map(holidays.map((h) => [h.id, h])), [holidays])

  const calEvents = useMemo<CalendarEvent<Ev>[]>(
    () => [
      // Holidays first so they sit on top of each day; locked so nobody drags them.
      ...holidays.map((h) => ({
        id: h.id,
        title: h.name,
        start: holidayStart(h),
        end: holidayEnd(h),
        allDay: true,
        color: HOLIDAY_COLOR,
        priority: h.national ? 100 : 90,
        readOnly: true,
      })),
      ...events.map((e) => ({
        id: e.id,
        title: e.title,
        start: evStart(e),
        end: evEnd(e),
        allDay: e.allDay,
        color: colorOf(e, projects),
        priority: e.priority,
        readOnly: readOnly,
        data: e,
      })),
    ],
    [events, projects, readOnly, holidays]
  )

  const views: CalendarView[] = mobile ? ["month", "days", "day", "agenda"] : ["month", "week", "day", "agenda"]

  const onEventUpdate = (u: EventCalendarProposedUpdate<Ev>) => {
    if (readOnly || !onMove) return false
    onMove(u.event.id, toStore(u.start, u.end, u.allDay))
    return true
  }

  return (
    <EventCalendar<Ev>
      events={calEvents}
      view={views.includes(calView) ? calView : "month"}
      onViewChange={onCalViewChange}
      date={date}
      onDateChange={onDateChange}
      views={views}
      defaultDayCount={3}
      weekStartsOn={1}
      interactions={{ drag: !readOnly, resize: !readOnly, selectSlot: !readOnly }}
      scrollToHour={8}
      maxEventsPerCell="auto"
      offDays={{ dates: offDates }}
      showDayAddButton={!readOnly}
      nowIndicator
      scrollbars="native"
      onEventUpdate={onEventUpdate}
      onEventClick={(occ) => {
        const h = holidayById.get(occ.eventId)
        if (h) onOpenDay?.(holidayStart(h))
        else onOpenEvent?.(occ.eventId)
      }}
      onSlotClick={(slot) => {
        if (slot.view === "month" || slot.allDay) onOpenDay?.(slot.date)
        else if (!readOnly && slot.end)
          onCreateRange?.(toStore(slot.date, slot.end, false))
      }}
      onSelectSlot={(slot) => {
        if (readOnly) return
        onCreateRange?.(toStore(slot.start, slot.end, slot.allDay))
      }}
      dayClassName={(d) => (dayMarks?.has(dayKey(d)) ? "ec-has-data" : undefined)}
      todayClassName="bg-primary/[0.04]"
      renderEventTooltip={({ occurrence }) => {
        const h = holidayById.get(occurrence.eventId)
        if (h) return <HolidayHover h={h} />
        const e = byId.get(occurrence.eventId)
        if (!e) return null
        return <EventHover e={e} projects={projects} users={users} />
      }}
      className="min-h-0 flex-1 text-[12px]"
    >
      <div className="flex flex-wrap items-center gap-1 border-b px-2 py-2 md:px-3">
        <div className="flex items-center">
          <EventCalendarNavPrev />
          <EventCalendarNavNext />
        </div>
        <EventCalendarTitle className="ms-1 text-[15px] font-semibold tracking-tight md:text-base" />
        <div className="grow" />
        <EventCalendarNavToday />
        <EventCalendarViewSwitcher />
      </div>
      <EventCalendarContent className="min-h-0 flex-1" />
    </EventCalendar>
  )
}


function HolidayHover({ h }: { h: Holiday }) {
  return (
    <div className="grid max-w-64 gap-1 py-0.5 text-left">
      <div className="flex items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-full" style={{ background: HOLIDAY_COLOR }} />
        <span className="font-medium">{h.name}</span>
      </div>
      <div className="opacity-80">{holidayWhere(h)}</div>
      {h.tentative && <div className="opacity-80">Date may still change</div>}
    </div>
  )
}

function EventHover({ e, projects, users }: { e: Ev; projects: Project[]; users: User[] }) {
  const p = projects.find((x) => x.id === e.projectId)
  const people = users.filter((u) => e.assignees.includes(u.id))
  return (
    <div className="grid max-w-64 gap-1.5 py-0.5 text-left">
      <div className="flex items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-full" style={{ background: colorOf(e, projects) }} />
        <span className="truncate font-medium">{e.title}</span>
      </div>
      <div className="opacity-80">{rangeLabel(e)}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {p && <span className="opacity-80">{p.name}</span>}
        <StatusPill status={e.status} />
        {e.openTasks > 0 && (
          <span className="inline-flex items-center gap-1 opacity-80">
            <ListChecksIcon className="size-3" /> {e.openTasks} open
          </span>
        )}
      </div>
      {e.location && (
        <div className="flex items-center gap-1 opacity-80">
          <MapPinIcon className="size-3" /> {e.location}
        </div>
      )}
      {people.length > 0 && <AvatarStack users={people} size={18} />}
      {e.notes && <p className="line-clamp-3 opacity-80">{e.notes}</p>}
    </div>
  )
}

// ---------------------------------------------------------------- gantt

function GanttBoard({
  events,
  projects,
  users,
  readOnly,
  date,
  onDateChange,
  scale,
  onScaleChange,
  onOpenEvent,
  onOpenDay,
  onCreateRange,
  onMove,
  onReorderEvents,
  onReorderProjects,
  holidays = [],
  offDates = [],
}: BoardProps) {
  const mobile = useIsMobile()
  const lastReorder = useRef(0)
  const holidayById = useMemo(() => new Map(holidays.map((h) => [h.id, h])), [holidays])

  const { resources, ganttEvents } = useMemo(() => {
    const active = projects.filter((p) => !p.archived)
    const groups: GanttResource[] = []
    const sorted = [...events].sort((a, b) => a.sort - b.sort || a.start.localeCompare(b.start))
    const row = (e: Ev): GanttResource => ({ id: `ev:${e.id}`, title: e.title, color: colorOf(e, projects), scheduleMode: "single" })
    for (const p of active) {
      const kids = sorted.filter((e) => e.projectId === p.id).map(row)
      groups.push({ id: p.id, title: p.name, color: p.color, children: kids })
    }
    const loose = sorted.filter((e) => !e.projectId || !active.some((p) => p.id === e.projectId)).map(row)
    if (loose.length || !groups.length) groups.push({ id: NONE, title: "No project", color: FALLBACK, children: loose })
    // A locked row for public holidays sits above the projects.
    if (holidays.length) groups.unshift({ id: HOLIDAY_ROW, title: "Public holidays", color: HOLIDAY_COLOR, scheduleMode: "multiple" })
    const holidayBars: GanttEvent<Ev>[] = holidays.map((h) => ({
      id: h.id,
      title: h.name,
      start: holidayStart(h),
      end: holidayEnd(h),
      allDay: true,
      color: HOLIDAY_COLOR,
      resourceId: HOLIDAY_ROW,
      readOnly: true,
    }))
    const ganttEvents: GanttEvent<Ev>[] = [...holidayBars, ...sorted.map((e) => ({
      id: e.id,
      title: e.title,
      start: evStart(e),
      end: evEnd(e),
      allDay: e.allDay,
      color: colorOf(e, projects),
      progress: e.progress,
      dependencies: e.dependencies,
      resourceId: `ev:${e.id}`,
      readOnly,
      data: e,
    }))]
    return { resources: groups, ganttEvents }
  }, [events, projects, readOnly, holidays])

  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events])

  const onEventUpdate = (u: GanttProposedUpdate<Ev>) => {
    if (readOnly || !onMove) return false
    onMove(u.event.id, toStore(u.start, u.end, u.allDay))
    return true
  }

  const onReorder = (proposal: GanttResourceReorder) => {
    if (readOnly) return false
    const now = Date.now()
    if (now - lastReorder.current < 150) return
    lastReorder.current = now
    const projectOrder = proposal.resources.map((g) => g.id).filter((id) => id !== NONE && id !== HOLIDAY_ROW)
    const current = projects.filter((p) => !p.archived).map((p) => p.id)
    if (projectOrder.join() !== current.join()) onReorderProjects?.(projectOrder)
    const changes: { id: string; sort: number; projectId: string | null }[] = []
    for (const g of proposal.resources) {
      if (g.id === HOLIDAY_ROW) continue
      ;(g.children ?? []).forEach((child, i) => {
        const id = child.id.replace(/^ev:/, "")
        const e = byId.get(id)
        const projectId = g.id === NONE ? null : g.id
        if (e && (e.sort !== i || (e.projectId ?? null) !== projectId)) changes.push({ id, sort: i, projectId })
      })
    }
    if (changes.length) onReorderEvents?.(changes)
  }

  const columns = mobile
    ? undefined
    : [
        {
          id: "status",
          title: "Status",
          width: 92,
          render: ({ resource, isGroup }: { resource: GanttResource; isGroup: boolean }) => {
            if (isGroup) return null
            const e = byId.get(resource.id.replace(/^ev:/, ""))
            return e ? <StatusPill status={e.status} /> : null
          },
        },
        {
          id: "people",
          title: "People",
          width: 78,
          render: ({ resource, isGroup }: { resource: GanttResource; isGroup: boolean }) => {
            if (isGroup) return null
            const e = byId.get(resource.id.replace(/^ev:/, ""))
            if (!e) return null
            return <AvatarStack users={users.filter((u) => e.assignees.includes(u.id))} size={20} />
          },
        },
      ]

  return (
    <Gantt<Ev>
      events={ganttEvents}
      resources={resources}
      scale={scale}
      onScaleChange={onScaleChange}
      date={date}
      onDateChange={onDateChange}
      weekStartsOn={1}
      interactions={{ drag: !readOnly, resize: !readOnly, selectSlot: !readOnly }}
      onEventUpdate={onEventUpdate}
      onEventClick={(occ) => {
        const h = holidayById.get(occ.eventId)
        if (h) onOpenDay?.(holidayStart(h))
        else onOpenEvent?.(occ.eventId)
      }}
      onResourceClick={({ resource, isGroup }) => {
        if (!isGroup && resource.id.startsWith("ev:")) onOpenEvent?.(resource.id.replace(/^ev:/, ""))
      }}
      onSlotClick={(slot) => {
        if (slot.resourceId === HOLIDAY_ROW) return
        if (readOnly || !onCreateRange) return
        const end = new Date(slot.date)
        end.setDate(end.getDate() + 1)
        const projectId = slot.resourceId && !slot.resourceId.startsWith("ev:") && slot.resourceId !== NONE ? slot.resourceId : null
        onCreateRange({ ...toStore(slot.date, end, true), projectId })
      }}
      onResourceReorder={readOnly ? undefined : onReorder}
      canReorderResource={(p) => {
        if (p.resourceId === HOLIDAY_ROW || p.parentId === HOLIDAY_ROW) return false
        const isEventRow = p.resourceId.startsWith("ev:")
        return isEventRow ? p.parentId !== null : p.parentId === null
      }}
      canCreateTask={() => !readOnly}
      onCreateTask={() => {
        if (readOnly || !onCreateRange) return
        const s = new Date()
        const e = new Date()
        e.setDate(e.getDate() + 3)
        onCreateRange(toStore(s, e, true))
      }}
      displayCreateTaskHint={!readOnly}
      displayScheduleHint={false}
      offDays={{ dates: offDates }}
      nowIndicator
      zoomControl={!mobile}
      rowCheckboxes={false}
      barLabel="auto"
      columns={columns}
      treePanel={mobile ? { width: 150, nameColumnWidth: 150, minWidth: 110, resizable: true } : { width: 380, nameColumnWidth: 210 }}
      i18n={{ labels: { resources: "Events" } }}
      defaultZoom={mobile ? 0.5 : 1}
      scrollbars="native"
      initialCenter="anchor"
      className="min-h-0 flex-1 text-[12px]"
    >
      <div className="flex flex-wrap items-center gap-1 border-b px-2 py-2 md:px-3">
        <div className="flex items-center">
          <GanttNavPrev />
          <GanttNavNext />
        </div>
        <GanttTitle className="ms-1 text-[15px] font-semibold tracking-tight md:text-base" />
        <div className="grow" />
        <GanttNavToday />
        <GanttScaleSwitcher scales={["week", "month", "quarter", "year"]} />
      </div>
      <GanttView className="min-h-0 flex-1" />
    </Gantt>
  )
}

export const monthTitle = (d: Date) => format(d, "MMMM yyyy")
