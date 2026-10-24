/**
 * The catalogue of optional extensions, compiled into Forge (spec §4.2).
 * Forge never downloads a catalogue and never runs anything not listed here.
 */
export type ExtensionId = 'boost' | 'remove-background' | 'heic' | 'video' | 'yt-dlp' | 'whisper'

/** Where an asset runs: `${platform}-${arch}`, or `${platform}-universal` for any arch. */
export type PlatformKey = `${'darwin' | 'win32' | 'linux'}-${'arm64' | 'x64' | 'universal'}`

export interface CatalogAsset {
  /** Per asset: a Windows build can ship, or be fixed, without moving the Mac one. */
  version: string
  url: string
  bytes: number
  sha256: string
  /**
   * The download is the program itself, not a Forge archive, and installs
   * under this name: yt-dlp's own release, pinned by its sha256 like any
   * other asset.
   */
  binary?: string
}

export interface CatalogEntry {
  id: ExtensionId
  title: string
  summary: string
  /** Major macOS version, e.g. 14; darwin assets only. */
  minMacos?: number
  /** An entry with no asset for an OS is not offered there at all. */
  assets: Partial<Record<PlatformKey, CatalogAsset>>
  /** One line, shown by `forge extensions`. */
  licence: string
}

const RELEASES = 'https://github.com/AtharvaN16/forge-terminal/releases/download'

