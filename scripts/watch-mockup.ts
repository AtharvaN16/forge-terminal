/**
 * forge watch, round two (2026-10-16). Round one's notes:
 * - a folder dropped on home gets its own frame, a folder's shape;
 * - no "Which files" step: a dropped folder converts, and Done says it is
 *   watching the folder, any new file will be converted, ↵ stops;
 * - Save to's default for a folder is a new folder: "images converted"
 *   beside it, or a "converted" subfolder inside it (both offered);
 * - the watching screen must show that something is happening;
 * - files landing: more options, more polish.
 *
 * Home, Quality and the "or drop a folder" row are cells captured from the
 * real app at 80 × 24 (/tmp/forge-watch/frames-*.json, by a throwaway test).
 * The header bar, Done's bar, Save to's rows, Working's line and bar are the
 * app's own art functions; the dotted surface is a copy of home-art's
 * private `dotted()`. Animated figures carry their frames; the page swaps
 * only the rows that change.
 *
 *   npx tsx scripts/watch-mockup.ts   → mockups/watch-2026-10.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import stringWidth from 'string-width'
import { formatBytes } from '../src/core/units.js'
import { trailBarRow } from '../src/shell/bar-art.js'
import { windowOver } from '../src/shell/colour/system-art.js'
import { doneBody } from '../src/shell/done-art.js'
import {
  blank,
  gradientAt,
  HOME_MARGIN,
  mix,
  type Row,
  type Run,
  rippleLevel,
  width,
} from '../src/shell/home-art.js'
import { sliderRow } from '../src/shell/quality-art.js'
import { FIELD_WIDTH, fieldRow, filesRow, folderRow } from '../src/shell/save-as-art.js'
import {
  DARK,
  dotGradient,
  LIGHT,
  modeColours,
  modeGradient,
  modePalette,
  type Palette,
  type ShellMode,
} from '../src/shell/theme.js'
import { middleEllipsis } from '../src/shell/width.js'
import { pagesRow, workLine } from '../src/shell/working-art.js'

const N = 80
const H = 24
const MODE: ShellMode = 'convert'

interface Cell {
  ch: string
  fg: string | null
  bg: string | null
  b: boolean
}
const frames = (name: string) =>
  JSON.parse(readFileSync(`/tmp/forge-watch/frames-${name}.json`, 'utf8')) as Record<
    string,
    Cell[][]
  >

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

/** The dropped folder: the short name the story uses, or a long one to see what gives. */
interface Folder {
  key: 'short' | 'long'
  name: string
  folder: string
}
interface Look {
  p: Palette
  name: 'dark' | 'light'
  f: Record<string, Cell[][]>
  d: Folder
}
const looksOf = (): Look[] => {
  const dark = frames('dark')
  const light = frames('light')
  const out: Look[] = []
  for (const d of FOLDERS)
    out.push(
      { p: modePalette(DARK, MODE), name: 'dark', f: dark, d },
      { p: modePalette(LIGHT, MODE), name: 'light', f: light, d },
    )
  return out
}
const captured = (L: Look, frame: string, row: number): Row => rowOf(L.f[frame]?.[row] ?? [])

/* ------------------------------------------------------------ the story */

const NAME = 'images'
const PARENT = '~/Developer/portfolio/public'
const LONG_NAME = 'Portfolio 2026 – final selects for the new website'
const folderOf = (key: Folder['key'], name: string): Folder => ({
  key,
  name,
  folder: `${PARENT}/${name}`,
})
const FOLDERS = [folderOf('short', NAME), folderOf('long', LONG_NAME)]
/** The folder's name, middle-ellipsed to `max` cells. */
const nm = (L: Look, max: number) => middleEllipsis(L.d.name, max)
const MB = 1000 * 1000
const KB = 1000

const HERE = 24
const HERE_IN = 86.4 * MB
const HERE_OUT = 10.2 * MB

interface Landed {
  name: string
  at: string
  sizes?: [number, number]
  phase?: string
  clock?: string
  failed?: string
  left?: string
}
/** Newest first, as the log shows them. */
const LANDED: Landed[] = [
  { name: 'IMG_4113.HEIC', at: '14:07', phase: 'Encoding WebP', clock: '4.1s' },
  { name: 'IMG_4112.HEIC', at: '14:06', sizes: [3.1 * MB, 412 * KB] },
  { name: 'Screenshot 2026-10-16 at 14.02.11.png', at: '14:02', sizes: [1.9 * MB, 164 * KB] },
  { name: 'scan-03.png', at: '13:58', failed: 'the file is damaged' },
  { name: 'intro.mp4', at: '13:55', left: 'not an image' },
  { name: 'team-offsite.jpg', at: '13:51', sizes: [5.4 * MB, 690 * KB] },
  { name: 'hero-v2.png', at: '13:40', sizes: [2.2 * MB, 188 * KB] },
]
const DONE = LANDED.filter((l) => l.sizes)
const ANSWERS = ['WebP', '80', 'Same location']
/** The first of the 24 as Save as names them: the files keep their names. */
const FIRST_OUT = 'about-me.webp'

/* ------------------------------------------------------------ pieces */

const run = (text: string, fg?: string, bg?: string, bold = false): Run => ({ text, fg, bg, bold })
const pad = (row: Row, n: number, bg?: string): Row => [
  ...row,
  ...(n > width(row) ? [{ text: ' '.repeat(n - width(row)), bg }] : []),
]
const accent = (L: Look) => modeColours(L.p, MODE).fg

/** The bar, inside the app's 2-column margin. `breathe` dims its hatching (0 to 1). */
function header(L: Look, answers: string[], current: string, drift?: number, breathe = 0): Row {
  const row = trailBarRow({
    width: N - 4,
    palette: L.p,
    mode: MODE,
    trail: { answers, current },
    slanted: false,
    drift,
  })
  const out = breathe
    ? row.map((r) => (r.text === '╱' && r.fg ? { ...r, fg: mix(r.fg, L.p.canvas, breathe) } : r))
    : row
  return [blank(2), ...out]
}

const keycap = (L: Look, k: string) => run(` ${k} `, L.p.fg, L.p.keycapBg, true)

function keys(L: Look, main: [string, string][], foot: string, lead = 3): Row[] {
  const row: Row = [blank(lead)]
  main.forEach(([k, w], i) => {
    if (i) row.push(blank(2))
    row.push(keycap(L, k), run(` ${w}`, L.p.dim))
  })
  row.push(blank(Math.max(1, N - width(row) - stringWidth(foot) - 3)), run(foot, L.p.border))
  return [[blank(2), run('─'.repeat(N - 4), L.p.border)], row]
}

function screen(body: Row[], keyRows: Row[], h = H): Row[] {
  const rows = body.slice(0, h - keyRows.length)
  while (rows.length < h - keyRows.length) rows.push([])
  return [...rows, ...keyRows]
}

const title = (L: Look, text: string, right?: string): Row => [
  blank(3),
  run(text, accent(L), undefined, true),
  ...(right ? [blank(61 - 3 - text.length), run(right, L.p.border)] : []),
]

