/**
 * The way on from Done (2026-10-22). In user testing many people stopped on
 * Done and didn't know how to go on. ↵ says something different in every mode
 * ("convert another", "compress again", "edit another", "new", "stop and go
 * home"), esc does nothing, and the quiet "continue editing →" at the bottom
 * right reads like the way forward.
 *
 * The screens are the app's own: home and Done captured at 80 × 24, dark,
 * after a PNG really converted to JPEG (scripts/done-next-capture.tsx →
 * scripts/done-next-frames.json). Each concept edits those cells. Decided
 * pieces hold everywhere: the header bar, the strip, the seven-row bar and
 * now/was. Only the way on changes.
 *
 *   npx tsx scripts/done-next-mockup.ts   → mockups/done-next-2026-10.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { DARK, modePalette } from '../src/shell/theme.js'
import { type PageConcept, feedbackPage } from './feedback-page.js'
import { type Cell, type Grid, termHtml } from './term-cells.js'

type Raw = { ch: string; fg: string | null; bg: string | null; b: boolean }
const frames = JSON.parse(
  readFileSync(new URL('./done-next-frames.json', import.meta.url), 'utf8'),
) as Record<string, Raw[][]>
const grid = (raw: Raw[][]): Grid =>
  raw.map((r) => r.map((c) => ({ ch: c.ch, fg: c.fg ?? undefined, bg: c.bg ?? undefined, b: c.b })))

const q = modePalette(DARK, 'convert')
const N = 80
/** The painted app's block: columns 4 to 75. */
const L = 4
const R = N - 4
const CANVAS = q.canvas
const MODE = q.modeConvert
const MODE_BG = q.modeConvertBg

const DONE = grid(frames.step4 as Raw[][])
const HOME = grid(frames.home as Raw[][])

/* ------------------------------------------------------------- drawing */

type Seg = [text: string, fg?: string, bg?: string, bold?: boolean]
const blankRow = (): Cell[] => Array.from({ length: N }, () => ({ ch: ' ', bg: CANVAS }))
const copy = (row: Cell[] | undefined): Cell[] => (row ?? blankRow()).map((c) => ({ ...c }))
const len = (segs: Seg[]) => segs.reduce((n, [t]) => n + [...t].length, 0)

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
const line = (at: number, segs: Seg[]) => put(blankRow(), at, segs)
/** Left and right on one row of the block. */
const ends = (left: Seg[], right: Seg[]) => put(line(L, left), R - len(right), right)

/** A key as the key row draws it: the cap on the key grey, the words dim. */
const cap = (k: string, words: string): Seg[] => [
  [` ${k} `, q.fg, q.keycapBg, true],
  [` ${words}`, q.dim],
]
/** The key row (KeyRow): keys from the margin, the footnote ending on it. */
function keyRow(main: Seg[][], foot: Array<[string, string]> = [['ctrl-c', 'quit']]): Cell[] {
  const left: Seg[] = main.flatMap((k, i) => (i ? [['  '] as Seg, ...k] : k))
  const right: Seg[] = foot.flatMap(([k, w], i) => [
    ...(i ? ([[' · ', q.border]] as Seg[]) : []),
    [k, q.fg] as Seg,
    ...(w ? ([[` ${w}`, q.border]] as Seg[]) : []),
  ])
  return ends(left, right)
}
const RULE = copy(DONE[22])
const HEADER = copy(DONE[1])
/** The strip (three rows), the bar (seven), the blank row and now/was: Done's body as built. */
const BODY = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map((i) => copy(DONE[i]))
/** Done's compact body (its short-window form): the strip's words, a three-row bar, now/was. */
const COMPACT = [5, 9, 10, 11, 15, 16].map((i) => copy(DONE[i]))
const FOOT = copy(DONE[20])

