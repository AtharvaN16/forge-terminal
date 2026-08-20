export interface SearchRequest {
  /** Encodes at a quality and resolves the resulting byte length. */
  encode: (quality: number) => Promise<number>
  targetBytes: number
  min?: number
  max?: number
  /** Called once per encode with a real position in a known sequence. */
  onAttempt?: (attempt: number, of: number) => void
}

export interface SearchResult {
  quality: number
  bytes: number
  /** True when even the lowest quality overshot the target. */
  missed: boolean
}

const DEFAULT_MIN = 1
const DEFAULT_MAX = 100

/**
 * How many encodes the search can possibly need.
 *
 * Known before the search starts, which is what lets progress be reported
 * honestly: `attempt 3 of 8` is a real position in a bounded sequence, not a
 * percentage invented to look like movement. Spec §12 forbids the latter, and
 * a made-up denominator is the same offence.
 *
 * The `+ 1` is the probe at `max` that always runs before the search proper.
 * The design doc put this bound at `ceil(log2(100))` = 7, which counted the
 * bisection steps and forgot the probe; the search really can take 8, and
 * reporting "attempt 8 of 7" would be exactly the dishonesty this number
 * exists to prevent.
 */
export function maxAttempts(min: number = DEFAULT_MIN, max: number = DEFAULT_MAX): number {
  const range = Math.max(1, max - min + 1)
  return 1 + Math.max(0, Math.ceil(Math.log2(range)))
}

/**
 * The highest quality whose encoded size fits within `targetBytes`.
 *
 * Assumes only that size rises with quality, which holds for every encoder
 * Forge uses. `encode` is a parameter rather than an import so this module
 * stays free of Sharp and can be tested against arithmetic — and so the same
 * search will serve a PDF encoder later without knowing anything about it.
 */
export async function findQuality(req: SearchRequest): Promise<SearchResult> {
  const min = req.min ?? DEFAULT_MIN
  const max = req.max ?? DEFAULT_MAX
  const of = maxAttempts(min, max)
  let attempt = 0

  const measure = async (quality: number): Promise<number> => {
    attempt += 1
    req.onAttempt?.(attempt, of)
    return req.encode(quality)
  }

  // The best case first: if the largest size already fits, there is nothing
  // to search for and the user keeps every bit of quality.
  const atMax = await measure(max)
  if (atMax <= req.targetBytes) return { quality: max, bytes: atMax, missed: false }

  let low = min
  let high = max
  let best: SearchResult | undefined

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const bytes = await measure(mid)
    if (bytes <= req.targetBytes) {
      best = { quality: mid, bytes, missed: false }
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  if (best) return best

  // Nothing fits. Report the smallest achievable rather than writing a file
  // that quietly misses the number the user asked for — the caller shows this
  // so they learn what is actually possible.
  const floor = await req.encode(min)
  return { quality: min, bytes: floor, missed: true }
}