function pick(L: Look, text: string, selected: boolean): Row {
  if (!selected) return [blank(4), run(text, L.p.fg)]
  const body: Row = [run('▌', accent(L)), blank(1), run(text, L.p.fg, undefined, true)]
  return [blank(2), ...pad(body, 52).map((r) => ({ ...r, bg: L.p.listBand }))]
}

const top = (L: Look, answers: string[], current: string, drift?: number, breathe = 0): Row[] => [
  [],
  header(L, answers, current, drift, breathe),
  [],
]

/* ------------------------------------------------------- the dotted surface */

/**
 * home-art's `dotted()` (not exported), copied: a filled panel of dots, one
 * every third column, with `lines` centred in a clean cut-out. `scale` steps
 * the dots back; `ripple` draws it that many ms into its ripple.
 */
function dotted({
  columns,
  h,
  p,
  lines,
  pad: padding,
  scale = 1,
  ripple,
  lit,
  fill = p.selectionBg,
}: {
  columns: number
  h: number
  p: Palette
  lines: Row[]
  pad: number
  scale?: number
  ripple?: number
  /** Each dot's level (0 to 1) from its column and row in the surface, given its level at rest. */
  lit?: (c: number, r: number, rest: number) => number
  fill?: string
}): Row[] {
  const M = HOME_MARGIN
  const W = columns - M * 2
  const stops = dotGradient(p, MODE)
  const isDot = (c: number) => c % 3 === 0 && c >= 3 && c <= W - 4
  const mid = (h - 1) / 2
  const centre = (3 + Math.floor((W - 4) / 3) * 3) / 2
  const reach = Math.hypot(centre, mid * 2.2) + 14
  const level = (c: number, r: number) => {
    const dx = Math.abs(c - W / 2) / (W / 2)
    const dy = mid === 0 ? 0 : Math.abs(r - mid) / mid
    const rest = 0.5 + 0.4 * Math.min(1, Math.hypot(dx, dy * 0.6))
    if (lit) return lit(c, r, rest)
    if (ripple === undefined) return rest
    return rippleLevel(ripple, Math.hypot(c - centre, (r - mid) * 2.2), rest, reach)
  }
  const dot = (c: number, r: number, k: number) => {
    const rest = mix(fill, gradientAt(c + r * 2, W + 14, stops), k)
    return scale === 1 ? rest : mix(fill, rest, scale)
  }
  const top0 = Math.floor((h - lines.length) / 2)
  const words = Math.max(0, ...lines.map(width))
  let a = Math.max(0, Math.floor((W - words - padding * 2) / 2))
  let b = W - a
  while (a > 0 && !isDot(a - 1)) a--
  while (b < W && !isDot(b)) b++
  const cut = b - a
  const out: Row[] = []
  for (let r = 0; r < h; r++) {
    const line = lines[r - top0]
    const clear = r >= top0 && r < top0 + lines.length
    const row: Row = [blank(M)]
    let c = 0
    while (c < W) {
      if (clear && c === a) {
        const left = line ? Math.floor((cut - width(line)) / 2) : 0
        row.push(
          { text: ' '.repeat(Math.max(0, line ? left : cut)), bg: fill },
          ...(line ?? []).map((x) => ({ ...x, bg: x.bg ?? fill })),
          { text: ' '.repeat(Math.max(0, line ? cut - left - width(line) : 0)), bg: fill },
        )
        c += cut
        continue
      }
      const k = r >= 1 && r <= h - 2 && isDot(c) ? level(c, r) : 0
      row.push(k > 0 ? { text: '·', fg: dot(c, r, k), bg: fill } : { text: ' ', bg: fill })
      c++
    }
    out.push(row)
  }
  return out
}

/** Where a light sweeping to and fro over `n` cells is, `i` of `frames` in. */
const sweepAt = (i: number, frames: number, n: number) =>
  (0.5 - 0.5 * Math.cos((i / frames) * Math.PI * 2)) * (n - 1)
const glow = (c: number, at: number, spread: number) => Math.exp(-(((c - at) / spread) ** 2))

/* ------------------------------------------------------- the folder's card */

/*
 * Round eight: D1, today's file card (home-art's `stagedCardRows`: 52 wide,
 * the tag in the top edge in the mode's colour), with "FOLDER – name" in the
 * edge where a file's format goes, and the facts inside.
 */

const CARD_W = 52
const IMAGE_FACTS = `${HERE} images · ${formatBytes(HERE_IN)}`
/** The edge keeps at least this much line after the name, so it still reads as an edge. */
const EDGE_MIN = 3

/** The file card's rows: "FOLDER – name" in the top edge, `lines` inside, dim. */
function folderCard(L: Look, lines: string[], cw = CARD_W): Row[] {
  const e = L.p.border
  const kind = run('FOLDER', accent(L), undefined, true)
  const dash = run(' – ', e)
  const room = cw - 5 - width([kind, dash]) - EDGE_MIN
  const name = run(middleEllipsis(L.d.name, room), L.p.fg, undefined, true)
  const tw = width([kind, dash, name])
  const inner = (text: string): Row => [
    run('│ ', e),
    run(padText(text, cw - 4), L.p.dim),
    run(' │', e),
  ]
  return [
    [run('╭─ ', e), kind, dash, name, run(` ${'─'.repeat(cw - 5 - tw)}╮`, e)],
    ...lines.map(inner),
    [run(`╰${'─'.repeat(cw - 2)}╯`, e)],
  ]
}

const padText = (s: string, n: number) => middleEllipsis(s, n).padEnd(n)

type Frame = (L: Look) => Row[]
const PICK_FRAME: Frame = (L) => folderCard(L, [IMAGE_FACTS])

/** Home with the folder dropped, in `frame`, on the dots. */
function homeFolder(L: Look, frame: Frame = PICK_FRAME): Row[] {
  // The cut-out centres each line on its own: every line the frame's full width keeps it whole.
  const lines = frame(L)
  const w = Math.max(...lines.map(width))
  return homeWith(
    L,
    dotted({
      columns: N - 4,
      h: 7,
      p: L.p,
      lines: lines.map((r) => pad(r, w)),
      pad: 1,
      scale: 0.42,
    }),
  )
}

/** Home with the folder dropped, its drop surface `surface` (7 rows). */
function homeWith(L: Look, surface: Row[]): Row[] {
  const rows = Array.from({ length: H }, (_, i) => captured(L, 'folder', i))
  surface.forEach((r, i) => {
    rows[8 + i] = [blank(2), ...r]
  })
  rows[19] = []
  const k = keys(L, [['↵', 'convert']], 'esc clear · 1–5 ←→ mode · ctrl-c quit', 5)
  rows[22] = k[0] as Row
  rows[23] = k[1] as Row
  return rows
}

/** The steps' card: the same frame, off the dots, so ↵ does not make it jump. */
const card = (L: Look): Row[] => PICK_FRAME(L).map((r) => [blank(2), ...r])

/* ------------------------------------------------------------ steps */

function format(L: Look): Row[] {
  return screen(
    [
      ...top(L, [], 'Format'),
      ...card(L),
      [],
      title(L, 'Convert to'),
      [],
      ...['JPEG', 'PNG', 'WebP', 'AVIF', 'GIF', 'TIFF', 'PDF'].map((f) => pick(L, f, f === 'WebP')),
    ],
    keys(
      L,
      [
        ['↑↓', 'choose'],
        ['↵', 'confirm'],
      ],
      '1–5 mode · esc back · ctrl-c quit',
    ),
  )
}

