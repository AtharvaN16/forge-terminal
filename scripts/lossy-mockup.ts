/**
 * Lossy PNG and GIF compression (2026-10-16): how you choose how hard to
 * compress a PNG or GIF, and what Done shows afterwards.
 *
 * Every screen is cells captured from the real app at 80 × 24 (a throwaway
 * test wrote /tmp/forge-lossy/frames-{dark,light}.json, with /compress forced
 * to accept a PNG and a GIF); what the app cannot draw yet is composed here
 * from those cells' colours and the app's own art functions. Sizes are
 * measured: sharp's palette PNG on a real 564 KB screenshot.
 *
 *   npx tsx scripts/lossy-mockup.ts   → mockups/lossy-2026-10.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import stringWidth from 'string-width'
import { wrapWords } from '../src/shell/done-art.js'
import { errorLine, errorPanel } from '../src/shell/error-art.js'
import { blank, HOME_MARGIN, type Row, type Run, width } from '../src/shell/home-art.js'
import { SLIDER_WIDTH, sliderRow } from '../src/shell/quality-art.js'
import { DARK, LIGHT, modeColours, modePalette, type Palette } from '../src/shell/theme.js'

const N = 80

interface Cell {
  ch: string
  fg: string | null
  bg: string | null
  b: boolean
}
type Frame = Cell[][]
const frames = (name: string) =>
  JSON.parse(readFileSync(`/tmp/forge-lossy/frames-${name}.json`, 'utf8')) as Record<string, Frame>
const CAPTURED = { dark: frames('dark'), light: frames('light') }

const rowOf = (cells: Cell[]): Row => {
  const out: Run[] = []
  for (const c of cells) {
    const last = out[out.length - 1]
    const fg = c.fg ?? undefined
    const bg = c.bg ?? undefined
    if (last && last.fg === fg && last.bg === bg && !!last.bold === c.b) last.text += c.ch
    else out.push({ text: c.ch, fg, bg, bold: c.b })
  }
  return out
}
const rowsOf = (f: Frame) => f.map(rowOf)

interface Look {
  p: Palette
  f: Record<string, Frame>
  mode: string
  sel: string
}
function lookOf(base: Palette): Look {
  const name = base.name === 'light' ? 'light' : 'dark'
  const f = CAPTURED[name]
  const p = modePalette(base, 'compress')
  const methodRow = (f['png-mode'] as Frame)[10] as Cell[]
  return { p, f, mode: modeColours(p, 'compress').fg, sel: methodRow[3]?.bg as string }
}

/* ------------------------------------------------------------ pieces */

const run = (text: string, fg?: string, bg?: string, bold = false): Run => ({ text, fg, bg, bold })
const pad = (row: Row, n: number, bg?: string): Row => [
  ...row,
  ...(n > width(row) ? [{ text: ' '.repeat(n - width(row)), bg }] : []),
]
/** A row on the app's canvas: the captured frames paint every cell. */
const onCanvas = (L: Look, row: Row): Row =>
  pad(
    row.map((r) => ({ ...r, bg: r.bg ?? L.p.canvas })),
    N,
    L.p.canvas,
  )
const empty = (L: Look): Row => onCanvas(L, [])

/** The measured size line under the slider: bold size, the saving in green. */
const sizeLine = (L: Look, size: string, saving: string): Row =>
  onCanvas(L, [blank(3), run(size, L.p.fg, undefined, true), blank(2), run(saving, L.p.ok)])

/** The quality screen with the band, the size line and the keys swapped. */
function qualityScreen(L: Look, band: Row, size: Row, key = 'png'): Row[] {
  const rows = rowsOf(L.f[`${key}-quality`] as Frame)
  rows[10] = onCanvas(L, band)
  rows[13] = size
  return rows
}

const THREE = [
  { q: 30, kb: '107 KB', pct: '81% smaller' },
  { q: 65, kb: '123 KB', pct: '78% smaller' },
  { q: 100, kb: '236 KB', pct: '58% smaller' },
]

/**
 * A3 · the G1 slider with three points: ←→ jumps from one to the next.
 * `even`: the points at the ends and the middle; otherwise where their
 * number sits on 1–100. `dots`: the two points you are not on are marked.
 */
function threeAt(L: Look, i: number, { even, dots }: { even: boolean; dots: boolean }): Row[] {
  const s = THREE[i] as (typeof THREE)[number]
  const label = ` ${s.q} `
  const w = stringWidth(label)
  const room = SLIDER_WIDTH - w
  const at = (j: number) =>
    even
      ? Math.round((j / (THREE.length - 1)) * room)
      : Math.round((((THREE[j]?.q ?? 1) - 1) / 99) * room)
  const k = at(i)
  // A dot sits in the middle of where that point's thumb would be.
  const marks = new Set(
    THREE.map((_, j) => j)
      .filter((j) => j !== i)
      .map((j) => at(j) + Math.floor(w / 2)),
  )
  const cells: Run[] = []
  for (let c = 0; c < SLIDER_WIDTH; c++) {
    if (c === k) {
      cells.push(run(label, L.p.ink, L.p.thumb, true))
      c += w - 1
      continue
    }
    const before = c < k
    const mark = dots && marks.has(c)
    cells.push(
      run(mark ? '•' : ' ', before ? L.p.track : L.p.trackFill, before ? L.p.trackFill : L.p.track),
    )
  }
  return qualityScreen(L, [blank(3), ...cells], sizeLine(L, s.kb, s.pct))
}

type Warn = 'band' | 'thumb' | 'label' | 'tag'

/**
 * The 30 point, which Clop would call Aggressive, said four ways. `band` is
 * the user's idea: the band turns orange, no word.
 */
