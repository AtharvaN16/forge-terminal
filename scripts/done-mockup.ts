/**
 * The Done screen, round seven (2026-10-19): the B6a bar, kept, with small
 * steps on it. Nothing here is a new concept. What today's screen does,
 * from the user's screenshot of a PNG → WebP convert in the Convert flow:
 *
 * - `p save as preset` sits on the chip's row and `→ continue editing` on
 *   the last row above the rule: both far from the result and from each
 *   other, and the rows between them are empty;
 * - the file's name and the change both sit inside the hatching, so the
 *   words read over a pattern, and the name spills out of a small band;
 * - "now" is on the left and "was" on the right, but nothing says which end
 *   of the bar each belongs to.
 *
 * The header bar, the formats' chip, the bar's cells' colours and the
 * layout rows are the app's own (`done-art.ts`); the variants rearrange the
 * same pieces. No new words: every string here is already in the app.
 * Full 80 × 24, dark and light.
 *
 *   npx tsx scripts/done-mockup.ts   → mockups/done-2026-10.html
 */
import { writeFileSync } from 'node:fs'
import stringWidth from 'string-width'
import { formatBytes } from '../src/core/units.js'
import { trailBarRow } from '../src/shell/bar-art.js'
import {
  changePhrase,
  type DoneFacts,
  doneBody,
  doneLayout,
  receiptBars,
} from '../src/shell/done-art.js'
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

interface Cell {
  ch: string
  fg?: string | undefined
  bg?: string | undefined
  b?: boolean | undefined
}
type Grid = Cell[][]
const cellsOf = (row: Row): Cell[] =>
  row.flatMap((r: Run) => [...r.text].map((ch) => ({ ch, fg: r.fg, bg: r.bg, b: r.bold })))
const run = (text: string, fg?: string, bg?: string, bold = false): Run => ({
  text,
  ...(fg ? { fg } : {}),
  ...(bg ? { bg } : {}),
  ...(bold ? { bold } : {}),
})
const fill = (c: string) => (c === '' ? undefined : c)

/* ------------------------------------------------------------------ cases */

interface Case {
  /** The source's and the result's formats, names and sizes. */
  facts: DoneFacts
  /** Whether Convert's Done carries a preset's keys (the screenshot's does). */
  preset: boolean
  caption: string
}
const KB = 1000
const SHOT: Case = {
  facts: {
    mode: 'convert',
    before: { format: 'PNG', name: 'Screenshot 2026-10-19 at 9.43.23 PM.png', bytes: 310 * KB },
    after: { format: 'WebP', name: 'Screenshot 2026-10-19 at 9.43.23 PM.webp', bytes: 32.2 * KB },
  },
  preset: true,
  caption: 'the screenshot: 310 KB → 32.2 KB',
}
const HALF: Case = {
  facts: {
    mode: 'convert',
    before: { format: 'JPEG', name: 'IMG_4821.jpg', bytes: 2.4 * KB * KB },
    after: { format: 'AVIF', name: 'IMG_4821.avif', bytes: 1.3 * KB * KB },
  },
  preset: true,
  caption: 'about half: 2.4 MB → 1.3 MB, a short name',
}
const GREW: Case = {
  facts: {
    mode: 'convert',
    before: { format: 'JPEG', name: 'poster.jpg', bytes: 120 * KB },
    after: { format: 'PNG', name: 'poster.png', bytes: 540 * KB },
  },
  preset: true,
  caption: 'it grew: 120 KB → 540 KB',
}
const PLAIN: Case = { ...SHOT, preset: false, caption: 'no preset keys: a plain convert' }

/* ----------------------------------------------------------------- pieces */

const formatsOf = (f: DoneFacts) =>
  f.before.format === f.after.format ? f.before.format : `${f.before.format} → ${f.after.format}`

function chipRow(p: Palette, f: DoneFacts): Row {
  const mode = modeColours(p, f.mode)
  return [blank(M), run(` ${formatsOf(f)} `, mode.fg, fill(mode.bg), true)]
}

/** A key as the body draws it: the cap on the key grey, the words dim. */
const keyHint = (p: Palette, key: string, words: string): Run[] => [
  run(` ${key} `, p.fg, fill(p.keycapBg), true),
  run(` ${words}`, p.dim),
]

/** The bar's cells (done-art's own): the band, then the hatching or the growth. */
function barCells(p: Palette, f: DoneFacts): Cell[] {
  const bars = receiptBars(f.before.bytes, f.after.bytes, BLOCK)
  const shared = Math.min(bars.before, bars.after)
  return Array.from({ length: BLOCK }, (_, i): Cell => {
    if (i < shared) return { ch: ' ', bg: fill(p.panelBand) }
    if (!bars.grew) return { ch: '╱', fg: p.shedHatch }
    return p.grownFill ? { ch: ' ', bg: p.grownFill } : { ch: '▒', fg: p.larger }
  })
}
const barRows = (p: Palette, f: DoneFacts, rows = 3): Row[] =>
  Array.from(
    { length: rows },
    (): Row => [blank(M), ...barCells(p, f).map((c) => run(c.ch, c.fg, c.bg))],
  )

