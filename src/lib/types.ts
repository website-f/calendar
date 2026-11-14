export type Role = "admin" | "editor" | "viewer"
export type Status = "planned" | "active" | "done" | "blocked"
export type EntryKind = "note" | "task" | "value" | "link" | "file"

export interface User {
  id: string
  email?: string
  name: string
  role?: Role
  color: string
  created_at?: string
}

export interface Project {
  id: string
  name: string
  color: string
  description: string
  sort: number
  archived: boolean
}

export interface Ev {
  id: string
  projectId: string | null
  title: string
  /** All-day: "YYYY-MM-DD" with an exclusive end. Timed: ISO instants. */
  start: string
  end: string
  allDay: boolean
  color: string | null
  status: Status
  progress: number
  priority: number
  location: string
  notes: string
  dependencies: string[]
  assignees: string[]
  sort: number
  createdBy: string | null
  updatedBy: string | null
  createdAt: string
  updatedAt: string
  entryCount: number
  openTasks: number
}

export interface Entry {
  id: string
  eventId: string
  day: string | null
  kind: EntryKind
  title: string
  body: string
  value: string
  url: string
  meta: Record<string, unknown>
  done: boolean
  sort: number
  createdBy?: string | null
  createdAt: string
  updatedAt: string
}

export interface Share {
  id: string
  token: string
  scope: "all" | "project" | "event"
  targetId: string | null
  title: string
  includeNotes: boolean
  includeEntries: boolean
  expiresAt: string | null
  revoked: boolean
  views: number
  createdBy: string | null
  createdAt: string
}

export interface Bootstrap {
  me: User & { role: Role; email: string }
  version: number
  users: User[]
  projects: Project[]
  events: Ev[]
  shares: Share[]
  dayMarks: { day: string; n: number }[]
}

export interface AppConfig {
  setupRequired: boolean
  setupNeedsCode?: boolean
  signupWithCode: boolean
  google: { clientId: string; apiKey: string; appId: string }
}

export interface PublicPayload {
  share: {
    title: string
    scope: string
    includeNotes: boolean
    includeEntries: boolean
    expiresAt: string | null
  }
  projects: Project[]
  users: User[]
  events: Ev[]
  entries: Entry[]
}

export interface Activity {
  id: number
  action: string
  detail: string
  userName: string
  createdAt: string
}

export const STATUS_LABEL: Record<Status, string> = {
  planned: "Planned",
  active: "In progress",
  done: "Done",
  blocked: "Blocked",
}

export const PRIORITY_LABEL = ["None", "Low", "Medium", "High"] as const

export const SWATCHES = [
  "#e4572e",
  "#d1495b",
  "#c2410c",
  "#edae49",
  "#3fa34d",
  "#00798c",
  "#2e86ab",
  "#4361ee",
  "#8e5cd9",
  "#b5179e",
  "#6b7280",
  "#1f2937",
] as const
