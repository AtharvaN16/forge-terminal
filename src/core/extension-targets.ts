import { extensionOutdated, type ForgeError, invalidArguments } from './errors.js'
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

/** A factor Boost resolution enlarges by. Sharpen is the same runner at 1×. */
export type BoostScale = 2 | 3 | 4

/** The first boost release whose runner makes 3× (earlier ones refuse it). */
export const BOOST_THREE_SINCE = '1.1.0'

/** Whether dotted version `v` is `floor` or later: "1.10.0" is after "1.9.0". */
function atLeast(v: string, floor: string): boolean {
  const a = v.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const b = floor.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return true
}

/** The factors an installed boost `version` makes, smallest first; 2× and 4× when unknown. */
export function boostScales(version: string | undefined): BoostScale[] {
  return version !== undefined && atLeast(version, BOOST_THREE_SINCE) ? [2, 3, 4] : [2, 4]
}

/**
 * Why a boost at `scale` cannot run on the installed version `have`, or
 * undefined when it can. "Update it" only when `latest` — the newest release
 * Forge knows of — makes that scale; otherwise updating would change nothing,
 * so the refusal names the scales that work instead.
 */
export function boostScaleRefusal(
  scale: number,
  have: string,
  latest: string | undefined,
): ForgeError | undefined {
  if (scale === 1 || boostScales(have).some((s) => s === scale)) return undefined
  if (latest !== undefined && boostScales(latest).some((s) => s === scale)) {
    return extensionOutdated('boost', `boost ${scale}×`, have, BOOST_THREE_SINCE)
  }
  const works = boostScales(have).map((s) => `--boost ${s}`)
  return invalidArguments(
    `No released boost makes ${scale}× yet.`,
    `Try ${works.slice(0, -1).join(', ')} or ${works.at(-1)}.`,
  )
}

/** The boost runner's own limits (extensions/boost/runner.ts): a side, and the whole output. */
export const BOOST_MAX_SIDE = 16_384
export const BOOST_MAX_PIXELS = 100_000_000

/**
 * Why a `scale`× boost of a `width` × `height` image is past the runner's
 * limits, or undefined when it fits. Scale 1 is Sharpen: the same check on
 * the image itself.
 */
export function boostOverLimit(
  width: number,
  height: number,
  scale: number,
): { side: number } | { megapixels: number } | undefined {
  const side = Math.max(width, height) * scale
  if (side > BOOST_MAX_SIDE) return { side }
  const pixels = width * scale * height * scale
  if (pixels > BOOST_MAX_PIXELS) return { megapixels: Math.round(pixels / 1e6) }
  return undefined
}
