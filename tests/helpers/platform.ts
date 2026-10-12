import { afterAll, beforeAll } from 'vitest'

/**
 * Pins process.platform for the calling test file. The extension tests use
 * Mac catalogue assets and Mac Enhance rows, read through code that defaults
 * to process.platform; pinning lets them run unchanged on the Windows CI job,
 * and is a no-op on a Mac. Windows behaviour is tested by passing 'win32'
 * explicitly. Child processes the tests spawn are not pinned.
 *
 * Called inside a describe it pins that block only, and puts back whatever
 * was there before — so a block can pin the real platform back inside a
 * file pinned to darwin.
 */
export function pinPlatform(platform: NodeJS.Platform): void {
  let before: PropertyDescriptor | undefined
  beforeAll(() => {
    before = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: platform })
  })
  afterAll(() => {
    if (before) Object.defineProperty(process, 'platform', before)
  })
}
