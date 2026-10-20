/**
 * /cli, round one (2026-10-19): the command line's flags and subcommands,
 * listed by category in the menu's settings.
 *
 * Decided in conversation: it is a settings row (it opens inside the menu's
 * box, as /about does), grouped by category, with the README keeping the full
 * reference. Open: how a row reads, whether ↵ copies, the name, the tabs.
 *
 * The menu list is the app's own `menuListRows`; the bar, the hint row and the
 * scroll bar's idea are the app's own art. The tab bar copies `aboutTabRows`
 * with the tabs as a parameter (the real one is fixed to About's two). The
 * rest is drawn here the way the popup draws it: a 78-column box, the bar, a
 * blank row, 15 body rows, a blank row and the field.
 *
 *   npx tsx scripts/cli-mockup.ts   → mockups/cli-2026-10.html
 */
import { writeFileSync } from 'node:fs'
import stringWidth from 'string-width'
import { trailBarRow } from '../src/shell/bar-art.js'
import { COMMANDS, type Command } from '../src/shell/commands.js'
import {
  blank,
  clip,
  HOME_MARGIN,
  menuHintRow,
  type Row,
  type Run,
  width as rowWidth,
} from '../src/shell/home-art.js'
import { menuListRows } from '../src/shell/menu-art.js'
import { DARK, LIGHT, modeGradient, type Palette } from '../src/shell/theme.js'

const N = 80
const H = 24
const POP_W = 78
const IN = POP_W - 4
const BODY = 15

/* ------------------------------------------------------------ the strings */

interface Item {
  /** The flag or subcommand as typed, with its arguments. */
  name: string
  /** What it does, in one short line. */
  does: string
  /** One real use of it. */
  ex: string
}

interface Tab {
  name: string
  items: Item[]
}

