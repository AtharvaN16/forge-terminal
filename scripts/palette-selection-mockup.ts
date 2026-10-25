/**
 * How the Palette grid marks the chosen swatch (2026-10-25). The user could
 * not see the mark on light swatches (blue 100) and, shown the line inside the
 * swatch, did not like how it looks. A live picker: one look per chip, drawn
 * on four swatches (two light, a mid-tone, a dark one) so the light ones can
 * be judged; a click repaints and saves the pick.
 *
 * Before: B1 today's lines inside (2026-10-25), B2 the gap frame in white or
 * near-black (2026-10-24), B3 the first one, in the text colour (2026-10-14).
 *
 * The cells are the app's own: `gridRows`, then each look drawn over them.
 *
 *   npx tsx scripts/palette-selection-mockup.ts → mockups/palette-selection-2026-10.html
 */
import { writeFileSync } from 'node:fs'
import { onWhiteAndBlack } from '../src/core/colour/contrast.js'
import { DEFAULT_STEPS, stepsOf } from '../src/core/colour/scale.js'
import { parseHex, rgbToOklab } from '../src/core/colour/space.js'
import { system } from '../src/core/colour/system.js'
import { gridRows } from '../src/shell/colour/system-art.js'
import { mix } from '../src/shell/home-art.js'
import { DARK, modePalette } from '../src/shell/theme.js'
import { type Cell, type Grid, gridHtml, TERM_CSS, toGrid } from './term-cells.js'

const P = modePalette(DARK, 'colour')
const CANVAS = P.canvas.toLowerCase()
const WHITE = '#ffffff'
const NEAR_BLACK = '#111111'
const PAGE = 'palette-selection-2026-10'

/* ---------------------------------------------------------------- the grid */

const sys = system({ r: 0xe3, g: 0x4c, b: 0x3a }, 'full')
const names = [...sys.rows.map((r) => r.name), 'neutral']
const gridRowsIn = [
  ...sys.rows.map((r) => ({ name: r.name, hexes: r.steps.map((x) => x.hex), yours: r.yours })),
  { name: 'neutral', hexes: sys.neutral.map((x) => x.hex), yours: false },
]
const labels = stepsOf(DEFAULT_STEPS).map(String)
/** 80 columns: names 10, cells 4, a gap of 1 between. */
const NAME = 10
const CELL = 4
const at = (col: number) => 2 + NAME + col * (CELL + 1)
const COLS = 70

/** Where the chosen swatch is, in the four screens. */
const SPOTS = [
  { row: names.indexOf('blue'), col: 1, label: 'blue 100 · a light one' },
  { row: names.indexOf('yellow'), col: 2, label: 'yellow 200 · a light, warm one' },
  { row: names.indexOf('teal'), col: 6, label: 'teal 600 · a mid-tone' },
  { row: names.indexOf('purple'), col: 8, label: 'purple 800 · a dark one' },
]

const base = (row: number, col: number): Grid =>
  toGrid(
    gridRows({
      width: 76,
      palette: P,
      labels,
      rows: gridRowsIn,
      reference: 5,
      sel: { row, col },
      framed: false,
      lines: 9,
    }),
    76,
  )

/** White or near-black, whichever reads on `hex`. */
const readsOn = (hex: string): string => {
  const rgb = parseHex(hex)
  if (!rgb) return WHITE
  const r = onWhiteAndBlack(rgb)
  return r.white >= r.black ? WHITE : NEAR_BLACK
}
/** The gap frame's colour as built on 2026-10-24: white, unless the swatch is near white. */
const frameOn = (hex: string): string => {
  const rgb = parseHex(hex)
  const L = rgb ? rgbToOklab(rgb).L : 0
  return Math.abs(1 - L) < 0.2 ? NEAR_BLACK : WHITE
}

/* ----------------------------------------------------------------- looks */

type Look = (g: Grid, row: number, col: number, hex: string) => void

const put = (g: Grid, r: number, c: number, cell: Cell): void => {
  const line = g[r] as Cell[]
  line[c] = { ...(line[c] ?? { ch: ' ' }), ...cell }
}
/** The swatch's own cells, left to right, on the row's line. */
const swatch = (g: Grid, row: number, col: number): Cell[] =>
  (g[1 + row] as Cell[]).slice(at(col), at(col) + CELL)
const onSwatch = (
  g: Grid,
  row: number,
  col: number,
  k: number,
  ch: string,
  fg: string,
  hex: string,
) => put(g, 1 + row, at(col) + k, { ch, fg, bg: hex, b: true })
const gaps = (g: Grid, row: number, col: number, left: string, right: string, fg: string) => {
  put(g, 1 + row, at(col) - 1, { ch: left, fg, b: true })
  put(g, 1 + row, at(col) + CELL, { ch: right, fg, b: true })
}
const pillLabels: Look = (g, row, col) => {
  for (let c = at(col); c < at(col) + CELL; c++)
    put(g, 0, c, { fg: NEAR_BLACK, bg: '#e7e7e7', b: true })
  const name = names[row] as string
  for (let c = 2; c <= 2 + name.length; c++)
    put(g, 1 + row, c, { fg: NEAR_BLACK, bg: '#e7e7e7', b: true })
}

