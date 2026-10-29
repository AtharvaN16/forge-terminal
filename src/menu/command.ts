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
  'open-file',
  'preset',
]

export function parseMenuArgs(argv: string[]): MenuCommand {
  const [sub, rawAction, ...paths] = argv
  // Open in Forge was Open-PDF-only before video and sound; a menu written by that Forge still says so.
  const action = rawAction === 'open-pdf' ? 'open-file' : rawAction
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

export function openedFor(action: MenuAction, paths: string[], pdf = false): Opened {
  switch (action) {
    case 'convert':
      return { paths, mode: 'convert', advance: true }
    case 'compress':
      return { paths, mode: 'compress', advance: true }
    case 'open-file':
      return { paths, mode: pdf ? 'pdf' : 'convert', advance: false }
    default:
      return { paths: [], mode: 'convert', advance: false }
  }
}

/**
 * `openedFor` for a real click. Open in Forge takes a PDF, a video or a
 * sound file; a PDF opens PDF mode, the rest wait on the convert home. Told
 * apart by what the file starts with, never its name.
 */
export async function openedForClick(action: MenuAction, paths: string[]): Promise<Opened> {
  const [first] = paths
  return openedFor(
    action,
    paths,
    action === 'open-file' && first !== undefined && (await isPdf(first)),
  )
}

async function isPdf(path: string): Promise<boolean> {
  const { open } = await import('node:fs/promises')
  try {
    const handle = await open(path, 'r')
    try {
      const head = Buffer.alloc(1024)
      const { bytesRead } = await handle.read(head, 0, head.length, 0)
      return head.subarray(0, bytesRead).includes('%PDF-')
    } finally {
      await handle.close()
    }
  } catch {
    return false
  }
}
