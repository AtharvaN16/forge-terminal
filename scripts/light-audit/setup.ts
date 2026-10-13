/**
 * Light-mode audit (see README.md): every frame the shell suite renders,
 * drawn in LIGHT instead of DARK, checked cell by cell. Not a test — the
 * suite's own assertions will fail in light; only the findings matter.
 * `AUDIT_THEME=dark` audits dark as drawn, on its own painted canvas.
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { afterAll, afterEach, expect, vi } from 'vitest'
import { ansiHex, type Cell, cells, contrast, dimmed } from './cells.js'

const OUT = process.env.LIGHT_AUDIT_OUT ?? '/tmp/forge-light-audit'
mkdirSync(OUT, { recursive: true })
const DARK_AUDIT = process.env.AUDIT_THEME === 'dark'

vi.mock('../../src/shell/theme.js', async (orig) => {
  const real = await orig<typeof import('../../src/shell/theme.js')>()
  if (process.env.AUDIT_THEME === 'dark') return real
  return { ...real, DARK: real.LIGHT, paletteFor: () => real.LIGHT }
})

const live: Array<{ frames: string[]; lastFrame: () => string | undefined }> = []
vi.mock('ink-testing-library', async (orig) => {
  const real = await orig<typeof import('ink-testing-library')>()
  return {
    ...real,
    render: (...args: Parameters<typeof real.render>) => {
      const r = real.render(...args)
      live.push(r)
      return r
    },
  }
})

const CANVAS = DARK_AUDIT ? '#1e1e1e' : '#ffffff'
const INK = DARK_AUDIT ? '#e7e7e7' : '#262626'
type Finding = {
  kind: 'default-fg' | 'contrast'
  fg: string
  bg: string
  ratio?: number
  glyph: boolean
  bold: boolean
  text: string
  test: string
}
const found = new Map<string, Finding & { count: number }>()
const colours = new Map<string, number>()
const seen = new Set<string>()

const isText = (ch: string) => /[\p{L}\p{N}]/u.test(ch)

function audit(frame: string, test: string) {
  if (seen.has(frame)) return
  seen.add(frame)
  // Dark: only frames the App painted. A component drawn on its own sits on
  // no canvas at all, so the terminal's ink is right there.
  if (DARK_AUDIT && !frame.includes('48;2;30;30;30m')) return
  const cs = cells(frame)
  // Runs of cells sharing a style, so a finding carries readable text.
  let run: Cell[] = []
  const key = (c: Cell) => `${c.fg}|${c.bg}|${c.bold}|${c.dim}|${c.inverse}|${c.line}`
  const flush = () => {
    if (run.length === 0) return
    const c = run[0] as Cell
    const text = run.map((r) => r.ch).join('')
    run = []
    if (text.trim() === '') {
      if (c.bg) colours.set(`bg ${c.bg}`, (colours.get(`bg ${c.bg}`) ?? 0) + 1)
      return
    }
    let fg = c.fg
    let bg = c.bg ?? CANVAS
    if (c.inverse) [fg, bg] = [bg, fg ?? INK]
    const glyph = ![...text].some(isText)
    if (fg === undefined) {
      record({
        kind: 'default-fg',
        fg: '(terminal)',
        bg: ansiHex(bg),
        glyph,
        bold: c.bold,
        text,
        test,
      })
      return
    }
    let shown = ansiHex(fg)
    if (c.dim) shown = dimmed(shown, ansiHex(bg))
    colours.set(`fg ${shown}`, (colours.get(`fg ${shown}`) ?? 0) + 1)
    if (c.bg) colours.set(`bg ${c.bg}`, (colours.get(`bg ${c.bg}`) ?? 0) + 1)
    const ratio = contrast(shown, ansiHex(bg))
    const need = glyph ? 3 : 4.5
    // Pictures (half blocks on their own colours) and the hatching are drawn, not read.
    if (/^[▀▄█\s]+$/.test(text)) return
    if (ratio < need)
      record({
        kind: 'contrast',
        fg: shown,
        bg: ansiHex(bg),
        ratio: Math.round(ratio * 100) / 100,
        glyph,
        bold: c.bold,
        text,
        test,
      })
  }
  for (const c of cs) {
    if (run.length > 0 && key(run[0] as Cell) !== key(c)) flush()
    run.push(c)
  }
  flush()
}

function record(f: Finding) {
  const k = `${f.kind}|${f.fg}|${f.bg}|${f.text.trim()}`
  const had = found.get(k)
  if (had) had.count++
  else found.set(k, { ...f, text: f.text.trim().slice(0, 60), count: 1 })
}

afterEach(() => {
  const test = `${expect.getState().testPath?.split('/tests/')[1]} > ${expect.getState().currentTestName}`
  for (const r of live) {
    for (const f of r.frames) audit(f, test)
    const last = r.lastFrame()
    if (last) audit(last, test)
  }
  live.length = 0
  seen.clear()
})

afterAll(() => {
  const file = `${OUT}/findings-${process.pid}.jsonl`
  for (const f of found.values()) appendFileSync(file, `${JSON.stringify(f)}\n`)
  for (const [k, n] of colours) appendFileSync(`${OUT}/colours-${process.pid}.tsv`, `${k}\t${n}\n`)
  found.clear()
  colours.clear()
})
