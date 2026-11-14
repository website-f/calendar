import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { addDays, format } from "date-fns"
import { toast } from "sonner"
import {
  CalendarDaysIcon,
  CheckIcon,
  FileSpreadsheetIcon,
  FolderOpenIcon,
  Loader2Icon,
  LogOutIcon,
  PlugIcon,
  UploadIcon,
  DownloadIcon,
  ExternalLinkIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { useEventMutations } from "@/lib/data"
import { dayKey, safeDate } from "@/lib/dates"
import {
  connectedAccount,
  disconnectGoogle,
  exportToSheet,
  getToken,
  googleConfigured,
  hasLiveToken,
  listGoogleCalendar,
  onGoogleChange,
  pickFromDrive,
  pushToGoogleCalendar,
  readSheet,
  type GCalItem,
} from "@/lib/google"
import type { AppConfig, Entry, Ev, Project, Status, User } from "@/lib/types"
import { cn } from "@/lib/utils"
import { FieldRow, NativeSelect, Panel } from "./bits"

type Cfg = AppConfig["google"]

function useGoogleState() {
  return useSyncExternalStore(
    (cb) => onGoogleChange(cb),
    () => `${hasLiveToken()}|${connectedAccount() ?? ""}`,
    () => "false|"
  )
}

export function GooglePanel({
  open,
  onOpenChange,
  cfg,
  events,
  projects,
  users,
  canEdit,
  isAdmin,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  cfg: Cfg | undefined
  events: Ev[]
  projects: Project[]
  users: User[]
  canEdit: boolean
  isAdmin: boolean
}) {
  const state = useGoogleState()
  const [live, account] = state.split("|")
  const configured = googleConfigured(cfg)

  return (
    <Panel
      open={open}
      onOpenChange={onOpenChange}
      title="Google Workspace"
      description="Use your own Google account with Sheets, Drive and Calendar."
      wide
    >
      {!configured ? (
        <SetupNotice isAdmin={isAdmin} />
      ) : (
        <div className="grid gap-4">
          <div className="flex items-center gap-3 rounded-2xl border bg-card p-4">
            <GoogleMark />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium">{account ? account : "Not connected"}</p>
              <p className="text-[12px] text-muted-foreground">
                {live === "true" ? "Connected for this session" : account ? "Reconnects when you use a Google action" : "Connect once, then use any action below"}
              </p>
            </div>
            {account ? (
              <Button variant="ghost" size="sm" onClick={disconnectGoogle}>
                <LogOutIcon /> Disconnect
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => getToken(cfg!, { interactive: true }).then(() => toast.success("Google connected")).catch((e) => toast.error(e.message))}
              >
                <PlugIcon /> Connect
              </Button>
            )}
          </div>

          <SheetsCard cfg={cfg!} events={events} projects={projects} users={users} canEdit={canEdit} />
          <CalendarCard cfg={cfg!} events={events} projects={projects} canEdit={canEdit} />
          <DriveCard cfg={cfg!} />
        </div>
      )}
    </Panel>
  )
}

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-4">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-muted text-foreground">{icon}</span>
        <h3 className="text-[14px] font-semibold tracking-tight">{title}</h3>
      </div>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------- Sheets

const HEADER_MAP: Record<string, string[]> = {
  title: ["title", "event", "name", "task", "activity", "subject", "perkara", "aktiviti"],
  start: ["start", "from", "date", "start date", "begin", "tarikh", "tarikh mula", "mula"],
  end: ["end", "to", "end date", "until", "finish", "due", "tarikh tamat", "tamat"],
  project: ["project", "group", "category", "projek", "kategori"],
  notes: ["notes", "note", "description", "details", "catatan", "keterangan"],
  location: ["location", "venue", "place", "lokasi", "tempat"],
  status: ["status"],
  progress: ["progress", "progress %", "%", "kemajuan"],
}

function detectColumns(header: (string | number)[]) {
  const norm = header.map((h) => String(h ?? "").trim().toLowerCase())
  const map: Record<string, number> = {}
  for (const [field, names] of Object.entries(HEADER_MAP)) {
    const i = norm.findIndex((h) => names.includes(h))
    if (i >= 0) map[field] = i
  }
  return map
}

