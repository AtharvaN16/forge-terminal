import { type DOMElement, useStdout } from 'ink'
import { type RefObject, useLayoutEffect } from 'react'
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
 * Leaving: in a layout effect's cleanup, which React runs during the commit,
 * before Ink writes the next screen. iTerm2's pictures are erased cell by cell
 * (Ink's next frame would overwrite most of them, but not cells it leaves
 * blank); Kitty's are deleted by id, since erasing text leaves them on screen.
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

export function useInlinePictures(opts: {
  boxes: ReadonlyArray<RefObject<DOMElement | null>>
  pictures: readonly Buffer[] | undefined
  protocol: ImageProtocol | null
  cols: number
  rows: number
}): void {
  const { stdout } = useStdout()
  const { boxes, pictures, protocol, cols, rows } = opts
  useLayoutEffect(() => {
    if (!pictures || !protocol || !stdout.isTTY) return
    const ids = pictures.map(() => nextKittyId++)
    const seqs = pictures.map((png, i) => inlineImageSequence(png, cols, rows, protocol, ids[i]))
    const original = stdout.write
    let ours = false
    let live = true
    let timer: NodeJS.Timeout | undefined
    let shown: Placement[] = []

    const send = (s: string) => {
      ours = true
      try {
        original.call(stdout, s)
      } finally {
        ours = false
      }
    }
    const paint = () => {
      timer = undefined
      if (!live) return
      const at = boxes.map((b) => placementOf(b.current, stdout.rows ?? 24))
      if (at.some((p) => p === undefined)) return
      shown = at as Placement[]
      send(shown.map((p, i) => placed(p, seqs[i] ?? '')).join(''))
    }
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(paint, SETTLE_MS)
    }
    const watcher = function (this: NodeJS.WriteStream, ...args: unknown[]) {
      const result = (original as (...a: unknown[]) => boolean).apply(this, args)
      if (live && !ours) schedule()
      return result
    } as typeof stdout.write
    stdout.write = watcher
    schedule()

    return () => {
      live = false
      if (timer) clearTimeout(timer)
      // Someone wrapped write after us: leave theirs in place; ours is now a pass-through.
      if (stdout.write === watcher) stdout.write = original
      if (protocol === 'kitty') send(ids.map(kittyDelete).join(''))
      else if (shown.length > 0) send(shown.map((p) => erased(p, cols, rows)).join(''))
    }
  }, [boxes, pictures, protocol, cols, rows, stdout])
}
