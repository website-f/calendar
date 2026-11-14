import { readFileSync, existsSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono, type Context } from "hono"
import { z } from "zod"
import { db, bumpVersion, getVersion, tx } from "./db.ts"
import {
  canEdit,
  clearLimit,
  createSession,
  currentUser,
  destroySession,
  hashPassword,
  limited,
  newId,
  requireUser,
  verifyPassword,
  type Env,
  type User,
} from "./auth.ts"

const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.HOST ?? "127.0.0.1"
const SIGNUP_CODE = process.env.SIGNUP_CODE ?? ""
// Required to create the very first (admin) account on a public server.
const SETUP_CODE = process.env.SETUP_CODE ?? ""
const DIST = process.env.DIST_DIR ?? "./dist"

type Row = Record<string, unknown>
const all = (sql: string, ...p: (string | number | null)[]) =>
  db.prepare(sql).all(...p) as Row[]
const one = (sql: string, ...p: (string | number | null)[]) =>
  db.prepare(sql).get(...p) as Row | undefined
const run = (sql: string, ...p: (string | number | null)[]) => db.prepare(sql).run(...p)

const now = () => new Date().toISOString()
const json = (v: unknown, fallback: unknown) => {
  try {
    return JSON.parse(String(v))
  } catch {
    return fallback
  }
}

// ---------- shapes ----------