const LOOKS: Record<string, { name: string; idea: string; group: string; draw: Look }> = {
  s1: {
    group: 'New',
    name: 'Hatching across the swatch',
    idea: 'the app’s own ╱ hatching, in the swatch’s reading colour, over the whole swatch',
    draw: (g, row, col, hex) => {
      const ink = mix(hex, readsOn(hex), 0.7)
      swatch(g, row, col).forEach((c, k) => {
        if (c.ch === ' ') onSwatch(g, row, col, k, '╱', ink, hex)
      })
    },
  },
  s2: {
    group: 'New',
    name: 'Pointers either side',
    idea: 'white ▸ ◂ in the gaps either side, pointing in: on the dark canvas, so seen on any swatch',
    draw: (g, row, col) => gaps(g, row, col, '▸', '◂', WHITE),
  },
  s3: {
    group: 'New',
    name: 'Thick white bars either side',
    idea: 'half-cell white bars in the gaps, hugging the swatch: a heavy bracket on the canvas',
    draw: (g, row, col) => gaps(g, row, col, '▐', '▌', WHITE),
  },
  s4: {
    group: 'New',
    name: 'Brackets inside',
    idea: '[ ] in the swatch’s first and last cell, in its reading colour',
    draw: (g, row, col, hex) => {
      onSwatch(g, row, col, 0, '[', readsOn(hex), hex)
      onSwatch(g, row, col, CELL - 1, ']', readsOn(hex), hex)
    },
  },
  s5: {
    group: 'New',
    name: 'Spotlight: the rest fades',
    idea: 'every other swatch dims towards the canvas; the chosen one stays full colour, nothing drawn on it',
    draw: (g, row, col) => {
      g.forEach((line, r) => {
        if (r === 0) return
        line.forEach((c, k) => {
          const mine = r === 1 + row && k >= at(col) && k < at(col) + CELL
          if (c.bg && !mine) line[k] = { ...c, bg: mix(c.bg, CANVAS, 0.6) }
        })
      })
    },
  },
  s6: {
    group: 'New',
    name: 'White labels',
    idea: 'the step number and the row name turn into white pills; the swatch itself is left alone',
    draw: pillLabels,
  },
  s7: {
    group: 'New',
    name: 'Pointers and white labels',
    idea: 'S2 and S6 together: a mark beside the swatch, and the two names it sits under and beside',
    draw: (g, row, col, hex) => {
      gaps(g, row, col, '▸', '◂', WHITE)
      pillLabels(g, row, col, hex)
    },
  },
  s8: {
    group: 'New',
    name: 'A tick in the swatch',
    idea: 'a ✓ in the middle of the chosen swatch, in its reading colour: plainly “this one”',
    draw: (g, row, col, hex) => onSwatch(g, row, col, 1, '✓', readsOn(hex), hex),
  },
  b1: {
    group: 'Before · all kept',
    name: 'Lines inside the swatch',
    idea: 'built 2026-10-25: │ on its first and last cell, in its reading colour',
    draw: (g, row, col, hex) => {
      onSwatch(g, row, col, 0, '│', readsOn(hex), hex)
      onSwatch(g, row, col, CELL - 1, '│', readsOn(hex), hex)
    },
  },
  b2: {
    group: 'Before · all kept',
    name: 'Thin frame in the gaps, white or near-black',
    idea: 'built 2026-10-24: ▕ ▏ either side; near-black only on a near-white swatch',
    draw: (g, row, col, hex) => gaps(g, row, col, '▕', '▏', frameOn(hex)),
  },
  b3: {
    group: 'Before · all kept',
    name: 'Thin frame in the gaps, text colour',
    idea: 'built 2026-10-14: ▕ ▏ either side in the text grey',
    draw: (g, row, col) => gaps(g, row, col, '▕', '▏', P.fg.toLowerCase()),
  },
}

/* ------------------------------------------------------------------- page */

const crop = (g: Grid): Grid => g.map((line) => line.slice(0, COLS))
const SCREENS: Record<string, string[]> = {}
for (const [id, look] of Object.entries(LOOKS))
  SCREENS[id] = SPOTS.map(({ row, col }) => {
    const g = base(row, col)
    look.draw(g, row, col, gridRowsIn[row]?.hexes[col] ?? '#000000')
    return gridHtml(crop(g), P)
  })

