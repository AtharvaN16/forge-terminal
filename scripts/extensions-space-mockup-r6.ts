/**
 * /extensions: the space taken, round six (2026-10-23). The user, on round
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
 *   npx tsx scripts/extensions-space-mockup-r6.ts   → mockups/extensions-space-2026-10-round6.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
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
const APP = '#a6a6a6'
const EXT = '#5c5c5c'
/** The frame's bottom edge: level with the sheet's last line; row 17, over the field, stays free. */
const BOTTOM = 16
/** Inside the frame: two cells in from each side. */
const IN_L = X + 2
const IN_W = COL - 3

type Graphic = 'none' | 'line' | 'bar' | 'bars' | 'blocks'

/**
 * The size frame, padded a row inside each edge, with `graphic` drawn in it.
 * Rows from the top: padding, the graphic's rows, the figures, padding.
 */
function sized(items: Item[], fill: string, graphic: Graphic): Grid {
  const g = G('yt')
  const rows: Array<(r: number) => void> = []
  const label = (r: number, text: string, value: string, bold = false, mark?: string) => {
    if (mark)
      put(g, r, IN_L, [
        ['▀', mark, fill],
        [' ', undefined, fill],
      ])
    put(g, r, IN_L + (mark ? 2 : 0), [[text, bold ? FG : QUIET, fill, bold]])
    atEnd(g, r, [[value, bold ? FG : DIM, fill, bold]])
  }
  const blank = () => rows.push(() => {})
  const split = (w: number) => {
    const nF = Math.round((F_MB / (F_MB + E_MB)) * w)
    return [nF, w - nF] as const
  }
  if (graphic === 'none') {
    rows.push((r) => label(r, 'Forge', FORGE))
    rows.push((r) => label(r, 'Extensions', EXTS))
    blank()
    rows.push((r) => label(r, 'Total', ALL, true))
  } else if (graphic === 'line') {
    // A thin line in the blank between the parts and the total: ▄, half a cell tall.
    rows.push((r) => label(r, 'Forge', FORGE, false, APP))
    rows.push((r) => label(r, 'Extensions', EXTS, false, EXT))
    rows.push((r) => {
      const [nF, nE] = split(IN_W)
      put(g, r, IN_L, [
        ['▄'.repeat(nF), APP, fill],
        ['▄'.repeat(nE), EXT, fill],
      ])
    })
    rows.push((r) => label(r, 'Total', ALL, true))
  } else if (graphic === 'bar') {
    // One full bar on top, a cell's gap between its parts; the figures under it.
    rows.push((r) => {
      const [nF, nE] = split(IN_W - 1)
      put(g, r, IN_L, [
        [' '.repeat(nF), undefined, APP],
        [' ', undefined, fill],
        [' '.repeat(nE), undefined, EXT],
      ])
    })
    blank()
    rows.push((r) => label(r, 'Forge', FORGE, false, APP))
    rows.push((r) => label(r, 'Extensions', EXTS, false, EXT))
    blank()
    rows.push((r) => label(r, 'Total', ALL, true))
  } else if (graphic === 'bars') {
    // A short bar beside each figure, against the total.
    const W = 6
    const bar = (r: number, text: string, value: string, mb: number, colour: string) => {
      label(r, text, value)
      const n = Math.max(1, Math.round((mb / (F_MB + E_MB)) * W))
      put(g, r, IN_L + 11, [
        ['▄'.repeat(n), colour, fill],
        ['▄'.repeat(W - n), '#3a3a3a', fill],
      ])
    }
    rows.push((r) => bar(r, 'Forge', FORGE, F_MB, APP))
    rows.push((r) => bar(r, 'Extensions', EXTS, E_MB, EXT))
    blank()
    rows.push((r) => label(r, 'Total', ALL, true))
  } else {
    // Blocks: one ▀ for every 5 MB, a gap between each, Forge's first.
    rows.push((r) => {
      const f = Math.round(F_MB / 5)
      const e = Math.round(E_MB / 5)
      const cells = [...Array(f).fill(APP), ...Array(e).fill(EXT)] as string[]
      const perRow = Math.floor((IN_W + 1) / 2)
      cells.forEach((c, i) => {
        put(g, r + Math.floor(i / perRow), IN_L + (i % perRow) * 2, [['▀', c, fill]])
      })
    })
    blank()
    blank()
    rows.push((r) => label(r, 'Forge', FORGE, false, APP))
    rows.push((r) => label(r, 'Extensions', EXTS, false, EXT))
    blank()
    rows.push((r) => label(r, 'Total', ALL, true))
  }
  const top = BOTTOM - rows.length - 1
  list(g, items, 4, top - 2)
  for (let r = top; r <= BOTTOM; r++) put(g, r, X, [[' '.repeat(COL), undefined, fill]])
  rows.forEach((draw, i) => {
    draw(top + 1 + i)
  })
  for (let r = 4; r <= BOTTOM; r++) (g[r] as Cell[])[36] = { ch: '│', fg: FAINT }
  return g
}

