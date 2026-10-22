/**
 * Transcribe, round three (2026-10-22). The user asked for three things:
 * "Writing notes" on its own row under "Transcribing", with squares instead
 * of dots; the clock in minutes once a job passes a minute; and a choice of
 * output format (.md today; .docx, .pdf, .txt asked for). Cells are the real
 * app's at 80 × 24, dark (scripts/transcribe-r3-capture.tsx), with only the
 * rows in question redrawn.
 *
 *   FORCE_COLOR=3 FORGE_NO_FIND=1 npx tsx scripts/transcribe-r3-capture.tsx
 *   npx tsx scripts/transcribe-r3-mockup.ts → mockups/transcribe-2026-10-round3.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { blank, mix, type Row, type Run } from '../src/shell/home-art.js'
import { DARK, modePalette } from '../src/shell/theme.js'
import { pagesRow } from '../src/shell/working-art.js'
import { feedbackPage, type PageConcept } from './feedback-page.js'
import { type Cell, cellsOf, type Grid, gridHtml, run, termHtml, toGrid } from './term-cells.js'

const W = 80
const p = modePalette(DARK, 'transcribe')
const RED = '#e63946'
const CANVAS = '#1e1e1e'
const NOW = mix(RED, CANVAS, 0.55)
const SELECT = '#323232'
const PILL = '#414141'
const FIELD = '#2c2c2c'
const FIELD_TINT = '#3a1a1d'

type Raw = { ch: string; fg: string | null; bg: string | null; b: boolean }
const RAW = JSON.parse(readFileSync('/tmp/forge-transcribe-r3/frames.json', 'utf8')) as Record<
  string,
  Raw[][]
>
const frame = (name: string): Grid =>
  (RAW[name] ?? []).map((r) =>
    r.map((c) => ({ ch: c.ch, fg: c.fg ?? undefined, bg: c.bg ?? undefined, b: c.b })),
  )

/* ------------------------------------------------------------ patching */

const text = (cells: Cell[]) => cells.map((c) => c.ch).join('')
/** `from` swapped for `to` (the same width) in row `r`, each cell keeping its style. */
function swap(g: Grid, r: number, from: string, to: string, fg?: string) {
  const row = g[r] as Cell[]
  const at = text(row).indexOf(from)
  if (at < 0) throw new Error(`not found on row ${r}: ${from}`)
  if ([...to].length !== [...from].length) throw new Error(`widths differ: ${from} / ${to}`)
  const style = row[at] as Cell
  ;[...to].forEach((ch, i) => {
    const c = row[at + i] as Cell
    row[at + i] = { ...c, ch, fg: fg ?? c.fg ?? style.fg }
  })
}
const setRow = (g: Grid, r: number, row: Row) => {
  g[r] = toGrid([row], W)[0] as Cell[]
}
const clearRows = (g: Grid, from: number, to: number) => {
  for (let r = from; r <= to; r++) setRow(g, r, [])
}

/** The header bar's hatching colour at each column, gathered from every captured bar. */
const HATCH: (string | undefined)[] = (() => {
  const out: (string | undefined)[] = Array(W).fill(undefined)
  for (const g of Object.values(RAW))
    (g[1] ?? []).forEach((c, i) => {
      if (c.ch === '╱' && c.fg && !out[i]) out[i] = c.fg
    })
  let last = -1
  for (let i = 0; i < W; i++) {
    if (!out[i]) continue
    if (last >= 0)
      for (let j = last + 1; j < i; j++)
        out[j] = mix(out[last] as string, out[i] as string, (j - last) / (i - last))
    last = i
  }
  return out
})()

/** The header bar's trail: the answers, then the current step in bold, right-aligned. */
function trail(g: Grid, answers: string[], current: string) {
  const row = g[1] as Cell[]
  const from = 16
  const end = 76
  const words: Run[] = [
    ...answers.flatMap((a) => [run(` ${a} `, p.dim), run('╱')]),
    run(` ${current} `, p.fg, undefined, true),
    run('╱╱'),
  ]
  const cells = cellsOf(words)
  const start = end - cells.length
  for (let i = from; i < end; i++) row[i] = { ch: '╱', fg: HATCH[i], bg: CANVAS }
  cells.forEach((c, i) => {
    row[start + i] = c.ch === '╱' ? { ch: '╱', fg: HATCH[start + i], bg: CANVAS } : { ...c, bg: CANVAS }
  })
}