const chip = (id: string) => {
  const l = LOOKS[id] as (typeof LOOKS)[string]
  return `<button class="chip" data-id="${id}"><span class="w"><b>${id.toUpperCase()}</b> ${l.name}<span>${l.idea}</span></span></button>`
}
const group = (name: string) =>
  `<div class="grp">${name}</div>${Object.entries(LOOKS)
    .filter(([, l]) => l.group === name)
    .map(([id]) => chip(id))
    .join('')}`

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · colour: marking the chosen swatch</title>
<style>
  body { margin:0; background:#0d0e11; color:#e2e4ea; font:16px/1.6 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  main { max-width:1560px; margin:0 auto; padding:40px 24px 80px; }
  h1 { font-size:28px; margin:0 0 6px; }
  .lede { color:#8f94a1; margin:0 0 28px; max-width:900px; }
  .layout { display:flex; gap:36px; align-items:flex-start; }
  .views { display:grid; grid-template-columns:repeat(2, max-content); gap:18px; }
  .views .t { zoom:.9; }
  .vt { font:600 13px -apple-system,sans-serif; color:#8f94a1; margin:0 0 6px; }
  .picks { width:400px; flex:none; }
  .chips { display:flex; flex-direction:column; gap:8px; align-items:stretch; }
  .chip { font:500 14px -apple-system, sans-serif; color:#c7cbd4; background:#16181d; border:1px solid #2c2f37; border-radius:8px; padding:8px 12px; cursor:pointer; text-align:left; }
  .chip .w { display:flex; flex-direction:column; }
  .chip b { font:700 12px ui-monospace,Menlo,monospace; color:#55c7d9; margin-right:6px; }
  .chip span span { color:#8f94a1; font-size:13px; }
  .chip:hover { border-color:#4a4f5a; color:#fff; }
  .chip.on { border-color:#55c7d9; background:#12282e; color:#8fe3f0; }
  .grp { font:700 12px ui-monospace,Menlo,monospace; letter-spacing:.06em; text-transform:uppercase; color:#e5a23c; margin:14px 0 2px; }
  .grp:first-child { margin-top:0; }
  .status { font:13px "SF Mono", ui-monospace, Menlo, monospace; color:#8f94a1; margin-top:10px; }
  .copy { margin-top:14px; font:500 14px -apple-system, sans-serif; color:#c7cbd4; background:#16181d; border:1px solid #2c2f37; border-radius:8px; padding:8px 14px; cursor:pointer; }
  ${TERM_CSS}
</style></head><body><main>
<h1>Marking the chosen swatch</h1>
<p class="lede">Click a look on the right. The four grids change at once, each with a different swatch chosen, so you can judge it on light and dark. The highlighted one is your pick, and it saves on its own. The dot marks your own colour. Each grid is at 80 columns.</p>
<div class="layout">
  <div class="views">${SPOTS.map((s, i) => `<div><div class="vt">${s.label}</div><div class="t" style="background:${P.canvas}"><div class="screen" data-i="${i}"></div></div></div>`).join('')}</div>
  <div class="picks">
    <div class="chips">${group('New')}${group('Before · all kept')}</div>
    <button class="copy">Copy my pick</button>
    <div class="status"></div>
  </div>
</div>
<script>
const SCREENS = ${JSON.stringify(SCREENS)}
const PAGE = ${JSON.stringify(PAGE)}
let pick = 's1'
const status = document.querySelector('.status')
const label = () => document.querySelector('.chip[data-id="' + pick + '"] .w').innerText.split('\\n')[0]
function paint() {
  document.querySelectorAll('.screen').forEach((el) => { el.innerHTML = SCREENS[pick][Number(el.dataset.i)] })
  for (const c of document.querySelectorAll('.chip')) c.classList.toggle('on', c.dataset.id === pick)
}
async function save() {
  localStorage.setItem(PAGE, pick)
  if (!location.protocol.startsWith('http')) { status.textContent = 'kept in this browser · use Copy my pick'; return }
  try {
    const r = await fetch('/feedback/' + PAGE, { method: 'POST', body: JSON.stringify({ page: PAGE, pick, label: label() }) })
    status.textContent = r.ok ? 'saved · ' + new Date().toLocaleTimeString() : 'not saved · use Copy my pick'
  } catch { status.textContent = 'not saved · use Copy my pick' }
}
for (const c of document.querySelectorAll('.chip')) c.addEventListener('click', () => { pick = c.dataset.id; paint(); save() })
document.querySelector('.copy').addEventListener('click', async () => { await navigator.clipboard.writeText(PAGE + ' pick: ' + label()); status.textContent = 'copied · paste it to Claude' })
const linked = location.hash.match(/^#([sb][0-9]+)$/)
pick = linked ? linked[1] : localStorage.getItem(PAGE) || pick
paint()
</script>
</main></body></html>`

writeFileSync(`mockups/${PAGE}.html`, html)
console.log(`wrote mockups/${PAGE}.html`)
