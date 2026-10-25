/**
 * Done's layout, a picker (2026-10-22). The user, on Done as built with its
 * row of buttons (dev f28ebd4), asked to try:
 *
 *   - the strip and the bar a little higher, nearer the header;
 *   - now and was on one row: "now 400 KB" at the left, "was 3 MB" at the right;
 *   - the buttons a little lower, nearer the rule.
 *
 * As the colour picker did (scripts/done-next-mockup-r9.ts): one screen, one
 * row of choices per question, a click repaints the screen in place, and the
 * highlighted choices are the answer, saved to mockups/feedback/done-layout.json.
 *
 * The rows are the app's own, captured at 80 × 24, 26 (the user's window,
 * measured from their screenshot), 30 and 34 (scripts/done-layout-capture.tsx
 * → scripts/done-layout-frames.json). The page keeps each height's pieces as
 * rows and puts the screen together as the choices say: the strip a given
 * number of blank rows under the header, always a blank row between the bar
 * and now/was, the buttons on the rule or a row above it.
 *
 *   npx tsx scripts/done-layout-mockup.ts   → mockups/done-layout-2026-10.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { DARK, modePalette } from '../src/shell/theme.js'
import { type Cell, type Grid, gridHtml, TERM_CSS } from './term-cells.js'

type Raw = { ch: string; fg: string | null; bg: string | null; b: boolean }
const frames = JSON.parse(
  readFileSync(new URL('./done-layout-frames.json', import.meta.url), 'utf8'),
) as Record<string, Raw[][]>
const grid = (raw: Raw[][]): Grid =>
  raw.map((r) => r.map((c) => ({ ch: c.ch, fg: c.fg ?? undefined, bg: c.bg ?? undefined, b: c.b })))

const q = modePalette(DARK, 'convert')
const N = 80
/** The painted app's block: columns 4 to 75. */
const L = 4
const R = N - 4

const text = (row: Cell[] | undefined) => (row ?? []).map((c) => c.ch).join('')
const blankRow = (): Cell[] => Array.from({ length: N }, () => ({ ch: ' ', bg: q.canvas }))
const blanks = (n: number) => Array.from({ length: Math.max(0, n) }, blankRow)

/** The screen's parts, found by what they say. */
function parts(g: Grid) {
  const at = (s: string) => g.findIndex((r) => text(r).includes(s))
  const strip = at('PNG → JPEG')
  const sizes = g.findIndex((r) => /^\s+now\s+was\s*$/.test(text(r)))
  const home = at('↵ Home')
  return {
    header: g[1] as Cell[],
    /** Blank rows between the header and the strip, as built. */
    above: strip - 1 - 2,
    body: g.slice(strip - 1, strip + 9),
    sizes: g.slice(sizes, sizes + 2),
    actions: g.slice(home - 1, home + 2),
    rule: g[g.length - 2] as Cell[],
    keys: g[g.length - 1] as Cell[],
  }
}

/** The cells of a row's word groups (runs of non-blank cells split by two or more spaces). */
function groups(row: Cell[]): Cell[][] {
  const out: Cell[][] = []
  let cur: Cell[] = []
  let gap = 0
  for (const c of row) {
    if (c.ch === ' ') {
      gap++
      if (cur.length) cur.push(c)
      continue
    }
    if (gap >= 2 && cur.length) {
      out.push(cur.slice(0, cur.length - gap))
      cur = []
    }
    gap = 0
    cur.push(c)
  }
  if (cur.length) out.push(cur.slice(0, cur.length - gap))
  return out
}

/** now and was on one row: `ends` puts was at the block's right end, else beside now. */
function oneRow(sizes: Cell[][], ends: boolean): Cell[] {
  const [words, numbers] = sizes
  const [now, was] = groups(words ?? [])
  const [small, large] = groups(numbers ?? [])
  const sp: Cell = { ch: ' ', bg: q.canvas }
  const left = [...(now ?? []), sp, ...(small ?? [])]
  const right = [...(was ?? []), sp, ...(large ?? [])]
  const row = blankRow()
  left.forEach((c, i) => {
    row[L + i] = c
  })
  const from = ends ? R - right.length : L + left.length + 4
  right.forEach((c, i) => {
    row[from + i] = c
  })
  return row
}

