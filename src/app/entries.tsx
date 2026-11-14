import { useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { toast } from "sonner"
import {
  CheckIcon,
  FileTextIcon,
  HashIcon,
  LinkIcon,
  ListTodoIcon,
  PaperclipIcon,
  StickyNoteIcon,
  Trash2Icon,
  ExternalLinkIcon,
  PlusIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useConfig, useEntryMutations } from "@/lib/data"
import { googleConfigured, googleLinkKind, pickFromDrive, pickerSupported } from "@/lib/google"
import type { Entry, EntryKind } from "@/lib/types"
import { cn } from "@/lib/utils"
import { relTime } from "@/lib/dates"

const KIND_META: Record<EntryKind, { label: string; icon: typeof StickyNoteIcon }> = {
  note: { label: "Note", icon: StickyNoteIcon },
  task: { label: "Task", icon: ListTodoIcon },
  value: { label: "Value", icon: HashIcon },
  link: { label: "Link", icon: LinkIcon },
  file: { label: "File", icon: PaperclipIcon },
}

export function EntryList({
  entries,
  readOnly,
  showEventTitle,
  eventTitle,
  compact,
}: {
  entries: Entry[]
  readOnly?: boolean
  showEventTitle?: boolean
  eventTitle?: (id: string) => string
  compact?: boolean
}) {
  const { update, remove } = useEntryMutations()
  const reduce = useReducedMotion()
  if (!entries.length) return null
  return (
    <ul className="grid gap-1.5">
      <AnimatePresence initial={false}>
        {entries.map((x) => {
          const Icon = KIND_META[x.kind].icon
          return (
            <motion.li
              key={x.id}
              layout={!reduce}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0, marginTop: -6 }}
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
              className={cn(
                "group relative flex items-start gap-2.5 rounded-xl border bg-card px-3 py-2.5",
                x.kind === "task" && x.done && "bg-muted/40"
              )}
            >
              {x.kind === "task" ? (
                <button
                  type="button"
                  disabled={readOnly}
                  aria-label={x.done ? "Mark as open" : "Mark as done"}
                  onClick={() => update.mutate({ id: x.id, done: !x.done })}
                  className={cn(
                    "mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border transition-colors",
                    x.done ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background hover:border-primary"
                  )}
                >
                  {x.done && <CheckIcon className="size-3.5" />}
                </button>
              ) : x.kind === "file" && typeof x.meta.iconUrl === "string" ? (
                <img src={x.meta.iconUrl} alt="" className="mt-0.5 size-5 shrink-0" />
              ) : (
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center text-muted-foreground">
                  <Icon className="size-4" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                {showEventTitle && eventTitle && (
                  <div className="mb-0.5 truncate text-[11px] font-medium text-muted-foreground">{eventTitle(x.eventId)}</div>
                )}
                <div className="flex flex-wrap items-baseline gap-x-2">
                  {x.title && (
                    <span className={cn("text-[14px] leading-snug font-medium md:text-[13px]", x.kind === "task" && x.done && "text-muted-foreground line-through")}>
                      {x.title}
                    </span>
                  )}
                  {x.kind === "value" && x.value && (
                    <span className="font-mono text-[13px] font-semibold tabular text-foreground">{x.value}</span>
                  )}
                </div>
                {x.body && !compact && (
                  <p className="mt-0.5 text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground">{x.body}</p>
                )}
                {x.url && (
                  <a
                    href={x.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-1 inline-flex max-w-full items-center gap-1 text-[12px] font-medium text-primary hover:underline"
                  >
                    <ExternalLinkIcon className="size-3 shrink-0" />
                    <span className="truncate">{x.kind === "file" ? openLabel(x.meta.mimeType) : x.url.replace(/^https?:\/\//, "")}</span>
                  </a>
                )}
                {!compact && <div className="mt-1 text-[11px] text-muted-foreground/80">{relTime(x.updatedAt)}</div>}
              </div>
              {!readOnly && (
                <button
                  type="button"
                  aria-label="Delete"
                  onClick={() => remove.mutate(x.id)}
                  className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground opacity-100 transition hover:bg-destructive/10 hover:text-destructive md:size-7 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                >
                  <Trash2Icon className="size-3.5" />
                </button>
              )}
            </motion.li>
          )
        })}
      </AnimatePresence>
    </ul>
  )
}

export function EntryComposer({ eventId, day }: { eventId: string; day: string | null }) {
  const [kind, setKind] = useState<EntryKind>("note")
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [value, setValue] = useState("")
  const [url, setUrl] = useState("")
  const { create } = useEntryMutations()
  const cfg = useConfig().data?.google

  const reset = () => {
    setTitle("")
    setBody("")
    setValue("")
    setUrl("")
  }

  const canSave =
    (kind === "note" && (title.trim() || body.trim())) ||
    (kind === "task" && title.trim()) ||
    (kind === "value" && title.trim() && value.trim()) ||
    (kind === "link" && /^https?:\/\//i.test(url.trim()))

  const save = () => {
    if (!canSave) return
    // A pasted Google Drive / Docs / Sheets link is stored as a file entry so it shows its type.
    const g = kind === "link" ? googleLinkKind(url.trim()) : null
    create.mutate(
      {
        eventId,
        day,
        kind: g ? "file" : kind,
        title: title.trim() || g?.label || (kind === "link" ? url.trim().replace(/^https?:\/\//, "").slice(0, 80) : ""),
        body: body.trim(),
        value: value.trim(),
        url: url.trim(),
        meta: g ? { mimeType: g.mimeType, source: "link" } : undefined,
      },
      { onSuccess: reset }
    )
  }

  const attachDrive = async () => {
    if (!cfg) return
    try {
      const files = await pickFromDrive(cfg, "any", true)
      for (const f of files) {
        await create.mutateAsync({
          eventId,
          day,
          kind: "file",
          title: f.name,
          url: f.url,
          meta: { driveId: f.id, mimeType: f.mimeType, iconUrl: f.iconUrl },
        })
      }
      if (files.length) toast.success(`${files.length} file${files.length > 1 ? "s" : ""} attached`)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const kinds: EntryKind[] = ["note", "task", "value", "link"]

  return (
    <div className="rounded-2xl border bg-card p-2">
      <div className="no-scrollbar flex items-center gap-1 overflow-x-auto pb-2">
        {kinds.map((k) => {
          const Icon = KIND_META[k].icon
          return (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition-colors md:h-7",
                kind === k ? "bg-ink text-ink-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="size-3.5" />
              {KIND_META[k].label}
            </button>
          )
        })}
        {googleConfigured(cfg) && pickerSupported() && (
          <button
            type="button"
            onClick={attachDrive}
            className="ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:h-7"
          >
            <DriveGlyph className="size-3.5" />
            Browse Drive
          </button>
        )}
      </div>
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        {kind === "link" && (
          <Input inputMode="url" type="url" placeholder="Paste a web, Google Drive, Docs or Sheets link" value={url} onChange={(e) => setUrl(e.target.value)} />
        )}
        <div className="flex gap-2">
          <Input
            placeholder={
              kind === "task"
                ? "What needs doing?"
                : kind === "value"
                  ? "Label, e.g. Attendance"
                  : kind === "link"
                    ? "Title (optional)"
                    : "Title"
            }
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          {kind === "value" && (
            <Input className="w-28 font-mono" placeholder="42" value={value} onChange={(e) => setValue(e.target.value)} />
          )}
        </div>
        {kind === "note" && (
          <Textarea placeholder="Write the details for this date..." value={body} onChange={(e) => setBody(e.target.value)} className="min-h-20" />
        )}
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={!canSave || create.isPending}>
            <PlusIcon /> Add {KIND_META[kind].label.toLowerCase()}
          </Button>
        </div>
      </form>
    </div>
  )
}

function openLabel(mime: unknown) {
  const m = String(mime ?? "")
  if (m.includes("spreadsheet")) return "Open in Google Sheets"
  if (m.includes("document")) return "Open in Google Docs"
  if (m.includes("presentation")) return "Open in Google Slides"
  if (m.includes("form")) return "Open in Google Forms"
  return "Open in Google Drive"
}

export function DriveGlyph({ className }: { className?: string }) {
  return <FileTextIcon className={className} />
}
