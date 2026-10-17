import { Box } from 'ink'
import { useEffect, useMemo, useState } from 'react'
import type { CreditSection } from '../../core/attributions.js'
import {
  ABOUT_INDENT,
  ABOUT_LINKS,
  aboutPillRow,
  aboutTabRows,
  creditLines,
  lastStart,
  scrolledLines,
} from '../about-art.js'
import type { BarChip } from '../bar-art.js'
import { HeaderBar } from '../components/HeaderBar.js'
import { HintBar } from '../components/HintBar.js'
import { Runs } from '../components/Home.js'
import { blank } from '../home-art.js'
import { Text } from '../Text.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, modeGradient, type Palette } from '../theme.js'
import { useKeys } from '../useKeys.js'

/** What /about needs from outside, injectable so tests open no browser and read no disk. */
export interface AboutSystem {
  openUrl(url: string): Promise<void>
  openFile(path: string): Promise<void>
  /** Attributions' sections, and the licence file when the build wrote one. */
  credits(): Promise<{ sections: CreditSection[]; file?: string }>
}

/** Loaded on first use, so the shell's start-up reads no licence file and lists no extension. */
export const realAbout: AboutSystem = {
  async openUrl(url) {
    return (await import('../reveal.js')).openUrl(url)
  },
  async openFile(path) {
    return (await import('../reveal.js')).openPath(path)
  },
  async credits() {
    return (await import('../about-credits.js')).loadCredits()
  },
}

/** The menu's gold, as the other settings: /about is reached from the menu. */
export function aboutChip(p: Palette): BarChip {
  return { label: 'about', colour: p.brand, stops: modeGradient(p, 'menu') }
}

/** Above the list: the bar and its gap, the tab bar and its gap. Below: the note, the key row's gap, rule and keys. */
const CHROME = 2 + 3 + 4

interface AboutFlowProps {
  width: number
  height: number
  /** The running version. */
  version: string
  system?: AboutSystem
  onClose: () => void
}

/**
 * `/about` (mockups in /tmp/forge-about, decided 2026-10-13): the bar
 * signed "by Atharva Nayak" at its far end, two tabs on a rule (L2). About is
 * Forge and its version, then the three links as pills (K4) — ←→ choose, ↵
 * opens one in the browser — with the chosen one's address under them.
 * Attributions is one scrolling list (T1): App, Extensions, Others; ↵ opens
 * the full licence texts. `tab` moves between the two, as ←→ belong to the
 * pills.
 */
export function AboutFlow({ width, height, version, system = realAbout, onClose }: AboutFlowProps) {
  const palette = useTheme()
  const [tab, setTab] = useState(0)
  const [link, setLink] = useState(0)
  const [start, setStart] = useState(0)
  const [credits, setCredits] = useState<{ sections: CreditSection[]; file?: string }>()
  useEffect(() => {
    let alive = true
    system
      .credits()
      .then((c) => alive && setCredits(c))
      .catch(() => alive && setCredits({ sections: [] }))
    return () => {
      alive = false
    }
  }, [system])

  const lines = useMemo(
    () => creditLines({ palette, width, sections: credits?.sections ?? [] }),
    [palette, width, credits],
  )
  const room = Math.max(3, height - CHROME)
  const last = lastStart(lines.length, room)

  useKeys((_input, key) => {
    if (key.escape) return onClose()
    if (key.tab) return setTab((t) => 1 - t)
    if (tab === 0) {
      if (key.leftArrow) setLink((i) => Math.max(0, i - 1))
      else if (key.rightArrow) setLink((i) => Math.min(ABOUT_LINKS.length - 1, i + 1))
      else if (key.return) void system.openUrl(ABOUT_LINKS[link]?.url ?? '').catch(() => {})
      return
    }
    if (key.upArrow) setStart((s) => Math.max(0, s - 1))
    else if (key.downArrow) setStart((s) => Math.min(last, s + 1))
    else if (key.return && credits?.file) void system.openFile(credits.file).catch(() => {})
  })

  const plain = (process.env.NO_COLOR ?? '') !== ''
  const chosen = ABOUT_LINKS[link]
  const keys: Array<[string, string]> =
    tab === 0
      ? [
          ['←→', 'choose'],
          ['↵', 'open'],
          ['tab', 'attributions'],
        ]
      : [
          ['↑↓', 'scroll'],
          ...(credits?.file ? [['↵', 'full licence texts'] as [string, string]] : []),
          ['tab', 'about'],
        ]

  return (
    <Box flexDirection="column" flexGrow={1} minHeight={height}>
      <Box marginBottom={1}>
        <HeaderBar
          mode="convert"
          chip={aboutChip(palette)}
          trail={{ answers: [], lead: 'by', current: 'Atharva Nayak' }}
          width={width}
        />
      </Box>
      {aboutTabRows({ palette, width, at: tab }).map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the tab bar's two rows are positional
        <Runs key={i} row={row} />
      ))}
      <Text> </Text>
      {tab === 0 ? (
        <>
          <Text>
            {' '.repeat(ABOUT_INDENT)}
            <Text bold color={colourProp(palette.fg)}>
              Forge
            </Text>
            <Text color={colourProp(palette.dim)}>{` ${version}`}</Text>
            <Text color={colourProp(palette.border)}>
              {'  ·  a terminal-native file converter'}
            </Text>
          </Text>
          <Text> </Text>
          <Text> </Text>
          <Runs row={aboutPillRow({ palette, at: link, plain })} />
          <Text> </Text>
          <Runs row={[blank(ABOUT_INDENT), { text: chosen?.shown ?? '', fg: palette.border }]} />
        </>
      ) : (
        scrolledLines({ palette, width, lines, start: Math.min(start, last), room }).map(
          (row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the window's rows are positional
            <Runs key={i} row={row} />
          ),
        )
      )}
      <HintBar width={width} pairs={keys} foot={[['esc', 'back']]} />
    </Box>
  )
}
