/**
 * Resize and Trim (2026-10-12): where they sit in Enhance's list, and six
 * ways Resize could ask for the size.
 *
 * The card, the field and the picker's band are cells captured from the real
 * app (a throwaway test wrote /tmp/forge-resize/frames-{dark,light}.json);
 * the bar and title come from the app's own art functions. What the app
 * cannot draw yet is composed here from those cells' colours.
 *
 *   npx tsx scripts/resize-mockup.ts   → mockups/resize-2026-10.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import stringWidth from 'string-width'
import { trailBarRow } from '../src/shell/bar-art.js'
import { blank, type Row, type Run, width } from '../src/shell/home-art.js'
import { titleRow } from '../src/shell/quality-art.js'
import { DARK, LIGHT, modeColours, modePalette, type Palette } from '../src/shell/theme.js'

const N = 80

interface Cell {
  ch: string
  fg: string | null
  bg: string | null
  b: boolean
}
const frames = (name: string) =>
  JSON.parse(readFileSync(`/tmp/forge-resize/frames-${name}.json`, 'utf8')) as Record<
    string,
    Cell[][]
  >
const CAPTURED = { dark: frames('dark'), light: frames('light') }

/** Captured cells back into runs. */
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

/** The colours a screen here needs, read from the palette and the captured cells. */
interface Look {
  p: Palette
  mode: string
  fg: string
  dim: string
  quiet: string
  sel: string
  field: string
  pill: string
  keycap: string
  warn: string
  card: Row[]
}
function lookOf(base: Palette): Look {
  const name = base.name === 'light' ? 'light' : 'dark'
  const f = CAPTURED[name]
  const p = modePalette(base, 'enhance')
  const picker = f[`${name}:enhance-picker`] as Cell[][]
  const typed = f[`${name}:size-typed`] as Cell[][]
  const unit = (typed[11] as Cell[]).find((c) => c.ch === 'K') as Cell
  return {
    p,
    mode: modeColours(p, 'enhance').fg,
    fg: p.fg,
    dim: p.dim,
    quiet: p.border,
    sel: (picker[9] as Cell[])[0]?.bg as string,
    field: (typed[11] as Cell[])[0]?.bg as string,
    pill: unit.bg as string,
    keycap: p.keycapBg,
    warn: p.warn,
    card: picker.slice(2, 6).map(rowOf),
  }
}

/* ------------------------------------------------------------ helpers */

const run = (text: string, fg?: string, bg?: string, bold = false): Run => ({ text, fg, bg, bold })
const pad = (row: Row, n: number, bg?: string): Row => [
  ...row,
  ...(n > width(row) ? [{ text: ' '.repeat(n - width(row)), bg }] : []),
]

function keys(L: Look, main: [string, string][], foot: string): Row[] {
  const row: Row = [blank(1)]
  main.forEach(([k, w], i) => {
    if (i) row.push(blank(2))
    row.push(run(` ${k} `, L.fg, L.keycap, true), run(` ${w}`, L.dim))
  })
  row.push(blank(Math.max(1, N - width(row) - stringWidth(foot) - 1)), run(foot, L.quiet))
  return [[run('─'.repeat(N), L.quiet)], row]
}

/** A whole screen: bar, card, title, the question's rows, keys. */
function screen(
  L: Look,
  trail: { answers: string[]; current: string },
  title: string,
  aside: string | undefined,
  body: Row[],
  keyRow: Row[],
): Row[] {
  return [
    trailBarRow({ width: N, palette: L.p, mode: 'enhance', trail, slanted: false }),
    [],
    ...L.card,
    [],
    titleRow({ palette: L.p, mode: 'enhance', title, aside, width: N }),
    [],
    ...body,
    [],
    ...keyRow,
  ]
}

const ASIDE = 'IMG_2041.jpg · 4032 × 3024'
const PICK_KEYS = (L: Look) =>
  keys(
    L,
    [
      ['↑↓', 'choose'],
      ['↵', 'confirm'],
    ],
    '1–5 mode · esc back · ctrl-c quit',
  )
const FIELD_KEYS = (L: Look, extra: [string, string][] = []) =>
  keys(L, [['↵', 'confirm'], ...extra], 'esc back · ctrl-c quit')

