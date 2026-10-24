import { type ExecFileOptions, execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { writeAtomic } from '../core/atomic.js'
import { clipboardToolMissing } from '../core/errors.js'
import type { FormatId } from '../core/types.js'

/**
 * The clipboard as a picture: read what is copied, put a result back, and
 * tell whether anything else was copied in between.
 *
 * `src/shell/clipboard.ts` is text only, through `pbcopy`/`pbpaste` and their
 * counterparts, which cannot carry image data. Each system is reached through
 * what it already has, so there is no compiled helper and no new dependency:
 *
 * - macOS: AppKit's `NSPasteboard`, through JavaScript for Automation
 *   (`osascript -l JavaScript`). One call is about 60 ms.
 * - Windows: `System.Windows.Forms.Clipboard`, through Windows PowerShell.
 * - Linux: `wl-paste`/`wl-copy` (wl-clipboard) on Wayland, `xclip` on X11.
 *
 * Paths reach the scripts as arguments or environment variables, never
 * spliced into the source, so a name with a quote in it cannot change what
 * runs.
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

/** An image type a clipboard can hold, by the name that clipboard gives it. */
interface ImageType {
  type: string
  ext: string
  format: FormatId
}

/** How one system's clipboard names what it holds. */
interface Names {
  /** Image types in the order they are taken. */
  images: ImageType[]
  /** What says a file was copied, rather than a picture. */
  file: string
  /**
   * The picture the system adds beside a copied file (Finder's icon), and its
   * own stand-in for any picture: never taken when a file is copied too.
   */
  standIn: string | null
  /** What says text is held: what a terminal's paste would give instead. */
  text: string[]
}

const NAMES: Record<'darwin' | 'win32' | 'linux', Names> = {
  /**
   * PNG first: macOS adds a TIFF copy beside nearly every PNG it is given,
   * and the PNG is the one the app that copied it wrote.
   */
  darwin: {
    images: [
      { type: 'public.png', ext: 'png', format: 'png' },
      { type: 'public.jpeg', ext: 'jpg', format: 'jpeg' },
      { type: 'org.webmproject.webp', ext: 'webp', format: 'webp' },
      { type: 'public.heic', ext: 'heic', format: 'heic' },
      { type: 'public.avif', ext: 'avif', format: 'avif' },
      { type: 'com.compuserve.gif', ext: 'gif', format: 'gif' },
      { type: 'public.tiff', ext: 'tiff', format: 'tiff' },
    ],
    file: 'public.file-url',
    standIn: 'public.tiff',
    text: ['public.utf8-plain-text'],
  },
  /**
   * Browsers and Office put the PNG they have beside a device-independent
   * bitmap, and the bitmap has lost the transparency. `Bitmap` is any
   * bitmap at all, read with `Clipboard.GetImage()` and saved as PNG.
   */
  win32: {
    images: [
      { type: 'PNG', ext: 'png', format: 'png' },
      { type: 'image/png', ext: 'png', format: 'png' },
      { type: 'JFIF', ext: 'jpg', format: 'jpeg' },
      { type: 'image/jpeg', ext: 'jpg', format: 'jpeg' },
      { type: 'image/webp', ext: 'webp', format: 'webp' },
      { type: 'image/heic', ext: 'heic', format: 'heic' },
      { type: 'image/avif', ext: 'avif', format: 'avif' },
      { type: 'GIF', ext: 'gif', format: 'gif' },
      { type: 'image/gif', ext: 'gif', format: 'gif' },
      { type: 'Bitmap', ext: 'png', format: 'png' },
    ],
    file: 'FileDrop',
    standIn: 'Bitmap',
    text: ['UnicodeText', 'Text'],
  },
  /** MIME types on both Wayland and X11; a file manager copies `text/uri-list` and no picture. */
  linux: {
    images: [
      { type: 'image/png', ext: 'png', format: 'png' },
      { type: 'image/jpeg', ext: 'jpg', format: 'jpeg' },
      { type: 'image/webp', ext: 'webp', format: 'webp' },
      { type: 'image/heic', ext: 'heic', format: 'heic' },
      { type: 'image/avif', ext: 'avif', format: 'avif' },
      { type: 'image/gif', ext: 'gif', format: 'gif' },
      { type: 'image/tiff', ext: 'tiff', format: 'tiff' },
    ],
    file: 'text/uri-list',
    standIn: null,
    text: ['text/plain;charset=utf-8', 'UTF8_STRING', 'text/plain', 'STRING', 'TEXT'],
  },
}

function namesFor(platform: NodeJS.Platform): Names {
  return platform === 'win32' ? NAMES.win32 : platform === 'linux' ? NAMES.linux : NAMES.darwin
}

function pickImage(types: readonly string[], names: Names): ImageType | undefined {
  const file = types.includes(names.file)
  return names.images.find((t) => types.includes(t.type) && !(file && t.type === names.standIn))
}

/**
 * The image type to read, or null. A copied file is not an image even though
 * Finder puts its icon on the clipboard as a TIFF: the terminal's paste
 * already gives its path, which lands like a dropped file. Any other picture
 * beside a file is real image data — it is how Forge puts a result back — so
 * with a file only the system's stand-in is passed over.
 */
export function imageTypeIn(
  types: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string | null {
  return pickImage(types, namesFor(platform))?.type ?? null
}

function holdsText(types: readonly string[], names: Names): boolean {
  return names.text.some((t) => types.includes(t))
}

/**
 * Whether this process can see the clipboard of the person at the keyboard.
 * Not over SSH: the clipboard there belongs to the machine logged into, not
 * the one they copied on. Linux needs a desktop session to have one at all.
 */
export function clipboardSupported(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.SSH_CONNECTION || env.SSH_TTY) return false
  if (platform === 'linux') return linuxBackends(env).length > 0
  return platform === 'darwin' || platform === 'win32'
}

const UTI: Partial<Record<FormatId, string>> = Object.fromEntries(
  NAMES.darwin.images.map((t) => [t.format, t.type]),
)

export function utiFor(format: FormatId): string {
  return UTI[format] ?? 'public.data'
}

export interface Peek {
  /**
   * Goes up, or at least changes, whenever anything is copied. -1 when
   * unknown. NSPasteboard's changeCount on a Mac; elsewhere a fingerprint of
   * what is held (`fingerprint`).
   */
  changeCount: number
  /** The image type held, or null for text, a copied file, or nothing. */
  image: string | null
  /** Whether text is held: what a terminal's paste would give instead. */
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
   * Puts a file on the clipboard: its bytes, for apps that paste a picture,
   * and, where the clipboard can carry both, a reference to the file, for
   * apps that attach a file. Resolves to the change count after writing.
   */
  write(path: string, format: FormatId): Promise<number>
}

const NOTHING: Peek = { changeCount: -1, image: null, text: false }

/**
 * A change count where the system keeps none to hand: what is held, as a
 * number. The same image copied again counts as no change, which is the
 * only case it gets wrong, and it is harmless — the clipboard holds what it
 * did. 48 bits: an exact integer in JavaScript, and never -1.
 */
export function fingerprint(types: readonly string[], digest: string): number {
  return createHash('sha256')
    .update(types.join('\n'))
    .update('\0')
    .update(digest)
    .digest()
    .readUIntBE(0, 6)
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * TIFF is how macOS hands over a picture copied from Preview or Safari, not
 * a format anyone means to paste. PNG keeps every pixel, the transparency
 * and the colour profile.
 */
async function tiffToPng(held: string, dir: string): Promise<string> {
  const { default: sharp } = await import('sharp')
  const png = join(dir, 'Copied image.png')
  await sharp(held).keepIccProfile().png().toFile(`${png}.part`)
  await rename(`${png}.part`, png)
  await rm(held, { force: true })
  return png
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
  const names = NAMES.darwin
  const peek = async (): Promise<Peek> => {
    try {
      const { types, count } = JSON.parse(await run(PEEK, [])) as { types: string[]; count: number }
      return {
        changeCount: count,
        image: pickImage(types, names)?.type ?? null,
        text: holdsText(types, names),
      }
    } catch {
      return NOTHING
    }
  }
  return {
    peek,
    async read(dir) {
      const { image } = await peek()
      const type = names.images.find((t) => t.type === image)
      if (!type) return null
      await mkdir(dir, { recursive: true })
      const held = join(dir, `Copied image.${type.ext}`)
      const got = JSON.parse(await run(READ, [type.type, held])) as { ok: boolean; count?: number }
      if (!got.ok || got.count === undefined) return null
      if (type.format !== 'tiff') return { path: held, changeCount: got.count }
      return { path: await tiffToPng(held, dir), changeCount: got.count }
    },
    async write(path, format) {
      const { count } = JSON.parse(await run(WRITE, [path, utiFor(format)])) as { count: number }
      return count
    },
  }
}

/* ------------------------------------------------------------------ Windows */

/** A command's whole output, as bytes: a picture's, or a script's UTF-8. */
function outputOf(cmd: string, args: string[], opts: ExecFileOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...opts, encoding: 'buffer' }, (e, stdout) =>
      e ? reject(e) : resolve(stdout),
    )
  })
}

