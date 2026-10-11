/**
 * The catalogue of optional extensions, compiled into Forge (spec §4.2).
 * Forge never downloads a catalogue and never runs anything not listed here.
 */
export type ExtensionId = 'boost' | 'remove-background'

export interface CatalogAsset {
  url: string
  bytes: number
  sha256: string
}

export interface CatalogEntry {
  id: ExtensionId
  title: string
  summary: string
  version: string
  /** Major macOS version, e.g. 14. */
  minMacos: number
  assets: Partial<Record<'arm64' | 'x64' | 'universal', CatalogAsset>>
  /** One line, shown by `forge extensions`. */
  licence: string
}

const RELEASES = 'https://github.com/AtharvaN16/forge-terminal/releases/download'

export const CATALOG: readonly CatalogEntry[] = [
  {
    id: 'boost',
    title: 'Boost',
    summary: 'Upscale images 2x or 4x with a local AI model',
    version: '1.0.0',
    minMacos: 14,
    assets: {
      arm64: {
        url: `${RELEASES}/ext-boost-v1.0.0/forge-ext-boost-1.0.0-arm64.tar.gz`,
        bytes: 14866271,
        sha256: 'cc669b3abf183fb65251b8399700ba5bab65e2623e0fcc716af1c18f4e5d77e9',
      },
      x64: {
        url: `${RELEASES}/ext-boost-v1.0.0/forge-ext-boost-1.0.0-x64.tar.gz`,
        bytes: 16061393,
        sha256: 'ec3ff921d067be9d4951a60fc3293ff1252ca660148296644d98c8abe13f38d6',
      },
    },
    licence: 'Real-ESRGAN general-x4v3 (BSD-3-Clause), ONNX Runtime (MIT)',
  },
  {
    id: 'remove-background',
    title: 'Remove background',
    summary: 'Cut the subject out of a photo, on this Mac',
    version: '1.0.0',
    minMacos: 14,
    assets: {
      universal: {
        url: `${RELEASES}/ext-remove-background-v1.0.0/forge-ext-remove-background-1.0.0-universal.tar.gz`,
        bytes: 32489,
        sha256: '9f6e055c0ce25f7504e10c7871e506a813bc75d6536396a675a8c075c4eb4686',
      },
    },
    licence: 'Uses Apple Vision on-device; helper is MIT',
  },
]

export function catalogEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((e) => e.id === id)
}
