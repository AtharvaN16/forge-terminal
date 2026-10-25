import { homedir } from 'node:os'
import { join } from 'node:path'
import { Box } from 'ink'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { SPINNER_FRAMES } from '../../cli/spinner.js'
import { expandTilde } from '../../config/preferences.js'
import type { Credit } from '../../core/attributions.js'
import { type ForgeError, isForgeError, unexpectedError } from '../../core/errors.js'
import { clockOf } from '../../core/timecode.js'
import { formatBytes } from '../../core/units.js'
import {
  assetFor,
  CATALOG,
  type CatalogEntry,
  machineName,
  offeredOn,
  osName,
  type PlatformKey,
} from '../../extensions/catalog.js'
import type { LockHolder } from '../../extensions/lock.js'
import type { ExtensionStatus } from '../../extensions/manager.js'
import type { OwnableId, OwnCopy } from '../../extensions/own.js'
import { unescapePath } from '../../utils/unescape-path.js'
import type { BarChip } from '../bar-art.js'
import { Runs } from '../components/Home.js'
import { ScreenBar, ScreenKeys } from '../components/MenuPopup.js'
import { errorLine } from '../error-art.js'
import type { Run } from '../home-art.js'
import { HOME_MARGIN } from '../home-art.js'
import { motionEnabled, useTicker } from '../motion.js'
import { type OwnSheetView, ownSheetRows } from '../own-art.js'
import { spaceRows } from '../space-art.js'
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
  /** The user's own copies of yt-dlp and ffmpeg (own.ts). Absent: there are none. */
  own?: OwnManager
  /** What Forge itself takes on disk, for the space box. Absent or undefined: no box. */
  forgeBytes?(): Promise<number | undefined>
}

/** The slice of `src/extensions/own.ts` the sheet needs. */
export interface OwnManager {
  /** The user's copy: the quick look, or "Check this Mac"'s deep one. */
  find(id: OwnableId, deep: boolean): Promise<OwnCopy | undefined>
  /** What the file at `path` is, when it is the tool. */
  probe(id: OwnableId, path: string): Promise<OwnCopy | undefined>
  /** Keeps the file the user pointed to. */
  choose(id: OwnableId, path: string): Promise<void>
  /** Removes Forge's copy once the user's is used; the bytes freed. */
  removeForgeCopy(id: OwnableId): Promise<number>
  /** A newer version of the user's copy; null when it is the latest; undefined when unknown. */
  newer(copy: OwnCopy): Promise<string | null | undefined>
  /** Updates the user's copy the way it was installed. */
  update(copy: OwnCopy, signal: AbortSignal): Promise<void>
}

const realOwn: OwnManager = {
  async find(id, deep) {
    return (await import('../../extensions/own.js')).findOwn(id, { deep })
  },
  async probe(id, path) {
    return (await import('../../extensions/own.js')).probeOwn(id, path)
  },
  async choose(id, path) {
    return (await import('../../extensions/own.js')).setChosenPath(id, path)
  },
  async removeForgeCopy(id) {
    return (await import('../../extensions/own.js')).removeForgeCopy(id)
  },
  async newer(copy) {
    return (await import('../../extensions/own.js')).ownUpdate(copy)
  },
  async update(copy, signal) {
    return (await import('../../extensions/own.js')).updateOwn(copy, { signal })
  },
}

