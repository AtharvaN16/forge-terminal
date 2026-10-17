import { Box } from 'ink'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { SPINNER_FRAMES } from '../../cli/spinner.js'
import type { Credit } from '../../core/attributions.js'
import { type ForgeError, isForgeError, unexpectedError } from '../../core/errors.js'
import { formatBytes } from '../../core/units.js'
import { assetFor, type CatalogEntry, type PlatformKey } from '../../extensions/catalog.js'
import type { LockHolder } from '../../extensions/lock.js'
import type { ExtensionStatus } from '../../extensions/manager.js'
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

/** The slice of `src/extensions/` this screen needs, injectable so tests need no network and no disk. */
export interface ExtensionsManager {
  list(): Promise<ExtensionStatus[]>
  install(
    id: string,
    opts: { onProgress: (done: number, total: number) => void; signal?: AbortSignal },
  ): Promise<unknown>
  remove(id: string): Promise<boolean>
  /** Who is running the tool right now, in any forge (lock.ts). */
  inUse(id: string): Promise<LockHolder | undefined>
}

/** Loaded on first use so the shell's start-up never touches `src/extensions/`. */
export const realManager: ExtensionsManager = {
  async list() {
    return (await import('../../extensions/manager.js')).listExtensions()
  },
  async install(id, opts) {
    return (await import('../../extensions/manager.js')).installExtension(id, opts)
  },
  async remove(id) {
    return (await import('../../extensions/manager.js')).removeExtension(id)
  },
  async inUse(id) {
    return (await import('../../extensions/lock.js')).extensionInUse(id)
  },
}

/**
 * What the sheet says about each tool, in the shell's words (edit mode's
 * names, not the catalogue ids): what it gives you, what will ask for it
 * again once it is gone, and its parts and licences for `i`. A tool missing
 * here falls back to the catalogue's own title, summary and licence line.
 */
const SHEETS: Record<
  string,
  { name: string; gives: string; again: string; parts: Array<[string, string]> }
> = {
  boost: {
    name: 'Boost resolution',
    gives: 'Sharpen · Boost resolution 2× · 4×',
    again: 'Sharpen and Boost resolution 2× and 4× will offer to download it again.',
    parts: [
      ['Real-ESRGAN general x4v3', 'BSD-3-Clause'],
      ['ONNX Runtime', 'MIT'],
    ],
  },
  'remove-background': {
    name: 'Remove background',
    gives: 'Cutouts, as transparent PNG',
    again: 'Remove background will offer to download it again.',
    parts: [
      ['Apple Vision', 'built into macOS'],
      ['a small helper', 'MIT'],
    ],
  },
  // Windows only: no Edit row of its own, it is what lets a HEIC open at all.
  heic: {
    name: 'HEIC photos',
    gives: 'Opens iPhone photos (HEIC)',
    again: 'A HEIC photo will ask for it again.',
    parts: [
      ['libheif and libde265', 'LGPL-3.0'],
      ['libheif-js', 'LGPL-3.0'],
    ],
  },
  // ffmpeg, for a Mac without Homebrew's: what lets video and sound open at all.
  video: {
    name: 'Video and sound',
    gives: 'Converts, compresses and trims video and sound',
    again: 'A video or sound file will offer to download it again.',
    parts: [
      ['FFmpeg', 'GPL-2.0-or-later'],
      ['x264', 'GPL-2.0-or-later'],
      ['LAME', 'LGPL-2.0-or-later'],
      ['Opus, libogg, libvorbis, libvpx', 'BSD-3-Clause'],
      ['zimg', 'WTFPL'],
    ],
  },
}

function sheetFor(entry: CatalogEntry) {
  return (
    SHEETS[entry.id] ?? {
      name: entry.title,
      gives: entry.summary,
      again: `${entry.title} will offer to download it again.`,
      parts: [[entry.licence, '']] as Array<[string, string]>,
    }
  )
}

/** What an installed tool brought with it, for /about's Attributions: its parts, each doing the tool's job. */
export function extensionCredits(entry: CatalogEntry): Credit[] {
  const sheet = sheetFor(entry)
  return sheet.parts.map(([name, licence]) => ({ name, licence, does: sheet.name }))
}