function aggressive(L: Look, warn: Warn): Row[] {
  const s = THREE[0] as (typeof THREE)[number]
  const rows = threeAt(L, 0, { even: true, dots: true })
  const word = 'aggressive'
  const room = SLIDER_WIDTH
  const mid = Math.round((room - 4) / 2) + 2
  const end = room - 2
  if (warn === 'band' || warn === 'thumb') {
    const label = warn === 'band' ? ' 30 ' : ` 30 · ${word} `
    const cells: Run[] = [blank(3), run(label, L.p.ink, L.p.larger, true)]
    let c = stringWidth(label)
    const track = warn === 'band' ? L.p.defaultTagBg : L.p.track
    const ink = warn === 'band' ? L.p.defaultTag : L.p.trackFill
    for (; c < room; c++) cells.push(run(c === mid || c === end ? '•' : ' ', ink, track))
    rows[10] = onCanvas(L, cells)
  }
  if (warn === 'label') {
    rows[11] = onCanvas(L, [
      blank(3),
      run(word, L.p.larger),
      blank(room - word.length - 'sharper'.length),
      run('sharper', L.p.border),
    ])
  }
  if (warn === 'tag') {
    rows[13] = onCanvas(L, [
      blank(3),
      run(s.kb, L.p.fg, undefined, true),
      blank(2),
      run(s.pct, L.p.ok),
      blank(3),
      run(` ${word} `, L.p.defaultTag, L.p.defaultTagBg),
    ])
  }
  return rows
}

/** Done as the app draws it, with the blank row on top the shell gives every screen. */
function done(L: Look, key: string): Row[] {
  const rows = rowsOf(L.f[key] as Frame)
  return [empty(L), ...rows.slice(0, 2), ...rows.slice(3)].map((r) => onCanvas(L, r))
}

/** Done with the close-up Enhance already draws, under the byte bars. */
function doneClose(L: Look, close: string, bars = 'png-done'): Row[] {
  const d = rowsOf(L.f[bars] as Frame)
  // EnhanceDone draws its "after" tab and frame in enhance's violet; on a
  // compress screen they take compress's green.
  const { fg: mode, bg: modeBg } = modeColours(L.p, 'compress')
  const violet: Record<string, string> = {
    '#b39ae8': mode,
    '#64569f': mode,
    '#2a2238': modeBg,
    '#f0ebfa': modeBg,
  }
  const c = rowsOf(
    (L.f[close] as Frame).map((r) =>
      r.map((x) => ({
        ...x,
        fg: x.fg ? (violet[x.fg] ?? x.fg) : x.fg,
        bg: x.bg ? (violet[x.bg] ?? x.bg) : x.bg,
      })),
    ),
  )
  const rows = [
    empty(L),
    d[0],
    empty(L),
    ...d.slice(7, 13),
    empty(L),
    ...c.slice(2, 14),
    d[22],
    d[23],
  ]
  return rows.map((r) => onCanvas(L, r as Row))
}

/* ------------------------------------------------------- frame edits */

const cloneFrame = (f: Frame): Frame => f.map((r) => r.map((c) => ({ ...c })))

/**
 * `old` → `neu` in one row of a captured frame, keeping each cell's colours.
 * A longer `neu` eats the spaces after `old`, so the row keeps its width.
 */
function retext(f: Frame, row: number, old: string, neu: string): void {
  const cells = f[row] as Cell[]
  const at = cells
    .map((c) => c.ch)
    .join('')
    .indexOf(old)
  if (at < 0) throw new Error(`"${old}" not in row ${row}`)
  const span = Math.max(old.length, neu.length)
  const text = neu.padEnd(span)
  const last = cells[at + old.length - 1] as Cell
  for (let i = 0; i < span; i++) {
    // Cells past `old` take its look: they were blank before.
    const c = i < old.length ? (cells[at + i] as Cell) : { ...last }
    cells[at + i] = { ...c, ch: text[i] as string }
  }
}

/** The quality screen for screenshot-small.png, a PNG some tool already squeezed. */
function squeezedFrame(L: Look): Frame {
  const f = cloneFrame(L.f['png-quality'] as Frame)
  retext(f, 4, 'screenshot.png', 'screenshot-small.png')
  retext(f, 5, '564 KB', '167 KB')
  retext(f, 8, 'screenshot.png', 'screenshot-small.png')
  return f
}

/** A key pair added to the key row before ↵, styled as the row's own pairs. */
function withKey(row: Cell[], key: string, word: string): Cell[] {
  // KeyRow draws a pair as a cap " ↵ ", a space, the word; pairs two apart.
  const glyph = row.findIndex((c) => c.ch === '↵')
  const at = glyph - 1
  const k = row[glyph] as Cell
  const capPad = row[at] as Cell
  const w = row[glyph + 3] as Cell
  const gap = row[at - 1] as Cell
  const add: Cell[] = [
    { ...capPad },
    ...[...key].map((ch) => ({ ...k, ch })),
    { ...capPad },
    { ...gap },
    ...[...word].map((ch) => ({ ...w, ch })),
    { ...gap },
    { ...gap },
  ]
  const out = [...row.slice(0, at), ...add, ...row.slice(at)]
  // Take the same number of cells back out of the gap before the foot,
  // leaving the three KeyRow keeps; short of that, KeyRow drops the foot's
  // last item ("· ctrl-c quit"), and so does this.
  const text = () => out.map((c) => c.ch).join('')
  let from = text().indexOf(' '.repeat(add.length + 3), at + add.length)
  if (from < 0) {
    const tail = ' · ctrl-c quit'
    const t = text().indexOf(tail)
    const cut = out.splice(t, tail.length)
    const gapAt = text().indexOf('   ', at + add.length)
    out.splice(gapAt, 0, ...cut.map(() => ({ ...gap })))
    from = text().indexOf(' '.repeat(add.length + 3), at + add.length)
  }
  out.splice(from, add.length)
  return out
}

/** The ↵ pair greyed out: nothing to confirm. */
function dimConfirm(L: Look, row: Cell[]): Cell[] {
  const at = row.findIndex((c) => c.ch === '↵')
  return row.map((c, i) =>
    i >= at && i < at + 10 && c.ch !== ' ' ? { ...c, fg: L.p.border, b: false } : c,
  )
}

/* ------------------------------------------------------------ dither */

/** Measured on the 564 KB screenshot at the 65 point. */
const DITHER = {
  on: { kb: '152 KB', pct: '73% smaller' },
  off: { kb: '123 KB', pct: '78% smaller' },
}

