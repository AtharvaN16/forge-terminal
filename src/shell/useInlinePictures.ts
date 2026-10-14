import { type DOMElement, useStdout } from 'ink'
import { type RefObject, useLayoutEffect, useRef } from 'react'
import { type ImageProtocol, inlineImageSequence, kittyDelete } from './inline-image.js'

/**
 * Draws real pictures into boxes Ink has left empty.
 *
 * Why not inside Ink's frame: Ink sanitises what it prints, keeping SGR and
 * OSC but dropping APC (Kitty's protocol) and the cursor save and restore an
 * image needs, and it measures every line as text; an image is neither. So
 * Ink draws the boxes as blank cells of the right size, and the pictures are
 * written over them afterwards, at their place:
 *
 *   ESC 7 · cursor up N · column C · <image, cursor not moved> · ESC 8
 *
 * The place is relative to where Ink leaves the cursor after a frame — column
 * 0 one line past the frame, or on its last line when the frame fills the
 * terminal (Ink then drops the trailing newline) — so it needs only the box's
 * row and column within the frame, which Yoga's layout gives exactly. No
 * cursor query, nothing absolute: the frame may sit anywhere on screen.
 *
 * When: after Ink has written. Ink throttles both its render and its write,
 * so instead of guessing, stdout.write is watched while the pictures are on
 * screen: any write that is not ours (a frame, a repaint after a resize) is
 * followed, once things are quiet for a moment, by the pictures again. A
 * repaint overwrites iTerm2's image cells with blanks; Kitty's image stays,
 * and is replaced in place because it is drawn again under the same id.
 *
 * A new picture in the same box (the crop moved, another colour chosen) is
 * drawn over the old one: Kitty's under the same id, which replaces it in
 * place, iTerm2's over its cells. Taking one off first would show the empty
 * box between the two.
 *
 * Leaving, or the box changing size: in a layout effect's cleanup, which React
 * runs during the commit, before Ink writes the next screen. iTerm2's
 * pictures are erased cell by cell (Ink's next frame would overwrite most of
 * them, but not cells it leaves blank); Kitty's are deleted by id, since
 * erasing text leaves them on screen.
 */

const ESC = '\u001b'
const SAVE = `${ESC}7`
const RESTORE = `${ESC}8`
const CSI = `${ESC}[`
/** Long enough that a burst of writes (sync start, frame, sync end) is one repaint. */
const SETTLE_MS = 40

let nextKittyId = 0x464f // "FO": anything that is not 0, kept small

/** Where a box sits relative to Ink's cursor: rows up from it, and its column. */
export interface Placement {
  up: number
  col: number
}

/**
 * The box's row and column within the frame, and so how far up from Ink's
 * resting cursor it is; undefined when it has not been laid out or has
 * scrolled off the top.
 */
export function placementOf(node: DOMElement | null, viewportRows: number): Placement | undefined {
  if (!node?.yogaNode) return undefined
  let top = 0
  let left = 0
  let root: DOMElement = node
  for (let n: DOMElement | undefined = node; n; n = n.parentNode) {
    if (n.yogaNode) {
      top += n.yogaNode.getComputedTop()
      left += n.yogaNode.getComputedLeft()
    }
    root = n
  }
  return placementFrom(top, left, root.yogaNode?.getComputedHeight() ?? 0, viewportRows)
}

/**
 * The cursor math alone: a box at `top`, `left` in a frame `frameHeight`
 * rows tall. Ink leaves the cursor one line past the frame, or on its last
 * line when the frame fills the viewport (it drops the trailing newline).
 * Undefined when the box's top has scrolled off the viewport.
 */
export function placementFrom(
  top: number,
  left: number,
  frameHeight: number,
  viewportRows: number,
): Placement | undefined {
  if (frameHeight <= 0) return undefined
  const fullscreen = frameHeight >= viewportRows
  const up = fullscreen ? frameHeight - 1 - top : frameHeight - top
  if (up < 0 || up > viewportRows - 1) return undefined
  return { up: Math.round(up), col: Math.round(left) }
}

/** `body` written at `at`, the cursor put back where it was. */
export function placed(at: Placement, body: string): string {
  return `${SAVE}${at.up > 0 ? `${CSI}${at.up}A` : ''}${CSI}${at.col + 1}G${body}${RESTORE}`
}

