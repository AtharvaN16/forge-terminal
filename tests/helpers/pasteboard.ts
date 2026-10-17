import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FormatId } from '../../src/core/types.js'
import type { Pasteboard } from '../../src/utils/pasteboard.js'

type Held = { kind: 'image'; bytes: Buffer; ext: string; format?: FormatId } | { kind: 'text' }

/**
 * An in-memory clipboard: holds one picture (or some text), counts changes
 * the way NSPasteboard does, and lets a test copy something else "meanwhile"
 * — `onRead` runs straight after the image is read.
 */
export function memoryPasteboard(opts: { onRead?: () => void } = {}) {
  let count = 1
  let held: Held | null = null
  let reads = 0
  const pb: Pasteboard = {
    async peek() {
      return {
        changeCount: count,
        image: held?.kind === 'image' ? 'public.png' : null,
        text: held?.kind === 'text',
      }
    },
    async read(dir) {
      if (held?.kind !== 'image') return null
      await mkdir(dir, { recursive: true })
      const path = join(dir, `Copied image.${held.ext}`)
      await writeFile(path, held.bytes)
      reads++
      const at = count
      opts.onRead?.()
      return { path, changeCount: at }
    },
    async write(path, format) {
      held = {
        kind: 'image',
        bytes: await readFile(path),
        ext: path.split('.').pop() ?? '',
        format,
      }
      count++
      return count
    },
  }
  return {
    pb,
    reads: () => reads,
    held: () => held,
    /** Copies a file, as if from another app. */
    async copyImage(path: string) {
      held = { kind: 'image', bytes: await readFile(path), ext: path.split('.').pop() ?? '' }
      count++
    },
    copyText() {
      held = { kind: 'text' }
      count++
    },
  }
}
