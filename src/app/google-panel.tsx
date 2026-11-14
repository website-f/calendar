import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { addDays, format } from "date-fns"
import { toast } from "sonner"
import {
  CalendarDaysIcon,
  CheckIcon,
  CopyIcon,
  FileSpreadsheetIcon,
  FileUpIcon,
  FolderOpenIcon,
  Loader2Icon,
  LogOutIcon,
  PlugIcon,
  UploadIcon,
  DownloadIcon,
  ExternalLinkIcon,
  RssIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { api } from "@/lib/api"
import { useEventMutations, useShareMutations } from "@/lib/data"
import { dayKey, safeDate } from "@/lib/dates"
import {
  connectedAccount,
  disconnectGoogle,
  exportToSheet,
  getToken,
  googleCalendarSubscribeUrl,
  googleConfigured,
  googleFileId,
  hasLiveToken,
  onGoogleChange,
  pickFromDrive,
  pickerSupported,
  readSheet,
} from "@/lib/google"
import { parseCsv, parseIcs, type IcsEvent } from "@/lib/importers"
import type { AppConfig, Entry, Ev, Project, Share, Status, User } from "@/lib/types"
import { cn } from "@/lib/utils"
import { FieldRow, NativeSelect, Panel } from "./bits"

type Cfg = AppConfig["google"]
type Row = Partial<Ev> & { title: string; start: string; end: string }

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
  shares,
  canEdit,
  isAdmin,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  cfg: Cfg | undefined
  events: Ev[]
  projects: Project[]
  users: User[]
  shares: Share[]
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
      description="Sheets, Calendar and Drive, with your own Google account."
      wide
    >
      <div className="grid gap-4">
        {configured ? (
          <div className="flex items-center gap-3 rounded-2xl border bg-card p-4">
            <GoogleMark />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium">{account ? account : "Not connected"}</p>
              <p className="text-[12px] text-muted-foreground">
                {live === "true"
                  ? "Connected for this session"
                  : account
                    ? "Reconnects when you use a Google action"
                    : "Needed only for exporting to Sheets and browsing Drive"}
              </p>
            </div>
            {account ? (
              <Button variant="ghost" size="sm" onClick={disconnectGoogle}>
                <LogOutIcon /> Disconnect
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() =>
                  getToken(cfg!, { interactive: true })
                    .then(() => toast.success("Google connected"))
                    .catch((e) => toast.error(e.message))
                }
              >
                <PlugIcon /> Connect
              </Button>
            )}
          </div>
        ) : (
          <SetupNotice isAdmin={isAdmin} />
        )}

        <CalendarCard shares={shares} projects={projects} canEdit={canEdit} />
        <SheetsCard cfg={configured ? cfg! : null} events={events} projects={projects} users={users} canEdit={canEdit} />
        <DriveCard />
      </div>
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

function SubHead({ children }: { children: React.ReactNode }) {
  return <span className="text-[12px] font-medium text-muted-foreground">{children}</span>
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const el = document.createElement("textarea")
    el.value = text
    el.style.cssText = "position:fixed;opacity:0;font-size:16px"
    document.body.appendChild(el)
    el.select()
    document.execCommand("copy")
    el.remove()
  }
}

// ---------------------------------------------------------------- Calendar

