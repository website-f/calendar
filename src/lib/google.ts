/* Google Workspace connector, client side only.
 * Uses Google Identity Services (token model) + Google Picker.
 * The access token lives in memory; nothing Google-related is stored on our server
 * except the file links people choose to attach. */

import type { AppConfig, Ev, Project, User, Entry } from "./types"
import { evStart, lastDay, dayKey, evEnd } from "./dates"
import { STATUS_LABEL } from "./types"

// Only non-sensitive scopes, so the app can be public without Google's "unverified app" warning.
// drive.file = files the app creates (Sheets exports) or the person picks in the Drive Picker.
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file"
const SCOPES = [
  DRIVE_SCOPE,
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

/** Google's Drive Picker needs third-party cookies. Safari, iOS browsers and Brave block them by default. */
export function pickerSupported(): boolean {
  const ua = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  const isSafari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua)
  const isBrave = Boolean((navigator as Navigator & { brave?: unknown }).brave)
  return !(isIOS || isSafari || isBrave)
}

/** While the Picker is up, our modal panels step aside so its iframe can take focus and clicks. */
let pickerActive = false
const pickerListeners = new Set<() => void>()
export const isPickerActive = () => pickerActive
export function onPickerChange(fn: () => void) {
  pickerListeners.add(fn)
  return () => pickerListeners.delete(fn)
}
function setPickerActive(v: boolean) {
  pickerActive = v
  pickerListeners.forEach((f) => f())
}

/** Pull the file id out of any Google Docs/Sheets/Drive link (or accept a bare id). */
export function googleFileId(input: string): string | null {
  const s = input.trim()
  const m = s.match(/\/d\/([a-zA-Z0-9_-]{20,})/) ?? s.match(/[?&]id=([a-zA-Z0-9_-]{20,})/) ?? s.match(/\/folders\/([a-zA-Z0-9_-]{20,})/)
  if (m) return m[1]!
  return /^[a-zA-Z0-9_-]{25,}$/.test(s) ? s : null
}

/** Best-effort file type from a Google link, for icons and default titles. */
export function googleLinkKind(url: string): { label: string; mimeType: string } | null {
  if (/docs\.google\.com\/spreadsheets/.test(url)) return { label: "Google Sheet", mimeType: "application/vnd.google-apps.spreadsheet" }
  if (/docs\.google\.com\/document/.test(url)) return { label: "Google Doc", mimeType: "application/vnd.google-apps.document" }
  if (/docs\.google\.com\/presentation/.test(url)) return { label: "Google Slides", mimeType: "application/vnd.google-apps.presentation" }
  if (/docs\.google\.com\/forms/.test(url)) return { label: "Google Form", mimeType: "application/vnd.google-apps.form" }
  if (/drive\.google\.com\/drive\/(u\/\d+\/)?folders/.test(url)) return { label: "Drive folder", mimeType: "application/vnd.google-apps.folder" }
  if (/drive\.google\.com/.test(url)) return { label: "Drive file", mimeType: "application/octet-stream" }
  return null
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
      // Never fold in permissions granted to older versions of the app; that would bring back
      // Google's "unverified app" screen for anyone who connected before.
      include_granted_scopes: false,
      callback: async (resp: TokenResponse) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error_description || resp.error || "Google sign-in was cancelled."))
          return
        }
        // Google shows each permission as a checkbox; Drive is unticked until the person ticks it.
        if (!window.google.accounts.oauth2.hasGrantedAllScopes(resp, DRIVE_SCOPE)) {
          reject(new Error("Google Drive was not ticked. Connect again and tick the Google Drive box so the app can save and open files."))
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
  setPickerActive(true)
  return new Promise<PickedFile[]>((resolve) => {
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
        if (data.action === g.picker.Action.PICKED || data.action === g.picker.Action.CANCEL) setPickerActive(false)
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

// ---------- Calendar (no Google permission needed) ----------

const gDate = (iso: string, allDay: boolean) =>
  allDay ? iso.slice(0, 10).replace(/-/g, "") : new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")

/** Google Calendar "create event" link with everything prefilled. Works in any browser, no sign-in to our app. */
export function googleCalendarEventUrl(e: Ev, details?: string): string {
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${gDate(e.start, e.allDay)}/${gDate(e.end, e.allDay)}`,
    details: [e.notes, details].filter(Boolean).join("\n\n").slice(0, 1500),
    location: e.location,
  })
  return `https://calendar.google.com/calendar/render?${q}`
}

/** One-click "subscribe" link: Google Calendar keeps the feed in sync by itself. */
export function googleCalendarSubscribeUrl(icsUrl: string): string {
  return `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(icsUrl.replace(/^https:/, "webcal:"))}`
}
