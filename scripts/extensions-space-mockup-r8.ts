/**
 * /extensions: the space taken, round eight (2026-10-23). "More options, and
 * use colour if you use graphics — the entire box can be a graphic." So the
 * frame itself is the chart: split, tinted or bordered by size, three or four
 * rows. Forge in its gold; the extensions in a second colour picked from the
 * modes' own (cyan, purple, red), never more than the two.
 *
 * Round seven (2026-10-23). "It needs to be
 * smaller — I want graphics so the frame is smaller." So the graphic now does
 * the work of the rows: every option is three or four rows with its padding
 * (round six's were six to nine). Still Forge against its extensions only,
 * the bottom edge level with the sheet's last line, the row over the field free.
 *
 * Round six (2026-10-23). The user, on round
 * five's tight frame: "I need padding and also maybe a graphical
 * visualization". So the frame is padded — a row inside each edge, its
 * bottom edge level with the sheet's last line, the row over the field free
 * — and a second chip row tries four quiet graphics of the one split there
 * is, Forge against its extensions, beside none at all. The grey stays open.
 *
 * Round five (2026-10-23). On D2's long-list
 * screen the user asked to keep the row above the text field free, line the
 * size area up with the text on the right, put it in its own frame of a
 * different grey, and move it up. No size per extension (round three), so
 * the rows keep their ✓.
 *
 * One design; the frame's grey is the open question, picked with a row of
 * chips that repaints both screens in place (memory: shade picks get a live
 * picker, not grids). The pick is saved to mockups/feedback/extensions-space-r5.json.
 *
 *   npx tsx scripts/extensions-space-mockup-r8.ts   → mockups/extensions-space-2026-10-round8.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { mix } from '../src/shell/home-art.js'
import { DARK, modePalette } from '../src/shell/theme.js'
import { type Cell, type Grid, TERM_CSS, termHtml } from './term-cells.js'

type Raw = { ch: string; fg: string | null; bg: string | null; b: boolean }
const frames = JSON.parse(
  readFileSync(new URL('./extensions-space-frames.json', import.meta.url), 'utf8'),
) as Record<string, Raw[][]>
const G = (k: string): Grid =>
  (frames[k] as Raw[][]).map((r) =>
    r.map((c) => ({ ch: c.ch, fg: c.fg ?? undefined, bg: c.bg ?? undefined, b: c.b })),
  )

const P = modePalette(DARK, 'menu')
const FG = '#e7e7e7'
const DIM = '#b0b0b0'
const QUIET = '#808080'
const FAINT = '#4d4d4d'
const GOLD = '#e5a23c'
const PANEL = '#2c2c2c'
const BAND = '#323232'
const _CANVAS = '#1e1e1e'
const SHELF = '#242424'
const N = 100
const _R = N - 4

type Seg = [text: string, fg?: string, bg?: string, bold?: boolean]
const len = (segs: Seg[]) => segs.reduce((n, [t]) => n + [...t].length, 0)
function put(g: Grid, r: number, at: number, segs: Seg[]): void {
  const row = g[r] as Cell[]
  let i = at
  for (const [text, fg, bg, bold] of segs)
    for (const ch of text) {
      const under = row[i]
      if (under) row[i] = { ch, fg, bg: bg ?? under.bg, b: !!bold }
      i++
    }
}
const _textOf = (g: Grid, r: number) => (g[r] as Cell[]).map((c) => c.ch).join('')

/** The list's column: names at 10, the cursor's band 8–34, the mark at 33. */
const X = 8
const COL = 27
const END = X + COL - 1
const atEnd = (g: Grid, r: number, segs: Seg[]) => put(g, r, END - len(segs), segs)
const _rule = (g: Grid, r: number) => put(g, r, X + 2, [['─'.repeat(COL - 3), FAINT]])

const FORGE = '35 MB'
const EXTS = '52 MB'
const ALL = '87 MB'