/** A screen `h` rows tall: `top` from row 0, `bottom` ending on the last row, blank between. */
function screen(top: Cell[][], bottom: Cell[][], h = 24): Grid {
  const gap = h - top.length - bottom.length
  if (gap < 0) throw new Error(`screen overflows by ${-gap}`)
  return [...top, ...Array.from({ length: gap }, blankRow), ...bottom]
}
const blanks = (n: number) => Array.from({ length: n }, blankRow)
const shot = (g: Grid) => termHtml(q, g)
const stackV = (...html: string[]) =>
  `<div style="display:flex;flex-direction:column;gap:20px">${html.join('')}</div>`

/** Done's top as built: a blank row, the header, a blank row and two above the body. */
const doneTop = (extra: Cell[][] = []) => [blankRow(), HEADER, ...blanks(2), ...extra, ...BODY]
const doneBottom = (keys: Cell[], foot: Cell[] = FOOT) => [foot, blankRow(), RULE, keys]

const OPEN = cap('o', 'open')
const SHOW = cap('s', 'show in Finder')

/* ---------------------------------------------- the key row, mode by mode */

interface ModeRow {
  mode: string
  keys: Seg[][]
  foot?: Array<[string, string]>
}
/** What each finished screen's key row says today (App.tsx, transcribe.tsx, watch.tsx). */
const TODAY_ROWS: ModeRow[] = [
  { mode: 'convert', keys: [cap('↵', 'convert another'), OPEN, SHOW] },
  { mode: 'compress', keys: [cap('↵', 'compress again'), OPEN, SHOW] },
  { mode: 'edit', keys: [cap('↵', 'edit another'), OPEN, cap('s', 'Show in Finder')] },
  {
    mode: 'transcribe',
    keys: [cap('↵', 'new'), cap('o', 'open'), cap('s', 'finder'), cap('c', 'copy')],
  },
  { mode: 'watch', keys: [cap('↵', 'stop and go home')] },
]
/** The same rows with one word for ↵ in every mode, and esc doing the same. */
const wordRows = (word: string, esc?: string): ModeRow[] =>
  TODAY_ROWS.map((r) => ({
    ...r,
    keys: [
      cap('↵', r.mode === 'watch' ? `stop · ${word}` : word),
      ...(r.mode === 'transcribe'
        ? [cap('o', 'open'), SHOW, cap('c', 'copy')]
        : r.mode === 'watch'
          ? []
          : [OPEN, SHOW]),
    ],
    ...(esc ? { foot: [[esc, ''] as [string, string], ['ctrl-c', 'quit']] } : {}),
  }))

/** Key rows alone, two cells larger, each labelled with its mode: the detail is the words. */
function rowsFigure(rows: ModeRow[]): string {
  return `<div class="rows">${rows
    .map(
      (r) =>
        `<div class="moderow"><span class="mlabel">${r.mode}</span>${shot([keyRow(r.keys, r.foot)])}</div>`,
    )
    .join('')}</div>`
}

/* ------------------------------------------------------------ concepts */

/** Y4: a way back under the header, where a back button sits. */
const back = line(L, [
  [' esc ', q.fg, q.keycapBg, true],
  [' ← home', q.dim],
])

/** Y5: ↵ lit in the mode's colour on the key row; the rest as they are. */
const litEnter: Seg[] = [
  [' ↵ ', q.ink, MODE, true],
  [' next file', MODE, undefined, true],
]

/** Y6: the next file as a button in the body, under now and was. */
const button = line(L, [
  [' ↵ ', q.ink, MODE, true],
  [' next file ', MODE, MODE_BG, true],
])

/** Y7: home's drop surface (D2 dots) under the result, seven rows: dots, words, dots. */
const dropZone = [9, 9, 10, 11, 12, 13, 13].map((i) => copy(HOME[i]))

/** Y9: home's field, without its "OR" (nothing to say "or" to). */
const field = (() => {
  const row = copy(HOME[16])
  put(row, L + 2, [
    ['›', MODE, q.shelf, true],
    [' search or enter a file path…', q.border, q.shelf],
    ['   ', undefined, q.shelf],
  ])
  return row
})()

