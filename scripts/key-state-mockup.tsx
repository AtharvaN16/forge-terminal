/**
 * How a key looks while it is pressed, and while it is on (2026-10-20): Tab
 * latches the supported formats open, and nothing on the key row says the key
 * is down. Each concept draws the same eight kinds of key the app uses at
 * rest, pressed (a moment; M6b's inverted cap, carried to every kind) and on
 * (held while what it opened is showing); and the real home with Tab pressed.
 *
 *   FORCE_COLOR=3 FORGE_NO_FIND=1 npx tsx scripts/key-state-mockup.tsx → mockups/key-state-2026-10.html
 */
import { writeFileSync } from 'node:fs'
import { render } from 'ink-testing-library'
import React from 'react'
import { DEFAULT_PREFERENCES } from '../src/config/preferences.js'
import { App } from '../src/shell/App.js'
import { mix, type Row, type Run } from '../src/shell/home-art.js'
import { DARK, modeColours, modePalette } from '../src/shell/theme.js'
import { ansiRow } from '../tests/shell/home-cells.js'
import { feedbackPage } from './feedback-page.js'
import { type Cell, cellsOf, type Grid, run, solid, termHtml, toGrid } from './term-cells.js'

const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms))
const plain = (l: string) => l.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '')

const p = modePalette(DARK, 'convert')
const mc = modeColours(p, 'convert').fg
const tint = mix(mc, p.canvas, 0.72)

/* ------------------------------------------------------------ the keys */

interface Key {
  id: string
  label: string
  k: string
  w: string
  /** How the key rests: a cap, bare text, a mode chip, or a bracket (no colour). */
  form: 'cap' | 'bare' | 'chip' | 'bracket'
}
const KEYS: Key[] = [
  { id: 'cap', label: 'key row cap', k: '↵', w: 'send', form: 'cap' },
  { id: 'foot', label: 'footnote', k: 'tab', w: 'supported formats', form: 'bare' },
  { id: 'foot2', label: 'footnote', k: '1–6 ←→', w: 'mode', form: 'bare' },
  { id: 'menu', label: '/ menu', k: '/', w: 'menu', form: 'cap' },
  { id: 'esc', label: 'esc clear', k: 'esc', w: 'clear', form: 'cap' },
  { id: 'enter', label: 'in the field', k: 'enter', w: '', form: 'cap' },
  { id: 'chip', label: 'field chip', k: '⌘V', w: 'paste', form: 'chip' },
  { id: 'none', label: 'no colour', k: 'tab', w: 'supported formats', form: 'bracket' },
]

const words = (w: string, fg: string, bold = false): Run[] =>
  w ? [run(` ${w}`, fg, undefined, bold)] : []

const rest = (key: Key): Run[] => {
  switch (key.form) {
    case 'cap':
      return [run(` ${key.k} `, p.fg, p.keycapBg, true), ...words(key.w, p.dim)]
    case 'bare':
      return [run(key.k, p.fg), ...words(key.w, p.border)]
    case 'chip':
      return [run(` ${key.k} `, p.ink, mc, true), ...words(key.w, mc)]
    case 'bracket':
      return [run(`[${key.k}]`, p.border), ...words(key.w, p.border)]
  }
}

/** M6b's press: the cap inverted, the words bright — now for every kind. */
const pressed = (key: Key): Run[] => {
  const cap =
    key.form === 'bracket'
      ? run(`[${key.k}]`, p.canvas, p.fg, true)
      : run(` ${key.k} `, key.form === 'chip' ? p.ink : p.canvas, p.fg, true)
  return [cap, ...words(key.w, p.fg)]
}

type Look = 'A' | 'B' | 'C' | 'D'
/** On: held while what the key opened is showing. */
const on = (key: Key, look: Look): Run[] => {
  // "/ menu" already has one: the menu's gold while it is open.
  if (key.id === 'menu') return [run(' / ', p.ink, p.brand, true), ...words(key.w, p.brand, true)]
  if (look === 'C') return pressed(key)
  // A chip is already a lit key; it stays as it is.
  if (key.form === 'chip') return rest(key)
  const cap = (fg: string, bg: string): Run =>
    key.form === 'bracket'
      ? run(`[${key.k}]`, fg, bg === '' ? undefined : bg, true)
      : run(` ${key.k} `, fg, bg, true)
  const keyBg = key.form === 'cap' ? p.keycapBg : undefined
  if (look === 'A') return [cap(p.ink, mc), ...words(key.w, mc)]
  if (look === 'D') return [cap(mc, tint), ...words(key.w, mc)]
  // B: no fill; the key in the mode's colour, its words bright.
  return key.form === 'bare'
    ? [run(key.k, mc, undefined, true), ...words(key.w, p.fg)]
    : [
        key.form === 'bracket' ? cap(mc, '') : run(` ${key.k} `, mc, keyBg, true),
        ...words(key.w, p.fg),
      ]
}

/* ------------------------------------------------------------ the pictures */

