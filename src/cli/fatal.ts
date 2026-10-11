import { type ForgeError, isForgeError, renderError, unexpectedError } from '../core/errors.js'

/** Any thrown value as a ForgeError, so every front end has something to render. */
export function asForgeError(e: unknown): ForgeError {
  return isForgeError(e) ? e : unexpectedError(e)
}

/** Display lines for an error nothing else caught. Never a stack trace unless `debug`. */
export function fatalLines(e: unknown, debug: boolean): string[] {
  return renderError(asForgeError(e), { debug })
}

/**
 * Catches the one failure a try/catch cannot: `main()` awaiting something
 * that will never settle. In that case Node exits 13 ("unsettled top-level await")
 * and prints no Forge error at all. That is what an agent saw when an encrypted
 * PDF prompted on a closed stdin.
 *
 * `beforeExit` fires exactly when the event loop has run dry. If `main()` is
 * still pending at that moment, nothing can ever resume it, so this reports
 * the failure and sets exit code 1.
 */
export function guardUnsettled(isSettled: () => boolean, report: (error: unknown) => void): void {
  process.once('beforeExit', () => {
    if (isSettled()) return
    report(new Error('Forge stopped before it finished: it was waiting for input that never came.'))
    process.exitCode = 1
  })
}
