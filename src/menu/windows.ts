import type { MenuItem, MenuKind } from './items.js'
import { AUMID, psEscape } from './notify.js'

/**
 * Explorer's right-click menu is registry keys, written under the current
 * user's hive so no admin rights are needed. Windows 11 shows them under
 * "Show more options" (or shift + right-click); its new menu takes only
 * items from an installed app package, which an npm tool is not.
 *
 * Decided (WM2): images and folders get one "Forge ›" row holding the
 * items, the way 7-Zip does, rather than four rows loose among Windows' own.
 * A PDF has a single item, Open in Forge, so it goes straight in the menu;
 * video and sound get the Forge row, with that item and Convert and Compress.
 *
 * Each item runs the launcher (launcher.ts) under `conhost --headless`, so a
 * click that opens no window (Sharpen) flashes no console either.
 */

const CLASSES = 'HKCU\\Software\\Classes'
const IMAGE = `${CLASSES}\\SystemFileAssociations\\image\\shell\\Forge`
const FOLDER = `${CLASSES}\\Directory\\shell\\Forge`
const VIDEO = `${CLASSES}\\SystemFileAssociations\\video\\shell\\Forge`
const AUDIO = `${CLASSES}\\SystemFileAssociations\\audio\\shell\\Forge`
const PDF = `${CLASSES}\\SystemFileAssociations\\.pdf\\shell\\ForgeOpen`
const APP_ID = `${CLASSES}\\AppUserModelId\\${AUMID}`

export interface RegistryEntry {
  key: string
  /** Value name to data; '' is the key's default value. */
  values: Record<string, string>
}

/** The keys that, deleted with everything under them, remove all Forge wrote. */
export const registryRoots = () => [IMAGE, FOLDER, VIDEO, AUDIO, PDF, APP_ID]

/** The icon file for an item's colour, in the menu folder. */
export const icoName = (item: Pick<MenuItem, 'paint'>) => `${item.paint}.ico`

export function registryPlan(o: {
  node: string
  menuDir: string
  items: MenuItem[]
}): RegistryEntry[] {
  // A preset's name (letters, digits and dashes) goes before the file.
  const command = (item: Pick<MenuItem, 'action' | 'preset'>) =>
    `conhost.exe --headless "${o.node}" "${o.menuDir}\\run.mjs" ${item.action}${item.preset === undefined ? '' : ` ${item.preset}`} "%1"`
  const icon = (item: Pick<MenuItem, 'paint'>) => `${o.menuDir}\\${icoName(item)}`
  const cascade = (root: string, kind: MenuKind): RegistryEntry[] => {
    const items = o.items.filter((i) => i.kinds.includes(kind))
    if (items.length === 0) return []
    return [
      { key: root, values: { MUIVerb: 'Forge', Icon: icon({ paint: 'forge' }), SubCommands: '' } },
      // Explorer orders a submenu by key name, hence the numbers.
      ...items.flatMap((item, n): RegistryEntry[] => {
        const name = item.preset === undefined ? item.action : `preset-${item.preset}`
        const key = `${root}\\shell\\${n + 1}${name}`
        return [
          { key, values: { MUIVerb: item.label, Icon: icon(item) } },
          { key: `${key}\\command`, values: { '': command(item) } },
        ]
      }),
    ]
  }
  const pdf = o.items.find((i) => i.action === 'open-file')
  return [
    ...cascade(IMAGE, 'image'),
    ...cascade(FOLDER, 'folder'),
    ...cascade(VIDEO, 'video'),
    ...cascade(AUDIO, 'audio'),
    ...(pdf
      ? [
          { key: PDF, values: { MUIVerb: pdf.label, Icon: icon(pdf) } },
          { key: `${PDF}\\command`, values: { '': command(pdf) } },
        ]
      : []),
    { key: APP_ID, values: { DisplayName: 'Forge', IconUri: `${o.menuDir}\\forge.png` } },
  ]
}

const ps = (s: string) => `'${psEscape(s)}'`
/** A key as PowerShell's registry provider takes it: the hive spelled out. */
const provider = (key: string) => ps(`Registry::${key.replace(/^HKCU\\/, 'HKEY_CURRENT_USER\\')}`)

/**
 * PowerShell that clears Forge's keys and writes `plan`. PowerShell rather
 * than reg.exe: reg.exe goes through the console code page, which mangles a
 * path with an accent in it (see utils/known-folders.ts).
 */
export function registryScript(plan: RegistryEntry[]): string {
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    ...registryRoots().map(
      (r) => `Remove-Item -Path ${provider(r)} -Recurse -Force -ErrorAction SilentlyContinue`,
    ),
    ...plan.flatMap(({ key, values }) => [
      `New-Item -Path ${provider(key)} -Force | Out-Null`,
      ...Object.entries(values).map(
        ([name, data]) =>
          `Set-ItemProperty -LiteralPath ${provider(key)} -Name ${ps(name === '' ? '(default)' : name)} -Value ${ps(data)}`,
      ),
    ]),
  ]
  return lines.join('\n')
}
