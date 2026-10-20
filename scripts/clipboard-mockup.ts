/**
 * Clipboard (2026-10-16): copy an image, run Forge on it, paste the result.
 *
 * Every terminal screen starts from cells captured from the real app at
 * 80 × 24 (a throwaway test wrote /tmp/forge-clip/frames-dark.json) and is
 * edited in place, so what is not about the clipboard is exactly today's app.
 *
 *   npx tsx scripts/clipboard-mockup.ts   → mockups/clipboard-2026-10.html
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

const N = 80
const F = JSON.parse(readFileSync('/tmp/forge-clip/frames-dark.json', 'utf8')) as Record<
  string,
  Frame
>

const C = {
  canvas: '#1e1e1e',
  fg: '#e7e7e7',
  dim: '#b0b0b0',
  border: '#808080',
  mode: '#79c98b',
  modeTint: '#182c1e',
  ink: '#0c1d22',
  ok: '#6fcf7f',
  listBand: '#323232',
  panelBand: '#404040',
  keycap: '#333333',
  shed: '#47774f',
  larger: '#f2994a',
  grown: '#403225',
  fail: '#e8796d',
  failTint: '#2e2020',
}

/* ------------------------------------------------------------ cell edits */

const get = (k: string): Frame => structuredClone(F[k] as Frame)
const textOf = (row: Cell[]) => row.map((c) => c.ch).join('')
const findRow = (f: Frame, s: string) => {
  const i = f.findIndex((r) => textOf(r).includes(s))
  if (i < 0) throw new Error(`no row with "${s}"`)
  return i
}
const blankRow = (): Cell[] =>
  Array.from({ length: N }, () => ({ ch: ' ', fg: null, bg: null, b: false }))

/** `s` written from column `c`; a `bg` of undefined keeps what is under it. */
function put(
  f: Frame,
  r: number,
  c: number,
  s: string,
  fg: string | null,
  bg?: string | null,
  b = false,
) {
  ;[...s].forEach((ch, i) => {
    const under = f[r]?.[c + i]
    if (!under) return
    f[r]![c + i] = { ch, fg, bg: bg === undefined ? under.bg : bg, b }
  })
}
function fill(
  f: Frame,
  r: number,
  c0: number,
  c1: number,
  ch: string,
  fg: string | null,
  bg: string | null,
) {
  for (let c = c0; c < c1; c++) f[r]![c] = { ch, fg, bg, b: false }
}
/** `from` in row `r` written over as `to`, in the style of from's first cell. */
function swap(f: Frame, r: number, from: string, to: string) {
  const i = textOf(f[r]!).indexOf(from)
  if (i < 0) throw new Error(`row ${r} has no "${from}"`)
  const s = f[r]![i]!
  put(f, r, i, to.padEnd(from.length), s.fg, s.bg, s.b)
}
const swapAll = (f: Frame, from: string, to: string) =>
  f.forEach((row, r) => {
    if (textOf(row).includes(from)) swap(f, r, from, to)
  })

/** The card's border tag: JPEG → PNG, closing the gap with the border's dash. */
function pngTag(f: Frame) {
  const r = f.findIndex((row) => /╭─ JPEG/.test(textOf(row)))
  const i = textOf(f[r]!).indexOf('JPEG')
  const space = { ...f[r]![i + 4]! }
  const dash = { ...f[r]![i + 5]! }
  put(f, r, i, 'PNG', C.mode, undefined, true)
  f[r]![i + 3] = space
  f[r]![i + 4] = dash
}
function clipCard(f: Frame) {
  pngTag(f)
  swapAll(f, 'Screenshot.jpg', 'Copied image')
  swapAll(f, '1440×900 · 1.1 MB', '2880×1800 · 4.1 MB')
}