interface Item {
  name: string
  mark?: string
  size?: string
}
/** Today's four, as installed for the capture. */
const SHORT: Item[] = [
  { name: 'Boost resolution', mark: '✓', size: '15 MB' },
  { name: 'Remove background', mark: '✓', size: '33 KB' },
  { name: 'YouTube links', mark: '✓', size: '37 MB' },
  { name: 'Video and audio', mark: '✓', size: 'yours' },
]
/** Sixteen: today's, then tools Forge might offer later — placeholders, to see the list grow. */
const LONG: Item[] = [
  ...SHORT,
  { name: 'HEIC photos' },
  { name: 'Word documents', mark: '✓', size: 'yours' },
  { name: 'PDF compression' },
  { name: 'Text in images' },
  { name: 'Denoise audio' },
  { name: 'Upscale video' },
  { name: 'Subtitles' },
  { name: 'RAW photos' },
  { name: 'Voices' },
  { name: 'Colour profiles' },
  { name: 'Fonts' },
  { name: 'Archives' },
]
const CURSOR = 'YouTube links'

/**
 * The list redrawn on rows `from`–`to`: as many items as fit, the cursor's
 * band and gold bar on CURSOR, and — when some do not fit — the last row
 * says how many more, as the / menu's list does.
 */
function list(
  g: Grid,
  items: Item[],
  from: number,
  to: number,
  o: { sizes?: boolean; cursor?: string } = {},
) {
  for (let r = 4; r <= 17; r++) put(g, r, 4, [[' '.repeat(32), undefined, PANEL]])
  const room = to - from + 1
  const shown = items.length > room ? items.slice(0, room - 1) : items
  const on = o.cursor ?? CURSOR
  shown.forEach((it, i) => {
    const r = from + i
    if (it.name === on) {
      put(g, r, X, [[' '.repeat(COL), undefined, BAND]])
      put(g, r, X, [['▌', GOLD], [' '], [it.name, FG, undefined, true]])
    } else put(g, r, X + 2, [[it.name, DIM]])
    const right = o.sizes ? it.size : it.mark
    if (right) atEnd(g, r, [[right, it.name === on ? FG : o.sizes ? QUIET : DIM]])
  })
  if (items.length > room) {
    const more = `↓ ${items.length - shown.length} more`
    atEnd(g, to, [[more, QUIET]])
  }
  // The rule between list and sheet runs as far down as the list does.
  for (let r = 4; r <= Math.max(to, 4); r++) (g[r] as Cell[])[36] = { ch: '│', fg: FAINT }
}

/* ------------------------------------------------------- the design */

/** Forge and Extensions, in megabytes, for the graphics' proportions. */
const F_MB = 34.5
const E_MB = 52.0
/** Forge itself: the lighter grey; the extensions: the darker. */
const _APP = '#a6a6a6'
const _EXT = '#5c5c5c'
/** The frame's bottom edge: level with the sheet's last line; row 17, over the field, stays free. */
const BOTTOM = 16
/** Inside the frame: two cells in from each side. */
const IN_L = X + 2
const IN_W = COL - 3

type Graphic = 'tinted' | 'solid' | 'boxes' | 'halves' | 'floor' | 'pills' | 'stripe'

/** Forge's colour: the brand's gold. */
const FORGE_C = GOLD
const INK = '#0c1d22'
/** A colour as a dark tint on the panel, for a fill words sit on. */
const tint = (c: string) => mix(PANEL, c, 0.26)

/** The two parts across `w` cells, by size. */
const split = (w: number) => {
  const nF = Math.round((F_MB / (F_MB + E_MB)) * w)
  return [nF, w - nF] as const
}
/** `text` padded or cut to exactly `n` cells. */
const pad = (text: string, n: number) => (text.length > n ? text.slice(0, n) : text.padEnd(n))

/**
 * The size frame as a graphic: the whole box drawn by `graphic`, in Forge's
 * gold and the extensions' colour `ext`, its bottom edge on row 16, `rows` tall.
 */
