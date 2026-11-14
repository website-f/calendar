import { useEffect, useMemo, useState } from "react"
import { format, isToday } from "date-fns"
import { toast } from "sonner"
import {
  CalendarPlusIcon,
  CopyIcon,
  HistoryIcon,
  Layers3Icon,
  Share2Icon,
  Trash2Icon,
  MapPinIcon,
  CalendarRangeIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { useActivity, useEventEntries, useEventMutations } from "@/lib/data"
import { dayKey, daysOf, fromInputs, inputDates, rangeLabel, relTime } from "@/lib/dates"
import { googleCalendarEventUrl } from "@/lib/google"
import { PRIORITY_LABEL, STATUS_LABEL, type Ev, type Project, type Status, type User } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Avatar, FieldRow, NativeSelect, Panel, Segmented, Swatches } from "./bits"
import { EntryComposer, EntryList } from "./entries"

export interface Draft {
  start: string
  end: string
  allDay: boolean
  projectId?: string | null
}

type Tab = "details" | "data" | "activity"

export function EventPanel({
  open,
  onOpenChange,
  event,
  draft,
  projects,
  users,
  events,
  readOnly,
  onShare,
  initialTab = "details",
  initialDay,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  event: Ev | null
  draft: Draft | null
  projects: Project[]
  users: User[]
  events: Ev[]
  readOnly: boolean
  onShare?: (eventId: string) => void
  initialTab?: Tab
  initialDay?: string | null
}) {
  const isNew = !event
  const [tab, setTab] = useState<Tab>(initialTab)
  const [form, setForm] = useState(() => toForm(event, draft))
  const [dirty, setDirty] = useState(false)
  const { create, update, remove, duplicate } = useEventMutations()

  useEffect(() => {
    if (!open) return
    setForm(toForm(event, draft))
    setDirty(false)
    setTab(event ? initialTab : "details")
    // Only reset when a different event/draft opens, not on every background refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event?.id, draft])

  // Keep non-dirty forms in sync with live updates from teammates.
  useEffect(() => {
    if (event && !dirty) setForm(toForm(event, null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.updatedAt])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setDirty(true)
  }

  const project = projects.find((p) => p.id === form.projectId)
  const accent = form.color ?? project?.color ?? "#6b7280"

  const save = () => {
    if (!form.title.trim()) {
      toast.error("Give the event a title.")
      return
    }
    const when = fromInputs(form)
    const payload = {
      title: form.title.trim(),
      projectId: form.projectId || null,
      ...when,
      color: form.color,
      status: form.status,
      progress: form.progress,
      priority: form.priority,
      location: form.location,
      notes: form.notes,
      assignees: form.assignees,
      dependencies: form.dependencies,
    }
    if (isNew) {
      create.mutate(payload, {
        onSuccess: (ev) => {
          toast.success("Event created", { description: rangeLabel(ev) })
          onOpenChange(false)
        },
      })
    } else {
      update.mutate({ id: event.id, ...payload }, { onSuccess: () => setDirty(false) })
    }
  }

  const title = isNew ? "New event" : readOnly ? event.title : "Edit event"

  const footer = readOnly ? null : (
    <div className="flex items-center gap-2">
      {!isNew && (
        <>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete event"
            onClick={() => {
              if (!confirm(`Delete "${event.title}" and all its daily data?`)) return
              remove.mutate(event.id, { onSuccess: () => toast.success("Event deleted") })
              onOpenChange(false)
            }}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2Icon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Duplicate event"
            onClick={() => duplicate.mutate(event.id, { onSuccess: () => toast.success("Copy created") })}
            className="text-muted-foreground"
          >
            <CopyIcon />
          </Button>
          {onShare && (
            <Button variant="ghost" size="icon" aria-label="Share event" onClick={() => onShare(event.id)} className="text-muted-foreground">
              <Share2Icon />
            </Button>
          )}
          <GooglePushButton event={event} />
        </>
      )}
      <div className="grow" />
      {(isNew || dirty) && (
        <>
          {!isNew && (
            <Button variant="ghost" onClick={() => { setForm(toForm(event, null)); setDirty(false) }}>
              Discard
            </Button>
          )}
          <Button onClick={save} disabled={create.isPending || update.isPending} size="lg" className="md:h-9">
            {isNew ? "Create event" : "Save changes"}
          </Button>
        </>
      )}
    </div>
  )

  return (
    <Panel open={open} onOpenChange={onOpenChange} title={title} wide footer={footer} hideTitle>
      {/* Header: colour rail + big title */}
      <div className="relative -mx-5 mb-4 px-5 pt-1">
        <div className="flex items-start gap-3">
          <span className="mt-1.5 h-9 w-1.5 shrink-0 rounded-full" style={{ background: accent }} />
          <div className="min-w-0 flex-1">
            {readOnly ? (
              <h2 className="text-xl font-semibold tracking-tight">{form.title}</h2>
            ) : (
              <input
                autoFocus={isNew}
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="Event title"
                aria-label="Event title"
                className="w-full bg-transparent text-xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/60"
              />
            )}
            <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <CalendarRangeIcon className="size-3.5" />
              {rangeLabel({ ...(event ?? ({} as Ev)), ...fromInputs(form) } as Ev)}
              {project && (
                <>
                  <span aria-hidden>·</span>
                  <span className="truncate">{project.name}</span>
                </>
              )}
            </p>
          </div>
        </div>
      </div>

      {!isNew && (
        <Segmented
          layoutId="event-tab"
          value={tab}
          onChange={setTab}
          className="mb-4 w-full"
          options={[
            { value: "details", label: "Details" },
            { value: "data", label: `Daily data${event.entryCount ? ` (${event.entryCount})` : ""}` },
            { value: "activity", label: "Activity" },
          ]}
        />
      )}

      {tab === "details" && (
        <DetailsForm form={form} set={set} projects={projects} users={users} events={events} readOnly={readOnly} selfId={event?.id} />
      )}
      {tab === "data" && event && <DailyData event={event} readOnly={readOnly} initialDay={initialDay ?? null} />}
      {tab === "activity" && event && <ActivityList eventId={event.id} />}
    </Panel>
  )
}

// ---------------------------------------------------------------- form

interface FormState {
  title: string
  projectId: string
  startDate: string
  endDate: string
  startTime: string
  endTime: string
  allDay: boolean
  color: string | null
  status: Status
  progress: number
  priority: number
  location: string
  notes: string
  assignees: string[]
  dependencies: string[]
}

function toForm(e: Ev | null, d: Draft | null): FormState {
  const src = e ?? {
    start: d?.start ?? dayKey(new Date()),
    end: d?.end ?? dayKey(new Date(Date.now() + 864e5)),
    allDay: d?.allDay ?? true,
  }
  const dates = inputDates(src as Ev)
  return {
    title: e?.title ?? "",
    projectId: e?.projectId ?? d?.projectId ?? "",
    ...dates,
    allDay: src.allDay,
    color: e?.color ?? null,
    status: e?.status ?? "planned",
    progress: e?.progress ?? 0,
    priority: e?.priority ?? 0,
    location: e?.location ?? "",
    notes: e?.notes ?? "",
    assignees: e?.assignees ?? [],
    dependencies: e?.dependencies ?? [],
  }
}

function DetailsForm({
  form,
  set,
  projects,
  users,
  events,
  readOnly,
  selfId,
}: {
  form: FormState
  set: <K extends keyof FormState>(k: K, v: FormState[K]) => void
  projects: Project[]
  users: User[]
  events: Ev[]
  readOnly: boolean
  selfId?: string
}) {
  const [showColor, setShowColor] = useState(Boolean(form.color))
  const others = events.filter((e) => e.id !== selfId)
  return (
    <fieldset disabled={readOnly} className="grid gap-5">
      <section className="grid gap-3">
        <div className="flex items-center justify-between rounded-xl bg-muted/60 px-3 py-2.5">
          <span className="text-[13px] font-medium">All day</span>
          <Switch checked={form.allDay} onCheckedChange={(v) => set("allDay", v)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="From">
            <Input type="date" value={form.startDate} onChange={(e) => {
              set("startDate", e.target.value)
              if (e.target.value > form.endDate) set("endDate", e.target.value)
            }} />
          </FieldRow>
          <FieldRow label="To">
            <Input type="date" value={form.endDate} min={form.startDate} onChange={(e) => set("endDate", e.target.value)} />
          </FieldRow>
          {!form.allDay && (
            <>
              <FieldRow label="Start time">
                <Input type="time" step={900} value={form.startTime} onChange={(e) => set("startTime", e.target.value)} />
              </FieldRow>
              <FieldRow label="End time">
                <Input type="time" step={900} value={form.endTime} onChange={(e) => set("endTime", e.target.value)} />
              </FieldRow>
            </>
          )}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <FieldRow label="Project" className="col-span-2 sm:col-span-1">
          <NativeSelect value={form.projectId} onChange={(v) => set("projectId", v)}>
            <option value="">No project</option>
            {projects.filter((p) => !p.archived || p.id === form.projectId).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </FieldRow>
        <FieldRow label="Priority" className="col-span-2 sm:col-span-1">
          <NativeSelect value={String(form.priority)} onChange={(v) => set("priority", Number(v))}>
            {PRIORITY_LABEL.map((l, i) => (
              <option key={l} value={i}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </FieldRow>
      </section>

      <section className="grid gap-2">
        <span className="text-[12px] font-medium text-muted-foreground">Status</span>
        <div className="grid grid-cols-4 gap-1.5">
          {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                set("status", s)
                if (s === "done") set("progress", 100)
              }}
              className={cn(
                "h-10 rounded-lg border text-[12px] font-medium transition-all md:h-8",
                form.status === s ? "border-ink bg-ink text-ink-foreground" : "bg-background text-muted-foreground hover:text-foreground"
              )}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-muted-foreground">Progress</span>
          <span className="font-mono text-[12px] tabular">{form.progress}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={form.progress}
          onChange={(e) => set("progress", Number(e.target.value))}
          className="h-2 w-full cursor-pointer accent-[var(--primary)]"
          aria-label="Progress"
        />
      </section>

      {users.length > 0 && (
        <section className="grid gap-2">
          <span className="text-[12px] font-medium text-muted-foreground">People</span>
          <div className="flex flex-wrap gap-1.5">
            {users.map((u) => {
              const on = form.assignees.includes(u.id)
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => set("assignees", on ? form.assignees.filter((x) => x !== u.id) : [...form.assignees, u.id])}
                  className={cn(
                    "inline-flex h-9 items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-[13px] transition-colors md:h-8",
                    on ? "border-transparent bg-ink text-ink-foreground" : "bg-background text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Avatar user={u} size={24} className="ring-0" />
                  {u.name.split(" ")[0]}
                </button>
              )
            })}
          </div>
        </section>
      )}

      <FieldRow label="Location">
        <div className="relative">
          <MapPinIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Room, site or link" value={form.location} onChange={(e) => set("location", e.target.value)} />
        </div>
      </FieldRow>

      <FieldRow label="Notes">
        <Textarea
          placeholder="Agenda, decisions, anything the team should know"
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          className="min-h-28"
        />
      </FieldRow>

      {others.length > 0 && (
        <FieldRow label="Starts after" hint="Draws a dependency arrow on the Gantt chart.">
          <NativeSelect
            value=""
            onChange={(v) => v && !form.dependencies.includes(v) && set("dependencies", [...form.dependencies, v])}
          >
            <option value="">Add a predecessor...</option>
            {others.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </NativeSelect>
          {form.dependencies.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {form.dependencies.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => set("dependencies", form.dependencies.filter((x) => x !== id))}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-muted px-2.5 text-[12px]"
                  title="Remove"
                >
                  <Layers3Icon className="size-3.5 text-muted-foreground" />
                  {events.find((e) => e.id === id)?.title ?? "Removed event"}
                  <span className="text-muted-foreground">×</span>
                </button>
              ))}
            </div>
          )}
        </FieldRow>
      )}

      <section className="grid gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-muted-foreground">Own colour</span>
          <Switch
            checked={showColor}
            onCheckedChange={(v) => {
              setShowColor(v)
              if (!v) set("color", null)
            }}
          />
        </div>
        {showColor && <Swatches value={form.color} onChange={(c) => set("color", c)} />}
      </section>
    </fieldset>
  )
}

// ---------------------------------------------------------------- daily data

function DailyData({ event, readOnly, initialDay }: { event: Ev; readOnly: boolean; initialDay: string | null }) {
  const days = useMemo(() => daysOf(event), [event])
  const { data: entries = [], isLoading } = useEventEntries(event.id)
  const [day, setDay] = useState<string | null>(initialDay && days.some((d) => dayKey(d) === initialDay) ? initialDay : null)
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    entries.forEach((x) => m.set(x.day ?? "", (m.get(x.day ?? "") ?? 0) + 1))
    return m
  }, [entries])
  const shown = entries.filter((x) => (x.day ?? null) === day)

  return (
    <div className="grid gap-4">
      <div className="-mx-5 overflow-x-auto px-5 no-scrollbar">
        <div className="flex gap-1.5 pt-2 pr-2 pb-1">
          <DayChip active={day === null} onClick={() => setDay(null)} top="All" bottom="days" count={counts.get("") ?? 0} />
          {days.map((d) => {
            const k = dayKey(d)
            return (
              <DayChip
                key={k}
                active={day === k}
                onClick={() => setDay(k)}
                top={format(d, "EEE")}
                bottom={format(d, "d MMM")}
                count={counts.get(k) ?? 0}
                today={isToday(d)}
              />
            )
          })}
        </div>
      </div>
      <p className="text-[13px] text-muted-foreground">
        {day === null
          ? "Data for the whole event. Pick a date above to log things for a single day."
          : `Data for ${format(new Date(day + "T00:00:00"), "EEEE, d MMMM")}.`}
      </p>
      {isLoading ? (
        <div className="grid gap-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : shown.length ? (
        <EntryList entries={shown} readOnly={readOnly} />
      ) : (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">
          Nothing logged {day ? "for this date" : "for the whole event"} yet.
        </p>
      )}
      {!readOnly && <EntryComposer eventId={event.id} day={day} />}
    </div>
  )
}

function DayChip({
  active,
  onClick,
  top,
  bottom,
  count,
  today,
}: {
  active: boolean
  onClick: () => void
  top: string
  bottom: string
  count: number
  today?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex h-14 min-w-14 shrink-0 flex-col items-center justify-center rounded-xl border px-2 transition-colors",
        active ? "border-ink bg-ink text-ink-foreground" : "bg-card hover:bg-muted",
        today && !active && "border-primary/50"
      )}
    >
      <span className={cn("text-[11px]", active ? "opacity-70" : "text-muted-foreground")}>{top}</span>
      <span className="text-[13px] font-semibold tabular">{bottom}</span>
      {count > 0 && (
        <span className="absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular">
          {count}
        </span>
      )}
    </button>
  )
}