function mapEvent(r: Row) {
  return {
    id: r.id as string,
    projectId: (r.project_id as string) ?? null,
    title: r.title as string,
    start: r.start as string,
    end: r.end as string,
    allDay: Boolean(r.all_day),
    color: (r.color as string) ?? null,
    status: r.status as string,
    progress: Number(r.progress),
    priority: Number(r.priority),
    location: r.location as string,
    notes: r.notes as string,
    dependencies: json(r.dependencies, []) as string[],
    assignees: json(r.assignees, []) as string[],
    sort: Number(r.sort),
    createdBy: (r.created_by as string) ?? null,
    updatedBy: (r.updated_by as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    entryCount: Number(r.entry_count ?? 0),
    openTasks: Number(r.open_tasks ?? 0),
  }
}

function mapEntry(r: Row) {
  return {
    id: r.id as string,
    eventId: r.event_id as string,
    day: (r.day as string) ?? null,
    kind: r.kind as string,
    title: r.title as string,
    body: r.body as string,
    value: r.value as string,
    url: r.url as string,
    meta: json(r.meta, {}),
    done: Boolean(r.done),
    sort: Number(r.sort),
    createdBy: (r.created_by as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }
}

function mapProject(r: Row) {
  return {
    id: r.id as string,
    name: r.name as string,
    color: r.color as string,
    description: r.description as string,
    sort: Number(r.sort),
    archived: Boolean(r.archived),
  }
}

function mapShare(r: Row) {
  return {
    id: r.id as string,
    token: r.token as string,
    scope: r.scope as string,
    targetId: (r.target_id as string) ?? null,
    title: r.title as string,
    includeNotes: Boolean(r.include_notes),
    includeEntries: Boolean(r.include_entries),
    expiresAt: (r.expires_at as string) ?? null,
    revoked: Boolean(r.revoked),
    views: Number(r.views),
    createdBy: (r.created_by as string) ?? null,
    createdAt: r.created_at as string,
  }
}

const EVENT_SELECT = `
  SELECT e.*,
    (SELECT COUNT(*) FROM entries x WHERE x.event_id=e.id) AS entry_count,
    (SELECT COUNT(*) FROM entries x WHERE x.event_id=e.id AND x.kind='task' AND x.done=0) AS open_tasks
  FROM events e`

const listUsers = () =>
  all(`SELECT id,email,name,role,color,created_at FROM users ORDER BY created_at`)
const listProjects = () =>
  all(`SELECT * FROM projects ORDER BY archived, sort, created_at`).map(mapProject)
const listEvents = () => all(`${EVENT_SELECT} ORDER BY e.start`).map(mapEvent)

function log(eventId: string | null, user: User | null, action: string, detail = "") {
  run(
    `INSERT INTO activity(event_id,user_id,action,detail) VALUES(?,?,?,?)`,
    eventId,
    user?.id ?? null,
    action,
    detail.slice(0, 300)
  )
}

// ---------- validation ----------

const dateOrInstant = z
  .string()
  .min(10)
  .max(40)
  .refine((v) => !Number.isNaN(new Date(v).getTime()), "Invalid date")

const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .nullable()

const eventInput = z.object({
  projectId: z.string().max(40).nullable().optional(),
  title: z.string().trim().min(1).max(200),
  start: dateOrInstant,
  end: dateOrInstant,
  allDay: z.boolean().optional(),
  color: color.optional(),
  status: z.enum(["planned", "active", "done", "blocked"]).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  priority: z.number().int().min(0).max(3).optional(),
  location: z.string().max(300).optional(),
  notes: z.string().max(20000).optional(),
  dependencies: z.array(z.string().max(40)).max(50).optional(),
  assignees: z.array(z.string().max(40)).max(50).optional(),
  sort: z.number().int().optional(),
})

const entryInput = z.object({
  eventId: z.string().max(40),
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  kind: z.enum(["note", "task", "value", "link", "file"]).optional(),
  title: z.string().max(300).optional(),
  body: z.string().max(20000).optional(),
  value: z.string().max(500).optional(),
  url: z
    .string()
    .max(2000)
    .refine((v) => v === "" || /^https?:\/\//i.test(v), "Links must start with http(s)://")
    .optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  done: z.boolean().optional(),
  sort: z.number().int().optional(),
})

const projectInput = z.object({
  name: z.string().trim().min(1).max(120),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  description: z.string().max(2000).optional(),
  sort: z.number().int().optional(),
  archived: z.boolean().optional(),
})

const shareInput = z.object({
  scope: z.enum(["all", "project", "event"]),
  targetId: z.string().max(40).nullable().optional(),
  title: z.string().max(160).optional(),
  includeNotes: z.boolean().optional(),
  includeEntries: z.boolean().optional(),
  expiresAt: dateOrInstant.nullable().optional(),
})

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new HttpError(400, "Expected a JSON body.")
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new HttpError(400, `${issue?.path.join(".") || "input"}: ${issue?.message}`)
  }
  return parsed.data
}

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function assertEditor(user: User) {
  if (!canEdit(user)) throw new HttpError(403, "Your role is view-only.")
}
function assertAdmin(user: User) {
  if (user.role !== "admin") throw new HttpError(403, "Only admins can do this.")
}
function assertRange(start: string, end: string) {
  if (new Date(end).getTime() < new Date(start).getTime())
    throw new HttpError(400, "The end must be on or after the start.")
}

// ---------- app ----------

const app = new Hono<Env>()

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400)
  const msg = String((err as Error).message ?? err)
  if (msg.includes("UNIQUE constraint failed: users.email"))
    return c.json({ error: "That email is already registered." }, 409)
  console.error(err)
  return c.json({ error: "Something went wrong on the server." }, 500)
})

// Security headers for every response.
app.use("*", async (c, next) => {
  await next()
  c.header("X-Content-Type-Options", "nosniff")
  c.header("Referrer-Policy", "strict-origin-when-cross-origin")
  c.header("X-Frame-Options", "SAMEORIGIN")
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
})

// CSRF: mutations must carry a header that cross-site forms cannot set.
app.use("/api/*", async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    if (c.req.header("x-requested-with") !== "calendar")
      return c.json({ error: "Missing request header." }, 403)
  }
  await next()
})

app.get("/api/health", (c) => c.json({ ok: true }))

app.get("/api/config", (c) => {
  const userCount = Number(one(`SELECT COUNT(*) AS n FROM users`)?.n ?? 0)
  return c.json({
    setupRequired: userCount === 0,
    setupNeedsCode: userCount === 0 && Boolean(SETUP_CODE),
    signupWithCode: Boolean(SIGNUP_CODE),
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      apiKey: process.env.GOOGLE_API_KEY ?? "",
      appId: process.env.GOOGLE_APP_ID ?? "",
    },
  })
})

// ----- auth -----

const ip = (c: Context) =>
  c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "local"

