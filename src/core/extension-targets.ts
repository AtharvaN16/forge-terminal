import { invalidArguments } from './errors.js'
import { FORMATS } from './formats.js'
import type { FormatId } from './types.js'

/**
 * Remove-background must keep its alpha: flattening would undo the operation
 * (spec §5.2). Read from the format table, not a list (invariant 2).
 */
export function removeBackgroundTargetRefusal(target: FormatId) {
  if (FORMATS[target].hasAlpha) return undefined
  const carrying = (Object.keys(FORMATS) as FormatId[])
    .filter((id) => FORMATS[id].hasAlpha && id !== 'heic')
    .join(', ')
  return invalidArguments(
    `${FORMATS[target].label} cannot hold transparency, so a cutout cannot be saved as one.`,
    `Choose a format that can: ${carrying}.`,
  )
}
