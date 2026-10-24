import { Box } from 'ink'
import { useEffect, useState } from 'react'
import type { BarChip } from '../bar-art.js'
import { keyHint } from '../components/Done.js'
import { Runs } from '../components/Home.js'
import { ScreenBar, ScreenKeys } from '../components/MenuPopup.js'
import { blank, HOME_MARGIN, type Row } from '../home-art.js'
import { Text } from '../Text.js'
import { useTheme } from '../ThemeContext.js'
import { modeGradient, type Palette } from '../theme.js'
import { useKeys } from '../useKeys.js'

/** What /right-click needs from outside, injectable so tests touch no Finder and no registry. */
export interface RightClickSystem {
  /** Whether Forge is in the right-click menu now. */
  isOn(): Promise<boolean>
  /** Puts it there, and keeps it there on every start. */
  turnOn(): Promise<void>
  /** Takes it out, and keeps it out on every start. */
  turnOff(): Promise<void>
  copy(text: string): void
}

/** Loaded on first use, so the shell's start-up loads none of the menu's code. */
export const realRightClick: RightClickSystem = {
  async isOn() {
    return (await import('../../menu/entry.js')).menuIsOn()
  },
  async turnOn() {
    await (await import('../../menu/entry.js')).switchMenu(true)
  },
  async turnOff() {
    await (await import('../../menu/entry.js')).switchMenu(false)
  },
  copy(text) {
    void import('../clipboard.js').then((c) => c.copy(text))
  },
}

/** The menu's gold, as the other settings: /right-click is reached from the menu. */
export function rightClickChip(p: Palette): BarChip {
  return { label: 'right-click', colour: p.brand, stops: modeGradient(p, 'menu') }
}

const COMMAND = 'forge uninstall'

/**
 * Decided (mockups/menu-settings-2026-10.html, S4) with the user's words:
 * whether Forge is in the right-click menu, with ↵ beside it to switch it,
 * then why `forge uninstall` is shown here, the command with `c` beside it.
 */
function words(platform: NodeJS.Platform, on: boolean) {
  const mac = platform === 'darwin'
  return {
    state: mac
      ? on
        ? 'Forge is in Finder’s Quick Actions'
        : 'Forge is not in Finder’s Quick Actions'
      : on
        ? 'Forge is in the right-click menu'
        : 'Forge is not in the right-click menu',
    why: `npm uninstall won’t remove Forge from ${
      mac
        ? 'your Mac’s Quick Actions'
        : platform === 'linux'
          ? 'your file manager’s right-click menu'
          : 'your PC’s right-click menu'
    }. To remove it, run the command below to uninstall Forge and delete any remaining settings.`,
  }
}

/** `text` broken into lines of at most `max` columns, at spaces. */
function wrap(text: string, max: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > max) {
      out.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) out.push(line)
  return out
}

export function RightClickFlow({
  width,
  platform = process.platform,
  system = realRightClick,
  onClose,
}: {
  width: number
  platform?: NodeJS.Platform
  system?: RightClickSystem
  onClose: () => void
}) {
  const palette = useTheme()
  const [on, setOn] = useState<boolean>()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    system
      .isOn()
      .then((v) => alive && setOn(v))
      .catch(() => alive && setOn(false))
    return () => {
      alive = false
    }
  }, [system])

  useKeys((input, key) => {
    if (key.escape) return onClose()
    if (busy || on === undefined) return
    if (key.return) {
      setBusy(true)
      const next = !on
      void (next ? system.turnOn() : system.turnOff())
        .then(() => setOn(next))
        .catch(() => {})
        .finally(() => setBusy(false))
      return
    }
    if (input === 'c') system.copy(COMMAND)
  })

  const indent = blank(HOME_MARGIN + 2)
  const w = words(platform, on ?? false)
  const status: Row =
    on === undefined
      ? [indent]
      : [
          indent,
          on ? { text: '● ', fg: palette.ok, bold: true } : { text: '○ ', fg: palette.border },
          { text: w.state, fg: on ? palette.fg : palette.dim, bold: on },
          blank(4),
          ...keyHint(palette, '↵', on ? 'turn off' : 'turn on'),
        ]
  const textWidth = Math.max(20, width - (HOME_MARGIN + 2) * 2)
  const command: Row = [
    indent,
    { text: ` ${COMMAND} `, fg: palette.fg, bg: palette.selectionBg },
    blank(3),
    ...keyHint(palette, 'c', 'copy'),
  ]

  return (
    <Box flexDirection="column" flexGrow={1}>
      <ScreenBar
        chip={rightClickChip(palette)}
        trail={{ answers: [], current: 'Right-click menu' }}
        width={width}
        drift={busy}
      />
      <Runs row={status} />
      <Text> </Text>
      <Text> </Text>
      <Runs row={[indent, { text: 'Uninstalling Forge', fg: palette.dim }]} />
      {wrap(w.why, textWidth).map((line) => (
        <Runs key={line} row={[indent, { text: line, fg: palette.border }]} />
      ))}
      <Text> </Text>
      <Runs row={command} />
      <Box flexGrow={1} />
      <ScreenKeys width={width} pairs={[]} foot={[['esc', 'back']]} />
    </Box>
  )
}
