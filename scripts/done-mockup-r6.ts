/**
 * The Done screen, round twelve (2026-10-19): the screen as it is, its own
 * pieces rearranged. No new picture and no new words: the formats' chip,
 * the bar sized by bytes (grey band kept, hatching shed) with the file's
 * name, the change, the now and was badges, `p save as preset`,
 * `→ continue editing` and the key row, placed ten ways.
 *
 * Each concept has four verdict buttons, and the page has one for "more
 * concepts". Served by scripts/mockup-feedback-server.mjs, the answers land
 * in mockups/feedback/done-round6.json; opened as a file, they stay in the
 * browser and a button copies them.
 *
 *   npx tsx scripts/done-mockup-r6.ts   → mockups/done-2026-10-round6.html
 */
import { writeFileSync } from 'node:fs'
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
import { DARK, modeColours, modePalette, type Palette } from '../src/shell/theme.js'
import { middleEllipsis } from '../src/shell/width.js'
import { type Cell, fill, over, rowOf, run, TERM_CSS, termHtml, toGrid } from './term-cells.js'

const N = 80
const H = 24
const BLOCK = N - 2 * M
const PAGE = 'done-round6'

/* ------------------------------------------------------------------ facts */

const KB = 1000
const F: DoneFacts = {
  mode: 'convert',
  before: { format: 'PNG', name: 'Screenshot 2026-10-19 at 9.43.23 PM.png', bytes: 310 * KB },
  after: { format: 'WebP', name: 'Screenshot 2026-10-19 at 9.43.23 PM.webp', bytes: 32.2 * KB },
}
const SAVED = `${formatBytes(F.before.bytes - F.after.bytes)} saved`
const SMALLER = changePhrase(F.before.bytes, F.after.bytes)
const CHANGE = `${SAVED} · ${SMALLER}`

/* ----------------------------------------------------------------- pieces */

const tint = (p: Palette) => fill(mix(p.ok, p.canvas, 0.8))
/** `left` from the block's left edge, `right` ending on its right edge. */
const spread = (left: Run[], right: Run[] = [], width = BLOCK, margin = M): Row => [
  blank(margin),
  ...left,
  blank(Math.max(right.length ? 1 : 0, width - rowWidth(left) - rowWidth(right))),
  ...right,
]
const chip = (p: Palette): Run => {
  const mode = modeColours(p, F.mode)
  return run(` ${F.before.format} → ${F.after.format} `, mode.fg, fill(mode.bg), true)
}
const pill = (p: Palette): Run => run(` ${CHANGE} `, p.ok, tint(p), true)
const name = (p: Palette, room = BLOCK): Run[] => [
  run('✓ ', p.ok, undefined, true),
  run(middleEllipsis(F.after.name, room - 2), p.fg, undefined, true),
]
const now = (p: Palette): Run[] => [
  run(' now ', p.dim, fill(p.keycapBg)),
  run(` ${formatBytes(F.after.bytes)} `, p.ok, tint(p), true),
]
const was = (p: Palette): Run[] => [
  run(' was ', p.border, fill(p.keycapBg)),
  run(` ${formatBytes(F.before.bytes)} `, p.dim, fill(p.panelBand)),
]
const key = (p: Palette, k: string, words: string): Run[] => [
  run(` ${k} `, p.fg, fill(p.keycapBg), true),
  run(` ${words}`, p.dim),
]
const preset = (p: Palette) => key(p, 'p', 'save as preset')
const more = (p: Palette) => key(p, '→', 'continue editing')

/**
 * The bar: `rows` tall, `width` wide from column `margin`, the grey band as
 * long as the new file, the hatching to the old file's length. With
 * `named`, the name sits on the middle row, knocked out of the hatching
 * with a cell to spare.
 */
function bar(p: Palette, { rows = 5, width = BLOCK, margin = M, named = true } = {}): Row[] {
  const kept = receiptBars(F.before.bytes, F.after.bytes, width).after
  return Array.from({ length: rows }, (_, r) => {
    const cells: Cell[] = Array.from({ length: width }, (_, i) =>
      i < kept ? { ch: ' ', bg: fill(p.panelBand) } : { ch: '╱', fg: p.shedHatch },
    )
    if (named && r === rows >> 1) {
      over(cells, margin === 0 ? M - 1 : 0, [run(' '), ...name(p, width - 4), run(' ')])
    }
    return [blank(margin), ...rowOf(cells)]
  })
}

