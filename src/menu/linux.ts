import { accessSync, constants } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { MenuItem, MenuKind } from './items.js'
import { shellQuote } from './mac.js'

/**
 * Linux has no one right-click menu: each file manager reads its own files.
 * Forge writes for the four most used, none of which needs anything
 * installed beyond the file manager itself:
 *
 * - GNOME Files (Nautilus): executable scripts in nautilus/scripts, shown
 *   under Scripts. A "Forge" folder there makes them a Forge submenu.
 *   Nautilus cannot offer a script for some file kinds only, so every item
 *   is there for every file; Forge says so if a file is not one it takes.
 * - Nemo (Cinnamon): one .nemo_action per item, matched by MIME type.
 * - Dolphin (KDE): one service menu per kind, a Forge submenu as on
 *   Windows, the PDF's single item on its own. KDE 6 runs only an executable one.
 * - Thunar (Xfce): its custom actions, in the user's own uca.xml. Forge's are
 *   merged in beside the user's and known by their unique-id, so taking
 *   them out leaves everything else as it was.
 *
 * Each item runs the launcher (launcher.ts) with its action and the files,
 * as on a Mac. Every file Forge writes carries MARKER, and nothing without
 * it is ever deleted.
 */

/** In every file Forge writes for a file manager: what removal looks for before deleting. */
export const MARKER = 'forge-terminal-menu'

export interface LinuxDirs {
  /** XDG_DATA_HOME: Nautilus', Nemo's and Dolphin's menus. */
  dataHome: string
  /** XDG_CONFIG_HOME: Thunar's actions. */
  configHome: string
  /** XDG_CONFIG_DIRS: where Thunar keeps the actions it starts with. */
  configDirs: string[]
}

/** The XDG base folders, as the spec reads them: a relative path is ignored. */
export function linuxDirs(o: {
  home: string
  xdgDataHome?: string
  xdgConfigHome?: string
  xdgConfigDirs?: string
}): LinuxDirs {
  const abs = (p: string | undefined) => (p && isAbsolute(p) ? p : undefined)
  const dirs = (o.xdgConfigDirs ?? '').split(':').filter((d) => isAbsolute(d))
  return {
    dataHome: abs(o.xdgDataHome) ?? join(o.home, '.local', 'share'),
    configHome: abs(o.xdgConfigHome) ?? join(o.home, '.config'),
    configDirs: dirs.length > 0 ? dirs : ['/etc/xdg'],
  }
}

/** Whether `cmd` is an executable on `path` (PATH as the environment has it). */
export function onPath(cmd: string, path: string | undefined = process.env.PATH): boolean {
  for (const dir of (path ?? '').split(':')) {
    if (dir === '') continue
    try {
      accessSync(join(dir, cmd), constants.X_OK)
      return true
    } catch {}
  }
  return false
}

/** The MIME types each kind is offered for. */
export const MIME_TYPES: Record<MenuKind, string> = {
  image: 'image/*',
  folder: 'inode/directory',
  pdf: 'application/pdf',
}

const mimeTypes = (kinds: MenuKind[]) => kinds.map((k) => `${MIME_TYPES[k]};`).join('')

/** The icon for an item's colour, written to the menu folder by install. */
export const pngName = (item: Pick<MenuItem, 'paint'>) => `${item.paint}.png`

// --- Nautilus ---------------------------------------------------------------

export const nautilusDir = (d: LinuxDirs) => join(d.dataHome, 'nautilus', 'scripts', 'Forge')

/** An item's own name among Forge's: its action, or a preset's, which can be several. */
export const itemId = (item: Pick<MenuItem, 'action' | 'preset'>) =>
  item.preset === undefined ? item.action : `preset-${item.preset}`

/** What the launcher is given before the files: the action, and a preset's name (letters, digits, dashes). */
export const itemArgs = (item: Pick<MenuItem, 'action' | 'preset'>) =>
  item.preset === undefined ? item.action : `preset ${item.preset}`

/** Nautilus shows a script by its file name, so the name is the label. */
export const nautilusName = (item: Pick<MenuItem, 'label'>) => item.label

