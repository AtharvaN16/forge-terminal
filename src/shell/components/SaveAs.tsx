import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { Box, type DOMElement, Text } from 'ink'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import type { Choice, PathPreset } from '../../core/actions/index.js'
import { useClickTarget } from '../ClickTargets.js'
import { destinationRows, isPathQuery, NO_MATCH } from '../destinations.js'
import type { Row } from '../home-art.js'
import { easeOut, mix, motionEnabled, useTween } from '../motion.js'
import { isStrayEscapeSequence } from '../mouse.js'
import { titleRow } from '../quality-art.js'
import {
  FIELD_WIDTH,
  fieldBlank,
  folderRow,
  listAt,
  SENTENCE_TAIL,
  sentenceRow,
} from '../save-as-art.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, type ShellMode } from '../theme.js'
import { useKeys } from '../useKeys.js'
import { bandFor } from '../width.js'
import { HintBar } from './HintBar.js'
import { Runs } from './Home.js'
import { Prompt } from './Prompt.js'

/** How long a dropped path's flash takes to fade. */
const DROP_FLASH_MS = 450

type Focus = 'name' | 'folder'

/**
 * Save as (P1, mockups/flow-parts-2-2026-10.html tab 7): where the file goes
 * and what it is called, as one answer — `› header.jpg   in  Desktop ▾` in
 * today's filled field.
 *
 * It opens on the name, pre-filled, the caret after it. Tab opens the field
 * downward onto the folders: ↑↓ choose, and the pill in the sentence follows
 * the highlight; typing filters them, or names a place (`~/…`, `/…`, a
 * dropped file to save beside); tab makes the highlighted one the default;
 * esc closes the list and returns to the name. ↵ from either saves with the
 * name and folder as they stand.
 *
 * The folders are `destinationRows`, from the action's own destination spec —
 * never a list of its own (invariant 2).
 */