app.post("/api/auth/register", async (c) => {
  const input = await body(
    c,
    z.object({
      name: z.string().trim().min(1).max(80),
      email: z.string().trim().email().max(160),
      password: z.string().min(8).max(200),
      code: z.string().max(200).optional(),
    })
  )
  if (limited(`reg:${ip(c)}`, 10)) throw new HttpError(429, "Too many attempts. Try again later.")
  const userCount = Number(one(`SELECT COUNT(*) AS n FROM users`)?.n ?? 0)
  let role = "editor"
  if (userCount === 0) {
    if (SETUP_CODE && input.code !== SETUP_CODE) throw new HttpError(403, "The setup code is wrong.")
    role = "admin"
  } else if (!SIGNUP_CODE || input.code !== SIGNUP_CODE)
    throw new HttpError(403, "Ask an admin to add you, or use the workspace code.")
  const id = newId("u_")
  const palette = ["#e4572e", "#2e86ab", "#3fa34d", "#8e5cd9", "#d1495b", "#edae49", "#00798c"]
  run(
    `INSERT INTO users(id,email,name,password_hash,role,color) VALUES(?,?,?,?,?,?)`,
    id,
    input.email.toLowerCase(),
    input.name,
    hashPassword(input.password),
    role,
    palette[userCount % palette.length]!
  )
  createSession(c, id)
  bumpVersion()
  return c.json({ user: one(`SELECT id,email,name,role,color,created_at FROM users WHERE id=?`, id) })
})

app.post("/api/auth/login", async (c) => {
  const input = await body(
    c,
    z.object({ email: z.string().trim().max(160), password: z.string().max(200) })
  )
  const key = `login:${ip(c)}:${input.email.toLowerCase()}`
  if (limited(key)) throw new HttpError(429, "Too many attempts. Wait 15 minutes and try again.")
  const row = one(`SELECT id,password_hash FROM users WHERE email=?`, input.email.toLowerCase())
  if (!row || !verifyPassword(input.password, String(row.password_hash)))
    throw new HttpError(401, "Email or password is wrong.")
  clearLimit(key)
  createSession(c, String(row.id))
  return c.json({
    user: one(`SELECT id,email,name,role,color,created_at FROM users WHERE id=?`, String(row.id)),
  })
})

app.post("/api/auth/logout", (c) => {
  destroySession(c)
  return c.json({ ok: true })
})

app.get("/api/auth/me", (c) => {
  const user = currentUser(c)
  return c.json({ user })
})

// ----- public share view (no auth) -----

app.get("/api/public/:token", (c) => {
  const share = one(`SELECT * FROM shares WHERE token=?`, c.req.param("token"))
  if (!share || share.revoked) return c.json({ error: "This link is no longer active." }, 404)
  if (share.expires_at && new Date(String(share.expires_at)).getTime() < Date.now())
    return c.json({ error: "This link has expired." }, 410)
  run(`UPDATE shares SET views=views+1 WHERE id=?`, String(share.id))

  let events = listEvents()
  let projects = listProjects().filter((p) => !p.archived)
  if (share.scope === "project") {
    events = events.filter((e) => e.projectId === share.target_id)
    projects = projects.filter((p) => p.id === share.target_id)
  } else if (share.scope === "event") {
    events = events.filter((e) => e.id === share.target_id)
    projects = projects.filter((p) => events.some((e) => e.projectId === p.id))
  }
  const includeNotes = Boolean(share.include_notes)
  const includeEntries = Boolean(share.include_entries)
  const ids = new Set(events.map((e) => e.id))
  const entries = includeEntries
    ? all(`SELECT * FROM entries ORDER BY day, sort, created_at`)
        .map(mapEntry)
        .filter((x) => ids.has(x.eventId))
        .map(({ createdBy: _c, ...x }) => x)
    : []
  const people = new Set(events.flatMap((e) => e.assignees))
  const users = listUsers()
    .filter((u) => people.has(String(u.id)))
    .map((u) => ({ id: u.id, name: u.name, color: u.color }))

  return c.json({
    share: {
      title: share.title || "Shared schedule",
      scope: share.scope,
      includeNotes,
      includeEntries,
      expiresAt: share.expires_at ?? null,
    },
    projects,
    users,
    events: events.map((e) => ({
      ...e,
      notes: includeNotes ? e.notes : "",
      createdBy: null,
      updatedBy: null,
    })),
    entries,
  })
})

