/**
 * Presets UX, round one (2026-10-22), after a friend test where nobody got
 * Continue editing or Save as preset: Compress span forever with no word of
 * what it was doing, and a saved preset could not be found again. The bugs
 * are fixed (b91c125); this page is the design side.
 *
 * Done's own buttons are being designed on another page (done-next), so
 * every screen here starts once → or p has been pressed, and Done is drawn
 * as the app draws it today.
 *
 * "Today" is captured from the app (scripts/presets-ux-capture.tsx). Every
 * option is drawn with the app's own art: windowOver for the windows,
 * editorLines / subLines for Continue editing's rows, over the captured Done.
 *
 *   npx tsx scripts/presets-ux-mockup.ts   → mockups/presets-ux-2026-10.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { windowOver } from '../src/shell/colour/system-art.js'
import type { Row, Run } from '../src/shell/home-art.js'
import {
  type Editor,
  type EditorRow,
  openEditor,
  withMissing,
  withReasons,
} from '../src/shell/preset-editor.js'
import { editorLines, OP_NAMES, subLines } from '../src/shell/preset-editor-art.js'
import { DARK, modePalette } from '../src/shell/theme.js'
import { type PageConcept, feedbackPage } from './feedback-page.js'
import { type Cell, type Grid, cellsOf, rowOf, termHtml, toGrid } from './term-cells.js'

type Raw = { ch: string; fg: string | null; bg: string | null; b: boolean }
const frames = JSON.parse(
  readFileSync(new URL('./presets-ux-frames.json', import.meta.url), 'utf8'),
) as Record<string, Raw[][]>
const grid = (raw: Raw[][]): Grid =>
  raw.map((r) => r.map((c) => ({ ch: c.ch, fg: c.fg ?? undefined, bg: c.bg ?? undefined, b: c.b })))
const F = Object.fromEntries(Object.entries(frames).map(([k, v]) => [k, grid(v)])) as Record<
  string,
  Grid
>

const P = modePalette(DARK, 'convert')
const N = 80
/** The painted app's block: columns 4 to 75. */
const L = 4
const R = N - 4
const CANVAS = P.canvas
const ACCENT = P.accent
const GOLD = '#e5a23c'

/* ------------------------------------------------------------- drawing */

type Seg = [text: string, fg?: string, bg?: string, bold?: boolean]
const run = (text: string, fg?: string, bg?: string, bold = false): Run => ({
  text,
  ...(fg ? { fg } : {}),
  ...(bg ? { bg } : {}),
  ...(bold ? { bold } : {}),
})
const blankRow = (): Cell[] => Array.from({ length: N }, () => ({ ch: ' ', bg: CANVAS }))
const copy = (row: Cell[] | undefined): Cell[] => (row ?? blankRow()).map((c) => ({ ...c }))
const len = (segs: Seg[]) => segs.reduce((n, [t]) => n + [...t].length, 0)
const rlen = (row: Row) => row.reduce((n, r) => n + [...r.text].length, 0)

/** `segs` written on `row` from column `at`; a cell keeps its fill unless the segment has one. */
function put(row: Cell[], at: number, segs: Seg[]): Cell[] {
  let i = at
  for (const [text, fg, bg, bold] of segs)
    for (const ch of text) {
      const under = row[i]
      if (under) row[i] = { ch, fg, bg: bg ?? under.bg ?? CANVAS, b: !!bold }
      i++
    }
  return row
}
/** Cells `from`–`to` of `row` filled with `bg`, emptied. */
function clear(row: Cell[], from: number, to: number, bg: string): Cell[] {
  for (let i = from; i < to; i++) row[i] = { ch: ' ', bg }
  return row
}

/** A key as the key row draws it: the cap on the key grey, the words dim. */
const cap = (k: string, words: string): Seg[] => [
  [' ', undefined, P.keycapBg],
  [k, P.fg, P.keycapBg, true],
  [' ', undefined, P.keycapBg],
  [` ${words}`, P.dim],
]
function keyRow(main: Array<[string, string]>, foot: Array<[string, string]> = [['esc', 'cancel']]): Cell[] {
  const left: Seg[] = main.flatMap(([k, w], i) => (i ? [['  '] as Seg, ...cap(k, w)] : cap(k, w)))
  const right: Seg[] = foot.flatMap(([k, w], i) => [
    ...(i ? ([[' · ', P.border]] as Seg[]) : []),
    [k, P.fg] as Seg,
    ...(w ? ([[` ${w}`, P.border]] as Seg[]) : []),
  ])
  return put(put(blankRow(), L, left), R - len(right), right)
}

const shot = (g: Grid) => termHtml(P, g)
const DONE = F.done as Grid
const TOP = [copy(DONE[0]), copy(DONE[1])]
const RULE = copy(DONE[22])

/* ------------------------------------------- Continue editing's window */

