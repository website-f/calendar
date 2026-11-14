import { useMemo, useState } from "react"
import { addDays, differenceInCalendarDays, format, isToday } from "date-fns"
import { CalendarOffIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon, ArrowUpRightIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useDayEntries } from "@/lib/data"
import { coversDay, dayKey, evStart, rangeLabel, spanDays } from "@/lib/dates"
import type { Entry, Ev, Project, User } from "@/lib/types"
import { cn } from "@/lib/utils"
import { AvatarStack, EmptyNote, Panel, ProgressLine, StatusPill } from "./bits"
import { EntryComposer, EntryList } from "./entries"

export function DayPanel({
  open,
  onOpenChange,
  day,
  onDayChange,
  events,
  projects,
  users,
  readOnly,
  onOpenEvent,
  onNewEvent,
  publicEntries,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  day: Date
  onDayChange: (d: Date) => void
  events: Ev[]
  projects: Project[]
  users: User[]
  readOnly: boolean
  onOpenEvent: (id: string, opts?: { day?: string }) => void
  onNewEvent?: (day: Date) => void
  /** Public view passes entries directly instead of fetching. */
  publicEntries?: Entry[]
}) {
  const key = dayKey(day)
  const todays = useMemo(
    () =>
      events
        .filter((e) => coversDay(e, day))
        .sort((a, b) => Number(b.allDay) - Number(a.allDay) || evStart(a).getTime() - evStart(b).getTime()),
    [events, day]
  )
  const fetched = useDayEntries(open && !publicEntries ? key : null)
  const entries = publicEntries
    ? publicEntries.filter((x) => x.day === key || (x.day === null && todays.some((e) => e.id === x.eventId)))
    : (fetched.data ?? [])
  const [composeFor, setComposeFor] = useState<string | null>(null)

  const header = (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-semibold tracking-tight">{format(day, "EEEE, d MMMM")}</span>
          {isToday(day) && (
            <span className="rounded-md bg-primary/12 px-1.5 py-0.5 text-[11px] font-medium text-primary">Today</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-0.5">
        <Button variant="ghost" size="icon-sm" aria-label="Previous day" onClick={() => onDayChange(addDays(day, -1))}>
          <ChevronLeftIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Next day" onClick={() => onDayChange(addDays(day, 1))}>
          <ChevronRightIcon />
        </Button>
      </div>
    </div>
  )

  return (
    <Panel
      open={open}
      onOpenChange={onOpenChange}
      title={header}
      description={`${todays.length} event${todays.length === 1 ? "" : "s"} · ${entries.length} data item${entries.length === 1 ? "" : "s"}`}
      footer={
        !readOnly && onNewEvent ? (
          <Button className="w-full md:h-9" size="lg" onClick={() => onNewEvent(day)}>
            <PlusIcon /> New event on {format(day, "d MMM")}
          </Button>
        ) : undefined
      }
    >
      {todays.length === 0 ? (
        <EmptyNote icon={<CalendarOffIcon className="size-5" />} title="Nothing scheduled">
          {readOnly ? "There are no events on this date." : "Add an event for this date, or drag across days on the calendar to plan a range."}
        </EmptyNote>
      ) : (
        <div className="grid gap-3">
          {todays.map((e) => {
            const p = projects.find((x) => x.id === e.projectId)
            const color = e.color ?? p?.color ?? "#6b7280"
            const mine = entries.filter((x) => x.eventId === e.id)
            const pinned = mine.filter((x) => x.day === key)
            const whole = mine.filter((x) => x.day === null)
            const span = spanDays(e)
            const dayIndex = differenceInCalendarDays(day, evStart(e)) + 1
            return (
              <article key={e.id} className="overflow-hidden rounded-2xl border bg-card">
                <button
                  type="button"
                  onClick={() => onOpenEvent(e.id, { day: key })}
                  className="flex w-full items-start gap-3 px-4 pt-3.5 pb-3 text-left transition-colors hover:bg-muted/40"
                >
                  <span className="mt-1 h-8 w-1 shrink-0 rounded-full" style={{ background: color }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-[15px] font-semibold tracking-tight">{e.title}</h3>
                      <ArrowUpRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    </div>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      {rangeLabel(e)}
                      {span > 1 && <span className="ml-1.5 font-medium text-foreground/70">Day {dayIndex} of {span}</span>}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <StatusPill status={e.status} />
                      {p && <span className="text-[12px] text-muted-foreground">{p.name}</span>}
                      <AvatarStack users={users.filter((u) => e.assignees.includes(u.id))} size={20} />
                    </div>
                    {e.progress > 0 && (
                      <div className="mt-2.5 flex items-center gap-2">
                        <ProgressLine value={e.progress} color={color} />
                        <span className="font-mono text-[11px] text-muted-foreground tabular">{e.progress}%</span>
                      </div>
                    )}
                  </div>
                </button>
                <div className={cn("grid gap-2 border-t bg-muted/25 px-3 py-3", !pinned.length && !whole.length && readOnly && "hidden")}>
                  {pinned.length > 0 && (
                    <>
                      <span className="px-1 text-[11px] font-medium text-muted-foreground">This day</span>
                      <EntryList entries={pinned} readOnly={readOnly} compact={false} />
                    </>
                  )}
                  {whole.length > 0 && (
                    <>
                      <span className="px-1 text-[11px] font-medium text-muted-foreground">Whole event</span>
                      <EntryList entries={whole} readOnly={readOnly} compact />
                    </>
                  )}
                  {!readOnly &&
                    (composeFor === e.id ? (
                      <EntryComposer eventId={e.id} day={key} />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setComposeFor(e.id)}
                        className="flex h-10 items-center gap-2 rounded-xl px-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground md:h-9"
                      >
                        <PlusIcon className="size-4" /> Log data for {format(day, "d MMM")}
                      </button>
                    ))}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </Panel>
  )
}