/* ----------------------------------------------------------------- screen */

type Align = 'centre' | 'top' | 'bottom'

/**
 * The header bar, the body, then `hint` (the row above the rule, if any),
 * the rule and the key row. `centre` places the body as the app does
 * (`doneLayout`); `top` puts it a blank row under the header; `bottom` ends
 * it a blank row above the hint.
 */
function screen(p: Palette, body: Row[], hint?: Row, align: Align = 'centre'): Row[] {
  const header = trailBarRow({
    width: N,
    palette: p,
    mode: 'convert',
    trail: { answers: ['WebP', 'Desktop'], current: 'Done' },
    slanted: false,
  })
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

  const free = H - 4 - body.length - (hint ? 1 : 0)
  const { top } = doneLayout({ height: H, body: body.length, notes: 0 })
  const above =
    align === 'top' ? 0 : align === 'bottom' ? Math.max(0, free - 1) : Math.min(top, free)
  const blanks = (n: number) => Array.from({ length: Math.max(0, n) }, (): Row => [])
  return [
    header,
    [],
    ...blanks(above),
    ...body,
    ...blanks(free - above),
    ...(hint ? [hint] : []),
    [run('─'.repeat(N), p.border)],
    keys,
  ]
}
/** `p` at the bottom left, `→` at the bottom right. */
const bothBottom = (p: Palette): Row => {
  const left: Row = [blank(M), ...preset(p)]
  return [...left, blank(N - 1 - rowWidth(left) - rowWidth(more(p))), ...more(p)]
}
/** `→` alone at the bottom right, as built. */
const moreBottom = (p: Palette): Row => [blank(N - 1 - rowWidth(more(p))), ...more(p)]

/* --------------------------------------------------------------- concepts */

interface Concept {
  id: string
  name: string
  idea: string
  draw: (p: Palette) => Row[]
}

