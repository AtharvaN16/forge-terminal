import { writeSync } from 'node:fs'
import { useStdout } from 'ink'
import { useEffect, useRef } from 'react'
import { BACKGROUND_RESET, backgroundSequence } from './terminal-background.js'
import type { Palette } from './theme.js'
import { reraise } from './useMouse.js'

/**
 * Keeps the terminal's default background on `palette`'s canvas for as long
 * as the calling component is mounted (see `terminal-background.ts`).
 *
 * Like mouse reporting, this is a setting on the *terminal*, so it is reset
 * on every way out: unmount (quit, ctrl-c, a restart), SIGINT/SIGTERM/SIGHUP,
 * and process exit, which is what a crash that never unmounts reaches. ctrl-z
 * needs nothing: in raw mode it arrives as a keystroke, not as SIGTSTP.
 *
 * A theme change writes the new colour at once, with no reset in between —
 * that would flash the profile's own colour.
 *
 * Returns whether the background is set — so the terminal's own padding
 * wears the canvas, and the canvas needs no painted margin of its own.
 */
export function useTerminalBackground(palette: Palette): boolean {
  const { stdout } = useStdout()
  const sequence = backgroundSequence(palette, process.env)
  const isTTY = (stdout as NodeJS.WriteStream | undefined)?.isTTY === true
  /** Whether a set is in force, so the reset is written only after one. */
  const isSet = useRef(false)

  useEffect(() => {
    const out = stdout as NodeJS.WriteStream | undefined
    if (!out?.isTTY) return
    if (sequence !== null) {
      out.write(sequence)
      isSet.current = true
    } else if (isSet.current) {
      out.write(BACKGROUND_RESET)
      isSet.current = false
    }
  }, [sequence, stdout])

  useEffect(() => {
    const out = stdout as NodeJS.WriteStream | undefined
    if (!out?.isTTY) return

    const reset = () => {
      if (!isSet.current) return
      isSet.current = false
      /**
       * `writeSync` on the fd, as `useMouse` does for MOUSE_OFF: on the
       * signal and exit paths the process is about to go, and a buffered
       * write can lose the race. A stream with no fd (a test double) falls
       * back to the ordinary write.
       */
      const fd = (out as { fd?: number }).fd
      try {
        if (typeof fd === 'number') writeSync(fd, BACKGROUND_RESET)
        else out.write(BACKGROUND_RESET)
      } catch {
        out.write(BACKGROUND_RESET)
      }
    }
    const onSignal = (signal: NodeJS.Signals) => {
      reset()
      process.removeListener(signal, onSignal)
      reraise(signal)
    }
    process.on('SIGINT', onSignal)
    process.on('SIGTERM', onSignal)
    process.on('SIGHUP', onSignal)
    process.on('exit', reset)

    return () => {
      reset()
      process.removeListener('SIGINT', onSignal)
      process.removeListener('SIGTERM', onSignal)
      process.removeListener('SIGHUP', onSignal)
      process.removeListener('exit', reset)
    }
  }, [stdout])

  return sequence !== null && isTTY
}