// ---------------------------------------------------------------- activity

function ActivityList({ eventId }: { eventId: string }) {
  const { data = [], isLoading } = useActivity(eventId)
  if (isLoading) return <div className="h-24 animate-pulse rounded-xl bg-muted" />
  if (!data.length)
    return <p className="py-6 text-center text-[13px] text-muted-foreground">No activity yet.</p>
  return (
    <ol className="relative grid gap-4 border-l pl-5">
      {data.map((a) => (
        <li key={a.id} className="relative">
          <span className="absolute top-1.5 -left-[25px] size-2 rounded-full bg-border ring-4 ring-background" />
          <p className="text-[13px]">
            <span className="font-medium">{a.userName}</span> <span className="text-muted-foreground">{a.action}</span>
          </p>
          {a.detail && <p className="text-[12px] text-muted-foreground">{a.detail}</p>}
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground/80">
            <HistoryIcon className="size-3" /> {relTime(a.createdAt)}
          </p>
        </li>
      ))}
    </ol>
  )
}

function GooglePushButton({ event }: { event: Ev }) {
  // A prefilled Google Calendar link: no Google permission, works in every browser.
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Add to Google Calendar"
      title="Add to Google Calendar"
      className="text-muted-foreground"
      render={<a href={googleCalendarEventUrl(event, window.location.origin)} target="_blank" rel="noreferrer" />}
    >
      <CalendarPlusIcon />
    </Button>
  )
}
