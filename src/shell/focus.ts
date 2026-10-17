import { writeSync } from 'node:fs'
import { useStdin, useStdout } from 'ink'
import { useEffect, useRef } from 'react'
import { reraise } from './useMouse.js'

/**
 * Focus reporting (DECSET 1004): the terminal says `ESC [ I` when its window
 * comes to the front and `ESC [ O` when it goes. Home uses the first to look
 * at the clipboard again, so a picture copied in another app is offered the
 * moment you come back. Terminal.app, iTerm2, Ghostty and kitty all send it.
 *
 * Both reports reach `useInput` as `[I` / `[O` too; `isStrayEscapeSequence`
 * keeps them out of every field.
 */
export const FOCUS_ON = '\x1b[?1004h'
export const FOCUS_OFF = '\x1b[?1004l'

export function isFocusIn(data: string): boolean {
  return data === '\x1b[I'
}

/**
 * Calls `onFocusIn` each time the window comes back to the front, for as
 * long as the caller is mounted and `enabled`. Reporting is a mode on the terminal, so it
 * is switched off again however the process ends, as `useMouse` does — and
 * only switched on for a real terminal, never written into piped output.
 * The reports are listened for either way, so a test can send one.
 */
export function useFocusIn(onFocusIn: () => void, enabled = true): void {
  const { internal_eventEmitter } = useStdin() as ReturnType<typeof useStdin> & {
    internal_eventEmitter?: {
      on: (event: string, listener: (data: string) => void) => void
      removeListener: (event: string, listener: (data: string) => void) => void
    }
  }
  const { stdout } = useStdout()
  const handler = useRef(onFocusIn)
  handler.current = onFocusIn

  useEffect(() => {
    if (!enabled) return
    const onInput = (data: string) => {
      if (isFocusIn(data)) handler.current()
    }
    internal_eventEmitter?.on('input', onInput)

    const out = stdout as NodeJS.WriteStream | undefined
    const tty = out?.isTTY === true
    let cleared = false
    const clear = () => {
      if (cleared || !tty || !out) return
      cleared = true
      // As useMouse: writeSync, since on exit a buffered write can be lost.
      const fd = (out as { fd?: number }).fd
      try {
        if (typeof fd === 'number') writeSync(fd, FOCUS_OFF)
        else out.write(FOCUS_OFF)
      } catch {
        out.write(FOCUS_OFF)
      }
    }
    // As useMouse and useTerminalBackground: off, then the signal again.
    const onSignal = (signal: NodeJS.Signals) => {
      clear()
      process.removeListener(signal, onSignal)
      reraise(signal)
    }
    if (tty) {
      out?.write(FOCUS_ON)
      process.on('SIGINT', onSignal)
      process.on('SIGTERM', onSignal)
      process.on('SIGHUP', onSignal)
      process.on('exit', clear)
    }
    return () => {
      internal_eventEmitter?.removeListener('input', onInput)
      clear()
      process.removeListener('SIGINT', onSignal)
      process.removeListener('SIGTERM', onSignal)
      process.removeListener('SIGHUP', onSignal)
      process.removeListener('exit', clear)
    }
  }, [enabled, internal_eventEmitter, stdout])
}
