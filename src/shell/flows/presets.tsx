import { copyFile, mkdtemp, rename, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import type { Key } from 'ink'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import type { Preferences } from '../../config/preferences.js'
import { targetsFor } from '../../core/capabilities.js'
import { boostScales } from '../../core/extension-targets.js'
import { FORMATS, primaryExtension } from '../../core/formats.js'
import { uniqueOutputPath } from '../../core/output-path.js'
import { type Preset, type PresetSteps, passesFor } from '../../core/preset.js'
import { runPreset } from '../../core/preset-run.js'
import type { FormatId, ImageInfo, Result } from '../../core/types.js'
import { offeredHere } from '../../extensions/catalog.js'
import type { ExtensionStatus } from '../../extensions/manager.js'
import type { Trail } from '../bar-art.js'
import type { DonePreset } from '../components/Done.js'
import { PresetEditorScreen, type PresetPreview } from '../components/PresetEditor.js'
import { PresetSaveScreen, presetFolders } from '../components/PresetSave.js'
import { type Editor, type OpId, reasonsFor } from '../preset-editor.js'
import { valueText } from '../preset-editor-art.js'
import type { ShellMode } from '../theme.js'

/** A preview's file, where it really is until ↵ done moves it into place. */
type Preview = PresetPreview & { file?: string }

/** What Done's result was made with: the convert just done, as a preset's steps. */
function stepsOfResult(result: Result): PresetSteps {
  const job = result.job
  if (job.op !== 'convert') return {}
  return {
    to: job.target,
    ...(job.options.quality === undefined ? {} : { quality: job.options.quality }),
    ...(job.options.compress ? { compress: job.options.compress } : {}),
  }
}

/** The steps as the formats' chip says them: `PNG → WebP 80 → 1920 wide → Sharpen`. */
export function chainOf(source: FormatId, steps: PresetSteps): string[] {
  const label = (f: FormatId) => FORMATS[f]?.label ?? f.toUpperCase()
  return [
    label(source),
    ...(steps.to
      ? [`${label(steps.to)}${steps.quality === undefined ? '' : ` ${steps.quality}`}`]
      : []),
    ...(steps.maxBytes ? [valueText({ id: 'compress', on: true, value: steps.maxBytes })] : []),
    ...(steps.resize ? [valueText({ id: 'resize', on: true, value: steps.resize })] : []),
    ...(steps.trim ? ['Trim'] : []),
    ...(steps.crop ? [`${steps.crop.w}:${steps.crop.h}`] : []),
    ...(steps.sharpen && !steps.boost ? ['Sharpen'] : []),
    ...(steps.boost ? [`Boost ${steps.boost}×`] : []),
    ...(steps.removeBackground ? ['Remove background'] : []),
  ]
}

/** Moves a finished preview into place: a rename, or a copy across volumes. */
async function moveInto(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  } catch {
    await copyFile(from, to)
    await unlink(from).catch(() => {})
  }
}

/**
 * Presets on Done (mockups/presets-2026-10.html, round 9): `p` opens Save as
 * preset, `→` opens Continue editing. Holds what this Done's session made —
 * the window as it was left, the steps, the preset saved — and gives App the
 * screen to show while either window is open.
 */