/** The change's words: "278 KB saved · 89.6% smaller", "+420 KB · 350% larger". */
function changeText(f: DoneFacts): string {
  const { before, after } = f
  if (before.bytes === after.bytes) return changePhrase(before.bytes, after.bytes)
  const diff = formatBytes(Math.abs(after.bytes - before.bytes))
  const phrase = changePhrase(before.bytes, after.bytes)
  return after.bytes > before.bytes ? `+${diff} · ${phrase}` : `${diff} saved · ${phrase}`
}
const inkOf = (p: Palette, f: DoneFacts) =>
  f.before.bytes === f.after.bytes ? p.fg : f.after.bytes > f.before.bytes ? p.larger : p.ok
const tintOf = (p: Palette, f: DoneFacts) =>
  p.canvas && f.before.bytes !== f.after.bytes
    ? fill(mix(inkOf(p, f), p.canvas, 0.8))
    : fill(p.panelBand)

/** now / was, as the app draws them: the smaller on the left. */
function badges(p: Palette, f: DoneFacts): { left: Run[]; right: Run[] } {
  const ink = inkOf(p, f)
  const now: Run[] = [
    run(' now ', p.dim, fill(p.keycapBg)),
    run(` ${formatBytes(f.after.bytes)} `, ink, tintOf(p, f), true),
  ]
  const was: Run[] = [
    run(' was ', p.border, fill(p.keycapBg)),
    run(` ${formatBytes(f.before.bytes)} `, p.dim, fill(p.panelBand)),
  ]
  return f.after.bytes > f.before.bytes ? { left: was, right: now } : { left: now, right: was }
}
function sizesRow(p: Palette, f: DoneFacts): Row {
  const { left, right } = badges(p, f)
  return [blank(M), ...left, blank(Math.max(1, BLOCK - rowWidth(left) - rowWidth(right))), ...right]
}

/** The name row: ✓ and the new file's name, bold; `after` runs are flush to the bar's end. */
function nameRow(p: Palette, f: DoneFacts, after: Run[] = []): Row {
  const room = BLOCK - 1 - (after.length ? rowWidth(after) + 2 : 0) - 2
  const name = middleEllipsis(f.after.name, Math.max(8, room))
  const left: Run[] = [run('✓ ', p.ok, undefined, true), run(name, p.fg, undefined, true)]
  const gap = Math.max(1, BLOCK - 1 - rowWidth(left) - rowWidth(after))
  return [blank(M + 1), ...left, ...(after.length ? [blank(gap), ...after] : [])]
}

/** The change as a pill on a tint of what happened, ending at the bar's end. */
function changePill(p: Palette, f: DoneFacts): Run[] {
  const same = f.before.bytes === f.after.bytes
  return [
    run(` ${changeText(f)} `, same ? p.dim : inkOf(p, f), same ? undefined : tintOf(p, f), !same),
  ]
}

/** `p save as preset` and `→ continue editing`, side by side. */
const actionsRow = (p: Palette): Row => [
  blank(M),
  ...keyHint(p, 'p', 'save as preset'),
  blank(3),
  ...keyHint(p, '→', 'continue editing'),
]

/* ----------------------------------------------------------------- screen */

function keyRow(p: Palette, c: Case): Row {
  const keys: [string, string][] = [
    ['↵', 'convert another'],
    ['o', 'open'],
    ['s', 'show in finder'],
  ]
  const left: Row = [blank(M + 1)]
  keys.forEach(([k, w], i) => {
    if (i) left.push(blank(2))
    left.push(run(` ${k} `, p.fg, fill(p.keycapBg), true), run(` ${w}`, p.dim))
  })
  void c
  const note: Row = [run('ctrl-c', p.fg), run(' quit', p.border)]
  return [...left, blank(N - rowWidth(left) - rowWidth(note) - 1), ...note, blank(1)]
}

/**
 * The whole screen: the header bar, a blank row, the body placed as the app
 * places it (`doneLayout`), the rule and the keys. `hint` is today's last
 * row above the rule.
 */
function screen(p: Palette, c: Case, body: Row[], hint?: Row, head?: Row): Grid {
  const bar = trailBarRow({
    width: N,
    palette: p,
    mode: 'convert',
    trail: { answers: ['WebP', 'Desktop'], current: 'Done' },
    slanted: false,
  })
  // A head row (the keys, round eight) takes two rows under the bar: it and a blank.
  const room = head ? H - 2 : H
  const { top, bottom } = doneLayout({ height: room, body: body.length, notes: 0 })
  const rows: Row[] = [
    bar,
    [],
    ...(head ? [head, []] : []),
    ...Array.from({ length: top }, (): Row => []),
    ...body,
  ]
  if (hint) {
    rows.push(...Array.from({ length: Math.max(0, bottom - 1) }, (): Row => []), hint)
  } else rows.push(...Array.from({ length: bottom }, (): Row => []))
  rows.push([run('─'.repeat(N), p.border)], keyRow(p, c))
  return rows.map((row) => {
    const cells = cellsOf(row)
    while (cells.length < N) cells.push({ ch: ' ' })
    return cells
  })
}

/* --------------------------------------------------------------- variants */

type Draw = (p: Palette, c: Case) => Grid