/** Y8: what's next as a list, drawn as the pickers draw a choice: the band, ▌ in the mode's colour. */
const CHOICES = ['Next file', 'Open', 'Show in Finder', 'Continue editing', 'Save as preset']
const listRows = CHOICES.map((c, i) =>
  i === 0
    ? put(line(L, [['▌', MODE, q.listBand]]), L + 1, [
        [' ', undefined, q.listBand],
        [c, q.fg, q.listBand, true],
        [' '.repeat(30 - c.length), undefined, q.listBand],
      ])
    : line(L, [['  '], [c, q.dim]]),
)

/** Y10: the same choices as a row of buttons, the first one lit, ←→ to move. */
const buttonRow = (() => {
  const segs: Seg[] = []
  CHOICES.forEach((c, i) => {
    if (i) segs.push([' '])
    segs.push(i === 0 ? [` ${c} `, q.ink, MODE, true] : [` ${c} `, q.dim, q.keycapBg])
  })
  return line(L + Math.floor((R - L - len(segs)) / 2), segs)
})()

const concepts: PageConcept[] = [
  {
    id: 'Y0',
    name: 'Today, as built',
    idea: 'Captured from the app. ↵ is the way home, but nothing says “home”, esc does nothing, and the quiet “continue editing →” at the bottom right looks like the way forward.',
    html: shot(screen(doneTop(), doneBottom(copy(DONE[23])))),
    tab: 'Today',
  },
  {
    id: 'Y0·b',
    name: 'Today: what ↵ says, mode by mode',
    idea: 'The same key does the same thing (back to home, ready for the next file) under five different words. Edit says “Show in Finder”, transcribe says “finder”.',
    html: rowsFigure(TODAY_ROWS),
  },
  {
    id: 'Y1',
    name: '↵ home, in every mode',
    idea: 'One word for ↵ on every finished screen: “home”. esc does the same (today it does nothing). The other keys keep their words, now the same in every mode.',
    html: rowsFigure(wordRows('home')),
    tab: 'One word for ↵',
  },
  {
    id: 'Y2',
    name: '↵ next file, in every mode',
    idea: 'Names what you want to do next instead of the place. Still lands on home, with nothing staged.',
    html: rowsFigure(wordRows('next file')),
  },
  {
    id: 'Y3',
    name: '↵ done, in every mode',
    idea: 'The word a dialog’s closing button uses. Short, but it sits on a screen already called Done.',
    html: rowsFigure(wordRows('done')),
  },
  {
    id: 'Y4',
    name: 'A way back under the header',
    idea: 'esc ← home on its own row under the header, where a back button usually is. The body moves down one row. The key row keeps ↵ next file.',
    html: shot(
      screen(
        [blankRow(), HEADER, blankRow(), back, blankRow(), ...BODY],
        doneBottom(keyRow([cap('↵', 'next file'), OPEN, SHOW])),
      ),
    ),
    tab: 'Ways on',
  },
  {
    id: 'Y5',
    name: '↵ lit on the key row',
    idea: 'Nothing moves. ↵ becomes the one key in the mode’s colour, the cap filled and the words bold, so it reads as the main action and o and s as extras.',
    html: shot(screen(doneTop(), doneBottom(keyRow([litEnter, OPEN, SHOW])))),
  },
  {
    id: 'Y6',
    name: 'A next-file button under the result',
    idea: '↵ next file as a button in the body, a row under now and was: the key on the mode’s colour, the words on its tint. It leaves the key row, which keeps o and s.',
    html: shot(screen([...doneTop(), blankRow(), button], doneBottom(keyRow([OPEN, SHOW])))),
  },
  {
    id: 'Y7',
    name: 'The drop zone comes back',
    idea: 'Home’s drop surface sits under the result, so the next file can be dropped or pasted straight onto Done. ↵ goes home. At 24 rows the body takes its compact form (one-row strip, three-row bar); at 32 it stays whole.',
    html: stackV(
      shot(
        screen(
          [blankRow(), HEADER, blankRow(), ...COMPACT, ...blanks(2), ...dropZone],
          doneBottom(keyRow([cap('↵', 'home'), OPEN, SHOW])),
        ),
      ),
      shot(
        screen(
          [...doneTop(), ...blanks(2), ...dropZone],
          doneBottom(keyRow([cap('↵', 'home'), OPEN, SHOW])),
          32,
        ),
      ),
    ),
  },
  {
    id: 'Y8',
    name: 'What next, as a list',
    idea: 'Every way on in one list, chosen the way every step before was (↑↓, ↵), the first one already chosen. The p and → foot and the o and s keys fold into it.',
    html: shot(
      screen(
        [blankRow(), HEADER, blankRow(), ...BODY, blankRow(), ...listRows],
        [RULE, keyRow([cap('↑↓', 'choose'), cap('↵', 'confirm')], [['esc', 'home'], ['ctrl-c', 'quit']])],
      ),
    ),
  },
  {
    id: 'Y9',
    name: 'The field comes back',
    idea: 'As a shell gives its prompt back once a command ends: home’s field sits under the result, ready for a path or a drop. o, s and p keep their keys. Typing / or ~, pasting or dropping goes into the field.',
    html: shot(
      screen(
        [...doneTop(), blankRow(), field],
        doneBottom(keyRow([cap('↵', 'home'), OPEN, SHOW])),
      ),
    ),
  },
  {
    id: 'Y10',
    name: 'A row of buttons',
    idea: 'The ways on as one row of buttons, as a dialog ends. The first is lit in the mode’s colour, and ←→ moves the light. Replaces the p and → foot.',
    html: shot(
      screen(
        [...doneTop()],
        [buttonRow, blankRow(), RULE, keyRow([cap('←→', 'choose'), cap('↵', 'confirm')], [['esc', 'home'], ['ctrl-c', 'quit']])],
      ),
    ),
  },
]