export function usePresetsOnDone(o: {
  result: Result | null
  setResult: (r: Result) => void
  mode: ShellMode
  trail: Trail
  width: number
  height: number
  open: 'edit' | 'save' | null
  setOpen: (open: 'edit' | 'save' | null) => void
  prefs: Preferences
  setPrefs: (update: (p: Preferences) => Preferences) => void
  save: (patch: Partial<Preferences>) => Promise<void>
  /** Clipboard results and other modes have no presets. */
  enabled: boolean
  /** The extensions on this machine, and adding one: the shell's own, injectable for tests. */
  tools: {
    list(): Promise<ExtensionStatus[]>
    install(
      id: string,
      opts: { onProgress: (done: number, total: number) => void; signal: AbortSignal },
    ): Promise<unknown>
  }
}) {
  const [editor, setEditor] = useState<Editor | undefined>()
  const [steps, setSteps] = useState<PresetSteps | undefined>()
  const [saved, setSaved] = useState<{ name: string; changed: boolean } | undefined>()
  const temps = useRef<string[]>([])

  const job = o.result?.job
  const source =
    job?.op === 'convert' && job.sources[0].kind === 'image' ? job.sources[0] : undefined
  const usable = o.enabled && source !== undefined

  // Previews no one moved into place go when the session ends.
  const sweep = useCallback(async () => {
    const dirs = temps.current
    temps.current = []
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })))
  }, [])
  useEffect(() => () => void sweep(), [sweep])

  // Why rows cannot apply (E2): what the probe knows at once, the trim once the image is read.
  const [reasons, setReasons] = useState<Partial<Record<OpId, string>>>({})
  const editing = o.open === 'edit' ? source : undefined
  useEffect(() => {
    if (!editing) return
    setReasons(reasonsFor(editing, undefined))
    let live = true
    import('../../engines/image.js')
      .then(({ measureImage }) => measureImage(editing))
      .then(
        (measure) => {
          if (live) setReasons(reasonsFor(editing, measure))
        },
        () => {},
      )
    return () => {
      live = false
    }
  }, [editing])

  // Rows whose extension is not added (E3), and the boost scales the installed one makes.
  const [missing, setMissing] = useState<Partial<Record<OpId, number>>>({})
  const [unavailable, setUnavailable] = useState<Partial<Record<OpId, string>>>({})
  const [boostVersion, setBoostVersion] = useState<string | undefined>()
  const tools = o.tools
  const check = useCallback(async () => {
    const all = await tools.list().catch((): ExtensionStatus[] => [])
    const away: Partial<Record<OpId, number>> = {}
    const not: Partial<Record<OpId, string>> = {}
    const rows: Array<[string, OpId[]]> = [
      ['boost', ['sharpen', 'boost']],
      ['remove-background', ['cutout']],
    ]
    for (const [id, ops] of rows) {
      const status = all.find((s) => s.entry.id === id)
      if (!status || status.installed !== undefined) continue
      for (const op of ops) {
        if (status.supported) away[op] = status.downloadBytes ?? 0
        else not[op] = status.reason ?? 'not available'
      }
    }
    setMissing(away)
    setUnavailable(not)
    setBoostVersion(all.find((s) => s.entry.id === 'boost')?.installed)
  }, [tools])
  useEffect(() => {
    if (editing) void check()
  }, [editing, check])
  const add = useCallback(
    (op: OpId) => {
      const id = op === 'cutout' ? 'remove-background' : 'boost'
      void tools
        .install(id, { onProgress: () => {}, signal: new AbortController().signal })
        .then(check, check)
    },
    [tools, check],
  )

  const reset = () => {
    setEditor(undefined)
    setSteps(undefined)
    setSaved(undefined)
    void sweep()
  }

  /** Done's keys: p and →, while a preset can be made from what is shown. */
  const key = (input: string, k: Key): boolean => {
    if (!usable) return false
    if (input === 'p') {
      o.setOpen('save')
      return true
    }
    if (k.rightArrow) {
      o.setOpen('edit')
      return true
    }
    return false
  }

  const done: DonePreset | undefined = usable
    ? saved
      ? { save: saved.changed ? 'update' : 'saved', name: saved.name }
      : { save: 'key' }
    : undefined
  const chain = source && steps ? chainOf(source.format, steps) : undefined

  let screen: ReactNode = null
  if (o.open && o.result && source && job?.op === 'convert') {
    const result = o.result
    const output = job.outputs[0]
    const original: ImageInfo = source
    // The rerun: the selected rows on the original, into a temp folder, named
    // as the result will be.
    const run = async (s: PresetSteps, signal: AbortSignal): Promise<Preview> => {
      const passes = passesFor(s, original.format)
      const last = passes[passes.length - 1]
      if (last?.kind !== 'encode')
        return { kind: 'ready', output: original.path, bytes: original.bytes }
      const name = `${basename(output, extname(output))}${primaryExtension(last.target)}`
      const temp = await mkdtemp(join(tmpdir(), 'forge-edit-'))
      temps.current.push(temp)
      const file = join(temp, name)
      const outcome = await runPreset(original, passes, file, { force: true, signal })
      if (outcome.kind === 'done') {
        return {
          kind: 'ready',
          output: join(dirname(output), name),
          bytes: outcome.result.outputBytes,
          file,
        }
      }
      if (outcome.kind === 'cancelled') return { kind: 'failed', message: 'cancelled' }
      const error = outcome.kind === 'unreachable' ? outcome.entry.error : outcome.error
      return { kind: 'failed', message: error.detail ?? error.title }
    }
    if (o.open === 'edit') {
      screen = (
        <PresetEditorScreen
          mode={o.mode}
          trail={o.trail}
          result={result}
          width={o.width}
          height={o.height}
          targets={targetsFor(original).map((t) => t.id)}
          scales={boostScales(boostVersion)}
          cutout={offeredHere('remove-background')}
          initial={editor}
          reasons={{ ...unavailable, ...reasons }}
          missing={missing}
          onAdd={add}
          run={run}
          onCancel={() => o.setOpen(null)}
          onDone={(next, preview: Preview | undefined, left) => {
            setEditor(left)
            o.setOpen(null)
            if (preview?.kind !== 'ready' || !preview.file) return
            const file = preview.file
            void (async () => {
              let to = preview.output
              // A preset never writes over the original.
              if (to === original.path) to = uniqueOutputPath(to)
              await moveInto(file, to)
              if (to !== output) await unlink(output).catch(() => {})
              const last = passesFor(next, original.format).at(-1)
              const target = last?.kind === 'encode' ? last.target : job.target
              o.setResult({
                job: {
                  ...job,
                  target,
                  outputs: [to],
                  options: {
                    ...job.options,
                    ...(next.quality === undefined ? {} : { quality: next.quality }),
                  },
                },
                outputBytes: preview.bytes,
                warnings: [],
              })
              setSteps(next)
              setSaved((s) => (s ? { ...s, changed: true } : s))
            })()
          }}
        />
      )
    } else {
      const presets = o.prefs.presets ?? []
      const updating = saved?.changed ? saved.name : undefined
      screen = (
        <PresetSaveScreen
          mode={o.mode}
          trail={o.trail}
          result={result}
          width={o.width}
          height={o.height}
          name={updating ?? ''}
          taken={presets.map((p) => p.name).filter((n) => n !== updating)}
          folders={presetFolders(o.prefs.defaultOutput)}
          defaultValue={o.prefs.defaultOutput}
          onCancel={() => o.setOpen(null)}
          onMakeDefault={(path) => {
            o.setPrefs((p) => ({ ...p, defaultOutput: path }))
            void o.save({ defaultOutput: path })
          }}
          onSave={({ name, saveTo }) => {
            const preset: Preset = { name, steps: steps ?? stepsOfResult(result), saveTo }
            const next = [...presets.filter((p) => p.name !== name), preset]
            o.setPrefs((p) => ({ ...p, presets: next }))
            void o.save({ presets: next })
            setSaved({ name, changed: false })
            o.setOpen(null)
          }}
        />
      )
    }
  }

  return { done, chain, key, screen, reset }
}
