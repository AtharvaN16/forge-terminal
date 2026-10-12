/**
 * Check for updates (2026-10-12): the /update screen, where it is listed, and
 * the note when a newer Forge is out. Three ways to draw /update, and where
 * the "update available" note goes.
 *
 * Header bar and hint bar are the app's own art; /commands and home are cells
 * captured from the real app at 80 × 24 (a throwaway test wrote
 * /tmp/forge-update/frames-{dark,light}.json). The split view copies
 * /extensions' measurements: a 27-cell list, a rule, the sheet.
 *
 *   npx tsx scripts/update-mockup.ts   → mockups/update-check-2026-10.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import stringWidth from 'string-width'
import { contrast } from '../src/core/colour/contrast.js'
import {
  fromLch,
  inGamut,
  oklabToRgb,
  parseHex,
  rgbToOklab,
  toHex,
  toLch,
} from '../src/core/colour/space.js'
import { trailBarRow } from '../src/shell/bar-art.js'
import { blank, type Row, type Run, width } from '../src/shell/home-art.js'
import {
  DARK,
  LIGHT,
  modeColours,
  modeGradient,
  type Palette,
  type ShellMode,
} from '../src/shell/theme.js'

const N = 80
const LIST = 27

interface Cell {
  ch: string
  fg: string | null
  bg: string | null
  b: boolean
}
const frames = (name: string) =>
  JSON.parse(readFileSync(`/tmp/forge-update/frames-${name}.json`, 'utf8')) as Record<
    string,
    Cell[][]
  >
const CAPTURED = { dark: frames('dark'), light: frames('light') }

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
const textOf = (cells: Cell[]) => cells.map((c) => c.ch).join('')

/** `from` in the row, written over as `to`, keeping the original cells' style. */
function rewrite(cells: Cell[], from: string, to: string): Cell[] {
  const i = textOf(cells).indexOf(from)
  if (i < 0) return cells
  const out = cells.map((c) => ({ ...c }))
  const padded = to.padEnd(from.length)
  for (let k = 0; k < from.length; k++) (out[i + k] as Cell).ch = padded[k] as string
  return out
}
/** `text` painted over the row from column `at`, in its own style. */
function paint(cells: Cell[], at: number, text: string, fg: string, bg: string | null, b = false) {
  const out = cells.map((c) => ({ ...c }))
  ;[...text].forEach((ch, k) => {
    out[at + k] = { ch, fg, bg, b }
  })
  return out
}
const blankCells = (n = N): Cell[] =>
  Array.from({ length: n }, () => ({ ch: ' ', fg: null, bg: null, b: false }))

interface Look {
  p: Palette
  name: 'dark' | 'light'
  f: Record<string, Cell[][]>
}
const looks: Look[] = [
  { p: DARK, name: 'dark', f: CAPTURED.dark },
  { p: LIGHT, name: 'light', f: CAPTURED.light },
]

/* ------------------------------------------------------------ pieces */

const run = (text: string, fg?: string, bg?: string, bold = false): Run => ({ text, fg, bg, bold })
const pad = (row: Row, n: number, bg?: string): Row => [
  ...row,
  ...(n > width(row) ? [{ text: ' '.repeat(n - width(row)), bg }] : []),
]

function header(L: Look, title: string): Row {
  return trailBarRow({
    width: N,
    palette: L.p,
    mode: 'convert',
    trail: { answers: [], current: title },
    slanted: false,
    chip: { label: 'update', colour: L.p.brand, stops: modeGradient(L.p, 'commands') },
  })
}

function keys(L: Look, main: [string, string][], foot = 'esc home · ctrl-c quit'): Row[] {
  const row: Row = [blank(1)]
  main.forEach(([k, w], i) => {
    if (i) row.push(blank(2))
    row.push(run(` ${k} `, L.p.fg, L.p.keycapBg, true), run(` ${w}`, L.p.dim))
  })
  row.push(blank(Math.max(1, N - width(row) - stringWidth(foot) - 1)), run(foot, L.p.border))
  return [[run('─'.repeat(N), L.p.border)], row]
}

/** A small tag, as Save as's "new" tag is drawn. */
const tag = (L: Look, t: string) => run(` ${t} `, L.p.newTag, L.p.newTagBg, true)
const okTag = (L: Look, t: string) => run(t, L.p.ok)
const pill = (L: Look, t: string) => run(` ${t} `, L.p.ink, L.p.pill, true)
const bold = (L: Look, t: string) => run(t, L.p.fg, undefined, true)
const dim = (L: Look, t: string) => run(t, L.p.dim)
const quiet = (L: Look, t: string) => run(t, L.p.border)
/** The command, in the field's band, so it reads as something to type. */
const command = (L: Look, t: string) => run(`  ${t}  `, L.p.fg, L.p.fieldBand)

interface Item {
  name: string
  /** What the row says at its end, inside the band. */
  tail?: Run[]
  /** A gap above it, as /commands puts one before settings. */
  gapAbove?: boolean
}

/** /extensions' list: the highlighted row is a band with the gold bar; the rest are dim. */
function listRow(L: Look, item: Item, on: boolean): Row {
  const tail = item.tail ?? []
  const room = LIST - 2 - stringWidth(item.name) - width(tail) - 1
  if (on) {
    return [
      blank(2),
      run('▌', L.p.brand, L.p.listBand),
      run(' ', undefined, L.p.listBand),
      run(item.name, L.p.fg, L.p.listBand, true),
      run(' '.repeat(Math.max(1, room)), undefined, L.p.listBand),
      ...tail.map((r) => ({ ...r, bg: r.bg ?? L.p.listBand })),
      run(' ', undefined, L.p.listBand),
    ]
  }
  return [blank(4), dim(L, item.name), blank(Math.max(1, room)), ...tail, blank(1)]
}

/** /extensions' split: list, a rule, the sheet of the highlighted row. */
function split(L: Look, items: Item[], at: number, sheet: Row[]): Row[] {
  const left: Row[] = []
  items.forEach((it, i) => {
    if (it.gapAbove) left.push([blank(2 + LIST)])
    left.push(pad(listRow(L, it, i === at), 2 + LIST))
  })
  const h = Math.max(left.length, sheet.length + 1)
  const rows: Row[] = []
  for (let i = 0; i < h; i++) {
    const l = left[i] ?? [blank(2 + LIST)]
    rows.push([...l, blank(1), run('│', L.p.faint), blank(2), ...(sheet[i] ?? [])])
  }
  return rows
}

function screen(L: Look, title: string, body: Row[], keyRow: Row[]): Row[] {
  return [header(L, title), [blank(N)], ...body, [blank(N)], ...keyRow]
}

/* ------------------------------------------------------------ U1 */

const NEW = '0.2.2'
const HAVE = '0.2.1'

