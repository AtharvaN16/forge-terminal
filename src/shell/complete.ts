import type { Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { expandTilde } from '../config/preferences.js'
import { readableFormats } from '../core/capabilities.js'
import { FORMATS } from '../core/formats.js'

export interface Completion {
  /** The fragment with as much appended as could be resolved unambiguously. */
  completed: string
  /** Basenames of every candidate, directories suffixed with `/`. Empty when unique. */
  matches: string[]
}

/**
 * Derived from the capability graph, never a hardcoded list (invariant 2).
 *
 * This is an **advisory display filter only**. Invariant 3 — sources are
 * probed by content, never by extension — is untouched: `probe()` still
 * decides what a file actually is, so a file this filter hides can still be
 * typed in full and converted. The filter exists so Tab does not offer a
 * `.txt` that the next step would only reject.
 */
function convertibleExtensions(): Set<string> {
  const set = new Set<string>()
  for (const id of readableFormats()) {
    for (const ext of FORMATS[id].extensions) set.add(ext.toLowerCase())
  }
  return set
}

/** Case-insensitive, because that is how the macOS filesystem compares names. */
function longestCommonPrefix(values: string[]): string {
  const first = values[0]
  if (first === undefined) return ''
  let prefix = first
  for (const v of values.slice(1)) {
    let i = 0
    while (i < prefix.length && i < v.length && prefix[i]?.toLowerCase() === v[i]?.toLowerCase()) {
      i++
    }
    prefix = prefix.slice(0, i)
  }
  return prefix
}

/**
 * Reads exactly one directory and never recurses.
 *
 * An unreadable directory returns the fragment unchanged with no matches:
 * Tab doing nothing is the right response to a folder the user cannot read,
 * not an error they did not ask for.
 */
export async function completePath(fragment: string): Promise<Completion> {
  if (fragment.trim().length === 0) return { completed: fragment, matches: [] }

  const expanded = expandTilde(fragment)
  const endsWithSep = expanded.endsWith('/')
  const dir = endsWithSep ? expanded : dirname(expanded)
  const stem = endsWithSep ? '' : basename(expanded)

  // Typed explicitly: `Awaited<ReturnType<typeof readdir>>` resolves to the
  // Buffer overload of readdir, whose Dirent names are buffers, not strings.
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return { completed: fragment, matches: [] }
  }

  const allowed = convertibleExtensions()
  // Dotfiles stay hidden until the user shows they want them by typing a dot.
  const showHidden = stem.startsWith('.')

  const candidates = entries
    .filter((e) => showHidden || !e.name.startsWith('.'))
    .filter((e) => e.name.toLowerCase().startsWith(stem.toLowerCase()))
    .filter((e) => {
      if (e.isDirectory()) return true
      const dot = e.name.lastIndexOf('.')
      return dot > 0 && allowed.has(e.name.slice(dot).toLowerCase())
    })
    .map((e) => ({ name: e.name, dir: e.isDirectory() }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const only = candidates[0]
  if (only === undefined) return { completed: fragment, matches: [] }

  if (candidates.length === 1) {
    // A trailing slash on a directory means the next Tab descends into it
    // rather than re-offering the directory that was just completed.
    return { completed: join(dir, only.name) + (only.dir ? '/' : ''), matches: [] }
  }

  const prefix = longestCommonPrefix(candidates.map((c) => c.name))
  return {
    completed: prefix.length > stem.length ? join(dir, prefix) : fragment,
    matches: candidates.map((c) => c.name + (c.dir ? '/' : '')),
  }
}