const TARGETS = ['jpeg', 'webp', 'avif', 'gif', 'tiff', 'pdf'] as const
/** The editor as it opens on IMG_2041.jpg: Trim has nothing to trim, the three models are not added. */
function editor(at = 2): Editor {
  const e = withReasons(
    withMissing(
      openEditor({
        target: 'jpeg',
        quality: 80,
        targets: [...TARGETS],
        scales: [2, 3, 4],
        cutout: true,
      }),
      { sharpen: 41_000_000, boost: 41_000_000, cutout: 30_000_000 },
    ),
    { trim: 'no empty edges' },
  )
  return { ...e, at }
}
const withRow = (e: Editor, id: EditorRow['id'], patch: Partial<EditorRow>): Editor => ({
  ...e,
  rows: e.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
})
/** Compress under 300 KB selected, as the friend did. */
const compressed = (at = 2) => withRow(editor(at), 'compress', { on: true, value: 300_000 })

const footOk = (bytes: string, change: string): Row => [
  run('✓ ', P.ok, undefined, true),
  run('IMG_2041.jpg', P.fg, undefined, true),
  run('   now ', P.border),
  run(bytes, P.fg, undefined, true),
  run(`   ${change}`, P.ok, undefined, true),
]
const FOOT_DONE = footOk('708 KB', '95.6% smaller')
const FOOT_EDITED = footOk('297 KB', '98.1% smaller')
const SPIN = '⠹'

/** Done's rows under the header, as a window covers them. */
// Without Done's foot (p save as preset · continue editing →): the window's
// own backdrop, doneUnder, draws only the body.
const UNDER: Row[] = DONE.slice(2, 22).map((r, i) => (i === 18 ? [] : rowOf(r)))

/** The window centred over `under`, as the app places it, its area the 20 rows under the header. */
function overDone(
  title: string,
  lines: Row[],
  under: Row[] = UNDER,
  o: { width?: number; top?: number; left?: number } = {},
): Row[] {
  const width = o.width ?? 68
  const top = o.top ?? Math.max(0, Math.floor((21 - (lines.length + 2)) / 2) - 1)
  return windowOver(P, under, {
    title,
    lines,
    width,
    columns: N,
    top,
    ...(o.left === undefined ? {} : { left: o.left }),
  }).slice(0, 20)
}
const screen = (middle: Row[], keys: Cell[]): Grid => [
  ...TOP.map(copy),
  ...toGrid(middle, N).map((r) => r.map((c) => ({ ...c, bg: c.bg ?? CANVAS }))),
  copy(RULE),
  keys,
]
/** Where a row's own window opens: under the row, from the value column. */
const SUB_LEFT = Math.floor((N - 68) / 2) + 1 + 3 + 2 + 19 - 2
const winTop = (lines: Row[]) => Math.max(0, Math.floor((21 - (lines.length + 2)) / 2) - 1)

const EDIT_KEYS = keyRow([
  ['↑↓', 'choose'],
  ['space', 'select'],
  ['→', 'more'],
  ['↵', 'done'],
])

/** A plain line inside the window, 3 cells in, as the foot sits. */
const inset = (runs: Run[]): Row => [run('   '), ...runs]
/** The Done strip's way of saying the steps: dim source, faint arrows, the rest white bold. */
function chain(parts: string[]): Run[] {
  return parts.flatMap((t, i) =>
    i === 0
      ? [run(t, P.dim)]
      : [run(' → ', P.faint), run(t, P.fg, undefined, true)],
  )
}
const STEPS = ['PNG', 'JPEG 80', 'under 300 KB']

/* --------------------------------------------------------------- figures */

const frameOf = (g: Grid, caption?: string) =>
  `<figure class="fr">${shot(g)}${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`
const stack = (...parts: string[]) => `<div class="stack">${parts.join('')}</div>`

/* ---------------------------------------------------------------- today */

const today: Array<[string, string, string]> = [
  ['done', '1 · Done', '“continue editing →” and “p save as preset” are the quietest words on screen. Nothing says what either does.'],
  ['editor', '2 · → opens nine rows', 'The cursor starts on Compress, which nobody asked for. ● and ○ are not explained; three rows say “not added”, one “no empty edges”.'],
  ['compressSub', '3 · space on Compress', 'A window asks for a size in KB. Compress mode asked “By quality or To a target size”; here there is only one.'],
  ['working', '4 · it works', 'A spinner and “Compressing”, nothing more. Undoing the change here used to leave it spinning forever (fixed in b91c125).'],
  ['edited', '5 · the file as it is now', '“98.1% smaller” is against the original, not against the file you had a moment ago, so a step that made it bigger read as a saving (fixed).'],
  ['save', '6 · p, Save as preset', 'The window covers the steps you are about to save. Nothing says what a preset is, or where you will find it again.'],
  ['saved', '7 · saved', '“✓ saved as webblog” — and the app never mentions it again. The only way to run it is forge --preset webblog in a shell.'],
]
const todayHtml = `<div class="flow">${today
  .map(([k, t, c]) => `<figure class="fr"><div class="ft">${t}</div>${shot(F[k] as Grid)}<figcaption>${c}</figcaption></figure>`)
  .join('<div class="arrow">→</div>')}</div>`

