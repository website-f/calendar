// Malaysian public holidays from Google's public holiday calendar (free, no API key, no sign-in).
// The feed covers national and state holidays several years ahead; we refresh it daily and keep
// the last good copy in SQLite so the calendar still shows holidays if Google is unreachable.

import { db } from "./db.ts"

const FEED =
  process.env.HOLIDAY_FEED_URL ??
  "https://calendar.google.com/calendar/ical/en.malaysia%23holiday%40group.v.calendar.google.com/public/basic.ics"
const REFRESH_MS = 24 * 60 * 60 * 1000
// Bump when parsing changes so cached copies are re-read with the new rules.
const PARSER_VERSION = "2"

export const MY_STATES = [
  "Johor",
  "Kedah",
  "Kelantan",
  "Kuala Lumpur",
  "Labuan",
  "Malacca",
  "Negeri Sembilan",
  "Pahang",
  "Penang",
  "Perak",
  "Perlis",
  "Putrajaya",
  "Sabah",
  "Sarawak",
  "Selangor",
  "Terengganu",
] as const

export interface Holiday {
  id: string
  date: string // YYYY-MM-DD (first day)
  end: string // YYYY-MM-DD exclusive
  name: string
  national: boolean
  states: string[] // empty for national holidays
  tentative: boolean
}

function unfold(text: string) {
  return text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/)
}
const unescape = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\")
const ymd = (v: string) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`

export function parseHolidayFeed(text: string): Holiday[] {
  const out: Holiday[] = []
  let cur: Record<string, string> | null = null
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") cur = {}
    else if (line === "END:VEVENT" && cur) {
      const desc = unescape(cur.DESCRIPTION ?? "")
      const start = (cur.DTSTART ?? "").match(/(\d{8})/)?.[1]
      const end = (cur.DTEND ?? "").match(/(\d{8})/)?.[1]
      // Skip observances (Valentine's Day, Mother's Day...): they are not days off.
      if (start && /^Public holiday/i.test(desc)) {
        const statesPart = desc.match(/^Public holiday in ([^\n]+)/i)?.[1] ?? ""
        const states = [...new Set(statesPart.split(",").map((s) => s.trim()).filter(Boolean))]
        const name = unescape(cur.SUMMARY ?? "Public holiday")
          .replace(/\s*\((regional holiday|tentative)\)/gi, "")
          .trim()
        out.push({
          id: `hol_${start}_${(cur.UID ?? name).replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`,
          date: ymd(start),
          end: end ? ymd(end) : ymd(start),
          name,
          national: states.length === 0,
          states,
          tentative: /tentative/i.test(desc),
        })
      }
      cur = null
    } else if (cur) {
      const i = line.indexOf(":")
      if (i > 0) cur[line.slice(0, i).split(";")[0]!.toUpperCase()] = line.slice(i + 1)
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || Number(b.national) - Number(a.national))
}

const getMeta = (k: string) => (db.prepare(`SELECT value FROM meta WHERE key=?`).get(k) as { value: string } | undefined)?.value
const setMeta = (k: string, v: string) =>
  db.prepare(`INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(k, v)

let cache: Holiday[] = (() => {
  try {
    return JSON.parse(getMeta("holidays_json") ?? "[]") as Holiday[]
  } catch {
    return []
  }
})()
let fetchedAt = getMeta("holidays_parser") === PARSER_VERSION ? Number(getMeta("holidays_fetched_at") ?? 0) : 0
let inflight: Promise<void> | null = null

export async function refreshHolidays(force = false): Promise<void> {
  if (!force && Date.now() - fetchedAt < REFRESH_MS && cache.length) return
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const res = await fetch(FEED, { signal: AbortSignal.timeout(20_000) })
      if (!res.ok) throw new Error(`feed ${res.status}`)
      const list = parseHolidayFeed(await res.text())
      if (list.length < 10) throw new Error("feed looked empty")
      cache = list
      fetchedAt = Date.now()
      setMeta("holidays_json", JSON.stringify(list))
      setMeta("holidays_fetched_at", String(fetchedAt))
      setMeta("holidays_parser", PARSER_VERSION)
      console.log(`holidays: loaded ${list.length} Malaysian public holidays`)
    } catch (err) {
      console.warn(`holidays: refresh failed, keeping ${cache.length} cached (${(err as Error).message})`)
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** "ALL" = every state, "" = national only, otherwise one state name. */
export function getHolidayRegion(): string {
  return getMeta("holiday_region") ?? "ALL"
}
export function setHolidayRegion(region: string) {
  setMeta("holiday_region", region)
}
export function holidaysEnabled(): boolean {
  return getMeta("holidays_enabled") !== "0"
}
export function setHolidaysEnabled(on: boolean) {
  setMeta("holidays_enabled", on ? "1" : "0")
}

export function listHolidays(region = getHolidayRegion()): Holiday[] {
  if (!holidaysEnabled()) return []
  // Fire-and-forget refresh; callers get the cached list immediately.
  void refreshHolidays()
  if (region === "ALL") return cache
  return cache.filter((h) => h.national || (region !== "" && h.states.includes(region)))
}

export function holidayStatus() {
  return { count: cache.length, fetchedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null }
}
