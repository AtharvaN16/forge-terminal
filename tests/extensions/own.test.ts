import { chmod, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  chosenPath,
  findOwn,
  newer,
  type OwnCopy,
  ownUpdate,
  probeOwn,
  resolveYtDlp,
  searchDirs,
  setChosenPath,
  updateOwn,
} from '../../src/extensions/own.js'
import { installed } from '../../src/extensions/paths.js'
import { fakeYtDlp } from '../helpers/fake-ytdlp.js'
import { makeTempDir } from '../helpers/fixtures.js'

const saved = { xdg: process.env.XDG_CONFIG_HOME, off: process.env.FORGE_NO_OWN_TOOLS }
beforeEach(async () => {
  process.env.XDG_CONFIG_HOME = await makeTempDir()
})
afterEach(() => {
  for (const [k, v] of [
    ['XDG_CONFIG_HOME', saved.xdg],
    ['FORGE_NO_OWN_TOOLS', saved.off],
  ] as const) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

/** A yt-dlp of the user's own: answers --version with `version`. */
async function ownYtDlp(dir: string, version = '2026.10.03'): Promise<string> {
  await mkdir(dir, { recursive: true })
  const path = join(dir, 'yt-dlp')
  await writeFile(
    path,
    `#!${process.execPath}\nif (process.argv.includes('--version')) console.log(${JSON.stringify(version)})\n`,
  )
  await chmod(path, 0o755)
  return path
}

describe('newer', () => {
  it('compares dotted versions part by part, as numbers', () => {
    expect(newer('2026.10.03', '2026.08.19')).toBe(true)
    expect(newer('2026.08.19', '2026.08.19')).toBe(false)
    expect(newer('2026.8.2', '2026.08.19')).toBe(false)
    expect(newer('2026.08.19.1', '2026.08.19')).toBe(true)
  })
})

describe('searchDirs', () => {
  it('is PATH, then Homebrew on a Mac; the deep look adds the usual user folders', () => {
    const env = { PATH: '/a:/b', HOME: '/Users/x' }
    expect(searchDirs({ platform: 'darwin', env })).toEqual([
      '/a',
      '/b',
      '/opt/homebrew/bin',
      '/usr/local/bin',
    ])
    expect(searchDirs({ platform: 'darwin', env, deep: true })).toEqual(
      expect.arrayContaining(['/Users/x/.local/bin', '/Users/x/bin', '/opt/local/bin']),
    )
  })
})

describe('probeOwn', () => {
  it('reads the version, and calls it Homebrew’s when it lives in a Cellar', async () => {
    const root = await makeTempDir()
    const real = await ownYtDlp(join(root, 'Cellar', 'yt-dlp', '2026.10.03', 'bin'))
    await mkdir(join(root, 'bin'))
    await symlink(real, join(root, 'bin', 'yt-dlp'))
    const copy = await probeOwn('yt-dlp', join(root, 'bin', 'yt-dlp'))
    expect(copy).toMatchObject({ version: '2026.10.03', homebrew: true, tooOld: false })
  })

  it('is too old below the version this Forge is tested with', async () => {
    const path = await ownYtDlp(await makeTempDir(), '2025.01.15')
    expect(await probeOwn('yt-dlp', path)).toMatchObject({ homebrew: false, tooOld: true })
  })

  it('is nothing for a file that does not answer as yt-dlp', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'yt-dlp')
    await writeFile(path, '#!/bin/sh\nexit 3\n')
    await chmod(path, 0o755)
    expect(await probeOwn('yt-dlp', path)).toBeUndefined()
    expect(await probeOwn('yt-dlp', join(dir, 'missing'))).toBeUndefined()
  })
})

describe('findOwn', () => {
  it('finds yt-dlp in the folders it is given', async () => {
    const dir = await makeTempDir()
    const path = await ownYtDlp(dir)
    expect(await findOwn('yt-dlp', { dirs: ['/nowhere', dir] })).toMatchObject({ path })
  })

  it('looks only where told when the suite switches the search off', async () => {
    process.env.FORGE_NO_OWN_TOOLS = '1'
    expect(await findOwn('yt-dlp')).toBeUndefined()
  })

  it('a chosen path wins, and is kept between runs', async () => {
    const onPath = await ownYtDlp(await makeTempDir(), '2026.10.03')
    const chosen = await ownYtDlp(await makeTempDir(), '2026.09.01')
    await setChosenPath('yt-dlp', chosen)
    expect(await chosenPath('yt-dlp')).toBe(chosen)
    expect(await findOwn('yt-dlp', { dirs: [onPath.replace(/\/yt-dlp$/, '')] })).toMatchObject({
      path: chosen,
      version: '2026.09.01',
    })
    await setChosenPath('yt-dlp', undefined)
    expect(await chosenPath('yt-dlp')).toBeUndefined()
  })
})

