import { Box } from 'ink'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { SPINNER_FRAMES } from '../../cli/spinner.js'
import { isForgeError } from '../../core/errors.js'
import type { BarChip } from '../bar-art.js'
import { HeaderBar } from '../components/HeaderBar.js'
import { HintBar } from '../components/HintBar.js'
import { Runs } from '../components/Home.js'
import { errorLine } from '../error-art.js'
import { HOME_MARGIN } from '../home-art.js'
import { motionEnabled, useTicker } from '../motion.js'
import { Text } from '../Text.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, modeGradient, type Palette } from '../theme.js'
import { useKeys } from '../useKeys.js'

/** What /update needs from outside, injectable so tests need no network, npm or disk. */
export interface Updater {
  /** The registry's latest release, or undefined when it cannot be reached. */
  check(): Promise<string | undefined>
  install(version: string): Promise<void>
  /** The automatic check's preference, saved. */
  setAuto(on: boolean): Promise<void>
  copy(text: string): void
}

/** Loaded on first use, so the shell's start-up never touches `src/update/`'s install side. */
export const realUpdater: Updater = {
  async check() {
    return (await import('../../update/check.js')).checkNow()
  },
  async install(version) {
    return (await import('../../update/install.js')).installUpdate(version)
  },
  async setAuto(on) {
    const { savePreferences } = await import('../../config/preferences.js')
    await savePreferences({ updateCheck: on })
  },
  copy(text) {
    void import('../clipboard.js').then(({ copy }) => copy(text))
  },
}

/** The menu's gold, as /extensions: /update is a setting, reached from the menu. */
export function updateChip(p: Palette): BarChip {
  return { label: 'update', colour: p.brand, stops: modeGradient(p, 'menu') }
}

type State =
  | { kind: 'checking' }
  | { kind: 'unreachable' }
  | { kind: 'latest' }
  | { kind: 'available'; latest: string }
  | { kind: 'installing'; latest: string; since: number }
  | { kind: 'installed'; latest: string }
  /** npm refused or failed; `command` is what the person can run themselves. */
  | { kind: 'refused'; latest: string; title: string; reason: string; command: string }

/** /extensions' measurements, four cells wider so "Check automatically" and its pill share a row. */
const LIST_WIDTH = 31
const SPIN_MS = 80
/** The clock appears after this long, as the working screen's does (W5). */
const CLOCK_AFTER_MS = 3000
/** How long "✓ copied" stands beside the pill: as long as colour's copy confirmation. */
const COPIED_MS = 1500

interface UpdateFlowProps {
  width: number
  /** The running version. */
  current: string
  /** The automatic check, as the preferences have it now. */
  auto: boolean
  updater?: Updater
  onClose: () => void
  /** ↵ restart, once the new version is installed. */
  onRestart: () => void
  /** Told what the registry said, so home's band can follow without a second request. */
  onChecked?: (latest: string | undefined) => void
}

/**
 * `/update` (V4, mockups/update-check-2026-10.html): /extensions' split. Two
 * rows — Forge, with a blue "new" beside it when a newer release is out (✓
 * when not), then a gap, then Check automatically with Boost's ‹ on › pill.
 * Forge's sheet says the new version and yours, and ↵ installs it in place:
 * npm reports no progress, so a spinner and, after three seconds, a clock
 * (invariant 7). The command and ↵ copy appear only when npm refuses. The
 * switch's side is left blank: its row says everything.
 */