const CONCEPTS: Concept[] = [
  {
    id: '1',
    name: 'Today',
    idea: 'The screen as built, from your screenshot, so it can be rated too.',
    draw: (p) => {
      const body = doneBody({ palette: p, facts: F, width: N })
      body[0] = [...(body[0] ?? []), blank(1), ...preset(p)]
      return screen(p, body, moreBottom(p))
    },
  },
  {
    id: '2',
    name: 'As decided so far',
    idea: 'Rounds two and three: the change at the end of the chip’s row, the bar five rows tall with the name in it, now and was under its ends, p at the bottom left and → at the bottom right.',
    draw: (p) =>
      screen(
        p,
        [spread([chip(p)], [pill(p)]), [], ...bar(p), [], spread(now(p), was(p))],
        bothBottom(p),
      ),
  },
  {
    id: '3',
    name: 'Sizes as tabs on the bar',
    idea: 'Now and was leave the row under the bar and sit on its top edge as tabs, touching it: now over the band’s start, was over the bar’s end. The bar and its two numbers read as one object.',
    draw: (p) => {
      const tabs = spread(now(p), was(p))
      return screen(p, [spread([chip(p)], [pill(p)]), [], tabs, ...bar(p)], bothBottom(p))
    },
  },
  {
    id: '4',
    name: 'The name as the title',
    idea: 'The file’s name leads, bold, on its own row; the chip and the change make the line under it. The bar is then only the picture, with nothing written on it.',
    draw: (p) =>
      screen(
        p,
        [
          [blank(M), ...name(p)],
          spread([chip(p)], [pill(p)]),
          [],
          ...bar(p, { named: false }),
          [],
          spread(now(p), was(p)),
        ],
        bothBottom(p),
      ),
  },
  {
    id: '5',
    name: 'The bar beside its numbers',
    idea: 'The bar narrower and taller, seven rows, on the left; to its right a column of what it shows: the formats, the saving, the change, then now and was. The name above both.',
    draw: (p) => {
      const W = 46
      const gap = 4
      const picture = bar(p, { rows: 7, width: W, named: false })
      const side: Run[][] = [
        [chip(p)],
        [],
        [run(SAVED, p.ok, undefined, true)],
        [run(SMALLER, p.ok)],
        [],
        now(p),
        was(p),
      ]
      const rows = picture.map((row, i) => [...row, blank(gap), ...(side[i] ?? [])])
      return screen(p, [[blank(M), ...name(p)], [], ...rows], bothBottom(p))
    },
  },
  {
    id: '6',
    name: 'The bar edge to edge',
    idea: 'The bar runs the full width of the window, margin to margin gone, like the header bar above it. Everything else keeps the margin, so the bar is the one thing that touches the edges.',
    draw: (p) =>
      screen(
        p,
        [
          spread([chip(p)], [pill(p)]),
          [],
          ...bar(p, { width: N, margin: 0 }),
          [],
          spread(now(p), was(p)),
        ],
        bothBottom(p),
      ),
  },
  {
    id: '7',
    name: 'Pinned under the header',
    idea: 'The result starts right under the header bar instead of floating in the middle, and p and → follow straight after it, at the block’s two ends. Everything is in one place at the top; the rest of the window is quiet.',
    draw: (p) =>
      screen(
        p,
        [
          spread([chip(p)], [pill(p)]),
          [],
          ...bar(p),
          [],
          spread(now(p), was(p)),
          [],
          spread(preset(p), more(p)),
        ],
        undefined,
        'top',
      ),
  },
  {
    id: '8',
    name: 'Landed above the keys',
    idea: 'The opposite: the result sits low, its sizes a blank row above p and →, so the eye goes from the bar straight to the keys that act on it. The space above it is empty.',
    draw: (p) =>
      screen(
        p,
        [spread([chip(p)], [pill(p)]), [], ...bar(p), [], spread(now(p), was(p))],
        bothBottom(p),
        'bottom',
      ),
  },
  {
    id: '9',
    name: 'Keys under the sizes, at the same ends',
    idea: 'p and → move up into the body, right under now and was: p under now on the left, → under was on the right, so each column reads number then key. The bottom row above the rule is empty.',
    draw: (p) =>
      screen(p, [
        spread([chip(p)], [pill(p)]),
        [],
        ...bar(p),
        [],
        spread(now(p), was(p)),
        spread(preset(p), more(p)),
      ]),
  },
  {
    id: '10',
    name: 'One line under the bar',
    idea: 'The chip’s row is the chip and p; the change moves under the bar, between now and was, so one line reads now, what changed, was. → at the bottom right.',
    draw: (p) => {
      const words = run(CHANGE, p.ok, undefined, true)
      const left = now(p)
      const right = was(p)
      const room = BLOCK - rowWidth(left) - rowWidth(right) - rowWidth([words])
      const line: Row = [
        blank(M),
        ...left,
        blank(room >> 1),
        words,
        blank(room - (room >> 1)),
        ...right,
      ]
      return screen(p, [spread([chip(p)], preset(p)), [], ...bar(p), [], line], moreBottom(p))
    },
  },
]

/* ------------------------------------------------------------------- page */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const VERDICTS = [
  ['like', 'I like it'],
  ['potential', 'Not now, but it has potential'],
  ['dislike', 'I don’t like it'],
  ['hate', 'I completely hate this'],
] as const