// ----- everything below needs a session -----

app.use("/api/*", requireUser)

app.get("/api/version", (c) => c.json({ version: getVersion() }))

app.get("/api/bootstrap", (c) => {
  const user = c.get("user")
  return c.json({
    me: user,
    version: getVersion(),
    users: listUsers().map((u) => (user.role === "admin" ? u : { ...u, email: u.email })),
    projects: listProjects(),
    events: listEvents(),
    shares: canEdit(user) ? all(`SELECT * FROM shares ORDER BY created_at DESC`).map(mapShare) : [],
    dayMarks: all(`SELECT day, COUNT(*) AS n FROM entries WHERE day IS NOT NULL GROUP BY day`).map(
      (r) => ({ day: String(r.day), n: Number(r.n) })
    ),
  })
})

// profile
app.patch("/api/me", async (c) => {
  const user = c.get("user")
  const input = await body(
    c,
    z.object({
      name: z.string().trim().min(1).max(80).optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      currentPassword: z.string().max(200).optional(),
      newPassword: z.string().min(8).max(200).optional(),
    })
  )
  if (input.newPassword) {
    const row = one(`SELECT password_hash FROM users WHERE id=?`, user.id)
    if (!row || !verifyPassword(input.currentPassword ?? "", String(row.password_hash)))
      throw new HttpError(400, "Your current password is wrong.")
    run(`UPDATE users SET password_hash=? WHERE id=?`, hashPassword(input.newPassword), user.id)
  }
  if (input.name) run(`UPDATE users SET name=? WHERE id=?`, input.name, user.id)
  if (input.color) run(`UPDATE users SET color=? WHERE id=?`, input.color, user.id)
  bumpVersion()
  return c.json({ ok: true })
})

// team (admin)
app.post("/api/users", async (c) => {
  const user = c.get("user")
  assertAdmin(user)
  const input = await body(
    c,
    z.object({
      name: z.string().trim().min(1).max(80),
      email: z.string().trim().email().max(160),
      password: z.string().min(8).max(200),
      role: z.enum(["admin", "editor", "viewer"]),
    })
  )
  const id = newId("u_")
  const palette = ["#2e86ab", "#3fa34d", "#8e5cd9", "#d1495b", "#edae49", "#00798c", "#e4572e"]
  const n = Number(one(`SELECT COUNT(*) AS n FROM users`)?.n ?? 0)
  run(
    `INSERT INTO users(id,email,name,password_hash,role,color) VALUES(?,?,?,?,?,?)`,
    id,
    input.email.toLowerCase(),
    input.name,
    hashPassword(input.password),
    input.role,
    palette[n % palette.length]!
  )
  bumpVersion()
  return c.json({ id })
})

app.patch("/api/users/:id", async (c) => {
  const user = c.get("user")
  assertAdmin(user)
  const id = c.req.param("id")
  const input = await body(
    c,
    z.object({
      role: z.enum(["admin", "editor", "viewer"]).optional(),
      password: z.string().min(8).max(200).optional(),
      name: z.string().trim().min(1).max(80).optional(),
    })
  )
  if (input.role && id === user.id && input.role !== "admin")
    throw new HttpError(400, "You cannot remove your own admin role.")
  if (input.role) run(`UPDATE users SET role=? WHERE id=?`, input.role, id)
  if (input.name) run(`UPDATE users SET name=? WHERE id=?`, input.name, id)
  if (input.password) {
    run(`UPDATE users SET password_hash=? WHERE id=?`, hashPassword(input.password), id)
    run(`DELETE FROM sessions WHERE user_id=?`, id)
  }
  bumpVersion()
  return c.json({ ok: true })
})

app.delete("/api/users/:id", (c) => {
  const user = c.get("user")
  assertAdmin(user)
  const id = c.req.param("id")
  if (id === user.id) throw new HttpError(400, "You cannot remove yourself.")
  run(`DELETE FROM users WHERE id=?`, id)
  bumpVersion()
  return c.json({ ok: true })
})

