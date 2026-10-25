/**
 * Round 3 (2026-10-24): "use enter for done, and show me options of
 * different greys, remove the thick concepts". A live picker: round 2's thin
 * concepts (T1–T5) with ↵ done for m done, and the greys the app already
 * uses for the band (or T5's outline). A click repaints the screen and the
 * close-up, and saves the pick.
 *
 * Round 2: one-row frames (T1–T4) and a thin outline (T5).
 * Round 1: three-row frames as Done's way on (F1–F3), now dropped.
 *
 * The screen under it is the Palette tab as built (dev), captured by
 * scripts/palette-steps-capture.tsx at 80 × 26.
 *
 *   npx tsx scripts/palette-steps-frame-mockup-r3.ts → mockups/palette-steps-frame-2026-10-round3.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { DARK, modeColours, modePalette } from '../src/shell/theme.js'
import { type Cell, type Grid, gridHtml, TERM_CSS } from './term-cells.js'

const P = modePalette(DARK, 'colour')
const TONE = modeColours(DARK, 'colour')
const CANVAS = DARK.canvas
const CAP = DARK.keycapBg
const PILL = DARK.fieldBand
const THUMB = DARK.thumb
const INK = DARK.ink
const FG = DARK.fg
const DIM = DARK.dim
const QUIET = DARK.border

type Raw = { ch: string; fg: string | null; bg: string | null; b: boolean }
const FRAMES = JSON.parse(
  readFileSync(new URL('./palette-steps-frames.json', import.meta.url), 'utf8'),
) as Record<string, Raw[][]>
const frame = (k: string): Grid =>
  (FRAMES[k] as Raw[][]).map((r) =>
    r.map((c) => ({ ch: c.ch, fg: c.fg ?? undefined, bg: c.bg ?? CANVAS, b: c.b })),
  )

/** The block's columns (the rule's). */
const LEFT = 4
const BLOCK = 72
/** A one-row frame takes More's row, where the steps line is today; the rule stays under it. */
const LINE = 23
/** T5's outline takes the row above, the steps' row and the rule's. */
const TOP = 22
const KEYS = 25

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
const blankRow = (g: Grid, r: number) => {
  g[r] = Array.from({ length: 80 }, () => ({ ch: ' ', bg: CANVAS }))
}

function keyRow(g: Grid): void {
  blankRow(g, KEYS)
  put(g, KEYS, LEFT + 1, [
    [' ←→ ', FG, CAP, true],
    [' change', DIM],
  ])
  const foot: Seg[] = [
    ['esc', FG, undefined, true],
    [' cancel', QUIET],
    [' · ', QUIET],
    ['ctrl-c', FG, undefined, true],
    [' quit', QUIET],
  ]
  put(g, KEYS, LEFT + BLOCK - len(foot), foot)
}

/* ---------------------------------------------------------------- greys */

/** The greys the app already uses, darkest first, and where. */
const GREYS: Record<string, [hex: string, name: string, from: string]> = {
  g1: ['#242424', 'Shelf', 'Done’s frame, the More window’s fill'],
  g2: ['#2c2c2c', 'Field', 'the colour field, today’s value pills'],
  g3: ['#333333', 'Key cap', 'every key cap, the tab cap'],
  g4: ['#404040', 'Card', 'home’s cards'],
  g5: ['#4d4d4d', 'Faint', 'the tab row’s rule'],
  g6: ['#808080', 'Border', 'window edges; the outline’s usual grey'],
}
/** One step up from `hex`, so what sits on the band still reads off it. */
const LADDER = ['#242424', '#2c2c2c', '#333333', '#404040', '#4d4d4d', '#5c5c5c', '#808080', '#959595']
const up = (hex: string) => LADDER[Math.min(LADDER.length - 1, LADDER.indexOf(hex) + 1)] as string
/** The value pills' and the tab cap's grey on a band of `band`: today's, unless the band is as light or lighter. */
const onBand = (band: string, today: string) =>
  LADDER.indexOf(band) >= LADDER.indexOf(today) ? up(band) : today

