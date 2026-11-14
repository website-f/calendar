import { useSyncExternalStore } from "react"
import { flushSync } from "react-dom"

export function useMedia(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query)
      m.addEventListener("change", cb)
      return () => m.removeEventListener("change", cb)
    },
    () => window.matchMedia(query).matches,
    () => fallback
  )
}

export const useIsDesktop = () => useMedia("(min-width: 1024px)")
export const useIsMobile = () => !useMedia("(min-width: 768px)", true)

/** Run a DOM update inside a View Transition when the browser supports it. */
export function withViewTransition(update: () => void) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (!doc.startViewTransition || reduce) {
    update()
    return
  }
  doc.startViewTransition(() => flushSync(update))
}
