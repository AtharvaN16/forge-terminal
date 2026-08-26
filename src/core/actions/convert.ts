import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { expandTilde, type Preferences } from '../../config/preferences.js'
import { rasterises, targetsFor } from '../capabilities.js'
import { invalidArguments } from '../errors.js'
import { FORMATS, formatById } from '../formats.js'
import { rasterOutputPaths, resolveOutputPath } from '../output-path.js'
import { normalisePages, parseRanges } from '../pages.js'
import type { ConvertOptions, DocumentInfo, FormatId, FormatSpec, SourceInfo } from '../types.js'
import type { Action, OptionSpec, PathPreset } from './index.js'

/**
 * Which pages to rasterise, and the resolution to do it at. Only offered
 * once a document source has a real (raster) target — the only other target
 * a document has is filtered out in `targetSelect` for being a no-op, so a
 * chosen target always means jpeg or png here (see `engines/pdfium.ts`).
 *
 * `choose` hands off to the shell's page picker (`PageGrid`, phase 3) rather
 * than a typed field: the grid is the one existing UI for this, and building
 * a second picker for the same job is exactly what note 4 warns against.
 */
function pagesSelect(doc: DocumentInfo): OptionSpec {
  return {
    kind: 'select',
    id: 'pages',
    label: 'Pages',
    default: 'all',
    choices: [
      { value: 'all', label: 'All pages', hint: `${doc.pages} pages` },
      { value: 'first', label: 'First page only' },
      { value: 'choose', label: 'Choose pages', hint: 'pick which ones' },
    ],
  }
}

/**
 * The shell offers three presets because a picker needs a short list; the
 * CLI's own `--dpi` has no such constraint and accepts any integer in
 * `invalidDpi`'s 36-600 range (spec §10). 150 is the default either way.
 */
function dpiSelect(): OptionSpec {
  return {
    kind: 'select',
    id: 'dpi',
    label: 'Resolution',
    default: '150',
    choices: [
      { value: '72', label: '72 dpi', hint: 'screen' },
      { value: '150', label: '150 dpi', hint: 'default' },
      { value: '300', label: '300 dpi', hint: 'print' },
    ],
  }
}

/**
 * `values.pages` arrives as one of: `'all'` (or unset), `'first'`, a typed
 * range string (`parseRanges`'s grammar), or an explicit array — the shape
 * `PageGrid`'s `onSubmit` hands back after "Choose pages". Every branch is
 * normalised through the one ordering authority, `core/pages.ts`'s
 * `normalisePages` — the same function `core/actions/extract.ts`'s
 * `selectedPages` uses, so naming and rendering can never derive from two
 * different orderings (phase 3's worst defect).
 */
function resolvePages(doc: DocumentInfo, raw: unknown): number[] {
  if (Array.isArray(raw)) return normalisePages(raw as number[])
  if (raw === 'first') return [0]
  if (typeof raw === 'string' && raw !== 'all' && raw !== '') {
    return normalisePages(parseRanges(raw, doc.pages))
  }
  return Array.from({ length: doc.pages }, (_, i) => i)
}

function targetSelect(source: SourceInfo): OptionSpec {
  // Converting a file to its own format changes nothing the user can see,
  // so it is never offered here (the CLI's separate `--to jpeg` recompress
  // flow is unaffected — that goes through core/plan.ts, not this file).
  const targets = targetsFor(source).filter((t) => t.id !== source.format)
  const first = targets[0]
  return {
    kind: 'select',
    id: 'target',
    // Names the source format explicitly, so it reads as "pick something
    // else" rather than leaving the user to wonder why their own format
    // is missing from the list.
    label: `Convert ${FORMATS[source.format].label} to`,
    choices: targets.map((t) => ({ value: t.id, label: t.label, hint: t.hint })),
    default: first ? first.id : '',
  }
}

/**
 * plan() cannot trust `values.target` the way options() can afford to — a
 * caller (in practice, the shell) is expected to reach plan() only after
 * walking options(), but nothing enforces that. An unchecked `as FormatId`
 * here would let a missing, empty, or bogus target slip through and crash
 * deep inside resolveOutputPath instead of failing at the boundary with a
 * message that says what went wrong.
 */
function requireTarget(values: Record<string, unknown>): FormatSpec {
  const raw = values.target
  const spec = typeof raw === 'string' ? formatById(raw) : undefined
  if (!spec) {
    throw invalidArguments(
      `convertAction.plan() requires a valid target format, got ${JSON.stringify(raw)}.`,
      'This is a caller bug, not a user-facing condition: call options() and pass one of the target select choices before calling plan().',
    )
  }
  return spec
}

/**
 * Names a path the way the built-in presets do, so a hoisted default is not
 * shown as a bare path when it happens to be one of them.
 */