/* ======================================================= A · where presets live */

/** The / menu with a Presets section first: each preset a command, its steps where a command's words go. */
function menuWithPresets(): Grid {
  const g = (F.menu as Grid).map(copy)
  const SHELF = '#2c2c2c'
  const section = (name: string, row: number) => {
    const r = clear(g[row] as Cell[], 4, 72, SHELF)
    put(r, 8, [[name, GOLD, SHELF, true], [' ', undefined, SHELF], ['─'.repeat(72 - 9 - name.length), P.faint, SHELF]])
  }
  const item = (row: number, cmd: string, words: string, lit: boolean) => {
    const bg = lit ? P.panelBand : SHELF
    const r = clear(g[row] as Cell[], lit ? 6 : 4, 72, bg)
    if (lit) put(r, 4, [['  ', undefined, SHELF], ['▌', GOLD, bg], [' ', undefined, bg]])
    put(r, 8, [[cmd, P.fg, bg, lit], [' '.repeat(Math.max(1, 14 - cmd.length)), undefined, bg], [words, lit ? P.dim : P.border, bg]])
  }
  for (let row = 4; row <= 16; row++) clear(g[row] as Cell[], 4, 72, SHELF)
  section('Presets', 4)
  item(6, '/webblog', 'PNG → JPEG 80 → under 300 KB', true)
  item(7, '/social', '1080 wide → Crop to shape 1:1', false)
  section('Settings', 9)
  for (const [i, c] of ['/theme', '/extensions', '/right-click', '/cli', '/update', '/about'].entries())
    item(11 + i, c, '', false)
  // The field: what was typed.
  put(clear(g[19] as Cell[], 10, 76, '#242424'), 10, [['/web', P.fg, '#242424']])
  ;(g[23] as Cell[]).splice(0, N, ...keyRow([['↑↓', 'choose'], ['↵', 'open']], [['esc', 'close'], ['ctrl-c', 'quit']]))
  return g
}

/** Home after /webblog: the preset is the mode, its steps under the tabs, the drop zone as ever. */
function homeOnPreset(): Grid {
  const g = (F.home as Grid).map(copy)
  const row = g[7] as Cell[]
  clear(row, 4, 76, CANVAS)
  put(row, 4, [[' ', undefined, '#262626'], ['/', ACCENT, '#262626', true], [' ', undefined, '#262626'], ['webblog', P.fg, '#262626', true], [' ', undefined, '#262626']])
  put(row, 17, chain(STEPS).map((r) => [r.text, r.fg, undefined, r.bold] as Seg))
  ;(g[23] as Cell[]).splice(0, N, ...keyRow([], [['esc', 'back to convert'], ['ctrl-c', 'quit']]))
  return g
}

/** Convert to, with saved presets listed above the formats: the next photo can go straight through one. */
function pickerWithPresets(): Grid {
  const g = (F.picker as Grid).map(copy)
  for (let row = 8; row <= 21; row++) clear(g[row] as Cell[], 0, N, CANVAS)
  put(g[8] as Cell[], 4, [['Convert to', ACCENT, CANVAS, true]])
  const SEL = '#323232'
  const line = (row: number, name: string, after: Seg[], lit = false) => {
    const r = g[row] as Cell[]
    if (lit) {
      clear(r, 4, 56, SEL)
      put(r, 4, [['▌', ACCENT, SEL], [' ', undefined, SEL], [name, P.fg, SEL, true]])
      put(r, 22, after.map(([t, fg, , b]) => [t, fg, SEL, b] as Seg))
    } else {
      put(r, 6, [[name, P.fg]])
      put(r, 22, after)
    }
  }
  line(10, 'webblog', [['JPEG 80 → under 300 KB', P.dim], ['   297 KB', P.fg, undefined, true]], true)
  line(11, 'social', [['1080 wide → 1:1', P.border]])
  put(g[12] as Cell[], 6, [['─'.repeat(48), P.faint]])
  for (const [i, f] of ['JPEG', 'WebP', 'AVIF', 'GIF', 'TIFF', 'PDF'].entries()) line(13 + i, f, [])
  return g
}

