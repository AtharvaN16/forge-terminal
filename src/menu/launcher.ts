import { servicesStatus, shellQuote } from './mac.js'
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
    /** Every Forge service key, switched off in the services settings with the bundles. */
    services: string[]
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
  const [cmd, args] = servicesStatus({ on: [], off: o.services, osascript })
  const switchOff = [cmd, ...args].map(shellQuote).join(' ')
  const say = (title: string, body: string) =>
    `${shellQuote(osascript)} -e 'display notification "${body}" with title "${title}"'`
  return `#!/bin/sh
# Forge's right-click menu. Rewritten by Forge whenever it sets the menu up.
if [ ! -f ${shellQuote(o.forge)} ]; then
  # Forge is gone: take its menu with it, and say so once.
${o.bundles.map((b) => `  rm -rf ${shellQuote(b)}`).join('\n')}
  rm -rf ${shellQuote(o.menuDir)}
  ${switchOff}
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

/**
 * A shell function `say TITLE BODY` posting a notification: notify-send
 * where libnotify's tool is installed, else gdbus straight to the
 * notification service, else nothing (notify.ts does the same from Node).
 * The titles it is given are Forge's own, with no quotes in them.
 */
function linuxSay(): string {
  const gdbus = [
    'gdbus call --session --dest org.freedesktop.Notifications',
    '--object-path /org/freedesktop/Notifications',
    '--method org.freedesktop.Notifications.Notify',
    `Forge 0 "''" "\\"$1\\"" "\\"$2\\"" '[]' '{}' -1`,
  ].join(' ')
  return `say() {
  if command -v notify-send >/dev/null 2>&1; then
    notify-send --app-name=Forge -- "$1" "$2" >/dev/null 2>&1
  elif command -v gdbus >/dev/null 2>&1; then
    ${gdbus} >/dev/null 2>&1
  fi
}`
}

/**
 * The Linux launcher: the Mac's shell script, for the file managers to call.
 * Forge gone, it deletes each file it wrote for a file manager (only one
 * that still carries the marker) and takes Forge's actions back out of
 * Thunar's uca.xml. That last is awk, so it needs no Node: each `<action>`
 * entry is held until its end and dropped if it is Forge's. A uca.xml Forge
 * made, left as Forge first wrote it, goes, so Thunar reads its own
 * defaults again.
 */
export function linuxLauncher(
  o: Common & {
    /** Every file Forge may have written for a file manager. */
    files: string[]
    /** Folders Forge made for those files, removed when left empty. */
    folders: string[]
    marker: string
    /**
     * Thunar's uca.xml when Forge's actions are in it, and the copy of what
     * Forge first wrote there when it made the file: with Forge's actions
     * out again and nothing else changed, the file goes.
     */
    thunar?: { file: string; seed: string }
    xdgConfigHome?: string
  },
): string {
  const run = [o.node, ...o.execArgv, o.forge].map(shellQuote).join(' ')
  const files = o.files.map(shellQuote).join(' \\\n    ')
  let thunar = ''
  if (o.thunar !== undefined) {
    const uca = shellQuote(o.thunar.file)
    const tmp = shellQuote(`${o.thunar.file}.forge-tmp`)
    const seed = shellQuote(o.thunar.seed)
    const awk = [
      '/<action>/ { held = ""; holding = 1 }',
      `holding { held = held $0 "\\n"; if (/<\\/action>/) { holding = 0; if (held !~ /<unique-id>${o.marker}-/) printf "%s", held }; next }`,
      '{ print }',
    ].join('\n')
    thunar = `  if [ -f ${uca} ] && grep -qF '<unique-id>${o.marker}-' ${uca}; then
    awk ${shellQuote(awk)} ${uca} > ${tmp} && mv -f ${tmp} ${uca}
    if [ -f ${seed} ] && cmp -s ${seed} ${uca}; then rm -f ${uca}; fi
  fi
`
  }
  return `#!/bin/sh
# Forge's right-click menu. Rewritten by Forge whenever it sets the menu up.
${linuxSay()}
if [ ! -f ${shellQuote(o.forge)} ]; then
  # Forge is gone: take its menu with it, and say so once.
  for f in ${files}; do
    if [ -f "$f" ] && grep -qF ${shellQuote(o.marker)} "$f"; then rm -f "$f"; fi
  done
${o.folders.map((d) => `  rmdir ${shellQuote(d)} 2>/dev/null`).join('\n')}
${thunar}  rm -rf ${shellQuote(o.menuDir)}
  say ${shellQuote(GONE_TITLE)} ${shellQuote(GONE_BODY)}
  exit 0
fi
if [ ! -x ${shellQuote(o.node)} ]; then
  say ${shellQuote(NO_NODE_TITLE)} ${shellQuote(NO_NODE_BODY)}
  exit 1
fi
${o.xdgConfigHome === undefined ? '' : `export XDG_CONFIG_HOME=${shellQuote(o.xdgConfigHome)}\n`}exec ${run} menu run "$@"
`
}