function labelFor(path: string, sourceDir: string): string {
  if (path === sourceDir) return 'Same folder'
  if (path === join(homedir(), 'Desktop')) return 'Desktop'
  if (path === join(homedir(), 'Downloads')) return 'Downloads'
  if (path === join(sourceDir, 'converted')) return 'New subfolder'
  return path.split('/').pop() || path
}

function destinationPath(source: SourceInfo, prefs: Preferences): OptionSpec {
  const here = dirname(source.path)
  const preferred = expandTilde(prefs.defaultOutput)

  // The configured default leads, listed explicitly so that a default
  // pointing somewhere none of the built-ins cover still appears at all. When
  // it *is* one of them, the dedupe below collapses the pair and this entry
  // wins — which is why it carries the built-in's label rather than a path.
  const candidates: PathPreset[] = [
    { label: labelFor(preferred, here), path: preferred },
    { label: 'Desktop', path: join(homedir(), 'Desktop') },
    { label: 'Same folder', path: here },
    { label: 'Downloads', path: join(homedir(), 'Downloads') },
    { label: 'New subfolder', path: join(here, 'converted') },
  ]
  // Two presets can resolve to the identical folder — e.g. "Same folder" and
  // "Downloads" collide whenever the source file already lives in
  // ~/Downloads. `Select` keys each row by its path, so an undeduped
  // collision here is not cosmetic: React treats it as two components
  // sharing one identity and refuses to render reliably. Keep the earlier
  // (more specific) preset and drop the redundant one.
  const seen = new Set<string>()
  const presets = candidates.filter((preset) => {
    if (seen.has(preset.path)) return false
    seen.add(preset.path)
    return true
  })
  return {
    kind: 'path',
    id: 'destination',
    label: 'Save to',
    default: preferred,
    presets,
  }
}

export const convertAction: Action = {
  id: 'convert',
  label: 'Convert',
  hint: 'to another format',

  appliesTo: (sources) => sources.length >= 1,

  options(sources, values, prefs) {
    const source = sources[0]
    if (!source) return []
    const specs: OptionSpec[] = [targetSelect(source)]

    const target = values.target
    if (typeof target !== 'string') return specs

    // A document source only needs the pages/resolution pickers when the
    // chosen target actually rasterises it (jpeg/png, via pdfium) — a
    // target of pdf/docx/doc is a document-to-document conversion with no
    // pages or dpi concept at all.
    if (source.kind === 'document' && rasterises(target as FormatId)) {
      specs.push(pagesSelect(source), dpiSelect())
    }

    const spec = FORMATS[target as FormatId]
    if (spec?.lossy) {
      specs.push({
        kind: 'slider',
        id: 'quality',
        label: 'Quality',
        min: 1,
        max: 100,
        step: 5,
        default: prefs.quality,
      })
    }

    specs.push(destinationPath(source, prefs))
    return specs
  },

  plan(sources, values) {
    const source = sources[0]
    if (!source) return []
    const spec = requireTarget(values)
    const target = spec.id

    const options: ConvertOptions = {
      // The caller's fill colour when one is given. The shell has no
      // background control and passes nothing, so it keeps the white default;
      // the CLI's `--background` reaches here through `values`. Hardcoding
      // white made that flag work for an image conversion and silently do
      // nothing for a document — the same flag behaving two ways depending on
      // what was dropped on it.
      background: typeof values.background === 'string' ? values.background : '#ffffff',
      // Same reasoning as `background` above: the shell has no metadata
      // control and passes nothing, so it keeps the `false` default, while
      // the CLI's `--keep-metadata` reaches here through `values`. Every
      // `ConvertOptions` field a caller can set has to be readable from
      // `values` or the flag that sets it works for one source kind and
      // silently does nothing for the other.
      keepMetadata: values.keepMetadata === true,
    }
    if (spec.lossy && typeof values.quality === 'number') options.quality = values.quality

    const destination = typeof values.destination === 'string' ? values.destination : undefined

    // A document source rasterises to one image per selected page rather
    // than one output for the whole source — `resolveOutputPath` below
    // assumes exactly the latter, so this branches before it rather than
    // trying to bend that function to a shape it was never built for. Only
    // true when the target actually rasterises (jpeg/png); pdf/docx/doc
    // fall through to the single-output path below like any other format.
    if (source.kind === 'document' && rasterises(target)) {
      const dpi = Number(values.dpi)
      options.dpi = Number.isFinite(dpi) && dpi > 0 ? dpi : 150
      const pages = resolvePages(source, values.pages)
      options.pages = pages
      const sourceRoot = typeof values.sourceRoot === 'string' ? values.sourceRoot : undefined
      const outputs = rasterOutputPaths(source.path, pages, target, destination, sourceRoot)
      return [{ op: 'convert', sources: [source], outputs, target, options }]
    }

    const output = resolveOutputPath({
      sourcePath: source.path,
      target,
      ...(destination === undefined ? {} : { output: `${destination}/` }),
    })

    return [{ op: 'convert', sources: [source], outputs: [output], target, options }]
  },
}
