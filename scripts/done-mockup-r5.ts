/**
 * The Done screen, round eleven (2026-10-19): round ten's eight pictures
 * (mockups/done-2026-10-round4.html), redrawn with care. Round ten stays as
 * it was; this script writes only its own page.
 *
 * What changed from round ten:
 * - the page draws cells the way a terminal does: a fill is one seamless
 *   block, a ╱ cell is a corner-to-corner diagonal so hatching runs on
 *   across cells and rows, and every run is exactly its cells wide;
 * - every picture spans the same block, column 2 to 77, and its edges line
 *   up with the chip's row above and the sizes below;
 * - no words sit on hatching: they sit on a fill, or the hatching is
 *   knocked out round them with a cell to spare;
 * - one blank row between groups, everywhere.
 *
 *   npx tsx scripts/done-mockup-r5.ts   → mockups/done-2026-10-round5.html
 */
import { writeFileSync } from 'node:fs'
import stringWidth from 'string-width'
import { formatBytes } from '../src/core/units.js'
import { trailBarRow } from '../src/shell/bar-art.js'
import { changePhrase, type DoneFacts, doneLayout, receiptBars } from '../src/shell/done-art.js'
import {
  blank,
  HOME_MARGIN as M,
  mix,
  type Row,
  type Run,
  width as rowWidth,
} from '../src/shell/home-art.js'
import { DARK, LIGHT, modeColours, modePalette, type Palette } from '../src/shell/theme.js'
import { middleEllipsis } from '../src/shell/width.js'

const N = 80
const H = 24
const BLOCK = N - 2 * M

/* ------------------------------------------------------------------ cells */

interface Cell {
  ch: string
  fg?: string | undefined
  bg?: string | undefined
  b?: boolean | undefined
}
type Grid = Cell[][]
const run = (text: string, fg?: string, bg?: string, bold = false): Run => ({
  text,
  ...(fg ? { fg } : {}),
  ...(bg ? { bg } : {}),
  ...(bold ? { bold } : {}),
})
const fill = (c: string) => (c === '' ? undefined : c)
const cellsOf = (row: Row): Cell[] =>
  row.flatMap((r: Run) => [...r.text].map((ch) => ({ ch, fg: r.fg, bg: r.bg, b: r.bold })))
const rowOf = (cells: Cell[]): Row => cells.map((c) => run(c.ch, c.fg, c.bg, !!c.b))

const solid = (n: number, bg?: string): Run => run(' '.repeat(Math.max(0, n)), undefined, bg)
const hatch = (p: Palette, n: number): Run => run('╱'.repeat(Math.max(0, n)), p.shedHatch)
/** `left` from the block's left edge, `right` ending on its right edge. */
const spread = (left: Run[], right: Run[] = []): Row => [
  blank(M),
  ...left,
  blank(Math.max(right.length ? 1 : 0, BLOCK - rowWidth(left) - rowWidth(right))),
  ...right,
]
/** `text` written over `cells` from `at`, keeping each cell's fill unless `bg` is given. */
function over(cells: Cell[], at: number, runs: Run[]) {
  let i = at
  for (const r of runs) {
    for (const ch of r.text) {
      const under = cells[i]
      if (under) cells[i] = { ch, fg: r.fg, bg: r.bg ?? under.bg, b: r.bold }
      i++
    }
  }
}
/** A row of `n` cells: what `paint(i)` says each one is. */
const cellsWith = (n: number, paint: (i: number) => Cell): Cell[] =>
  Array.from({ length: n }, (_, i) => paint(i))
const inBlock = (cells: Cell[]): Row => [blank(M), ...rowOf(cells)]

/* ------------------------------------------------------------------ facts */

const KB = 1000
const SHOT: DoneFacts = {
  mode: 'convert',
  before: { format: 'PNG', name: 'Screenshot 2026-10-19 at 9.43.23 PM.png', bytes: 310 * KB },
  after: { format: 'WebP', name: 'Screenshot 2026-10-19 at 9.43.23 PM.webp', bytes: 32.2 * KB },
}
const ratioOf = (f: DoneFacts) => f.after.bytes / f.before.bytes
const keptOf = (f: DoneFacts, cells: number) =>
  receiptBars(f.before.bytes, f.after.bytes, cells).after

/* ----------------------------------------------------------------- pieces */

const tint = (p: Palette) => fill(mix(p.ok, p.canvas, 0.8))