const SHADES: Array<{ id: string; label: string; fill: string }> = [
  { id: 'field', label: 'The field’s grey', fill: SHELF },
  { id: 'darker', label: 'A step darker', fill: '#272727' },
  { id: 'lighter', label: 'A step lighter', fill: '#313131' },
  { id: 'light', label: 'Lighter still', fill: '#363636' },
]
const GRAPHICS: Array<{ id: Graphic; label: string }> = [
  { id: 'none', label: 'None — the figures alone' },
  { id: 'line', label: 'A thin line over the total' },
  { id: 'bar', label: 'One bar on top' },
  { id: 'bars', label: 'A short bar by each figure' },
  { id: 'blocks', label: 'Blocks, one per 5 MB' },
]

const shot = (g: Grid) => termHtml(P, g)
const screens = Object.fromEntries(
  SHADES.flatMap((s) =>
    GRAPHICS.map((gr) => [
      `${s.id}|${gr.id}`,
      `<figure class="fr">${shot(sized(SHORT, s.fill, gr.id))}<figcaption>today’s four</figcaption></figure>` +
        `<figure class="fr">${shot(sized(LONG, s.fill, gr.id))}<figcaption>sixteen — the list scrolls above the frame</figcaption></figure>`,
    ]),
  ),
)

const PAGE = 'extensions-space-r6'
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · space, round 6</title>
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
<p class="lede">The frame now has padding — a row inside each edge — its bottom edge level with “Already have yt-dlp?”, the row above the field free. Try a graphic of Forge against its extensions, or none; and the frame’s grey.</p>
<div class="box">Two picks below; both screens repaint as you click. The panel around the frame is #2c2c2c; the cursor’s band is #323232.</div>
<div class="q"><div class="qt">1. The frame’s grey</div><div class="chips">${SHADES.map(
  (s) =>
    `<button class="chip" data-name="shade" data-id="${s.id}"><span class="sw" style="background:${s.fill}"></span>${s.label}</button>`,
).join('')}</div>
<div class="qt" style="margin-top:14px">2. A graphic in the frame</div><div class="chips">${GRAPHICS.map(
  (gr) => `<button class="chip" data-name="graphic" data-id="${gr.id}">${gr.label}</button>`,
).join('')}<span class="status"></span></div></div>
<div class="screens" id="screens"></div>
<script>
const SCREENS = ${JSON.stringify(screens)}
const PAGE = '${PAGE}'
let state = Object.assign({ shade: 'field', graphic: 'line' }, JSON.parse(localStorage.getItem(PAGE) || '{}'))
const status = document.querySelector('.status')
const label = (name) => document.querySelector('.chip[data-name="' + name + '"][data-id="' + state[name] + '"]').textContent
function paint() {
  document.getElementById('screens').innerHTML = SCREENS[state.shade + '|' + state.graphic]
  for (const c of document.querySelectorAll('.chip')) c.classList.toggle('on', state[c.dataset.name] === c.dataset.id)
}
async function save() {
  localStorage.setItem(PAGE, JSON.stringify(state))
  if (!location.protocol.startsWith('http')) { status.textContent = 'kept in this browser'; return }
  try {
    const r = await fetch('/feedback/' + PAGE, { method: 'POST', body: JSON.stringify({ page: PAGE, picks: { grey: label('shade'), graphic: label('graphic') } }) })
    status.textContent = r.ok ? 'saved · ' + new Date().toLocaleTimeString() : 'not saved'
  } catch { status.textContent = 'not saved' }
}
for (const c of document.querySelectorAll('.chip')) c.addEventListener('click', () => { state[c.dataset.name] = c.dataset.id; paint(); save() })
paint()
</script>
</main></body></html>`

writeFileSync('mockups/extensions-space-2026-10-round6.html', html)
console.log('wrote mockups/extensions-space-2026-10-round6.html')
if (process.env.DUMP)
  for (const gr of GRAPHICS) {
    const rows = sized(LONG, SHELF, gr.id)
      .slice(3, 19)
      .map((r) =>
        r
          .slice(4, 40)
          .map((c) => c.ch)
          .join(''),
      )
    console.log([gr.id, ...rows].join(String.fromCharCode(10)))
  }
