/**
 * /menu (2026-10-17): the right-click menu in Forge's settings, where it can
 * be switched off and on, and where the command to remove Forge is shown.
 *
 * Built on cells captured from the real app at 80 × 24 (the settings screen
 * /extensions and the commands list, in /tmp/forge-finder/frames-dark.json),
 * edited in place.
 *
 *   npx tsx scripts/menu-settings-mockup.ts   → mockups/menu-settings-2026-10.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import stringWidth from 'string-width'

interface Cell {
  ch: string
  fg: string | null
  bg: string | null
  b: boolean
}
type Frame = Cell[][]

const F = JSON.parse(readFileSync('/tmp/forge-finder/frames-dark.json', 'utf8')) as Record<
  string,
  Frame
>

const C = {
  canvas: '#1e1e1e',
  fg: '#e7e7e7',
  dim: '#b0b0b0',
  border: '#808080',
  rule: '#4d4d4d',
  ink: '#0c1d22',
  ok: '#6fcf7f',
  listBand: '#323232',
  panelBand: '#404040',
  keycap: '#333333',
  settings: '#e5a23c',
  field: '#2c2c2c',
}
const MODE = { forge: '#a68ce0', convert: '#55c7d9', compress: '#79c98b', edit: '#b39ae8', pdf: '#ff6b4a' }

const get = (k: string): Frame => structuredClone(F[k] as Frame)
const textOf = (row: Cell[]) => row.map((c) => c.ch).join('')
const blankRow = (n = 80, bg: string | null = C.canvas): Cell[] =>
  Array.from({ length: n }, () => ({ ch: ' ', fg: null, bg, b: false }))

function put(f: Frame, r: number, c: number, s: string, fg: string | null, bg?: string | null, b = false) {
  ;[...s].forEach((ch, i) => {
    const under = f[r]?.[c + i]
    if (!under) return
    f[r]![c + i] = { ch, fg, bg: bg === undefined ? under.bg : bg, b }
  })
}
function fill(f: Frame, r: number, c0: number, c1: number, ch: string, fg: string | null, bg: string | null) {
  for (let c = c0; c < c1; c++) if (f[r]?.[c]) f[r]![c] = { ch, fg, bg, b: false }
}
/** Writes runs left to right from column `c`. */
function runs(f: Frame, r: number, c: number, parts: [string, string | null, boolean?, string?][]) {
  for (const [t, fg, b, bg] of parts) {
    put(f, r, c, t, fg, bg ?? undefined, !!b)
    c += stringWidth(t)
  }
  return c
}

function settingsHeader(f: Frame, chip: string) {
  f[1] = blankRow()
  put(f, 1, 4, ` ${chip} `, C.ink, C.settings, true)
  const from = 4 + stringWidth(chip) + 3
  for (let x = from; x < 76; x++) {
    const k = (x - from) / (76 - from)
    const a = [0xe7, 0xaa, 0x44]
    const b = [0xf0, 0xca, 0x65]
    const hex = `#${a.map((v, i) => Math.round(v + ((b[i] as number) - v) * k).toString(16).padStart(2, '0')).join('')}`
    put(f, 1, x, '╱', hex, C.canvas)
  }
}

function keys(f: Frame, main: [string, string][], foot = 'esc back · ctrl-c quit', at = 4) {
  const r = f.length - 1
  f[r] = blankRow()
  let c = at
  main.forEach(([k, w], i) => {
    if (i) c += 2
    put(f, r, c, ` ${k} `, C.fg, C.keycap, true)
    c += stringWidth(k) + 2
    put(f, r, c, ` ${w}`, C.dim, C.canvas)
    c += stringWidth(w) + 1
  })
  put(f, r, 77 - stringWidth(foot), foot, C.border, C.canvas)
}

/** An empty settings screen: the extensions frame, cleared below its header. */
function screen(chip: string): Frame {
  const f = get('extensions')
  settingsHeader(f, chip)
  for (let r = 2; r < 22; r++) f[r] = blankRow()
  return f
}

