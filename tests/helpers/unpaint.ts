import { PAINT_INSET } from '../../src/shell/App.js'

/**
 * A plain (SGR-stripped) app frame without the painted canvas's margin: the
 * blank row on top dropped, `PAINT_INSET` columns off the left, and the
 * painted blanks at each line's end trimmed — the frame as the layout drew
 * it, so a test can read positions in layout columns and rows.
 */
export function unpaint(frame: string): string {
  const lines = frame.split('\n')
  if (lines[0]?.trim() === '') lines.shift()
  const pad = ' '.repeat(PAINT_INSET)
  return lines.map((l) => (l.startsWith(pad) ? l.slice(PAINT_INSET) : l).trimEnd()).join('\n')
}
