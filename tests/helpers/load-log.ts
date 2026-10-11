import { execFile } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const RECORDER = pathToFileURL(join(process.cwd(), 'tests', 'helpers', 'load-recorder.mjs')).href

export interface LoadRun {
  exitCode: number
  stdout: string
  stderr: string
  /** Every module URL the process resolved, `node:` built-ins included. */
  urls: string[]
}

/**
 * Runs `node <args>` with a resolve hook that records every module the
 * process loads.
 *
 * This is how a stray static import gets caught. Without it the import only
 * costs 100 ms, and nothing in the suite notices (spec §7). `tsx` is on by
 * default so source can be run directly, which needs cwd to be the repo root.
 * Pass `tsx: false` to run a built bundle with plain node.
 */
export async function modulesLoaded(
  args: string[],
  opts: { tsx?: boolean; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<LoadRun> {
  const log = join(await mkdtemp(join(tmpdir(), 'forge-load-')), 'loaded.json')
  const preload = ['--import', RECORDER, ...(opts.tsx === false ? [] : ['--import', 'tsx'])]
  let exitCode = 0
  let stdout = ''
  let stderr = ''
  try {
    const result = await run(process.execPath, [...preload, ...args], {
      cwd: opts.cwd ?? process.cwd(),
      env: { ...process.env, ...opts.env, FORGE_LOAD_LOG: log },
    })
    stdout = result.stdout
    stderr = result.stderr
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string }
    exitCode = err.code ?? -1
    stdout = err.stdout ?? ''
    stderr = err.stderr ?? ''
  }
  const urls = JSON.parse(await readFile(log, 'utf8')) as string[]
  return { exitCode, stdout, stderr, urls }
}

/** Package names (`sharp`, `@hyzyla/pdfium`) among the URLs, read from each one's last `node_modules/` segment. */
export function packagesIn(urls: readonly string[]): Set<string> {
  const names = new Set<string>()
  for (const url of urls) {
    const at = url.lastIndexOf('/node_modules/')
    if (at === -1) continue
    const [first = '', second = ''] = url.slice(at + '/node_modules/'.length).split('/')
    names.add(first.startsWith('@') ? `${first}/${second}` : first)
  }
  return names
}
