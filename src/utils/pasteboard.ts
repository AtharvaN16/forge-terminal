import { execFile } from 'node:child_process'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { FormatId } from '../core/types.js'

/**
 * The clipboard as a picture: read what is copied, put a result back, and
 * tell whether anything else was copied in between.
 *
 * `src/shell/clipboard.ts` is text only, through `pbcopy`/`pbpaste`, which
 * cannot carry image data. Here it is AppKit's `NSPasteboard`, reached through
 * JavaScript for Automation (`osascript -l JavaScript`), which every Mac has:
 * no compiled helper, no new dependency. One call is about 60 ms.
 *
 * Paths reach the scripts as arguments, never spliced into the source, so a
 * name with a quote in it cannot change what runs.
 */

/** Runs a JXA script with arguments and resolves to what it printed. */
export type Osascript = (script: string, args: string[]) => Promise<string>

const execFileAsync = promisify(execFile)

export const osascript: Osascript = async (script, args) => {
  const { stdout } = await execFileAsync('osascript', ['-l', 'JavaScript', '-e', script, ...args], {
    timeout: 5000,
  })
  return stdout.trim()
}

/**
 * Image types in the order they are taken. PNG first: macOS adds a TIFF copy
 * beside nearly every PNG it is given, and the PNG is the one the app that
 * copied it wrote.
 */
const IMAGE_TYPES: { uti: string; ext: string }[] = [
  { uti: 'public.png', ext: 'png' },
  { uti: 'public.jpeg', ext: 'jpg' },
  { uti: 'org.webmproject.webp', ext: 'webp' },
  { uti: 'public.heic', ext: 'heic' },
  { uti: 'public.avif', ext: 'avif' },
  { uti: 'com.compuserve.gif', ext: 'gif' },
  { uti: 'public.tiff', ext: 'tiff' },
]

/**
 * The image type to read, or null. A copied Finder file is not an image even
 * though Finder puts its icon on the clipboard as a TIFF: ⌘V already pastes
 * its path, which lands like a dropped file. Any other picture beside a file
 * is real image data — it is how Forge puts a result back — so with a file
 * only the TIFF is passed over.
 */
export function imageTypeIn(types: readonly string[]): string | null {
  const file = types.includes('public.file-url')
  return (
    IMAGE_TYPES.find((t) => types.includes(t.uti) && !(file && t.uti === 'public.tiff'))?.uti ??
    null
  )
}

/**
 * Whether this process can see the clipboard of the person at the keyboard.
 * macOS only for now. Over SSH, osascript would read the remote Mac's
 * clipboard, which is not the one they copied to.
 */
export function clipboardSupported(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return platform === 'darwin' && !env.SSH_CONNECTION && !env.SSH_TTY
}

const UTI: Partial<Record<FormatId, string>> = {
  png: 'public.png',
  jpeg: 'public.jpeg',
  webp: 'org.webmproject.webp',
  heic: 'public.heic',
  avif: 'public.avif',
  gif: 'com.compuserve.gif',
  tiff: 'public.tiff',
}

export function utiFor(format: FormatId): string {
  return UTI[format] ?? 'public.data'
}

export interface Peek {
  /** NSPasteboard's changeCount: it goes up whenever anything is copied. -1 when unknown. */
  changeCount: number
  /** The image type held, or null for text, a copied file, or nothing. */
  image: string | null
  /** Whether text is held: what a terminal's ⌘V would paste instead. */
  text: boolean
}

export interface ClipboardImage {
  path: string
  changeCount: number
}

export interface Pasteboard {
  peek(): Promise<Peek>
  /** Writes the copied image into `dir` as `Copied image.<ext>`; null when there is none. */
  read(dir: string): Promise<ClipboardImage | null>
  /**
   * Puts a file on the clipboard twice over: its bytes, for apps that paste
   * a picture, and a reference to the file, for apps that attach a file.
   * Resolves to the change count after writing.
   */
  write(path: string, format: FormatId): Promise<number>
}

const PEEK = `ObjC.import('AppKit')
const pb = $.NSPasteboard.generalPasteboard
JSON.stringify({ types: ObjC.deepUnwrap(pb.types) || [], count: Number(pb.changeCount) })`

const READ = `function run(argv) {
  ObjC.import('AppKit')
  const pb = $.NSPasteboard.generalPasteboard
  const data = pb.dataForType(argv[0])
  if (data.isNil()) return JSON.stringify({ ok: false })
  const ok = data.writeToFileAtomically(argv[1], true)
  return JSON.stringify({ ok: ok, count: Number(pb.changeCount) })
}`

const WRITE = `function run(argv) {
  ObjC.import('AppKit')
  const pb = $.NSPasteboard.generalPasteboard
  const item = $.NSPasteboardItem.alloc.init
  item.setDataForType($.NSData.dataWithContentsOfFile(argv[0]), argv[1])
  item.setStringForType($.NSURL.fileURLWithPath(argv[0]).absoluteString, 'public.file-url')
  pb.clearContents
  pb.writeObjects($.NSArray.arrayWithObject(item))
  return JSON.stringify({ count: Number(pb.changeCount) })
}`

export function macPasteboard(run: Osascript = osascript): Pasteboard {
  const peek = async (): Promise<Peek> => {
    try {
      const { types, count } = JSON.parse(await run(PEEK, [])) as { types: string[]; count: number }
      return {
        changeCount: count,
        image: imageTypeIn(types),
        text: types.includes('public.utf8-plain-text'),
      }
    } catch {
      return { changeCount: -1, image: null, text: false }
    }
  }
  return {
    peek,
    async read(dir) {
      const { image } = await peek()
      const type = IMAGE_TYPES.find((t) => t.uti === image)
      if (!type) return null
      await mkdir(dir, { recursive: true })
      const held = join(dir, `Copied image.${type.ext}`)
      const got = JSON.parse(await run(READ, [type.uti, held])) as { ok: boolean; count?: number }
      if (!got.ok || got.count === undefined) return null
      if (type.uti !== 'public.tiff') return { path: held, changeCount: got.count }
      // TIFF is how macOS hands over a picture copied from Preview or
      // Safari, not a format anyone means to paste. PNG keeps every pixel,
      // the transparency and the colour profile.
      const { default: sharp } = await import('sharp')
      const png = join(dir, 'Copied image.png')
      await sharp(held).keepIccProfile().png().toFile(`${png}.part`)
      await rename(`${png}.part`, png)
      await rm(held, { force: true })
      return { path: png, changeCount: got.count }
    },
    async write(path, format) {
      const { count } = JSON.parse(await run(WRITE, [path, utiFor(format)])) as { count: number }
      return count
    },
  }
}