const forgeAvailable = (L: Look): Row[] => [
  [bold(L, `Forge ${NEW}`), blank(1), tag(L, 'new')],
  [dim(L, `You have ${HAVE}`)],
  [],
  [command(L, 'npm i -g forge-terminal')],
  [],
  [pill(L, '↵ copy'), blank(2), dim(L, 'then run it in any terminal')],
]
const forgeLatest = (L: Look): Row[] => [
  [bold(L, `Forge ${HAVE}`)],
  [okTag(L, '✓ the latest'), dim(L, ' · checked just now')],
  [],
  [pill(L, '↵ check again')],
]
const autoSheet = (L: Look): Row[] => [
  [bold(L, 'Check automatically')],
  [dim(L, 'On · once a day, in the background')],
  [],
  [quiet(L, 'Asks npm one thing: the latest version')],
  [quiet(L, 'number. Nothing about your files is sent.')],
  [],
  [pill(L, '↵ turn off')],
]

const U1_ITEMS = (L: Look, available: boolean): Item[] => [
  { name: 'Forge', tail: available ? [tag(L, NEW)] : [okTag(L, '✓')] },
  { name: 'Check automatically', tail: [dim(L, 'on')] },
]
const u1 = (L: Look): Row[][] => [
  screen(
    L,
    'Update',
    split(L, U1_ITEMS(L, true), 0, forgeAvailable(L)),
    keys(L, [
      ['↑↓', 'choose'],
      ['↵', 'copy'],
    ]),
  ),
  screen(
    L,
    'Update',
    split(L, U1_ITEMS(L, false), 0, forgeLatest(L)),
    keys(L, [
      ['↑↓', 'choose'],
      ['↵', 'check again'],
    ]),
  ),
  screen(
    L,
    'Update',
    split(L, U1_ITEMS(L, true), 1, autoSheet(L)),
    keys(L, [
      ['↑↓', 'choose'],
      ['↵', 'turn off'],
    ]),
  ),
]

/* ------------------------------------------------------------ U2 */

const U2_ITEMS = (L: Look): Item[] => [
  { name: 'Forge', tail: [tag(L, NEW)] },
  { name: 'Boost resolution', tail: [tag(L, '1.1.0')] },
  { name: 'Remove background', tail: [okTag(L, '✓')] },
  { name: 'Check automatically', tail: [dim(L, 'on')], gapAbove: true },
]
const boostSheet = (L: Look): Row[] => [
  [bold(L, 'Boost resolution 1.1.0'), blank(1), tag(L, 'new')],
  [dim(L, 'You have 1.0.0 · adds Boost resolution 3×')],
  [],
  [pill(L, '↵ update'), blank(2), dim(L, '15.1 MB')],
]
const u2 = (L: Look): Row[][] => [
  screen(
    L,
    'Updates',
    split(L, U2_ITEMS(L), 0, forgeAvailable(L)),
    keys(L, [
      ['↑↓', 'choose'],
      ['↵', 'copy'],
    ]),
  ),
  screen(
    L,
    'Updates',
    split(L, U2_ITEMS(L), 1, boostSheet(L)),
    keys(L, [
      ['↑↓', 'choose'],
      ['↵', 'update'],
    ]),
  ),
  screen(
    L,
    'Updates',
    split(L, U2_ITEMS(L), 3, autoSheet(L)),
    keys(L, [
      ['↑↓', 'choose'],
      ['↵', 'turn off'],
    ]),
  ),
]

/* ------------------------------------------------------------ U3 */

const sheet = (_L: Look, rows: Row[]): Row[] => rows.map((r) => [blank(2), ...r])
const u3 = (L: Look): Row[][] => [
  screen(
    L,
    'Update',
    sheet(L, [
      [bold(L, `Forge ${NEW} is available`), blank(1), tag(L, 'new'), dim(L, `  you have ${HAVE}`)],
      [],
      [command(L, 'npm i -g forge-terminal'), blank(2), dim(L, 'run it in any terminal')],
      [],
      [quiet(L, 'Checks automatically once a day · a turns it off')],
    ]),
    keys(L, [
      ['↵', 'copy'],
      ['a', 'auto-check off'],
    ]),
  ),
  screen(
    L,
    'Update',
    sheet(L, [
      [bold(L, `Forge ${HAVE}`), blank(2), okTag(L, '✓ the latest'), dim(L, ' · checked just now')],
      [],
      [quiet(L, 'Checks automatically once a day · a turns it off')],
    ]),
    keys(L, [
      ['↵', 'check again'],
      ['a', 'auto-check off'],
    ]),
  ),
]

/* ------------------------------------------------------------ /commands and home */

/** The captured /commands list with /update added under settings; `note` is its description. */
function commandsWith(L: Look, note: 'plain' | 'available'): Row[] {
  const f = L.f.commands as Cell[][]
  const i = f.findIndex((r) => textOf(r).includes('/extensions'))
  const ext = f[i] as Cell[]
  let row = rewrite(ext, '/extensions', '/update')
  // The description is redrawn in one style: the copied cells carry the
  // old text's own bold runs, which land on the wrong letters.
  const old = 'install and remove the AI tools'
  const at = textOf(row).indexOf(old)
  const st = row[at] as Cell
  row = paint(row, at, ' '.repeat(old.length), st.fg ?? L.p.dim, st.bg)
  if (note === 'available')
    row = paint(row, at, ` ${NEW} is available `, L.p.newTag, L.p.newTagBg, true)
  else row = paint(row, at, 'check for a new version', st.fg ?? L.p.dim, st.bg, st.b)
  // The list grows by one row; the blank row under it gives its place.
  const rows = [...f.slice(0, i + 1), row, ...f.slice(i + 2)]
  return rows.map(rowOf)
}

/** Home, with the note drawn where `where` says. */
function homeWith(L: Look, where: 'band' | 'field' | 'tabs'): Row[] {
  const f = (L.f.home as Cell[][]).map((r) => r.map((c) => ({ ...c })))
  if (where === 'band') {
    const i = f.findIndex((r) => textOf(r).includes(`v${HAVE}`))
    const r = f[i] as Cell[]
    const at = textOf(r).indexOf(` v${HAVE}`)
    const note = ` ${NEW} is out · /update `
    f[i] = paint(r, at - note.length, note, L.p.newTag, L.p.newTagBg, true)
    f[i] = paint(f[i] as Cell[], at - note.length - 1, ' ', L.p.fg, null)
  }
  if (where === 'field') {
    const i = f.findIndex((r) => textOf(r).includes('or type a path'))
    const row = blankCells()
    const a = paint(row, 4, '↑ ', L.p.newTag, null, true)
    const b = paint(a, 6, `Forge ${NEW} is out`, L.p.fg, null)
    f[i + 2] = paint(b, 6 + `Forge ${NEW} is out`.length, ' · /update to see how', L.p.dim, null)
  }
  if (where === 'tabs') {
    const i = f.findIndex((r) => textOf(r).includes('/ commands'))
    const r = f[i] as Cell[]
    const at = textOf(r).indexOf('/ commands') + '/ commands'.length + 2
    f[i] = paint(r, at, ` ${NEW} `, L.p.newTag, L.p.newTagBg, true)
  }
  return f.map(rowOf)
}