type Os = 'mac' | 'win'
const WHERE: Record<Os, [string, string | null, boolean?][]> = {
  mac: [
    ['In Finder: right-click a file ', C.dim],
    ['›', C.border],
    [' Quick Actions', C.fg],
  ],
  win: [
    ['In Explorer: Show more options ', C.dim],
    ['›', C.border],
    [' Forge', C.fg],
  ],
}

/** The items, each with its mode's colour on a slash, grouped by what is right-clicked. */
function itemRows(f: Frame, r: number, c: number, dimmed = false) {
  const tone = (hex: string) => (dimmed ? C.rule : hex)
  const name = dimmed ? C.border : C.fg
  const rows: [string, [string, string][]][] = [
    [
      'An image',
      [
        ['Open Forge', MODE.forge],
        ['Convert in Forge', MODE.convert],
        ['Compress in Forge', MODE.compress],
        ['Sharpen in Forge', MODE.edit],
      ],
    ],
    [
      'A folder',
      [
        ['Open Forge', MODE.forge],
        ['Convert in Forge', MODE.convert],
        ['Compress in Forge', MODE.compress],
      ],
    ],
    ['A PDF', [['Open in Forge', MODE.pdf]]],
  ]
  let row = r
  for (const [what, items] of rows) {
    put(f, row, c, what, C.border, C.canvas)
    items.forEach(([label, hex], i) => {
      runs(f, row + i, c + 12, [
        ['╱ ', tone(hex), true],
        [label, name],
      ])
    })
    row += items.length + 1
  }
  return row
}

/** The items, one line per thing right-clicked, for a layout short of rows. Returns the row after. */
function itemLines(f: Frame, r: number, c: number, dimmed = false) {
  const tone = (hex: string) => (dimmed ? C.rule : hex)
  const name = dimmed ? C.border : C.fg
  const rows: [string, [string, string][]][] = [
    ['An image', [['Open', MODE.forge], ['Convert', MODE.convert], ['Compress', MODE.compress], ['Sharpen', MODE.edit]]],
    ['A folder', [['Open', MODE.forge], ['Convert', MODE.convert], ['Compress', MODE.compress]]],
    ['A PDF', [['Open in Forge', MODE.pdf]]],
  ]
  rows.forEach(([what, items], i) => {
    put(f, r + i, c, what, C.border, C.canvas)
    let x = c + 12
    for (const [label, hex] of items) {
      x = runs(f, r + i, x, [['╱ ', tone(hex), true], [label, name], ['   ', null]])
    }
  })
  return r + rows.length
}

/* ------------------------------------------------------------ variants */

/** A key hint in place: the key on a grey cap, its word after it. Returns the column after. */
function cap(f: Frame, r: number, c: number, key: string, word: string) {
  put(f, r, c, ` ${key} `, C.fg, C.keycap, true)
  put(f, r, c + stringWidth(key) + 2, ` ${word}`, C.dim, C.canvas)
  return c + stringWidth(key) + 3 + stringWidth(word)
}

/** The switch, with ↵ beside it saying what it does. */
function switchRow(f: Frame, r: number, c: number, on: boolean, label = true) {
  let x = c
  if (label) x = runs(f, r, c, [['Right-click menu', C.fg, true], ['   ', null]])
  x = runs(f, r, x, [[on ? '● on' : '○ off', on ? C.ok : C.border, on], ['    ', null]])
  cap(f, r, x, '↵', on ? 'turn off' : 'turn on')
}

/** Why the uninstall command is on this screen: the user's words (2026-10-17), per platform. */
type Why = Os
const WHY_TEXT: Record<Os, string> = {
  mac: 'npm uninstall won’t remove Forge from your Mac’s Quick Actions. To remove it, run the command below to uninstall Forge and delete any remaining settings.',
  win: 'npm uninstall won’t remove Forge from your PC’s right-click menu. To remove it, run the command below to uninstall Forge and delete any remaining settings.',
}
const HEAD = 'Uninstalling Forge'