export const CATALOG: readonly CatalogEntry[] = [
  {
    id: 'boost',
    title: 'Boost resolution',
    summary: 'Sharpen, or boost resolution 2x or 4x, with a local AI model',
    minMacos: 14,
    // Apple Silicon only for now. An x64 build exists (CI still makes it) but
    // has never been run, and its CPU fallback would look frozen on an Intel
    // Mac, so Intel is told there is no build rather than offered that.
    assets: {
      'darwin-arm64': {
        version: '1.0.0',
        url: `${RELEASES}/ext-boost-v1.0.0/forge-ext-boost-1.0.0-arm64.tar.gz`,
        bytes: 14866325,
        sha256: '7af24c92f95b1cd34618adde4a90926c91a8db4347d640be4921f1dc706a9a2e',
      },
      // Windows runs on DirectML, so any DirectX 12 GPU — integrated included —
      // keeps it from the CPU fallback that rules out Intel Macs above.
      'win32-x64': {
        version: '1.1.0',
        url: `${RELEASES}/ext-boost-v1.1.0/forge-ext-boost-1.1.0-win32-x64.tar.gz`,
        bytes: 22993151,
        sha256: 'abac81a9efe616f33b3bce98db2c0ff0b5597b43a7e3d5ea98968761a2b7a0ce',
      },
      'win32-arm64': {
        version: '1.1.0',
        url: `${RELEASES}/ext-boost-v1.1.0/forge-ext-boost-1.1.0-win32-arm64.tar.gz`,
        bytes: 22936985,
        sha256: '7d39d93cae52f298423db0b185b0ae3a3bac65464abeb23561d9bcb2ebb3f026',
      },
    },
    licence: 'Real-ESRGAN general-x4v3 (BSD-3-Clause), ONNX Runtime (MIT)',
  },
  {
    id: 'remove-background',
    title: 'Remove background',
    summary: 'Cut the subject out of a photo, on this Mac',
    minMacos: 14,
    assets: {
      'darwin-universal': {
        version: '1.0.0',
        url: `${RELEASES}/ext-remove-background-v1.0.0/forge-ext-remove-background-1.0.0-universal.tar.gz`,
        bytes: 32489,
        sha256: '9f6e055c0ce25f7504e10c7871e506a813bc75d6536396a675a8c075c4eb4686',
      },
    },
    licence: 'Uses Apple Vision on-device; helper is MIT',
  },
  {
    // macOS decodes HEIC itself (sips); only Windows needs this.
    id: 'heic',
    title: 'HEIC photos',
    summary: 'Open iPhone photos (HEIC) on Windows',
    assets: {
      'win32-universal': {
        version: '1.0.0',
        url: `${RELEASES}/ext-heic-v1.0.0/forge-ext-heic-1.0.0-win32-universal.tar.gz`,
        bytes: 532364,
        sha256: '6c5f86c1a896d84264fb19371117e6ca6ec9b8726afec03f8c30aa5125a3ad97',
      },
    },
    licence: 'libheif and libde265 (LGPL-3.0), via libheif-js',
  },
  {
    // ffmpeg for a Mac without Homebrew's (video spec §3.7). Built from source
    // by extensions/video/build.sh; its source is published beside it, as the
    // GPL asks. No asset until it is published: until then nothing offers it,
    // and Forge says how to get ffmpeg instead.
    id: 'video',
    title: 'Video and audio',
    summary: 'Convert, compress and trim video and audio (ffmpeg)',
    minMacos: 13,
    assets: {},
    licence:
      'FFmpeg (GPL-2.0-or-later) with x264 (GPL-2.0), LAME (LGPL-2.0), Opus and libvpx (BSD), zimg (WTFPL)',
  },
  {
    // Transcribe's YouTube links (spec 2026-10-17-transcribe-design §3): the
    // upstream single-file build, pinned like every asset. It runs on the
    // Node Forge runs on; between Forge releases it updates itself
    // (`yt-dlp --update`, which checks its own signatures) when YouTube
    // breaks it.
    id: 'yt-dlp',
    title: 'YouTube links',
    summary: 'Transcribe YouTube videos: yt-dlp fetches their sound',
    minMacos: 26,
    assets: {
      'darwin-universal': {
        version: '2026.08.19',
        url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp_macos',
        bytes: 37146048,
        sha256: '0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202',
        binary: 'yt-dlp',
      },
    },
    licence: 'yt-dlp (Unlicense); its bundled Python and libraries under their own licences',
  },
  {
    // whisper.cpp's whisper-cli: transcribe's speech to text wherever Apple's
    // recogniser is not there (whisper helper). Built by
    // extensions/whisper/build.mjs from whisper.cpp 1.9.5: Windows is
    // upstream's own CPU build repacked, Linux is built from the same tag,
    // static. No Mac build: Homebrew's whisper-cpp covers the Intel and
    // older Macs that need it.
    id: 'whisper',
    title: 'Speech to text (whisper.cpp)',
    summary: 'Transcribe video and sound on this computer, with whisper.cpp',
    assets: {
      'win32-x64': {
        version: '1.0.0',
        url: `${RELEASES}/ext-whisper-v1.0.0/forge-ext-whisper-1.0.0-win32-x64.tar.gz`,
        bytes: 4036317,
        sha256: '6ef35ad2167c54a562c17717af38e0ac46941a2519d2d47ede730b583d29ad9a',
      },
      'win32-arm64': {
        version: '1.0.0',
        url: `${RELEASES}/ext-whisper-v1.0.0/forge-ext-whisper-1.0.0-win32-arm64.tar.gz`,
        bytes: 1482982,
        sha256: 'a59506f00cf2fae340455648aa7429ccb0422951c3d85fb8b6bb0e618f02677d',
      },
      // Static (musl), so one build runs on any Linux of that chip.
      'linux-arm64': {
        version: '1.0.0',
        url: `${RELEASES}/ext-whisper-v1.0.0/forge-ext-whisper-1.0.0-linux-arm64.tar.gz`,
        bytes: 1186510,
        sha256: 'cb06763e5301617ad443901a9110413eaabfd1ecf06cc7202d74553d000d3e6d',
      },
      // Needs AVX2 (2013 on); an older PC is told to use its own whisper-cli.
      'linux-x64': {
        version: '1.0.0',
        url: `${RELEASES}/ext-whisper-v1.0.0/forge-ext-whisper-1.0.0-linux-x64.tar.gz`,
        bytes: 1299655,
        sha256: '22554cb9ecf220f2345543267f59339701de8e2292773646b65922232ce98ed7',
      },
    },
    licence: 'whisper.cpp and ggml (MIT)',
  },
]

/** The machine, as sentences name it: "this Mac", "this PC", "this computer" (Linux). */
export function machineName(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return 'PC'
  if (platform === 'darwin') return 'Mac'
  return 'computer'
}

/** The OS, as sentences name it. */
export function osName(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return 'Windows'
  if (platform === 'darwin') return 'macOS'
  if (platform === 'linux') return 'Linux'
  return 'this system'
}

/** The OSes the catalogue has builds for. */
export const EXTENSION_PLATFORMS: readonly NodeJS.Platform[] = ['darwin', 'win32', 'linux']

export function catalogEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((e) => e.id === id)
}

/** `${platform}-${arch}`, else `${platform}-universal`. */
export function assetFor(
  entry: CatalogEntry,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): CatalogAsset | undefined {
  const assets = entry.assets as Partial<Record<string, CatalogAsset>>
  return assets[`${platform}-${arch}`] ?? assets[`${platform}-universal`]
}

/** Whether any asset exists for this OS. */
export function offeredOn(
  entry: CatalogEntry,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return Object.keys(entry.assets).some((key) => key.startsWith(`${platform}-`))
}

export function offeredHere(
  id: ExtensionId,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const entry = catalogEntry(id)
  return entry !== undefined && offeredOn(entry, platform)
}