const TABS: Tab[] = [
  {
    name: 'Convert',
    items: [
      {
        name: '-t, --to <format>',
        does: 'convert to another format',
        ex: 'forge photo.heic --to jpg',
      },
      {
        name: '-o, --output <path>',
        does: 'where to save',
        ex: 'forge scan.png --to pdf -o ~/Desktop',
      },
      {
        name: '-q, --quality <1-100>',
        does: 'quality for lossy formats',
        ex: 'forge photo.png --to webp -q 80',
      },
      {
        name: '--max-size <size>',
        does: 'compress until the file fits',
        ex: 'forge photo.jpg --to jpg --max-size 500kb',
      },
      {
        name: '--background <colour>',
        does: 'fill where transparency goes',
        ex: 'forge logo.png --to jpg --background "#ffffff"',
      },
      {
        name: '--keep-metadata',
        does: 'keep EXIF and GPS data',
        ex: 'forge photo.jpg --to webp --keep-metadata',
      },
      {
        name: '--recursive',
        does: 'go into subfolders',
        ex: 'forge photos/ --to webp --recursive',
      },
      {
        name: '--force',
        does: 'overwrite files that exist',
        ex: 'forge photo.png --to jpg --force',
      },
      {
        name: '--concurrency <n>',
        does: 'how many files at once',
        ex: 'forge photos/ --to webp --concurrency 4',
      },
      {
        name: '--preset <name>',
        does: 'run a preset saved from Done',
        ex: 'forge photo.png --preset blog',
      },
      { name: '--formats', does: 'list every supported format', ex: 'forge --formats' },
      { name: '--json', does: 'print JSON instead of text', ex: 'forge photo.png --to jpg --json' },
      {
        name: '--debug',
        does: 'show the underlying errors',
        ex: 'forge photo.png --to jpg --debug',
      },
    ],
  },
  {
    name: 'Edit',
    items: [
      {
        name: '--resize <percent>',
        does: 'a percent of the size, 1–200',
        ex: 'forge photo.jpg --resize 50%',
      },
      {
        name: '--width <px>',
        does: 'a width; the height follows',
        ex: 'forge photo.jpg --width 1200',
      },
      {
        name: '--height <px>',
        does: 'a height; the width follows',
        ex: 'forge photo.jpg --height 800',
      },
      {
        name: '--crop <W:H>',
        does: 'cut to a shape, keeping the subject',
        ex: 'forge photo.jpg --crop 4:5',
      },
      { name: '--trim', does: 'cut transparent or plain edges', ex: 'forge logo.png --trim' },
      {
        name: '--boost [2|3|4]',
        does: 'sharpen and enlarge · boost',
        ex: 'forge photo.jpg --boost 3',
      },
      {
        name: '--sharpen',
        does: 'sharpen at the same size · boost',
        ex: 'forge photo.jpg --sharpen',
      },
      {
        name: '--remove-bg',
        does: 'cut out the subject · remove-background',
        ex: 'forge portrait.jpg --remove-bg',
      },
    ],
  },
  {
    name: 'PDF',
    items: [
      { name: '--merge', does: 'combine PDFs into one', ex: 'forge a.pdf b.pdf --merge' },
      {
        name: '--split <mode>',
        does: 'every-page, every=N or at=N,N',
        ex: 'forge book.pdf --split every=10',
      },
      {
        name: '--extract <pages>',
        does: 'keep only these pages',
        ex: 'forge book.pdf --extract 3-7,12',
      },
      { name: '--delete <pages>', does: 'drop these pages', ex: 'forge book.pdf --delete 2' },
      { name: '--rotate <degrees>', does: '90, 180 or 270', ex: 'forge scan.pdf --rotate 90' },
      {
        name: '--separate',
        does: 'with --extract, one file per page',
        ex: 'forge book.pdf --extract 1-3 --separate',
      },
      {
        name: '--pages <ranges>',
        does: 'which pages to turn into images',
        ex: 'forge book.pdf --to png --pages 3-7',
      },
      {
        name: '--dpi <n>',
        does: 'image resolution, 36–600',
        ex: 'forge book.pdf --to png --dpi 300',
      },
      {
        name: '--password-stdin',
        does: "read an encrypted PDF's password",
        ex: 'echo "$PW" | forge locked.pdf --to png --password-stdin',
      },
    ],
  },
  {
    name: 'Media',
    items: [
      {
        name: '--cut <start-end>',
        does: 'keep from start to end',
        ex: 'forge talk.mp4 --cut 0:03.2-0:41',
      },
      { name: '--mute', does: 'take the sound out of a video', ex: 'forge clip.mp4 --mute' },
      { name: '--speed <x>', does: 'faster or slower, 0.25–4', ex: 'forge talk.mp4 --speed 1.5' },
      {
        name: '--fps <n>',
        does: 'frames per second of a video',
        ex: 'forge clip.mov --to mp4 --fps 30',
      },
      {
        name: '--bitrate <kbps>',
        does: 'bitrate of a sound file',
        ex: 'forge song.wav --to mp3 --bitrate 128k',
      },
      {
        name: '--loudness <LUFS>',
        does: 'even out the loudness',
        ex: 'forge talk.mp3 --loudness -16',
      },
    ],
  },
  {
    name: 'Tools',
    items: [
      {
        name: 'probe <files>',
        does: 'what a file is and what Forge can do with it',
        ex: 'forge probe scan.pdf --json',
      },
      {
        name: 'palette <image>',
        does: "an image's main colours",
        ex: 'forge palette photo.jpg --svg',
      },
      {
        name: 'scale <colour>',
        does: '50–950 from one colour',
        ex: 'forge scale "#3b82f6" --json',
      },
      {
        name: 'clip',
        does: 'compress the copied image and put it back',
        ex: 'forge clip --to webp',
      },
      {
        name: 'watch <folder>',
        does: 'convert a folder, then each file added to it',
        ex: 'forge watch ~/Downloads --to webp',
      },
      {
        name: 'transcribe <file | link>',
        does: 'a video, sound or YouTube link into Markdown',
        ex: 'forge transcribe talk.mp4 --detail brief',
      },
    ],
  },
  {
    name: 'Setup',
    items: [
      {
        name: 'config [list | path | set]',
        does: "read or change Forge's settings",
        ex: 'forge config set output ~/Desktop',
      },
      {
        name: 'extensions [add | remove]',
        does: 'optional extras, such as boost',
        ex: 'forge extensions add boost',
      },
      { name: 'update', does: 'install a newer Forge', ex: 'forge update' },
      {
        name: 'uninstall',
        does: 'take Forge out of right-click, then remove it',
        ex: 'forge uninstall',
      },
      {
        name: 'mcp',
        does: 'run as a local MCP server for AI agents',
        ex: 'claude mcp add forge -- forge mcp',
      },
    ],
  },
]