/** What a Mac needs for the tool, from its builds: Apple Silicon when arm64 is the only one. */
function needsOf(entry: CatalogEntry, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    // The chips Windows builds exist for; a universal build would never be unsupported.
    const chips = (Object.keys(entry.assets) as PlatformKey[])
      .filter((key) => key.startsWith('win32-'))
      .map((key) => key.slice('win32-'.length))
    return `Windows · ${chips.join(' or ')}`
  }
  const silicon =
    entry.assets['darwin-universal'] === undefined && entry.assets['darwin-x64'] === undefined
  return `${silicon ? 'Apple Silicon · ' : ''}macOS ${entry.minMacos}`
}

/** "6.2" and "of 14.9 MB": the bytes so far in the total's own unit, so the two read as one count. */
export function byteCount(done: number, total: number): { got: string; of: string } {
  const of = formatBytes(total)
  const unit = of.split(' ')[1] ?? 'B'
  const scale = unit === 'GB' ? 1e9 : unit === 'MB' ? 1e6 : unit === 'KB' ? 1e3 : 1
  const v = done / scale
  return { got: unit === 'B' || v >= 100 ? String(Math.round(v)) : v.toFixed(1), of: `of ${of}` }
}

/** The menu's gold (K1, round 5), which `/extensions` is drawn in: it is a setting, reached from the menu. */
export function extensionsChip(p: Palette): BarChip {
  return {
    label: 'extensions',
    colour: p.brand,
    stops: modeGradient(p, 'menu'),
  }
}

const LIST_WIDTH = 27
/** The G1 band's length, in cells. */
const BAND = 16
const SPIN_MS = 80
/** How often the screen asks whether another forge has started or finished a job. */
const IN_USE_POLL_MS = 1000

type Busy = { id: string; done: number; total: number }

interface ExtensionsFlowProps {
  width: number
  manager?: ExtensionsManager
  onError: (error: ForgeError) => void
  onClose: () => void
  /** Names the machine in the remove question: "this Mac", "this PC". */
  platform?: NodeJS.Platform
}

/**
 * `/extensions` (M3 trimmed to T2, mockups/extensions-2026-10.html tab 4):
 * names on the left with a quiet mark (✓ on this Mac, "update", the spinner
 * while installing), a sheet on the right with the name, one line of what
 * it gives you, and the one thing to do. `i` puts the parts and licences in
 * the sheet; `x` turns the sheet into the remove question, in place.
 *
 * Every number is real: the band is bytes received of the catalogue's byte
 * count, from `installExtension`'s `onProgress`, then "checking" while the
 * archive is verified — never a percentage. "Frees N" is measured on disk.
 */