const HEIGHTS = [24, 26, 30, 34] as const
const rowHtml = (row: Cell[]) => gridHtml([row], q)

/** Each height's pieces, as rows of HTML, for the page to put together. */
const pieces = Object.fromEntries(
  HEIGHTS.map((h) => {
    const p = parts(grid(frames[`done${h}`] as Raw[][]))
    return [
      h,
      {
        built: p.above,
        header: rowHtml(p.header),
        body: p.body.map(rowHtml),
        sizes: {
          stacked: p.sizes.map(rowHtml),
          ends: [rowHtml(oneRow(p.sizes, true))],
          left: [rowHtml(oneRow(p.sizes, false))],
        },
        actions: p.actions.map(rowHtml),
        rule: rowHtml(p.rule),
        keys: rowHtml(p.keys),
      },
    ]
  }),
)
const BLANK = rowHtml(blankRow())

type Choice = [id: string, label: string]
const chips = (name: string, title: string, list: Choice[], hint = '') =>
  `<div class="q"><div class="qt">${title}${hint ? `<span class="hint">${hint}</span>` : ''}</div><div class="chips">${list
    .map(
      ([id, label]) => `<button class="chip" data-name="${name}" data-id="${id}">${label}</button>`,
    )
    .join('')}</div></div>`

const START = { body: 'built', sizes: 'stacked', foot: 'gap', height: '26' }

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · Done, pick the layout</title>
<style>
  body { margin:0; background:#0d0e11; color:#e2e4ea; font:16px/1.6 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  main { max-width:1400px; margin:0 auto; padding:40px 24px 80px; }
  h1 { font-size:28px; margin:0 0 6px; }
  .lede { color:#8f94a1; margin:0 0 28px; max-width:900px; }
  .layout { display:flex; gap:40px; align-items:flex-start; }
  .picks { min-width:380px; }
  .q { margin:0 0 22px; }
  .qt { font-weight:620; margin-bottom:8px; }
  .hint { font-weight:400; color:#8f94a1; font-size:13px; margin-left:8px; }
  .chips { display:flex; flex-wrap:wrap; gap:8px; }
  .chip { font:500 14px -apple-system, BlinkMacSystemFont, sans-serif; color:#c7cbd4; background:#16181d; border:1px solid #2c2f37; border-radius:8px; padding:7px 12px; cursor:pointer; }
  .chip:hover { border-color:#4a4f5a; color:#fff; }
  .chip.on { border-color:#55c7d9; background:#12282e; color:#8fe3f0; }
  .chip.off { opacity:.35; cursor:not-allowed; }
  .view { border-top:1px solid #23252c; padding-top:18px; margin-top:6px; }
  .status { font:13px "SF Mono", ui-monospace, Menlo, monospace; color:#8f94a1; margin-top:8px; }
  .copy { font:500 14px -apple-system, sans-serif; color:#c7cbd4; background:#16181d; border:1px solid #2c2f37; border-radius:8px; padding:8px 14px; cursor:pointer; }
  .t { zoom:1.15; }
  ${TERM_CSS}
</style></head><body><main>
<h1>Done: pick the layout</h1>
<p class="lede">Click one choice in each row on the right. The screen changes straight away, so you can flick between two choices and compare them in the same spot. The highlighted choices are your picks, and they save on their own.</p>
<div class="layout">
  <div class="t" style="background:${q.canvas}"><div id="screen"></div></div>
  <div class="picks">
    ${chips(
      'body',
      '1. Blank rows between the header and the strip',
      [
        ['built', 'As built'],
        ['1', '1'],
        ['2', '2'],
        ['3', '3'],
        ['4', '4'],
      ],
      'greyed where the window is too short',
    )}
    ${chips('sizes', '2. Now and was', [
      ['stacked', 'Stacked (now)'],
      ['ends', 'One row, at either end'],
      ['left', 'One row, side by side'],
    ])}
    ${chips('foot', '3. The buttons', [
      ['gap', 'A blank row above the line (now)'],
      ['line', 'On the line'],
    ])}
    <div class="view">${chips(
      'height',
      'Look at it in',
      [
        ['24', '80 × 24'],
        ['26', '80 × 26 (your window)'],
        ['30', '80 × 30'],
        ['34', '80 × 34'],
      ],
      'not a pick, just the window',
    )}</div>
    <button class="copy">Copy my picks</button>
    <div class="status"></div>
  </div>
</div>
<script>
const PIECES = ${JSON.stringify(pieces)}
const BLANK = ${JSON.stringify(BLANK)}
const PAGE = 'done-layout'
// Only answers this page offers: a choice saved by an earlier version of it is dropped.
const ALLOWED = { body: ['built', '1', '2', '3', '4'], sizes: ['stacked', 'ends', 'left'], foot: ['gap', 'line'], height: ['24', '26', '30', '34'] }
const saved = JSON.parse(localStorage.getItem(PAGE + '-v2') || '{}')
let state = ${JSON.stringify(START)}
for (const k of Object.keys(ALLOWED)) if (ALLOWED[k].includes(saved[k])) state[k] = saved[k]
const status = document.querySelector('.status')
/** The screen's rows with \`k\` blank rows under the header, or null where it does not fit. */
function rowsFor(k) {
  const h = Number(state.height)
  const p = PIECES[h]
  const above = k === 'built' ? p.built : Number(k)
  const top = [BLANK, p.header, ...Array(above).fill(BLANK), ...p.body, BLANK, ...p.sizes[state.sizes]]
  const bottom = [...p.actions, ...(state.foot === 'gap' ? [BLANK] : []), p.rule, p.keys]
  const free = h - top.length - bottom.length
  return free < 0 ? null : [...top, ...Array(free).fill(BLANK), ...bottom]
}
function paint() {
  if (!rowsFor(state.body)) state.body = 'built'
  document.getElementById('screen').innerHTML = rowsFor(state.body).join('')
  for (const c of document.querySelectorAll('.chip')) {
    c.classList.toggle('on', state[c.dataset.name] === c.dataset.id)
    if (c.dataset.name === 'body') {
      c.classList.toggle('off', !rowsFor(c.dataset.id))
      if (c.dataset.id === 'built') c.textContent = 'As built (' + PIECES[Number(state.height)].built + ')'
    }
  }
}
function label(name) { const c = document.querySelector('.chip[data-name="' + name + '"][data-id="' + state[name] + '"]'); return c ? c.textContent : '' }
function summary() { return 'done-layout picks: blank rows under the header ' + label('body') + ' · now and was ' + label('sizes') + ' · buttons ' + label('foot') }
async function save() {
  localStorage.setItem(PAGE + '-v2', JSON.stringify(state))
  if (!location.protocol.startsWith('http')) { status.textContent = 'kept in this browser · use Copy my picks'; return }
  const picks = { body: label('body'), sizes: label('sizes'), foot: label('foot') }
  try {
    const r = await fetch('/feedback/' + PAGE, { method: 'POST', body: JSON.stringify({ page: PAGE, picks }) })
    status.textContent = r.ok ? 'saved · ' + new Date().toLocaleTimeString() : 'not saved · use Copy my picks'
  } catch { status.textContent = 'not saved · use Copy my picks' }
}
for (const c of document.querySelectorAll('.chip'))
  c.addEventListener('click', () => {
    if (c.classList.contains('off')) return
    state[c.dataset.name] = c.dataset.id
    paint()
    if (c.dataset.name !== 'height') save()
  })
document.querySelector('.copy').addEventListener('click', async () => { await navigator.clipboard.writeText(summary()); status.textContent = 'copied · paste it to Claude' })
paint()
</script>
</main></body></html>`

writeFileSync('mockups/done-layout-2026-10.html', html)
console.log('wrote mockups/done-layout-2026-10.html')