// projects
app.post("/api/projects", async (c) => {
  const user = c.get("user")
  assertEditor(user)
  const input = await body(c, projectInput)
  const id = newId("p_")
  const sort = Number(one(`SELECT COALESCE(MAX(sort),0)+1 AS s FROM projects`)?.s ?? 0)
  run(
    `INSERT INTO projects(id,name,color,description,sort,created_by) VALUES(?,?,?,?,?,?)`,
    id,
    input.name,
    input.color ?? "#e4572e",
    input.description ?? "",
    input.sort ?? sort,
    user.id
  )
  bumpVersion()
  return c.json(mapProject(one(`SELECT * FROM projects WHERE id=?`, id)!))
})

app.patch("/api/projects/:id", async (c) => {
  const user = c.get("user")
  assertEditor(user)
  const id = c.req.param("id")
  const input = await body(c, projectInput.partial())
  const cur = one(`SELECT * FROM projects WHERE id=?`, id)
  if (!cur) throw new HttpError(404, "Project not found.")
  run(
    `UPDATE projects SET name=?,color=?,description=?,sort=?,archived=? WHERE id=?`,
    input.name ?? String(cur.name),
    input.color ?? String(cur.color),
    input.description ?? String(cur.description),
    input.sort ?? Number(cur.sort),
    input.archived === undefined ? Number(cur.archived) : input.archived ? 1 : 0,
    id
  )
  bumpVersion()
  return c.json(mapProject(one(`SELECT * FROM projects WHERE id=?`, id)!))
})

app.post("/api/projects/reorder", async (c) => {
  const user = c.get("user")
  assertEditor(user)
  const input = await body(c, z.object({ ids: z.array(z.string().max(40)).max(500) }))
  tx(() => input.ids.forEach((id, i) => run(`UPDATE projects SET sort=? WHERE id=?`, i, id)))
  bumpVersion()
  return c.json({ ok: true })
})

app.delete("/api/projects/:id", (c) => {
  const user = c.get("user")
  assertEditor(user)
  run(`DELETE FROM projects WHERE id=?`, c.req.param("id"))
  bumpVersion()
  return c.json({ ok: true })
})