/* ------------------------------------------------------------- concepts */

type Field = 'set' | 'start' | 'end'
type Kind = 't1' | 't2' | 't3' | 't4' | 't5'
const VALUES: Record<Field, string> = { set: 'Tailwind', start: '50', end: '950' }

/** ↵ done as its own block: the mode's tint at rest, or its bright colour (T3). */
function doneBlock(bright: boolean): Seg[] {
  const bg = bright ? TONE.fg : TONE.bg
  const fg = bright ? INK : TONE.fg
  return [
    ['  ↵', fg, bg, true],
    [' done  ', fg, bg, bright],
  ]
}
const tab = (bg: string): Seg[] => [[' tab ', FG, bg, true]]

/** Today's pills: the value in hand on the white thumb with ‹ ›, the others on `pill`. */
function pills(hand: Field, pill: string, band?: string): Seg[] {
  const p = (f: Field): Seg =>
    f === hand ? [` ‹ ${VALUES[f]} › `, INK, THUMB, true] : [` ${VALUES[f]} `, FG, pill]
  return [
    ['  ', undefined, band],
    p('set'),
    ['  from ', DIM, band],
    p('start'),
    ['  to ', DIM, band],
    p('end'),
    ['   11 steps', QUIET, band],
  ]
}

/** Done's buttons in one row: the one in hand on `on` with ‹ ›, the rest dim on the band, spaced evenly. */
function buttons(hand: Field, band: string, on: string, room: number): Seg[] {
  const label: Record<Field, string> = { set: 'Tailwind', start: 'from 50', end: 'to 950' }
  const all = (['set', 'start', 'end'] as Field[]).map((f): Seg =>
    f === hand ? [` ‹ ${label[f]} › `, FG, on, true] : [`   ${label[f]}   `, DIM, band],
  )
  const tail: Seg[] = [['11 steps', QUIET, band], ['  ', undefined, band], ...tab(on), ['  ', undefined, band]]
  const spare = room - len(all) - len(tail)
  const gap = Math.floor(spare / 4)
  const out: Seg[] = []
  for (const b of all) out.push([' '.repeat(gap), undefined, band], b)
  out.push([' '.repeat(spare - gap * 3), undefined, band], ...tail)
  return out
}

function screen(kind: Kind, grey: string, hand: Field): Grid {
  const g = frame('steps')
  // A one-row frame keeps the rule under it, as today; T5's outline takes its row.
  for (const r of kind === 't5' ? [TOP, LINE, TOP + 2] : [TOP, LINE]) blankRow(g, r)
  if (kind === 't5') return outlined(g, grey, hand)
  const done = doneBlock(kind === 't3')
  const frameW = BLOCK - len(done) - 1
  if (kind === 't1') {
    put(g, LINE, LEFT, [[' '.repeat(frameW), undefined, grey]])
    put(g, LINE, LEFT, pills(hand, onBand(grey, PILL), grey))
    put(g, LINE, LEFT + frameW - 7, tab(onBand(grey, CAP)))
  } else if (kind === 't4') {
    put(g, LINE, LEFT, pills(hand, PILL))
    put(g, LINE, LEFT + frameW - 7, tab(CAP))
  } else {
    put(g, LINE, LEFT, buttons(hand, grey, onBand(grey, CAP), frameW))
  }
  put(g, LINE, LEFT + frameW + 1, done)
  keyRow(g)
  return g
}

