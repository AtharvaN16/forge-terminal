/**
 * A key that is down, round two (2026-10-20). Decided from round one: pressed
 * and on are one look, and only the key changes — the words beside it stay as
 * they are at rest. This round varies the key's look alone, on the eight kinds
 * of key the app draws, and on the real home with Tab pressed.
 *
 *   FORCE_COLOR=3 FORGE_NO_FIND=1 npx tsx scripts/key-state-mockup-r2.tsx → mockups/key-state-2026-10-round2.html
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
const lifted = mix(p.keycapBg, p.fg, 0.3)

/* ------------------------------------------------------------ the keys */

interface Key {
  label: string
  k: string
  w: string
  /** How the key rests: a cap, bare text, a mode chip, or a bracket (no colour). */
  form: 'cap' | 'bare' | 'chip' | 'bracket'
  /** Drawn the same in every concept: the menu's gold, the no-colour form. */
  fixed?: boolean
}
const KEYS: Key[] = [
  { label: 'key row cap', k: '↵', w: 'send', form: 'cap' },
  { label: 'footnote', k: 'tab', w: 'supported formats', form: 'bare' },
  { label: 'footnote', k: '1–6 ←→', w: 'mode', form: 'bare' },
  { label: '/ menu', k: '/', w: 'menu', form: 'cap', fixed: true },
  { label: 'esc clear', k: 'esc', w: 'clear', form: 'cap' },
  { label: 'in the field', k: 'enter', w: '', form: 'cap' },
  { label: 'field chip', k: '⌘V', w: 'paste', form: 'chip' },
  { label: 'no colour', k: 'tab', w: 'supported formats', form: 'bracket', fixed: true },
]

const words = (w: string, fg: string): Run[] => (w ? [run(` ${w}`, fg)] : [])
const wordsAt = (key: Key): Run[] =>
  words(
    key.w,
    key.form === 'bare' || key.form === 'bracket' ? p.border : key.form === 'chip' ? mc : p.dim,
  )

const rest = (key: Key): Run[] => {
  switch (key.form) {
    case 'cap':
      return [run(` ${key.k} `, p.fg, p.keycapBg, true), ...wordsAt(key)]
    case 'bare':
      return [run(key.k, p.fg), ...wordsAt(key)]
    case 'chip':
      return [run(` ${key.k} `, p.ink, mc, true), ...wordsAt(key)]
    case 'bracket':
      return [run(`[${key.k}]`, p.border), ...wordsAt(key)]
  }
}

type Look = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

/** The key while it is down — pressed or on, one look. The words stay as at rest. */
const down = (key: Key, look: Look): Run[] => {
  // "/ menu": the menu's own gold while it is open, in every concept.
  if (key.label === '/ menu') return [run(' / ', p.ink, p.brand, true), ...wordsAt(key)]
  // No colour has no fills to use: reverse video, or the dot where the concept is the dot.
  if (key.form === 'bracket')
    return look === 'F'
      ? [run('● ', p.fg, undefined, true), run(`[${key.k}]`, p.border), ...wordsAt(key)]
      : [run(`[${key.k}]`, p.canvas, p.fg, true), ...wordsAt(key)]
  if (look === 'F') return [run('● ', mc, undefined, true), ...rest(key)]
  // A chip is already filled: it goes white, in every concept but F.
  if (key.form === 'chip') return [run(` ${key.k} `, p.ink, p.fg, true), ...wordsAt(key)]
  const cap = (fg: string, bg: string): Run => run(` ${key.k} `, fg, bg, true)
  const tail = wordsAt(key)
  switch (look) {
    case 'A':
      return [cap(p.ink, mc), ...tail]
    case 'B':
      return key.form === 'bare'
        ? [run(key.k, mc, undefined, true), ...tail]
        : [cap(mc, p.keycapBg), ...tail]
    case 'C':
      return [cap(p.canvas, p.fg), ...tail]
    case 'D':
      return [cap(mc, tint), ...tail]
    case 'E':
      return [cap(p.fg, lifted), ...tail]
  }
  return rest(key)
}

/* ------------------------------------------------------------ the pictures */

const INV = 76
const COLS = [18, 48]
const width = (r: Run[]) => r.reduce((n, x) => n + [...x.text].length, 0)
function inventory(look: Look): Grid {
  const head: Row = [
    solid(COLS[0] ?? 0),
    run('at rest'.padEnd(30), p.dim),
    run('pressed, and on', p.dim),
  ]
  const lines: Row[] = KEYS.map((key) => {
    const out: Row = [solid(2), run(key.label.padEnd(14), p.dim)]
    for (const [i, c] of [rest(key), down(key, look)].entries())
      out.push(...c, solid((COLS[i + 1] ?? INV) - (COLS[i] ?? 0) - width(c)))
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

/** The key row's footnote with Tab drawn as `tab`; the rest as the app draws it. */
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
    name: 'The key on a chip in the mode’s colour',
    idea: 'Down, the key is filled with the mode’s colour, as a hint in the field is and as “/ menu” is when open. The loudest.',
  },
  {
    id: 'B',
    name: 'The key in the mode’s colour, no fill',
    idea: 'Down, only the key’s own letters change colour. A cap keeps its grey, a footnote key stays bare, so nothing shifts or grows. The quietest.',
  },
  {
    id: 'C',
    name: 'The key inverted, white',
    idea: 'Down, the cap is white with a dark key: the pressed look the key row has today, kept for as long as the key is on. The brightest, and in no colour at all.',
  },
  {
    id: 'D',
    name: 'The key on a tinted cap',
    idea: 'Down, the cap is tinted with the mode’s colour and the key is in that colour. Between A and B.',
  },
  {
    id: 'E',
    name: 'A lifted grey cap',
    idea: 'Down, the cap steps up a few shades of grey and the key is white. No colour, no white block: it only looks nearer. The most neutral.',
  },
  {
    id: 'F',
    name: 'A dot in front of the key',
    idea: 'Down, a dot in the mode’s colour comes before the key, which is otherwise as at rest. The one that still says “on” with no colour at all.',
  },
]

const home = await homeFrame()
const block = (look: Look) =>
  `<div class="stack">${termHtml(DARK, withFootnote(home, down(KEYS[1] as Key, look)))}<div style="height:14px"></div>${termHtml(DARK, inventory(look))}</div>`

writeFileSync(
  'mockups/key-state-2026-10-round2.html',
  feedbackPage({
    page: 'key-state-round2',
    title: 'Forge · A key that is down, round two',
    heading: 'A key that is down',
    lede: 'Held fixed from round one: pressed and on look the same, and only the key changes — the words beside it stay as they are at rest. Which look for the key? Each concept shows the real home with Tab pressed, and the eight kinds of key at rest and down. “/ menu” keeps its gold in all of them; the field chip goes white; the no-colour key is reversed, except in F. Dark, 80 × 24. Round one’s page is unchanged.',
    compact: true,
    concepts: CONCEPTS.map((c) => ({ id: c.id, name: c.name, idea: c.idea, html: block(c.id) })),
  }),
)
console.log('wrote mockups/key-state-2026-10-round2.html')
process.exit(0)
