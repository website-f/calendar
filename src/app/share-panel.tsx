import { useEffect, useState } from "react"
import { addDays, format } from "date-fns"
import { toast } from "sonner"
import { CheckIcon, CopyIcon, EyeIcon, Link2OffIcon, Share2Icon, Trash2Icon, GlobeIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useShareMutations } from "@/lib/data"
import type { Ev, Project, Share } from "@/lib/types"
import { cn } from "@/lib/utils"
import { FieldRow, NativeSelect, Panel, Segmented } from "./bits"

export const shareUrl = (s: Pick<Share, "token">) => `${window.location.origin}/s/${s.token}`

export function SharePanel({
  open,
  onOpenChange,
  shares,
  projects,
  events,
  preset,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  shares: Share[]
  projects: Project[]
  events: Ev[]
  preset?: { scope: Share["scope"]; targetId: string | null } | null
}) {
  const { create, update, remove } = useShareMutations()
  const [scope, setScope] = useState<Share["scope"]>("all")
  const [targetId, setTargetId] = useState<string>("")
  const [title, setTitle] = useState("")
  const [includeNotes, setIncludeNotes] = useState(true)
  const [includeEntries, setIncludeEntries] = useState(false)
  const [expiry, setExpiry] = useState("never")

  useEffect(() => {
    if (!open) return
    setScope(preset?.scope ?? "all")
    setTargetId(preset?.targetId ?? "")
    setTitle(
      preset?.scope === "event"
        ? (events.find((e) => e.id === preset.targetId)?.title ?? "")
        : preset?.scope === "project"
          ? (projects.find((p) => p.id === preset.targetId)?.name ?? "")
          : ""
    )
  }, [open, preset, events, projects])

  const makeLink = () => {
    if (scope !== "all" && !targetId) {
      toast.error(scope === "project" ? "Pick a project to share." : "Pick an event to share.")
      return
    }
    const expiresAt = expiry === "never" ? null : addDays(new Date(), Number(expiry)).toISOString()
    create.mutate(
      { scope, targetId: scope === "all" ? null : targetId, title: title.trim(), includeNotes, includeEntries, expiresAt },
      {
        onSuccess: async (s) => {
          await copy(shareUrl(s))
          toast.success("Public link created and copied")
        },
      }
    )
  }

  const scopeLabel = (s: Share) =>
    s.scope === "all"
      ? "Whole calendar"
      : s.scope === "project"
        ? `Project: ${projects.find((p) => p.id === s.targetId)?.name ?? "removed"}`
        : `Event: ${events.find((e) => e.id === s.targetId)?.title ?? "removed"}`

  return (
    <Panel
      open={open}
      onOpenChange={onOpenChange}
      title="Share a view-only link"
      description="Anyone with the link sees the calendar and Gantt chart. They cannot edit anything."
      wide
    >
      <div className="grid gap-4 rounded-2xl border bg-card p-4">
        <Segmented
          layoutId="share-scope"
          value={scope}
          onChange={(v) => {
            setScope(v)
            setTargetId("")
          }}
          className="w-full"
          options={[
            { value: "all", label: "Everything" },
            { value: "project", label: "A project" },
            { value: "event", label: "One event" },
          ]}
        />
        {scope === "project" && (
          <FieldRow label="Project">
            <NativeSelect value={targetId} onChange={setTargetId}>
              <option value="">Choose a project...</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </FieldRow>
        )}
        {scope === "event" && (
          <FieldRow label="Event">
            <NativeSelect value={targetId} onChange={setTargetId}>
              <option value="">Choose an event...</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </NativeSelect>
          </FieldRow>
        )}
        <FieldRow label="Page title">
          <Input placeholder="e.g. Q4 site visits" value={title} onChange={(e) => setTitle(e.target.value)} />
        </FieldRow>
        <div className="grid gap-2">
          <ToggleRow label="Show notes" hint="Event notes and locations" checked={includeNotes} onChange={setIncludeNotes} />
          <ToggleRow label="Show daily data" hint="Tasks, values, links and files logged on each date" checked={includeEntries} onChange={setIncludeEntries} />
        </div>
        <FieldRow label="Link expires">
          <NativeSelect value={expiry} onChange={setExpiry}>
            <option value="never">Never</option>
            <option value="1">In 1 day</option>
            <option value="7">In 7 days</option>
            <option value="30">In 30 days</option>
            <option value="90">In 90 days</option>
          </NativeSelect>
        </FieldRow>
        <Button size="lg" className="md:h-9" onClick={makeLink} disabled={create.isPending}>
          <GlobeIcon /> Create public link
        </Button>
      </div>

      <h3 className="mt-6 mb-2 text-[13px] font-semibold">Active links</h3>
      {shares.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-center text-[13px] text-muted-foreground">No links yet.</p>
      ) : (
        <ul className="grid gap-2">
          {shares.map((s) => {
            const expired = s.expiresAt && new Date(s.expiresAt) < new Date()
            const dead = s.revoked || expired
            return (
              <li key={s.id} className={cn("rounded-xl border bg-card p-3", dead && "opacity-60")}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium md:text-[13px]">{s.title || scopeLabel(s)}</p>
                    <p className="truncate text-[12px] text-muted-foreground">
                      {scopeLabel(s)}
                      {s.expiresAt && ` · ${expired ? "expired" : "until"} ${format(new Date(s.expiresAt), "d MMM")}`}
                      {s.revoked && " · turned off"}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground tabular">
                    <EyeIcon className="size-3.5" /> {s.views}
                  </span>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <CopyButton url={shareUrl(s)} disabled={Boolean(dead)} />
                  {typeof navigator.share === "function" && !dead && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigator.share({ title: s.title || "Schedule", url: shareUrl(s) }).catch(() => {})}
                    >
                      <Share2Icon /> Share
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => update.mutate({ id: s.id, revoked: !s.revoked })}>
                    <Link2OffIcon /> {s.revoked ? "Turn on" : "Turn off"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-muted-foreground hover:text-destructive"
                    onClick={() => confirm("Delete this link? People using it will lose access.") && remove.mutate(s.id)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-muted/50 px-3 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium">{label}</span>
        <span className="block text-[12px] text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Older Safari: fall back to a temporary field.
    const el = document.createElement("textarea")
    el.value = text
    el.setAttribute("readonly", "")
    el.style.position = "fixed"
    el.style.opacity = "0"
    el.style.fontSize = "16px"
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand("copy")
    el.remove()
    return ok
  }
}

function CopyButton({ url, disabled }: { url: string; disabled?: boolean }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={async () => {
        if (await copy(url)) {
          setDone(true)
          setTimeout(() => setDone(false), 1600)
        }
      }}
    >
      {done ? <CheckIcon /> : <CopyIcon />} {done ? "Copied" : "Copy link"}
    </Button>
  )
}