/** Home with a presets tab: the saved ones as a list where the drop zone's dots are. */
function presetsTab(): Grid {
  const g = (F.home as Grid).map(copy)
  const row = g[7] as Cell[]
  clear(row, 4, 76, CANVAS)
  const tabs: Array<[string, string]> = [['1', 'convert'], ['2', 'compress'], ['3', 'pdf'], ['4', 'edit'], ['5', 'transcribe'], ['6', 'colour'], ['7', 'presets']]
  // Seven only fit in the block at 80 columns with two-cell gaps, the lit
  // one padded on its fill: exactly the 72 cells from 4 to 75.
  let x = 4
  for (const [n, t] of tabs) {
    const on = t === 'presets'
    if (on) {
      x -= 1
      const bg = '#262626'
      put(row, x, [[' ', undefined, bg], [n, ACCENT, bg, true], [' ', undefined, bg], [t, P.fg, bg, true], [' ', undefined, bg]])
    } else put(row, x, [[n, P.border], [' '], [t, P.dim]])
    x += n.length + 1 + t.length + 2
  }
  // The drop zone keeps its shape and dots; the list sits under it.
  const SEL = '#323232'
  for (let r = 15; r <= 21; r++) clear(g[r] as Cell[], 0, N, CANVAS)
  put(clear(g[16] as Cell[], 4, 60, SEL), 4, [['▌', ACCENT, SEL], [' ', undefined, SEL], ['webblog', P.fg, SEL, true], ['        ', undefined, SEL], ['JPEG 80 → under 300 KB', P.dim, SEL]])
  put(g[17] as Cell[], 6, [['social', P.fg], ['         ', undefined], ['1080 wide → 1:1', P.border]])
  ;(g[23] as Cell[]).splice(0, N, ...keyRow([['↑↓', 'choose'], ['⌫', 'delete']], [['1–7 ←→', 'mode'], ['ctrl-c', 'quit']]))
  return g
}

/** Finder's right-click menu with Forge's Quick Actions, each preset one of them. */
const finderMenu = `<div class="mac"><div class="mac-file"><div class="thumb"></div>IMG_2041.png</div><div class="mac-menu">
<div>Open</div><div>Open With</div><hr><div>Get Info</div><div>Rename</div><div>Compress “IMG_2041.png”</div><hr>
<div class="sub on">Quick Actions<span>›</span></div></div><div class="mac-menu side">
<div>Forge: Convert</div><div>Forge: Compress</div><hr><div class="on">Forge: webblog</div><div>Forge: social</div><hr><div>Customize…</div></div></div>`

/* ====================================================== B · the editing window */

const B0 = screen(overDone('Continue editing', editorLines(P, editor(), [FOOT_DONE], 66)), EDIT_KEYS)

/** B1: the steps so far as the window's first line, the rows under it. */
function b1(): Grid {
  const lines = editorLines(P, compressed(), [FOOT_EDITED], 66)
  lines.splice(1, 0, inset(chain(STEPS)), [])
  return screen(overDone('Continue editing', lines), EDIT_KEYS)
}

/** B2: only what can apply; the models not added fold into one last row. */
function b2(): Grid {
  const e = editor()
  const keep = e.rows.filter((r) => !r.why && r.missing === undefined)
  const lines = editorLines(P, { ...e, rows: keep }, [FOOT_DONE], 66)
  const more: Row = [
    run('   '),
    run('+ ', P.border),
    run('On-device models'.padEnd(19), P.dim),
    run('Sharpen · Boost · Remove background', P.faint),
  ]
  lines.splice(1 + keep.length, 0, more)
  return screen(overDone('Continue editing', lines), EDIT_KEYS)
}

/** B3: the foot says what this edit did to the file you had, before → after. */
function b3(): Grid {
  const foot: Row = [
    run('✓ ', P.ok, undefined, true),
    run('IMG_2041.jpg', P.fg, undefined, true),
    run('   708 KB', P.dim),
    run('  →  ', P.faint),
    run('297 KB', P.fg, undefined, true),
    run('   58% smaller', P.ok, undefined, true),
  ]
  return screen(overDone('Continue editing', editorLines(P, compressed(), [foot], 66)), EDIT_KEYS)
}