/** One picker row: the band and ▌ when chosen, the detail only then. */
interface Item {
  label: string
  detail?: Run[]
  /** Dimmed, with why, whether chosen or not. */
  off?: string
}
function picker(L: Look, items: Item[], chosen: number, gapAfter?: number): Row[] {
  const col = 2 + Math.max(...items.map((i) => stringWidth(i.label))) + 2
  const out: Row[] = []
  items.forEach((it, i) => {
    const on = i === chosen
    const bg = on ? L.sel : undefined
    const row: Row = [
      on ? run('▌', L.mode, bg) : blank(1),
      run(' ', undefined, bg),
      run(it.label, it.off ? L.dim : on ? L.fg : undefined, bg, on && !it.off),
    ]
    const tail = it.off ? [run(it.off, L.dim, bg)] : on ? (it.detail ?? []) : []
    const r = pad(row, col, bg)
    out.push(on ? pad([...r, ...tail.map((x) => ({ ...x, bg }))], 52, bg) : [...r, ...tail])
    if (gapAfter !== undefined && i === gapAfter) out.push([])
  })
  return out
}
const dimB = (L: Look, dim: string, bold: string): Run[] => [
  run(dim, L.dim),
  run(bold, L.fg, undefined, true),
]

/** The filled three-row field Target size draws, units at the right. */
function field(
  L: Look,
  value: string,
  opts: { placeholder?: string; units?: string[]; unit?: number; suffix?: string; w?: number } = {},
): Row[] {
  const w = opts.w ?? 76
  const fill = [run(' '.repeat(w), undefined, L.field)]
  const left: Row = [run(' ', undefined, L.field), run('›', L.mode, L.field), run(' ', undefined, L.field)]
  if (value) left.push(run(value, L.fg, L.field), run(' ', L.fg, L.fg))
  else left.push(run(' ', L.fg, L.fg), run(opts.placeholder ?? '', L.quiet, L.field))
  if (opts.suffix) left.push(run(` ${opts.suffix}`, L.dim, L.field))
  const right: Row = []
  ;(opts.units ?? []).forEach((u, i) => {
    if (i === opts.unit) right.push(run(`  ${u}  `, L.fg, L.pill, true))
    else right.push(run(`  ${u}  `, L.dim, L.field))
  })
  right.push(run('  ', undefined, L.field))
  const mid = [...pad(left, w - width(right), L.field), ...right]
  return [fill, mid, fill]
}

/** "  becomes 2016 × 1512" under a field, or a refusal in the warning colour. */
const result = (L: Look, dims?: string, refusal?: string): Row =>
  refusal
    ? [blank(1), run(refusal, L.warn)]
    : dims
      ? [blank(1), run('becomes ', L.dim), run(dims, L.fg, undefined, true)]
      : []

/* -------------------------------------------------------- the list */

const SIX = (L: Look, order: string[]): Item[] =>
  order.map((id) => {
    switch (id) {
      case 'sharpen':
        return { label: 'Sharpen', detail: dimB(L, 'same size · ', '4032 × 3024') }
      case 'boost2':
        return { label: 'Boost resolution 2×', detail: dimB(L, '', '8064 × 6048') }
      case 'boost4':
        return { label: 'Boost resolution 4×', off: '195 MP, over 100 MP' }
      case 'cutout':
        return { label: 'Remove background', detail: dimB(L, '', 'transparent PNG') }
      case 'trim':
        return { label: 'Trim edges', detail: dimB(L, 'empty edges off · ', '3610 × 2804') }
      default:
        return { label: 'Resize', detail: dimB(L, 'smaller, to a size you choose', '') }
    }
  })

const AI_FIRST = ['sharpen', 'boost2', 'boost4', 'cutout', 'trim', 'resize']
const PLAIN_FIRST = ['resize', 'trim', 'sharpen', 'boost2', 'boost4', 'cutout']

const enhanceList = (L: Look, order: string[], chosen: number, gap?: number) =>
  screen(
    L,
    { answers: [], current: 'Enhance' },
    'Enhance JPEG',
    undefined,
    picker(L, SIX(L, order), chosen, gap),
    PICK_KEYS(L),
  )

/* --------------------------------------------------- size: six ways */

const SIZE_TRAIL = { answers: ['Resize'], current: 'Size' }
const UNITS = ['%', 'width', 'height']

