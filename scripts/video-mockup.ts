/**
 * Video and audio (ffmpeg), round three (2026-10-16): the mode is the job.
 * Convert changes the format, compress makes it smaller, edit cuts or
 * mutes; Forge picks the technical settings; extras are CLI-only. Rounds one
 * and two (mockups/video-2026-10.html, -round2.html) are frozen.
 *
 * Home, Method, Target size, Save as and Done's keys are cells captured from
 * the real app at 80 × 24 (tests/shell/zz-video-capture.test.tsx wrote
 * /tmp/forge-video/frames-dark.json); the header bar, the staged card, Done's
 * panels, Working's line, the quality band and the notes are the app's own art
 * functions. Only the video-specific rows (the timeline, the frames, the
 * waveform, the pills) are drawn here, from the same palette.
 *
 *   npx tsx scripts/video-mockup.ts   → mockups/video-2026-10-round3.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import stringWidth from 'string-width'
import { formatBytes } from '../src/core/units.js'
import { trailBarRow } from '../src/shell/bar-art.js'
import { doneBody, doneNotes } from '../src/shell/done-art.js'
import { blank, mix, type Row, type Run, stagedCardRows, width } from '../src/shell/home-art.js'
import { sliderRow } from '../src/shell/quality-art.js'
import { DARK, modePalette, type Palette, type ShellMode } from '../src/shell/theme.js'
import { middleEllipsis } from '../src/shell/width.js'
import { workLine } from '../src/shell/working-art.js'

const N = 80
const H = 24
const MB = 1000 * 1000

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

/* ------------------------------------------------------------ palette */

interface Look {
  p: Palette
  mode: ShellMode
}
const look = (mode: ShellMode): Look => ({ p: modePalette(DARK, mode), mode })
const CONVERT = look('convert')
const COMPRESS = look('compress')
const EDIT = look('edit')

/* ------------------------------------------------------------ the story */

const REC = 'Screen Recording 2026-10-16 at 10.42.13'
const VIDEO = {
  name: `${REC}.mov`,
  tag: 'MOV',
  facts: '2:10 · 2940×1912 · 60 fps · 184 MB',
  size: '184 MB',
}
const POD = 'episode-14-raw'
const AUDIO = {
  name: `${POD}.wav`,
  tag: 'WAV',
  facts: '58:12 · stereo · 48 kHz · 671 MB',
  size: '671 MB',
}
const DUR = 130

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

const title = (L: Look, text: string, right?: string, rightCol = 39): Row => [
  blank(3),
  run(text, L.p.accent, undefined, true),
  ...(right ? [blank(Math.max(1, rightCol - 3 - stringWidth(text))), run(right, L.p.dim)] : []),
]

/** `row` on the list band, `n` wide, keeping any fill a run already has (a byte band, a bar). */
const onBand = (L: Look, row: Row, n = N - 4): Row =>
  pad(row, n).map((x) => ({ ...x, bg: x.bg ?? L.p.listBand }))
/** The Boost-style pill at the band's far end: ‹ 2× ›. */
const pill = (L: Look, v: string, left = true, rightOk = true): Run[] => [
  run(left ? '‹ ' : '  ', left ? L.p.dim : L.p.faint),
  run(v, L.p.fg, undefined, true),
  run(rightOk ? ' ›' : '  ', rightOk ? L.p.dim : L.p.faint),
]

/* ------------------------------------------------------------ time */

