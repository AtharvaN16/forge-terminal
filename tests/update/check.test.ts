import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  availableUpdate,
  CHECK_EVERY_MS,
  cachePath,
  checkNow,
  fetchLatest,
  isNewer,
  isStale,
  REGISTRY_URL,
  readCache,
  updateChecksEnabled,
  writeCache,
} from '../../src/update/check.js'
import { makeTempDir } from '../helpers/fixtures.js'

const reply = (body: unknown, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

describe('isNewer', () => {
  it('compares each part as a number', () => {
    expect(isNewer('0.2.2', '0.2.1')).toBe(true)
    expect(isNewer('0.10.0', '0.9.9')).toBe(true)
    expect(isNewer('1.0.0', '0.99.99')).toBe(true)
  })

  it('is false for the same or an older version', () => {
    expect(isNewer('0.2.1', '0.2.1')).toBe(false)
    expect(isNewer('0.2.0', '0.2.1')).toBe(false)
  })

  it('never offers a pre-release or anything that is not a version', () => {
    expect(isNewer('0.3.0-beta.1', '0.2.1')).toBe(false)
    expect(isNewer('0.0.0-stage', '0.2.1')).toBe(false)
    expect(isNewer('latest', '0.2.1')).toBe(false)
    expect(isNewer('', '0.2.1')).toBe(false)
  })
})

describe('updateChecksEnabled', () => {
  it('is on unless something turns it off', () => {
    expect(updateChecksEnabled({}, {})).toBe(true)
    expect(updateChecksEnabled({ updateCheck: true }, {})).toBe(true)
  })

  it('is off when the preference says so', () => {
    expect(updateChecksEnabled({ updateCheck: false }, {})).toBe(false)
  })

  it('is off on CI and when FORGE_NO_UPDATE_CHECK is set', () => {
    expect(updateChecksEnabled({}, { CI: 'true' })).toBe(false)
    expect(updateChecksEnabled({}, { FORGE_NO_UPDATE_CHECK: '1' })).toBe(false)
  })
})

describe('fetchLatest', () => {
  it('asks the registry for the latest version only', async () => {
    let asked = ''
    const fetchImpl = (async (url: string) => {
      asked = url
      return new Response(JSON.stringify({ name: 'forge-terminal', version: '0.2.2' }))
    }) as unknown as typeof fetch
    expect(await fetchLatest({ fetchImpl })).toBe('0.2.2')
    expect(asked).toBe(REGISTRY_URL)
  })

  it('answers undefined, never throws, when the registry cannot be used', async () => {
    expect(await fetchLatest({ fetchImpl: reply({}, 500) })).toBeUndefined()
    expect(await fetchLatest({ fetchImpl: reply({ version: 'nope' }) })).toBeUndefined()
    const offline = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    expect(await fetchLatest({ fetchImpl: offline })).toBeUndefined()
  })

  it('gives up after the timeout instead of hanging', async () => {
    const never = ((_url: string, init?: RequestInit) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })) as unknown as typeof fetch
    expect(await fetchLatest({ fetchImpl: never, timeoutMs: 20 })).toBeUndefined()
  })
})

describe('the once-a-day cache', () => {
  let saved: string | undefined
  beforeEach(async () => {
    saved = process.env.XDG_CONFIG_HOME
    process.env.XDG_CONFIG_HOME = await makeTempDir()
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = saved
  })

  it('lives beside the config file', () => {
    expect(cachePath()).toBe(join(process.env.XDG_CONFIG_HOME ?? '', 'forge', 'update-check.json'))
  })

  it('round-trips, and a missing or broken file reads as no cache', async () => {
    expect(await readCache()).toBeUndefined()
    await writeCache({ checkedAt: 5, latest: '0.2.2' })
    expect(await readCache()).toEqual({ checkedAt: 5, latest: '0.2.2' })
    await writeFile(cachePath(), '{not json')
    expect(await readCache()).toBeUndefined()
  })

  it('is stale when absent, older than a day, or from the future', () => {
    const now = 10 * CHECK_EVERY_MS
    expect(isStale(undefined, now)).toBe(true)
    expect(isStale({ checkedAt: now - CHECK_EVERY_MS - 1 }, now)).toBe(true)
    expect(isStale({ checkedAt: now - 1000 }, now)).toBe(false)
    expect(isStale({ checkedAt: now + 60_000 }, now)).toBe(true)
  })

  it('checkNow records the answer and keeps when the note was last shown', async () => {
    await writeCache({ checkedAt: 1, latest: '0.2.1', notifiedAt: 7 })
    expect(await checkNow({ fetchImpl: reply({ version: '0.2.2' }), now: 1000 })).toBe('0.2.2')
    expect(JSON.parse(await readFile(cachePath(), 'utf8'))).toEqual({
      checkedAt: 1000,
      latest: '0.2.2',
      notifiedAt: 7,
    })
  })

  it('checkNow offline still records the attempt, so the day is not spent retrying', async () => {
    const offline = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    await writeCache({ checkedAt: 1, latest: '0.2.2' })
    expect(await checkNow({ fetchImpl: offline, now: 1000 })).toBeUndefined()
    expect(await readCache()).toEqual({ checkedAt: 1000, latest: '0.2.2' })
  })

  it('availableUpdate reads the cache only, and names a version newer than this one', async () => {
    expect(await availableUpdate('0.2.1')).toBeUndefined()
    await writeCache({ checkedAt: 1, latest: '0.2.2' })
    expect(await availableUpdate('0.2.1')).toBe('0.2.2')
    expect(await availableUpdate('0.2.2')).toBeUndefined()
  })
})
