/**
 * Fonts the computer already has, for the text the PDF's own font does not
 * cover (Chinese, Japanese, Korean, Arabic, Hebrew, Thai, symbols). Forge ships
 * none of them: a CJK font alone is 16 MB, and the machine has one.
 *
 * Where to look is a short list of file names per OS and writing system
 * (Windows' and macOS's fonts are the same on every machine of that OS), and
 * on Linux fontconfig's own answer (`fc-match`), with a few well-known file
 * names tried where fontconfig is not installed. A font is only used if the
 * characters are in it. What is asked of the system comes in as `Deps`, so a
 * test (or another OS) answers it with its own folder of fonts.
 */
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import type { Script } from '../core/transcribe/scripts.js'
import { type Font, fontCount, readFont } from './ttf.js'

/** A font file, and which font of it when it is a collection (.ttc). */
export interface FontRef {
  path: string
  index: number
}

/** What a font is wanted for. */
export interface Need {
  script: Script | 'other'
  /** The East Asian language, for Han characters and kana. */
  lang?: 'ja' | 'ko' | 'zh' | 'zh-TW'
  /** A character it must hold, for fontconfig to search by. */
  codePoint?: number
}

export interface Deps {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  home: string
  exists(path: string): boolean
  /** The names in a folder, or none. */
  list(dir: string): string[]
  /** What a command printed, or undefined when it is missing or fails. */
  run(cmd: string, args: string[]): Promise<string | undefined>
  /** A file's bytes, or undefined when it cannot be read. */
  read(path: string): Uint8Array | undefined
}

export const realDeps: Deps = {
  platform: process.platform,
  env: process.env,
  home: homedir(),
  exists: (p) => existsSync(p),
  list: (dir) => {
    try {
      return readdirSync(dir)
    } catch {
      return []
    }
  },
  run: (cmd, args) =>
    new Promise((resolve) => {
      execFile(cmd, args, { timeout: 5000, windowsHide: true, maxBuffer: 4_000_000 }, (err, out) =>
        resolve(err ? undefined : out),
      )
    }),
  read: (p) => {
    try {
      // A font over 100 MB is not one a PDF should be reading whole.
      if (statSync(p).size > 100_000_000) return undefined
      return readFileSync(p)
    } catch {
      return undefined
    }
  },
}

/** Windows' fonts by writing system, best first: file name, and the font of a collection. */
const WINDOWS: Record<string, Array<[string, number]>> = {
  zh: [
    ['msyh.ttc', 0],
    ['simsun.ttc', 0],
    ['simhei.ttf', 0],
    ['Deng.ttf', 0],
    ['arialuni.ttf', 0],
  ],
  'zh-TW': [
    ['msjh.ttc', 0],
    ['mingliu.ttc', 0],
    ['msyh.ttc', 0],
    ['arialuni.ttf', 0],
  ],
  ja: [
    ['YuGothR.ttc', 0],
    ['YuGothM.ttc', 0],
    ['meiryo.ttc', 0],
    ['msgothic.ttc', 0],
    ['msmincho.ttc', 0],
    ['arialuni.ttf', 0],
  ],
  ko: [
    ['malgun.ttf', 0],
    ['gulim.ttc', 0],
    ['batang.ttc', 0],
    ['arialuni.ttf', 0],
  ],
  arabic: [
    ['segoeui.ttf', 0],
    ['arial.ttf', 0],
    ['tahoma.ttf', 0],
    ['times.ttf', 0],
    ['arialuni.ttf', 0],
  ],
  hebrew: [
    ['segoeui.ttf', 0],
    ['arial.ttf', 0],
    ['tahoma.ttf', 0],
    ['times.ttf', 0],
    ['arialuni.ttf', 0],
  ],
  thai: [
    ['LeelawUI.ttf', 0],
    ['leelawad.ttf', 0],
    ['tahoma.ttf', 0],
    ['arialuni.ttf', 0],
  ],
  other: [
    ['seguisym.ttf', 0],
    ['segoeui.ttf', 0],
    ['arial.ttf', 0],
    ['arialuni.ttf', 0],
    ['malgun.ttf', 0],
    ['msyh.ttc', 0],
  ],
}

