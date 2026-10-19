import type { MenuItem, MenuKind } from './items.js'

/**
 * A Finder Quick Action is a `.workflow` bundle in ~/Library/Services: an
 * Info.plist declaring the service (its menu name, Finder as the only app it
 * appears in, the file types it takes) and a document.wflow holding one
 * "Run Shell Script" action. Forge writes these itself; no Automator, no
 * developer account. The shape is the one Automator saves, as seen in
 * third-party bundles written the same way.
 *
 * The script calls Forge's launcher (see launcher.ts) with the item's action
 * and every selected file. A Quick Action does not get the user's shell PATH,
 * which is why it calls the launcher by its full path rather than `forge`.
 */

/** Plist values: enough of the format for these two files. */
type Plist = string | number | boolean | Plist[] | { [key: string]: Plist }

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function plistValue(v: Plist, indent: string): string {
  if (typeof v === 'string') return `${indent}<string>${xml(v)}</string>`
  if (typeof v === 'number') return `${indent}<integer>${v}</integer>`
  if (typeof v === 'boolean') return `${indent}<${v}/>`
  if (Array.isArray(v))
    return `${indent}<array>\n${v.map((x) => plistValue(x, `${indent}\t`)).join('\n')}\n${indent}</array>`
  const rows = Object.entries(v).map(
    ([k, x]) => `${indent}\t<key>${xml(k)}</key>\n${plistValue(x, `${indent}\t`)}`,
  )
  return rows.length === 0
    ? `${indent}<dict/>`
    : `${indent}<dict>\n${rows.join('\n')}\n${indent}</dict>`
}

export const plist = (root: Plist) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
${plistValue(root, '')}
</plist>
`

/** Uniform type identifiers Finder matches a selection against. */
const SEND_TYPES: Record<MenuKind, string> = {
  image: 'public.image',
  folder: 'public.folder',
  pdf: 'com.adobe.pdf',
}

/** What Automator records the service as taking. */
function inputType(kinds: MenuKind[]): string {
  if (kinds.length === 1 && kinds[0] === 'image')
    return 'com.apple.Automator.fileSystemObject.image'
  if (kinds.length === 1 && kinds[0] === 'pdf') return 'com.apple.Automator.fileSystemObject.PDF'
  if (kinds.length === 1 && kinds[0] === 'folder')
    return 'com.apple.Automator.fileSystemObject.folder'
  return 'com.apple.Automator.fileSystemObject'
}

/** A POSIX shell word: single-quoted, any single quote closed, escaped and reopened. */
export const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

/** The icon's name in the bundle's Resources, without its extension, as NSIconName wants it. */
export const ICON_NAME = 'forge'

/** The bundle for `item`: its folder name, and each file's path inside it with its text. */
export function workflowFiles(
  item: MenuItem,
  launcher: string,
): { name: string; files: Record<string, string> } {
  const info = plist({
    CFBundleDevelopmentRegion: 'English',
    CFBundleIdentifier: `com.forge-terminal.menu.${item.action}`,
    CFBundleInfoDictionaryVersion: '6.0',
    CFBundleName: item.label,
    CFBundlePackageType: 'BNDL',
    CFBundleShortVersionString: '1.0',
    CFBundleVersion: '1',
    NSServices: [
      {
        NSIconName: ICON_NAME,
        NSMenuItem: { default: item.label },
        NSMessage: 'runWorkflowAsService',
        NSRequiredContext: { NSApplicationIdentifier: 'com.apple.finder' },
        NSSendFileTypes: item.kinds.map((k) => SEND_TYPES[k]),
      },
    ],
  })
  const command = `${shellQuote(launcher)} ${item.action} "$@"`
  const document = plist({
    AMApplicationBuild: '521',
    AMApplicationVersion: '2.10',
    AMDocumentVersion: '2',
    actions: [
      {
        action: {
          AMAccepts: { Container: 'List', Optional: true, Types: ['com.apple.cocoa.path'] },
          AMActionVersion: '2.0.3',
          AMApplication: ['Automator'],
          AMParameterProperties: {
            COMMAND_STRING: {},
            CheckedForUserDefaultShell: {},
            inputMethod: {},
            shell: {},
            source: {},
          },
          AMProvides: { Container: 'List', Types: ['com.apple.cocoa.string'] },
          ActionBundlePath: '/System/Library/Automator/Run Shell Script.action',
          ActionName: 'Run Shell Script',
          ActionParameters: {
            COMMAND_STRING: command,
            CheckedForUserDefaultShell: true,
            inputMethod: 1,
            shell: '/bin/zsh',
            source: '',
          },
          BundleIdentifier: 'com.apple.RunShellScript',
          CFBundleVersion: '2.0.3',
          CanShowSelectedItemsWhenRun: false,
          CanShowWhenRun: true,
          Category: ['AMCategoryUtilities'],
          'Class Name': 'RunShellScriptAction',
          InputUUID: '7A1F3C2E-0F4B-4E8A-9C61-5B2D8E4F1A01',
          OutputUUID: '7A1F3C2E-0F4B-4E8A-9C61-5B2D8E4F1A02',
          UUID: '7A1F3C2E-0F4B-4E8A-9C61-5B2D8E4F1A03',
          UnlocalizedApplications: ['Automator'],
        },
        isViewVisible: true,
      },
    ],
    connectors: {},
    workflowMetaData: {
      serviceApplicationBundleID: 'com.apple.finder',
      serviceApplicationPath: '/System/Library/CoreServices/Finder.app',
      serviceInputTypeIdentifier: inputType(item.kinds),
      serviceOutputTypeIdentifier: 'com.apple.Automator.nothing',
      serviceProcessesInput: false,
      workflowTypeIdentifier: 'com.apple.Automator.servicesMenu',
    },
  })
  return {
    name: `${item.label}.workflow`,
    files: {
      'Contents/Info.plist': info,
      'Contents/document.wflow': document,
      // Automator keeps a second copy here; Finder has been seen to read either.
      'Contents/Resources/document.wflow': document,
    },
  }
}