/** After a one-off command, in a terminal: the run's own output, then the note. */
function cli(L: Look, style: 'line' | 'boxed'): Row[] {
  const prompt = (t: string): Row => [run('~ ', L.p.ok), run('% ', L.p.fg), run(t, L.p.fg)]
  const out: Row[] = [
    prompt('forge photo.jpg --to webp'),
    [run('✓ ', L.p.ok), run('photo.jpg → photo.webp', L.p.fg)],
    [dim(L, '  2.4 MB → 412 KB · 83% smaller')],
    [],
  ]
  if (style === 'line') {
    out.push([
      run('↑ ', L.p.newTag, undefined, true),
      dim(L, `Forge ${NEW} is out (you have ${HAVE}) · `),
      run('npm i -g forge-terminal', L.p.fg),
    ])
  } else {
    out.push(
      [quiet(L, '╭─────────────────────────────────────────────╮')],
      [
        quiet(L, '│ '),
        bold(L, `Forge ${NEW} is out`),
        dim(L, ` · you have ${HAVE}`),
        blank(14),
        quiet(L, '│'),
      ],
      [quiet(L, '│ '), run('npm i -g forge-terminal', L.p.fg), blank(21), quiet(L, '│')],
      [quiet(L, '╰─────────────────────────────────────────────╯')],
    )
  }
  out.push([], prompt(''))
  return out
}

/* ------------------------------------------------------------ round 2 */

/**
 * Round 2: the tag beside the name says "new"; the sheet says "Your version";
 * ↵ updates in place, and the command only appears when Forge cannot run it;
 * Check automatically leaves the split for a row of its own under it, with a
 * B3-style ‹ on › pill at its band's end.
 */
type R2 = 'available' | 'installing' | 'installed' | 'denied' | 'latest'

const AUTO_BAND = 46

/** The B3 pill: ‹ value ›, an arrow grey when there is nothing further that way. */
function onOff(L: Look, on: boolean, live: boolean): Run[] {
  const arrow = (t: string, can: boolean) =>
    run(t, can && live ? L.p.brand : L.p.faint, undefined, true)
  return [
    arrow('‹ ', on),
    run(` ${on ? 'on' : 'off'} `, L.p.fg, L.p.panelBand, true),
    arrow(' ›', !on),
  ]
}

function autoRow(L: Look, on: boolean, at: boolean): Row {
  const name = 'Check automatically'
  const pillRuns = onOff(L, on, at)
  const room = AUTO_BAND - 2 - stringWidth(name) - width(pillRuns) - 1
  if (!at) return [blank(4), dim(L, name), blank(room), ...onOff(L, on, false)]
  return [
    blank(2),
    run('▌', L.p.brand, L.p.listBand),
    run(' ', undefined, L.p.listBand),
    run(name, L.p.fg, L.p.listBand, true),
    run(' '.repeat(room), undefined, L.p.listBand),
    ...pillRuns.map((r) => ({ ...r, bg: r.bg ?? L.p.listBand })),
    run(' ', undefined, L.p.listBand),
  ]
}

/** E5·b's one tinted row: the refusal, said once, in the fail tint. */
const refusal = (L: Look, t: string): Run[] => [
  run(' ✕ ', L.p.fail, L.p.failTint, true),
  run(`${t} `, L.p.fg, L.p.failTint),
]

function r2Sheet(L: Look, s: R2): Row[] {
  const head: Row[] = [[bold(L, `Forge ${NEW}`)], [dim(L, `Your version: ${HAVE}`)], []]
  switch (s) {
    case 'available':
      return [...head, [pill(L, '↵ update'), blank(2), dim(L, 'Forge restarts when it is done')]]
    case 'installing':
      return [...head, [run('⠹ ', L.p.brand), run(`Installing ${NEW}`, L.p.fg), dim(L, ' · 0:04')]]
    case 'installed':
      return [
        [bold(L, `Forge ${NEW}`)],
        [okTag(L, '✓ installed'), dim(L, ' · restart to use it')],
        [],
        [pill(L, '↵ restart')],
      ]
    case 'denied':
      return [
        ...head,
        refusal(L, 'npm needs permission to update Forge'),
        [],
        [command(L, 'sudo npm i -g forge-terminal')],
        [],
        [pill(L, '↵ copy'), blank(2), dim(L, 'run it in any terminal')],
      ]
    case 'latest':
      return [
        [bold(L, `Forge ${HAVE}`)],
        [okTag(L, '✓ the latest'), dim(L, ' · checked just now')],
        [],
        [pill(L, '↵ check again')],
      ]
  }
}

function r2Screen(L: Look, s: R2, opts: { atAuto?: boolean; auto?: boolean } = {}): Row[] {
  const fresh = s === 'available' || s === 'denied' || s === 'installing'
  const forge: Item = {
    name: 'Forge',
    tail: [],
  }
  const atAuto = opts.atAuto ?? false
  const sheet = r2Sheet(L, s)
  // "new" sits right after the name, not at the band's end.
  const nameRow = (on: boolean): Row => {
    const t = fresh ? [blank(1), tag(L, 'new')] : s === 'installed' ? [] : [blank(1), okTag(L, '✓')]
    const used = 2 + stringWidth(forge.name) + width(t)
    if (on) {
      return [
        blank(2),
        run('▌', L.p.brand, L.p.listBand),
        run(' ', undefined, L.p.listBand),
        run(forge.name, L.p.fg, L.p.listBand, true),
        ...t.map((r) => ({ ...r, bg: r.bg ?? L.p.listBand })),
        run(' '.repeat(LIST - used), undefined, L.p.listBand),
      ]
    }
    return [blank(4), dim(L, forge.name), ...t, blank(LIST - used)]
  }
  const left: Row[] = [nameRow(!atAuto)]
  const h = Math.max(left.length, sheet.length + 1)
  const body: Row[] = []
  for (let i = 0; i < h; i++) {
    const l = left[i] ?? [blank(2 + LIST)]
    body.push([...pad(l, 2 + LIST), blank(1), run('│', L.p.faint), blank(2), ...(sheet[i] ?? [])])
  }
  body.push([], autoRow(L, opts.auto ?? true, atAuto))
  const k: [string, string][] = atAuto
    ? [
        ['↑↓', 'choose'],
        ['←→', 'on / off'],
      ]
    : s === 'installing'
      ? []
      : [
          ['↑↓', 'choose'],
          [
            '↵',
            s === 'denied'
              ? 'copy'
              : s === 'installed'
                ? 'restart'
                : s === 'latest'
                  ? 'check again'
                  : 'update',
          ],
        ]
  return screen(
    L,
    'Update',
    body,
    keys(L, k, s === 'installing' ? 'esc stop · ctrl-c quit' : undefined),
  )
}

