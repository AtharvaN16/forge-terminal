import { execFile } from 'node:child_process'
import { win32 } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * `explorer.exe` exits 1 even when it did what it was asked, so a numeric exit
 * code is not a failure. A string code (`ENOENT`) means it never ran at all.
 */
async function runExplorer(args: string[]): Promise<void> {
  try {
    await run('explorer.exe', args)
  } catch (err) {
    if (typeof (err as { code?: unknown }).code === 'number') return
    throw err
  }
}

/**
 * Explorer wants backslashes: a path with a `/` in it (the shell builds
 * `<folder>/<name>`, and globbed paths come back as `C:/…`) does not select
 * the file, and Explorer opens Documents instead.
 */
const forExplorer = (path: string) => win32.normalize(path)

/** Opens a file with its default application. */
export async function openPath(
  path: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform === 'win32') return runExplorer([forExplorer(path)])
  await run('open', [path])
}

/** Reveals a file in Finder (Explorer on Windows) with it selected. */
export async function revealPath(
  path: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  // `/select,` and the path as two arguments: Node quotes only the path when
  // it has a space (`/select, "C:\My Files\a.png"`), the form Explorer
  // honours. Quoted whole (`"/select,C:\My Files\a.png"`) it is ignored.
  if (platform === 'win32') return runExplorer(['/select,', forExplorer(path)])
  await run('open', ['-R', path])
}

/**
 * What the reveal action is called here. Finder is a macOS name, and Forge is
 * a macOS tool — but the wording should not be a lie anywhere it happens to
 * run, so the label follows the platform rather than being hardcoded.
 */
export function revealLabel(platform: string = process.platform): string {
  if (platform === 'darwin') return 'Show in Finder'
  if (platform === 'win32') return 'Show in Explorer'
  return 'Show in file manager'
}