function quality(L: Look): Row[] {
  return screen(
    [
      ...top(L, ['WebP'], 'Quality'),
      ...card(L),
      [],
      title(L, 'Quality', 'WebP'),
      [],
      captured(L, 'quality', 10),
      captured(L, 'quality', 11),
    ],
    keys(
      L,
      [
        ['←→', 'adjust'],
        ['↵', 'confirm'],
      ],
      '1–5 mode · esc back · ctrl-c quit',
    ),
  )
}

/**
 * Save as, as it is today when a save writes many files (a PDF's pages): the
 * "files" row in place of the name, then today's places. Same location is
 * the folder itself, where each image already is.
 */
function saveAs(L: Look): Row[] {
  const W = FIELD_WIDTH
  const f = (
    name: string,
    path: string,
    o: { first?: boolean; isDefault?: boolean; selected?: boolean } = {},
  ) => [blank(2), ...folderRow({ palette: L.p, width: W, label: name, path, ...o })]
  const gap = (): Row => [blank(2), ...fieldRow({ palette: L.p, width: W })]
  return screen(
    [
      ...top(L, ['WebP', '80'], 'Save as'),
      ...card(L),
      [],
      title(L, 'Save as'),
      [],
      [],
      gap(),
      [blank(2), ...filesRow({ palette: L.p, width: W, names: `${FIRST_OUT} … ${HERE} files` })],
      gap(),
      captured(L, 'saveas', 14),
      gap(),
      f('Same location', L.d.folder, { first: true, isDefault: true, selected: true }),
      f('Desktop', '~/Desktop'),
      f('Downloads', '~/Downloads'),
      f('New subfolder', `${L.d.folder}/…`),
      captured(L, 'saveas', 20),
      gap(),
      captured(L, 'saveas', 22),
    ],
    keys(
      L,
      [
        ['↵', 'save'],
        ['↑↓', 'folder'],
        ['tab', 'make default'],
      ],
      'esc back · ctrl-c quit',
    ),
  )
}

/** Converting what is there: Working's line, and a real count of files, as /pdf counts pages. */
function working(L: Look): Row[] {
  const count = pagesRow({ palette: L.p, mode: MODE, done: 9, total: HERE })
  const last = count[count.length - 1] as Run
  last.text = `  9 of ${HERE} images`
  return screen(
    [
      ...top(L, ANSWERS, 'Converting', 1.3),
      ...card(L),
      [],
      [
        blank(2),
        ...workLine({
          palette: L.p,
          mode: MODE,
          spinner: '⠹',
          label: 'Encoding WebP · project-7.jpg',
        }),
      ],
      [],
      [blank(2), ...count],
    ],
    keys(L, [['esc', 'stop']], 'ctrl-c quit'),
  )
}

/** Done for the folder: the bar for everything written so far. */
const doneFor = (L: Look, n: number, a: number, b: number): Row[] =>
  doneBody({
    palette: L.p,
    width: N,
    facts: {
      mode: MODE,
      before: { format: 'JPEG · PNG', name: `${n} images`, bytes: a },
      after: { format: 'WebP', name: `${n} images`, bytes: b },
    },
  })

/** "Watching images" and the sentence. */
const watchWords = (L: Look, max = 56): Row[] => [
  [run('Watching ', L.p.fg), run(nm(L, max), accent(L), undefined, true)],
  [run('Any new files you add will be converted.', L.p.dim)],
]

/* -------------------------------------------- watching, then files landing (animated) */

interface Anim {
  frames: number
  ms: number
  draw: (L: Look, i: number) => Row[]
}

const NAME_W = 30
const END = N - 2

/** A row's time (or clock) flush to the end, on `bg` if it has one. */
const timed = (L: Look, l: Landed, row: Row, bg?: string, end = END): Row => {
  const t = l.clock ?? l.at
  return [...pad(row, end - t.length, bg), run(t, l.failed ? L.p.failTintDim : L.p.border, bg)]
}

/** What a row says after the name: the phase, the reason, or the sizes and the change. */
function after(L: Look, l: Landed, sizesW = 17): Row {
  if (l.phase) return [run(l.phase, L.p.fg, undefined, true)]
  if (l.failed) return [run(l.failed, L.p.fg, L.p.failTint)]
  if (l.left) return [run(l.left, L.p.border)]
  // Convert says what it became, then how big the new file is: the format is the news, not the saving.
  const [, b] = l.sizes ?? [0, 0]
  return [
    run(`${formatOf(l.name)} → WebP`.padEnd(sizesW), L.p.fg),
    run(formatBytes(b).padStart(8), L.p.dim),
  ]
}

/** The format a name's extension suggests: only for drawing these rows (Forge itself probes content). */
const formatOf = (name: string) => {
  const ext = (name.split('.').pop() ?? '').toUpperCase()
  return ext === 'JPG' ? 'JPEG' : ext
}

/**
 * A file's row: its state, its name, the sizes right-aligned and the change
 * in bold, the time at the end. `spin` is the running file's spinner frame;
 * `flash` (0 to 1) lays a band under a row that has just finished.
 */
function fileRow(L: Look, l: Landed, spin = '⠹', flash = 0, end = END): Row {
  const name = padText(l.name, NAME_W - 2).padEnd(NAME_W)
  if (l.phase)
    return timed(
      L,
      l,
      [
        blank(3),
        run(spin, accent(L), undefined, true),
        blank(1),
        run(name, L.p.fg, undefined, true),
        ...after(L, l),
      ],
      undefined,
      end,
    )
  if (l.failed) {
    const bg = L.p.failTint
    return timed(
      L,
      l,
      [blank(2), run(' ✕ ', L.p.fail, bg, true), run(name, L.p.fail, bg, true), ...after(L, l)],
      bg,
      end,
    )
  }
  if (l.left)
    return timed(
      L,
      l,
      [blank(3), run('–', L.p.border), blank(1), run(name, L.p.dim), ...after(L, l)],
      undefined,
      end,
    )
  const bg = flash > 0 ? mix(L.p.canvas, L.p.panelBand, flash) : undefined
  const body: Row = [run(' ✓ ', L.p.ok, undefined, true), run(name, L.p.fg), ...after(L, l)].map(
    (r) => ({ ...r, bg }),
  )
  return timed(L, l, [blank(2), ...body], bg, end)
}

/** The watching line, as S7 drew it: a hairline with a light sweeping to and fro. */
function hairline(L: Look, i: number): Row {
  const n = N - 6
  const at = sweepAt(i % SWEEP, SWEEP, n)
  const stops = modeGradient(L.p, MODE)
  return [
    blank(3),
    ...Array.from({ length: n }, (_, c) =>
      run('─', mix(L.p.faint, gradientAt(c, n, stops), glow(c, at, 7))),
    ),
  ]
}

/** One sweep there and back, in frames. */
const SWEEP = 32