const R2_FIGS: Fig[] = [
  {
    id: 'V1',
    name: '↵ updates; the command only when Forge cannot run it',
    pick: true,
    note: '<b>Forge</b> carries a blue <b>new</b> beside its name; the sheet says <b>Your version: 0.2.1</b>. <b>↵ update</b> runs npm for you (no percentage — npm gives none, so a spinner and a clock, as the working screen does), then offers <b>↵ restart</b>. Only when npm is refused (Node installed for the whole Mac needs sudo) does the command appear, in one tinted row and the field’s band, with ↵ copy. <b>Check automatically</b> leaves the split for a row of its own under it, with B3’s pill at its band’s end: ←→ turns it on and off, the arrow that leads nowhere goes grey. Shown: available, installing, installed, refused, already the latest, the switch highlighted (on), then off.',
    draw: (L) => [
      r2Screen(L, 'available'),
      r2Screen(L, 'installing'),
      r2Screen(L, 'installed'),
      r2Screen(L, 'denied'),
      r2Screen(L, 'latest'),
      r2Screen(L, 'available', { atAuto: true, auto: true }),
      r2Screen(L, 'available', { atAuto: true, auto: false }),
    ],
  },
]

/** N1 in the band, in plain fg (white on dark, black on light), as text or as a pill. */
function homeBand(L: Look, style: 'text' | 'pill'): Row[] {
  const f = (L.f.home as Cell[][]).map((r) => r.map((c) => ({ ...c })))
  const i = f.findIndex((r) => textOf(r).includes(`v${HAVE}`))
  const r = f[i] as Cell[]
  const at = textOf(r).indexOf(` v${HAVE}`)
  const note = style === 'pill' ? ` ${NEW} is out · /update ` : `${NEW} is out · /update`
  const fg = style === 'pill' ? L.p.ink : L.p.fg
  const bg = style === 'pill' ? L.p.pill : null
  f[i] = paint(r, at - note.length - 1, ' ', L.p.fg, null)
  f[i] = paint(f[i] as Cell[], at - note.length, note, fg, bg, true)
  return f.map(rowOf)
}

const N1_FIGS: Fig[] = [
  {
    id: 'N1a',
    name: 'In the band, as text',
    pick: true,
    note: 'White on dark, black on light, bold, on the band’s baseline before the version. Reads as part of the band.',
    draw: (L) => [homeBand(L, 'text')],
  },
  {
    id: 'N1b',
    name: 'In the band, as a pill',
    note: 'The same words knocked out of a white pill on dark, black on light — the ↵ pill’s look. Louder.',
    draw: (L) => [homeBand(L, 'pill')],
  },
]

/** After a command, shaped like a Forge error: symbol and title, then the detail and the way forward, indented. */
function cliNote(L: Look, colour: boolean): Row[] {
  const c = (t: string, fg: string, b = false) =>
    colour ? run(t, fg, undefined, b) : run(t, L.p.fg)
  const prompt = (t: string): Row => [run('~ ', L.p.ok), run('% ', L.p.fg), run(t, L.p.fg)]
  return [
    prompt('forge photo.jpg --to webp'),
    [run('✓ ', L.p.ok), run('photo.jpg → photo.webp', L.p.fg)],
    [dim(L, '  2.4 MB → 412 KB · 83% smaller')],
    [],
    [c('↑ ', L.p.newTag, true), c('Update available', L.p.fg, true)],
    [],
    [c(`  Forge ${NEW} is out.`, L.p.fg), c(` Your version: ${HAVE}`, L.p.dim)],
    [],
    [c('  ', L.p.fg), c('forge update', L.p.fg, true), c(' installs it.', L.p.dim)],
    [],
    prompt(''),
  ]
}

const L1_FIGS: Fig[] = [
  {
    id: 'L1a',
    name: 'Shaped like an error, in colour',
    pick: true,
    note: 'The same shape as “✕ File not found”: a symbol and a title, then the detail and the way forward indented under it, a blank line between. The ↑ is the blue of “new”, the title bold, the rest dim except the command. <b>forge update</b> does what ↵ update does in the app. Once a day at most; never with --json, MCP or a pipe.',
    draw: (L) => [cliNote(L, true)],
  },
  {
    id: 'L1b',
    name: 'Shaped like an error, plain',
    note: 'Exactly as Forge prints errors today: one colour. Matches them perfectly; easier to skim past.',
    draw: (L) => [cliNote(L, false)],
  },
]

/* ------------------------------------------------------------ round 3 */

/** Round 3's list is wider by four, so "Check automatically" and its pill fit on one row. */
const LIST3 = 31

function r3Screen(
  L: Look,
  s: R2,
  opts: { atAuto?: boolean; auto?: boolean; gap?: boolean; blankSheet?: boolean } = {},
): Row[] {
  const fresh = s === 'available' || s === 'denied' || s === 'installing'
  const atAuto = opts.atAuto ?? false
  const on = opts.auto ?? true
  const band = (cells: Run[], hi: boolean): Row => {
    const used = 2 + width(cells)
    if (!hi)
      return [
        blank(2),
        blank(2),
        ...cells.map((r) => (r.fg === L.p.fg && r.bold ? { ...r, fg: L.p.dim, bold: false } : r)),
        blank(Math.max(0, LIST3 - used)),
      ]
    return [
      blank(2),
      run('▌', L.p.brand, L.p.listBand),
      run(' ', undefined, L.p.listBand),
      ...cells.map((r) => ({ ...r, bg: r.bg ?? L.p.listBand })),
      run(' '.repeat(Math.max(0, LIST3 - used)), undefined, L.p.listBand),
    ]
  }
  const forgeCells: Run[] = [
    run('Forge', L.p.fg, undefined, true),
    ...(fresh ? [blank(1), tag(L, 'new')] : s === 'installed' ? [] : [blank(1), okTag(L, '✓')]),
  ]
  const name = 'Check automatically'
  const pillRuns = onOff(L, on, atAuto)
  const autoCells: Run[] = [
    run(name, L.p.fg, undefined, true),
    blank(LIST3 - 2 - stringWidth(name) - width(pillRuns) - 1),
    ...pillRuns,
  ]
  const left: Row[] = [
    band(forgeCells, !atAuto),
    ...(opts.gap ? [[blank(2 + LIST3)]] : []),
    band(autoCells, atAuto),
  ]
  const sheet: Row[] = atAuto
    ? opts.blankSheet
      ? []
      : [
          [bold(L, 'Check automatically')],
          [dim(L, on ? 'Once a day, in the background.' : 'Off. /update still checks.')],
          [],
          [quiet(L, 'Asks npm for the latest version number;')],
          [quiet(L, 'nothing about your files is sent.')],
        ]
    : r2Sheet(L, s)
  const h = Math.max(left.length, r2Sheet(L, s).length + 1)
  const body: Row[] = []
  for (let i = 0; i < h; i++) {
    const l = left[i] ?? [blank(2 + LIST3)]
    body.push([...pad(l, 2 + LIST3), blank(1), run('│', L.p.faint), blank(2), ...(sheet[i] ?? [])])
  }
  const k: [string, string][] = atAuto
    ? [
        ['↑↓', 'choose'],
        ['←→', 'on / off'],
      ]
    : s === 'installing'
      ? []
      : [
          ['↑↓', 'choose'],
          [
            '↵',
            s === 'denied'
              ? 'copy'
              : s === 'installed'
                ? 'restart'
                : s === 'latest'
                  ? 'check again'
                  : 'update',
          ],
        ]
  return screen(
    L,
    'Update',
    body,
    keys(L, k, s === 'installing' ? 'esc stop · ctrl-c quit' : undefined),
  )
}

