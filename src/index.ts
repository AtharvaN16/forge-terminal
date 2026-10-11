#!/usr/bin/env node
import * as nodeModule from 'node:module'
import { parseArgs, wantsJson } from './cli/args.js'
import type { BatchProgress } from './cli/execute.js'
import { asForgeError, fatalLines, guardUnsettled } from './cli/fatal.js'
import { type Spinner, startSpinner } from './cli/spinner.js'
import { invalidArguments, isForgeError, renderError } from './core/errors.js'
import { errorJson } from './core/report-data.js'

/**
 * Node's on-disk compile cache for every module loaded after this line, which
 * is all of the heavy ones because they are imported dynamically below.
 * Measured at -25 ms per run (spec §4.2.3).
 *
 * A namespace import plus an optional call, never `import { enableCompileCache }`:
 * the function arrived in Node 22.1, `engines` allows 20, and a missing named
 * export from a built-in is a link error that would stop Forge from starting
 * at all.
 */
nodeModule.enableCompileCache?.()

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

// Re-exported, not redeclared: theme.ts owns the value so the shell can
// show it in the banner without importing the entrypoint and forming a cycle.
import { VERSION } from './shell/theme.js'

export { VERSION }

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const debug = argv.includes('--debug')
  const json = wantsJson(argv)

  try {
    // Parse first, import second (spec §4.2). `--version`, `--help` and every
    // usage error are answered inside parseArgs, by Commander, before any
    // engine, library or shell module is loaded.
    const intent = parseArgs(argv)

    // The shell is only ever launched from a real terminal. Piped or scripted
    // invocations must never block waiting for a keypress.
    //
    // Both streams are checked, not just stdout. `useInput` calls
    // `setRawMode(true)` on stdin, which throws when stdin is not a TTY — and
    // `forge < /dev/null`, a Makefile recipe, or an IDE run pane all give a
    // TTY stdout with a redirected stdin. Gating on stdout alone let those
    // through to Ink, whose ErrorBoundary then rendered the raw stack.
    if (intent.kind === 'shell') {
      // --json asks for one document on stdout. The shell is the one thing that
      // cannot produce one, so a bare `forge --json` is a usage error.
      if (json) {
        throw invalidArguments(
          'No files given.',
          'Name a file, for example: forge photo.jpg --to webp --json',
        )
      }
      if (!process.stdout.isTTY || !process.stdin.isTTY) {
        process.stderr.write(
          'Forge needs a file and a target format.\nTry: forge photo.jpg --to webp\n',
        )
        process.exitCode = 2
        return
      }
      // Before the shell — and therefore before Ink, and therefore before
      // chalk, which fixes its colour level at import time and never
      // reconsults the environment afterwards. See shell/theme.ts.
      const { applyColourPreference } = await import('./shell/theme.js')
      applyColourPreference()

      // boot.ts starts importing the shell and plays the intro at the same
      // time. It is React-free, so nothing here gets ahead of the line above.
      const { bootShell } = await import('./shell/boot.js')
      await bootShell()
      return
    }

    // Only now, with real work to do, is the engine layer loaded.
    const { execute } = await import('./cli/execute.js')

    /**
     * The spinner is created on the first search callback rather than up
     * front: most runs never search at all, and starting one for them would
     * flash a line for no reason. `execute` reports a position; only this
     * file decides to animate it, and only on a terminal.
     */
    let spinner: Spinner | undefined
    // Progress and the spinner are stderr decoration for a person at a
    // terminal. Under --json they stay off entirely (spec §3.2).
    const tty = Boolean(process.stderr.isTTY) && !json
    const result = await execute(intent, {
      json,
      onProgress: tty ? onProgress : undefined,
      ...(tty
        ? {
            onSearch: (status: string) => {
              spinner ??= startSpinner(process.stderr, 'finding the smallest that fits')
              spinner.update(status)
            },
          }
        : {}),
    })
    spinner?.stop()
    if (result.stdout.length > 0) process.stdout.write(`${result.stdout.join('\n')}\n`)
    if (result.stderr.length > 0) process.stderr.write(`${result.stderr.join('\n')}\n`)
    process.exitCode = result.exitCode
  } catch (e) {
    if (isForgeError(e)) {
      if (json) process.stdout.write(`${JSON.stringify(errorJson(VERSION, e))}\n`)
      else process.stderr.write(`${renderError(e, { debug }).join('\n')}\n`)
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

/**
 * Prints an error that main() did not turn into a Forge answer itself. There is
 * never a raw stack trace (unless --debug), and Node's own exit code never
 * leaks through. Only this file prints.
 */
function reportFatal(e: unknown): void {
  const argv = process.argv.slice(2)
  if (wantsJson(argv)) {
    process.stdout.write(`${JSON.stringify(errorJson(VERSION, asForgeError(e)))}\n`)
    return
  }
  process.stderr.write(`${fatalLines(e, argv.includes('--debug')).join('\n')}\n`)
}

let settled = false
guardUnsettled(() => settled, reportFatal)
try {
  await main()
} catch (e) {
  reportFatal(e)
  process.exitCode = 1
} finally {
  settled = true
}
