/**
 * Groups the findings `setup.ts` wrote: one line per colour pair, worst
 * first, with sample text and where it was seen. Then every colour used, with
 * its OKLCH, so saturation outliers stand out.
 *
 *   npx tsx scripts/light-audit/summarise.ts [/tmp/forge-light-audit]
 */
import { readdirSync, readFileSync } from 'node:fs'
import { oklch } from './cells.js'

const dir = process.argv[2] ?? '/tmp/forge-light-audit'
type F = {
  kind: string
  fg: string
  bg: string
  ratio?: number
  glyph: boolean
  bold: boolean
  text: string
  test: string
  count: number
}
const all: F[] = []
const colours = new Map<string, number>()
for (const f of readdirSync(dir)) {
  const body = readFileSync(`${dir}/${f}`, 'utf8')
  if (f.startsWith('findings'))
    for (const l of body.split('\n')) if (l) all.push(JSON.parse(l) as F)
  if (f.startsWith('colours'))
    for (const l of body.split('\n')) {
      const [k, n] = l.split('\t')
      if (k) colours.set(k, (colours.get(k) ?? 0) + Number(n))
    }
}

const groups = new Map<
  string,
  { f: F; texts: Map<string, number>; tests: Set<string>; count: number }
>()
for (const f of all) {
  const k = `${f.kind}|${f.fg}|${f.bg}|${f.glyph ? 'glyph' : 'text'}`
  const g = groups.get(k) ?? { f, texts: new Map(), tests: new Set(), count: 0 }
  g.texts.set(f.text, (g.texts.get(f.text) ?? 0) + f.count)
  g.tests.add(f.test.split(' > ')[0] ?? f.test)
  g.count += f.count
  groups.set(k, g)
}
const sorted = [...groups.values()].sort(
  (a, b) =>
    (a.f.kind === 'default-fg' ? -1 : 0) - (b.f.kind === 'default-fg' ? -1 : 0) ||
    (a.f.ratio ?? 0) - (b.f.ratio ?? 0),
)
for (const g of sorted) {
  const texts = [...g.texts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t]) => JSON.stringify(t))
  console.log(
    `${g.f.kind.padEnd(10)} ${(g.f.ratio?.toFixed(2) ?? '  -  ').padStart(5)}  fg ${g.f.fg.padEnd(10)} bg ${g.f.bg}  ${g.f.glyph ? 'glyph' : 'text '}  ×${g.count}`,
  )
  console.log(`           ${texts.join('  ')}`)
  console.log(
    `           in ${[...g.tests].slice(0, 5).join(', ')}${g.tests.size > 5 ? ` +${g.tests.size - 5}` : ''}`,
  )
}

console.log('\n--- colours by chroma (OKLCH) ---')
const rows = [...colours.entries()]
  .map(([k, n]) => {
    const [role, hex] = k.split(' ') as [string, string]
    if (!hex.startsWith('#')) return undefined
    return { role, hex, n, ...oklch(hex) }
  })
  .filter((r) => r !== undefined)
  .sort((a, b) => b.C - a.C)
for (const r of rows)
  console.log(
    `${r.role} ${r.hex}  L ${r.L.toFixed(2)}  C ${r.C.toFixed(3)}  h ${r.h.toFixed(0).padStart(3)}  ×${r.n}`,
  )
