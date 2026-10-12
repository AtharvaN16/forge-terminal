/**
 * Cell-level comparison against the decided home screen
 * (tests/shell/fixtures/home-mockup.json, made by
 * scripts/home-mockup-fixture.mjs from the mockup).
 *
 * A cell is its glyph, foreground, background and weight. A blank cell with
 * no background is blank whatever its foreground or weight say, because a
 * terminal draws nothing there either way.
 */
import { readFileSync } from 'node:fs'
import { tabRows } from '../../src/shell/home-art.js'
import { DARK, MODE_KEYS, modePalette, type ShellMode, VERSION } from '../../src/shell/theme.js'

export interface Cell {
  ch: string
  fg: string | null
  bg: string | null
  b: boolean
}

type FixtureRun = [string, string | null, string | null, boolean]
export interface FixtureFrame {
  label: string
  mode: ShellMode
  text: string
  rows: FixtureRun[][]
}

/**
 * A fixture made by scripts/home-mockup-fixture.mjs, by file name.
 *
 * The mockups were drawn at v0.1.0; the band shows whatever version is
 * running, so the drawn version is swapped for it rather than re-drawing every
 * fixture on each release.
 */
export function loadFixture(name: string): unknown {
  const raw = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
  return JSON.parse(raw.replaceAll('v0.1.0', `v${VERSION}`))
}

export const MOCKUP = loadFixture('home-mockup.json') as FixtureFrame[]

function normalise(cell: Cell): Cell {
  if (cell.ch === ' ' && cell.bg === null) return { ch: ' ', fg: null, bg: null, b: false }
  if (cell.ch === ' ') return { ...cell, fg: null, b: false }
  return cell
}

/** A row padded with blank cells to `width`, normalised. */
function pad(cells: Cell[], width: number): Cell[] {
  const out = cells.slice(0, width).map(normalise)
  while (out.length < width) out.push({ ch: ' ', fg: null, bg: null, b: false })
  return out
}

export function fixtureRow(frame: FixtureFrame, row: number, width = 80): Cell[] {
  const cells: Cell[] = []
  for (const [text, fg, bg, b] of frame.rows[row] ?? []) {
    for (const ch of text) cells.push({ ch, fg, bg, b })
  }
  return pad(cells, width)
}

/**
 * A row of a home frame (80 × 24), as the app draws it now. Three things
 * moved on from the frozen mockup:
 * - the row above the keys is a rule in the border colour;
 * - the tab rows (5–6) have more modes than the mockup's three (colour, colour
 *   spec §6.1; enhance, mockups/extensions-2026-10.html), so they are held to
 *   `tabRows` itself;
 * - the key row names every mode digit (`MODE_KEYS`, "1–5").
 */
export function homeRow(frame: FixtureFrame, row: number): Cell[] {
  if (row === 22) return runsRow([{ text: '─'.repeat(80), fg: DARK.border }])
  if (row === 5 || row === 6) {
    const tabs = tabRows({
      width: 80,
      palette: modePalette(DARK, frame.mode),
      mode: frame.mode,
      savesTo: '~/Desktop',
      commands: frame.text.startsWith('/') && !frame.text.includes(' '),
    })
    return runsRow(tabs[row - 5] ?? [])
  }
  const cells = fixtureRow(frame, row)
  if (row === 23) {
    const at = cells
      .map((c) => c.ch)
      .join('')
      .indexOf('1–3 mode')
    const last = cells[at + 2]
    if (at >= 0 && last) cells[at + 2] = { ...last, ch: MODE_KEYS.slice(-1) }
  }
  return cells
}

export interface Run {
  text: string
  fg?: string | undefined
  bg?: string | undefined
  bold?: boolean | undefined
}

export function runsRow(runs: Run[], width = 80): Cell[] {
  const cells: Cell[] = []
  for (const run of runs) {
    for (const ch of run.text) {
      cells.push({ ch, fg: run.fg ?? null, bg: run.bg ?? null, b: run.bold ?? false })
    }
  }
  return pad(cells, width)
}

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`

/**
 * One rendered line of Ink output, as cells. Reads the SGR codes chalk emits
 * at colour level 3 — truecolour foreground and background, bold, and their
 * resets. Inverse (the caret) is ignored: the mockup draws the terminal's
 * own cursor there, which is not a cell attribute.
 */
export function ansiRow(line: string, width = 80): Cell[] {
  const cells: Cell[] = []
  let fg: string | null = null
  let bg: string | null = null
  let b = false
  const ESC = String.fromCharCode(27)
  const re = new RegExp(`${ESC}\\[([0-9;]*)m|${ESC}\\]8;[^\\u0007]*\\u0007|([^${ESC}])`, 'gu')
  for (const m of line.matchAll(re)) {
    if (m[1] !== undefined) {
      const p = m[1] === '' ? [0] : m[1].split(';').map(Number)
      for (let i = 0; i < p.length; i++) {
        const v = p[i]
        if (v === 38 && p[i + 1] === 2) {
          fg = hex(p[i + 2] ?? 0, p[i + 3] ?? 0, p[i + 4] ?? 0)
          i += 4
        } else if (v === 48 && p[i + 1] === 2) {
          bg = hex(p[i + 2] ?? 0, p[i + 3] ?? 0, p[i + 4] ?? 0)
          i += 4
        } else if (v === 39) fg = null
        else if (v === 49) bg = null
        else if (v === 1) b = true
        else if (v === 22) b = false
        else if (v === 0) {
          fg = null
          bg = null
          b = false
        }
      }
    } else if (m[2] !== undefined) {
      cells.push({ ch: m[2], fg, bg, b })
    }
  }
  return pad(cells, width)
}

/** The first differing column, for a readable failure; -1 when equal. */
export function firstDifference(a: Cell[], b: Cell[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return i
  }
  return -1
}

/** Compares two rows and reports where and how they first differ. */
export function describeRow(actual: Cell[], expected: Cell[]): string {
  const at = firstDifference(actual, expected)
  if (at === -1) return 'equal'
  const text = (cells: Cell[]) => cells.map((c) => c.ch).join('')
  return [
    `differ at column ${at}:`,
    `  actual   ${JSON.stringify(actual[at])}`,
    `  expected ${JSON.stringify(expected[at])}`,
    `  actual   |${text(actual)}|`,
    `  expected |${text(expected)}|`,
  ].join('\n')
}

/**
 * A mockup row moved `n` cells left. The kit draws step screens two cells in,
 * under the bar's chip; the app draws them flush left, so a step's rows are
 * held to the mockup's at the same distance from the file card.
 */
export function shifted(cells: Cell[], n = 2, width = 80): Cell[] {
  return pad(cells.slice(n), width)
}
