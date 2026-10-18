/**
 * What's new on /update (2026-10-17, round 3): one column, ↵ update at the
 * far right of the release's row, Check automatically under it, then the release's notes as a section of their
 * own that scrolls, on a grey card under a grey "what's new" chip. Decided:
 * U4, its chip grey (U3 heading and hairline, U5 timeline not picked).
 *
 * The header bar and the hint bar's rule are the real /update at 80 × 24,
 * captured from the app (a throwaway test wrote
 * /tmp/forge-whatsnew/frames.json), as is the "new" tag. Everything else is
 * drawn here from the theme's own colours.
 *
 *   npx tsx scripts/whatsnew-mockup.ts   → mockups/whatsnew-2026-10.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { DARK, LIGHT, type Palette } from '../src/shell/theme.js'

interface Cell {
  ch: string
  fg: string | null
  bg: string | null
  b: boolean
}
type Theme = 'dark' | 'light'
const CAPTURED = JSON.parse(readFileSync('/tmp/forge-whatsnew/frames.json', 'utf8')) as Record<
  Theme,
  Cell[][]
>

const N = 80
const LEFT = 4
/** One past the last content column: the hint bar's foot ends here. */
const RIGHT = 76
/** The scroll bar's column, the content's last. */
const BAR = RIGHT - 1
const TOP = 3
/** The hint bar keeps a blank row above its rule, as the app's does. */
const BOTTOM = 20

interface Note {
  title: string
  text: string
}

/** 0.4.0 against 0.3.9: what `dev` holds that the last release does not. */
const NOTES: Note[] = [
  {
    title: 'Watch a folder',
    text: 'Drop a folder on Convert. Forge converts what is in it, then each new file that lands there. In a terminal: forge watch.',
  },
  {
    title: 'Presets',
    text: 'On Done, press p to save what you did. Run it on any file with forge photo.png --preset name.',
  },
  {
    title: 'Continue editing',
    text: 'On Done, → adds more steps to the same file without starting over.',
  },
  {
    title: 'Paste an image',
    text: 'Copy an image anywhere, then press ⌘V on home. The result goes back on the clipboard.',
  },
  {
    title: 'Smaller PNG and GIF',
    text: 'Compress can now shrink PNGs and GIFs much further, and never makes a file bigger.',
  },
  {
    title: 'Enhance is now Edit',
    text: 'Same six tools, a name that fits them all.',
  },
]

/** The edge case: a long release. Made up past the first six. */
const LONG: Note[] = [
  ...NOTES,
  {
    title: 'Crop to shape',
    text: 'Cut an image to a circle or a rounded square; corner brackets show what stays.',
  },
  { title: 'Scale steps', text: 'Colour builds a tonal scale in Tailwind, even or Radix steps.' },
  { title: 'Light theme', text: 'Forge follows a light terminal. /theme switches by hand.' },
  { title: 'HEIC on Windows', text: 'An extension opens iPhone photos on Windows too.' },
  { title: 'Resize and Trim', text: 'Edit resizes to an exact size and trims empty edges.' },
]

function wrap(text: string, width: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line === '') line = word
    else if (line.length + 1 + word.length <= width) line += ` ${word}`
    else {
      out.push(line)
      line = word
    }
  }
  if (line !== '') out.push(line)
  return out
}

/** One cell grid, written into by column. */
class Screen {
  rows: Cell[][]
  constructor(
    readonly p: Palette,
    theme: Theme,
  ) {
    this.rows = CAPTURED[theme].map((r) => r.map((c) => ({ ...c })))
    // Keep the header bar (rows 0–2) and the hint bar's rule (22).
    for (const i of [...Array.from({ length: 21 - TOP + 1 }, (_, k) => TOP + k), 23])
      this.fill(i, 0, N, p.canvas)
  }
  fill(i: number, from: number, to: number, bg: string) {
    for (let x = from; x < to; x++)
      (this.rows[i] as Cell[])[x] = { ch: ' ', fg: null, bg, b: false }
  }
  text(i: number, x: number, s: string, fg: string, opts: { bg?: string; b?: boolean } = {}) {
    const row = this.rows[i] as Cell[]
    for (const ch of s) {
      const bg = opts.bg ?? row[x]?.bg ?? this.p.canvas
      row[x++] = { ch, fg, bg, b: !!opts.b }
    }
    return x
  }
  cells(i: number, x: number, cells: Cell[]) {
    for (const c of cells) (this.rows[i] as Cell[])[x++] = { ...c }
    return x
  }
}

type Focus = 'update' | 'notes'

/** One drawn line of the notes, and which note it belongs to. */
interface NoteLine {
  item: number
  draw: (s: Screen, i: number, x0: number) => void
}

interface Frame {
  first: number
  last: number
  x0: number
  x1: number
  bar: number
}