/** A key row: caps on the left, quiet keys on the right, as the app draws it. */
function keyRow(left: [string, string][], right: [string, string][]): Row {
  const l: Run[] = left.flatMap(([k, w], i) => [
    ...(i ? [blank(2)] : []),
    run(` ${k} `, p.fg, p.keycapBg, true),
    run(` ${w}`, p.dim),
  ])
  const r: Run[] = right.flatMap(([k, w], i) => [
    ...(i ? [run(' · ', p.border)] : []),
    run(k, p.fg),
    ...(w ? [run(` ${w}`, p.border)] : []),
  ])
  const lw = cellsOf(l).length
  const rw = cellsOf(r).length
  return [blank(4), ...l, blank(Math.max(1, 72 - lw - rw)), ...r]
}
/** The key row: the last row of a screen. */
const keysOf = (g: Grid) => g.length - 1

/** The card's size: the stand-in file is 16 bytes. */
const realSize = (g: Grid) => swap(g, 5, '16 B  ', '212 MB', p.dim)

/* ------------------------------------------------------------ working */

const LEAD = 4
const END = LEAD + 64

/** A step's line: its mark (spinner, ✓, or none), its name, its own clock at the line's end. */
function stepLine(
  state: 'now' | 'done' | 'later',
  label: string,
  clock = '',
  count: Run[] = [],
): Row {
  const mark =
    state === 'now'
      ? run('⠹', RED, undefined, true)
      : state === 'done'
        ? run('✓', p.ok, undefined, true)
        : run(' ')
  const name =
    state === 'now'
      ? run(label, p.fg, undefined, true)
      : state === 'done'
        ? run(label, p.fg)
        : run(label, p.faint)
  const head: Run[] = [blank(LEAD), mark, blank(1), name, ...count]
  const used = cellsOf(head).length
  return clock ? [...head, blank(Math.max(1, END - used - clock.length)), run(clock, p.border)] : head
}

const HEARD = 2890
const LENGTH = 3717
const clockOf = (s: number) =>
  s >= 3600
    ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

const heardBar = (done: number) =>
  pagesRow({ palette: p, mode: 'transcribe', done, total: LENGTH, says: `${clockOf(done)} of ${clockOf(LENGTH)}` })

const PARTS = 5
const DONE = 2 // part 3 is being written
const said = (done: number) => run(`  ${done} of ${PARTS} parts`, p.dim)
const cellAt = (i: number) => (i < DONE ? RED : i === DONE ? NOW : p.track)

/** W1, the user's idea: a small square per part. */
const smallSquares = (known: boolean): Row =>
  known
    ? [
        blank(LEAD + 2),
        ...Array.from({ length: PARTS }, (_, i) => run('■ ', i < DONE ? RED : i === DONE ? NOW : p.faint)),
        said(DONE),
      ]
    : []
/** W2: the page bar's thirty cells, cut into one segment per part. */
const segmented = (known: boolean): Row => {
  if (!known) return []
  const gaps = PARTS - 1
  const base = Math.floor((30 - gaps) / PARTS)
  const extra = 30 - gaps - base * PARTS
  const runs: Run[] = []
  for (let i = 0; i < PARTS; i++) {
    if (i) runs.push(blank(1))
    runs.push(run('█'.repeat(base + (i < extra ? 1 : 0)), cellAt(i)))
  }
  return [blank(LEAD + 2), ...runs, said(DONE)]
}
/** W3: a square of two cells per part — a terminal cell is half as wide as it is tall. */
const bigSquares = (known: boolean): Row =>
  known
    ? [
        blank(LEAD + 2),
        ...Array.from({ length: PARTS }, (_, i) => [run('██', cellAt(i)), blank(1)]).flat(),
        run(` ${DONE} of ${PARTS} parts`, p.dim),
      ]
    : []

type Variant = {
  id: string
  name: string
  idea: string
  /** Rows from the working line down: while transcribing, then while writing notes. */
  heard: Row[]
  notes: Row[]
}

const T1 = { heard: '58.4s', took: '1m 08s', notes: '18.2s' }
const full = heardBar(LENGTH)

