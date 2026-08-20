import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Opens a file with its default application. */
export async function openPath(path: string): Promise<void> {
  await run('open', [path])
}

/** Reveals a file in Finder with it selected. */
export async function revealPath(path: string): Promise<void> {
  await run('open', ['-R', path])
}

/**
 * What the reveal action is called here. Finder is a macOS name, and Forge is
 * a macOS tool — but the wording should not be a lie anywhere it happens to
 * run, so the label follows the platform rather than being hardcoded.
 */
export function revealLabel(platform: string = process.platform): string {
  if (platform === 'darwin') return 'Show in Finder'
  if (platform === 'win32') return 'Show location'
  return 'Show in file manager'
}
