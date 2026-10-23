import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Box } from 'ink'
import { useEffect, useMemo, useRef, useState } from 'react'
import stringWidth from 'string-width'
import { expandTilde } from '../../config/preferences.js'
import type { Result } from '../../core/types.js'
import { displayName, displayPath } from '../../utils/display-path.js'
import { lastSegment } from '../../utils/last-segment.js'
import type { Trail } from '../bar-art.js'
import { windowOver } from '../colour/system-art.js'
import { completePath, isFolderCompletion } from '../complete.js'
import { destinationRows, isPathQuery } from '../destinations.js'
import { doneBody, doneLayout } from '../done-art.js'
import { blank, type Row } from '../home-art.js'
import { isStrayEscapeSequence } from '../mouse.js'
import {
  edgeColour,
  fieldBlank,
  fieldRow,
  folderRow,
  type Labels,
  label,
  NAME_WIDTH,
  newFolderRow,
  type PathLine,
  padTo,
  pathRow,
  ruleRow,
  underlineRow,
} from '../save-as-art.js'
import { useTheme } from '../ThemeContext.js'
import type { ShellMode } from '../theme.js'
import { useKeys } from '../useKeys.js'
import { bandFor } from '../width.js'
import { doneFacts } from './Done.js'
import { HeaderBar } from './HeaderBar.js'
import { KeyRow, KeyRule, Runs } from './Home.js'

/**
 * Done's rows between the header and the rule, as a window covers them: the
 * same body where Done puts it — the chain on its strip — so the window opens
 * over the screen it came from.
 */
export function doneUnder(
  palette: ReturnType<typeof useTheme>,
  result: Result,
  mode: ShellMode,
  width: number,
  height: number,
  links?: DoneLinks,
): Row[] {
  const area = height - 3
  const facts = doneFacts(result, mode)
  // Compact where Done is: a screen too short for the body and its buttons.
  const roomy = doneBody({ palette, facts, width, links })
  const body =
    4 + roomy.length + 1 > height
      ? doneBody({ palette, facts, width, links, compact: true })
      : roomy
  const { top } = doneLayout({ height, body: body.length, notes: 0 })
  const under: Row[] = [[], ...Array.from({ length: top }, (): Row => []), ...body]
  while (under.length < area) under.push([])
  return under.slice(0, area)
}

/** The chain Done's strip says (C1): what Save as preset keeps. */
export type DoneLinks = { source: string; steps: readonly string[]; slot: boolean }

/** A place a preset can save to: a folder (`~` unexpanded), `same`, or `ask`. */
export interface PresetFolder {
  label: string
  value: string
  /** Shown on the highlighted row, as Save as shows a folder's path. */
  path?: string | undefined
}

const WINDOW_WIDTH = 68

/**
 * "preset name", "save files to": each no wider than eight, run over two
 * lines, with room after — so a label never reads as one of the folders.
 */
const LABELS: Labels = { width: 10, to: ['save', 'files to'] }
const NAME_LABEL = ['preset', 'name']

/** The folder `value` names, made absolute: what two rows are compared by. */
const folderOf = (value: string) => resolve(expandTilde(value))

/** Named the way Save as names a folder: Desktop and Downloads by name, the rest by their last part. */
function folderLabel(value: string): string {
  const at = folderOf(value)
  if (at === folderOf('~/Desktop')) return 'Desktop'
  if (at === folderOf('~/Downloads')) return 'Downloads'
  return lastSegment(at) || at
}

/**
 * The places Save as preset lists: the default first, then Desktop, Same
 * location, Downloads and Ask each time — the default's own folder listed
 * once, however it is written (`~/Desktop` or `/Users/…/Desktop`), as Save
 * as lists it once.
 */
export function presetFolders(defaultOutput: string): PresetFolder[] {
  const named = (value: string): PresetFolder => ({
    label: folderLabel(value),
    value,
    path: displayPath(folderOf(value)),
  })
  const seen = new Set<string>()
  return [
    named(defaultOutput),
    named('~/Desktop'),
    { label: 'Same location', value: 'same' },
    named('~/Downloads'),
    { label: 'Ask each time', value: 'ask' },
  ].filter((f) => {
    if (f.path === undefined) return true
    const at = folderOf(f.value)
    if (seen.has(at)) return false
    seen.add(at)
    return true
  })
}