function chipRow(p: Palette, f: DoneFacts): Row {
  const mode = modeColours(p, f.mode)
  const chip = run(` ${f.before.format} → ${f.after.format} `, mode.fg, fill(mode.bg), true)
  const diff = formatBytes(f.before.bytes - f.after.bytes)
  const pill = run(
    ` ${diff} saved · ${changePhrase(f.before.bytes, f.after.bytes)} `,
    p.ok,
    tint(p),
    true,
  )
  return spread([chip], [pill])
}
const nameRuns = (p: Palette, f: DoneFacts, room = BLOCK): Run[] => [
  run('✓ ', p.ok, undefined, true),
  run(middleEllipsis(f.after.name, room - 2), p.fg, undefined, true),
]
const nowBadge = (p: Palette, f: DoneFacts): Run[] => [
  run(' now ', p.dim, fill(p.keycapBg)),
  run(` ${formatBytes(f.after.bytes)} `, p.ok, tint(p), true),
]
const wasBadge = (p: Palette, f: DoneFacts): Run[] => [
  run(' was ', p.border, fill(p.keycapBg)),
  run(` ${formatBytes(f.before.bytes)} `, p.dim, fill(p.panelBand)),
]
const keyHint = (p: Palette, key: string, words: string): Run[] => [
  run(` ${key} `, p.fg, fill(p.keycapBg), true),
  run(` ${words}`, p.dim),
]

/* ----------------------------------------------------------------- screen */

/**
 * Held still in every figure: the header bar, the chip with the saving at
 * its row's end, then the picture; `p` and `→` on the last row above the
 * rule; the key row.
 */
function screen(p: Palette, f: DoneFacts, picture: Row[]): Grid {
  const header = trailBarRow({
    width: N,
    palette: p,
    mode: 'convert',
    trail: { answers: ['WebP', 'Desktop'], current: 'Done' },
    slanted: false,
  })
  const body = [chipRow(p, f), [], ...picture]
  const { top, bottom } = doneLayout({ height: H, body: body.length, notes: 0 })
  const more = keyHint(p, '→', 'continue editing')
  const preset: Row = [blank(M), ...keyHint(p, 'p', 'save as preset')]
  const hint: Row = [...preset, blank(N - 1 - rowWidth(preset) - rowWidth(more)), ...more]
  const keys: Row = [blank(M + 1)]
  for (const [i, [k, w]] of (
    [
      ['↵', 'convert another'],
      ['o', 'open'],
      ['s', 'show in finder'],
    ] as const
  ).entries()) {
    if (i) keys.push(blank(2))
    keys.push(run(` ${k} `, p.fg, fill(p.keycapBg), true), run(` ${w}`, p.dim))
  }
  const quit: Row = [run('ctrl-c', p.fg), run(' quit', p.border)]
  keys.push(blank(N - rowWidth(keys) - rowWidth(quit) - 1), ...quit)
  const rows: Row[] = [
    header,
    [],
    ...Array.from({ length: top }, (): Row => []),
    ...body,
    ...Array.from({ length: Math.max(0, bottom - 1) }, (): Row => []),
    hint,
    [run('─'.repeat(N), p.border)],
    keys,
  ]
  return rows.map((row) => {
    const cells = cellsOf(row).slice(0, N)
    while (cells.length < N) cells.push({ ch: ' ' })
    return cells
  })
}

/* --------------------------------------------------------------- pictures */

interface Look {
  id: string
  name: string
  idea: string
  picture: (p: Palette, f: DoneFacts) => Row[]
}

/** L: the bar as decided so far, the name knocked out of the hatching. */
const L: Look = {
  id: 'L',
  name: 'The bar',
  idea: 'The bar from round three, for comparison: five rows, the grey band the new file, the hatching what it shed; the name on the middle row, knocked out of the hatching with a cell to spare. Now and was under its two ends.',
  picture: (p, f) => {
    const kept = keptOf(f, BLOCK)
    const rows: Row[] = []
    for (let r = 0; r < 5; r++) {
      const cells = cellsWith(BLOCK, (i) =>
        i < kept ? { ch: ' ', bg: fill(p.panelBand) } : { ch: '╱', fg: p.shedHatch },
      )
      if (r === 2) over(cells, 0, [run(' '), ...nameRuns(p, f, BLOCK - 4), run(' ')])
      rows.push(inBlock(cells))
    }
    return [...rows, [], spread(nowBadge(p, f), wasBadge(p, f))]
  },
}