/*
 * The list under the line grows downwards: the oldest file at the top, the
 * newest at the bottom, where the eye is when a file arrives. Past the room
 * it scrolls by itself, so the newest is always in view. Scrolling up with
 * ↑ stops that until ↓ reaches the bottom again; while it is stopped, files
 * that land below say so ("↓ n new"). A failure scrolled off the top is
 * counted above the list ("↑ n failed"), so it never goes unseen.
 */
interface Arrival {
  file: Landed
  /** Frames: when it appears, when it starts encoding, when it is done. */
  at: number
  encode: number
  done: number
}
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

/** Each arrival as it stands at frame `i`, oldest first: its row and whether it has finished. */
function arrived(L: Look, list: Arrival[], i: number, end = END) {
  return list
    .filter((x) => i >= x.at)
    .map((x) => {
      if (i < x.done) {
        const phase = i < x.encode ? 'Reading' : 'Encoding WebP'
        const clock = `${((i - x.at) * 0.07).toFixed(1)}s`
        const file = { ...x.file, sizes: undefined, failed: undefined, phase, clock }
        return { file, row: fileRow(L, file, SPIN[i % SPIN.length], 0, end), done: false }
      }
      return {
        file: x.file,
        row: fileRow(L, x.file, '', Math.max(0, 1 - (i - x.done) / 24), end),
        done: true,
      }
    })
}

/** Where the rows end when a scroll bar takes the last column but one. */
const ROW_END = N - HOME_MARGIN - 3

/**
 * The list: `room` rows, the last `room` of them unless `back` rows up (you
 * scrolled), with the commands list's thin bar on the right once it scrolls.
 * Over it, "↑ n failed" for failures above the view; under it, while you are
 * scrolled up, "↓ n new" for what landed since, in the last row's place.
 */
function listRows(L: Look, files: Landed[], rows: Row[], room: number, back = 0, fresh = 0): Row[] {
  const end = N - HOME_MARGIN
  const total = rows.length
  if (total <= room) return [[], ...rows]
  const shown = back ? room - 1 : room
  const start = Math.max(0, total - shown - back)
  const thumb = Math.max(1, Math.round((shown * shown) / total))
  const at = Math.round((start / Math.max(1, total - shown)) * (shown - thumb))
  const body = rows.slice(start, start + shown).map((row, k): Row => {
    const bar = k >= at && k < at + thumb ? run('┃', L.p.dim) : run('│', L.p.faint)
    return [...pad(row, end - 1), bar]
  })
  const failedAbove = files.slice(0, start).filter((l) => l.failed).length
  const up: Row = failedAbove ? [run(`↑ ${failedAbove} failed`, L.p.fail)] : []
  const down: Row = [run(`↓ ${fresh} new`, accent(L), undefined, true)]
  return [
    up.length ? [blank(end - width(up)), ...up] : [],
    ...body,
    ...(back ? [fresh ? [blank(end - width(down)), ...down] : []] : []),
  ]
}

/** The watching screen: Done's bar for everything so far, the words, the line, the list. */
function watchScreen(
  L: Look,
  o: {
    i: number
    line: (L: Look, i: number) => Row
    files: { file: Landed; row: Row; done: boolean }[]
    h?: number
    back?: number
    /** Files that landed below while scrolled up. */
    fresh?: number
  },
): Row[] {
  const h = o.h ?? H
  const finished = o.files.filter((x) => x.done && x.file.sizes).map((x) => x.file)
  const n = HERE + finished.length
  const a = HERE_IN + finished.reduce((t, l) => t + (l.sizes?.[0] ?? 0), 0)
  const b = HERE_OUT + finished.reduce((t, l) => t + (l.sizes?.[1] ?? 0), 0)
  const head: Row[] = [
    ...top(L, ANSWERS, 'Watching'),
    ...doneFor(L, n, a, b),
    [],
    ...watchWords(L).map((w) => [blank(3), ...w]),
    [],
    o.line(L, o.i),
  ]
  // Below the line: a row for "↑ n failed" (or air), then the rows, down to the keys.
  const room = h - head.length - 1 - 2
  const scrolls = o.files.length > room
  const files = o.files.map((x) => x.file)
  return screen(
    [
      ...head,
      ...listRows(
        L,
        files,
        o.files.map((x) => x.row),
        room,
        o.back,
        o.fresh,
      ),
    ],
    keys(
      L,
      [
        ['↵', 'stop and go home'],
        ['o', 'open folder'],
        ...(scrolls ? [['↑↓', 'scroll'] as [string, string]] : []),
      ],
      'ctrl-c quit',
    ),
    h,
  )
}

/*
 * T1: waiting, then three files landing, frame by frame (70 ms each).
 * The light never stops: it is watching the whole time. Each file arrives at
 * the bottom of the list, reads, encodes and finishes; a finished row keeps a
 * band for a moment and Done's bar counts it in.
 */
const ARRIVALS: Arrival[] = [
  {
    file: { name: 'IMG_4112.HEIC', at: '14:06', sizes: [3.1 * MB, 412 * KB] },
    at: 44,
    encode: 50,
    done: 70,
  },
  {
    file: {
      name: 'Screenshot 2026-10-16 at 14.02.11.png',
      at: '14:06',
      sizes: [1.9 * MB, 164 * KB],
    },
    at: 82,
    encode: 86,
    done: 100,
  },
  {
    file: { name: 'scan-03.png', at: '14:07', failed: 'the file is damaged' },
    at: 118,
    encode: 122,
    done: 130,
  },
]
const STORY_FRAMES = 176

const watching = (L: Look, i: number, line: (L: Look, i: number) => Row) =>
  watchScreen(L, { i, line, files: arrived(L, ARRIVALS, i) })

/* ------------------------------------------------------- a long list */

/** An afternoon's worth: 20 files since watching began, oldest first. */
const EARLIER: Landed[] = (() => {
  const out: Landed[] = []
  const at = (k: number) => {
    const m = 13 * 60 + 52 + k * 3
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
  }
  for (let k = 0; k < 20; k++) {
    const a = (1.6 + ((k * 7) % 11) * 0.31) * MB
    const name =
      k % 5 === 2
        ? `Screenshot 2026-10-16 at ${at(k).replace(':', '.')}.04.png`
        : k === 6
          ? 'scan-03.png'
          : k === 11
            ? 'intro.mp4'
            : `IMG_${4120 + k}.HEIC`
    out.push(
      k === 6
        ? { name, at: at(k), failed: 'the file is damaged' }
        : k === 11
          ? { name, at: at(k), left: 'not an image' }
          : { name, at: at(k), sizes: [a, Math.round(a * (0.11 + (k % 4) * 0.02))] },
    )
  }
  return out
})()
/** Already there before the figure starts: finished long ago. */
const BEFORE: Arrival[] = EARLIER.map((file) => ({ file, at: -100, encode: -100, done: -100 }))
/** Then two more land while you watch. */
const LATER: Arrival[] = [
  {
    file: { name: 'IMG_4141.HEIC', at: '14:52', sizes: [3.4 * MB, 402 * KB] },
    at: 20,
    encode: 26,
    done: 46,
  },
  {
    file: { name: 'IMG_4142.HEIC', at: '14:53', sizes: [2.7 * MB, 351 * KB] },
    at: 64,
    encode: 70,
    done: 90,
  },
]

