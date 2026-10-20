import { type Key, useInput, usePaste } from 'ink'
import { announceKey } from './pressed-key.js'

/**
 * `useInput`, minus key *releases*.
 *
 * The shell asks for the kitty keyboard protocol (see `launch.tsx`) because it
 * is the only channel on macOS that can report Cmd — as `key.super` — and the
 * flag that makes Cmd legible on the arrow keys, `reportEventTypes`, also
 * makes the terminal report every key going *up* as well as down. Ink passes
 * those through like any other event, so a handler that does not filter them
 * runs twice per keystroke: one typed character inserted twice, one Enter
 * submitting twice.
 *
 * Every `useInput` in this app therefore goes through here instead. A single
 * choke point rather than sixteen guards, because the failure mode of missing
 * one is silent and only appears in terminals that speak the protocol — which
 * is not the one most of this was developed against.
 *
 * `repeat` is deliberately kept: it is what auto-repeat on a held key is made
 * of, and dropping it would make held arrows move exactly one column.
 */
export function useKeys(
  handler: (input: string, key: Key) => void,
  options?: { isActive?: boolean; pastes?: boolean },
): void {
  const isActive = options?.isActive ?? true
  useInput(
    (input, key) => {
      if (key.eventType === 'release') return
      announceKey(input, key)
      handler(input, key)
    },
    { isActive },
  )
  usePaste((text) => handler(text, PASTE), { isActive: isActive && options?.pastes === true })
}

/**
 * The key a paste arrives with under `pastes: true`: nothing pressed, only
 * text.
 *
 * `pastes` turns on bracketed paste (Ink's `usePaste`), so the terminal wraps
 * a paste — and a drop, which is a paste of the dropped paths — in markers,
 * and Ink holds it until the end marker however many reads it spans. The
 * text then reaches `handler` as one `input`, exactly as a paste small
 * enough to arrive in one read always did, so a handler that reads a
 * multi-character input as a paste keeps working
 * (docs/superpowers/specs/2026-10-13-forge-paste-drops-design.md).
 *
 * Only what takes text asks for it: while any `pastes` handler is active Ink
 * sends pastes to those alone, and to `useInput` only when none is.
 */
export const PASTE: Key = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  pageDown: false,
  pageUp: false,
  home: false,
  end: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  meta: false,
  super: false,
  hyper: false,
  capsLock: false,
  numLock: false,
}
