/**
 * Transcribe, round two (2026-10-17): its own mode, the sixth tab on home,
 * in red, where "/ menu" was. A path, a dropped file or a YouTube link;
 * Apple's speech recogniser writes the transcript, Apple Intelligence the
 * notes. Mac only. Round one (mockups/transcribe-2026-10.html, a "text" box
 * in Convert to) is frozen; its source is /tmp/forge-stt/transcribe-mockup-round1.ts.
 *
 * Home and Save as are cells captured from the real app at 80 × 24
 * (tests/shell/zz-video-capture.test.tsx wrote /tmp/forge-video/frames-dark.json),
 * recoloured for the new mode; the header bar, the cards, the field chip and
 * Working's line are the app's own art functions. The file preview reads the
 * spike's real output, /tmp/forge-stt/data/talk.md.
 *
 *   npx tsx scripts/transcribe-mockup.ts   → mockups/transcribe-2026-10-round2.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import stringWidth from 'string-width'
import { type BarChip, trailBarRow } from '../src/shell/bar-art.js'
import { type Command, listCommands } from '../src/shell/commands.js'
import { doneNotes } from '../src/shell/done-art.js'
import { blank, mix, type Row, type Run, stagedCardRows, width } from '../src/shell/home-art.js'
import {
  DARK,
  modeGradient,
  modePalette,
  type Palette,
  type ShellMode,
  VERSION,
} from '../src/shell/theme.js'
import { middleEllipsis } from '../src/shell/width.js'
import { workLine } from '../src/shell/working-art.js'

const N = 80
const H = 24

interface Cell {
  ch: string
  fg: string | null
  bg: string | null
  b: boolean
}
const F = JSON.parse(readFileSync('/tmp/forge-video/frames-dark.json', 'utf8')) as Record<
  string,
  Cell[][]
>
const frame = (name: string): Cell[][] => (F[name] ?? []).map((r) => r.map((c) => ({ ...c })))

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
/** Swap `from` for `to` in a captured row, each cell keeping its own style. */
function swap(cells: Cell[] | undefined, from: string, to: string) {
  if (!cells) return
  const text = cells.map((c) => c.ch).join('')
  const at = text.indexOf(from)
  if (at < 0) throw new Error(`not found: ${from}`)
  const t = [...to.padEnd(from.length)]
  if (t.length !== [...from].length) throw new Error(`too long: ${to}`)
  t.forEach((ch, i) => {
    const c = cells[at + i]
    if (c) c.ch = ch
  })
}

/* ------------------------------------------------------------ colour */

/** Transcribe's red: of the reds tried, the furthest (OKLab) from pdf's orange-red and from fail. */
const RED = '#e63946'
const RED_BG = '#3a1a1d'

