import { invalidArguments } from '../core/errors.js'
import { isPresetName } from '../core/preset.js'
import type { ShellMode } from '../shell/theme.js'
import type { MenuAction } from './items.js'

/**
 * `forge menu …`: the hidden commands behind the right-click menu, never
 * typed by anyone. The launcher calls `run` with a click's action and files;
 * `run` opens a terminal on `open`; `install` and `remove` are there to set
 * the menu up or take it down by hand.
 */
export type MenuCommand =
  /** A preset's item carries the preset's name. */
  | { kind: 'run'; action: MenuAction; paths: string[]; preset?: string }
  | { kind: 'open'; action: MenuAction; paths: string[] }
  | { kind: 'install' }
  | { kind: 'remove' }

const ACTIONS: readonly MenuAction[] = [
  'open',
  'convert',
  'compress',
  'sharpen',
  'open-pdf',
  'preset',
]

export function parseMenuArgs(argv: string[]): MenuCommand {
  const [sub, action, ...paths] = argv
  if (sub === 'install' || sub === 'remove') return { kind: sub }
  if (sub === 'run' || sub === 'open') {
    if (!ACTIONS.includes(action as MenuAction))
      throw invalidArguments(`No menu action called "${action ?? ''}".`)
    if (action === 'preset') {
      const [name, ...files] = paths
      if (sub !== 'run' || name === undefined || !isPresetName(name))
        throw invalidArguments(`No preset called "${name ?? ''}".`)
      return { kind: 'run', action, preset: name, paths: files }
    }
    return { kind: sub, action: action as MenuAction, paths }
  }
  throw invalidArguments(`No menu command called "${sub ?? ''}".`)
}

/** How the shell opens for a menu item: what is staged, in which mode, and whether ↵ is pressed for you. */
export interface Opened {
  paths: string[]
  mode: ShellMode
  /** Take the first step, as ↵ on the staged file would: Convert and Compress open one step in. */
  advance: boolean
}

export function openedFor(action: MenuAction, paths: string[]): Opened {
  switch (action) {
    case 'convert':
      return { paths, mode: 'convert', advance: true }
    case 'compress':
      return { paths, mode: 'compress', advance: true }
    case 'open-pdf':
      return { paths, mode: 'pdf', advance: false }
    default:
      return { paths: [], mode: 'convert', advance: false }
  }
}
