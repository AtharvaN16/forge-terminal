import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { unsupportedOperation } from '../../src/core/errors.js'
import { makeJpeg, makePdf, makePng, makeTempDir } from '../helpers/fixtures.js'

/**
 * What src/index.ts does with an argv. Anything parseArgs throws (other than
 * --help/--version, which never appear here) exits 2. Otherwise execute()
 * decides.
 */
async function exitOf(argv: string[]): Promise<number> {
  let intent: ReturnType<typeof parseArgs>
  try {
    intent = parseArgs(argv)
  } catch {
    return 2
  }
  return (await execute(intent)).exitCode
}

interface Fixtures {
  jpg: string
  png: string
  pdf3: string
  pdf1: string
  ghost: string
}

let dir: string
const savedXdg = process.env.XDG_CONFIG_HOME

beforeEach(async () => {
  dir = await makeTempDir()
  process.env.XDG_CONFIG_HOME = dir
})

afterEach(() => {
  if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = savedXdg
})

async function fixtures(): Promise<Fixtures> {
  return {
    jpg: await makeJpeg(dir, 'a.jpg'),
    png: await makePng(dir, 'b.png'),
    pdf3: await makePdf(dir, 'three.pdf', 3),
    pdf1: await makePdf(dir, 'one.pdf', 1),
    ghost: join(dir, 'ghost.jpg'),
  }
}

const CASES: { name: string; argv: (f: Fixtures) => string[]; code: 0 | 1 | 2 }[] = [
  // 2 — the command itself is invalid, whatever file it names
  { name: 'an unknown flag', argv: (f) => [f.jpg, '--bogus'], code: 2 },
  { name: 'a flag missing its value', argv: (f) => [f.jpg, '--to'], code: 2 },
  { name: 'no target format', argv: (f) => [f.jpg], code: 2 },
  { name: 'a format Forge does not know', argv: (f) => [f.jpg, '--to', 'mp4'], code: 2 },
  {
    name: 'contradictory flags',
    argv: (f) => [f.jpg, '--quality', '40', '--max-size', '1mb'],
    code: 2,
  },
  {
    name: 'two page operations at once',
    argv: (f) => [f.pdf3, '--rotate', '90', '--delete', '2'],
    code: 2,
  },
  {
    name: 'an invalid config value',
    argv: () => ['config', 'set', 'theme', 'chartreuse'],
    code: 2,
  },
  // 0 — everything worked
  { name: 'a conversion that works', argv: (f) => [f.jpg, '--to', 'webp'], code: 0 },
  // 1 — understood, but these files could not be done; other files could
  { name: 'a missing file', argv: (f) => [f.ghost, '--to', 'webp'], code: 1 },
  { name: 'a target this file cannot become', argv: (f) => [f.jpg, '--to', 'heic'], code: 1 },
  { name: 'compressing a lossless file', argv: (f) => [f.png, '--quality', '50'], code: 1 },
  { name: 'merging something that is not a PDF', argv: (f) => [f.jpg, f.pdf3, '--merge'], code: 1 },
  { name: 'merging a single PDF', argv: (f) => [f.pdf3, '--merge'], code: 1 },
  { name: 'splitting a one-page PDF', argv: (f) => [f.pdf1, '--split', 'every-page'], code: 1 },
  { name: 'a split point past the last page', argv: (f) => [f.pdf3, '--split', 'at=9'], code: 1 },
  {
    name: 'extracting a page that does not exist',
    argv: (f) => [f.pdf3, '--extract', '9'],
    code: 1,
  },
  {
    name: 'rendering a page that does not exist',
    argv: (f) => [f.pdf3, '--to', 'png', '--pages', '9'],
    code: 1,
  },
]

describe('exit codes (spec §3.4)', () => {
  for (const c of CASES) {
    it(`${c.code} for ${c.name}`, async () => {
      expect(await exitOf(c.argv(await fixtures()))).toBe(c.code)
    })
  }

  it('reports a page operation that does not fit the files on stderr, not by throwing', async () => {
    const f = await fixtures()
    const out = await execute(parseArgs([f.jpg, f.pdf3, '--merge']))
    expect(out.stdout).toEqual([])
    expect(out.stderr.join('\n')).toContain('PDFs only')
  })
})

describe('unsupportedOperation', () => {
  it('has its own code, distinct from invalid-arguments (which always means exit 2)', () => {
    const e = unsupportedOperation('merge', 'PDFs only')
    expect(e.code).toBe('unsupported-operation')
    expect(e.detail).toContain('PDFs only')
    expect(e.hint).toBeTruthy()
  })
})
