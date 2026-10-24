import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The bytes of every file under `dir`; its own `node_modules` left out when `deps` is false. */
async function bytesUnder(dir: string, deps = true): Promise<number> {
  let total = 0
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!deps && e.name === 'node_modules') continue
    const path = join(dir, e.name)
    if (e.isDirectory()) total += await bytesUnder(path)
    else if (e.isFile()) total += (await stat(path).catch(() => undefined))?.size ?? 0
  }
  return total
}

interface Manifest {
  name?: string
  files?: string[]
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}
const manifestOf = async (dir: string): Promise<Manifest | undefined> =>
  JSON.parse(await readFile(join(dir, 'package.json'), 'utf8').catch(() => 'null')) ?? undefined

/** Where `name` resolves from `from`, as Node would: the nearest node_modules up the tree. */
async function resolveDep(name: string, from: string): Promise<string | undefined> {
  for (let dir = from; ; dir = dirname(dir)) {
    const at = join(dir, 'node_modules', name)
    if (await manifestOf(at)) return at
    if (dirname(dir) === dir) return undefined
  }
}

/** The folder holding Forge's package.json, found up from this file. */
export async function packageRoot(from = dirname(fileURLToPath(import.meta.url))) {
  for (let dir = from; ; dir = dirname(dir)) {
    if ((await manifestOf(dir))?.name === 'forge-terminal') return dir
    if (dirname(dir) === dir) return undefined
  }
}

/**
 * What Forge itself takes on disk: what npm installs of it — the package's
 * own `files`, its package.json, README and LICENSE — and every dependency it
 * needs to run, each counted once, wherever npm put it. The same answer from
 * an install and from a checkout, which also holds tests, mockups and the
 * tools that build it.
 */
export async function installBytes(root: string): Promise<number> {
  const own = await manifestOf(root)
  if (!own) return 0
  let total = 0
  for (const name of [...(own.files ?? []), 'package.json', 'README.md', 'LICENSE']) {
    const path = join(root, name)
    const s = await stat(path).catch(() => undefined)
    if (s?.isDirectory()) total += await bytesUnder(path)
    else if (s?.isFile()) total += s.size
  }
  const seen = new Set<string>()
  const queue: Array<[string, string]> = []
  const need = (m: Manifest, from: string) => {
    for (const name of Object.keys({ ...m.dependencies, ...m.optionalDependencies }))
      queue.push([name, from])
  }
  need(own, root)
  while (queue.length > 0) {
    const [name, from] = queue.shift() as [string, string]
    const dir = await resolveDep(name, from)
    if (!dir || seen.has(dir)) continue
    seen.add(dir)
    // Its own node_modules are counted as the dependencies resolve into them.
    total += await bytesUnder(dir, false)
    const m = await manifestOf(dir)
    if (m) need(m, dir)
  }
  return total
}