/** The trail bar: mode chip, hatching, answers dim, the current one bold. */
function header(f: Frame, answers: string[], current: string) {
  const row = blankRow()
  f[1] = row
  const hatchAt = (c: number) => {
    const k = (c - 14) / (75 - 14)
    const a = [0x74, 0xc9, 0x96]
    const b = [0x59, 0xc7, 0xd0]
    return `#${a
      .map((v, i) =>
        Math.round(v + ((b[i] as number) - v) * k)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`
  }
  put(f, 1, 4, ' compress ', C.ink, C.mode, true)
  const parts: [string, 'a' | 'c' | 's'][] = []
  for (const a of answers) parts.push([a, 'a'], [' ╱ ', 's'])
  parts.push([current, 'c'])
  const len = parts.reduce((n, [t]) => n + stringWidth(t), 0)
  let c = 73 - len
  for (let x = 14; x < c - 1; x++) put(f, 1, x, '╱', hatchAt(x), C.canvas)
  for (const [t, k] of parts) {
    if (k === 's') put(f, 1, c + 1, '╱', hatchAt(c + 1), C.canvas)
    else put(f, 1, c, t, k === 'a' ? C.dim : C.fg, C.canvas, k === 'c')
    c += stringWidth(t)
  }
  put(f, 1, 74, '╱╱', hatchAt(74), C.canvas)
}

/** The key row: keycaps with their words, then the quiet footnote at the right. */
function keys(f: Frame, main: [string, string][], foot: string, at = 5) {
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
  const fc = 77 - stringWidth(foot)
  if (fc <= c) console.warn('key row overflows:', main, foot)
  put(f, r, fc, foot, C.border, C.canvas)
}

/* ------------------------------------------------------------ screens */

const META = 'PNG · 2880×1800 · 4.1 MB'
const AMBER = '#e5a23c'

/**
 * A key hint inside a text field (decided 2026-10-16): the key on a chip in
 * the mode's colour, the words after it in the same colour, ending two cells
 * short of the field's edge.
 */
function fieldKey(f: Frame, r: number, key: string, words: string, accent: string, ink = C.ink) {
  const bg = f[r]![8]!.bg
  const c = 74 - stringWidth(` ${key}  ${words}`)
  put(f, r, c, ` ${key} `, ink, accent, true)
  put(f, r, c + stringWidth(key) + 2, ` ${words}`, accent, bg)
}

/** Home while the clipboard holds a picture: "or type a path" stays; ⌘V at the far end. */
function homeWithHint(): Frame {
  const f = get('home')
  fieldKey(f, findRow(f, 'or type a path'), '⌘V', 'to paste from clipboard', C.mode)
  return f
}

/** Colour mode's field with its hint redrawn as the chip, in neutral grey: the swatches already carry the colour. */
function colourField(k: 'colourTyped' | 'colourScale'): Frame {
  const f = get(k)
  // the 256-colour note only shows in a terminal without true colour
  const note = f.findIndex((r) => textOf(r).includes('colours shown approximately'))
  if (note >= 0) f[note] = blankRow()
  const bg = f[4]![8]!.bg
  fill(f, 4, 22, 76, ' ', null, bg)
  if (k === 'colourTyped') fieldKey(f, 4, '↵', 'done', C.border, C.canvas)
  else fieldKey(f, 4, '⇧ →', 'gradient to a second colour', C.border, C.canvas)
  return f
}

function staged(): Frame {
  const f = get('staged')
  clipCard(f)
  swap(f, findRow(f, 'drop more'), 'drop more, or type a path', 'or type a path')
  const r = findRow(f, 'or type a path')
  fill(f, r, 8, 33, ' ', C.border, f[r]![8]!.bg)
  put(f, r, 8, 'or type a path', C.border, undefined)
  return f
}

function method(): Frame {
  const f = get('how')
  clipCard(f)
  return f
}

function quality(): Frame {
  const f = get('quality')
  clipCard(f)
  const r = findRow(f, '498 KB')
  swap(f, r, '498 KB', '1.2 MB')
  swap(f, r, '56%', '71%')
  return f
}

