import { Box } from 'ink'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SPINNER_FRAMES } from '../../cli/spinner.js'
import { isForgeError } from '../../core/errors.js'
import type { ReleaseNote } from '../../update/check.js'
import type { BarChip } from '../bar-art.js'
import { Runs } from '../components/Home.js'
import { ScreenBar, ScreenKeys } from '../components/MenuPopup.js'
import { errorLine } from '../error-art.js'
import { HOME_MARGIN } from '../home-art.js'
import { motionEnabled, useTicker } from '../motion.js'
import { Text } from '../Text.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, modeGradient, type Palette } from '../theme.js'
import {
  CARD_CHROME,
  CARD_ROWS,
  lastNoteStart,
  noteCard,
  noteLines,
  noteStarts,
} from '../update-art.js'
import { useKeys } from '../useKeys.js'

/** What /update needs from outside, injectable so tests need no network, npm or disk. */
export interface Updater {
  /** The registry's latest release, or undefined when it cannot be reached. */
  check(): Promise<string | undefined>
  install(version: string): Promise<void>
  /** The automatic check's preference, saved. */
  setAuto(on: boolean): Promise<void>
  copy(text: string): void
  /** What a release says is new, as the last check heard it: none when unknown. */
  whatsNew?(version: string): Promise<ReleaseNote[]>
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
  async whatsNew(version) {
    return (await import('../../update/check.js')).whatsNewFor(version)
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

/** What ↑↓ has chosen: the release's action, the switch, or the notes (only when they scroll). */
type Focus = 'action' | 'auto' | 'notes'

const SPIN_MS = 80
/** The clock appears after this long, as the working screen's does (W5). */
const CLOCK_AFTER_MS = 3000
/** How long "✓ copied" stands beside the pill: as long as colour's copy confirmation. */
const COPIED_MS = 1500
/** The header bar and the gap under it; the hint bar's gap, rule and keys. */
const CHROME = 2 + 3

interface UpdateFlowProps {
  width: number
  /** The rows the screen has: the notes scroll in what the rest leaves. */
  height: number
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
 * `/update` (U4, mockups/whatsnew-2026-10.html): one column in three blocks.
 * The release — Forge and its version, a blue "new" beside it when a newer
 * one is out (✓ when not), its action at the far right of the row — and
 * yours under it; then Check automatically with Boost's ‹ on › pill; then,
 * once a newer release is known, what it says is new on a grey card under a
 * grey "what's new" chip. ↵ update installs it in place: npm reports no
 * progress, so a spinner and, after three seconds, a clock (invariant 7).
 * The command and ↵ copy appear only when npm refuses. ↑↓ goes from the
 * action to the switch to the notes, when they scroll.
 */
export function UpdateFlow({
  width,
  height,
  current,
  auto: autoAtOpen,
  updater = realUpdater,
  onClose,
  onRestart,
  onChecked,
}: UpdateFlowProps) {
  const palette = useTheme()
  const [state, setState] = useState<State>({ kind: 'checking' })
  const [focus, setFocus] = useState<Focus>('action')
  const [auto, setAuto] = useState(autoAtOpen)
  /** What the newer release says is new, on the card until it is installed and run. */
  const [notes, setNotes] = useState<ReleaseNote[]>([])
  /** The card's first line shown: always a note's first. */
  const [start, setStart] = useState(0)
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
    const newer = isNewer(latest, current)
    const said = newer && updater.whatsNew ? await updater.whatsNew(latest).catch(() => []) : []
    if (!alive.current) return
    setNotes(said)
    setStart(0)
    setState(newer ? { kind: 'available', latest } : { kind: 'latest' })
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

  const fg = colourProp(palette.fg)
  const dim = colourProp(palette.dim)
  const gold = colourProp(updateChip(palette).colour)
  const inner = Math.max(20, width - 2 * HOME_MARGIN)

  const spinning =
    (state.kind === 'installing' || state.kind === 'checking') && motionEnabled(palette.name)
  const n = useTicker(spinning, SPIN_MS)
  const spinner = spinning ? (SPINNER_FRAMES[n % SPINNER_FRAMES.length] ?? '') : '·'

  const pill = (text: string, on = focus === 'action') => (
    <Text
      backgroundColor={colourProp(on ? palette.pill : palette.keycapBg)}
      color={colourProp(on ? palette.ink : palette.dim)}
      bold
    >
      {` ${text} `}
    </Text>
  )

  const refusalRow = (title: string, reason: string) => (
    <Runs
      row={errorLine({
        palette,
        title,
        reason,
        width: inner,
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

  const fresh =
    state.kind === 'available' || state.kind === 'installing' || state.kind === 'refused'
  const shown = 'latest' in state ? state.latest : current

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

  /** At the far right of the release's row: what ↵ does, or what is happening. */
  const action = (): ReactNode => {
    switch (state.kind) {
      case 'checking':
        return (
          <Text>
            <Text color={gold}>{`${spinner} `}</Text>
            <Text color={dim}>checking npm</Text>
          </Text>
        )
      case 'unreachable':
        return pill('↵ try again')
      case 'latest':
        return pill('↵ check again')
      case 'available':
        return pill('↵ update')
      case 'installing':
        return (
          <Text>
            <Text color={gold}>{`${spinner} `}</Text>
            <Text color={fg}>{`Installing ${state.latest}`}</Text>
            <Text color={dim}>{clock(state.since)}</Text>
          </Text>
        )
      case 'installed':
        return pill('↵ restart')
      case 'refused':
        return null
    }
  }

  const yours = <Text color={dim}>{`Your version ${current}`}</Text>
  /** Under the release's row: yours, or what the check found. */
  const under = (): ReactNode[] => {
    switch (state.kind) {
      case 'checking':
        return [' ']
      case 'unreachable':
        return [refusalRow('Could not check', 'could not reach npm')]
      case 'latest':
        return [
          <Text key="l">
            <Text color={colourProp(palette.ok)}>✓ the latest</Text>
            <Text color={dim}> · checked just now</Text>
          </Text>,
        ]
      case 'available':
      case 'installing':
        return [yours]
      case 'installed':
        return [
          <Text key="d">
            <Text color={colourProp(palette.ok)}>✓ installed</Text>
            <Text color={dim}> · restart to use it</Text>
          </Text>,
        ]
      case 'refused':
        return [
          yours,
          ' ',
          refusalRow(state.title, state.reason),
          ' ',
          <Text
            key="cmd"
            backgroundColor={palette.fieldBand === '' ? undefined : palette.fieldBand}
            color={fg}
          >
            {`  ${state.command}  `}
          </Text>,
          ' ',
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

  const top = [
    <Box key="release" width={inner} justifyContent="space-between">
      <Text wrap="truncate">
        <Text bold color={fg}>{`Forge ${shown}`}</Text>
        {mark}
      </Text>
      {action()}
    </Box>,
    ...under(),
  ]

  // The card: the newer release's notes, in whatever rows the rest leaves.
  const showCard = notes.length > 0 && 'latest' in state
  const laid = useMemo(
    () => noteLines({ palette, notes, width: inner - CARD_CHROME }),
    [palette, notes, inner],
  )
  const room = Math.max(3, height - CHROME - top.length - 3 - CARD_ROWS)
  const scrolls = showCard && laid.rows.length > room
  const last = lastNoteStart(laid.items, room)
  const starts = noteStarts(laid.items).filter((k) => k <= last)

  const busy = state.kind === 'installing'
  useKeys((_input, key) => {
    if (busy) return
    if (key.escape) return onClose()
    if (key.upArrow) {
      if (focus === 'notes') {
        const before = starts.filter((k) => k < start).at(-1)
        if (before === undefined) setFocus('auto')
        else setStart(before)
      } else setFocus('action')
      return
    }
    if (key.downArrow) {
      if (focus === 'action') setFocus('auto')
      else if (focus === 'auto' && scrolls) setFocus('notes')
      else if (focus === 'notes') setStart(starts.find((k) => k > start) ?? start)
      return
    }
    if (focus === 'auto') {
      if (key.leftArrow) flip(true)
      else if (key.rightArrow) flip(false)
      return
    }
    if (focus !== 'action' || !key.return) return
    if (state.kind === 'available') void install(state.latest)
    else if (state.kind === 'installed') onRestart()
    else if (state.kind === 'refused') {
      updater.copy(state.command)
      // A fresh copy restarts the moment, as a second one in colour does.
      setCopied(false)
      setTimeout(() => setCopied(true), 0)
    } else if (state.kind === 'latest' || state.kind === 'unreachable') void check()
  })

  /** Boost's B3 pill: ‹ on ›, the arrow that leads nowhere in the border grey. */
  const chip = palette.folderChip === '' ? {} : { backgroundColor: palette.folderChip }
  const arrow = (live: boolean, text: string) => (
    <Text
      bold={live}
      color={colourProp(live && focus === 'auto' ? palette.accent : palette.border)}
      {...chip}
    >
      {text}
    </Text>
  )
  const onAuto = focus === 'auto'
  const switchRow = (
    <Text>
      <Text bold={onAuto} color={onAuto ? fg : dim}>
        Check automatically
      </Text>
      {'   '}
      {arrow(!auto, ' ‹ ')}
      <Text bold color={fg} {...chip}>
        {auto ? 'on' : 'off'}
      </Text>
      {arrow(auto, ' › ')}
    </Text>
  )

  const keys = (): { main: Array<[string, string]>; foot: Array<[string, string]> } => {
    const quit: [string, string] = ['ctrl-c', 'quit']
    if (busy) return { main: [], foot: [quit] }
    const foot: Array<[string, string]> = [['esc', 'home'], quit]
    if (focus === 'notes') return { main: [['↑↓', 'scroll']], foot }
    const main: Array<[string, string]> = [['↑↓', 'choose']]
    if (focus === 'auto') main.push(['←→', 'on / off'])
    else if (state.kind === 'available') main.push(['↵', 'update'])
    else if (state.kind === 'installed') main.push(['↵', 'restart'])
    else if (state.kind === 'refused') main.push(['↵', 'copy'])
    else if (state.kind === 'latest') main.push(['↵', 'check again'])
    else if (state.kind === 'unreachable') main.push(['↵', 'try again'])
    return { main, foot }
  }

  const trail =
    state.kind === 'installing'
      ? { answers: ['Update'], current: 'Installing' }
      : { answers: [], current: 'Update' }
  const k = keys()

  return (
    <Box flexDirection="column" flexGrow={1}>
      <ScreenBar chip={updateChip(palette)} trail={trail} width={width} drift={busy} />
      <Box flexDirection="column" paddingLeft={HOME_MARGIN}>
        {top.map((r, i) =>
          typeof r === 'string' ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: the release block's rows are positional
            <Text key={i}>{r}</Text>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: the release block's rows are positional
            <Box key={i}>{r}</Box>
          ),
        )}
        <Text> </Text>
        {switchRow}
        {showCard ? (
          <>
            <Text> </Text>
            {noteCard({
              palette,
              version: shown,
              laid,
              width: inner,
              start,
              // A short release's card is as tall as its notes.
              room: scrolls ? room : laid.rows.length,
              lit: focus === 'notes',
            }).map((row, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the card's rows are positional
              <Runs key={i} row={row} />
            ))}
          </>
        ) : null}
      </Box>
      <ScreenKeys width={width} pairs={k.main} foot={k.foot} />
    </Box>
  )
}