/** A: as built. */
const asBuilt: Draw = (p, c) => {
  const body = doneBody({ palette: p, facts: c.facts, width: N })
  if (c.preset) {
    body[0] = [...(body[0] ?? []), blank(1), ...keyHint(p, 'p', 'save as preset')]
  }
  return screen(
    p,
    c,
    body,
    c.preset
      ? (() => {
          const hint = keyHint(p, '→', 'continue editing')
          return [blank(Math.max(0, N - 1 - rowWidth(hint))), ...hint]
        })()
      : undefined,
  )
}

/** B: today's body, the two preset keys gathered under it. */
const gathered: Draw = (p, c) => {
  const body = doneBody({ palette: p, facts: c.facts, width: N })
  if (c.preset) body.push([], actionsRow(p))
  return screen(p, c, body)
}

/** C: the name and the change above a bar that is only the picture. */
const clearBar =
  (rows: number): Draw =>
  (p, c) => {
    const body: Row[] = [
      chipRow(p, c.facts),
      nameRow(p, c.facts, changePill(p, c.facts)),
      ...barRows(p, c.facts, rows),
      [],
      sizesRow(p, c.facts),
    ]
    if (c.preset) body.push([], actionsRow(p))
    return screen(p, c, body)
  }

/** D: the name above the bar; the change and both sizes on one line under it. */
const oneAxis: Draw = (p, c) => {
  const f = c.facts
  const same = f.before.bytes === f.after.bytes
  const { left, right } = badges(p, f)
  const words = changeText(f)
  const room = BLOCK - rowWidth(left) - rowWidth(right)
  const centre = Math.max(1, Math.floor((room - stringWidth(words)) / 2))
  const line: Row = [
    blank(M),
    ...left,
    blank(centre),
    run(words, same ? p.dim : inkOf(p, f), undefined, !same),
    blank(Math.max(1, room - centre - stringWidth(words))),
    ...right,
  ]
  const body: Row[] = [chipRow(p, f), nameRow(p, f), ...barRows(p, f, 3), [], line]
  if (c.preset) body.push([], actionsRow(p))
  return screen(p, c, body)
}

/* ------------------------------------------------------------------- page */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
function html(rows: Grid, palette: Palette): string {
  return rows
    .map((cells) => {
      let out = ''
      for (const c of cells) {
        const st = [
          `color:${c.fg || palette.fg}`,
          c.bg ? `background:${c.bg}` : '',
          c.b ? 'font-weight:700' : '',
        ]
          .filter(Boolean)
          .join(';')
        out += `<span style="${st}">${esc(c.ch)}</span>`
      }
      return `<div class="r">${out}</div>`
    })
    .join('')
}
const term = (base: Palette, rows: Grid) =>
  `<div class="t" style="background:${base === LIGHT ? '#ffffff' : '#1e1e1e'}">${html(rows, base)}</div>`

const pair = (draw: Draw, c: Case) =>
  `<div class="row">${[DARK, LIGHT]
    .map(
      (base) =>
        `<div class="col">${term(base, draw(modePalette(base, 'convert'), c))}<div class="cap">${esc(c.caption)} · ${base === DARK ? 'dark' : 'light'}</div></div>`,
    )
    .join('')}</div>`

const figure = (id: string, name: string, idea: string, body: string, pick = false) =>
  `<figure><div class="vt"><span class="id">${id}</span><span class="name">${name.replace(/`/g, '')}</span>${pick ? '<span class="pick">RECOMMENDED</span>' : ''}</div>