const VARIANTS: Variant[] = [
  {
    id: 'W1',
    name: 'Your idea: two steps, small squares',
    idea: 'Writing notes waits faint under Transcribing until its parts are known. Each step keeps its own clock. A square per part: red when written, half red while it is being written, grey for the rest.',
    heard: [stepLine('now', 'Transcribing', T1.heard), [], heardBar(HEARD), [], stepLine('later', 'Writing notes')],
    notes: [
      stepLine('done', 'Transcribing', T1.took),
      [],
      full,
      [],
      stepLine('now', 'Writing notes', T1.notes),
      [],
      smallSquares(true),
    ],
  },
  {
    id: 'W2',
    name: 'The bar, cut into parts',
    idea: 'The notes bar is the transcribing bar’s own thirty cells, cut into one segment per part, so the two bars line up and read as one kind of thing.',
    heard: [stepLine('now', 'Transcribing', T1.heard), [], heardBar(HEARD), [], stepLine('later', 'Writing notes')],
    notes: [
      stepLine('done', 'Transcribing', T1.took),
      [],
      full,
      [],
      stepLine('now', 'Writing notes', T1.notes),
      [],
      segmented(true),
    ],
  },
  {
    id: 'W3',
    name: 'Big squares',
    idea: 'Two cells per part make a true square (a terminal cell is twice as tall as it is wide), drawn solid like the bar above.',
    heard: [stepLine('now', 'Transcribing', T1.heard), [], heardBar(HEARD), [], stepLine('later', 'Writing notes')],
    notes: [
      stepLine('done', 'Transcribing', T1.took),
      [],
      full,
      [],
      stepLine('now', 'Writing notes', T1.notes),
      [],
      bigSquares(true),
    ],
  },
  {
    id: 'W4',
    name: 'A finished step folds to one line',
    idea: 'Once transcribing is done its bar goes; the ✓ line keeps the length and the time it took. Only the step still running has a bar.',
    heard: [stepLine('now', 'Transcribing', T1.heard), [], heardBar(HEARD), [], stepLine('later', 'Writing notes')],
    notes: [
      stepLine('done', 'Transcribing', T1.took, [run(`   ${clockOf(LENGTH)}`, p.dim)]),
      [],
      stepLine('now', 'Writing notes', T1.notes),
      [],
      segmented(true),
    ],
  },
  {
    id: 'W5',
    name: 'Two lines, no bars',
    idea: 'The least: each step is one line with its count beside its name. Nothing grows, so it says less about how far along it is.',
    heard: [
      stepLine('now', 'Transcribing', T1.heard, [run(`   ${clockOf(HEARD)} of ${clockOf(LENGTH)}`, p.dim)]),
      [],
      stepLine('later', 'Writing notes'),
    ],
    notes: [
      stepLine('done', 'Transcribing', T1.took, [run(`   ${clockOf(LENGTH)}`, p.dim)]),
      [],
      stepLine('now', 'Writing notes', T1.notes, [run(`   part ${DONE + 1} of ${PARTS}`, p.dim)]),
    ],
  },
]

/** The real Working screen, its rows from the working line down replaced. */
function working(name: 'heard' | 'notes', rows: Row[]): Grid {
  const g = frame(name)
  realSize(g)
  trail(g, ['Desktop', 'influence-talk.md'], name === 'heard' ? 'Transcribing' : 'Writing notes')
  clearRows(g, 8, 21)
  rows.forEach((r, i) => setRow(g, 8 + i, r))
  // Both steps can be stopped, and nothing is written until the end.
  setRow(g, keysOf(g), keyRow([['esc', 'stop']], [['nothing is saved until it is done', ''], ['ctrl-c', 'quit']]))
  return g
}

/** █ as a terminal draws it: the whole cell, no seam between neighbours. */
const solidify = (g: Grid): Grid =>
  g.map((r) => r.map((c) => (c.ch === '█' ? { ch: ' ', bg: c.fg, fg: c.fg } : c)))

/** Rows 0–`to`, then the key row's two, with a cut between. */
function cropped(g: Grid, to: number): string {
  if (to >= keysOf(g) - 2) return termHtml(DARK, solidify(g), CANVAS)
  const top = solidify(g.slice(0, to + 1))
  const foot = g.slice(keysOf(g) - 1)
  return `<div class="t" style="background:${CANVAS}">${gridHtml(top, DARK)}<div class="cut"></div>${gridHtml(foot, DARK)}</div>`
}
const pair = (a: string, b: string, la: string, lb: string) =>
  `<div class="stack"><div class="cap">${la}</div>${a}<div class="cap">${lb}</div>${b}</div>`

/* ------------------------------------------------------------ clock */