/** N1, reworded: "/update is available · v0.2.1", the first half in `colour`. */
function homeBand3(L: Look, colour: string, frame = 'home', crop = false): Row[] {
  const f = (L.f[frame] as Cell[][]).map((r) => r.map((c) => ({ ...c })))
  const i = f.findIndex((r) => textOf(r).includes(`v${HAVE}`))
  const r = f[i] as Cell[]
  const at = textOf(r).indexOf(` v${HAVE}`)
  const note = '/update is available'
  const sep = ' ·'
  const start = at - note.length - sep.length
  f[i] = paint(r, start - 1, ' ', L.p.fg, null)
  f[i] = paint(f[i] as Cell[], start, note, colour, null, true)
  f[i] = paint(f[i] as Cell[], start + note.length, sep, L.p.dim, null)
  const tabs = f.findIndex((r) => textOf(r).includes('2 compress'))
  return (crop ? f.slice(0, tabs + 1) : f).map(rowOf)
}

/* ---- the note after a command: ten ways */

const OUT = (L: Look): Row[] => [
  [run('~ ', L.p.ok), run('% ', L.p.fg), run('forge photo.jpg --to webp', L.p.fg)],
  [run('✓ ', L.p.ok), run('photo.jpg → photo.webp', L.p.fg)],
  [dim(L, '  2.4 MB → 412 KB · 83% smaller')],
  [],
]
const END = (L: Look): Row[] => [[], [run('~ ', L.p.ok), run('% ', L.p.fg)]]
const after = (L: Look, note: Row[]): Row[][] => [[...OUT(L), ...note, ...END(L)]]
const goldChip = (L: Look, t: string) => run(` ${t} `, L.p.ink, L.p.brand, true)
const keycap = (L: Look, t: string) => run(` ${t} `, L.p.fg, L.p.keycapBg, true)

/** The header bar's hatching, `n` cells, in the commands' gold gradient. */
function hatch(L: Look, n: number): Run[] {
  const stops = modeGradient(L.p, 'commands')
  return Array.from({ length: n }, (_, k) =>
    run('╱', stops[Math.min(stops.length - 1, Math.floor((k / n) * stops.length))]),
  )
}

const L_FIGS: Fig[] = [
  {
    id: 'A1',
    name: 'The header bar, small',
    pick: true,
    note: 'The app’s own header bar, brought to the terminal: the gold <b>update</b> chip, the hatching, and the versions knocked out of it at the far end — the same thing /update opens with. Unmistakably Forge, one row, and the command under it.',
    draw: (L) =>
      after(L, [
        [
          goldChip(L, 'update'),
          ...hatch(L, 30),
          blank(1),
          dim(L, `${HAVE} → `),
          bold(L, NEW),
          blank(1),
          ...hatch(L, 2),
        ],
        [blank(1), dim(L, 'Run '), bold(L, 'forge update'), dim(L, ' to install it')],
      ]),
  },
  {
    id: 'A2',
    name: 'Gold chip, one sentence',
    note: 'Just the chip and a sentence on one line. The chip carries the colour; the sentence stays calm.',
    draw: (L) =>
      after(L, [
        [
          goldChip(L, 'update'),
          blank(1),
          bold(L, `Forge ${NEW} is out`),
          dim(L, ' · '),
          run('forge update', L.p.fg),
        ],
      ]),
  },
  {
    id: 'A3',
    name: 'Version arrow',
    note: 'The change itself is the message: your version dim, an arrow, the new one in blue. The command sits right after it.',
    draw: (L) =>
      after(L, [
        [
          dim(L, 'Forge  '),
          run(HAVE, L.p.border),
          dim(L, '  ──→  '),
          run(NEW, L.p.newTag, undefined, true),
          dim(L, '   '),
          keycap(L, 'forge update'),
        ],
      ]),
  },
  {
    id: 'A4',
    name: 'Two pills',
    note: '<b>your version 0.2.1</b> in a grey pill, <b>latest 0.2.2</b> in a blue one, the command after them. Reads like a status line.',
    draw: (L) =>
      after(L, [
        [
          run(` your version ${HAVE} `, L.p.dim, L.p.keycapBg),
          blank(1),
          run(` latest ${NEW} `, L.p.newTag, L.p.newTagBg, true),
          dim(L, '  → '),
          bold(L, 'forge update'),
        ],
      ]),
  },
  {
    id: 'A5',
    name: 'The list’s gold bar',
    note: 'The ▌ the app uses for the highlighted row, on two lines: what happened, then what to do. Quiet, but it looks like part of Forge rather than a print-out.',
    draw: (L) =>
      after(L, [
        [run('▌ ', L.p.brand), bold(L, `Forge ${NEW} is available`)],
        [run('▌ ', L.p.brand), dim(L, `Your version: ${HAVE} · `), run('forge update', L.p.fg)],
      ]),
  },
  {
    id: 'A6',
    name: 'Tinted panel',
    note: 'Errors in the app sit in a tinted panel (E5); this is the same panel in the blue of “new”, two rows, full width. The loudest of the ten, without a box drawn in lines.',
    draw: (L) =>
      after(L, [
        pad(
          [
            run(' ↑ ', L.p.newTag, L.p.newTagBg, true),
            run(`Forge ${NEW} is available`, L.p.fg, L.p.newTagBg, true),
          ],
          60,
          L.p.newTagBg,
        ),
        pad(
          [
            run(`   Your version: ${HAVE} · `, L.p.dim, L.p.newTagBg),
            run('forge update', L.p.fg, L.p.newTagBg, true),
          ],
          60,
          L.p.newTagBg,
        ),
      ]),
  },
  {
    id: 'A7',
    name: 'Like the hint bar',
    note: 'A rule and a row shaped like the app’s hint bar: the news on the left, the keys on the right in the hint bar’s quiet grey — including how to turn it off.',
    draw: (L) =>
      after(L, [
        [run('─'.repeat(64), L.p.border)],
        [
          run('↑ ', L.p.newTag, undefined, true),
          bold(L, `${NEW} is out`),
          blank(14),
          keycap(L, 'forge update'),
          quiet(L, '  · update-check off'),
        ],
      ]),
  },
  {
    id: 'A8',
    name: 'Keycap command',
    note: 'The sentence in grey and the command drawn as a key, the way the app draws ↵ and esc. The eye goes straight to what to type.',
    draw: (L) =>
      after(L, [
        [
          dim(L, `Forge ${NEW} is out (you have ${HAVE}).  `),
          keycap(L, 'forge update'),
          dim(L, ' installs it'),
        ],
      ]),
  },
  {
    id: 'A9',
    name: 'Corner bracket',
    note: 'A light bracket in gold down the left of two lines, like a note in the margin. Separates the news from the conversion’s output without a full box.',
    draw: (L) =>
      after(L, [
        [run('┌ ', L.p.brand), bold(L, 'Update available'), dim(L, `  ${HAVE} → ${NEW}`)],
        [run('└ ', L.p.brand), dim(L, 'run '), run('forge update', L.p.fg, undefined, true)],
      ]),
  },
  {
    id: 'A10',
    name: 'Hatched edges',
    note: 'The band’s ╱ hatching as two short ends either side of the sentence, as the version sits in the FORGE band at home. A smaller echo of A1.',
    draw: (L) =>
      after(L, [
        [
          ...hatch(L, 3),
          blank(1),
          bold(L, `Forge ${NEW} is out`),
          dim(L, ' · '),
          run('forge update', L.p.fg),
          blank(1),
          ...hatch(L, 3),
        ],
      ]),
  },
]

