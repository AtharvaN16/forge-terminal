import { Box } from 'ink'
import { Text } from '../Text.js'
import { ThemeProvider, useTheme } from '../ThemeContext.js'
import { commandsPalette, NEUTRAL } from '../theme.js'
import { HintBar } from './HintBar.js'
import { Select } from './Select.js'

/**
 * Rendered before any theme is known, so it wraps itself in NEUTRAL rather
 * than inheriting the ambient palette: at this moment we genuinely do not
 * know the terminal's background, and NEUTRAL sets no background fill and no
 * foreground, which makes it legible on either. Reopened with /theme, the
 * theme is known — and light paints its canvas, where NEUTRAL's terminal
 * colours could be light on white — so it keeps the current palette.
 *
 * Round 5: "Select theme", a blank row, the two names with no hints, and the
 * keys under a rule as on every other screen. The cursor opens on Dark, what
 * most terminals are.
 */
export function ThemePicker({
  width,
  onChoose,
  onCancel,
}: {
  width: number
  onChoose: (theme: 'dark' | 'light') => void
  /** esc: back, keeping the theme. Absent on first run, which has nothing to go back to. */
  onCancel?: () => void
}) {
  const current = useTheme()
  return (
    <ThemeProvider palette={current.name === 'neutral' ? NEUTRAL : commandsPalette(current)}>
      <Box flexDirection="column" flexGrow={1}>
        <Text bold>Select theme</Text>
        <Text> </Text>
        <Select
          width={width}
          items={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          initialValue="dark"
          onSubmit={(value) => onChoose(value === 'light' ? 'light' : 'dark')}
          {...(onCancel ? { onCancel } : {})}
        />
        <HintBar
          width={width}
          pairs={[
            ['↑↓', 'choose'],
            ['↵', 'confirm'],
          ]}
          foot={onCancel ? [['esc', 'back']] : []}
        />
      </Box>
    </ThemeProvider>
  )
}
