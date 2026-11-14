import { useMemo, useRef } from "react"
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
} from "@/components/reui/gantt/gantt-types"
import { evEnd, evStart, toStore } from "@/lib/dates"
import { HOLIDAY_COLOR, type Ev } from "@/lib/types"
import { holidayEnd, holidayStart } from "@/lib/holidays"
import { useIsMobile } from "@/lib/use-media"
import { AvatarStack, StatusPill } from "./bits"
import { FALLBACK, HOLIDAY_ROW, NONE, colorOf, type BoardProps } from "./board-shared"

// ---------------------------------------------------------------- gantt

export default function GanttBoard({
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
      barLabel="inside"
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

