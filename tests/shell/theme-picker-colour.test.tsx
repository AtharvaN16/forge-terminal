import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { ThemePicker } from '../../src/shell/components/ThemePicker.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, LIGHT, modePalette } from '../../src/shell/theme.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

const fgOf = (hex: string) =>
  `\u001b[38;2;${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(';')}m`

describe('the theme picker is a setting: the commands’ gold', () => {
  it.each([
    ['dark', DARK],
    ['light', LIGHT],
  ] as const)('marks the highlighted row in the brand gold, not the mode’s colour (%s)', (_, p) => {
    const { lastFrame } = render(
      <ThemeProvider palette={modePalette(p, 'convert')}>
        <ThemePicker width={60} onChoose={() => {}} />
      </ThemeProvider>,
    )
    const row = (lastFrame() ?? '').split('\n').find((l) => l.includes('Dark')) ?? ''
    expect(row).toContain(`${fgOf(p.brand)}▌`)
    expect(row).not.toContain(fgOf(p.modeConvert))
  })
})
