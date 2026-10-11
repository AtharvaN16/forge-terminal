import { CATALOG, type ExtensionId } from './catalog.js'
import { installed } from './paths.js'

/** Ids of the extensions that are installed and intact. Offline, cheap, never throws. */
export async function installedExtensionIds(): Promise<Set<ExtensionId>> {
  const found = await Promise.all(CATALOG.map(async (e) => ((await installed(e.id)) ? e.id : null)))
  return new Set(found.filter((id): id is ExtensionId => id !== null))
}
