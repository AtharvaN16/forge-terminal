import { execFile } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { writeAtomic } from '../core/atomic.js'
import { icoFrom, renderIcon } from './icon.js'
import { type MenuItem, type MenuPaint, menuItems } from './items.js'
import { linuxLauncher, macLauncher, windowsLauncher } from './launcher.js'
import {
  DOLPHIN_KINDS,
  dolphinDir,
  dolphinMenu,
  dolphinName,
  EMPTY_UCA,
  hasThunar,
  type LinuxDirs,
  linuxDirs,
  MARKER,
  mergeUca,
  nautilusDir,
  nautilusName,
  nautilusScript,
  nemoAction,
  nemoDir,
  nemoName,
  pngName,
  stripUca,
  thunarActions,
  thunarDefaults,
  thunarFile,
} from './linux.js'
import { BUNDLE_PREFIX, ICON_NAME, serviceKey, servicesStatus, workflowFiles } from './mac.js'
import { icoName, registryPlan, registryRoots, registryScript } from './windows.js'

/**
 * Setting up and taking down the right-click menu. Everything it touches is
 * passed in, so tests run it against a temp folder with a recording `run`.
 */
export interface MenuEnv {
  platform: NodeJS.Platform
  /** The user's home; the Quick Actions go in its Library/Services. */
  home: string
  /** Forge's own folder for the launcher, the icons and the state file. */
  menuDir: string
  node: string
  execArgv: string[]
  forge: string
  /**
   * XDG_CONFIG_HOME as the user's shell had it. A menu item is started by
   * Finder or Explorer, which never read the shell's profile, so without it
   * the item would look for extensions and settings in the wrong folder.
   */
  xdgConfigHome?: string
  /** Linux: XDG_DATA_HOME as the shell had it, where Nautilus, Nemo and Dolphin look. */
  xdgDataHome?: string
  /** Linux: XDG_CONFIG_DIRS, where Thunar keeps the actions it starts with. */
  xdgConfigDirs?: string
  /** Linux: PATH, to tell whether Thunar is installed. */
  path?: string
  /** Forge's version, recorded so a newer one sets the menu up again. */
  version: string
  /** Whether Boost is installed, which Sharpen needs. */
  sharpen: boolean
  /** The presets turned on in /right-click, by name. */
  presets?: readonly string[]
  /** Runs a program; install waits for it. */
  run: (cmd: string, args: string[]) => Promise<void>
}

export interface MenuState {
  version: string
  /** The Forge the launcher was written for, and the Node that runs it. */
  forge: string
  node: string
  execArgv: string[]
  xdgConfigHome?: string
  /** The presets the menu was written with, so a change made elsewhere is written at the next start. */
  presets?: string[]
}

/** True when `state` was written for this Forge, Node and config folder: nothing to redo. */
export const stateMatches = (state: MenuState, e: MenuEnv) =>
  state.version === e.version &&
  state.forge === e.forge &&
  state.node === e.node &&
  state.execArgv.join('\0') === e.execArgv.join('\0') &&
  state.xdgConfigHome === e.xdgConfigHome &&
  (state.presets ?? []).join('\0') === (e.presets ?? []).join('\0')

const PBS = '/System/Library/CoreServices/pbs'
const stateFile = (e: Pick<MenuEnv, 'menuDir'>) => join(e.menuDir, 'state.json')
const servicesDir = (e: Pick<MenuEnv, 'home'>) => join(e.home, 'Library', 'Services')

/** Every bundle Forge has ever named, Sharpen included, so a removal finds them all. */
const allBundles = (e: Pick<MenuEnv, 'home'>) =>
  menuItems({ sharpen: true }).map((i) => join(servicesDir(e), `${i.label}.workflow`))

/** Every service Forge has ever named, for the services settings. */
const allServices = () => menuItems({ sharpen: true }).map(serviceKey)

/**
 * The Quick Actions Forge wrote that are in the Services folder now, found
 * by their bundle ID: a preset's item is named after a preset that may since
 * have been turned off, renamed or deleted, so no fixed list finds it.
 */