/** The 65 point with the size for `state`, and the frame to edit further. */
function at65(L: Look, state: 'on' | 'off'): { rows: Row[]; keys: Cell[] } {
  const rows = threeAt(L, 1, { even: true, dots: true })
  const s = DITHER[state]
  rows[13] = sizeLine(L, s.kb, s.pct)
  return { rows, keys: [...((L.f['png-quality'] as Frame)[23] as Cell[])] }
}

/** The one line that says what dithering is for, where the toggle shows. */
const EXPLAIN = 'hides stripes in gradients, makes the file bigger'

type Toggle = 'row' | 'keys' | 'auto' | 'none'

function dither(L: Look, how: Toggle, state: 'on' | 'off'): Row[] {
  const { rows, keys } = at65(L, how === 'none' ? 'off' : state)
  if (how === 'row') {
    const pill = (v: 'on' | 'off'): Run =>
      v === state ? run(` ${v} `, L.p.ink, L.p.thumb, true) : run(` ${v} `, L.p.dim)
    rows[15] = onCanvas(L, [
      blank(3),
      run('Dither', L.p.fg),
      blank(3),
      pill('on'),
      blank(1),
      pill('off'),
      blank(4),
      run(EXPLAIN, L.p.dim),
    ])
    rows[23] = onCanvas(L, rowOf(withKey(keys, 'd', 'dither')))
  }
  if (how === 'keys') {
    rows[15] = onCanvas(L, [blank(3), run(`Dither: ${EXPLAIN}`, L.p.dim)])
    rows[23] = onCanvas(L, rowOf(withKey(keys, 'd', `dither ${state}`)))
  }
  if (how === 'auto') {
    const s = DITHER[state]
    rows[13] = onCanvas(L, [
      blank(3),
      run(s.kb, L.p.fg, undefined, true),
      blank(2),
      run(s.pct, L.p.ok),
      blank(3),
      run(state === 'on' ? 'dithered' : 'not dithered', L.p.border),
    ])
    rows[15] = onCanvas(L, [blank(3), run(`Dither: ${EXPLAIN}`, L.p.dim)])
    rows[23] = onCanvas(L, rowOf(withKey(keys, 'd', 'dither')))
  }
  return rows
}

/* ------------------------------------------------- dither, round two */

/** Measured on a gradient wallpaper (379 KB PNG) at the 65 point. */
const GRADIENT = {
  on: { kb: '293 KB', pct: '23% smaller' },
  off: { kb: '27 KB', pct: '93% smaller' },
}

/**
 * The header bar of the quality screen with the trail `answers` then
 * `current`, built from its own cells; the hatch gives up the room.
 */
function trail(L: Look, answers: string[], current: string): Row {
  const row = (L.f['png-quality'] as Frame)[1] as Cell[]
  const text = row.map((c) => c.ch).join('')
  const start = text.indexOf(' By quality')
  const answer = row[start + 1] as Cell
  const sep = row[text.indexOf('╱', start)] as Cell
  const cur = row[text.indexOf('Quality', start + 3)] as Cell
  const end = text.lastIndexOf('╱')
  const tail = row.slice(end - 1, end + 1)
  const plain = { ...(row[start] as Cell) }
  const said: Cell[] = []
  const put = (s: string, look: Cell) => {
    for (const ch of s) said.push({ ...look, ch })
  }
  for (const a of answers) {
    put(' ', plain)
    put(a, answer)
    put(' ', plain)
    put('╱', sep)
  }
  put(' ', plain)
  put(current, cur)
  put(' ', plain)
  const grow = said.length + tail.length - (end + 1 - start)
  const head = row.slice(0, start - grow)
  const out = [...head, ...said, ...tail]
  return onCanvas(L, rowOf(out))
}

/** One list row as Method draws it: the selected one on a bar with ▌. */
function listRow(L: Look, label: string, detail: Run[], selected: boolean): Row {
  const bar = 52
  const runs: Run[] = selected
    ? [run('▌', L.mode, L.sel), run(' ', undefined, L.sel), run(label, L.p.fg, L.sel, true)]
    : [blank(2), run(label, L.p.fg)]
  const at = 20
  const row: Run[] = [
    ...runs,
    run(' '.repeat(at - width(runs)), undefined, selected ? L.sel : undefined),
  ]
  for (const d of detail) row.push(selected ? { ...d, bg: L.sel } : d)
  if (selected) row.push(run(' '.repeat(Math.max(0, bar - width(row))), undefined, L.sel))
  return onCanvas(L, [blank(2), ...row])
}

/** T5: a step of its own after Quality, chosen by what each costs. */
function gradientStep(L: Look, first: boolean): Row[] {
  const f = cloneFrame(L.f['png-mode'] as Frame)
  // A step after Quality: esc goes back to it, not off the file.
  retext(f, 23, '1–5 mode · esc remove file', '       1–5 mode · esc back')
  const rows = rowsOf(f).map((r) => onCanvas(L, r))
  rows[1] = trail(L, ['By quality', '65'], 'Gradients')
  rows[8] = onCanvas(L, [
    blank(3),
    run('Gradients', L.mode, undefined, true),
    blank(41),
    run('screenshot.png', L.p.border),
  ])
  const size = (s: { kb: string; pct: string }): Run[] => [
    run(s.kb, L.p.fg, undefined, true),
    blank(2),
    run(s.pct, L.p.ok),
  ]
  rows[10] = listRow(L, 'Smooth', size(DITHER.on), first)
  rows[11] = listRow(L, 'Flat colours', size(DITHER.off), !first)
  return rows
}

/** T6: say what the picture is; Forge sets dithering from that. */
function photoGraphic(L: Look, photo: boolean): Row[] {
  const { rows, keys } = at65(L, photo ? 'on' : 'off')
  const pill = (v: string, on: boolean): Run =>
    on ? run(` ${v} `, L.p.ink, L.p.thumb, true) : run(` ${v} `, L.p.dim)
  rows[15] = onCanvas(L, [
    blank(3),
    run('Picture', L.p.fg),
    blank(3),
    pill('photo', photo),
    blank(1),
    pill('graphic', !photo),
  ])
  rows[23] = onCanvas(L, rowOf(withKey(keys, 'p', 'picture')))
  return rows
}

