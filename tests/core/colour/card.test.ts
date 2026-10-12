import { describe, expect, it } from 'vitest'
import { card, scaleCard } from '../../../src/core/colour/card.js'
import { scale } from '../../../src/core/colour/scale.js'

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

  it('is deterministic', () => {
    expect(scaleCard(ref, scale(ref))).toBe(scaleCard(ref, scale(ref)))
  })
})