/** T5: the line in a rounded outline in `grey`; ↵ done in its own rounded outline in pink. */
function outlined(g: Grid, grey: string, hand: Field): Grid {
  const word: Seg[] = [
    [' ↵', TONE.fg, undefined, true],
    [' done ', TONE.fg],
  ]
  const doneW = len(word) + 2
  const frameW = BLOCK - doneW - 1
  const box = (at: number, w: number, c: string) => {
    put(g, TOP, at, [[`╭${'─'.repeat(w - 2)}╮`, c]])
    put(g, LINE, at, [['│', c]])
    put(g, LINE, at + w - 1, [['│', c]])
    put(g, TOP + 2, at, [[`╰${'─'.repeat(w - 2)}╯`, c]])
  }
  box(LEFT, frameW, grey)
  put(g, LINE, LEFT + 2, pills(hand, PILL).slice(1))
  put(g, LINE, LEFT + frameW - 7, tab(CAP))
  box(LEFT + frameW + 1, doneW, TONE.fg)
  put(g, LINE, LEFT + frameW + 2, word)
  keyRow(g)
  return g
}

const KINDS: Record<Kind, [name: string, idea: string]> = {
  t1: ['One-row band, today’s pills', 'the band from margin to margin; tab at its right end; ↵ done tinted beside it'],
  t2: ['One-row band, Done’s buttons', 'values spaced evenly; the one in hand one grey lighter, with ‹ ›; ↵ done tinted'],
  t3: ['As T2, ↵ done bright', 'the same buttons; ↵ done in the bright pink'],
  t4: ['No band', 'today’s line; only ↵ done drawn as its own tinted block (the grey changes nothing here)'],
  t5: ['A thin outline', 'a rounded frame in the grey, three rows; it takes the rule’s row; ↵ done outlined in pink'],
}

/* ---------------------------------------------------------------- page */

const PAGE = 'palette-steps-frame-2026-10-round3'
const SCREENS: Record<string, string> = {}
const CLOSE: Record<string, string> = {}
for (const k of Object.keys(KINDS) as Kind[])
  for (const [id, [hex]] of Object.entries(GREYS)) {
    SCREENS[`${k}-${id}`] = gridHtml(screen(k, hex, 'set'), P)
    CLOSE[`${k}-${id}`] = gridHtml(screen(k, hex, 'start').slice(20, 26), P)
  }

const chip = (group: string, id: string, label: string, from: string, swatch = '') =>
  `<button class="chip" data-group="${group}" data-id="${id}">${swatch}<span class="w"><b>${id.toUpperCase()}</b> ${label}<span>${from}</span></span></button>`
const kindChips = Object.entries(KINDS)
  .map(([id, [name, idea]]) => chip('kind', id, name, idea))
  .join('')