const hsl = (hex: string): [number, number, number] => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}
const hex = ([h, s, l]: [number, number, number]): string => {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return `#${[f(0), f(8), f(4)]
    .map((x) =>
      Math.round(x * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}
/**
 * Convert's cyan gradient turned to red: the band's hatching and the drop
 * zone's dots. Mirrored, so where cyan drifts to violet the red drifts to
 * pink, away from pdf's orange.
 */
const RED_H = hsl(RED)[0]
const CYAN_H = hsl('#55c7d9')[0]
const toRed = (c: string | null): string | null => {
  if (!c) return c
  const [h, s, l] = hsl(c)
  return s < 0.2 ? c : hex([(RED_H - (h - CYAN_H) + 720) % 360, Math.min(1, s * 1.05), l])
}

interface Look {
  p: Palette
  mode: ShellMode
  /** The header bar's chip, for a mode the app does not have yet. */
  chip?: BarChip
}
const CONVERT: Look = { p: modePalette(DARK, 'convert'), mode: 'convert' }
/** Drawn as convert with convert's colours swapped for the red, until transcribe is a ShellMode. */
const TRANS: Look = {
  p: modePalette({ ...DARK, modeConvert: RED, modeConvertBg: RED_BG }, 'convert'),
  mode: 'convert',
  chip: { label: 'transcribe', colour: RED, stops: [RED, toRed(DARK.violet) ?? RED] },
}

/* ------------------------------------------------------------ the story */

const URL_TEXT = 'https://www.youtube.com/watch?v=UKbXq3GJZ0o'
const VIDEO_TITLE = 'The Power of Pre-Suasion – Robert Cialdini'
const YT = { name: VIDEO_TITLE, tag: 'YouTube', facts: 'RSA · 1:01:57' }
const FILE = { name: 'pre-suasion-talk.mp4', tag: 'MP4', facts: '1:01:57 · 1280×720 · 386 MB' }
const DUR = 3717
const OUT = 'The Power of Pre-Suasion.md'

const PARTS: [string, string][] = [
  ['0:00', 'Persuasion: Aligning Mindset and Context'],
  ['14:14', 'Images and Performance Alignment'],
  ['30:30', 'Ethical Persuasion and Authority'],
  ['43:52', 'Media, Debate, and Cooperation'],
  ['56:57', 'Predisposition in Recruitment'],
]

/* ------------------------------------------------------------ pieces */

const run = (text: string, fg?: string, bg?: string, bold = false): Run => ({ text, fg, bg, bold })
const pad = (row: Row, n: number, bg?: string): Row => [
  ...row,
  ...(n > width(row) ? [{ text: ' '.repeat(n - width(row)), bg }] : []),
]

function header(L: Look, answers: string[], current: string, drift?: number): Row {
  return [
    blank(2),
    ...trailBarRow({
      width: N - 4,
      palette: L.p,
      mode: L.mode,
      trail: { answers, current },
      slanted: false,
      drift,
      chip: L.chip,
    }),
  ]
}
const top = (L: Look, answers: string[], current: string, drift?: number): Row[] => [
  [],
  header(L, answers, current, drift),
  [],
]

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
function screen(body: Row[], keyRows: Row[]): Row[] {
  const rows = body.slice(0, H - keyRows.length)
  while (rows.length < H - keyRows.length) rows.push([])
  return [...rows, ...keyRows]
}

interface Src {
  name: string
  tag: string
  facts: string
}
/** The file card under the bar, as every step after home draws it. */
function card(L: Look, f: Src): Row[] {
  const inner = 48
  return [
    [
      blank(2),
      run('╭─', L.p.border),
      blank(1),
      run(f.tag, L.p.accent, undefined, true),
      blank(1),
      run(`${'─'.repeat(52 - 5 - f.tag.length)}╮`, L.p.border),
    ],
    [
      blank(2),
      run('│', L.p.border),
      blank(1),
      run(middleEllipsis(f.name, inner).padEnd(inner + 1), L.p.fg, undefined, true),
      run('│', L.p.border),
    ],
    [
      blank(2),
      run('│', L.p.border),
      blank(1),
      run(middleEllipsis(f.facts, inner).padEnd(inner + 1), L.p.dim),
      run('│', L.p.border),
    ],
    [blank(2), run(`╰${'─'.repeat(50)}╯`, L.p.border)],
  ]
}

const title = (L: Look, text: string): Row => [blank(3), run(text, L.p.accent, undefined, true)]

const t2m = (t: number) => {
  const h = Math.floor(t / 3600)
  const m = Math.floor(t / 60) % 60
  const s = String(Math.round(t % 60)).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/* ------------------------------------------------------------ home */

const PANEL = '#2c2c2c'
const FIELD = '#242424'
const TABS = ['convert', 'compress', 'pdf', 'edit', 'colour', 'transcribe']

/** The tab row: six modes, the chosen one on its chip; `menu` keeps today's "/ menu" at the end. */
function tabRow(L: Look, on: string, menu = false): Row {
  // Today's five, or the six with transcribe in the menu's slot.
  const tabs = menu ? TABS.slice(0, 5) : TABS
  const row: Row = [blank(4)]
  let after = 1
  tabs.forEach((t, i) => {
    const n = String(i + 1)
    if (t === on) {
      row.push(
        blank(after - 1),
        run(' ', undefined, '#262626'),
        run(n, L.p.accent, '#262626', true),
      )
      row.push(run(` ${t} `, L.p.fg, '#262626', true))
      after = 2
    } else {
      row.push(blank(after), run(n, L.p.border), run(` ${t}`, L.p.dim))
      after = 3
    }
  })
  if (menu) row.push(blank(after), run('/', L.p.border), run(' menu', L.p.dim))
  return row
}

/** Words across the drop zone's middle, the dots cleared around them. */
function panelWords(cells: Cell[], runs: Run[]) {
  const w = runs.reduce((n, r) => n + stringWidth(r.text), 0)
  const from = Math.round(40.5 - w / 2)
  for (let i = from - 4; i < from + w + 4; i++)
    Object.assign(cells[i] ?? {}, { ch: ' ', fg: null, bg: PANEL, b: false })
  let x = from
  for (const r of runs)
    for (const ch of r.text) {
      Object.assign(cells[x] ?? {}, { ch, fg: r.fg ?? null, bg: PANEL, b: !!r.bold })
      x++
    }
}

/** The field: the prompt, what to type, and the key chip at the far end. */
function fieldRow(L: Look, text: string, chip: Row | null, typed = false): Row {
  const left: Row = [
    run('  ', undefined, FIELD),
    run('›', L.p.accent, FIELD, true),
    run(` ${text}`, typed ? L.p.fg : L.p.border, FIELD),
  ]
  const right: Row = chip
    ? [...chip.map((r) => ({ ...r, bg: r.bg ?? FIELD })), run('  ', undefined, FIELD)]
    : []
  return [
    blank(4),
    ...left,
    run(' '.repeat(72 - width(left) - width(right)), undefined, FIELD),
    ...right,
  ]
}

interface HomeOpts {
  on: string
  /** The drop zone's two lines, or a card (rows 8–14) in their place. */
  words?: [Run[], Run[]]
  panel?: Row[]
  field: string
  typed?: boolean
  /**
   * Where "/ menu" is: the tab row (today), or right-aligned on the row
   * above the key row (the user's); `open` is that with the list showing.
   */
  menu: 'tabs' | 'above' | 'open'
  /** With the menu open: what follows the slash. */
  query?: string
  /** With the menu open: the arrows it takes (a grid takes all four). */
  arrows?: boolean
  send?: string
  red?: boolean
}

/** The command list with transcribe among the modes (its strip the menu's gold until it is a ShellMode). */
const TRANSCRIBE_CMD: Command = {
  name: 'transcribe',
  description: 'notes and transcripts from video and sound',
  needsSource: false,
  group: 'modes',
}
const commandsFor = (query: string): Command[] => {
  const all = listCommands('').items
  const at = all.filter((c) => c.group === 'modes').length
  return [...all.slice(0, at), TRANSCRIBE_CMD, ...all.slice(at)].filter((c) =>
    c.name.startsWith(query),
  )
}
/** The menu's gold across the band's hatching while it is open, as home does today. */
const GOLD = modeGradient(DARK, 'menu')
const goldAt = (x: number) => mix(GOLD[0] ?? DARK.brand, GOLD[1] ?? DARK.brand, x / (N - 1))

function home(L: Look, o: HomeOpts): Row[] {
  const f = frame('home')
  const open = o.menu === 'open'
  if (o.red)
    for (const r of open ? [9, 10, 11, 12, 13] : [2, 3, 4, 9, 10, 11, 12, 13])
      for (const c of f[r] ?? [])
        c.fg = c.ch === '·' || c.ch === '╱' || c.ch === '↓' ? toRed(c.fg) : c.fg
  if (open)
    for (const r of [2, 3, 4])
      (f[r] ?? []).forEach((c, x) => {
        if (c.ch === '╱') c.fg = goldAt(x)
      })
  if (o.words) {
    const [a, b] = o.words
    if (f[10]) panelWords(f[10], a)
    if (f[11]) panelWords(f[11], b)
  }
  const rows = f.map(rowOf)
  rows[7] = tabRow(L, o.on, o.menu === 'tabs')
  if (o.panel)
    o.panel.forEach((r, i) => {
      rows[8 + i] = [blank(2), ...r]
    })
  rows[16] = fieldRow(
    open ? { ...L, p: { ...L.p, accent: DARK.brand } } : L,
    open ? `/${o.query ?? ''}` : o.field,
    null,
    open || o.typed,
  )
  // Above the key row, flush with its right end: the slash on a keycap, then the word; gold while open.
  if (o.menu !== 'tabs') {
    const hint: Row = open
      ? [run(' / ', DARK.ink, DARK.brand, true), run(' menu', DARK.brand, undefined, true)]
      : [run(' / ', L.p.fg, '#333333', true), run(' menu', L.p.dim)]
    rows[21] = [blank(79 - width(hint)), ...hint]
  }
  const keyRow: Row = [blank(5)]
  if (open)
    keyRow.push(
      run(o.arrows ? ' ↑↓←→ ' : ' ↑↓ ', L.p.fg, '#333333', true),
      run(' choose', L.p.dim),
      blank(2),
      run(' ↵ ', L.p.fg, '#333333', true),
      run(' open', L.p.dim),
    )
  else keyRow.push(run(' ↵ ', L.p.fg, '#333333', true), run(` ${o.send ?? 'send'}`, L.p.dim))
  const foot = open
    ? 'esc close · ctrl-c quit'
    : `${o.menu === 'tabs' ? '1–5' : '1–6'} ←→ mode · esc clear · ${o.send ? '' : 'ctrl-n new · '}ctrl-c quit`
  keyRow.push(blank(79 - width(keyRow) - stringWidth(foot)), run(foot, L.p.border))
  rows[23] = keyRow
  return rows.slice(0, H)
}

const dropWords = (L: Look, main: string, sub: string): [Run[], Run[]] => [
  [run('↓', L.p.accent, undefined, true), run(`  ${main}`, L.p.fg, undefined, true)],
  [run(sub, L.p.dim)],
]

/** A card in the drop zone, as home draws a waiting file. */
const staged = (L: Look, f: Src): Row[] =>
  stagedCardRows({
    width: N - 4,
    rows: 7,
    palette: L.p,
    mode: L.mode,
    file: { name: f.name, tag: f.tag, size: '', facts: f.facts },
  })

/** The drop zone with one or two lines of its own (looking up, an offer, a refusal). */
function panelLines(lines: Run[][], tint?: string): Row[] {
  const W = 72
  const row = (r: Run[]): Row => {
    const w = width(r)
    const l = Math.floor((W - w) / 2)
    return [
      blank(2),
      run(' '.repeat(l), undefined, tint ?? PANEL),
      ...r.map((x) => ({ ...x, bg: x.bg ?? tint ?? PANEL })),
      run(' '.repeat(W - l - w), undefined, tint ?? PANEL),
    ]
  }
  // Five rows, as the drop zone's dots are, the lines in the middle.
  const above = Math.floor((5 - lines.length) / 2)
  const body: Run[][] = [...Array.from({ length: above }, () => []), ...lines]
  while (body.length < 5) body.push([])
  return [[], ...body.map(row), []]
}

/* ------------------------------------------------------------ the steps after home */

const OUTS: [string, string][] = [
  ['Notes', 'summary, notes and transcript · .md'],
  ['Only transcript', '.md'],
]
function transcribeTo(L: Look, src: Src, chosen = 'Notes', outs = OUTS): Row[] {
  const list: Row[] = outs.map(([n, d]) => {
    const on = n === chosen
    const lead: Row = [run(on ? '▌' : ' ', L.p.accent), blank(1), run(n, L.p.fg, undefined, on)]
    if (!on) return [blank(2), ...lead]
    return [
      blank(2),
      ...pad([...lead, blank(20 - width(lead)), run(d, L.p.dim)], 52).map((x) => ({
        ...x,
        bg: L.p.listBand,
      })),
    ]
  })
  return screen(
    [...top(L, [], 'Transcribe to'), ...card(L, src), [], title(L, 'Transcribe to'), [], ...list],
    keys(
      L,
      [
        ['↑↓', 'choose'],
        ['↵', 'confirm'],
      ],
      'esc back · ctrl-c quit',
    ),
  )
}

function saveAs(L: Look, answers: string[], name: string, ext: string, src: Src): Row[] {
  const f = frame('quality')
  swap(
    f[12],
    'Screen Recording          .png',
    `${middleEllipsis(name, 25).padEnd(26)}${ext}`.padEnd(30),
  )
  const tmp =
    (f[16] ?? [])
      .map((c) => c.ch)
      .join('')
      .match(/\/var\/folders\/\S+/)?.[0] ?? ''
  swap(f[16], tmp, '~/Desktop')
  // Save as's own name chip and caret are convert's cyan; the mode here is red.
  for (const r of f) for (const c of r) if (c.fg === '#55c7d9') c.fg = RED
  const rows = f.map(rowOf)
  rows[1] = header(L, answers, 'Save as')
  card(L, src).forEach((r, i) => {
    rows[3 + i] = r
  })
  rows.splice(23, 1)
  rows.splice(10, 1)
  return rows.slice(0, H)
}

const ANSWERS = ['Notes', 'Desktop', OUT]
function working(L: Look, src: Src, label: string, body: Row[], clock: string): Row[] {
  return screen(
    [
      ...top(L, ANSWERS, 'Working', 1.4),
      ...card(L, src),
      [],
      [
        blank(2),
        ...workLine({ palette: L.p, mode: L.mode, spinner: '⠹', label, clock, width: N - 2 }),
      ],
      [],
      ...body,
    ],
    keys(L, [['esc', 'stop']], 'ctrl-c quit'),
  )
}
const bar = (L: Look, k: number, words: string): Row => {
  const BAR = 30
  const n = Math.round(k * BAR)
  return [
    blank(5),
    run(' '.repeat(n), undefined, L.p.trackFill),
    run(' '.repeat(BAR - n), undefined, L.p.track),
    run(`  ${words}`, L.p.dim),
  ]
}
const partDots = (L: Look, done: number, of = PARTS.length): Row => [
  blank(5),
  ...Array.from({ length: of }, (_, i) =>
    i < done ? run('● ', L.p.accent, undefined, true) : run('○ ', L.p.faint),
  ),
  run(` part ${Math.min(done + 1, of)} of ${of}`, L.p.dim),
]

interface DoneOpts {
  name?: string
  parts?: boolean
  warning?: string
  missing?: number
  answers?: string[]
}
/** Done: a green "done" chip, the file, the parts it found; the four keys on the key row (O1). */
function done(L: Look, o: DoneOpts = {}): Row[] {
  const rows: Row[] = [
    ...top(L, o.answers ?? ANSWERS, 'Done'),
    [],
    [blank(4), run(' done ', DARK.ok, mix(DARK.ok, DARK.canvas, 0.8), true)],
    [],
    [blank(4), run('✓ ', L.p.ok, undefined, true), run(o.name ?? OUT, L.p.fg, undefined, true)],
    [],
    ...(o.parts === false
      ? []
      : PARTS.map(
          ([t, h], i): Row => [
            blank(6),
            run(t.padStart(5), L.p.border),
            blank(3),
            i === o.missing ? run(`Part ${i + 1}`, L.p.dim) : run(h, L.p.fg),
          ],
        )),
  ]
  if (o.warning)
    rows.push(
      [],
      ...doneNotes({ palette: L.p, width: N - 4, offers: [], warnings: [o.warning] }).map((r) => [
        blank(2),
        ...r,
      ]),
    )
  return screen(
    rows,
    keys(
      L,
      [
        ['↵', 'new'],
        ['o', 'open'],
        ['s', 'finder'],
        ['c', 'copy'],
      ],
      'ctrl-c quit',
    ),
  )
}

/* ------------------------------------------------------------ the menu, rising from the hint */

/** The menu's rows: the modes in tab order, then the settings. */
const MENU_MODES = TABS.map((t) => commandsFor('').find((c) => c.name === t)).filter(
  (c): c is Command => c !== undefined,
)
const MENU_SETTINGS = commandsFor('').filter((c) => c.group === 'settings')
const stripOf = (c: Command) =>
  c.name === 'transcribe'
    ? RED
    : c.group === 'modes'
      ? ((DARK as unknown as Record<string, string>)[
          `mode${c.name[0]?.toUpperCase()}${c.name.slice(1)}`
        ] ?? DARK.brand)
      : DARK.brand

/**
 * Today's list (commandRows' look: a gold heading and a faint rule per group,
 * the chosen row on the band with its strip), but standing on the "/ menu"
 * hint and growing upward. What you type sits at its foot, just above the
 * hint; as typing narrows the list it sinks back towards it, and home shows
 * again above. No blank row under a heading, so the whole list fits without
 * scrolling.
 */
const toCells = (row: Row): Cell[] => {
  const out: Cell[] = []
  for (const r of row)
    for (const ch of r.text) out.push({ ch, fg: r.fg ?? null, bg: r.bg ?? null, b: !!r.bold })
  while (out.length < N) out.push({ ch: ' ', fg: null, bg: null, b: false })
  return out
}
/** `put` drawn over `row` from column `x`. */
const overlay = (row: Row, x: number, put: Row): Row => {
  const cells = toCells(row)
  toCells(put)
    .slice(0, width(put))
    .forEach((c, i) => {
      cells[x + i] = c
    })
  return rowOf(cells.slice(0, N))
}

/**
 * The menu as a popup: typing / on home opens a box over the whole screen,
 * home dimmed behind it, with its own field for the commands at the top. Choosing a mode closes it on that tab;
 * choosing a setting opens that setting's screen inside the box (its title
 * says where you are), and esc steps back to the list, then out.
 */
/** Its right edge lines up with the "/ menu" hint's (column 78), the same margin on the left. */
const POP_X = 1
const POP_W = 78
const POP_TOP = 0
const POP_BODY = 15
const POP_FILL = DARK.selectionBg
const IN = POP_W - 4

type Screen = 'list' | 'theme' | 'extensions' | 'update' | 'about'
const pill = (text: string, on = true): Run =>
  run(` ${text} `, on ? DARK.ink : DARK.fg, on ? DARK.fg : DARK.keycapBg, on)

/** The list: each group under a gold heading and a faint rule; each command with what it does. */
function menuList(query: string): Row[] {
  const out: Row[] = []
  const all = [...MENU_SETTINGS, ...MENU_MODES].filter((c) => c.name.startsWith(query))
  const chosen = all[0]?.name
  for (const [label, cs] of [
    ['Settings', MENU_SETTINGS],
    ['Modes', MENU_MODES],
  ] as const) {
    const members = cs.filter((c) => c.name.startsWith(query))
    if (members.length === 0) continue
    if (out.length) out.push([])
    out.push([
      blank(2),
      run(label, DARK.brand, undefined, true),
      run(` ${'─'.repeat(IN - 3 - label.length)}`, DARK.faint),
    ])
    out.push([])
    for (const c of members) {
      const on = c.name === chosen
      const name: Run[] = [
        run(`/${query}`, DARK.fg, undefined, true),
        run(c.name.slice(query.length), on ? DARK.fg : DARK.dim, undefined, on),
      ]
      const desc =
        c.description.length > IN - 17 ? `${c.description.slice(0, IN - 18)}…` : c.description
      const what = run(desc, on ? DARK.dim : DARK.border)
      const row: Row = [run(on ? '▌' : ' ', stripOf(c)), blank(1), ...name]
      const full: Row = [...pad(row, 16), ...[what]]
      out.push(on ? pad(full, IN).map((x) => ({ ...x, bg: DARK.panelBand })) : full)
    }
  }
  return out
}

/** A list on the left, a rule, what the chosen row says on the right: the settings' own split. */
const split = (left: Row[], right: Row[], w: number): Row[] =>
  Array.from({ length: Math.max(left.length, right.length) }, (_, i) => [
    ...pad(left[i] ?? [], w),
    run('│', DARK.faint),
    blank(2),
    ...(right[i] ?? []),
  ])
const chosenRow = (r: Row, w: number): Row =>
  pad([run('▌', DARK.brand), blank(1), ...r], w).map((x) => ({ ...x, bg: DARK.panelBand }))

function menuScreen(screen: Exclude<Screen, 'list'>): Row[] {
  if (screen === 'theme')
    return [
      [],
      [blank(2), run('Light', DARK.fg)],
      chosenRow([run('Dark', DARK.fg, undefined, true)], 24),
    ]
  if (screen === 'extensions')
    return split(
      [
        chosenRow(
          [run('Boost resolution', DARK.fg, undefined, true), blank(5), run('✓', DARK.ok)],
          27,
        ),
        [blank(2), run('Remove background', DARK.fg)],
      ],
      [
        [run('Boost resolution', DARK.fg, undefined, true)],
        [run('Sharpen · Boost resolution 2× · 4×', DARK.dim)],
        [],
        [run('✓ installed', DARK.ok)],
      ],
      28,
    )
  if (screen === 'update')
    return split(
      [
        chosenRow([run('Forge', DARK.fg, undefined, true), run(' ✓', DARK.ok)], 31),
        [],
        [
          blank(2),
          run('Check automatically', DARK.fg),
          blank(4),
          run('‹ ', DARK.dim),
          run('on', DARK.fg, undefined, true),
          run(' ›', DARK.dim),
        ],
      ],
      [
        [run(`Forge ${VERSION}`, DARK.fg, undefined, true)],
        [run('✓ the latest · checked just now', DARK.ok)],
        [],
        [pill('↵ check again')],
      ],
      32,
    )
  return [
    [run('  About  ', DARK.fg, undefined, true), run('  Attributions  ', DARK.dim)],
    [run('━'.repeat(9), DARK.brand), run('─'.repeat(IN - 9), DARK.faint)],
    [],
    [
      blank(2),
      run('Forge', DARK.fg, undefined, true),
      run(` ${VERSION}`, DARK.dim),
      run('  ·  a terminal-native file converter', DARK.dim),
    ],
    [],
    [
      blank(2),
      pill('GitHub ↗'),
      blank(2),
      pill('Portfolio ↗', false),
      blank(2),
      pill('Report a bug ↗', false),
    ],
    [],
    [blank(2), run('github.com/AtharvaN16', DARK.dim)],
  ]
}

const SCREEN_KEYS: Record<Screen, { main: [string, string][]; foot: string }> = {
  list: {
    main: [
      ['↑↓', 'choose'],
      ['↵', 'open'],
    ],
    foot: 'esc close · ctrl-c quit',
  },
  theme: {
    main: [
      ['↑↓', 'choose'],
      ['↵', 'confirm'],
    ],
    foot: 'esc back · ctrl-c quit',
  },
  extensions: {
    main: [
      ['↑↓', 'choose'],
      ['x', 'remove'],
    ],
    foot: 'i about · esc back · ctrl-c quit',
  },
  update: {
    main: [
      ['↑↓', 'choose'],
      ['↵', 'check again'],
    ],
    foot: 'esc back · ctrl-c quit',
  },
  about: {
    main: [
      ['←→', 'choose'],
      ['↵', 'open'],
      ['tab', 'attributions'],
    ],
    foot: 'esc back · ctrl-c quit',
  },
}

function menuPopup(screen: Screen = 'list', query = ''): Row[] {
  const rows = home(R, {
    on: 'transcribe',
    red: true,
    words: dropWords(R, 'Drop a video or sound file', 'or paste a YouTube link'),
    field: '',
    menu: 'open',
  })
  // Home stays behind the box, dimmed.
  rows.forEach((r, i) => {
    if (i === 21) return
    rows[i] = r.map((x) => ({
      ...x,
      fg: x.fg ? mix(x.fg, DARK.canvas, 0.75) : x.fg,
      bg: x.bg ? mix(x.bg, DARK.canvas, 0.6) : x.bg,
    }))
  })
  const edge = DARK.brand
  // The hatched header bar inside the box, as every screen has: the menu's chip, then where you are.
  const bar = trailBarRow({
    width: IN,
    palette: DARK,
    mode: 'convert',
    trail: {
      answers: [],
      current: screen === 'list' ? '' : `${screen[0]?.toUpperCase()}${screen.slice(1)}`,
    },
    slanted: false,
    chip: { label: 'menu', colour: edge, stops: GOLD },
  })
  const side = (r: Row): Row =>
    [
      run('│', edge, POP_FILL),
      blank(1),
      ...pad(r, IN).map((x) => ({ ...x, bg: x.bg ?? POP_FILL })),
      run(' ', undefined, POP_FILL),
      run('│', edge, POP_FILL),
    ].map((x) => ({ ...x, bg: x.bg ?? POP_FILL }))
  // Its own field: the command so far, in the menu's gold, as home's field draws its prompt.
  const typed = screen === 'list' ? `/${query}` : `/${screen}`
  const field: Row = [
    run('  ', undefined, FIELD),
    run('›', DARK.brand, FIELD, true),
    run(` ${typed}`, screen === 'list' ? DARK.fg : DARK.dim, FIELD),
    ...(screen === 'list' ? [run(' ', DARK.ink, DARK.fg)] : []),
  ]
  const body = screen === 'list' ? menuList(query) : menuScreen(screen)
  // The bar on top, the list or the screen, and the field at the foot.
  const box: Row[] = [
    [run(`╭${'─'.repeat(POP_W - 2)}╮`, edge, POP_FILL)],
    side(bar),
    side([]),
    ...Array.from({ length: POP_BODY }, (_, i) => side(body[i] ?? [])),
    side([]),
    side(pad(field, IN, FIELD)),
    [run(`╰${'─'.repeat(POP_W - 2)}╯`, edge, POP_FILL)],
  ]
  box.forEach((r, i) => {
    rows[POP_TOP + i] = overlay(rows[POP_TOP + i] ?? [], POP_X, r)
  })
  const k = SCREEN_KEYS[screen]
  rows[22] = [blank(2), run('─'.repeat(N - 4), DARK.border)]
  rows[23] = keys(R, k.main, k.foot)[1] ?? []
  return rows
}

/* ------------------------------------------------------------ the screens */

const R = TRANS
const T1 = () =>
  home(R, {
    on: 'transcribe',
    red: true,
    words: dropWords(R, 'Drop a video or sound file', 'or paste a YouTube link'),
    field: 'or type a path or link',
    menu: 'above',
  })
const T2 = () =>
  home(R, {
    on: 'transcribe',
    red: true,
    panel: panelLines([
      [run('⠹ ', R.p.accent, undefined, true), run('Looking up the link', R.p.fg, undefined, true)],
    ]),
    field: URL_TEXT,
    typed: true,
    menu: 'above',
    send: 'transcribe',
  })
const T3 = () =>
  home(R, {
    on: 'transcribe',
    red: true,
    panel: staged(R, YT),
    field: 'or paste another link',
    menu: 'above',
    send: 'transcribe',
  })
const T3F = () =>
  home(R, {
    on: 'transcribe',
    red: true,
    panel: staged(R, FILE),
    field: 'or type a path or link',
    menu: 'above',
    send: 'transcribe',
  })
const T4 = () => transcribeTo(R, YT)
const T5 = () => saveAs(R, ['Notes'], 'The Power of Pre-Suasion', '.md', YT)
const T6 = () => working(R, YT, 'Downloading the sound', [bar(R, 0.31, '18.2 of 59.6 MB')], '0:07')
const T7 = () =>
  working(R, YT, 'Transcribing', [bar(R, 1390 / DUR, `${t2m(1390)} of ${t2m(DUR)}`)], '0:26')
const T8 = () => working(R, YT, 'Writing notes', [partDots(R, 2)], '1:21')
const T9 = () => done(R)
const D_FILE = () =>
  done(R, { name: 'pre-suasion-talk.md', answers: ['Notes', 'Desktop', 'pre-suasion-talk.md'] })
const D_ONLY = () =>
  done(R, {
    name: 'pre-suasion-talk.md',
    parts: false,
    answers: ['Only transcript', 'Desktop', 'pre-suasion-talk.md'],
  })

/* ---- where "/ menu" goes */
const C1 = () =>
  home(CONVERT, {
    on: 'convert',
    words: dropWords(CONVERT, 'Drop a file here', 'images · HEIC · PDF · Word'),
    field: 'or type a path',
    menu: 'above',
  })
const POP = () => menuPopup()
const POP_T = () => menuPopup('list', 'ex')
const POP_THEME = () => menuPopup('theme')
const POP_EXT = () => menuPopup('extensions')
const POP_UPD = () => menuPopup('update')
const POP_ABOUT = () => menuPopup('about')

/* ---- the colour */
function swatches(): Row[] {
  const chip = (name: string, fg: string, bg: string): Run[] => [
    run(` ${name} `, fg, bg, true),
    blank(2),
  ]
  return [
    [
      blank(2),
      ...chip('convert', DARK.modeConvert, DARK.modeConvertBg),
      ...chip('compress', DARK.modeCompress, DARK.modeCompressBg),
      ...chip('pdf', DARK.modePdf, DARK.modePdfBg),
      ...chip('edit', DARK.modeEdit, DARK.modeEditBg),
      ...chip('colour', DARK.modeColour, DARK.modeColourBg),
      ...chip('transcribe', RED, RED_BG),
    ],
    [],
    [blank(2), run('pdf  ', DARK.dim), run('Converting to PDF', DARK.modePdf, undefined, true)],
    [blank(2), run('new  ', DARK.dim), run('Transcribing', RED, undefined, true)],
    [blank(2), run('fail ', DARK.dim), run('✕ This video is private.', DARK.fail, undefined, true)],
  ]
}

/* ---- the add-on and the refusals */
const OFFER = () =>
  home(R, {
    on: 'transcribe',
    red: true,
    panel: panelLines([
      [run('YouTube links need yt-dlp', R.p.fg, undefined, true)],
      [run('37 MB download · ', R.p.dim), run('↵ installs', R.p.fg)],
    ]),
    field: URL_TEXT,
    typed: true,
    menu: 'above',
    send: 'install',
  })
const INSTALLING = () =>
  home(R, {
    on: 'transcribe',
    red: true,
    panel: panelLines([
      [run('YouTube links need yt-dlp', R.p.fg, undefined, true)],
      [
        run(' '.repeat(5), undefined, R.p.trackFill),
        run(' '.repeat(7), undefined, R.p.track),
        run('  12.6', R.p.fg, undefined, true),
        run(' of 37 MB', R.p.dim),
      ],
    ]),
    field: URL_TEXT,
    typed: true,
    menu: 'above',
    send: 'install',
  })
const refusal = (words: string) => () =>
  home(R, {
    on: 'transcribe',
    red: true,
    panel: panelLines(
      [[run('✕ ', DARK.fail, undefined, true), run(words, DARK.fg)]],
      DARK.failTint,
    ),
    field: URL_TEXT,
    typed: true,
    menu: 'above',
  })
const PRIVATE = refusal('This video is private.')
const PLAYLIST = refusal('This is a playlist. Paste one video’s link.')
// With nothing to choose, Transcribe to is skipped.
const AI_OFF = () => saveAs(R, ['Only transcript'], 'The Power of Pre-Suasion', '.md', YT)
const NO_NOTES = () =>
  done(R, { warning: 'Apple Intelligence would not write notes for part 4.', missing: 3 })
const W0 = () =>
  working(
    R,
    YT,
    'Downloading speech for English (US)',
    [
      [
        blank(5),
        run(' '.repeat(11), undefined, R.p.trackFill),
        run(' '.repeat(19), undefined, R.p.track),
      ],
    ],
    '0:09',
  )

/* ---- command line */
const prompt = (cmd: string): Row => [run('~ % ', DARK.dim), run(cmd, DARK.fg)]
function cli(): Row[] {
  const ok = (name: string, facts: string): Row => [
    run('✓ ', DARK.ok, undefined, true),
    run(name.padEnd(30), DARK.fg),
    run(facts, DARK.dim),
  ]
  return [
    prompt('forge transcribe talk.mp4'),
    ok('talk.md', '1:01:57 → 7,553 words · 5 parts'),
    [],
    prompt(`forge transcribe ${URL_TEXT}`),
    ok(OUT, '1:01:57 → 7,553 words · 5 parts'),
    [],
    prompt('forge transcribe talk.mp4 --to transcript'),
    ok('talk.md', '1:01:57 → 7,553 words'),
    [],
    prompt('forge transcribe interview.m4a --language hi'),
    ok('interview.md', '24:10 → 3,120 words · 2 parts'),
  ]
}

/* ------------------------------------------------------------ the file (M1, round one) */

const DISCLAIMER = 'Summary and notes by Apple Intelligence. They may contain mistakes.'
function fileHtml(): string {
  const md = readFileSync('/tmp/forge-stt/data/talk.md', 'utf8')
  const [head = '', rest = ''] = md.split('## Notes')
  const [notesPart = '', transPart = ''] = rest.split('## Transcript')
  const summary = head
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .join(' ')
  const sections = (s: string) =>
    `\n${s}`
      .split('\n### ')
      .slice(1)
      .map((sec) => sec.split('\n').slice(1).filter(Boolean))
  const notes = sections(notesPart)
  const words = sections(transPart)
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  let out = `<h1>${esc(OUT.replace('.md', ''))}</h1><p class="src">${esc(URL_TEXT)} · 1:01:57</p><p>${inline(summary)}</p><p class="ai"><i>${DISCLAIMER}</i></p><h2>Notes</h2>`
  PARTS.forEach(([t, h], i) => {
    out += `<h3>${esc(h)} <span class="ts">${t}</span></h3><ul>${(notes[i] ?? []).map((l) => `<li>${inline(l.replace(/^- /, ''))}</li>`).join('')}</ul>`
  })
  out += '<h2>Transcript</h2>'
  PARTS.forEach(([t, h], i) => {
    out += `<h3>${esc(h)} <span class="ts">${t}</span></h3>${(words[i] ?? [])
      .slice(0, 2)
      .map((p) => `<p>${inline(p)}</p>`)
      .join('')}<p class="more">…</p>`
  })
  return `<div class="doc">${out}</div>`
}

/* ------------------------------------------------------------ page */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
function html(rows: Row[], short = false): string {
  rows.forEach((r, i) => {
    if (width(r) > N) console.warn(`row ${i} is ${width(r)} wide:`, r.map((x) => x.text).join(''))
  })
  if (!short && rows.length !== H) console.warn(`${rows.length} rows`)
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
        out += style
          ? `<span style="${style}">${esc(x.text)}</span>`
          : `<span>${esc(x.text)}</span>`
        used += stringWidth(x.text)
      }
      if (used < N) out += `<span>${' '.repeat(N - used)}</span>`
      return `<div class="r">${out}</div>`
    })
    .join('')
  return `<div class="t" style="background:${DARK.canvas};color:${DARK.fg}">${body}</div>`
}

interface Fig {
  id: string
  name: string
  note: string
  draw?: () => Row[]
  raw?: () => string
  short?: boolean
}
const figure = (f: Fig) =>
  `<figure><div class="vt"><span class="id">${f.id}</span><span class="name">${f.name}</span></div>${f.raw ? f.raw() : html(f.draw?.() ?? [], f.short)}<p class="idea">${f.note}</p></figure>`
const flow = (figs: Fig[], arrows = true) =>
  `<div class="flow">${figs.map(figure).join(arrows ? '<div class="arrow">→</div>' : '')}</div>`

const LINK_FLOW: Fig[] = [
  {
    id: '1',
    name: 'Home · transcribe',
    note: 'The sixth tab, in red, where <b>/ menu</b> was. Drop a file, type a path, or paste a YouTube link.',
    draw: T1,
  },
  {
    id: '2',
    name: 'Looking up the link',
    note: 'yt-dlp reads the title and length (a second or two). Only the link is sent anywhere; nothing is downloaded yet.',
    draw: T2,
  },
  {
    id: '3',
    name: 'The video, waiting',
    note: 'The title and channel on the card, as a dropped file’s name and facts are. ↵ goes on.',
    draw: T3,
  },
  {
    id: '4',
    name: 'Transcribe to',
    note: 'Notes or Only transcript: a plain list, the chosen row says what is in it.',
    draw: T4,
  },
  { id: '5', name: 'Save as', note: 'Named after the video.', draw: T5 },
  {
    id: '6',
    name: 'Working · downloading',
    note: 'Only the sound (about 60 MB for an hour), real bytes. Deleted once the file is written.',
    draw: T6,
  },
  {
    id: '7',
    name: 'Working · transcribing',
    note: 'About a minute for an hour; a true bar.',
    draw: T7,
  },
  { id: '8', name: 'Working · notes', note: 'A dot per part; about 30 s.', draw: T8 },
  { id: '9', name: 'Done', note: 'The parts it found; the keys on the key row.', draw: T9 },
]
const FILE_FLOW: Fig[] = [
  {
    id: '3·f',
    name: 'A file instead',
    note: 'Drop or type a path: the card is the file’s, and the flow goes on with no download.',
    draw: T3F,
  },
]
const COMMANDS: Fig[] = [
  {
    id: '1',
    name: '“/ menu” above the key row',
    note: 'Right-aligned on the row above the key row, on every home tab.',
    draw: C1,
  },
]
const MENU_OPEN: Fig[] = [
  {
    id: '2',
    name: 'Type /: the popup',
    note: 'A box over the whole screen, home dimmed behind it: the hatched header bar on top, the commands, and its own field at the foot. Every command with what it does; nothing scrolls. ↑↓ choose, ↵ opens, esc closes. A mode closes the box on that tab.',
    draw: POP,
  },
  { id: '3', name: 'Typing narrows it', note: '<b>/ex</b> leaves extensions.', draw: POP_T },
  {
    id: '4',
    name: '/theme, inside',
    note: 'A setting opens in the box, not as its own screen; the header bar says where you are (<b>Theme</b>). esc back to the list, esc again to home.',
    draw: POP_THEME,
  },
  {
    id: '5',
    name: '/extensions, inside',
    note: 'The extensions screen’s own split, at the box’s width. (Its sizes come from the catalogue; left out here.)',
    draw: POP_EXT,
  },
  { id: '6', name: '/update, inside', note: 'The same, for update.', draw: POP_UPD },
  { id: '7', name: '/about, inside', note: 'About’s tabs and links, in the box.', draw: POP_ABOUT },
]
const DONE_FIGS: Fig[] = [
  {
    id: 'D',
    name: 'From a link',
    note: 'A green <b>done</b> chip, the file, the parts it found. The keys on the key row: <b>↵ new</b>, <b>o open</b>, <b>s finder</b>, <b>c copy</b> (the whole file, to paste anywhere).',
    draw: T9,
  },
  { id: 'D·f', name: 'From a file', note: 'The same.', draw: D_FILE },
  {
    id: 'D·t',
    name: 'After Only transcript',
    note: 'No notes, so no parts: the file and the keys.',
    draw: D_ONLY,
  },
]
const COLOUR: Fig[] = [
  {
    id: 'red',
    name: '#e63946',
    note: 'Every red sits near pdf’s orange-red; this one is the furthest from it and from the error colour that were tried. The hatching and the dots drift from red to pink, as convert’s drift from cyan to violet. It is a little darker than the other modes’ colours, as most reds are.',
    draw: swatches,
    short: true,
  },
]
const LINK_EDGES: Fig[] = [
  {
    id: 'Y1',
    name: 'First link: the add-on',
    note: 'yt-dlp is not in Forge; the first link offers it, as video offers ffmpeg. 37 MB, kept up to date by Forge, and it runs on the Node Forge already has.',
    draw: OFFER,
  },
  {
    id: 'Y2',
    name: 'Installing',
    note: 'Real bytes. Then 2, Looking up the link.',
    draw: INSTALLING,
  },
  {
    id: 'Y3',
    name: 'A private or missing video',
    note: 'E5·b, the one tinted row for refusals, in the drop zone. The same row for a link that is not a video.',
    draw: PRIVATE,
  },
  {
    id: 'Y4',
    name: 'A playlist',
    note: 'One video per run, so a playlist is refused with what to do instead.',
    draw: PLAYLIST,
  },
]
const OTHER_EDGES: Fig[] = [
  {
    id: 'E1',
    name: 'Apple Intelligence off',
    note: 'Only transcript is left, so there is nothing to choose: Transcribe to is skipped and it goes straight to Save as.',
    draw: AI_OFF,
  },
  {
    id: 'E2',
    name: 'First time in a language',
    note: 'macOS fetches its speech model once per language (about 200 MB), with real progress.',
    draw: W0,
  },
  {
    id: 'E3',
    name: 'A part with no notes',
    note: 'If Apple still refuses a part after the looser retry, it keeps its transcript and time, and Done says so.',
    draw: NO_NOTES,
  },
]
const FILE_FIGS: Fig[] = [
  {
    id: 'M1',
    name: 'The file',
    note: 'As round one, with the link and length under the title. Two paragraphs of transcript a part here.',
    raw: fileHtml,
  },
]
const CLI_FIGS: Fig[] = [
  {
    id: 'CLI',
    name: 'forge transcribe',
    note: 'The mode as a word, as the others are. <b>--language</b> only here.',
    draw: cli,
    short: true,
  },
]

const DECIDED = [
  '<b>Transcribe is its own mode:</b> the sixth tab on home, in red, in the slot “/ menu” had.',
  '<b>“/ menu” sits above the key row</b>, right-aligned.',
  '<b>Done:</b> a green “done” chip, the file and its parts; ↵ new, o open, s finder, c copy on the key row. No word count.',
  '<b>A path, a dropped file or a YouTube link</b>, then the flow goes on from there.',
  '<b>Mac only</b> (macOS 26 or later). Windows only if it has equivalent built-in tools.',
  '<b>Apple does the work:</b> its speech recogniser, and Apple Intelligence for the notes.',
  '<b>The file says the notes may be wrong</b>, in one line under the summary.',
]
const CALLS = [
  '<b>Red is #e63946</b>, the red furthest from pdf’s and from the error colour.',
  '<b>Transcribe to</b> offers Notes and Only transcript; with Apple Intelligence off the step is skipped. Convert’s “text” box from round one is gone: the mode is the job.',
  '<b>/ opens the menu as a popup over the whole screen</b>, home dimmed behind, with its own field; theme, extensions, update and about open inside it.',
  '<b>YouTube through yt-dlp</b>, an add-on installed on the first link (37 MB). It fetches the sound only, and Forge deletes it after.',
  '<b>One video per run</b>; a playlist is refused with what to do instead.',
  '<b>Kept from round one:</b> the Mac’s language (others by <b>--language</b>), Done lists the parts, notes then transcript in the file, the disclaimer.',
]
const NEEDS_YOU = [
  '<b>YouTube’s terms</b> do not allow downloading except through their own buttons. Many tools do it anyway (yt-dlp itself, MacWhisper), and the add-on keeps yt-dlp out of Forge’s own package, but it is a risk only you can take on. Keep the YouTube link, or drop it and keep files and paths only?',
]

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · transcribe · round 2</title>
<style>
  :root { --page:#0d0e11; --ink:#e2e4ea; --muted:#8f94a1; --rule:#23252c; --cyan:#55c7d9; --mono:"SF Mono", ui-monospace, Menlo, monospace; --sans:-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--page); color:var(--ink); font:16px/1.6 var(--sans); }
  main { max-width:2300px; margin:0 auto; padding:44px 24px 120px; }
  h1 { font-size:32px; margin:0 0 8px; }
  main > h2, section > h2 { font-size:15px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); margin:36px 0 0; }
  h2 b { color:var(--ink); }
  .lede { color:#c7cbd4; max-width:1000px; margin:0; }
  .status { display:inline-block; margin:16px 0 0; font:600 12px var(--mono); letter-spacing:.08em; color:#e8c46d; border:1px solid #5a4a2c; padding:3px 9px; border-radius:6px; }
  .qs { max-width:1100px; margin:18px 0 0; padding:16px 20px 16px 40px; border:1px solid var(--rule); border-radius:10px; background:#121318; }
  .qs li { margin:6px 0; color:#c7cbd4; } .qs li b { color:var(--ink); }
  .qs.done { border-color:#2c5a37; } .qs.done li::marker { color:#6fcf7f; }
  .qs.ask { border-color:#5a4a2c; } .qs.ask li::marker { color:#e8c46d; }
  .tabs { position:sticky; top:0; z-index:5; display:flex; flex-wrap:wrap; gap:6px; margin:26px -24px 0; padding:12px 24px; background:rgba(13,14,17,.94); border-bottom:1px solid var(--rule); }
  .tabs a { font:13px var(--mono); color:var(--muted); text-decoration:none; border:1px solid var(--rule); padding:6px 12px; border-radius:8px; cursor:pointer; }
  .tabs a.on { color:#0c1d22; background:var(--cyan); border-color:var(--cyan); font-weight:700; }
  section { display:none; margin-top:10px; } section.on { display:block; }
  .flow { display:flex; flex-wrap:wrap; gap:18px 14px; align-items:flex-start; }
  .arrow { align-self:center; font:28px var(--mono); color:var(--cyan); padding:0 2px; }
  figure { margin:22px 0 0; width:min-content; }
  .vt { display:flex; align-items:baseline; gap:10px; margin-bottom:8px; white-space:nowrap; }
  .vt .id { font:700 12px var(--mono); padding:3px 7px; border-radius:6px; background:#12282e; color:var(--cyan); }
  .vt .name { font-weight:620; }
  .idea { font-size:14px; color:#c7cbd4; margin:8px 0 0; }
  .t { font:13px/1 var(--mono); padding:12px 14px; border-radius:10px; border:1px solid #2c2f37; width:max-content; }
  .r { height:17px; white-space:pre; overflow:hidden; }
  .r > span { display:inline-block; height:17px; line-height:17px; vertical-align:top; }
  .doc { width:720px; max-height:900px; overflow:auto; padding:28px 34px; border-radius:10px; border:1px solid #2c2f37; background:#1b1b1b; color:#e7e7e7; font:15px/1.6 var(--sans); }
  .doc h1 { font-size:26px; margin:0 0 2px; }
  .doc .src { font:13px var(--mono); color:#909090; margin:0 0 12px; }
  .doc h2 { font-size:20px; margin:26px 0 8px; padding-bottom:4px; border-bottom:1px solid #333; }
  .doc h3 { font-size:16px; margin:18px 0 6px; }
  .doc p, .doc li { color:#d0d0d0; margin:6px 0; }
  .doc .ai { color:#909090; font-size:14px; }
  .doc .ts { font:13px var(--mono); color:#909090; font-weight:400; margin-left:6px; }
  .doc .more { color:#707070; }
  .doc b { color:#e7e7e7; font-family:var(--mono); font-size:13px; font-weight:500; }
</style></head>
<body><main>
<h1>Transcribe · round 2</h1>
<p class="lede">Transcribe as its own mode on home: drop a video or sound file, type a path, or paste a YouTube link; get notes or a transcript. Home and Save as are captured from the app at 80 × 24 and recoloured; the rest is drawn with the app’s own art functions. The file is the spike’s real output from a one-hour talk.</p>
<span class="status">OPEN · ROUND 2</span>
<h2>Decided</h2>
<ol class="qs done">${DECIDED.map((q) => `<li>${q}</li>`).join('')}</ol>
<h2>Needs you</h2>
<ol class="qs ask">${NEEDS_YOU.map((q) => `<li>${q}</li>`).join('')}</ol>
<h2>My calls · say if any is wrong</h2>
<ol class="qs">${CALLS.map((q) => `<li>${q}</li>`).join('')}</ol>
<div class="tabs"><a data-t="link" class="on">From a link</a><a data-t="done">Done</a><a data-t="commands">/ menu</a><a data-t="colour">Red</a><a data-t="links">Links: edge cases</a><a data-t="edge">Other edge cases</a><a data-t="file">The file</a><a data-t="cli">Command line</a></div>
<section id="s-link" class="on"><h2><b>FLOW</b> · a YouTube talk to notes</h2>${flow(LINK_FLOW)}<h2><b>FROM A FILE</b></h2>${flow(FILE_FLOW)}</section>
<section id="s-done"><h2><b>DONE</b> · what to do next</h2>${flow(DONE_FIGS, false)}</section>
<section id="s-commands"><h2><b>WHERE “/ MENU” GOES</b></h2>${flow(COMMANDS, false)}<h2><b>HOW IT OPENS</b></h2>${flow(MENU_OPEN, false)}</section>
<section id="s-colour"><h2><b>THE RED</b></h2>${flow(COLOUR)}</section>
<section id="s-links"><h2><b>LINKS</b></h2>${flow(LINK_EDGES, false)}</section>
<section id="s-edge"><h2><b>EDGE CASES</b></h2>${flow(OTHER_EDGES, false)}</section>
<section id="s-file"><h2><b>THE .MD FILE</b> · as a Markdown viewer shows it</h2>${flow(FILE_FIGS, false)}</section>
<section id="s-cli"><h2><b>SCREEN</b></h2>${flow(CLI_FIGS)}</section>
</main>
<script>
document.querySelectorAll('.tabs a').forEach((a) => a.onclick = () => {
  document.querySelectorAll('.tabs a').forEach((b) => b.classList.toggle('on', b === a))
  document.querySelectorAll('section').forEach((s) => s.classList.toggle('on', s.id === 's-' + a.dataset.t))
  history.replaceState(null, '', '#' + a.dataset.t)
})
const h = location.hash.slice(1); if (h) document.querySelector('.tabs a[data-t="' + h + '"]')?.click()
const solo = new URLSearchParams(location.search).get('solo')
if (solo) {
  const [t, i] = solo.split('-')
  document.querySelector('.tabs a[data-t="' + t + '"]')?.click()
  document.querySelectorAll('main > :not(section)').forEach((e) => e.remove())
  document.querySelectorAll('section > h2, .arrow').forEach((e) => e.remove())
  document.querySelectorAll('#s-' + t + ' figure').forEach((f, k) => { if (String(k) !== i) f.remove() })
  document.querySelector('main').style.padding = '0 16px'
}
</script></body></html>`

const out = new URL('../mockups/transcribe-2026-10-round2.html', import.meta.url)
writeFileSync(out, page)
console.log('wrote', decodeURIComponent(out.pathname), page.length)
