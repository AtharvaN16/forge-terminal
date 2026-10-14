import { useEffect, useRef, useState } from 'react'
import type { Row, Run } from './home-art.js'
import { colourEnabled } from './theme.js'

/**
 * Motion in the shell (spec 2026-10-11 picker §4). Everything here changes a
 * character or a colour in a cell and nothing else, ticks no faster than a
 * terminal can usefully redraw, and stops on its own. When motion is off,
 * every caller shows its final frame — which is what a piped run, NO_COLOR,
 * the first-run NEUTRAL palette and the test suite all see.
 */

/** About 30 redraws a second: smooth to the eye, cheap for Ink. */
export const FRAME_MS = 33

let forced: boolean | undefined

/** Tests only: force motion on or off regardless of the terminal. `undefined` restores detection. */
export function setMotionForTests(on: boolean | undefined): void {
  forced = on
}

export function motionEnabled(paletteName: string): boolean {
  if (forced !== undefined) return forced
  return paletteName !== 'neutral' && colourEnabled()
}

const HEX = /^#[0-9a-f]{6}$/i

/**
 * A colour `k` of the way from `a` to `b`. Only hex colours blend; anything
 * else (an ANSI name, or '' for "no colour") snaps at the midpoint, so a
 * fade degrades to a cut rather than to a wrong colour.
 */
export function mix(a: string, b: string, k: number): string {
  const t = Math.max(0, Math.min(1, k))
  if (!HEX.test(a) || !HEX.test(b)) return t < 0.5 ? a : b
  let out = '#'
  for (const i of [1, 3, 5]) {
    const from = Number.parseInt(a.slice(i, i + 2), 16)
    const to = Number.parseInt(b.slice(i, i + 2), 16)
    out += Math.round(from + (to - from) * t)
      .toString(16)
      .padStart(2, '0')
  }
  return out
}

/**
 * `p` with every hex colour in it `v` of the way up from `canvas`: 0 is all
 * canvas, 1 is `p` itself. For fading a whole component that reads its
 * colours from the theme (the home field), where there are no rows to blend.
 */
export function fadedPalette<P extends object>(p: P, canvas: string, v: number): P {
  if (v >= 1) return p
  const out: Record<string, unknown> = { ...(p as Record<string, unknown>) }
  for (const [name, value] of Object.entries(p))
    if (typeof value === 'string' && HEX.test(value)) out[name] = mix(canvas, value, v)
  return out as P
}

/** One cell of a row: a glyph and its colours. */
interface Cell {
  ch: string
  fg?: string | undefined
  bg?: string | undefined
  bold?: boolean | undefined
}

const cellsOf = (row: Row): Cell[] =>
  row.flatMap((r) => Array.from(r.text, (ch) => ({ ch, fg: r.fg, bg: r.bg, bold: r.bold })))

/**
 * Row `a` moved `k` of the way to row `b`, cell for cell: each cell's colours
 * mix — except that a blank shows only its fill, so a glyph replacing one
 * fades up out of that fill from the start. A missing fill is `canvas`, a
 * missing ink `fg`; the shorter row is padded with blanks. A cell neither row
 * fills stays unfilled: the canvas is only a guess at the terminal's
 * background, and painting it there shows as dark patches on any other.
 * Adjacent cells that end up alike are one run again.
 *
 * Where a word changes (one screen's words for another's), its glyphs fade
 * out into their fill over the first half and the new ones up over the
 * second, swapping unseen at the midpoint. Swapped cell by cell where they
 * were, two lines of words read as one garble half way. A word here is a run
 * of two or more cells that hold a glyph in either row; only a run in which
 * some glyph changes, and that has glyphs in both rows, dips. A lone glyph —
 * a dot of the drop zone, which ripples on through the fade — swaps at the
 * midpoint as before, and a word that stays is left alone: dipping whole
 * rows flashed both (2026-10-14). Words where there was nothing fade up
 * from the start; words going to nothing are gone by the midpoint.
 */
export function blendRows(a: Row, b: Row, k: number, ends: { canvas: string; fg: string }): Row {
  const t = Math.max(0, Math.min(1, k))
  const from = cellsOf(a)
  const to = cellsOf(b)
  const n = Math.max(from.length, to.length)
  const bgOf = (c: Cell) => c.bg || ends.canvas
  const inkOf = (c: Cell) => (c.ch === ' ' ? bgOf(c) : c.fg || ends.fg)
  const dips = wordsThatChange(from, to, n)
  const out: Run[] = []
  for (let i = 0; i < n; i++) {
    const x = from[i] ?? { ch: ' ' }
    const y = to[i] ?? { ch: ' ' }
    const dip = dips[i] === true
    const bg = x.bg || y.bg ? mix(bgOf(x), bgOf(y), t) : undefined
    const fill = bg ?? ends.canvas
    const cell: Run =
      t === 0
        ? { text: x.ch, fg: x.fg, bg: x.bg, bold: x.bold }
        : t === 1
          ? { text: y.ch, fg: y.fg, bg: y.bg, bold: y.bold }
          : dip
            ? {
                text: t < 0.5 ? x.ch : y.ch,
                fg: t < 0.5 ? mix(inkOf(x), fill, t * 2) : mix(fill, inkOf(y), t * 2 - 1),
                bg,
                bold: t < 0.5 ? x.bold : y.bold,
              }
            : {
                text: x.ch === ' ' ? y.ch : y.ch === ' ' ? x.ch : t < 0.5 ? x.ch : y.ch,
                fg: mix(inkOf(x), inkOf(y), t),
                bg,
                bold: t < 0.5 ? x.bold : y.bold,
              }
    const last = out[out.length - 1]
    if (last && last.fg === cell.fg && last.bg === cell.bg && last.bold === cell.bold)
      last.text += cell.text
    else out.push(cell)
  }
  return out
}