const greyChips = Object.entries(GREYS)
  .map(([id, [hex, name, from]]) =>
    chip('grey', id, `${name} ${hex}`, from, `<i style="background:${hex}"></i>`),
  )
  .join('')

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · colour: the steps row, thin, in greys</title>
<style>
  body { margin:0; background:#0d0e11; color:#e2e4ea; font:16px/1.6 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  main { max-width:1500px; margin:0 auto; padding:40px 24px 80px; }
  h1 { font-size:28px; margin:0 0 6px; }
  .lede { color:#8f94a1; margin:0 0 28px; max-width:900px; }
  .layout { display:flex; gap:40px; align-items:flex-start; }
  .views { display:flex; flex-direction:column; gap:18px; }
  .close .t { zoom:1.25; }
  .vt { font:600 13px -apple-system,sans-serif; color:#8f94a1; margin:0 0 6px; }
  .picks { min-width:400px; max-width:440px; }
  .chips { display:flex; flex-direction:column; gap:8px; align-items:stretch; }
  .chip { font:500 14px -apple-system, sans-serif; color:#c7cbd4; background:#16181d; border:1px solid #2c2f37; border-radius:8px; padding:8px 12px; cursor:pointer; text-align:left; display:flex; gap:12px; align-items:center; }
  .chip .w { display:flex; flex-direction:column; }
  .chip i { width:34px; height:22px; border-radius:4px; border:1px solid #3a3d45; flex:none; }
  .chip b { font:700 12px ui-monospace,Menlo,monospace; color:#55c7d9; margin-right:6px; display:inline }
  .chip span span { color:#8f94a1; font-size:13px; }
  .chip:hover { border-color:#4a4f5a; color:#fff; }
  .chip.on { border-color:#55c7d9; background:#12282e; color:#8fe3f0; }
  .grp { font:700 12px ui-monospace,Menlo,monospace; letter-spacing:.06em; text-transform:uppercase; color:#e5a23c; margin:14px 0 2px; }
  .grp:first-child { margin-top:0; }
  .status { font:13px "SF Mono", ui-monospace, Menlo, monospace; color:#8f94a1; margin-top:10px; }
  .copy { margin-top:14px; font:500 14px -apple-system, sans-serif; color:#c7cbd4; background:#16181d; border:1px solid #2c2f37; border-radius:8px; padding:8px 14px; cursor:pointer; }
  ${TERM_CSS}
</style></head><body><main>
<h1>The steps row, thin, in greys</h1>
<p class="lede">Pick a concept, then a grey, on the right. The screen and the close-up change at once. The highlighted two are your pick, and they save on their own. Every grey is one the app already uses. ↵ done is the way out now.</p>
<div class="layout">
  <div class="views">
    <div><div class="vt">The Palette tab, steps open, the set in hand (80 × 26)</div><div class="t" style="background:${P.canvas}"><div id="screen"></div></div></div>
    <div class="close"><div class="vt">Close-up after tab: from in hand</div><div class="t" style="background:${P.canvas}"><div id="close"></div></div></div>
  </div>
  <div class="picks">
    <div class="chips"><div class="grp">Concept</div>${kindChips}<div class="grp">Grey of the band (T5: of the outline)</div>${greyChips}</div>
    <button class="copy">Copy my pick</button>
    <div class="status"></div>
  </div>
</div>
<script>
const SCREENS = ${JSON.stringify(SCREENS)}
const CLOSE = ${JSON.stringify(CLOSE)}
const PAGE = ${JSON.stringify(PAGE)}
const pick = { kind: 't1', grey: 'g1' }
const status = document.querySelector('.status')
const label = (g) => document.querySelector('.chip[data-group="' + g + '"][data-id="' + pick[g] + '"] .w').innerText.split('\\n')[0]
function paint() {
  const k = pick.kind + '-' + pick.grey
  document.getElementById('screen').innerHTML = SCREENS[k]
  document.getElementById('close').innerHTML = CLOSE[k]
  for (const c of document.querySelectorAll('.chip')) c.classList.toggle('on', pick[c.dataset.group] === c.dataset.id)
}
async function save() {
  localStorage.setItem(PAGE, JSON.stringify(pick))
  if (!location.protocol.startsWith('http')) { status.textContent = 'kept in this browser · use Copy my pick'; return }
  try {
    const r = await fetch('/feedback/' + PAGE, { method: 'POST', body: JSON.stringify({ page: PAGE, ...pick, label: label('kind') + ' · ' + label('grey') }) })
    status.textContent = r.ok ? 'saved · ' + new Date().toLocaleTimeString() : 'not saved · use Copy my pick'
  } catch { status.textContent = 'not saved · use Copy my pick' }
}
for (const c of document.querySelectorAll('.chip')) c.addEventListener('click', () => { pick[c.dataset.group] = c.dataset.id; paint(); save() })
document.querySelector('.copy').addEventListener('click', async () => { await navigator.clipboard.writeText(PAGE + ' pick: ' + label('kind') + ' · ' + label('grey')); status.textContent = 'copied · paste it to Claude' })
try { Object.assign(pick, JSON.parse(localStorage.getItem(PAGE) || '{}')) } catch {}
const linked = location.hash.match(/^#(t[1-5])-(g[1-6])$/)
if (linked) { pick.kind = linked[1]; pick.grey = linked[2] }
paint()
</script>
</main></body></html>`

writeFileSync(`mockups/${PAGE}.html`, html)
console.log(`wrote mockups/${PAGE}.html`)
