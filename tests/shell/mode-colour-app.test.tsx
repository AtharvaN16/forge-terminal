import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { DARK } from '../../src/shell/theme.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

const ENTER = String.fromCharCode(13)
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms))
const rgb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`
}

describe('the screen is drawn in the mode colour', () => {
  it('draws the picker cursor in convert cyan, not the old amber', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'photo.jpg')
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const app = render(<App initialWidth={80} prefs={prefs} />)
    app.stdin.write(jpg)
    await settle(150)
    app.stdin.write(ENTER)
    await settle()
    const frame = app.lastFrame() ?? ''
    expect(frame).toContain('❯')
    expect(frame).toContain(rgb(DARK.modeConvert))
    expect(frame).not.toContain(rgb(DARK.accent))
  })
})
