/* Google Workspace connector, client side only.
 * Uses Google Identity Services (token model) + Google Picker.
 * The access token lives in memory; nothing Google-related is stored on our server
 * except the file links people choose to attach. */

import type { AppConfig, Ev, Project, User, Entry } from "./types"
import { evStart, lastDay, dayKey, evEnd } from "./dates"
import { STATUS_LABEL } from "./types"

const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/calendar.events",
  "openid",
  "email",
  "profile",
].join(" ")

type Cfg = AppConfig["google"]

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

declare global {
  interface Window {
    google?: any
    gapi?: any
  }
}

let token: { value: string; exp: number } | null = null
let tokenClient: any = null
const listeners = new Set<() => void>()
const LS_KEY = "cal.google.account"

export function googleConfigured(cfg?: Cfg) {
  return Boolean(cfg?.clientId)
}

export function connectedAccount(): string | null {
  try {
    return localStorage.getItem(LS_KEY)
  } catch {
    return null
  }
}

export function hasLiveToken() {
  return Boolean(token && token.exp > Date.now() + 30_000)
}

export function onGoogleChange(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const emit = () => listeners.forEach((f) => f())

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      const check = () => resolve()
      setTimeout(check, 0)
      return
    }
    const s = document.createElement("script")
    s.src = src
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`Could not load ${src}`))
    document.head.appendChild(s)
  })
}

async function ensureGis() {
  await loadScript("https://accounts.google.com/gsi/client")
  for (let i = 0; i < 50 && !window.google?.accounts?.oauth2; i++) await new Promise((r) => setTimeout(r, 100))
  if (!window.google?.accounts?.oauth2) throw new Error("Google sign-in did not load.")
}

/** Ask for (or refresh) an access token. Must be called from a user gesture the first time. */
export async function getToken(cfg: Cfg, opts: { interactive?: boolean } = {}): Promise<string> {
  if (hasLiveToken()) return token!.value
  if (!cfg.clientId) throw new Error("Google is not configured on the server yet.")
  await ensureGis()
  return new Promise((resolve, reject) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId,
      scope: SCOPES,
      callback: async (resp: TokenResponse) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error_description || resp.error || "Google sign-in was cancelled."))
          return
        }
        token = { value: resp.access_token, exp: Date.now() + (resp.expires_in ?? 3600) * 1000 }
        try {
          const me = await gfetch<{ email?: string }>("https://www.googleapis.com/oauth2/v3/userinfo")
          if (me.email) localStorage.setItem(LS_KEY, me.email)
        } catch {
          /* userinfo is optional */
        }
        emit()
        resolve(resp.access_token)
      },
      error_callback: (err: { type?: string; message?: string }) =>
        reject(new Error(err?.message || (err?.type === "popup_closed" ? "Google window was closed." : "Google sign-in failed."))),
    })
    tokenClient.requestAccessToken({ prompt: opts.interactive || !connectedAccount() ? "consent" : "" })
  })
}

export function disconnectGoogle() {
  if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token.value, () => {})
  token = null
  try {
    localStorage.removeItem(LS_KEY)
  } catch {
    /* ignore */
  }
  emit()
}

async function gfetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  if (!token) throw new Error("Connect Google first.")
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token.value}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  })
  if (res.status === 401) {
    token = null
    emit()
    throw new Error("Your Google session expired. Connect again.")
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error?.message || `Google request failed (${res.status})`)
  return data as T
}

// ---------- Drive Picker ----------

export interface PickedFile {
  id: string
  name: string
  url: string
  mimeType: string
  iconUrl?: string
}

async function ensurePicker() {
  await loadScript("https://apis.google.com/js/api.js")
  for (let i = 0; i < 50 && !window.gapi; i++) await new Promise((r) => setTimeout(r, 100))
  await new Promise<void>((resolve) => window.gapi.load("picker", { callback: resolve }))
}

export type PickerKind = "any" | "sheets" | "docs"

