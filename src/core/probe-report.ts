import { resolve } from 'node:path'
import { actionsFor, convertAction } from './actions/index.js'
import { rasterises, targetIdsFor } from './capabilities.js'
import { type InputFailure, resolveInputs } from './resolve.js'
import type { FormatId, SourceInfo } from './types.js'

/**
 * What a file is and what Forge can do with it (spec §3.3), as data. The CLI
 * prints it as text or `--json`, and the MCP server returns it from
 * `forge_probe`.
 *
 * This is a type alias, not an interface: the MCP SDK types `structuredContent`
 * as an index-signature record, which an interface does not satisfy.
 */
export type ProbeReport = {
  path: string
  kind: SourceInfo['kind']
  /** Detected from content, never from the extension (invariant 3). */
  format: FormatId
  bytes: number
  width?: number
  height?: number
  pages?: number
  encrypted?: boolean
  /**
   * `targetIdsFor(source)` — includes the file's own format, which recompresses.
   * For an encrypted PDF, only the formats its pages rasterise to.
   */
  targets: FormatId[]
  /**
   * `actionsFor([source])` ids. Merge is never listed: it needs two or more
   * files. For an encrypted PDF, only `convert`.
   */
  actions: string[]
}

export function describeSource(source: SourceInfo): ProbeReport {
  const common = {
    path: resolve(source.path),
    kind: source.kind,
    format: source.format,
    bytes: source.bytes,
  }
  // An encrypted PDF can only be opened with a password, and only the pdfium
  // raster path takes one: everything else (pdf, docx, every page operation)
  // refuses it with encrypted-source. So probe lists just what will work.
  const locked = source.kind === 'document' && source.encrypted === true
  const can = {
    targets: targetIdsFor(source).filter((t) => !locked || rasterises(t)),
    actions: actionsFor([source])
      .filter((a) => !locked || a.id === convertAction.id)
      .map((a) => a.id),
  }
  if (source.kind === 'image') {
    return { ...common, width: source.width, height: source.height, ...can }
  }
  return { ...common, pages: source.pages, encrypted: source.encrypted, ...can }
}

/**
 * Probes paths, folders or globs the way a conversion resolves them, and
 * writes nothing. A folder is read one level deep, so probing a folder
 * describes each file in it.
 */
export async function probeFiles(
  patterns: string[],
): Promise<{ probes: ProbeReport[]; failures: InputFailure[] }> {
  const resolved = await resolveInputs(patterns, { recursive: false })
  return { probes: resolved.sources.map(describeSource), failures: resolved.failures }
}
