import { Box } from 'ink'
import { useState } from 'react'
import type { Result } from '../../core/types.js'
import type { Trail } from '../bar-art.js'
import { windowOver } from '../colour/system-art.js'
import { blank, type Row } from '../home-art.js'
import {
  edgeColour,
  fieldBlank,
  fieldRow,
  folderRow,
  label,
  NAME_WIDTH,
  newFolderRow,
  padTo,
  pathRow,
  ruleRow,
  underlineRow,
} from '../save-as-art.js'
import { Text } from '../Text.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, type ShellMode } from '../theme.js'
import { useKeys } from '../useKeys.js'
import { HeaderBar } from './HeaderBar.js'
import { KeyRow, Runs } from './Home.js'
import { doneUnder } from './PresetEditor.js'

/** A place a preset can save to: a folder (`~` unexpanded), `same`, or `ask`. */
export interface PresetFolder {
  label: string
  value: string
  /** Shown on the highlighted row, as Save as shows a folder's path. */
  path?: string | undefined
}

const WINDOW_WIDTH = 68

/**
 * Save as preset (round 9): the centred window over Done, holding Save as's
 * own block — the name on the mode's tint, underlined, a rule, the folders
 * with the default tagged, the path row. ↑↓ move the folders while the name
 * keeps the caret, `/` names a new folder inside the highlighted one, as in
 * Save as. Its coloured edge is left out: the window's frame is the edge.
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
  onCancel,
}: {
  mode: ShellMode
  trail: Trail
  result: Result
  width: number
  height: number
  /** The name the field opens with: empty, or the preset being updated. */
  name: string
  /** Names already saved; one of them cannot be saved over from here. */
  taken: string[]
  folders: PresetFolder[]
  defaultValue: string
  onSave: (preset: { name: string; saveTo: string }) => void
  onCancel: () => void
}) {
  const palette = useTheme()
  const [name, setName] = useState(initialName)
  const [at, setAt] = useState(0)
  const [making, setMaking] = useState<string | null>(null)
  const isTaken = taken.includes(name)
  const folder = folders[at]

  useKeys((input, k) => {
    if (making !== null) {
      if (k.escape) setMaking(null)
      else if (k.return && making.trim() !== '' && folder) {
        onSave({ name, saveTo: `${folder.value}/${making.trim()}` })
      } else if (k.backspace || k.delete) setMaking(making.slice(0, -1))
      else if (/^[A-Za-z0-9 _.-]$/.test(input)) setMaking(making + input)
      return
    }
    if (k.escape) onCancel()
    else if (k.return) {
      if (name !== '' && !isTaken && folder) onSave({ name, saveTo: folder.value })
    } else if (k.upArrow) setAt((a) => Math.max(0, a - 1))
    else if (k.downArrow) setAt((a) => Math.min(folders.length - 1, a + 1))
    else if (k.backspace || k.delete) setName((n) => n.slice(0, -1))
    else if (input === '/' && folder?.path) setMaking('')
    else if (/^[A-Za-z0-9-]$/.test(input) && !(name === '' && input === '-')) {
      setName((n) => (n.length < NAME_WIDTH - 2 ? n + input : n))
    }
  })

  const p = palette
  const fw = WINDOW_WIDTH - 2
  const caret = making === null ? [{ text: ' ', bg: p.fg }] : []
  const lines: Row[] = [
    fieldBlank({ palette: p, width: fw }),
    fieldRow({
      palette: p,
      width: fw,
      runs: [
        label(p, 'name'),
        ...padTo([{ text: ` ${name}`, fg: p.fg, bg: p.band }, ...caret], NAME_WIDTH, p.band),
      ],
    }),
    isTaken
      ? fieldRow({
          palette: p,
          width: fw,
          runs: [label(p), { text: '▔'.repeat(NAME_WIDTH), fg: p.fail }],
        })
      : underlineRow({ palette: p, width: fw }),
    ...(isTaken
      ? [
          fieldRow({
            palette: p,
            width: fw,
            runs: [
              label(p),
              { text: name, fg: p.fail, bold: true },
              { text: ' is taken', fg: p.fail },
            ],
          }),
        ]
      : []),
    ruleRow({ palette: p, width: fw }),
    fieldBlank({ palette: p, width: fw }),
    ...folders.flatMap((f, i) => [
      folderRow({
        palette: p,
        width: fw,
        first: i === 0,
        label: f.label,
        path: f.path ?? '',
        selected: i === at && making === null,
        isDefault: f.value === defaultValue,
      }),
      ...(making !== null && i === at
        ? [newFolderRow({ palette: p, width: fw, name: making, isNew: true })]
        : []),
    ]),
    pathRow({ palette: p, width: fw, line: { kind: 'rest' } }),
    fieldBlank({ palette: p, width: fw }),
  ]
  // Save as's block without its coloured edge: the window's frame is the edge here.
  const edge = edgeColour(p)
  const framed = lines.map((r) =>
    r[0] && r[0].bg === edge ? [{ ...r[0], bg: undefined }, ...r.slice(1)] : r,
  )
  const area = height - 3
  const rows = windowOver(p, doneUnder(p, result, mode, width, height), {
    title: 'Save as preset',
    lines: framed,
    width: WINDOW_WIDTH,
    columns: width,
    top: Math.max(0, Math.floor((area - framed.length - 2) / 2)),
  })
  const keys: Array<[string, string]> =
    making !== null
      ? [['↵', 'create and save']]
      : [
          ['↵', 'save'],
          ['↑↓', 'folder'],
          ['/', 'new folder'],
        ]
  return (
    <Box flexDirection="column" width={width} height={height}>
      <HeaderBar mode={mode} trail={trail} width={width} />
      {rows.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the rows are positional
        <Runs key={i} row={row.length === 0 ? [blank(1)] : row} />
      ))}
      <Text color={colourProp(p.border)}>{'─'.repeat(width)}</Text>
      <KeyRow main={keys} foot={[['esc', 'cancel']]} width={width} />
    </Box>
  )
}
