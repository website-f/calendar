import { useEffect, useRef } from "react"
import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "./api"
import type { Activity, AppConfig, Bootstrap, Entry, Ev, Project, Share, User } from "./types"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: true },
  },
})

const BOOT = ["bootstrap"] as const

export const useConfig = () =>
  useQuery({ queryKey: ["config"], queryFn: () => api<AppConfig>("/api/config"), staleTime: 60_000 })

export const useMe = () =>
  useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ user: (User & { role: Bootstrap["me"]["role"]; email: string }) | null }>("/api/auth/me"),
  })

export const useBootstrap = (enabled = true) =>
  useQuery({ queryKey: BOOT, queryFn: () => api<Bootstrap>("/api/bootstrap"), enabled })

/** Poll a tiny version number; refetch everything only when someone changed data. */
export function useLiveSync(version: number | undefined) {
  const qc = useQueryClient()
  const last = useRef(version)
  last.current = version
  useEffect(() => {
    let stop = false
    const tick = async () => {
      if (document.hidden) return
      try {
        const { version: v } = await api<{ version: number }>("/api/version")
        if (!stop && last.current !== undefined && v !== last.current) {
          qc.invalidateQueries({ queryKey: BOOT })
          qc.invalidateQueries({ queryKey: ["entries"] })
          qc.invalidateQueries({ queryKey: ["activity"] })
        }
      } catch {
        /* offline: try again next tick */
      }
    }
    const id = window.setInterval(tick, 12_000)
    const onVis = () => !document.hidden && tick()
    document.addEventListener("visibilitychange", onVis)
    return () => {
      stop = true
      window.clearInterval(id)
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [qc])
}

function patchBoot(qc: QueryClient, fn: (b: Bootstrap) => Bootstrap) {
  const prev = qc.getQueryData<Bootstrap>(BOOT)
  if (prev) qc.setQueryData<Bootstrap>(BOOT, fn(prev))
  return prev
}

const fail = (err: unknown) => toast.error((err as Error).message || "Could not save.")

// ---------- events ----------

export function useEventMutations() {
  const qc = useQueryClient()

  const create = useMutation({
    mutationFn: (input: Partial<Ev> & { title: string; start: string; end: string }) =>
      api<Ev>("/api/events", { body: input }),
    onSuccess: (ev) => {
      patchBoot(qc, (b) => ({ ...b, events: [...b.events, ev] }))
      qc.invalidateQueries({ queryKey: BOOT })
    },
    onError: fail,
  })

  const update = useMutation({
    mutationFn: ({ id, ...patch }: Partial<Ev> & { id: string }) =>
      api<Ev>(`/api/events/${id}`, { method: "PATCH", body: patch }),
    onMutate: async ({ id, ...patch }) => {
      await qc.cancelQueries({ queryKey: BOOT })
      const prev = patchBoot(qc, (b) => ({
        ...b,
        events: b.events.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      }))
      return { prev }
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(BOOT, ctx.prev)
      fail(err)
    },
    onSuccess: (ev) => {
      patchBoot(qc, (b) => ({ ...b, events: b.events.map((e) => (e.id === ev.id ? ev : e)) }))
      qc.invalidateQueries({ queryKey: ["activity", ev.id] })
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/events/${id}`, { method: "DELETE" }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: BOOT })
      const prev = patchBoot(qc, (b) => ({ ...b, events: b.events.filter((e) => e.id !== id) }))
      return { prev }
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(BOOT, ctx.prev)
      fail(err)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: BOOT }),
  })

  const duplicate = useMutation({
    mutationFn: (id: string) => api<Ev>(`/api/events/${id}/duplicate`, { body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: BOOT }),
    onError: fail,
  })

  const importMany = useMutation({
    mutationFn: (events: (Partial<Ev> & { title: string; start: string; end: string })[]) =>
      api<{ created: number }>("/api/events/import", { body: { events } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: BOOT }),
    onError: fail,
  })

  return { create, update, remove, duplicate, importMany }
}

// ---------- projects ----------

export function useProjectMutations() {
  const qc = useQueryClient()
  const create = useMutation({
    mutationFn: (input: Partial<Project> & { name: string }) => api<Project>("/api/projects", { body: input }),
    onSuccess: (p) => {
      patchBoot(qc, (b) => ({ ...b, projects: [...b.projects, p] }))
    },
    onError: fail,
  })
  const update = useMutation({
    mutationFn: ({ id, ...patch }: Partial<Project> & { id: string }) =>
      api<Project>(`/api/projects/${id}`, { method: "PATCH", body: patch }),
    onMutate: async ({ id, ...patch }) => {
      const prev = patchBoot(qc, (b) => ({
        ...b,
        projects: b.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      }))
      return { prev }
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(BOOT, ctx.prev)
      fail(err)
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: BOOT }),
    onError: fail,
  })
  return { create, update, remove }
}

// ---------- entries (per-date data) ----------

export const useEventEntries = (eventId: string | null, initial?: Entry[]) =>
  useQuery({
    queryKey: ["entries", "event", eventId],
    queryFn: () => api<Entry[]>(`/api/entries?eventId=${eventId}`),
    enabled: Boolean(eventId) && !initial,
    initialData: initial,
  })

export const useDayEntries = (day: string | null) =>
  useQuery({
    queryKey: ["entries", "day", day],
    queryFn: () => api<Entry[]>(`/api/entries?day=${day}`),
    enabled: Boolean(day),
  })

export const useActivity = (eventId: string | null) =>
  useQuery({
    queryKey: ["activity", eventId],
    queryFn: () => api<Activity[]>(`/api/events/${eventId}/activity`),
    enabled: Boolean(eventId),
  })

export function useEntryMutations() {
  const qc = useQueryClient()
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["entries"] })
    qc.invalidateQueries({ queryKey: BOOT })
    qc.invalidateQueries({ queryKey: ["activity"] })
  }
  const create = useMutation({
    mutationFn: (input: Partial<Entry> & { eventId: string }) => api<Entry>("/api/entries", { body: input }),
    onSuccess: refresh,
    onError: fail,
  })
  const update = useMutation({
    mutationFn: ({ id, ...patch }: Partial<Entry> & { id: string }) =>
      api<Entry>(`/api/entries/${id}`, { method: "PATCH", body: patch }),
    onMutate: async ({ id, ...patch }) => {
      // Optimistic toggle/edit across any cached entry list.
      const lists = qc.getQueriesData<Entry[]>({ queryKey: ["entries"] })
      lists.forEach(([key, list]) => {
        if (list) qc.setQueryData(key, list.map((x) => (x.id === id ? { ...x, ...patch } : x)))
      })
      return { lists }
    },
    onError: (err, _v, ctx) => {
      ctx?.lists.forEach(([key, list]) => qc.setQueryData(key, list))
      fail(err)
    },
    onSettled: refresh,
  })
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/entries/${id}`, { method: "DELETE" }),
    onMutate: async (id) => {
      const lists = qc.getQueriesData<Entry[]>({ queryKey: ["entries"] })
      lists.forEach(([key, list]) => {
        if (list) qc.setQueryData(key, list.filter((x) => x.id !== id))
      })
      return { lists }
    },
    onError: (err, _v, ctx) => {
      ctx?.lists.forEach(([key, list]) => qc.setQueryData(key, list))
      fail(err)
    },
    onSettled: refresh,
  })
  return { create, update, remove }
}

// ---------- shares ----------

export function useShareMutations() {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: BOOT })
  const create = useMutation({
    mutationFn: (input: Partial<Share> & { scope: Share["scope"] }) => api<Share>("/api/shares", { body: input }),
    onSuccess: done,
    onError: fail,
  })
  const update = useMutation({
    mutationFn: ({ id, ...patch }: Partial<Share> & { id: string }) =>
      api<Share>(`/api/shares/${id}`, { method: "PATCH", body: patch }),
    onSuccess: done,
    onError: fail,
  })
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/shares/${id}`, { method: "DELETE" }),
    onSuccess: done,
    onError: fail,
  })
  return { create, update, remove }
}
