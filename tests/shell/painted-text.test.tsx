import { Box } from 'ink'
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { Text } from '../../src/shell/Text.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, LIGHT, NEUTRAL } from '../../src/shell/theme.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

const LIGHT_FG = '\u001b[38;2;38;38;38m'

describe('Text on a painted canvas', () => {
  it('takes the palette’s ink when it names none: the terminal’s own may be white', () => {
    const { lastFrame } = render(
      <ThemeProvider palette={LIGHT}>
        <Text>JPEG</Text>
      </ThemeProvider>,
    )
    expect(lastFrame()).toContain(`${LIGHT_FG}JPEG`)
  })

  it('keeps a colour it is given', () => {
    const { lastFrame } = render(
      <ThemeProvider palette={LIGHT}>
        <Text color="#9a6005">JPEG</Text>
      </ThemeProvider>,
    )
    expect(lastFrame()).toContain('\u001b[38;2;154;96;5mJPEG')
    expect(lastFrame()).not.toContain(LIGHT_FG)
  })

  it('lets a nested Text inherit from the one around it', () => {
    const { lastFrame } = render(
      <ThemeProvider palette={LIGHT}>
        <Text color="#9a6005">
          a <Text bold>b</Text>
        </Text>
      </ThemeProvider>,
    )
    expect(lastFrame()).not.toContain(LIGHT_FG)
  })

  it('takes dark’s ink too, now that dark paints its canvas', () => {
    const { lastFrame } = render(
      <ThemeProvider palette={DARK}>
        <Text>JPEG</Text>
      </ThemeProvider>,
    )
    expect(lastFrame()).toContain('\u001b[38;2;231;231;231mJPEG')
  })

  it('leaves the neutral palette to the terminal’s own foreground', () => {
    const { lastFrame } = render(
      <ThemeProvider palette={NEUTRAL}>
        <Box>
          <Text>JPEG</Text>
        </Box>
      </ThemeProvider>,
    )
    expect(lastFrame()).toBe('JPEG')
  })
})
