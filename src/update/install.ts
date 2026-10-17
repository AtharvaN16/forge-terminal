import { spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, join, win32 } from 'node:path'
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
export function installedGlobally(
  script: string | undefined,
  platform: NodeJS.Platform = process.platform,
  exists: (p: string) => boolean = existsSync,
): boolean {
  if (script === undefined) return false
  // Windows has no lib\: a global package is `<prefix>\node_modules\<name>`,
  // as a project's is, but only the global one has its forge.cmd shim in
  // <prefix> itself (a project's and npx's are in node_modules\.bin).
  if (platform === 'win32') {
    const prefix = /^(.*)[\\/]node_modules[\\/]forge-terminal[\\/]/.exec(script)?.[1]
    return prefix !== undefined && exists(win32.join(prefix, 'forge.cmd'))
  }
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

/**
 * Windows: the npm beside node.exe is `npm.cmd`, a batch shim Node will not
 * spawn without a shell (EINVAL since 20.12.2), and the bare `npm` there is
 * a POSIX shell script. So the node running Forge runs npm's own entry point
 * — what the shim runs — with no shell. Undefined when there is none there.
 */
export function npmCliBeside(
  execPath: string,
  exists: (p: string) => boolean = existsSync,
): string | undefined {
  const cli = win32.join(win32.dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  return exists(cli) ? cli : undefined
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

export function lastWords(output: string): string {
  const lines = output
    .split('\n')
    .map((l) => l.replace(/^npm (error|ERR!)\s*/, '').trim())
    .filter((l) => l !== '' && !/^(code|errno|syscall|path|dest|A complete log)/.test(l))
  return lines.at(-1) ?? 'npm exited without saying why'
}

export async function installUpdate(
  version: string,
  opts: {
    run?: Run
    npm?: string
    script?: string
    signal?: AbortSignal
    platform?: NodeJS.Platform
    exists?: (p: string) => boolean
  } = {},
): Promise<void> {
  const platform = opts.platform ?? process.platform
  if (platform === 'win32') return installOnWindows(version, opts)
  const script = opts.script ?? runningScript(process.argv[1])
  if (!installedGlobally(script, platform)) throw updateUnavailable(version)
  const npm = opts.npm ?? npmBeside(process.execPath)
  const run = opts.run ?? runProcess
  const { code, output } = await run(
    npm,
    ['install', '--global', `forge-terminal@${version}`],
    opts.signal,
  )
  if (code === 0) return
  if (/EACCES|EPERM|permission denied/i.test(output)) throw updateDenied(version, platform)
  throw updateFailed(version, lastWords(output))
}

/**
 * As above, with npm run through node (`npmCliBeside`). A refusal here is
 * rarely permission: Windows will not let npm replace the files of a Forge
 * that is running — this one, if it has loaded Sharp's DLLs, or another
 * window's — so it is said as that, without macOS's sudo.
 */
async function installOnWindows(
  version: string,
  opts: {
    run?: Run
    script?: string
    signal?: AbortSignal
    exists?: (p: string) => boolean
  },
): Promise<void> {
  const script = opts.script ?? runningScript(process.argv[1])
  if (!installedGlobally(script, 'win32', opts.exists)) throw updateUnavailable(version)
  const cli = npmCliBeside(process.execPath, opts.exists)
  if (cli === undefined) throw updateFailed(version, 'npm was not found beside Node')
  const run = opts.run ?? runProcess
  const { code, output } = await run(
    process.execPath,
    [cli, 'install', '--global', `forge-terminal@${version}`],
    opts.signal,
  )
  if (code === 0) return
  if (/EACCES|EPERM|EBUSY|permission denied/i.test(output)) throw updateDenied(version, 'win32')
  throw updateFailed(version, lastWords(output))
}
