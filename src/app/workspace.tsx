import { useCallback, useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { addDays, format, isSameDay, startOfDay } from "date-fns"
import { toast } from "sonner"
import {
  CalendarDaysIcon,
  ChartGanttIcon,
  EyeIcon,
  EyeOffIcon,
  LogOutIcon,
  MenuIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  Settings2Icon,
  Share2Icon,
  UsersIcon,
  XIcon,
  FolderPlusIcon,
  PartyPopperIcon,
} from "lucide-react"
import type { CalendarView } from "@/components/reui/event-calendar/event-calendar-types"
import type { GanttScale } from "@/components/reui/gantt/gantt-types"
import { Button } from "@/components/ui/button"
import { Calendar as MiniCalendar } from "@/components/ui/calendar"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { api } from "@/lib/api"
import {
  useConfig,
  useEventMutations,
  useLiveSync,
  useProjectMutations,
} from "@/lib/data"
import { coversDay, dayKey, evStart, parseDay, rangeLabel } from "@/lib/dates"
import { offDayDates } from "@/lib/holidays"
import type { Bootstrap, Ev, Project, Share } from "@/lib/types"
import { HOLIDAY_COLOR, SWATCHES } from "@/lib/types"
import { useIsDesktop, withViewTransition } from "@/lib/use-media"
import { cn } from "@/lib/utils"
import { Avatar, Logo, Panel, FieldRow, Segmented, Swatches } from "./bits"
import { Board, type BoardMode } from "./board"
import { DayPanel } from "./day-panel"
import { EventPanel, type Draft } from "./event-panel"
import { GooglePanel } from "./google-panel"
import { SettingsPanel } from "./settings-panel"
import { SharePanel } from "./share-panel"

const NONE = "__none"
const HOLIDAYS_KEY = "__holidays"
const LS_HIDDEN = "cal.hiddenProjects"
const LS_MODE = "cal.mode"

function readLS<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
function writeLS(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* ignore */
  }
}