/** Runs a Windows PowerShell script with extra environment variables; resolves to what it printed. */
export type PowerShell = (script: string, env: Record<string, string>) => Promise<string>

/**
 * `-EncodedCommand`, not `-Command`: these scripts run to several lines, and
 * a script passed as base64 UTF-16LE has no quoting to get wrong on its way
 * through the command line. `-STA` because the clipboard is an OLE object,
 * which only a single-threaded apartment may touch (it is Windows
 * PowerShell's default, said anyway). 15 s: a cold PowerShell start loading
 * Windows Forms can take several seconds on a slow disk.
 */
export const powershell: PowerShell = async (script, env) => {
  const out = await outputOf(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-STA',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    { env: { ...process.env, ...env }, timeout: 15000, windowsHide: true },
  )
  return out.toString('utf8').trim()
}

/**
 * Looks at the clipboard, and with `FORGE_CLIP_PATH` set also saves the
 * picture there. The picture is the first of `FORGE_CLIP_ORDER` held, passing
 * over `FORGE_CLIP_STAND_IN` beside `FORGE_CLIP_FILE` — `pickImage`'s rule,
 * applied here so a look is one PowerShell start, not two. Prints the formats
 * held, the one taken, and a SHA-256 of its bytes for the change count.
 */
export const WIN_READ = `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$data = [Windows.Forms.Clipboard]::GetDataObject()
$types = @()
if ($null -ne $data) { $types = @($data.GetFormats()) }
$file = $types -contains $env:FORGE_CLIP_FILE
$pick = $null
foreach ($t in $env:FORGE_CLIP_ORDER.Split('|')) {
  if (($types -contains $t) -and -not ($file -and $t -eq $env:FORGE_CLIP_STAND_IN)) { $pick = $t; break }
}
$digest = ''
if ($null -ne $pick) {
  $bytes = $null
  if ($pick -eq 'Bitmap') {
    $image = [Windows.Forms.Clipboard]::GetImage()
    if ($null -ne $image) {
      $stream = New-Object IO.MemoryStream
      $image.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
      $bytes = $stream.ToArray()
    }
  } else {
    $value = $data.GetData($pick)
    if ($value -is [IO.MemoryStream]) { $bytes = $value.ToArray() }
    elseif ($value -is [byte[]]) { $bytes = $value }
  }
  if ($null -eq $bytes -or $bytes.Length -eq 0) { $pick = $null }
  else {
    $digest = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes)).Replace('-', '')
    if ($env:FORGE_CLIP_PATH) { [IO.File]::WriteAllBytes($env:FORGE_CLIP_PATH, $bytes) }
  }
}
ConvertTo-Json -Compress @{ types = $types; image = $pick; digest = $digest }`

