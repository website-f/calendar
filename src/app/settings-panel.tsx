import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { MonitorIcon, MoonIcon, SunIcon, Trash2Icon, UserPlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { api } from "@/lib/api"
import { setThemePref, useThemePref } from "@/lib/theme"
import type { Bootstrap, Role } from "@/lib/types"
import { Avatar, FieldRow, NativeSelect, Panel, Segmented, Swatches } from "./bits"

type Tab = "profile" | "team" | "holidays" | "look"

export function SettingsPanel({
  open,
  onOpenChange,
  boot,
  initialTab = "profile",
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  boot: Bootstrap
  initialTab?: Tab
}) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const isAdmin = boot.me.role === "admin"
  return (
    <Panel open={open} onOpenChange={onOpenChange} title="Settings" wide>
      <Segmented
        layoutId="settings-tab"
        value={tab}
        onChange={setTab}
        className="mb-5 w-full"
        options={[
          { value: "profile", label: "Profile" },
          ...(isAdmin ? [{ value: "team" as Tab, label: "Team" }, { value: "holidays" as Tab, label: "Holidays" }] : []),
          { value: "look", label: "Appearance" },
        ]}
      />
      {tab === "profile" && <Profile boot={boot} />}
      {tab === "team" && isAdmin && <Team boot={boot} />}
      {tab === "holidays" && isAdmin && <Holidays boot={boot} />}
      {tab === "look" && <Look />}
    </Panel>
  )
}

function Profile({ boot }: { boot: Bootstrap }) {
  const qc = useQueryClient()
  const [name, setName] = useState(boot.me.name)
  const [color, setColor] = useState(boot.me.color)
  const [cur, setCur] = useState("")
  const [next, setNext] = useState("")
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await api("/api/me", { method: "PATCH", body: { name, color, ...(next ? { currentPassword: cur, newPassword: next } : {}) } })
      toast.success(next ? "Profile and password updated" : "Profile updated")
      setCur("")
      setNext("")
      qc.invalidateQueries()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-3">
        <Avatar user={{ name, color }} size={48} />
        <div>
          <p className="text-[15px] font-semibold">{name}</p>
          <p className="text-[13px] text-muted-foreground">
            {boot.me.email} · {roleLabel(boot.me.role)}
          </p>
        </div>
      </div>
      <FieldRow label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </FieldRow>
      <div className="grid gap-2">
        <span className="text-[12px] font-medium text-muted-foreground">Your colour</span>
        <Swatches value={color} onChange={setColor} />
      </div>
      <div className="grid gap-3 rounded-2xl border bg-card p-4">
        <p className="text-[13px] font-medium">Change password</p>
        <FieldRow label="Current password">
          <Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
        </FieldRow>
        <FieldRow label="New password" hint="At least 8 characters.">
          <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </FieldRow>
      </div>
      <Button size="lg" className="md:h-9" onClick={save} disabled={busy || !name.trim()}>
        Save profile
      </Button>
    </div>
  )
}

const roleLabel = (r?: Role) => (r === "admin" ? "Admin" : r === "viewer" ? "Viewer" : "Editor")

