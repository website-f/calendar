import { lazy, Suspense, useMemo } from "react"
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
import { dayKey, evEnd, evStart, rangeLabel, toStore } from "@/lib/dates"
import { HOLIDAY_COLOR, type Ev, type Holiday, type Project, type User } from "@/lib/types"
import { holidayEnd, holidayStart, holidayWhere } from "@/lib/holidays"
import { useIsMobile } from "@/lib/use-media"
import { cn } from "@/lib/utils"
import { AvatarStack, StatusPill } from "./bits"
import { colorOf, type BoardProps } from "./board-shared"

export type { BoardMode, BoardProps } from "./board-shared"

// The Gantt (REUI's largest component) loads only when someone opens the Gantt view.
const GanttBoard = lazy(() => import("./gantt-board"))

export function Board(props: BoardProps) {
  return (
    <div
      className={cn("relative flex min-h-0 flex-1 flex-col", props.className)}
      style={{ viewTransitionName: "board" }}
    >
      {props.mode === "calendar" ? (
        <CalendarBoard {...props} />
      ) : (
        <Suspense fallback={<BoardSkeleton />}>
          <GanttBoard {...props} />
        </Suspense>
      )}
    </div>
  )
}

function BoardSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3" aria-busy="true">
      <div className="h-8 w-56 animate-pulse rounded-lg bg-muted" />
      <div className="grid flex-1 grid-cols-[minmax(8rem,22rem)_1fr] gap-2">
        <div className="animate-pulse rounded-xl bg-muted/70" />
        <div className="animate-pulse rounded-xl bg-muted/50" />
      </div>
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

export const monthTitle = (d: Date) => format(d, "MMMM yyyy")