interface Option {
  id: string
  name: string
  idea: string
  pick?: boolean
  /** Draws the section's heading (and card) from row `top`; says where the notes go. */
  frame: (s: Screen, top: number) => Frame
  lines: (p: Palette, notes: Note[], width: number) => NoteLine[]
}

/** The name in a column of its own, the text beside it; a blank line between notes. */
function twoColumns(p: Palette, notes: Note[], width: number, nameCol = 22): NoteLine[] {
  return notes.flatMap((n, item): NoteLine[] => [
    ...wrap(n.text, width - nameCol).map(
      (l, k): NoteLine => ({
        item,
        draw: (s, i, x0) => {
          if (k === 0) s.text(i, x0, n.title, p.fg, { b: true })
          s.text(i, x0 + nameCol, l, p.dim)
        },
      }),
    ),
    ...(item < notes.length - 1 ? [{ item, draw: () => {} }] : []),
  ])
}

const OPTIONS: Option[] = [
  {
    id: 'U4',
    name: 'Card with a tab',
    idea: 'The notes on a grey card, its tab a grey chip one step lighter, “what’s new”. The card holds the scroll bar; the release reads as one object.',
    pick: true,
    frame: (s, top) => {
      for (let i = top; i <= BOTTOM; i++) s.fill(i, LEFT, RIGHT, s.p.band)
      // The tab: a grey chip one step up from the card, white words.
      const x = s.text(top, LEFT, " what's new ", s.p.fg, { bg: s.p.panelBand, b: true })
      s.text(top, x + 1, 'in 0.4.0', s.p.dim)
      return { first: top + 2, last: BOTTOM - 1, x0: LEFT + 2, x1: BAR - 3, bar: BAR - 1 }
    },
    lines: (p, notes, width) => twoColumns(p, notes, width, 22),
  },
]

interface State {
  focus: Focus
  notes: Note[]
  /** Scrolled to the last note. */
  end?: boolean
}