export function UpdateFlow({
  width,
  current,
  auto: autoAtOpen,
  updater = realUpdater,
  onClose,
  onRestart,
  onChecked,
}: UpdateFlowProps) {
  const palette = useTheme()
  const [state, setState] = useState<State>({ kind: 'checking' })
  const [row, setRow] = useState<0 | 1>(0)
  const [auto, setAuto] = useState(autoAtOpen)
  /** ↵ copy just put the command on the clipboard: said beside the pill for a moment. */
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(id)
  }, [copied])
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const check = useCallback(async () => {
    setState({ kind: 'checking' })
    const latest = await updater.check().catch(() => undefined)
    if (!alive.current) return
    onChecked?.(latest)
    if (latest === undefined) return setState({ kind: 'unreachable' })
    const { isNewer } = await import('../../update/check.js')
    setState(isNewer(latest, current) ? { kind: 'available', latest } : { kind: 'latest' })
  }, [updater, current, onChecked])

  useEffect(() => {
    void check()
  }, [check])

  const install = async (latest: string) => {
    setState({ kind: 'installing', latest, since: Date.now() })
    try {
      await updater.install(latest)
      if (alive.current) setState({ kind: 'installed', latest })
    } catch (e) {
      if (!alive.current) return
      const known = isForgeError(e)
      setState({
        kind: 'refused',
        latest,
        // One sentence, as the mockup's tinted row: the short form, no reason after it.
        title: known ? (e.short ?? e.title) : 'npm could not install the update',
        reason: '',
        command: known && e.hint ? e.hint : `npm i -g forge-terminal@${latest}`,
      })
    }
  }

  const flip = (on: boolean) => {
    if (on === auto) return
    setAuto(on)
    void updater.setAuto(on).catch(() => {})
  }

  const busy = state.kind === 'installing'
  useKeys((_input, key) => {
    if (busy) return
    if (key.escape) return onClose()
    if (key.upArrow) return setRow(0)
    if (key.downArrow) return setRow(1)
    if (row === 1) {
      if (key.leftArrow) flip(true)
      else if (key.rightArrow) flip(false)
      return
    }
    if (!key.return) return
    if (state.kind === 'available') void install(state.latest)
    else if (state.kind === 'installed') onRestart()
    else if (state.kind === 'refused') {
      updater.copy(state.command)
      // A fresh copy restarts the moment, as a second one in colour does.
      setCopied(false)
      setTimeout(() => setCopied(true), 0)
    } else if (state.kind === 'latest' || state.kind === 'unreachable') void check()
  })

  const spinning = (busy || state.kind === 'checking') && motionEnabled(palette.name)
  const n = useTicker(spinning, SPIN_MS)
  const spinner = spinning ? (SPINNER_FRAMES[n % SPINNER_FRAMES.length] ?? '') : '·'

  const fg = colourProp(palette.fg)
  const dim = colourProp(palette.dim)
  const gold = colourProp(updateChip(palette).colour)
  const fresh =
    state.kind === 'available' || state.kind === 'installing' || state.kind === 'refused'
  const split = width >= LIST_WIDTH + 3 + 40
  const paneWidth = Math.max(10, split ? width - HOME_MARGIN - LIST_WIDTH - 2 : width - HOME_MARGIN)

  const pill = (text: string) => (
    <Text backgroundColor={colourProp(palette.pill)} color={colourProp(palette.ink)} bold>
      {` ${text} `}
    </Text>
  )

  const band = (on: boolean, left: ReactNode, right: ReactNode = null) => (
    <Box
      width={LIST_WIDTH}
      justifyContent="space-between"
      {...(on && palette.listBand !== '' ? { backgroundColor: palette.listBand } : {})}
    >
      <Text wrap="truncate">
        {on ? <Text color={gold}>▌ </Text> : '  '}
        {left}
      </Text>
      {right}
    </Box>
  )

  /** "new" beside the name while a newer Forge is out; ✓ once this is the latest. */
  const mark =
    fresh && palette.newTagBg !== '' ? (
      <Text>
        {' '}
        <Text backgroundColor={palette.newTagBg} color={colourProp(palette.newTag)} bold>
          {' new '}
        </Text>
      </Text>
    ) : fresh ? (
      <Text bold color={colourProp(palette.newTag)}>
        {' new'}
      </Text>
    ) : state.kind === 'latest' ? (
      <Text color={colourProp(palette.ok)}> ✓</Text>
    ) : null

  /** Boost's B3 pill: ‹ on ›, the arrow that leads nowhere in the border grey. */
  const chip = palette.folderChip === '' ? {} : { backgroundColor: palette.folderChip }
  const arrow = (live: boolean, text: string) => (
    <Text
      bold={live}
      color={colourProp(live && row === 1 ? palette.accent : palette.border)}
      {...chip}
    >
      {text}
    </Text>
  )
  const switchPill = (
    <Text>
      {arrow(!auto, ' ‹ ')}
      <Text bold color={fg} {...chip}>
        {auto ? 'on' : 'off'}
      </Text>
      {arrow(auto, ' › ')}
    </Text>
  )

  const list = (
    <>
      {band(
        row === 0,
        <>
          <Text bold={row === 0} color={row === 0 ? fg : dim}>
            Forge
          </Text>
          {mark}
        </>,
      )}
      <Text> </Text>
      {band(
        row === 1,
        <Text bold={row === 1} color={row === 1 ? fg : dim}>
          Check automatically
        </Text>,
        switchPill,
      )}
    </>
  )

  const refusalRow = (title: string, reason: string) => (
    <Runs
      row={errorLine({
        palette,
        title,
        reason,
        width: split ? paneWidth - 3 : paneWidth,
        plain: (process.env.NO_COLOR ?? '') !== '',
      })}
    />
  )

  const clock = (since: number) => {
    const s = Math.floor((Date.now() - since) / 1000)
    return Date.now() - since < CLOCK_AFTER_MS
      ? ''
      : ` · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  const sheet = (): ReactNode[] => {
    if (row === 1) return []
    const title = (v: string) => (
      <Text bold color={fg}>
        {`Forge ${v}`}
      </Text>
    )
    const yours = <Text color={dim}>{`Your version: ${current}`}</Text>
    switch (state.kind) {
      case 'checking':
        return [
          title(current),
          <Text key="c">
            <Text color={gold}>{`${spinner} `}</Text>
            <Text color={dim}>checking npm</Text>
          </Text>,
        ]
      case 'unreachable':
        return [
          title(current),
          refusalRow('Could not check', 'could not reach npm'),
          '',
          pill('↵ try again'),
        ]
      case 'latest':
        return [
          title(current),
          <Text key="l">
            <Text color={colourProp(palette.ok)}>✓ the latest</Text>
            <Text color={dim}> · checked just now</Text>
          </Text>,
          '',
          pill('↵ check again'),
        ]
      case 'available':
        return [
          title(state.latest),
          yours,
          '',
          <Text key="u">
            {pill('↵ update')}
            <Text color={dim}>{'  Forge restarts when it is done'}</Text>
          </Text>,
        ]
      case 'installing':
        return [
          title(state.latest),
          yours,
          '',
          <Text key="i">
            <Text color={gold}>{`${spinner} `}</Text>
            <Text color={fg}>{`Installing ${state.latest}`}</Text>
            <Text color={dim}>{clock(state.since)}</Text>
          </Text>,
        ]
      case 'installed':
        return [
          title(state.latest),
          <Text key="d">
            <Text color={colourProp(palette.ok)}>✓ installed</Text>
            <Text color={dim}> · restart to use it</Text>
          </Text>,
          '',
          pill('↵ restart'),
        ]
      case 'refused':
        return [
          title(state.latest),
          yours,
          '',
          refusalRow(state.title, state.reason),
          '',
          <Text
            key="cmd"
            backgroundColor={palette.fieldBand === '' ? undefined : palette.fieldBand}
            color={fg}
          >
            {`  ${state.command}  `}
          </Text>,
          '',
          <Text key="copy">
            {pill('↵ copy')}
            {copied ? (
              <>
                <Text color={colourProp(palette.ok)} bold>
                  {'  ✓ copied'}
                </Text>
                <Text color={dim}>{' to the clipboard'}</Text>
              </>
            ) : (
              <Text color={dim}>{'  run it in any terminal'}</Text>
            )}
          </Text>,
        ]
    }
  }

  const keys = (): { main: Array<[string, string]>; foot: Array<[string, string]> } => {
    const quit: [string, string] = ['ctrl-c', 'quit']
    if (busy) return { main: [], foot: [quit] }
    const main: Array<[string, string]> = [['↑↓', 'choose']]
    if (row === 1) main.push(['←→', 'on / off'])
    else if (state.kind === 'available') main.push(['↵', 'update'])
    else if (state.kind === 'installed') main.push(['↵', 'restart'])
    else if (state.kind === 'refused') main.push(['↵', 'copy'])
    else if (state.kind === 'latest') main.push(['↵', 'check again'])
    else if (state.kind === 'unreachable') main.push(['↵', 'try again'])
    return { main, foot: [['esc', 'home'], quit] }
  }

  const trail =
    state.kind === 'installing'
      ? { answers: ['Update'], current: 'Installing' }
      : { answers: [], current: 'Update' }
  const k = keys()
  const rows = sheet()

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginBottom={1}>
        <HeaderBar
          mode="convert"
          chip={updateChip(palette)}
          trail={trail}
          width={width}
          drift={busy}
        />
      </Box>
      <Box flexDirection={split ? 'row' : 'column'} paddingLeft={HOME_MARGIN}>
        <Box flexDirection="column" width={LIST_WIDTH} flexShrink={0}>
          {list}
        </Box>
        {split ? null : <Text> </Text>}
        <Box
          flexDirection="column"
          width={paneWidth}
          minHeight={4}
          {...(split
            ? {
                marginLeft: 1,
                paddingLeft: 2,
                borderStyle: 'single' as const,
                borderTop: false,
                borderBottom: false,
                borderRight: false,
                borderLeftColor: colourProp(palette.faint) ?? 'gray',
              }
            : {})}
        >
          {rows.map((r, i) =>
            typeof r === 'string' ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: the sheet's rows are positional
              <Text key={i}>{r || ' '}</Text>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: the sheet's rows are positional
              <Box key={i}>{r}</Box>
            ),
          )}
        </Box>
      </Box>
      <HintBar width={width} pairs={k.main} foot={k.foot} />
    </Box>
  )
}
