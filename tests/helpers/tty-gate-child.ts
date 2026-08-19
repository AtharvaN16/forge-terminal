/**
 * Runs the real CLI entrypoint with a TTY stdout and a non-TTY stdin — the
 * shape `forge < /dev/null`, a Makefile recipe, or an IDE run pane produces,
 * and one a spawned test process cannot otherwise present (both of its
 * streams are pipes).
 *
 * No arguments, so `parseArgs` returns the shell intent. `src/index.ts` runs
 * `await main()` at module top level, so importing it *is* running it — and
 * the import has to be dynamic, since a static one would be hoisted above the
 * two lines that set the stage.
 */
Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })

await import('../../src/index.js')