const CLI_COMMAND: Command = {
  name: 'cli',
  description: 'run Forge from the terminal',
  needsSource: false,
  group: 'settings',
}

/* -------------------------------------------------------------- the cells */

interface Cell {
  ch: string
  fg?: string
  bg?: string
  b?: boolean
}
const cellsOf = (row: Row): Cell[] =>
  row.flatMap((r: Run) => [...r.text].map((ch) => ({ ch, fg: r.fg, bg: r.bg, b: r.bold })))

const run = (text: string, fg?: string, bg?: string, bold = false): Run => ({
  text,
  ...(fg ? { fg } : {}),
  ...(bg ? { bg } : {}),
  ...(bold ? { bold: true } : {}),
})

/** `row` padded with blanks to exactly `n` columns, the blanks on `bg`. */
const pad = (row: Row, n: number, bg?: string): Row => [
  ...row,
  { text: ' '.repeat(Math.max(0, n - rowWidth(row))), ...(bg ? { bg } : {}) },
]
const onBand = (row: Row, bg: string): Row => row.map((r) => ({ ...r, bg: r.bg ?? bg }))

/* ---------------------------------------------------------- the list rows */

const NAME = 28

type Layout = 'A' | 'B' | 'C'

interface Look {
  p: Palette
  tab: number
  at: number
  layout: Layout
}

/** The tab bar: aboutTabRows with the names as a parameter. */
function tabRows(p: Palette, at: number): Row[] {
  const names: Row = [blank(HOME_MARGIN)]
  const rule: Row = [blank(HOME_MARGIN)]
  let used = 0
  TABS.forEach((t, i) => {
    const on = i === at
    const w = t.name.length + 4
    names.push({ text: `  ${t.name}  `, fg: on ? p.fg : p.dim, bold: on })
    rule.push({ text: (on ? '━' : '─').repeat(w), fg: on ? p.brand : p.faint })
    used += w
  })
  rule.push({ text: '─'.repeat(Math.max(0, IN - HOME_MARGIN * 2 - used)), fg: p.faint })
  return [names, rule]
}

/** A row the width of the list, minus the scroll bar's two columns. */
const LIST_W = IN - 2

/** The menu's chosen row: a ▌ strip in the gold, the band across. */
function chosenRow(p: Palette, parts: Run[]): Row {
  return onBand(pad([run('▌', p.brand), blank(1), ...parts], LIST_W), p.panelBand)
}

/** Layout A: every row says what it does, none is chosen; the list only scrolls. */
function rowA(p: Palette, it: Item): Row {
  return [
    blank(2),
    run(it.name.padEnd(NAME), p.fg, undefined, true),
    run(clip(it.does, LIST_W - 2 - NAME), p.dim),
  ]
}

/** Layout B: names only; the chosen one opens into what it does and an example, in the band. */
function rowsB(p: Palette, it: Item, chosen: boolean): Row[] {
  if (!chosen) return [[blank(2), run(it.name, p.dim)]]
  return [
    chosenRow(p, [run(it.name, p.fg, undefined, true)]),
    onBand(pad([blank(4), run(it.does, p.dim)], LIST_W), p.panelBand),
    onBand(pad([blank(4), run('$ ', p.brand), run(it.ex, p.fg)], LIST_W), p.panelBand),
  ]
}

/** Layout C: every row says what it does; the chosen one is banded and its example sits under the list. */
function rowC(p: Palette, it: Item, chosen: boolean): Row {
  return chosen
    ? chosenRow(p, [
        run(it.name.padEnd(NAME), p.fg, undefined, true),
        run(clip(it.does, LIST_W - 2 - NAME), p.dim),
      ])
    : [blank(2), run(it.name.padEnd(NAME), p.dim), run(clip(it.does, LIST_W - 2 - NAME), p.border)]
}

/**
 * The list's lines in a window of `room`, with the menu's scroll bar on the
 * last column and "↓ n more" under it for only what is still below.
 */
