import * as React from "react"
import { motion, useReducedMotion } from "motion/react"
import { CheckIcon, ChevronDownIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useIsDesktop } from "@/lib/use-media"
import { SWATCHES, type Status, type User, STATUS_LABEL } from "@/lib/types"
import { isPickerActive, onPickerChange } from "@/lib/google"

/** Bottom sheet on phones, side panel on desktop. Built on Dialog so inputs behave in iOS Safari. */
export function Panel({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide,
  footer,
  hideTitle,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  wide?: boolean
  footer?: React.ReactNode
  hideTitle?: boolean
}) {
  const desktop = useIsDesktop()
  // On touch screens, focus the panel itself rather than the first field so the keyboard stays down.
  const focusRef = React.useRef<HTMLDivElement>(null)
  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches
  const picking = React.useSyncExternalStore(onPickerChange, isPickerActive, () => false)
  return (
    <Sheet
      open={open}
      modal={!picking}
      // Clicks inside Google's Picker land outside this panel; don't treat them as "close".
      onOpenChange={(v) => {
        if (!v && isPickerActive()) return
        onOpenChange(v)
      }}
    >
      <SheetContent
        initialFocus={coarse ? focusRef : true}
        side={desktop ? "right" : "bottom"}
        className={cn(
          "gap-0 border-0 bg-background p-0 shadow-float",
          desktop
            ? cn("m-2 h-[calc(100dvh-1rem)] rounded-2xl border", wide ? "sm:max-w-xl w-[36rem]" : "sm:max-w-md w-[28rem]")
            : "max-h-[92dvh] rounded-t-3xl border-t"
        )}
      >
        <div ref={focusRef} tabIndex={-1} className="sr-only" />
        {!desktop && (
          <div className="flex justify-center pt-2.5 pb-1" aria-hidden>
            <span className="h-1 w-10 rounded-full bg-border" />
          </div>
        )}
        <div className={cn("flex items-start gap-3 px-5 pt-3 pb-3 pr-14", hideTitle && "sr-only")}>
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-[15px] font-semibold tracking-tight">{title}</SheetTitle>
            {description ? (
              <SheetDescription className="mt-0.5 text-[13px] text-muted-foreground">{description}</SheetDescription>
            ) : (
              <SheetDescription className="sr-only">{typeof title === "string" ? title : "Panel"}</SheetDescription>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6">{children}</div>
        {footer && <div className="border-t bg-background/80 px-5 py-3 pb-safe backdrop-blur">{footer}</div>}
        {!footer && <div className="pb-safe" />}
      </SheetContent>
    </Sheet>
  )
}

/** Animated segmented control (pill slides between options). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
  layoutId,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: React.ReactNode; icon?: React.ReactNode }[]
  className?: string
  size?: "sm" | "md"
  layoutId: string
}) {
  const reduce = useReducedMotion()
  return (
    <div
      role="tablist"
      className={cn(
        "relative inline-flex items-center gap-0.5 rounded-xl bg-muted p-0.5 ring-1 ring-border/60 ring-inset",
        className
      )}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative z-0 inline-flex flex-1 items-center justify-center gap-1.5 rounded-[10px] font-medium whitespace-nowrap transition-colors",
              size === "sm" ? "h-8 px-2.5 text-xs md:h-7" : "h-9 px-3 text-[13px] md:h-8",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 -z-10 rounded-[10px] bg-background shadow-soft ring-1 ring-border/70"
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 38 }}
              />
            )}
            {o.icon}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

interface SelectOption {
  value: string
  label: React.ReactNode
  text: string
  disabled?: boolean
}

/** Read <option> children (as written for a native select) into a list of options. */
function readOptions(children: React.ReactNode): SelectOption[] {
  const out: SelectOption[] = []
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement<React.OptionHTMLAttributes<HTMLOptionElement>>(child)) return
    if (child.type === React.Fragment) {
      out.push(...readOptions((child.props as { children?: React.ReactNode }).children))
      return
    }
    const p = child.props
    const label = p.children
    const text = React.Children.toArray(label).map((x) => (typeof x === "string" || typeof x === "number" ? String(x) : "")).join("")
    out.push({ value: String(p.value ?? text), label, text, disabled: p.disabled })
  })
  return out
}

/**
 * Themed dropdown (Base UI Select) with a native-select-like API: pass <option> children,
 * get the chosen value back as a string. Replaces the browser's default dropdown everywhere.
 */
