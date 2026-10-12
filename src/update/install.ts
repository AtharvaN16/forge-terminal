import { spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { updateDenied, updateFailed, updateUnavailable } from '../core/errors.js'

/**
 * Installs a newer Forge over this one, when asked (/update's ↵, `forge
 * update`). It runs the npm that sits beside the node running Forge, so it
 * replaces this very install rather than whichever npm is first on PATH, and
 * it installs exactly the version that was offered. Nothing here prints; npm's
 * output is kept only to explain a failure.
 */
export interface RunResult {
  code: number | null
  /** stdout and stderr together. */
  output: string
}
export type Run = (cmd: string, args: string[], signal?: AbortSignal) => Promise<RunResult>

/** `npm i -g` puts a package in `<prefix>/lib/node_modules/<name>`; npx keeps its own cache. */
export function installedGlobally(script: string | undefined): boolean {
  if (script === undefined) return false
  return /\/lib\/node_modules\/forge-terminal\//.test(script) && !script.includes('/_npx/')
}

/**
 * The file this Forge runs from. `process.argv[1]` is the command as typed —
 * npm's bin symlink, `/opt/homebrew/bin/forge` — so it is followed to the
 * real file in node_modules.
 */
export function runningScript(argv1: string | undefined): string | undefined {
  if (argv1 === undefined) return undefined
  try {
    return realpathSync(argv1)
  } catch {
    return argv1
  }
}

export function npmBeside(execPath: string, exists: (p: string) => boolean = existsSync): string {
  const beside = join(dirname(execPath), 'npm')
  return exists(beside) ? beside : 'npm'
}

const runProcess: Run = (cmd, args, signal) =>
  new Promise((resolve) => {
    let output = ''
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(signal ? { signal } : {}),
    })
    child.stdout.setEncoding('utf8').on('data', (d: string) => {
      output += d
    })
    child.stderr.setEncoding('utf8').on('data', (d: string) => {
      output += d
    })
    child.on('error', (e) => resolve({ code: null, output: `${output}\n${e.message}` }))
    child.on('close', (code) => resolve({ code, output }))
  })

function lastWords(output: string): string {
  const lines = output
    .split('\n')
    .map((l) => l.replace(/^npm (error|ERR!)\s*/, '').trim())
    .filter((l) => l !== '' && !/^(code|errno|syscall|path|dest|A complete log)/.test(l))
  return lines.at(-1) ?? 'npm exited without saying why'
}

export async function installUpdate(
  version: string,
  opts: { run?: Run; npm?: string; script?: string; signal?: AbortSignal } = {},
): Promise<void> {
  const script = opts.script ?? runningScript(process.argv[1])
  if (!installedGlobally(script)) throw updateUnavailable(version)
  const npm = opts.npm ?? npmBeside(process.execPath)
  const run = opts.run ?? runProcess
  const { code, output } = await run(
    npm,
    ['install', '--global', `forge-terminal@${version}`],
    opts.signal,
  )
  if (code === 0) return
  if (/EACCES|EPERM|permission denied/i.test(output)) throw updateDenied(version)
  throw updateFailed(version, lastWords(output))
}