/**
 * A Nautilus script. Nautilus passes the selection as paths relative to the
 * folder on screen, and as full paths, one a line, in
 * NAUTILUS_SCRIPT_SELECTED_FILE_PATHS; the full paths are the ones used.
 */
export function nautilusScript(item: MenuItem, launcher: string): string {
  return `#!/bin/sh
# ${MARKER}: Forge's right-click menu, written by Forge. \`forge menu remove\` takes it out.
if [ -n "$NAUTILUS_SCRIPT_SELECTED_FILE_PATHS" ]; then
  IFS='
'
  set -f
  set -- $NAUTILUS_SCRIPT_SELECTED_FILE_PATHS
fi
exec ${shellQuote(launcher)} ${itemArgs(item)} "$@"
`
}

// --- Nemo -------------------------------------------------------------------

export const nemoDir = (d: LinuxDirs) => join(d.dataHome, 'nemo', 'actions')

/**
 * Numbered in menu order, from the full list so a name never changes with
 * Boost; presets after every built-in item, as in the menu.
 */
export const nemoName = (item: Pick<MenuItem, 'action' | 'preset'>, order: string[]) =>
  `forge-${item.preset === undefined ? order.indexOf(item.action) + 1 : order.length + 1}-${itemId(item)}.nemo_action`

/**
 * `%` starts one of Nemo's tokens (and a desktop file's field codes), so a
 * literal one is written twice.
 */
const percent = (s: string) => s.replace(/%/g, '%%')

/**
 * A Nemo action. Its Exec line is split as a shell would, so the launcher is
 * shell-quoted; Nemo quotes the paths it puts in for %F itself. No icon: Nemo
 * takes only a theme icon's name, and Forge installs none in a theme.
 */
export function nemoAction(item: MenuItem, launcher: string): string {
  return `[Nemo Action]
# ${MARKER}: Forge's right-click menu, written by Forge. \`forge menu remove\` takes it out.
Name=${percent(item.label)}
Comment=${percent(item.label)}
Exec=${percent(shellQuote(launcher))} ${itemArgs(item)} %F
Selection=notnone
Mimetypes=${mimeTypes(item.kinds)}
`
}

// --- Dolphin ----------------------------------------------------------------

export const dolphinDir = (d: LinuxDirs) => join(d.dataHome, 'kio', 'servicemenus')

/** One service menu per kind: a Forge submenu as on Windows, so a file gets one row. */
export const dolphinName = (kind: MenuKind) => `forge-${kind}.desktop`

export const DOLPHIN_KINDS: MenuKind[] = ['image', 'folder', 'pdf']

/**
 * An argument in a desktop file's Exec line: in double quotes, with `"`, `` ` ``,
 * `$` and `\` escaped, then every `\` doubled again, since the value is
 * itself a string with escapes of its own (desktop entry spec, "The Exec key").
 */
export const desktopQuote = (s: string) =>
  percent(`"${s.replace(/[\\"`$]/g, '\\$&')}"`).replace(/\\/g, '\\\\')

/** A Dolphin service menu holding `items`, those offered for `kind`; undefined when there are none. */
export function dolphinMenu(
  kind: MenuKind,
  all: MenuItem[],
  o: { launcher: string; menuDir: string },
): string | undefined {
  const items = all.filter((i) => i.kinds.includes(kind))
  if (items.length === 0) return undefined
  // A PDF has one item, so it goes straight in the menu, as on Windows.
  const submenu = items.length > 1
  const head = [
    '[Desktop Entry]',
    `# ${MARKER}: Forge's right-click menu, written by Forge. \`forge menu remove\` takes it out.`,
    'Type=Service',
    // KDE Frameworks 5 before 5.85 reads these; later ones and KDE 6 ignore them.
    'ServiceTypes=KonqPopupMenu/Plugin',
    'X-KDE-ServiceTypes=KonqPopupMenu/Plugin',
    `MimeType=${MIME_TYPES[kind]};`,
    `Actions=${items.map((i) => `${itemId(i)};`).join('')}`,
    'X-KDE-Priority=TopLevel',
    ...(submenu ? ['X-KDE-Submenu=Forge', `Icon=${join(o.menuDir, 'forge.png')}`] : []),
  ]
  const actions = items.map((i) =>
    [
      '',
      `[Desktop Action ${itemId(i)}]`,
      `Name=${i.label}`,
      `Icon=${join(o.menuDir, pngName(i))}`,
      `Exec=${desktopQuote(o.launcher)} ${itemArgs(i)} %F`,
    ].join('\n'),
  )
  return `${[...head, ...actions].join('\n')}\n`
}