/** `text` broken into lines of at most `width` cells, at spaces. */
function wrap(text: string, width: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line && stringWidth(`${line} ${word}`) > width) {
      out.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) out.push(line)
  return out
}

/** The heading, the reason in dim lines, the command with c beside it. Returns the row after. */
function uninstallBlock(f: Frame, r: number, c: number, width: number, os: Os) {
  put(f, r, c, HEAD, C.fg, C.canvas, true)
  const lines = wrap(WHY_TEXT[os], width)
  lines.forEach((l, i) => put(f, r + 1 + i, c, l, C.dim, C.canvas))
  commandRow(f, r + 2 + lines.length, c)
  return r + 3 + lines.length
}

/** The command on its field, c beside it. */
function commandRow(f: Frame, r: number, c: number) {
  const x = runs(f, r, c, [[' forge uninstall ', C.fg, false, C.field], ['   ', null]])
  cap(f, r, x, 'c', 'copy')
}

/** S1: one screen, top to bottom: the switch, what it adds, where, then uninstalling. */
function s1(on: boolean, os: Os = 'mac'): Frame {
  const f = screen('right-click')
  switchRow(f, 3, 6, on)
  fill(f, 4, 6, 74, '─', C.rule, C.canvas)
  const next = itemLines(f, 6, 6, !on)
  if (on) runs(f, next + 1, 6, WHERE[os])
  fill(f, 13, 6, 74, '─', C.rule, C.canvas)
  uninstallBlock(f, 15, 6, 68, os)
  keys(f, [])
  return f
}

/** S2: two panes, as /extensions: rows on the left, the lit row's details on the right. */
function s2(lit: 0 | 1, on = true, os: Os = 'mac'): Frame {
  const f = screen('right-click')
  const rows: [string, string][] = [
    ['Right-click menu', on ? '●' : '○'],
    ['Uninstalling Forge', ''],
  ]
  rows.forEach(([name, mark], i) => {
    const r = 3 + i
    const isLit = i === lit
    const bg = isLit ? C.listBand : C.canvas
    fill(f, r, 4, 31, ' ', null, bg)
    if (isLit) put(f, r, 4, '▌', C.settings, bg)
    put(f, r, 6, name, isLit ? C.fg : C.dim, bg, isLit)
    if (mark) put(f, r, 29, mark, mark === '●' ? C.fg : C.border, bg, mark === '●')
  })
  for (let r = 3; r < 20; r++) put(f, r, 32, '│', C.rule, C.canvas)
  if (lit === 0) {
    put(f, 3, 35, 'Right-click menu', C.fg, C.canvas, true)
    switchRow(f, 4, 35, on, false)
    const next = itemRows(f, 6, 35, !on)
    if (on)
      runs(
        f,
        next,
        35,
        WHERE[os].map(([t, c]) => [t.replace(': right-click a file', ''), c] as [string, string | null]),
      )
  } else uninstallBlock(f, 3, 35, 40, os)
  keys(f, [['↑↓', 'choose']])
  return f
}