/**
 * Puts `FORGE_CLIP_PATH` on the clipboard three ways: its bytes under each of
 * `FORGE_CLIP_TYPES` (what a browser or Office pastes, transparency and all),
 * a bitmap for every other app, and the file itself for apps that attach
 * one. GDI+ cannot read WebP, AVIF or HEIC, so those go on without the
 * bitmap. `SetDataObject(…, $true)` copies everything into the clipboard,
 * so it stays there after PowerShell exits.
 */
export const WIN_WRITE = `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$path = $env:FORGE_CLIP_PATH
$bytes = [IO.File]::ReadAllBytes($path)
$data = New-Object Windows.Forms.DataObject
foreach ($t in $env:FORGE_CLIP_TYPES.Split('|')) {
  $data.SetData($t, $false, (New-Object IO.MemoryStream(, $bytes)))
}
try { $data.SetImage([Drawing.Image]::FromStream((New-Object IO.MemoryStream(, $bytes)))) } catch {}
$files = New-Object Collections.Specialized.StringCollection
[void]$files.Add($path)
$data.SetFileDropList($files)
[Windows.Forms.Clipboard]::SetDataObject($data, $true)`

interface WinLook {
  types: string[]
  image: string | null
  digest: string
}

function asList(v: unknown): string[] {
  // ConvertTo-Json flattens a one-item array to its item in some versions.
  if (Array.isArray(v)) return v.map(String)
  return typeof v === 'string' ? [v] : []
}

