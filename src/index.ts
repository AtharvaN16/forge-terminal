#!/usr/bin/env node
import * as nodeModule from 'node:module'
import { parseArgs, wantsJson } from './cli/args.js'
import type { BatchProgress } from './cli/execute.js'
import { asForgeError, fatalLines, guardUnsettled } from './cli/fatal.js'
import { type Spinner, startSpinner } from './cli/spinner.js'
import { invalidArguments, isForgeError, renderError } from './core/errors.js'
import { errorJson } from './core/report-data.js'
import { sizeThreadpool } from './core/threads.js'
import { trueColour } from './shell/glyphs.js'

// Before anything can touch libuv's threadpool, which reads its size once:
// a thread for each of the batch's workers (core/threads.ts).
sizeThreadpool()

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
    /**
     * `forge mcp` is a server, not a command. It owns stdin and stdout until
     * the client hangs up, so it is routed before argument parsing and never
     * reaches execute(). The import is lazy, so no other command loads the
     * MCP SDK (spec §3.5).
     */
    // The background half of the once-a-day update check (cli/update-note.ts):
    // a detached process the last command started. It asks npm, writes the
    // answer beside the config, and exits. Nothing is printed.
    if (argv[0] === '__update-check') {
      const { checkNow } = await import('./update/check.js')
      await checkNow()
      return
    }

    // `forge menu …`: what the right-click menu's items run (src/menu/). Never
    // typed by anyone: the launcher calls `run` with a click's action and
    // files, and `run` opens a terminal on `open`, which is the shell with the
    // files staged.
    if (argv[0] === 'menu') {
      const { openedForClick, parseMenuArgs } = await import('./menu/command.js')
      const cmd = parseMenuArgs(argv.slice(1))
      if (cmd.kind === 'open') {
        const { applyColourPreference } = await import('./shell/theme.js')
        applyColourPreference()
        const { bootShell } = await import('./shell/boot.js')
        await bootShell(undefined, { opened: await openedForClick(cmd.action, cmd.paths) })
        return
      }
      const { runMenuCommand } = await import('./menu/entry.js')
      process.exitCode = await runMenuCommand(cmd, VERSION)
      return
    }

    if (argv[0] === 'mcp') {
      const { runMcpServer } = await import('./mcp/server.js')
      await runMcpServer(argv.slice(1))
      return
    }

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
      // The right-click menu is set up in the background once the shell is
      // up, saying so the first time (src/menu/setup.ts).
      await bootShell(undefined, {
        menuNote: async () => (await import('./menu/entry.js')).menuAtStart(VERSION),
      })
      return
    }

    // `forge watch` runs until ctrl-c, a line per file as it lands, so it
    // prints as it goes rather than returning one result to print. ctrl-c
    // is how it ends, not an interruption: it finishes what is being
    // converted, says the totals, and exits 0 (1 if anything failed).
    if (intent.kind === 'watch') {
      const { runWatch } = await import('./cli/watch-command.js')
      const stop = new AbortController()
      process.once('SIGINT', () => stop.abort())
      process.exitCode = await runWatch(intent, {
        out: (line) => process.stdout.write(`${line}\n`),
        json,
        signal: stop.signal,
      })
      return
    }

    // Before the engine layer: npm is about to delete Forge, and on Windows a
    // loaded sharp would hold its DLL open against that (tests/menu/lazy-sharp).
    if (intent.kind === 'uninstall') {
      const { runUninstall } = await import('./menu/entry.js')
      process.exitCode = await runUninstall(VERSION, (line) => process.stdout.write(`${line}\n`))
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
    // Real bytes for an extension download: one rewritten line, no invented percentage.
    let lastPrinted = 0
    const onDownload = (done: number, total: number): void => {
      const now = Date.now()
      if (done < total && now - lastPrinted < 100) return
      lastPrinted = now
      const mb = (n: number): string => (n / 1e6).toFixed(1)
      process.stderr.write(
        `\r  downloading ${mb(done)} / ${mb(total)} MB${done >= total ? '\n' : ''}`,
      )
    }
    // Progress and the spinner are stderr decoration for a person at a
    // terminal. Under --json they stay off entirely (spec §3.2).
    const tty = Boolean(process.stderr.isTTY) && !json
    // ctrl-c during an extension job kills its child and writes nothing.
    const interrupt = new AbortController()
    // Only for extension jobs: any other run keeps the default ctrl-c.
    if (intent.kind === 'extension-op') process.once('SIGINT', () => interrupt.abort())
    const startedAt = Date.now()
    const result = await execute(intent, {
      json,
      // npm says nothing while it installs, so a person gets a spinner (invariant 7: no number).
      ...(tty
        ? {
            onInstalling: (version: string) => {
              spinner = startSpinner(process.stderr, `installing Forge ${version}`)
            },
          }
        : {}),
      signal: interrupt.signal,
      ...(tty ? { onDownload } : {}),
      // Swatches in `forge palette` / `forge scale`: only for a person at a
      // colour terminal, never into a pipe or under NO_COLOR.
      colour: Boolean(process.stdout.isTTY) && !json && trueColour(),
      onProgress: tty
        ? (progress: BatchProgress) => {
            // The spinner redraws its line in place and the counter prints
            // whole lines, so the two would share one row ("⠸ finding … 1/3").
            // Once a job finishes the counter is the better signal; the
            // spinner goes for good (a stopped one ignores later updates).
            if (progress.completed > 0) spinner?.stop()
            onProgress(progress)
          }
        : undefined,
      ...(tty
        ? {
            onSearch: (status: string) => {
              spinner ??= startSpinner(process.stderr, 'finding the smallest that fits')
              spinner.update(status)
            },
            onEncode: (status: string) => {
              spinner ??= startSpinner(process.stderr, 'encoding')
              spinner.update(status)
            },
          }
        : {}),
    })
    spinner?.stop()
    if (result.stdout.length > 0) process.stdout.write(`${result.stdout.join('\n')}\n`)
    if (result.stderr.length > 0) process.stderr.write(`${result.stderr.join('\n')}\n`)
    process.exitCode = interrupt.signal.aborted ? 130 : result.exitCode
    // A long run's notice, for a person who went to another app meanwhile:
    // never into a pipe or under --json, where no one is waiting on it.
    if (tty && result.notice && !interrupt.signal.aborted) {
      const { postFinishNotice } = await import('./menu/notify.js')
      await postFinishNotice(result.notice, Date.now() - startedAt)
    }
    // A6: a newer Forge, said once a day after a command, to a person at a
    // terminal only — never into a pipe, never with --json. It reads the
    // cache and never waits on the network; it must never fail the command.
    if (tty && process.stdout.isTTY && intent.kind !== 'update') {
      try {
        const { afterCommand, spawnRefresh } = await import('./cli/update-note.js')
        const { runningScript } = await import('./update/install.js')
        const note = await afterCommand(VERSION, {
          refresh: () => spawnRefresh(runningScript(process.argv[1])),
          colour: trueColour(),
        })
        if (note.length > 0) process.stderr.write(`\n${note.join('\n')}\n`)
      } catch {
        // No note is better than a command that fails after it succeeded.
      }
    }
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
