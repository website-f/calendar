import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { motion, useReducedMotion } from "motion/react"
import { ArrowRightIcon, Loader2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"
import type { AppConfig } from "@/lib/types"
import { FieldRow, Logo, Segmented } from "./bits"

export function AuthScreen({ config }: { config: AppConfig }) {
  const qc = useQueryClient()
  const setup = config.setupRequired
  const [mode, setMode] = useState<"login" | "join">(setup ? "join" : "login")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const reduce = useReducedMotion()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setBusy(true)
    try {
      if (mode === "login") await api("/api/auth/login", { body: { email, password } })
      else await api("/api/auth/register", { body: { name, email, password, code: code || undefined } })
      await qc.invalidateQueries()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const showJoin = setup || config.signupWithCode

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Visual side: a living preview of what the product does, built from real layout, not a screenshot */}
      <div className="relative hidden overflow-hidden bg-ink text-ink-foreground lg:block">
        <WeekRibbon />
        <div className="absolute inset-x-12 bottom-12">
          <p className="max-w-md text-4xl leading-[1.08] font-semibold tracking-tight">
            Every date, every event, and the data that goes with it.
          </p>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed opacity-70">
            Plan on the calendar, track it on the Gantt chart, and keep each day's notes, tasks and files in one place.
          </p>
        </div>
      </div>

      <div className="flex min-h-dvh flex-col bg-background px-5 pt-safe pb-safe">
        <div className="flex h-16 items-center gap-2.5">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight">Orion Calendar</span>
        </div>
        <div className="flex flex-1 items-center justify-center py-8">
          <motion.form
            onSubmit={submit}
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="grid w-full max-w-sm gap-5"
          >
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {setup ? "Set up your workspace" : mode === "login" ? "Welcome back" : "Join your team"}
              </h1>
              <p className="mt-1.5 text-[14px] text-muted-foreground">
                {setup
                  ? "You are the first person here, so you become the admin."
                  : mode === "login"
                    ? "Sign in to see the office schedule."
                    : "Use the workspace code your admin gave you."}
              </p>
            </div>

            {showJoin && !setup && (
              <Segmented
                layoutId="auth-mode"
                value={mode}
                onChange={(v) => {
                  setMode(v)
                  setError("")
                }}
                className="w-full"
                options={[
                  { value: "login", label: "Sign in" },
                  { value: "join", label: "Create account" },
                ]}
              />
            )}

            {mode === "join" && (
              <FieldRow label="Your name">
                <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
              </FieldRow>
            )}
            <FieldRow label="Work email">
              <Input type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            </FieldRow>
            <FieldRow label="Password" hint={mode === "join" ? "At least 8 characters." : undefined}>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength={mode === "join" ? 8 : undefined}
                required
              />
            </FieldRow>
            {mode === "join" && (!setup || config.setupNeedsCode) && (
              <FieldRow label={setup ? "Setup code" : "Workspace code"} hint={setup ? "From the server's .env file (SETUP_CODE)." : undefined}>
                <Input value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="none" autoCorrect="off" required />
              </FieldRow>
            )}

            {error && (
              <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" size="lg" className="h-11 rounded-xl text-[15px]" disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : <ArrowRightIcon />}
              {setup ? "Create workspace" : mode === "login" ? "Sign in" : "Create account"}
            </Button>
            {!showJoin && (
              <p className="text-center text-[13px] text-muted-foreground">No account yet? Ask your admin to add you.</p>
            )}
          </motion.form>
        </div>
      </div>
    </div>
  )
}

/** Decorative week strip with sliding bars: shows the product idea using real CSS layout. */
function WeekRibbon() {
  const reduce = useReducedMotion()
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  const bars = [
    { row: 0, from: 0, span: 3, c: "var(--primary)", label: "Site survey" },
    { row: 1, from: 1, span: 4, c: "#2e86ab", label: "Tender documents" },
    { row: 2, from: 3, span: 2, c: "#3fa34d", label: "Client visit" },
    { row: 3, from: 0, span: 6, c: "#8e5cd9", label: "Quarter close" },
    { row: 4, from: 4, span: 3, c: "#edae49", label: "Training" },
  ]
  return (
    <div className="absolute inset-x-12 top-14">
      <div className="grid grid-cols-7 gap-2 text-[12px] opacity-50">
        {days.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="relative mt-4 grid grid-cols-7 gap-2">
        {bars.map((b, i) => (
          <motion.div
            key={b.label}
            initial={reduce ? false : { opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 + i * 0.08, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="flex h-10 items-center rounded-xl px-3 text-[13px] font-medium text-white"
            style={{ gridColumn: `${b.from + 1} / span ${b.span}`, gridRow: b.row + 1, background: b.c }}
          >
            <span className="truncate">{b.label}</span>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