export function windowsPasteboard(ps: PowerShell = powershell): Pasteboard {
  const names = NAMES.win32
  const choosing = {
    FORGE_CLIP_ORDER: names.images.map((t) => t.type).join('|'),
    FORGE_CLIP_FILE: names.file,
    FORGE_CLIP_STAND_IN: names.standIn ?? '',
  }
  const look = async (path?: string): Promise<WinLook> => {
    const out = JSON.parse(
      await ps(WIN_READ, { ...choosing, ...(path === undefined ? {} : { FORGE_CLIP_PATH: path }) }),
    ) as { types?: unknown; image?: unknown; digest?: unknown }
    const types = asList(out.types)
    const image = typeof out.image === 'string' && out.image !== '' ? out.image : null
    return { types, image, digest: typeof out.digest === 'string' ? out.digest : '' }
  }
  const peek = async (): Promise<Peek> => {
    try {
      const got = await look()
      return {
        changeCount: fingerprint(got.types, got.digest),
        image: got.image,
        text: holdsText(got.types, names),
      }
    } catch {
      return NOTHING
    }
  }
  return {
    peek,
    async read(dir) {
      await mkdir(dir, { recursive: true })
      const part = join(dir, '.Copied image.part')
      const got = await look(part)
      const type = names.images.find((t) => t.type === got.image)
      if (!type) {
        await rm(part, { force: true })
        return null
      }
      const held = join(dir, `Copied image.${type.ext}`)
      await rename(part, held)
      return { path: held, changeCount: fingerprint(got.types, got.digest) }
    },
    async write(path, format) {
      const types = names.images.filter((t) => t.format === format && t.type !== names.standIn)
      await ps(WIN_WRITE, {
        FORGE_CLIP_PATH: path,
        FORGE_CLIP_TYPES: (types.length > 0 ? types.map((t) => t.type) : [`image/${format}`]).join(
          '|',
        ),
      })
      return (await peek()).changeCount
    },
  }
}

/* -------------------------------------------------------------------- Linux */

/** Where Linux's clipboard commands come from: the real ones, unless a test gives its own. */
export interface LinuxTools {
  /**
   * Runs a command to the end and resolves to its output. Rejects with
   * `code: 'ENOENT'` when it is not installed, and otherwise when it fails —
   * as both tools do when nothing, or not that type, is copied.
   */
  run(cmd: string, args: string[]): Promise<Buffer>
  /**
   * Runs a command that copies, with a file as its input. `wl-copy` and
   * `xclip` both fork and leave a child behind that holds the copy until
   * something else is copied, so this resolves when the first one exits.
   */
  copy(cmd: string, args: string[], input: string): Promise<void>
}

/**
 * The child left behind gets no pipes from Forge: one held open would keep
 * Forge running until something else was copied. Detached, so it is in a
 * session of its own: closing the terminal does not take the copy with it,
 * which on a Mac it would not either.
 */
