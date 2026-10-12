import { spawn } from 'node:child_process'
import { join } from 'node:path'

/**
 * How the child's stdin looks — the conditions an agent harness actually
 * produces (spec §5). `closed` is `< /dev/null`; `open` is a pipe nobody
 * writes to or closes; `open-after` writes once and never closes; `text`
 * writes and closes.
 */
export type StdinMode =
  | { kind: 'closed' }
  | { kind: 'open' }
  | { kind: 'open-after'; text: string }
  | { kind: 'text'; text: string }

export interface ForgeRun {
  /** null when the process was killed for overrunning the timeout. */
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

/**
 * tsx's own JS entry, to be run as `process.execPath TSX_CLI …`. The
 * `node_modules/.bin/tsx` shim is a shell script on a Mac and a `.cmd` on
 * Windows, and Windows cannot spawn either without a shell.
 */
export const TSX_CLI = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')

const entry = join(process.cwd(), 'src', 'index.ts')

/** Runs the real CLI entry from source, as an agent would, with a hard timeout. */
export function runForge(
  args: string[],
  opts: { stdin?: StdinMode; cwd?: string; timeoutMs?: number } = {},
): Promise<ForgeRun> {
  const stdin = opts.stdin ?? { kind: 'closed' }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TSX_CLI, entry, ...args], {
      cwd: opts.cwd,
      stdio: [stdin.kind === 'closed' ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    // `stdio` is computed, so TypeScript types these as possibly null.
    child.stdout?.setEncoding('utf8').on('data', (d: string) => {
      stdout += d
    })
    child.stderr?.setEncoding('utf8').on('data', (d: string) => {
      stderr += d
    })
    if (stdin.kind === 'open-after') child.stdin?.write(stdin.text)
    if (stdin.kind === 'text') child.stdin?.end(stdin.text)

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, opts.timeoutMs ?? 15_000)

    // A child that never started has no 'close' to wait for; say why at once
    // rather than leave the test to hit its own timeout.
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ exitCode: null, stdout, stderr: `${stderr}${String(e)}`, timedOut })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      child.stdin?.destroy()
      resolve({ exitCode: code, stdout, stderr, timedOut })
    })
  })
}