describe('resolveYtDlp', () => {
  it('uses yours when it is new enough, and removes Forge’s copy', async () => {
    await fakeYtDlp({})
    const mine = await ownYtDlp(await makeTempDir())
    const got = await resolveYtDlp({ dirs: [mine.replace(/\/yt-dlp$/, '')] })
    expect(got).toMatchObject({ entry: mine, own: true })
    expect(await installed('yt-dlp')).toBeUndefined()
  })

  it('keeps to Forge’s copy when yours is too old', async () => {
    await fakeYtDlp({})
    const mine = await ownYtDlp(await makeTempDir(), '2025.01.15')
    const got = await resolveYtDlp({ dirs: [mine.replace(/\/yt-dlp$/, '')] })
    expect(got).toMatchObject({ own: false })
    expect(await installed('yt-dlp')).toBeDefined()
  })

  it('is nothing with neither', async () => {
    expect(await resolveYtDlp({ dirs: [] })).toBeUndefined()
  })
})

/** A brew that records its argv and answers `outdated` with `current`. */
async function fakeBrew(current?: string): Promise<{ brew: string; calls: string }> {
  const dir = await makeTempDir()
  const brew = join(dir, 'brew')
  const calls = join(dir, 'calls.jsonl')
  const outdated = current
    ? JSON.stringify({ formulae: [{ name: 'yt-dlp', current_version: current }] })
    : JSON.stringify({ formulae: [] })
  await writeFile(
    brew,
    `#!${process.execPath}
const fs = require('node:fs')
const a = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(a) + '\\n')
if (a[0] === 'outdated') console.log(${JSON.stringify(outdated)})
`,
  )
  await chmod(brew, 0o755)
  return { brew, calls }
}
const homebrewCopy = (path: string): OwnCopy => ({
  id: 'yt-dlp',
  path,
  version: '2026.10.03',
  homebrew: true,
  tooOld: false,
})

describe('ownUpdate', () => {
  it('asks Homebrew for a newer version of its own copy', async () => {
    const { brew } = await fakeBrew('2026.11.02')
    expect(await ownUpdate(homebrewCopy('/x/yt-dlp'), { brew })).toBe('2026.11.02')
    const none = await fakeBrew()
    expect(await ownUpdate(homebrewCopy('/x/yt-dlp'), { brew: none.brew })).toBeUndefined()
  })

  it('knows a copy older than the pinned version has one, without asking', async () => {
    const copy: OwnCopy = { ...homebrewCopy('/x'), homebrew: false, tooOld: true }
    expect(await ownUpdate(copy, { brew: '/missing' })).toBe('2026.08.19')
  })
})

describe('updateOwn', () => {
  it('runs brew upgrade for Homebrew’s copy', async () => {
    const { brew, calls } = await fakeBrew()
    await updateOwn(homebrewCopy('/x/yt-dlp'), { brew })
    expect(await readFile(calls, 'utf8')).toContain('["upgrade","yt-dlp"]')
  })

  it('lets any other yt-dlp update itself', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'yt-dlp')
    const calls = join(dir, 'calls')
    await writeFile(
      path,
      `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(calls)}, process.argv.slice(2).join(' ') + '\\n')\n`,
    )
    await chmod(path, 0o755)
    await updateOwn({ ...homebrewCopy(path), homebrew: false }, { brew: '/missing' })
    expect(await readFile(calls, 'utf8')).toBe('--update\n')
  })

  it('says why when the update fails', async () => {
    const dir = await makeTempDir()
    const brew = join(dir, 'brew')
    await writeFile(brew, '#!/bin/sh\necho "Error: no network" >&2\nexit 1\n')
    await chmod(brew, 0o755)
    await expect(updateOwn(homebrewCopy('/x/yt-dlp'), { brew })).rejects.toThrow('no network')
  })
})