/** B4 (reopens W2): only the steps you have, and one row to add another; the rest wait in its window. */
function b4(open: boolean): Grid {
  const e = compressed()
  const have = e.rows.filter((r) => r.on)
  const lines = editorLines(P, { ...e, rows: have, at: open ? 99 : 0 }, [FOOT_EDITED], 66)
  const lit = open
  const bg = lit ? P.panelBand : undefined
  const add: Row = [
    run(lit ? ' › ' : '   ', ACCENT, bg, true),
    run('+ ', ACCENT, bg, true),
    run('Add a step'.padEnd(19), P.fg, bg, lit),
    run('  ›', P.border, bg),
  ]
  const padded: Row = [...add, run(' '.repeat(Math.max(0, 66 - rlen(add))), undefined, bg)]
  lines.splice(1 + have.length, 0, padded)
  let mid = overDone('Continue editing', lines)
  if (open) {
    const top = winTop(lines) + 1 + 1 + have.length
    const items = ['Resize', 'Trim edges', 'Crop to shape', 'Sharpen', 'Boost resolution', 'Remove background']
    const sub: Row[] = [
      [],
      ...items.map((t, i): Row => {
        const on = i === 0
        const b = on ? P.panelBand : undefined
        const out = i >= 3
        const r: Row = [
          run(on ? ' › ' : '   ', ACCENT, b, true),
          run(t.padEnd(20), out ? P.faint : on ? P.fg : P.dim, b, on),
          ...(out ? [run('not added', P.faint, b)] : []),
        ]
        return [...r, run(' '.repeat(Math.max(0, 40 - rlen(r))), undefined, b)]
      }),
      [],
    ]
    mid = windowOver(P, mid, { title: 'Add a step', lines: sub, width: 42, columns: N, top: top + 1, left: SUB_LEFT }).slice(0, 20)
  }
  return screen(
    mid,
    open
      ? keyRow([['↑↓', 'choose'], ['↵', 'add']], [['esc', 'back']])
      : keyRow([['↑↓', 'choose'], ['space', 'select'], ['→', 'more'], ['↵', 'done']]),
  )
}

/* ========================================================== C · while it works */

/** The window mid-rerun, Compress lit and spinning; `foot` and the rows' look vary. */
function working(foot: Row[], o: { lock?: boolean; keys?: Cell[] } = {}): Grid {
  let lines = editorLines(P, compressed(), foot, 66, { id: 'compress', glyph: SPIN })
  if (o.lock) {
    // Every row but the working one goes faint, so the window reads as busy.
    lines = lines.map((row, i) =>
      i >= 1 && i <= 9 && i !== 3 ? row.map((r) => (r.fg ? { ...r, fg: P.faint, bold: false } : r)) : row,
    )
  }
  return screen(overDone('Continue editing', lines), o.keys ?? EDIT_KEYS)
}
const spinFoot = (...after: Run[]): Row => [run(`${SPIN} `, ACCENT, undefined, true), run('Compressing', P.fg, undefined, true), ...after]

/* ========================================================== D · saving the steps */

/** The Save as preset window's own lines, as the app draws them (captured): 66 cells inside the frame. */
function saveLines(typed = false): Row[] {
  const g = F[typed ? 'saveTyped' : 'save'] as Grid
  const out: Row[] = []
  for (let r = 6; r <= 16; r++) out.push(rowOf((g[r] as Cell[]).slice(7, 73)))
  // The capture faded nothing inside the window; its rows end at the frame.
  while (out.length && rlen(out[out.length - 1] as Row) === 0) out.pop()
  return out
}
const SAVE_KEYS = keyRow([['↵', 'save'], ['↑↓', 'folder'], ['tab', 'make default'], ['/', 'new folder']])

/** The edit window, faded, with Save as preset over it: p pressed inside Continue editing. */
function saveOverEditor(withSteps: boolean): Grid {
  const editorRows = overDone('Continue editing', editorLines(P, compressed(), [FOOT_EDITED], 66))
  const lines = saveLines(true)
  if (withSteps) lines.splice(0, 1, [], inset(chain(STEPS)), [])
  return screen(overDone('Save as preset', lines, editorRows), SAVE_KEYS)
}

/** Done's foot with the saved line saying how to run it again. */
function savedSays(words: Run[]): Grid {
  const g = (F.saved as Grid).map(copy)
  const r = clear(g[20] as Cell[], 4, 50, CANVAS)
  put(r, 4, words.map((w) => [w.text, w.fg, undefined, w.bold] as Seg))
  return g
}

/* ======================================================= E · Compress and Quality */

/** E1: one Quality row; its window offers compress mode's two ways. */
function e1(): Grid {
  const e = editor(1)
  const rows = e.rows.filter((r) => r.id !== 'compress')
  const lines = editorLines(P, { ...e, rows, at: 1 }, [FOOT_DONE], 66)
  let mid = overDone('Continue editing', lines)
  const top = winTop(lines) + 1 + 1 + 1
  const opt = (lit: boolean, name: string, after: Run[]): Row => {
    const b = lit ? P.panelBand : undefined
    const r: Row = [run(lit ? ' › ' : '   ', ACCENT, b, true), run(name.padEnd(20), lit ? P.fg : P.dim, b, lit), ...after]
    return [...r, run(' '.repeat(Math.max(0, 40 - rlen(r))), undefined, b)]
  }
  const sub: Row[] = [
    [],
    opt(true, 'By quality', [run('80', P.fg, P.panelBand, true)]),
    opt(false, 'To a target size', [run(' ', undefined, P.band), run('    ', undefined, P.band), run(' KB', P.dim)]),
    [],
  ]
  mid = windowOver(P, mid, { title: 'Quality', lines: sub, width: 42, columns: N, top: top + 1, left: SUB_LEFT }).slice(0, 20)
  return screen(mid, keyRow([['↑↓', 'choose'], ['↵', 'confirm']], [['esc', 'back']]))
}

