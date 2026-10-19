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

const bundleId = (item: MenuItem) => `com.forge-terminal.menu.${item.action}`
const MESSAGE = 'runWorkflowAsService'

/**
 * How the services settings name `item`'s service: bundle ID, menu name,
 * message. Under this key they record where the service may appear.
 */
export const serviceKey = (item: MenuItem) => `${bundleId(item)} - ${item.label} - ${MESSAGE}`

/**
 * Switches services on and off for Finder's right-click menu. A bundle in
 * ~/Library/Services alone only reaches the Services menu: Finder lists a
 * Quick Action only once the services settings (the `pbs` defaults domain)
 * mark it for the context menu, which Automator does when it saves one. The
 * flags must be booleans; strings are ignored. Written through
 * NSUserDefaults so the settings daemon sees it and every other entry and
 * setting stays as it was.
 *
 * Argument 1 is the domain; each one after is a service key, prefixed + for
 * on and - for off.
 */
const SERVICES_STATUS_JXA = `ObjC.import('Foundation')
function run(argv) {
  const domain = argv[0]
  const defaults = $.NSUserDefaults.standardUserDefaults
  const or = (v) => (v.isNil() ? $.NSDictionary.dictionary : v)
  const all = $.NSMutableDictionary.dictionaryWithDictionary(or(defaults.persistentDomainForName(domain)))
  const status = $.NSMutableDictionary.dictionaryWithDictionary(or(all.objectForKey('NSServicesStatus')))
  const on = { presentation_modes: { ContextMenu: true, FinderPreview: true, ServicesMenu: true, TouchBar: true } }
  for (const arg of argv.slice(1)) {
    const key = arg.slice(1)
    if (arg[0] === '+') status.setObjectForKey($(on), key)
    else status.removeObjectForKey(key)
  }
  all.setObjectForKey(status, 'NSServicesStatus')
  defaults.setPersistentDomainForName(all, domain)
}`

/** The command that switches `on` services on and `off` ones off; `domain` is for tests. */
export function servicesStatus(o: {
  on: string[]
  off: string[]
  domain?: string
  osascript?: string
}): [string, string[]] {
  return [
    o.osascript ?? '/usr/bin/osascript',
    [
      '-l',
      'JavaScript',
      '-e',
      SERVICES_STATUS_JXA,
      o.domain ?? 'pbs',
      ...o.on.map((k) => `+${k}`),
      ...o.off.map((k) => `-${k}`),
    ],
  ]
}

/** The bundle for `item`: its folder name, and each file's path inside it with its text. */
export function workflowFiles(
  item: MenuItem,
  launcher: string,
): { name: string; files: Record<string, string> } {
  const info = plist({
    CFBundleDevelopmentRegion: 'English',
    CFBundleIdentifier: bundleId(item),
    CFBundleInfoDictionaryVersion: '6.0',
    CFBundleName: item.label,
    CFBundlePackageType: 'BNDL',
    CFBundleShortVersionString: '1.0',
    CFBundleVersion: '1',
    NSServices: [
      {
        NSIconName: ICON_NAME,
        NSMenuItem: { default: item.label },
        NSMessage: MESSAGE,
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
