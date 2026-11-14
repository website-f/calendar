import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { MonitorIcon, MoonIcon, SunIcon, Trash2Icon, UserPlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"
import { setThemePref, useThemePref } from "@/lib/theme"
import type { Bootstrap, Role } from "@/lib/types"
import { Avatar, FieldRow, NativeSelect, Panel, Segmented, Swatches } from "./bits"

type Tab = "profile" | "team" | "look"

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
          ...(isAdmin ? [{ value: "team" as Tab, label: "Team" }] : []),
          { value: "look", label: "Appearance" },
        ]}
      />
      {tab === "profile" && <Profile boot={boot} />}
      {tab === "team" && isAdmin && <Team boot={boot} />}
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
