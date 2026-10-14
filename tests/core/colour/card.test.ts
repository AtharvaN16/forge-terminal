import { describe, expect, it } from 'vitest'
import {
  alphaCard,
  card,
  neutralCard,
  paletteCard,
  scaleCard,
  systemCard,
} from '../../../src/core/colour/card.js'
import { DEFAULT_STEPS, type StepSpec, scale } from '../../../src/core/colour/scale.js'
import { system } from '../../../src/core/colour/system.js'

const ref = { r: 101, g: 121, b: 253 }

describe('card', () => {
  it('a square outer card, rounded swatches, one layer per item', () => {
    const svg = scaleCard(ref, scale(ref))
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toMatch(/<rect id="card" width="\d+" height="\d+" rx="0" fill="#FFFFFF"\/>/)
    expect(svg.match(/<g id="blue-\d+"/g)).toHaveLength(11)
    expect(svg).toContain('<g id="blue-500"')
    expect(svg).toMatch(/<rect id="swatch" width="64" height="64" rx="10" fill="#6579FD"/)
    expect(svg).toContain('>Blue</text>')
    expect(svg).toContain('from #6579FD · 50–950 in OKLCH')
  })

  it('dark theme gives the dark card', () => {
    expect(scaleCard(ref, scale(ref), 'dark')).toContain('fill="#18181B"')
  })

  it('escapes text and keeps ids to [a-z0-9-]', () => {
    const svg = card('a <b> & "c"', 'x', [
      { id: 'My File!.jpg-1', name: '<n>', value: 'v', hex: '#000000' },
    ])
    expect(svg).toContain('a &lt;b&gt; &amp; &quot;c&quot;')
    expect(svg).toContain('<g id="my-file-jpg-1"')
    expect(svg).not.toContain('<n>')
  })

  it("says colour or colours, and shades of a colour when it is one colour's shades", () => {
    const one = [
      {
        hex: '#336699',
        rgb: { r: 51, g: 102, b: 153 },
        share: 1,
        centre: { L: 0, a: 0, b: 0 },
        members: new Uint32Array(),
      },
    ]
    expect(paletteCard('a.jpg', one)).toContain('1 colour, most of the image first')
    expect(paletteCard('a.jpg', [...one, ...one])).toContain('2 colours, most of the image first')
    expect(paletteCard('a.jpg', [...one, ...one], 'light', '#F26E69')).toContain(
      '2 shades of #F26E69',
    )
  })

  it('is deterministic', () => {
    expect(scaleCard(ref, scale(ref))).toBe(scaleCard(ref, scale(ref)))
  })
})

describe('scaleCard with chosen steps', () => {
  it('names its steps when they are not the default', () => {
    const ref = { r: 101, g: 121, b: 253 }
    const spec = { set: 'even', start: 100, end: 900, count: 17 } as const
    const svg = scaleCard(ref, scale(ref, spec), 'light', spec)
    expect(svg).toContain('from #6579FD · 100–900, 17 even steps in OKLCH')
    expect(svg.match(/id="[a-z]+-\d+"/g)).toHaveLength(17)
    const radix = { set: 'radix', start: 50, end: 950, count: 11 } as const
    expect(scaleCard(ref, scale(ref, radix), 'light', radix)).toContain('Radix 1–12 in OKLCH')
    const tw = { set: 'tailwind', start: 100, end: 900, count: 11 } as const
    expect(scaleCard(ref, scale(ref, tw), 'light', tw)).toContain('Tailwind 100–900 in OKLCH')
    expect(scaleCard(ref, scale(ref))).toContain('from #6579FD · 50–950 in OKLCH')
  })
})

const cherry = { r: 210, g: 4, b: 45 }
const radix: StepSpec = { set: 'radix', start: 50, end: 950, count: 11 }