function toStatus(v: unknown): Status {
  const s = String(v ?? "").toLowerCase()
  if (s.includes("done") || s.includes("complete") || s.includes("siap")) return "done"
  if (s.includes("progress") || s.includes("active") || s.includes("ongoing")) return "active"
  if (s.includes("block") || s.includes("hold")) return "blocked"
  return "planned"
}

function SheetsCard({ cfg, events, projects, users, canEdit }: { cfg: Cfg; events: Ev[]; projects: Project[]; users: User[]; canEdit: boolean }) {
  const [busy, setBusy] = useState<"export" | "import" | null>(null)
  const [lastUrl, setLastUrl] = useState<string | null>(null)
  const [withData, setWithData] = useState(true)
  const [preview, setPreview] = useState<{ title: string; rows: (Partial<Ev> & { title: string; start: string; end: string })[]; skipped: number } | null>(null)
  const [projectId, setProjectId] = useState("")
  const { importMany } = useEventMutations()

  const doExport = async () => {
    setBusy("export")
    try {
      const entries = withData ? await api<Entry[]>("/api/entries?all=1") : []
      const url = await exportToSheet(cfg, `Calendar export ${format(new Date(), "d MMM yyyy HH:mm")}`, events, projects, users, entries)
      setLastUrl(url)
      toast.success("Spreadsheet created in your Google Drive")
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const doPick = async () => {
    setBusy("import")
    try {
      const [file] = await pickFromDrive(cfg, "sheets", false)
      if (!file) return
      const { title, rows } = await readSheet(cfg, file.id)
      if (rows.length < 2) throw new Error("That sheet has no rows under the header.")
      const cols = detectColumns(rows[0]!)
      if (cols.title === undefined || cols.start === undefined)
        throw new Error("Could not find Title and Start columns. Name your header row e.g. Title, Start, End, Project, Notes.")
      let skipped = 0
      const parsed = rows.slice(1).flatMap((r) => {
        const t = String(r[cols.title!] ?? "").trim()
        const s = safeDate(r[cols.start!])
        if (!t || !s) {
          skipped++
          return []
        }
        const e = cols.end !== undefined ? safeDate(r[cols.end]) : null
        const last = e && e >= s ? e : s
        const pName = cols.project !== undefined ? String(r[cols.project] ?? "").trim().toLowerCase() : ""
        const proj = pName ? projects.find((p) => p.name.toLowerCase() === pName) : undefined
        return [
          {
            title: t.slice(0, 200),
            start: dayKey(s),
            end: dayKey(addDays(last, 1)),
            allDay: true,
            projectId: proj?.id ?? null,
            notes: cols.notes !== undefined ? String(r[cols.notes] ?? "").slice(0, 20000) : "",
            location: cols.location !== undefined ? String(r[cols.location] ?? "").slice(0, 300) : "",
            status: cols.status !== undefined ? toStatus(r[cols.status]) : "planned",
            progress: cols.progress !== undefined ? Math.max(0, Math.min(100, Math.round(Number(r[cols.progress]) || 0))) : 0,
          },
        ]
      })
      if (!parsed.length) throw new Error("No rows had both a title and a valid start date.")
      setPreview({ title, rows: parsed, skipped })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const doImport = () => {
    if (!preview) return
    const rows = preview.rows.map((r) => ({ ...r, projectId: r.projectId ?? (projectId || null) }))
    importMany.mutate(rows, {
      onSuccess: (r) => {
        toast.success(`Imported ${r.created} events from ${preview.title}`)
        setPreview(null)
      },
    })
  }

  return (
    <Card icon={<FileSpreadsheetIcon className="size-4" />} title="Google Sheets">
      <div className="grid gap-3">
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={withData} onChange={(e) => setWithData(e.target.checked)} className="size-4 accent-[var(--primary)]" />
          Include daily data as a second tab
        </label>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={doExport} disabled={busy !== null}>
            {busy === "export" ? <Loader2Icon className="animate-spin" /> : <UploadIcon />} Export to a new sheet
          </Button>
          {canEdit && (
            <Button variant="outline" onClick={doPick} disabled={busy !== null}>
              {busy === "import" ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />} Import from a sheet
            </Button>
          )}
        </div>
        {lastUrl && (
          <a href={lastUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline">
            <ExternalLinkIcon className="size-3.5" /> Open the new spreadsheet
          </a>
        )}
        {preview && (
          <div className="grid gap-3 rounded-xl bg-muted/50 p-3">
            <p className="text-[13px]">
              <span className="font-medium">{preview.rows.length} events</span> ready from <span className="font-medium">{preview.title}</span>
              {preview.skipped > 0 && <span className="text-muted-foreground"> ({preview.skipped} rows skipped)</span>}
            </p>
            <ul className="grid max-h-40 gap-1 overflow-y-auto text-[12px]">
              {preview.rows.slice(0, 30).map((r, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="truncate">{r.title}</span>
                  <span className="shrink-0 font-mono text-muted-foreground tabular">{r.start}</span>
                </li>
              ))}
            </ul>
            <FieldRow label="Put rows without a matching project into">
              <NativeSelect value={projectId} onChange={setProjectId}>
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </FieldRow>
            <div className="flex gap-2">
              <Button onClick={doImport} disabled={importMany.isPending}>
                <CheckIcon /> Import {preview.rows.length}
              </Button>
              <Button variant="ghost" onClick={() => setPreview(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        <p className="text-[12px] text-muted-foreground">
          Import reads the first tab. Header names it understands: Title, Start, End, Project, Notes, Location, Status, Progress.
        </p>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- Calendar

function CalendarCard({ cfg, events, projects, canEdit }: { cfg: Cfg; events: Ev[]; projects: Project[]; canEdit: boolean }) {
  const [scope, setScope] = useState("upcoming")
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [items, setItems] = useState<GCalItem[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const { importMany } = useEventMutations()

  const toPush = useMemo(() => {
    const today = dayKey(new Date())
    if (scope === "upcoming") return events.filter((e) => e.end.slice(0, 10) >= today)
    if (scope === "all") return events
    return events.filter((e) => e.projectId === scope)
  }, [scope, events])

  useEffect(() => setPicked(new Set(items?.map((i) => i.id) ?? [])), [items])

  const push = async () => {
    if (!toPush.length) return toast.info("Nothing to send.")
    setProgress({ done: 0, total: toPush.length })
    try {
      const r = await pushToGoogleCalendar(cfg, toPush, (done) => setProgress({ done, total: toPush.length }))
      toast.success(`Google Calendar updated: ${r.created} added, ${r.updated} refreshed`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setProgress(null)
    }
  }

  const load = async () => {
    setLoading(true)
    try {
      setItems(await listGoogleCalendar(cfg, addDays(new Date(), -7), addDays(new Date(), 90)))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const importPicked = () => {
    const rows = (items ?? [])
      .filter((i) => picked.has(i.id))
      .map((i) => {
        const allDay = Boolean(i.start.date)
        return {
          title: (i.summary || "Untitled").slice(0, 200),
          start: allDay ? i.start.date! : i.start.dateTime!,
          end: allDay ? i.end.date! : i.end.dateTime!,
          allDay,
          notes: (i.description ?? "").slice(0, 20000),
          location: (i.location ?? "").slice(0, 300),
        }
      })
    if (!rows.length) return
    importMany.mutate(rows, {
      onSuccess: (r) => {
        toast.success(`Imported ${r.created} events from Google Calendar`)
        setItems(null)
      },
    })
  }

  return (
    <Card icon={<CalendarDaysIcon className="size-4" />} title="Google Calendar">
      <div className="grid gap-3">
        <FieldRow label="Send to my Google Calendar">
          <div className="flex gap-2">
            <NativeSelect value={scope} onChange={setScope} className="flex-1">
              <option value="upcoming">Upcoming events</option>
              <option value="all">All events</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  Project: {p.name}
                </option>
              ))}
            </NativeSelect>
            <Button variant="outline" onClick={push} disabled={progress !== null}>
              {progress ? `${progress.done}/${progress.total}` : `Send ${toPush.length}`}
            </Button>
          </div>
        </FieldRow>
        <p className="text-[12px] text-muted-foreground">Sending again updates the same Google events instead of making copies.</p>
        {canEdit && (
          <>
            <Button variant="outline" onClick={load} disabled={loading} className="justify-self-start">
              {loading ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />} Bring in my Google events
            </Button>
            {items && (
              <div className="grid gap-2 rounded-xl bg-muted/50 p-3">
                {items.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">No events in the next 90 days.</p>
                ) : (
                  <>
                    <ul className="grid max-h-56 gap-1 overflow-y-auto">
                      {items.map((i) => {
                        const on = picked.has(i.id)
                        const when = i.start.date ?? i.start.dateTime ?? ""
                        return (
                          <li key={i.id}>
                            <button
                              type="button"
                              onClick={() => {
                                const n = new Set(picked)
                                if (on) n.delete(i.id)
                                else n.add(i.id)
                                setPicked(n)
                              }}
                              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] hover:bg-background"
                            >
                              <span className={cn("grid size-4.5 shrink-0 place-items-center rounded border", on && "border-primary bg-primary text-primary-foreground")}>
                                {on && <CheckIcon className="size-3" />}
                              </span>
                              <span className="min-w-0 flex-1 truncate">{i.summary || "Untitled"}</span>
                              <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular">
                                {when ? format(new Date(when.length === 10 ? when + "T00:00:00" : when), "d MMM") : ""}
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                    <Button onClick={importPicked} disabled={!picked.size || importMany.isPending} className="justify-self-start">
                      Import {picked.size}
                    </Button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- Drive

function DriveCard({ cfg }: { cfg: Cfg }) {
  return (
    <Card icon={<FolderOpenIcon className="size-4" />} title="Google Drive">
      <p className="mb-3 text-[13px] text-muted-foreground">
        Attach Drive files, Docs and Sheets to any event or date from its Daily data tab. Files stay in Drive; the calendar keeps a link.
      </p>
      <Button
        variant="outline"
        onClick={() =>
          pickFromDrive(cfg, "any", true)
            .then((f) => f.length && toast.success(`${f.length} file${f.length > 1 ? "s" : ""} can now be attached from any event`))
            .catch((e) => toast.error(e.message))
        }
      >
        <FolderOpenIcon /> Browse my Drive
      </Button>
    </Card>
  )
}

function SetupNotice({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="grid gap-3 rounded-2xl border bg-card p-4 text-[13px]">
      <div className="flex items-center gap-3">
        <GoogleMark />
        <p className="font-medium">Google is not switched on for this workspace yet.</p>
      </div>
      {isAdmin ? (
        <ol className="grid list-decimal gap-1.5 pl-5 text-muted-foreground">
          <li>In Google Cloud Console, create an OAuth client ID (type: Web application).</li>
          <li>
            Add <span className="font-mono text-foreground">{window.location.origin}</span> as an authorised JavaScript origin.
          </li>
          <li>Enable the Google Drive, Sheets, Calendar and Picker APIs, and create an API key.</li>
          <li>
            Put <span className="font-mono text-foreground">GOOGLE_CLIENT_ID</span>, <span className="font-mono text-foreground">GOOGLE_API_KEY</span> and{" "}
            <span className="font-mono text-foreground">GOOGLE_APP_ID</span> (project number) in the server's .env and restart.
          </li>
        </ol>
      ) : (
        <p className="text-muted-foreground">Ask an admin to connect the Google project.</p>
      )}
    </div>
  )
}

function GoogleMark() {
  // Four-colour dots, a neutral nod to Google without using its logo.
  return (
    <span className="grid size-10 shrink-0 grid-cols-2 gap-1 rounded-xl border bg-background p-2.5">
      <span className="rounded-full bg-[#4285F4]" />
      <span className="rounded-full bg-[#EA4335]" />
      <span className="rounded-full bg-[#FBBC05]" />
      <span className="rounded-full bg-[#34A853]" />
    </span>
  )
}