/** R1: the list follows the newest: each arrival lands at the bottom and the rows above step up. */
const R1: Anim = {
  frames: 124,
  ms: 70,
  draw: (L, i) =>
    watchScreen(L, { i, line: hairline, files: arrived(L, [...BEFORE, ...LATER], i, ROW_END) }),
}

const LONG_FIGS: Fig[] = [
  {
    id: 'R1',
    name: 'It follows the newest',
    note: 'Twenty files in, two more land. Each arrives at the bottom, under the last one, and the list steps up a row to keep it in view: the newest is always where you are looking. The thin bar on the right says there is more above. A failure that has scrolled off the top is counted over the list: “↑ 1 failed”.',
    anim: R1,
  },
  {
    id: 'R2',
    name: 'Scrolled up, a file lands',
    note: 'Press ↑ to look back and the list stops following. A file that lands meanwhile goes in below, out of view, and “↓ 1 new” says so in the last row’s place. ↓ to the bottom and it follows again.',
    draw: (L) =>
      watchScreen(L, {
        i: 7,
        line: hairline,
        files: arrived(
          L,
          [...BEFORE, { ...(LATER[0] as Arrival), at: -50, encode: -50, done: -50 }],
          0,
          ROW_END,
        ),
        back: 6,
        fresh: 1,
      }),
  },
  {
    id: 'R3',
    name: 'A taller window',
    note: 'The screen fills the window, so a taller terminal (here 80 × 40) shows more rows, still oldest at the top and newest at the bottom; it only scrolls past that.',
    draw: (L) =>
      watchScreen(L, { i: 7, line: hairline, files: arrived(L, BEFORE, 0, ROW_END), h: 40 }),
  },
]

const T1: Anim = { frames: STORY_FRAMES, ms: 70, draw: (L, i) => watching(L, i, hairline) }
const PICK_WATCH = T1

/* ------------------------------------------------------- the command line */

const prompt = (L: Look, cmd: string): Row => [run('~ % ', L.p.dim), run(cmd, L.p.fg)]

function cliRun(L: Look): Row[] {
  const line = (l: Landed): Row => {
    if (l.failed)
      return [
        run('✕ ', L.p.fail, undefined, true),
        run(l.name, L.p.fg),
        run(`   ${l.failed}`, L.p.dim),
      ]
    if (l.left)
      return [run('– ', L.p.border), run(l.name, L.p.dim), run(`   ${l.left}`, L.p.border)]
    const [, b] = l.sizes ?? [0, 0]
    return [
      run('✓ ', L.p.ok, undefined, true),
      run(middleEllipsis(l.name, 20).padEnd(20), L.p.dim),
      run(' → ', L.p.border),
      run(middleEllipsis(l.name.replace(/\.[^.]+$/, '.webp'), 20).padEnd(22), L.p.fg),
      run(formatBytes(b), L.p.dim),
    ]
  }
  const order = [...LANDED].reverse().filter((l) => !l.phase)
  return [
    prompt(L, 'forge watch ./public/images --to webp -q 80'),
    [run('✓ ', L.p.ok, undefined, true), run(`${HERE} converted to WebP`, L.p.fg, undefined, true)],
    [run('  in ', L.p.border), run(`./public/${NAME}`, L.p.dim)],
    [
      run('Watching ', L.p.fg, undefined, true),
      run(NAME, L.p.fg, undefined, true),
      run(' · any new files you add will be converted · ctrl-c to stop', L.p.dim),
    ],
    ...order.map(line),
    [run('^C', L.p.dim)],
    [
      run('✓ ', L.p.ok, undefined, true),
      run(`${HERE + DONE.length} converted`, L.p.fg, undefined, true),
      run(' · 1 failed · 1 left alone', L.p.dim),
    ],
    prompt(L, ''),
  ]
}

function cliJson(L: Look): Row[] {
  const j = (s: string): Row[] =>
    Array.from({ length: Math.ceil(s.length / N) }, (_, k) => [
      run(s.slice(k * N, (k + 1) * N), L.p.dim),
    ])
  return [
    prompt(L, 'forge watch ./public/images --to webp --json'),
    ...j(
      '{"forge":"0.4.0","event":"converted-existing","ok":true,"results":[…24 results…],"failures":[]}',
    ),
    ...j(
      '{"forge":"0.4.0","event":"watching","folder":"/Users/you/portfolio/public/images","output":"/Users/you/portfolio/public/images"}',
    ),
    ...j(
      '{"forge":"0.4.0","event":"converted","result":{"op":"convert","source":"/Users/you/portfolio/public/images/hero-v2.png","outputs":["/Users/you/portfolio/public/images/hero-v2.webp"],"inputBytes":2200000,"outputBytes":188000,"warnings":[]}}',
    ),
    ...j(
      '{"forge":"0.4.0","event":"left-alone","path":"/Users/you/portfolio/public/images/intro.mp4","reason":"not-an-image"}',
    ),
    ...j(
      '{"forge":"0.4.0","event":"failed","failure":{"path":"/Users/you/portfolio/public/images/scan-03.png","code":"corrupt-source","title":"…","detail":"…","hint":"…"}}',
    ),
    ...j('{"forge":"0.4.0","event":"stopped","converted":28,"failed":1,"leftAlone":1}'),
  ]
}

/* ------------------------------------------------------------ page */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function rowHtml(r: Row): string {
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
    out += style ? `<span style="${style}">${esc(x.text)}</span>` : `<span>${esc(x.text)}</span>`
    used += stringWidth(x.text)
  }
  if (used < N) out += `<span>${' '.repeat(N - used)}</span>`
  return out
}

function check(rows: Row[], what: string) {
  rows.forEach((r, i) => {
    if (width(r) > N)
      console.warn(`${what} row ${i} is ${width(r)} wide:`, r.map((x) => x.text).join(''))
  })
}

function term(rows: Row[], p: Palette, attrs = '', tall = true): string {
  return `<div class="t${tall ? '' : ' short'}"${attrs} style="background:${p.canvas};color:${p.fg}">${rows.map((r) => `<div class="r">${rowHtml(r)}</div>`).join('')}</div>`
}

/** Every animation's frames: a table of distinct rows, and each frame as indices into it. */
const ANIM: Record<string, { ms: number; table: string[]; frames: number[][] }> = {}
let animId = 0

interface Fig {
  id: string
  name: string
  pick?: boolean
  note: string
  draw?: (L: Look) => Row[]
  anim?: Anim
  short?: boolean
  /** Drawn the same whatever the folder is called (the command line). */
  fixed?: boolean
}

const looks = looksOf()