function Team({ boot }: { boot: Bootstrap }) {
  const qc = useQueryClient()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<Role>("editor")
  const [busy, setBusy] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: ["bootstrap"] })

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api("/api/users", { body: { name, email, password, role } })
      toast.success(`${name} can now sign in`, { description: `Share their email and temporary password with them.` })
      setName("")
      setEmail("")
      setPassword("")
      refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const change = async (id: string, body: Record<string, unknown>, msg: string) => {
    try {
      await api(`/api/users/${id}`, { method: "PATCH", body })
      toast.success(msg)
      refresh()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="grid gap-5">
      <ul className="grid gap-2">
        {boot.users.map((u) => (
          <li key={u.id} className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5">
            <Avatar user={u} size={32} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium md:text-[13px]">
                {u.name} {u.id === boot.me.id && <span className="text-muted-foreground">(you)</span>}
              </p>
              <p className="truncate text-[12px] text-muted-foreground">{u.email}</p>
            </div>
            <NativeSelect
              value={u.role ?? "editor"}
              onChange={(v) => change(u.id, { role: v }, `${u.name} is now ${roleLabel(v as Role).toLowerCase()}`)}
              className="w-28"
              disabled={u.id === boot.me.id}
            >
              <option value="admin">Admin</option>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </NativeSelect>
            {u.id !== boot.me.id && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${u.name}`}
                className="text-muted-foreground hover:text-destructive"
                onClick={async () => {
                  if (!confirm(`Remove ${u.name}? Their events stay.`)) return
                  try {
                    await api(`/api/users/${u.id}`, { method: "DELETE" })
                    refresh()
                  } catch (err) {
                    toast.error((err as Error).message)
                  }
                }}
              >
                <Trash2Icon />
              </Button>
            )}
          </li>
        ))}
      </ul>

      <form onSubmit={add} className="grid gap-3 rounded-2xl border bg-card p-4">
        <p className="flex items-center gap-2 text-[13px] font-medium">
          <UserPlusIcon className="size-4" /> Add a teammate
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldRow label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="off" />
          </FieldRow>
          <FieldRow label="Email">
            <Input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
          </FieldRow>
          <FieldRow label="Temporary password" hint="They can change it in Settings.">
            <Input value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoComplete="new-password" />
          </FieldRow>
          <FieldRow label="Role">
            <NativeSelect value={role} onChange={(v) => setRole(v as Role)}>
              <option value="editor">Editor: can add and change events</option>
              <option value="viewer">Viewer: read only</option>
              <option value="admin">Admin: also manages the team</option>
            </NativeSelect>
          </FieldRow>
        </div>
        <Button type="submit" disabled={busy} className="justify-self-start">
          Add teammate
        </Button>
      </form>
    </div>
  )
}

function Holidays({ boot }: { boot: Bootstrap }) {
  const qc = useQueryClient()
  const hs = boot.holidaySettings
  const [busy, setBusy] = useState(false)
  const save = async (patch: { enabled?: boolean; region?: string }) => {
    setBusy(true)
    try {
      await api("/api/settings/holidays", { method: "PATCH", body: patch })
      await qc.invalidateQueries({ queryKey: ["bootstrap"] })
      toast.success("Holiday settings saved")
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid gap-5">
      <p className="text-[13px] text-muted-foreground">
        Malaysian public holidays come from Google's public holiday calendar: free, updated daily, and shown to everyone on the calendar, the Gantt
        chart and share links.
      </p>
      <label className="flex items-center justify-between rounded-xl bg-muted/60 px-3 py-2.5">
        <span className="text-[13px] font-medium">Show public holidays</span>
        <Switch checked={hs.enabled} disabled={busy} onCheckedChange={(v) => save({ enabled: v })} />
      </label>
      <FieldRow label="Which holidays" hint="National holidays always show. State holidays follow this choice.">
        <NativeSelect value={hs.region} onChange={(v) => save({ region: v })} disabled={busy || !hs.enabled}>
          <option value="ALL">All states (national and every state holiday)</option>
          <option value="">National holidays only</option>
          {hs.states.map((st) => (
            <option key={st} value={st}>
              National + {st}
            </option>
          ))}
        </NativeSelect>
      </FieldRow>
      <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2.5 text-[13px]">
        <span className="text-muted-foreground">
          {hs.count} holidays loaded{hs.fetchedAt ? `, updated ${new Date(hs.fetchedAt).toLocaleString()}` : ""}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await api("/api/settings/holidays/refresh", { body: {} })
              await qc.invalidateQueries({ queryKey: ["bootstrap"] })
              toast.success("Holidays refreshed")
            } catch (err) {
              toast.error((err as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          Refresh now
        </Button>
      </div>
    </div>
  )
}

function Look() {
  const pref = useThemePref()
  return (
    <div className="grid gap-3">
      <span className="text-[12px] font-medium text-muted-foreground">Theme</span>
      <Segmented
        layoutId="theme"
        value={pref}
        onChange={setThemePref}
        className="w-full"
        options={[
          { value: "light", label: "Light", icon: <SunIcon className="size-3.5" /> },
          { value: "dark", label: "Dark", icon: <MoonIcon className="size-3.5" /> },
          { value: "system", label: "System", icon: <MonitorIcon className="size-3.5" /> },
        ]}
      />
    </div>
  )
}
