import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { format, startOfDay } from "date-fns"
import { CalendarDaysIcon, CalendarPlusIcon, ChartGanttIcon, EyeIcon, Link2OffIcon, MapPinIcon, MoonIcon, SunIcon, CalendarRangeIcon } from "lucide-react"
import { googleCalendarSubscribeUrl } from "@/lib/google"
import type { CalendarView } from "@/components/reui/event-calendar/event-calendar-types"
import type { GanttScale } from "@/components/reui/gantt/gantt-types"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { coversDay, dayKey, evStart, lastDay, parseDay, rangeLabel } from "@/lib/dates"
import { setThemePref, useResolvedTheme } from "@/lib/theme"
import type { PublicPayload } from "@/lib/types"
import { withViewTransition } from "@/lib/use-media"
import { cn } from "@/lib/utils"
import { AvatarStack, Logo, Panel, ProgressLine, Segmented, StatusPill } from "./bits"
import { Board, type BoardMode } from "./board"
import { DayPanel } from "./day-panel"
import { EntryList } from "./entries"

export function PublicView({ token }: { token: string }) {
  const q = useQuery({
    queryKey: ["public", token],
    queryFn: () => api<PublicPayload>(`/api/public/${encodeURIComponent(token)}`),
    retry: false,
    refetchInterval: 60_000,
  })
  const theme = useResolvedTheme()
  const [mode, setModeRaw] = useState<BoardMode>("calendar")
  const [date, setDate] = useState(() => new Date())
  const [calView, setCalView] = useState<CalendarView>("month")
  const [scale, setScale] = useState<GanttScale>("month")
  const [hidden, setHidden] = useState<string[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [day, setDay] = useState<Date | null>(null)

  const data = q.data
  const events = useMemo(
    () => (data?.events ?? []).filter((e) => !hidden.includes(e.projectId ?? "__none")),
    [data, hidden]
  )
  const dayMarks = useMemo(() => new Set((data?.entries ?? []).filter((x) => x.day).map((x) => x.day!)), [data])

  // Jump to where the shared events are, if none are in the current month.
  const [jumped, setJumped] = useState(false)
  if (data && !jumped) {
    setJumped(true)
    const now = new Date()
    if (data.events.length && !data.events.some((e) => coversDay(e, now))) {
      const upcoming = data.events.find((e) => lastDay(e) >= startOfDay(now)) ?? data.events[0]!
      setDate(evStart(upcoming))
    }
  }

  if (q.isLoading) return <PublicSkeleton />
  if (q.isError || !data)
    return (
      <div className="grid min-h-dvh place-items-center bg-canvas px-6 text-center">
        <div className="grid justify-items-center gap-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
            <Link2OffIcon className="size-5" />
          </span>
          <h1 className="text-lg font-semibold">This link is not available</h1>
          <p className="max-w-xs text-[14px] text-muted-foreground">{(q.error as Error)?.message ?? "It may have been turned off or expired."}</p>
        </div>
      </div>
    )

  const stats = summarise(data)
  const ev = openId ? data.events.find((e) => e.id === openId) : null

  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <header className="shrink-0 border-b bg-background pt-safe">
        <div className="flex items-center gap-3 px-4 py-3 md:px-6">
          <Logo className="size-9" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[16px] font-semibold tracking-tight md:text-lg">{data.share.title}</h1>
            <p className="flex items-center gap-1.5 truncate text-[12px] text-muted-foreground">
              <EyeIcon className="size-3.5" /> View only
              {stats.range && (
                <>
                  <span aria-hidden>·</span>
                  {stats.range}
                </>
              )}
            </p>
          </div>
          <Segmented
            layoutId="public-mode"
            value={mode}
            onChange={(m) => withViewTransition(() => setModeRaw(m))}
            className="hidden md:inline-flex"
            options={[
              { value: "calendar", label: "Calendar", icon: <CalendarDaysIcon className="size-3.5" /> },
              { value: "gantt", label: "Gantt", icon: <ChartGanttIcon className="size-3.5" /> },
            ]}
          />
          <Button
            variant="outline"
            title="Add this schedule to your Google Calendar"
            render={
              <a
                href={googleCalendarSubscribeUrl(`${window.location.origin}/api/public/${encodeURIComponent(token)}/calendar.ics`)}
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            <CalendarPlusIcon /> <span className="hidden sm:inline">Subscribe</span>
          </Button>
          <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={() => setThemePref(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </Button>
        </div>

        {/* Summary strip */}
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3 md:px-6">
          <Stat label="Events" value={String(data.events.length)} />
          <Stat label="In progress" value={String(stats.active)} />
          <Stat label="Done" value={`${stats.donePct}%`} bar={stats.donePct} />
          {stats.next && <Stat label="Next up" value={stats.next.title} sub={format(evStart(stats.next), "EEE d MMM")} wide />}
          {data.projects.length > 1 &&
            data.projects.map((p) => {
              const off = hidden.includes(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setHidden(off ? hidden.filter((x) => x !== p.id) : [...hidden, p.id])}
                  className={cn(
                    "flex h-14 shrink-0 items-center gap-2 rounded-xl border bg-card px-3 text-[13px] transition-opacity",
                    off && "opacity-45"
                  )}
                >
                  <span className="size-2.5 rounded-[3px]" style={{ background: p.color }} />
                  {p.name}
                </button>
              )
            })}
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col md:p-3">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background md:rounded-2xl md:border md:shadow-soft">
          <Board
            mode={mode}
            events={events}
            projects={data.projects}
            users={data.users}
            readOnly
            dayMarks={dayMarks}
            date={date}
            onDateChange={setDate}
            calView={calView}
            onCalViewChange={setCalView}
            scale={scale}
            onScaleChange={setScale}
            onOpenEvent={setOpenId}
            onOpenDay={setDay}
            holidays={data.holidays ?? []}
            offDates={(data.holidays ?? []).filter((h) => h.national).map((h) => parseDay(h.date))}
          />
        </div>
      </main>

      {/* Mobile mode switch */}
      <nav className="shrink-0 border-t bg-background/92 px-4 py-2 pb-safe backdrop-blur-xl md:hidden">
        <Segmented
          layoutId="public-mode-m"
          value={mode}
          onChange={(m) => withViewTransition(() => setModeRaw(m))}
          className="w-full"
          options={[
            { value: "calendar", label: "Calendar", icon: <CalendarDaysIcon className="size-3.5" /> },
            { value: "gantt", label: "Gantt", icon: <ChartGanttIcon className="size-3.5" /> },
          ]}
        />
      </nav>

      <Panel open={Boolean(ev)} onOpenChange={(v) => !v && setOpenId(null)} title={ev?.title ?? ""} wide hideTitle>
        {ev && (
          <div className="grid gap-5">
            <div className="flex items-start gap-3">
              <span
                className="mt-1.5 h-9 w-1.5 shrink-0 rounded-full"
                style={{ background: ev.color ?? data.projects.find((p) => p.id === ev.projectId)?.color ?? "#6b7280" }}
              />
              <div className="min-w-0">
                <h2 className="text-xl font-semibold tracking-tight">{ev.title}</h2>
                <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
                  <CalendarRangeIcon className="size-3.5" /> {rangeLabel(ev)}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={ev.status} />
              {data.projects.find((p) => p.id === ev.projectId) && (
                <span className="text-[13px] text-muted-foreground">{data.projects.find((p) => p.id === ev.projectId)!.name}</span>
              )}
              <AvatarStack users={data.users.filter((u) => ev.assignees.includes(u.id))} />
            </div>
            <div className="flex items-center gap-3">
              <ProgressLine value={ev.progress} />
              <span className="font-mono text-[12px] tabular">{ev.progress}%</span>
            </div>
            {ev.location && data.share.includeNotes && (
              <p className="flex items-center gap-2 text-[14px]">
                <MapPinIcon className="size-4 text-muted-foreground" /> {ev.location}
              </p>
            )}
            {ev.notes && <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{ev.notes}</p>}
            {data.share.includeEntries && (
              <PublicEntries entries={data.entries.filter((x) => x.eventId === ev.id)} />
            )}
          </div>
        )}
      </Panel>

      {day && (
        <DayPanel
          open
          onOpenChange={(v) => !v && setDay(null)}
          day={day}
          onDayChange={setDay}
          events={events}
          projects={data.projects}
          users={data.users}
          readOnly
          onOpenEvent={(id) => {
            setDay(null)
            setOpenId(id)
          }}
          publicEntries={data.entries}
          holidays={data.holidays ?? []}
        />
      )}
    </div>
  )
}

function PublicEntries({ entries }: { entries: PublicPayload["entries"] }) {
  if (!entries.length) return null
  const groups = new Map<string, typeof entries>()
  entries.forEach((x) => groups.set(x.day ?? "", [...(groups.get(x.day ?? "") ?? []), x]))
  return (
    <div className="grid gap-4">
      {[...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([d, list]) => (
          <section key={d} className="grid gap-2">
            <h3 className="text-[12px] font-medium text-muted-foreground">
              {d ? format(new Date(d + "T00:00:00"), "EEEE, d MMMM") : "Whole event"}
            </h3>
            <EntryList entries={list} readOnly />
          </section>
        ))}
    </div>
  )
}

function Stat({ label, value, sub, bar, wide }: { label: string; value: string; sub?: string; bar?: number; wide?: boolean }) {
  return (
    <div className={cn("flex h-14 shrink-0 flex-col justify-center rounded-xl border bg-card px-3", wide ? "max-w-60 min-w-40" : "min-w-24")}>
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="truncate text-[15px] leading-tight font-semibold tabular">{value}</span>
      {sub && <span className="truncate text-[11px] text-muted-foreground">{sub}</span>}
      {bar !== undefined && (
        <span className="mt-1 block">
          <ProgressLine value={bar} />
        </span>
      )}
    </div>
  )
}

function summarise(d: PublicPayload) {
  const now = startOfDay(new Date())
  const active = d.events.filter((e) => e.status === "active").length
  const done = d.events.filter((e) => e.status === "done").length
  const donePct = d.events.length ? Math.round((done / d.events.length) * 100) : 0
  const next = [...d.events].filter((e) => evStart(e) >= now).sort((a, b) => evStart(a).getTime() - evStart(b).getTime())[0]
  let range = ""
  if (d.events.length) {
    const first = d.events.reduce((m, e) => (evStart(e) < m ? evStart(e) : m), evStart(d.events[0]!))
    const last = d.events.reduce((m, e) => (lastDay(e) > m ? lastDay(e) : m), lastDay(d.events[0]!))
    range = dayKey(first) === dayKey(last) ? format(first, "d MMM yyyy") : `${format(first, "d MMM")} - ${format(last, "d MMM yyyy")}`
  }
  return { active, donePct, next, range }
}

function PublicSkeleton() {
  return (
    <div className="flex h-dvh flex-col gap-3 bg-canvas p-4">
      <div className="h-12 w-64 animate-pulse rounded-xl bg-muted" />
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 w-28 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div className="flex-1 animate-pulse rounded-2xl bg-muted" />
    </div>
  )
}
