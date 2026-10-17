/**
 * The catalogue of optional extensions, compiled into Forge (spec §4.2).
 * Forge never downloads a catalogue and never runs anything not listed here.
 */
export type ExtensionId = 'boost' | 'remove-background' | 'heic' | 'yt-dlp'

/** Where an asset runs: `${platform}-${arch}`, or `${platform}-universal` for any arch. */
export type PlatformKey = `${'darwin' | 'win32'}-${'arm64' | 'x64' | 'universal'}`

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
]

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