function figure(f: Fig): string {
  const themes = looks
    .filter((L) => !f.fixed || L.d.key === 'short')
    .map((L) => {
      const cls = `theme ${L.name} ${f.fixed ? 'nm-any' : `nm-${L.d.key}`}`
      if (f.anim) {
        const id = `a${animId++}`
        const table: string[] = []
        const index = new Map<string, number>()
        const framesOut: number[][] = []
        let first: Row[] = []
        for (let i = 0; i < f.anim.frames; i++) {
          const rows = f.anim.draw(L, i)
          check(rows, `${f.id} ${L.name} ${L.d.key} frame ${i}`)
          if (i === 0) first = rows
          framesOut.push(
            rows.map((r) => {
              const h = rowHtml(r)
              let k = index.get(h)
              if (k === undefined) {
                k = table.length
                table.push(h)
                index.set(h, k)
              }
              return k
            }),
          )
        }
        ANIM[id] = { ms: f.anim.ms, table, frames: framesOut }
        return `<div class="${cls}">${term(first, L.p, ` data-a="${id}"`)}</div>`
      }
      const rows = f.draw?.(L) ?? []
      check(rows, `${f.id} ${L.name} ${L.d.key}`)
      return `<div class="${cls}">${term(rows, L.p, '', !f.short)}</div>`
    })
    .join('')
  return `<figure><div class="vt"><span class="id">${f.id}</span><span class="name">${f.name}</span>${f.pick ? '<span class="pick">MY PICK</span>' : ''}${f.anim ? '<span class="live">MOVES</span>' : ''}</div>${themes}<p class="idea">${f.note}</p></figure>`
}
const flow = (figs: Fig[]) =>
  `<div class="flow">${figs.map(figure).join('<div class="arrow">→</div>')}</div>`
const options = (figs: Fig[]) => `<div class="opts">${figs.map(figure).join('')}</div>`

const FLOW: Fig[] = [
  {
    id: 'Step 1',
    name: 'Drop the folder on home',
    note: 'Today’s file card, with <b>FOLDER – images</b> in its top edge where a file’s format goes, and the count and size inside. ↵ converts.',
    draw: (L) => homeFolder(L),
  },
  {
    id: 'Step 2',
    name: 'Convert to',
    note: 'Formats every image in the folder can become. The card stays at the top, as a file’s does.',
    draw: format,
  },
  { id: 'Step 3', name: 'Quality', note: 'The same slider.', draw: quality },
  {
    id: 'Step 4',
    name: 'Save as',
    note: 'Today’s Save as, unchanged: the <b>files</b> row it shows when a save writes many files, then the usual places. Same location is the folder itself; <b>/</b> makes a new folder, as today.',
    draw: saveAs,
  },
  {
    id: 'Step 5',
    name: 'Converting the 24',
    note: 'Working’s line and the bar /pdf uses for pages, counting files: a real total, known before it starts. esc stops; what is written stays.',
    draw: working,
  },
  {
    id: 'Step 6',
    name: 'Watching, then files landing',
    note: 'One screen from here on (T1). Done’s bar for the 24, the sentence, and the hairline with the light sweeping along it. Files land under it, each below the last, so the newest is at the bottom; Done’s bar counts each one in. ↵ stops and goes home.',
    anim: PICK_WATCH,
  },
]

/* ------------------------------------------------------- mixed folders */

/** What a mixed folder holds, by content: kind, how many, and what it can become here. */
const MIXED: { kind: string; n: number; can: boolean; why?: string }[] = [
  { kind: 'images', n: 18, can: true },
  { kind: 'PDFs', n: 3, can: true },
  { kind: 'videos', n: 2, can: false, why: 'not yet supported' },
  { kind: 'other', n: 1, can: false, why: 'a text file' },
]
const MIXED_N = MIXED.reduce((t, k) => t + k.n, 0)

/** The folder's card for a mixed folder: how many files and how big, then each kind's count. */
const frameMixed = (L: Look): Row[] =>
  folderCard(L, [
    `${MIXED_N} files · ${formatBytes(HERE_IN + 14.2 * MB)}`,
    MIXED.map((k) => `${k.n} ${k.kind}`).join(' · '),
  ])
const mixedCard = (L: Look): Row[] => frameMixed(L).map((r) => [blank(2), ...r])

/** A kind's row: how many, its name, and what will happen to it. */
function kindRow(
  L: Look,
  k: (typeof MIXED)[number],
  what: Row,
  selected: boolean,
  lead: Row = [],
): Row {
  const body: Row = [
    ...lead,
    run(String(k.n).padStart(3), k.can ? L.p.fg : L.p.dim),
    blank(2),
    run(k.kind[0]?.toUpperCase() + k.kind.slice(1), k.can ? L.p.fg : L.p.dim, undefined, selected),
    blank(10 - k.kind.length),
    ...what,
  ]
  if (!selected) return [blank(4), ...body]
  return [
    blank(2),
    ...pad([run('▌', accent(L)), blank(1), ...body], 60).map((r) => ({ ...r, bg: L.p.listBand })),
  ]
}

/** M2: a row for each kind, each with its own answer; ↵ on a row asks that kind's steps. */
function mixedPerKind(L: Look, o: { sel?: number } = {}): Row[] {
  const sel = o.sel ?? 0
  const what: Row[] = [
    [run('WebP', L.p.fg), run(' · ', L.p.border), run('80', L.p.fg)],
    [run('PNG', L.p.fg), run(' · ', L.p.border), run('150 dpi', L.p.fg)],
    [run('–', L.p.border), run('  not yet supported', L.p.border)],
    [run('–', L.p.border), run('  a text file', L.p.border)],
  ]
  return screen(
    [
      ...top(L, [], 'Each kind'),
      ...mixedCard(L),
      [],
      title(L, 'Each kind'),
      [],
      ...MIXED.map((k, i) => kindRow(L, k, what[i] ?? [], i === sel)),
    ],
    keys(
      L,
      [
        ['↑↓', 'kind'],
        ['↵', 'change'],
        ['s', 'start'],
      ],
      'esc back · ctrl-c quit',
    ),
  )
}

/*
 * Changing a kind's answer (picked): colour's window (W1), centred, over the
 * faded screen, as Palette's Mode and Tweak open; Enhance's pill (B3) for
 * a setting with steps, Tweak's slider for quality.
 */

/** Enhance's pill: ‹ step › on the folder chip, an arrow lit where ←→ can still go. */
function pillRow(L: Look, label: string, i: number, n: number): Row {
  const bg = L.p.folderChip || undefined
  const arrow = (live: boolean, t: string) => run(t, live ? accent(L) : L.p.border, bg, live)
  return [arrow(i > 0, ' ‹ '), run(label, L.p.fg, bg, true), arrow(i < n - 1, ' › ')]
}

/** A kind's settings: what the pill steps through, from targetsFor and the step's own choices. */
interface Setting {
  kind: number
  name: string
  steps: string[]
  at: number
}
const QUALITIES = Array.from({ length: 21 }, (_, k) => String(k * 5))
const SETTINGS: Setting[] = [
  { kind: 0, name: 'format', steps: ['JPEG', 'PNG', 'WebP', 'AVIF', 'GIF', 'TIFF', 'PDF'], at: 2 },
  { kind: 0, name: 'quality', steps: QUALITIES, at: 16 },
  { kind: 1, name: 'format', steps: ['JPEG', 'PNG', 'PDF', 'DOCX'], at: 1 },
  { kind: 1, name: 'resolution', steps: ['72 dpi', '150 dpi', '300 dpi'], at: 1 },
]