function CalendarCard({ shares, projects, canEdit }: { shares: Share[]; projects: Project[]; canEdit: boolean }) {
  const live = shares.filter((s) => !s.revoked && (!s.expiresAt || new Date(s.expiresAt) > new Date()))
  const [shareId, setShareId] = useState<string>("")
  const { create } = useShareMutations()
  const { importMany } = useEventMutations()
  const fileRef = useRef<HTMLInputElement>(null)
  const [ics, setIcs] = useState<{ name: string; items: IcsEvent[] } | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [projectId, setProjectId] = useState("")

  useEffect(() => {
    if (!shareId && live[0]) setShareId(live[0].id)
  }, [live, shareId])
  useEffect(() => setPicked(new Set(ics?.items.map((i) => i.uid) ?? [])), [ics])

  const share = live.find((s) => s.id === shareId)
  const feed = share ? `${window.location.origin}/api/public/${share.token}/calendar.ics` : ""
  const label = (s: Share) =>
    s.title ||
    (s.scope === "all" ? "Whole calendar" : s.scope === "project" ? `Project: ${projects.find((p) => p.id === s.targetId)?.name ?? "?"}` : "One event")

  const onFile = async (f: File | undefined) => {
    if (!f) return
    try {
      const items = parseIcs(await f.text())
      if (!items.length) throw new Error("No events found in that file.")
      setIcs({ name: f.name, items })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const importPicked = () => {
    if (!ics) return
    const rows: Row[] = ics.items
      .filter((i) => picked.has(i.uid))
      .map((i) => ({ title: i.title, start: i.start, end: i.end, allDay: i.allDay, notes: i.notes, location: i.location, projectId: projectId || null }))
    if (!rows.length) return
    importMany.mutate(rows, {
      onSuccess: (r) => {
        toast.success(`Imported ${r.created} events`)
        setIcs(null)
      },
    })
  }

  return (
    <Card icon={<CalendarDaysIcon className="size-4" />} title="Google Calendar">
      <div className="grid gap-4">
        <div className="grid gap-2">
          <SubHead>Show this calendar inside Google Calendar</SubHead>
          {live.length === 0 ? (
            <div className="grid gap-2 rounded-xl bg-muted/50 p-3 text-[13px]">
              <p className="text-muted-foreground">
                Google Calendar follows a share link. Make one for the whole calendar to start; it stays in sync automatically.
              </p>
              {canEdit && (
                <Button
                  variant="outline"
                  className="justify-self-start"
                  disabled={create.isPending}
                  onClick={() => create.mutate({ scope: "all", title: "Orion Calendar", includeNotes: true, includeEntries: false })}
                >
                  <RssIcon /> Create a calendar feed
                </Button>
              )}
            </div>
          ) : (
            <>
              {live.length > 1 && (
                <NativeSelect value={shareId} onChange={setShareId}>
                  {live.map((s) => (
                    <option key={s.id} value={s.id}>
                      {label(s)}
                    </option>
                  ))}
                </NativeSelect>
              )}
              <div className="flex flex-wrap gap-2">
                <Button render={<a href={googleCalendarSubscribeUrl(feed)} target="_blank" rel="noreferrer" />}>
                  <CalendarDaysIcon /> Add to Google Calendar
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    await copyText(feed)
                    toast.success("Feed link copied", { description: "Paste it in Outlook or Apple Calendar under Add calendar > From URL." })
                  }}
                >
                  <CopyIcon /> Copy feed link
                </Button>
              </div>
              <p className="text-[12px] text-muted-foreground">
                Google Calendar refreshes the feed by itself every few hours. Each event also has its own Add to Google Calendar button.
              </p>
            </>
          )}
        </div>

        {canEdit && (
          <div className="grid gap-2">
            <SubHead>Bring events in from Google Calendar</SubHead>
            <p className="text-[12px] text-muted-foreground">
              In Google Calendar open Settings, then Import &amp; export, then Export. Unzip it and choose the .ics file here.
            </p>
            <input ref={fileRef} type="file" accept=".ics,text/calendar" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <Button variant="outline" className="justify-self-start" onClick={() => fileRef.current?.click()}>
              <FileUpIcon /> Choose .ics file
            </Button>
            {ics && (
              <div className="grid gap-2 rounded-xl bg-muted/50 p-3">
                <p className="text-[13px]">
                  <span className="font-medium">{ics.items.length} events</span> in {ics.name}
                </p>
                <ul className="grid max-h-56 gap-1 overflow-y-auto">
                  {ics.items.map((i) => {
                    const on = picked.has(i.uid)
                    return (
                      <li key={i.uid}>
                        <button
                          type="button"
                          onClick={() => {
                            const n = new Set(picked)
                            if (on) n.delete(i.uid)
                            else n.add(i.uid)
                            setPicked(n)
                          }}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] hover:bg-background"
                        >
                          <span className={cn("grid size-4.5 shrink-0 place-items-center rounded border", on && "border-primary bg-primary text-primary-foreground")}>
                            {on && <CheckIcon className="size-3" />}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{i.title}</span>
                          <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular">
                            {format(new Date(i.allDay ? i.start + "T00:00:00" : i.start), "d MMM yy")}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} label="Put them in" />
                <div className="flex gap-2">
                  <Button onClick={importPicked} disabled={!picked.size || importMany.isPending}>
                    <CheckIcon /> Import {picked.size}
                  </Button>
                  <Button variant="ghost" onClick={() => setIcs(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

function ProjectPicker({ projects, value, onChange, label }: { projects: Project[]; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <FieldRow label={label}>
      <NativeSelect value={value} onChange={onChange}>
        <option value="">No project</option>
        {projects
          .filter((p) => !p.archived)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </NativeSelect>
    </FieldRow>
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

/** Turn spreadsheet rows (header first) into events. */
function rowsToEvents(rows: (string | number)[][], projects: Project[]): { rows: Row[]; skipped: number } {
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
        status: cols.status !== undefined ? toStatus(r[cols.status]) : ("planned" as Status),
        progress: cols.progress !== undefined ? Math.max(0, Math.min(100, Math.round(Number(r[cols.progress]) || 0))) : 0,
      },
    ]
  })
  if (!parsed.length) throw new Error("No rows had both a title and a valid start date.")
  return { rows: parsed, skipped }
}

function SheetsCard({
  cfg,
  events,
  projects,
  users,
  canEdit,
}: {
  cfg: Cfg | null
  events: Ev[]
  projects: Project[]
  users: User[]
  canEdit: boolean
}) {
  const [busy, setBusy] = useState<"export" | "import" | null>(null)
  const [lastUrl, setLastUrl] = useState<string | null>(null)
  const [withData, setWithData] = useState(true)
  const [preview, setPreview] = useState<{ title: string; rows: Row[]; skipped: number } | null>(null)
  const [projectId, setProjectId] = useState("")
  const [sheetLink, setSheetLink] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)
  const { importMany } = useEventMutations()

  const run = async (title: string, load: () => Promise<(string | number)[][]>) => {
    setBusy("import")
    try {
      const { rows, skipped } = rowsToEvents(await load(), projects)
      setPreview({ title, rows, skipped })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const doExport = async () => {
    if (!cfg) return
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

  const doLink = () => {
    const id = googleFileId(sheetLink)
    if (!id) {
      toast.error("Paste the link of a Google Sheet (it contains /spreadsheets/d/...).")
      return
    }
    const gid = sheetLink.match(/[#&?]gid=(\d+)/)?.[1] ?? ""
    run("your sheet", async () => {
      const { csv } = await api<{ csv: string }>(`/api/sheets/csv?id=${encodeURIComponent(id)}${gid ? `&gid=${gid}` : ""}`)
      return parseCsv(csv)
    })
  }

  const doPick = async () => {
    if (!cfg) return
    const [file] = await pickFromDrive(cfg, "sheets", false).catch((err) => {
      toast.error((err as Error).message)
      return []
    })
    if (file) run(file.name, async () => (await readSheet(cfg, file.id)).rows)
  }

  const doFile = (f: File | undefined) => {
    if (!f) return
    run(f.name, async () => parseCsv(await f.text()))
    if (fileRef.current) fileRef.current.value = ""
  }

  const doImport = () => {
    if (!preview) return
    const rows = preview.rows.map((r) => ({ ...r, projectId: r.projectId ?? (projectId || null) }))
    importMany.mutate(rows, {
      onSuccess: (r) => {
        toast.success(`Imported ${r.created} events from ${preview.title}`)
        setPreview(null)
        setSheetLink("")
      },
    })
  }

  return (
    <Card icon={<FileSpreadsheetIcon className="size-4" />} title="Google Sheets">
      <div className="grid gap-4">
        {cfg && (
          <div className="grid gap-2">
            <SubHead>Export</SubHead>
            <label className="flex items-center gap-2 text-[13px]">
              <Checkbox checked={withData} onCheckedChange={(v) => setWithData(Boolean(v))} />
              Include daily data as a second tab
            </label>
            <Button variant="outline" className="justify-self-start" onClick={doExport} disabled={busy !== null}>
              {busy === "export" ? <Loader2Icon className="animate-spin" /> : <UploadIcon />} Export to a new sheet
            </Button>
            {lastUrl && (
              <a href={lastUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline">
                <ExternalLinkIcon className="size-3.5" /> Open the new spreadsheet
              </a>
            )}
          </div>
        )}

        {canEdit && (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              doLink()
            }}
          >
            <SubHead>Import events from a sheet</SubHead>
            <div className="flex gap-2">
              <Input inputMode="url" placeholder="Paste the Google Sheet link" value={sheetLink} onChange={(e) => setSheetLink(e.target.value)} className="flex-1" />
              <Button type="submit" variant="outline" disabled={busy !== null || !sheetLink.trim()}>
                {busy === "import" ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />} Read
              </Button>
            </div>
            <p className="text-[12px] text-muted-foreground">
              The sheet must be shared as "Anyone with the link can view". Header names it understands: Title, Start, End, Project, Notes, Location, Status,
              Progress.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => doFile(e.target.files?.[0])} />
              <button type="button" onClick={() => fileRef.current?.click()} className="text-[12px] font-medium text-primary hover:underline">
                Or upload a CSV file
              </button>
              {cfg && pickerSupported() && (
                <button type="button" onClick={doPick} disabled={busy !== null} className="text-[12px] font-medium text-primary hover:underline">
                  Or browse your Drive
                </button>
              )}
            </div>
          </form>
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
            <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} label="Put rows without a matching project into" />
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
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- Drive

function DriveCard() {
  const usePicker = useMemo(() => pickerSupported(), [])
  return (
    <Card icon={<FolderOpenIcon className="size-4" />} title="Google Drive">
      <p className="text-[13px] text-muted-foreground">
        Attach Drive files, Docs and Sheets to any event or date: open the event, go to <span className="font-medium text-foreground">Daily data</span>, choose{" "}
        <span className="font-medium text-foreground">Link</span> and paste the file's share link. Files stay in Drive; the calendar keeps the link.
        {usePicker && " In this browser you can also use Browse Drive there."}
      </p>
    </Card>
  )
}

function SetupNotice({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="grid gap-3 rounded-2xl border bg-card p-4 text-[13px]">
      <div className="flex items-center gap-3">
        <GoogleMark />
        <p className="font-medium">Google sign-in is not switched on for this workspace.</p>
      </div>
      <p className="text-muted-foreground">
        {isAdmin
          ? "Calendar feeds and imports below still work. Exporting to Sheets and browsing Drive need GOOGLE_CLIENT_ID, GOOGLE_API_KEY and GOOGLE_APP_ID in the server's .env."
          : "Calendar feeds and imports below still work. Ask an admin to switch on Google sign-in for Sheets export."}
      </p>
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
