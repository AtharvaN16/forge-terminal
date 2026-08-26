import { type Key, useInput } from 'ink'

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
  options?: { isActive?: boolean },
): void {
  useInput((input, key) => {
    if (key.eventType === 'release') return
    handler(input, key)
  }, options)
}