const R3_SCREEN: Fig = {
  id: 'V2',
  name: 'Check automatically in the list, under Forge',
  pick: true,
  note: 'The switch is a row of the list, under Forge, with B3’s ‹ on › pill at the end of its band (the list is four cells wider so both fit). ←→ flips it while it is highlighted; its sheet says what it does in two lines. Everything else is V1. Shown: available, installing, installed, refused, the latest, the switch on, the switch off.',
  draw: (L) => [
    r3Screen(L, 'available'),
    r3Screen(L, 'installing'),
    r3Screen(L, 'installed'),
    r3Screen(L, 'denied'),
    r3Screen(L, 'latest'),
    r3Screen(L, 'available', { atAuto: true, auto: true }),
    r3Screen(L, 'available', { atAuto: true, auto: false }),
  ],
}
const R3_BAND: Fig[] = [
  {
    id: 'N1·blue',
    name: '“/update is available” in the blue of “new”',
    pick: true,
    note: 'The same blue as the <b>new</b> tag on /update, so the two read as one thing. The dot and the version keep the band’s own colours.',
    draw: (L) => [homeBand3(L, L.p.newTag)],
  },
  {
    id: 'N1·green',
    name: 'In green',
    note: 'The ✓ green: reads as good news. It is also the colour of “done”, which this is not yet.',
    draw: (L) => [homeBand3(L, L.p.ok)],
  },
  {
    id: 'N1·violet',
    name: 'In violet',
    note: 'The violet of labels and Enhance. Distinct from everything else on home; says nothing by itself.',
    draw: (L) => [homeBand3(L, L.p.violet)],
  },
]

/* ------------------------------------------------------------ round 4 */

const MODES = ['convert', 'compress', 'pdf', 'enhance', 'colour'] as const
const R4_SCREEN: Fig = {
  id: 'V3',
  name: 'A gap between Forge and the switch',
  pick: true,
  note: 'V2 with one empty row between <b>Forge</b> and <b>Check automatically</b>, as /commands leaves a gap before its settings. ↑↓ skips the gap.',
  draw: (L) => [
    r3Screen(L, 'available', { gap: true }),
    r3Screen(L, 'available', { gap: true, atAuto: true }),
    r3Screen(L, 'latest', { gap: true }),
  ],
}
const colourName: Record<string, (L: Look) => string> = {
  blue: (L) => L.p.newTag,
  green: (L) => L.p.ok,
  violet: (L) => L.p.violet,
}
const R4_MODES: Fig[] = Object.entries(colourName).map(([name, c], i) => ({
  id: `N1·${name}`,
  name: `“/update is available” in ${name}, in every mode`,
  ...(i === 0 ? { pick: true } : {}),
  note:
    name === 'blue'
      ? 'Blue sits apart from every mode’s hatching: convert’s is cyan, the nearest, but lighter and greener. In light mode it darkens with the rest of the palette. The one that never matches a mode.'
      : name === 'green'
        ? 'In <b>compress</b> mode the hatching is this same green, so the words melt into it. Fine in the other four.'
        : 'In <b>enhance</b> mode the hatching is violet too, and the words sink into it. Fine in the other four.',
  draw: (L) => MODES.map((m) => homeBand3(L, c(L), `home-${m}`, true)),
}))
const R4_A6: Fig = {
  id: 'A6',
  name: 'Tinted panel, as you picked it',
  pick: true,
  note: 'A6 in dark and light. It says <b>forge update</b>, not /update: this note is printed in your terminal after a one-off command, where /update means nothing — /update only works inside the app. <b>forge update</b> does the same thing from the terminal: it installs the new version.',
  draw: (L) => (L_FIGS.find((f) => f.id === 'A6') as Fig).draw(L),
}

/* ------------------------------------------------------------ round 5 */

/**
 * The mode's colour turned half way round the hue circle in OKLCH: same
 * lightness, chroma brought in until it fits sRGB, then lightness nudged until
 * it reads at 4.5:1 on the canvas.
 */
