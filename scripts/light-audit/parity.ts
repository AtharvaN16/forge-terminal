/**
 * The findings as palette tokens: each light (text, surface) pair named by
 * the LIGHT tokens that hold those colours, with the same pair's contrast in
 * DARK beside it. Light weaker than dark for the same roles is a regression
 * of light's, not a deliberate quiet level.
 *
 *   npx tsx scripts/light-audit/parity.ts [/tmp/forge-light-audit]
 */
import { readdirSync, readFileSync } from 'node:fs'
import { DARK, LIGHT, type Palette } from '../../src/shell/theme.js'
import { contrast } from './cells.js'

const dir = process.argv[2] ?? '/tmp/forge-light-audit'
const names = (p: Palette, hex: string) =>
  Object.entries(p)
    .filter(([, v]) => typeof v === 'string' && v.toLowerCase() === hex.toLowerCase())
    .map(([k]) => k)
type F = {
  kind: string
  fg: string
  bg: string
  ratio?: number
  glyph: boolean
  text: string
  count: number
}
const pairs = new Map<
  string,
  { fg: string; bg: string; ratio: number; glyph: boolean; count: number; texts: Set<string> }
>()
for (const f of readdirSync(dir).filter((f) => f.startsWith('findings')))
  for (const l of readFileSync(`${dir}/${f}`, 'utf8').split('\n')) {
    if (!l) continue
    const x = JSON.parse(l) as F
    if (x.kind !== 'contrast' || x.ratio === undefined) continue
    const k = `${x.fg}|${x.bg}|${x.glyph}`
    const p = pairs.get(k) ?? {
      fg: x.fg,
      bg: x.bg,
      ratio: x.ratio,
      glyph: x.glyph,
      count: 0,
      texts: new Set(),
    }
    p.count += x.count
    if (p.texts.size < 4) p.texts.add(x.text)
    pairs.set(k, p)
  }
const rows = [...pairs.values()]
  .map((p) => {
    const fgT = names(LIGHT, p.fg)
    const bgT = p.bg === '#ffffff' ? ['canvas'] : names(LIGHT, p.bg)
    let dark: number | undefined
    for (const a of fgT)
      for (const b of bgT) {
        const df = DARK[a as keyof Palette]
        const db = DARK[b as keyof Palette]
        if (
          typeof df === 'string' &&
          typeof db === 'string' &&
          df.startsWith('#') &&
          db.startsWith('#')
        )
          dark = Math.max(dark ?? 0, contrast(df, db))
      }
    return { ...p, fgT, bgT, dark }
  })
  .filter((r) => r.fgT.length > 0 && r.bgT.length > 0)
  .sort((a, b) => b.count - a.count)
for (const r of rows)
  console.log(
    `${r.glyph ? 'glyph' : 'text '} light ${r.ratio.toFixed(2)}  dark ${r.dark?.toFixed(2) ?? '  ? '}  ${r.fgT.join('/')} on ${r.bgT.join('/')}  ×${r.count}  ${[...r.texts].map((t) => JSON.stringify(t)).join(' ')}`,
  )
