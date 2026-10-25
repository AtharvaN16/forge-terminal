/**
 * /extensions: the space taken, round ten (2026-10-24). The user picked Forge
 * grey and the extensions cyan, then asked for the list and the size graphic
 * to be one frame. So the list sits in a frame whose last two rows are the
 * graphic. Open: how the frame is drawn (darker fill, lighter fill, or an
 * outline like the sheet's facts card) and whether the graphic runs to the
 * frame's edges or sits inset. Locked: grey and cyan, the tinted split, two
 * rows, the bottom level with "Already have yt-dlp?", the row over the field free.
 *
 * Round nine: scripts/extensions-space-mockup-r9.ts.
 *
 *   npx tsx scripts/extensions-space-mockup-r10.ts   → mockups/extensions-space-2026-10-round10.html
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
const _SHELF = '#242424'
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
const _ALL = '87 MB'

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

/* ------------------------------------------------------- the design */

const F_MB = 34.5
const E_MB = 52.0
/** Picked in round nine. */
const FORGE_C = '#a6a6a6'
const EXT_C = '#55c7d9'
/** The frame: its top level with the sheet's title, its bottom with "Already have yt-dlp?". */
const TOP = 4
const BOTTOM = 16
const L = X
const RIGHT = END

const pad = (text: string, n: number) => (text.length > n ? text.slice(0, n) : text.padEnd(n))
const split = (w: number) => {
  const nF = Math.round((F_MB / (F_MB + E_MB)) * w)
  return [nF, w - nF] as const
}

interface Look {
  id: string
  label: string
  /** The frame's fill; undefined for the outline. */
  fill?: string
  /** The cursor's band on that fill. */
  band: string
}
const LOOKS: Look[] = [
  { id: 'dark', label: 'Darker fill', fill: '#242424', band: '#323232' },
  // Between the two (2026-10-24). The exact middle is the panel's own #2c2c2c,
  // which hides the frame, so one step either side of it.
  { id: 'mid-dark', label: 'Between · a shade darker', fill: '#282828', band: '#353535' },
  { id: 'mid-light', label: 'Between · a shade lighter', fill: '#303030', band: '#3b3b3b' },
  { id: 'light', label: 'Lighter fill', fill: '#333333', band: '#3e3e3e' },
  { id: 'line', label: 'Outline, like the facts card', band: BAND },
]
const EDGES = [
  { id: 'flush', label: 'Runs to the frame’s edges' },
  { id: 'inset', label: 'Inset, a cell of room around it' },
]

function framed(items: Item[], look: Look, inset: boolean): Grid {
  const g = G('yt')
  // Clear the captured list.
  for (let r = 4; r <= 17; r++) put(g, r, 4, [[' '.repeat(32), undefined, PANEL]])
  const line = !look.fill
  const ground = look.fill ?? PANEL
  if (look.fill)
    for (let r = TOP; r <= BOTTOM; r++) put(g, r, L, [[' '.repeat(COL), undefined, look.fill]])
  else {
    put(g, TOP, L, [[`╭${'─'.repeat(COL - 2)}╮`, QUIET]])
    for (let r = TOP + 1; r < BOTTOM; r++) {
      put(g, r, L, [['│', QUIET]])
      put(g, r, RIGHT, [['│', QUIET]])
    }
    put(g, BOTTOM, L, [[`╰${'─'.repeat(COL - 2)}╯`, QUIET]])
  }
  // Inside: the outline takes a cell each side and the rows it is drawn on.
  const inL = line ? L + 1 : L
  const inW = line ? COL - 2 : COL
  const inTop = TOP + 1
  const inBottom = line ? BOTTOM - 1 : BOTTOM

  // The graphic: two rows at the bottom of the inside, flush or a cell in.
  const gL = inset ? inL + 1 : inL
  const gW = inset ? inW - 2 : inW
  const gBottom = inset ? inBottom - 1 : inBottom
  const [nF, nE] = split(gW)
  const tint = (c: string) => mix(ground, c, 0.26)
  put(g, gBottom - 1, gL, [
    [pad(' Forge', nF), FORGE_C, tint(FORGE_C), true],
    [pad(' Extensions', nE), EXT_C, tint(EXT_C), true],
  ])
  put(g, gBottom, gL, [
    [pad(` ${FORGE}`, nF), FG, tint(FORGE_C)],
    [pad(` ${EXTS}`, nE), FG, tint(EXT_C)],
  ])

  // The list: from a row under the top to a row clear of the graphic.
  const from = inTop
  const to = gBottom - 3
  const room = to - from + 1
  const shown = items.length > room ? items.slice(0, room - 1) : items
  const markAt = inL + inW - 2
  shown.forEach((it, i) => {
    const r = from + i
    if (it.name === CURSOR) {
      put(g, r, inL, [[' '.repeat(inW), undefined, look.band]])
      put(g, r, inL, [['▌', GOLD], [' '], [it.name, FG, undefined, true]])
    } else put(g, r, inL + 2, [[it.name, DIM]])
    if (it.mark) put(g, r, markAt, [[it.mark, it.name === CURSOR ? FG : DIM]])
  })
  if (items.length > room) {
    const more = `↓ ${items.length - shown.length} more`
    put(g, to, markAt + 1 - more.length, [[more, QUIET]])
  }
  // No rule between the list and the sheet (2026-10-24): the frame divides them.
  for (let r = 4; r <= 17; r++) (g[r] as Cell[])[36] = { ch: ' ', bg: PANEL }
  return g
}

