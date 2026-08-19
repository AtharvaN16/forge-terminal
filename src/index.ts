#!/usr/bin/env node
import { parseArgs } from './cli/args.js'
import type { BatchProgress } from './cli/execute.js'
import { execute } from './cli/execute.js'
import { isForgeError, renderError } from './core/errors.js'

/**
 * Prints "Converting N files" once, then a completion counter as jobs finish.
 * Only src/index.ts prints, so this is the sole consumer of execute()'s
 * progress callback — and only on a real TTY, so a piped or CI run stays
 * quiet. No live redraw: each update is its own line, not a bar to be built.
 */
function onProgress({ completed, total }: BatchProgress): void {
  if (completed === 0) {
    process.stderr.write(`Converting ${total} files\n`)
  } else {
    process.stderr.write(`  ${completed}/${total}\n`)
  }
}

export const VERSION = '0.1.0'

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const debug = argv.includes('--debug')

  try {
    const intent = parseArgs(argv)

    // The shell is only ever launched from a real terminal. Piped or scripted
    // invocations must never block waiting for a keypress.
    if (intent.kind === 'shell') {
      if (!process.stdout.isTTY) {
        process.stderr.write(
          'Forge needs a file and a target format.\nTry: forge photo.jpg --to webp\n',
        )
        process.exitCode = 2
        return
      }
      const { launchShell } = await import('./shell/launch.js')
      await launchShell()
      return
    }

    const result = await execute(intent, {
      onProgress: process.stderr.isTTY ? onProgress : undefined,
    })
    if (result.stdout.length > 0) process.stdout.write(`${result.stdout.join('\n')}\n`)
    if (result.stderr.length > 0) process.stderr.write(`${result.stderr.join('\n')}\n`)
    process.exitCode = result.exitCode
  } catch (e) {
    if (isForgeError(e)) {
      process.stderr.write(`${renderError(e, { debug }).join('\n')}\n`)
      process.exitCode = 2
      return
    }
    // Commander throws for --help, --version, and argument errors, having
    // already printed. Only help and version mean success — an unknown
    // option or a missing option argument is a usage error and must exit 2,
    // never Commander's own exitCode 1, which would collide with spec §9's
    // "1 = some files failed".
    if (e instanceof Error && 'code' in e && 'exitCode' in e) {
      const code = (e as { code?: unknown }).code
      process.exitCode = code === 'commander.helpDisplayed' || code === 'commander.version' ? 0 : 2
      return
    }
    throw e
  }
}

await main()
