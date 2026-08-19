import { describe, expect, it } from 'vitest'
import { fileLink } from '../../src/shell/hyperlink.js'

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)

describe('fileLink', () => {
  it('emits an OSC 8 hyperlink where supported', () => {
    const out = fileLink('Open file', '/Users/me/a.webp', { supported: true })
    expect(out).toBe(`${ESC}]8;;file:///Users/me/a.webp${BEL}Open file${ESC}]8;;${BEL}`)
  })

  it('falls back to the bare url where unsupported, since Terminal.app cmd+clicks those', () => {
    const out = fileLink('Open file', '/Users/me/a.webp', { supported: false })
    expect(out).toBe('file:///Users/me/a.webp')
    expect(out).not.toContain(ESC)
  })

  it('percent-encodes spaces so the url is valid', () => {
    const out = fileLink('Open', '/Users/me/My Photo.webp', { supported: false })
    expect(out).toBe('file:///Users/me/My%20Photo.webp')
  })

  it('links a directory for the reveal case', () => {
    expect(fileLink('Reveal', '/Users/me/pics', { supported: false })).toBe('file:///Users/me/pics')
  })
})