const CLOCKS: { id: string; name: string; idea: string; say: (s: number) => string }[] = [
  {
    id: 'T1',
    name: 'Minutes and seconds',
    idea: '“4m 12s”, and “1h 03m” past an hour. Under a minute it stays as today: “42.3s”.',
    say: (s) => (s < 60 ? `${s.toFixed(1)}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(Math.floor(s % 60)).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`),
  },
  {
    id: 'T2',
    name: 'A stopwatch',
    idea: '“4:12”, and “1:03:20” past an hour — the way the card and the bar already write lengths.',
    say: (s) => (s < 60 ? `${s.toFixed(1)}s` : clockOf(Math.floor(s))),
  },
  {
    id: 'T3',
    name: 'Whole minutes',
    idea: '“4 min”, as “about 4 min left” already says on video. Calmer: it changes once a minute.',
    say: (s) => (s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)} min`),
  },
]
const clockStrip = (say: (s: number) => string) =>
  `<div class="t s" style="background:${CANVAS}">${gridHtml(
    toGrid(
      [42.3, 252, 3800].map((s) => stepLine('now', 'Transcribing', say(s))),
      72,
    ),
    DARK,
  )}</div>`

/* ------------------------------------------------------------ format */

const FORMATS = [
  ['Markdown', '.md'],
  ['Word', '.docx'],
  ['PDF', '.pdf'],
  ['Text', '.txt'],
] as const
const WANTS = [
  ['All', 'summary, notes and transcript'],
  ['Notes', 'summary and notes'],
  ['Transcript', ''],
] as const

/** A picker row as the app's Select draws it: the hint and any pill only on the selected row. */
function pick(label: string, on: boolean, hint = '', pill = '', col = 18, quiet = false): Row {
  if (!on)
    return [blank(6), run(label, quiet ? p.dim : p.fg, undefined, quiet), ...(quiet ? [] : [])]
  const head: Run[] = [
    blank(4),
    run('▌', RED, SELECT),
    run(' ', undefined, SELECT),
    run(label, p.fg, SELECT, true),
    run(' '.repeat(Math.max(1, col - 6 - label.length)), undefined, SELECT),
    run(hint, p.dim, SELECT),
  ]
  const used = cellsOf(head).length
  if (!pill) return [...head, run(' '.repeat(76 - used), undefined, SELECT)]
  const pillRuns: Run[] = [
    run(' ', undefined, PILL),
    run('‹', RED, PILL, true),
    run(' ', undefined, PILL),
    run(pill, p.fg, PILL, true),
    run(' ', undefined, PILL),
    run('›', RED, PILL, true),
    run(' ', undefined, PILL),
  ]
  const pw = cellsOf(pillRuns).length
  return [...head, run(' '.repeat(74 - used - pw), undefined, SELECT), ...pillRuns, run('  ', undefined, SELECT)]
}
/** The inactive group's choice: kept, marked, not highlighted. */
const kept = (label: string): Row => [blank(4), run('▌', p.border), blank(1), run(label, p.fg, undefined, true)]
const title = (t: string): Row => [blank(4), run(t, RED, undefined, true)]

function chooseScreen(rows: Row[], keys: Row, answers: string[] = [], current = 'Transcribe to'): Grid {
  const g = frame('choose')
  realSize(g)
  trail(g, answers, current)
  clearRows(g, 8, 21)
  rows.forEach((r, i) => setRow(g, 8 + i, r))
  setRow(g, keysOf(g), keys)
  return g
}
const BACK: [string, string][] = [
  ['esc', 'back'],
  ['ctrl-c', 'quit'],
]
const wantRows = (pillOn = true, hintFull = false) => [
  title('Transcribe to'),
  pick('All', true, hintFull ? 'summary, notes and transcript · .md' : 'summary, notes and transcript', pillOn ? 'Standard' : ''),
  pick('Notes', false),
  pick('Transcript', false),
]

function saveAs(ext: string, answers: string[], pill = false, keys?: Row): Grid {
  const g = frame('saveAs')
  realSize(g)
  trail(g, answers, 'Save as')
  swap(g, 12, '.md  ', ext.padEnd(5))
  if (pill) {
    const row = g[12] as Cell[]
    const at = text(row).indexOf(ext)
    const runs: Run[] = [
      run(' ', undefined, PILL),
      run('‹', RED, PILL, true),
      run(' ', undefined, PILL),
      run(ext, p.fg, PILL, true),
      run(' ', undefined, PILL),
      run('›', RED, PILL, true),
      run(' ', undefined, PILL),
    ]
    cellsOf(runs).forEach((c, i) => {
      row[at - 1 + i] = c
    })
  }
  // The stand-in's temp folder, as the folder the user would see.
  const to = g[16] as Cell[]
  const at = text(to).indexOf('forge-test')
  const end = text(to).indexOf('default') - 2
  for (let i = at; i < end; i++) to[i] = { ...(to[i] as Cell), ch: ' ' }
  'Desktop'.split('').forEach((ch, i) => {
    to[at + i] = { ...(to[at] as Cell), ch, fg: p.fg, b: true }
  })
  swap(g, 17, 'Desktop  ', 'Documents', p.fg)
  if (keys) setRow(g, keysOf(g), keys)
  return g
}

const formatRows = (on: number) => [
  title('Format'),
  ...FORMATS.map(([l, e], i) => pick(l, i === on, e)),
]

/** F2: both questions on one screen, one list under the other; tab moves between them. */
const bothRows = (focus: 'want' | 'format') => [
  title('Transcribe to'),
  ...(focus === 'want'
    ? [pick('All', true, 'summary, notes and transcript', 'Standard'), pick('Notes', false), pick('Transcript', false)]
    : [kept('All'), pick('Notes', false), pick('Transcript', false)]),
  [],
  title('Format'),
  ...FORMATS.map(([l, e], i) =>
    focus === 'format' ? pick(l, i === 1, e) : i === 1 ? kept(l) : pick(l, false),
  ),
]

function doneScreen(menu: boolean): Grid {
  const g = frame('done')
  trail(g, ['All', 'Desktop', 'influence-talk.md'], 'Done')
  if (menu) {
    const rows: Row[] = [
      title('Export a copy'),
      ...FORMATS.slice(1).map(([l, e], i) => pick(l, i === 0, e)),
    ]
    clearRows(g, 13, 21)
    rows.forEach((r, i) => setRow(g, 13 + i, r))
    setRow(g, keysOf(g), keyRow([['↑↓', 'choose'], ['↵', 'save']], BACK))
  } else {
    setRow(
      g,
      keysOf(g),
      keyRow(
        [
          ['↵', 'new'],
          ['o', 'open'],
          ['s', 'finder'],
          ['c', 'copy'],
          ['e', 'export'],
        ],
        [['ctrl-c', 'quit']],
      ),
    )
  }
  return g
}

/* ------------------------------------------------------------------- page */

const flow = (steps: [string, Grid, number][]) =>
  `<div class="flow">${steps
    .map(([cap, g, to], i) => `${i ? '<div class="arrow">↓</div>' : ''}<div class="cap">${cap}</div>${cropped(g, to)}`)
    .join('')}</div>`

const concepts: PageConcept[] = [
  ...VARIANTS.map(
    (v, i): PageConcept => ({
      id: v.id,
      name: v.name,
      idea: v.idea,
      ...(i === 0
        ? {
            tab: '1 · Working',
            section:
              'OPTIONS — W1, W2, W3, W4 or W5, pick one <span class="sub">Each shows the same run twice: while it transcribes, then while it writes notes (part 3 of 5).</span>',
          }
        : {}),
      html: pair(
        cropped(working('heard', v.heard), 15),
        cropped(working('notes', v.notes), 15),
        'While transcribing',
        'While writing notes',
      ),
    }),
  ),
  ...CLOCKS.map(
    (c, i): PageConcept => ({
      id: c.id,
      name: c.name,
      idea: c.idea,
      ...(i === 0
        ? {
            tab: '2 · Clock',
            section:
              'OPTIONS — T1, T2 or T3, pick one <span class="sub">The same line at 42 seconds, 4 minutes, and an hour. It would change every Working screen, not only transcribe’s.</span>',
          }
        : {}),
      html: clockStrip(c.say),
    }),
  ),
  {
    id: 'F1',
    name: 'Your idea: a Format step',
    idea: 'A step of its own after Transcribe to, Markdown first. The name on Save as takes the chosen extension, and the header bar keeps the answer. The All row stops saying “· .md”.',
    tab: '3 · Format',
    section:
      'OPTIONS — F1, F2, F3 or F4, pick one <span class="sub">Each is shown as its steps in order, top to bottom. Word is picked to show the change.</span>',
    html: flow([
      ['Step 1 · Transcribe to', chooseScreen(wantRows(), keyRow([['↑↓', 'choose'], ['←→', 'detail'], ['↵', 'confirm']], BACK)), 12],
      ['Step 2 · Format', chooseScreen(formatRows(1), keyRow([['↑↓', 'choose'], ['↵', 'confirm']], BACK), ['All'], 'Format'), 13],
      ['Step 3 · Save as', saveAs('.docx', ['All', 'Word']), 24],
    ]),
  },
  {
    id: 'F2',
    name: 'One screen, two lists',
    idea: 'Format sits under Transcribe to on the same screen; tab moves between the two lists, and the other list keeps its choice marked. No extra step for anyone who keeps Markdown.',
    html: flow([
      [
        'Transcribe to has focus',
        chooseScreen(bothRows('want'), keyRow([['↑↓', 'choose'], ['←→', 'detail'], ['tab', 'format'], ['↵', 'confirm']], [['esc', 'back']])),
        18,
      ],
      [
        'After tab: Format has focus',
        chooseScreen(bothRows('format'), keyRow([['↑↓', 'choose'], ['tab', 'transcribe to'], ['↵', 'confirm']], BACK)),
        18,
      ],
    ]),
  },
  {
    id: 'F3',
    name: 'The extension is a pill on Save as',
    idea: 'No new step and no new list: the “.md” after the name becomes a pill, stepped with ←→ like Detail. The format is chosen where the file is named.',
    html: flow([
      [
        'Save as',
        saveAs('.docx', ['All'], true, keyRow([['↵', 'save'], ['↑↓', 'folder'], ['←→', 'format'], ['tab', 'default']], [['esc', 'back']])),
        24,
      ],
    ]),
  },
  {
    id: 'F4',
    name: 'Export a copy from Done',
    idea: 'The .md is always written, as today. Done gains “e export”: a copy as Word, PDF or text, saved beside it. The flow before Done does not change at all.',
    html: flow([
      ['Done', doneScreen(false), 12],
      ['After e', doneScreen(true), 17],
    ]),
  },
]

const before = `<div class="box"><h3>Decided — from your message</h3><ul>
<li>“Writing notes” is its own row, under “Transcribing”.</li>
<li>Squares, not dots, for the parts.</li>
<li>The clock says minutes once it passes 60 seconds; under a minute it stays in seconds.</li>
<li>A choice of output format: Markdown (today), Word, PDF, text.</li>
</ul></div>
<div class="box"><h3>Questions for you</h3><ol>
<li>New words on screen, to approve: the step name <b>Format</b>; the names <b>Markdown · Word · PDF · Text</b> with <b>.md · .docx · .pdf · .txt</b>; “<b>2 of 5 parts</b>” under the squares; F2’s “<b>tab format</b>”; F4’s “<b>e export</b>” and “<b>Export a copy</b>”.</li>
<li>Should the format be remembered between runs? (Detail is not.) My pick: yes — a format is a habit, Detail is per talk.</li>
<li>The clock (tab 2) is shared by every Working screen. Change it everywhere? My pick: yes.</li>
<li>Word and PDF: Word would come from macOS’s own <code>textutil</code> (no download). PDF needs a renderer — the Swift helper already in Forge can print one. Text is the Markdown with its marks removed. OK to have Word and PDF look plain (headings, bullets, times, no styling)?</li>
</ol></div>
<style>
  .stack, .flow { display:flex; flex-direction:column; gap:6px; }
  .cap { color:#8f94a1; font:600 12px -apple-system,sans-serif; letter-spacing:.06em; text-transform:uppercase; margin-top:6px; }
  .arrow { color:#e63946; font-size:20px; text-align:center; width:640px; margin:2px 0 -4px; }
  .cut { height:10px; margin:3px 0; background:repeating-linear-gradient(90deg,#3a3a3a 0 6px,transparent 6px 12px) center/100% 1px no-repeat; }
  .t.s { padding:8px 12px; }
  h2 .sub { display:block; color:#8f94a1; font-size:14px; font-weight:400; margin-top:4px; }
</style>`

writeFileSync(
  'mockups/transcribe-2026-10-round3.html',
  feedbackPage({
    page: 'transcribe-round3',
    title: 'Forge · Transcribe, round three',
    heading: 'Transcribe: progress, clock, format',
    lede: 'Three open questions, each on its own tab: how “Writing notes” sits under “Transcribing”, how the clock says minutes, and where the output format is chosen. Screens are the real app at 80 × 24, dark; only the rows in question are redrawn. The middle of each screen is cut (dashed line) to keep them short.',
    before,
    concepts,
    compact: true,
  }),
)
console.log('wrote mockups/transcribe-2026-10-round3.html')
