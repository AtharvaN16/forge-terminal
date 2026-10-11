import { Box, Text } from 'ink'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Choice } from '../../core/actions/index.js'
import { type ForgeError, isForgeError, unexpectedError } from '../../core/errors.js'
import { formatBytes } from '../../core/units.js'
import type { ExtensionStatus } from '../../extensions/manager.js'
import { HintBar } from '../components/HintBar.js'
import { Select } from '../components/Select.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'
import { useKeys } from '../useKeys.js'
import { bandFor } from '../width.js'

/** The slice of `src/extensions/manager.ts` this screen needs, injectable so tests need no network. */
export interface ExtensionsManager {
  list(): Promise<ExtensionStatus[]>
  install(id: string, opts: { onProgress: (done: number, total: number) => void }): Promise<unknown>
  remove(id: string): Promise<boolean>
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
}

export function stateOf(s: ExtensionStatus): string {
  if (!s.supported) return s.reason ?? 'not available'
  if (s.installed === undefined) return 'not installed'
  return s.updateAvailable
    ? `update available (installed v${s.installed})`
    : `installed v${s.installed}`
}

function toChoice(s: ExtensionStatus): Choice {
  const size = s.downloadBytes ? `  ${formatBytes(s.downloadBytes)}` : ''
  const choice: Choice = {
    value: s.entry.id,
    label: s.entry.title,
    hint: `${s.entry.summary}${size}`,
    badge: stateOf(s),
  }
  if (!s.supported) {
    choice.disabled = true
    // The reason is the whole point of a disabled row: say it where the hint goes.
    choice.hint = `${s.entry.summary}  ${s.reason ?? ''}`.trim()
  }
  return choice
}

interface ExtensionsFlowProps {
  width: number
  /** Offer mode: show only this extension and report `onInstalled` once it is on disk. */
  only?: string
  manager?: ExtensionsManager
  onInstalled?: (id: string) => void
  onError: (error: ForgeError) => void
  onClose: () => void
}

/**
 * `/extensions`, and the install offer behind "Boost resolution" and
 * "Remove background". Drawn with the picker (`Select`) and `HintBar`; the
 * only thing new is the progress line, and that is real: bytes received over
 * the catalogue's byte count, from `installExtension`'s `onProgress`. When
 * the total is unknown it shows bytes alone, never a made-up percentage.
 */
export function ExtensionsFlow({
  width,
  only,
  manager = realManager,
  onInstalled,
  onError,
  onClose,
}: ExtensionsFlowProps) {
  const palette = useTheme()
  const [statuses, setStatuses] = useState<ExtensionStatus[] | undefined>()
  const [busy, setBusy] = useState<{ id: string; verb: string; done: number; total: number }>()
  const [cursor, setCursor] = useState(0)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const fail = useCallback(
    (e: unknown) => onError(isForgeError(e) ? e : unexpectedError(e)),
    [onError],
  )

  const refresh = useCallback(async () => {
    try {
      const all = await manager.list()
      if (alive.current) setStatuses(only ? all.filter((s) => s.entry.id === only) : all)
      return all
    } catch (e) {
      fail(e)
      return []
    }
  }, [manager, only, fail])

  useEffect(() => {
    void refresh().then((all) => {
      const s = all.find((x) => x.entry.id === only)
      if (s?.installed !== undefined && !s.updateAvailable) onInstalled?.(s.entry.id)
    })
  }, [refresh, only, onInstalled])

  const install = async (s: ExtensionStatus) => {
    const id = s.entry.id
    setBusy({ id, verb: s.installed === undefined ? 'Installing' : 'Updating', done: 0, total: 0 })
    try {
      await manager.install(id, {
        onProgress: (done, total) => {
          if (alive.current) setBusy((b) => (b ? { ...b, done, total } : b))
        },
      })
      await refresh()
      if (alive.current) setBusy(undefined)
      onInstalled?.(id)
    } catch (e) {
      if (alive.current) setBusy(undefined)
      fail(e)
    }
  }

  const remove = async (s: ExtensionStatus) => {
    setBusy({ id: s.entry.id, verb: 'Removing', done: 0, total: 0 })
    try {
      await manager.remove(s.entry.id)
      await refresh()
    } catch (e) {
      fail(e)
    }
    if (alive.current) setBusy(undefined)
  }

  const current = statuses?.[cursor]
  useKeys(
    (input) => {
      if (input === 'x' && current?.installed !== undefined) void remove(current)
    },
    { isActive: busy === undefined && statuses !== undefined && only === undefined },
  )

  const choose = (id: string) => {
    const s = statuses?.find((x) => x.entry.id === id)
    if (s && (s.installed === undefined || s.updateAvailable)) void install(s)
  }

  const band = bandFor(width)
  const dim = colourProp(palette.dim)
  const percent = busy && busy.total > 0 ? ` ${Math.floor((busy.done / busy.total) * 100)}%` : ''
  const bytes =
    busy && busy.done > 0
      ? busy.total > 0
        ? `  ${formatBytes(busy.done)} of ${formatBytes(busy.total)}`
        : `  ${formatBytes(busy.done)}`
      : ''

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={colourProp(palette.label)}>
        {only ? 'Needs an extension — install it?' : 'Extensions'}
      </Text>
      {statuses ? (
        <Select
          width={width}
          items={statuses.map(toChoice)}
          onSubmit={choose}
          onCancel={onClose}
          onHighlight={setCursor}
          isActive={busy === undefined}
          showHints={band !== 'compact'}
        />
      ) : (
        <Text color={dim}>Reading the catalogue…</Text>
      )}
      {busy ? <Text color={dim}>{`${busy.verb}${percent}${bytes}`}</Text> : null}
      <HintBar
        width={width}
        pairs={[
          ['↑↓', 'choose'],
          ['↵', 'install or update'],
          ...(only ? [] : ([['x', 'remove']] as Array<[string, string]>)),
          ['esc', 'close'],
        ]}
      />
    </Box>
  )
}