function windowed(p: Palette, lines: Row[], room: number, start = 0): Row[] {
  const shown = lines.slice(start, start + room)
  const out: Row[] = [...shown]
  if (lines.length > room) {
    const thumb = Math.max(1, Math.round((room * room) / lines.length))
    const top = Math.round((start / (lines.length - room)) * (room - thumb))
    shown.forEach((row, i) => {
      const bar: Run = i >= top && i < top + thumb ? run('┃', p.dim) : run('│', p.faint)
      out[i] = [...pad(row, IN - 1), bar]
    })
    const below = lines.length - start - room
    const note = `↓ ${below} more`
    out.push(below > 0 ? [blank(IN - 1 - stringWidth(note)), run(note, p.dim)] : [])
  }
  return out
}

/** The example strip under layout C's list: a shelf like the home field's, with the command. */
function exampleStrip(p: Palette, it: Item): Row[] {
  const bg = p.shelf === '' ? p.keycapBg : p.shelf
  const line = (parts: Run[]): Row => onBand(pad([blank(2), ...parts], IN - 2), bg)
  return [
    [],
    [blank(HOME_MARGIN), ...line([run('$ ', p.brand, bg, true), run(it.ex, p.fg, bg)]).slice(1)],
  ]
}

/** The 15 body rows of a tab. */
function tabBody(look: Look): Row[] {
  const { p, tab, at, layout } = look
  const items = TABS[tab]?.items ?? []
  const [names, rule] = tabRows(p, tab)
  const out: Row[] = [names ?? [], rule ?? [], []]
  const room = BODY - out.length
  if (layout === 'A') {
    out.push(
      ...windowed(
        p,
        items.map((it) => rowA(p, it)),
        room - 1,
      ),
    )
  } else if (layout === 'B') {
    const lines = items.flatMap((it, i) => rowsB(p, it, i === at))
    out.push(...windowed(p, lines, room - 1))
  } else {
    const lines = items.map((it, i) => rowC(p, it, i === at))
    const list = windowed(p, lines, room - 3)
    while (list.length < room - 3 + 1) list.push([])
    out.push(...list, ...exampleStrip(p, items[at] as Item))
  }
  return out
}

/* ------------------------------------------------------------- the popup */

const KEYS: Record<Layout, [string, string][]> = {
  A: [
    ['↑↓', 'scroll'],
    ['←→', 'category'],
  ],
  B: [
    ['↑↓', 'choose'],
    ['←→', 'category'],
  ],
  C: [
    ['↑↓', 'choose'],
    ['←→', 'category'],
    ['↵', 'copy example'],
  ],
}
const MENU_KEYS: [string, string][] = [
  ['↑↓', 'choose'],
  ['↵', 'open'],
]

function keyRow(p: Palette, main: [string, string][]): Row {
  const row: Row = [blank(1)]
  main.forEach(([k, w], i) => {
    if (i) row.push(blank(2))
    row.push(run(` ${k} `, p.fg, p.keycapBg, true), run(` ${w}`, p.dim))
  })
  const foot = 'esc back · ctrl-c quit'
  row.push(blank(Math.max(1, N - rowWidth(row) - stringWidth(foot) - 1)), run(foot, p.border))
  return row
}

/** The whole window: the box, then the hint, the rule and the keys. */
function popup(
  p: Palette,
  trail: string,
  typed: string,
  body: Row[],
  keys: [string, string][],
): Cell[][] {
  const edge = p.brand
  const fill = p.selectionBg
  const field = p.shelf === '' ? p.keycapBg : p.shelf
  const bar = trailBarRow({
    width: IN,
    palette: p,
    mode: 'convert',
    trail: { answers: [], current: trail },
    slanted: false,
    chip: { label: 'menu', colour: edge, stops: modeGradient(p, 'menu') },
  })
  const side = (r: Row): Row =>
    [
      run('│', edge),
      blank(1),
      ...pad(r, IN).map((x) => ({ ...x, bg: x.bg ?? fill })),
      run(' ', undefined, fill),
      run('│', edge),
    ].map((x) => ({ ...x, bg: x.bg ?? fill }))
  const fieldRow: Row = pad(
    [run('  ', undefined, field), run('›', edge, field, true), run(` ${typed}`, p.fg, field)],
    IN,
    field,
  )
  const box: Row[] = [
    [run(`╭${'─'.repeat(POP_W - 2)}╮`, edge, fill)],
    side(bar),
    side([]),
    ...Array.from({ length: BODY }, (_, i) => side(body[i] ?? [])),
    side([]),
    side(fieldRow),
    [run(`╰${'─'.repeat(POP_W - 2)}╯`, edge, fill)],
  ].map((r, i) => (i === 0 || i === 20 ? r : r))
  const rows: Row[] = [
    ...box.map((r) => [blank(1), ...r]),
    menuHintRow({ palette: p, width: N, open: true }),
    [run('─'.repeat(N), p.border)],
    keyRow(p, keys),
  ]
  return rows.slice(0, H).map(cellsOf)
}

