/**
 * Times in a video or sound file, as people type and read them: `41`,
 * `0:41`, `1:02.5`, `1:02:03`. Seconds throughout; never negative.
 */

/** Seconds from `41`, `0:41`, `1:02.5` or `1:02:03`; undefined for anything else. */
export function parseTime(text: string): number | undefined {
  const parts = text.trim().split(':')
  if (parts.length === 0 || parts.length > 3) return undefined
  let seconds = 0
  for (const [i, part] of parts.entries()) {
    const last = i === parts.length - 1
    if (!(last ? /^\d+(\.\d+)?$/ : /^\d+$/).test(part)) return undefined
    const n = Number(part)
    // Minutes and seconds after the first part stop at 59.
    if (i > 0 && n >= 60) return undefined
    seconds = seconds * 60 + n
  }
  return seconds
}

/** `0:03.2-0:41` → start and end; the end may be left open. Undefined when it reads wrong or ends first. */
export function parseCut(text: string): { start: number; end: number | undefined } | undefined {
  const at = text.indexOf('-')
  if (at < 0) return undefined
  const start = parseTime(text.slice(0, at))
  const tail = text.slice(at + 1).trim()
  const end = tail === '' ? undefined : parseTime(tail)
  if (start === undefined || (tail !== '' && end === undefined)) return undefined
  if (end !== undefined && end <= start) return undefined
  return { start, end }
}

const two = (n: number) => String(n).padStart(2, '0')

/** A time to the tenth, as the Trim fields show it: `0:03.2`, `1:02:03.4`. */
export function timeOf(seconds: number): string {
  const tenths = Math.round(seconds * 10)
  const s = (tenths % 600) / 10
  const m = Math.floor(tenths / 600) % 60
  const h = Math.floor(tenths / 36000)
  const sec = s.toFixed(1).padStart(4, '0')
  return h > 0 ? `${h}:${two(m)}:${sec}` : `${m}:${sec}`
}

/** A length in whole seconds, as the card shows it: `2:10`, `58:12`, `1:02:03`. */
export function clockOf(seconds: number): string {
  const total = Math.round(seconds)
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
}

/** How far ←→ can move a Trim handle. */
const STEPS = [1, 5, 10, 30, 60, 300, 600, 1800] as const

/** The steps worth offering: up to about a quarter of the length, one second always. */
export function stepsFor(duration: number): number[] {
  return STEPS.filter((s, i) => i === 0 || s <= duration / 4)
}

/** A step as the pill shows it: `1 s`, `30 s`, `5 min`. */
export function stepLabel(seconds: number): string {
  return seconds < 60 ? `${seconds} s` : `${seconds / 60} min`
}