const t2s = (t: number) => {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}
const t2m = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`

/* ------------------------------------------------------------ Length: the sound and the bar */

const TL_LEAD = 3
const TL_W = 74
const at = (t: number, total = DUR) => Math.round((t / total) * (TL_W - 1))

/** A voice over a screen recording: talk, pauses, a quiet start. */
const LEVELS = Array.from({ length: TL_W }, (_, i) => {
  if (i < 2) return 0.03
  const talk = Math.abs(
    Math.sin(i * 0.9) * 0.55 + Math.sin(i * 2.3) * 0.3 + Math.sin(i * 0.17) * 0.25,
  )
  const pause = i % 17 < 3 || (i > 60 && i < 64) ? 0.12 : 1
  return Math.min(1, 0.1 + talk * pause)
})

/**
 * The sound as peaks: a plain vertical line per column rising from the
 * bottom row, as tall as that moment is loud, its top in half cells (╷).
 * White where it is kept, grey where it is cut.
 */
function waveRows(L: Look, a: number, b: number, rows = 3): Row[] {
  const lo = at(a)
  const hi = at(b)
  return Array.from({ length: rows }, (_, r) => {
    const up = rows - 1 - r
    const row: Row = [blank(TL_LEAD)]
    LEVELS.forEach((v, i) => {
      const h = Math.max(1, Math.round(v * rows * 2))
      const covered = Math.max(0, Math.min(2, h - 2 * up))
      const ch = covered === 2 ? '│' : covered === 1 ? '╷' : ' '
      row.push(run(ch, i >= lo && i <= hi ? L.p.fg : L.p.faint))
    })
    return row
  })
}

/** What the arrows move: J the start, L the end, space the range (both ends, its length kept). */
type Active = 'start' | 'end' | 'both' | 'none'
const moves = (active: Active, end: 'start' | 'end') => active === end || active === 'both'

/** The length as a filled bar: what is kept in the mode's colour, what is cut grey, a handle at each end. */
function barRow(L: Look, a: number, b: number, active: Active, colour = L.p.accent): Row {
  const lo = at(a)
  const hi = at(b)
  const row: Row = [blank(TL_LEAD)]
  for (let i = 0; i < TL_W; i++) {
    const handle = i === lo || i === hi
    const on = (i === lo && moves(active, 'start')) || (i === hi && moves(active, 'end'))
    if (handle) row.push(run(' ', undefined, on ? L.p.thumb : colour))
    else if (i > lo && i < hi) row.push(run(' ', undefined, mix(L.p.canvas, colour, 0.45)))
    else row.push(run(' ', undefined, L.p.track))
  }
  return row
}

/**
 * Under the bar: the I and O chips at their handles, and the minutes faint
 * wherever a chip is not. The times themselves are in the fields below.
 */
function handlesRow(L: Look, a: number, b: number, active: Active): Row {
  const lo = at(a)
  const hi = at(b)
  type C = { ch: string; fg?: string; bg?: string; bold?: boolean; own?: boolean }
  const cells: C[] = Array.from({ length: TL_W }, () => ({ ch: ' ' }))
  const put = (x: number, text: string, style: Omit<C, 'ch'>) =>
    [...text].forEach((ch, i) => {
      const c = cells[x + i]
      if (c) Object.assign(c, { ch, ...style })
    })
  const free = (x: number, n: number) =>
    x >= 0 && x + n <= TL_W && cells.slice(x, x + n).every((c) => !c.own)
  // The handles first, then the minutes where they still fit.
  const chip = (on: boolean) => ({
    fg: on ? L.p.ink : L.p.fg,
    bg: on ? L.p.accent : L.p.keycapBg,
    bold: true,
    own: true,
  })
  const jx = Math.max(0, lo - 1)
  // Two handles closer than their chips: L's chip sits just after J's.
  const lx = Math.min(TL_W - 3, Math.max(jx + 3, hi - 1))
  put(jx, ' I ', chip(moves(active, 'start')))
  put(lx, ' O ', chip(moves(active, 'end')))
  for (const t of [0, 30, 60, 90, 120, DUR]) {
    const label = t2m(t)
    const x = t === DUR ? TL_W - label.length : t === 0 ? 0 : at(t) - 1
    if (free(x - 1, label.length + 2) || (x === 0 && free(0, label.length + 1)))
      put(x, label, { fg: L.p.faint })
  }
  return [blank(TL_LEAD), ...cells.map((c) => run(c.ch, c.fg, c.bg, c.bold))]
}

const A = 3.2
const B = 41.0

/**
 * Above the key row: start and end as two fields, the tab chip at the row’s far right.
 * The chosen end's field is live: typing a time replaces it (0:41, 41,
 * 1:02.5); tab, I or O moves to the other; ↵ keeps both.
 */
function timeFields(L: Look, a: number, b: number, active: Active): Row {
  // Both words white; the chosen end's time on a chip in the mode's tint (the
  // bar's kept fill), the other's plain grey.
  const field = (label: string, t: number, on: boolean): Run[] => [
    run(label, L.p.fg),
    blank(2),
    on
      ? run(` ${t2s(t)} `, L.p.fg, mix(L.p.canvas, L.p.accent, 0.45), true)
      : run(` ${t2s(t)} `, L.p.dim),
  ]
  // start at the left edge with the sound and the bar; tab, which moves the
  // chip from one time to the other, a grey chip at the row's far right.
  const left: Row = [
    blank(TL_LEAD),
    ...field('start', a, moves(active, 'start')),
    blank(4),
    ...field('end', b, moves(active, 'end')),
  ]
  const right: Row = [run(' tab ', L.p.dim, L.p.keycapBg)]
  return [...left, blank(TL_LEAD + TL_W - width(left) - width(right)), ...right]
}

/** Length (T1): the card, then the sound, the bar and the handles. No pictures. */
function lengthStep(
  L: Look,
  active: Active,
  a = A,
  b = B,
  answers: string[] = ['Trim'],
  name = 'Trim',
  /** A GIF past 15 s: too big to post almost anywhere, so the kept length turns orange. */
  long = false,
  step = '1 s',
): Row[] {
  const kept = `keeps ${t2s(b - a)} of ${t2m(DUR)}`
  return screen(
    [
      ...top(L, answers, 'Length'),
      ...card(L, VIDEO),
      [],
      // How far ←→ moves, at the title's far end: the word and the pill
      // (1 s · 5 s · 10 s · 30 s · 1 min · 5 min · 10 min · 30 min, the ones up to
      // about a quarter of the video; stepped with [ ]). 1 s to start.
      (() => {
        const head = title(L, name)
        const stepRow: Row = [run('step  ', L.p.dim), ...pill(L, step)]
        return [...head, blank(TL_LEAD + TL_W - width(head) - width(stepRow)), ...stepRow]
      })(),
      [],
      ...waveRows(L, a, b),
      [],
      barRow(L, a, b, active, long ? L.p.larger : L.p.accent),
      handlesRow(L, a, b, active),
      [],
      // The kept length; GIF's warning at the same row's far end.
      long
        ? [
            blank(TL_LEAD),
            run(kept, L.p.dim),
            blank(TL_W - kept.length - 'GIF might be too large'.length),
            run('GIF might be too large', L.p.larger),
          ]
        : [blank(TL_LEAD), run(kept, L.p.dim)],
      [],
      [],
      timeFields(L, a, b, active),
    ],
    keys(
      L,
      [
        ['I', 'start'],
        ['O', 'end'],
        ['space', 'range'],
        ['←→', 'move'],
        ['[ ]', 'step'],
        ['↵', 'confirm'],
      ],
      'esc',
    ),
  )
}

/* ------------------------------------------------------------ the app's own steps */

function home(L: Look, f: Src, under?: string): Row[] {
  const name =
    L.mode === 'convert' ? 'staged' : L.mode === 'compress' ? 'stagedCompress' : 'stagedEdit'
  const rows = frame(name).map(rowOf)
  const surface = stagedCardRows({
    width: N - 4,
    rows: 7,
    palette: L.p,
    mode: L.mode,
    file: { name: f.name, tag: f.tag, size: '', facts: f.facts },
  })
  surface.forEach((r, i) => {
    rows[8 + i] = [blank(2), ...r]
  })
  if (under) rows[18] = [blank(6), run(under, L.p.dim)]
  return rows.slice(0, H)
}

function method(L: Look, src: Src = VIDEO): Row[] {
  const f = frame('how')
  swap(f[8], 'Screen Recording.jpg', '')
  swap(f[10], 'pick a level, see the result', '')
  const rows = f.map(rowOf)
  rows[1] = header(L, [], 'Method')
  card(L, src).forEach((r, i) => {
    rows[3 + i] = r
  })
  return rows
}

interface ERow {
  name: string
  pane: [string, string, string?]
  pill?: string
}
function editPicker(L: Look, src: Src, tools: (ERow | null)[], at: string): Row[] {
  const list: Row[] = []
  const chosen = tools.find((t) => t?.name === at)
  const pane: Row[] = []
  if (chosen) {
    pane.push([run(chosen.pane[0], L.p.fg, undefined, true)])
    for (const line of wrap(chosen.pane[1], 36)) pane.push([run(line, L.p.dim)])
    if (chosen.pane[2]) {
      pane.push([])
      pane.push([run(chosen.pane[2], L.p.dim)])
    }
  }
  tools.forEach((t, i) => {
    let row: Row
    if (!t) row = [blank(38)]
    else if (t.name === at) {
      const body: Row = [run('▌', L.p.accent), blank(1), run(t.name, L.p.fg, undefined, true)]
      const p = t.pill ? pill(L, t.pill) : []
      const fill = 35 - width(body) - width(p) - 1
      row = [
        blank(2),
        ...[...body, blank(fill), ...p, blank(1)].map((r) => ({ ...r, bg: L.p.listBand })),
        blank(1),
      ]
    } else row = [blank(4), run(t.name, L.p.fg), blank(34 - t.name.length)]
    list.push([...row, run('│', L.p.border), blank(2), ...(pane[i] ?? [])])
  })
  return screen(
    [...top(L, [], 'Edit'), ...card(L, src), [], title(L, `Edit ${src.tag}`), [], ...list],
    keys(
      L,
      chosen?.pill
        ? [
            ['↑↓', 'choose'],
            ['←→', 'change'],
            ['↵', 'confirm'],
          ]
        : [
            ['↑↓', 'choose'],
            ['↵', 'confirm'],
          ],
      '1–5 mode · esc back · ctrl-c quit',
    ),
  )
}
function wrap(text: string, w: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line && `${line} ${word}`.length > w) {
      out.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) out.push(line)
  return out
}

function bitrate(L: Look, answers: string[], aside: string): Row[] {
  const ends: Row = [
    blank(3),
    run('smaller', L.p.border),
    blank(48 - 7 - 6),
    run('better', L.p.border),
  ]
  return screen(
    [
      ...top(L, answers, 'Quality'),
      ...card(L, AUDIO),
      [],
      title(L, 'Quality', aside, 59),
      [],
      [],
      [blank(2), ...sliderRow({ palette: L.p, value: 128, min: 64, max: 320, unit: ' kbps' })],
      ends,
      [],
      [blank(3), run('about 56 MB', L.p.fg, undefined, true), run('   92% smaller', L.p.ok)],
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

/* ------------------------------------------------------------ Convert to */

const VIDEO_FORMATS = [
  {
    group: 'video',
    items: [
      ['MP4', 'H.264 · AAC'],
      ['HEVC', 'H.265 · AAC'],
      ['WebM', 'VP9 · Opus'],
      ['GIF', '256 colours · no sound'],
    ],
  },
  {
    group: 'sound only',
    items: [
      ['MP3', ''],
      ['M4A', 'AAC'],
      ['WAV', ''],
    ],
  },
] as const

function formatScreen(L: Look, body: Row[], src: Src = VIDEO, across = false): Row[] {
  return screen(
    [...top(L, [], 'Format'), ...card(L, src), [], title(L, 'Convert to'), [], ...body],
    keys(
      L,
      [
        [across ? '↑↓←→' : '↑↓', 'choose'],
        ['↵', 'confirm'],
      ],
      'esc back · ctrl-c quit',
    ),
  )
}

/** F1 · the kinds as boxes side by side (video, sound only); ←→ between them, ↑↓ within. */
function formatTiles(L: Look, chosen = 'MP4', detail?: Run[], src: Src = VIDEO): Row[] {
  const gap = 2
  const W = Math.floor((N - 4 - gap * (VIDEO_FORMATS.length - 1)) / VIDEO_FORMATS.length)
  const inner = W - 2
  const tall = Math.max(...VIDEO_FORMATS.map((g) => g.items.length))
  const boxes = VIDEO_FORMATS.map((g) => {
    const has = g.items.some(([f]) => f === chosen)
    const edge = has ? L.p.accent : L.p.border
    const rows: Row[] = [
      [
        run('╭─ ', edge),
        run(g.group, has ? L.p.accent : L.p.dim, undefined, has),
        run(` ${'─'.repeat(W - 5 - g.group.length)}╮`, edge),
      ],
    ]
    for (let i = 0; i < tall; i++) {
      const it = g.items[i]
      if (!it) {
        rows.push([run('│', edge), blank(inner), run('│', edge)])
        continue
      }
      const on = it[0] === chosen
      const cell: Row = [
        run(on ? '▌' : ' ', L.p.accent),
        blank(1),
        run(it[0], L.p.fg, undefined, on),
      ]
      rows.push([
        run('│', edge),
        ...(on ? pad(cell, inner).map((x) => ({ ...x, bg: L.p.listBand })) : pad(cell, inner)),
        run('│', edge),
      ])
    }
    rows.push([run(`╰${'─'.repeat(inner)}╯`, edge)])
    return rows
  })
  const out: Row[] = []
  for (let i = 0; i < tall + 2; i++)
    out.push([blank(2), ...boxes.flatMap((b, k) => [...(k ? [blank(gap)] : []), ...(b[i] ?? [])])])
  const it = VIDEO_FORMATS.flatMap((g) => g.items).find(([f]) => f === chosen)
  out.push([])
  out.push([
    blank(3),
    run(chosen, L.p.fg, undefined, true),
    blank(3),
    ...(detail ?? [run(it?.[1] ?? '', L.p.dim)]),
  ])
  return formatScreen(L, out, src, true)
}

/* ------------------------------------------------------------ fit a size */

const CLIP = {
  name: 'Screen Recording 2026-10-16 at 10.51.02.mov',
  tag: 'MOV',
  facts: '0:06 · 2940×1912 · 60 fps · 9.8 MB',
  size: '9.8 MB',
}
/**
 * The unit chips, rebuilt on the captured field row: only the units between
 * the smallest this video can get and the file as it is. B never; KB only for
 * a clip short enough to get under 1 MB.
 */
function unitChips(cells: Cell[], units: string[], chosen: string) {
  const field = '#2c2c2c'
  const chip = '#414141'
  for (let i = 50; i < 74; i++)
    Object.assign(cells[i] ?? {}, { ch: ' ', fg: null, bg: field, b: false })
  let x = 72
  for (const u of [...units].reverse()) {
    const text = `  ${u}  `
    x -= text.length
    const on = u === chosen
    ;[...text].forEach((ch, i) => {
      Object.assign(cells[x + i] ?? {}, {
        ch,
        fg: ch === ' ' ? null : on ? DARK.fg : DARK.dim,
        bg: on ? chip : field,
        b: on,
      })
    })
  }
}
function targetTyped(
  L: Look,
  typed: string,
  refused: boolean,
  units = ['MB'],
  src: Src & { size: string } = { ...VIDEO, size: '184 MB' },
): Row[] {
  const f = frame('sizeTyped')
  swap(
    f[8],
    'Screen Recording.jpg · 1.1 MB',
    `${middleEllipsis(src.name, 20)} · ${src.size}`.padStart(29),
  )
  swap(f[12], '10mb ', typed)
  const typedUnit = typed.match(/[kmg]?b$/i)?.[0].toUpperCase()
  if (f[12])
    unitChips(f[12], units, typedUnit && units.includes(typedUnit) ? typedUnit : (units[0] ?? 'MB'))
  // One unit leaves nothing for tab to switch to.
  if (units.length < 2) {
    const k = f[23] ?? []
    const at = k
      .map((c) => c.ch)
      .join('')
      .indexOf('tab  unit')
    for (let i = at - 1; i < at + 10; i++)
      Object.assign(k[i] ?? {}, { ch: ' ', fg: null, bg: null, b: false })
  }
  const rows = f.map(rowOf)
  rows[1] = header(L, [], 'Size')
  card(L, src).forEach((r, i) => {
    rows[3 + i] = r
  })
  // Compress's own refusal (SizeAside): the size in bold, then the words in plain orange.
  if (refused)
    rows[14] = [
      blank(5),
      run('2.5 MB', L.p.fg, undefined, true),
      run('  cannot compress more', L.p.larger),
    ]
  return rows
}

/* ------------------------------------------------------------ save as, working, done */

function saveAs(L: Look, answers: string[], name: string, ext: string, src: Src = VIDEO): Row[] {
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
  const rows = f.map(rowOf)
  rows[1] = header(L, answers, 'Save as')
  card(L, src).forEach((r, i) => {
    rows[3 + i] = r
  })
  rows.splice(23, 1)
  rows.splice(10, 1)
  return rows.slice(0, H)
}

function working(
  L: Look,
  answers: string[],
  label: string,
  done: number,
  total: number,
  extra?: string,
  clock = '0:24',
  src: Src = VIDEO,
): Row[] {
  const BAR = 30
  const k = Math.round((done / total) * BAR)
  const bar: Row = [
    blank(5),
    run(' '.repeat(k), undefined, L.p.trackFill),
    run(' '.repeat(BAR - k), undefined, L.p.track),
    run(`  ${t2m(done)} of ${t2m(total)}`, L.p.dim),
    ...(extra ? [run(`  ·  ${extra}`, L.p.border)] : []),
  ]
  return screen(
    [
      ...top(L, answers, 'Working', 1.4),
      ...card(L, src),
      [],
      [
        blank(2),
        ...workLine({ palette: L.p, mode: L.mode, spinner: '⠹', label, clock, width: N - 2 }),
      ],
      [],
      bar,
    ],
    keys(L, [['esc', 'stop']], 'ctrl-c quit'),
  )
}

function done(
  L: Look,
  answers: string[],
  before: { format: string; name: string; bytes: number },
  after: { format: string; name: string; bytes: number },
  notes: { offers?: string[]; warnings?: string[] } = {},
  again = 'convert another',
  offerKey?: string,
): Row[] {
  const body = doneBody({ palette: L.p, width: N - 4, facts: { mode: L.mode, before, after } }).map(
    (r) => [blank(2), ...r],
  )
  const n = doneNotes({
    palette: L.p,
    width: N - 4,
    offers: notes.offers ?? [],
    warnings: notes.warnings ?? [],
  }).map((r) => [blank(2), ...r])
  const k: [string, string][] = [
    ['↵', again],
    ['o', 'open'],
    ['s', 'show in Finder'],
  ]
  if (offerKey) k.push(['c', offerKey])
  const rows: Row[] = [...top(L, answers, 'Done'), [], [], [], ...body]
  while (rows.length < 17 - n.length) rows.push([])
  // A fourth key leaves no room for the foot.
  return screen([...rows, ...n], keys(L, k, offerKey ? '' : 'ctrl-c quit', offerKey ? 3 : 5))
}

/* ------------------------------------------------------------ sound files */

const AUDIO_FORMATS: { f: string; d: string; bytes?: number }[] = [
  { f: 'MP3', d: '128 kbps', bytes: 55.9 * MB },
  { f: 'M4A', d: 'AAC · 128 kbps', bytes: 55.9 * MB },
  { f: 'Opus', d: '96 kbps', bytes: 41.9 * MB },
  { f: 'FLAC', d: 'lossless' },
  { f: 'AIFF', d: 'as WAV', bytes: 671 * MB },
]
/**
 * Sound's Convert to is image convert's own picker (captured): a plain list,
 * the chosen row with its size and how it compares. For sound the size is
 * arithmetic (bitrate × length), so it is there at once; FLAC's would be
 * measured, as an image format's is.
 */
function soundPicker(L: Look, chosen = 'MP3'): Row[] {
  const rows = frame('target').map(rowOf)
  rows[1] = header(L, [], 'Format')
  card(L, AUDIO).forEach((r, i) => {
    rows[3 + i] = r
  })
  for (let i = 10; i < 16; i++) rows[i] = []
  AUDIO_FORMATS.forEach((f, i) => {
    const on = f.f === chosen
    const lead: Row = [run(on ? '▌' : ' ', L.p.accent), blank(1), run(f.f, L.p.fg, undefined, on)]
    if (!on) {
      rows[10 + i] = [blank(2), ...lead]
      return
    }
    const size: Row =
      f.bytes === undefined
        ? []
        : [
            run(formatBytes(f.bytes), L.p.fg, undefined, true),
            run(`  ${Math.round((1 - f.bytes / (671 * MB)) * 100)}% smaller`, L.p.ok),
          ]
    rows[10 + i] = [blank(2), ...onBand(L, [...lead, blank(31 - width(lead)), ...size], 52)]
  })
  return rows
}

/* ------------------------------------------------------------ the screens */

const T = (a: number, b: number) => `${t2s(a)}–${t2s(b)}`

/* ---- convert */

const V1 = () => home(CONVERT, VIDEO)
const V2 = () => formatTiles(CONVERT)
const V3 = () => saveAs(CONVERT, ['MP4'], REC, '.mp4')
const V4 = () =>
  working(
    CONVERT,
    ['MP4', 'Desktop', `${REC}.mp4`],
    'Converting to H.264',
    74,
    DUR,
    'about 20 s left',
    '0:31',
  )
const V5 = () =>
  done(
    CONVERT,
    ['MP4', 'Desktop', `${REC}.mp4`],
    { format: 'MOV', name: VIDEO.name, bytes: 184 * MB },
    { format: 'MP4', name: `${REC}.mp4`, bytes: 38.6 * MB },
  )

/* ---- compress */

const C1 = () => home(COMPRESS, VIDEO)
const C2 = () => method(COMPRESS)
const C3 = () => targetTyped(COMPRESS, '10mb', false)
const C4 = () => saveAs(COMPRESS, ['To a target size', '10 MB'], `${REC}-small`, '.mov')
const C5 = () =>
  working(
    COMPRESS,
    ['10 MB', 'Desktop', `${REC}-small.mov`],
    'Pass 2 of 2 · compressing',
    41,
    DUR,
    'about 50 s left',
    '0:38',
  )
const C6 = () =>
  done(
    COMPRESS,
    ['10 MB', 'Desktop', `${REC}-small.mov`],
    { format: 'MOV', name: VIDEO.name, bytes: 184 * MB },
    { format: 'MOV', name: `${REC}-small.mov`, bytes: 9.7 * MB },
    { warnings: ['To fit 10 MB it is now 1280×832 at 24 fps.'] },
    'compress again',
  )
const CX = () => targetTyped(COMPRESS, '1mb', true)
const CK = () => targetTyped(COMPRESS, '400kb', false, ['KB', 'MB'], CLIP)

/* ---- edit */

const VIDEO_TOOLS: (ERow | null)[] = [
  {
    name: 'Trim',
    pane: ['Cuts off the start and the end.', 'Copied, not re-encoded, so it takes seconds.'],
  },
  { name: 'Mute', pane: ['Takes the sound out.', 'The picture is copied as it is.'] },
  null,
  { name: 'Resize', pane: ['Makes the picture smaller.', 'Steps to 1080p, 720p and 480p.'] },
  { name: 'Crop to shape', pane: ['Cuts the picture to a shape.', '16:9, 9:16, 1:1 and 4:5.'] },
]
const TRIMMED = {
  ...VIDEO,
  name: `${REC}-trimmed.mov`,
  facts: '0:37.8 · 2940×1912 · 60 fps · 53.4 MB',
}
const E1 = () => home(EDIT, VIDEO)
const E2 = () => editPicker(EDIT, VIDEO, VIDEO_TOOLS, 'Trim')
const E3 = () => lengthStep(EDIT, 'start')
const E4 = () => lengthStep(EDIT, 'end')
const E4B = () => lengthStep(EDIT, 'both', 13.2, 51.0)
const E4T = () => lengthStep(EDIT, 'end', A, B, ['Trim'], 'Trim', false, '10 s')
const E5 = () => saveAs(EDIT, ['Trim', T(A, B)], `${REC}-trimmed`, '.mov')
const E6 = () =>
  done(
    EDIT,
    ['Trim', 'Desktop', `${REC}-trimmed.mov`],
    { format: 'MOV', name: VIDEO.name, bytes: 184 * MB },
    { format: 'MOV', name: TRIMMED.name, bytes: 53.4 * MB },
    { warnings: ['It starts at 0:02.9, the keyframe just before 0:03.2.'] },
    'edit another',
    'compress it',
  )
const E7 = () => method(COMPRESS, TRIMMED)

/* ---- GIF */

const GA = 12.0
const GB = 19.5
const G1 = () => formatTiles(CONVERT, 'GIF')
const G2 = () => lengthStep(CONVERT, 'start', GA, GB, ['GIF'], 'GIF')
const G2L = () => lengthStep(CONVERT, 'end', GA, 38.0, ['GIF'], 'GIF', true)
const G3 = () =>
  done(
    CONVERT,
    ['GIF', T(GA, GB), 'Desktop', `${REC}.gif`],
    { format: 'MOV', name: VIDEO.name, bytes: 184 * MB },
    { format: 'GIF', name: `${REC}.gif`, bytes: 4.8 * MB },
    { offers: ['✧ WebP would be 1.1 MB, 77% smaller again.'] },
    'convert another',
    'WebP',
  )

/* ---- sound files */

const AUDIO_TOOLS: (ERow | null)[] = [
  { name: 'Trim', pane: ['Cuts off the start and the end.', 'Copied, not re-encoded.'] },
  {
    name: 'Even out loudness',
    pane: ['Brings the sound to one steady level.', 'The level podcasts use.', '−31 LUFS now'],
  },
]
const A1 = () => home(CONVERT, AUDIO)
const A2 = () => soundPicker(CONVERT)
const A3 = () => bitrate(CONVERT, ['MP3'], 'MP3')
const A4 = () =>
  done(
    CONVERT,
    ['MP3', '128 kbps', 'Desktop', `${POD}.mp3`],
    { format: 'WAV', name: AUDIO.name, bytes: 671 * MB },
    { format: 'MP3', name: `${POD}.mp3`, bytes: 55.9 * MB },
  )
const A5 = () => editPicker(EDIT, AUDIO, AUDIO_TOOLS, 'Even out loudness')

/* ---- first time: installed in place, as Boost is */

const VIDEO_UNKNOWN = { ...VIDEO, facts: 'video · 184 MB' }
const BYTE_BAND = 12
function firstTime(L: Look, state: 'offer' | 'bytes' | 'checking'): Row[] {
  const total = 31.4
  const got = 12.6
  const k = Math.round((got / total) * BYTE_BAND)
  const detail: Run[] =
    state === 'offer'
      ? [run(`${total} MB download · `, L.p.dim), run('↵ installs', L.p.fg)]
      : state === 'bytes'
        ? [
            run(' '.repeat(k), undefined, L.p.trackFill),
            run(' '.repeat(BYTE_BAND - k), undefined, L.p.track),
            blank(2),
            run(String(got), L.p.fg, undefined, true),
            run(` of ${total} MB`, L.p.dim),
          ]
        : [run('checking', L.p.dim)]
  const rows = formatTiles(L, 'MP4', detail, VIDEO_UNKNOWN)
  return [
    ...rows.slice(0, H - 2),
    ...keys(
      L,
      state === 'offer'
        ? [
            ['↑↓←→', 'choose'],
            ['↵', 'install'],
          ]
        : [['esc', 'cancel']],
      state === 'offer' ? 'esc back · ctrl-c quit' : 'ctrl-c quit',
    ),
  ]
}

/* ---- command line */

const prompt = (L: Look, cmd: string): Row => [run('~ % ', L.p.dim), run(cmd, L.p.fg)]
function cli(L: Look): Row[] {
  const ok = (name: string, sizes: string): Row => [
    run('✓ ', L.p.ok, undefined, true),
    run(name.padEnd(30), L.p.fg),
    run(sizes, L.p.dim),
  ]
  return [
    prompt(L, 'forge rec.mov --to mp4'),
    ok('rec.mp4', '184 MB → 38.6 MB · 79% smaller'),
    [],
    prompt(L, 'forge rec.mov --max-size 10mb'),
    ok('rec-small.mov', '184 MB → 9.7 MB · 95% smaller'),
    [run('  ⚠ To fit 10 MB it is now 1280×832 at 24 fps.', L.p.warn)],
    [],
    prompt(L, 'forge rec.mov --max-size 1mb'),
    [
      run('  ', L.p.fail, undefined, true),
      run('2.5 MB', L.p.fg, undefined, true),
      run('  cannot compress more', L.p.larger),
    ],
    [],
    [run('# only here, never in the app:', L.p.border)],
    prompt(L, 'forge rec.mov --speed 2 --fps 30 --mute'),
    prompt(L, 'forge talk.mp4 --frame 1:02 --to png'),
    prompt(L, 'forge episode.wav --to mp3 --bitrate 96k --loudness -14'),
  ]
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
  draw: () => Row[]
  short?: boolean
}
const figure = (f: Fig) =>
  `<figure><div class="vt"><span class="id">${f.id}</span><span class="name">${f.name}</span></div>${html(f.draw(), f.short)}<p class="idea">${f.note}</p></figure>`
const flow = (figs: Fig[]) =>
  `<div class="flow">${figs.map(figure).join('<div class="arrow">→</div>')}</div>`

const CONVERT_FLOW: Fig[] = [
  {
    id: '1',
    name: 'Drop it in convert',
    note: 'Like an image. The card shows length, size, frame rate and bytes.',
    draw: V1,
  },
  {
    id: '2',
    name: 'Convert to',
    note: 'Two boxes, video (GIF with them) and sound only; the one you are in is in the mode’s colour. ←→ moves between boxes, ↑↓ within. The chosen format’s codecs underneath. Codec, frame rate and HDR are Forge’s choice, never asked.',
    draw: V2,
  },
  { id: '3', name: 'Save as', note: 'Unchanged.', draw: V3 },
  {
    id: '4',
    name: 'Working',
    note: 'A video has a true length, so it gets a true bar. When the video inside is already H.264, MP4 is a copy and this is over in seconds.',
    draw: V4,
  },
  { id: '5', name: 'Done', note: 'Unchanged.', draw: V5 },
]
const COMPRESS_FLOW: Fig[] = [
  { id: '1', name: 'Drop it in compress', note: '', draw: C1 },
  { id: '2', name: 'Method', note: 'The same two ways.', draw: C2 },
  {
    id: '3',
    name: 'Target size',
    note: 'The same field: the whole file, sound included.',
    draw: C3,
  },
  { id: '4', name: 'Save as', note: '-small, as today.', draw: C4 },
  {
    id: '5',
    name: 'Working',
    note: 'Two passes so 10 MB lands under 10 MB; each pass has its own true bar.',
    draw: C5,
  },
  {
    id: '6',
    name: 'Done',
    note: 'Forge picks the picture size and frame rate it takes to fit, and says so here in one line.',
    draw: C6,
  },
]
const COMPRESS_NO: Fig[] = [
  {
    id: '3·b',
    name: 'Too small for this video',
    note: 'Forge works out the smallest this video can get before encoding anything (the smallest picture and frame rate that still read). Below that, the field says so as you type, the way compress already does: the smallest size, then <b>cannot compress more</b> in plain orange. For this 2:10 recording that is about 2.5 MB; for an hour-long talk about 70 MB. Only MB is offered: nothing under 1 MB is possible, and B never is.',
    draw: CX,
  },
  {
    id: '3·c',
    name: 'A short clip: KB is back',
    note: 'A 6-second clip can get to about 120 KB, so KB is offered. The units are the ones between the smallest the video can get and its size now: B never, KB only when it can go under 1 MB, GB only for a file over 1 GB.',
    draw: CK,
  },
]
const EDIT_MOVE: Fig[] = [
  {
    id: '4·b',
    name: 'space: the range',
    note: 'space chooses the range, both ends at once: both chips, both handles and both times light, and ←→ slides it, its length kept (here 0:37.8, ten seconds later). I or O goes back to one end; tab cycles start → end → range.',
    draw: E4B,
  },
  {
    id: '4·c',
    name: 'A bigger step',
    note: '<b>[ ]</b> steps the pill at the title’s end: 1 s · 5 s · 10 s · 30 s · 1 min · 5 min · 10 min · 30 min, but only the ones up to about a quarter of the video (this 2:10 recording gets 1 s to 30 s; an hour-long podcast all eight). Every ←→ then moves that far. No modifier to hold, so it works the same in every terminal.',
    draw: E4T,
  },
]
const EDIT_FLOW: Fig[] = [
  { id: '1', name: 'Drop it in edit', note: '', draw: E1 },
  {
    id: '2',
    name: 'The tools',
    note: 'Edit’s split view, with the video tools: Trim and Mute, then Resize and Crop to shape. One tool per run, as for images. Mute is missing when there is no sound.',
    draw: E2,
  },
  {
    id: '3',
    name: 'Trim · the start',
    note: 'The sound as peaks, white where it is kept and grey where it is cut, to find the pause before you start talking. The bar: kept in the mode’s fill, cut in grey. Choose what moves, then move it: <b>I</b> the start, <b>O</b> the end (the in and out keys every editor uses), <b>space</b> the range (both ends); <b>←→</b> moves it by the <b>step</b> (1 s to start). The times are fields above the key row; <b>tab</b> (far right) cycles start → end → range; type <b>0:41</b> and the chosen end goes there.',
    draw: E3,
  },
  { id: '4', name: 'Trim · the end', note: 'O took the end.', draw: E4 },
  { id: '5', name: 'Save as', note: '-trimmed.', draw: E5 },
  {
    id: '6',
    name: 'Done',
    note: 'Trim copies, so it can only start on a keyframe; when that moved the start, Done says where. <b>c compress it</b> sends the trimmed file straight into compress.',
    draw: E6,
  },
  {
    id: '7',
    name: '…and into compress',
    note: 'Compress’s Method, the trimmed file already on the card. Two short runs, one real encode.',
    draw: E7,
  },
]
const GIF_LONG: Fig[] = [
  {
    id: '2·b',
    name: 'Too long for a GIF',
    note: 'Past 15 s the kept part of the bar turns orange (the colour Done uses for a file that grew), and the note <b>GIF might be too large</b> sits beside the times, in the same orange: a GIF that long is over 10 MB, too big for GitHub, Discord and most chat. It can still be made. 15 s is a length rule, not a size guess.',
    draw: G2L,
  },
]
const GIF_FLOW: Fig[] = [
  { id: '1', name: 'Convert to · GIF', note: '', draw: G1 },
  {
    id: '2',
    name: 'Which part',
    note: 'A GIF of a whole recording is huge, so GIF opens Trim’s screen once. Width and frame rate are Forge’s choice (800 px, 15 fps).',
    draw: G2,
  },
  { id: '3', name: 'Done', note: 'The WebP size, measured. <b>c</b> makes it.', draw: G3 },
]
const SOUND_FLOW: Fig[] = [
  { id: '1', name: 'Drop a sound file', note: 'Same modes, same places.', draw: A1 },
  {
    id: '2',
    name: 'Convert to',
    note: 'Image convert’s own picker. The chosen row has its size, as an image format’s does; for sound it is arithmetic (bitrate × length), so it is there at once.',
    draw: A2,
  },
  { id: '3', name: 'Quality', note: 'The quality slider in kbps, the size under it.', draw: A3 },
  { id: '4', name: 'Done', note: '', draw: A4 },
]
const SOUND_MORE: Fig[] = [
  {
    id: 'E',
    name: 'Edit for sound',
    note: 'Trim and Even out loudness (to −16, the podcast level; other levels are a CLI flag).',
    draw: A5,
  },
]
const FIRST_FLOW: Fig[] = [
  {
    id: '1',
    name: 'No ffmpeg yet',
    note: 'The format you are on says what it needs, as Boost’s row does. If Homebrew’s ffmpeg is there, none of this appears.',
    draw: () => firstTime(CONVERT, 'offer'),
  },
  {
    id: '2',
    name: 'Installing',
    note: 'The byte band, real bytes.',
    draw: () => firstTime(CONVERT, 'bytes'),
  },
  {
    id: '3',
    name: 'Checking',
    note: 'Then on to Save as.',
    draw: () => firstTime(CONVERT, 'checking'),
  },
]
const CLI_FIGS: Fig[] = [
  {
    id: 'CLI',
    name: 'The same jobs, plus the extras',
    note: 'Everything the app does, as flags. Speed, frame rate, bitrate, loudness level and saving a frame live only here.',
    draw: () => cli(CONVERT),
    short: true,
  },
]

const DECIDED = [
  '<b>The mode is the job.</b> Convert changes the format, compress makes it smaller, edit cuts or mutes. A video goes where an image would.',
  '<b>Forge picks the technical things:</b> codec, frame rate, the picture size needed to fit, HDR, copy or re-encode.',
  '<b>Extras only on the command line:</b> speed, frame rate, bitrate, loudness level, saving a frame.',
  '<b>Two jobs = two runs:</b> Done’s <b>c</b> key sends the result into the next mode.',
  '<b>Installed in place</b>, as Boost is. <b>Trim:</b> filled bar, sound as peaks; I and O for start and end, space for the range, a step picker.',
]
const QUESTIONS = [
  '<b>GIF</b> opens the Trim screen once (GIF, 2). OK, or no extra step?',
  '<b>Animated WebP</b> is out of the list. Keep it as GIF Done’s measured offer (GIF, 3), or drop it entirely?',
  '<b>Done’s key</b> after Trim: <b>c compress it</b>. OK? (After compress or convert, no next-job key.)',
  '<b>ffmpeg:</b> Homebrew’s when it is there, else the download (my pick)? Or always the download?',
  '<b>Progress:</b> a real bar and “about 20 s left” for video and sound, as an exception to invariant 7?',
  '<b>Trim copies</b> (seconds, lossless, the start can land up to ~2 s early) or <b>re-encodes</b> (exact, slower)?',
  '<b>Words to approve:</b> the box names <b>video, sound only</b>; GIF’s detail <b>256 colours · no sound</b>; the tool panes (Trim, Mute, Resize, Crop to shape, Even out loudness); <b>2.5 MB cannot compress more</b> (compress’s existing words); <b>To fit 10 MB it is now 1280×832 at 24 fps.</b>; <b>It starts at 0:02.9, the keyframe just before 0:03.2.</b>; the key <b>compress it</b>.',
]

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · video and sound · round 3</title>
<style>
  :root { --page:#0d0e11; --ink:#e2e4ea; --muted:#8f94a1; --rule:#23252c; --cyan:#55c7d9; --mono:"SF Mono", ui-monospace, Menlo, monospace; --sans:-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--page); color:var(--ink); font:16px/1.6 var(--sans); }
  main { max-width:2300px; margin:0 auto; padding:44px 24px 120px; }
  h1 { font-size:32px; margin:0 0 8px; }
  h2 { font-size:15px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); margin:36px 0 0; }
  h2 b { color:var(--ink); }
  .lede { color:#c7cbd4; max-width:1000px; margin:0; }
  .status { display:inline-block; margin:16px 0 0; font:600 12px var(--mono); letter-spacing:.08em; color:#e8c46d; border:1px solid #5a4a2c; padding:3px 9px; border-radius:6px; }
  .qs { max-width:1100px; margin:18px 0 0; padding:16px 20px 16px 40px; border:1px solid var(--rule); border-radius:10px; background:#121318; }
  .qs li { margin:6px 0; color:#c7cbd4; } .qs li b { color:var(--ink); }
  .qs.done { border-color:#2c5a37; } .qs.done li::marker { color:#6fcf7f; }
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
</style></head>
<body><main>
<h1>Video and sound · round 3</h1>
<p class="lede">Video and sound work exactly like images: convert changes the format, compress makes it smaller, edit cuts or mutes. Home, Method, the size field and Save as are captured from the app at 80 × 24; the rest is drawn with the app’s own art functions.</p>
<span class="status">OPEN · ROUND 3</span>
<h2>Decided</h2>
<ol class="qs done">${DECIDED.map((q) => `<li>${q}</li>`).join('')}</ol>
<h2>Questions for you</h2>
<ol class="qs">${QUESTIONS.map((q) => `<li>${q}</li>`).join('')}</ol>
<div class="tabs"><a data-t="convert" class="on">Convert</a><a data-t="compress">Compress</a><a data-t="edit">Edit · Trim</a><a data-t="gif">GIF</a><a data-t="sound">Sound files</a><a data-t="first">First time</a><a data-t="cli">Command line</a></div>
<section id="s-convert" class="on"><h2><b>FLOW</b> · MOV to MP4</h2>${flow(CONVERT_FLOW)}</section>
<section id="s-compress"><h2><b>FLOW</b> · under 10 MB</h2>${flow(COMPRESS_FLOW)}<h2><b>WHEN IT REFUSES</b></h2>${flow(COMPRESS_NO)}</section>
<section id="s-edit"><h2><b>FLOW</b> · cut the dead seconds, then shrink it</h2>${flow(EDIT_FLOW)}<h2><b>MOVING</b></h2>${flow(EDIT_MOVE)}</section>
<section id="s-gif"><h2><b>FLOW</b> · seven seconds as a GIF</h2>${flow(GIF_FLOW)}<h2><b>TOO LONG</b></h2>${flow(GIF_LONG)}</section>
<section id="s-sound"><h2><b>FLOW</b> · a podcast WAV to MP3</h2>${flow(SOUND_FLOW)}<h2><b>SCREEN</b></h2>${flow(SOUND_MORE)}</section>
<section id="s-first"><h2><b>FLOW</b> · no ffmpeg on this Mac yet</h2>${flow(FIRST_FLOW)}</section>
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
  document.querySelectorAll('h2, .arrow').forEach((e) => e.remove())
  document.querySelectorAll('#s-' + t + ' figure').forEach((f, k) => { if (String(k) !== i) f.remove() })
  document.querySelector('main').style.padding = '0 16px'
}
</script></body></html>`

const out = new URL('../mockups/video-2026-10-round3.html', import.meta.url)
writeFileSync(out, page)
console.log('wrote', decodeURIComponent(out.pathname), page.length)
