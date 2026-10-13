import { updateUnreachable } from '../core/errors.js'

/**
 * `forge update`: ask npm now and, if a newer Forge is out, install it (the
 * same install /update's ↵ runs). The running process keeps its old code;
 * the next `forge` starts the new one. Lines and data, never printing.
 */
export interface UpdateResult {
  stdout: string[]
  data: { current: string; latest: string; installed: boolean }
}

export async function runUpdate(
  current: string,
  deps: {
    check?: () => Promise<string | undefined>
    install?: (version: string) => Promise<void>
    onInstalling?: (version: string) => void
  } = {},
): Promise<UpdateResult> {
  const check = deps.check ?? (async () => (await import('../update/check.js')).checkNow())
  const install =
    deps.install ?? (async (v: string) => (await import('../update/install.js')).installUpdate(v))
  const latest = await check()
  if (latest === undefined) throw updateUnreachable()
  const { isNewer } = await import('../update/check.js')
  if (!isNewer(latest, current)) {
    return {
      stdout: [`✓ Forge ${current} is the latest.`],
      data: { current, latest, installed: false },
    }
  }
  deps.onInstalling?.(latest)
  await install(latest)
  return {
    stdout: [`✓ Forge ${latest} is installed. It runs from your next forge.`],
    data: { current, latest, installed: true },
  }
}