function forgeBundles(e: Pick<MenuEnv, 'home'>): { path: string; key: string }[] {
  let names: string[]
  try {
    names = readdirSync(servicesDir(e)).filter((n) => n.endsWith('.workflow'))
  } catch {
    return []
  }
  return names.flatMap((n) => {
    const path = join(servicesDir(e), n)
    try {
      const info = readFileSync(join(path, 'Contents', 'Info.plist'), 'utf8')
      const id = /<key>CFBundleIdentifier<\/key>\s*<string>([^<]*)<\/string>/.exec(info)?.[1]
      const label = /<key>CFBundleName<\/key>\s*<string>([^<]*)<\/string>/.exec(info)?.[1]
      if (!id?.startsWith(BUNDLE_PREFIX) || label === undefined) return []
      const unxml = (t: string) =>
        t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      return [{ path, key: `${id} - ${unxml(label)} - runWorkflowAsService` }]
    } catch {
      return []
    }
  })
}

/** What install last recorded, or undefined when the menu is not set up. */
export function readState(e: Pick<MenuEnv, 'menuDir'>): MenuState | undefined {
  try {
    return JSON.parse(readFileSync(stateFile(e), 'utf8')) as MenuState
  } catch {
    return undefined
  }
}

export const isInstalled = (e: Pick<MenuEnv, 'menuDir'>) => readState(e) !== undefined

const write = (path: string, data: string | Buffer) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, data)
}

/**
 * Writes the menu for this machine, replacing whatever Forge wrote before:
 * an item that went (Sharpen, with Boost removed) does not linger. A
 * platform with no menu to add to is left untouched.
 */
export async function installMenu(e: MenuEnv): Promise<void> {
  if (!hasMenu(e.platform)) return
  const items = menuItems({ sharpen: e.sharpen, presets: e.presets ?? [] })
  mkdirSync(e.menuDir, { recursive: true })
  if (e.platform === 'linux') {
    await installLinux(e, items)
  } else if (e.platform === 'darwin') {
    const launcher = join(e.menuDir, 'run')
    const presetItems = items.filter((i) => i.preset !== undefined)
    const presetBundles = presetItems.map((i) =>
      join(servicesDir(e), workflowFiles(i, launcher).name),
    )
    write(
      launcher,
      macLauncher({
        ...e,
        bundles: [...allBundles(e), ...presetBundles],
        services: [...allServices(), ...presetItems.map(serviceKey)],
      }),
    )
    chmodSync(launcher, 0o755)
    const before = forgeBundles(e)
    for (const bundle of [...allBundles(e), ...before.map((b) => b.path)])
      rmSync(bundle, { recursive: true, force: true })
    const tiffs = new Map<MenuPaint, Buffer>()
    // Loaded here, not at the top: `forge uninstall` imports this module, and
    // on Windows a loaded sharp holds its DLL open against npm deleting it.
    const { default: sharp } = await import('sharp')
    for (const item of items) {
      if (!tiffs.has(item.paint))
        tiffs.set(
          item.paint,
          await sharp(await renderIcon(item.paint, 64))
            .tiff()
            .toBuffer(),
        )
      const { name, files } = workflowFiles(item, launcher)
      const root = join(servicesDir(e), name)
      for (const [rel, text] of Object.entries(files)) write(join(root, rel), text)
      write(
        join(root, 'Contents', 'Resources', `${ICON_NAME}.tiff`),
        tiffs.get(item.paint) as Buffer,
      )
    }
    // Without this the items reach only the Services menu, not the right-click menu.
    const on = items.map(serviceKey)
    const known = new Set([...allServices(), ...before.map((b) => b.key)])
    await e.run(...servicesStatus({ on, off: [...known].filter((k) => !on.includes(k)) }))
    await e.run(PBS, ['-update'])
  } else {
    write(join(e.menuDir, 'run.mjs'), windowsLauncher({ ...e, keys: registryRoots() }))
    for (const paint of PAINTS) {
      const images = await Promise.all(
        [16, 24, 32, 48, 256].map(async (size) => ({ size, png: await renderIcon(paint, size) })),
      )
      write(join(e.menuDir, icoName({ paint })), icoFrom(images))
    }
    write(join(e.menuDir, 'forge.png'), await renderIcon('forge', 256))
    await e.run('powershell.exe', powershell(registryScript(registryPlan({ ...e, items }))))
  }
  const state: MenuState = {
    version: e.version,
    forge: e.forge,
    node: e.node,
    execArgv: e.execArgv,
    ...(e.xdgConfigHome === undefined ? {} : { xdgConfigHome: e.xdgConfigHome }),
    ...(e.presets && e.presets.length > 0 ? { presets: [...e.presets] } : {}),
  }
  write(stateFile(e), JSON.stringify(state))
}

