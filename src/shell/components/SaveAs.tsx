import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Box, type DOMElement, type Key } from 'ink'
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import stringWidth from 'string-width'
import { NEW_SUBFOLDER } from '../../core/actions/destination.js'
import type { Choice, PathPreset } from '../../core/actions/index.js'
import { displayName } from '../../utils/display-path.js'
import { useClickTarget } from '../ClickTargets.js'
import { completePath, isFolderCompletion } from '../complete.js'
import { destinationRows, isPathQuery, NO_MATCH } from '../destinations.js'
import { easeOut, mix, motionEnabled, useTween } from '../motion.js'
import { isStrayEscapeSequence } from '../mouse.js'
import {
  edgeColour,
  FIELD_WIDTH,
  fieldRow,
  filesRow,
  folderRow,
  NAME_WIDTH,
  newFolderRow,
  type PathLine,
  pathRow,
  ruleRow,
  tagEnd,
  underlineRow,
} from '../save-as-art.js'
import { Text } from '../Text.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, type ShellMode } from '../theme.js'
import { useKeys } from '../useKeys.js'
import { bandFor } from '../width.js'
import { HintBar } from './HintBar.js'
import { Runs } from './Home.js'
import { Prompt } from './Prompt.js'
import { StepTitle } from './StepTitle.js'

/**
 * Where the highlight is: a folder, by its path — so it stays put when the
 * list reorders (making a folder the default moves it to the top) — or the
 * path row, or nowhere (a folder the list does not have).
 */
const PATH_ROW = Symbol('path row')
type At = string | typeof PATH_ROW | null

/**
 * Motion: a dropped folder lights the path row in the mode's colour, fading
 * back over DROP_MS. The highlight and the default's tag move at once — they
 * used to glide (M3), and the fade between rows read as ghosting.
 */
const DROP_MS = 450

/** What `/` names a new folder at first: `converted`, or the next one free in `parent`. */
function freeName(parent: string): string {
  let name = 'converted'
  for (let n = 2; existsSync(join(parent, name)); n++) name = `converted ${n}`
  return name
}