const shot = (g: Grid) => termHtml(P, g)
const screens = Object.fromEntries(
  LOOKS.flatMap((l) =>
    EDGES.map((e) => [
      `${l.id}|${e.id}`,
      `<figure class="fr">${shot(framed(SHORT, l, e.id === 'inset'))}<figcaption>today’s four</figcaption></figure>` +
        `<figure class="fr">${shot(framed(LONG, l, e.id === 'inset'))}<figcaption>sixteen — the list scrolls inside the frame</figcaption></figure>`,
    ]),
  ),
)

const PAGE = 'extensions-space-r10'
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · space, round 10</title>
<style>
  body { margin:0; background:#0d0e11; color:#e2e4ea; font:15px/1.5 -apple-system, BlinkMacSystemFont, sans-serif; }
  main { max-width:1100px; margin:0 auto; padding:40px 24px 80px; }
  h1 { font-size:26px; margin:0 0 6px; }
  .lede { color:#a9aebb; margin:0 0 22px; }
  .q { position:sticky; top:0; z-index:2; background:#0d0e11; padding:14px 0 12px; }
  .qt { font-weight:600; margin:0 0 10px; }
  .chips { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  .chip { font:500 14px -apple-system, sans-serif; color:#c7cbd4; background:#16181d; border:1px solid #2c2f37; border-radius:8px; padding:7px 12px; cursor:pointer; }
  .chip.on { border-color:#55c7d9; background:#12282e; color:#8fe3f0; }
  .status { color:#8f94a1; font-size:13px; margin-left:12px; }
  .screens { display:flex; flex-direction:column; gap:16px; margin-top:12px; }
  .fr { margin:0; display:flex; flex-direction:column; gap:6px; }
  .fr figcaption { font-size:13px; color:#a9aebb; }
  ${TERM_CSS}
</style></head><body><main>
<h1>/extensions — the list and the size graphic as one frame</h1>
<p class="lede">Forge grey, extensions cyan, as you picked. The list and the graphic now share one frame: its top level with “YouTube links”, its bottom with “Already have yt-dlp?”, the row above the field free. Pick how the frame is drawn and where the graphic sits in it.</p>
<div class="q"><div class="qt">1. The frame</div><div class="chips">${LOOKS.map(
  (l) => `<button class="chip" data-name="look" data-id="${l.id}">${l.label}</button>`,
).join('')}</div>
<div class="qt" style="margin-top:14px">2. The graphic</div><div class="chips">${EDGES.map(
  (e) => `<button class="chip" data-name="edge" data-id="${e.id}">${e.label}</button>`,
).join('')}<span class="status"></span></div></div>
<div class="screens" id="screens"></div>
<script>
const SCREENS = ${JSON.stringify(screens)}
const PAGE = '${PAGE}'
let state = Object.assign({ look: 'dark', edge: 'flush' }, JSON.parse(localStorage.getItem(PAGE) || '{}'))
const status = document.querySelector('.status')
const label = (name) => document.querySelector('.chip[data-name="' + name + '"][data-id="' + state[name] + '"]').textContent
function paint() {
  document.getElementById('screens').innerHTML = SCREENS[state.look + '|' + state.edge]
  for (const c of document.querySelectorAll('.chip')) c.classList.toggle('on', state[c.dataset.name] === c.dataset.id)
}
async function save() {
  localStorage.setItem(PAGE, JSON.stringify(state))
  if (!location.protocol.startsWith('http')) { status.textContent = 'kept in this browser'; return }
  try {
    const r = await fetch('/feedback/' + PAGE, { method: 'POST', body: JSON.stringify({ page: PAGE, picks: { frame: label('look'), graphic: label('edge') } }) })
    status.textContent = r.ok ? 'saved · ' + new Date().toLocaleTimeString() : 'not saved'
  } catch { status.textContent = 'not saved' }
}
for (const c of document.querySelectorAll('.chip')) c.addEventListener('click', () => { state[c.dataset.name] = c.dataset.id; paint(); save() })
paint()
</script>
</main></body></html>`

writeFileSync('mockups/extensions-space-2026-10-round10.html', html)
console.log('wrote mockups/extensions-space-2026-10-round10.html')
if (process.env.DUMP)
  for (const l of LOOKS)
    for (const inset of [false, true]) {
      console.log(`--- ${l.id} ${inset ? 'inset' : 'flush'}`)
      for (const r of framed(LONG, l, inset).slice(3, 18))
        console.log(
          r
            .slice(4, 40)
            .map((c) => c.ch)
            .join(''),
        )
    }
