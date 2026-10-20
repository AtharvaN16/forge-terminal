import { Box } from 'ink'
import { HOME_MARGIN } from '../home-art.js'
import { Text } from '../Text.js'
import { ThemeProvider, useTheme } from '../ThemeContext.js'
import { menuPalette, modeGradient, NEUTRAL } from '../theme.js'
import { HeaderBar } from './HeaderBar.js'
import { ScreenKeys, useInMenu } from './MenuPopup.js'
import { Select } from './Select.js'

/**
 * Rendered before any theme is known, so it wraps itself in NEUTRAL rather
 * than inheriting the ambient palette: at this moment we genuinely do not
 * know the terminal's background, and NEUTRAL sets no background fill and no
 * foreground, which makes it legible on either. Reopened with /theme, the
 * theme is known — and light paints its canvas, where NEUTRAL's terminal
 * colours could be light on white — so it keeps the current palette.
 *
 * Round 5: "Select theme" (reopened: the settings' bar instead), a blank row, the two names with no hints, and the
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
  // In the / menu's popup, which draws the bar (named "Theme") and the blank row under it.
  const inMenu = useInMenu()
  return (
    <ThemeProvider palette={current.name === 'neutral' ? NEUTRAL : menuPalette(current)}>
      <Box flexDirection="column" flexGrow={1}>
        {inMenu ? null : onCancel ? (
          <ThemeBar width={width} />
        ) : (
          <Text bold>{`${' '.repeat(HOME_MARGIN)}Select theme`}</Text>
        )}
        {inMenu ? null : <Text> </Text>}
        {/* The rows' band on the margins, as far as the bar above it runs (Select indents itself). */}
        <Box>
          <Select
            width={width - HOME_MARGIN * 2}
            items={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            initialValue="dark"
            onSubmit={(value) => onChoose(value === 'light' ? 'light' : 'dark')}
            {...(onCancel ? { onCancel } : {})}
          />
        </Box>
        <ScreenKeys
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

/** Reopened with /theme, the picker is a setting like the others: their gold bar, named "theme". */
function ThemeBar({ width }: { width: number }) {
  const palette = useTheme()
  return (
    <HeaderBar
      mode="convert"
      chip={{ label: 'theme', colour: palette.brand, stops: modeGradient(palette, 'menu') }}
      trail={{ answers: [] }}
      width={width}
    />
  )
}