<p class="idea">${esc(idea.replace(/`/g, ''))}</p>${body}</figure>`

const VARIANTS: { id: string; name: string; idea: string; draw: Draw; pick?: boolean }[] = [
  {
    id: 'A',
    name: 'As built',
    idea: 'The screen in your screenshot, drawn from the app’s own art.',
    draw: asBuilt,
  },
  {
    id: 'B',
    name: 'The two keys under the result',
    idea: 'Only the keys move: `p save as preset` and `→ continue editing` leave the chip’s row and the bottom corner, and sit together one row under the sizes. The body becomes one block, and the bottom of the screen is only the key row. The bar, the badges and the chip are as built.',
    draw: gathered,
  },
  {
    id: 'C',
    name: 'B, and the words out of the hatching',
    idea: 'The name goes on its own row above the bar, whole, and the change sits at that row’s end as a pill on a tint of what happened (green for smaller, orange for larger), the way the new size is tinted. The bar underneath is then only the picture: the band, the hatching.',
    draw: clearBar(3),
    pick: true,
  },
  {
    id: 'D',
    name: 'B, the change between the two sizes',
    idea: 'The name above the bar, as in C. The change is not a pill: it sits on the sizes’ line, between the two badges, so one line reads “now 32.2 KB … 278 KB saved · 89.6% smaller … was 310 KB”, left to right across the bar it describes.',
    draw: oneAxis,
  },
  {
    id: 'E',
    name: 'C with a taller bar',
    idea: 'C with the bar five rows tall instead of three, for the result to have more weight on a tall window. Same words, same pieces.',
    draw: clearBar(5),
  },
]

const figures = VARIANTS.map((v) => figure(v.id, v.name, v.idea, pair(v.draw, SHOT), v.pick)).join(
  '',
)

const cases = [HALF, GREW, PLAIN]
  .map((c) => `<div class="sub">${esc(c.caption)}</div>${pair(clearBar(3), c)}`)
  .join('')

/* ============================================================ round eight */

/** The bar's rows with the new file's name written over the middle one, as done-art does. */
function nameInBar(p: Palette, f: DoneFacts, rows: number): Row[] {
  const out: Row[] = []
  for (let r = 0; r < rows; r++) {
    const cells = barCells(p, f)
    if (r === Math.floor(rows / 2)) {
      const name = middleEllipsis(f.after.name, BLOCK - 5)
      let i = 0
      for (const run of [
        { ch: ' ' },
        { ch: '✓', fg: p.ok },
        { ch: ' ' },
        ...[...name].map((ch) => ({ ch, fg: p.fg })),
        { ch: ' ' },
      ]) {
        const under = cells[i]
        if (under) cells[i] = { ...run, bg: under.bg, b: run.ch !== ' ' }
        i++
      }
    }
    out.push([blank(M), ...cells.map((c) => ({ ...run(c.ch, c.fg, c.bg, c.b) }))])
  }
  return out
}

/** The change on the sizes' line, between the badges. */
function sizesWithChange(p: Palette, f: DoneFacts): Row {
  const same = f.before.bytes === f.after.bytes
  const { left, right } = badges(p, f)
  const words = changeText(f)
  const room = BLOCK - rowWidth(left) - rowWidth(right)
  const centre = Math.max(1, Math.floor((room - stringWidth(words)) / 2))
  return [
    blank(M),
    ...left,
    blank(centre),
    run(words, same ? p.dim : inkOf(p, f), undefined, !same),
    blank(Math.max(1, room - centre - stringWidth(words))),
    ...right,
  ]
}

/**
 * F / G: the name stays in the bar, the change is out of it, the two keys
 * are the first row under the header bar. `where` is where the change goes.
 */
const keysOnTop =
  (rows: number, where: 'sizes' | 'chip'): Draw =>
  (p, c) => {
    const f = c.facts
    const chip: Row = chipRow(p, f)
    if (where === 'chip') {
      const words = changePill(p, f)
      chip.push(blank(Math.max(1, BLOCK - rowWidth(chip) + M - rowWidth(words))), ...words)
    }
    const body: Row[] = [
      chip,
      ...nameInBar(p, f, rows),
      [],
      where === 'sizes' ? sizesWithChange(p, f) : sizesRow(p, f),
    ]
    return screen(p, c, body, undefined, c.preset ? actionsRow(p) : undefined)
  }

const ROUND8: { id: string; name: string; idea: string; draw: Draw }[] = [
  {
    id: 'F',
    name: 'Name in the bar, the change between the sizes, keys on top',
    idea: 'B’s body with the change taken out of the bar and put on the sizes’ line, between the two badges. The name is back in the bar, as built. The two keys are the first row under the header bar; the result sits in the middle of what is left.',
    draw: keysOnTop(3, 'sizes'),
  },
  {
    id: 'G',
    name: 'F with the taller bar',
    idea: 'The same, the bar five rows tall, the name on its middle row.',
    draw: keysOnTop(5, 'sizes'),
  },
  {
    id: 'H',
    name: 'The change on the chip’s row',
    idea: 'The same as F, but the change sits at the chip row’s end, as a pill on its tint, instead of between the sizes. The sizes’ line is then just “now” and “was”.',
    draw: keysOnTop(3, 'chip'),
  },
]
const round8 = ROUND8.map((v) => figure(v.id, v.name, v.idea, pair(v.draw, SHOT))).join('')
const grew8 = [HALF, GREW, PLAIN]
  .map((c) => `<div class="sub">${esc(c.caption)}</div>${pair(keysOnTop(3, 'sizes'), c)}`)
  .join('')

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · Done, round seven</title>
<style>
  body { margin:0; background:#0d0e11; color:#e2e4ea; font:16px/1.6 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  main { max-width:1900px; margin:0 auto; padding:44px 24px 120px; }
  h1 { font-size:30px; margin:0 0 8px; } h2 { font-size:21px; margin:56px 0 4px; }
  .lede { color:#8f94a1; max-width:1000px; margin:0; }
  .box { border:1px solid #2c2f37; border-radius:10px; padding:14px 18px; margin:22px 0 0; max-width:1000px; background:#14161b; }
  .box h3 { margin:0 0 6px; font-size:14px; letter-spacing:.06em; text-transform:uppercase; color:#8f94a1; }
  .box ol, .box ul { margin:6px 0 0 20px; padding:0; } .box li { margin:4px 0; }
  figure { margin:36px 0 0; }
  .vt { display:flex; align-items:baseline; gap:10px; margin-bottom:6px; }
  .vt .id { font:700 12px "SF Mono", ui-monospace, Menlo, monospace; padding:3px 7px; border-radius:6px; background:#12282e; color:#55c7d9; }
  .vt .name { font-weight:620; }
  .pick { font:600 11px "SF Mono", ui-monospace, Menlo, monospace; letter-spacing:.08em; color:#6fcf7f; border:1px solid #2c5a37; padding:2px 7px; border-radius:6px; }
  .idea { font-size:14.5px; color:#c7cbd4; margin:6px 0 12px; max-width:1000px; }
  .sub { font:600 13px "SF Mono", ui-monospace, Menlo, monospace; color:#c7cbd4; margin:34px 0 -6px; }
  .row { display:flex; flex-wrap:wrap; gap:28px; margin-top:14px; }
  .col { display:flex; flex-direction:column; gap:10px; }
  .cap { font:13px "SF Mono", ui-monospace, Menlo, monospace; color:#8f94a1; }
  .t { font:13px/1 "SF Mono", ui-monospace, Menlo, monospace; padding:12px 14px; border-radius:10px; border:1px solid #2c2f37; width:max-content; }
  .r { height:17px; white-space:pre; } .r > span { display:inline-block; height:17px; line-height:17px; }
  code { font:13px "SF Mono", ui-monospace, Menlo, monospace; color:#c7cbd4; }
</style></head><body><main>
<h1>Done, a round of small steps</h1>
<p class="lede">The Done screen after a convert that carries preset keys, at a standard 80 × 24 window, dark and light, drawn from the app’s own bar, chip and badges. The idea stays: one bar as long as the larger file, the shed part hatched, the two sizes under it. These are steps on it, not a new screen.</p>

<div class="box"><h3>What stood out in the screenshot</h3><ol>
<li><b>The two keys are far from everything.</b> <code>p save as preset</code> hangs off the chip’s row; <code>→ continue editing</code> is on the last row, with a gap of empty rows between them and the result.</li>
<li><b>The words sit on the hatching.</b> The name and “278 KB saved · 89.6% smaller” are both written over the pattern, and the name runs past a small band.</li>
<li><b>Nothing ties a size to its end of the bar.</b> “now” and “was” are at the left and right, with the bar above them.</li></ol></div>

<div class="box"><h3>Open questions</h3><ol>
<li><b>Which step?</b> B to E below, pick one. C is where I would stop. D moves the change to the sizes’ line; E is C taller.</li>
<li><b>Are the two keys allowed to move?</b> Round nine of the presets put <code>p</code> beside the chip and <code>→</code> at the bottom right; B to E move both under the result. No new words in any figure.</li></ol></div>

<h2>OPTIONS: the result</h2>
<p class="lede">A is today’s. B to E, pick one.</p>
${figures}

<h2>C in other cases</h2>
<p class="lede">The recommended step with a result about half the size, one that grew, and a convert without preset keys.</p>
${cases}
</main></body></html>`

writeFileSync('mockups/done-2026-10.html', page)
console.log('wrote mockups/done-2026-10.html')

/* ============================================================ round nine */

type PAt = 'chip' | 'bottom' | 'under'
/**
 * Round nine: the change on the chip's row, the bar five rows tall, and
 * `→ continue editing` on the bottom right, as built. `p` is placed three
 * ways: after the chip (as built), at the bottom left on the row it shares
 * with →, or on its own row under the sizes.
 */
const final =
  (at: PAt): Draw =>
  (p, c) => {
    const f = c.facts
    const chip: Row = chipRow(p, f)
    if (c.preset && at === 'chip') chip.push(blank(1), ...keyHint(p, 'p', 'save as preset'))
    const words = changePill(p, f)
    chip.push(blank(Math.max(1, BLOCK + M - rowWidth(chip) - rowWidth(words))), ...words)
    const body: Row[] = [chip, ...nameInBar(p, f, 5), [], sizesRow(p, f)]
    if (c.preset && at === 'under') body.push([], [blank(M), ...keyHint(p, 'p', 'save as preset')])
    const more = keyHint(p, '→', 'continue editing')
    const left: Run[] = at === 'bottom' ? [blank(M), ...keyHint(p, 'p', 'save as preset')] : []
    const hint: Row | undefined = c.preset
      ? [...left, blank(Math.max(0, N - 1 - rowWidth(left) - rowWidth(more))), ...more]
      : undefined
    return screen(p, c, body, hint)
  }

const ROUND9: { id: string; name: string; idea: string; at: PAt; pick?: boolean }[] = [
  {
    id: 'I',
    name: '`p` stays beside the chip',
    idea: 'As built: the chip, then `p save as preset`, and the change out at the row’s end. One row carries the formats, the preset key and the saving; the bottom right has `→ continue editing` alone.',
    at: 'chip',
  },
  {
    id: 'J',
    name: '`p` at the bottom left, `→` at the bottom right',
    idea: 'The two keys share the last row above the rule, one at each end, the way the key row below them has its keys and its footnote. The chip’s row is then only the formats and the change.',
    at: 'bottom',
    pick: true,
  },
  {
    id: 'K',
    name: '`p` on its own row under the sizes',
    idea: '`p save as preset` sits one row under the sizes, left; `→ continue editing` stays alone at the bottom right. The body is one block ending in the preset key.',
    at: 'under',
  },
]
const round9 = ROUND9.map((v) =>
  figure(v.id, v.name, v.idea, pair(final(v.at), SHOT), v.pick),
).join('')
const cases9 = [HALF, GREW, PLAIN]
  .map((c) => `<div class="sub">${esc(c.caption)}</div>${pair(final('bottom'), c)}`)
  .join('')

/* ============================================================ round ten */

/**
 * Round ten, broad: the same result drawn eight ways. Fixed across all of
 * them: the header bar, the chip with the change at its row's end, `p` and
 * `→` on the bottom row, the key row. Only the middle changes. Dark only.
 */
function frame(p: Palette, c: Case, middle: Row[]): Grid {
  const f = c.facts
  const chip = chipRow(p, f)
  const words = changePill(p, f)
  chip.push(blank(Math.max(1, BLOCK + M - rowWidth(chip) - rowWidth(words))), ...words)
  const more = keyHint(p, '→', 'continue editing')
  const left: Run[] = [blank(M), ...keyHint(p, 'p', 'save as preset')]
  const hint: Row | undefined = c.preset
    ? [...left, blank(Math.max(0, N - 1 - rowWidth(left) - rowWidth(more))), ...more]
    : undefined
  return screen(p, c, [chip, ...middle], hint)
}

const sp = (n: number, bg?: string): Run => run(' '.repeat(Math.max(0, n)), undefined, bg)
const hatchRun = (p: Palette, n: number): Run => run('╱'.repeat(Math.max(0, n)), p.shedHatch)
/** The cells of `n` across the same scale as the bar's, for the new file. */
const keptOf = (f: DoneFacts, n: number) =>
  Math.min(
    ...Object.values(receiptBars(f.before.bytes, f.after.bytes, n))
      .slice(0, 2)
      .map(Number),
  )
const sizeText = (b: number) => formatBytes(b)

/** Text written over cells, each keeping the fill under it unless `bg` says otherwise. */
function over(cells: Cell[], at: number, text: string, fg: string, bg?: string, bold = false) {
  ;[...text].forEach((ch, k) => {
    const under = cells[at + k]
    if (under) cells[at + k] = { ch, fg, bg: bg ?? under.bg, b: bold }
  })
}
const toRow = (cells: Cell[]): Row => [blank(M), ...cells.map((c) => run(c.ch, c.fg, c.bg, c.b))]

/** L: today's concept as decided so far. */
const looks: { id: string; name: string; idea: string; draw: Draw; pick?: boolean }[] = []
looks.push({
  id: 'L',
  name: 'The bar (as decided so far)',
  idea: 'Round three’s I to K, for comparison: one bar five rows tall, the name in it, now and was under it.',
  draw: (p, c) => frame(p, c, [...nameInBar(p, c.facts, 5), [], sizesRow(p, c.facts)]),
})

/** M: two bars, one for each file. */
looks.push({
  id: 'M',
  name: 'Two bars, one a file',
  idea: 'The old file’s bar full width, the new file’s under it on the same scale; each has its own caption line with its name and size. Reads as two files, not as one file shrinking.',
  draw: (p, c) => {
    const f = c.facts
    const kept = keptOf(f, BLOCK)
    const caption = (tag: Run, name: Run[], size: Run): Row => {
      const left: Row = [blank(M), tag, sp(2), ...name]
      return [...left, sp(Math.max(1, BLOCK + M - rowWidth(left) - rowWidth([size]))), size]
    }
    const bar = (n: number, bg?: string): Row => [blank(M), sp(n, bg)]
    return frame(p, c, [
      [],
      bar(BLOCK, fill(p.panelBand)),
      bar(BLOCK, fill(p.panelBand)),
      caption(
        run(' was ', p.border, fill(p.keycapBg)),
        [run(f.before.name, p.dim)],
        run(sizeText(f.before.bytes), p.dim),
      ),
      [],
      bar(kept, tintOf(p, f)),
      bar(kept, tintOf(p, f)),
      caption(
        run(' now ', p.dim, fill(p.keycapBg)),
        [run('✓ ', p.ok, undefined, true), run(f.after.name, p.fg, undefined, true)],
        run(sizeText(f.after.bytes), inkOf(p, f), undefined, true),
      ),
    ])
  },
})

/** N: standing columns, the old one tall with its shed part hatched. */
looks.push({
  id: 'N',
  name: 'Two standing columns',
  idea: 'Round five’s S5 again, with what is now decided: the old file a tall column, its shed part hatched above the grey that is kept, the new file a short one beside it, both on the floor. The sizes sit under them.',
  draw: (p, c) => {
    const f = c.facts
    const R = 9
    const colW = 34
    const gap = BLOCK - 2 * colW
    const bars = receiptBars(f.before.bytes, f.after.bytes, R)
    const rows: Row[] = [nameRow(p, f), []]
    for (let r = 0; r < R; r++) {
      const fromFloor = R - r
      const left: Run =
        fromFloor > bars.before
          ? sp(colW)
          : fromFloor > Math.min(bars.before, bars.after)
            ? hatchRun(p, colW)
            : sp(colW, fill(p.panelBand))
      const right: Run = fromFloor <= bars.after ? sp(colW, fill(p.panelBand)) : sp(colW)
      rows.push([blank(M), left, sp(gap), right])
    }
    const { left: a, right: b } = badges(p, f)
    const was = bars.grew ? a : b
    const now = bars.grew ? b : a
    rows.push([blank(M), ...was, sp(colW + gap - rowWidth(was)), ...now])
    return frame(p, c, rows)
  },
})

/** O: a grid of a hundred dots. */
looks.push({
  id: 'O',
  name: 'A hundred dots',
  idea: 'Ten by ten, a dot for each hundredth of the old file. The ones still there are lit, in the first rows; the shed ones are the hatching’s green, faint. The drop area’s own dots, with a number on them.',
  draw: (p, c) => {
    const f = c.facts
    const lit = Math.max(1, keptOf(f, 100))
    const rows: Row[] = [nameRow(p, f), []]
    const { left, right } = badges(p, f)
    const now = f.after.bytes > f.before.bytes ? right : left
    const was = f.after.bytes > f.before.bytes ? left : right
    for (let r = 0; r < 10; r++) {
      const dots: Run[] = []
      for (let k = 0; k < 10; k++) {
        const on = r * 10 + k < lit
        dots.push(run('●', on ? inkOf(p, f) : p.shedHatch, undefined, on), sp(1))
      }
      rows.push([blank(M + 1), ...dots, sp(3), ...(r === 0 ? now : r === 9 ? was : [])])
    }
    return frame(p, c, rows)
  },
})

/** P: the quality screen's track and white pill. */
looks.push({
  id: 'P',
  name: 'A track and a pill',
  idea: 'The quality screen’s grey band with its white number pill: the band is the old file; the new size is the pill on the green part, the old size sits at the band’s end.',
  draw: (p, c) => {
    const f = c.facts
    const kept = keptOf(f, BLOCK)
    const R = 5
    const rows: Row[] = [nameRow(p, f), []]
    for (let r = 0; r < R; r++) {
      const cells: Cell[] = Array.from({ length: BLOCK }, (_, i) => ({
        ch: ' ',
        bg: i < kept ? mix(inkOf(p, f), p.canvas || p.shelf, 0.55) : p.panelBand,
      }))
      if (r === Math.floor(R / 2)) {
        const pill = ` ${sizeText(f.after.bytes)} `
        over(
          cells,
          Math.max(0, kept - Math.floor(pill.length / 2)),
          pill,
          p.canvas || p.ink,
          p.fg,
          true,
        )
        const end = ` ${sizeText(f.before.bytes)} `
        over(cells, BLOCK - end.length, end, p.dim)
      }
      rows.push(toRow(cells))
    }
    return frame(p, c, rows)
  },
})

/** Q: a box inside a box. */
looks.push({
  id: 'Q',
  name: 'One box inside the other',
  idea: 'Area, not length: the old file is the big hatched box, the new file a solid box in its corner, with the same shape and a tenth of the area. The two badges sit inside the boxes they name.',
  draw: (p, c) => {
    const f = c.facts
    const R = 9
    const s = Math.sqrt(
      Math.min(f.before.bytes, f.after.bytes) / Math.max(f.before.bytes, f.after.bytes),
    )
    const iw = Math.max(4, Math.round(BLOCK * s))
    const ih = Math.max(1, Math.round(R * s))
    const rows: Row[] = [nameRow(p, f), []]
    const { left, right } = badges(p, f)
    const now = f.after.bytes > f.before.bytes ? right : left
    const was = f.after.bytes > f.before.bytes ? left : right
    for (let r = 0; r < R; r++) {
      const cells: Cell[] = Array.from({ length: BLOCK }, (_, i) =>
        r < ih && i < iw ? { ch: ' ', bg: p.panelBand } : { ch: '╱', fg: p.shedHatch },
      )
      const out = toRow(cells)
      if (r === Math.floor(ih / 2)) {
        const at = M + 2
        const kept: Row = [
          ...out.slice(0, 1),
          ...cells.slice(0, 2).map((x) => run(x.ch, x.fg, x.bg)),
          ...now,
          ...cells.slice(2 + rowWidth(now)).map((x) => run(x.ch, x.fg, x.bg)),
        ]
        void at
        rows.push(kept)
      } else if (r === R - 1) {
        const body = cells.slice(0, BLOCK - rowWidth(was) - 2).map((x) => run(x.ch, x.fg, x.bg))
        rows.push([blank(M), ...body, sp(1), ...was, sp(1)])
      } else rows.push(out)
    }
    return frame(p, c, rows)
  },
})

/** R: a waterfall of three rows. */
looks.push({
  id: 'R',
  name: 'A waterfall',
  idea: 'Three bars on one scale: was, now, saved. The old file in full, the new file as the left part of it, and what was saved as the hatched part that is left over, starting where the new one ends.',
  draw: (p, c) => {
    const f = c.facts
    const label = 10
    const barW = BLOCK - label
    const kept = keptOf(f, barW)
    const group = (tag: Run, size: Run, parts: Run[]): Row[] => [
      [blank(M), tag, sp(label - rowWidth([tag])), ...parts],
      [blank(M), run(' '), size, sp(label - 1 - rowWidth([size])), ...parts],
    ]
    return frame(p, c, [
      [],
      ...group(run(' was ', p.border, fill(p.keycapBg)), run(sizeText(f.before.bytes), p.dim), [
        sp(barW, fill(p.panelBand)),
      ]),
      [],
      ...group(
        run(' now ', p.dim, fill(p.keycapBg)),
        run(sizeText(f.after.bytes), inkOf(p, f), undefined, true),
        [sp(kept, fill(p.panelBand)), sp(barW - kept)],
      ),
      [],
      ...group(
        run(' saved ', p.dim, fill(p.keycapBg)),
        run(sizeText(f.before.bytes - f.after.bytes), inkOf(p, f), undefined, true),
        [sp(kept), hatchRun(p, barW - kept)],
      ),
    ])
  },
})

/** S: was, an arrow, now. */
looks.push({
  id: 'S',
  name: 'Was, an arrow, now',
  idea: 'The only one that is not a scale: the old size in a grey panel, the new size in a green one, hatching running between them with an arrow, left to right in time. Nothing in it is proportional.',
  draw: (p, c) => {
    const f = c.facts
    const pw = 16
    const mid = BLOCK - 2 * pw
    const R = 5
    const rows: Row[] = [nameRow(p, f), []]
    const was = (r: number): Run => {
      const t = r === 1 ? ' was' : r === 2 ? ` ${sizeText(f.before.bytes)}` : ''
      return run(t.padEnd(pw), r === 2 ? p.fg : p.border, fill(p.panelBand), r === 2)
    }
    const now = (r: number): Run => {
      const t = r === 1 ? ' now' : r === 2 ? ` ${sizeText(f.after.bytes)}` : ''
      return run(t.padEnd(pw), r === 2 ? inkOf(p, f) : p.dim, tintOf(p, f), r === 2)
    }
    for (let r = 0; r < R; r++) {
      const shaft: Run[] =
        r === 2
          ? [
              hatchRun(p, Math.floor((mid - 5) / 2)),
              run('  →  ', p.fg, undefined, true),
              hatchRun(p, Math.ceil((mid - 5) / 2)),
            ]
          : [hatchRun(p, mid)]
      rows.push([blank(M), was(r), ...shaft, now(r)])
    }
    return frame(p, c, rows)
  },
})

const single = (draw: Draw, c: Case) =>
  `<div class="row"><div class="col">${term(DARK, draw(modePalette(DARK, 'convert'), c))}</div></div>`
const round10 = looks
  .map((v) => figure(v.id, v.name, v.idea, single(v.draw, SHOT), v.pick))
  .join('')

const head = page.slice(0, page.indexOf('<h1>'))
const page8 = `${head.replace('round seven', 'round eight')}<h1>Done, round two</h1>
<p class="lede">The same screen after a convert that carries preset keys, 80 × 24, dark and light. Asked for: B, with the file’s name back in the bar and the change (“278 KB saved · 89.6% smaller”) out of it; the taller bar; and the two keys moved to the top of the screen. I read “top” as the first row under the header bar; if you meant somewhere else, say so.</p>

<div class="box"><h3>Open questions</h3><ol>
<li><b>Where does the change go?</b> F and G put it between the two sizes; H puts it at the end of the chip’s row.</li>
<li><b>How tall is the bar?</b> F is three rows, G is five.</li></ol></div>

<h2>OPTIONS: the result</h2>
<p class="lede">F, G or H, pick one.</p>
${round8}

<h2>F in other cases</h2>
<p class="lede">A result about half the size, one that grew, and a convert without preset keys (no keys on top).</p>
${grew8}
</main></body></html>`
writeFileSync('mockups/done-2026-10-round2.html', page8)
console.log('wrote mockups/done-2026-10-round2.html')

const page9 = `${head.replace('round seven', 'round nine')}<h1>Done, round three</h1>
<p class="lede">Decided from round two: the change is on the chip’s row, the bar is five rows tall with the name in it, and <code>→ continue editing</code> is on the bottom right. Open: where <code>p save as preset</code> goes. 80 × 24, dark and light.</p>

<div class="box"><h3>Open question</h3><ol>
<li><b>Where does <code>p save as preset</code> go?</b> I to K below, pick one. J is where I would put it. I did not put it in the key row at the bottom: with <code>↵ convert another</code>, <code>o open</code> and <code>s show in finder</code> it would push <code>ctrl-c quit</code> off an 80-column line.</li></ol></div>

<h2>OPTIONS: where p goes</h2>
<p class="lede">I, J or K, pick one.</p>
${round9}

<h2>J in other cases</h2>
<p class="lede">A result about half the size, one that grew, and a convert without preset keys (neither key shows).</p>
${cases9}
</main></body></html>`
writeFileSync('mockups/done-2026-10-round3.html', page9)
console.log('wrote mockups/done-2026-10-round3.html')

const page10 = `${head.replace('round seven', 'round ten').replace('</style>', '.grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(640px, 1fr)); gap:0 28px; } .grid figure { margin-top:34px; }</style>')}<h1>Done, eight ways</h1>
<p class="lede">The same result drawn eight ways, dark only, 80 × 24. Held still in every one: the header, the chip with the saving at its row’s end, <code>p</code> and <code>→</code> on the bottom row, and the key row. Only the middle changes; L is the bar from the last round, for comparison. Every word is one the app already says. Each figure shows the screenshot’s case, 310 KB to 32.2 KB; a file that grew, a short name and light mode come for the ones you keep.</p>

<div class="box"><h3>Open question</h3><ol>
<li><b>Which of these are worth taking further?</b> Any number of L to S; I will bring the ones you pick through the other cases and light mode. M, N and Q each show the two files as two things; O, P and R show one file shrinking; S is the only one that is not to scale.</li></ol></div>

<h2>OPTIONS: the picture</h2>
<div class="grid">${round10}</div>
</main></body></html>`
writeFileSync('mockups/done-2026-10-round4.html', page10)
console.log('wrote mockups/done-2026-10-round4.html')
