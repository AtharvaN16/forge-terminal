/**
 * Transcribe home, less text (2026-10-19). The screen as it is today has a
 * lot of words on it: two lines in the drop zone, a long field placeholder
 * (now with "only English supported currently"), the key row's five hints.
 * Four ways of saying the same things with fewer words. Cells are captured
 * from the real app at 80 × 24 (tests/shell/zz-video-capture.test.tsx wrote
 * /tmp/forge-video/frames-dark.json), recoloured red for the mode.
 *
 *   npx tsx scripts/transcribe-home-mockup.ts   → mockups/transcribe-home-2026-10.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import stringWidth from 'string-width'
import type { BarChip } from '../src/shell/bar-art.js'
import { type Command, listCommands } from '../src/shell/commands.js'
import { blank, mix, type Row, type Run, width } from '../src/shell/home-art.js'
import {
  DARK,
  modeGradient,
  modePalette,
  type Palette,
  type ShellMode,
} from '../src/shell/theme.js'

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
function _swap(cells: Cell[] | undefined, from: string, to: string) {
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
const _CONVERT: Look = { p: modePalette(DARK, 'convert'), mode: 'convert' }
/** Drawn as convert with convert's colours swapped for the red, until transcribe is a ShellMode. */
const TRANS: Look = {
  p: modePalette({ ...DARK, modeConvert: RED, modeConvertBg: RED_BG }, 'convert'),
  mode: 'convert',
  chip: { label: 'transcribe', colour: RED, stops: [RED, toRed(DARK.violet) ?? RED] },
}

/* ------------------------------------------------------------ pieces */

const run = (text: string, fg?: string, bg?: string, bold = false): Run => ({ text, fg, bg, bold })

/* ------------------------------------------------------------ home */

