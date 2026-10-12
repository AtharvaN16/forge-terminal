import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { configPath } from '../config/preferences.js'

/**
 * Is there a newer Forge? (update spec). One small request to the npm
 * registry — the latest version number of forge-terminal and nothing else —
 * at most once a day, remembered beside the config file. Nothing here prints
 * and nothing here throws for want of a network: an offline Mac simply has no
 * news.
 */
export const REGISTRY_URL = 'https://registry.npmjs.org/forge-terminal/latest'
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000
const TIMEOUT_MS = 3000

/** A plain release: pre-releases (`0.0.0-stage`, `1.0.0-beta.1`) are never offered. */
const RELEASE = /^(\d+)\.(\d+)\.(\d+)$/

function parts(v: string): [number, number, number] | undefined {
  const m = RELEASE.exec(v)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined
}

/** Whether `candidate` is a release later than `current`. */
export function isNewer(candidate: string, current: string): boolean {
  const a = parts(candidate)
  const b = parts(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return (a[i] as number) > (b[i] as number)
  }
  return false
}

/**
 * The automatic check runs unless the preference turns it off, or the
 * environment says no one is there to read it (CI) or asks for quiet.
 * `/update` and `forge update` check whatever this says: they were asked.
 */
export function updateChecksEnabled(
  prefs: { updateCheck?: boolean },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (prefs.updateCheck === false) return false
  if (env.CI !== undefined && env.CI !== '' && env.CI !== 'false') return false
  if (env.FORGE_NO_UPDATE_CHECK !== undefined && env.FORGE_NO_UPDATE_CHECK !== '') return false
  return true
}

export interface UpdateCache {
  /** When the registry was last asked, answered or not. */
  checkedAt: number
  /** The latest release it named, if it ever answered. */
  latest?: string
  /** When the note after a command was last printed: once a day at most. */
  notifiedAt?: number
}

export function cachePath(): string {
  return join(dirname(configPath()), 'update-check.json')
}

/** Undefined when there is no cache or it cannot be read: never throws. */
export async function readCache(): Promise<UpdateCache | undefined> {
  try {
    const raw: unknown = JSON.parse(await readFile(cachePath(), 'utf8'))
    if (typeof raw !== 'object' || raw === null) return undefined
    const { checkedAt, latest, notifiedAt } = raw as Record<string, unknown>
    if (typeof checkedAt !== 'number') return undefined
    return {
      checkedAt,
      ...(typeof latest === 'string' && parts(latest) ? { latest } : {}),
      ...(typeof notifiedAt === 'number' ? { notifiedAt } : {}),
    }
  } catch {
    return undefined
  }
}

/** Temp file, then rename (invariant 6): two forges finishing at once cannot tear it. */
export async function writeCache(cache: UpdateCache): Promise<void> {
  const path = cachePath()
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await writeFile(tmp, `${JSON.stringify(cache)}\n`)
    await rename(tmp, path)
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}

/** Absent, more than a day old, or dated in the future (a clock that moved back). */
export function isStale(cache: UpdateCache | undefined, now = Date.now()): boolean {
  if (cache === undefined) return true
  return cache.checkedAt > now || now - cache.checkedAt > CHECK_EVERY_MS
}

export interface FetchOpts {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  timeoutMs?: number
}

/** The registry's latest release, or undefined if it could not be had in time. */
export async function fetchLatest(opts: FetchOpts = {}): Promise<string | undefined> {
  const fetcher = opts.fetchImpl ?? fetch
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
  try {
    const res = await fetcher(REGISTRY_URL, { signal, headers: { accept: 'application/json' } })
    if (!res.ok) return undefined
    const body: unknown = await res.json()
    const version = (body as { version?: unknown } | null)?.version
    return typeof version === 'string' && parts(version) ? version : undefined
  } catch {
    return undefined
  }
}

/**
 * Asks the registry now and remembers the answer. The attempt is recorded
 * even when there is no answer, so an offline Mac asks once a day, not on
 * every run; the last version it did hear about is kept.
 */
export async function checkNow(
  opts: FetchOpts & { now?: number } = {},
): Promise<string | undefined> {
  const latest = await fetchLatest(opts)
  const before = await readCache()
  const next: UpdateCache = {
    checkedAt: opts.now ?? Date.now(),
    ...((latest ?? before?.latest) !== undefined ? { latest: latest ?? before?.latest } : {}),
    ...(before?.notifiedAt !== undefined ? { notifiedAt: before.notifiedAt } : {}),
  }
  await writeCache(next).catch(() => {})
  return latest
}

/** From the cache alone, no network: the newer release to offer, if there is one. */
export async function availableUpdate(current: string): Promise<string | undefined> {
  const latest = (await readCache())?.latest
  return latest !== undefined && isNewer(latest, current) ? latest : undefined
}
