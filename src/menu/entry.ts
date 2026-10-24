import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { configBase } from '../config/config-base.js'
import { isForgeError } from '../core/errors.js'
import { installed } from '../extensions/paths.js'
import { revealPath } from '../shell/reveal.js'
import { installedGlobally, npmBeside, npmCliBeside, runningScript } from '../update/install.js'
import type { MenuCommand } from './command.js'
import { gather } from './gather.js'
import { installMenu, type MenuEnv, removeMenu, runProgram } from './install.js'
import { onPath, pngName } from './linux.js'
import { stableNode } from './node-path.js'
import { notify } from './notify.js'
import { freeSharpName, runMenuAction, type SharpenResult } from './run.js'
import { ensureMenu, rememberedTerminal, rememberTerminal, resync } from './setup.js'
import { uninstallForge } from './uninstall.js'

/**
 * The right-click menu's ties to the real machine: the environment install
 * works in, how a click is run, `forge uninstall`. The logic lives in the
 * modules beside this one, each tested on its own with these passed in.
 */

const menuDir = () => join(configBase(), 'forge', 'menu')

/** This machine, this Forge. */
export async function realMenuEnv(version: string): Promise<MenuEnv> {
  return {
    platform: process.platform,
    home: homedir(),
    menuDir: menuDir(),
    node: stableNode(process.execPath, process.env.PATH),
    execArgv: process.execArgv,
    forge: runningScript(process.argv[1]) ?? '',
    ...(process.env.XDG_CONFIG_HOME ? { xdgConfigHome: process.env.XDG_CONFIG_HOME } : {}),
    ...(process.env.XDG_DATA_HOME ? { xdgDataHome: process.env.XDG_DATA_HOME } : {}),
    ...(process.env.XDG_CONFIG_DIRS ? { xdgConfigDirs: process.env.XDG_CONFIG_DIRS } : {}),
    ...(process.env.PATH ? { path: process.env.PATH } : {}),
    version,
    sharpen: (await installed('boost')) !== undefined,
    run: runProgram,
  }
}

/**
 * As the shell starts: keep the terminal it is running in, and set the menu
 * up (the first time, saying so). Off under FORGE_NO_MENU, which the test
 * suite sets, so no test ever writes to a real Finder or registry.
 */
export async function menuAtStart(version: string): Promise<string | undefined> {
  if (process.env.FORGE_NO_MENU) return undefined
  const e = await realMenuEnv(version)
  rememberTerminal(e, process.env)
  const { loadPreferences } = await import('../config/preferences.js')
  const { prefs } = await loadPreferences()
  return ensureMenu(e, {
    global: installedGlobally(e.forge, e.platform),
    enabled: prefs.rightClickMenu !== false,
  })
}

/** /right-click: whether Forge is in the right-click menu now. */
export async function menuIsOn(): Promise<boolean> {
  const { isInstalled } = await import('./install.js')
  return isInstalled(await realMenuEnv(''))
}

/**
 * /right-click's switch: puts the menu in or takes it out now, and keeps the
 * choice in the settings so every start honours it.
 */
export async function switchMenu(on: boolean): Promise<void> {
  const { VERSION } = await import('../shell/theme.js')
  const { savePreferences } = await import('../config/preferences.js')
  const e = await realMenuEnv(VERSION)
  if (on) await installMenu(e)
  else await removeMenu(e)
  await savePreferences({ rightClickMenu: on })
}

/** After an extension is added or removed: Sharpen comes and goes with Boost. Never throws. */
export async function resyncMenu(): Promise<void> {
  if (process.env.FORGE_NO_MENU) return
  try {
    await resync(await realMenuEnv(''))
  } catch {}
}

/** Sharpen one file as `forge <file> --sharpen` would: the file it wrote, or why not. */
async function sharpenFile(path: string): Promise<SharpenResult> {
  const { parseArgs } = await import('../cli/args.js')
  const { runIntent } = await import('../cli/execute.js')
  const intent = parseArgs([path, '--sharpen', '--output', freeSharpName(path)])
  const report = await runIntent(intent as Parameters<typeof runIntent>[0])
  const output = report.results[0]?.job.outputs[0]
  if (output !== undefined) return { output }
  const failure = report.failures[0]?.error
  return { error: isForgeError(failure) ? failure.detail : 'It could not be sharpened.' }
}

/** Starts a program and lets it outlive this one: a terminal window, which stays once this process exits. */
const launch = (cmd: string, args: string[]) =>
  new Promise<void>((resolve) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
    child.on('error', () => resolve())
    child.unref()
    resolve()
  })

/** `forge menu run|install|remove`. (`open` is the shell, started by index.ts.) */
export async function runMenuCommand(cmd: MenuCommand, version: string): Promise<number> {
  const e = await realMenuEnv(version)
  if (cmd.kind === 'install') {
    await installMenu(e)
    return 0
  }
  if (cmd.kind === 'remove') {
    await removeMenu(e)
    return 0
  }
  if (cmd.kind !== 'run') return 2
  // Full paths: a file manager may hand over ones relative to the folder on
  // screen, and the terminal Forge opens in starts somewhere else.
  let paths = cmd.paths.map((p) => resolve(p))
  // Explorer runs an item once per selected file; the first gathers the rest.
  if (e.platform === 'win32' && paths.length === 1) {
    const all = await gather(join(e.menuDir, 'spool'), cmd.action, paths[0] as string)
    if (all === null) return 0
    paths = all
  }
  await runMenuAction(cmd.action, paths, {
    platform: e.platform,
    self: [e.node, ...e.execArgv, e.forge],
    terminal: rememberedTerminal(e),
    launch,
    sharpen: sharpenFile,
    notify: (title, body) =>
      notify(title, body, e.platform, { icon: join(e.menuDir, pngName({ paint: 'forge' })) }),
    has: (program) => onPath(program, e.path),
    reveal: async (path) => {
      await revealPath(path, e.platform)
    },
  })
  return 0
}

/** `forge uninstall`: the menu out, then npm removes Forge. */
export async function runUninstall(version: string, out: (line: string) => void): Promise<0 | 1> {
  const e = await realMenuEnv(version)
  const npm = (args: string[]) =>
    new Promise<{ code: number | null; output: string }>((resolve) => {
      const cli = e.platform === 'win32' ? npmCliBeside(e.node) : undefined
      const [cmd, argv] = cli !== undefined ? [e.node, [cli, ...args]] : [npmBeside(e.node), args]
      let output = ''
      const child = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'] })
      child.stdout.setEncoding('utf8').on('data', (d: string) => {
        output += d
      })
      child.stderr.setEncoding('utf8').on('data', (d: string) => {
        output += d
      })
      child.on('error', (err) => resolve({ code: null, output: `${output}\n${err.message}` }))
      child.on('close', (code) => resolve({ code, output }))
    })
  return uninstallForge(e, { forgeDir: join(configBase(), 'forge'), npm, out })
}