describe('systemCard', () => {
  const sys = system(cherry, 'full')
  const svg = systemCard(cherry, sys, 'full', DEFAULT_STEPS)

  it('a square card titled by the family, saying where it came from', () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toMatch(/<rect id="card" width="\d+" height="\d+" rx="0" fill="#FFFFFF"\/>/)
    expect(svg).toContain('>Red palette</text>')
    expect(svg).toContain('from #D2042D · Full set · 50–950 in OKLCH')
    expect(svg).toContain('font-family="Inter"')
  })

  it('step numbers across the top, a named row per family, the neutral last', () => {
    for (const n of [50, 500, 950]) expect(svg).toContain(`>${n}</text>`)
    const names = [...svg.matchAll(/<text id="name"[^>]*>([^<]+)<\/text>/g)].map((m) => m[1])
    expect(names).toEqual([...sys.rows.map((r) => r.name), 'neutral'])
  })

  it('a layer per swatch, each a rounded rect of its colour', () => {
    expect(svg.match(/<g id="[a-z-]+-\d+"/g)).toHaveLength(9 * 11)
    expect(svg).toMatch(/<g id="red-500"[^>]*><rect id="swatch"[^>]* rx="8" fill="#D2042D"/)
    expect(svg).toContain('<g id="neutral-950"')
    expect(svg).toContain(`fill="${sys.rows[5]?.steps[5]?.hex}"`)
  })

  it('names the mode and the steps', () => {
    const mono = system(cherry, 'mono', undefined, radix)
    const m = systemCard(cherry, mono, 'mono', radix)
    expect(m).toContain('from #D2042D · Monochromatic · Radix 1–12 in OKLCH')
    expect(m.match(/<g id="[a-z-]+-\d+"/g)).toHaveLength(4 * 12)
    expect(m).toContain('<g id="red-soft-12"')
  })

  it('dark theme, and deterministic', () => {
    expect(systemCard(cherry, sys, 'full', DEFAULT_STEPS, 'dark')).toContain('fill="#18181B"')
    expect(systemCard(cherry, sys, 'full', DEFAULT_STEPS)).toBe(svg)
  })
})

describe('neutralCard', () => {
  const steps = system(cherry, 'full').neutral
  const svg = neutralCard(cherry, steps, 'soft')

  it('the F1 card of the neutral, saying its tint', () => {
    expect(svg).toMatch(/<rect id="card" width="\d+" height="\d+" rx="0" fill="#FFFFFF"\/>/)
    expect(svg).toContain('>Red neutral</text>')
    expect(svg).toContain('from #D2042D · soft tint · 50–950 in OKLCH')
    expect(svg.match(/<g id="neutral-\d+"/g)).toHaveLength(11)
    expect(svg).toContain(`fill="${steps[5]?.hex}"`)
    expect(svg).toContain(`>${steps[0]?.hex}</text>`)
  })

  it('dark theme, chosen steps, and deterministic', () => {
    expect(neutralCard(cherry, steps, 'soft', 'dark')).toContain('fill="#18181B"')
    const r = system(cherry, 'full', undefined, radix).neutral
    expect(neutralCard(cherry, r, 'soft', 'light', radix)).toContain('Radix 1–12 in OKLCH')
    expect(neutralCard(cherry, steps, 'soft')).toBe(svg)
  })
})

describe('alphaCard', () => {
  const alphas = [
    { step: 100, rgb: { r: 210, g: 4, b: 45 }, a: 0.1, hex8: '#D2042D1A' },
    { step: 500, rgb: { r: 210, g: 4, b: 45 }, a: 1, hex8: '#D2042DFF' },
    { step: 900, rgb: { r: 120, g: 0, b: 20 }, a: 0.8766, hex8: '#780014E0' },
  ]
  const svg = alphaCard(cherry, alphas, 'white')

  it('the F1 card over a checkerboard, each swatch see-through by its alpha', () => {
    expect(svg).toMatch(/<rect id="card" width="\d+" height="\d+" rx="0" fill="#FFFFFF"\/>/)
    expect(svg).toContain('<pattern id="checker"')
    expect(svg).toContain('fill="#E5E5E5"')
    expect(svg).toContain('width="8" height="8"')
    expect(svg.match(/fill="url\(#checker\)"/g)).toHaveLength(3)
    expect(svg).toMatch(/<rect id="swatch"[^>]*fill="#D2042D" fill-opacity="0.100"/)
    expect(svg).toMatch(/<rect id="swatch"[^>]*fill="#780014" fill-opacity="0.877"/)
  })

  it('a layer per step, the hex8 under each, and where it came from', () => {
    expect(svg.match(/<g id="red-alpha-\d+"/g)).toHaveLength(3)
    for (const a of alphas) expect(svg).toContain(`>${a.hex8}</text>`)
    expect(svg).toContain('>Red alpha</text>')
    expect(svg).toContain('from #D2042D · over white · 50–950')
    expect(alphaCard(cherry, alphas, 'black', 'light', radix)).toContain(
      'from #D2042D · over black · Radix 1–12',
    )
  })

  it('dark theme, and deterministic', () => {
    expect(alphaCard(cherry, alphas, 'white', 'dark')).toContain('fill="#18181B"')
    expect(alphaCard(cherry, alphas, 'white')).toBe(svg)
  })

  it('leaves the plain card without a pattern', () => {
    expect(scaleCard(ref, scale(ref))).not.toContain('pattern')
  })
})