// R1 — Target size's own field: a number, its unit on the right, tab switches.
const r1 = (L: Look): Row[][] => [
  screen(L, SIZE_TRAIL, 'Resize to', ASIDE, [
    ...field(L, '', { placeholder: 'type a number', units: UNITS, unit: 0 }),
  ], FIELD_KEYS(L, [['tab', 'unit']])),
  screen(L, SIZE_TRAIL, 'Resize to', ASIDE, [
    ...field(L, '50', { units: UNITS, unit: 0 }),
    [],
    result(L, '2016 × 1512'),
  ], FIELD_KEYS(L, [['tab', 'unit']])),
  screen(L, SIZE_TRAIL, 'Resize to', ASIDE, [
    ...field(L, '1200', { units: UNITS, unit: 1 }),
    [],
    result(L, '1200 × 900'),
  ], FIELD_KEYS(L, [['tab', 'unit']])),
  screen(L, SIZE_TRAIL, 'Resize to', ASIDE, [
    ...field(L, '5000', { units: UNITS, unit: 1 }),
    [],
    result(L, undefined, 'wider than the photo · Boost resolution makes it bigger'),
  ], FIELD_KEYS(L, [['tab', 'unit']])),
]

// R2 — presets, with "Custom size" opening R1's field.
const PRESETS = (L: Look): Item[] => [
  { label: 'Half size', detail: dimB(L, '', '2016 × 1512') },
  { label: 'Quarter size', detail: dimB(L, '', '1008 × 756') },
  { label: '1920 wide', detail: dimB(L, '', '1920 × 1440') },
  { label: '1280 wide', detail: dimB(L, '', '1280 × 960') },
  { label: '640 wide', detail: dimB(L, '', '640 × 480') },
  { label: 'Custom size', detail: dimB(L, 'type a width, height or %', '') },
]
const r2 = (L: Look): Row[][] => [
  screen(L, SIZE_TRAIL, 'Resize to', ASIDE, picker(L, PRESETS(L), 0), PICK_KEYS(L)),
  screen(L, SIZE_TRAIL, 'Resize to', ASIDE, picker(L, PRESETS(L), 2), PICK_KEYS(L)),
  screen(
    L,
    { answers: ['Resize', 'Custom size'], current: 'Size' },
    'Custom size',
    ASIDE,
    [...field(L, '1500', { units: UNITS, unit: 1 }), [], result(L, '1500 × 1125')],
    FIELD_KEYS(L, [['tab', 'unit']]),
  ),
]

// R3 — Quality's slider, in percent; # opens a field for an exact width.
function percentSlider(L: Look, v: number): Row[] {
  const w = 48
  const label = ` ${v}% `
  const room = w - stringWidth(label)
  const k = Math.round(((v - 1) / 99) * room)
  return [
    [
      blank(1),
      run(' '.repeat(k), undefined, L.p.trackFill),
      run(label, L.p.ink, L.p.thumb, true),
      run(' '.repeat(room - k), undefined, L.p.track),
    ],
    [blank(1), run('smaller', L.quiet), blank(w - 16), run('same size', L.quiet)],
  ]
}
const r3 = (L: Look): Row[][] => [
  screen(L, SIZE_TRAIL, 'Resize to', ASIDE, [
    ...percentSlider(L, 50),
    [],
    result(L, '2016 × 1512'),
  ], keys(L, [['←→', 'adjust'], ['↵', 'confirm'], ['#', 'exact size']], 'esc back · ctrl-c quit')),
  screen(L, SIZE_TRAIL, 'Resize to', ASIDE, [
    ...percentSlider(L, 25),
    [],
    result(L, '1008 × 756'),
  ], keys(L, [['←→', 'adjust'], ['↵', 'confirm'], ['#', 'exact size']], 'esc back · ctrl-c quit')),
  screen(
    L,
    { answers: ['Resize', 'Exact size'], current: 'Size' },
    'Exact size',
    ASIDE,
    [...field(L, '1200', { units: ['width', 'height'], unit: 0 }), [], result(L, '1200 × 900')],
    FIELD_KEYS(L, [['tab', 'unit']]),
  ),
]