/* ------------------------------------------------------------- the screens */

/** The menu list with the new row chosen. */
function menuScreen(p: Palette): Cell[][] {
  const items = [
    ...COMMANDS.filter((c) => c.group === 'settings'),
    ...COMMANDS.filter((c) => c.group === 'modes'),
  ]
  // The new row sits after /right-click.
  const at = items.findIndex((c) => c.name === 'right-click')
  items.splice(at + 1, 0, CLI_COMMAND)
  const selected = items.indexOf(CLI_COMMAND)
  const body = menuListRows({
    palette: p,
    width: IN,
    items,
    query: '',
    typed: '',
    selected,
    rows: BODY,
  })
  return popup(p, '', '/', body, MENU_KEYS)
}

function cliScreen(look: Look): Cell[][] {
  return popup(look.p, 'cli', '/cli', tabBody(look), KEYS[look.layout])
}

/* ---------------------------------------------------------------- the page */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
function html(rows: Cell[][], p: Palette): string {
  return rows
    .map((cells) => {
      let out = ''
      for (const c of cells) {
        const st = [
          `color:${c.fg || p.fg}`,
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
const term = (p: Palette, rows: Cell[][]) =>
  `<div class="t" style="background:${p === LIGHT ? '#ffffff' : '#1e1e1e'}">${html(rows, p)}</div>`

const fig = (cap: string, p: Palette, rows: Cell[][]) =>
  `<div class="col">${term(p, rows)}<div class="cap">${esc(cap)}</div></div>`

const LAYOUTS: { id: Layout; name: string; idea: string; pick?: boolean }[] = [
  {
    id: 'A',
    name: 'A plain list',
    idea: 'Every row is a flag and what it does, like Attributions. Nothing is chosen; ↑↓ only scrolls. The calmest, and the closest to a page of --help.',
  },
  {
    id: 'B',
    name: 'The chosen row opens',
    idea: 'Only the names are listed, as the menu lists its commands. The chosen row opens inside its band into what it does and a real example. Short to scan; you must walk down to learn.',
  },
  {
    id: 'C',
    name: 'A list and an example strip',
    idea: 'Every row says what it does, the chosen one is banded, and its example sits under the list on a shelf like the home field. ↵ copies the example. You can scan and also take something away.',
    pick: true,
  },
]

const optionFigs = LAYOUTS.map(
  (
    l,
  ) => `<figure><div class="vt"><span class="id">${l.id}</span><span class="name">${l.name}</span>${l.pick ? '<span class="pick">RECOMMENDED</span>' : ''}</div>
<p class="idea">${esc(l.idea)}</p>
<div class="row">${fig('Convert · 3rd row chosen', DARK, cliScreen({ p: DARK, tab: 0, at: 2, layout: l.id }))}</div></figure>`,
).join('\n')

const tabFigs = TABS.map((t, i) =>
  fig(
    `${i + 1} · ${t.name}`,
    DARK,
    cliScreen({ p: DARK, tab: i, at: i === 0 ? 2 : 0, layout: 'C' }),
  ),
).join('\n')

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · /cli</title>
<style>
  body { margin:0; background:#0d0e11; color:#e2e4ea; font:16px/1.6 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  main { max-width:1900px; margin:0 auto; padding:44px 24px 120px; }
  h1 { font-size:30px; margin:0 0 8px; } h2 { font-size:21px; margin:56px 0 4px; }
  .lede { color:#8f94a1; max-width:1000px; margin:0; }
  .box { border:1px solid #2c2f37; border-radius:10px; padding:14px 18px; margin:22px 0 0; max-width:1000px; background:#14161b; }
  .box h3 { margin:0 0 6px; font-size:14px; letter-spacing:.06em; text-transform:uppercase; color:#8f94a1; }
  .box ol, .box ul { margin:6px 0 0 20px; padding:0; } .box li { margin:4px 0; }
  figure { margin:36px 0 0; }
  .vt { display:flex; align-items:baseline; gap:10px; margin-bottom:6px; }
  .vt .id { font:700 12px "SF Mono", ui-monospace, Menlo, monospace; padding:3px 7px; border-radius:6px; background:#12282e; color:#55c7d9; }
  .vt .name { font-weight:620; }
  .vt .pick { font:600 11px "SF Mono", ui-monospace, Menlo, monospace; letter-spacing:.08em; color:#6fcf7f; border:1px solid #2c5a37; padding:2px 7px; border-radius:6px; }
  .idea { font-size:14.5px; color:#c7cbd4; margin:6px 0 12px; max-width:1000px; }
  .row { display:flex; flex-wrap:wrap; gap:28px; margin-top:14px; }
  .col { display:flex; flex-direction:column; gap:10px; }
  .cap { font:13px "SF Mono", ui-monospace, Menlo, monospace; color:#8f94a1; }
  .t { font:13px/1 "SF Mono", ui-monospace, Menlo, monospace; padding:12px 14px; border-radius:10px; border:1px solid #2c2f37; width:max-content; }
  .r { height:17px; white-space:pre; } .r > span { display:inline-block; height:17px; line-height:17px; }
  code { font:13px "SF Mono", ui-monospace, Menlo, monospace; color:#c7cbd4; }
</style></head><body><main>
<h1>/cli: Forge in the terminal, by category</h1>
<p class="lede">A settings row in the menu that lists every flag and subcommand, one tab per category. The window is 80 × 24, dark first, drawn from the app’s own art. The box, its bar and its keys are the menu popup’s, as /about’s are.</p>

<div class="box"><h3>Decided</h3><ul>
<li>It is a settings row, and it opens inside the menu’s box like /about.</li>
<li>Grouped by category, one tab each. The README stays the full reference; this lists names and one line each, not every behaviour.</li>
<li>The rows are generated from the same table <code>--help</code> reads, so a new flag cannot be forgotten (a build detail, not on screen).</li></ul></div>

<div class="box"><h3>Open questions</h3><ol>
<li><b>How does a row read?</b> A, B or C below, pick one. I recommend C.</li>
<li><b>Does ↵ copy the example?</b> In C it does. It would use the clipboard code the shell already has. Say if you would rather it only be read.</li>
<li><b>The name and its menu line.</b> I used <code>/cli</code>, and “run Forge from the terminal” on its row (the word “commands” is kept for the menu’s own entries). Both strings are mine.</li>
<li><b>The six tab names.</b> Convert, Edit, PDF, Media, Tools, Setup. “Tools” holds probe, palette, scale, clip, watch and transcribe; “Setup” holds config, extensions, update, uninstall and mcp. Every tab name and row string on this page is mine, to be approved before it is built.</li>
<li><b>/right-click and /theme.</b> Neither has a command of its own (the theme is <code>forge config set theme</code>), so they have no row. Leave them out, or add a line for each in Setup?</li></ol></div>

<h2>SCREEN: the menu with the new row</h2>
<p class="lede">The row sits after /right-click. Only the chosen row says what it does, as every row does.</p>
<div class="row">${fig('/ menu · /cli chosen', DARK, menuScreen(DARK))}${fig('light', LIGHT, menuScreen(LIGHT))}</div>

<h2>OPTIONS: how a row reads</h2>
<p class="lede">A, B or C, pick one. The Convert category, third row chosen.</p>
${optionFigs}

<h2>FLOW: the six categories, in option C</h2>
<p class="lede">← → moves between categories, left to right. The first screen is also shown in the light theme.</p>
<div class="row">${tabFigs}${fig('1 · Convert, light', LIGHT, cliScreen({ p: LIGHT, tab: 0, at: 2, layout: 'C' }))}</div>
</main></body></html>`

writeFileSync('mockups/cli-2026-10.html', page)
console.log('wrote mockups/cli-2026-10.html')
