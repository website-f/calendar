/** RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF or LF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  const s = text.replace(/^﻿/, "")
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ",") {
      row.push(field)
      field = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else field += ch
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""))
}

export interface IcsEvent {
  uid: string
  title: string
  start: string
  end: string
  allDay: boolean
  notes: string
  location: string
}

/** Minimal iCalendar reader for files exported from Google Calendar, Outlook or Apple Calendar.
 *  Recurring events come in as their first occurrence only. */
export function parseIcs(text: string): IcsEvent[] {
  // Unfold continuation lines (a line starting with space or tab continues the previous one).
  const lines = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/)
  const out: IcsEvent[] = []
  let cur: Record<string, { value: string; params: string }> | null = null
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") cur = {}
    else if (line === "END:VEVENT" && cur) {
      const ev = toEvent(cur)
      if (ev) out.push(ev)
      cur = null
    } else if (cur) {
      const idx = line.indexOf(":")
      if (idx < 0) continue
      const head = line.slice(0, idx)
      const [name, ...params] = head.split(";")
      cur[name!.toUpperCase()] = { value: line.slice(idx + 1), params: params.join(";").toUpperCase() }
    }
  }
  return out
}

const unescape = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\")

function icsDate(p: { value: string; params: string } | undefined): { iso: string; allDay: boolean } | null {
  if (!p) return null
  const v = p.value.trim()
  if (/^\d{8}$/.test(v) || p.params.includes("VALUE=DATE")) {
    const d = v.slice(0, 8)
    return { iso: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, allDay: true }
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/)
  if (!m) return null
  const [, y, mo, d, h, mi, s, z] = m
  // TZID times are read as this browser's local time, which matches for a single-office team.
  const date = z
    ? new Date(Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!))
    : new Date(+y!, +mo! - 1, +d!, +h!, +mi!, +s!)
  return { iso: date.toISOString(), allDay: false }
}

function toEvent(p: Record<string, { value: string; params: string }>): IcsEvent | null {
  const s = icsDate(p.DTSTART)
  if (!s) return null
  let e = icsDate(p.DTEND)
  if (!e) {
    if (s.allDay) {
      const d = new Date(s.iso + "T00:00:00")
      d.setDate(d.getDate() + 1)
      e = { iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, allDay: true }
    } else e = { iso: new Date(new Date(s.iso).getTime() + 3600_000).toISOString(), allDay: false }
  }
  return {
    uid: p.UID?.value ?? crypto.randomUUID(),
    title: unescape(p.SUMMARY?.value ?? "Untitled").slice(0, 200),
    start: s.iso,
    end: e.iso,
    allDay: s.allDay,
    notes: unescape(p.DESCRIPTION?.value ?? "").slice(0, 20000),
    location: unescape(p.LOCATION?.value ?? "").slice(0, 300),
  }
}
