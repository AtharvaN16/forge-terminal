import { afterAll, beforeAll } from 'vitest'

/**
 * Pins process.platform for the calling test file. The extension tests use
 * Mac catalogue assets and Mac Enhance rows, read through code that defaults
 * to process.platform; pinning lets them run unchanged on the Windows CI job,
 * and is a no-op on a Mac. Windows behaviour is tested by passing 'win32'
 * explicitly. Child processes the tests spawn are not pinned.
 */
export function pinPlatform(platform: NodeJS.Platform): void {
  const real = Object.getOwnPropertyDescriptor(process, 'platform') as PropertyDescriptor
  beforeAll(() => {
    Object.defineProperty(process, 'platform', { value: platform })
  })
  afterAll(() => {
    Object.defineProperty(process, 'platform', real)
  })
}
