import type { ExtensionStatus } from './manager.js'

/**
 * whisper and read-text are for where Apple's recogniser and reader are not:
 * a Mac that hears, or reads, for itself does not list them, unless they are
 * installed (then they can still be removed).
 * Read lazily: transcribe's engine asks Apple's helper, which only this needs.
 */
export async function hideUnneeded(list: ExtensionStatus[]): Promise<ExtensionStatus[]> {
  const spare = list.filter(
    (s) => (s.entry.id === 'whisper' || s.entry.id === 'read-text') && s.installed === undefined,
  )
  if (spare.length === 0) return list
  const { appleDoes } = await import('../engines/transcribe.js')
  const apple = await appleDoes()
  return list.filter(
    (s) => !spare.includes(s) || (s.entry.id === 'whisper' ? !apple.hears : !apple.reads),
  )
}