// R4 — Figma's W and H: both numbers shown, change one and the other follows.
function pair(L: Look, w: string, h: string, focus: 0 | 1, typed: boolean): Row[] {
  const box = (tag: string, v: string, on: boolean, follows: boolean): [Row, Row] => {
    const inner: Row = [
      run(' ', undefined, L.field),
      run(tag, on ? L.mode : L.quiet, L.field, on),
      run('  ', undefined, L.field),
      run(v, follows ? L.dim : L.fg, L.field, on),
    ]
    if (on) inner.push(run(' ', L.fg, L.fg))
    return [pad(inner, 18, L.field), [run(' '.repeat(18), undefined, L.field)]]
  }
  const [a, af] = box('W', w, focus === 0, typed && focus === 1)
  const [b, bf] = box('H', h, focus === 1, typed && focus === 0)
  return [
    [blank(1), ...af, blank(3), ...bf],
    [blank(1), ...a, run(' × ', L.quiet), ...b, blank(3), run('keeps its shape', L.quiet)],
    [blank(1), ...af, blank(3), ...bf],
  ]
}
const r4 = (L: Look): Row[][] => [
  screen(L, SIZE_TRAIL, 'Resize to', 'IMG_2041.jpg', pair(L, '4032', '3024', 0, false),
    FIELD_KEYS(L, [['tab', 'width / height']])),
  screen(L, SIZE_TRAIL, 'Resize to', 'IMG_2041.jpg', [
    ...pair(L, '1200', '900', 0, true),
    [],
    [blank(1), run('was 4032 × 3024', L.dim)],
  ], FIELD_KEYS(L, [['tab', 'width / height']])),
  screen(L, SIZE_TRAIL, 'Resize to', 'IMG_2041.jpg', [
    ...pair(L, '1440', '1080', 1, true),
    [],
    [blank(1), run('was 4032 × 3024', L.dim)],
  ], FIELD_KEYS(L, [['tab', 'width / height']])),
]

// R5 — choose the kind first, then one number with its unit written in.
const KINDS = (L: Look): Item[] => [
  { label: 'By percentage', detail: dimB(L, 'half, a quarter, any share', '') },
  { label: 'To a width', detail: dimB(L, 'now ', '4032 px wide') },
  { label: 'To a height', detail: dimB(L, 'now ', '3024 px tall') },
  { label: 'Longest side', detail: dimB(L, 'for photos turned either way', '') },
]
const r5 = (L: Look): Row[][] => [
  screen(L, SIZE_TRAIL, 'Resize by', ASIDE, picker(L, KINDS(L), 0), PICK_KEYS(L)),
  screen(L, SIZE_TRAIL, 'Resize by', ASIDE, picker(L, KINDS(L), 1), PICK_KEYS(L)),
  screen(
    L,
    { answers: ['Resize', 'To a width'], current: 'Width' },
    'Width',
    ASIDE,
    [...field(L, '1200', { suffix: 'px' }), [], result(L, '1200 × 900')],
    FIELD_KEYS(L),
  ),
]

// R6 — one free field that teaches itself: examples under it, tab fills one.
function chips(L: Look, on?: number): Row {
  const row: Row = [blank(1), run('try ', L.quiet)]
  ;['50%', '1920 wide', '1080 tall', '1200 × 800 box'].forEach((c, i) => {
    if (i) row.push(blank(2))
    row.push(run(` ${c} `, i === on ? L.fg : L.dim, i === on ? L.pill : L.keycap, i === on))
  })
  return row
}
const r6 = (L: Look): Row[][] => [
  screen(L, SIZE_TRAIL, 'Resize to', ASIDE, [
    ...field(L, '', { placeholder: 'a percentage or a size' }),
    [],
    chips(L),
  ], FIELD_KEYS(L, [['tab', 'fill an example']])),
  screen(L, SIZE_TRAIL, 'Resize to', ASIDE, [
    ...field(L, '1920 wide'),
    [],
    chips(L, 1),
    [],
    result(L, '1920 × 1440'),
  ], FIELD_KEYS(L, [['tab', 'fill an example']])),
  screen(L, SIZE_TRAIL, 'Resize to', ASIDE, [
    ...field(L, '1200x800'),
    [],
    chips(L),
    [],
    result(L, '1067 × 800 · fits inside 1200 × 800'),
  ], FIELD_KEYS(L, [['tab', 'fill an example']])),
]

/* ------------------------------------- round two: R3 revised (picked) */

const SRC = { w: 4032, h: 3024 }
const at = (v: number) => `${Math.round((SRC.w * v) / 100)} × ${Math.round((SRC.h * v) / 100)}`
const SLIDER = 48