interface DoneOpts {
  /** Columns of the after panel, out of 72 for the larger file. */
  after: number
  title: string
  right: string
  rightColour: string
  now: string
  was: string
  grew?: boolean
}
function done(o: DoneOpts): Frame {
  const f = get('done')
  header(f, ['By quality', '80', 'Clipboard'], 'Done')
  // the format tag above the panel
  fill(f, 7, 4, 12, ' ', null, C.canvas)
  put(f, 7, 4, ' PNG ', C.mode, C.modeTint, true)
  for (const r of [8, 9, 10]) {
    if (o.grew) {
      fill(f, r, 4, 4 + o.after, ' ', null, C.panelBand)
      fill(f, r, 4 + o.after, 76, ' ', null, C.grown)
    } else {
      fill(f, r, 4, 4 + o.after, ' ', null, C.panelBand)
      fill(f, r, 4 + o.after, 76, '╱', C.shed, C.canvas)
    }
  }
  put(f, 9, 5, o.title.startsWith('✓') ? '✓' : ' ', C.ok, C.panelBand, true)
  put(f, 9, 7, o.title.replace(/^✓ /, ''), C.fg, C.panelBand, true)
  // A grown file's change sits on its own panel, just short of the growth.
  const end = o.grew ? 3 + o.after : 76
  const rc = end - stringWidth(o.right)
  const under = o.grew ? C.panelBand : C.canvas
  put(f, 9, rc - 1, ' ', null, under)
  put(f, 9, rc, o.right, o.rightColour, under, true)
  const sizes = findRow(f, 'now 498 KB')
  swap(f, sizes, 'now 498 KB', o.now)
  swap(f, sizes, 'was 1.1 MB', o.was)
  keys(
    f,
    [
      ['↵', 'compress again'],
      ['u', 'undo'],
      ['s', 'save a copy'],
      ['o', 'open'],
    ],
    'ctrl-c quit',
  )
  return f
}
const doneSmaller = () =>
  done({
    after: 21,
    title: '✓ On the clipboard',
    right: '2.9 MB saved · 71% smaller',
    rightColour: C.ok,
    now: 'now 1.2 MB',
    was: 'was 4.1 MB',
  })

function doneChanged(): Frame {
  const f = doneSmaller()
  swap(f, 9, 'On the clipboard', 'Copied image.png')
  // Too long for E5·b's one row: a padding row, the title, a gap, a row per
  // sentence, a padding row.
  for (const r of [16, 17, 18, 19, 20, 21]) {
    f[r] = blankRow()
    fill(f, r, 4, 76, ' ', null, C.failTint)
  }
  put(f, 17, 5, 'Clipboard changed', C.fail, C.failTint, true)
  put(f, 19, 5, 'The file you uploaded is no longer in the clipboard.', C.fg, C.failTint)
  put(f, 20, 5, 'The compressed image is saved to Desktop.', C.fg, C.failTint)
  keys(
    f,
    [
      ['↵', 'compress again'],
      ['o', 'open'],
      ['s', 'show in Finder'],
    ],
    'ctrl-c quit',
  )
  return f
}

function commandsClip(): Frame {
  const f = get('filtered')
  swap(f, 16, '/co', '/cl')
  const band = f[11]![8]!.bg
  fill(f, 11, 8, 20, ' ', null, band)
  put(f, 11, 8, '/clip', C.fg, band, true)
  fill(f, 12, 8, 20, ' ', null, f[12]![8]!.bg)
  put(f, 12, 8, '/', C.fg, undefined, true)
  put(f, 12, 9, 'colour', C.dim, undefined)
  fill(f, 13, 8, 20, ' ', null, f[13]![8]!.bg)
  return f
}

/** A plain shell session: `$ command` lines and Forge's printed result. */
type Line = [string, string | null, boolean?][]
function shell(lines: Line[]): Frame {
  const f: Frame = [blankRow()]
  for (const l of lines) {
    const row = blankRow()
    let c = 2
    for (const [t, fg, b] of l) {
      ;[...t].forEach((ch, i) => {
        if (row[c + i]) row[c + i] = { ch, fg, bg: null, b: !!b }
      })
      c += stringWidth(t)
    }
    f.push(row)
  }
  f.push(blankRow())
  return f
}
const $ = (cmd: string): Line => [
  ['$ ', C.border],
  [cmd, C.fg, true],
]
const cliRun = () =>
  shell([
    $('forge clip'),
    [
      ['✓ ', C.ok],
      ['Copied image', C.fg, true],
      [' → ', C.border],
      ['clipboard', C.fg],
    ],
    [
      ['  4.1 MB → 1.2 MB · ', C.dim],
      ['71% smaller', C.ok],
    ],
    [],
    $('forge clip --max-size 1mb'),
    [
      ['✓ ', C.ok],
      ['Copied image', C.fg, true],
      [' → ', C.border],
      ['clipboard', C.fg],
    ],
    [
      ['  4.1 MB → 980 KB · ', C.dim],
      ['77% smaller', C.ok],
    ],
    [],
    $('forge clip --undo'),
    [
      ['✓ ', C.ok],
      ['The original is back on the clipboard', C.fg],
    ],
  ])