export async function pickFromDrive(cfg: Cfg, kind: PickerKind = "any", multi = true): Promise<PickedFile[]> {
  const access = await getToken(cfg)
  await ensurePicker()
  const g = window.google
  return new Promise((resolve) => {
    let view: any
    if (kind === "sheets") view = new g.picker.DocsView(g.picker.ViewId.SPREADSHEETS)
    else if (kind === "docs") view = new g.picker.DocsView(g.picker.ViewId.DOCUMENTS)
    else view = new g.picker.DocsView(g.picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(true)
    view.setMode(g.picker.DocsViewMode.LIST)
    const builder = new g.picker.PickerBuilder()
      .addView(view)
      .addView(new g.picker.DocsUploadView())
      .setOAuthToken(access)
      .setOrigin(window.location.origin)
      .setSize(Math.min(1051, window.innerWidth - 16), Math.min(650, window.innerHeight - 32))
      .setCallback((data: any) => {
        if (data.action === g.picker.Action.PICKED) {
          resolve(
            (data.docs ?? []).map((d: any) => ({
              id: d.id,
              name: d.name,
              url: d.url,
              mimeType: d.mimeType,
              iconUrl: d.iconUrl,
            }))
          )
        } else if (data.action === g.picker.Action.CANCEL) resolve([])
      })
    if (cfg.apiKey) builder.setDeveloperKey(cfg.apiKey)
    if (cfg.appId) builder.setAppId(cfg.appId)
    if (multi) builder.enableFeature(g.picker.Feature.MULTISELECT_ENABLED)
    builder.build().setVisible(true)
  })
}

// ---------- Sheets ----------

export async function exportToSheet(
  cfg: Cfg,
  title: string,
  events: Ev[],
  projects: Project[],
  users: User[],
  entries: Entry[] = []
): Promise<string> {
  await getToken(cfg)
  const pName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? ""
  const uNames = (ids: string[]) =>
    ids.map((id) => users.find((u) => u.id === id)?.name).filter(Boolean).join(", ")
  const cell = (v: string | number) =>
    typeof v === "number" ? { userEnteredValue: { numberValue: v } } : { userEnteredValue: { stringValue: v } }
  const header = (cols: string[]) => ({
    values: cols.map((c) => ({
      userEnteredValue: { stringValue: c },
      userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 } },
    })),
  })

  const evRows = events.map((e) => ({
    values: [
      cell(e.title),
      cell(pName(e.projectId)),
      cell(dayKey(evStart(e))),
      cell(dayKey(lastDay(e))),
      cell(e.allDay ? "" : `${evStart(e).toTimeString().slice(0, 5)}-${evEnd(e).toTimeString().slice(0, 5)}`),
      cell(STATUS_LABEL[e.status]),
      cell(e.progress),
      cell(uNames(e.assignees)),
      cell(e.location),
      cell(e.notes),
    ],
  }))
  const evTitle = (id: string) => events.find((e) => e.id === id)?.title ?? ""
  const dataRows = entries.map((x) => ({
    values: [
      cell(x.day ?? "Whole event"),
      cell(evTitle(x.eventId)),
      cell(x.kind),
      cell(x.title),
      cell(x.value),
      cell(x.kind === "task" ? (x.done ? "Done" : "Open") : ""),
      cell(x.url),
      cell(x.body),
    ],
  }))

  const sheet = await gfetch<{ spreadsheetUrl: string }>("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    body: JSON.stringify({
      properties: { title },
      sheets: [
        {
          properties: { title: "Events", gridProperties: { frozenRowCount: 1 } },
          data: [
            {
              startRow: 0,
              startColumn: 0,
              rowData: [
                header(["Title", "Project", "Start", "End", "Time", "Status", "Progress %", "People", "Location", "Notes"]),
                ...evRows,
              ],
            },
          ],
        },
        ...(dataRows.length
          ? [
              {
                properties: { title: "Daily data", gridProperties: { frozenRowCount: 1 } },
                data: [
                  {
                    startRow: 0,
                    startColumn: 0,
                    rowData: [header(["Date", "Event", "Type", "Title", "Value", "Task", "Link", "Details"]), ...dataRows],
                  },
                ],
              },
            ]
          : []),
      ],
    }),
  })
  return sheet.spreadsheetUrl
}

/** Read the first tab of a spreadsheet as rows of cell values (formatted). */
export async function readSheet(cfg: Cfg, spreadsheetId: string): Promise<{ title: string; rows: (string | number)[][] }> {
  await getToken(cfg)
  const meta = await gfetch<{ properties: { title: string }; sheets: { properties: { title: string } }[] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties.title`
  )
  const tab = meta.sheets[0]?.properties.title ?? "Sheet1"
  const values = await gfetch<{ values?: (string | number)[][] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tab)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`
  )
  return { title: meta.properties.title, rows: values.values ?? [] }
}

// ---------- Calendar ----------

function toGoogleEvent(e: Ev, appUrl: string) {
  const base = {
    summary: e.title,
    location: e.location || undefined,
    description: [e.notes, `Open in Calendar: ${appUrl}`].filter(Boolean).join("\n\n"),
    extendedProperties: { private: { orionCalendarId: e.id } },
  }
  if (e.allDay) return { ...base, start: { date: e.start.slice(0, 10) }, end: { date: e.end.slice(0, 10) } }
  return { ...base, start: { dateTime: e.start }, end: { dateTime: e.end } }
}

/** Create or update each event in the user's primary Google Calendar. */
export async function pushToGoogleCalendar(cfg: Cfg, events: Ev[], onProgress?: (done: number) => void) {
  await getToken(cfg)
  let done = 0
  let created = 0
  let updated = 0
  for (const e of events) {
    const body = toGoogleEvent(e, window.location.origin)
    const found = await gfetch<{ items?: { id: string }[] }>(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?privateExtendedProperty=${encodeURIComponent(
        `orionCalendarId=${e.id}`
      )}&maxResults=1`
    )
    const existing = found.items?.[0]
    if (existing) {
      await gfetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${existing.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      })
      updated++
    } else {
      await gfetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events`, {
        method: "POST",
        body: JSON.stringify(body),
      })
      created++
    }
    onProgress?.(++done)
  }
  return { created, updated }
}

export interface GCalItem {
  id: string
  summary?: string
  description?: string
  location?: string
  start: { date?: string; dateTime?: string }
  end: { date?: string; dateTime?: string }
  extendedProperties?: { private?: Record<string, string> }
}

export async function listGoogleCalendar(cfg: Cfg, from: Date, to: Date): Promise<GCalItem[]> {
  await getToken(cfg)
  const q = new URLSearchParams({
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  })
  const res = await gfetch<{ items?: GCalItem[] }>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`
  )
  return (res.items ?? []).filter((i) => !i.extendedProperties?.private?.orionCalendarId)
}