/**
 * Where the highlight is: a folder, by the folder it names — so it stays put
 * when the list reorders (making a folder the default moves it to the top) —
 * or the path row.
 */
const PATH_ROW = Symbol('path row')
type At = string | typeof PATH_ROW
/** What a row is known by: the folder it names, or `same` / `ask`. */
const keyOf = (f: PresetFolder) => (f.path === undefined ? f.value : folderOf(f.value))

/** A path the way it is shown: `~/Desktop`. */
const display = (path: string) => displayPath(folderOf(path))

/**
 * Save as preset (round 9): the centred window over Done, holding Save as's
 * own block — the name on the mode's tint, underlined, a rule, the folders
 * with the default tagged, the path row. ↑↓ move the folders while the name
 * keeps the caret, `/` names a new folder inside the highlighted one, as in
 * Save as, and tab makes the highlighted folder the default, as there too.
 * ↓ past the last folder reaches the path row, as in Save as:
 * typing there names a place — tab taking the rest of a matching folder — or
 * narrows the folders by name, and a drop anywhere lands on it. Its coloured
 * edge is left out: the window's frame is the edge.
 */
export function PresetSaveScreen({
  mode,
  trail,
  result,
  width,
  height,
  name: initialName,
  taken,
  folders,
  defaultValue,
  onSave,
  onMakeDefault,
  onCancel,
  links,
}: {
  mode: ShellMode
  trail: Trail
  result: Result
  /**
   * The chain being saved (decided, mockups/presets-ux-2026-10-round10.html):
   * shown first, in a block on the grey of Done's buttons, so what is named
   * is in sight.
   */
  links?: DoneLinks | undefined
  width: number
  height: number
  /** The name the field opens with: empty, or the preset being updated. */
  name: string
  /** Names already saved; one of them cannot be saved over from here. */
  taken: string[]
  folders: PresetFolder[]
  defaultValue: string
  onSave: (preset: { name: string; saveTo: string }) => void
  /** tab on a highlighted folder that is not already the default: its absolute path. */
  onMakeDefault: (path: string) => void
  onCancel: () => void
}) {
  const palette = useTheme()
  const [name, setName] = useState(initialName)
  const [making, setMaking] = useState<string | null>(null)
  const isTaken = taken.includes(name)

  /**
   * What is on the path row. Keys are read in one tick, before React
   * re-renders — a dropped path and the ↵ behind it can land together — so
   * the handlers read `pathRef`; `path` draws. `dropped`: it came in one piece.
   */
  const [path, setPathState] = useState('')
  const pathRef = useRef('')
  const [dropped, setDropped] = useState(false)
  const setPath = (next: string, drop = false) => {
    pathRef.current = next
    setPathState(next)
    setDropped(drop)
  }
  const isPath = isPathQuery(path)
  // Text that is not a path narrows the folders by name.
  const filter = path !== '' && !isPath ? path.toLowerCase() : ''
  const shown = filter ? folders.filter((f) => f.label.toLowerCase().includes(filter)) : folders
  const place = useMemo(
    () => (isPath ? destinationRows(path, [], '', display)[0] : undefined),
    [isPath, path],
  )
  const placeMissing = useMemo(
    () => (place ? !existsSync(expandTilde(place.value)) : false),
    [place],
  )

  const [at, setAt] = useState<At>(() => (folders[0] ? keyOf(folders[0]) : PATH_ROW))
  const atRef = useRef<At>(at)
  atRef.current = at
  const go = (next: At) => {
    atRef.current = next
    setAt(next)
  }
  const onPath = at === PATH_ROW
  const index = shown.findIndex((f) => keyOf(f) === at)
  const folder = shown[index]
  const isDefault = (f: PresetFolder) =>
    f.path !== undefined && folderOf(f.value) === folderOf(defaultValue)

  /** ↑↓: through the folders, then onto the path row; stopping at the ends. */
  const move = (delta: number) => {
    const from = atRef.current
    if (from === PATH_ROW) {
      if (delta > 0) return
      // A filter belongs to the path row; leaving it lets the list go.
      const narrowed = pathRef.current !== '' && !isPathQuery(pathRef.current)
      if (narrowed) setPath('')
      const last = (narrowed ? folders : shown).at(-1)
      if (last) go(keyOf(last))
      return
    }
    const i = shown.findIndex((f) => keyOf(f) === from)
    const next = i === -1 ? (delta > 0 ? 0 : -1) : i + delta
    if (next < 0) return
    const to = shown[next]
    go(to ? keyOf(to) : PATH_ROW)
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

  const save = (saveTo: string) => {
    if (name !== '' && !isTaken) onSave({ name, saveTo })
  }
  /** ↵ on the path row: the place typed — a dropped file's folder — or the first folder it narrows to. */
  const savePath = (text: string) => {
    if (isPathQuery(text)) {
      const row = destinationRows(text, [], '', display)[0]
      if (row) save(folderOf(row.value))
      return
    }
    const hit = folders.find((f) => f.label.toLowerCase().includes(text.toLowerCase()))
    if (text !== '' && hit) save(hit.value)
  }

  /**
   * Text that arrived in one piece is a drop. Ink does not split a chunk that
   * holds both text and a line ending: a dropped path and the terminal's own
   * Enter land as one event, and the path saves.
   */
  const take = (input: string) => {
    const breakAt = input.search(/[\r\n]/)
    const text = breakAt === -1 ? input : input.slice(0, breakAt)
    const next = pathRef.current + text
    setPath(next, text.length > 1)
    go(PATH_ROW)
    if (breakAt !== -1) savePath(next)
  }

  useKeys((input, k) => {
    if (isStrayEscapeSequence(input)) return
    if (making !== null) {
      if (k.escape) setMaking(null)
      else if (k.return && making.trim() !== '' && folder) {
        save(`${folder.value}/${making.trim()}`)
      } else if (k.backspace || k.delete) setMaking(making.slice(0, -1))
      else if (/^[A-Za-z0-9 _.-]$/.test(input)) setMaking(making + input)
      return
    }
    const here = atRef.current
    if (k.return) {
      if (here === PATH_ROW) savePath(pathRef.current)
      else if (folder) save(folder.value)
    } else if (k.escape) {
      if (here === PATH_ROW && pathRef.current !== '') setPath('')
      else if (here === PATH_ROW) move(-1)
      else onCancel()
    } else if (k.upArrow || k.downArrow) move(k.downArrow ? 1 : -1)
    else if (k.tab) {
      if (here === PATH_ROW && ghost) setPath(pathRef.current + ghost)
      else if (folder?.path && !isDefault(folder)) onMakeDefault(folderOf(folder.value))
    } else if (k.backspace || k.delete) {
      if (here === PATH_ROW) setPath(pathRef.current.slice(0, -1))
      else setName((n) => n.slice(0, -1))
    } else if (k.ctrl || k.meta || !input) return
    else if (here === PATH_ROW) take(input)
    // A drop: a path arriving in one piece goes to the path row.
    else if (input.length > 1 && isPathQuery(input.split(/[\r\n]/)[0] ?? '')) take(input)
    else if (input === '/' && folder?.path) setMaking('')
    else if (/^[A-Za-z0-9-]$/.test(input) && !(name === '' && input === '-')) {
      setName((n) => (n.length < NAME_WIDTH - 2 ? n + input : n))
    }
  })

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
        ? shown.length === 0
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

  const p = palette
  // As wide as Continue editing's, narrower in a narrow terminal.
  const W = Math.min(WINDOW_WIDTH, width - 4)
  const fw = W - 2
  // As Save as: names only in a compact terminal.
  const showPath = bandFor(width) !== 'compact'
  // A row's line of the list, counting the new folder's row while it is open.
  const lineOf = (i: number) => i + (making !== null && index !== -1 && index < i ? 1 : 0)
  const caret = making === null && !onPath ? [{ text: ' ', bg: p.fg }] : []
  // The chain, steps joined by ─▸, in a block of its own grey: three rows,
  // the words on the middle one, three cells in from the window's sides.
  const block = p.shelf || undefined
  const fillRow = (runs: Row = []): Row => {
    const inner = fw - 6
    const used = runs.reduce((n, r) => n + stringWidth(r.text), 0)
    return [
      blank(3),
      ...runs.map((r) => ({ ...r, ...(block ? { bg: block } : {}) })),
      { text: ' '.repeat(Math.max(0, inner - used)), ...(block ? { bg: block } : {}) },
      blank(3),
    ]
  }
  const chainRuns: Row = links
    ? [
        { text: '  ' },
        { text: links.source, fg: p.dim },
        ...links.steps.flatMap(
          (t): Row => [
            { text: ' ─▸ ', fg: p.border },
            { text: t, fg: p.fg, bold: true },
          ],
        ),
      ]
    : []
  const chainBlock: Row[] = links ? [[], fillRow(), fillRow(chainRuns), fillRow()] : []
  const lines: Row[] = [
    ...chainBlock,
    fieldBlank({ palette: p, width: fw }),
    fieldRow({
      palette: p,
      width: fw,
      runs: [
        label(p, NAME_LABEL[0], LABELS.width),
        ...padTo([{ text: ` ${name}`, fg: p.fg, bg: p.band }, ...caret], NAME_WIDTH, p.band),
      ],
    }),
    isTaken
      ? fieldRow({
          palette: p,
          width: fw,
          runs: [
            label(p, NAME_LABEL[1], LABELS.width),
            { text: '▔'.repeat(NAME_WIDTH), fg: p.fail },
          ],
        })
      : underlineRow({ palette: p, width: fw, labels: LABELS, text: NAME_LABEL[1] }),
    ...(isTaken
      ? [
          fieldRow({
            palette: p,
            width: fw,
            runs: [
              label(p, '', LABELS.width),
              { text: name, fg: p.fail, bold: true },
              { text: ' is taken', fg: p.fail },
            ],
          }),
        ]
      : []),
    ruleRow({ palette: p, width: fw }),
    fieldBlank({ palette: p, width: fw }),
    ...shown.flatMap((f, i) => [
      folderRow({
        line: lineOf(i),
        palette: p,
        width: fw,
        first: i === 0,
        label: f.label,
        path: f.path ?? '',
        selected: i === index && making === null,
        isDefault: isDefault(f),
        showPath,
        labels: LABELS,
      }),
      ...(making !== null && i === index
        ? [
            newFolderRow({
              palette: p,
              width: fw,
              name: making,
              isNew: true,
              labels: LABELS,
              line: i + 1,
            }),
          ]
        : []),
    ]),
    pathRow({
      palette: p,
      width: fw,
      line,
      first: shown.length === 0,
      showPath,
      labels: LABELS,
      at: lineOf(shown.length),
    }),
    fieldBlank({ palette: p, width: fw }),
  ]
  // Save as's block without its coloured edge: the window's frame is the edge here.
  const edge = edgeColour(p)
  const framed = lines.map((r) =>
    r[0] && r[0].bg === edge ? [{ ...r[0], bg: undefined }, ...r.slice(1)] : r,
  )
  const area = height - 3
  const rows = windowOver(p, doneUnder(p, result, mode, width, height, links), {
    title: 'Save as preset',
    lines: framed,
    width: W,
    columns: width,
    top: Math.max(0, Math.floor((area - framed.length - 2) / 2)),
  })
  const keys: Array<[string, string]> =
    making !== null
      ? [['↵', 'create and save']]
      : !onPath
        ? [
            ['↵', 'save'],
            ['↑↓', 'folder'],
            // As Save as: on a folder, not on Same location or Ask each time.
            ...(folder?.path
              ? ([
                  ['tab', 'make default'],
                  ['/', 'new folder'],
                ] as Array<[string, string]>)
              : []),
          ]
        : path === '' || (filter && shown.length === 0)
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
  const foot: Array<[string, string]> = [
    ['esc', !onPath ? 'cancel' : path !== '' ? 'clear path' : 'back'],
  ]
  return (
    <Box flexDirection="column" width={width} height={height}>
      <HeaderBar mode={mode} trail={trail} width={width} />
      {rows.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the rows are positional
        <Runs key={i} row={row.length === 0 ? [blank(1)] : row} />
      ))}
      <KeyRule width={width} />
      <KeyRow main={keys} foot={foot} width={width} />
    </Box>
  )
}