/** T7: nothing on a flat image; a tag, and d to undo it, when gradients were found. */
function onlyWhenFound(L: Look, found: boolean): Row[] {
  const { rows, keys } = at65(L, 'off')
  if (!found) return rows
  const f = cloneFrame(L.f['png-quality'] as Frame)
  retext(f, 4, 'screenshot.png', 'gradient.png')
  retext(f, 5, '1696×1080 · 564 KB · transparent', '1696×1080 · 379 KB')
  retext(f, 8, 'screenshot.png', 'gradient.png')
  for (const i of [4, 5, 8]) rows[i] = onCanvas(L, rowOf(f[i] as Cell[]))
  rows[13] = onCanvas(L, [
    blank(3),
    run(GRADIENT.on.kb, L.p.fg, undefined, true),
    blank(2),
    run(GRADIENT.on.pct, L.p.ok),
    blank(3),
    run(' gradients kept smooth ', L.p.defaultTag, L.p.defaultTagBg),
  ])
  rows[23] = onCanvas(L, rowOf(withKey(keys, 'd', 'flatten')))
  return rows
}

/** T8: Forge picks; Done offers the other way as a redo. */
function onDone(L: Look): Row[] {
  const rows = done(L, 'png-done-nd')
  // No room for "ctrl-c quit" beside one more pair: KeyRow drops it.
  const keys = ((L.f['png-done-nd'] as Frame)[23] as Cell[]).map((c) => ({ ...c }))
  const quit = keys
    .map((c) => c.ch)
    .join('')
    .indexOf('ctrl-c quit')
  for (let i = quit; i < quit + 11; i++) keys[i] = { ...(keys[quit - 1] as Cell) }
  const text = keys.map((c) => c.ch).join('')
  const capAt = text.indexOf(' o ') // the "o open" cap starts here
  const cap = keys[capAt] as Cell
  const glyph = keys[capAt + 1] as Cell
  const word = keys[capAt + 4] as Cell
  const gap = keys[capAt - 1] as Cell
  const add: Cell[] = [
    { ...cap },
    { ...glyph, ch: 'd' },
    { ...cap },
    { ...gap },
    ...[...'redo dithered'].map((ch) => ({ ...word, ch })),
    { ...gap },
    { ...gap },
  ]
  const out = [...keys.slice(0, capAt), ...add, ...keys.slice(capAt)]
  const from = out
    .map((c) => c.ch)
    .join('')
    .indexOf(' '.repeat(add.length + 3), capAt + add.length)
  out.splice(from, add.length)
  rows[rows.length - 1] = onCanvas(L, rowOf(out))
  return rows
}

/** T9: no words — the band's filled part is dotted while dithering is on. */
function dottedBand(L: Look, on: boolean): Row[] {
  const { rows, keys } = at65(L, on ? 'on' : 'off')
  if (on) {
    rows[10] = (rows[10] as Row).map((r) =>
      r.bg === L.p.trackFill && /^[ •]+$/.test(r.text)
        ? { ...r, text: r.text.replace(/ /g, '░'), fg: L.p.track }
        : r,
    )
  }
  rows[23] = onCanvas(L, rowOf(withKey(keys, 'd', 'dither')))
  return rows
}

/** T10: no screen at all — a flag and a saved default. */
function cliOnly(L: Look): Row[] {
  const g = (s: string) => run(s, L.p.dim)
  const t = (s: string) => run(s, L.p.fg)
  return [
    empty(L),
    onCanvas(L, [g('$ '), t('forge shot.png --quality 65 --no-dither')]),
    onCanvas(L, [run('✓ ', L.p.ok), t('shot-small.png · 123 KB · 78% smaller')]),
    empty(L),
    onCanvas(L, [g('$ '), t('forge config set dither off')]),
    empty(L),
    onCanvas(L, [g('$ '), t('forge --help')]),
    onCanvas(L, [g('  …')]),
    onCanvas(L, [
      t('  --dither / --no-dither'),
      g('   smooth gradients, or flat colours (smaller)'),
    ]),
    onCanvas(L, [g('  …')]),
    empty(L),
  ]
}

/** T11: the size line also prices the other way; d swaps them. */
function priced(L: Look, on: boolean): Row[] {
  const { rows, keys } = at65(L, on ? 'on' : 'off')
  const other = on ? DITHER.off : DITHER.on
  const s = on ? DITHER.on : DITHER.off
  rows[13] = onCanvas(L, [
    blank(3),
    run(s.kb, L.p.fg, undefined, true),
    blank(2),
    run(s.pct, L.p.ok),
    blank(3),
    run(on ? `${other.kb} without dithering` : `${other.kb} with dithering`, L.p.border),
  ])
  rows[23] = onCanvas(L, rowOf(withKey(keys, 'd', 'swap')))
  return rows
}

/* ------------------------------------------------ dither, compact round */

/** The 65 point on the gradient wallpaper, with `size` measured there. */
function gradientAt65(L: Look, size: { kb: string; pct: string }): { rows: Row[]; keys: Cell[] } {
  const { rows, keys } = at65(L, 'off')
  const f = cloneFrame(L.f['png-quality'] as Frame)
  retext(f, 4, 'screenshot.png', 'gradient.png')
  retext(f, 5, '1696×1080 · 564 KB · transparent', '1696×1080 · 379 KB')
  retext(f, 8, 'screenshot.png', 'gradient.png')
  for (const i of [4, 5, 8]) rows[i] = onCanvas(L, rowOf(f[i] as Cell[]))
  rows[13] = sizeLine(L, size.kb, size.pct)
  return { rows, keys }
}

/** The size line with a grey tail after the saving. */
function sizeTail(L: Look, size: { kb: string; pct: string }, tail: Run): Row {
  return onCanvas(L, [
    blank(3),
    run(size.kb, L.p.fg, undefined, true),
    blank(2),
    run(size.pct, L.p.ok),
    blank(3),
    tail,
  ])
}

