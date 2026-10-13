import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { attributions, type CreditSection, parseLicences } from '../core/attributions.js'
import type { ExtensionStatus } from '../extensions/manager.js'

const FILE = 'third-party-licenses.txt'

/**
 * Where the build put the licence file: beside the bundle, whose chunks sit
 * one folder down (dist/chunks), or under dist/ when run from source.
 */
function candidates(from: string): string[] {
  const out: string[] = []
  let dir = dirname(from)
  for (let i = 0; i < 4; i++) {
    out.push(join(dir, FILE), join(dir, 'dist', FILE))
    dir = dirname(dir)
  }
  return out
}

async function licenceFile(from: string): Promise<{ path: string; text: string } | undefined> {
  for (const path of candidates(fileURLToPath(from))) {
    const text = await readFile(path, 'utf8').catch(() => undefined)
    if (text !== undefined) return { path, text }
  }
  return undefined
}

/**
 * Attributions as this install has it: the bundle's packages from its
 * licence file, and the parts of whichever extensions are installed. A
 * missing file leaves Others with only the native packages, and no ↵.
 */
export async function loadCredits({
  from = import.meta.url,
  list = async () => (await import('../extensions/manager.js')).listExtensions(),
}: {
  /** The module the search starts from: this one, in the bundle or the source. */
  from?: string
  list?: () => Promise<ExtensionStatus[]>
} = {}): Promise<{ sections: CreditSection[]; file?: string }> {
  const [found, statuses] = await Promise.all([licenceFile(from), list().catch(() => [])])
  const { extensionCredits } = await import('./flows/extensions.js')
  const extensions = statuses
    .filter((s) => s.installed !== undefined)
    .flatMap((s) => extensionCredits(s.entry))
  const sections = attributions({ bundled: parseLicences(found?.text ?? ''), extensions })
  return found ? { sections, file: found.path } : { sections }
}