/** 0–200 %, so 100 sits in the middle; the thumb never goes below 5. */
function centredSlider(L: Look, v: number, after: Row = []): Row[] {
  const label = ` ${v}% `
  const room = SLIDER - stringWidth(label)
  const k = Math.round((v / 200) * room)
  const mid = 1 + Math.round(SLIDER / 2)
  const same = 'same size'
  return [
    [
      blank(1),
      run(' '.repeat(k), undefined, L.p.trackFill),
      run(label, L.p.ink, L.p.thumb, true),
      run(' '.repeat(room - k), undefined, L.p.track),
      ...after,
    ],
    [
      blank(1),
      run('smaller', L.quiet),
      blank(mid - 1 - 7 - Math.floor(same.length / 2)),
      run(same, L.quiet),
      blank(1 + SLIDER - mid - Math.ceil(same.length / 2) - 6),
      run('larger', L.quiet),
    ],
  ]
}

const keycap = (L: Look, k: string): Run => run(` ${k} `, L.fg, L.keycap, true)

/** What the slider gives, and — past 100 % — that Boost does bigger better. */
function sliderResult(L: Look, v: number, right: Row = []): Row[] {
  const dims = v === 100 ? [run('same size · ', L.dim), run(at(v), L.fg, undefined, true)] : [run('becomes ', L.dim), run(at(v), L.fg, undefined, true)]
  const row: Row = [blank(1), ...dims]
  const rows: Row[] = [right.length ? [...pad(row, 1 + SLIDER - width(right)), ...right] : row]
  if (v > 100) rows.push([blank(1), run('stretched, so softer · Boost resolution adds detail', L.quiet)])
  return rows
}

type HintAt = 'below' | 'result' | 'slider'
const HINT_TEXT = 'type an exact size'
function sliderScreen(L: Look, v: number, hint: HintAt): Row[] {
  const tip: Row = [keycap(L, '#'), run(` ${HINT_TEXT}`, L.dim)]
  const body =
    hint === 'slider'
      ? [...centredSlider(L, v, [blank(3), ...tip]), [], ...sliderResult(L, v)]
      : hint === 'result'
        ? [...centredSlider(L, v), [], ...sliderResult(L, v, tip)]
        : [...centredSlider(L, v), [], ...sliderResult(L, v), [], [blank(1), ...tip]]
  return screen(
    L,
    SIZE_TRAIL,
    'Resize to',
    ASIDE,
    body,
    keys(L, [['←→', 'adjust'], ['↵', 'confirm']], 'esc back · ctrl-c quit'),
  )
}
const slidersAt = (hint: HintAt) => (L: Look) => [100, 50, 150].map((v) => sliderScreen(L, v, hint))

/** # from the slider: R4's pair, already holding the slider's size. */
const EXACT_TRAIL = { answers: ['Resize', 'Exact size'], current: 'Size' }
const exactKeys = (L: Look) =>
  keys(L, [['↵', 'confirm'], ['tab', 'width / height']], 'esc slider · ctrl-c quit')
const exact = (L: Look): Row[][] => [
  screen(L, EXACT_TRAIL, 'Exact size', ASIDE, [
    ...pair(L, '2016', '1512', 0, false),
  ], exactKeys(L)),
  screen(L, EXACT_TRAIL, 'Exact size', ASIDE, [
    ...pair(L, '1200', '900', 0, true),
  ], exactKeys(L)),
  screen(L, EXACT_TRAIL, 'Exact size', ASIDE, [
    ...pair(L, '20000', '15000', 0, true),
    [],
    [blank(1), run('over 16,384 px a side', L.warn)],
  ], exactKeys(L)),
]

/* ------------------------------------------------------------- render */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const GLYPH: Record<string, string> = {
  '╱': 'd',
  '▀': 'u',
  '▄': 'l',
  '█': 'f',
  '▌': 'h',
  '': 'si',
  '': 'so',
}