// --- Thunar -----------------------------------------------------------------

export const thunarFile = (d: LinuxDirs) => join(d.configHome, 'Thunar', 'uca.xml')

/** The actions Thunar starts with, which it reads until the user has a uca.xml of their own. */
export const thunarDefaults = (d: LinuxDirs) =>
  d.configDirs.map((dir) => join(dir, 'Thunar', 'uca.xml'))

/** A uca.xml with no actions at all: what Forge writes when Thunar has none to start with. */
export const EMPTY_UCA = '<?xml version="1.0" encoding="UTF-8"?>\n<actions>\n</actions>\n'

const ucaId = (item: Pick<MenuItem, 'action' | 'preset'>) => `${MARKER}-${itemId(item)}`

const xml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** What Thunar matches a file against for each kind: a name pattern and its file types. */
const THUNAR_MATCH: Record<MenuKind, { patterns: string[]; type: string }> = {
  image: { patterns: ['*'], type: 'image-files' },
  folder: { patterns: ['*'], type: 'directories' },
  pdf: { patterns: ['*.pdf', '*.PDF'], type: 'other-files' },
}

/**
 * Forge's actions as uca.xml entries, laid out as Thunar writes its own.
 * Images' and folders' are in a Forge submenu (Thunar 4.18 and later; an
 * older one lists them loose), the PDF's on its own, as on Windows.
 */
export function thunarActions(items: MenuItem[], o: { launcher: string; menuDir: string }): string {
  return items
    .map((i) => {
      const match = i.kinds.map((k) => THUNAR_MATCH[k])
      const patterns = [...new Set(match.flatMap((m) => m.patterns))]
      const all = patterns.includes('*') ? ['*'] : patterns
      return [
        '<action>',
        `\t<icon>${xml(join(o.menuDir, pngName(i)))}</icon>`,
        `\t<name>${xml(i.label)}</name>`,
        `\t<submenu>${i.kinds.includes('pdf') ? '' : 'Forge'}</submenu>`,
        `\t<unique-id>${ucaId(i)}</unique-id>`,
        `\t<command>${xml(percent(shellQuote(o.launcher)))} ${itemArgs(i)} %F</command>`,
        `\t<description>${xml(i.label)}</description>`,
        '\t<range></range>',
        `\t<patterns>${xml(all.join(';'))}</patterns>`,
        ...match.map((m) => `\t<${m.type}/>`),
        '</action>',
      ].join('\n')
    })
    .map((block) => `${block}\n`)
    .join('')
}

/** One `<action>` entry, with the whitespace around it, so taking it out leaves no gap. */
const ACTION = /[ \t]*<action>[\s\S]*?<\/action>[ \t]*\r?\n?/g

/** `uca` with Forge's actions taken out and everything else exactly as it was. */
export function stripUca(uca: string): string {
  return uca.replace(ACTION, (block) => (block.includes(`<unique-id>${MARKER}-`) ? '' : block))
}

/**
 * `uca` with Forge's actions in, replacing any it had: put before the
 * closing `</actions>`, at the start of its line when it has one to itself,
 * so stripUca gives back exactly what was there. Undefined when that cannot
 * be found, so a file Forge cannot read is never written over.
 */
export function mergeUca(uca: string, actions: string): string | undefined {
  const stripped = stripUca(uca)
  let at = stripped.lastIndexOf('</actions>')
  if (at === -1 || !/<actions>/.test(stripped)) return undefined
  const line = stripped.lastIndexOf('\n', at) + 1
  if (/^[ \t]*$/.test(stripped.slice(line, at))) at = line
  return `${stripped.slice(0, at)}${actions}${stripped.slice(at)}`
}

/** Whether Thunar is here: on PATH, or with a settings folder of its own. */
export const hasThunar = (d: LinuxDirs, path: string | undefined, exists: (p: string) => boolean) =>
  onPath('thunar', path) || exists(join(d.configHome, 'Thunar'))
