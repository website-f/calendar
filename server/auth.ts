import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto"
import type { Context, Next } from "hono"
import { getCookie, setCookie, deleteCookie } from "hono/cookie"
import { db } from "./db.ts"

export type Role = "admin" | "editor" | "viewer"
export interface User {
  id: string
  email: string
  name: string
  role: Role
  color: string
  created_at: string
}

export type Env = { Variables: { user: User } }

const COOKIE = "cal_sid"
const SESSION_DAYS = 30
const SECURE = process.env.COOKIE_SECURE === "true"

export function newId(prefix = ""): string {
  return prefix + randomBytes(12).toString("base64url")
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 })
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algo, saltB64, hashB64] = stored.split("$")
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, "base64")
  const actual = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: 16384,
    r: 8,
    p: 1,
  })
  return timingSafeEqual(expected, actual)
}

const sha = (v: string) => createHash("sha256").update(v).digest("hex")

export function createSession(c: Context, userId: string) {
  const token = randomBytes(32).toString("base64url")
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5)
  db.prepare(`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)`).run(
    sha(token),
    userId,
    expires.toISOString()
  )
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: SECURE,
    sameSite: "Lax",
    path: "/",
    expires,
  })
}

export function destroySession(c: Context) {
  const token = getCookie(c, COOKIE)
  if (token) db.prepare(`DELETE FROM sessions WHERE token_hash=?`).run(sha(token))
  deleteCookie(c, COOKIE, { path: "/" })
}

export function currentUser(c: Context): User | null {
  const token = getCookie(c, COOKIE)
  if (!token) return null
  const row = db
    .prepare(
      `SELECT u.id,u.email,u.name,u.role,u.color,u.created_at,s.expires_at
       FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`
    )
    .get(sha(token)) as (User & { expires_at: string }) | undefined
  if (!row) return null
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare(`DELETE FROM sessions WHERE token_hash=?`).run(sha(token))
    return null
  }
  const { expires_at: _e, ...user } = row
  return user
}

export async function requireUser(c: Context<Env>, next: Next) {
  const user = currentUser(c)
  if (!user) return c.json({ error: "Please sign in." }, 401)
  c.set("user", user)
  await next()
}

export function canEdit(user: User) {
  return user.role === "admin" || user.role === "editor"
}

// Small in-memory limiter for sign-in attempts (per IP + email).
const attempts = new Map<string, { n: number; until: number }>()
export function limited(key: string, max = 8, windowMs = 15 * 60_000): boolean {
  const now = Date.now()
  const rec = attempts.get(key)
  if (!rec || rec.until < now) {
    attempts.set(key, { n: 1, until: now + windowMs })
    return false
  }
  rec.n += 1
  return rec.n > max
}
export function clearLimit(key: string) {
  attempts.delete(key)
}
