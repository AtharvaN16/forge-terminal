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