function opposite(hex: string, canvas: string): string {
  const lch = toLch(rgbToOklab(parseHex(hex) as never))
  const out = { L: lch.L, C: lch.C, h: (lch.h + 180) % 360 }
  while (!inGamut(fromLch(out)) && out.C > 0) out.C -= 0.005
  const bg = parseHex(canvas) as never
  const dark = toLch(rgbToOklab(bg)).L < 0.5
  for (let k = 0; k < 60; k++) {
    const rgb = oklabToRgb(fromLch(out))
    if (contrast(rgb, bg) >= 4.5) break
    out.L += dark ? 0.01 : -0.01
    while (!inGamut(fromLch(out)) && out.C > 0) out.C -= 0.005
  }
  return toHex(oklabToRgb(fromLch(out)))
}
const OPPOSITES: string[] = []
const R5_MODES: Fig = {
  id: 'N1·opposite',
  name: '“/update is available” in the mode’s opposite colour',
  pick: true,
  note: 'Each mode’s own colour turned half way round the colour wheel, at the same lightness, then checked to read at 4.5:1 on the background. So it always stands out from the hatching beside it, whichever mode you are in. Values, dark / light: OPPOSITES_HERE.',
  draw: (L) =>
    MODES.map((m) => {
      const c = opposite(modeColours(L.p, m as ShellMode).fg, L.p.canvas)
      OPPOSITES.push(`${L.name} ${m} ${c}`)
      return homeBand3(L, c, `home-${m}`, true)
    }),
}
const R5_SCREEN: Fig = {
  id: 'V4',
  name: 'The switch’s sheet left blank',
  pick: true,
  note: 'With <b>Check automatically</b> highlighted, the right side is empty: the row and its ‹ on › say everything.',
  draw: (L) => [
    r3Screen(L, 'available', { gap: true }),
    r3Screen(L, 'available', { gap: true, atAuto: true, blankSheet: true }),
    r3Screen(L, 'available', { gap: true, atAuto: true, auto: false, blankSheet: true }),
  ],
}
const R5_A6: Fig = {
  id: 'A6',
  name: 'Tinted panel: “In terminal: forge update”',
  pick: true,
  note: 'The second line now says where to type it: <b>In terminal:</b> then <b>forge update</b> in bold. Your version moves up to the first line, dim.',
  draw: (L) =>
    after(L, [
      pad(
        [
          run(' ↑ ', L.p.newTag, L.p.newTagBg, true),
          run(`Forge ${NEW} is available`, L.p.fg, L.p.newTagBg, true),
          run(` · your version ${HAVE}`, L.p.dim, L.p.newTagBg),
        ],
        60,
        L.p.newTagBg,
      ),
      pad(
        [
          run('   In terminal: ', L.p.dim, L.p.newTagBg),
          run('forge update', L.p.fg, L.p.newTagBg, true),
        ],
        60,
        L.p.newTagBg,
      ),
    ]),
}

/* ------------------------------------------------------------ page */

const GLYPH: Record<string, string> = {}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function html(rows: Row[], p: Palette): string {
  rows.forEach((r, i) => {
    if (width(r) > N) console.warn(`row ${i} is ${width(r)} wide:`, r.map((x) => x.text).join(''))
  })
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
        let inner = ''
        for (const ch of x.text) inner += GLYPH[ch] ? `<i class="${GLYPH[ch]}"></i>` : esc(ch)
        out += style ? `<span style="${style}">${inner}</span>` : `<span>${inner}</span>`
        used += stringWidth(x.text)
      }
      if (used < N) out += `<span>${' '.repeat(N - used)}</span>`
      return `<div class="r">${out}</div>`
    })
    .join('')
  return `<div class="t" style="background:${p.canvas};color:${p.fg}">${body}</div>`
}

interface Fig {
  id: string
  name: string
  pick?: boolean
  note: string
  draw: (L: Look) => Row[][]
}
function figure(f: Fig): string {
  const themes = looks
    .map(
      (L) =>
        `<div class="theme ${L.name}">${f
          .draw(L)
          .map((fr) => html(fr, L.p))
          .join('')}</div>`,
    )
    .join('')
  return `<figure><div class="vt"><span class="id">${f.id}</span><span class="name">${f.name}</span>${f.pick ? '<span class="pick">MY PICK</span>' : ''}</div>${themes}<p class="idea">${f.note}</p></figure>`
}

const SCREEN_FIGS: Fig[] = [
  {
    id: 'U1',
    name: 'Split view: Forge, and the switch',
    pick: true,
    note: 'Two rows, drawn exactly as /extensions draws its list. <b>Forge</b> says on its row whether there is a new version (a blue tag, the colour Save as uses for “new”) or a green ✓; its sheet shows the command in the field’s band and <b>↵ copies it</b>. <b>Check automatically</b> is the off switch, with one honest sentence about what the check sends. Shown: a new version is out; you are on the latest; the switch highlighted.',
    draw: u1,
  },
  {
    id: 'U2',
    name: 'Split view: everything that can update',
    note: 'The same split, but the list is every piece of Forge that has a version: Forge itself and each installed extension. An extension with a newer build (here Boost 1.1.0, which brings 3×) updates right here with ↵, as /extensions does today. One screen answers “is anything out of date?”. The cost: extension updates now live in two places, unless /extensions stops showing them.',
    draw: u2,
  },
  {
    id: 'U3',
    name: 'No split: one sheet',
    note: 'For comparison: no list, just the answer. The command, ↵ to copy it, and the switch as a key (<b>a</b>) with one quiet line saying it is on. Fewest moving parts; the switch is easy to miss.',
    draw: u3,
  },
]

const WHERE_FIGS: Fig[] = [
  {
    id: 'C1',
    name: '/commands: one more setting',
    pick: true,
    note: '<b>/update</b> joins /theme and /extensions under settings. When a newer Forge is out, its description becomes a blue “0.2.2 is available” tag, so opening the list is enough to notice it.',
    draw: (L) => [commandsWith(L, 'plain'), commandsWith(L, 'available')],
  },
  {
    id: 'N1',
    name: 'Home: in the FORGE band, before the version',
    pick: true,
    note: 'The note sits on the band’s baseline just before <b>v0.2.1</b>, where the version already is: “0.2.2 is out · /update”. Seen every time home opens, takes no row, and goes away once you update.',
    draw: (L) => [homeWith(L, 'band')],
  },
  {
    id: 'N2',
    name: 'Home: a line under the field',
    note: 'A sentence under the prompt: “↑ Forge 0.2.2 is out · /update to see how”. Clearest wording, but it competes with the drop zone, the one thing home is for.',
    draw: (L) => [homeWith(L, 'field')],
  },
  {
    id: 'N3',
    name: 'Home: a tag at the end of the tabs',
    note: 'Just the version, as a small tag after <b>/ commands</b>, pointing at where /update lives. Quietest; says the least.',
    draw: (L) => [homeWith(L, 'tabs')],
  },
]