const INV = 96
const COLS = [18, 44, 70]
const width = (r: Run[]) => r.reduce((n, x) => n + [...x.text].length, 0)
function inventory(look: Look): Grid {
  const head: Row = [
    solid(COLS[0] ?? 0),
    run('at rest'.padEnd(26), p.dim),
    run('pressed'.padEnd(26), p.dim),
    run('on', p.dim),
  ]
  const lines: Row[] = KEYS.map((key) => {
    const cells = [rest(key), pressed(key), on(key, look)]
    const out: Row = [solid(2), run(key.label.padEnd(14), p.dim)]
    cells.forEach((c, i) => {
      out.push(...c, solid((COLS[i + 1] ?? INV) - (COLS[i] ?? 0) - width(c)))
    })
    return out
  })
  return toGrid([[], head, [], ...lines, []], INV)
}

async function homeFrame(): Promise<Grid> {
  const app = render(
    <App initialWidth={80} initialHeight={24} prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark' }} />,
  )
  await settle()
  app.stdin.write('\t')
  await settle()
  const lines = (app.lastFrame() ?? '').split('\n')
  app.unmount()
  const w = Math.max(...lines.map((l) => [...plain(l)].length))
  return lines.map((l) =>
    ansiRow(l, w).map(
      (c): Cell => ({ ch: c.ch, fg: c.fg ?? undefined, bg: c.bg ?? undefined, b: c.b }),
    ),
  )
}

/** The key row's footnote, Tab drawn as `tab`; the rest as the app draws it. */
function withFootnote(g: Grid, tab: Run[]): Grid {
  const out = g.map((r) => r.map((c) => ({ ...c })))
  const at = out.findLastIndex((r) =>
    r
      .map((c) => c.ch)
      .join('')
      .includes('ctrl-c quit'),
  )
  const row = out[at] as Cell[]
  const text = row.map((c) => c.ch).join('')
  const from = text.indexOf('tab supported')
  const to = text.trimEnd().length
  const sep = run(' · ', p.border)
  const items: Run[][] = [
    tab,
    [run('1–6 ←→', p.fg), run(' mode', p.border)],
    [run('ctrl-c', p.fg), run(' quit', p.border)],
  ]
  const draw: Run[] = items.flatMap((it, i) => (i ? [sep, ...it] : it))
  const n = width(draw)
  const blank = row[Math.max(0, from - 1)] as Cell
  for (let i = from; i < to; i++) row[i] = { ...blank, ch: ' ' }
  cellsOf(draw).forEach((c, i) => {
    row[to - n + i] = c
  })
  return out
}

/* ------------------------------------------------------------------- page */

const CONCEPTS: { id: Look; name: string; idea: string }[] = [
  {
    id: 'A',
    name: 'The key fills with the mode’s colour',
    idea: 'On, the key is a chip in the mode’s colour with the words in it, like a hint in the field and like “/ menu” when the menu is open. The loudest, and it reads from across the room.',
  },
  {
    id: 'B',
    name: 'The key lights, no fill',
    idea: 'On, the key turns the mode’s colour and the words go from faded to bright; no cap appears, so nothing shifts or grows. The quietest, and it stays a line of text.',
  },
  {
    id: 'C',
    name: 'The press, held',
    idea: 'On is the pressed look kept: the cap inverted, white, until the panel goes. One look for both states, so nothing new to learn; it is the brightest thing on the row.',
  },
  {
    id: 'D',
    name: 'A tinted cap',
    idea: 'On, the key gets a cap tinted with the mode’s colour, the key and words in that colour. A step between A and B: clearly a cap, not shouting.',
  },
]

const home = await homeFrame()
const screen = (tab: Run[]) => termHtml(DARK, withFootnote(home, tab))
const block = (look: Look) =>
  `<div class="stack">${screen(on(KEYS[1] as Key, look))}<div style="height:14px"></div>${termHtml(DARK, inventory(look))}</div>`

const before = `<h2>Where it stands</h2>
<p class="lede">Tab is down and the formats are showing, and the key row looks as it did before.</p>
<div style="margin-top:18px">${screen(rest(KEYS[1] as Key))}</div>`

writeFileSync(
  'mockups/key-state-2026-10.html',
  feedbackPage({
    page: 'key-state',
    title: 'Forge · A key that is down',
    heading: 'A key that is pressed, and a key that is on',
    lede: 'Two questions. First, which look says a key is on, while what it opened is showing: A to D below, on the real home with Tab pressed. Second, whether the middle column, the pressed look, which the key row’s caps have today, should reach every kind of key: the footnote, the hints, the field. Each concept draws all eight kinds of key at rest, pressed and on. Dark, 80 × 24; the table is wider.',
    before,
    concepts: CONCEPTS.map((c) => ({ id: c.id, name: c.name, idea: c.idea, html: block(c.id) })),
  }),
)
console.log('wrote mockups/key-state-2026-10.html')
process.exit(0)
