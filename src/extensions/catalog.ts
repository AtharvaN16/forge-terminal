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
const YT_DLP = 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19'

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
      // Linux runs on the CPU: onnxruntime-node's only Linux GPU provider is
      // CUDA, a separate download of hundreds of MB. The runner is 1.1.0's,
      // unchanged (the Windows archives above rebuild from it byte for byte),
      // so it is 1.1.0 too. Slow on a big image, as Windows without a GPU is:
      // the same limits, and the working screen's spinner and clock.
      'linux-x64': {
        version: '1.1.0',
        url: `${RELEASES}/ext-boost-v1.1.0/forge-ext-boost-1.1.0-linux-x64.tar.gz`,
        bytes: 17020233,
        sha256: 'd87c0dcf719f940f255b274a2696e8df548902fe54353bbca36f809897805402',
      },
      'linux-arm64': {
        version: '1.1.0',
        url: `${RELEASES}/ext-boost-v1.1.0/forge-ext-boost-1.1.0-linux-arm64.tar.gz`,
        bytes: 12003550,
        sha256: '522bda2f2e13edac3d49aa89dfadf5b02d79ae1e3b701f615c042d5e74f8f609',
      },
    },
    licence: 'Real-ESRGAN general-x4v3 (BSD-3-Clause), ONNX Runtime (MIT)',
  },
  {
    id: 'remove-background',
    title: 'Remove background',
    summary: 'Cut the subject out of a photo, on this computer',
    // Darwin assets only, like every minMacos.
    minMacos: 14,
    assets: {
      // Apple Vision, through a small Swift helper (extensions/remove-background).
      'darwin-universal': {
        version: '1.0.0',
        url: `${RELEASES}/ext-remove-background-v1.0.0/forge-ext-remove-background-1.0.0-universal.tar.gz`,
        bytes: 32489,
        sha256: '9f6e055c0ce25f7504e10c7871e506a813bc75d6536396a675a8c075c4eb4686',
      },
      // Elsewhere U²-Net-p, a 4.6 MB model, on ONNX Runtime's CPU provider
      // (extensions/remove-background-onnx): the same arguments and replies.
      'win32-x64': {
        version: '1.1.0',
        url: `${RELEASES}/ext-remove-background-v1.1.0/forge-ext-remove-background-1.1.0-win32-x64.tar.gz`,
        bytes: 13324892,
        sha256: 'c505032600bd44c8da9ae2bf5a93892142abaaaf29ff3b13a4cbbd141be1c1c1',
      },
      'win32-arm64': {
        version: '1.1.0',
        url: `${RELEASES}/ext-remove-background-v1.1.0/forge-ext-remove-background-1.1.0-win32-arm64.tar.gz`,
        bytes: 13398461,
        sha256: '8b65bac6b5d3a00b4f124fb8fa662c8ddf6bc517ef39175c5faf7f4b596d7807',
      },
      'linux-x64': {
        version: '1.1.0',
        url: `${RELEASES}/ext-remove-background-v1.1.0/forge-ext-remove-background-1.1.0-linux-x64.tar.gz`,
        bytes: 16721400,
        sha256: '3195f6ce0346cf4ebb01ef92b3de20ad1d811c20a290ede2112ba6a277893623',
      },
      'linux-arm64': {
        version: '1.1.0',
        url: `${RELEASES}/ext-remove-background-v1.1.0/forge-ext-remove-background-1.1.0-linux-arm64.tar.gz`,
        bytes: 11703766,
        sha256: '448896ae9dd1ec0943fcc4c8a8ac3f75258a496ec12405151f324627a8aca30f',
      },
    },
    licence:
      'Apple Vision on macOS (helper MIT); elsewhere U²-Net-p (Apache-2.0) and ONNX Runtime (MIT)',
  },
  {
    // macOS decodes HEIC itself (sips); Windows and Linux need this. The two
    // archives hold the same files (JavaScript and WebAssembly, any chip) and
    // differ only in the manifest's arch.
    id: 'heic',
    title: 'HEIC photos',
    summary: 'Open iPhone photos (HEIC)',
    assets: {
      'win32-universal': {
        version: '1.0.0',
        url: `${RELEASES}/ext-heic-v1.0.0/forge-ext-heic-1.0.0-win32-universal.tar.gz`,
        bytes: 532364,
        sha256: '6c5f86c1a896d84264fb19371117e6ca6ec9b8726afec03f8c30aa5125a3ad97',
      },
      'linux-universal': {
        version: '1.0.0',
        url: `${RELEASES}/ext-heic-v1.0.0/forge-ext-heic-1.0.0-linux-universal.tar.gz`,
        bytes: 532362,
        sha256: 'fccac1de0c707c18778e7909237747fdd47602f9c6861e600a24d23ac3f5b63c',
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
    // upstream single-file builds, pinned like every asset (bytes and sha256
    // from the release's SHA2-256SUMS, checked against the downloads). They
    // run on the Node Forge runs on; between Forge releases they update
    // themselves (`yt-dlp --update`, which checks its own signatures) when
    // YouTube breaks them. Windows runs a program only by its .exe name.
    id: 'yt-dlp',
    title: 'YouTube links',
    summary: 'Transcribe YouTube videos: yt-dlp fetches their sound',
    minMacos: 26,
    assets: {
      'darwin-universal': {
        version: '2026.08.19',
        url: `${YT_DLP}/yt-dlp_macos`,
        bytes: 37146048,
        sha256: '0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202',
        binary: 'yt-dlp',
      },
      'linux-x64': {
        version: '2026.08.19',
        url: `${YT_DLP}/yt-dlp_linux`,
        bytes: 40446224,
        sha256: '58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a',
        binary: 'yt-dlp',
      },
      'linux-arm64': {
        version: '2026.08.19',
        url: `${YT_DLP}/yt-dlp_linux_aarch64`,
        bytes: 40167448,
        sha256: 'b16e4dab368a816cd05d477d698a605a6ae87ccee1c8ffd38fa21d7254141fcc',
        binary: 'yt-dlp',
      },
      'win32-x64': {
        version: '2026.08.19',
        url: `${YT_DLP}/yt-dlp.exe`,
        bytes: 17840399,
        sha256: '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a',
        binary: 'yt-dlp.exe',
      },
      'win32-arm64': {
        version: '2026.08.19',
        url: `${YT_DLP}/yt-dlp_arm64.exe`,
        bytes: 21159286,
        sha256: '05b438997bafc3affdfda9d041353c9d73e04dc842207254b655b0887c4445b0',
        binary: 'yt-dlp.exe',
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