const cliMore = () =>
  shell([
    $('forge clip --to jpeg'),
    [
      ['✓ ', C.ok],
      ['Copied image', C.fg, true],
      [' → ', C.border],
      ['clipboard', C.fg],
      ['  as JPEG', C.dim],
    ],
    [
      ['  4.1 MB → 610 KB · ', C.dim],
      ['85% smaller', C.ok],
    ],
    [],
    $('forge clip --save ~/Desktop'),
    [
      ['✓ ', C.ok],
      ['Copied image', C.fg, true],
      [' → ', C.border],
      ['clipboard', C.fg],
      [' + ', C.border],
      ['~/Desktop/Copied image.png', C.fg],
    ],
    [
      ['  4.1 MB → 1.2 MB · ', C.dim],
      ['71% smaller', C.ok],
    ],
    [],
    $('forge clip'),
    [
      ['✕ ', C.fail],
      ['No image', C.fail, true],
      ['   The clipboard holds text, not a picture.', C.fg],
    ],
  ])

/* ------------------------------------------------------------ html */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
function term(f: Frame): string {
  const rows = f
    .map((row) => {
      let out = ''
      let cur = ''
      let style = ''
      const flush = () => {
        if (cur)
          out += style ? `<span style="${style}">${esc(cur)}</span>` : `<span>${esc(cur)}</span>`
        cur = ''
      }
      for (const c of row) {
        const s = [
          c.fg ? `color:${c.fg}` : '',
          c.bg ? `background:${c.bg}` : '',
          c.b ? 'font-weight:700' : '',
        ]
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
  step?: string
  id?: string
  name: string
  pick?: boolean
  note: string
  body: string
}
const card = (c: Card) =>
  `<figure>${c.step ? `<div class="step">${c.step}</div>` : ''}<div class="vt">${c.id ? `<span class="id">${c.id}</span>` : ''}<span class="name">${c.name}</span>${c.pick ? '<span class="pick">MY PICK</span>' : ''}</div>${c.body}<p class="idea">${c.note}</p></figure>`
const flow = (cs: Card[]) =>
  `<div class="flow">${cs.map(card).join('<div class="arrow">→</div>')}</div>`
const options = (cs: Card[]) => `<div class="opts">${cs.map(card).join('')}</div>`

const copyArt = `<div class="art"><div class="mac">
  <div class="shot"><div class="sel"><span>2880 × 1800</span></div></div>
  <div class="kbd"><kbd>⌃</kbd><kbd>⇧</kbd><kbd>⌘</kbd><kbd>4</kbd></div>
  <div class="cap">or right-click an image → <b>Copy Image</b></div></div></div>`

const pasteArt = `<div class="art"><div class="chat">
  <div class="chathead"># design-review</div>
  <div class="msg"><div class="av"></div><div><b>you</b><div class="att"><div class="thumb"></div><div><div class="fn">Copied image.png</div><div class="fs">PNG · 1.2 MB</div></div></div></div></div>
  <div class="composer">⌘V</div></div></div>`

const clipArt = `<div class="clipbox">
  <div class="slot"><h4>1 · The picture</h4><p>PNG data, 1.2 MB. What Chrome, Safari, Figma, Notes and Slack in a browser read when you paste.</p></div>
  <div class="slot"><h4>2 · The file</h4><p>A reference to <code>Copied image.png</code> in Forge's cache folder. What the Slack app, Mail, Messages and Finder take when you paste: the exact compressed bytes.</p></div>
  <div class="slot quiet"><h4>Kept aside</h4><p>The original 4.1 MB image, so <b>u</b> (or <code>forge clip --undo</code>) can put it back. Only the last one is kept.</p></div>
</div>`

const APP_FLOW: Card[] = [
  {
    step: 'Step 1',
    name: 'Copy an image',
    note: 'Anywhere on the Mac: a screenshot to the clipboard, or Copy Image in a browser, Figma or Preview.',
    body: copyArt,
  },
  {
    step: 'Step 2',
    name: 'Home says ⌘V pastes it',
    note: 'While the clipboard holds a picture, the far end of the field says so: ⌘V on a chip in the mode’s colour, the words in the same colour; “or type a path” stays. <b>⌘V</b> pastes the picture. With text, or nothing, on the clipboard the field is as today, so there is never an error to show. It goes once you type.',
    body: term(homeWithHint()),
  },
  {
    step: 'Step 3',
    name: 'It lands like a dropped file',
    note: 'Straight after ⌘V: the same card a dropped file gets, named <b>Copied image</b>, with no path. Pick the mode with 1–5 as usual; here it is compress.',
    body: term(staged()),
  },
  {
    step: 'Step 4',
    name: 'Method',
    note: 'Unchanged from today.',
    body: term(method()),
  },
  {
    step: 'Step 5',
    name: 'Quality',
    note: 'Unchanged, with the size shown live. Needs lossy PNG, which Forge does not have yet (today it says a PNG has nothing to trade away).',
    body: term(quality()),
  },
  {
    step: 'Step 6',
    name: 'Done (Save as is skipped)',
    note: 'No file to name or place, so there is no Save as. The result is already on the clipboard. The trail ends <b>Clipboard ╱ Done</b>. <b>u</b> puts the original back; <b>s</b> also saves it as a file.',
    body: term(doneSmaller()),
  },
  {
    step: 'Step 7',
    name: 'Paste where you were going',
    note: 'Back in Slack, GitHub, an AI chat: ⌘V. The name it arrives with is an open question.',
    body: pasteArt,
  },
]

const CLI_FLOW: Card[] = [
  {
    step: 'One step',
    name: 'forge clip, then ⌘V',
    note: 'No questions: same format, a sensible quality, back on the clipboard. Flags work as they do for files (<code>--max-size</code>, <code>--quality</code>). <code>--undo</code> puts the last original back, even after the app quits.',
    body: term(cliRun()),
  },
  {
    step: 'More',
    name: 'Convert, keep a copy, nothing to use',
    note: '<code>--to</code> converts on the clipboard; <code>--save</code> also writes a file. With no image, one line says why, with a non-zero exit code. Agents get the same as an MCP tool, <code>clip</code>.',
    body: term(cliMore()),
  },
]

const HINTS: Card[] = [
  {
    name: 'Home, while a picture is copied',
    note: 'Decided: ⌘V on a chip in the mode’s colour, the words in the same colour, at the field’s far end.',
    body: term(homeWithHint()),
  },
  {
    name: 'Colour: once a scale is shown',
    note: 'The same chip, in grey: colour mode’s swatches already compete for attention. Today: ⇧ → bold pink, the words grey.',
    body: term(colourField('colourScale')),
  },
  {
    name: 'Colour: while typing on a scale',
    note: 'And for ↵ done. These two are the only key hints inside a text field today; any new one gets the chip.',
    body: term(colourField('colourTyped')),
  },
  {
    id: 'B',
    name: 'Also /clip in the commands?',
    note: 'A second way in, for someone who looks in the list first. Listed only while the clipboard holds a picture. Not needed if ⌘V is enough.',
    body: term(commandsClip()),
  },
]

const EDGE: Card[] = [
  {
    id: 'E3',
    name: 'You copied something else meanwhile',
    note: 'Decided wording. Forge checks before writing back: if you copied something else while it worked, your new copy stays on the clipboard and the result is saved to the default folder. The verb follows the mode.',
    body: term(doneChanged()),
  },
]

const QUESTIONS = [
  '<b>Keep /clip as well</b> (B), or is ⌘V enough?',
  '<b>A result that would be larger:</b> ↵ switched off at those quality levels (my pick), or ↵ allowed, and Forge just leaves the clipboard alone?',
  '<b>No Save as for a copied image</b> (Step 6)? The result goes straight back on the clipboard; <b>s</b> saves a file if you want one.',
  '<b>Lossy PNG first.</b> Screenshots are PNGs and Forge cannot shrink a PNG today. Build lossy PNG before this (my pick), or have clipboard compress turn PNGs into JPEG? JPEG loses transparency and blurs text.',
  '<b>The name it pastes with</b> (Step 7): <code>Copied image.png</code>, <code>Screenshot 2026-10-16 at 12.40.png</code>, or <code>image.png</code>?',
  '<b>Retina → 1×</b> as a compress option (halves each side, about ¼ the size), or leave it to Resize in enhance?',
  '<b>Windows</b> in the first version, or later? There the key would be ctrl-v.',
  '<b>Words drawn in the screens, to approve:</b> “Copied image” · “On the clipboard” · “undo” · “save a copy”. In E3, “uploaded” could be “copied”, since nothing is uploaded; kept as you wrote it.',
]

const BETTER = [
  [
    'You see it before it happens',
    'Clop optimises silently. Forge shows the size live on the quality step, then the before and after on Done.',
  ],
  [
    'Every mode, not just smaller',
    'Remove the background from a copied image and paste it into Keynote. Boost a small one. Crop it to a circle for an avatar. Convert a copied WebP or HEIC. Get the palette of a copied screenshot.',
  ],
  [
    '“Fit for where it’s going”',
    'Presets like <code>--for slack</code>, <code>--for github</code>, <code>--for claude</code>, each with that place’s size limit and the size it shrinks images to anyway. Anything bigger is pixels the other side throws away, so shrinking to it costs nothing you would see. (Each limit needs looking up first.)',
  ],
  [
    'One-key undo',
    'u on Done, <code>--undo</code> on the command line. Clop keeps backups in a folder; this is quicker.',
  ],
  [
    'Free for agents',
    'Clop charges for its MCP server; Forge’s <code>clip</code> tool would be free.',
  ],
  [
    'Never worse, never in your way',
    'Never puts back a bigger image, never overwrites a newer copy, strips location data from copied photos.',
  ],
]

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · Clipboard</title>
<style>
  :root { --page:#0d0e11; --ink:#e2e4ea; --muted:#8f94a1; --rule:#23252c; --card:#14161a; --green:#79c98b; --mono:"SF Mono", ui-monospace, Menlo, monospace; --sans:-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--page); color:var(--ink); font:16px/1.6 var(--sans); }
  main { max-width:1440px; margin:0 auto; padding:44px 24px 120px; }
  h1 { font-size:34px; margin:0 0 6px; letter-spacing:-.015em; }
  .lede { color:var(--muted); font-size:17px; max-width:900px; margin:0; }
  .top { display:grid; grid-template-columns:1fr 1.25fr; gap:18px; margin-top:26px; }
  @media (max-width:1100px) { .top { grid-template-columns:1fr; } }
  .box { background:var(--card); border:1px solid var(--rule); border-radius:12px; padding:16px 20px; }
  .box h3 { margin:0 0 8px; font:600 12px var(--mono); letter-spacing:.1em; text-transform:uppercase; color:var(--green); }
  .box ol, .box ul { margin:0; padding-left:20px; } .box li { margin:4px 0; font-size:15px; color:#c7cbd4; }
  .status { display:flex; gap:10px; margin-top:16px; font:13px var(--mono); }
  .status span { border:1px solid var(--rule); border-radius:8px; padding:4px 10px; color:var(--muted); }
  .status b { color:var(--ink); }
  nav { display:flex; flex-wrap:wrap; gap:8px; margin-top:20px; }
  nav a { font:13px var(--mono); color:var(--muted); text-decoration:none; border:1px solid var(--rule); padding:4px 10px; border-radius:999px; }
  nav a:hover { color:var(--ink); }
  section { margin-top:76px; }
  h2 { font-size:26px; margin:0 0 4px; letter-spacing:-.01em; }
  .kind { font:700 11px var(--mono); letter-spacing:.12em; color:var(--green); border:1px solid #2c5a37; border-radius:6px; padding:2px 7px; margin-right:10px; vertical-align:4px; }
  .sub { color:var(--muted); margin:0 0 24px; max-width:900px; }
  .flow { display:flex; flex-wrap:wrap; align-items:flex-start; gap:18px 10px; }
  .arrow { align-self:center; font-size:30px; color:#4a7a56; padding:0 2px; }
  .opts { display:flex; flex-wrap:wrap; gap:30px 26px; }
  figure { margin:0; width:max-content; max-width:100%; }
  .step { font:700 12px var(--mono); color:var(--green); letter-spacing:.06em; margin-bottom:2px; }
  .vt { display:flex; align-items:baseline; gap:10px; margin-bottom:8px; }
  .vt .id { font:700 12px var(--mono); padding:3px 7px; border-radius:6px; background:#17301f; color:var(--green); }
  .vt .name { font-weight:620; }
  .vt .pick { font:600 11px var(--mono); letter-spacing:.08em; color:#6fcf7f; border:1px solid #2c5a37; padding:2px 7px; border-radius:6px; }
  .idea { font-size:14.5px; color:#c7cbd4; margin:8px 0 0; max-width:660px; }
  .t { font:13px/1 var(--mono); padding:12px 14px; border-radius:10px; border:1px solid #2c2f37; width:max-content; background:#1e1e1e; color:#e7e7e7; }
  .r { height:17px; white-space:pre; overflow:hidden; }
  .r > span { display:inline-block; height:17px; line-height:17px; vertical-align:top; }
  code { font:.9em var(--mono); background:#1c1e24; padding:1px 5px; border-radius:4px; }
  /* illustrations */
  .art { width:330px; height:428px; border-radius:10px; border:1px solid #2c2f37; background:#16171b; display:flex; align-items:center; justify-content:center; }
  .mac { text-align:center; }
  .shot { width:250px; height:160px; margin:0 auto; border-radius:6px; background:linear-gradient(135deg,#2b3b52,#3a2f4f); position:relative; }
  .sel { position:absolute; left:34px; top:28px; width:170px; height:100px; border:1.5px dashed #e7e7e7; background:rgba(255,255,255,.08); }
  .sel span { position:absolute; right:-2px; bottom:-22px; font:11px var(--mono); color:#c7cbd4; }
  .kbd { margin-top:38px; display:flex; gap:6px; justify-content:center; }
  kbd { font:600 15px var(--sans); min-width:34px; padding:6px 8px; border-radius:7px; background:#26272c; border:1px solid #3a3c43; border-bottom-width:3px; color:#e7e7e7; }
  .cap { margin-top:14px; font-size:13px; color:var(--muted); }
  .chat { width:290px; border-radius:8px; background:#1b1d21; border:1px solid #2c2f37; overflow:hidden; font-size:13px; }
  .chathead { padding:8px 12px; border-bottom:1px solid #2c2f37; color:#c7cbd4; font-weight:600; }
  .msg { display:flex; gap:10px; padding:14px 12px; }
  .av { width:30px; height:30px; border-radius:6px; background:#4a7a56; flex:none; }
  .att { margin-top:6px; display:flex; gap:10px; align-items:center; border:1px solid #2c2f37; border-radius:8px; padding:8px; background:#202227; }
  .thumb { width:46px; height:30px; border-radius:4px; background:linear-gradient(135deg,#2b3b52,#3a2f4f); }
  .fn { color:#e7e7e7; font-weight:600; } .fs { color:var(--muted); font-size:12px; }
  .composer { margin:4px 12px 12px; border:1px solid #3a3c43; border-radius:8px; padding:8px 10px; color:var(--muted); font:12px var(--mono); }
  .clipbox { display:grid; grid-template-columns:repeat(3, 1fr); gap:14px; max-width:1100px; }
  @media (max-width:900px) { .clipbox { grid-template-columns:1fr; } }
  .slot { background:var(--card); border:1px solid #2c5a37; border-radius:12px; padding:14px 18px; }
  .slot.quiet { border-color:var(--rule); }
  .slot h4 { margin:0 0 6px; font-size:15px; } .slot p { margin:0; font-size:14.5px; color:#c7cbd4; }
  table { border-collapse:collapse; max-width:1100px; width:100%; font-size:14.5px; }
  td, th { text-align:left; padding:8px 12px; border-bottom:1px solid var(--rule); vertical-align:top; color:#c7cbd4; }
  th { color:var(--ink); font-weight:600; width:34%; }
  .better { display:grid; grid-template-columns:1fr 1fr; gap:12px; max-width:1100px; }
  @media (max-width:900px) { .better { grid-template-columns:1fr; } }
  .better div { background:var(--card); border:1px solid var(--rule); border-radius:12px; padding:12px 16px; font-size:14.5px; color:#c7cbd4; }
  .better b { display:block; color:var(--ink); font-size:15.5px; margin-bottom:2px; }
</style></head>
<body><main>
<h1>Clipboard</h1>
<p class="lede">Copy an image, let Forge work on it, paste the result. The clipboard becomes a source and a destination, like a file and a folder. Screens are the real app at 80 × 24, edited where the clipboard changes them.</p>
<div class="status"><span>Decided <b>⌘V chip in the field, and for every field hint (grey in colour mode) · no error for text · never bigger · E3 wording</b></span><span>Open <b>${QUESTIONS.length} questions</b></span><span>Round <b>4</b></span></div>
<div class="top">
  <div class="box"><h3>In plain words</h3><ol>
    <li>You copy a picture, like a screenshot or an image from a web page.</li>
    <li>You open Forge. The field says <b>⌘V to paste from clipboard</b>; ⌘V brings the picture in, as if you had dropped a file.</li>
    <li>You pick what to do (shrink it, convert it, remove the background) with the same steps as a file.</li>
    <li>Forge puts the result back on the clipboard. There is no file to name or save.</li>
    <li>You paste wherever you were going. Not happy? Press <b>u</b> and the original comes back.</li>
    <li>From the command line, <code>forge clip</code> does all of it in one go.</li>
  </ol></div>
  <div class="box"><h3>Questions for you</h3><ol>${QUESTIONS.map((q) => `<li>${q}</li>`).join('')}</ol></div>
</div>
<nav><a href="#app">In the app</a><a href="#cli">Command line</a><a href="#entry">Key hints in fields</a><a href="#lands">What lands on the clipboard</a><a href="#edge">Clipboard changed</a><a href="#cases">Other cases</a><a href="#better">Better than Clop</a></nav>

<section id="app"><h2><span class="kind">FLOW</span>In the app: shrink a screenshot, then paste it</h2>
<p class="sub">Step 1 → Step 7. Compress is shown; convert and enhance go the same way, with their own questions in the middle.</p>
${flow(APP_FLOW)}</section>

<section id="cli"><h2><span class="kind">FLOW</span>From the command line</h2>
<p class="sub">The fast lane: one command, no questions.</p>
${flow(CLI_FLOW)}</section>

<section id="entry"><h2><span class="kind">SCREENS</span>Key hints inside a field</h2>
<p class="sub">Decided: one look for every key hint in a text field, starting with ⌘V. The ⌘V hint shows only while the clipboard holds a picture; Forge checks when it opens and whenever you come back to its window. B is a separate yes or no.</p>
${options(HINTS)}</section>

<section id="lands"><h2><span class="kind">SCREEN</span>What goes back on the clipboard</h2>
<p class="sub">Two things at once, because different apps read different ones. Which apps read which is a guess until it is tested.</p>
${clipArt}</section>

<section id="edge"><h2><span class="kind">SCREEN</span>When the clipboard changes meanwhile</h2>
<p class="sub">Text on the clipboard is not a case: then the hint simply is not shown. A result that would be larger has no screen either (see the table below).</p>
${options(EDGE)}</section>

<section id="cases"><h2><span class="kind">RULES</span>Other cases, no new screen needed</h2>
<table>
<tr><th>A result that would be larger</th><td>Rare, but compress can do it: a JPEG saved at 60 asked for at 80, or a PNG another tool has already squeezed. The quality step shows it live, in orange, as the slider moves, so you know before ↵. At those levels ↵ is off, so a larger image is never put back and there is no screen for it.</td></tr>\n<tr><th>Files copied in Finder (⌘C)</th><td>Treated exactly like files dropped on home, Save as included, because they have a real folder. The new files then go on the clipboard, so ⌘V pastes the results. Finder also puts each file’s icon on the clipboard as a picture; Forge must take the file, never the icon.</td></tr>
<tr><th>Several files copied</th><td>The several-files list, as a multi-file drop.</td></tr>
<tr><th>Window screenshot with a shadow, converted to JPEG</th><td>Transparency flattened, as today.</td></tr>
<tr><th>Colours and sharpness</th><td>The colour profile (screenshots are Display P3) and the Retina size tag are kept, so it pastes at the right size in the right colours.</td></tr>
<tr><th>A photo copied from Photos</th><td>Location and camera data are stripped.</td></tr>
<tr><th>A copied GIF from a browser</th><td>The clipboard only holds its first frame. Forge says so rather than handing back a still.</td></tr>
<tr><th>A PDF copied from Preview</th><td>Not in the first version; the picture version of it is used.</td></tr>
<tr><th>Over SSH, or no clipboard</th><td>No hint. <code>forge clip</code> says why, as it does with text on the clipboard.</td></tr>
</table></section>

<section id="better"><h2><span class="kind">IDEAS</span>Better than Clop</h2>
<p class="sub">Where this can beat it. None of these are drawn yet; say which to keep.</p>
<div class="better">${BETTER.map(([t, d]) => `<div><b>${t}</b>${d}</div>`).join('')}</div></section>
</main></body></html>`

const out = new URL('../mockups/clipboard-2026-10.html', import.meta.url)
writeFileSync(out, page)
console.log('wrote', decodeURIComponent(out.pathname), page.length)