function screen(theme: Theme, o: Option, state: State): Cell[][] {
  const p = theme === 'dark' ? DARK : LIGHT
  const s = new Screen(p, theme)
  const tag = (CAPTURED[theme][3] as Cell[]).slice(12, 17)

  // The release, what you have, and ↵ update at the far right of its row.
  let x = s.text(TOP, LEFT, 'Forge 0.4.0', p.fg, { b: true })
  s.cells(TOP, x + 1, tag)
  const onUpdate = state.focus === 'update'
  const pill = ' ↵ update '
  s.text(TOP, RIGHT - pill.length, pill, onUpdate ? p.ink : p.dim, {
    bg: onUpdate ? p.pill : p.keycapBg,
    b: true,
  })
  s.text(TOP + 1, LEFT, 'Your version 0.3.9', p.dim)

  // The setting, on its own.
  x = s.text(TOP + 3, LEFT, 'Check automatically', p.dim)
  const chip = { bg: p.folderChip }
  x = s.text(TOP + 3, x + 3, ' ‹ ', p.border, chip)
  x = s.text(TOP + 3, x, 'on', p.fg, { ...chip, b: true })
  s.text(TOP + 3, x, ' › ', p.border, { ...chip, b: true })

  // What's new.
  const f = o.frame(s, TOP + 5)
  const lines = o.lines(p, state.notes, f.x1 - f.x0)
  const room = f.last - f.first + 1
  // A note at a time: the end is the first note from which the rest fits.
  const starts = lines.flatMap((l, k) => (k === 0 || lines[k - 1]?.item !== l.item ? [k] : []))
  const scroll = state.end ? (starts.find((k) => lines.length - k <= room) ?? 0) : 0
  const shownLines = lines.slice(scroll, scroll + room)
  shownLines.forEach((l, k) => {
    l.draw(s, f.first + k, f.x0)
  })

  if (lines.length > room) {
    const thumb = Math.max(1, Math.round((room * room) / lines.length))
    const at = Math.round((scroll / (lines.length - room)) * (room - thumb))
    const lit = state.focus === 'notes' ? p.fg : p.dim
    for (let k = 0; k < room; k++) {
      const on = k >= at && k < at + thumb
      s.text(f.first + k, f.bar, on ? '┃' : '│', on ? lit : p.faint)
    }
    const shown = new Set(shownLines.map((l) => l.item))
    const count = (ls: NoteLine[]) =>
      new Set(ls.map((l) => l.item).filter((i) => !shown.has(i))).size
    const above = count(lines.slice(0, scroll))
    const below = count(lines.slice(scroll + room))
    const note = (i: number, t: string) => s.text(i, f.bar + 1 - t.length, t, p.dim)
    if (above > 0) note(f.first - 1, `↑ ${above} more`)
    if (below > 0) note(f.last + 1, `↓ ${below} more`)
  }

  // The keys, as HintBar draws them.
  const keys: Array<[string, string]> =
    state.focus === 'notes'
      ? [['↑↓', 'scroll']]
      : [
          ['↑↓', 'choose'],
          ['↵', 'update'],
        ]
  x = LEFT - 1
  for (const [k, label] of keys) {
    x = s.text(23, x, ` ${k} `, p.fg, { bg: p.keycapBg, b: true })
    x = s.text(23, x + 1, label, p.dim) + 3
  }
  const foot = 'esc home · ctrl-c quit'
  s.text(23, RIGHT - foot.length, foot, p.border)
  return s.rows
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
function html(rows: Cell[][], palette: Palette): string {
  return rows
    .map((cells) => {
      let out = ''
      for (const c of cells) {
        const st = [
          `color:${c.fg || palette.fg}`,
          c.bg ? `background:${c.bg}` : '',
          c.b ? 'font-weight:700' : '',
        ]
          .filter(Boolean)
          .join(';')
        out += `<span style="${st}">${esc(c.ch)}</span>`
      }
      return `<div class="r">${out}</div>`
    })
    .join('')
}

const term = (theme: Theme, o: Option, state: State, cap: string) => {
  const p = theme === 'dark' ? DARK : LIGHT
  return `<div class="shot"><div class="t" style="background:${p.canvas}">${html(screen(theme, o, state), p)}</div><div class="cap">${cap}</div></div>`
}

const figures = OPTIONS.map(
  (
    o,
  ) => `<figure><div class="vt"><span class="id">${o.id}</span><span class="name">${o.name}</span>${o.pick ? '<span class="pick">DECIDED</span>' : ''}</div>
<p class="idea">${esc(o.idea)}</p>
<div class="theme">
${term('dark', o, { focus: 'update', notes: NOTES }, '1 · opened: ↵ update chosen, 0.4.0’s six notes')}
${term('light', o, { focus: 'update', notes: NOTES }, '1 · the same, light')}
${term('dark', o, { focus: 'notes', notes: LONG, end: true }, '2 · edge case: a long release (11 notes, the last five made up), ↓ into the notes, scrolled to the end')}
</div></figure>`,
).join('\n')

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · What's new on /update</title>
<style>
  body { margin:0; background:#0d0e11; color:#e2e4ea; font:16px/1.6 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  main { max-width:2100px; margin:0 auto; padding:44px 24px 120px; }
  h1 { font-size:30px; margin:0 0 8px; } .lede { color:#8f94a1; max-width:1000px; margin:0; }
  h2 { font-size:13px; letter-spacing:.12em; color:#8f94a1; margin:40px 0 0; font-weight:650; }
  h2 span { letter-spacing:0; font-weight:400; color:#c7cbd4; margin-left:10px; }
  ol { color:#c7cbd4; max-width:1000px; padding-left:22px; } li { margin:4px 0; }
  figure { margin:28px 0 0; }
  .vt { display:flex; align-items:baseline; gap:10px; margin-bottom:6px; }
  .vt .id { font:700 12px "SF Mono", ui-monospace, Menlo, monospace; padding:3px 7px; border-radius:6px; background:#12282e; color:#55c7d9; }
  .vt .name { font-weight:620; }
  .vt .pick { font:600 11px "SF Mono", ui-monospace, Menlo, monospace; letter-spacing:.08em; color:#6fcf7f; border:1px solid #2c5a37; padding:2px 7px; border-radius:6px; }
  .idea { font-size:14.5px; color:#c7cbd4; margin:6px 0 12px; max-width:1000px; }
  .theme { display:flex; flex-wrap:wrap; gap:14px; align-items:flex-start; }
  .shot { width:max-content; } .cap { font:13px "SF Mono", ui-monospace, Menlo, monospace; color:#8f94a1; margin-top:8px; max-width:620px; }
  .t { font:13px/1 "SF Mono", ui-monospace, Menlo, monospace; padding:12px 14px; border-radius:10px; border:1px solid #2c2f37; width:max-content; }
  .r { height:17px; white-space:pre; } .r > span { display:inline-block; height:17px; line-height:17px; }
</style></head><body><main>
<h1>/update: what’s new</h1>
<p class="lede">/update at 80 × 24, the smallest size Forge supports, when 0.4.0 is out. One column, in three blocks with a step of space between them: the release and your version, with ↵ update at the far right of the release’s row; Check automatically; then what’s new. The notes scroll, so a release can say as much as it needs.</p>
<h2>DECIDED<span>U4, its chip grey (2026-10-17)</span></h2>
<p class="idea">↑↓ goes ↵ update → Check automatically → into the notes when they overflow, where it scrolls a note at a time; the bar brightens and the keys say “↑↓ scroll”. ↑ at the top of the notes goes back.</p>
${figures}
</main></body></html>`

writeFileSync('mockups/whatsnew-2026-10.html', page)
console.log('wrote mockups/whatsnew-2026-10.html')
