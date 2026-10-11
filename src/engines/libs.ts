/**
 * The heavy libraries engines use, each loaded on first use and then cached
 * for the process.
 *
 * Engines declare what they can do (`reads`, `writes`, `ops`) as plain data
 * that costs nothing to import. They pay for a library only when a probe, a
 * run or a measurer actually needs it. On 0.1.0, loading every engine library
 * up front cost ~230 ms on every command, `forge --version` included (spec
 * §1, §4.2).
 *
 * The promise is cached rather than the module, so two concurrent first calls
 * share one import instead of racing two.
 */
export function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let loading: Promise<T> | undefined
  return () => {
    loading ??= load()
    return loading
  }
}

export const loadSharp = lazy(async () => (await import('sharp')).default)
export const loadPdfLib = lazy(() => import('pdf-lib'))
export const loadPdfium = lazy(() => import('@hyzyla/pdfium'))
export const loadMammoth = lazy(async () => (await import('mammoth')).default)
export const loadWordExtractor = lazy(async () => (await import('word-extractor')).default)
export const loadAdmZip = lazy(async () => (await import('adm-zip')).default)
export const loadCfb = lazy(() => import('cfb'))

type DocxModule = typeof import('docx')

/**
 * `docx` is imported with `globalThis.localStorage` hidden while it evaluates.
 *
 * Its bundle inlines the browser build of `util-deprecate`, whose
 * `deprecate()` probes `globalThis.localStorage` for `noDeprecation`, and
 * calls it at module top level (readable-stream's `_writableState.buffer`).
 * On Node 26 `localStorage` is a global getter that emits an
 * ExperimentalWarning on stderr when `--localstorage-file` is absent, so a
 * static import put that warning on every invocation, `--version` included.
 *
 * Loading lazily keeps the warning off every path that never writes a docx.
 * Hiding the getter for the duration of the import keeps it off the path that
 * does. Nothing is filtered: the warning is never raised, and every other Node
 * warning still prints. Without a backing file Node's `localStorage` is
 * unusable anyway, so `docx` sees exactly the "no localStorage" it would have
 * concluded, and nothing in Forge reads it while it is hidden.
 */
async function importWithoutLocalStorage(): Promise<DocxModule> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  if (!descriptor?.configurable) return import('docx')
  Object.defineProperty(globalThis, 'localStorage', {
    value: undefined,
    configurable: true,
    enumerable: descriptor.enumerable ?? false,
    writable: true,
  })
  try {
    return await import('docx')
  } finally {
    Object.defineProperty(globalThis, 'localStorage', descriptor)
  }
}

export const loadDocx = lazy(importWithoutLocalStorage)