/** The Mac's, for a Mac before macOS 26 or an Intel one (a newer Apple-silicon Mac has Apple's helper). */
const MAC: Record<string, Array<[string, number]>> = {
  zh: [
    ['PingFang.ttc', 0],
    ['STHeiti Light.ttc', 1],
    ['Hiragino Sans GB.ttc', 0],
    ['Arial Unicode.ttf', 0],
  ],
  'zh-TW': [
    ['PingFang.ttc', 2],
    ['STHeiti Light.ttc', 0],
    ['Hiragino Sans GB.ttc', 0],
    ['Arial Unicode.ttf', 0],
  ],
  ja: [
    ['ヒラギノ角ゴシック W3.ttc', 0],
    ['Hiragino Sans GB.ttc', 0],
    ['AquaKana.ttc', 0],
    ['Arial Unicode.ttf', 0],
  ],
  ko: [
    ['AppleSDGothicNeo.ttc', 0],
    ['Arial Unicode.ttf', 0],
  ],
  arabic: [
    ['GeezaPro.ttc', 0],
    ['SFArabic.ttf', 0],
    ['Arial Unicode.ttf', 0],
  ],
  hebrew: [
    ['ArialHB.ttc', 0],
    ['Arial Unicode.ttf', 0],
  ],
  thai: [
    ['Thonburi.ttc', 0],
    ['Arial Unicode.ttf', 0],
  ],
  other: [
    ['Arial Unicode.ttf', 0],
    ['Apple Symbols.ttf', 0],
    ['Arial.ttf', 0],
  ],
}

/** Fonts a Linux install is likely to have when fontconfig cannot say, by writing system. */
const LINUX_NAMES: Record<string, Array<[string, number]>> = {
  zh: [
    ['NotoSansCJK-Regular.ttc', 2],
    ['NotoSansCJKsc-Regular.otf', 0],
    ['wqy-zenhei.ttc', 0],
    ['wqy-microhei.ttc', 0],
    ['DroidSansFallbackFull.ttf', 0],
    ['DroidSansFallback.ttf', 0],
  ],
  'zh-TW': [
    ['NotoSansCJK-Regular.ttc', 3],
    ['NotoSansCJKtc-Regular.otf', 0],
    ['wqy-zenhei.ttc', 0],
    ['DroidSansFallbackFull.ttf', 0],
  ],
  ja: [
    ['NotoSansCJK-Regular.ttc', 0],
    ['NotoSansCJKjp-Regular.otf', 0],
    ['DroidSansFallbackFull.ttf', 0],
    ['TakaoGothic.ttf', 0],
  ],
  ko: [
    ['NotoSansCJK-Regular.ttc', 1],
    ['NotoSansCJKkr-Regular.otf', 0],
    ['NanumGothic.ttf', 0],
    ['DroidSansFallbackFull.ttf', 0],
  ],
  arabic: [
    ['NotoSansArabic-Regular.ttf', 0],
    ['NotoNaskhArabic-Regular.ttf', 0],
    ['DejaVuSans.ttf', 0],
    ['FreeSans.ttf', 0],
  ],
  hebrew: [
    ['NotoSansHebrew-Regular.ttf', 0],
    ['DejaVuSans.ttf', 0],
    ['FreeSans.ttf', 0],
  ],
  thai: [
    ['NotoSansThai-Regular.ttf', 0],
    ['Garuda.ttf', 0],
    ['Loma.ttf', 0],
    ['DejaVuSans.ttf', 0],
  ],
  other: [
    ['DejaVuSans.ttf', 0],
    ['NotoSansSymbols-Regular.ttf', 0],
    ['NotoSansSymbols2-Regular.ttf', 0],
    ['FreeSans.ttf', 0],
    ['LiberationSans-Regular.ttf', 0],
  ],
}

/** fontconfig's name for a language. */
const FC_LANG: Record<string, string> = {
  zh: 'zh-cn',
  'zh-TW': 'zh-tw',
  ja: 'ja',
  ko: 'ko',
  arabic: 'ar',
  hebrew: 'he',
  thai: 'th',
}

/** Which row of the tables above a need is. */
function key(need: Need): string {
  if (need.script === 'han' || need.script === 'kana' || need.script === 'hangul') {
    if (need.script === 'kana') return 'ja'
    if (need.script === 'hangul') return 'ko'
    return need.lang ?? 'zh'
  }
  if (need.script === 'arabic' || need.script === 'hebrew' || need.script === 'thai')
    return need.script
  return 'other'
}

/** The path rules of the OS being asked about, whichever one this is. */
const pathOf = (d: Deps) => (d.platform === 'win32' ? win32 : posix)

