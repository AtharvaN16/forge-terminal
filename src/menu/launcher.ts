import { shellQuote } from './mac.js'
import { toastScript } from './notify.js'

/**
 * What every menu item calls: a small script in Forge's config folder that
 * knows where Node and Forge are, rewritten whenever Forge sets the menu up.
 *
 * It is also the menu's safety net for uninstalling. npm runs nothing when a
 * package is removed (uninstall scripts went in npm 7), so someone who skips
 * `forge uninstall` leaves the items behind. The first click on one finds
 * Forge gone, removes every Forge item and this folder, and says so once.
 */

const GONE_TITLE = 'Forge was uninstalled'
const GONE_BODY = 'Its menu items are removed.'
const NO_NODE_TITLE = 'Forge could not start'
const NO_NODE_BODY = 'Run forge in a terminal once to set its menu up again.'

interface Common {
  /** Node, as `process.execPath`. */
  node: string
  /** Node's own flags, so a source checkout run through tsx works the same way. */
  execArgv: string[]
  /** Forge's entry script. */
  forge: string
  /** The folder holding this launcher and the icons, removed with the items. */
  menuDir: string
}

/**
 * The Mac launcher, a POSIX shell script the Quick Actions call with the
 * action and files.
 *
 * Only Forge's own script being gone means it was uninstalled. Node can move
 * under a Forge that is still there (a Node upgrade that the stable path in
 * node-path.ts did not survive); then the menu is kept, and the next `forge`
 * writes the launcher again.
 */
export function macLauncher(
  o: Common & {
    bundles: string[]
    /** Config folder override to carry into the run, as the user's shell had it. */
    xdgConfigHome?: string
    /** Stand-ins for tests: the notifier and Finder's service refresher. */
    tools?: { osascript: string; pbs: string }
  },
): string {
  const { osascript, pbs } = o.tools ?? {
    osascript: '/usr/bin/osascript',
    pbs: '/System/Library/CoreServices/pbs',
  }
  const run = [o.node, ...o.execArgv, o.forge].map(shellQuote).join(' ')
  const say = (title: string, body: string) =>
    `${shellQuote(osascript)} -e 'display notification "${body}" with title "${title}"'`
  return `#!/bin/sh
# Forge's right-click menu. Rewritten by Forge whenever it sets the menu up.
if [ ! -f ${shellQuote(o.forge)} ]; then
  # Forge is gone: take its menu with it, and say so once.
${o.bundles.map((b) => `  rm -rf ${shellQuote(b)}`).join('\n')}
  rm -rf ${shellQuote(o.menuDir)}
  ${shellQuote(pbs)} -update
  ${say(GONE_TITLE, GONE_BODY)}
  exit 0
fi
if [ ! -x ${shellQuote(o.node)} ]; then
  ${say(NO_NODE_TITLE, NO_NODE_BODY)}
  exit 1
fi
${o.xdgConfigHome === undefined ? '' : `export XDG_CONFIG_HOME=${shellQuote(o.xdgConfigHome)}\n`}exec ${run} menu run "$@"
`
}

/**
 * The Windows launcher, a Node script the Explorer items run under a hidden
 * console. Node rather than a batch file: a batch file opens a console
 * window, and Sharpen is meant to run with none.
 */
export function windowsLauncher(o: Common & { keys: string[]; xdgConfigHome?: string }): string {
  const env = o.xdgConfigHome === undefined ? {} : { XDG_CONFIG_HOME: o.xdgConfigHome }
  return `// Forge's right-click menu. Rewritten by Forge whenever it sets the menu up.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'

const FORGE = ${JSON.stringify(o.forge)}
const ARGS = ${JSON.stringify(o.execArgv)}
const MENU = ${JSON.stringify(o.menuDir)}
const KEYS = ${JSON.stringify(o.keys)}
const ENV = ${JSON.stringify(env)}

if (existsSync(FORGE)) {
  const child = spawn(process.execPath, [...ARGS, FORGE, 'menu', 'run', ...process.argv.slice(2)], {
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, ...ENV },
  })
  child.on('exit', (code) => process.exit(code ?? 0))
} else {
  // Forge is gone: say so while its app ID still exists, then take the menu with it.
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ${JSON.stringify(toastScript(GONE_TITLE, GONE_BODY))}], { windowsHide: true })
  } catch {}
  for (const key of KEYS) {
    try {
      execFileSync('reg.exe', ['delete', key, '/f'], { windowsHide: true, stdio: 'ignore' })
    } catch {}
  }
  rmSync(MENU, { recursive: true, force: true })
}
`
}
