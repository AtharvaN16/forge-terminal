import { readFile, writeFile } from 'node:fs/promises'
import type { LinuxTools, PowerShell } from '../../src/utils/pasteboard.js'
import { WIN_READ, WIN_WRITE } from '../../src/utils/pasteboard.js'

const notFound = (cmd: string) =>
  Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: 'ENOENT', errno: -2 })

/**
 * A Linux desktop's clipboard behind stand-ins for `wl-paste`/`wl-copy` and
 * `xclip`, answering the way the real ones do: one owner offering one or more
 * types, a failure when nothing (or not that type) is copied, and `TARGETS`
 * listed by xclip beside the types. Only the commands in `installed` exist.
 *
 * `lag` makes a copy show up only after that many more commands have run, as
 * xclip's does: it forks before it takes the clipboard over.
 */
export function fakeLinuxDesktop(opts: { installed: string[]; lag?: number }) {
  let held = new Map<string, Buffer>()
  let pending: { held: Map<string, Buffer>; after: number } | undefined
  const calls: string[][] = []
  const tick = () => {
    if (pending && pending.after-- <= 0) {
      held = pending.held
      pending = undefined
    }
  }
  const typeIn = (cmd: string, args: string[]) =>
    args[args.indexOf(cmd === 'xclip' ? '-t' : '--type') + 1] as string
  const tools: LinuxTools = {
    async run(cmd, args) {
      calls.push([cmd, ...args])
      if (!opts.installed.includes(cmd)) throw notFound(cmd)
      tick()
      if (held.size === 0) {
        throw new Error(
          cmd === 'xclip' ? 'Error: target TARGETS not available' : 'Nothing is copied',
        )
      }
      if (args.includes('--list-types') || args.includes('TARGETS')) {
        const types = cmd === 'xclip' ? ['TARGETS', ...held.keys()] : [...held.keys()]
        return Buffer.from(`${types.join('\n')}\n`)
      }
      const bytes = held.get(typeIn(cmd, args))
      if (!bytes) throw new Error('No suitable type of content copied')
      return bytes
    },
    async copy(cmd, args, input) {
      calls.push([cmd, ...args, `< ${input}`])
      if (!opts.installed.includes(cmd)) throw notFound(cmd)
      const next = new Map([[typeIn(cmd, args), await readFile(input)]])
      if (opts.lag) pending = { held: next, after: opts.lag }
      else held = next
    },
  }
  return {
    tools,
    calls,
    held: () => held,
    /** Copies something, as another app would: one owner, these types. */
    hold(types: Record<string, Buffer | string>) {
      held = new Map(
        Object.entries(types).map(([k, v]) => [k, typeof v === 'string' ? Buffer.from(v) : v]),
      )
    },
  }
}

/**
 * Windows' clipboard behind a stand-in for PowerShell that does what
 * `WIN_READ` and `WIN_WRITE` do, from the environment they are given. The
 * scripts themselves only run on Windows; this pins what Forge asks of them.
 */
export function fakeWindowsClipboard() {
  let formats = new Map<string, Buffer>()
  const calls: { script: string; env: Record<string, string> }[] = []
  const ps: PowerShell = async (script, env) => {
    calls.push({ script, env })
    if (script === WIN_READ) {
      const types = [...formats.keys()]
      const file = types.includes(env.FORGE_CLIP_FILE as string)
      const pick =
        (env.FORGE_CLIP_ORDER as string)
          .split('|')
          .find((t) => types.includes(t) && !(file && t === env.FORGE_CLIP_STAND_IN)) ?? null
      const bytes = pick === null ? undefined : formats.get(pick)
      const { createHash } = await import('node:crypto')
      const digest = bytes ? createHash('sha256').update(bytes).digest('hex').toUpperCase() : ''
      if (bytes && env.FORGE_CLIP_PATH) await writeFile(env.FORGE_CLIP_PATH, bytes)
      // ConvertTo-Json gives a one-format list as a bare string.
      return JSON.stringify({ types: types.length === 1 ? types[0] : types, image: pick, digest })
    }
    if (script === WIN_WRITE) {
      const path = env.FORGE_CLIP_PATH as string
      const bytes = await readFile(path)
      formats = new Map((env.FORGE_CLIP_TYPES as string).split('|').map((t) => [t, bytes]))
      formats.set('FileDrop', Buffer.from(path))
      return ''
    }
    throw new Error('unknown script')
  }
  return {
    ps,
    calls,
    formats: () => formats,
    hold(held: Record<string, Buffer | string>) {
      formats = new Map(
        Object.entries(held).map(([k, v]) => [k, typeof v === 'string' ? Buffer.from(v) : v]),
      )
    },
  }
}
