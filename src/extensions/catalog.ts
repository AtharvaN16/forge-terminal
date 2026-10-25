/**
 * The catalogue of optional extensions, compiled into Forge (spec §4.2).
 * Forge never downloads a catalogue and never runs anything not listed here.
 */
export type ExtensionId =
  | 'boost'
  | 'remove-background'
  | 'heic'
  | 'raw'
  | 'video'
  | 'yt-dlp'
  | 'whisper'
  | 'read-text'

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
    // Apple silicon and Windows keep the graphics provider they always had
    // (CoreML, DirectML). Linux x64 and Intel Macs run on WebGPU (Vulkan, Metal)
    // through the same model and runner, 1.2.0, and the runner stops with
    // boost-too-slow when no real graphics card answers and the processor would
    // take minutes (extensions/boost/providers.ts). Not Linux arm64: its ONNX
    // Runtime build has no WebGPU in it.
    assets: {
      'darwin-arm64': {
        version: '1.0.0',
        url: `${RELEASES}/ext-boost-v1.0.0/forge-ext-boost-1.0.0-arm64.tar.gz`,
        bytes: 14866325,
        sha256: '7af24c92f95b1cd34618adde4a90926c91a8db4347d640be4921f1dc706a9a2e',
      },
      'darwin-x64': {
        version: '1.2.0',
        url: `${RELEASES}/ext-boost-v1.2.0/forge-ext-boost-1.2.0-x64.tar.gz`,
        bytes: 16062122,
        sha256: '4770833905b4b6c348d1eb18bb735ace9a4f63ace51097c4a7c4b74ec1787998',
      },
      // Windows runs on DirectML, so any DirectX 12 GPU — integrated included.
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
      'linux-x64': {
        version: '1.2.0',
        url: `${RELEASES}/ext-boost-v1.2.0/forge-ext-boost-1.2.0-linux-x64.tar.gz`,
        bytes: 17020821,
        sha256: 'fca6232c38c05469e255ba2900ab32f993c1b8588f0a3569b24977ab657ff4cb',
      },
    },
    licence: 'Real-ESRGAN general-x4v3 (BSD-3-Clause), ONNX Runtime (MIT), Dawn (BSD-3-Clause)',
  },
  {
    id: 'remove-background',
    title: 'Remove background',
    summary: 'Cut the subject out of a photo, on this Mac',
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
      // Not on Windows or Linux yet: U²-Net-p (extensions/remove-background-onnx)
      // failed the quality bar on 2026-10-11, and a compressed IS-Net
      // (45 MB) is close but not Apple's (mockups/remove-bg-compressed-2026-10.html).
      // The runner speaks the Swift helper's arguments, so a model that passes
      // drops in.
    },
    licence: 'Uses Apple Vision on-device; helper is MIT',
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
    // macOS decodes camera RAW itself (sips); Windows and Linux need this:
    // LibRaw, through libraw-wasm's WASM build. As with heic, the two
    // archives hold the same files and differ only in the manifest's arch.
    id: 'raw',
    title: 'Camera RAW photos',
    summary: 'Open camera RAW photos',
    assets: {
      'win32-universal': {
        version: '1.0.0',
        url: `${RELEASES}/ext-raw-v1.0.0/forge-ext-raw-1.0.0-win32-universal.tar.gz`,
        bytes: 529983,
        sha256: 'def170f48e004240c0cd23a539e4345d8056ea1f4d9c90f45c2a07573bfad199',
      },
      'linux-universal': {
        version: '1.0.0',
        url: `${RELEASES}/ext-raw-v1.0.0/forge-ext-raw-1.0.0-linux-universal.tar.gz`,
        bytes: 529982,
        sha256: '35c21be2691cecfcadca944ee8c61736b7d6149130e42492c097115467facd36',
      },
    },
    licence: 'LibRaw (LGPL-2.1 or CDDL-1.0), via libraw-wasm (ISC)',
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
    // Transcribe runs on every Mac now (whisper.cpp where Apple's recogniser is
    // missing), so this follows the video extension's floor, not macOS 26.
    minMacos: 13,
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
    // Every OS, the same way: whisper.cpp's whisper-cli and the speech model
    // (model.bin, ggml-base q5_1, 60 MB) in one archive, so /extensions counts
    // it and removing the extension removes it. On a Mac it is for where
    // Apple's recogniser is not (Intel, before macOS 26).
    minMacos: 13,
    assets: {
      // One universal whisper-cli (Metal and Accelerate), macOS 13 and later.
      'darwin-universal': {
        version: '1.0.0',
        url: `${RELEASES}/ext-whisper-v1.0.0/forge-ext-whisper-1.0.0-universal.tar.gz`,
        bytes: 61123538,
        sha256: 'f521e829afdbcf56da901bd9df5f7644d9903489a2167c3cf75c72cab98629ad',
      },
      'win32-x64': {
        version: '1.0.0',
        url: `${RELEASES}/ext-whisper-v1.0.0/forge-ext-whisper-1.0.0-win32-x64.tar.gz`,
        bytes: 60751383,
        sha256: '930014128158e14903413dce5b15b1a9853d6257fd6998da5ecedffb8a435c2f',
      },
      'win32-arm64': {
        version: '1.0.0',
        url: `${RELEASES}/ext-whisper-v1.0.0/forge-ext-whisper-1.0.0-win32-arm64.tar.gz`,
        bytes: 58197088,
        sha256: 'f11f1fdcc07816033558ebc89d19e31f60a4672b0e239a67e18160d205cc4460',
      },
      // Static (musl), so one build runs on any Linux of that chip.
      'linux-arm64': {
        version: '1.0.0',
        url: `${RELEASES}/ext-whisper-v1.0.0/forge-ext-whisper-1.0.0-linux-arm64.tar.gz`,
        bytes: 57902587,
        sha256: '17f793a111809b81f7761a7c226be1f9c71aa23701030e0616663ed411d0b827',
      },
      // Needs AVX2 (2013 on); an older PC is told to use its own whisper-cli.
      'linux-x64': {
        version: '1.0.0',
        url: `${RELEASES}/ext-whisper-v1.0.0/forge-ext-whisper-1.0.0-linux-x64.tar.gz`,
        bytes: 58051297,
        sha256: '23ef0a03fa46364a85b485f03234327e6a6cc9c8b31e8ac86f6abb9dfad8f82e',
      },
    },
    licence: 'whisper.cpp and ggml (MIT), OpenAI Whisper base model (MIT)',
  },
  {
    // Reading the text of pictures and PDFs where Apple's reader is not
    // (spec 2026-10-23-extract-text-design §6): Windows, Linux, and Macs on
    // Intel or before macOS 26. PP-OCR's small models on ONNX Runtime's CPU
    // provider; it answers as the Mac helper's \`read\` does.
    id: 'read-text',
    title: 'Read text',
    summary: 'Read the text of pictures and PDFs on this computer',
    minMacos: 13,
    assets: {
      'darwin-arm64': {
        version: '1.0.1',
        url: `${RELEASES}/ext-read-text-v1.0.1/forge-ext-read-text-1.0.1-arm64.tar.gz`,
        bytes: 21975029,
        sha256: 'b6af18462eb4bf6571caf6a7d392bd945a18f91d5cdd95de6fa4b5466aacc2cc',
      },
      'darwin-x64': {
        version: '1.0.1',
        url: `${RELEASES}/ext-read-text-v1.0.1/forge-ext-read-text-1.0.1-x64.tar.gz`,
        bytes: 23165933,
        sha256: '1267a0e2883d274b22b3712ac1ebf427a740986858d402b2e018d1bab3f0bf26',
      },
      'win32-x64': {
        version: '1.0.1',
        url: `${RELEASES}/ext-read-text-v1.0.1/forge-ext-read-text-1.0.1-win32-x64.tar.gz`,
        bytes: 20729724,
        sha256: 'aec6099196c03ba37562974f93b6eeb3246ff9b381b63e35aece6aa2324f6360',
      },
      'win32-arm64': {
        version: '1.0.1',
        url: `${RELEASES}/ext-read-text-v1.0.1/forge-ext-read-text-1.0.1-win32-arm64.tar.gz`,
        bytes: 20805682,
        sha256: '3aece834bf1fe83238d001239ebb0c63fe484ad3fb11f5f16680f801a0e0c4ae',
      },
      'linux-x64': {
        version: '1.0.1',
        url: `${RELEASES}/ext-read-text-v1.0.1/forge-ext-read-text-1.0.1-linux-x64.tar.gz`,
        bytes: 24127461,
        sha256: '032a7075867fa7d9e00eb462df55cdc13b131710fe37941a899144775b2f5d2f',
      },
      'linux-arm64': {
        version: '1.0.1',
        url: `${RELEASES}/ext-read-text-v1.0.1/forge-ext-read-text-1.0.1-linux-arm64.tar.gz`,
        bytes: 19113041,
        sha256: '013f452ef931c91ecec7c39cbb9766c8d0f50e00aa9c7ffff37e589b65565961',
      },
    },
    licence:
      'PP-OCRv4 detection and PP-OCRv5 Latin recognition (Apache-2.0, PaddlePaddle; ONNX by RapidOCR and monkt), ONNX Runtime (MIT)',
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

/**
 * Whether the catalogue offers `id` on this OS and, when `arch` is given, for
 * that chip as well: Boost, for one, has builds for Linux x64 but not arm64.
 * Callers that mean this machine pass `process.arch`; a test that names an OS
 * on its own gets the OS's answer.
 */
export function offeredHere(
  id: ExtensionId,
  platform: NodeJS.Platform = process.platform,
  arch?: string,
): boolean {
  const entry = catalogEntry(id)
  if (entry === undefined || !offeredOn(entry, platform)) return false
  return arch === undefined || assetFor(entry, platform, arch) !== undefined
}