export const linuxTools: LinuxTools = {
  run(cmd, args) {
    return outputOf(cmd, args, {
      // The default is 1 MB and it throws rather than truncating; a
      // screenshot of a large display is tens of MB.
      maxBuffer: 512 * 1024 * 1024,
      timeout: 5000,
    })
  },
  async copy(cmd, args, input) {
    const file = await open(input, 'r')
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: [file.fd, 'ignore', 'ignore'], detached: true })
        child.on('error', reject)
        child.on('exit', (code) =>
          code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`)),
        )
      })
    } finally {
      await file.close()
    }
  },
}

/** Wayland or X11, and the commands that reach each one's clipboard. */
export interface LinuxBackend {
  name: 'wayland' | 'x11'
  /** The package the commands come in. */
  tool: 'wl-clipboard' | 'xclip'
  types: [string, string[]]
  read(type: string): [string, string[]]
  write(type: string): [string, string[]]
}

const WAYLAND: LinuxBackend = {
  name: 'wayland',
  tool: 'wl-clipboard',
  types: ['wl-paste', ['--list-types']],
  read: (type) => ['wl-paste', ['--type', type]],
  write: (type) => ['wl-copy', ['--type', type]],
}

const X11: LinuxBackend = {
  name: 'x11',
  tool: 'xclip',
  types: ['xclip', ['-selection', 'clipboard', '-t', 'TARGETS', '-o']],
  read: (type) => ['xclip', ['-selection', 'clipboard', '-t', type, '-o']],
  write: (type) => ['xclip', ['-selection', 'clipboard', '-t', type, '-i']],
}

/**
 * The desktop's own clipboard first: a Wayland session's, then X11's. A
 * Wayland desktop runs X11 apps through XWayland and keeps the two
 * clipboards in step, so xclip still works there when wl-clipboard is not
 * installed.
 */
export function linuxBackends(env: NodeJS.ProcessEnv = process.env): LinuxBackend[] {
  return [...(env.WAYLAND_DISPLAY ? [WAYLAND] : []), ...(env.DISPLAY ? [X11] : [])]
}

/** How long a copy has to show up after its command returns: 2 s in all. */
const SETTLE_TRIES = 40
const SETTLE_MS = 50

function notInstalled(e: unknown): boolean {
  return (e as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

export function linuxPasteboard(
  env: NodeJS.ProcessEnv = process.env,
  tools: LinuxTools = linuxTools,
): Pasteboard {
  const names = NAMES.linux
  const backends = linuxBackends(env)
  let chosen: LinuxBackend | undefined

  /** Runs `use` with the first backend whose commands are installed, then sticks to it. */
  const via = async <T>(use: (b: LinuxBackend) => Promise<T>): Promise<T> => {
    if (chosen) return use(chosen)
    for (const b of backends) {
      try {
        const got = await use(b)
        chosen = b
        return got
      } catch (e) {
        if (!notInstalled(e)) {
          chosen = b
          throw e
        }
      }
    }
    throw clipboardToolMissing(backends[0]?.tool ?? 'xclip')
  }

  /** The types held; none when nothing is copied, which both tools report as a failure. */
  const typesOn = async (b: LinuxBackend): Promise<string[]> => {
    try {
      const out = await tools.run(...b.types)
      return out
        .toString('utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l !== '')
    } catch (e) {
      if (notInstalled(e)) throw e
      return []
    }
  }

  const look = (withBytes: boolean) =>
    via(async (b) => {
      const types = await typesOn(b)
      const image = pickImage(types, names)
      const bytes = image && withBytes ? await tools.run(...b.read(image.type)) : undefined
      return { types, image, bytes }
    })

  const peek = async (): Promise<Peek> => {
    try {
      const { types, image, bytes } = await look(true)
      return {
        changeCount: fingerprint(types, bytes ? sha256(bytes) : ''),
        image: image?.type ?? null,
        text: holdsText(types, names),
      }
    } catch {
      return NOTHING
    }
  }

  return {
    peek,
    async read(dir) {
      const { types, image, bytes } = await look(true)
      if (!image || !bytes || bytes.length === 0) return null
      const held = join(dir, `Copied image.${image.ext}`)
      await writeAtomic(held, bytes)
      const changeCount = fingerprint(types, sha256(bytes))
      if (image.format !== 'tiff') return { path: held, changeCount }
      return { path: await tiffToPng(held, dir), changeCount }
    },
    async write(path, format) {
      const type = names.images.find((t) => t.format === format)?.type ?? `image/${format}`
      await via((b) => tools.copy(...b.write(type), path))
      // xclip forks before it takes the clipboard over, so for a moment
      // after it returns the old copy is still there. Wait until the new
      // one is, so the next look sees it.
      const want = sha256(await readFile(path))
      let count = -1
      for (let i = 0; i < SETTLE_TRIES; i++) {
        const got = await look(true).catch(() => null)
        const digest = got?.bytes ? sha256(got.bytes) : ''
        if (got) count = fingerprint(got.types, digest)
        if (digest === want) return count
        await new Promise((r) => setTimeout(r, SETTLE_MS))
      }
      return count
    },
  }
}

/** This computer's clipboard. Check `clipboardSupported` first. */
export function systemPasteboard(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Pasteboard {
  if (platform === 'win32') return windowsPasteboard()
  if (platform === 'linux') return linuxPasteboard(env)
  return macPasteboard()
}