function sized(items: Item[], fill: string, graphic: Graphic, ext: string): Grid {
  const g = G('yt')
  const rows = graphic === 'boxes' || graphic === 'tinted' || graphic === 'solid' ? 4 : 3
  const top = BOTTOM - rows + 1
  list(g, items, 4, top - 2)
  const [nF, nE] = split(COL)
  const rowAt = (i: number) => top + i
  if (graphic === 'tinted' || graphic === 'solid') {
    // The whole box split by size: Forge's part, then the extensions'.
    const solid = graphic === 'solid'
    const fb = solid ? FORGE_C : tint(FORGE_C)
    const eb = solid ? ext : tint(ext)
    const ft = solid ? INK : FORGE_C
    const et = solid ? INK : ext
    const v = solid ? INK : FG
    for (let i = 0; i < rows; i++) {
      put(g, rowAt(i), X, [
        [' '.repeat(nF), undefined, fb],
        [' '.repeat(nE), undefined, eb],
      ])
    }
    put(g, rowAt(1), X + 1, [[pad('Forge', nF - 2), ft, fb, true]])
    put(g, rowAt(1), X + nF + 1, [[pad('Extensions', nE - 2), et, eb, true]])
    put(g, rowAt(2), X + 1, [[pad(FORGE, nF - 2), v, fb]])
    put(g, rowAt(2), X + nF + 1, [[pad(EXTS, nE - 2), v, eb]])
  } else if (graphic === 'boxes') {
    // A treemap: two boxes side by side, each as wide as its part, edged in its colour.
    const draw = (x: number, w: number, c: string, name: string, size: string) => {
      put(g, rowAt(0), x, [[`╭${'─'.repeat(w - 2)}╮`, c]])
      put(g, rowAt(1), x, [
        ['│', c],
        [pad(` ${name}`, w - 2), c, undefined, true],
        ['│', c],
      ])
      put(g, rowAt(2), x, [
        ['│', c],
        [pad(` ${size}`, w - 2), FG],
        ['│', c],
      ])
      put(g, rowAt(3), x, [[`╰${'─'.repeat(w - 2)}╯`, c]])
    }
    draw(X, nF, FORGE_C, 'Forge', FORGE)
    draw(X + nF, nE, ext, 'Extensions', EXTS)
  } else if (graphic === 'halves') {
    // One box, its edge split by size: gold over Forge's part, the second colour over the rest.
    const lw = nF
    const rw = nE
    put(g, rowAt(0), X, [
      [`╭─ Forge ${'─'.repeat(Math.max(0, lw - 9))}`, FORGE_C],
      [`┬─ Extensions ${'─'.repeat(Math.max(0, rw - 15))}╮`, ext],
    ])
    put(g, rowAt(1), X, [
      ['│', FORGE_C],
      [pad(` ${FORGE}`, lw - 1), FG, fill],
      ['│', ext],
      [pad(` ${EXTS}`, rw - 2), FG, fill],
      ['│', ext],
    ])
    put(g, rowAt(2), X, [
      [`╰${'─'.repeat(lw - 1)}`, FORGE_C],
      [`┴${'─'.repeat(rw - 2)}╯`, ext],
    ])
  } else if (graphic === 'floor') {
    // A neutral box whose floor is the chart: its last row's lower half in the two colours.
    for (let i = 0; i < rows; i++) put(g, rowAt(i), X, [[' '.repeat(COL), undefined, fill]])
    put(g, rowAt(1), IN_L, [
      ['Forge ', QUIET, fill],
      ['35', FORGE_C, fill, true],
      ['  Ext ', QUIET, fill],
      ['52', ext, fill, true],
    ])
    atEnd(g, rowAt(1), [[ALL, FG, fill, true]])
    put(g, rowAt(2), X, [
      ['▄'.repeat(nF), FORGE_C, fill],
      ['▄'.repeat(nE), ext, fill],
    ])
  } else if (graphic === 'pills') {
    // A neutral padded box holding one bar of two coloured pills, named and sized inside.
    for (let i = 0; i < rows; i++) put(g, rowAt(i), X, [[' '.repeat(COL), undefined, fill]])
    const [f, e] = split(IN_W)
    put(g, rowAt(1), IN_L, [
      [pad(` Forge ${Math.round(F_MB)}`, f), INK, FORGE_C, true],
      [pad(` Extensions ${Math.round(E_MB)}`, e), INK, ext, true],
    ])
  } else {
    // stripe: the box's left edge, a full-height stripe split top to bottom by size, the words beside it.
    for (let i = 0; i < rows; i++) put(g, rowAt(i), X, [[' '.repeat(COL), undefined, fill]])
    put(g, rowAt(0), X, [['▌', FORGE_C, fill]])
    put(g, rowAt(1), X, [['▌', FORGE_C, fill]])
    put(g, rowAt(2), X, [['▌', ext, fill]])
    put(g, rowAt(0), IN_L, [['Forge', FORGE_C, fill, true]])
    atEnd(g, rowAt(0), [[FORGE, FG, fill]])
    put(g, rowAt(1), IN_L, [['Extensions', ext, fill, true]])
    atEnd(g, rowAt(1), [[EXTS, FG, fill]])
    put(g, rowAt(2), IN_L, [['Total', QUIET, fill]])
    atEnd(g, rowAt(2), [[ALL, FG, fill, true]])
  }
  for (let r = 4; r <= BOTTOM; r++) (g[r] as Cell[])[36] = { ch: '│', fg: FAINT }
  return g
}

