import type { ExtensionStatus } from './manager.js'

/**
 * whisper is for where Apple's recogniser is not: a Mac that hears for itself
 * does not list it, unless it is installed (then it can still be removed).
 * Read lazily: transcribe's engine asks Apple's helper, which only this needs.
 */
export async function hideUnneeded(list: ExtensionStatus[]): Promise<ExtensionStatus[]> {
  const whisper = list.find((s) => s.entry.id === 'whisper')
  if (whisper === undefined || whisper.installed !== undefined) return list
  const { whisperUseful } = await import('../engines/transcribe.js')
  return (await whisperUseful()) ? list : list.filter((s) => s !== whisper)
}
