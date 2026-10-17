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

/** The Mac launcher, a POSIX shell script the Quick Actions call with the action and files. */
export function macLauncher(o: Common & { bundles: string[] }): string {
  const run = [o.node, ...o.execArgv, o.forge].map(shellQuote).join(' ')
  return `#!/bin/sh
# Forge's right-click menu. Rewritten by Forge whenever it sets the menu up.
if [ -f ${shellQuote(o.forge)} ] && [ -x ${shellQuote(o.node)} ]; then
  exec ${run} menu run "$@"
fi
# Forge is gone: take its menu with it, and say so once.
${o.bundles.map((b) => `rm -rf ${shellQuote(b)}`).join('\n')}
rm -rf ${shellQuote(o.menuDir)}
/System/Library/CoreServices/pbs -update
/usr/bin/osascript -e 'display notification "${GONE_BODY}" with title "${GONE_TITLE}"'
`
}

/**
 * The Windows launcher, a Node script the Explorer items run under a hidden
 * console. Node rather than a batch file: a batch file opens a console
 * window, and Sharpen is meant to run with none.
 */
export function windowsLauncher(o: Common & { keys: string[] }): string {
  return `// Forge's right-click menu. Rewritten by Forge whenever it sets the menu up.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'

const FORGE = ${JSON.stringify(o.forge)}
const ARGS = ${JSON.stringify(o.execArgv)}
const MENU = ${JSON.stringify(o.menuDir)}
const KEYS = ${JSON.stringify(o.keys)}

if (existsSync(FORGE)) {
  const child = spawn(process.execPath, [...ARGS, FORGE, 'menu', 'run', ...process.argv.slice(2)], {
    stdio: 'inherit',
    windowsHide: true,
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