const EXT_COLOURS: Array<{ id: string; label: string; colour: string }> = [
  { id: 'cyan', label: 'Cyan (convert’s)', colour: '#55c7d9' },
  { id: 'purple', label: 'Purple (edit’s)', colour: '#b39ae8' },
  { id: 'red', label: 'Red (transcribe’s)', colour: '#e8796d' },
  { id: 'grey', label: 'Grey — gold only for Forge', colour: '#8c8c8c' },
]

const SHADES: Array<{ id: string; label: string; fill: string }> = [
  { id: 'field', label: 'The field’s grey', fill: SHELF },
  { id: 'darker', label: 'A step darker', fill: '#272727' },
  { id: 'lighter', label: 'A step lighter', fill: '#313131' },
  { id: 'light', label: 'Lighter still', fill: '#363636' },
]
const GRAPHICS: Array<{ id: Graphic; label: string }> = [
  { id: 'tinted', label: 'The box split, tinted · 4 rows' },
  { id: 'solid', label: 'The box split, solid · 4 rows' },
  { id: 'boxes', label: 'Two boxes, sized (treemap) · 4 rows' },
  { id: 'halves', label: 'One box, edges split by size · 3 rows' },
  { id: 'floor', label: 'The box’s floor is the bar · 3 rows' },
  { id: 'pills', label: 'Two coloured pills, named inside · 3 rows' },
  { id: 'stripe', label: 'A coloured edge, words beside · 3 rows' },
]

const shot = (g: Grid) => termHtml(P, g)
const screens = Object.fromEntries(
  SHADES.flatMap((s) =>
    GRAPHICS.flatMap((gr) =>
      EXT_COLOURS.map((c) => [
        `${s.id}|${gr.id}|${c.id}`,
        `<figure class="fr">${shot(sized(SHORT, s.fill, gr.id, c.colour))}<figcaption>today’s four</figcaption></figure>` +
          `<figure class="fr">${shot(sized(LONG, s.fill, gr.id, c.colour))}<figcaption>sixteen — the list scrolls above it</figcaption></figure>`,
      ]),
    ),
  ),
)

