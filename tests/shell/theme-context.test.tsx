import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { ThemeProvider, useTheme } from '../../src/shell/ThemeContext.js'
import { DARK, LIGHT, NEUTRAL } from '../../src/shell/theme.js'

function Probe() {
  const palette = useTheme()
  return <Text>{palette.name}</Text>
}

describe('theme context', () => {
  it('provides the palette it is given', () => {
    expect(
      render(
        <ThemeProvider palette={LIGHT}>
          <Probe />
        </ThemeProvider>,
      ).lastFrame(),
    ).toContain('light')

    expect(
      render(
        <ThemeProvider palette={DARK}>
          <Probe />
        </ThemeProvider>,
      ).lastFrame(),
    ).toContain('dark')
  })

  it('defaults to the neutral palette outside a provider', () => {
    expect(render(<Probe />).lastFrame()).toContain(NEUTRAL.name)
  })
})