export function SaveAs({
  mode,
  width,
  name,
  onNameChange,
  proposed,
  ext,
  fixedName,
  folder,
  onFolder,
  presets,
  defaultPath,
  display,
  onMakeDefault,
  onSubmit,
  onBack,
  initialFocus = 'name',
}: {
  mode: ShellMode
  /** The live terminal width. */
  width: number
  /** The name as typed, without its extension. Empty means `proposed`. */
  name: string
  onNameChange: (name: string) => void
  /** The name the action would choose for `folder` (`plan()`), without its extension. */
  proposed: string
  /** Fixed by the target format: shown, never typed. */
  ext: string
  /**
   * In place of a name to edit, when the save writes many files (a document
   * rasterised a page at a time): what they will be called. Save as then
   * opens on the folder, and esc goes back rather than to a name.
   */
  fixedName?: string | undefined
  /** The folder chosen now. */
  folder: string
  /** A different folder has been highlighted: the sentence and the proposal follow it. */
  onFolder: (path: string) => void
  presets: PathPreset[]
  /** The folder saved as the default, so its row can carry the tag. */
  defaultPath: string
  /** A path the way it is shown: `~/Desktop`. */
  display: (path: string) => string
  /** tab on a highlighted folder that is not already the default. */
  onMakeDefault: (path: string) => void
  /** ↵: the folder, and the name as typed (empty means the proposed one). */
  onSubmit: (folder: string, name: string) => void
  /** esc with nothing left to clear. */
  onBack: () => void
  initialFocus?: Focus
}) {
  const palette = useTheme()
  const [focus, setFocus] = useState<Focus>(fixedName ? 'folder' : initialFocus)
  const onFolders = focus === 'folder'
  const noColour = (process.env.NO_COLOR ?? '') !== ''
  const plain = noColour || palette.selectionBg === ''
  const fieldWidth = Math.max(24, Math.min(FIELD_WIDTH, width - 4))
  const showPath = bandFor(width) !== 'compact'

  /**
   * What has been typed to find a folder. `useInput` handlers are synchronous
   * but state is not, so a whole dropped path — and, close behind it, the ↵
   * that saves — can arrive before React re-renders: `queryRef` is what the
   * handlers read; `query` triggers the render.
   */
  const [query, setQuery] = useState('')
  const queryRef = useRef('')
  const setBoth = (next: string) => {
    queryRef.current = next
    setQuery(next)
  }

  // Memoised on the text: a path stats the disk, and a redraw (the drop flash
  // runs ~14 of them) must not stat it again each time.
  const rows = useMemo(
    () => destinationRows(query, presets, defaultPath, display),
    [query, presets, defaultPath, display],
  )
  /** Folders that are not there yet — a save there makes them — are drawn quieter. */
  const missing = useMemo(
    () => new Set(rows.filter((r) => !r.disabled && !existsSync(r.value)).map((r) => r.value)),
    [rows],
  )
  /** The text the list on screen was built from. */
  const drawnQuery = useRef(query)
  drawnQuery.current = query
  const isPath = isPathQuery(query)

  /**
   * Which row is highlighted, kept against the list it was chosen in. A new
   * list (typing changed it) starts on its first row; the places, unfiltered,
   * start on the folder already chosen — and on none if that folder is one
   * the list does not have (a path typed earlier), so the choice stands until
   * ↑↓ moves it.
   */
  const listKey = rows.map((r) => r.value).join('\n')
  const startAt = (list: Choice[], q: string) =>
    q === '' ? list.findIndex((r) => r.value === folder) : list.findIndex((r) => !r.disabled)
  const [highlight, setHighlight] = useState(() => ({ listKey, index: startAt(rows, query) }))
  const index = highlight.listKey === listKey ? highlight.index : startAt(rows, query)
  /** Mirrors `index` for two arrows read in one tick, before React re-renders. */
  const indexRef = useRef(index)
  indexRef.current = index
  const highlighted = index >= 0 ? rows[index] : undefined
  const chosen = highlighted && !highlighted.disabled ? highlighted.value : undefined

  // The sentence, and the name proposed for it, follow the highlight live.
  useEffect(() => {
    if (onFolders && chosen !== undefined && chosen !== folder) onFolder(chosen)
  }, [onFolders, chosen, folder, onFolder])

  /** ↑↓: the next row that can be chosen, stopping at the ends as the pickers do. */
  const move = (delta: number) => {
    const from = indexRef.current
    let i = from === -1 ? (delta > 0 ? 0 : rows.length - 1) : from + delta
    while (i >= 0 && i < rows.length && rows[i]?.disabled) i += delta
    if (i < 0 || i >= rows.length) return
    indexRef.current = i
    setHighlight({ listKey, index: i })
  }

  // A paste is one multi-character chunk; that is what a drop looks like.
  const [droppedAt, setDroppedAt] = useState(0)
  const flash = easeOut(
    useTween(droppedAt, DROP_FLASH_MS, { enabled: droppedAt > 0 && motionEnabled(palette.name) }),
  )
  const pillBg =
    droppedAt > 0 && flash < 1 && !plain ? mix(palette.accent, palette.pill, flash) : undefined

  const save = (path: string) => onSubmit(path, name)
  /** The first row `text` resolves to, for a ↵ that arrived before the list was redrawn. */
  const resolve = (text: string) => {
    const row = destinationRows(text, presets, defaultPath, display)[0]
    if (row && !row.disabled) save(row.value)
  }

  useKeys(
    (input, key) => {
      if (key.return) {
        if (queryRef.current !== drawnQuery.current) resolve(queryRef.current)
        else if (chosen !== undefined) save(chosen)
        else if (query === '') save(folder)
        return
      }
      if (key.escape) {
        if (queryRef.current !== '') setBoth('')
        else if (fixedName) onBack()
        else setFocus('name')
        return
      }
      if (key.upArrow || key.downArrow) {
        move(key.downArrow ? 1 : -1)
        return
      }
      if (key.tab) {
        if (!isPath && chosen !== undefined && chosen !== defaultPath) onMakeDefault(chosen)
        return
      }
      if (key.backspace || key.delete) {
        setBoth(queryRef.current.slice(0, -1))
        return
      }
      // An unhandled Ctrl chord (e.g. Ctrl+N) is not text — without this an
      // unclaimed one would fall through and type its bare letter.
      if (key.ctrl || key.meta || !input) return
      // A DSR reply or a mouse report Ink could not resolve: see mouse.ts.
      if (isStrayEscapeSequence(input)) return
      /**
       * Ink does not split a chunk that holds both text and a line ending: a
       * dropped path with a trailing newline and the terminal's own Enter land
       * as one event whose `input` is `"path\r"`. Everything before the break
       * is the final text, and it saves through the row that text resolves to.
       */
      const breakAt = input.search(/[\r\n]/)
      if (breakAt !== -1) {
        const final = queryRef.current + input.slice(0, breakAt)
        setBoth(final)
        resolve(final)
        return
      }
      if (input.length > 1) setDroppedAt(Date.now())
      setBoth(queryRef.current + input)
    },
    { isActive: onFolders },
  )

  const folderName = (path: string) =>
    presets.find((p) => p.path === path)?.label ?? (basename(path) || path)
  const fill = plain ? undefined : palette.selectionBg
  const pad = plain ? null : <Runs row={fieldBlank({ palette, width: fieldWidth })} />
  const shownName = fixedName ?? (name === '' ? proposed : name)
  const shownExt = fixedName ? '' : ext
  const sentence = sentenceRow({
    palette,
    width: fieldWidth,
    name: shownName,
    ext: shownExt,
    focus,
    folder: onFolders && query !== '' ? query : folderName(chosen ?? folder),
    query: onFolders && query !== '',
    pillBg,
    plain,
  })
  const at = listAt(shownName, shownExt, fieldWidth)

  return (
    <Box flexDirection="column">
      <Runs row={titleRow({ palette, mode, title: 'Save as', width })} />
      <Box marginTop={2} flexDirection="column">
        {pad}
        {onFolders ? (
          <Runs row={sentence} />
        ) : (
          // The name, edited in place: the field's own caret and keys, then
          // the rest of the sentence after the extension.
          <Box width={fieldWidth} {...(fill ? { backgroundColor: fill } : {})}>
            <Text> </Text>
            <Prompt
              value={name}
              onChange={onNameChange}
              onSubmit={(typed) => onSubmit(folder, typed)}
              placeholder={proposed}
              isActive
              variant="inline"
              suffix={ext}
              after={<RunsText row={sentence.slice(SENTENCE_TAIL)} />}
              width={fieldWidth - 1}
              intercept={(_input, key, value) => {
                if (key.tab) {
                  setFocus('folder')
                  return true
                }
                if (key.escape && value === '') {
                  onBack()
                  return true
                }
                return false
              }}
            />
          </Box>
        )}
        {onFolders ? (
          <>
            {pad ?? <Text> </Text>}
            {rows.map((row, i) => (
              <FolderTarget
                key={row.value}
                id={`save-as-folder-${i}`}
                isActive={!row.disabled}
                onClick={() => save(row.value)}
                onHover={() => setHighlight({ listKey, index: i })}
              >
                <Runs
                  row={folderRow({
                    palette,
                    width: fieldWidth,
                    at,
                    label: row.label,
                    path: row.hint ?? '',
                    selected: i === index && !row.disabled,
                    isDefault: row.value === defaultPath && !isPath,
                    quiet: row.value === NO_MATCH || missing.has(row.value),
                    note: row.value === NO_MATCH ? row.hint : undefined,
                    showPath,
                    plain,
                  })}
                />
              </FolderTarget>
            ))}
          </>
        ) : null}
        {pad}
      </Box>
      <HintBar
        width={width}
        pairs={
          onFolders
            ? [
                ['↑↓', 'choose'],
                ['↵', 'save'],
                ['tab', 'make default'],
              ]
            : [
                ['↵', 'save'],
                ['tab', 'folder'],
              ]
        }
        foot={[
          ['esc', onFolders && !fixedName ? 'name' : 'back'],
          ['ctrl-c', 'quit'],
        ]}
      />
    </Box>
  )
}

/** Runs as nested text, for the rest of a line a `Prompt` starts. */
function RunsText({ row }: { row: Row }) {
  return (
    <>
      {row.map((run, i) => (
        <Text
          // biome-ignore lint/suspicious/noArrayIndexKey: a row's runs are positional
          key={i}
          color={colourProp(run.fg ?? '')}
          backgroundColor={colourProp(run.bg ?? '')}
          bold={run.bold ?? false}
        >
          {run.text}
        </Text>
      ))}
    </>
  )
}

/**
 * A folder's row, plus the click region it occupies: a click saves there, a
 * hover highlights it. A component because each row needs its own ref.
 */
function FolderTarget({
  id,
  isActive,
  onClick,
  onHover,
  children,
}: {
  id: string
  isActive: boolean
  onClick: () => void
  onHover: () => void
  children: ReactNode
}) {
  const ref = useRef<DOMElement | null>(null)
  useClickTarget({
    id,
    ref,
    onClick,
    onHover: (hovering) => {
      if (hovering) onHover()
    },
    isActive,
  })
  return <Box ref={ref}>{children}</Box>
}