/** S3: the menu drawn as Finder shows it, the switch above it. */
function s3(on: boolean, os: Os = 'mac'): Frame {
  const f = screen('right-click')
  switchRow(f, 3, 6, on)
  const box = (r0: number, c0: number, w: number, lines: [string, string | null, string?][], lit = -1) => {
    put(f, r0, c0, `╭${'─'.repeat(w - 2)}╮`, C.rule, C.canvas)
    lines.forEach(([t, fg, mark], i) => {
      const r = r0 + 1 + i
      const bg = i === lit ? C.panelBand : C.field
      put(f, r, c0, '│', C.rule, C.canvas)
      fill(f, r, c0 + 1, c0 + w - 1, ' ', null, bg)
      if (mark) put(f, r, c0 + 2, '╱', on ? mark : C.rule, bg, true)
      put(f, r, c0 + (mark ? 4 : 2), t, on ? fg : C.border, bg, i === lit)
      put(f, r, c0 + w - 1, '│', C.rule, C.canvas)
    })
    put(f, r0 + 1 + lines.length, c0, `╰${'─'.repeat(w - 2)}╯`, C.rule, C.canvas)
  }
  box(5, 6, 22, [
    ['Open', C.dim],
    ['Get Info', C.dim],
    ['Rename', C.dim],
    ['Copy', C.dim],
    ['Quick Actions     ›', C.fg],
  ], 4)
  box(8, 28, 26, [
    ['Rotate Left', C.dim],
    ['Markup', C.dim],
    ['Open Forge', C.fg, MODE.forge],
    ['Convert in Forge', C.fg, MODE.convert],
    ['Compress in Forge', C.fg, MODE.compress],
    ['Sharpen in Forge', C.fg, MODE.edit],
  ])
  uninstallBlock(f, 16, 6, 68, os)
  keys(f, [])
  return f
}

/** S4: the least: the state with its switch, the command with its copy. */
function s4(on: boolean, os: Os = 'mac'): Frame {
  const f = screen('right-click')
  const x = runs(
    f,
    4,
    6,
    on
      ? [['● ', C.ok, true], ['Forge is in Finder’s Quick Actions', C.fg, true], ['    ', null]]
      : [['○ ', C.border], ['Forge is not in Finder’s Quick Actions', C.dim], ['    ', null]],
  )
  cap(f, 4, x, '↵', on ? 'turn off' : 'turn on')
  uninstallBlock(f, 7, 6, 68, os)
  keys(f, [])
  return f
}

/** Where /menu sits: the commands list's Settings group. */
/** The home tabs with "/ commands" renamed "/ menu" (and the mode once called enhance, edit). */
function renamedTabs(f: Frame) {
  // Laid out again, three cells apart as the app spaces them: the words got shorter.
  f[7] = blankRow()
  const tabs: [string, string][] = [
    ['1', 'convert'],
    ['2', 'compress'],
    ['3', 'pdf'],
    ['4', 'edit'],
    ['5', 'colour'],
    ['/', 'menu'],
  ]
  let c = 5
  for (const [n, word] of tabs) {
    const on = n === '/'
    const bg = on ? '#262626' : C.canvas
    if (on) fill(f, 7, c - 1, c + n.length + 1 + word.length + 1, ' ', null, bg)
    put(f, 7, c, n, on ? C.settings : C.border, bg, on)
    put(f, 7, c + n.length + 1, word, on ? C.fg : C.dim, bg, on)
    c += n.length + 1 + word.length + 3
  }
}

/** The / menu: Settings first, then Modes, as asked; `typed` narrows it. */
function commands(typed?: string): Frame {
  const f = get('commands')
  renamedTabs(f)
  for (let r = 9; r < 19; r++) f[r] = blankRow()
  const group = (r: number, name: string) => {
    put(f, r, 8, `${name} `, C.border, C.canvas)
    fill(f, r, 8 + name.length + 1, 72, '─', C.rule, C.canvas)
  }
  const row = (r: number, cmd: string, what: string, lit: boolean) => {
    const bg = lit ? C.listBand : C.canvas
    fill(f, r, 6, 72, ' ', null, bg)
    if (lit) put(f, r, 6, '▌', C.settings, bg)
    put(f, r, 8, cmd, lit ? C.fg : C.dim, bg, lit)
    put(f, r, 22, what, lit ? C.dim : C.border, bg)
  }
  const settings: [string, string][] = [
    ['/theme', 'switch between light and dark'],
    ['/extensions', 'install and remove the AI tools'],
    ['/right-click', 'Forge in the right-click menu'],
    ['/update', 'check for a new version'],
    ['/about', 'who made Forge, and what it is built on'],
  ]
  const r = f.findIndex((x) => textOf(x).includes('› /'))
  if (typed) {
    group(9, 'Settings')
    row(11, '/right-click', 'Forge in the right-click menu', true)
    put(f, r, 8, typed, C.fg, undefined, true)
    return f
  }
  group(9, 'Settings')
  settings.forEach(([cmd, what], i) => row(11 + i, cmd, what, i === 0))
  group(17, 'Modes')
  put(f, 18, 67, '↓ 5 more', C.border, C.canvas)
  return f
}

