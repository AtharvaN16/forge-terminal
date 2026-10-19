import { describe, expect, it } from 'vitest'
import { modulesLoaded } from '../helpers/load-log.js'

/**
 * `forge uninstall` has npm delete Forge while Forge is running. On Windows a
 * loaded sharp holds its DLL open and npm cannot delete it, so nothing on the
 * uninstall path may load sharp.
 */
describe('the uninstall path', () => {
  it('loads no sharp', async () => {
    const { urls, exitCode, stderr } = await modulesLoaded([
      '--input-type=module',
      '-e',
      "await import('./src/menu/entry.ts'); await import('./src/cli/args.ts')",
    ])
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    expect(urls.filter((u) => u.includes('/node_modules/sharp/'))).toEqual([])
  }, 30_000)
})