function html(rows: Row[], p: Palette): string {
  rows.forEach((r, i) => {
    if (width(r) > N) console.warn(`row ${i} is ${width(r)} wide:`, r.map((x) => x.text).join(''))
  })
  const body = rows
    .map((r) => {
      let out = ''
      let used = 0
      for (const x of r) {
        const style = [x.fg ? `color:${x.fg}` : '', x.bg ? `background:${x.bg}` : '', x.bold ? 'font-weight:700' : '']
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
  note: string
  pick?: boolean
  draw: (L: Look) => Row[][]
}
function figure(f: Fig): string {
  const themes = [DARK, LIGHT]
    .map((p) => {
      const L = lookOf(p)
      return `<div class="theme ${p.name}">${f.draw(L).map((fr) => html(fr, L.p)).join('')}</div>`
    })
    .join('')
  return `<figure><div class="vt"><span class="id">${f.id}</span><span class="name">${f.name}</span>${f.pick ? '<span class="pick">MY PICK</span>' : ''}</div>${themes}<p class="idea">${f.note}</p></figure>`
}

interface Tab {
  id: string
  title: string
  intro: string
  figs: Fig[]
}

const TABS: Tab[] = [
  {
    id: 'slider',
    title: '★ Resize slider',
    intro:
      'You picked R3, with three changes: <b>100 % sits in the middle</b> — left is smaller, right is larger (0–200 %, steps of 5, never below 5 %); the <b>#</b> key is shown inside the screen, not only in the key row; and <b>#</b> opens R4’s width × height, already holding the slider’s size. Each figure is the slider at 100 %, 50 % and 150 %. Three places for the # hint:',
    figs: [
      {
        id: 'H1',
        name: '# on its own line, under the size',
        pick: true,
        note: 'The hint sits apart, under what you will get. Easy to see, and it does not crowd the slider or the size.',
        draw: slidersAt('below'),
      },
      {
        id: 'H2',
        name: '# at the end of the size line',
        note: 'One row less. The hint shares a row with the size, at the slider’s right edge.',
        draw: slidersAt('result'),
      },
      {
        id: 'H3',
        name: '# beside the slider',
        note: 'Right next to the thing it replaces: “or type it”. The slider row gets busy.',
        draw: slidersAt('slider'),
      },
      {
        id: 'X',
        name: '# → exact size (R4)',
        note: 'The width and height start at what the slider was showing (here 50 %, 2016 × 1512), so # never loses your place. Type over the width and the height follows, grey; tab goes to the height. Too large is refused at the 16,384 px limit Boost uses. esc goes back to the slider.',
        draw: exact,
      },
    ],
  },
  {
    id: 'size',
    title: 'Round one · R1–R6',
    intro:
      'Six different ways to answer “how big?”. Each figure is a few moments of the same screen, left to right. Every one only makes images <b>smaller</b> (bigger is Boost resolution’s job), keeps the shape, and shows the size you will get before you press ↵. The photo is 4032 × 3024.',
    figs: [
      {
        id: 'R1',
        name: 'Number + unit, like Target size',
        pick: true,
        note: 'Compress’s Target size field, which you already use: type a number, the units sit on the right where you can see them, <b>tab</b> moves between <b>% · width · height</b>. You never have to know a syntax — the choices are on screen. The size you will get appears as you type; a number bigger than the photo says so and points to Boost resolution. For several photos of different sizes, % and width both mean the same thing for each.',
        draw: r1,
      },
      {
        id: 'R2',
        name: 'Presets, then Custom',
        note: 'Nothing to type for the common cases: half, quarter, three common widths. Each row shows what it gives only when highlighted, like the Enhance list. “Custom size” opens R1’s field. Two steps for anything off the list, and someone has to choose the presets.',
        draw: r2,
      },
      {
        id: 'R3',
        name: 'Percent slider, # for exact',
        note: 'Quality’s slider (G1), in percent: ←→ in steps of 5, the size you will get under it. Very easy to try. An exact width needs <b>#</b>, which opens a field — a hidden second way in.',
        draw: r3,
      },
      {
        id: 'R4',
        name: 'Width × Height, like Figma',
        note: 'Both numbers are on screen from the start, as in Figma’s W and H. Type over the width and the height follows (grey, because Forge worked it out), or tab to the height. Very familiar to designers; no percentages unless you work them out yourself.',
        draw: r4,
      },
      {
        id: 'R5',
        name: 'Choose the kind, then the number',
        note: 'First a list — By percentage / To a width / To a height / Longest side — then one field with the unit written beside the number (“1200 px”). The most explicit, and “Longest side” handles a mix of portrait and landscape photos. But it is two questions every time.',
        draw: r5,
      },
      {
        id: 'R6',
        name: 'Free field that teaches itself',
        note: 'One field that understands “50%”, “1920 wide”, “1080 tall”, “1200x800”. The examples under it are the help: tab fills one in and you edit it. Fastest for someone who knows it; still the hardest to trust, because the rules are not visible.',
        draw: r6,
      },
    ],
  },
  {
    id: 'list',
    title: '2 · Resize and Trim in Enhance’s list',
    intro:
      'Both are new rows in Enhance’s list. Neither needs an extension, so they are always ready. <b>Trim edges</b> asks nothing: its row shows the size after trimming, or is dimmed with “no empty edges” when there is nothing to cut. <b>Resize</b> goes on to the size question (tab 1). Each figure shows Trim highlighted, then Resize.',
    figs: [
      {
        id: 'E1',
        name: 'Added at the end',
        note: 'The AI tools keep their places; the two plain tools come after. Least change to what exists.',
        draw: (L) => [enhanceList(L, AI_FIRST, 4), enhanceList(L, AI_FIRST, 5)],
      },
      {
        id: 'E2',
        name: 'Everyday tools first',
        note: 'Resize and Trim are what most people want most of the time, and they are instant, so they go first.',
        draw: (L) => [enhanceList(L, PLAIN_FIRST, 1), enhanceList(L, PLAIN_FIRST, 0)],
      },
      {
        id: 'E3',
        name: 'Two groups',
        pick: true,
        note: 'E1’s order, with one empty row between the AI tools and the plain ones. No labels or notes, the gap alone says they are different kinds of tool.',
        draw: (L) => [enhanceList(L, AI_FIRST, 4, 3), enhanceList(L, AI_FIRST, 5, 3)],
      },
    ],
  },
]

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · Resize and Trim</title>
<style>
  :root { --page:#0d0e11; --ink:#e2e4ea; --muted:#8f94a1; --rule:#23252c; --cyan:#55c7d9; --mono:"SF Mono", ui-monospace, Menlo, monospace; --sans:-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--page); color:var(--ink); font:16px/1.6 var(--sans); }
  main { max-width:2300px; margin:0 auto; padding:44px 24px 120px; }
  h1 { font-size:32px; margin:0 0 8px; }
  .lede { color:var(--muted); max-width:900px; margin:0; }
  .tabs { position:sticky; top:0; z-index:5; display:flex; flex-wrap:wrap; gap:6px; margin:22px -24px 0; padding:12px 24px; background:rgba(13,14,17,.94); border-bottom:1px solid var(--rule); align-items:center; }
  .tabs a { font:13px var(--mono); color:var(--muted); text-decoration:none; border:1px solid var(--rule); padding:6px 12px; border-radius:8px; cursor:pointer; }
  .tabs a.on { color:#0c1d22; background:var(--cyan); border-color:var(--cyan); font-weight:700; }
  .tabs .sp { flex:1; }
  .tabs label { font:13px var(--mono); color:var(--muted); display:flex; gap:6px; align-items:center; }
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
  .r i { display:inline-block; width:1ch; height:17px; vertical-align:top; }
  i.d { background:linear-gradient(to top left, transparent calc(50% - .7px), currentColor calc(50% - .7px), currentColor calc(50% + .7px), transparent calc(50% + .7px)); }
  i.u { background:linear-gradient(currentColor 50%, transparent 50%); }
  i.l { background:linear-gradient(transparent 50%, currentColor 50%); }
  i.f { background:currentColor; }
  i.h { background:linear-gradient(to right, currentColor 50%, transparent 50%); }
  i.si { background:linear-gradient(to bottom right, transparent 50%, currentColor 50%); }
  i.so { background:linear-gradient(to bottom right, currentColor 50%, transparent 50%); }
  code { font:.9em var(--mono); background:#1c1e24; padding:1px 5px; border-radius:4px; }
</style></head>
<body class="only-dark"><main>
<h1>Resize and Trim</h1>
<p class="lede">Two new rows for Enhance. Card, field and list are captured from the app as it is today at 80 × 24; switch dark and light at the right of the tab bar.</p>
<div class="tabs">${TABS.map((t, i) => `<a data-t="${t.id}"${i === 0 ? ' class="on"' : ''}>${t.title}</a>`).join('')}<span class="sp"></span>
<label><input type="radio" name="th" value="only-dark" checked> dark</label><label><input type="radio" name="th" value="only-light"> light</label><label><input type="radio" name="th" value="both"> both</label></div>
${TABS.map((t, i) => `<section id="s-${t.id}"${i === 0 ? ' class="on"' : ''}><p class="intro">${t.intro}</p>${t.figs.map(figure).join('')}</section>`).join('\n')}
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

const out = new URL('../mockups/resize-2026-10.html', import.meta.url)
writeFileSync(out, page)
console.log('wrote', decodeURIComponent(out.pathname), page.length)
