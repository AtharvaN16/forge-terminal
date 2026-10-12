import type { ExtensionJson, ExtensionsJson } from '../core/report-data.js'
import { formatBytes } from '../core/units.js'
import { assetFor, type CatalogEntry } from '../extensions/catalog.js'
import type { ExtensionStatus } from '../extensions/manager.js'
import type { ExtensionsIntent } from './args.js'

export interface ExtensionsResult {
  stdout: string[]
  data: Pick<ExtensionsJson, 'extensions' | 'changed'>
}

/**
 * The catalogue's version for this machine. With no build for this chip, this
 * OS's own: an Intel Mac is still told boost is 1.0.0, as before assets had versions.
 */
function catalogVersion(entry: CatalogEntry): string {
  const own = Object.entries(entry.assets).find(([key]) => key.startsWith(`${process.platform}-`))
  return assetFor(entry)?.version ?? own?.[1]?.version ?? ''
}

export function toExtensionJson(s: ExtensionStatus): ExtensionJson {
  return {
    id: s.entry.id,
    title: s.entry.title,
    summary: s.entry.summary,
    version: catalogVersion(s.entry),
    licence: s.entry.licence,
    installed: s.installed ?? null,
    updateAvailable: s.updateAvailable,
    supported: s.supported,
    ...(s.reason !== undefined ? { reason: s.reason } : {}),
    ...(s.downloadBytes !== undefined ? { downloadBytes: s.downloadBytes } : {}),
  }
}

function stateOf(s: ExtensionStatus): string {
  if (!s.supported) return `not available: ${s.reason ?? 'unsupported here'}`
  if (s.installed === undefined) {
    const size = s.downloadBytes ? `, ${formatBytes(s.downloadBytes)} download` : ''
    return `not installed${size}`
  }
  if (s.updateAvailable)
    return `installed ${s.installed}, update to ${assetFor(s.entry)?.version} available`
  return `installed ${s.installed}`
}

function listLines(all: ExtensionStatus[]): string[] {
  const width = Math.max(...all.map((s) => s.entry.id.length))
  return all.flatMap((s, i) => [
    ...(i > 0 ? [''] : []),
    `${s.entry.id.padEnd(width)}  ${s.entry.summary}`,
    `${' '.repeat(width)}  ${stateOf(s)}`,
    `${' '.repeat(width)}  ${s.entry.licence}`,
  ])
}

/**
 * Returns lines and data rather than printing, like every cli/ module. The
 * manager is imported here, so only `forge extensions` pays for it.
 * Download progress is the caller's: `onDownload` receives real byte counts.
 */
export async function runExtensions(
  intent: ExtensionsIntent,
  opts: { onDownload?: (done: number, total: number) => void } = {},
): Promise<ExtensionsResult> {
  const { installExtension, listExtensions, removeExtension } = await import(
    '../extensions/manager.js'
  )
  let changed: ExtensionsJson['changed']
  let message: string | undefined

  if (intent.action === 'add' && intent.id !== undefined) {
    const before = (await listExtensions()).find((s) => s.entry.id === intent.id)
    const upToDate = before?.installed !== undefined && !before.updateAvailable
    const have = await installExtension(intent.id, { onProgress: opts.onDownload })
    changed = { id: intent.id, action: upToDate ? 'unchanged' : 'added' }
    message = upToDate
      ? `${intent.id} ${have.version} is already installed`
      : `Installed ${intent.id} ${have.version}`
  } else if (intent.action === 'remove' && intent.id !== undefined) {
    const removed = await removeExtension(intent.id)
    changed = { id: intent.id, action: removed ? 'removed' : 'unchanged' }
    message = removed ? `Removed ${intent.id}` : `${intent.id} was not installed`
  }

  const all = await listExtensions()
  return {
    stdout: message === undefined ? listLines(all) : [message],
    data: { extensions: all.map(toExtensionJson), ...(changed ? { changed } : {}) },
  }
}