/* ------------------------------------------------------------ html */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
function term(f: Frame): string {
  const rows = f
    .map((row) => {
      let out = ''
      let cur = ''
      let style = ''
      const flush = () => {
        if (cur) out += `<span style="${style}">${esc(cur)}</span>`
        cur = ''
      }
      for (const c of row) {
        const s = [c.fg ? `color:${c.fg}` : '', c.bg ? `background:${c.bg}` : '', c.b ? 'font-weight:700' : '']
          .filter(Boolean)
          .join(';')
        if (s !== style) {
          flush()
          style = s
        }
        cur += c.ch
      }
      flush()
      return `<div class="r">${out}</div>`
    })
    .join('')
  return `<div class="t">${rows}</div>`
}

interface Card {
  id: string
  name: string
  pick?: boolean
  note: string
  frames: Frame[]
}
const card = (c: Card) =>
  `<figure><div class="vt"><span class="id">${c.id}</span><span class="name">${c.name}</span>${c.pick ? '<span class="pick">MY PICK</span>' : ''}</div><div class="frames">${c.frames.map(term).join('')}</div><p class="idea">${c.note}</p></figure>`

const OPTIONS: Card[] = [
  {
    id: 'S1',
    name: 'One screen, top to bottom',
    note: 'The switch with ↵ right beside it, what it adds, where to find it; then, under a rule, uninstalling: why it is here, the command, c beside it.',
    frames: [s1(true), s1(false)],
  },
  {
    id: 'S2',
    name: 'Two panes, as /extensions',
    pick: true,
    note: 'Right-click menu: the switch with ↵ beside it, then the items. Uninstalling Forge: why the command is here, then the command with c beside it. The key row keeps only ↑↓.',
    frames: [s2(0), s2(1)],
  },
  {
    id: 'S3',
    name: 'The menu, drawn',
    note: 'Finder’s menu drawn with Quick Actions open; the switch above, uninstalling below.',
    frames: [s3(true), s3(false)],
  },
  {
    id: 'S4',
    name: 'Two lines',
    note: 'The state with ↵ beside it; uninstalling, with c beside the command.',
    frames: [s4(true), s4(false)],
  },
]

const WHYS: Card[] = [
  {
    id: 'U',
    name: 'Mac',
    note: 'Your words, wrapped to the pane.',
    frames: [s2(1, true, 'mac')],
  },
  { id: 'U·w', name: 'Windows', note: 'The same, with the PC and its right-click menu.', frames: [s2(1, true, 'win')] },
]

