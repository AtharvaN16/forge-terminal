import { execFile, spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { dirname, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'
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

/**
 * macOS `open` fails on a missing file, which the shell shows as an error
 * block. Explorer exits 1 either way, so `runExplorer` cannot tell, and a file
 * that was moved or deleted would fail silently (or open Documents). Look
 * first, and fail the way `open` does.
 */
async function assertExists(path: string): Promise<void> {
  try {
    await access(path)
  } catch {
    throw new Error(`The file ${path} does not exist.`)
  }
}

/**
 * Linux: xdg-open, started and let go. Where no desktop answers for it,
 * xdg-open runs the viewer itself and waits for it to close, and Forge must
 * not wait with it. So it cannot say whether the file opened; the file is
 * looked for first, as on Windows, and only xdg-open being missing fails.
 */
function xdgOpen(target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('xdg-open', [target], { detached: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

/** Opens a file with its default application. */
export async function openPath(
  path: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform === 'win32') {
    await assertExists(path)
    return runExplorer([forExplorer(path)])
  }
  if (platform === 'linux') {
    await assertExists(path)
    return xdgOpen(path)
  }
  await run('open', [path])
}

/** Opens a web address in the default browser. */
export async function openUrl(
  url: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform === 'win32') return runExplorer([url])
  if (platform === 'linux') return xdgOpen(url)
  await run('open', [url])
}

/**
 * Asks the file manager to show `path` selected, through the freedesktop
 * FileManager1 interface that Nautilus, Nemo, Dolphin, Thunar and Caja
 * answer on D-Bus: by gdbus, or dbus-send where GLib's tool is not
 * installed. Rejects when neither can, or no file manager answers.
 */
async function showItem(path: string): Promise<void> {
  // dbus-send separates an array's items with commas, so one in the name is escaped.
  const uri = pathToFileURL(path).href.replace(/,/g, '%2C')
  const call = ['/org/freedesktop/FileManager1', 'org.freedesktop.FileManager1.ShowItems']
  try {
    await run(
      'gdbus',
      [
        'call',
        '--session',
        '--dest',
        'org.freedesktop.FileManager1',
        '--object-path',
        call[0] as string,
        '--method',
        call[1] as string,
        `['${uri.replace(/'/g, '%27')}']`,
        "''",
      ],
      { timeout: 5000 },
    )
  } catch (err) {
    if ((err as { code?: unknown }).code !== 'ENOENT') throw err
    await run(
      'dbus-send',
      [
        '--session',
        '--print-reply',
        '--reply-timeout=5000',
        '--dest=org.freedesktop.FileManager1',
        ...call,
        `array:string:${uri}`,
        'string:',
      ],
      { timeout: 6000 },
    )
  }
}

/** Reveals a file in Finder (Explorer on Windows, the file manager on Linux) with it selected. */
export async function revealPath(
  path: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  // `/select,` and the path as two arguments: Node quotes only the path when
  // it has a space (`/select, "C:\My Files\a.png"`), the form Explorer
  // honours. Quoted whole (`"/select,C:\My Files\a.png"`) it is ignored.
  if (platform === 'win32') {
    await assertExists(path)
    return runExplorer(['/select,', forExplorer(path)])
  }
  // Linux: the file selected in the file manager when one answers on D-Bus,
  // else its folder opened, with nothing selected.
  if (platform === 'linux') {
    await assertExists(path)
    try {
      await showItem(path)
    } catch {
      await xdgOpen(dirname(path))
    }
    return
  }
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
