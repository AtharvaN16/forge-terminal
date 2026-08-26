import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Forge is MIT. A strong-copyleft dependency would force the whole distributed
 * work to that licence, and nothing else in this suite would notice.
 *
 * This exists because it already happened: `mupdf` was added for PDF
 * rasterisation and is AGPL-3.0-or-later. It was caught by a human reading a
 * review, one task before it would have shipped. Automated here so the next one
 * is caught by the suite instead.
 *
 * Strong copyleft (AGPL, GPL) fails. Weak copyleft (LGPL) passes: Forge already
 * ships ten LGPL-3.0-or-later packages — Sharp's prebuilt libvips binaries —
 * which load as separate shared libraries and carry a relinking obligation
 * rather than a licence-conversion one. That is why this matches GPL only when
 * it is NOT preceded by an L, instead of grepping for the substring.
 */

const lockPath = fileURLToPath(new URL('../../package-lock.json', import.meta.url))

/** `AGPL-3.0`, `GPL-2.0` match. `LGPL-3.0` does not. */
const STRONG_COPYLEFT = /(^|[^L])GPL/

/**
 * A disjunctive SPDX expression ("MIT OR GPL-3.0-or-later") only forces
 * copyleft if EVERY alternative is copyleft — the whole point of an OR is
 * that the recipient may choose either. jszip (pulled in transitively by
 * `mammoth`/`docx`) ships exactly this shape, dual-licensed MIT/GPL, and
 * Forge exercises the MIT option.
 */
function isStrongCopyleft(license: string): boolean {
  return license.split(/\s+OR\s+/).every((part) => STRONG_COPYLEFT.test(part))
}

type LockPackage = { license?: string; dev?: boolean }
type Lock = { packages?: Record<string, LockPackage> }

async function productionPackages(): Promise<Array<[string, LockPackage]>> {
  const lock = JSON.parse(await readFile(lockPath, 'utf8')) as Lock
  return Object.entries(lock.packages ?? {}).filter(([path, meta]) => path !== '' && !meta.dev)
}

describe('dependency licences', () => {
  it('ships no strong-copyleft package', async () => {
    const offenders = (await productionPackages())
      .filter(([, meta]) => meta.license !== undefined && isStrongCopyleft(meta.license))
      .map(([path, meta]) => `${path} (${meta.license})`)

    // Named in the failure so the reader sees WHICH package and WHICH licence,
    // rather than a bare `expected 1 to be 0`.
    expect(offenders).toEqual([])
  })

  it('can still see a licence for every production package', async () => {
    // The test above is only as good as the data. If npm stops writing
    // `license` into the lockfile, the check silently passes on everything —
    // so assert the coverage that makes it meaningful.
    const missing = (await productionPackages())
      .filter(([, meta]) => meta.license === undefined)
      .map(([path]) => path)

    expect(missing).toEqual([])
  })

  it('rejects an AGPL package and tolerates an LGPL one', async () => {
    // Guards the regex itself. Written against literals rather than the real
    // lockfile so it keeps testing the rule after the dependency set changes.
    expect(STRONG_COPYLEFT.test('AGPL-3.0-or-later')).toBe(true)
    expect(STRONG_COPYLEFT.test('GPL-3.0-only')).toBe(true)
    expect(STRONG_COPYLEFT.test('LGPL-3.0-or-later')).toBe(false)
    expect(STRONG_COPYLEFT.test('Apache-2.0 AND LGPL-3.0-or-later')).toBe(false)
    expect(STRONG_COPYLEFT.test('MIT')).toBe(false)
  })

  it('only flags a disjunctive licence when every alternative is strong copyleft', () => {
    // Guards `isStrongCopyleft` itself, the same way the test above guards
    // the raw regex. jszip's real lockfile shape is the first case; the
    // second is the hypothetical this must still catch.
    expect(isStrongCopyleft('MIT OR GPL-3.0-or-later')).toBe(false)
    expect(isStrongCopyleft('GPL-3.0-only OR AGPL-3.0-or-later')).toBe(true)
    expect(isStrongCopyleft('GPL-3.0-only')).toBe(true)
  })
})