/** E2: both rows stay; with Compress on, Quality says it is now the most it may use. */
function e2(): Grid {
  const e = compressed(2)
  const lines = editorLines(P, e, [FOOT_EDITED], 66)
  // The Quality row's value: "up to 80".
  const q = lines[2] as Row
  const at = q.findIndex((r) => r.text === '80')
  if (at >= 0) q.splice(at, 1, run('up to 80', P.fg))
  const fixed: Row = [...q]
  const w = rlen(fixed)
  if (w > 66) fixed.splice(-1, 1, run(' '.repeat(Math.max(0, 66 - (w - rlen([q[q.length - 1] as Run]))))))
  lines[2] = fixed
  return screen(overDone('Continue editing', lines), EDIT_KEYS)
}

/** E3: the Quality row holds either answer: ‹ 80 › or a size, tab between them, no window. */
function e3(): Grid {
  const e = editor(1)
  const rows = e.rows.filter((r) => r.id !== 'compress')
  const lines = editorLines(P, { ...e, rows, at: 1 }, [FOOT_EDITED], 66)
  const b = P.panelBand
  const lit: Row = [
    run(' › ', ACCENT, b, true),
    run('● ', ACCENT, b),
    run('Quality'.padEnd(19), P.fg, b, true),
    run('80', P.faint, b),
    run('  ·  ', P.faint, b),
    run(' under ', P.dim, b),
    run(' 300 ', P.fg, P.band, true),
    run(' ', undefined, P.fg),
    run(' KB', P.dim, b),
  ]
  lines[2] = [...lit, run(' '.repeat(Math.max(0, 66 - rlen(lit))), undefined, b)]
  return screen(overDone('Continue editing', lines), keyRow([['0–9', 'size'], ['tab', 'quality'], ['↵', 'done']]))
}

/* ------------------------------------------------------------ concepts */