/** Whether Forge has a right-click menu to add to on `platform`. */
export const hasMenu = (platform: NodeJS.Platform) =>
  platform === 'darwin' || platform === 'win32' || platform === 'linux'

const PAINTS: MenuPaint[] = ['forge', 'convert', 'compress', 'edit', 'pdf']

const dirsOf = (e: MenuEnv) =>
  linuxDirs({
    home: e.home,
    ...(e.xdgDataHome === undefined ? {} : { xdgDataHome: e.xdgDataHome }),
    ...(e.xdgConfigHome === undefined ? {} : { xdgConfigHome: e.xdgConfigHome }),
    ...(e.xdgConfigDirs === undefined ? {} : { xdgConfigDirs: e.xdgConfigDirs }),
  })

/** Every file Forge may have written for a Linux file manager, Sharpen's included. */
/**
 * Every file Forge may have written for the file managers: the built-in
 * items by name, and whatever else is in Forge's own Nautilus folder or
 * named as Forge's Nemo actions are (a preset's, turned off since).
 * `removeOwned` still deletes only those carrying Forge's marker.
 */
function linuxFiles(d: LinuxDirs): string[] {
  const all = menuItems({ sharpen: true })
  const order = all.map((i) => i.action)
  const listed = (dir: string, keep: (name: string) => boolean) => {
    try {
      return readdirSync(dir)
        .filter(keep)
        .map((name) => join(dir, name))
    } catch {
      return []
    }
  }
  return [
    ...new Set([
      ...all.map((i) => join(nautilusDir(d), nautilusName(i))),
      ...listed(nautilusDir(d), () => true),
      ...all.map((i) => join(nemoDir(d), nemoName(i, order))),
      ...listed(nemoDir(d), (name) => name.startsWith('forge-') && name.endsWith('.nemo_action')),
      ...DOLPHIN_KINDS.map((k) => join(dolphinDir(d), dolphinName(k))),
    ]),
  ]
}

const readText = (path: string) => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/** Deletes each of `paths` that Forge wrote: one without Forge's marker is someone else's. */
function removeOwned(paths: string[]) {
  for (const path of paths) if (readText(path)?.includes(MARKER)) rmSync(path, { force: true })
}

/** The folders install made for the file managers' menus, kept so removal can take them back out. */
const madeFile = (e: Pick<MenuEnv, 'menuDir'>) => join(e.menuDir, 'made.json')
const made = (e: Pick<MenuEnv, 'menuDir'>): string[] => {
  try {
    return JSON.parse(readFileSync(madeFile(e), 'utf8')) as string[]
  } catch {
    return []
  }
}

/** Makes `dir` and any parents, recording the ones that were not there. */
function makeDir(e: Pick<MenuEnv, 'menuDir'>, dir: string) {
  const fresh: string[] = []
  for (let d = dir; !existsSync(d) && dirname(d) !== d; d = dirname(d)) fresh.push(d)
  if (fresh.length === 0) return
  mkdirSync(dir, { recursive: true })
  write(madeFile(e), JSON.stringify([...new Set([...made(e), ...fresh])]))
}

/** Removes each folder that is empty, deepest first. */
function removeEmpty(dirs: string[]) {
  for (const dir of [...dirs].sort((a, b) => b.length - a.length))
    try {
      rmdirSync(dir)
    } catch {}
}

const thunarSeed = (e: Pick<MenuEnv, 'menuDir'>) => join(e.menuDir, 'thunar-seed.xml')

/**
 * Forge's actions into Thunar's uca.xml, beside the user's own. With no
 * uca.xml yet, Thunar is reading the actions it ships with, so the new file
 * starts as a copy of those (only for a Thunar that is installed: any other
 * would take the file as the user's and never read its defaults). What it
 * started as is kept, so removing Forge's actions can tell the file is as
 * Forge found it and delete it. A uca.xml Forge cannot read is left alone.
 */