/** M: a bar for each file, its caption above it. */
const Mlook: Look = {
  id: 'M',
  name: 'Two bars, one a file',
  idea: 'Each file is a caption and a bar under it, on one scale: the old file’s bar solid grey, full width; the new file’s grey only as far as it reaches, the rest of the old length hatched. Name on the left of each caption, size on the right, both edges the bars’ edges.',
  picture: (p, f) => {
    const kept = keptOf(f, BLOCK)
    const was = [solid(BLOCK, fill(p.panelBand))]
    const now = [solid(kept, fill(p.panelBand)), hatch(p, BLOCK - kept)]
    return [
      spread(
        [run(' was ', p.border, fill(p.keycapBg)), blank(2), run(f.before.name, p.dim)],
        [run(formatBytes(f.before.bytes), p.dim)],
      ),
      [blank(M), ...was],
      [blank(M), ...was],
      [],
      spread(
        [run(' now ', p.dim, fill(p.keycapBg)), blank(2), ...nameRuns(p, f, 50)],
        [run(formatBytes(f.after.bytes), p.ok, undefined, true)],
      ),
      [blank(M), ...now],
      [blank(M), ...now],
    ]
  },
}

/** N: standing columns, each size at the end of a rule from its column's top. */
const Nlook: Look = {
  id: 'N',
  name: 'Two standing columns',
  idea: 'Round five’s S5, made a chart: two columns on one floor, the old one hatched above the grey it kept, the new one only that grey. A thin rule runs from the top of each column to its size at the block’s right edge.',
  picture: (p, f) => {
    const R = 8
    const colW = 14
    const gap = 2
    const bars = receiptBars(f.before.bytes, f.after.bytes, R)
    const keptRows = Math.min(bars.before, bars.after)
    const rule = mix(p.border, p.canvas, 0.6)
    const leader = (from: number, badge: Run[]): Run[] => {
      const n = BLOCK - from - rowWidth(badge) - 1
      return [blank(1), run('─'.repeat(Math.max(0, n - 1)), rule), blank(1), ...badge]
    }
    const rows: Row[] = [[blank(M), ...nameRuns(p, f)], []]
    for (let r = 0; r < R; r++) {
      const floor = R - r
      const oldCol =
        floor > bars.before
          ? solid(colW)
          : floor > keptRows
            ? hatch(p, colW)
            : solid(colW, fill(p.panelBand))
      const newCol = floor <= bars.after ? solid(colW, fill(p.panelBand)) : solid(colW)
      const row: Run[] = [blank(M), oldCol]
      if (r === 0) row.push(...leader(colW, wasBadge(p, f)))
      else {
        row.push(blank(gap), newCol)
        if (r === R - bars.after) row.push(...leader(2 * colW + gap, nowBadge(p, f)))
      }
      rows.push(row)
    }
    return rows
  },
}

/** O: a hundred dots, the kept ones lit, filling from the left as the band does. */
const O: Look = {
  id: 'O',
  name: 'A hundred dots',
  idea: 'Four rows of twenty-five, across the whole block: a dot for each hundredth of the old file. The ones kept are lit and fill from the left, as the band does; the shed ones are the hatching’s green. Now and was under the ends.',
  picture: (p, f) => {
    const lit = Math.max(1, Math.round(ratioOf(f) * 100))
    const rows: Row[] = [[blank(M), ...nameRuns(p, f)], []]
    for (let r = 0; r < 4; r++) {
      const cells = cellsWith(BLOCK, () => ({ ch: ' ' }))
      for (let col = 0; col < 25; col++) {
        const on = col * 4 + r < lit
        const at = col * 3 + 1
        const cell = cells[at]
        if (cell) Object.assign(cell, { ch: '●', fg: on ? p.ok : p.shedHatch })
      }
      rows.push(inBlock(cells))
    }
    return [...rows, [], spread(nowBadge(p, f), wasBadge(p, f))]
  },
}

/** P: the quality screen's band, three rows tall, its thumb the new size. */
const P: Look = {
  id: 'P',
  name: 'The quality band, tall',
  idea: 'The quality screen’s own slider, three rows tall: the old file is the whole band, the new size is the white thumb, standing where it falls. “now” sits quietly under the thumb, the old size under the band’s end.',
  picture: (p, f) => {
    const label = ` ${formatBytes(f.after.bytes)} `
    const w = stringWidth(label)
    const k = Math.round(ratioOf(f) * (BLOCK - w))
    const rows: Row[] = [[blank(M), ...nameRuns(p, f)], []]
    for (let r = 0; r < 3; r++) {
      rows.push([
        blank(M),
        solid(k, fill(p.trackFill)),
        r === 1 ? run(label, p.ink, fill(p.thumb), true) : solid(w, fill(p.thumb)),
        solid(BLOCK - k - w, fill(p.track)),
      ])
    }
    const at = k + Math.floor((w - 3) / 2)
    const end: Run[] = [run('was ', p.border), run(formatBytes(f.before.bytes), p.dim)]
    rows.push(
      [],
      [blank(M + at), run('now', p.border), blank(BLOCK - at - 3 - rowWidth(end)), ...end],
    )
    return rows
  },
}