const concepts: PageConcept[] = [
  /* A */
  {
    id: 'A1',
    tab: '1 · Where presets live',
    section: 'OPTIONS — pick one or more: where a saved preset is found again',
    name: 'Each preset is a / command',
    idea: 'MY PICK, with A2. The / menu gets a Presets section first: /webblog, its steps where a command’s words go. Choosing it makes the preset the mode — its steps under the tabs — and the next file dropped goes straight through it. The name rule (letters, digits, dashes) was made for this: /webblog here, forge --preset webblog in a shell.',
    html: stack(frameOf(menuWithPresets(), 'typing /web'), frameOf(homeOnPreset(), '↵ — webblog is the mode until esc')),
  },
  {
    id: 'A2',
    name: 'Presets first in Convert to',
    idea: 'MY PICK, with A1. Where you already are when you drop the next photo: saved presets sit above the formats, each with its steps and the size it would make, measured like a format’s. One ↵ runs all the steps. Found without knowing it exists.',
    html: frameOf(pickerWithPresets()),
  },
  {
    id: 'A3',
    name: 'A presets tab on home',
    idea: 'A seventh tab, 7 presets: the list where the field is, the drop zone above. Drop a file on the lit one. Also where a preset is deleted (⌫). Costs a tab for something many people will have none of, and seven tabs only just fit at 80 columns (the gaps tighten to two cells).',
    html: frameOf(presetsTab()),
  },
  {
    id: 'A4',
    name: 'Each preset in Finder’s right-click',
    idea: 'Forge already installs Quick Actions (/right-click). Each preset becomes one more: right-click photos in Finder, Forge: webblog, done — Forge never opened. Works with A1–A3, not instead of them.',
    html: finderMenu,
  },

  /* B */
  {
    id: 'B0',
    tab: '2 · The editing window',
    section: 'OPTIONS — what Continue editing shows. Its shape (W2: one window, a row per operation, ● / ○, a row’s window under it) stays unless you pick B4',
    name: 'Today, after the fixes',
    idea: 'For comparison. Opens with the cursor on Compress; nine rows; four of them cannot be used on this photo.',
    html: frameOf(B0),
  },
  {
    id: 'B1',
    name: 'The steps on the window’s first line',
    idea: 'MY PICK. PNG → JPEG 80 → under 300 KB, in Done’s strip style, grows as you select rows. Says what ● means without a word of help: the dots are the steps. It is also exactly what Save as preset will keep.',
    html: frameOf(b1()),
  },
  {
    id: 'B2',
    name: 'Only what applies to this photo',
    idea: 'Trim (nothing to trim) is gone; the three models that are not added fold into one last row that opens the extension offer. Six rows instead of nine, none of them dead.',
    html: frameOf(b2()),
  },
  {
    id: 'B3',
    name: 'The foot says before → after',
    idea: 'What this edit did to the file you had: 708 KB → 297 KB, 58% smaller. Today’s foot compares with the 16 MB original, so every step looks like a big saving — even one that made the file bigger.',
    html: frameOf(b3()),
  },
  {
    id: 'B4',
    name: 'Only your steps, and + Add a step (reopens W2)',
    idea: 'Drawn because nobody knew where to start in nine rows. The window lists only the steps you have; + Add a step opens the rest under it. Reopens the decided W2, so only if the friend test changes your mind.',
    html: stack(frameOf(b4(false), 'what you have'), frameOf(b4(true), '→ on + Add a step')),
  },

  /* C */
  {
    id: 'C1',
    tab: '3 · While it works',
    section: 'OPTIONS — what the window says while a step runs (here Compress on a 16 MB photo, a few seconds)',
    name: 'Today, after the fixes',
    idea: 'For comparison: the row spins, the foot says Compressing, a clock after 3 s. Nothing says the file on disk is untouched or how far along it is.',
    html: frameOf(F.working as Grid),
  },
  {
    id: 'C2',
    name: 'Says how far: try 3 of 8',
    idea: 'MY PICK. A size search encodes at most 8 times and Forge knows which try it is on, so this is a fact, not a made-up bar (invariant 7 allows it). Long waits stop feeling stuck.',
    html: frameOf(working([spinFoot(run('   try 3 of 8', P.dim))])),
  },
  {
    id: 'C3',
    name: 'The old file stays until the new one lands',
    idea: 'The foot keeps the file you have, dimmed, with an arrow to the one being made. Says without words that nothing is lost yet; esc stop is on the key row.',
    html: frameOf(
      working(
        [
          [
            run(`${SPIN} `, ACCENT, undefined, true),
            run('IMG_2041.jpg', P.dim, undefined, true),
            run('   708 KB', P.dim),
            run('  →  ', P.faint),
            run('…', P.dim),
          ],
        ],
        { keys: keyRow([['↑↓', 'choose'], ['space', 'select']], [['esc', 'stop']]) },
      ),
    ),
  },
  {
    id: 'C4',
    name: 'The window waits with you',
    idea: 'Every row but the working one goes faint and the keys shrink to esc stop: plainly busy, plainly stoppable. Costs the ability to queue the next change while one runs.',
    html: frameOf(working([spinFoot(run('   0:04', P.dim))], { lock: true, keys: keyRow([], [['esc', 'stop']]) })),
  },

  /* D */
  {
    id: 'D1',
    tab: '4 · Saving the steps',
    section: 'OPTIONS — saving what you just did, from where you are',
    name: 'p inside the window',
    idea: 'MY PICK, with D2. The edit window’s keys gain p save as preset, the same key as on Done. The Save as preset window opens over the edit window; esc goes back to it.',
    html: stack(
      frameOf(screen(overDone('Continue editing', editorLines(P, compressed(), [FOOT_EDITED], 66)), keyRow([['↑↓', 'choose'], ['space', 'select'], ['↵', 'done'], ['p', 'save as preset']])), 'the edit window’s keys'),
      frameOf(saveOverEditor(false), 'p'),
    ),
  },
  {
    id: 'D2',
    name: 'The save window shows what it keeps',
    idea: 'MY PICK, with D1. The steps on the save window’s first line, above the name: you name something you can see. Today the window covers them.',
    html: frameOf(saveOverEditor(true)),
  },
  {
    id: 'D3',
    name: 'Asked once, on ↵',
    idea: 'Leaving the window with new steps asks once whether to keep them; ↵ again just leaves. Hard to miss — but a question every time you edit, which may wear.',
    html: frameOf(
      screen(
        overDone('Continue editing', editorLines(P, compressed(), [[run('Keep these steps as a preset?', P.fg, undefined, true)]], 66)),
        keyRow([['p', 'save as preset'], ['↵', 'just this file']], [['esc', 'back']]),
      ),
    ),
  },
  {
    id: 'D4',
    name: 'The saved line says how to use it',
    idea: 'With A1: ✓ saved as /webblog — the command is the name, so the confirmation teaches where it lives. (Done’s foot itself is being redesigned on the done-next page; this is only the words.)',
    html: frameOf(savedSays([run('✓ saved as ', P.ok), run('/webblog', P.ok, undefined, true)])),
  },

  /* E */
  {
    id: 'E1',
    tab: '5 · Compress and Quality',
    section: 'OPTIONS — Compress and Quality both set how small the file gets; today they are two rows that silently fight',
    name: 'One Quality row, compress mode’s two ways',
    idea: 'The Compress row goes. Quality’s window offers By quality or To a target size, exactly as compress mode asks. One row, one answer.',
    html: frameOf(e1()),
  },
  {
    id: 'E2',
    name: 'Both rows, Quality says “up to 80”',
    idea: 'MY PICK — smallest change, keeps W2. Since b91c125 a target size never goes above the Quality row; with Compress on, Quality’s value reads up to 80 so the link is visible.',
    html: frameOf(e2()),
  },
  {
    id: 'E3',
    name: 'Quality holds either answer, in the row',
    idea: 'No window: the lit Quality row shows 80 · under ___ KB; typing digits fills the size, tab goes back to the slider. Fast, but two answers in one row is a lot to read.',
    html: frameOf(e3()),
  },
]

