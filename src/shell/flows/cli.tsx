import { Box } from 'ink'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CLI_TABS } from '../../core/cli-reference.js'
import type { BarChip } from '../bar-art.js'
import { cliExampleRows, cliListRows, cliTabRows } from '../cli-art.js'
import { Runs } from '../components/Home.js'
import { ScreenBar, ScreenKeys } from '../components/MenuPopup.js'
import type { Row } from '../home-art.js'
import { Text } from '../Text.js'
import { useTheme } from '../ThemeContext.js'
import { modeGradient, type Palette } from '../theme.js'
import { useKeys } from '../useKeys.js'

/** What /cli needs from outside, injectable so tests touch no clipboard. */
export interface CliSystem {
  copy(text: string): void
}

/** Loaded on first use, so the shell's start-up reads no clipboard code. */
export const realCli: CliSystem = {
  copy(text) {
    void import('../clipboard.js').then(({ copy }) => copy(text))
  },
}

/** The menu's gold, as the other settings: /cli is reached from the menu. */
export function cliChip(p: Palette): BarChip {
  return { label: 'cli', colour: p.brand, stops: modeGradient(p, 'menu') }
}

/** How long "✓ copied" stands on the shelf, as /update's does beside its pill. */
const COPIED_MS = 1500
/** Under the list: the tabs and their gap (3), the "↓ n more" row (1), the shelf and its gap (2). */
const CHROME = 3 + 1 + 2

/** A row; an empty one is a blank line, which Ink would otherwise draw as nothing. */
const Line = ({ row }: { row: Row }) => (row.length === 0 ? <Text> </Text> : <Runs row={row} />)

interface CliFlowProps {
  width: number
  height: number
  system?: CliSystem
  onClose: () => void
}

/**
 * `/cli` (mockups/cli-2026-10.html, decided 2026-10-19): every flag and
 * subcommand, a tab each category (option C). ↑↓ choose a row, ←→ change
 * category, ↵ copy the chosen row's example, which is on a shelf under the
 * list.
 */
export function CliFlow({ width, height, system = realCli, onClose }: CliFlowProps) {
  const palette = useTheme()
  const [at, setPosition] = useState({ tab: 0, row: 0, start: 0 })
  // Keys can arrive faster than React renders (a held arrow): each reads the latest position here.
  const position = useRef(at)
  const [copiedBy, setCopiedBy] = useState(0)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (copiedBy === 0) return
    setCopied(true)
    const id = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(id)
  }, [copiedBy])

  const items = (CLI_TABS[at.tab] ?? CLI_TABS[0])?.items ?? []
  const room = Math.max(3, height - CHROME)

  const moveTo = (next: typeof at) => {
    position.current = next
    setPosition(next)
    setCopied(false)
  }
  /** The chosen row moved to `row`, the window scrolled just far enough to keep it in view. */
  const choose = (row: number) => {
    const here = position.current
    const count = CLI_TABS[here.tab]?.items.length ?? 0
    const to = Math.max(0, Math.min(count - 1, row))
    const start = to < here.start ? to : to >= here.start + room ? to - room + 1 : here.start
    moveTo({ ...here, row: to, start })
  }

  useKeys((_input, key) => {
    const here = position.current
    if (key.escape) return onClose()
    if (key.upArrow) return choose(here.row - 1)
    if (key.downArrow) return choose(here.row + 1)
    if (key.leftArrow || key.rightArrow) {
      const next = Math.max(0, Math.min(CLI_TABS.length - 1, here.tab + (key.rightArrow ? 1 : -1)))
      if (next !== here.tab) moveTo({ tab: next, row: 0, start: 0 })
      return
    }
    if (key.return) {
      const item = CLI_TABS[here.tab]?.items[here.row]
      if (!item) return
      system.copy(item.ex)
      // A fresh copy restarts the moment, as /update's does.
      setCopiedBy((n) => n + 1)
    }
  })

  const tabs = useMemo(
    () => cliTabRows({ palette, width, tabs: CLI_TABS, at: at.tab }),
    [palette, width, at.tab],
  )
  const list = cliListRows({ palette, width, items, at: at.row, start: at.start, room })
  const example = items[at.row]

  return (
    <Box flexDirection="column" flexGrow={1} minHeight={height}>
      <ScreenBar chip={cliChip(palette)} trail={{ answers: [] }} width={width} />
      {tabs.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the tab bar's two rows are positional
        <Runs key={i} row={row} />
      ))}
      <Text> </Text>
      {list.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the window's rows are positional
        <Line key={i} row={row} />
      ))}
      {example
        ? cliExampleRows({ palette, width, item: example, copied }).map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the shelf's rows are positional
            <Line key={i} row={row} />
          ))
        : null}
      <ScreenKeys
        width={width}
        pairs={[
          ['↑↓', 'choose'],
          ['←→', 'category'],
          ['↵', 'copy example'],
        ]}
        foot={[['esc', 'back']]}
      />
    </Box>
  )
}