/** Q: a box inside a box: area, not length. */
const Q: Look = {
  id: 'Q',
  name: 'One box inside the other',
  idea: 'Area, not length: the old file is the hatched box, the new file a grey box in its corner, the same shape and a tenth of the area, a cell of space round it. Each size sits inside the box it names.',
  picture: (p, f) => {
    const R = 8
    const s = Math.sqrt(ratioOf(f))
    const iw = Math.max(16, Math.round(BLOCK * s))
    const ih = Math.max(1, Math.round(R * s))
    const rows: Row[] = [[blank(M), ...nameRuns(p, f)], []]
    for (let r = 0; r < R; r++) {
      const cells = cellsWith(BLOCK, (i) => {
        if (r < ih && i < iw) return { ch: ' ', bg: fill(p.panelBand) }
        if ((r < ih && i === iw) || (r === ih && i <= iw)) return { ch: ' ' }
        return { ch: '╱', fg: p.shedHatch }
      })
      if (r === Math.floor(ih / 2)) {
        over(cells, 2, [run('now ', p.dim), run(formatBytes(f.after.bytes), p.ok, undefined, true)])
      }
      if (r === R - 1) {
        const was: Run[] = [
          run(' was ', p.border, p.canvas),
          run(`${formatBytes(f.before.bytes)} `, p.dim, p.canvas),
        ]
        over(cells, BLOCK - rowWidth(was), was)
      }
      rows.push(inBlock(cells))
    }
    return rows
  },
}

/** R: was, now, saved: three bars on one scale. */
const R: Look = {
  id: 'R',
  name: 'A waterfall',
  idea: 'Three bars on one scale, three rows each, their words to the left: was, the old file in full; now, the grey it kept; saved, the hatched rest, starting where now ends.',
  picture: (p, f) => {
    const label = 16
    const barW = BLOCK - label
    const kept = keptOf(f, barW)
    const group = (word: string, size: Run, bar: Run[]): Row[] => {
      const words: Run[] = [run(word, p.border)]
      const lead: Run[] = [
        ...words,
        blank(label - 2 - rowWidth(words) - rowWidth([size])),
        size,
        blank(2),
      ]
      return [
        [blank(M + label), ...bar],
        [blank(M), ...lead, ...bar],
        [blank(M + label), ...bar],
      ]
    }
    return [
      [blank(M), ...nameRuns(p, f)],
      [],
      ...group('was', run(formatBytes(f.before.bytes), p.dim), [solid(barW, fill(p.panelBand))]),
      [],
      ...group('now', run(formatBytes(f.after.bytes), p.ok, undefined, true), [
        solid(kept, fill(p.panelBand)),
      ]),
      [],
      ...group('saved', run(formatBytes(f.before.bytes - f.after.bytes), p.ok, undefined, true), [
        blank(kept),
        hatch(p, barW - kept),
      ]),
    ]
  },
}

/** S: was, an arrow, now. */
const S: Look = {
  id: 'S',
  name: 'Was, an arrow, now',
  idea: 'The one that is not to scale: the old size in a grey panel, the new one in a green panel, three rows each, the hatching between them carrying an arrow, left to right in time.',
  picture: (p, f) => {
    const pw = 18
    const mid = BLOCK - 2 * pw
    const panel = (r: number, word: string, size: string, fg: string, bg?: string): Run => {
      if (r !== 1) return solid(pw, bg)
      const t = `${word}  ${size}`
      const l = Math.floor((pw - t.length) / 2)
      return run(`${' '.repeat(l)}${t}${' '.repeat(pw - l - t.length)}`, fg, bg, true)
    }
    const rows: Row[] = [[blank(M), ...nameRuns(p, f)], []]
    for (let r = 0; r < 3; r++) {
      const shaft: Run[] =
        r === 1
          ? [
              hatch(p, (mid - 5) >> 1),
              run('  →  ', p.fg, undefined, true),
              hatch(p, mid - 5 - ((mid - 5) >> 1)),
            ]
          : [hatch(p, mid)]
      rows.push([
        blank(M),
        panel(r, 'was', formatBytes(f.before.bytes), p.dim, fill(p.panelBand)),
        ...shaft,
        panel(r, 'now', formatBytes(f.after.bytes), p.ok, tint(p)),
      ])
    }
    return rows
  },
}

const LOOKS = [L, Mlook, Nlook, O, P, Q, R, S]