const before = `<div class="box"><h3>Status</h3><ul>
<li><b>Fixed</b> (b91c125): the spinner that never stopped; ↵ while working; errors cut off at the window’s edge; Compress making a file bigger; Compress refusing a PNG; a /compress result losing its compression when edited or saved.</li>
<li><b>Elsewhere</b>: Done’s own buttons (Save as preset, Continue editing, Home…) are on the done-next page, so nothing here redraws Done.</li>
</ul></div>
<div class="box"><h3>Questions for you</h3><ol>
<li><b>Where should a saved preset be found again?</b> (tab 1) Today: nowhere in the app.</li>
<li><b>What should the edit window show?</b> (tab 2) — and is B4 worth reopening W2 for?</li>
<li><b>What should it say while a step runs?</b> (tab 3)</li>
<li><b>How do you save the steps you just made?</b> (tab 4)</li>
<li><b>Compress and Quality:</b> one row or two? (tab 5)</li>
<li><b>New words to approve</b> (each appears in a screen): “Presets” (menu section) · “On-device models” (B2, a row name) · “+ Add a step” (B4) · “try 3 of 8” (C2) · “esc stop” (C3, C4) · “p save as preset” in the edit window (D1) · “Keep these steps as a preset?” and “just this file” (D3) · “saved as /webblog” (D4) · “By quality” / “To a target size” in the edit window (E1) · “up to 80” (E2).</li>
<li><b>Small calls I’d make unless you object:</b> the edit window opens with the cursor on its first row, not on Compress; a space typed in a preset’s name becomes a dash as you type (today it is dropped); ↵ after a failed step keeps the window open instead of closing with nothing kept.</li>
</ol></div>
<h2 style="margin-top:48px">Today — the friend test, step by step</h2>
<p class="lede" style="margin-top:6px">Captured from the app (dark, 80 × 24) on a 16 MB photo: convert to JPEG, → Continue editing, Compress under 300 KB, ↵, p, save as webblog.</p>
${todayHtml}
<style>
.flow{display:flex;gap:14px;align-items:flex-start;overflow-x:auto;padding:18px 0 10px}
.flow .arrow{font-size:28px;color:#4a4f5a;align-self:center}
.fr{margin:0;display:flex;flex-direction:column;gap:8px}
.fr figcaption{font-size:13.5px;color:#a9aebb;max-width:690px}
.fr .ft{font:600 14px -apple-system,sans-serif;color:#e2e4ea}
.stack{display:flex;flex-direction:column;gap:18px}
.mac{display:flex;gap:0;align-items:flex-start;font:13px -apple-system,sans-serif;color:#e8e8e8;padding:20px;background:linear-gradient(135deg,#2a3b55,#4a3456);border-radius:10px;width:640px;height:330px}
.mac-file{display:flex;flex-direction:column;align-items:center;gap:6px;margin:30px 24px 0 10px;font-size:12px}
.mac-file .thumb{width:64px;height:48px;background:linear-gradient(135deg,#c8a,#79c);border-radius:4px;outline:2px solid #4b8bf5}
.mac-menu{background:rgba(40,40,44,.92);border:1px solid #555;border-radius:8px;padding:5px;min-width:200px;box-shadow:0 10px 30px rgba(0,0,0,.4);margin-top:40px}
.mac-menu.side{margin-top:178px;margin-left:-4px}
.mac-menu div{padding:3px 10px;border-radius:4px;display:flex;justify-content:space-between}
.mac-menu div.on{background:#2f6fe0;color:#fff}
.mac-menu hr{border:0;border-top:1px solid #555;margin:4px 6px}
</style>`

writeFileSync(
  'mockups/presets-ux-2026-10.html',
  feedbackPage({
    page: 'presets-ux',
    title: 'Forge · presets and continue editing, after the friend test',
    heading: 'Presets and Continue editing: what nobody got',
    lede: 'Your friends could not tell what Continue editing does, watched Compress spin with no word of what was happening, and had no way to find a saved preset again. Five questions, one tab each; every option is drawn with the app’s own pieces over the real Done.',
    before,
    concepts,
  }),
)
console.log('wrote mockups/presets-ux-2026-10.html')