/** C: ↵ on a kind opens its window over the faded screen: its format, then its own setting. */
const WIN_W = 56
function kindWindow(L: Look, ki: number, focus: number, at?: number): Row[] {
  const inner = WIN_W - 2
  const under = mixedPerKind(L, { sel: ki }).slice(0, H - 2)
  const own = SETTINGS.filter((x) => x.kind === ki)
  const lines: Row[] = [[]]
  own.forEach((x, j) => {
    const on = j === focus
    const step = on && at !== undefined ? at : x.at
    const label = x.name[0]?.toUpperCase() + x.name.slice(1)
    if (x.name === 'quality') {
      // As Tweak's sliders: the quality screen's band, the one in hand named bright.
      lines.push([])
      lines.push([
        blank(3),
        run(label.padEnd(12), on ? L.p.fg : L.p.dim, undefined, on),
        ...sliderRow({ palette: L.p, value: Number(x.steps[step]), min: 0, max: 100, width: 34 }),
      ])
      return
    }
    const band = on && L.p.panelBand ? L.p.panelBand : undefined
    const row: Row = [
      run(on ? ' › ' : '   ', accent(L), band, true),
      run(label.padEnd(14), on ? L.p.fg : L.p.dim, band, on),
      // Off the pill, the value sits where the pill's label does.
      ...(on
        ? pillRow(L, x.steps[step] ?? '', step, x.steps.length)
        : [blank(3), run(x.steps[step] ?? '', L.p.dim)]),
    ]
    lines.push(band ? pad(row, inner, band) : row)
  })
  lines.push([])
  const k = MIXED[ki] as (typeof MIXED)[number]
  const body = windowOver(L.p, under, {
    title: `${k.n} ${k.kind[0]?.toUpperCase()}${k.kind.slice(1)}`,
    lines,
    width: WIN_W,
    columns: N,
    // In the middle of the screen above the key row.
    top: Math.max(1, Math.floor((under.length - lines.length - 2) / 2)),
  })
  return [
    ...body,
    ...keys(
      L,
      [
        ['↑↓', 'choose'],
        ['←→', 'change'],
        ['↵', 'done'],
      ],
      'esc cancel · ctrl-c quit',
    ),
  ]
}

const CHANGE_WINDOW: Fig[] = [
  {
    id: 'PDFs',
    name: '↵ on PDFs: their window',
    note: 'Palette’s window (W1), centred: framed, over the faded Each kind, titled with the kind. Format on the pill, Resolution under it; ↑↓ between them, ←→ changes, ↵ keeps it, esc puts it back.',
    draw: (L) => kindWindow(L, 1, 0),
  },
  {
    id: 'Images',
    name: '↵ on Images: format and quality',
    note: 'An image kind’s window has Tweak’s slider for Quality, the same band as the quality screen’s.',
    draw: (L) => kindWindow(L, 0, 1),
  },
]

const MIXED_FIGS: Fig[] = [
  {
    id: 'M2',
    name: 'An answer per kind',
    note: 'A row for each kind and what will happen to it; the biggest kind already has an answer. ↵ on a row asks that kind’s own steps (Convert to, Quality) and comes back; s starts. Kinds Forge cannot convert say why. Watching keeps every kind’s answer.',
    draw: mixedPerKind,
  },
]

const CLI: Fig[] = [
  {
    id: 'C1',
    name: 'forge watch <folder> --to …',
    note: 'Like the app: converts what is there, says where it went, then watches. <code>--new-only</code> skips the files already there; <code>-o</code> picks another folder (default: the folder itself, as Same location).',
    draw: cliRun,
    short: true,
    fixed: true,
  },
  {
    id: 'C2',
    name: '--json: one line per event',
    note: 'For agents and scripts: one whole JSON document per line, a converted file carrying today’s <code>result</code> object.',
    draw: cliJson,
    short: true,
    fixed: true,
  },
]

const RULES = [
  'Dropping a folder always ends watching it; ↵ on Done stops. Converting a folder once is just: drop, convert, ↵.',
  'Output goes where Save as says, as today: Same location puts each WebP beside its original, in the watched folder. Forge never converts a file it wrote itself, so its own output is never picked up again.',
  'A file is read only once it has stopped growing (no change for 1 s): a screenshot being written, a copy or a download is never read half-done. <code>.crdownload</code>, <code>.part</code>, <code>.download</code> and hidden files are ignored.',
  'Probed by content, never by extension. What can’t become the chosen format is left alone and listed with why; nothing is touched that wasn’t converted. Originals are never changed.',
  'Name taken: keeps both (<code>hero (1).webp</code>). Nobody is there to ask.',
  'Writes are atomic (temp file, then rename), so a dev server watching the folder never sees half a WebP.',
  'Up to 4 files at a time. Each running file has its own row and true phase; never a percentage.',
  'Only while it runs: ↵, ctrl-c or closing the terminal stops it. Files that landed while the Mac slept are picked up on wake.',
]