/**
 * For each of `n` cells, whether it is in a word that changes between `from`
 * and `to` (see `blendRows`): a run of two or more cells that hold a glyph in
 * either row, some glyph of which differs, which had glyphs to fade out —
 * or any run, one glyph or more, that goes to nothing.
 */
function wordsThatChange(from: Cell[], to: Cell[], n: number): boolean[] {
  const dips = new Array<boolean>(n).fill(false)
  const ch = (cs: Cell[], i: number) => cs[i]?.ch ?? ' '
  for (let i = 0; i < n; ) {
    if (ch(from, i) === ' ' && ch(to, i) === ' ') {
      i++
      continue
    }
    let end = i
    let changed = false
    let was = false
    let comes = false
    while (end < n && (ch(from, end) !== ' ' || ch(to, end) !== ' ')) {
      if (ch(from, end) !== ch(to, end)) changed = true
      if (ch(from, end) !== ' ') was = true
      if (ch(to, end) !== ' ') comes = true
      end++
    }
    // Going to nothing, it is gone by the midpoint too, not left fading
    // beside the words that came; a lone glyph changing for another swaps.
    if (changed && was && (!comes || end - i >= 2)) dips.fill(true, i, end)
    i = end
  }
  return dips
}

/** Fast start, gentle stop. */
export function easeOut(k: number): number {
  return 1 - (1 - Math.max(0, Math.min(1, k))) ** 3
}

/**
 * Progress from 0 to 1 over `durationMs`, restarted whenever `key` changes.
 * At rest — and always, when not `enabled` — it reads 1, the final frame.
 *
 * The restart is detected during render rather than in an effect, so the
 * very frame that shows the new key already shows the tween at 0: an effect
 * would let one frame of "already finished" slip out first.
 */
export function useTween(
  key: unknown,
  durationMs: number,
  opts: { enabled: boolean; onMount?: boolean },
): number {
  const started = useRef<{ key: unknown; at: number } | null>(null)
  if (started.current === null) {
    started.current = { key, at: opts.onMount ? Date.now() : Number.NEGATIVE_INFINITY }
  } else if (!Object.is(started.current.key, key)) {
    started.current = { key, at: Date.now() }
  }
  const [, redraw] = useState(0)
  const elapsed = Date.now() - started.current.at
  const running = opts.enabled && elapsed < durationMs

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => redraw((n) => n + 1), FRAME_MS)
    return () => clearInterval(id)
  }, [running])

  if (!opts.enabled) return 1
  return Math.max(0, Math.min(1, elapsed / durationMs))
}

/**
 * Milliseconds since `active` last became true, redrawn every `intervalMs`;
 * `undefined` while it is false. Each time it turns on, it starts again at 0.
 * The start is taken during render, as `useTween`'s is, so the first frame
 * already reads 0.
 */
export function useElapsed(active: boolean, intervalMs = FRAME_MS * 2): number | undefined {
  const since = useRef<number | null>(null)
  if (!active) since.current = null
  else if (since.current === null) since.current = Date.now()
  useTicker(active, intervalMs)
  return since.current === null ? undefined : Date.now() - since.current
}

/** A frame count that advances every `intervalMs` while `active`, and holds still otherwise. */
export function useTicker(active: boolean, intervalMs = FRAME_MS * 2): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setN((x) => x + 1), intervalMs)
    return () => clearInterval(id)
  }, [active, intervalMs])
  return n
}

/**
 * `rows`, faded in over `durationMs` from the rows drawn before `key` last
 * changed. What was on screen is captured during render, as `useTween`'s
 * restart is, so the first frame of a change already starts from it; a
 * change mid-fade starts from the frame then showing, not from where the
 * last fade was headed. Not `enabled`, the new rows are drawn at once.
 */
export function useBlendedRows(
  key: unknown,
  rows: Row[],
  durationMs: number,
  opts: { enabled: boolean; canvas: string; fg: string },
): Row[] {
  const last = useRef<{ key: unknown; shown: Row[]; from: Row[] | undefined }>({
    key,
    shown: rows,
    from: undefined,
  })
  if (!Object.is(last.current.key, key)) {
    last.current.from = last.current.shown
    last.current.key = key
  }
  const k = easeOut(useTween(key, durationMs, { enabled: opts.enabled }))
  const from = last.current.from
  const shown =
    k >= 1 || !from ? rows : rows.map((row, i) => blendRows(from[i] ?? [], row, k, opts))
  last.current.shown = shown
  return shown
}
