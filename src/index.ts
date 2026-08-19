#!/usr/bin/env node
import { parseArgs } from './cli/args.js'
import { execute } from './cli/execute.js'
import { isForgeError, renderError } from './core/errors.js'

export const VERSION = '0.1.0'

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const debug = argv.includes('--debug')

  try {
    const intent = parseArgs(argv)

    // The shell is only ever launched from a real terminal. Piped or scripted
    // invocations must never block waiting for a keypress.
    if (intent.kind === 'shell' && !process.stdout.isTTY) {
      process.stderr.write(
        'Forge needs a file and a target format.\nTry: forge photo.jpg --to webp\n',
      )
      process.exitCode = 2
      return
    }

    const result = await execute(intent)
    if (result.stdout.length > 0) process.stdout.write(`${result.stdout.join('\n')}\n`)
    if (result.stderr.length > 0) process.stderr.write(`${result.stderr.join('\n')}\n`)
    process.exitCode = result.exitCode
  } catch (e) {
    if (isForgeError(e)) {
      process.stderr.write(`${renderError(e, { debug }).join('\n')}\n`)
      process.exitCode = 2
      return
    }
    // Commander throws for --help and --version, having already printed.
    if (e instanceof Error && 'exitCode' in e) {
      process.exitCode = Number((e as { exitCode: unknown }).exitCode) || 0
      return
    }
    throw e
  }
}

await main()
