import { Box, type DOMElement, Text } from 'ink'
import { useRef, useState } from 'react'
import stringWidth from 'string-width'
import { unescapePath } from '../../utils/unescape-path.js'
import { useClickTarget } from '../ClickTargets.js'
import { copy, paste } from '../clipboard.js'
import { positionInFrame } from '../frame-geometry.js'
import { isStrayEscapeSequence, offsetForColumn } from '../mouse.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'
import { useKeys } from '../useKeys.js'

/**
 * Consumes as many characters starting at `from` as fit within `maxWidth`
 * display cells, always taking at least one. Mirrors `wrapWord`'s own
 * per-token accumulation in wrap-ansi (the library `wrap-text.js` calls for
 * Ink's `wrap="wrap"`): the first character placed on a row is kept even if
 * it alone is wider than the row, which is what stops a single wide glyph
 * from starving the loop.
 */
function takeByWidth(chars: string[], from: number, maxWidth: number): number {
  let width = stringWidth(chars[from] ?? '')
  let i = from + 1
  while (i < chars.length) {
    const w = stringWidth(chars[i] ?? '')
    if (width + w > maxWidth) break
    width += w
    i++
  }
  return i
}

/**
 * Where a wrapped, space-free `value` breaks across visual rows, given a
 * `<Text wrap="wrap">` that is `columns` cells wide and a marker occupying
 * `markerWidth` of those cells on row 0 only.
 *
 * Returns the EXCLUSIVE end index (into `Array.from(value)`) of each row's
 * slice of `value`, in row order: row 0's slice is `value.slice(0,
 * bounds[0])`, row `r`'s (`r > 0`) is `value.slice(bounds[r - 1],
 * bounds[r])`. Row 0's slice can be empty — see below.
 *
 * This exists because `wrap-text.js` wraps with wrap-ansi's `{ trim: false,
 * hard: true }` (checked against the installed wrap-ansi@10, which Ink
 * 7.1.1 depends on), and a `value` with no space is one unbreakable "word":
 * `hard: true` then degrades wrap-ansi's word-wrap to plain fixed-width
 * chunking, via the exact same `wrapWord` routine this function mirrors.
 * `trim: false` (Ink's choice, not the default) is what makes the mapping
 * possible at all — it turns off wrap-ansi's end-of-row trimming, so every
 * row's characters concatenate back into `value` exactly, in order, with
 * none dropped or added, and a row-by-row walk can reconstruct `value`'s
 * indices losslessly.
 *
 * Two things decide the split, both taken from wrap-ansi's own `exec`:
 *   1. If `value` fits in `columns` at all, it either sits packed right
 *      after the marker (small enough for the leftover room), or — if not —
 *      moves whole to row 1, leaving row 0 as marker only.
 *   2. If `value` is wider than a full row, it hard-wraps in `columns`-wide
 *      chunks. Whether the first chunk starts packed after the marker or on
 *      a fresh row follows wrap-ansi's own tie-break: pack there only when
 *      doing so does not cost an extra row overall.
 *
 * NOT attempted when `value` contains a space: wrap-ansi then wraps at word
 * boundaries, which can end a row short of a full `columns` cells, and
 * reproducing that exactly would mean re-implementing wrap-ansi's whole
 * word-splitting pass — a second wrapping engine to keep forever in sync
 * with whatever Ink bundles. Given how rarely a dropped or typed path
 * actually contains a literal space, that cost is not worth paying here;
 * callers fall back to clamping instead (see the click handler below).
 */
function hardWrapBounds(value: string, columns: number, markerWidth: number): number[] {
  const chars = Array.from(value)
  const total = chars.length
  const remaining = columns - markerWidth
  const wordWidth = stringWidth(value)

  if (wordWidth <= columns) {
    return wordWidth <= remaining ? [total] : [0, total]
  }

  const breaksPackedHere = 1 + Math.floor((wordWidth - remaining - 1) / columns)
  const breaksFromNextRow = Math.floor((wordWidth - 1) / columns)

  const bounds: number[] = []
  let budget = remaining
  if (breaksFromNextRow < breaksPackedHere) {
    bounds.push(0)
    budget = columns
  }

  let i = 0
  while (i < total) {
    const end = takeByWidth(chars, i, budget)
    bounds.push(end)
    i = end
    budget = columns
  }
  return bounds
}