/** Loaded on first use so the shell's start-up never touches `src/extensions/`. */
export const realManager: ExtensionsManager = {
  async list() {
    const all = await (await import('../../extensions/manager.js')).listExtensions()
    // A tool the user may have themselves is listed even where Forge has no
    // download of it yet (ffmpeg on a Mac): the sheet says whether it is theirs.
    const { isOwnable } = await import('../../extensions/own.js')
    const more = CATALOG.filter(
      (entry) =>
        isOwnable(entry.id) &&
        !offeredOn(entry, process.platform) &&
        !all.some((s) => s.entry.id === entry.id),
    ).map((entry): ExtensionStatus => ({ entry, updateAvailable: false, supported: false }))
    const { hideUnneeded } = await import('../../extensions/needed.js')
    return hideUnneeded([...all, ...more])
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
  own: realOwn,
  async forgeBytes() {
    const { installBytes, packageRoot } = await import('../../core/install-size.js')
    const root = await packageRoot()
    return root ? installBytes(root) : undefined
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
  // Off macOS only: no Edit row of its own, it is what lets a HEIC open at all.
  heic: {
    name: 'HEIC photos',
    gives: 'Opens iPhone photos (HEIC)',
    again: 'A HEIC photo will ask for it again.',
    parts: [
      ['libheif and libde265', 'LGPL-3.0'],
      ['libheif-js', 'LGPL-3.0'],
    ],
  },
  // Off macOS only, as heic: what lets a camera RAW photo open at all.
  raw: {
    name: 'Camera RAW photos',
    gives: 'Opens camera RAW photos',
    again: 'A RAW photo will ask for it again.',
    parts: [
      ['LibRaw', 'LGPL-2.1 or CDDL-1.0'],
      ['libraw-wasm', 'ISC'],
      ['Little CMS', 'MIT'],
    ],
  },
  // Transcribe's YouTube links: often the user's own, from Homebrew.
  'yt-dlp': {
    name: 'YouTube links',
    gives: 'Transcribe YouTube videos',
    again: 'A YouTube link will offer to download it again.',
    parts: [['yt-dlp', 'Unlicense']],
  },
  // ffmpeg, for a Mac without Homebrew's: what lets video and sound open at all.
  video: {
    name: 'Video and audio',
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
  // whisper-cli, where Apple's recogniser is not there: what lets transcribe hear at all.
  whisper: {
    name: 'Speech to text',
    gives: 'Transcripts of video and sound, made on this computer',
    again: 'Transcribe will say how to get it again.',
    parts: [['whisper.cpp and ggml', 'MIT']],
  },
}

/**
 * Parts where a tool is a different program off macOS: Remove background is
 * Apple Vision on a Mac, a small model on ONNX Runtime on Windows and Linux.
 */
const PARTS_ELSEWHERE: Record<string, Array<[string, string]>> = {
  'remove-background': [
    ['BiRefNet-lite', 'MIT'],
    ['ONNX Runtime', 'MIT'],
  ],
}

function sheetFor(entry: CatalogEntry, platform: NodeJS.Platform = process.platform) {
  const sheet = SHEETS[entry.id] ?? {
    name: entry.title,
    gives: entry.summary,
    again: `${entry.title} will offer to download it again.`,
    parts: [[entry.licence, '']] as Array<[string, string]>,
  }
  const elsewhere = platform === 'darwin' ? undefined : PARTS_ELSEWHERE[entry.id]
  return elsewhere ? { ...sheet, parts: elsewhere } : sheet
}

/** What an installed tool brought with it, for /about's Attributions: its parts, each doing the tool's job. */
export function extensionCredits(
  entry: CatalogEntry,
  platform: NodeJS.Platform = process.platform,
): Credit[] {
  const sheet = sheetFor(entry, platform)
  return sheet.parts.map(([name, licence]) => ({ name, licence, does: sheet.name }))
}

/** What a Mac needs for the tool, from its builds: Apple Silicon when arm64 is the only one. */
function needsOf(entry: CatalogEntry, platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'darwin') {
    // The chips this OS's builds exist for; a universal build would never be unsupported.
    const chips = (Object.keys(entry.assets) as PlatformKey[])
      .filter((key) => key.startsWith(`${platform}-`))
      .map((key) => key.slice(platform.length + 1))
    return `${osName(platform)} · ${chips.join(' or ')}`
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

/**
 * The tools a user may have themselves, by catalogue id, and what to look
 * for (own.ts). Kept here, not imported, so opening the shell never loads
 * `src/extensions/`.
 */
const OWN_TOOLS: Record<OwnableId, { name: string; binary: string }> = {
  'yt-dlp': { name: 'yt-dlp', binary: 'yt-dlp' },
  video: { name: 'ffmpeg', binary: 'ffmpeg' },
}
const ownable = (id: string): id is OwnableId => id in OWN_TOOLS
/** A path as the user would write it: the home folder as ~. */
const tilde = (path: string) => {
  const home = homedir()
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
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
  /** The rows the menu gives the screen; the list's frame fills them. */
  height?: number
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
  height,
  manager = realManager,
  onError,
  onClose,
  platform = process.platform,
}: ExtensionsFlowProps) {
  const palette = useTheme()
  /** "this Mac", "this PC", "this computer": where `c` looks for the user's own copy. */
  const here = `this ${machineName(platform)}`
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

  /** Forge's own size on disk, measured once (install-size.ts). */
  const [forgeBytes, setForgeBytes] = useState<number>()
  useEffect(() => {
    void manager
      .forgeBytes?.()
      .then((bytes) => {
        if (alive.current && bytes !== undefined) setForgeBytes(bytes)
      })
      .catch(() => {})
  }, [manager])

  /** What Forge knows of each tool the user may have themselves: their copy, a newer version, what removing Forge's copy freed. */
  const [owns, setOwns] = useState<
    Record<string, { copy?: OwnCopy; newer?: string; latest?: boolean; freed?: number }>
  >({})
  /** "Check this Mac" on the current tool: looking, found, or nothing found (the Path field). */
  const [check, setCheck] = useState<
    | { id: OwnableId; phase: 'checking' }
    | { id: OwnableId; phase: 'found'; copy: OwnCopy }
    | { id: OwnableId; phase: 'none' }
  >()
  const [path, setPath] = useState('')
  const [pathError, setPathError] = useState<string>()
  /** The user's copy being updated, and since when (the clock). */
  const [updating, setUpdating] = useState<{ id: string; started: number }>()

  /**
   * The user's copy is used: Forge's own goes (one copy, always), then
   * Homebrew is asked, in the background, whether there is a newer version.
   */
  const adopt = useCallback(
    async (id: OwnableId, copy: OwnCopy | undefined) => {
      const own = manager.own
      if (!own) return
      const freed = copy && !copy.tooOld ? await own.removeForgeCopy(id).catch(() => 0) : 0
      if (!alive.current) return
      setOwns((o) => ({ ...o, [id]: { ...(copy ? { copy } : {}), ...(freed ? { freed } : {}) } }))
      if (freed) void refresh()
      if (!copy) return
      const newer = await own.newer(copy).catch(() => undefined)
      if (newer === undefined || !alive.current) return
      setOwns((o) =>
        o[id]?.copy === copy
          ? { ...o, [id]: { ...o[id], ...(newer === null ? { latest: true } : { newer }) } }
          : o,
      )
    },
    [manager, refresh],
  )

  // Forge looks for the user's own copies by itself, once the list is in.
  const ownIds = (statuses ?? [])
    .map((s) => s.entry.id)
    .filter(ownable)
    .join(',')
  useEffect(() => {
    const own = manager.own
    if (!own || ownIds === '') return
    for (const id of ownIds.split(',') as OwnableId[]) {
      void own
        .find(id, false)
        .then((copy) => adopt(id, copy))
        .catch(() => {})
    }
  }, [ownIds, manager, adopt])

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
      // The same answer as last time is the same state: no redraw, every second, for nothing.
      if (live && alive.current)
        setInUse((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next))
    }
    void look()
    const timer = setInterval(() => void look(), IN_USE_POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [installedIds, manager])

  const current = statuses?.[cursor]
  const spinning =
    (busy !== undefined || updating !== undefined || check?.phase === 'checking') &&
    motionEnabled(palette.name)
  const n = useTicker(spinning, SPIN_MS)
  // The update's clock, a second at a time even with motion off: it is a fact, not an animation.
  useTicker(updating !== undefined, 1000)

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
    setCheck(undefined)
    setPath('')
    setPathError(undefined)
  }

  /** "Check this Mac": the deep look, the spinner while it runs. */
  const lookDeep = async (id: OwnableId) => {
    const own = manager.own
    if (!own) return
    setFailed(undefined)
    setCheck({ id, phase: 'checking' })
    const copy = await own.find(id, true).catch(() => undefined)
    if (!alive.current) return
    setCheck((c) =>
      c?.id === id && c.phase === 'checking'
        ? copy
          ? { id, phase: 'found', copy }
          : { id, phase: 'none' }
        : c,
    )
  }

  /** ↵ use it: kept as the user's choice, then used — Forge's copy goes. */
  const take = async (id: OwnableId, copy: OwnCopy) => {
    const own = manager.own
    if (!own) return
    try {
      await own.choose(id, copy.path)
    } catch (e) {
      fail(e)
      return
    }
    setCheck(undefined)
    setPath('')
    setPathError(undefined)
    await adopt(id, copy)
  }

  /** ↵ on a typed or dropped path: the file, or the tool inside a dropped folder. */
  const takePath = async (id: OwnableId) => {
    const own = manager.own
    if (!own) return
    const raw = expandTilde(unescapePath(path.trim()))
    const copy =
      (await own.probe(id, raw).catch(() => undefined)) ??
      (await own.probe(id, join(raw, OWN_TOOLS[id].binary)).catch(() => undefined))
    if (!alive.current) return
    if (copy === undefined) {
      setPathError(`Nothing there runs as ${OWN_TOOLS[id].name}`)
      return
    }
    await take(id, copy)
  }

  /** ↵ update on the user's copy: the way it was installed, with its clock. */
  const upgrade = async (id: OwnableId, copy: OwnCopy) => {
    const own = manager.own
    if (!own) return
    const controller = new AbortController()
    stop.current = controller
    setFailed(undefined)
    setUpdating({ id, started: Date.now() })
    try {
      await own.update(copy, controller.signal)
      const fresh = await own.probe(id, copy.path).catch(() => undefined)
      if (!alive.current) return
      setUpdating(undefined)
      await adopt(id, fresh ?? copy)
    } catch (e) {
      if (!alive.current) return
      setUpdating(undefined)
      if (!controller.signal.aborted)
        setFailed({
          id,
          title: `Could not update ${OWN_TOOLS[id].name}`,
          reason: e instanceof Error ? e.message : String(e),
        })
    } finally {
      if (stop.current === controller) stop.current = undefined
    }
  }

  const used = current ? inUse[current.entry.id] : undefined
  const removable = current?.installed !== undefined && used === undefined

  useKeys((input, key) => {
    if (busy || updating) {
      if (key.escape) stop.current?.abort()
      return
    }
    // esc goes back one level: the question, then the about panel, then
    // a check (its field), then the screen — even before the list has
    // loaded, or if it never does.
    if (key.escape) {
      if (confirm) setConfirm(false)
      else if (about) setAbout(false)
      else if (check && path !== '') {
        setPath('')
        setPathError(undefined)
      } else if (check) setCheck(undefined)
      else onClose()
      return
    }
    if (!statuses || !current) return
    if (confirm) {
      if (key.return) void remove(current)
      return
    }
    const id = current.entry.id
    if (ownable(id) && manager.own && !about) {
      const mine = owns[id]?.copy
      if (check?.id === id && check.phase === 'checking') return
      if (check?.id === id && check.phase === 'found') {
        if (key.return) void take(id, check.copy)
        else if (key.upArrow) move(-1)
        else if (key.downArrow) move(1)
        return
      }
      if (check?.id === id && check.phase === 'none') {
        // The Path field has the keys: typed or dropped text goes into it.
        if (key.return) {
          if (path.trim() !== '') void takePath(id)
          else if (current.supported && current.installed === undefined) void install(current)
        } else if (key.upArrow) move(-1)
        else if (key.downArrow) move(1)
        else if (key.backspace || key.delete) {
          setPath((t) => t.slice(0, -1))
          setPathError(undefined)
        } else if (input && !key.ctrl && !key.meta && !key.tab) {
          setPath((t) => t + input.replace(/[\r\n]+/g, ''))
          setPathError(undefined)
        }
        return
      }
      if (key.return && mine && (owns[id]?.newer || failed?.id === id)) {
        void upgrade(id, mine)
        return
      }
      // The user's copy is used: there is nothing of Forge's to install.
      if (key.return && mine && !mine.tooOld) return
      if (input === 'c' && !(mine && !mine.tooOld)) {
        void lookDeep(id)
        return
      }
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
    if (busy?.id === s.entry.id || updating?.id === s.entry.id) return spinner
    const mine = owns[s.entry.id]
    if (mine?.copy && !mine.copy.tooOld) return mine.newer ? 'update' : '✓'
    if (s.installed === undefined) return ''
    return s.updateAvailable ? 'update' : '✓'
  }

  const listRow = (s: ExtensionStatus, i: number): ReactNode => {
    const me = i === cursor
    const name = sheetFor(s.entry).name
    const m = mark(s)
    const markColour =
      busy?.id === s.entry.id || updating?.id === s.entry.id ? colourProp(gold) : dim
    return (
      <Box
        key={s.entry.id}
        width={LIST_WIDTH}
        justifyContent="space-between"
        {...(me && palette.listBand !== '' ? { backgroundColor: palette.listBand } : {})}
      >
        <Text wrap="truncate">
          {me ? <Text color={colourProp(gold)}>▌ </Text> : '  '}
          <Text bold={me} color={me ? fg : s.supported || owns[s.entry.id]?.copy ? dim : quiet}>
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

  /** The sheet's own width, inside its rule and padding when split. */
  const room = () => (split ? paneWidth - 3 : paneWidth)

  /**
   * The sheet of a tool the user may have themselves (own-art.ts): header,
   * a card of facts, one other thing — the same three blocks in every state.
   */
  const ownView = (s: ExtensionStatus, id: OwnableId): OwnSheetView => {
    const T = sheetFor(s.entry)
    const tool = OWN_TOOLS[id].name
    const mine = owns[id]
    const run = (text: string, colour = palette.fg, bold = false): Run => ({
      text,
      fg: colour,
      ...(bold ? { bold } : {}),
    })
    const ok = (text: string): Run[] => [run('✓ ', palette.ok), run(text)]
    const spin = (text: string): Run[] => [run(`${spinner} `, gold), run(text, palette.dim)]
    const version = (v: string, newer: string | undefined, latest: boolean): Run[] =>
      newer
        ? [
            run(v, palette.dim),
            run('  →  ', palette.border),
            run(newer, palette.fg, true),
            run(' available', palette.dim),
          ]
        : [run(latest ? `${v} · latest` : v, palette.dim)]
    const size = s.downloadBytes ? `${formatBytes(s.downloadBytes)} download` : undefined
    const installable = s.supported && s.installed === undefined
    const ask: Run[] = [
      run(`Already have ${tool}?  `, palette.dim),
      ...(palette.keycapBg !== ''
        ? [{ text: ' c ', fg: palette.fg, bg: palette.keycapBg, bold: true }]
        : [run('[c]', palette.fg, true)]),
      run(` check ${here}`, palette.dim),
    ]
    const error =
      failed?.id === id
        ? errorLine({
            palette,
            title: failed.title,
            reason: failed.reason,
            width: room(),
            plain: (process.env.NO_COLOR ?? '') !== '',
          })
        : undefined
    const base = { name: T.name, gives: T.gives, tag: tool }

    if (busy?.id === id) {
      const k = busy.total > 0 ? Math.round(Math.min(1, busy.done / busy.total) * BAND) : 0
      const count = byteCount(busy.done, busy.total)
      const band: Run[] =
        palette.track === '' || palette.trackFill === ''
          ? [run(`${'━'.repeat(k)}${'─'.repeat(BAND - k)}`, palette.dim)]
          : [
              { text: ' '.repeat(k), bg: palette.trackFill },
              { text: ' '.repeat(BAND - k), bg: palette.track },
            ]
      const status =
        busy.total > 0 && busy.done >= busy.total
          ? [...band, run('  '), ...spin('checking')]
          : [...band, run('  '), run(count.got, palette.fg, true), run(` ${count.of}`, palette.dim)]
      return { ...base, facts: [['Status', status]] }
    }
    if (updating?.id === id && mine?.copy) {
      const by = mine.copy.homebrew ? 'Homebrew' : tool
      const secs = (Date.now() - updating.started) / 1000
      return {
        ...base,
        facts: [
          ['Status', spin(`Updating with ${by} · ${clockOf(secs)}`)],
          ['Path', [run(tilde(mine.copy.path), palette.dim)]],
          ['Version', [run(mine.copy.version, palette.dim)]],
        ],
      }
    }
    if (check?.id === id && check.phase === 'checking') {
      return {
        ...base,
        action: installable ? '↵ install' : undefined,
        facts: [
          ['Status', spin(`Checking ${here}`)],
          ...(installable && size ? [['Size', [run(size, palette.dim)]] as [string, Run[]]] : []),
        ],
      }
    }
    if (check?.id === id && check.phase === 'found') {
      return {
        ...base,
        action: '↵ use it',
        facts: [
          ['Status', ok(`Found on ${here}`)],
          ['Path', [run(tilde(check.copy.path), palette.dim)]],
          ['Version', [run(check.copy.version, palette.dim)]],
        ],
      }
    }
    if (check?.id === id && check.phase === 'none') {
      return {
        ...base,
        action: path.trim() !== '' ? '↵ use it' : installable ? '↵ install' : undefined,
        facts: [
          ['Status', [run(`Not found on ${here}`)]],
          [
            'Path',
            path === ''
              ? [run('Drop it here, or type it', palette.border)]
              : [run(path, palette.fg)],
          ],
        ],
        field: 'Path',
        under: pathError
          ? errorLine({ palette, title: 'Not found', reason: pathError, width: room() })
          : undefined,
      }
    }
    if (mine?.copy) {
      const c = mine.copy
      return {
        ...base,
        action: mine.newer ? '↵ update' : error ? '↵ try again' : undefined,
        facts: [
          ['Status', c.tooOld ? [run('Too old to use')] : ok('Uses your copy')],
          ['Path', [run(tilde(c.path), palette.dim)]],
          ['Version', version(c.version, mine.newer, mine.latest === true)],
        ],
        under:
          error ??
          (mine.freed
            ? [
                run("Forge's copy removed · ", palette.dim),
                run(formatBytes(mine.freed), palette.fg, true),
                run(' freed', palette.dim),
              ]
            : undefined),
      }
    }
    if (s.installed !== undefined) {
      const newer = s.updateAvailable ? assetFor(s.entry)?.version : undefined
      return {
        ...base,
        action: s.updateAvailable ? '↵ update' : undefined,
        facts: [
          ['Status', ok('Installed')],
          ['Version', version(s.installed, newer, true)],
          ['Size', [run(formatBytes(s.installedBytes ?? s.downloadBytes ?? 0), palette.dim)]],
        ],
        under: error ?? ask,
      }
    }
    return {
      ...base,
      action: error && s.supported ? '↵ try again' : installable ? '↵ install' : undefined,
      facts: [
        ['Status', [run('Not installed')]],
        ...(s.supported && size ? [['Size', [run(size, palette.dim)]] as [string, Run[]]] : []),
      ],
      under: error ?? ask,
    }
  }

  const sheet = (s: ExtensionStatus): ReactNode[] => {
    const id = s.entry.id
    if (ownable(id) && manager.own && !confirm && !about) {
      return ownSheetRows(palette, ownView(s, id), room()).map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the sheet's rows are positional
        <Runs key={i} row={row} />
      ))
    }
    const T = sheetFor(s.entry, platform)
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
          {`Remove it from this ${machineName(platform)}?`}
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
    if (busy || updating) return { main: [['esc', 'stop']], foot: [quit] }
    const s = current
    const id = s?.entry.id
    if (s && id && ownable(id) && manager.own) {
      const back: Array<[string, string]> = [['esc', 'back'], quit]
      if (check?.id === id && check.phase === 'checking')
        return { main: [['esc', 'stop']], foot: [quit] }
      if (check?.id === id && check.phase === 'found')
        return { main: [['↵', 'use it']], foot: back }
      if (check?.id === id && check.phase === 'none') {
        if (path.trim() !== '') return { main: [['↵', 'use it']], foot: [['esc', 'clear'], quit] }
        return {
          main: s.supported && s.installed === undefined ? [['↵', 'install']] : [],
          foot: back,
        }
      }
      const mine = owns[id]
      const main: Array<[string, string]> = [['↑↓', 'choose']]
      if (mine?.copy && (mine.newer || failed?.id === id))
        main.push(['↵', failed?.id === id ? 'try again' : 'update'])
      else if (s.supported && failed?.id === id) main.push(['↵', 'try again'])
      else if (s.supported && s.installed === undefined && !mine?.copy) main.push(['↵', 'install'])
      else if (s.updateAvailable && !mine?.copy) main.push(['↵', 'update'])
      if (!(mine?.copy && !mine.copy.tooOld)) main.push(['c', `check ${here}`])
      if (removable && !mine?.copy) main.push(['x', 'remove'])
      return { main, foot: [['i', 'about'], ['esc', 'back'], quit] }
    }
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

  // The list and the space taken share one frame (round 10, 2026-10-24):
  // the shelf's darker fill, from the sheet's first row to the last row the
  // menu gives it (the menu keeps the row over the field free), the space box
  // its last two rows. Too many tools to fit scroll, the last row saying how
  // many are below, as the / menu's list does.
  const space =
    split && statuses && forgeBytes !== undefined
      ? spaceRows(
          palette,
          forgeBytes,
          statuses.reduce(
            (n, s) => n + (s.installed !== undefined ? (s.installedBytes ?? 0) : 0),
            0,
          ),
          LIST_WIDTH,
        )
      : []
  const frameRows = split && height !== undefined ? height : undefined
  const listRoom =
    frameRows === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(2, frameRows - 1 - (space.length > 0 ? space.length + 1 : 0))
  const all = statuses ?? []
  const scrolls = all.length > listRoom
  const fits = scrolls ? listRoom - 1 : all.length
  const start = scrolls ? Math.min(Math.max(0, cursor - fits + 1), all.length - fits) : 0
  const below = all.length - start - fits
  const listRows = (
    <>
      {all.slice(start, start + fits).map((s, i) => listRow(s, start + i))}
      {scrolls ? (
        <Box width={LIST_WIDTH} justifyContent="flex-end">
          <Text color={quiet}>{below > 0 ? `↓ ${below} more ` : ' '}</Text>
        </Box>
      ) : null}
    </>
  )

  return (
    <Box flexDirection="column" flexGrow={1}>
      <ScreenBar
        chip={extensionsChip(palette)}
        trail={trail}
        width={width}
        drift={busy !== undefined}
      />
      {statuses && current ? (
        <Box flexDirection={split ? 'row' : 'column'} paddingLeft={HOME_MARGIN}>
          {split ? (
            <Box
              flexDirection="column"
              width={LIST_WIDTH}
              flexShrink={0}
              {...(frameRows !== undefined ? { height: frameRows } : {})}
              {...(palette.shelf !== '' ? { backgroundColor: palette.shelf } : {})}
            >
              <Text> </Text>
              {listRows}
              <Box flexGrow={1} />
              {space.length > 0 ? <Text> </Text> : null}
              {space.map((row, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the box's rows are positional
                <Runs key={i} row={row} />
              ))}
            </Box>
          ) : (
            <>
              <Box flexDirection="column" width={LIST_WIDTH} flexShrink={0}>
                {statuses.map(listRow)}
              </Box>
              <Text> </Text>
            </>
          )}
          {/* No rule between list and sheet (2026-10-24): the frame divides them. */}
          <Box
            flexDirection="column"
            width={paneWidth}
            minHeight={statuses.length + 1}
            {...(split ? { marginLeft: 1, paddingLeft: 3 } : {})}
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
      <ScreenKeys width={width} pairs={k.main} foot={k.foot} />
    </Box>
  )
}
