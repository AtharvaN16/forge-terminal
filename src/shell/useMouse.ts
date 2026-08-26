import { writeSync } from 'node:fs'
import { useStdin, useStdout } from 'ink'
import { useEffect, useRef } from 'react'
import {
  MOUSE_OFF,
  MOUSE_ON,
  MOUSE_ON_WITH_HOVER,
  type MouseEvent,
  parseCursorReport,
  parseMouse,
} from './mouse.js'

/**
 * Which reporting mode to ask the terminal for.
 *
 * Motion reporting costs an event per cell of pointer travel, so it is asked
 * for only while something on screen can respond to a hover.
 */
export function reportingSequence(hover: boolean): string {
  return hover ? MOUSE_ON_WITH_HOVER : MOUSE_ON
}

/**
 * Turns terminal mouse reporting on for as long as the calling component is
 * mounted, and hands decoded events to `onEvent`.
 *
 * Reporting is a mode set on the *terminal*, not on this process, so the one
 * thing this must never do is exit without clearing it. A terminal left in
 * reporting mode prints `[<35;…M` at the user's shell prompt on every mouse
 * move, and nothing short of `reset` puts it right — that failure is behind
 * the "stuck in mouse reporting" bug reports filed against other CLIs. Ink
 * installs no signal handling of its own (only `beforeExit`, which a signal
 * skips), so every path off is covered here.
 *
 * The cost, which is unavoidable and worth stating plainly: while reporting is
 * on the terminal routes drags to us instead of to its own selection, so
 * click-dragging no longer selects text to copy. Holding Option restores the
 * native behaviour in both Terminal.app and iTerm2.
 */
export function useMouse(
  onEvent: (event: MouseEvent) => void,
  options: { isActive?: boolean; hover?: boolean } = {},
): void {
  const { isActive = true, hover = false } = options
  const { setRawMode, internal_eventEmitter } = useStdin() as ReturnType<typeof useStdin> & {
    internal_eventEmitter?: {
      on: (event: string, listener: (data: string) => void) => void
      removeListener: (event: string, listener: (data: string) => void) => void
    }
  }
  /**
   * The stream Ink is rendering to, not the global `process.stdout`. They are
   * the same object in production and deliberately are not under test — and
   * more importantly, a run whose output is piped or redirected must not have
   * mode-setting sequences injected into it.
   */
  const { stdout } = useStdout()

  /**
   * Mirrored into a ref so the effect below does not re-run — and therefore
   * does not switch reporting off and on again — every time the caller passes
   * a fresh closure, which is every render.
   */
  const handler = useRef(onEvent)
  handler.current = onEvent

  useEffect(() => {
    if (!isActive) return

    /**
     * The stream object itself rather than `useStdout().write`: that helper is
     * the scrollback-and-`<Static>` path for *output*, and a mode-setting
     * sequence is not output.
     *
     * Gated on a real terminal. Mouse reporting is meaningless without one,
     * and writing the sequence anyway would corrupt a piped or redirected run
     * — the frame is the product's output, and nothing that is not the frame
     * belongs in it.
     */
    const out = stdout as NodeJS.WriteStream | undefined
    if (!out?.isTTY) return

    setRawMode(true)
    out.write(reportingSequence(hover))

    let cleared = false
    const clear = () => {
      if (cleared) return
      cleared = true
      /**
       * `writeSync` on the file descriptor rather than `out.write`: on the
       * signal paths below the process is about to go, and a buffered async
       * write can lose the race. This is the one sequence that must land.
       * A stream with no fd (a test double) falls back to the ordinary write.
       */
      const fd = (out as { fd?: number }).fd
      try {
        if (typeof fd === 'number') writeSync(fd, MOUSE_OFF)
        else out.write(MOUSE_OFF)
      } catch {
        out.write(MOUSE_OFF)
      }
    }

    /**
     * Ink's own input channel, which hands over sequences already reassembled
     * by its incremental CSI parser. A bare `stdin.on('data')` listener would
     * work too, but it sees raw chunks — a report split across two writes
     * arrives as `"[<0;12;"` then `"34M"`, and reassembling it correctly means
     * reimplementing the framer Ink already has.
     */
    const onInput = (data: string) => {
      const event = parseMouse(data)
      if (event) handler.current(event)
    }

    internal_eventEmitter?.on('input', onInput)

    /**
     * SIGINT is not "maybe" — ctrl-c is how this app is normally quit.
     * `process.on`, not `once`, would leak across remounts, so these are
     * removed again below.
     */
    const onSignal = (signal: NodeJS.Signals) => {
      clear()
      process.removeListener(signal, onSignal)
      process.kill(process.pid, signal)
    }
    process.on('SIGINT', onSignal)
    process.on('SIGTERM', onSignal)
    process.on('SIGHUP', onSignal)
    process.on('exit', clear)

    return () => {
      clear()
      internal_eventEmitter?.removeListener('input', onInput)
      process.removeListener('SIGINT', onSignal)
      process.removeListener('SIGTERM', onSignal)
      process.removeListener('SIGHUP', onSignal)
      process.removeListener('exit', clear)
    }
  }, [isActive, hover, setRawMode, internal_eventEmitter, stdout])
}

/**
 * Delivers the terminal's replies to `CURSOR_QUERY`.
 *
 * Split from `useMouse` because the two have different lifetimes: mouse
 * reporting is a mode that must be switched on and off, while a cursor report
 * is a one-shot answer to a question this app asked. Both read the same
 * channel, so both go through Ink's reassembled input rather than a raw
 * `data` listener.
 */
export function useCursorReport(
  onReport: (position: { row: number; col: number }) => void,
  isActive = true,
): void {
  const { internal_eventEmitter } = useStdin() as ReturnType<typeof useStdin> & {
    internal_eventEmitter?: {
      on: (event: string, listener: (data: string) => void) => void
      removeListener: (event: string, listener: (data: string) => void) => void
    }
  }

  const handler = useRef(onReport)
  handler.current = onReport

  useEffect(() => {
    if (!isActive) return
    const onInput = (data: string) => {
      const position = parseCursorReport(data)
      if (position) handler.current(position)
    }
    internal_eventEmitter?.on('input', onInput)
    return () => internal_eventEmitter?.removeListener('input', onInput)
  }, [isActive, internal_eventEmitter])
}