const CLI_FIGS: Fig[] = [
  {
    id: 'L1',
    name: 'One line after the output',
    pick: true,
    note: 'One dim line after the run’s own output, at most once a day, only when a person is at the terminal. Never with --json, MCP or a pipe. Copy-pasteable command at its end.',
    draw: (L) => [cli(L, 'line')],
  },
  {
    id: 'L2',
    name: 'A small box',
    note: 'The box many npm tools draw. Harder to miss, but louder than anything else Forge prints after a conversion.',
    draw: (L) => [cli(L, 'boxed')],
  },
]

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · Check for updates</title>
<style>
  :root { --page:#0d0e11; --ink:#e2e4ea; --muted:#8f94a1; --rule:#23252c; --cyan:#55c7d9; --mono:"SF Mono", ui-monospace, Menlo, monospace; --sans:-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--page); color:var(--ink); font:16px/1.6 var(--sans); }
  main { max-width:2300px; margin:0 auto; padding:44px 24px 120px; }
  h1 { font-size:32px; margin:0 0 8px; }
  .lede { color:var(--muted); max-width:1000px; margin:0; }
  .tabs { position:sticky; top:0; z-index:5; display:flex; flex-wrap:wrap; gap:6px; margin:22px -24px 0; padding:12px 24px; background:rgba(13,14,17,.94); border-bottom:1px solid var(--rule); align-items:center; }
  .tabs .sp { flex:1; }
  .tabs label { font:13px var(--mono); color:var(--muted); display:flex; gap:6px; align-items:center; }
  .tabs a { font:13px var(--mono); color:var(--muted); text-decoration:none; border:1px solid var(--rule); padding:6px 12px; border-radius:8px; cursor:pointer; }
  .tabs a.on { color:#0c1d22; background:var(--cyan); border-color:var(--cyan); font-weight:700; }
  section { display:none; margin-top:30px; } section.on { display:block; }
  .intro { color:#c7cbd4; max-width:1000px; }
  figure { margin:34px 0 0; }
  .vt { display:flex; align-items:baseline; gap:10px; margin-bottom:8px; }
  .vt .id { font:700 12px var(--mono); padding:3px 7px; border-radius:6px; background:#12282e; color:var(--cyan); }
  .vt .name { font-weight:620; }
  .vt .pick { font:600 11px var(--mono); letter-spacing:.08em; color:#6fcf7f; border:1px solid #2c5a37; padding:2px 7px; border-radius:6px; }
  .idea { font-size:14.5px; color:#c7cbd4; margin:8px 0 0; max-width:1000px; }
  .theme { display:flex; flex-wrap:wrap; gap:14px; }
  .theme + .theme { margin-top:14px; }
  body.only-dark .theme.light, body.only-light .theme.dark { display:none; }
  .t { font:13px/1 var(--mono); padding:12px 14px; border-radius:10px; border:1px solid #2c2f37; width:max-content; }
  .r { height:17px; white-space:pre; overflow:hidden; }
  .r > span { display:inline-block; height:17px; line-height:17px; vertical-align:top; }
</style></head>
<body class="both"><main>
<h1>Check for updates</h1>
<p class="lede">/commands and home are captured from the app at 80 × 24; /update copies /extensions’ split view, drawn with the app’s own colours. Forge checks npm once a day in the background (with an off switch) and /update checks on demand. Round 1 only said how to update; round 2 updates when you press ↵. Switch dark and light at the right of the tab bar.</p>
<div class="tabs"><a data-t="r5" class="on">★ Round 5</a><a data-t="r4">Round 4</a><a data-t="r3">Round 3</a><a data-t="r2">Round 2</a><a data-t="screen">The /update screen · round 1</a><a data-t="where">/commands and home</a><a data-t="cli">After a command</a><span class="sp"></span>
<label><input type="radio" name="th" value="only-dark"> dark</label><label><input type="radio" name="th" value="only-light"> light</label><label><input type="radio" name="th" value="both" checked> both</label></div>
<section id="s-r5" class="on"><p class="intro">Round 4’s notes. <b>V4</b>: nothing on the right while the switch is highlighted. <b>/update is available</b> in each mode’s opposite colour. <b>A6</b> says “In terminal: <b>forge update</b>”.</p>
${figure(R5_SCREEN)}${figure(R5_MODES).replace('OPPOSITES_HERE', OPPOSITES.join(', '))}${figure(R5_A6)}</section>
<section id="s-r4"><p class="intro">Round 3’s notes. <b>V3</b>: a gap between Forge and the switch. Then how “/update is available” looks in all five modes — the band’s hatching takes each mode’s colour, so a colour that matches one of them disappears there. Then <b>A6</b>, which you picked for after a command. Shown in dark and light; the toggle at the right of the tab bar switches.</p>
${figure(R4_SCREEN)}${R4_MODES.map(figure).join('')}${figure(R4_A6)}</section>
<section id="s-r3"><p class="intro">Round 2’s notes, applied. <b>V2</b>: Check automatically is a row in the list under Forge, with its toggle. <b>N1</b> now reads “/update is available · v0.2.1”, the first half in a colour of its own — three colours to choose from. Then <b>ten</b> new ways to say it after a command, A1–A10.</p>
${figure(R3_SCREEN)}${R3_BAND.map(figure).join('')}${L_FIGS.map(figure).join('')}</section>
<section id="s-r2"><p class="intro">Your notes on round 1, applied. <b>V1</b>: the tag beside Forge says <b>new</b>; the sheet says <b>Your version</b>; <b>↵ update</b> updates in place, so the command only shows when Forge is not allowed to run it; <b>Check automatically</b> is a row under the split with an on/off pill like Boost’s 2× · 4×. Then N1 in white or black by theme, and L1 shaped like an error.</p>
${R2_FIGS.map(figure).join('')}${N1_FIGS.map(figure).join('')}${L1_FIGS.map(figure).join('')}</section>
<section id="s-screen"><p class="intro">What <b>/update</b> opens. U1 and U2 use the split view from /extensions, as you suggested; U3 is the no-split version for comparison. Each shows a few moments side by side.</p>
${SCREEN_FIGS.map(figure).join('')}</section>
<section id="s-where"><p class="intro">Where /update is listed, and how home says a newer Forge is out. One of N1–N3 would be chosen; C1 goes with any of them.</p>
${WHERE_FIGS.map(figure).join('')}</section>
<section id="s-cli"><p class="intro">After a one-off command, when a newer Forge is out and the day’s note has not been shown yet. Never in --json, MCP or piped output.</p>
${CLI_FIGS.map(figure).join('')}</section>
</main>
<script>
document.querySelectorAll('.tabs a').forEach((a) => a.onclick = () => {
  document.querySelectorAll('.tabs a').forEach((b) => b.classList.toggle('on', b === a))
  document.querySelectorAll('section').forEach((s) => s.classList.toggle('on', s.id === 's-' + a.dataset.t))
  history.replaceState(null, '', '#' + a.dataset.t)
})
const h = location.hash.slice(1); if (h) document.querySelector('.tabs a[data-t="' + h + '"]')?.click()
document.querySelectorAll('input[name=th]').forEach((r) => r.onchange = () => { document.body.className = r.value })
const th = new URLSearchParams(location.search).get('theme'); if (th) { const v = th === 'both' ? 'both' : 'only-' + th; document.body.className = v; const r = document.querySelector('input[value="' + v + '"]'); if (r) r.checked = true }
</script></body></html>`

const out = new URL('../mockups/update-check-2026-10.html', import.meta.url)
writeFileSync(out, page)
console.log('wrote', decodeURIComponent(out.pathname), page.length)