/** A note where the shell's notes sit: above the keys, grey, for a while. */
function noteAboveKeys(L: Look, rows: Row[], text: string): Row[] {
  rows[20] = onCanvas(L, [blank(HOME_MARGIN), run(text, L.p.dim)])
  return rows
}

/** K1: no jargon — the state in plain words at the end of the size line. */
function plainWords(L: Look, smooth: boolean): Row[] {
  const { rows, keys } = at65(L, smooth ? 'on' : 'off')
  const s = smooth ? DITHER.on : DITHER.off
  rows[13] = sizeTail(L, s, run(smooth ? 'smooth gradients' : 'flat colours', L.p.border))
  rows[23] = onCanvas(L, rowOf(withKey(keys, 'd', 'gradients')))
  return rows
}

/** K2: only the key until it is pressed; then a note says what it did. */
function explainOnPress(L: Look, pressed: boolean): Row[] {
  const { rows, keys } = at65(L, pressed ? 'on' : 'off')
  rows[23] = onCanvas(L, rowOf(withKey(keys, 'd', 'dither')))
  return pressed ? noteAboveKeys(L, rows, NOTE_ON) : rows
}

/** K3: nothing on a flat image; on gradients a tag, and d with a note. */
function whenItMatters(L: Look, step: 'flat' | 'found' | 'flattened'): Row[] {
  if (step === 'flat') return at65(L, 'off').rows
  const size = step === 'found' ? GRADIENT.on : GRADIENT.off
  const { rows, keys } = gradientAt65(L, size)
  if (step === 'found') {
    rows[13] = sizeTail(L, size, run(' gradients kept smooth ', L.p.defaultTag, L.p.defaultTagBg))
    rows[23] = onCanvas(L, rowOf(withKey(keys, 'd', 'flatten')))
    return rows
  }
  rows[23] = onCanvas(L, rowOf(withKey(keys, 'd', 'smooth')))
  return noteAboveKeys(L, rows, NOTE_FLAT)
}

/** K4: the other choice's size in plain words; d swaps. */
function otherPrice(L: Look, smooth: boolean): Row[] {
  const { rows, keys } = at65(L, smooth ? 'on' : 'off')
  const s = smooth ? DITHER.on : DITHER.off
  const o = smooth ? DITHER.off : DITHER.on
  rows[13] = sizeTail(
    L,
    s,
    run(smooth ? `${o.kb} as flat colours` : `${o.kb} with smooth gradients`, L.p.border),
  )
  rows[23] = onCanvas(L, rowOf(withKey(keys, 'd', 'swap')))
  return rows
}

const NOTE_ON = 'Dithering on — hides stripes in gradients, makes the file bigger.'
const NOTE_FLAT = 'Flattened — 27 KB, but gradients may show stripes.'

/* ------------------------------------- dither below a point (user's idea) */

/**
 * Below 100 the file is flat colours by default. Measured on your screenshot:
 * at 100 dithering changes nothing (236 KB either way); at 65 it is 123 KB
 * flat, 152 KB dithered; at 30, 107 KB flat, 124 KB dithered.
 */
const FLAT = {
  65: { kb: '123 KB', pct: '78% smaller' },
  30: { kb: '107 KB', pct: '81% smaller' },
}
const SMOOTH = {
  65: { kb: '152 KB', pct: '73% smaller' },
  30: { kb: '124 KB', pct: '78% smaller' },
}

const OFF_LONG = 'Dithering hides stripes in gradients, but makes the file bigger.'
const OFF_SHORT = 'dithering hides stripes, adds size'
const ON = 'Dithering on'

/** The band in the dither pattern while it is on: its empty cells become ░. */
function patterned(L: Look, band: Row): Row {
  const ink: Record<string, string> = {
    [L.p.trackFill]: L.p.track,
    [L.p.track]: L.p.trackFill,
    [L.p.defaultTagBg]: L.p.defaultTag,
  }
  // A cell of space is kept after a word in the band ("aggressive"), so the
  // pattern does not run into it.
  return band.map((r, i) => {
    if (!(r.bg && ink[r.bg] && /^[ •]+$/.test(r.text))) return r
    const afterWord = /[a-z]$/.test(band[i - 1]?.text ?? '')
    const text = r.text.replace(/ /g, '░')
    return { ...r, text: afterWord ? ` ${text.slice(1)}` : text, fg: ink[r.bg] }
  })
}

type Place = 'note' | 'tail' | 'row'
type Moment = 'top' | 'off' | 'on' | 'on30'

function belowPoint(L: Look, place: Place, moment: Moment): Row[] {
  if (moment === 'top') return threeAt(L, 2, { even: true, dots: true })
  const at30 = moment === 'on30'
  const rows = at30 ? aggressive(L, 'band') : threeAt(L, 1, { even: true, dots: true })
  const on = moment !== 'off'
  const size = on ? SMOOTH[at30 ? 30 : 65] : FLAT[65]
  if (on) rows[10] = patterned(L, rows[10] as Row)
  const keys = (L.f['png-quality'] as Frame)[23] as Cell[]
  rows[23] = onCanvas(L, rowOf(withKey(keys, 'd', 'dither')))
  const msg = on ? ON : place === 'tail' ? OFF_SHORT : OFF_LONG
  if (place === 'tail') {
    rows[13] = sizeTail(L, size, run(msg, L.p.border))
    return rows
  }
  rows[13] = sizeLine(L, size.kb, size.pct)
  if (place === 'note') return noteAboveKeys(L, rows, msg)
  rows[15] = onCanvas(L, [blank(3), run(msg, L.p.dim)])
  return rows
}

/* ----------------------------------- the note carries its key (round 5) */

const SAY_FULL = 'Use dithering to hide stripes in gradients, but it will make the file bigger.'
const SAY_SHORT = 'Use dithering to hide stripes in gradients — the file gets bigger.'
const SAY_ON = 'Dithering on'

type Say = 'full' | 'short' | 'fade'

/**
 * The note above the keys with the d key inside it, on the chip in-field
 * hints use (mode colour, ink key). `fade`: the note sits on a tint that
 * dissolves into the dither pattern towards its end.
 */
