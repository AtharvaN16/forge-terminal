import { lastWords } from '../update/install.js'
import { type MenuEnv, removeMenu } from './install.js'

/**
 * `forge uninstall`. npm runs nothing when a package is removed, so Forge's
 * right-click items would be left behind by `npm uninstall -g`. This takes
 * them out first, then has npm remove Forge. (The launcher clears the items
 * away on the next click for anyone who uninstalls with npm directly.)
 */
export async function uninstallForge(
  e: MenuEnv,
  o: {
    /** Runs npm with these arguments: its exit code and what it printed. */
    npm: (args: string[]) => Promise<{ code: number | null; output: string }>
    out: (line: string) => void
  },
): Promise<0 | 1> {
  await removeMenu(e)
  o.out('✓ Removed Forge from the right-click menu')
  const { code, output } = await o.npm(['uninstall', '--global', 'forge-terminal'])
  if (code === 0) {
    o.out('✓ Uninstalled forge-terminal')
    return 0
  }
  o.out(`✕ npm could not uninstall forge-terminal: ${lastWords(output)}`)
  return 1
}
