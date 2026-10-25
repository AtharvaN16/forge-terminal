import { readFileSync } from 'node:fs'
import { join, posix, win32 } from 'node:path'
import type { Deps } from '../../src/engines/system-fonts.js'

const FIXTURES = join(process.cwd(), 'tests', 'fixtures', 'fonts')

/**
 * A computer's fonts, for a test: `files` maps a path on it to one of the font
 * files in tests/fixtures/fonts (a file by the name of a font a real OS has),
 * and `fc` what fontconfig answers for a pattern, as `path<TAB>index` lines.
 * It reads nothing else, so a test gets the same answer on any machine.
 */
export function fakeSystem(o: {
  platform: NodeJS.Platform
  files?: Record<string, string>
  fc?: Record<string, string[]>
  env?: NodeJS.ProcessEnv
  /** Pretend fontconfig is not installed. */
  noFc?: boolean
}): Deps & { asked: string[] } {
  const files = o.files ?? {}
  const path = o.platform === 'win32' ? win32 : posix
  const asked: string[] = []
  return {
    platform: o.platform,
    env: o.env ?? {},
    home: o.platform === 'win32' ? 'C:\\Users\\u' : '/home/u',
    asked,
    exists: (p) => p in files,
    list: (dir) => {
      const names = new Set<string>()
      for (const f of Object.keys(files)) {
        let at = f
        while (at !== path.dirname(at)) {
          if (path.dirname(at) === dir) names.add(path.basename(at))
          at = path.dirname(at)
        }
      }
      return [...names]
    },
    run: async (cmd, args) => {
      if (cmd !== 'fc-match' || o.noFc) return undefined
      const pattern = args.at(-1) ?? ''
      asked.push(pattern)
      const lines = o.fc?.[pattern]
      return lines ? `${lines.join('\n')}\n` : ''
    },
    read: (p) => {
      const fixture = files[p]
      return fixture === undefined ? undefined : readFileSync(join(FIXTURES, fixture))
    },
  }
}

/** A computer with no fonts at all: only Noto Sans, which Forge carries, is there. */
export const noFonts = fakeSystem({ platform: 'linux', noFc: true })
