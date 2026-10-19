import { execFile } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { icoFrom, renderIcon } from './icon.js'
import { type MenuPaint, menuItems } from './items.js'
import { macLauncher, windowsLauncher } from './launcher.js'
import { ICON_NAME, serviceKey, servicesStatus, workflowFiles } from './mac.js'
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
  /** Forge's version, recorded so a newer one sets the menu up again. */
  version: string
  /** Whether Boost is installed, which Sharpen needs. */
  sharpen: boolean
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
}

/** True when `state` was written for this Forge, Node and config folder: nothing to redo. */
export const stateMatches = (state: MenuState, e: MenuEnv) =>
  state.version === e.version &&
  state.forge === e.forge &&
  state.node === e.node &&
  state.execArgv.join('\0') === e.execArgv.join('\0') &&
  state.xdgConfigHome === e.xdgConfigHome

const PBS = '/System/Library/CoreServices/pbs'
const stateFile = (e: Pick<MenuEnv, 'menuDir'>) => join(e.menuDir, 'state.json')
const servicesDir = (e: Pick<MenuEnv, 'home'>) => join(e.home, 'Library', 'Services')

/** Every bundle Forge has ever named, Sharpen included, so a removal finds them all. */
const allBundles = (e: Pick<MenuEnv, 'home'>) =>
  menuItems({ sharpen: true }).map((i) => join(servicesDir(e), `${i.label}.workflow`))

/** Every service Forge has ever named, for the services settings. */
const allServices = () => menuItems({ sharpen: true }).map(serviceKey)

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
  if (e.platform !== 'darwin' && e.platform !== 'win32') return
  const items = menuItems({ sharpen: e.sharpen })
  mkdirSync(e.menuDir, { recursive: true })
  if (e.platform === 'darwin') {
    const launcher = join(e.menuDir, 'run')
    write(launcher, macLauncher({ ...e, bundles: allBundles(e), services: allServices() }))
    chmodSync(launcher, 0o755)
    for (const bundle of allBundles(e)) rmSync(bundle, { recursive: true, force: true })
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
    await e.run(...servicesStatus({ on, off: allServices().filter((k) => !on.includes(k)) }))
    await e.run(PBS, ['-update'])
  } else {
    write(join(e.menuDir, 'run.mjs'), windowsLauncher({ ...e, keys: registryRoots() }))
    const paints: MenuPaint[] = ['forge', 'convert', 'compress', 'edit', 'pdf']
    for (const paint of paints) {
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
  }
  write(stateFile(e), JSON.stringify(state))
}

/** Takes everything install wrote back out: the items, the keys, Forge's menu folder. */
export async function removeMenu(e: MenuEnv): Promise<void> {
  if (e.platform === 'darwin') {
    for (const bundle of allBundles(e)) rmSync(bundle, { recursive: true, force: true })
    rmSync(e.menuDir, { recursive: true, force: true })
    await e.run(...servicesStatus({ on: [], off: allServices() }))
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
