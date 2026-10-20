/**
 * Terminal cells for mockup pages, drawn as a terminal draws them (see
 * memory: mockup fidelity, 2026-10-19): a run of one style is one block
 * exactly its cells wide, so fills have no seams; ╱ is a corner-to-corner
 * line, so hatching runs on unbroken across cells and rows; ● is a drawn
 * dot; ▀ and ▄ fill exactly the cell's top or bottom half. Rows are the app's own `Row`s, so the art functions draw straight in.
 */
import type { Row, Run } from '../src/shell/home-art.js'
import type { Palette } from '../src/shell/theme.js'

export interface Cell {
  ch: string
  fg?: string | undefined
  bg?: string | undefined
  b?: boolean | undefined
}
export type Grid = Cell[][]

export const run = (text: string, fg?: string, bg?: string, bold = false): Run => ({
  text,
  ...(fg ? { fg } : {}),
  ...(bg ? { bg } : {}),
  ...(bold ? { bold } : {}),
})
/** A palette colour as a fill: none where the palette has none. */
export const fill = (c: string) => (c === '' ? undefined : c)
export const cellsOf = (row: Row): Cell[] =>
  row.flatMap((r: Run) => [...r.text].map((ch) => ({ ch, fg: r.fg, bg: r.bg, b: r.bold })))
export const rowOf = (cells: Cell[]): Row => cells.map((c) => run(c.ch, c.fg, c.bg, !!c.b))
export const solid = (n: number, bg?: string): Run => run(' '.repeat(Math.max(0, n)), undefined, bg)
export const hatch = (p: Palette, n: number): Run => run('╱'.repeat(Math.max(0, n)), p.shedHatch)

/** `runs` written over `cells` from `at`, each cell keeping its fill unless the run has one. */
export function over(cells: Cell[], at: number, runs: Run[]): void {
  let i = at
  for (const r of runs) {
    for (const ch of r.text) {
      const under = cells[i]
      if (under) cells[i] = { ch, fg: r.fg, bg: r.bg ?? under.bg, b: r.bold }
      i++
    }
  }
}

/** Rows to a grid `width` cells wide, cut or padded. */
export const toGrid = (rows: Row[], width: number): Grid =>
  rows.map((row) => {
    const cells = cellsOf(row).slice(0, width)
    while (cells.length < width) cells.push({ ch: ' ' })
    return cells
  })

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

/** The grid as HTML rows; pair with `TERM_CSS`. */
export function gridHtml(rows: Grid, base: Palette): string {
  const kind = (c: Cell) =>
    c.ch === '╱' ? 'h' : c.ch === '●' ? 'd' : c.ch === '▀' ? 'u' : c.ch === '▄' ? 'l' : 't'
  const key = (c: Cell) => `${kind(c)}|${c.fg ?? ''}|${c.bg ?? ''}|${c.b ? 1 : 0}`
  return rows
    .map((cells) => {
      let out = ''
      let i = 0
      while (i < cells.length) {
        const first = cells[i] as Cell
        let j = i
        while (j < cells.length && key(cells[j] as Cell) === key(first)) j++
        const n = j - i
        const fg = first.fg || base.fg
        const st = [`width:${n}ch`, `color:${fg}`]
        if (first.b) st.push('font-weight:700')
        const k = kind(first)
        const layer =
          k === 'h'
            ? `linear-gradient(to bottom right, transparent calc(50% - .7px), ${fg} calc(50% - .7px), ${fg} calc(50% + .7px), transparent calc(50% + .7px)) 0 0 / 1ch 100%`
            : k === 'd'
              ? `radial-gradient(circle, ${fg} 3.2px, transparent 3.9px) 0 0 / 1ch 100%`
              : // Half blocks: exactly the cell's top or bottom half, as a terminal draws them.
                k === 'u'
                ? `linear-gradient(to bottom, ${fg} 50%, transparent 50%)`
                : k === 'l'
                  ? `linear-gradient(to top, ${fg} 50%, transparent 50%)`
                  : ''
        if (layer) st.push(`background:${layer}${first.bg ? ` ${first.bg}` : ''}`)
        else if (first.bg) st.push(`background:${first.bg}`)
        const text =
          k === 't'
            ? cells
                .slice(i, j)
                .map((c) => c.ch)
                .join('')
            : ' '.repeat(n)
        out += `<span style="${st.join(';')}">${esc(text)}</span>`
        i = j
      }
      return `<div class="r">${out}</div>`
    })
    .join('')
}

/** A terminal window around `rows`, on the palette's canvas. */
export const termHtml = (base: Palette, rows: Grid, fallback = '#1e1e1e') =>
  `<div class="t" style="background:${base.canvas || fallback}">${gridHtml(rows, base)}</div>`

export const TERM_CSS = `
  .t { font:13px/1 "SF Mono", ui-monospace, Menlo, monospace; font-variant-ligatures:none; padding:14px 16px; border-radius:10px; border:1px solid #2c2f37; width:max-content; }
  .r { height:17px; white-space:pre; display:flex; }
  .r > span { display:block; flex:none; height:17px; line-height:17px; overflow:hidden; }`