interface PromptProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  placeholder: string
  isActive: boolean
  /**
   * `drop` is the three-line target you drag a file onto; `field` is a filled
   * single line for a short answer such as a filename. `plain` is the
   * unfilled fallback used in the compact band.
   */
  variant: 'drop' | 'field' | 'plain'
  /**
   * Skips this component's own `unescapePath` call, handing `onSubmit` the
   * buffer exactly as typed or pasted.
   *
   * Every other field submits one answer, where running `unescapePath`
   * unconditionally is harmless — a rename or a page range has no backslash
   * escapes to lose. The one file-drop prompt is different: a real multi-file
   * drag pastes several *shell-escaped* paths on one line, and splitting that
   * apart (`splitPastedPaths`, which the caller runs instead) needs the
   * escaping intact to tell a literal space in a filename from the space
   * separating two paths. Unescaping here first would already have thrown
   * that distinction away.
   */
  rawOnSubmit?: boolean
  /**
   * The live terminal width. Ink's `Box` has no notion of the caller's
   * `initialWidth` test prop — left unset, a bordered `Box` expands to fill
   * whatever `stdout.columns` genuinely is, which in production coincides
   * with the width App.tsx computed but in a narrow real terminal (or a test
   * that pins a narrower `initialWidth`) does not. Passing it through
   * explicitly is what keeps the bordered box from overflowing.
   */
  width: number
}

/**
 * The drop area: where a file gets dropped or a path gets typed.
 *
 * Fully controlled — `value` is owned by the caller — but the text an
 * in-flight `useInput` event must act on is mirrored into `valueRef` on every
 * render, so a burst of stdin events delivered through the same handler
 * closure before React re-renders still accumulates onto the real current
 * value rather than a stale one, and a caller-driven reset (e.g. clearing the
 * field after submit) is picked up the moment it renders. See Select.tsx and
 * PathInput.tsx for the same pattern and its rationale.
 *
 * On submission the buffer is also reset right here, synchronously, rather
 * than only via the caller clearing `value` and that flowing back through a
 * re-render: two Enter-terminated events delivered in the same synchronous
 * tick (e.g. two paths pasted back to back, or a fast burst of separate
 * writes) reach this same closure before React ever gets a chance to
 * re-render and resync `valueRef` from a cleared `value` prop. Without this,
 * the second event's text would concatenate onto the just-submitted first
 * event's text instead of starting clean, producing a path that exists
 * nowhere on disk.
 */