export function Workspace({ boot, onSignOut }: { boot: Bootstrap; onSignOut: () => void }) {
  useLiveSync(boot.version)
  const qc = useQueryClient()
  const desktop = useIsDesktop()
  const cfg = useConfig().data
  const canEdit = boot.me.role !== "viewer"
  const isAdmin = boot.me.role === "admin"
  const { update: updateEvent } = useEventMutations()

  // ---- view state
  const [mode, setModeRaw] = useState<BoardMode>(() => readLS<BoardMode>(LS_MODE, "calendar"))
  const [date, setDate] = useState(() => new Date())
  const [calView, setCalView] = useState<CalendarView>("month")
  const [scale, setScale] = useState<GanttScale>("month")
  const [hidden, setHidden] = useState<string[]>(() => readLS<string[]>(LS_HIDDEN, []))
  const [people, setPeople] = useState<string[]>([])
  const [query, setQuery] = useState("")

  const setMode = (m: BoardMode) => {
    if (m === mode) return
    withViewTransition(() => setModeRaw(m))
    writeLS(LS_MODE, m)
  }
  useEffect(() => writeLS(LS_HIDDEN, hidden), [hidden])

  // ---- panels
  const [evPanel, setEvPanel] = useState<{ id: string | null; draft: Draft | null; day?: string | null; tab?: "details" | "data" } | null>(null)
  const [dayPanel, setDayPanel] = useState<Date | null>(null)
  const [share, setShare] = useState<{ scope: Share["scope"]; targetId: string | null } | null | undefined>(undefined)
  const [googleOpen, setGoogleOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [projectEdit, setProjectEdit] = useState<Project | "new" | null>(null)

  const openEvent = useCallback((id: string, opts?: { day?: string }) => {
    setDayPanel(null)
    setEvPanel({ id, draft: null, day: opts?.day ?? null, tab: opts?.day ? "data" : "details" })
  }, [])
  const newEvent = useCallback(
    (draft?: Partial<Draft>) => {
      if (!canEdit) return
      const s = startOfDay(draft?.start ? new Date(draft.start) : date)
      setDayPanel(null)
      setEvPanel({
        id: null,
        draft: {
          start: draft?.start ?? dayKey(s),
          end: draft?.end ?? dayKey(addDays(s, 1)),
          allDay: draft?.allDay ?? true,
          projectId: draft?.projectId ?? null,
        },
      })
    },
    [canEdit, date]
  )

  // ---- data shaping
  const projects = boot.projects
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return boot.events.filter((e) => {
      const pk = e.projectId && projects.some((p) => p.id === e.projectId && !p.archived) ? e.projectId : NONE
      if (hidden.includes(pk)) return false
      if (people.length && !e.assignees.some((a) => people.includes(a))) return false
      if (q && !`${e.title} ${e.notes} ${e.location}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [boot.events, hidden, people, query, projects])
  const dayMarks = useMemo(() => new Set(boot.dayMarks.map((d) => d.day)), [boot.dayMarks])
  const showHolidays = !hidden.includes(HOLIDAYS_KEY)
  const holidays = useMemo(() => (showHolidays ? boot.holidays : []), [showHolidays, boot.holidays])
  const offDates = useMemo(() => offDayDates(holidays, boot.holidaySettings.region), [holidays, boot.holidaySettings.region])
  const current = evPanel?.id ? (boot.events.find((e) => e.id === evPanel.id) ?? null) : null

  // Close the editor if a teammate deletes the event under us.
  useEffect(() => {
    if (evPanel?.id && !current) setEvPanel(null)
  }, [evPanel?.id, current])

  // ---- keyboard shortcuts (desktop)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setCmdOpen((v) => !v)
        return
      }
      if (t.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "c") newEvent()
      else if (e.key === "g") setMode(mode === "calendar" ? "gantt" : "calendar")
      else if (e.key === "/") {
        e.preventDefault()
        setCmdOpen(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  // ---- reorder from the gantt tree
  const reorderEvents = (changes: { id: string; sort: number; projectId: string | null }[]) => {
    changes.forEach((c) => updateEvent.mutate({ id: c.id, sort: c.sort, projectId: c.projectId }))
  }
  const reorderProjects = async (ids: string[]) => {
    const prev = qc.getQueryData<Bootstrap>(["bootstrap"])
    if (prev)
      qc.setQueryData<Bootstrap>(["bootstrap"], {
        ...prev,
        projects: prev.projects.map((p) => ({ ...p, sort: ids.indexOf(p.id) === -1 ? p.sort : ids.indexOf(p.id) })).sort((a, b) => a.sort - b.sort),
      })
    try {
      await api("/api/projects/reorder", { body: { ids } })
    } catch (err) {
      if (prev) qc.setQueryData(["bootstrap"], prev)
      toast.error((err as Error).message)
    }
  }

  const sidebar = (
    <Sidebar
      boot={boot}
      date={date}
      onPickDate={(d) => {
        setDate(d)
        setMenuOpen(false)
      }}
      onOpenDay={(d) => {
        setMenuOpen(false)
        setDayPanel(d)
      }}
      hidden={hidden}
      setHidden={setHidden}
      onEditProject={(p) => setProjectEdit(p)}
      onNewProject={() => setProjectEdit("new")}
      onOpenEvent={(id) => {
        setMenuOpen(false)
        openEvent(id)
      }}
      canEdit={canEdit}
    />
  )

  return (
    <div className="flex h-dvh min-h-0 w-full overflow-hidden bg-canvas">
      {/* Desktop sidebar */}
      {desktop && (
        <aside className="flex w-[17.5rem] shrink-0 flex-col">
          <div className="flex h-16 items-center gap-2.5 px-5">
            <Logo />
            <div className="min-w-0">
              <p className="text-[14px] leading-tight font-semibold tracking-tight">Orion Calendar</p>
              <p className="text-[12px] leading-tight text-muted-foreground">Office schedule</p>
            </div>
          </div>
          {canEdit && (
            <div className="px-4 pb-3">
              <Button className="h-10 w-full justify-start gap-2 rounded-xl shadow-soft" onClick={() => newEvent()}>
                <PlusIcon /> New event
                <Kbd className="ml-auto bg-primary-foreground/15 text-primary-foreground">C</Kbd>
              </Button>
            </div>
          )}
          <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-4">{sidebar}</div>
          <div className="flex items-center gap-1 border-t px-3 py-2.5">
            <UserMenu boot={boot} onSettings={() => setSettingsOpen(true)} onSignOut={onSignOut} />
          </div>
        </aside>
      )}

      {/* Main surface */}
      <main className={cn("flex min-w-0 flex-1 flex-col", desktop && "py-2 pr-2")}>
        <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden bg-background", desktop && "rounded-2xl border shadow-soft")}>
          {/* Top bar */}
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 pt-safe md:h-14 md:px-4">
            {!desktop && (
              <div className="flex min-w-0 items-center gap-2">
                <Logo className="size-7 rounded-lg" />
                <span className="truncate text-[15px] font-semibold tracking-tight">Orion Calendar</span>
              </div>
            )}
            {desktop && (
              <Segmented
                layoutId="board-mode"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "calendar", label: "Calendar", icon: <CalendarDaysIcon className="size-3.5" /> },
                  { value: "gantt", label: "Gantt", icon: <ChartGanttIcon className="size-3.5" /> },
                ]}
              />
            )}
            <div className="grow" />
            {desktop && <PeopleFilter users={boot.users} value={people} onChange={setPeople} />}
            <button
              type="button"
              onClick={() => setCmdOpen(true)}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                desktop ? "h-8 w-56 border bg-background px-2.5 text-[13px]" : "size-10 justify-center"
              )}
              aria-label="Search events"
            >
              <SearchIcon className="size-4" />
              {desktop && (
                <>
                  <span className="truncate">{query ? `Filtered: ${query}` : "Search events"}</span>
                  <Kbd className="ml-auto">⌘K</Kbd>
                </>
              )}
            </button>
            {query && (
              <Button variant="ghost" size="icon-sm" aria-label="Clear search" onClick={() => setQuery("")}>
                <XIcon />
              </Button>
            )}
            {desktop && canEdit && (
              <Button variant="outline" onClick={() => setShare(null)}>
                <Share2Icon /> Share
              </Button>
            )}
            {desktop && (
              <Button variant="outline" onClick={() => setGoogleOpen(true)}>
                <GoogleDots /> Google
              </Button>
            )}
            {!desktop && (
              <Button variant="ghost" size="icon" aria-label="Menu" onClick={() => setMenuOpen(true)}>
                <MenuIcon />
              </Button>
            )}
          </header>

          {(people.length > 0 || hidden.some((k) => k !== HOLIDAYS_KEY)) && (
            <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-[12px] text-muted-foreground md:px-4">
              <span>
                Showing {visible.length} of {boot.events.length} events
              </span>
              <button
                type="button"
                className="font-medium text-foreground underline-offset-2 hover:underline"
                onClick={() => {
                  setPeople([])
                  setHidden(hidden.filter((k) => k === HOLIDAYS_KEY))
                }}
              >
                Show all
              </button>
            </div>
          )}

          <Board
            mode={mode}
            events={visible}
            projects={projects}
            users={boot.users}
            readOnly={!canEdit}
            dayMarks={dayMarks}
            date={date}
            onDateChange={setDate}
            calView={calView}
            onCalViewChange={setCalView}
            scale={scale}
            onScaleChange={setScale}
            onOpenEvent={openEvent}
            onOpenDay={(d) => setDayPanel(d)}
            onCreateRange={(r) => newEvent(r)}
            onMove={(id, r) => updateEvent.mutate({ id, ...r })}
            onReorderEvents={reorderEvents}
            onReorderProjects={reorderProjects}
            holidays={holidays}
            offDates={offDates}
          />
        </div>

        {/* Mobile tab bar */}
        {!desktop && (
          <nav className="relative z-20 shrink-0 border-t bg-background/92 pb-safe backdrop-blur-xl">
            <div className="grid h-16 grid-cols-5 items-center">
              <TabButton active={mode === "calendar"} onClick={() => setMode("calendar")} icon={<CalendarDaysIcon />} label="Calendar" />
              <TabButton active={mode === "gantt"} onClick={() => setMode("gantt")} icon={<ChartGanttIcon />} label="Gantt" />
              <div className="grid place-items-center">
                {canEdit ? (
                  <button
                    type="button"
                    aria-label="New event"
                    onClick={() => newEvent()}
                    className="-mt-6 grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-float transition-transform active:scale-95"
                  >
                    <PlusIcon className="size-6" />
                  </button>
                ) : (
                  <span />
                )}
              </div>
              <TabButton
                active={false}
                onClick={() => setDayPanel(new Date())}
                icon={<span className="grid size-5 place-items-center rounded-md border-[1.5px] border-current text-[10px] font-bold tabular">{new Date().getDate()}</span>}
                label="Today"
              />
              <TabButton active={menuOpen} onClick={() => setMenuOpen(true)} icon={<MoreHorizontalIcon />} label="More" />
            </div>
          </nav>
        )}
      </main>

      {/* Mobile menu sheet */}
      {!desktop && (
        <Panel open={menuOpen} onOpenChange={setMenuOpen} title="Menu">
          <div className="mb-4 grid grid-cols-3 gap-2">
            {canEdit && <MenuTile icon={<Share2Icon />} label="Share" onClick={() => { setMenuOpen(false); setShare(null) }} />}
            <MenuTile icon={<GoogleDots />} label="Google" onClick={() => { setMenuOpen(false); setGoogleOpen(true) }} />
            <MenuTile icon={<Settings2Icon />} label="Settings" onClick={() => { setMenuOpen(false); setSettingsOpen(true) }} />
          </div>
          <div className="mb-4">
            <p className="mb-2 px-1 text-[12px] font-medium text-muted-foreground">People</p>
            <PeopleFilter users={boot.users} value={people} onChange={setPeople} wrap />
          </div>
          {sidebar}
          <Button variant="ghost" className="mt-4 w-full justify-start text-muted-foreground" onClick={onSignOut}>
            <LogOutIcon /> Sign out
          </Button>
        </Panel>
      )}

      {/* Panels */}
      <EventPanel
        open={Boolean(evPanel)}
        onOpenChange={(v) => !v && setEvPanel(null)}
        event={current}
        draft={evPanel?.draft ?? null}
        projects={projects}
        users={boot.users}
        events={boot.events}
        readOnly={!canEdit}
        initialTab={evPanel?.tab}
        initialDay={evPanel?.day}
        onShare={canEdit ? (id) => setShare({ scope: "event", targetId: id }) : undefined}
      />
      {dayPanel && (
        <DayPanel
          open={Boolean(dayPanel)}
          onOpenChange={(v) => !v && setDayPanel(null)}
          day={dayPanel}
          onDayChange={(d) => {
            setDayPanel(d)
            setDate(d)
          }}
          events={visible}
          projects={projects}
          users={boot.users}
          readOnly={!canEdit}
          onOpenEvent={openEvent}
          onNewEvent={(d) => newEvent({ start: dayKey(d), end: dayKey(addDays(d, 1)), allDay: true })}
          holidays={holidays}
        />
      )}
      <SharePanel
        open={share !== undefined}
        onOpenChange={(v) => !v && setShare(undefined)}
        shares={boot.shares}
        projects={projects}
        events={boot.events}
        preset={share}
      />
      <GooglePanel
        open={googleOpen}
        onOpenChange={setGoogleOpen}
        cfg={cfg?.google}
        events={visible}
        projects={projects}
        users={boot.users}
        shares={boot.shares}
        canEdit={canEdit}
        isAdmin={isAdmin}
      />
      <SettingsPanel open={settingsOpen} onOpenChange={setSettingsOpen} boot={boot} />
      <ProjectPanel
        project={projectEdit}
        onClose={() => setProjectEdit(null)}
        onShare={(id) => {
          setProjectEdit(null)
          setShare({ scope: "project", targetId: id })
        }}
        nextColor={SWATCHES[projects.length % SWATCHES.length]!}
      />
      <CommandDialog open={cmdOpen} onOpenChange={setCmdOpen} title="Search events" className="top-[max(0.75rem,env(safe-area-inset-top))] sm:top-1/3">
        <SearchPalette
          events={boot.events}
          projects={projects}
          onPick={(id) => {
            setCmdOpen(false)
            const e = boot.events.find((x) => x.id === id)
            if (e) setDate(evStart(e))
            openEvent(id)
          }}
          onFilter={(q) => {
            setQuery(q)
            setCmdOpen(false)
          }}
          onNew={
            canEdit
              ? () => {
                  setCmdOpen(false)
                  newEvent()
                }
              : undefined
          }
        />
      </CommandDialog>
    </div>
  )
}

// ---------------------------------------------------------------- pieces

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors [&_svg]:size-5",
        active ? "text-foreground" : "text-muted-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function MenuTile({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-20 flex-col items-center justify-center gap-2 rounded-2xl border bg-card text-[12px] font-medium transition-colors active:bg-muted [&_svg]:size-5"
    >
      {icon}
      {label}
    </button>
  )
}

function GoogleDots() {
  return (
    <span className="grid size-4 grid-cols-2 gap-[2px]" aria-hidden>
      <span className="rounded-full bg-[#4285F4]" />
      <span className="rounded-full bg-[#EA4335]" />
      <span className="rounded-full bg-[#FBBC05]" />
      <span className="rounded-full bg-[#34A853]" />
    </span>
  )
}

function PeopleFilter({
  users,
  value,
  onChange,
  wrap,
}: {
  users: Bootstrap["users"]
  value: string[]
  onChange: (v: string[]) => void
  wrap?: boolean
}) {
  if (users.length < 2) return null
  return (
    <div className={cn("flex items-center", wrap ? "flex-wrap gap-1.5" : "-space-x-1")}>
      {!wrap && <UsersIcon className="mr-2 size-4 text-muted-foreground" />}
      {users.map((u) => {
        const on = value.includes(u.id)
        return (
          <button
            key={u.id}
            type="button"
            title={`Only show ${u.name}`}
            onClick={() => onChange(on ? value.filter((x) => x !== u.id) : [...value, u.id])}
            className={cn(
              "rounded-full transition-all",
              wrap && "inline-flex h-9 items-center gap-2 border py-1 pr-3 pl-1 text-[13px]",
              wrap && on && "border-transparent bg-ink text-ink-foreground",
              !wrap && (value.length && !on ? "opacity-35 hover:opacity-80" : "hover:-translate-y-0.5"),
              !wrap && on && "relative z-10 ring-2 ring-primary ring-offset-1 ring-offset-background"
            )}
          >
            <Avatar user={u} size={wrap ? 26 : 26} className={wrap ? "ring-0" : undefined} />
            {wrap && u.name.split(" ")[0]}
          </button>
        )
      })}
    </div>
  )
}

function UserMenu({ boot, onSettings, onSignOut }: { boot: Bootstrap; onSettings: () => void; onSignOut: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-muted" />
        }
      >
        <Avatar user={boot.me} size={30} className="ring-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{boot.me.name}</span>
          <span className="block truncate text-[11px] text-muted-foreground capitalize">{boot.me.role}</span>
        </span>
        <MoreHorizontalIcon className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuItem onClick={onSettings}>
          <Settings2Icon /> Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSignOut}>
          <LogOutIcon /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Sidebar({
  boot,
  date,
  onPickDate,
  onOpenDay,
  hidden,
  setHidden,
  onEditProject,
  onNewProject,
  onOpenEvent,
  canEdit,
}: {
  boot: Bootstrap
  date: Date
  onPickDate: (d: Date) => void
  onOpenDay: (d: Date) => void
  hidden: string[]
  setHidden: (v: string[]) => void
  onEditProject: (p: Project) => void
  onNewProject: () => void
  onOpenEvent: (id: string) => void
  canEdit: boolean
}) {
  const active = boot.projects.filter((p) => !p.archived)
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    boot.events.forEach((e) => {
      const k = e.projectId && active.some((p) => p.id === e.projectId) ? e.projectId : NONE
      m.set(k, (m.get(k) ?? 0) + 1)
    })
    return m
  }, [boot.events, active])
  const busy = useMemo(() => {
    const s = new Set<string>()
    boot.events.forEach((e) => {
      const start = evStart(e)
      for (let i = 0; i < 62; i++) {
        const d = addDays(start, i)
        if (!coversDay(e, d)) break
        s.add(dayKey(d))
      }
    })
    return s
  }, [boot.events])
  const upNext = useMemo(() => {
    const today = startOfDay(new Date())
    return boot.events
      .filter((e) => evStart(e) >= today || coversDay(e, today))
      .sort((a, b) => evStart(a).getTime() - evStart(b).getTime())
      .slice(0, 5)
  }, [boot.events])

  const toggle = (id: string) => setHidden(hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id])

  return (
    <div className="grid gap-5">
      <div className="rounded-2xl bg-background/60 p-1 ring-1 ring-border/70">
        <MiniCalendar
          mode="single"
          selected={date}
          month={date}
          onMonthChange={onPickDate}
          weekStartsOn={1}
          onSelect={(d) => d && onPickDate(d)}
          onDayClick={(d) => isSameDay(d, date) && onOpenDay(d)}
          modifiers={{ busy: (d) => busy.has(dayKey(d)) }}
          modifiersClassNames={{ busy: "[&>button]:after:absolute [&>button]:after:bottom-1 [&>button]:after:left-1/2 [&>button]:after:size-1 [&>button]:after:-translate-x-1/2 [&>button]:after:rounded-full [&>button]:after:bg-primary/70" }}
          className="w-full bg-transparent p-1 [--cell-size:--spacing(8)] lg:[--cell-size:--spacing(8.5)]"
        />
        <p className="px-2 pb-1.5 text-[11px] text-muted-foreground">Tap a selected day again to open its data.</p>
      </div>

      <section>
        <div className="mb-1 flex items-center justify-between px-2">
          <h3 className="text-[12px] font-medium text-muted-foreground">Projects</h3>
          {canEdit && (
            <Button variant="ghost" size="icon-xs" aria-label="New project" onClick={onNewProject}>
              <FolderPlusIcon />
            </Button>
          )}
        </div>
        <ul className="grid gap-0.5">
          {[...active.map((p) => ({ id: p.id, name: p.name, color: p.color, p })), { id: NONE, name: "No project", color: "#6b7280", p: null }]
            .filter((x) => x.p || (counts.get(NONE) ?? 0) > 0)
            .map((x) => {
              const off = hidden.includes(x.id)
              return (
                <li key={x.id} className="group flex items-center gap-1 rounded-xl pr-1 transition-colors hover:bg-background/70">
                  <button
                    type="button"
                    onClick={() => toggle(x.id)}
                    className="flex h-10 min-w-0 flex-1 items-center gap-2.5 px-2 text-left md:h-9"
                    aria-pressed={!off}
                    title={off ? "Show" : "Hide"}
                  >
                    <span
                      className={cn("size-3 shrink-0 rounded-[4px] transition-all", off && "scale-75 opacity-40")}
                      style={{ background: off ? "transparent" : x.color, boxShadow: `inset 0 0 0 1.5px ${x.color}` }}
                    />
                    <span className={cn("truncate text-[14px] md:text-[13px]", off && "text-muted-foreground line-through decoration-muted-foreground/40")}>{x.name}</span>
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground tabular">{counts.get(x.id) ?? 0}</span>
                  </button>
                  <span className="hidden text-muted-foreground group-hover:inline-flex">{off ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}</span>
                  {x.p && canEdit && (
                    <Button variant="ghost" size="icon-xs" aria-label={`Edit ${x.name}`} onClick={() => onEditProject(x.p!)} className="opacity-100 md:opacity-0 md:group-hover:opacity-100">
                      <MoreHorizontalIcon />
                    </Button>
                  )}
                </li>
              )
            })}
        </ul>
        {boot.holidaySettings.enabled && boot.holidays.length > 0 && (
          <HolidayToggle boot={boot} on={!hidden.includes(HOLIDAYS_KEY)} onToggle={() => toggle(HOLIDAYS_KEY)} onOpenDay={onOpenDay} />
        )}
        {active.length === 0 && canEdit && (
          <button
            type="button"
            onClick={onNewProject}
            className="mt-1 flex h-10 w-full items-center gap-2 rounded-xl border border-dashed px-3 text-[13px] text-muted-foreground hover:text-foreground"
          >
            <FolderPlusIcon className="size-4" /> Create your first project
          </button>
        )}
      </section>

      <section>
        <h3 className="mb-1 px-2 text-[12px] font-medium text-muted-foreground">Up next</h3>
        {upNext.length === 0 ? (
          <p className="px-2 text-[13px] text-muted-foreground">Nothing coming up.</p>
        ) : (
          <ul className="grid gap-0.5">
            {upNext.map((e) => (
              <UpNextItem key={e.id} e={e} projects={boot.projects} onClick={() => onOpenEvent(e.id)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function HolidayToggle({
  boot,
  on,
  onToggle,
  onOpenDay,
}: {
  boot: Bootstrap
  on: boolean
  onToggle: () => void
  onOpenDay: (d: Date) => void
}) {
  const today = dayKey(new Date())
  const next = boot.holidays.find((h) => h.date >= today && (h.national || boot.holidaySettings.region !== "ALL"))
  const region = boot.holidaySettings.region
  return (
    <div className="mt-1 rounded-xl">
      <button type="button" onClick={onToggle} aria-pressed={on} className="flex h-10 w-full items-center gap-2.5 rounded-xl px-2 text-left transition-colors hover:bg-background/70 md:h-9">
        <span
          className={cn("size-3 shrink-0 rounded-[4px] transition-all", !on && "scale-75 opacity-40")}
          style={{ background: on ? HOLIDAY_COLOR : "transparent", boxShadow: `inset 0 0 0 1.5px ${HOLIDAY_COLOR}` }}
        />
        <span className={cn("truncate text-[14px] md:text-[13px]", !on && "text-muted-foreground line-through decoration-muted-foreground/40")}>
          Public holidays
        </span>
        <span className="ml-auto truncate text-[11px] text-muted-foreground">{region === "ALL" ? "All states" : region || "National"}</span>
      </button>
      {on && next && (
        <button
          type="button"
          onClick={() => onOpenDay(parseDay(next.date))}
          className="mx-2 mb-1 flex w-[calc(100%-1rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-muted-foreground hover:bg-background/70"
        >
          <PartyPopperIcon className="size-3.5 shrink-0" style={{ color: HOLIDAY_COLOR }} />
          <span className="truncate">
            Next: <span className="font-medium text-foreground">{next.name}</span>, {format(parseDay(next.date), "EEE d MMM")}
          </span>
        </button>
      )}
    </div>
  )
}

function UpNextItem({ e, projects, onClick }: { e: Ev; projects: Project[]; onClick: () => void }) {
  const color = e.color ?? projects.find((p) => p.id === e.projectId)?.color ?? "#6b7280"
  const s = evStart(e)
  return (
    <li>
      <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-background/70">
        <span className="grid w-9 shrink-0 text-center">
          <span className="text-[10px] font-medium text-muted-foreground uppercase">{format(s, "EEE")}</span>
          <span className="text-[15px] leading-tight font-semibold tabular">{format(s, "d")}</span>
        </span>
        <span className="h-8 w-[3px] shrink-0 rounded-full" style={{ background: color }} />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium">{e.title}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{rangeLabel(e)}</span>
        </span>
      </button>
    </li>
  )
}

function ProjectPanel({
  project,
  onClose,
  onShare,
  nextColor,
}: {
  project: Project | "new" | null
  onClose: () => void
  onShare: (id: string) => void
  nextColor: string
}) {
  const { create, update, remove } = useProjectMutations()
  const isNew = project === "new"
  const [name, setName] = useState("")
  const [color, setColor] = useState(nextColor)
  const [description, setDescription] = useState("")

  useEffect(() => {
    if (!project) return
    setName(isNew ? "" : project.name)
    setColor(isNew ? nextColor : project.color)
    setDescription(isNew ? "" : project.description)
  }, [project, isNew, nextColor])

  const save = () => {
    if (!name.trim()) return
    if (isNew) create.mutate({ name: name.trim(), color, description }, { onSuccess: onClose })
    else if (project) update.mutate({ id: project.id, name: name.trim(), color, description }, { onSuccess: onClose })
  }

  return (
    <Panel
      open={Boolean(project)}
      onOpenChange={(v) => !v && onClose()}
      title={isNew ? "New project" : "Edit project"}
      description="Projects group events on the calendar and become rows on the Gantt chart."
      footer={
        <div className="flex items-center gap-2">
          {!isNew && project && (
            <>
              <Button variant="ghost" onClick={() => onShare(project.id)}>
                <Share2Icon /> Share
              </Button>
              <Button
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => update.mutate({ id: project.id, archived: !project.archived }, { onSuccess: onClose })}
              >
                {project.archived ? "Restore" : "Archive"}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete project"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => {
                  if (confirm(`Delete "${project.name}"? Its events stay, without a project.`)) remove.mutate(project.id, { onSuccess: onClose })
                }}
              >
                <XIcon />
              </Button>
            </>
          )}
          <div className="grow" />
          <Button size="lg" className="md:h-9" onClick={save} disabled={!name.trim()}>
            {isNew ? "Create project" : "Save"}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        <FieldRow label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Annual audit" autoFocus />
        </FieldRow>
        <FieldRow label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        </FieldRow>
        <div className="grid gap-2">
          <span className="text-[12px] font-medium text-muted-foreground">Colour</span>
          <Swatches value={color} onChange={setColor} />
        </div>
      </div>
    </Panel>
  )
}

function SearchPalette({
  events,
  projects,
  onPick,
  onFilter,
  onNew,
}: {
  events: Ev[]
  projects: Project[]
  onPick: (id: string) => void
  onFilter: (q: string) => void
  onNew?: () => void
}) {
  const [q, setQ] = useState("")
  const needle = q.trim().toLowerCase()
  // Plain "contains" matching on what people actually type; cmdk's fuzzy scoring was too loose.
  const results = useMemo(() => {
    const projectName = new Map(projects.map((p) => [p.id, p.name]))
    const list = needle
      ? events.filter((e) =>
          [e.title, e.notes, e.location, e.projectId ? projectName.get(e.projectId) : ""].join(" ").toLowerCase().includes(needle)
        )
      : events
    // Upcoming first (soonest first), then past events (most recent first).
    const today = dayKey(new Date())
    return [...list]
      .sort((a, b) => {
        const af = a.end.slice(0, 10) >= today
        const bf = b.end.slice(0, 10) >= today
        if (af !== bf) return af ? -1 : 1
        return af ? a.start.localeCompare(b.start) : b.start.localeCompare(a.start)
      })
      .slice(0, 100)
  }, [events, projects, needle])

  return (
    <Command loop shouldFilter={false}>
      <CommandInput placeholder="Search by title, notes, place or project..." value={q} onValueChange={setQ} />
      <CommandList>
        <CommandEmpty>No events match "{q.trim()}".</CommandEmpty>
        {needle && results.length > 0 && (
          <CommandGroup heading="Filter">
            <CommandItem value="__filter" onSelect={() => onFilter(q.trim())}>
              <SearchIcon /> Show only events matching "{q.trim()}"
            </CommandItem>
          </CommandGroup>
        )}
        {onNew && !needle && (
          <CommandGroup heading="Actions">
            <CommandItem value="__new" onSelect={onNew}>
              <PlusIcon /> New event
            </CommandItem>
          </CommandGroup>
        )}
        {results.length > 0 && (
          <CommandGroup heading={needle ? `${results.length} result${results.length === 1 ? "" : "s"}` : "Events"}>
            {results.map((e) => {
              const p = projects.find((x) => x.id === e.projectId)
              return (
                <CommandItem key={e.id} value={e.id} onSelect={() => onPick(e.id)}>
                  <span className="size-2 shrink-0 rounded-full" style={{ background: e.color ?? p?.color ?? "#6b7280" }} />
                  <span className="min-w-0 flex-1 truncate">{e.title}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{rangeLabel(e)}</span>
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )
}
