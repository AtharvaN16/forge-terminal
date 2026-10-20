/**
 * Finder actions (2026-10-16): right-click a file in Finder and run Forge on it.
 *
 * Terminal screens start from cells captured from the real app at 80 × 24
 * (copied from the presets round to /tmp/forge-finder/frames-dark.json) and
 * are edited in place. Finder, the menu bar and notifications are HTML.
 *
 *   npx tsx scripts/finder-mockup.ts   → mockups/finder-2026-10.html
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
  fail: '#e8796d',
}

/* ------------------------------------------------------------ cell edits */

const get = (k: string): Frame => structuredClone(F[k] as Frame)
const textOf = (row: Cell[]) => row.map((c) => c.ch).join('')
const blankRow = (n = 80, bg: string | null = C.canvas): Cell[] =>
  Array.from({ length: n }, () => ({ ch: ' ', fg: null, bg, b: false }))

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
  for (let c = c0; c < c1; c++) if (f[r]?.[c]) f[r]![c] = { ch, fg, bg, b: false }
}

/** The key row: keycaps with their words, then the quiet footnote at the right. */
function keys(f: Frame, main: [string, string][], foot: string, at = 4) {
  const r = f.length - 1
  const w = f[r]!.length
  f[r] = blankRow(w)
  let c = at
  main.forEach(([k, word], i) => {
    if (i) c += 2
    put(f, r, c, ` ${k} `, C.fg, C.keycap, true)
    c += stringWidth(k) + 2
    put(f, r, c, ` ${word}`, C.dim, C.canvas)
    c += stringWidth(word) + 1
  })
  const fc = w - 3 - stringWidth(foot)
  if (fc <= c) console.warn('key row overflows:', main, foot)
  put(f, r, fc, foot, C.border, C.canvas)
}

/* ------------------------------------------------------------ terminal screens */

const hex = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16))
const mixHex = (a: string, b: string, t: number) =>
  `#${hex(a)
    .map((v, i) =>
      Math.round(v + ((hex(b)[i] as number) - v) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`

/** Home in PDF mode with a PDF staged: what Open in Forge on a PDF lands on. */
function stagedPdf(): Frame {
  const f = get('staged')
  const PDF = '#ff6b4a'
  const BG = '#2c2c2c'
  // the drop zone's dots and the accents, from convert's cyan to pdf's orange
  for (const [r, row] of f.entries())
    for (const c of row) {
      if (!c.fg || r < 5) continue
      if (c.fg === '#55c7d9') c.fg = PDF
      else if (c.ch === '·') {
        const [, g] = hex(c.fg)
        const t = Math.max(0, Math.min(1, ((g as number) - 0x2c) / (0xc7 - 0x2c)))
        c.fg = mixHex(BG, PDF, t)
      }
    }
  // the mode tabs: 3 pdf in the chip
  fill(f, 7, 4, 15, ' ', null, C.canvas)
  put(f, 7, 5, '1', C.border, C.canvas)
  put(f, 7, 7, 'convert', C.dim, C.canvas)
  fill(f, 7, 29, 36, ' ', null, '#262626')
  put(f, 7, 30, '3', PDF, '#262626', true)
  put(f, 7, 32, 'pdf', C.fg, '#262626', true)
  const swapIn = (from: string, to: string) => {
    const r = f.findIndex((row) => textOf(row).includes(from))
    const i = textOf(f[r]!).indexOf(from)
    const s0 = f[r]![i]!
    put(f, r, i, to.padEnd(from.length), s0.fg, s0.bg, s0.b)
  }
  swapIn('PNG', 'PDF')
  swapIn('photo.png', 'notes.pdf')
  swapIn('3024×2016 · 14.4 MB', '12 pages · 4.8 MB')
  const k = f.length - 1
  const i = textOf(f[k]!).indexOf('convert')
  put(f, k, i, 'pdf    ', C.dim, C.canvas)
  return f
}

/** Open Forge: the app as it starts, nothing staged. */
const openedHome = () => get('home')

/** Compress in Forge: the method step, the mode already chosen. */
const openedCompress = () => get('how')

/** Ghostscript as an extension: a third row, not yet installed. */
function extensionsGhostscript(): Frame {
  const f = get('extensions')
  for (let r = 3; r < 9; r++) f[r] = blankRow()
  const rows: [string, boolean][] = [
    ['Boost resolution', true],
    ['Remove background', true],
    ['PDF compression', false],
  ]
  rows.forEach(([name, installed], i) => {
    const r = 3 + i
    const lit = i === 2
    const bg = lit ? C.listBand : C.canvas
    fill(f, r, 4, 31, ' ', null, bg)
    if (lit) put(f, r, 4, '▌', C.settings, bg)
    put(f, r, 6, name, lit ? C.fg : C.dim, bg, lit)
    if (installed) put(f, r, 29, '✓', C.dim, bg)
  })
  for (let r = 3; r < 9; r++) put(f, r, 32, '│', C.rule, C.canvas)
  put(f, 3, 35, 'PDF compression', C.fg, C.canvas, true)
  put(f, 4, 35, 'Shrinks PDFs of text and drawings', C.dim, C.canvas)
  put(f, 6, 35, 'Ghostscript · AGPL', C.border, C.canvas)
  put(f, 7, 35, 'not installed · 16 MB', C.dim, C.canvas)
  keys(
    f,
    [
      ['↑↓', 'choose'],
      ['↵', 'install'],
    ],
    'i about · esc back · ctrl-c quit',
  )
  return f
}

/* ------------------------------------------------------------ html: terminal */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
function term(f: Frame, cls = ''): string {
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
  return `<div class="t ${cls}">${rows}</div>`
}

/** A macOS window around a terminal screen. */
const win = (f: Frame, title: string) =>
  `<div class="win"><div class="bar"><i></i><i></i><i></i><span>${title}</span></div>${term(f, 'bare')}</div>`

/* ------------------------------------------------------------ html: macOS */

/* ------------------------------------------------------------ logo */

const TEAL = '#55c7d9'
const VIOLET = '#a68ce0'
let uid = 0

/** Every slash leans as the F does, top-right corner to bottom-left: 4 across for 5 down. */
const SLANT = 4 / 5

/** The home band's F: 4 × 5 pixels of `px`, its top-left at `x`, `y`. */
const pixelF = (x: number, y: number, px: number, fillc: string) =>
  `<path fill="${fillc}" d="M${x} ${y}h${4 * px}v${px}h${-3 * px}v${px}h${2 * px}v${px}h${-2 * px}v${2 * px}h${-px}z"/>`

/**
 * The logo, decided (C5·m): the home screen's F, white on the canvas grey, and four slashes
 * packed into the bottom-right corner at the F's own angle. Forge's own mark has them teal to
 * violet; each Quick Action's icon has them in its mode's colour (`paint`).
 *
 * The slashes are just whole lines cut by the tile, never by an edge of their own: an edge
 * running parallel to them would shave the first one down to a sliver. They stop at the inside
 * of the border, and the last sits as far into the corner as still leaves ~10 units showing.
 */