export function ExtensionsFlow({
  width,
  manager = realManager,
  onError,
  onClose,
  platform = process.platform,
}: ExtensionsFlowProps) {
  const palette = useTheme()
  const [statuses, setStatuses] = useState<ExtensionStatus[] | undefined>()
  const [cursor, setCursor] = useState(0)
  const [busy, setBusy] = useState<Busy>()
  const [about, setAbout] = useState(false)
  const [confirm, setConfirm] = useState(false)
  /** "✓ Removed · N freed", until the cursor moves. */
  const [freed, setFreed] = useState<{ id: string; bytes: number }>()
  /** A download that failed, said on its sheet as an E5·b row (error-art.ts). */
  const [failed, setFailed] = useState<{ id: string; title: string; reason: string }>()
  const [inUse, setInUse] = useState<Record<string, LockHolder>>({})
  const stop = useRef<AbortController | undefined>(undefined)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      stop.current?.abort()
    }
  }, [])

  const fail = useCallback(
    (e: unknown) => onError(isForgeError(e) ? e : unexpectedError(e)),
    [onError],
  )

  const refresh = useCallback(async () => {
    try {
      const all = await manager.list()
      if (alive.current) setStatuses(all)
    } catch (e) {
      fail(e)
    }
  }, [manager, fail])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Another forge may start or finish a job on a tool at any time.
  const installedIds = (statuses ?? [])
    .filter((s) => s.installed !== undefined)
    .map((s) => s.entry.id)
    .join(',')
  useEffect(() => {
    if (installedIds === '') return
    let live = true
    const look = async () => {
      const next: Record<string, LockHolder> = {}
      for (const id of installedIds.split(',')) {
        const holder = await manager.inUse(id).catch(() => undefined)
        if (holder) next[id] = holder
      }
      if (live && alive.current) setInUse(next)
    }
    void look()
    const timer = setInterval(() => void look(), IN_USE_POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [installedIds, manager])

  const current = statuses?.[cursor]
  const spinning = busy !== undefined && motionEnabled(palette.name)
  const n = useTicker(spinning, SPIN_MS)

  const install = async (s: ExtensionStatus) => {
    const id = s.entry.id
    const controller = new AbortController()
    stop.current = controller
    setFailed(undefined)
    setFreed(undefined)
    setBusy({ id, done: 0, total: s.downloadBytes ?? 0 })
    try {
      await manager.install(id, {
        signal: controller.signal,
        onProgress: (done, total) => {
          if (alive.current) setBusy((b) => (b ? { ...b, done, total } : b))
        },
      })
      await refresh()
      if (alive.current) setBusy(undefined)
    } catch (e) {
      if (!alive.current) return
      setBusy(undefined)
      if (controller.signal.aborted) return
      // A download that failed is said on its own sheet, with a way to try again.
      if (isForgeError(e) && e.code.startsWith('extension-')) {
        setFailed({ id, title: e.title, reason: e.short ?? e.detail.replace(`${id}: `, '') })
      } else fail(e)
    } finally {
      if (stop.current === controller) stop.current = undefined
    }
  }

  const remove = async (s: ExtensionStatus) => {
    setConfirm(false)
    try {
      await manager.remove(s.entry.id)
      if (alive.current) setFreed({ id: s.entry.id, bytes: s.installedBytes ?? 0 })
    } catch (e) {
      // Started a job between the last look and ↵: the sheet says so on the next look.
      if (isForgeError(e) && e.code === 'extension-in-use') {
        const holder = await manager.inUse(s.entry.id).catch(() => undefined)
        if (holder && alive.current) setInUse((u) => ({ ...u, [s.entry.id]: holder }))
      } else fail(e)
    }
    await refresh()
  }

  const move = (delta: number) => {
    if (!statuses) return
    const next = Math.max(0, Math.min(statuses.length - 1, cursor + delta))
    if (next === cursor) return
    setCursor(next)
    setFreed(undefined)
    setAbout(false)
  }

  const used = current ? inUse[current.entry.id] : undefined
  const removable = current?.installed !== undefined && used === undefined

  useKeys((input, key) => {
    if (busy) {
      if (key.escape) stop.current?.abort()
      return
    }
    // esc goes back one level: the question, then the about panel, then
    // the screen — even before the list has loaded, or if it never does.
    if (key.escape) {
      if (confirm) setConfirm(false)
      else if (about) setAbout(false)
      else onClose()
      return
    }
    if (!statuses || !current) return
    if (confirm) {
      if (key.return) void remove(current)
      return
    }
    if (input === 'i') {
      setAbout((a) => !a)
      return
    }
    if (about) return
    if (key.upArrow) move(-1)
    else if (key.downArrow) move(1)
    else if (key.return) {
      if (current.supported && (current.installed === undefined || current.updateAvailable)) {
        void install(current)
      }
    } else if (input === 'x' && removable) {
      setFreed(undefined)
      setConfirm(true)
    }
  })

  const fg = colourProp(palette.fg)
  const dim = colourProp(palette.dim)
  const quiet = colourProp(palette.border)
  const gold = extensionsChip(palette).colour
  const spinner = spinning ? (SPINNER_FRAMES[n % SPINNER_FRAMES.length] ?? '') : '·'

  const installing = statuses?.find((s) => s.entry.id === busy?.id)
  const trail = installing
    ? { answers: [sheetFor(installing.entry).name], current: 'Installing' }
    : confirm
      ? { answers: ['Extensions'], current: 'Remove' }
      : { answers: [] }

  const pill = (text: string) => (
    <Text backgroundColor={colourProp(palette.pill)} color={colourProp(palette.ink)} bold>
      {` ${text} `}
    </Text>
  )

  /** The G1 band: mid grey up to the bytes, dark after. Rules where the palette has no fills. */
  const band = (frac: number) => {
    const k = Math.round(Math.max(0, Math.min(1, frac)) * BAND)
    if (palette.track === '' || palette.trackFill === '') {
      return <Text color={dim}>{`${'━'.repeat(k)}${'─'.repeat(BAND - k)}`}</Text>
    }
    return (
      <Text>
        <Text backgroundColor={colourProp(palette.trackFill)}>{' '.repeat(k)}</Text>
        <Text backgroundColor={colourProp(palette.track)}>{' '.repeat(BAND - k)}</Text>
      </Text>
    )
  }

  /** The list's mark: only what is worth seeing without moving the cursor. */
  const mark = (s: ExtensionStatus): string => {
    if (busy?.id === s.entry.id) return spinner
    if (s.installed === undefined) return ''
    return s.updateAvailable ? 'update' : '✓'
  }

  const listRow = (s: ExtensionStatus, i: number): ReactNode => {
    const me = i === cursor
    const name = sheetFor(s.entry).name
    const m = mark(s)
    const markColour = busy?.id === s.entry.id ? colourProp(gold) : dim
    return (
      <Box
        key={s.entry.id}
        width={LIST_WIDTH}
        justifyContent="space-between"
        {...(me && palette.listBand !== '' ? { backgroundColor: palette.listBand } : {})}
      >
        <Text wrap="truncate">
          {me ? <Text color={colourProp(gold)}>▌ </Text> : '  '}
          <Text bold={me} color={me ? fg : s.supported ? dim : quiet}>
            {name}
          </Text>
        </Text>
        <Text color={markColour}>{m ? `${m} ` : ''}</Text>
      </Box>
    )
  }

  const action = (s: ExtensionStatus): ReactNode => {
    const id = s.entry.id
    const size = formatBytes(s.downloadBytes ?? 0)
    if (busy?.id === id) {
      if (busy.total > 0 && busy.done >= busy.total) {
        return (
          <Text>
            {band(1)}
            <Text color={colourProp(gold)}>{`  ${spinner} `}</Text>
            <Text color={dim}>checking</Text>
          </Text>
        )
      }
      const count = byteCount(busy.done, busy.total)
      return (
        <Text>
          {band(busy.total > 0 ? busy.done / busy.total : 0)}
          {'  '}
          <Text bold color={fg}>
            {count.got}
          </Text>
          <Text color={dim}>{` ${count.of}`}</Text>
        </Text>
      )
    }
    if (!s.supported)
      return <Text color={quiet}>{`Can't install: ${s.reason ?? 'not available'}`}</Text>
    if (failed?.id === id) {
      // The sheet's own width, inside its rule and padding when split.
      const room = split ? paneWidth - 3 : paneWidth
      const plain = (process.env.NO_COLOR ?? '') !== ''
      return (
        <Box flexDirection="column">
          <Runs
            row={errorLine({
              palette,
              title: failed.title,
              reason: failed.reason,
              width: room,
              plain,
            })}
          />
          <Text> </Text>
          <Text>{pill('↵ try again')}</Text>
        </Box>
      )
    }
    if (s.installed === undefined) {
      return (
        <Text>
          {pill('↵ install')}
          <Text color={dim}>{`  ${size}`}</Text>
        </Text>
      )
    }
    if (s.updateAvailable) {
      return (
        <Text>
          {pill('↵ update')}
          <Text color={dim}>{`  ${s.installed} → `}</Text>
          <Text color={fg}>{assetFor(s.entry)?.version}</Text>
        </Text>
      )
    }
    return (
      <Text>
        <Text color={colourProp(palette.ok)}>✓ </Text>
        <Text
          color={dim}
        >{`installed · ${formatBytes(s.installedBytes ?? s.downloadBytes ?? 0)}`}</Text>
      </Text>
    )
  }

  const sheet = (s: ExtensionStatus): ReactNode[] => {
    const T = sheetFor(s.entry)
    const name = (
      <Text bold color={fg}>
        {T.name}
      </Text>
    )
    if (confirm) {
      return [
        name,
        '',
        <Text key="q" bold color={fg}>
          {`Remove it from this ${platform === 'win32' ? 'PC' : 'Mac'}?`}
        </Text>,
        <Text key="f" color={dim}>{`Frees ${formatBytes(s.installedBytes ?? 0)}.`}</Text>,
        <Text key="a" color={quiet}>
          {T.again}
        </Text>,
        '',
        <Text key="k">
          <Text bold color={fg}>
            ↵{' '}
          </Text>
          <Text bold color={colourProp(palette.fail)}>
            remove
          </Text>
          <Text color={quiet}>{'   esc keep'}</Text>
        </Text>,
      ]
    }
    const gives = <Text color={dim}>{T.gives}</Text>
    if (about) {
      const partWidth = Math.max(...T.parts.map(([p]) => p.length)) + 3
      const label = (l: string) => <Text color={quiet}>{l.padEnd(9)}</Text>
      return [
        name,
        gives,
        '',
        ...T.parts.map(([part, licence]) => (
          <Text key={part}>
            <Text color={dim}>{part.padEnd(partWidth)}</Text>
            <Text color={quiet}>{licence}</Text>
          </Text>
        )),
        // T2: the version only when there is a newer one, and what the
        // tool needs only when this Mac falls short of it.
        ...(s.updateAvailable && s.installed !== undefined
          ? [
              <Text key="v">
                {label('version')}
                <Text color={dim}>{`${s.installed} → `}</Text>
                <Text color={fg}>{assetFor(s.entry)?.version}</Text>
              </Text>,
            ]
          : []),
        ...(s.supported
          ? []
          : [
              <Text key="n">
                {label('needs')}
                <Text color={dim}>{needsOf(s.entry)}</Text>
              </Text>,
            ]),
      ]
    }
    const rows: ReactNode[] = [name, gives, '', action(s)]
    if (freed?.id === s.entry.id) {
      rows.push(
        '',
        <Text key="freed">
          <Text color={colourProp(palette.ok)}>✓ </Text>
          <Text color={dim}>{`Removed · ${formatBytes(freed.bytes)} freed`}</Text>
        </Text>,
      )
    }
    const holder = inUse[s.entry.id]
    if (holder && s.installed !== undefined) {
      const where = holder.pid === process.pid ? '' : ' in another window'
      const what = holder.what ? `${holder.what}${where}` : `another forge is running it${where}`
      rows.push(
        '',
        <Text
          key="use"
          color={dim}
        >{`In use: ${what}. It can be removed when that finishes.`}</Text>,
      )
    }
    return rows
  }

  const keys = (): { main: Array<[string, string]>; foot: Array<[string, string]> } => {
    const quit: [string, string] = ['ctrl-c', 'quit']
    if (confirm)
      return {
        main: [
          ['↵', 'remove'],
          ['esc', 'keep'],
        ],
        foot: [quit],
      }
    if (about) return { main: [['i', 'close']], foot: [['esc', 'back'], quit] }
    if (busy) return { main: [['esc', 'stop']], foot: [quit] }
    const s = current
    const main: Array<[string, string]> = [['↑↓', 'choose']]
    if (s?.supported && failed?.id === s.entry.id) main.unshift(['↵', 'try again'])
    else if (s?.supported && s.installed === undefined) main.push(['↵', 'install'])
    else if (s?.updateAvailable) main.push(['↵', 'update'])
    if (removable) main.push(['x', 'remove'])
    return { main, foot: [['i', 'about'], ['esc', 'back'], quit] }
  }

  const split = width >= LIST_WIDTH + 3 + 40
  const paneWidth = Math.max(10, split ? width - HOME_MARGIN - LIST_WIDTH - 2 : width - HOME_MARGIN)
  const k = keys()
  const rows = current ? sheet(current) : []

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginBottom={1}>
        <HeaderBar
          mode="convert"
          chip={extensionsChip(palette)}
          trail={trail}
          width={width}
          drift={busy !== undefined}
        />
      </Box>
      {statuses && current ? (
        <Box flexDirection={split ? 'row' : 'column'} paddingLeft={HOME_MARGIN}>
          <Box flexDirection="column" width={LIST_WIDTH} flexShrink={0}>
            {statuses.map(listRow)}
          </Box>
          {split ? null : <Text> </Text>}
          {/* The rule between list and sheet is the sheet's left border, so it
              runs the sheet's whole height, wrapped lines included. */}
          <Box
            flexDirection="column"
            width={paneWidth}
            minHeight={statuses.length + 1}
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
            {rows.map((row, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the sheet's rows are positional
              <Box key={i}>{typeof row === 'string' ? <Text>{row || ' '}</Text> : row}</Box>
            ))}
          </Box>
        </Box>
      ) : (
        <Box paddingLeft={HOME_MARGIN}>
          <Text color={dim}>Reading the catalogue…</Text>
        </Box>
      )}
      <HintBar width={width} pairs={k.main} foot={k.foot} />
    </Box>
  )
}