const p = modePalette(DARK, 'convert')
const figures = CONCEPTS.map(
  (c) => `<section class="concept" data-id="${c.id}">
  ${termHtml(p, toGrid(c.draw(p), N))}
  <div class="side">
    <div class="vt"><span class="id">${c.id}</span><span class="name">${esc(c.name)}</span></div>
    <p class="idea">${esc(c.idea)}</p>
    <div class="verdicts">${VERDICTS.map(([v, label]) => `<button data-v="${v}">${label}</button>`).join('')}</div>
  </div>
</section>`,
).join('')

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · Done, rearranged</title>
<style>
  body { margin:0; background:#0d0e11; color:#e2e4ea; font:16px/1.6 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  main { max-width:1500px; margin:0 auto; padding:44px 24px 120px; }
  h1 { font-size:30px; margin:0 0 8px; }
  .lede { color:#8f94a1; max-width:1000px; margin:0; }
  .top { display:flex; align-items:center; gap:16px; margin:24px 0 8px; flex-wrap:wrap; }
  .status { font:13px "SF Mono", ui-monospace, Menlo, monospace; color:#8f94a1; }
  .concept { display:flex; gap:32px; align-items:flex-start; margin:44px 0 0; }
  .side { max-width:420px; padding-top:4px; }
  .vt { display:flex; align-items:baseline; gap:10px; }
  .vt .id { font:700 12px "SF Mono", ui-monospace, Menlo, monospace; padding:3px 8px; border-radius:6px; background:#12282e; color:#55c7d9; }
  .vt .name { font-weight:620; font-size:18px; }
  .idea { font-size:14.5px; color:#c7cbd4; margin:8px 0 18px; }
  .verdicts { display:flex; flex-direction:column; gap:8px; }
  button { font:600 14px -apple-system, BlinkMacSystemFont, sans-serif; color:#c7cbd4; background:#16181d; border:1px solid #2c2f37; border-radius:8px; padding:9px 14px; text-align:left; cursor:pointer; transition:background .12s, border-color .12s, color .12s; }
  button:hover { border-color:#4a4f5a; color:#fff; }
  button[data-v="like"].on { background:#16301d; border-color:#3f8f55; color:#8fe0a3; }
  button[data-v="potential"].on { background:#2e2614; border-color:#9a7a2c; color:#f0cf7a; }
  button[data-v="dislike"].on { background:#24262c; border-color:#6b7080; color:#e2e4ea; }
  button[data-v="hate"].on { background:#341618; border-color:#a8414a; color:#ff9aa2; }
  button.more { padding:11px 18px; font-size:15px; }
  button.more.on { background:#12282e; border-color:#55c7d9; color:#8fe3f0; }
  button.copy { font-weight:500; }
  ${TERM_CSS}
</style></head><body><main>
<h1>Done, rearranged</h1>
<p class="lede">Today’s Done screen and nine rearrangements of its own pieces: the chip, the bar sized by bytes with the name, the change, now and was, p, → and the key row. No new picture, no new words. Dark, 80 × 24, the screenshot’s file (310 KB → 32.2 KB).</p>
<div class="top">
  <button class="more">I would like more concepts</button>
  <button class="copy">Copy my answers</button>
  <span class="status"></span>
</div>
${figures}
<script>
const PAGE = '${PAGE}'
const status = document.querySelector('.status')
const served = location.protocol.startsWith('http')
let state = JSON.parse(localStorage.getItem(PAGE) || '{"verdicts":{},"moreConcepts":false}')

function paint() {
  for (const s of document.querySelectorAll('.concept')) {
    for (const b of s.querySelectorAll('button')) b.classList.toggle('on', state.verdicts[s.dataset.id] === b.dataset.v)
  }
  document.querySelector('.more').classList.toggle('on', !!state.moreConcepts)
}
function summary() {
  const lines = [...document.querySelectorAll('.concept')].map((s) => {
    const v = state.verdicts[s.dataset.id]
    return s.dataset.id + ' ' + s.querySelector('.name').textContent + ': ' + (v || '—')
  })
  return 'Done, rearranged (' + PAGE + ')\\n' + lines.join('\\n') + '\\nMore concepts: ' + (state.moreConcepts ? 'yes' : 'no')
}
async function save() {
  localStorage.setItem(PAGE, JSON.stringify(state))
  paint()
  if (!served) { status.textContent = 'kept in this browser · use Copy my answers'; return }
  try {
    const r = await fetch('/feedback/' + PAGE, { method: 'POST', body: JSON.stringify({ page: PAGE, ...state }) })
    status.textContent = r.ok ? 'saved for Claude · ' + new Date().toLocaleTimeString() : 'not saved · use Copy my answers'
  } catch { status.textContent = 'not saved · use Copy my answers' }
}
for (const s of document.querySelectorAll('.concept')) {
  for (const b of s.querySelectorAll('button')) {
    b.addEventListener('click', () => {
      const id = s.dataset.id
      state.verdicts[id] = state.verdicts[id] === b.dataset.v ? undefined : b.dataset.v
      save()
    })
  }
}
document.querySelector('.more').addEventListener('click', () => { state.moreConcepts = !state.moreConcepts; save() })
document.querySelector('.copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(summary())
  status.textContent = 'copied · paste it to Claude'
})
if (served) {
  fetch('/feedback/' + PAGE).then((r) => r.json()).then((saved) => {
    if (saved && saved.verdicts) state = { verdicts: saved.verdicts, moreConcepts: !!saved.moreConcepts }
    paint()
  }).catch(paint)
} else paint()
</script>
</main></body></html>`

writeFileSync('mockups/done-2026-10-round6.html', page)
console.log('wrote mockups/done-2026-10-round6.html')