/** Blanks a `cols` × `rows` box at `at` (erase characters, row by row). */
function erased(at: Placement, cols: number, rows: number): string {
  let body = ''
  for (let r = 0; r < rows; r++)
    body += `${CSI}${at.col + 1}G${CSI}${cols}X${r < rows - 1 ? `${CSI}B` : ''}`
  return placed(at, body)
}

/** Where a picture sits inside its box, in cells: for one drawn among rows rather than in a box of its own. */
export interface PictureOffset {
  row: number
  col: number
}

export function useInlinePictures(opts: {
  boxes: ReadonlyArray<RefObject<DOMElement | null>>
  pictures: readonly Buffer[] | undefined
  protocol: ImageProtocol | null
  cols: number
  rows: number
  offsets?: ReadonlyArray<PictureOffset> | undefined
}): void {
  const { stdout } = useStdout()
  const { boxes, pictures, protocol, cols, rows, offsets } = opts
  // Keyed by value: a new array each render is the same place.
  const at = (offsets ?? []).map((o) => `${o.row},${o.col}`).join(';')
  /** Kitty ids, one per picture, kept for this screen's life: a new picture under the same id replaces the old in place. */
  const ids = useRef<number[]>([])
  /** What is on screen now, and how it was drawn, to take it off again. */
  const shown = useRef<
    { at: Placement[]; protocol: ImageProtocol; cols: number; rows: number } | undefined
  >(undefined)
  /** Set while writing a picture, so the watcher does not take it for Ink's. */
  const ours = useRef(false)

  const send = (s: string) => {
    ours.current = true
    try {
      stdout.write(s)
    } finally {
      ours.current = false
    }
  }
  const idOf = (i: number) => {
    ids.current[i] ??= nextKittyId++
    return ids.current[i] as number
  }
  /** Takes the pictures off: Kitty's deleted by id (erasing text leaves them), iTerm2's erased cell by cell. */
  const clear = () => {
    const was = shown.current
    if (!was) return
    shown.current = undefined
    if (was.protocol === 'kitty') send(was.at.map((_, i) => kittyDelete(idOf(i))).join(''))
    else send(was.at.map((p) => erased(p, was.cols, was.rows)).join(''))
  }

  // Off when the box changes size or the protocol changes, and when the
  // screen is left: in the commit, before Ink writes the next screen. A new
  // picture alone is not a reason: it is drawn over the old one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `clear` reads refs only
  useLayoutEffect(() => clear, [protocol, cols, rows, stdout])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `at` stands for `offsets`; `send` and `clear` read refs only
  useLayoutEffect(() => {
    if (!pictures || !protocol || !stdout.isTTY) {
      clear()
      return
    }
    const seqs = pictures.map((png, i) => inlineImageSequence(png, cols, rows, protocol, idOf(i)))
    const original = stdout.write
    let live = true
    let timer: NodeJS.Timeout | undefined

    const paint = () => {
      timer = undefined
      if (!live) return
      const places = boxes.map((b, i) => {
        const p = placementOf(b.current, stdout.rows ?? 24)
        const o = offsets?.[i]
        return p && o ? { up: p.up - o.row, col: p.col + o.col } : p
      })
      if (places.some((p) => p === undefined || p.up < 0)) return
      const now = places as Placement[]
      // Moved: the old place is cleared first, or iTerm2's cells stay behind.
      const was = shown.current
      if (was?.at.some((p, i) => p.up !== now[i]?.up || p.col !== now[i]?.col)) clear()
      shown.current = { at: now, protocol, cols, rows }
      send(now.map((p, i) => placed(p, seqs[i] ?? '')).join(''))
    }
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(paint, SETTLE_MS)
    }
    const watcher = function (this: NodeJS.WriteStream, ...args: unknown[]) {
      const result = (original as (...a: unknown[]) => boolean).apply(this, args)
      if (live && !ours.current) schedule()
      return result
    } as typeof stdout.write
    stdout.write = watcher
    schedule()

    return () => {
      live = false
      if (timer) clearTimeout(timer)
      // Someone wrapped write after us: leave theirs in place; ours is now a pass-through.
      if (stdout.write === watcher) stdout.write = original
    }
  }, [boxes, pictures, protocol, cols, rows, at, stdout])
}