export function NativeSelect({
  value,
  onChange,
  children,
  className,
  disabled,
  placeholder,
  "aria-label": ariaLabel,
}: {
  value: string | number | readonly string[] | undefined
  onChange: (v: string) => void
  children: React.ReactNode
  className?: string
  disabled?: boolean
  placeholder?: string
  "aria-label"?: string
}) {
  const options = React.useMemo(() => readOptions(children), [children])
  const current = String(value ?? "")
  const selected = options.find((o) => o.value === current)
  return (
    <Select
      value={current}
      onValueChange={(v) => v !== null && onChange(String(v))}
      items={options.map((o) => ({ value: o.value, label: o.label }))}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          "h-10 w-full min-w-0 bg-background pl-3 text-left text-[15px] md:h-8 md:text-sm dark:bg-input/30",
          !selected && "text-muted-foreground",
          className
        )}
      >
        <SelectValue className="min-w-0 truncate">{() => (selected ? selected.label : (placeholder ?? "Choose..."))}</SelectValue>
      </SelectTrigger>
      <SelectContent
        alignItemWithTrigger={false}
        className="max-h-[min(var(--available-height),20rem)] min-w-(--anchor-width) rounded-xl p-1 shadow-float"
      >
        {options.map((o) => (
          <SelectItem
            key={o.value}
            value={o.value}
            disabled={o.disabled}
            className="min-h-10 rounded-lg py-2 pr-8 pl-2.5 text-[15px] md:min-h-8 md:py-1.5 md:text-sm [&>span:first-child]:whitespace-normal"
          >
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function FieldRow({
  label,
  children,
  hint,
  className,
}: {
  label: string
  children: React.ReactNode
  hint?: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn("grid gap-1.5", className)}>
      <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-[12px] text-muted-foreground">{hint}</span>}
    </label>
  )
}

export function Swatches({ value, onChange }: { value: string | null; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Colour ${c}`}
          onClick={() => onChange(c)}
          className="grid size-8 place-items-center rounded-full ring-offset-2 ring-offset-background transition-transform active:scale-95 md:size-7"
          style={{ background: c, boxShadow: value === c ? `0 0 0 2px var(--background), 0 0 0 4px ${c}` : undefined }}
        >
          {value === c && <CheckIcon className="size-3.5 text-white" />}
        </button>
      ))}
    </div>
  )
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("")
}

export function Avatar({ user, size = 24, className }: { user: Pick<User, "name" | "color">; size?: number; className?: string }) {
  return (
    <span
      title={user.name}
      className={cn("inline-grid shrink-0 place-items-center rounded-full font-semibold text-white ring-2 ring-background", className)}
      style={{ width: size, height: size, background: user.color, fontSize: Math.max(9, size * 0.4) }}
    >
      {initials(user.name)}
    </span>
  )
}

export function AvatarStack({ users, max = 3, size = 22 }: { users: Pick<User, "name" | "color" | "id">[]; max?: number; size?: number }) {
  if (!users.length) return null
  return (
    <span className="inline-flex items-center -space-x-1.5">
      {users.slice(0, max).map((u) => (
        <Avatar key={u.id} user={u} size={size} />
      ))}
      {users.length > max && (
        <span
          className="inline-grid place-items-center rounded-full bg-muted font-medium text-muted-foreground ring-2 ring-background"
          style={{ width: size, height: size, fontSize: size * 0.4 }}
        >
          +{users.length - max}
        </span>
      )}
    </span>
  )
}

const STATUS_STYLE: Record<Status, string> = {
  planned: "bg-muted text-muted-foreground",
  active: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  done: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  blocked: "bg-rose-500/12 text-rose-700 dark:text-rose-300",
}

export function StatusPill({ status, className }: { status: Status; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium", STATUS_STYLE[status], className)}>
      {STATUS_LABEL[status]}
    </span>
  )
}

export function ProgressLine({ value, color }: { value: number; color?: string }) {
  return (
    <span className="relative block h-1 w-full overflow-hidden rounded-full bg-foreground/8">
      <span
        className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color ?? "var(--primary)" }}
      />
    </span>
  )
}

export function Logo({ className }: { className?: string }) {
  // Simple geometric mark: a calendar tile with a bar running through it.
  return (
    <span className={cn("relative inline-grid size-8 place-items-center rounded-[10px] bg-ink text-ink-foreground", className)}>
      <span className="absolute inset-x-1.5 top-1.5 h-[3px] rounded-full bg-primary" />
      <span className="mt-1.5 text-[11px] font-semibold tabular">{new Date().getDate()}</span>
    </span>
  )
}

export function EmptyNote({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed px-6 py-8 text-center">
      <span className="grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">{icon}</span>
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="max-w-[34ch] text-[13px] text-muted-foreground">{children}</div>}
    </div>
  )
}