function windowsDirs(d: Deps): string[] {
  const join = win32.join
  const root = d.env.WINDIR ?? d.env.SystemRoot ?? 'C:\\Windows'
  return [
    join(root, 'Fonts'),
    ...(d.env.LOCALAPPDATA ? [join(d.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts')] : []),
  ]
}

function macDirs(d: Deps): string[] {
  const join = posix.join
  return [
    '/System/Library/Fonts',
    '/System/Library/Fonts/Supplemental',
    '/Library/Fonts',
    join(d.home, 'Library', 'Fonts'),
  ]
}

function linuxDirs(d: Deps): string[] {
  const join = posix.join
  const data = d.env.XDG_DATA_HOME ?? join(d.home, '.local', 'share')
  return [
    '/usr/share/fonts',
    '/usr/local/share/fonts',
    '/usr/share/fonts/opentype/noto',
    '/usr/share/fonts/truetype',
    join(data, 'fonts'),
    join(d.home, '.fonts'),
  ]
}

/** Finds `name` in a folder and the folders below it, three deep. */
function findIn(dir: string, name: string, d: Deps, depth = 3): string | undefined {
  const { join } = pathOf(d)
  const names = d.list(dir)
  const lower = name.toLowerCase()
  const hit = names.find((n) => n.toLowerCase() === lower)
  if (hit) return join(dir, hit)
  if (depth === 0) return undefined
  for (const n of names) {
    if (n.includes('.')) continue
    const found = findIn(join(dir, n), name, d, depth - 1)
    if (found) return found
  }
  return undefined
}

/** What fontconfig gives for a pattern: its files, closest first. */
async function fontconfig(pattern: string, d: Deps): Promise<FontRef[]> {
  const out = await d.run('fc-match', ['-s', '-f', '%{file}\t%{index}\n', pattern])
  if (out === undefined) return []
  return out
    .split('\n')
    .map((line) => line.split('\t'))
    .filter(([file]) => file !== undefined && file !== '')
    .slice(0, 8)
    .map(([file, index]) => ({
      path: file as string,
      // fontconfig packs a variable font's named instance above the low 16 bits.
      index: (Number(index) || 0) & 0xffff,
    }))
}

/** The fonts that may hold what is needed, best first. They are not yet known to have it. */
export async function candidates(need: Need, d: Deps = realDeps): Promise<FontRef[]> {
  const k = key(need)
  const { join } = pathOf(d)
  const out: FontRef[] = []
  const add = (ref: FontRef | undefined) => {
    if (ref && !out.some((o) => o.path === ref.path && o.index === ref.index)) out.push(ref)
  }
  if (d.platform === 'win32' || d.platform === 'darwin') {
    const table = d.platform === 'win32' ? WINDOWS : MAC
    const dirs = d.platform === 'win32' ? windowsDirs(d) : macDirs(d)
    for (const [file, index] of table[k] ?? table.other ?? []) {
      for (const dir of dirs) {
        const p = join(dir, file)
        if (d.exists(p)) {
          add({ path: p, index })
          break
        }
      }
    }
    return out
  }
  // Linux and the rest: fontconfig's answer first, then well-known files.
  const lang = FC_LANG[k]
  if (lang) for (const r of await fontconfig(`:lang=${lang}`, d)) add(r)
  else if (need.codePoint !== undefined)
    for (const r of await fontconfig(`:charset=${need.codePoint.toString(16)}`, d)) add(r)
  for (const [file, index] of LINUX_NAMES[k] ?? LINUX_NAMES.other ?? []) {
    for (const dir of linuxDirs(d)) {
      const found = findIn(dir, file, d)
      if (found) {
        add({ path: found, index })
        break
      }
    }
  }
  return out
}

/** A loaded font and where it came from. */
export interface LoadedFont {
  font: Font
  ref: FontRef
  /** The font's own file name, for a name in the PDF. */
  name: string
}

/** What each source of fonts has read, so a document's fonts are read once however many lines use them. */
const loaded = new WeakMap<Deps, Map<string, Font | null>>()

/** Reads a font, or undefined when the file is gone or is not a font Forge reads. */
export function loadFont(ref: FontRef, d: Deps = realDeps): LoadedFont | undefined {
  const cache = loaded.get(d) ?? new Map<string, Font | null>()
  loaded.set(d, cache)
  const id = `${ref.path}#${ref.index}`
  const name = pathOf(d)
    .basename(ref.path)
    .replace(/\.[^.]+$/, '')
  const cached = cache.get(id)
  if (cached !== undefined) return cached === null ? undefined : { font: cached, ref, name }
  try {
    const bytes = d.read(ref.path)
    if (!bytes) throw new Error('unreadable')
    const font = readFont(bytes, Math.min(ref.index, Math.max(0, fontCount(bytes) - 1)))
    cache.set(id, font)
    return { font, ref, name }
  } catch {
    cache.set(id, null)
    return undefined
  }
}