const QUESTIONS = [
  '<b>Layout:</b> S1, S2 (my pick), S3 or S4?',
  '<b>Off:</b> turning it off takes the items out of Finder (or Explorer) at once, and Forge does not add them back on the next start. Turning it on puts them back. Right?',
  '<b>The screen’s name:</b> “/right-click”, since “/ menu” is now the commands list’s own name? Or “/finder”, “/shortcuts”…',
  '<b>Words drawn, to approve:</b> “/ menu” (the tab, was “/ commands”) · “right-click” (the chip) · “/right-click” · “Forge in the right-click menu” (its line in the / menu) · “Right-click menu” · “on” / “off” · “turn off” / “turn on” · “An image” · “A folder” · “A PDF” · “In Finder: right-click a file › Quick Actions” · “In Explorer: Show more options › Forge” · “Uninstalling Forge” · “copy”.',
]

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · /right-click and the / menu</title>
<style>
  :root { --page:#0d0e11; --ink:#e2e4ea; --muted:#8f94a1; --rule:#23252c; --card:#14161a; --amber:#e5a23c; --mono:"SF Mono", ui-monospace, Menlo, monospace; --sans:-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--page); color:var(--ink); font:16px/1.6 var(--sans); }
  main { max-width:1760px; margin:0 auto; padding:44px 24px 120px; }
  h1 { font-size:34px; margin:0 0 6px; }
  .lede { color:var(--muted); font-size:17px; max-width:900px; margin:0; }
  .box { background:var(--card); border:1px solid var(--rule); border-radius:12px; padding:16px 20px; margin-top:22px; max-width:1100px; }
  .box h3 { margin:0 0 8px; font:600 12px var(--mono); letter-spacing:.1em; text-transform:uppercase; color:var(--amber); }
  .box li { margin:4px 0; font-size:15px; color:#c7cbd4; }
  section { margin-top:60px; }
  h2 { font-size:26px; margin:0 0 4px; }
  .kind { font:700 11px var(--mono); letter-spacing:.12em; color:var(--amber); border:1px solid #6b4f22; border-radius:6px; padding:2px 7px; margin-right:10px; vertical-align:4px; }
  .sub { color:var(--muted); margin:0 0 24px; max-width:900px; }
  .opts { display:flex; flex-direction:column; gap:40px; }
  figure { margin:0; }
  .frames { display:flex; gap:16px; flex-wrap:wrap; }
  .vt { display:flex; align-items:baseline; gap:10px; margin-bottom:8px; }
  .vt .id { font:700 12px var(--mono); padding:3px 7px; border-radius:6px; background:#33270f; color:var(--amber); }
  .vt .name { font-weight:620; }
  .vt .pick { font:600 11px var(--mono); letter-spacing:.08em; color:#6fcf7f; border:1px solid #2c5a37; padding:2px 7px; border-radius:6px; }
  .idea { font-size:14.5px; color:#c7cbd4; margin:8px 0 0; max-width:900px; }
  .t { font:13px/1 var(--mono); padding:12px 14px; border-radius:10px; border:1px solid #2c2f37; width:max-content; background:#1e1e1e; color:#e7e7e7; }
  .r { height:17px; white-space:pre; overflow:hidden; }
  .r > span { display:inline-block; height:17px; line-height:17px; vertical-align:top; }
</style></head><body><main>
<h1>/right-click, and the / menu</h1>
<p class="lede">The right-click menu in Forge’s settings: switch it off or on, see what it adds and where, and the command that removes Forge. On by default; added on first run as decided. Real app frames at 80 × 24, edited.</p>
<div class="box"><h3>Questions for you</h3><ol>${QUESTIONS.map((q) => `<li>${q}</li>`).join('')}</ol></div>

<section><h2><span class="kind">OPTIONS</span>The screen</h2>
<p class="sub">Each shown on, then off (S2: each of its two rows lit).</p>
<div class="opts">${OPTIONS.map(card).join('')}</div></section>

<section><h2><span class="kind">DECIDED</span>Why the uninstall command is here</h2>
<p class="sub">Your words. Shown in S2’s second row; the same block ends S1, S3 and S4.</p>
<div class="opts">${WHYS.map(card).join('')}</div></section>

<section><h2><span class="kind">SCREENS</span>Where it sits, and on Windows</h2>
<p class="sub">As you asked: the home tab “/ commands” is now “/ menu”, and its list puts Settings above Modes. /right-click sits under Settings, between /extensions and /update. On Windows the one line about where to look changes.</p>
<div class="opts">${card({ id: 'L', name: 'The / menu, Settings first', note: 'Unfiltered (left), and with /ri typed (right).', frames: [commands(), commands('/ri')] })}${card({ id: 'W', name: 'Windows (S2)', note: 'Explorer’s words in place of Finder’s.', frames: [s2(0, true, 'win')] })}</div></section>
</main></body></html>`

const out = new URL('../mockups/menu-settings-2026-10.html', import.meta.url)
writeFileSync(out, page)
console.log('wrote', decodeURIComponent(out.pathname))