const before = `<div class="box"><h3>Held fixed</h3>
<p style="margin:4px 0 0">The header bar, the strip, the seven-row bar and now/was, as built. Only how you leave Done changes. Tab 2 is the words for ↵. Tab 3 is where the way on sits and how it looks. Any tab-3 concept can take any tab-2 word.</p></div>
<div class="box"><h3>Questions for you</h3><ol>
<li>New strings to approve: <code>home</code>, <code>next file</code>, <code>done</code> (Y1–Y3), <code>← home</code> (Y4), <code>Next file</code> (Y8, Y10), <code>search or enter a file path…</code> (Y9: home's placeholder without “OR”).</li>
<li>Should esc on Done go home in every concept? Today it does nothing. I'd make it go home whichever concept wins.</li>
<li>Should dropping or pasting a file on Done start the next one straight away, even where there is no drop zone? It would skip the trip home.</li>
<li>Should “continue editing →” be louder, quieter or renamed once ↵ is clear? Only Y8 and Y10 touch it.</li>
</ol></div>
<style>.rows{display:flex;flex-direction:column;gap:10px}.moderow{display:flex;align-items:center;gap:14px}.mlabel{font:12px "SF Mono",ui-monospace,Menlo,monospace;color:#8f94a1;width:78px;text-align:right}.rows .t{padding:6px 16px}</style>`

writeFileSync(
  'mockups/done-next-2026-10.html',
  feedbackPage({
    page: 'done-next',
    title: 'Forge · the way on from Done',
    heading: 'Done: the way on',
    lede: 'In testing, people stopped on Done and didn’t know how to go on. Today, ↵ (back to home) has a different word in every mode, esc does nothing, and “continue editing →” looks like the next step. The Today screens are captured from the app (dark, 80 × 24); the concepts edit those captures.',
    before,
    concepts,
  }),
)
console.log('wrote mockups/done-next-2026-10.html')