function sayRows(L: Look, say: Say, on: boolean): Row[] {
  const chip = run(' d ', L.p.ink, L.mode, true)
  const room = N - 2 * HOME_MARGIN - 4
  const text = on ? SAY_ON : say === 'full' ? SAY_FULL : SAY_SHORT
  if (say !== 'fade') {
    const lines = wrapWords(text, room)
    return lines.map((l, i) =>
      onCanvas(L, [blank(HOME_MARGIN), i === 0 ? chip : blank(3), blank(1), run(l, L.p.dim)]),
    )
  }
  // The band's own grey, so the note dissolves the way the band is patterned.
  const tint = L.p.trackFill
  const body: Run[] = [
    chip,
    run(' ', undefined, tint),
    run(text, L.p.fg, tint),
    run(' ', undefined, tint),
  ]
  // The tint gives way in three steps of the pattern, ending on the canvas.
  const left = N - 2 * HOME_MARGIN - width(body)
  const steps = on ? Math.min(left, 30) : left
  const third = Math.ceil(steps / 3)
  const fade: Run[] = ['▓', '▒', '░'].map((g, i) =>
    run(g.repeat(Math.max(0, Math.min(third, steps - i * third))), tint, L.p.canvas),
  )
  return [onCanvas(L, [blank(HOME_MARGIN), ...body, ...fade])]
}

function sayAt(L: Look, say: Say, on: boolean): Row[] {
  const rows = threeAt(L, 1, { even: true, dots: true })
  const size = on ? SMOOTH[65] : FLAT[65]
  rows[13] = sizeLine(L, size.kb, size.pct)
  if (on) rows[10] = patterned(L, rows[10] as Row)
  const note = sayRows(L, say, on)
  note.forEach((r, i) => {
    rows[21 - note.length + i] = r
  })
  // The note's blank row under it, before the rule.
  rows[21] = empty(L)
  const lift = note.length
  note.forEach((r, i) => {
    rows[21 - lift + i] = r
  })
  return rows
}

/* -------------------------------- the note, round 6: grey key, plain words */

const PLAIN_OFF = 'Use dithering for smoother colours — the file gets bigger.'
const PLAIN_ON = 'Dithering on'

/**
 * The note above the keys, its d on the key row's own grey cap and lined up
 * with the caps below it (the key row starts one cell in).
 */
function plainNote(L: Look, on: boolean): Row {
  return onCanvas(L, [
    blank(HOME_MARGIN + 1),
    // On, the d itself turns the mode's green: the cap says the state.
    run(' d ', on ? L.mode : L.p.fg, L.p.keycapBg, true),
    blank(1),
    run(on ? PLAIN_ON : PLAIN_OFF, L.p.dim),
  ])
}

function plainAt(L: Look, point: 65 | 30, on: boolean): Row[] {
  const rows = point === 30 ? aggressive(L, 'band') : threeAt(L, 1, { even: true, dots: true })
  const size = on ? SMOOTH[point] : FLAT[point]
  rows[13] = sizeLine(L, size.kb, size.pct)
  rows[20] = plainNote(L, on)
  return rows
}

/* ---------------------------------------------------- nothing written */

const GROW = {
  title: 'Cannot compress more',
  reason: 'nothing written',
  detail: 'screenshot-small.png would grow from 167 KB to 168 KB, so nothing was written.',
  hint: 'Try a lower point on the slider.',
}

/** The 100 point on the squeezed PNG: the slider already says it grows. */
function grows(L: Look): Row[] {
  const f = squeezedFrame(L)
  const rows = rowsOf(f).map((r) => onCanvas(L, r))
  const band = threeAt(L, 2, { even: true, dots: true })[10] as Row
  rows[10] = band
  rows[13] = onCanvas(L, [
    blank(3),
    run('168 KB', L.p.fg, undefined, true),
    blank(2),
    run('1% larger', L.p.larger),
  ])
  return rows
}

type Refuse = 'line' | 'panel' | 'prevent'

function refuse(L: Look, how: Refuse): Row[] {
  const rows = grows(L)
  const w = N - 2 * HOME_MARGIN
  if (how === 'line') {
    rows[15] = onCanvas(L, [
      blank(HOME_MARGIN),
      ...errorLine({ palette: L.p, title: GROW.title, reason: GROW.reason, width: w }),
    ])
  }
  if (how === 'panel') {
    const panel = errorPanel({
      palette: L.p,
      title: GROW.title,
      detail: GROW.detail,
      hint: GROW.hint,
      width: w,
    }).map((r) => onCanvas(L, [blank(HOME_MARGIN), ...r]))
    // Where a refused file's panel sits today: above the flow it explains.
    return [
      rows[0] as Row,
      ...panel,
      empty(L),
      ...rows.slice(1, 14),
      empty(L),
      rows[22] as Row,
      rows[23] as Row,
    ]
  }
  if (how === 'prevent') {
    rows[13] = onCanvas(L, [
      blank(3),
      run('168 KB', L.p.fg, undefined, true),
      blank(2),
      run(GROW.title.toLowerCase(), L.p.larger),
    ])
    rows[23] = onCanvas(L, rowOf(dimConfirm(L, (L.f['png-quality'] as Frame)[23] as Cell[])))
  }
  return rows
}

/** The command line, as `renderError` prints it. */
function cli(L: Look): Row[] {
  const rows: Row[] = [
    empty(L),
    onCanvas(L, [run('$ ', L.p.dim), run('forge screenshot-small.png --quality 100', L.p.fg)]),
    onCanvas(L, [run(`✕ ${GROW.title}`, L.p.fail, undefined, true)]),
    empty(L),
    onCanvas(L, [run(`  ${GROW.detail}`, L.p.fg)]),
    empty(L),
    onCanvas(L, [run('  Try a lower --quality.', L.p.dim)]),
    empty(L),
  ]
  return rows
}

/* ------------------------------------------------------------- render */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const GLYPH: Record<string, string> = { '╱': 'd', '▀': 'u', '▄': 'l', '█': 'f', '▌': 'h' }