export function Prompt({
  value,
  onChange,
  onSubmit,
  placeholder,
  isActive,
  variant,
  width,
  rawOnSubmit = false,
}: PromptProps) {
  const palette = useTheme()
  const valueRef = useRef(value)
  // Deliberately a plain assignment in the render body, not a `useEffect`:
  // Ink's renderer has no browser paint to tear before, so there is no
  // "render without committing" hazard `useLayoutEffect` guards against
  // elsewhere. `useInput`'s handler (below) runs between renders, and by
  // reading `valueRef.current` — never the `value` prop directly — it always
  // sees whatever this line last wrote, which is current as of the most
  // recent render, synchronously, with no effect-scheduling delay.
  valueRef.current = value

  /**
   * Insertion point, counted in code points from the start. A ref for the
   * same reason `valueRef` is: arrow keys and text can arrive in one flush,
   * and each must act on where the caret genuinely is now.
   *
   * Clamped on every read rather than only on write, because the caller can
   * replace `value` from underneath us — Tab completion does exactly that —
   * and a caret left past the new end would insert into nothing.
   */
  // Initialised to the end of whatever the field was mounted with. The rename
  // field is seeded by its parent before this component exists, so the
  // "value changed from outside" check below never fires for that first
  // value — starting at 0 is what put typed text in front of the name.
  const caretRef = useRef(Array.from(value).length)

  /**
   * A caret move changes no text, so `onChange(value)` hands React the string
   * it already has and it bails out of re-rendering — the caret would move in
   * the ref and never on screen. This counter exists solely to give those
   * renders something that actually changed.
   */
  const [, bump] = useState(0)
  const rerender = () => bump((n) => n + 1)

  /**
   * The last value this component itself produced. When `value` arrives
   * different from it, the parent replaced the text from outside — seeding
   * the rename field with a filename, or Tab completing a path — and the
   * caret belongs at the end of the new text, not wherever it happened to sit
   * in the old. Without this the rename field opened with the caret at 0 and
   * everything typed landed in front of the name.
   */
  const ownRef = useRef(value)
  if (value !== ownRef.current) {
    ownRef.current = value
    caretRef.current = Array.from(value).length
  }

  /**
   * The fixed end of a selection; the caret is the moving end. `null` means
   * nothing is selected.
   *
   * Anchor-and-head rather than start-and-end, which is what lets Shift+Left
   * *shrink* a selection built with Shift+Right instead of always growing it:
   * the pair remembers which end the user is dragging. Start/end would have
   * thrown that away on the first normalisation.
   */
  const anchorRef = useRef<number | null>(null)

  const chars = () => Array.from(valueRef.current)
  const caret = () => Math.min(Math.max(caretRef.current, 0), chars().length)

  /** The selected span as a half-open range, or null when nothing is selected. */
  const selection = (): { from: number; to: number } | null => {
    const anchor = anchorRef.current
    if (anchor === null) return null
    const at = caret()
    const from = Math.min(anchor, at)
    const to = Math.max(anchor, at)
    return from === to ? null : { from, to }
  }

  const commit = (next: string, at: number) => {
    valueRef.current = next
    caretRef.current = at
    ownRef.current = next
    anchorRef.current = null
    onChange(next)
  }

  /**
   * Moves the caret, either extending the selection or dropping it.
   *
   * Every motion goes through here so the "plain motion collapses, shifted
   * motion extends" rule is stated once rather than repeated at a dozen call
   * sites, where one omission would leave a selection stranded on screen.
   */
  const moveTo = (position: number, extend: boolean) => {
    if (extend) {
      if (anchorRef.current === null) anchorRef.current = caret()
    } else {
      anchorRef.current = null
    }
    caretRef.current = position
    rerender()
  }

  /**
   * Removes the selected span and returns what it held, or null if there was
   * no selection. Callers use the return value to decide whether they still
   * have their own work to do — typing over a selection replaces it, but
   * Backspace with a selection is *only* the deletion.
   */
  const deleteSelection = (): string | null => {
    const span = selection()
    if (!span) return null
    const c = chars()
    const removed = c.slice(span.from, span.to).join('')
    commit([...c.slice(0, span.from), ...c.slice(span.to)].join(''), span.from)
    return removed
  }

  useKeys(
    (input, key) => {
      if (key.escape) return

      /**
       * Every branch below matches on what Ink *delivers*, which is not what
       * the terminal sends. `use-input.js` strips a leading ESC from any
       * sequence `parse-keypress` did not fully resolve, so a comparison like
       * `input === '\x1bb'` can never be true — the handler sees `'b'` with
       * `key.meta` set. An earlier version of this file was written against
       * the raw sequences and every one of those branches was dead code.
       *
       * Measured against Ink 7.1.1 (see tests/shell/prompt-shortcuts.test.tsx
       * for the sequences, which are the ones Terminal.app's shipped
       * keyMappings.plist and iTerm2/xterm actually emit):
       *
       *   Option+Left   ESC b       -> input 'b',  key.meta
       *   Option+Left   CSI 1;3D    -> input '',   key.meta + key.leftArrow
       *   Ctrl+Left     CSI 1;5D    -> input '',   key.ctrl + key.leftArrow
       *   Option+Bksp   ESC DEL     -> input '',   key.meta + key.backspace
       *   fn+Delete     CSI 3~      -> input '',   key.delete
       *   Home / End    CSI H / F   -> input '',   key.home / key.end
       *   Ctrl+U/K/W/A/E            -> input 'u'/'k'/'w'/'a'/'e', key.ctrl
       *
       * `key.meta` means only "the bytes were ESC-prefixed" — which is what
       * Option sends. It can therefore never identify Cmd, and in Terminal.app
       * Cmd is unreachable outright: its key-mapping UI does not offer Command
       * as a modifier, so no Cmd chord produces bytes at all.
       *
       * Cmd is still reachable elsewhere, through a different channel: the
       * kitty keyboard protocol reports a modifier bitmask instead of an ESC
       * prefix, and Ink surfaces its Cmd bit as `key.super`. `launch.tsx`
       * negotiates that protocol, so the `key.super` branches below are live
       * in iTerm2, Ghostty, WezTerm, kitty and VS Code's terminal, and inert
       * in Terminal.app.
       */
      const wordBack = (c: string[], from: number) => {
        let i = from
        while (i > 0 && c[i - 1] === ' ') i--
        while (i > 0 && c[i - 1] !== ' ' && c[i - 1] !== '/') i--
        return i
      }
      const wordForward = (c: string[], from: number) => {
        let i = from
        while (i < c.length && c[i] === ' ') i++
        while (i < c.length && c[i] !== ' ' && c[i] !== '/') i++
        return i
      }

      /**
       * Cmd, reported as `key.super` by the kitty keyboard protocol that
       * `launch.tsx` asks for. Checked before the Option and plain branches
       * because on macOS Cmd is the *line*-scoped modifier and Option the
       * word-scoped one — Cmd+Left goes to the start of the line, not back a
       * word — and `key.super` arrives alongside `key.leftArrow`, which the
       * branches below would otherwise claim first.
       *
       * Silent no-ops in a terminal without the protocol (Terminal.app), where
       * Cmd cannot be reported at all and these are simply never true.
       */
      if (key.super && key.leftArrow) {
        moveTo(0, key.shift)
        return
      }
      if (key.super && key.rightArrow) {
        moveTo(chars().length, key.shift)
        return
      }
      // Cmd+Backspace — delete to line start, the macOS counterpart of Ctrl+U.
      if (key.super && key.backspace) {
        const c = chars()
        const at = caret()
        copy(c.slice(0, at).join(''))
        commit(c.slice(at).join(''), 0)
        return
      }
      // Cmd+fn+Delete — delete to line end.
      if (key.super && key.delete) {
        const c = chars()
        const at = caret()
        copy(c.slice(at).join(''))
        commit(c.slice(0, at).join(''), at)
        return
      }
      // Cmd+A — select all. Ctrl+A stays line-start (readline), which is why
      // this needs the protocol to be distinguishable at all.
      if (key.super && input === 'a') {
        anchorRef.current = 0
        caretRef.current = chars().length
        rerender()
        return
      }

      /**
       * The kill commands put what they removed on the system clipboard, and
       * Ctrl+Y puts it back. That is readline's kill-ring model, mapped onto
       * the clipboard the rest of the machine shares — and it is the only
       * copy route available here, because Cmd+C never reaches a terminal
       * app: the terminal keeps it for copying *its* selection, which is not
       * this field's.
       */

      // Ctrl+X — cut the selection.
      if (key.ctrl && input === 'x') {
        const cut = deleteSelection()
        if (cut !== null) copy(cut)
        return
      }

      // Ctrl+Y — yank: insert the clipboard at the caret, replacing any
      // selection. Cmd+V still works too; the terminal turns it into ordinary
      // typed input, which the text branch below already handles.
      if (key.ctrl && input === 'y') {
        const pasted = paste()
        if (pasted === '') return
        deleteSelection()
        const c = chars()
        const at = caret()
        // A clipboard holding several lines is one line's worth of path here;
        // the rest would be silently mangled, so only the first is taken.
        const flat = pasted.split(/[\r\n]/)[0] ?? ''
        const typed = Array.from(flat)
        commit([...c.slice(0, at), ...typed, ...c.slice(at)].join(''), at + typed.length)
        return
      }

      // Ctrl+U — kill to line start.
      if (key.ctrl && input === 'u') {
        const c = chars()
        const at = caret()
        copy(c.slice(0, at).join(''))
        commit(c.slice(at).join(''), 0)
        return
      }

      // Ctrl+K — kill to line end.
      if (key.ctrl && input === 'k') {
        const c = chars()
        const at = caret()
        copy(c.slice(at).join(''))
        commit(c.slice(0, at).join(''), at)
        return
      }

      // Option+Backspace / Ctrl+W — delete the word before the caret, or the
      // selection if there is one.
      if ((key.meta && key.backspace) || (key.ctrl && input === 'w')) {
        const cut = deleteSelection()
        if (cut !== null) {
          copy(cut)
          return
        }
        const c = chars()
        const at = caret()
        const i = wordBack(c, at)
        copy(c.slice(i, at).join(''))
        commit([...c.slice(0, i), ...c.slice(at)].join(''), i)
        return
      }

      // Option+fn+Delete — delete the word after the caret.
      if (key.meta && key.delete) {
        const c = chars()
        const at = caret()
        const i = wordForward(c, at)
        commit([...c.slice(0, at), ...c.slice(i)].join(''), at)
        return
      }

      /**
       * `key.shift` on an arrow extends the selection instead of collapsing
       * it. Terminal.app sends Shift+Left/Right (`CSI 1;2D`/`C`) but has no
       * mapping at all for Shift+Up/Down, so horizontal selection is the only
       * kind this field can offer — which costs nothing, because the field is
       * one line.
       */

      // Option+Left / Ctrl+Left — word back.
      if (((key.meta || key.ctrl) && key.leftArrow) || (key.meta && input === 'b')) {
        moveTo(wordBack(chars(), caret()), key.shift)
        return
      }

      // Option+Right / Ctrl+Right — word forward.
      if (((key.meta || key.ctrl) && key.rightArrow) || (key.meta && input === 'f')) {
        moveTo(wordForward(chars(), caret()), key.shift)
        return
      }

      // Home / Ctrl+A — line start. Terminal.app does not map Home by
      // default (it scrolls the view), so Ctrl+A carries this there.
      if (key.home || (key.ctrl && input === 'a')) {
        moveTo(0, key.shift)
        return
      }

      // End / Ctrl+E — line end.
      if (key.end || (key.ctrl && input === 'e')) {
        moveTo(chars().length, key.shift)
        return
      }

      if (key.leftArrow) {
        /**
         * A plain arrow with a selection up collapses to that selection's
         * edge rather than stepping one further, which is what every text
         * field does — pressing Left after selecting "bar" puts the caret
         * before the b, not before the a.
         */
        const span = selection()
        moveTo(span && !key.shift ? span.from : Math.max(0, caret() - 1), key.shift)
        return
      }

      if (key.rightArrow) {
        const span = selection()
        moveTo(span && !key.shift ? span.to : Math.min(chars().length, caret() + 1), key.shift)
        return
      }

      if (key.return) {
        onSubmit(rawOnSubmit ? valueRef.current : unescapePath(valueRef.current))
        valueRef.current = ''
        caretRef.current = 0
        onChange('')
        return
      }

      /**
       * Forward delete is its own branch, not folded in with backspace. Ink
       * reports fn+Delete as `key.delete` and Backspace as `key.backspace`;
       * treating them alike made fn+Delete eat the character *before* the
       * caret, which is the opposite of what the key does.
       */
      if (key.delete) {
        if (deleteSelection() !== null) return
        const c = chars()
        const at = caret()
        if (at >= c.length) return
        commit([...c.slice(0, at), ...c.slice(at + 1)].join(''), at)
        return
      }

      if (key.backspace) {
        if (deleteSelection() !== null) return
        const c = chars()
        const at = caret()
        if (at === 0) return
        commit([...c.slice(0, at - 1), ...c.slice(at)].join(''), at - 1)
        return
      }

      if (input) {
        /**
         * An unresolved control sequence reaches here with its ESC already
         * stripped, so it looks like ordinary text beginning with `[` — a
         * mouse report arrives as `"[<0;12;34M"`. The old guard tested
         * `input.startsWith('\x1b')`, which can never be true, so any
         * terminal with mouse reporting on typed its own mouse events into
         * the path.
         *
         * Matched narrowly on purpose: a lone `[`, and `[` followed by
         * anything that is not a CSI parameter run, stay typeable, because
         * brackets are legal in filenames — `shot[1].png` must still work.
         */
        if (isStrayEscapeSequence(input)) {
          return
        }

        // Typing over a selection replaces it, so the removal happens before
        // the buffer is read back below.
        deleteSelection()

        const breakIndex = input.search(/[\r\n]/)
        const c = chars()
        const at = caret()

        if (breakIndex !== -1) {
          const next = [...c.slice(0, at), ...input.slice(0, breakIndex), ...c.slice(at)].join('')
          onSubmit(rawOnSubmit ? next : unescapePath(next))
          valueRef.current = ''
          caretRef.current = 0
          onChange('')
          return
        }

        const typed = Array.from(input)
        commit([...c.slice(0, at), ...typed, ...c.slice(at)].join(''), at + typed.length)
      }
    },
    { isActive },
  )

  const cells = Array.from(value)
  const at = Math.min(Math.max(caretRef.current, 0), cells.length)

  /**
   * Click-to-position the caret.
   *
   * This was once impossible for a stated reason: mapping a click needs the
   * frame's absolute position, which Ink never exposes, and the apparent way
   * around it — parking the *real* terminal cursor on the caret and asking the
   * terminal where its cursor is — showed a second cursor, because Ink cannot
   * place the cursor without making it visible.
   *
   * What changed is that the query never needed the caret. Ink hides the cursor
   * while rendering and leaves it one line below the frame, so asking where it
   * is locates the *frame* — invisibly, and without moving anything. The caret
   * is then plain arithmetic from there. See `useFrameOrigin.ts`.
   */
  const lineRef = useRef<DOMElement | null>(null)

  /**
   * The prompt marker (`› `, or `  › ` in the plain variant) sits between the
   * Box's left edge and the first character of row 0 ONLY. `value` renders
   * inside `<Text wrap="wrap">`, so a value longer than the available width
   * spans several visual rows — the normal case for a real path, not an edge
   * case — and a continuation row has no marker at all: it starts at column
   * 0. Both the click inset below and the continuation-row math in `onClick`
   * need this number, so it is computed once.
   */
  const markerWidth = variant === 'plain' ? 4 : 2

  useClickTarget({
    id: 'prompt-line',
    ref: lineRef,
    isActive,
    // Shrinks the registered rect past the marker, which is only ever
    // correct for row 0 — `onClick` below corrects for that on every other
    // row.
    inset: { col: markerWidth },
    onClick: (point) => {
      /**
       * Row 0: `point.col` is already target-relative and already past the
       * marker (the registered rect is inset by `markerWidth`), so it is a
       * column straight into `value`, and `offsetForColumn` finds the
       * character by display width exactly as it always has — unchanged
       * from before this row-aware handling existed.
       */
      if (point.row === 0) {
        moveTo(offsetForColumn(valueRef.current, point.col), false)
        return
      }

      // A continuation row has no marker, so its true on-screen column is
      // `point.col` with the inset added back — the inset only ever applied
      // to row 0.
      const colInRow = point.col + markerWidth

      // The same width the `<Text wrap="wrap">` actually wrapped against:
      // the registered click rect is this width minus `markerWidth` (see
      // the inset above), so re-deriving it here from the live layout, the
      // same way `useClickTarget` itself does, is the only way to recover
      // it without hardcoding the padding math for each variant.
      const rect = positionInFrame(
        lineRef.current as unknown as Parameters<typeof positionInFrame>[0],
      )
      const columns = rect?.width

      if (columns === undefined || columns < markerWidth || /\s/.test(valueRef.current)) {
        /**
         * FALLBACK, not the full mapping — see `hardWrapBounds` above for
         * why a value containing whitespace is not attempted (word-wrap
         * boundaries, not fixed columns) and why a terminal narrower than
         * the marker itself is not either (the tie-break arithmetic assumes
         * non-negative leftover room). Landing at the end is predictable;
         * guessing a column-based offset that ignores how this row actually
         * wrapped would not be — see the reviewer's repro in
         * prompt-mouse.test.tsx for exactly what that looked like.
         */
        moveTo(chars().length, false)
        return
      }

      const bounds = hardWrapBounds(valueRef.current, columns, markerWidth)
      const start = bounds[point.row - 1] ?? chars().length
      const end = bounds[point.row] ?? chars().length
      const rowText = chars().slice(start, end).join('')
      moveTo(start + offsetForColumn(rowText, colInRow), false)
    },
  })

  /**
   * The caret is drawn as an inverse block on the character it sits on, and
   * on a trailing space when it is at the end. `inverse` rather than a
   * palette colour: it swaps whatever foreground and background the terminal
   * is already using, so it is visible in either theme and under NO_COLOR,
   * where a coloured caret would vanish along with everything else.
   */
  const before = cells.slice(0, at).join('')
  const under = cells[at] ?? ' '
  const after = cells.slice(at + 1).join('')

  /**
   * `inverse` is an SGR attribute, so with colour suppressed it emits nothing
   * and the caret disappears — leaving no way to tell where typing will land
   * in the middle of a name. Under NO_COLOR the caret becomes a literal
   * glyph instead, which is the same rule the rest of the shell follows:
   * meaning never rides on colour alone (spec §13).
   */
  const noColour = process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== ''
  const caretGlyph = (ch: string) =>
    noColour ? <Text color={colourProp(palette.fg)}>{`▏${ch}`}</Text> : <Text inverse>{ch}</Text>

  /**
   * A selection is drawn as a background band, not with `inverse`. `inverse`
   * is a flag rather than a toggle — nesting it inside an already-inverted run
   * renders identically, so a caret drawn that way *inside* a selection would
   * simply vanish. A background colour and an inverse caret compose; two
   * inverses do not.
   *
   * With no palette (the first-run picker, or NO_COLOR) there is no background
   * to use, so the band falls back to `inverse` and the caret is dropped for
   * the duration — the band itself then shows where the selection is.
   */
  const span = (() => {
    const anchor = anchorRef.current
    if (anchor === null) return null
    const from = Math.min(anchor, at)
    const to = Math.max(anchor, at)
    return from === to ? null : { from, to }
  })()

  const selectionColour = colourProp(palette.textSelectionBg)

  const line = span ? (
    <Text>
      <Text color={colourProp(palette.fg)}>{cells.slice(0, span.from).join('')}</Text>
      <Text
        color={colourProp(palette.fg)}
        {...(selectionColour ? { backgroundColor: selectionColour } : { inverse: true })}
      >
        {cells.slice(span.from, span.to).join('')}
      </Text>
      <Text color={colourProp(palette.fg)}>{cells.slice(span.to).join('')}</Text>
    </Text>
  ) : value ? (
    <Text>
      <Text color={colourProp(palette.fg)}>{before}</Text>
      {isActive ? caretGlyph(under) : <Text color={colourProp(palette.fg)}>{under}</Text>}
      <Text color={colourProp(palette.fg)}>{after}</Text>
    </Text>
  ) : (
    <Text>
      {isActive ? caretGlyph(' ') : null}
      <Text color={colourProp(palette.dim)}>{placeholder}</Text>
    </Text>
  )

  /**
   * A filled drop area, drawn without a border: the fill *is* the boundary,
   * and a stroke around it only competed with the panel it was outlining.
   * Three rows because this is the target you drag a file onto, and a
   * one-line box is a small target.
   *
   * Every row is padded to exactly the same width — an earlier version
   * budgeted the text row differently from the blank ones, which is what left
   * the ragged notch on the right.
   *
   * Measured: Ink trims trailing whitespace from a rendered line, but only
   * when it really is whitespace — with a background set the run ends in the
   * reset sequence and survives intact. So the fill exists exactly when
   * colour does, and under NO_COLOR it collapses to the prompt line alone,
   * which is the right outcome either way.
   */
  const bg = palette.selectionBg === '' ? undefined : palette.selectionBg

  if (!bg || variant === 'plain') {
    // No colour: there is no fill to draw, so the prompt is just its line.
    return (
      <Box flexDirection="column">
        <Box ref={lineRef} width={width}>
          <Text wrap="wrap">
            <Text color={colourProp(palette.accent)}>{'  › '}</Text>
            {line}
          </Text>
        </Box>
      </Box>
    )
  }

  return (
    <Box
      flexDirection="column"
      width={width}
      backgroundColor={colourProp(bg)}
      paddingX={1}
      paddingY={1}
      marginTop={variant === 'field' ? 2 : 1}
      marginBottom={variant === 'field' ? 2 : 1}
    >
      <Box ref={lineRef}>
        <Text wrap="wrap">
          <Text color={colourProp(palette.accent)}>{'› '}</Text>
          {line}
        </Text>
      </Box>
    </Box>
  )
}