function c5Logo(size: number, paint?: string): string {
  const k = `g${uid++}`
  const small = size <= 20
  const count = small ? 3 : 4
  const gap = small ? 6 : 4.6
  const last = small ? 51 : 51.5
  const feet = Array.from({ length: count }, (_, i) => last - (count - 1 - i) * gap)
  const lines = feet.map((x) => `<line x1="${x}" y1="66" x2="${x + 66 * SLANT}" y2="0"/>`).join('')
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${k}w" gradientUnits="userSpaceOnUse" x1="34" y1="0" x2="62" y2="0"><stop offset="0" stop-color="${TEAL}"/><stop offset="1" stop-color="${VIOLET}"/></linearGradient><clipPath id="${k}c"><rect width="64" height="64" rx="14"/></clipPath><clipPath id="${k}i"><rect x="1.5" y="1.5" width="61" height="61" rx="12.5"/></clipPath></defs><g clip-path="url(#${k}c)"><rect width="64" height="64" fill="#1e1e1e"/><g clip-path="url(#${k}i)" stroke="${paint ?? `url(#${k}w)`}" stroke-width="${small ? 3.6 : 2.4}">${lines}</g>${pixelF(16, 12, 8, '#e7e7e7')}</g><rect x=".75" y=".75" width="62.5" height="62.5" rx="13.5" fill="none" stroke="#3a3a3a" stroke-width="1.5"/></svg>`
}

const brand = (size: number) => c5Logo(size)

/** Each Quick Action's slashes in its mode's colour; Open Forge and the Windows Forge row keep the gradient. */
const MODE_PAINT = { convert: '#55c7d9', compress: '#79c98b', pdf: '#ff6b4a', enhance: '#b39ae8' }
const PAINT: Record<string, string> = {
  'Convert in Forge': MODE_PAINT.convert,
  'Compress in Forge': MODE_PAINT.compress,
  'Open in Forge': MODE_PAINT.pdf,
  'Sharpen in Forge': MODE_PAINT.enhance,
}
/** `paint` 'grad' (or none known for the label) keeps the gradient. */
const markFor = (label: string, paint?: string) => {
  const p = paint === 'grad' ? undefined : (paint ?? PAINT[label])
  return `<span class="mk">${c5Logo(16, p)}</span>`
}
const markAt = (size: number) =>
  `<span class="mk" style="width:${size}px;height:${size}px">${brand(size)}</span>`

interface Item {
  label: string
  icon?: 'forge' | 'sys' | 'none'
  lit?: boolean
  sep?: boolean
  dim?: boolean
  /** The slashes' colour in the icon; by default the label's mode. */
  paint?: string
}
const sys = (label: string): Item => ({ label, icon: 'sys' })
const ours = (label: string, lit = false, paint?: string): Item => ({
  label,
  icon: 'forge',
  lit,
  paint,
})
const SEP: Item = { label: '', sep: true }
const CUSTOMIZE: Item = { label: 'Customize…', icon: 'none' }

function menuHtml(items: Item[], cls = ''): string {
  return `<div class="menu ${cls}">${items
    .map((i) => {
      if (i.sep) return '<div class="sep"></div>'
      const ic =
        i.icon === 'forge'
          ? markFor(i.label, i.paint)
          : i.icon === 'sys'
            ? '<span class="si"></span>'
            : '<span class="ni"></span>'
      return `<div class="mi${i.lit ? ' lit' : ''}${i.dim ? ' dim' : ''}">${ic}<span>${esc(i.label)}</span></div>`
    })
    .join('')}</div>`
}

const MAIN_MENU = (file: string) => `<div class="menu main">
  <div class="mi"><span class="ni"></span>Open</div>
  <div class="mi"><span class="ni"></span>Open With<b>›</b></div>
  <div class="sep"></div>
  <div class="mi"><span class="ni"></span>Move to Trash</div>
  <div class="sep"></div>
  <div class="mi"><span class="ni"></span>Get Info</div>
  <div class="mi"><span class="ni"></span>Rename</div>
  <div class="mi"><span class="ni"></span>Compress “${esc(file)}”</div>
  <div class="mi"><span class="ni"></span>Duplicate</div>
  <div class="mi"><span class="ni"></span>Quick Look</div>
  <div class="sep"></div>
  <div class="mi"><span class="ni"></span>Copy</div>
  <div class="mi"><span class="ni"></span>Share…</div>
  <div class="sep"></div>
  <div class="tags"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#ffd60a"></i><i style="background:#28c840"></i><i style="background:#0a84ff"></i><i style="background:#bf5af2"></i><i style="background:#8e8e93"></i></div>
  <div class="sep"></div>
  <div class="mi lit"><span class="ni"></span>Quick Actions<b>›</b></div>
</div>`

const APPLE_ACTIONS = (kind: 'image' | 'pdf' | 'folder' | 'media'): Item[] =>
  kind === 'media'
    ? [sys('Rotate Left'), sys('Trim')]
    : kind === 'image'
      ? [
          sys('Rotate Left'),
          sys('Markup'),
          sys('Create PDF'),
          sys('Convert Image'),
          sys('Remove Background'),
        ]
      : kind === 'pdf'
        ? [sys('Rotate Left'), sys('Markup')]
        : [sys('New Terminal at Folder')]

interface FileIcon {
  name: string
  kind: 'png' | 'jpg' | 'webp' | 'pdf' | 'folder' | 'mov' | 'mp3'
  sel?: boolean
  fresh?: boolean
}
const fileIcon = (f: FileIcon) =>
  `<div class="fi${f.sel ? ' sel' : ''}${f.fresh ? ' fresh' : ''}"><div class="ico ${f.kind}">${f.kind === 'folder' ? '' : `<em>${f.kind.toUpperCase()}</em>`}</div><div class="fn">${esc(f.name)}</div></div>`

/** A Finder window with files, and optionally the context menu open on one. */
function finder(opts: { files: FileIcon[]; sub?: Item[]; title?: string; tall?: boolean }): string {
  const menus = opts.sub
    ? `<div class="ctx">${MAIN_MENU(opts.files.find((f) => f.sel)?.name ?? 'photo.png')}${menuHtml(opts.sub, 'sub')}</div>`
    : ''
  return `<div class="desk${opts.tall ? ' tall' : ''}"><div class="fwin">
    <div class="fbar"><i></i><i></i><i></i><span>${esc(opts.title ?? 'Portfolio')}</span></div>
    <div class="fbody"><div class="side"><p>Favourites</p><div>Desktop</div><div>Downloads</div><div class="on">Portfolio</div><div>Documents</div></div>
    <div class="grid">${opts.files.map(fileIcon).join('')}</div></div></div>${menus}</div>`
}

const FILES: FileIcon[] = [
  { name: 'photo.png', kind: 'png', sel: true },
  { name: 'hero.png', kind: 'png' },
  { name: 'notes.pdf', kind: 'pdf' },
]

const subFor = (ourItems: Item[], kind: 'image' | 'pdf' | 'folder' | 'media' = 'image'): Item[] => [
  ...APPLE_ACTIONS(kind),
  SEP,
  ...ourItems,
  SEP,
  CUSTOMIZE,
]

/** The menu bar, with Automator's gear turning while a Quick Action runs. */
const menuBar = (spinning: boolean) => `<div class="desk short"><div class="mbar">
  <span class="apple"></span><b>Finder</b><span>File</span><span>Edit</span><span>View</span><span>Go</span>
  <span class="grow"></span>${spinning ? '<span class="gear">⚙</span>' : ''}<span>Fri 16 Oct 14:02</span></div>
  ${spinning ? '<div class="gearcap">macOS shows this while a Quick Action runs. Click it to stop.</div>' : ''}</div>`

const note = (title: string, body: string, opts: { fail?: boolean; when?: string } = {}) =>
  `<div class="nt${opts.fail ? ' fail' : ''}"><div class="nic">${markAt(30)}</div><div class="ntx"><div class="nh"><b>${esc(title)}</b><span>${opts.when ?? 'now'}</span></div><div>${esc(body)}</div></div></div>`
const notifyDesk = (...notes: string[]) => `<div class="desk notify">${notes.join('')}</div>`

/** Finder's preview pane: Quick Action buttons under the preview. */
const previewPane = (actions: string[]) => `<div class="desk"><div class="fwin wide">
  <div class="fbar"><i></i><i></i><i></i><span>Portfolio</span></div>
  <div class="fbody"><div class="cols"><div class="col"><div class="row on">photo.png</div><div class="row">hero.png</div><div class="row">notes.pdf</div></div>
  <div class="pv"><div class="pimg"></div><div class="pname">photo.png</div><div class="pmeta">PNG image · 14.4 MB</div>
  <div class="pbtns">${actions.map((a) => `<div class="pb">${a === 'More…' ? '<span class="dots">···</span>' : markAt(34)}<span>${esc(a)}</span></div>`).join('')}</div></div></div></div></div></div>`

/* ------------------------------------------------------------ html: Windows 11 */

interface WinItem {
  label: string
  forge?: boolean
  lit?: boolean
  more?: boolean
  sep?: boolean
}
const wi = (label: string, o: Partial<WinItem> = {}): WinItem => ({ label, ...o })
const WSEP: WinItem = { label: '', sep: true }
const winMenu = (items: WinItem[], cls = '') =>
  `<div class="wmenu ${cls}">${items
    .map((i) =>
      i.sep
        ? '<div class="wsep"></div>'
        : `<div class="wi${i.lit ? ' lit' : ''}">${i.forge ? markFor(i.label) : '<span class="ni"></span>'}<span>${esc(i.label)}</span>${i.more ? '<b>›</b>' : ''}</div>`,
    )
    .join('')}</div>`

/** The classic menu (Show more options), with Forge's rows in it: flat, or one Forge › row. */
function classic(forge: WinItem[], file: 'image' | 'pdf' = 'image'): WinItem[] {
  return [
    wi('Open'),
    ...(file === 'image'
      ? [wi('Edit'), wi('Print'), wi('Rotate right'), wi('Rotate left')]
      : [wi('Print')]),
    WSEP,
    ...forge,
    WSEP,
    wi('Open with', { more: true }),
    wi('Send to', { more: true }),
    WSEP,
    wi('Cut'),
    wi('Copy'),
    WSEP,
    wi('Delete'),
    wi('Rename'),
    WSEP,
    wi('Properties'),
  ]
}
const FORGE_ROWS = ['Open Forge', 'Convert in Forge', 'Compress in Forge', 'Sharpen in Forge']

interface WFile {
  name: string
  kind: 'png' | 'jpg' | 'pdf' | 'folder'
  sel?: boolean
  fresh?: boolean
}
const wFile = (f: WFile) =>
  `<div class="fi${f.sel ? ' wsel' : ''}${f.fresh ? ' fresh' : ''}"><div class="ico ${f.kind}">${f.kind === 'folder' ? '' : `<em>${f.kind.toUpperCase()}</em>`}</div><div class="fn">${esc(f.name)}</div></div>`
const W_FILES: WFile[] = [
  { name: 'photo.png', kind: 'png', sel: true },
  { name: 'hero.png', kind: 'png' },
  { name: 'notes.pdf', kind: 'pdf' },
]

/** File Explorer with files, and optionally the classic menu (and a submenu) open. */
function explorer(o: { files: WFile[]; menu?: WinItem[]; sub?: WinItem[] }): string {
  const menus = o.menu
    ? `<div class="wctx">${winMenu(o.menu)}${o.sub ? winMenu(o.sub, 'wsub') : ''}</div>`
    : ''
  return `<div class="desk win11"><div class="xwin">
    <div class="xbar"><span class="xtab">Portfolio</span><span class="grow"></span><span class="xc">—</span><span class="xc">▢</span><span class="xc">✕</span></div>
    <div class="xcmd">＋ New &nbsp; ✂ &nbsp; ⧉ &nbsp; ⎘ &nbsp; ✎ &nbsp; ⇪ &nbsp; 🗑 &nbsp; ⇅ Sort &nbsp; ☰ View</div>
    <div class="fbody"><div class="side"><div>Home</div><div>Gallery</div><p></p><div>Desktop</div><div>Downloads</div><div class="on">Portfolio</div></div>
    <div class="grid">${o.files.map(wFile).join('')}</div></div></div>${menus}</div>`
}

/** The new Windows 11 menu; Forge's rows are only behind Show more options. */
const modernMenu = (file = 'photo.png') => `<div class="desk win11"><div class="xwin">
  <div class="xbar"><span class="xtab">Portfolio</span><span class="grow"></span><span class="xc">—</span><span class="xc">▢</span><span class="xc">✕</span></div>
  <div class="fbody"><div class="side"><div>Desktop</div><div class="on">Portfolio</div></div><div class="grid">${W_FILES.map(wFile).join('')}</div></div></div>
  <div class="wctx"><div class="wmenu w11"><div class="w11top"><i>✂</i><i>⧉</i><i>✎</i><i>⇪</i><i>🗑</i></div>
  <div class="wi"><span class="ni"></span>Open</div><div class="wi"><span class="ni"></span>Open with<b>›</b></div><div class="wi"><span class="ni"></span>Set as desktop background</div><div class="wi"><span class="ni"></span>Copy as path</div><div class="wi"><span class="ni"></span>Properties</div><div class="wsep"></div><div class="wi lit"><span class="ni"></span>Show more options<b class="kb">Shift+F10</b></div></div></div>
  <div class="cap">${esc(file)}: Windows 11’s own menu</div></div>`

/** A Windows 11 notification, bottom right. */
const toast = (
  title: string,
  body: string,
  fail = false,
) => `<div class="desk notify win11 wt"><div class="toast${fail ? ' fail' : ''}">
  <div class="th">${markAt(16)}<span>Forge</span><span class="grow"></span><span>···</span><span>✕</span></div>
  <div class="tt">${esc(title)}</div><div class="tb">${esc(body)}</div></div>
  <div class="tray"><span>ENG</span><span>14:02</span></div></div>`

/** Windows Terminal around a terminal screen. */
const wt = (f: Frame, title: string) =>
  `<div class="win wtw"><div class="wtbar"><span class="wttab">${markAt(14)}${esc(title)}<i>✕</i></span><span class="wtplus">＋ ⌄</span><span class="grow"></span><span>—</span><span>▢</span><span>✕</span></div>${term(f, 'bare')}</div>`

/* ------------------------------------------------------------ cards */

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

/** The built-in items, as decided; `lit` highlights one. */
const IMAGE_ITEMS = ['Open Forge', 'Convert in Forge', 'Compress in Forge', 'Sharpen in Forge']
const DEFAULTS = (lit?: string, names = IMAGE_ITEMS) => names.map((n) => ours(n, n === lit))

const SHOT: FileIcon[] = [
  { name: 'Screenshot.jpg', kind: 'jpg', sel: true },
  { name: 'hero.png', kind: 'png' },
  { name: 'notes.pdf', kind: 'pdf' },
]
const PDF_SEL: FileIcon[] = [
  { name: 'photo.png', kind: 'png' },
  { name: 'hero.png', kind: 'png' },
  { name: 'notes.pdf', kind: 'pdf', sel: true },
]

const FLOW_DIRECT: Card[] = [
  {
    step: 'Step 1',
    name: 'Right-click → Sharpen in Forge',
    note: 'Forge’s four items under macOS’s own, with Forge’s logo.',
    body: finder({ files: FILES, sub: subFor(DEFAULTS('Sharpen in Forge')) }),
  },
  {
    step: 'Step 2',
    name: 'It runs, no window',
    note: 'Sharpen has nothing to ask. macOS turns a gear in the menu bar meanwhile.',
    body: menuBar(true),
  },
  {
    step: 'Step 3',
    name: 'One notification',
    note: 'Decided: a notification, then the file selected.',
    body: notifyDesk(note('photo-sharp.png', 'Sharpened')),
  },
  {
    step: 'Step 4',
    name: 'The new file, selected',
    note: 'Beside the original, named as the CLI names it. The original is never touched.',
    body: finder({
      files: [
        { name: 'photo.png', kind: 'png' },
        { name: 'photo-sharp.png', kind: 'png', sel: true, fresh: true },
        { name: 'hero.png', kind: 'png' },
        { name: 'notes.pdf', kind: 'pdf' },
      ],
    }),
  },
]

const FLOW_MODE: Card[] = [
  {
    step: 'Step 1',
    name: 'Right-click → Compress in Forge',
    note: 'Convert in Forge works the same way.',
    body: finder({ files: SHOT, sub: subFor(DEFAULTS('Compress in Forge')) }),
  },
  {
    step: 'Step 2',
    name: 'Forge opens one step in',
    note: 'The mode already chosen. Convert in Forge opens on the format list.',
    body: win(openedCompress(), 'forge — Screenshot.jpg'),
  },
]

const FLOW_PDF: Card[] = [
  {
    step: 'Step 1',
    name: 'Right-click a PDF → Open in Forge',
    note: 'For a PDF, Forge shows only this one item.',
    body: finder({
      files: PDF_SEL,
      sub: subFor(DEFAULTS('Open in Forge', ['Open in Forge']), 'pdf'),
    }),
  },
  {
    step: 'Step 2',
    name: 'Forge opens in PDF mode',
    note: 'The PDF staged and <b>3 pdf</b> chosen, so ↵ goes straight to the page operations.',
    body: win(stagedPdf(), 'forge — notes.pdf'),
  },
]

const FLOW_OPEN: Card[] = [
  {
    step: 'Step 1',
    name: 'Right-click → Open Forge',
    note: 'Wherever you are in Finder.',
    body: finder({ files: FILES, sub: subFor(DEFAULTS('Open Forge')) }),
  },
  {
    step: 'Step 2',
    name: 'Forge opens, as it starts',
    note: 'Just the app in a terminal window, nothing staged; the file you clicked is not brought in.',
    body: win(openedHome(), 'forge'),
  },
]

const TYPES: Card[] = [
  {
    id: 'K·a',
    name: 'An image',
    note: 'All four.',
    body: finder({ files: FILES, sub: subFor(DEFAULTS()) }),
  },
  {
    id: 'K·b',
    name: 'A PDF',
    note: 'Only Open in Forge: the PDF staged, in PDF mode. Open Forge would add nothing here.',
    body: finder({ files: PDF_SEL, sub: subFor(DEFAULTS(undefined, ['Open in Forge']), 'pdf') }),
  },
  {
    id: 'K·c',
    name: 'A folder',
    note: 'Convert and Compress in Forge open one step in, for every file inside.',
    body: finder({
      files: [
        { name: 'images', kind: 'folder', sel: true },
        { name: 'photo.png', kind: 'png' },
        { name: 'notes.pdf', kind: 'pdf' },
      ],
      sub: subFor(
        DEFAULTS(undefined, ['Open Forge', 'Convert in Forge', 'Compress in Forge']),
        'folder',
      ),
    }),
  },
  {
    id: 'K·d',
    name: 'A video or a sound (coming)',
    note: 'Like a PDF: only Open in Forge, which opens with the file staged in its own mode, once video and sound land. Its slashes take that mode’s colour then; the gradient until it exists.',
    body: finder({
      files: [
        { name: 'clip.mov', kind: 'mov', sel: true },
        { name: 'voice.mp3', kind: 'mp3' },
        { name: 'notes.pdf', kind: 'pdf' },
      ],
      sub: subFor([ours('Open in Forge', true, 'grad')], 'media'),
    }),
  },
]

/** The decided logo: Forge's own mark large, then each Quick Action's, as the menus draw them. */
const logoDecided = () =>
  card({
    id: 'C5·m',
    name: 'The F, slashes in the corner, a colour per Quick Action',
    note: 'Forge’s own mark (app, Open Forge, the Windows Forge › row) has the slashes teal to violet. Each Quick Action’s icon has them in its mode’s colour: Convert teal, Compress green, Open in Forge on a PDF orange, Sharpen violet. Video and sound take theirs when those modes land.',
    body: `<div class="logo permode"><div class="pm">${c5Logo(128)}<span>Forge</span></div>${(
      [
        ['Convert in Forge', MODE_PAINT.convert],
        ['Compress in Forge', MODE_PAINT.compress],
        ['Open in Forge · PDF', MODE_PAINT.pdf],
        ['Sharpen in Forge', MODE_PAINT.enhance],
        ['Open Forge', undefined],
      ] as [string, string | undefined][]
    )
      .map(
        ([label, c]) =>
          `<div class="pm">${c5Logo(64, c)}<div class="pmrow">${c5Logo(32, c)}${c5Logo(16, c)}</div><span>${esc(label)}</span></div>`,
      )
      .join('')}</div>`,
  })

const W_PDF: WFile[] = [
  { name: 'photo.png', kind: 'png' },
  { name: 'hero.png', kind: 'png' },
  { name: 'notes.pdf', kind: 'pdf', sel: true },
]
const cascade = (lit?: string) =>
  ({
    menu: classic([wi('Forge', { forge: true, more: true, lit: true })]),
    sub: FORGE_ROWS.map((r) => wi(r, { forge: true, lit: r === lit })),
  }) as const

const WIN_MENUS: Card[] = [
  {
    id: 'WM1',
    name: 'Four rows, as on the Mac',
    note: 'Flat in the classic menu, between Rotate and Open with. Windows has no Quick Actions group to hold them, so they sit loose among Windows’ own.',
    body: explorer({
      files: W_FILES,
      menu: classic(FORGE_ROWS.map((r, i) => wi(r, { forge: true, lit: i === 3 }))),
    }),
  },
  {
    id: 'WM2',
    name: 'One Forge › row',
    pick: true,
    note: 'Windows (unlike macOS) lets a free tool open its own submenu, so Forge takes one row, the way 7-Zip does. The same four inside.',
    body: explorer({ files: W_FILES, ...cascade('Sharpen in Forge') }),
  },
]

const WIN_SHARPEN: Card[] = [
  {
    step: 'Step 1',
    name: 'Right-click → Show more options',
    note: 'Windows 11 keeps other programs’ items out of its new menu. Shift + right-click skips straight to the classic one.',
    body: modernMenu(),
  },
  {
    step: 'Step 2',
    name: 'Forge › Sharpen in Forge',
    note: 'WM2.',
    body: explorer({ files: W_FILES, ...cascade('Sharpen in Forge') }),
  },
  {
    step: 'Step 3',
    name: 'A notification',
    note: 'Named Forge, with the logo.',
    body: toast('photo-sharp.png', 'Sharpened'),
  },
  {
    step: 'Step 4',
    name: 'The new file, selected',
    note: 'Beside the original, selected in Explorer.',
    body: explorer({
      files: [
        { name: 'photo.png', kind: 'png' },
        { name: 'photo-sharp.png', kind: 'png', sel: true, fresh: true },
        { name: 'hero.png', kind: 'png' },
        { name: 'notes.pdf', kind: 'pdf' },
      ],
    }),
  },
]

const WIN_COMPRESS: Card[] = [
  {
    step: 'Step 1',
    name: 'Forge › Compress in Forge',
    note: 'Convert in Forge the same way.',
    body: explorer({
      files: [{ name: 'Screenshot.jpg', kind: 'jpg', sel: true }, ...W_FILES.slice(1)],
      ...cascade('Compress in Forge'),
    }),
  },
  {
    step: 'Step 2',
    name: 'Windows Terminal opens, one step in',
    note: 'A new Windows Terminal window (the old console if it is not installed), on compress’s first question.',
    body: wt(openedCompress(), 'forge'),
  },
]

const WIN_PDF: Card[] = [
  {
    step: 'Step 1',
    name: 'A PDF: just Open in Forge',
    note: 'One item, so no Forge › row: it sits in the menu directly.',
    body: explorer({
      files: W_PDF,
      menu: classic([wi('Open in Forge', { forge: true, lit: true })], 'pdf'),
    }),
  },
  {
    step: 'Step 2',
    name: 'Forge opens in PDF mode',
    note: 'As on the Mac.',
    body: wt(stagedPdf(), 'forge'),
  },
]

/** A shell session as plain coloured lines. */
const cli = (lines: [string, string][][]) =>
  `<div class="t">${lines
    .map(
      (l) =>
        `<div class="r">${l.map(([t, c]) => `<span style="color:${c}">${esc(t)}</span>`).join('') || ' '}</div>`,
    )
    .join('')}</div>`

const UNINSTALL: Card[] = [
  {
    id: 'U1',
    name: 'forge uninstall',
    note: 'One command: the menu items go, then Forge uninstalls itself from npm. The README’s “Updating and removing” points here instead of at npm.',
    body: cli([
      [
        ['$ ', '#808080'],
        ['forge uninstall', '#e7e7e7'],
      ],
      [
        ['✓ ', '#6fcf7f'],
        ['Removed Forge from the right-click menu', '#e7e7e7'],
      ],
      [
        ['✓ ', '#6fcf7f'],
        ['Uninstalled forge-terminal', '#e7e7e7'],
      ],
      [],
    ]),
  },
  {
    id: 'U2',
    name: 'Left behind, then clicked (Mac)',
    note: 'Someone ran <code>npm uninstall</code> directly. The first click on a leftover item finds no Forge, removes every Forge item, and says so once. Nothing else happens.',
    body: notifyDesk(note('Forge was uninstalled', 'Its menu items are removed.')),
  },
  {
    id: 'U2·w',
    name: 'Left behind, then clicked (Windows)',
    note: 'The same, on Windows.',
    body: toast('Forge was uninstalled', 'Its menu items are removed.'),
  },
]

const OTHER: Card[] = [
  {
    id: 'P',
    name: 'Finder’s preview pane',
    note: 'macOS puts a few Quick Actions under the preview by itself, and More… for the rest.',
    body: previewPane(['Compress in Forge', 'Sharpen in Forge', 'More…']),
  },
  {
    id: 'E1',
    name: 'It fails (Mac)',
    note: 'One notification, the reason in Forge’s own words.',
    body: notifyDesk(
      note('photo.png not sharpened', 'The Boost extension was removed.', { fail: true }),
    ),
  },
  {
    id: 'E1·w',
    name: 'It fails (Windows)',
    note: 'The same words.',
    body: toast('photo.png not sharpened', 'The Boost extension was removed.', true),
  },
]

const GHOST: Card[] = [
  {
    id: 'G',
    name: 'PDF compression in /extensions',
    note: 'A third row, installed like Boost; offered from the “nothing to shrink” message too.',
    body: term(extensionsGhostscript()),
  },
]

const QUESTIONS = [
  '<b>Windows menu:</b> WM1 four loose rows, or WM2 one Forge › row with the four inside (my pick)?',
  '<b>Saying it was added:</b> with no settings, should Forge still say once, the first time, that it added itself to the menu? Draft: “Added Forge to Finder’s Quick Actions” (Mac) · “Added Forge to the right-click menu” (Windows).',
  '<b>Words drawn, to approve:</b> “Open Forge” · “Convert in Forge” · “Compress in Forge” · “Sharpen in Forge” · “Open in Forge” (PDFs only) · “Forge” (the Windows row) · “Sharpened” · E1’s sentence · U1’s lines · U2’s notification: “Forge was uninstalled” / “Its menu items are removed”.',
]

const RULES: [string, string][] = [
  [
    'No settings',
    'The menu is the same for everyone. Sharpen in Forge appears once Boost is installed (from /extensions, as today), and goes if it is removed.',
  ],
  [
    'Mac: what an item is',
    'A Quick Action: a small <code>.workflow</code> folder in <code>~/Library/Services</code> that runs one command on the selected files. Forge writes these itself on first run; no Automator, no developer account. Each can carry the logo as its image (to test that Finder shows it in the submenu).',
  ],
  [
    'Windows: what an item is',
    'Registry keys under <code>HKEY_CURRENT_USER\\Software\\Classes</code>, per file type (images, PDFs, folders), so no admin rights. A submenu (WM2) and an icon (<code>forge.ico</code>, shipped with Forge) are both free. Windows 11 shows them only under Show more options; its new menu needs a signed app package.',
  ],
  [
    'Finding Forge',
    'Neither system gives a menu item your shell’s PATH. Each item calls a small launcher Forge keeps in its config folder, which records where Node and Forge live and is rewritten on every update.',
  ],
  [
    'Opening a window',
    'Mac: Terminal and iTerm via AppleScript, Ghostty via <code>open -na Ghostty</code>, whichever you last ran Forge in. Windows: <code>wt.exe</code>, else the old console. Forge opening with files given to it is a small addition: today <code>forge photo.png</code> with no flags does not open the app.',
  ],
  [
    'Notifications',
    'Mac: a Quick Action can post one, but macOS shows it under the script runner’s name and icon, not Forge’s, unless Forge ships a tiny signed helper app. Windows: Forge registers its own name and logo once (a Start menu shortcut with an app ID), so the toast says Forge.',
  ],
  [
    'Several files',
    'Mac: one run gets them all. Windows: Explorer starts one process per file, so the launcher gathers them into one run. One notification with totals either way.',
  ],
  ['Names taken', 'As in the app: never overwrites, writes <code>photo (1).png</code>.'],
  [
    'Privacy prompts (Mac)',
    'The first run on Desktop, Documents or Downloads may make macOS ask for access. It needs testing to see which app name it shows.',
  ],
  [
    'Uninstalling Forge',
    'Decided. npm runs nothing when a package is removed (uninstall scripts are gone since npm 7), so: <code>forge uninstall</code> removes the menu items on both systems, then runs <code>npm uninstall -g forge-terminal</code> itself, and the README points there. Anyone who uses npm directly gets a safety net: the first click on a leftover item finds Forge gone, removes every Forge item, and says so once. Nothing runs in the background.',
  ],
]

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · Right-click menu</title>
<style>
  :root { --page:#0d0e11; --ink:#e2e4ea; --muted:#8f94a1; --rule:#23252c; --card:#14161a; --amber:#e5a23c; --mono:"SF Mono", ui-monospace, Menlo, monospace; --sans:-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--page); color:var(--ink); font:16px/1.6 var(--sans); }
  main { max-width:1500px; margin:0 auto; padding:44px 24px 120px; }
  h1 { font-size:34px; margin:0 0 6px; letter-spacing:-.015em; }
  .lede { color:var(--muted); font-size:17px; max-width:900px; margin:0; }
  .top { display:grid; grid-template-columns:1fr 1.25fr; gap:18px; margin-top:26px; }
  @media (max-width:1100px) { .top { grid-template-columns:1fr; } }
  .box { background:var(--card); border:1px solid var(--rule); border-radius:12px; padding:16px 20px; }
  .box h3 { margin:0 0 8px; font:600 12px var(--mono); letter-spacing:.1em; text-transform:uppercase; color:var(--amber); }
  .box ol { margin:0; padding-left:20px; } .box li { margin:4px 0; font-size:15px; color:#c7cbd4; }
  .status { display:flex; flex-wrap:wrap; gap:10px; margin-top:16px; font:13px var(--mono); }
  .status span { border:1px solid var(--rule); border-radius:8px; padding:4px 10px; color:var(--muted); }
  .status b { color:var(--ink); }
  nav { display:flex; flex-wrap:wrap; gap:8px; margin-top:20px; }
  nav a { font:13px var(--mono); color:var(--muted); text-decoration:none; border:1px solid var(--rule); padding:4px 10px; border-radius:999px; }
  nav a:hover { color:var(--ink); }
  section { margin-top:76px; }
  h2 { font-size:26px; margin:0 0 4px; letter-spacing:-.01em; }
  .kind { font:700 11px var(--mono); letter-spacing:.12em; color:var(--amber); border:1px solid #6b4f22; border-radius:6px; padding:2px 7px; margin-right:10px; vertical-align:4px; }
  .sub { color:var(--muted); margin:0 0 24px; max-width:900px; }
  .flow { display:flex; flex-wrap:wrap; align-items:flex-start; gap:18px 10px; }
  .arrow { align-self:center; font-size:30px; color:#7a5a2a; padding:0 2px; }
  .opts { display:flex; flex-wrap:wrap; gap:34px 28px; }
  figure { margin:0; width:max-content; max-width:100%; }
  .step { font:700 12px var(--mono); color:var(--amber); letter-spacing:.06em; margin-bottom:2px; }
  .vt { display:flex; align-items:baseline; gap:10px; margin-bottom:8px; }
  .vt .id { font:700 12px var(--mono); padding:3px 7px; border-radius:6px; background:#33270f; color:var(--amber); }
  .vt .name { font-weight:620; }
  .vt .pick { font:600 11px var(--mono); letter-spacing:.08em; color:#6fcf7f; border:1px solid #2c5a37; padding:2px 7px; border-radius:6px; }
  .idea { font-size:14.5px; color:#c7cbd4; margin:8px 0 0; max-width:620px; }
  .t { font:13px/1 var(--mono); padding:12px 14px; border-radius:10px; border:1px solid #2c2f37; width:max-content; background:#1e1e1e; color:#e7e7e7; }
  .t.bare { border:0; border-radius:0 0 10px 10px; }
  .r { height:17px; white-space:pre; overflow:hidden; }
  .r > span { display:inline-block; height:17px; line-height:17px; vertical-align:top; }
  code { font:.9em var(--mono); background:#1c1e24; padding:1px 5px; border-radius:4px; }
  .pair { display:flex; gap:16px; align-items:flex-start; }

  /* macOS window around a terminal */
  .win { border-radius:11px; overflow:hidden; border:1px solid #3a3c43; box-shadow:0 18px 40px rgba(0,0,0,.45); width:max-content; }
  .bar, .fbar { height:28px; background:#2a2a2c; display:flex; align-items:center; gap:7px; padding:0 11px; font:12px var(--sans); color:#a9abb2; border-bottom:1px solid #111; }
  .bar i, .fbar i { width:11px; height:11px; border-radius:50%; background:#ff5f57; display:inline-block; }
  .bar i:nth-child(2), .fbar i:nth-child(2) { background:#febc2e; } .bar i:nth-child(3), .fbar i:nth-child(3) { background:#28c840; }
  .bar span, .fbar span { flex:1; text-align:center; margin-right:44px; }

  /* desktop + Finder */
  .desk { position:relative; width:670px; height:480px; border-radius:12px; overflow:hidden; border:1px solid #2c2f37; background:radial-gradient(120% 90% at 20% 10%, #3b4a63 0%, #2a2440 45%, #17161f 100%); font:13px var(--sans); color:#e9e9ee; }
  .desk.short { height:120px; width:420px; }
  .desk.notify { height:200px; width:420px; padding:14px; display:flex; flex-direction:column; align-items:flex-end; gap:10px; }
  .fwin { position:absolute; left:18px; top:18px; width:400px; height:300px; border-radius:11px; overflow:hidden; background:#1f1f22; border:1px solid #3a3a3e; box-shadow:0 18px 40px rgba(0,0,0,.45); }
  .fwin.wide { width:584px; height:430px; }
  .fbody { display:flex; height:calc(100% - 28px); }
  .side { width:118px; background:#262629; padding:10px 8px; font-size:12px; color:#c9cad0; }
  .side p { margin:0 0 4px; font-size:10.5px; color:#7d7f87; font-weight:600; }
  .side div { padding:3px 8px; border-radius:6px; } .side .on { background:#3a3a3f; color:#fff; }
  .grid { flex:1; display:flex; flex-wrap:wrap; align-content:flex-start; gap:12px 14px; padding:16px; }
  .fi { width:72px; text-align:center; font-size:11.5px; }
  .ico { width:46px; height:56px; margin:0 auto 5px; border-radius:4px; background:linear-gradient(160deg,#f4f4f6,#d9dae0); position:relative; clip-path:polygon(0 0,72% 0,100% 20%,100% 100%,0 100%); }
  .ico em { position:absolute; left:0; right:0; bottom:7px; font:700 8.5px var(--sans); font-style:normal; color:#fff; background:#8e8e93; margin:0 7px; border-radius:2px; padding:1px 0; }
  .ico.png, .ico.jpg { background:linear-gradient(160deg,#6f8fb8,#46597e); } .ico.webp { background:linear-gradient(160deg,#6f8fb8,#46597e); }
  .ico.png em, .ico.jpg em, .ico.webp em { background:rgba(0,0,0,.45); }
  .ico.pdf em { background:#e0443e; }
  .ico.mov { background:linear-gradient(160deg,#3a3f4b,#1f232b); } .ico.mov em { background:#7d5cff; }
  .ico.mp3 em { background:#e0459b; }
  .ico.folder { width:58px; height:46px; margin-top:10px; clip-path:none; border-radius:5px; background:linear-gradient(180deg,#5aa9f0,#2f86e0); }
  .ico.folder::before { content:''; position:absolute; left:0; top:-6px; width:24px; height:8px; border-radius:3px 3px 0 0; background:#5aa9f0; }
  .fn { padding:1px 4px; border-radius:4px; display:inline-block; }
  .fi.sel .ico { outline:3px solid rgba(255,255,255,.18); outline-offset:3px; border-radius:6px; }
  .fi.sel .fn { background:#0a64d6; color:#fff; }
  .fi.fresh .ico { box-shadow:0 0 0 2px var(--amber); }
  .ctx { position:absolute; left:236px; top:122px; display:flex; align-items:flex-end; }
  .menu { background:rgba(40,40,44,.92); backdrop-filter:blur(20px); border:1px solid rgba(255,255,255,.12); border-radius:10px; padding:5px; box-shadow:0 14px 34px rgba(0,0,0,.5); min-width:200px; font-size:13px; }
  .menu.sub { margin-left:-6px; margin-bottom:-6px; }
  .mi { display:flex; align-items:center; gap:8px; padding:3px 10px 3px 8px; border-radius:5px; color:#e9e9ee; white-space:nowrap; height:23px; }
  .mi b { margin-left:auto; padding-left:22px; font-weight:400; color:#aaa; }
  .mi.lit { background:#0a64d6; color:#fff; } .mi.lit b { color:#fff; }
  .mi.dim { color:#7d7f87; }
  .sep { height:1px; background:rgba(255,255,255,.12); margin:4px 8px; }
  .tags { display:flex; gap:6px; padding:4px 10px; } .tags i { width:12px; height:12px; border-radius:50%; display:inline-block; }
  .ni { width:16px; display:inline-block; }
  .si { width:16px; height:16px; border-radius:4px; display:inline-block; background:linear-gradient(160deg,#9a9ca3,#6c6e75); }
  .mk { width:16px; height:16px; display:inline-block; flex:none; }

  /* menu bar */
  .mbar { height:26px; background:rgba(30,30,34,.7); backdrop-filter:blur(10px); display:flex; align-items:center; gap:16px; padding:0 14px; font-size:13px; }
  .mbar .apple { width:12px; height:14px; border-radius:6px 6px 5px 5px; background:#e9e9ee; }
  .mbar .grow { flex:1; }
  .gear { display:inline-block; animation:spin 1.6s linear infinite; font-size:15px; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .gearcap { margin:26px 0 0 auto; width:250px; margin-right:16px; font-size:12px; color:#c9cad0; text-align:right; }

  /* notifications */
  .nt { width:340px; display:flex; gap:10px; padding:10px 12px; border-radius:14px; background:rgba(44,44,48,.9); backdrop-filter:blur(20px); border:1px solid rgba(255,255,255,.1); box-shadow:0 10px 26px rgba(0,0,0,.4); }
  .ntx { flex:1; font-size:13px; color:#d9dae0; }
  .nh { display:flex; justify-content:space-between; } .nh span { color:#8e9099; font-size:12px; }
  .nt.fail .nh b { color:#ff8c80; }

  /* preview pane */
  .cols { display:flex; width:100%; }
  .col { width:200px; border-right:1px solid #333; padding:8px 6px; font-size:12.5px; }
  .col .row { padding:3px 8px; border-radius:5px; } .col .row.on { background:#0a64d6; }
  .pv { flex:1; display:flex; flex-direction:column; align-items:center; padding:20px 14px; }
  .pimg { width:220px; height:146px; border-radius:6px; background:linear-gradient(135deg,#6f8fb8,#2a2440); }
  .pname { margin-top:12px; font-weight:600; } .pmeta { color:#8e9099; font-size:12px; }
  .pbtns { margin-top:auto; display:flex; gap:18px; }
  .pb { display:flex; flex-direction:column; align-items:center; gap:5px; font-size:11px; color:#c9cad0; width:84px; text-align:center; }
  .pb .dots { width:34px; height:34px; border-radius:50%; background:#3a3a3f; display:flex; align-items:center; justify-content:center; }

  /* logo */
  .logo { display:flex; gap:22px; align-items:center; background:#16171b; border:1px solid #2c2f37; border-radius:12px; padding:22px; }
  .permode { gap:26px; } .pm { display:flex; flex-direction:column; align-items:center; gap:8px; font:12px var(--sans); color:#c7cbd4; }
  .pmrow { display:flex; gap:8px; align-items:flex-end; }
  h3.grp { font:600 13px var(--mono); letter-spacing:.08em; text-transform:uppercase; color:var(--muted); margin:40px 0 16px; }
  .lside { display:flex; flex-direction:column; gap:14px; }
  .lsizes { display:flex; gap:14px; align-items:flex-end; }
  .lmac { background:rgba(40,40,44,.95); border:1px solid rgba(255,255,255,.12); border-radius:8px; padding:4px; width:210px; font:13px var(--sans); color:#e9e9ee; }
  .lwin { background:#2b2b2b; border:1px solid #444; border-radius:6px; padding:3px; width:210px; font:13px "Segoe UI", var(--sans); }
  .mk svg { display:block; width:100%; height:100%; }

  /* explorer, terminal, toast */
  .xwin { position:absolute; left:18px; top:18px; width:400px; height:300px; border-radius:8px; overflow:hidden; background:#202020; border:1px solid #3a3a3a; box-shadow:0 18px 40px rgba(0,0,0,.45); font:12px "Segoe UI", var(--sans); }
  .xbar { height:30px; background:#1c1c1c; display:flex; align-items:center; gap:10px; padding:0 10px; color:#ddd; }
  .xtab { background:#2b2b2b; padding:5px 12px; border-radius:6px 6px 0 0; margin-top:6px; }
  .xc { width:22px; text-align:center; color:#bbb; }
  .xcmd { height:30px; display:flex; align-items:center; padding:0 12px; color:#cfcfcf; border-bottom:1px solid #333; background:#272727; font-size:12px; }
  .xwin .fbody { height:calc(100% - 60px); }
  .xwin .side { background:#202020; border-right:1px solid #333; }
  .xwin .side .on { background:#3a3a3a; }
  .fi.wsel .fn { background:#0e4a7a; color:#fff; } .fi.wsel .ico { outline:2px solid #3b7bbf; outline-offset:3px; border-radius:4px; }
  .grow { flex:1; }
  .wctx { position:absolute; left:262px; top:84px; display:flex; align-items:flex-start; }
  .wmenu { background:#2b2b2b; border:1px solid #454545; border-radius:6px; padding:3px; box-shadow:0 12px 30px rgba(0,0,0,.5); min-width:220px; font:12.5px "Segoe UI", var(--sans); }
  .wmenu.wsub { margin-left:-4px; margin-top:150px; }
  .wmenu.w11 { border-radius:8px; min-width:250px; }
  .wi { display:flex; align-items:center; gap:9px; padding:4px 10px; border-radius:4px; color:#eee; height:24px; }
  .wi b { margin-left:auto; font-weight:400; color:#bbb; padding-left:18px; } .wi b.kb { font-size:11px; color:#999; }
  .wi.lit { background:#414141; }
  .wsep { height:1px; background:#454545; margin:3px 6px; }
  .w11top { display:flex; justify-content:space-around; padding:6px 4px 8px; border-bottom:1px solid #454545; margin-bottom:4px; }
  .w11top i { font-style:normal; opacity:.85; }
  .desk.win11 .cap { position:absolute; left:18px; bottom:12px; font-size:12px; color:#9fb3cc; }
  .desk.notify.wt { justify-content:flex-end; }
  .toast { width:360px; background:#2b2b2b; border:1px solid #454545; border-radius:8px; padding:12px 14px; font:12.5px "Segoe UI", var(--sans); color:#ddd; box-shadow:0 12px 30px rgba(0,0,0,.5); }
  .th { display:flex; align-items:center; gap:8px; color:#bbb; font-size:12px; margin-bottom:8px; }
  .tt { font-weight:600; color:#fff; font-size:14px; } .tb { color:#cfcfcf; }
  .toast.fail .tt { color:#ff8c80; }
  .tray { display:flex; gap:14px; font-size:11px; color:#cfd6e0; padding:2px 4px; }
  .wtw { border-radius:8px; border-color:#3f3f3f; }
  .wtbar { height:34px; background:#202020; display:flex; align-items:center; gap:12px; padding:0 0 0 8px; color:#ccc; font:12px "Segoe UI", var(--sans); }
  .wtbar > span:last-child, .wtbar > span:nth-last-child(2), .wtbar > span:nth-last-child(3) { width:40px; text-align:center; }
  .wttab { display:flex; align-items:center; gap:8px; background:#1e1e1e; padding:8px 12px; border-radius:6px 6px 0 0; margin-top:6px; }
  .wttab i { font-style:normal; color:#888; margin-left:14px; }
  .wtplus { color:#999; }

  table { border-collapse:collapse; max-width:1100px; width:100%; font-size:14.5px; }
  td, th { text-align:left; padding:8px 12px; border-bottom:1px solid var(--rule); vertical-align:top; color:#c7cbd4; }
  th { color:var(--ink); font-weight:600; width:24%; }
</style></head>
<body><main>
<h1>Right-click menu: Finder and Explorer</h1>
<p class="lede">Right-click a file and run Forge on it. Same items for everyone, on the Mac and on Windows; no settings. Terminal screens are the real app at 80 × 24, edited where this changes them; Finder, Explorer, menus and notifications are drawn.</p>
<div class="status"><span>Decided <b>images: Open Forge · Convert · Compress · Sharpen in Forge · PDFs, video, sound: Open in Forge (staged) · no user options · Windows now · logo C5·m · forge uninstall + self-cleaning click</b></span><span>Open <b>${QUESTIONS.length} questions</b></span><span>Round <b>7</b></span></div>
<div class="top">
  <div class="box"><h3>In plain words</h3><ol>
    <li>Right-click an image: <b>Open Forge</b>, <b>Convert in Forge</b>, <b>Compress in Forge</b>, <b>Sharpen in Forge</b>.</li>
    <li><b>Open Forge</b> just opens the app in a terminal window, without the file.</li>
    <li><b>Open in Forge</b> (the file staged, in its mode) is for PDFs, and for video and sound once those land.</li>
    <li>Convert and Compress open Forge in a terminal window with the file already in, one step in. Sharpen just runs, then a notification.</li>
    <li>Mac: under Quick Actions. Windows: under Show more options, in a Forge › row.</li>
    <li>No settings: it is the same for everyone. Forge adds it on first run.</li>
    <li>The logo marks Forge’s rows in both menus.</li>
  </ol></div>
  <div class="box"><h3>Questions for you</h3><ol>${QUESTIONS.map((q) => `<li>${q}</li>`).join('')}</ol></div>
</div>
<nav><a href="#logo">Logo</a><a href="#flow">Mac: Sharpen</a><a href="#flowpdf">Mac: a PDF</a><a href="#flow2">Mac: Compress</a><a href="#flow3">Mac: Open Forge</a><a href="#types">Mac: by file type</a><a href="#winmenu">Windows: the menu</a><a href="#winsharpen">Windows: Sharpen</a><a href="#wincompress">Windows: Compress</a><a href="#winpdf">Windows: a PDF</a><a href="#other">Preview pane, failures</a><a href="#uninstall">Uninstalling</a><a href="#ghost">Ghostscript</a><a href="#rules">Rules</a></nav>

<section id="logo"><h2><span class="kind">DECIDED</span>The logo</h2>
<p class="sub">Every concept explored is kept in <code>mockups/finder-2026-10-logos.html</code>.</p>
<div class="opts">${logoDecided()}</div></section>

<section id="flow"><h2><span class="kind">FLOW</span>Sharpen, no window</h2>
<p class="sub">Decided menu for images: Open Forge, Convert in Forge, Compress in Forge, Sharpen in Forge.</p>
${flow(FLOW_DIRECT)}</section>

<section id="flowpdf"><h2><span class="kind">FLOW</span>A PDF: Open in Forge, in PDF mode</h2>
<p class="sub">Decided.</p>
${flow(FLOW_PDF)}</section>

<section id="flow2"><h2><span class="kind">FLOW</span>Compress in Forge</h2>
<p class="sub">Convert and Compress need answers, so they open Forge with the mode already chosen.</p>
${flow(FLOW_MODE)}</section>

<section id="flow3"><h2><span class="kind">FLOW</span>Open Forge</h2>
<p class="sub">Kept: opens Forge, nothing staged.</p>
${flow(FLOW_OPEN)}</section>

<section id="types"><h2><span class="kind">SCREENS</span>The menu follows the file</h2>
<p class="sub">Finder hides an item whose file type does not fit.</p>
${options(TYPES)}</section>

<section id="winmenu"><h2><span class="kind">OPTIONS</span>Windows: the menu</h2>
<p class="sub">The same four items. Windows has no Quick Actions group, so the question is whether they sit loose or in one row of their own.</p>
${options(WIN_MENUS)}</section>

<section id="winsharpen"><h2><span class="kind">FLOW</span>Windows: Sharpen, no window</h2>
<p class="sub">With WM2.</p>
${flow(WIN_SHARPEN)}</section>

<section id="wincompress"><h2><span class="kind">FLOW</span>Windows: Compress in Forge</h2>
<p class="sub">Convert and Compress open Forge, one step in.</p>
${flow(WIN_COMPRESS)}</section>

<section id="winpdf"><h2><span class="kind">FLOW</span>Windows: a PDF</h2>
<p class="sub">Open in Forge, in PDF mode.</p>
${flow(WIN_PDF)}</section>

<section id="other"><h2><span class="kind">SCREENS</span>Preview pane, failures</h2>
<p class="sub">No choices here yet; say if any looks wrong.</p>
${options(OTHER)}</section>

<section id="uninstall"><h2><span class="kind">DECIDED</span>Uninstalling</h2>
<p class="sub">npm cannot run anything when Forge is removed, so the clean-up happens in Forge’s own command, with a safety net on the next click.</p>
${options(UNINSTALL)}</section>

<section id="ghost"><h2><span class="kind">SCREEN</span>Ghostscript, as an extension</h2>
<p class="sub">Decided: an extension. The build that runs inside Node is about 16 MB, five times Forge itself, and its licence (AGPL) is cleaner kept apart from Forge.</p>
${options(GHOST)}</section>

<section id="rules"><h2><span class="kind">RULES</span>How it works underneath</h2>
<table>${RULES.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table></section>
</main></body></html>`

const out = new URL('../mockups/finder-2026-10.html', import.meta.url)
writeFileSync(out, page)
console.log('wrote', decodeURIComponent(out.pathname), page.length)