function html(rows: Row[], p: Palette): string {
  rows.forEach((r, i) => {
    if (width(r) > N) console.warn(`row ${i} is ${width(r)} wide:`, r.map((x) => x.text).join(''))
  })
  const body = rows
    .map((r) => {
      let out = ''
      let used = 0
      for (const x of r) {
        const style = [
          x.fg ? `color:${x.fg}` : '',
          x.bg ? `background:${x.bg}` : '',
          x.bold ? 'font-weight:700' : '',
        ]
          .filter(Boolean)
          .join(';')
        let inner = ''
        for (const ch of x.text) inner += GLYPH[ch] ? `<i class="${GLYPH[ch]}"></i>` : esc(ch)
        out += style ? `<span style="${style}">${inner}</span>` : `<span>${inner}</span>`
        used += stringWidth(x.text)
      }
      if (used < N) out += `<span>${' '.repeat(N - used)}</span>`
      return `<div class="r">${out}</div>`
    })
    .join('')
  return `<div class="t" style="background:${p.canvas};color:${p.fg}">${body}</div>`
}

interface Fig {
  id: string
  name: string
  note: string
  pick?: boolean
  draw: (L: Look) => Row[][]
}
function figure(f: Fig): string {
  const themes = [DARK, LIGHT]
    .map((base) => {
      const L = lookOf(base)
      return `<div class="theme ${base.name}">${f
        .draw(L)
        .map((fr) => html(fr, L.p))
        .join('')}</div>`
    })
    .join('')
  return `<figure><div class="vt"><span class="id">${f.id}</span><span class="name">${f.name}</span>${f.pick ? '<span class="pick">MY PICK</span>' : ''}</div>${themes}<p class="idea">${f.note}</p></figure>`
}

interface Tab {
  id: string
  title: string
  kind: string
  intro: string
  figs: Fig[]
}

const TABS: Tab[] = [
  {
    id: 'dial',
    title: '1 · Slider ✓',
    kind: 'SCREEN — decided: A3·a',
    intro:
      'After <b>By quality</b> on a PNG or GIF: the JPEG slider’s look, but ←→ jumps between three points, 30 → 65 → 100. Only the point you land on is measured, as today. <code>--quality</code> on the command line still takes any number. Sizes measured on your 564 KB screenshot.',
    figs: [
      {
        id: 'A3·a',
        name: 'Three points, at the ends and the middle, the other two dotted',
        note: '30 · 65 · 100 are a first guess from this one screenshot (100 is about Clop’s Normal, 65 its Aggressive); to be checked on more files before building.',
        draw: (L) => [
          threeAt(L, 0, { even: true, dots: true }),
          threeAt(L, 1, { even: true, dots: true }),
          threeAt(L, 2, { even: true, dots: true }),
        ],
      },
    ],
  },
  {
    id: 'aggressive',
    title: '2 · Orange at 30 ✓',
    kind: 'SCREEN — decided: W1',
    intro:
      'At 30, the smallest point, the band turns orange to say the result may look different. No word on it. Only the 30 screen changes; 65 and 100 stay as in tab 1. The orange is the app’s own: the orange of a file that grew, and the soft orange of Save as’s default tag.',
    figs: [
      {
        id: 'W1',
        name: 'The band turns orange',
        note: 'The thumb in orange, the rest of the band in a dark orange tint.',
        draw: (L) => [aggressive(L, 'band')],
      },
    ],
  },
  {
    id: 'done',
    title: '3 · Done ✓',
    kind: 'SCREEN — decided: as today',
    intro:
      'After it is written: the decided K3·a, unchanged. No close-up — a picture drawn in the terminal is too coarse to judge colour loss by; O opens the real file.',
    figs: [
      {
        id: 'A',
        name: 'As today',
        note: 'PNG and GIF get exactly the Done every compress gets. Press O to look at the file yourself.',
        draw: (L) => [done(L, 'png-done'), done(L, 'gif-done')],
      },
    ],
  },
  {
    id: 'dither',
    title: '4 · Dither ✓',
    kind: 'SCREEN — decided: N4',
    intro:
      'Flat colours by default. At 65 and 30 a note above the keys always offers dithering, with <b>d</b> on the same grey cap as every key below it and lined up with them. Press d and the note says “Dithering on”; the band stays as it is. At 100 the note shows only when dithering changes the file (a gradient still bands at 100; your screenshot comes out the same either way). It never shows when the two copies come out identical — logos and icons with few colours, where d would do nothing. Forge does not judge the look: you press d and see. Sizes measured on your screenshot: 65 is 123 KB flat, 152 KB dithered; 30 is 107 KB, 124 KB.',
    figs: [
      {
        id: 'N4',
        name: 'Plain note, grey key, no pattern',
        pick: true,
        note: 'Words: “Use dithering for smoother colours — the file gets bigger.” → “Dithering on”. While on, the d on its cap is the mode’s green. Shown at 65 off, 65 on, and 30 on with the orange band.',
        draw: (L) => [plainAt(L, 65, false), plainAt(L, 65, true), plainAt(L, 30, true)],
      },
    ],
  },
  {
    id: 'grow',
    title: '5 · Nothing written ✓',
    kind: 'SCREEN — decided: E3',
    intro:
      'A PNG another tool already squeezed (screenshot-small.png, 167 KB) would come out at 168 KB at the 100 point. Forge never writes a bigger file. Applies to every format <code>/compress</code> takes — a JPEG saved at 60 and compressed at 90 grows 49 → 74 KB today.',
    figs: [
      {
        id: 'E3',
        name: 'Said before ↵, which then does nothing',
        pick: true,
        note: 'The size line says it instead of “1% larger”, and ↵ confirm goes grey. No error at all. Words: “cannot compress more”.',
        draw: (L) => [refuse(L, 'prevent')],
      },
      {
        id: 'CLI',
        name: 'Command line and MCP',
        note: 'As every Forge error prints. Exit code 1, no file written. The MCP tool returns the same title, detail and hint.',
        draw: (L) => [cli(L)],
      },
    ],
  },
]

const QUESTIONS: string[] = []