async function installThunar(e: MenuEnv, d: LinuxDirs, items: MenuItem[], launcher: string) {
  const file = thunarFile(d)
  let current = readText(file)
  if (current === undefined) {
    if (!hasThunar(d, e.path, existsSync)) return
    current =
      thunarDefaults(d)
        .map(readText)
        .find((t) => t !== undefined && mergeUca(t, '') !== undefined) ?? EMPTY_UCA
    write(thunarSeed(e), current)
    makeDir(e, dirname(file))
  }
  const merged = mergeUca(current, thunarActions(items, { launcher, menuDir: e.menuDir }))
  if (merged !== undefined && merged !== readText(file))
    await writeAtomic(file, Buffer.from(merged))
}

/** Forge's actions back out of uca.xml, and the file gone if Forge made it and nothing else changed. */
async function removeThunar(e: MenuEnv, d: LinuxDirs) {
  const file = thunarFile(d)
  const current = readText(file)
  if (current === undefined || !current.includes(`<unique-id>${MARKER}-`)) return
  const stripped = stripUca(current)
  if (stripped === readText(thunarSeed(e))) rmSync(file, { force: true })
  else await writeAtomic(file, Buffer.from(stripped))
}

/** Writes `text` atomically, as an executable when `exec`. */
async function writeFile(path: string, text: string, exec = false) {
  await writeAtomic(path, Buffer.from(text))
  if (exec) chmodSync(path, 0o755)
}

async function installLinux(e: MenuEnv, items: MenuItem[]) {
  const d = dirsOf(e)
  const launcher = join(e.menuDir, 'run')
  for (const paint of PAINTS)
    write(join(e.menuDir, pngName({ paint })), await renderIcon(paint, 128))
  // What an earlier install wrote goes first, so an item that went (Sharpen,
  // with Boost removed) does not linger.
  removeOwned(linuxFiles(d))
  const order = menuItems({ sharpen: true }).map((i) => i.action)
  makeDir(e, nautilusDir(d))
  for (const item of items)
    await writeFile(join(nautilusDir(d), nautilusName(item)), nautilusScript(item, launcher), true)
  makeDir(e, nemoDir(d))
  for (const item of items)
    await writeFile(join(nemoDir(d), nemoName(item, order)), nemoAction(item, launcher))
  makeDir(e, dolphinDir(d))
  for (const kind of DOLPHIN_KINDS) {
    const menu = dolphinMenu(kind, items, { launcher, menuDir: e.menuDir })
    // KDE 6 runs a service menu outside the system's folders only if it is executable.
    if (menu !== undefined) await writeFile(join(dolphinDir(d), dolphinName(kind)), menu, true)
  }
  await installThunar(e, d, items, launcher)
  // Last, once every folder it may have to take away is known.
  write(
    launcher,
    linuxLauncher({
      ...e,
      files: linuxFiles(d),
      folders: [...new Set([nautilusDir(d), ...made(e)])].sort((a, b) => b.length - a.length),
      marker: MARKER,
      thunar: { file: thunarFile(d), seed: thunarSeed(e) },
    }),
  )
  chmodSync(launcher, 0o755)
}

async function removeLinux(e: MenuEnv) {
  const d = dirsOf(e)
  removeOwned(linuxFiles(d))
  await removeThunar(e, d)
  removeEmpty([nautilusDir(d), ...made(e)])
  rmSync(e.menuDir, { recursive: true, force: true })
}

/** Takes everything install wrote back out: the items, the keys, Forge's menu folder. */
export async function removeMenu(e: MenuEnv): Promise<void> {
  if (e.platform === 'linux') {
    await removeLinux(e)
  } else if (e.platform === 'darwin') {
    const before = forgeBundles(e)
    for (const bundle of [...allBundles(e), ...before.map((b) => b.path)])
      rmSync(bundle, { recursive: true, force: true })
    rmSync(e.menuDir, { recursive: true, force: true })
    const off = new Set([...allServices(), ...before.map((b) => b.key)])
    await e.run(...servicesStatus({ on: [], off: [...off] }))
    await e.run(PBS, ['-update'])
  } else if (e.platform === 'win32') {
    rmSync(e.menuDir, { recursive: true, force: true })
    await e.run('powershell.exe', powershell(registryScript([])))
  }
}

const powershell = (script: string) => [
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-Command',
  script,
]

/** `run` for real: the program, no shell, a minute at most, errors passed up. */
export const runProgram = (cmd: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    execFile(cmd, args, { timeout: 60_000, windowsHide: true }, (err) =>
      err ? reject(err) : resolve(),
    )
  })