/* ------------------------------------------------------------------- html */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
/**
 * A row as a terminal draws it: runs of one style as one block exactly
 * their cells wide, so fills have no seams; ╱ as a corner-to-corner line,
 * so hatching runs on across cells and rows; ● as a drawn dot.
 */
function html(rows: Grid, base: Palette): string {
  const kind = (c: Cell) => (c.ch === '╱' ? 'h' : c.ch === '●' ? 'd' : 't')
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
        const layers: string[] = []
        if (k === 'h')
          layers.push(
            `linear-gradient(to bottom right, transparent calc(50% - .7px), ${fg} calc(50% - .7px), ${fg} calc(50% + .7px), transparent calc(50% + .7px)) 0 0 / 1ch 100%`,
          )
        if (k === 'd')
          layers.push(`radial-gradient(circle, ${fg} 3.2px, transparent 3.9px) 0 0 / 1ch 100%`)
        if (layers.length)
          st.push(`background:${layers.join(',')}${first.bg ? ` ${first.bg}` : ''}`)
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
const term = (base: Palette, rows: Grid) =>
  `<div class="t" style="background:${base.canvas || (base === LIGHT ? '#ffffff' : '#1e1e1e')}">${html(rows, base)}</div>`

const figures = LOOKS.map((l) => {
  const p = modePalette(DARK, 'convert')
  return `<figure><div class="vt"><span class="id">${l.id}</span><span class="name">${l.name}</span></div>
<p class="idea">${esc(l.idea)}</p>${term(p, screen(p, SHOT, l.picture(p, SHOT)))}</figure>`
}).join('')

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · Done, eight ways, redrawn</title>
<style>
  body { margin:0; background:#0d0e11; color:#e2e4ea; font:16px/1.6 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  main { max-width:1900px; margin:0 auto; padding:44px 24px 120px; }
  h1 { font-size:30px; margin:0 0 8px; } h2 { font-size:21px; margin:56px 0 4px; }
  .lede { color:#8f94a1; max-width:1000px; margin:0; }
  .box { border:1px solid #2c2f37; border-radius:10px; padding:14px 18px; margin:22px 0 0; max-width:1000px; background:#14161b; }
  .box h3 { margin:0 0 6px; font-size:14px; letter-spacing:.06em; text-transform:uppercase; color:#8f94a1; }
  .box ol { margin:6px 0 0 20px; padding:0; } .box li { margin:4px 0; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(700px, 1fr)); gap:0 32px; }
  figure { margin:40px 0 0; }
  .vt { display:flex; align-items:baseline; gap:10px; margin-bottom:6px; }
  .vt .id { font:700 12px "SF Mono", ui-monospace, Menlo, monospace; padding:3px 7px; border-radius:6px; background:#12282e; color:#55c7d9; }
  .vt .name { font-weight:620; }
  .idea { font-size:14.5px; color:#c7cbd4; margin:6px 0 14px; max-width:700px; min-height:3.2em; }
  .t { font:13px/1 "SF Mono", ui-monospace, Menlo, monospace; font-variant-ligatures:none; padding:14px 16px; border-radius:10px; border:1px solid #2c2f37; width:max-content; }
  .r { height:17px; white-space:pre; display:flex; }
  .r > span { display:block; flex:none; height:17px; line-height:17px; overflow:hidden; }
  code { font:13px "SF Mono", ui-monospace, Menlo, monospace; color:#c7cbd4; }
</style></head><body><main>
<h1>Done, eight ways, redrawn</h1>
<p class="lede">Round ten’s eight pictures, the same ideas drawn with care, dark, 80 × 24. Round ten’s page is kept as it was (<code>done-2026-10-round4.html</code>). Held still in every figure: the header, the chip with the saving at its row’s end, <code>p</code> and <code>→</code> on the bottom row, the key row.</p>

<div class="box"><h3>What changed in the drawing</h3><ol>
<li>The page draws cells as a terminal does: a fill is one block with no seams, and each ╱ runs corner to corner, so the hatching is unbroken diagonal lines, as in your screenshot.</li>
<li>Every picture spans the same block as the chip’s row above it, edge to edge; captions and sizes end on the same columns.</li>
<li>No words sit on the hatching: they are on a fill, or the hatching is cut back round them with a cell to spare.</li></ol></div>

<div class="box"><h3>Open question</h3><ol>
<li><b>Which are worth taking further?</b> Any of L to S. I will bring the ones you keep through a file that grew, a short name and light mode.</li></ol></div>

<h2>OPTIONS: the picture</h2>
<div class="grid">${figures}</div>
</main></body></html>`

writeFileSync('mockups/done-2026-10-round5.html', page)
console.log('wrote mockups/done-2026-10-round5.html')