const BEYOND = [
  '<b>Dithering chosen per image</b> — tab 4. Clop always dithers.',
  '<b>Never write a bigger file</b> — tab 5. Agreed; covers JPEG and WebP too, not only PNG and GIF.',
]

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · Lossy PNG and GIF</title>
<style>
  :root { --page:#0d0e11; --ink:#e2e4ea; --muted:#8f94a1; --rule:#23252c; --green:#79c98b; --mono:"SF Mono", ui-monospace, Menlo, monospace; --sans:-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--page); color:var(--ink); font:16px/1.6 var(--sans); }
  main { max-width:2300px; margin:0 auto; padding:44px 24px 120px; }
  h1 { font-size:32px; margin:0 0 8px; }
  h2 { font-size:18px; margin:26px 0 6px; }
  .lede { color:var(--muted); max-width:900px; margin:0; }
  .box { border:1px solid var(--rule); border-radius:10px; padding:12px 18px; margin-top:18px; max-width:1100px; background:#121317; }
  .box ol, .box ul { margin:6px 0; padding-left:22px; } .box li { margin:4px 0; color:#c7cbd4; }
  .tabs { position:sticky; top:0; z-index:5; display:flex; flex-wrap:wrap; gap:6px; margin:22px -24px 0; padding:12px 24px; background:rgba(13,14,17,.94); border-bottom:1px solid var(--rule); align-items:center; }
  .tabs a { font:13px var(--mono); color:var(--muted); text-decoration:none; border:1px solid var(--rule); padding:6px 12px; border-radius:8px; cursor:pointer; }
  .tabs a.on { color:#0c1d22; background:var(--green); border-color:var(--green); font-weight:700; }
  .tabs .sp { flex:1; }
  .tabs label { font:13px var(--mono); color:var(--muted); display:flex; gap:6px; align-items:center; }
  section { display:none; margin-top:30px; } section.on { display:block; }
  .kind { font:700 12px var(--mono); letter-spacing:.08em; color:var(--green); }
  .intro { color:#c7cbd4; max-width:1000px; margin-top:4px; }
  figure { margin:34px 0 0; }
  .vt { display:flex; align-items:baseline; gap:10px; margin-bottom:8px; }
  .vt .id { font:700 12px var(--mono); padding:3px 7px; border-radius:6px; background:#182c1e; color:var(--green); }
  .vt .name { font-weight:620; }
  .vt .pick { font:600 11px var(--mono); letter-spacing:.08em; color:#6fcf7f; border:1px solid #2c5a37; padding:2px 7px; border-radius:6px; }
  .idea { font-size:14.5px; color:#c7cbd4; margin:8px 0 0; max-width:1000px; }
  .theme { display:flex; flex-wrap:wrap; gap:14px; }
  .theme + .theme { margin-top:14px; }
  body.only-dark .theme.light, body.only-light .theme.dark { display:none; }
  .t { font:13px/1 var(--mono); padding:12px 14px; border-radius:10px; border:1px solid #2c2f37; width:max-content; }
  .r { height:17px; white-space:pre; overflow:hidden; }
  .r > span { display:inline-block; height:17px; line-height:17px; vertical-align:top; }
  .r i { display:inline-block; width:1ch; height:17px; vertical-align:top; }
  i.d { background:linear-gradient(to top left, transparent calc(50% - .7px), currentColor calc(50% - .7px), currentColor calc(50% + .7px), transparent calc(50% + .7px)); }
  i.u { background:linear-gradient(currentColor 50%, transparent 50%); }
  i.l { background:linear-gradient(transparent 50%, currentColor 50%); }
  i.f { background:currentColor; }
  i.h { background:linear-gradient(to right, currentColor 50%, transparent 50%); }
  code { font:.9em var(--mono); background:#1c1e24; padding:1px 5px; border-radius:4px; }
</style></head>
<body class="only-dark"><main>
<h1>Lossy PNG and GIF</h1>
<p class="lede"><code>/compress</code> on a PNG or GIF makes it smaller by using fewer colours (PNG) and reusing unchanged pixels between frames (GIF). <code>/convert</code> to PNG stays perfect quality. Screens are captured from the app at 80 × 24; sizes are measured.</p>
${QUESTIONS.length ? `<div class="box"><b>Questions for you</b><ol>${QUESTIONS.map((q) => `<li>${q}</li>`).join('')}</ol></div>` : ''}
<div class="box"><b>Ideas that go further than Clop</b><ul>${BEYOND.map((q) => `<li>${q}</li>`).join('')}</ul></div>
<div class="tabs">${TABS.map((t, i) => `<a data-t="${t.id}"${i === 0 ? ' class="on"' : ''}>${t.title}</a>`).join('')}<span class="sp"></span>
<label><input type="radio" name="th" value="only-dark" checked> dark</label><label><input type="radio" name="th" value="only-light"> light</label><label><input type="radio" name="th" value="both"> both</label></div>
${TABS.map((t, i) => `<section id="s-${t.id}"${i === 0 ? ' class="on"' : ''}><div class="kind">${t.kind}</div><p class="intro">${t.intro}</p>${t.figs.map(figure).join('')}</section>`).join('\n')}
</main>
<script>
document.querySelectorAll('.tabs a').forEach((a) => a.onclick = () => {
  document.querySelectorAll('.tabs a').forEach((b) => b.classList.toggle('on', b === a))
  document.querySelectorAll('section').forEach((s) => s.classList.toggle('on', s.id === 's-' + a.dataset.t))
  history.replaceState(null, '', '#' + a.dataset.t)
})
const h = location.hash.slice(1); if (h) document.querySelector('.tabs a[data-t="' + h + '"]')?.click()
document.querySelectorAll('input[name=th]').forEach((r) => r.onchange = () => { document.body.className = r.value })
const th = new URLSearchParams(location.search).get('theme'); if (th) { const v = th === 'both' ? 'both' : 'only-' + th; document.body.className = v; const r = document.querySelector('input[value="' + v + '"]'); if (r) r.checked = true }
</script></body></html>`

const out = new URL('../mockups/lossy-2026-10.html', import.meta.url)
writeFileSync(out, page)
console.log('wrote', decodeURIComponent(out.pathname), page.length)
