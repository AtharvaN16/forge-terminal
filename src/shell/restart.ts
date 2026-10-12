import { spawnSync } from 'node:child_process'
import { runningScript } from '../update/install.js'

/**
 * /update's ↵ restart: the shell exits, and once Ink has given the terminal
 * back, the same command starts again — now the newly installed Forge, since
 * npm replaced the files at the same path. The new one owns the terminal
 * until it exits; this process waits and passes its exit code on.
 */
let wanted = false

export function requestRestart(): void {
  wanted = true
}

export function restartRequested(): boolean {
  return wanted
}

export function relaunch(): void {
  const script = runningScript(process.argv[1])
  if (script === undefined) return
  const r = spawnSync(process.execPath, [...process.execArgv, script], { stdio: 'inherit' })
  process.exitCode = r.status ?? 0
}