/** A new folder's name as typed: no slash, which would make it two folders, and no line breaks. */
const folderText = (input: string) =>
  input.replace(process.platform === 'win32' ? /[\\/\r\n:*?"<>|]/g : /[/\r\n]/g, '')

/**
 * Save as (V10c, mockups/round-5-2026-10.html): where the file goes and what
 * it is called, in one block. The name sits at the top, filled and
 * underlined, the caret in it; the folders are listed under a rule.
 *
 * Typing edits the name. ↑↓ move through the folders while the caret stays
 * in the name, so ↵ never skips a choice nobody saw; tab makes the
 * highlighted folder the default. ↓ past the last folder reaches the path
 * row: typing there names a place (`~/…`, `/…`) — the rest of a matching
 * folder shown dim, tab taking it — or narrows the folders by name. A drop
 * anywhere lands on that row. ↵ saves with the name and folder as they stand.
 *
 * `/` on a folder opens a row under it naming a new folder inside it —
 * `converted`, or the next one free — said "new folder" while no folder of
 * that name is there. Typing goes to it; ↵ saves into it, made as the file is
 * written; esc clears the name, and a second esc closes it. A slash cannot
 * be in a file name, so the name loses nothing to the key.
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
  aside,
  lastPath,
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
   * rasterised a page at a time): what they will be called. The name row
   * then says so, and esc goes straight back.
   */
  fixedName?: string | undefined
  /** The folder chosen now. */
  folder: string
  /** A different folder has been highlighted: the proposal follows it. */
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
  /** What the save will do, quiet at the title's right: "Rotate 90°". */
  aside?: string | undefined
  /** Where the last file was saved, so its row can say so. */
  lastPath?: string | undefined
}) {
  const palette = useTheme()
  const noColour = (process.env.NO_COLOR ?? '') !== ''
  const plain = noColour || palette.selectionBg === ''
  const fieldWidth = Math.max(24, Math.min(FIELD_WIDTH, width - 4))
  const showPath = bandFor(width) !== 'compact'

  /**
   * What is on the path row. `useInput` handlers are synchronous but state is
   * not, so a whole dropped path — and, close behind it, the ↵ that saves —
   * can arrive before React re-renders: `pathRef` is what the handlers read;
   * `path` triggers the render. `dropped` is whether it arrived in one piece.
   */
  const [path, setPath] = useState('')
  const pathRef = useRef('')
  const [dropped, setDropped] = useState(false)
  /** Counts drops, so each one lights the path row afresh. */
  const [drops, setDrops] = useState(0)
  const setBoth = (next: string, drop = false) => {
    pathRef.current = next
    setPath(next)
    setDropped(drop)
    if (drop) setDrops((n) => n + 1)
  }

  const isPath = isPathQuery(path)
  // Text that is not a path narrows the folders by name.
  const filter = path !== '' && !isPath ? path : ''
  // Memoised on the text: a path stats the disk, and a redraw must not stat it again.
  const folders = useMemo(
    () =>
      destinationRows(filter, presets, defaultPath, display).filter((r) => r.value !== NO_MATCH),
    [filter, presets, defaultPath, display],
  )
  const place = useMemo(
    () => (isPath ? destinationRows(path, presets, defaultPath, display)[0] : undefined),
    [isPath, path, presets, defaultPath, display],
  )
  const placeMissing = useMemo(() => (place ? !existsSync(place.value) : false), [place])

  /** Where the highlight is. It starts on the folder already chosen, or on none. */
  const [at, setAt] = useState<At>(() => (presets.some((p) => p.path === folder) ? folder : null))
  /** Mirrors `at` for keys read in one tick, before React re-renders. */
  const atRef = useRef<At>(at)
  atRef.current = at
  const go = (next: At) => {
    atRef.current = next
    setAt(next)
  }
  const onPath = at === PATH_ROW
  const index = folders.findIndex((r) => r.value === at)
  const chosen: string | undefined = onPath
    ? filter
      ? folders[0]?.value
      : place && !place.disabled
        ? place.value
        : undefined
    : folders[index]?.value

  // The proposal follows the highlight live.
  useEffect(() => {
    if (chosen !== undefined && chosen !== folder) onFolder(chosen)
  }, [chosen, folder, onFolder])

  /** ↑↓: through the folders, then onto the path row; stopping at the ends. */
  const move = (delta: number) => {
    const from = atRef.current
    if (from === PATH_ROW) {
      const last = folders[folders.length - 1]
      if (delta < 0 && last) {
        // A filter belongs to the path row; leaving it lets the list go.
        if (pathRef.current !== '' && !isPathQuery(pathRef.current)) setBoth('')
        go(last.value)
      }
      return
    }
    const i = folders.findIndex((r) => r.value === from)
    const next = i === -1 ? (delta > 0 ? 0 : -1) : i + delta
    if (next < 0) return
    go(folders[next]?.value ?? PATH_ROW)
  }

  /** The rest of a folder matching a typed path, for tab; none for a drop. */
  const [ghost, setGhost] = useState('')
  useEffect(() => {
    setGhost('')
    if (!onPath || !isPath || dropped) return
    let live = true
    void completePath(path).then((found) => {
      if (!live || pathRef.current !== path) return
      const next = found.find(
        (c) => isFolderCompletion(c.insert) && c.insert.startsWith(path) && c.insert !== path,
      )
      setGhost(next ? next.insert.slice(path.length) : '')
    })
    return () => {
      live = false
    }
  }, [onPath, isPath, dropped, path])

  const save = (to: string) => onSubmit(to, name)
  /** Where `text` saves to, for a ↵ that arrived before the list was redrawn. */
  const resolve = (text: string) => {
    if (isPathQuery(text)) {
      const row = destinationRows(text, presets, defaultPath, display)[0]
      if (row && !row.disabled) save(row.value)
      return
    }
    const hit = destinationRows(text, presets, defaultPath, display)[0]
    if (hit && !hit.disabled) save(hit.value)
  }
  /** The text the screen on show was drawn from. */
  const drawnPath = useRef(path)
  drawnPath.current = path

  /**
   * A new folder being named under `parent` (`/`). Mirrored in a ref, as the
   * path is: a ↵ can arrive in the same tick as the last letter.
   */
  const [making, setMakingState] = useState<{ parent: string; name: string } | null>(null)
  const makingRef = useRef(making)
  const setMaking = (next: { parent: string; name: string } | null) => {
    makingRef.current = next
    setMakingState(next)
  }
  /** A folder `/` can make a new folder in: any listed one but New subfolder, itself a new one. */
  const canMake = (here: At): here is string =>
    typeof here === 'string' && folders.some((r) => r.value === here && r.label !== NEW_SUBFOLDER)
  const startNew = (): boolean => {
    const here = atRef.current
    if (!canMake(here)) return false
    setMaking({ parent: here, name: freeName(here) })
    return true
  }
  /** Keys while a new folder is being named: the name takes the typing. */
  const makingKey = (input: string, key: Key) => {
    const m = makingRef.current
    if (!m) return
    if (key.return) {
      const folderName = m.name.trim()
      if (folderName !== '') save(join(m.parent, folderName))
      return
    }
    // esc clears the name; on an empty one, closes the row.
    if (key.escape) {
      setMaking(m.name === '' ? null : { ...m, name: '' })
      return
    }
    if (key.backspace || key.delete) {
      setMaking({ ...m, name: Array.from(m.name).slice(0, -1).join('') })
      return
    }
    if (key.ctrl || key.meta || key.tab || key.upArrow || key.downArrow || !input) return
    const typed = folderText(input)
    if (typed) setMaking({ ...m, name: m.name + typed })
  }
  const newIsNew = useMemo(
    () =>
      making !== null &&
      making.name.trim() !== '' &&
      !existsSync(join(making.parent, making.name.trim())),
    [making],
  )

  const makeDefault = () => {
    const row = folders.find((r) => r.value === atRef.current)
    if (row && row.value !== defaultPath) onMakeDefault(row.value)
  }

  /**
   * Text that arrived in one piece — what a drop is. Ink does not split a
   * chunk that holds both text and a line ending: a dropped path with a
   * trailing newline and the terminal's own Enter land as one event. Before
   * the break is the path, and it saves through the place it names.
   */
  const take = (input: string) => {
    const breakAt = input.search(/[\r\n]/)
    const text = breakAt === -1 ? input : input.slice(0, breakAt)
    const next = pathRef.current + text
    setBoth(next, text.length > 1)
    go(PATH_ROW)
    if (breakAt !== -1) resolve(next)
  }

  /**
   * ↵ on the path row. A drop can move the highlight there and its ↵ arrive
   * before a redraw — to whichever field held the keys — so this reads the
   * refs, never the render's `chosen`.
   */
  const enterPath = () => {
    if (pathRef.current !== drawnPath.current) resolve(pathRef.current)
    else if (chosen !== undefined) save(chosen)
  }

  // The path row, and the folders when there is no name to hold the keys.
  useKeys(
    (input, key) => {
      if (isStrayEscapeSequence(input)) return
      if (makingRef.current) {
        makingKey(input, key)
        return
      }
      const here = atRef.current
      if (key.return) {
        if (here === PATH_ROW) enterPath()
        else save(chosen ?? folder)
        return
      }
      if (key.escape) {
        if (here === PATH_ROW && pathRef.current !== '') setBoth('')
        else if (here === PATH_ROW) move(-1)
        else onBack()
        return
      }
      if (key.upArrow || key.downArrow) {
        move(key.downArrow ? 1 : -1)
        return
      }
      if (key.tab) {
        if (here === PATH_ROW && ghost) setBoth(pathRef.current + ghost)
        else makeDefault()
        return
      }
      if (key.backspace || key.delete) {
        if (here === PATH_ROW) setBoth(pathRef.current.slice(0, -1))
        return
      }
      // An unhandled Ctrl chord (e.g. Ctrl+N) is not text.
      if (key.ctrl || key.meta || !input) return
      if (input === '/' && here !== PATH_ROW && startNew()) return
      take(input)
    },
    { isActive: onPath || fixedName !== undefined || making !== null },
  )

  const nameFocus = !onPath && fixedName === undefined && making === null
  const fill = plain ? undefined : palette.selectionBg
  const edge = edgeColour(palette, plain)
  const tint = plain ? undefined : colourProp(palette.band)
  const blank = <Runs row={fieldRow({ palette, width: fieldWidth, plain })} />

  const line: PathLine = (() => {
    if (path === '') return onPath ? { kind: 'empty' } : { kind: 'rest' }
    if (place && dropped && !placeMissing) {
      return {
        kind: 'place',
        label:
          place.label === 'Use this folder' ? displayName(place.value) || place.value : place.label,
        path: display(place.value),
        highlighted: onPath,
      }
    }
    return {
      kind: 'typing',
      text: path,
      ghost: onPath ? ghost : '',
      note: filter
        ? folders.length === 0
          ? 'nomatch'
          : undefined
        : onPath && ghost
          ? 'complete'
          : placeMissing
            ? 'new'
            : undefined,
      highlighted: onPath,
    }
  })()

  const keys: Array<[string, string]> = making
    ? making.name.trim() === ''
      ? []
      : [['↵', 'create and save']]
    : !onPath
      ? [
          ['↵', 'save'],
          ['↑↓', 'folder'],
          ['tab', 'make default'],
        ]
      : path === '' || (filter && folders.length === 0)
        ? [['↑', 'folders']]
        : placeMissing && !filter
          ? [
              ['↵', 'create and save'],
              ['↑', 'folders'],
            ]
          : [
              ['↵', 'save here'],
              ...(ghost ? [['tab', 'complete'] as [string, string]] : []),
              ['↑', 'folders'],
            ]
  const foot: Array<[string, string]> = making
    ? [['ctrl-c', 'quit']]
    : [
        ['esc', onPath && path !== '' ? 'clear path' : 'back'],
        ['ctrl-c', 'quit'],
      ]

  const moving = motionEnabled(palette.name)
  // The list as it rests: the folders, then the path row.
  const list = [
    ...folders.map((row: Choice, i) =>
      folderRow({
        palette,
        width: fieldWidth,
        first: i === 0,
        label: row.label,
        path: row.hint ?? '',
        selected: !onPath && making === null && i === index,
        isDefault: row.value === defaultPath,
        isLast: row.value === lastPath,
        showPath,
        plain,
      }),
    ),
    pathRow({ palette, width: fieldWidth, line, first: folders.length === 0, showPath, plain }),
  ]
  const lit = 1 - easeOut(useTween(drops, DROP_MS, { enabled: moving }))
  const shown =
    lit > 0 && dropped
      ? list.map((row, i) =>
          i === list.length - 1
            ? row.map((run, j) =>
                j > 0 && run.bg === palette.fieldBand
                  ? { ...run, bg: mix(palette.fieldBand, palette.accent, 0.55 * lit) }
                  : run,
              )
            : row,
        )
      : list

  return (
    <Box flexDirection="column" flexGrow={1}>
      <StepTitle mode={mode} title="Save as" aside={aside} width={width} />
      <Box marginTop={2} flexDirection="column">
        {blank}
        {fixedName !== undefined ? (
          <Runs row={filesRow({ palette, width: fieldWidth, names: fixedName, plain })} />
        ) : (
          <Box width={fieldWidth}>
            <Text backgroundColor={edge} color={colourProp(palette.border)}>
              {edge ? ' ' : '│'}
            </Text>
            <Text backgroundColor={fill} color={colourProp(palette.border)}>
              {'  name    '}
            </Text>
            <Box width={NAME_WIDTH} {...(tint ? { backgroundColor: tint } : {})}>
              <Text> </Text>
              <Prompt
                value={name}
                onChange={onNameChange}
                onSubmit={(typed) => onSubmit(chosen ?? folder, typed)}
                placeholder={proposed}
                isActive={nameFocus}
                variant="inline"
                marker={false}
                width={NAME_WIDTH - 1}
                intercept={(input, key, value) => {
                  if (key.upArrow || key.downArrow) {
                    move(key.downArrow ? 1 : -1)
                    return true
                  }
                  if (key.tab) {
                    makeDefault()
                    return true
                  }
                  if (key.return) {
                    if (atRef.current === PATH_ROW) enterPath()
                    else onSubmit(chosen ?? folder, value)
                    return true
                  }
                  if (key.escape && value === '') {
                    onBack()
                    return true
                  }
                  // `/`: a new folder in the highlighted one. A file name has no slash.
                  if (input === '/' && startNew()) return true
                  // A drop: a path arriving in one piece goes to the path row.
                  if (input.length > 1 && isPathQuery(input.split(/[\r\n]/)[0] ?? '')) {
                    take(input)
                    return true
                  }
                  return false
                }}
              />
            </Box>
            <Box flexGrow={1} {...(fill ? { backgroundColor: fill } : {})}>
              <Text color={colourProp(palette.border)}>{` ${ext}`}</Text>
            </Box>
          </Box>
        )}
        {fixedName !== undefined ? (
          blank
        ) : (
          <Runs row={underlineRow({ palette, width: fieldWidth, plain })} />
        )}
        <Runs row={ruleRow({ palette, width: fieldWidth, plain })} />
        {blank}
        {folders.map((row: Choice, i) => (
          <Fragment key={row.value}>
            <FolderTarget
              id={`save-as-folder-${i}`}
              isActive
              onClick={() => save(row.value)}
              onHover={() => go(row.value)}
            >
              <Runs row={shown[i] ?? []} />
            </FolderTarget>
            {making?.parent === row.value ? (
              <Runs
                row={newFolderRow({
                  palette,
                  width: fieldWidth,
                  name: making.name,
                  isNew: newIsNew,
                  plain,
                })}
              />
            ) : null}
          </Fragment>
        ))}
        <FolderTarget id="save-as-path" isActive onClick={() => go(PATH_ROW)} onHover={() => {}}>
          <Runs row={shown[folders.length] ?? []} />
        </FolderTarget>
        {blank}
      </Box>
      <UnderKeys
        pairs={
          making !== null
            ? [['esc', making.name === '' ? 'close' : 'clear']]
            : !onPath && canMake(at)
              ? [['/', 'new folder']]
              : []
        }
        end={tagEnd(fieldWidth)}
      />
      <HintBar width={width} pairs={keys} foot={foot} />
    </Box>
  )
}

/**
 * Keys that belong to the highlighted row ("/ new folder", "esc clear"), on
 * the row under the block, ending at column `end` — where the tags do.
 * Uncapped, in the mode's colour, so they read as the block's, not the key
 * row's. The row is kept when there are none, so nothing below it moves.
 */
function UnderKeys({ pairs, end }: { pairs: Array<[string, string]>; end: number }) {
  const palette = useTheme()
  const used = pairs.reduce(
    (n, [key, word], i) => n + (i ? 2 : 0) + stringWidth(`${key} ${word}`),
    0,
  )
  return (
    <Text wrap="truncate" color={colourProp(palette.accent)}>
      {' '.repeat(Math.max(0, end - used))}
      {pairs.map(([key, word], i) => (
        <Text key={key}>
          {i ? '  ' : ''}
          <Text bold>{key}</Text>
          {` ${word}`}
        </Text>
      ))}
    </Text>
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
