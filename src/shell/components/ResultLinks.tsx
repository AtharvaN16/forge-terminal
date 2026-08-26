import { Box, type DOMElement, Text } from 'ink'
import { useRef } from 'react'
import { useClickTarget } from '../ClickTargets.js'
import { fileLink, hyperlinksSupported } from '../hyperlink.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'

/**
 * One link: the label, and the region a click on it lands in.
 *
 * Still an OSC 8 hyperlink where the terminal supports one, so cmd+click keeps
 * working and the URL is still copyable — the click target is additive. Where
 * OSC 8 is absent (Terminal.app) the label renders as plain text and the click
 * target is the whole mechanism, which is why the label is no longer gated on
 * `hyperlinksSupported()`.
 */
function Link({
  id,
  label,
  path,
  onActivate,
}: {
  id: string
  label: string
  path: string
  onActivate: () => void
}) {
  const palette = useTheme()
  const ref = useRef<DOMElement | null>(null)
  useClickTarget({ id, ref, onClick: onActivate })
  return (
    <Box ref={ref}>
      <Text color={colourProp(palette.accent)}>
        {hyperlinksSupported() ? fileLink(label, path) : label}
      </Text>
    </Box>
  )
}

export function ResultLinks({
  outputPath,
  revealLabel,
  onOpen,
  onReveal,
}: {
  outputPath: string
  revealLabel: string
  onOpen: () => void
  onReveal: () => void
}) {
  return (
    <Box>
      <Link id="result-open" label="Open file" path={outputPath} onActivate={onOpen} />
      <Text>{'  ·  '}</Text>
      <Link
        id="result-reveal"
        label={revealLabel}
        path={outputPath.replace(/\/[^/]+$/, '')}
        onActivate={onReveal}
      />
    </Box>
  )
}