const PANEL = '#2c2c2c'
const FIELD = '#242424'
const TABS = ['convert', 'compress', 'pdf', 'edit', 'transcribe', 'colour']

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
  words?: Run[][]
  /** Text knocked out of the band's bottom row, left of the version. */
  band?: string
  /** A chip stamped in the drop zone's top-right corner. */
  corner?: string
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
const _commandsFor = (query: string): Command[] => {
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
    // Clear the captured words back to dots (rows 10, 11 are as row 9), then set ours:
    // one line on the middle row, two on 10–11 as the app has them, three on 10–12.
    for (const r of [10, 11, 12]) f[r] = (f[9] ?? []).map((c) => ({ ...c }))
    const first = o.words.length === 1 ? 11 : 10
    o.words.forEach((w, i) => {
      const cells = f[first + i]
      if (cells) panelWords(cells, w)
    })
  }
  if (o.band && f[4]) {
    // As the version: spaces round it, the canvas behind, a dim grey.
    const end = 64
    const from = end - stringWidth(o.band) - 1
    let x = from
    for (const ch of ` ${o.band} `)
      Object.assign(f[4][x++] ?? {}, {
        ch,
        fg: ch === ' ' ? null : DARK.dim,
        bg: '#1e1e1e',
        b: false,
      })
  }
  if (o.corner && f[9]) {
    const w = stringWidth(o.corner) + 2
    const from = 74 - w
    for (let i = from - 2; i < 74; i++)
      Object.assign(f[9][i] ?? {}, { ch: ' ', fg: null, bg: PANEL })
    let x = from
    for (const ch of ` ${o.corner} `)
      Object.assign(f[9][x++] ?? {}, { ch, fg: DARK.dim, bg: '#3a3a3a', b: false })
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

const _dropWords = (L: Look, main: string, sub: string): [Run[], Run[]] => [
  [run('↓', L.p.accent, undefined, true), run(`  ${main}`, L.p.fg, undefined, true)],
  [run(sub, L.p.dim)],
]

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

/* ------------------------------------------------------------ the concepts */

const R = TRANS
const NOTE = DARK.dim

interface Concept {
  words: Run[][]
  field: string
  /** Chip at the field's far end. */
  chip?: string
  /** Dim label on the row under the field, level with its text. */
  under?: string
  /** Chip in the drop zone's top-right corner. */
  corner?: string
  /** Text on the band's bottom row. */
  band?: string
  foot?: string
}

const LESS = '1–6 ←→ mode · esc clear · ctrl-c quit'
const FULL = '1–6 ←→ mode · esc clear · ctrl-n new · ctrl-c quit'

function scene(c: Concept): Row[] {
  const rows = home(R, {
    on: 'transcribe',
    red: true,
    words: c.words,
    corner: c.corner,
    band: c.band,
    field: c.field,
    menu: 'above',
  })
  rows[16] = fieldRow(R, c.field, c.chip ? [run(` ${c.chip} `, NOTE, '#3a3a3a')] : null)
  if (c.under) rows[18] = [blank(6), run(c.under, NOTE)]
  const foot = c.foot ?? LESS
  const key: Row = [blank(5), run(' ↵ ', R.p.fg, '#333333', true), run(' send', R.p.dim)]
  key.push(blank(79 - width(key) - stringWidth(foot)), run(foot, R.p.border))
  rows[23] = key
  return rows
}

const bold = (t: string): Run[] => [
  run('↓', R.p.accent, undefined, true),
  run(`  ${t}`, R.p.fg, undefined, true),
]
const dim = (t: string): Run[] => [run(t, R.p.dim)]
const YT = 'or paste a YouTube link'

const PATH = 'or type a path'
const SPEECH = 'English speech only'

const TODAY = () =>
  scene({
    words: [bold('Drop a video or sound file'), dim(YT)],
    field: 'or type a path or link (only English supported currently)',
    foot: FULL,
  })

interface Fig {
  id: string
  name: string
  note: string
  draw: () => Row[]
}

const OPTIONS: Fig[] = [
  {
    id: 'A',
    name: 'Corner chip',
    note: 'Both drop-zone lines stay, YouTube included. A <b>English speech only</b> chip in the zone’s top-right corner; the field is bare.',
    draw: () =>
      scene({ words: [bold('Drop a video or sound file'), dim(YT)], field: PATH, corner: SPEECH }),
  },
  {
    id: 'B',
    name: 'Chip in the field',
    note: 'The chip at the field’s far end, where the app puts other in-field hints.',
    draw: () =>
      scene({ words: [bold('Drop a video or sound file'), dim(YT)], field: PATH, chip: SPEECH }),
  },
  {
    id: 'C',
    name: 'In the sentence',
    note: 'No extra element: the language is part of what you are asked to drop. “Drop an <b>English</b> video or sound file”.',
    draw: () =>
      scene({
        words: [bold('Drop an English video or sound file'), dim(YT)],
        field: PATH,
      }),
  },
  {
    id: 'D',
    name: 'Third line in the zone',
    note: 'Everything about what goes in lives in the zone, three lines, the last one dim. The field is bare.',
    draw: () =>
      scene({
        words: [bold('Drop a video or sound file'), dim(YT), dim('Spoken English only')],
        field: PATH,
      }),
  },
  {
    id: 'E',
    name: 'Under the field',
    note: 'A dim line below the field, level with its text.',
    draw: () =>
      scene({
        words: [bold('Drop a video or sound file'), dim(YT)],
        field: PATH,
        under: 'Transcribes English speech only',
      }),
  },
  {
    id: 'F',
    name: 'On the band',
    note: 'Knocked out of the hatching beside the version, the way the version is. It reads as a property of the mode, off the working area altogether.',
    draw: () =>
      scene({
        words: [bold('Drop a video or sound file'), dim(YT)],
        field: PATH,
        band: SPEECH,
      }),
  },
  {
    id: 'G',
    name: 'Bracket, rewritten',
    note: 'Closest to today: the bracket stays in the field, said as what it means.',
    draw: () =>
      scene({
        words: [bold('Drop a video or sound file'), dim(YT)],
        field: 'or type a path (English speech only)',
      }),
  },
]

const figure = (f: Fig) =>
  `<figure><div class="vt"><span class="id">${f.id}</span><span class="name">${f.name}</span></div>${html(f.draw())}<p class="idea">${f.note}</p></figure>`

const QUESTIONS = [
  '<b>The YouTube line stays</b> in every option, as it is today.',
  '<b>What it should say:</b> the limit is the language spoken in the file, not the language of the screen. “English speech only” (A, B, F, G), “Spoken English only” (D), “Transcribes English speech only” (E), or inside the drop line (C). Which wording?',
  '<b>Key row on home:</b> <b>ctrl-n new</b> goes in every option but today, because there is nothing to start over from on home. This touches every mode’s home, not only transcribe.',
]

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · transcribe home · less text</title>
<style>
  :root { --page:#0d0e11; --ink:#e2e4ea; --muted:#8f94a1; --rule:#23252c; --red:#e63946; --mono:"SF Mono", ui-monospace, Menlo, monospace; --sans:-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--page); color:var(--ink); font:16px/1.6 var(--sans); }
  main { max-width:1900px; margin:0 auto; padding:44px 24px 120px; }
  h1 { font-size:32px; margin:0 0 8px; }
  h2 { font-size:15px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); margin:36px 0 0; }
  h2 b { color:var(--ink); }
  .lede { color:#c7cbd4; max-width:1000px; margin:0; }
  .qs { max-width:1100px; margin:18px 0 0; padding:16px 20px 16px 40px; border:1px solid #5a4a2c; border-radius:10px; background:#121318; }
  .qs li { margin:6px 0; color:#c7cbd4; } .qs li::marker { color:#e8c46d; } .qs li b { color:var(--ink); }
  .flow { display:flex; flex-wrap:wrap; gap:18px 28px; align-items:flex-start; }
  figure { margin:22px 0 0; width:min-content; }
  .vt { display:flex; align-items:baseline; gap:10px; margin-bottom:8px; white-space:nowrap; }
  .vt .id { font:700 12px var(--mono); padding:3px 7px; border-radius:6px; background:#3a1a1d; color:var(--red); }
  .vt .name { font-weight:620; }
  .idea { font-size:14px; color:#c7cbd4; margin:8px 0 0; width:0; min-width:100%; }
  .t { font:13px/1 var(--mono); padding:12px 14px; border-radius:10px; border:1px solid #2c2f37; width:max-content; }
  .r { height:17px; white-space:pre; overflow:hidden; }
  .r > span { display:inline-block; height:17px; line-height:17px; vertical-align:top; }
</style></head>
<body><main>
<h1>Transcribe home · less text</h1>
<p class="lede">The same screen seven ways. The YouTube line stays; the question is where the language limit goes and what it says. Captured from the app at 80 × 24, recoloured red.</p>
<h2>Questions · strings to approve</h2>
<ol class="qs">${QUESTIONS.map((q) => `<li>${q}</li>`).join('')}</ol>
<h2><b>TODAY</b> · for comparison</h2>
<div class="flow">${figure({ id: 'Today', name: 'As it is', note: 'Two lines in the drop zone, a long field, a five-hint key row.', draw: TODAY })}</div>
<h2><b>OPTIONS</b> · pick one</h2>
<div class="flow">${OPTIONS.map(figure).join('')}</div>
</main></body></html>`

const out = new URL('../mockups/transcribe-home-2026-10.html', import.meta.url)
writeFileSync(out, page)
console.log('wrote', decodeURIComponent(out.pathname), page.length)