// events
app.post("/api/events", async (c) => {
  const user = c.get("user")
  assertEditor(user)
  const input = await body(c, eventInput)
  assertRange(input.start, input.end)
  const id = newId("e_")
  const sort = Number(one(`SELECT COALESCE(MAX(sort),0)+1 AS s FROM events`)?.s ?? 0)
  run(
    `INSERT INTO events(id,project_id,title,start,"end",all_day,color,status,progress,priority,location,notes,dependencies,assignees,sort,created_by,updated_by)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    input.projectId ?? null,
    input.title,
    input.start,
    input.end,
    input.allDay === false ? 0 : 1,
    input.color ?? null,
    input.status ?? "planned",
    input.progress ?? 0,
    input.priority ?? 0,
    input.location ?? "",
    input.notes ?? "",
    JSON.stringify(input.dependencies ?? []),
    JSON.stringify(input.assignees ?? []),
    input.sort ?? sort,
    user.id,
    user.id
  )
  log(id, user, "created", input.title)
  bumpVersion()
  return c.json(mapEvent(one(`${EVENT_SELECT} WHERE e.id=?`, id)!))
})

app.patch("/api/events/:id", async (c) => {
  const user = c.get("user")
  assertEditor(user)
  const id = c.req.param("id")
  const cur = one(`SELECT * FROM events WHERE id=?`, id)
  if (!cur) throw new HttpError(404, "Event not found.")
  const input = await body(c, eventInput.partial())
  const start = input.start ?? String(cur.start)
  const end = input.end ?? String(cur.end)
  assertRange(start, end)
  run(
    `UPDATE events SET project_id=?,title=?,start=?,"end"=?,all_day=?,color=?,status=?,progress=?,priority=?,location=?,notes=?,dependencies=?,assignees=?,sort=?,updated_by=?,updated_at=? WHERE id=?`,
    input.projectId === undefined ? ((cur.project_id as string) ?? null) : input.projectId,
    input.title ?? String(cur.title),
    start,
    end,
    input.allDay === undefined ? Number(cur.all_day) : input.allDay ? 1 : 0,
    input.color === undefined ? ((cur.color as string) ?? null) : input.color,
    input.status ?? String(cur.status),
    input.progress ?? Number(cur.progress),
    input.priority ?? Number(cur.priority),
    input.location ?? String(cur.location),
    input.notes ?? String(cur.notes),
    input.dependencies ? JSON.stringify(input.dependencies) : String(cur.dependencies),
    input.assignees ? JSON.stringify(input.assignees) : String(cur.assignees),
    input.sort ?? Number(cur.sort),
    user.id,
    now(),
    id
  )
  const COLS: Record<string, string> = {
    projectId: "project_id",
    title: "title",
    allDay: "all_day",
    color: "color",
    status: "status",
    progress: "progress",
    priority: "priority",
    location: "location",
    notes: "notes",
    dependencies: "dependencies",
    assignees: "assignees",
  }
  const LABEL: Record<string, string> = { projectId: "project", allDay: "all-day", assignees: "people", dependencies: "dependencies" }
  const norm = (v: unknown) => (typeof v === "boolean" ? Number(v) : Array.isArray(v) ? JSON.stringify(v) : (v ?? null))
  const changed = Object.keys(input).filter((k) => COLS[k] && norm((input as Record<string, unknown>)[k]) !== norm(cur[COLS[k]!]))
  const moved = start !== String(cur.start) || end !== String(cur.end)
  const pretty = (v: string) => (v.length <= 10 ? v : new Date(v).toISOString().slice(0, 16).replace("T", " "))
  // All-day ends are stored exclusive; show the last day people actually see.
  const lastShown = end.length <= 10 ? new Date(Date.parse(end + "T00:00:00Z") - 864e5).toISOString().slice(0, 10) : pretty(end)
  if (moved) log(id, user, "rescheduled", start.slice(0, 10) === lastShown ? pretty(start) : `${pretty(start)} to ${lastShown}`)
  if (input.status && input.status !== cur.status) log(id, user, `marked it ${input.status}`)
  const rest = changed.filter((k) => k !== "status")
  if (rest.length) log(id, user, "updated", rest.map((k) => LABEL[k] ?? k).join(", "))
  bumpVersion()
  return c.json(mapEvent(one(`${EVENT_SELECT} WHERE e.id=?`, id)!))
})

app.post("/api/events/:id/duplicate", (c) => {
  const user = c.get("user")
  assertEditor(user)
  const cur = one(`SELECT * FROM events WHERE id=?`, c.req.param("id"))
  if (!cur) throw new HttpError(404, "Event not found.")
  const id = newId("e_")
  run(
    `INSERT INTO events(id,project_id,title,start,"end",all_day,color,status,progress,priority,location,notes,dependencies,assignees,sort,created_by,updated_by)
     SELECT ?,project_id,title || ' (copy)',start,"end",all_day,color,'planned',0,priority,location,notes,'[]',assignees,sort+1,?,? FROM events WHERE id=?`,
    id,
    user.id,
    user.id,
    String(cur.id)
  )
  log(id, user, "created", `copy of ${cur.title}`)
  bumpVersion()
  return c.json(mapEvent(one(`${EVENT_SELECT} WHERE e.id=?`, id)!))
})

app.delete("/api/events/:id", (c) => {
  const user = c.get("user")
  assertEditor(user)
  const id = c.req.param("id")
  const cur = one(`SELECT title FROM events WHERE id=?`, id)
  run(`DELETE FROM events WHERE id=?`, id)
  run(`DELETE FROM shares WHERE scope='event' AND target_id=?`, id)
  log(id, user, "deleted", String(cur?.title ?? ""))
  bumpVersion()
  return c.json({ ok: true })
})

app.get("/api/events/:id/activity", (c) => {
  const rows = all(
    `SELECT a.*, u.name AS user_name FROM activity a LEFT JOIN users u ON u.id=a.user_id
     WHERE a.event_id=? ORDER BY a.id DESC LIMIT 50`,
    c.req.param("id")
  )
  return c.json(
    rows.map((r) => ({
      id: Number(r.id),
      action: r.action,
      detail: r.detail,
      userName: r.user_name ?? "Someone",
      createdAt: r.created_at,
    }))
  )
})

// entries (per-day data)
app.get("/api/entries", (c) => {
  const eventId = c.req.query("eventId")
  const day = c.req.query("day")
  if (c.req.query("all") === "1")
    return c.json(all(`SELECT * FROM entries ORDER BY day IS NOT NULL, day, sort`).map(mapEntry))
  if (eventId)
    return c.json(
      all(`SELECT * FROM entries WHERE event_id=? ORDER BY day IS NOT NULL, day, sort, created_at`, eventId).map(mapEntry)
    )
  if (day) {
    // Everything for one date: day-pinned entries, plus whole-event entries of events covering it.
    return c.json(
      all(
        `SELECT x.* FROM entries x JOIN events e ON e.id=x.event_id
         WHERE x.day=? OR (x.day IS NULL AND substr(e.start,1,10)<=? AND (
           (e.all_day=1 AND substr(e."end",1,10)>?) OR (e.all_day=0 AND substr(e."end",1,10)>=?)))
         ORDER BY x.sort, x.created_at`,
        day,
        day,
        day,
        day
      ).map(mapEntry)
    )
  }
  throw new HttpError(400, "Pass eventId or day.")
})

app.post("/api/entries", async (c) => {
  const user = c.get("user")
  assertEditor(user)
  const input = await body(c, entryInput)
  if (!one(`SELECT id FROM events WHERE id=?`, input.eventId)) throw new HttpError(404, "Event not found.")
  const id = newId("x_")
  const sort = Number(one(`SELECT COALESCE(MAX(sort),0)+1 AS s FROM entries WHERE event_id=?`, input.eventId)?.s ?? 0)
  run(
    `INSERT INTO entries(id,event_id,day,kind,title,body,value,url,meta,done,sort,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    input.eventId,
    input.day ?? null,
    input.kind ?? "note",
    input.title ?? "",
    input.body ?? "",
    input.value ?? "",
    input.url ?? "",
    JSON.stringify(input.meta ?? {}),
    input.done ? 1 : 0,
    input.sort ?? sort,
    user.id
  )
  log(input.eventId, user, "added data", `${input.kind ?? "note"}${input.day ? ` on ${input.day}` : ""}: ${input.title ?? ""}`)
  bumpVersion()
  return c.json(mapEntry(one(`SELECT * FROM entries WHERE id=?`, id)!))
})

app.patch("/api/entries/:id", async (c) => {
  const user = c.get("user")
  assertEditor(user)
  const id = c.req.param("id")
  const cur = one(`SELECT * FROM entries WHERE id=?`, id)
  if (!cur) throw new HttpError(404, "Entry not found.")
  const input = await body(c, entryInput.omit({ eventId: true }).partial())
  run(
    `UPDATE entries SET day=?,kind=?,title=?,body=?,value=?,url=?,meta=?,done=?,sort=?,updated_at=? WHERE id=?`,
    input.day === undefined ? ((cur.day as string) ?? null) : input.day,
    input.kind ?? String(cur.kind),
    input.title ?? String(cur.title),
    input.body ?? String(cur.body),
    input.value ?? String(cur.value),
    input.url ?? String(cur.url),
    input.meta ? JSON.stringify(input.meta) : String(cur.meta),
    input.done === undefined ? Number(cur.done) : input.done ? 1 : 0,
    input.sort ?? Number(cur.sort),
    now(),
    id
  )
  bumpVersion()
  return c.json(mapEntry(one(`SELECT * FROM entries WHERE id=?`, id)!))
})

app.delete("/api/entries/:id", (c) => {
  const user = c.get("user")
  assertEditor(user)
  const cur = one(`SELECT event_id,title,kind FROM entries WHERE id=?`, c.req.param("id"))
  run(`DELETE FROM entries WHERE id=?`, c.req.param("id"))
  if (cur) log(String(cur.event_id), user, "removed data", `${cur.kind}: ${cur.title}`)
  bumpVersion()
  return c.json({ ok: true })
})

// bulk import (Google Sheets / CSV)
app.post("/api/events/import", async (c) => {
  const user = c.get("user")
  assertEditor(user)
  const input = await body(c, z.object({ events: z.array(eventInput).min(1).max(1000) }))
  const created = tx(() =>
    input.events.map((e) => {
      assertRange(e.start, e.end)
      const id = newId("e_")
      run(
        `INSERT INTO events(id,project_id,title,start,"end",all_day,color,status,progress,priority,location,notes,dependencies,assignees,created_by,updated_by)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'[]','[]',?,?)`,
        id,
        e.projectId ?? null,
        e.title,
        e.start,
        e.end,
        e.allDay === false ? 0 : 1,
        e.color ?? null,
        e.status ?? "planned",
        e.progress ?? 0,
        e.priority ?? 0,
        e.location ?? "",
        e.notes ?? "",
        user.id,
        user.id
      )
      log(id, user, "imported", e.title)
      return id
    })
  )
  bumpVersion()
  return c.json({ created: created.length })
})

// shares
app.post("/api/shares", async (c) => {
  const user = c.get("user")
  assertEditor(user)
  const input = await body(c, shareInput)
  if (input.scope !== "all" && !input.targetId) throw new HttpError(400, "Pick what to share.")
  const id = newId("s_")
  const token = randomBytes(18).toString("base64url")
  run(
    `INSERT INTO shares(id,token,scope,target_id,title,include_notes,include_entries,expires_at,created_by) VALUES(?,?,?,?,?,?,?,?,?)`,
    id,
    token,
    input.scope,
    input.scope === "all" ? null : (input.targetId ?? null),
    input.title ?? "",
    input.includeNotes === false ? 0 : 1,
    input.includeEntries ? 1 : 0,
    input.expiresAt ?? null,
    user.id
  )
  bumpVersion()
  return c.json(mapShare(one(`SELECT * FROM shares WHERE id=?`, id)!))
})

app.patch("/api/shares/:id", async (c) => {
  const user = c.get("user")
  assertEditor(user)
  const input = await body(
    c,
    z.object({
      revoked: z.boolean().optional(),
      title: z.string().max(160).optional(),
      includeNotes: z.boolean().optional(),
      includeEntries: z.boolean().optional(),
      expiresAt: dateOrInstant.nullable().optional(),
    })
  )
  const cur = one(`SELECT * FROM shares WHERE id=?`, c.req.param("id"))
  if (!cur) throw new HttpError(404, "Link not found.")
  run(
    `UPDATE shares SET revoked=?,title=?,include_notes=?,include_entries=?,expires_at=? WHERE id=?`,
    input.revoked === undefined ? Number(cur.revoked) : input.revoked ? 1 : 0,
    input.title ?? String(cur.title),
    input.includeNotes === undefined ? Number(cur.include_notes) : input.includeNotes ? 1 : 0,
    input.includeEntries === undefined ? Number(cur.include_entries) : input.includeEntries ? 1 : 0,
    input.expiresAt === undefined ? ((cur.expires_at as string) ?? null) : input.expiresAt,
    String(cur.id)
  )
  bumpVersion()
  return c.json(mapShare(one(`SELECT * FROM shares WHERE id=?`, String(cur.id))!))
})

app.delete("/api/shares/:id", (c) => {
  const user = c.get("user")
  assertEditor(user)
  run(`DELETE FROM shares WHERE id=?`, c.req.param("id"))
  bumpVersion()
  return c.json({ ok: true })
})

app.all("/api/*", (c) => c.json({ error: "Not found." }, 404))

// ---------- static SPA ----------

if (existsSync(DIST)) {
  app.use(
    "/assets/*",
    async (c, next) => {
      await next()
      c.header("Cache-Control", "public, max-age=31536000, immutable")
    },
    serveStatic({ root: DIST })
  )
  app.use("*", serveStatic({ root: DIST }))
  const indexHtml = readFileSync(`${DIST}/index.html`, "utf8")
  app.get("*", (c) => {
    c.header("Cache-Control", "no-cache")
    return c.html(indexHtml)
  })
}

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`calendar server on http://${info.address}:${info.port}`)
})