const PAGE = 'extensions-space-r8'
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · space, round 8</title>
<style>
  body { margin:0; background:#0d0e11; color:#e2e4ea; font:15px/1.5 -apple-system, BlinkMacSystemFont, sans-serif; }
  main { max-width:1100px; margin:0 auto; padding:40px 24px 80px; }
  h1 { font-size:26px; margin:0 0 6px; }
  .lede { color:#a9aebb; margin:0 0 22px; }
  .box { background:#14161a; border:1px solid #23252c; border-radius:12px; padding:16px 20px; margin:0 0 20px; }
  .box ul { margin:6px 0 0; padding-left:20px; color:#d6d9e0; }
  .q { position:sticky; top:0; z-index:2; background:#0d0e11; padding:14px 0 12px; }
  .qt { font-weight:600; margin:0 0 10px; }
  .chips { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  .chip { font:500 14px -apple-system, sans-serif; color:#c7cbd4; background:#16181d; border:1px solid #2c2f37; border-radius:8px; padding:7px 12px; cursor:pointer; display:flex; align-items:center; gap:8px; }
  .chip.on { border-color:#55c7d9; background:#12282e; color:#8fe3f0; }
  .sw { width:14px; height:14px; border-radius:3px; border:1px solid #555; }
  .status { color:#8f94a1; font-size:13px; margin-left:12px; }
  .screens { display:flex; flex-direction:column; gap:16px; margin-top:12px; }
  .fr { margin:0; display:flex; flex-direction:column; gap:6px; }
  .fr figcaption { font-size:13px; color:#a9aebb; }
  ${TERM_CSS}
</style></head><body><main>
<h1>/extensions — the size frame</h1>
<p class="lede">The box is the graphic now: split, tinted or edged by size, three or four rows. Forge in its gold; pick the extensions’ colour. The bottom edge stays level with “Already have yt-dlp?”, the row above the field free.</p>
<div class="box">Two picks below; both screens repaint as you click. The panel around the frame is #2c2c2c; the cursor’s band is #323232.</div>
<div class="q"><div class="qt">1. The box</div><div class="chips">${GRAPHICS.map(
  (gr) => `<button class="chip" data-name="graphic" data-id="${gr.id}">${gr.label}</button>`,
).join('')}</div>
<div class="qt" style="margin-top:14px">2. The extensions’ colour <span style="color:#8f94a1;font-weight:400">— Forge is gold</span></div><div class="chips">${EXT_COLOURS.map(
  (c) =>
    `<button class="chip" data-name="colour" data-id="${c.id}"><span class="sw" style="background:${c.colour}"></span>${c.label}</button>`,
).join('')}</div>
<div class="qt" style="margin-top:14px">3. The grey, where the box has one</div><div class="chips">${SHADES.map(
  (sh) =>
    `<button class="chip" data-name="shade" data-id="${sh.id}"><span class="sw" style="background:${sh.fill}"></span>${sh.label}</button>`,
).join('')}<span class="status"></span></div></div>
<div class="screens" id="screens"></div>
<script>
const SCREENS = ${JSON.stringify(screens)}
const PAGE = '${PAGE}'
let state = Object.assign({ shade: 'field', graphic: 'tinted', colour: 'cyan' }, JSON.parse(localStorage.getItem(PAGE) || '{}'))
const status = document.querySelector('.status')
const label = (name) => document.querySelector('.chip[data-name="' + name + '"][data-id="' + state[name] + '"]').textContent
function paint() {
  document.getElementById('screens').innerHTML = SCREENS[state.shade + '|' + state.graphic + '|' + state.colour]
  for (const c of document.querySelectorAll('.chip')) c.classList.toggle('on', state[c.dataset.name] === c.dataset.id)
}
async function save() {
  localStorage.setItem(PAGE, JSON.stringify(state))
  if (!location.protocol.startsWith('http')) { status.textContent = 'kept in this browser'; return }
  try {
    const r = await fetch('/feedback/' + PAGE, { method: 'POST', body: JSON.stringify({ page: PAGE, picks: { box: label('graphic'), colour: label('colour'), grey: label('shade') } }) })
    status.textContent = r.ok ? 'saved · ' + new Date().toLocaleTimeString() : 'not saved'
  } catch { status.textContent = 'not saved' }
}
for (const c of document.querySelectorAll('.chip')) c.addEventListener('click', () => { state[c.dataset.name] = c.dataset.id; paint(); save() })
paint()
</script>
</main></body></html>`

writeFileSync('mockups/extensions-space-2026-10-round8.html', html)
console.log('wrote mockups/extensions-space-2026-10-round8.html')
if (process.env.DUMP)
  for (const gr of GRAPHICS) {
    const rows = sized(SHORT, SHELF, gr.id, '#55c7d9')
      .slice(3, 19)
      .map((r) =>
        r
          .slice(4, 40)
          .map((c) => c.ch)
          .join(''),
      )
    console.log([gr.id, ...rows].join(String.fromCharCode(10)))
  }
