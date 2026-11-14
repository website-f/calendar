import { useEffect, useSyncExternalStore } from "react"

export type ThemePref = "light" | "dark" | "system"
const KEY = "cal.theme"
const listeners = new Set<() => void>()

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === "light" || v === "dark" ? v : "system"
  } catch {
    return "system"
  }
}

const mq = () => window.matchMedia("(prefers-color-scheme: dark)")

function resolve(pref: ThemePref): "light" | "dark" {
  return pref === "system" ? (mq().matches ? "dark" : "light") : pref
}

export function applyTheme() {
  const dark = resolve(readPref()) === "dark"
  document.documentElement.classList.toggle("dark", dark)
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute("content", dark ? "#16171b" : "#f4f5f7")
}

export function setThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref)
  } catch {
    /* private mode: theme just won't persist */
  }
  applyTheme()
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  const m = mq()
  const onChange = () => {
    applyTheme()
    cb()
  }
  m.addEventListener("change", onChange)
  return () => {
    listeners.delete(cb)
    m.removeEventListener("change", onChange)
  }
}

export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribe, readPref, () => "system")
}

export function useResolvedTheme(): "light" | "dark" {
  const pref = useThemePref()
  useEffect(() => applyTheme(), [pref])
  return useSyncExternalStore(
    subscribe,
    () => resolve(readPref()),
    () => "light"
  )
}