const QUESTIONS = [
  '<b>The card:</b> D1 with <b>FOLDER – images</b> in the top edge (FOLDER in the mode’s colour, the dash grey, the name bold), and inside only “24 images · 86.4 MB”. A long name is cut in the middle so the edge keeps a little line after it: try <b>name: long</b>. Is this what you meant?',
  '<b>Dropping the same folder again:</b> with Same location, <code>hero.webp</code> from last time sits beside <code>hero.jpg</code>. Converting again would make <code>hero (1).webp</code>. Should Forge skip an image whose output is already there? I’d skip, and count it as left alone with “already converted”.',
  '<b>Strings to approve</b> (inside the screens): “<b>↑ 1 failed</b>” over the list when a failure has scrolled off the top; “<b>↓ 1 new</b>” when you have scrolled up and a file lands below; the key <b>↑↓ scroll</b> once the list is longer than the room.',
  '<b>Mixed folders (M2) strings:</b> the title “<b>Each kind</b>”, “<b>–  not yet supported</b>”, “<b>–  a text file</b>”, and the keys <b>↵ change</b> and <b>s start</b>. A kind’s answer reads like the bar’s trail: “WebP · 80”, “PNG · 150 dpi”.',
  '<b>Changing a kind:</b> the window, centred. Two strings to approve: its title (“<b>3 PDFs</b>”) and the key <b>←→ change</b>; ↑↓ choose, ↵ done and esc cancel are the Mode window’s.',
  '<b>An empty folder:</b> today Forge refuses it (“holds nothing”). It could go straight to watching instead. Should it?',
  '<b>Still open:</b> a <code>/watch</code> command; remembering a folder’s settings; the reasons “not an image”, “already WebP”.',
]

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · watch a folder</title>
<style>
  :root { --page:#0d0e11; --ink:#e2e4ea; --muted:#8f94a1; --rule:#23252c; --cyan:#55c7d9; --mono:"SF Mono", ui-monospace, Menlo, monospace; --sans:-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--page); color:var(--ink); font:16px/1.6 var(--sans); }
  main { max-width:2300px; margin:0 auto; padding:44px 24px 120px; }
  h1 { font-size:32px; margin:0 0 8px; }
  h2 { font-size:15px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); margin:30px 0 0; }
  h2 b { color:var(--ink); }
  .lede { color:#c7cbd4; max-width:1000px; margin:0; }
  .status { display:inline-block; margin:16px 0 0; font:600 12px var(--mono); letter-spacing:.08em; color:#e8c46d; border:1px solid #5a4a2c; padding:3px 9px; border-radius:6px; }
  .qs { max-width:1100px; margin:18px 0 0; padding:16px 20px 16px 40px; border:1px solid var(--rule); border-radius:10px; background:#121318; }
  .qs li { margin:6px 0; color:#c7cbd4; }
  .qs li b { color:var(--ink); }
  code { font:13px var(--mono); color:#b9dfe6; }
  .tabs { position:sticky; top:0; z-index:5; display:flex; flex-wrap:wrap; gap:6px; margin:26px -24px 0; padding:12px 24px; background:rgba(13,14,17,.94); border-bottom:1px solid var(--rule); align-items:center; }
  .tabs .sp { flex:1; }
  .tabs label { font:13px var(--mono); color:var(--muted); display:flex; gap:6px; align-items:center; }
  .tabs a { font:13px var(--mono); color:var(--muted); text-decoration:none; border:1px solid var(--rule); padding:6px 12px; border-radius:8px; cursor:pointer; }
  .tabs a.on { color:#0c1d22; background:var(--cyan); border-color:var(--cyan); font-weight:700; }
  section { display:none; margin-top:10px; } section.on { display:block; }
  .intro { color:#c7cbd4; max-width:1000px; }
  .flow, .opts { display:flex; flex-wrap:wrap; gap:18px 14px; align-items:flex-start; }
  .arrow { align-self:center; font:28px var(--mono); color:var(--cyan); padding:0 2px; }
  figure { margin:22px 0 0; width:min-content; }
  .vt { display:flex; align-items:baseline; gap:10px; margin-bottom:8px; white-space:nowrap; }
  .vt .id { font:700 12px var(--mono); padding:3px 7px; border-radius:6px; background:#12282e; color:var(--cyan); }
  .vt .name { font-weight:620; }
  .vt .pick { font:600 11px var(--mono); letter-spacing:.08em; color:#6fcf7f; border:1px solid #2c5a37; padding:2px 7px; border-radius:6px; }
  .vt .live { font:600 11px var(--mono); letter-spacing:.08em; color:#b9a6f0; border:1px solid #463a6b; padding:2px 7px; border-radius:6px; }
  .idea { font-size:14px; color:#c7cbd4; margin:8px 0 0; }
  .theme + .theme { margin-top:12px; }
  body[data-th=only-dark] .theme.light, body[data-th=only-light] .theme.dark { display:none; }
  body[data-nm=short] .theme.nm-long, body[data-nm=long] .theme.nm-short { display:none; }
  .t { font:13px/1 var(--mono); padding:12px 14px; border-radius:10px; border:1px solid #2c2f37; width:max-content; }
  .r { height:17px; white-space:pre; overflow:hidden; }
  .r > span { display:inline-block; height:17px; line-height:17px; vertical-align:top; }
  ol.rules { max-width:1000px; color:#c7cbd4; } ol.rules li { margin:8px 0; }
</style></head>
<body data-th="only-dark" data-nm="short"><main>
<h1>forge watch</h1>
<p class="lede">Drop a folder, convert it, and Forge keeps watching it: every image you add afterwards is converted too, until you press ↵. Built around your portfolio’s <code>public/images</code>. Round eight: your picks only (the card D1 with the name in its edge, T1, R1, M2, today’s Save as).</p>
<span class="status">DECIDED · ROUND 8 · a few strings open</span>
<h2>Questions for you</h2>
<ol class="qs">${QUESTIONS.map((q) => `<li>${q}</li>`).join('')}</ol>
<div class="tabs"><a data-t="flow" class="on">★ The flow</a><a data-t="long">A long list</a><a data-t="mixed">Mixed folders</a><a data-t="cli">Command line</a><a data-t="rules">How it behaves</a><span class="sp"></span>
<label><input type="radio" name="nm" value="short" checked> name: short</label><label><input type="radio" name="nm" value="long"> name: long</label><span style="width:14px"></span>
<label><input type="radio" name="th" value="only-dark" checked> dark</label><label><input type="radio" name="th" value="only-light"> light</label><label><input type="radio" name="th" value="both"> both</label></div>
<section id="s-flow" class="on"><h2><b>FLOW</b> · Step 1 → Step 6</h2>${flow(FLOW)}</section>
<section id="s-long"><h2><b>SCREENS</b> · when more files land than fit</h2><p class="intro">After an afternoon: 20 files have landed since watching began, one failed, one was left alone. Newest at the bottom; the list follows it.</p>${options(LONG_FIGS)}</section>
<section id="s-mixed"><h2><b>SCREEN</b> · a folder with several kinds in it</h2><p class="intro">24 files: 18 images, 3 PDFs, 2 videos and a text file. Kinds come from probing each file’s content, never its extension.</p>${options(MIXED_FIGS)}
<h2><b>SCREENS</b> · changing a kind’s answer: ↵ on its row opens its window</h2>${options(CHANGE_WINDOW)}</section>
<section id="s-cli"><h2><b>SCREENS</b> · the same feature without the app</h2>${options(CLI)}</section>
<section id="s-rules"><h2><b>RULES</b> · what it does when nobody is looking</h2><ol class="rules">${RULES.map((r) => `<li>${r}</li>`).join('')}</ol></section>
</main>
<script>
const ANIM = ${JSON.stringify(ANIM)}
document.querySelectorAll('.t[data-a]').forEach((t) => {
  const a = ANIM[t.dataset.a]
  const rows = [...t.children]
  let i = 0
  const shown = a.frames[0].slice()
  setInterval(() => {
    if (t.offsetParent === null) return
    i = (i + 1) % a.frames.length
    const f = a.frames[i]
    for (let r = 0; r < f.length; r++) if (f[r] !== shown[r]) { rows[r].innerHTML = a.table[f[r]]; shown[r] = f[r] }
  }, a.ms)
})
document.querySelectorAll('.tabs a').forEach((a) => a.onclick = () => {
  document.querySelectorAll('.tabs a').forEach((b) => b.classList.toggle('on', b === a))
  document.querySelectorAll('section').forEach((s) => s.classList.toggle('on', s.id === 's-' + a.dataset.t))
  history.replaceState(null, '', '#' + a.dataset.t)
})
const h = location.hash.slice(1); if (h) document.querySelector('.tabs a[data-t="' + h + '"]')?.click()
document.querySelectorAll('input[name=th]').forEach((r) => r.onchange = () => { document.body.dataset.th = r.value })
document.querySelectorAll('input[name=nm]').forEach((r) => r.onchange = () => { document.body.dataset.nm = r.value })
const q = new URLSearchParams(location.search)
const th = q.get('theme'); if (th) { const v = th === 'both' ? 'both' : 'only-' + th; document.body.dataset.th = v; const r = document.querySelector('input[value="' + v + '"]'); if (r) r.checked = true }
const nq = q.get('name'); if (nq) { document.body.dataset.nm = nq; const r = document.querySelector('input[name=nm][value="' + nq + '"]'); if (r) r.checked = true }
</script></body></html>`

const out = new URL('../mockups/watch-2026-10.html', import.meta.url)
writeFileSync(out, page)
console.log('wrote', decodeURIComponent(out.pathname), page.length)
