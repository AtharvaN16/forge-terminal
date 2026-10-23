import { copyFile, mkdtemp, rename, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import type { Preferences } from '../../config/preferences.js'
import { targetsFor } from '../../core/capabilities.js'
import { boostScales } from '../../core/extension-targets.js'
import { FORMATS, primaryExtension } from '../../core/formats.js'
import { uniqueOutputPath } from '../../core/output-path.js'
import { type Preset, type PresetSteps, passesFor } from '../../core/preset.js'
import { runPreset } from '../../core/preset-run.js'
import type { ImageInfo, Result } from '../../core/types.js'
import { offeredHere } from '../../extensions/catalog.js'
import type { ExtensionStatus } from '../../extensions/manager.js'
import type { Trail } from '../bar-art.js'
import { ContinueEditingScreen, type Rerun } from '../components/ContinueEditing.js'
import type { DonePreset } from '../components/Done.js'
import { type DoneLinks, PresetSaveScreen, presetFolders } from '../components/PresetSave.js'
import { chainLabels, type Op, reasonsFor, stepLabel } from '../continue-editing.js'
import type { ShellMode } from '../theme.js'

/** What Done's result was made with: the convert or compress just done, as a preset's steps. */
export function stepsOfResult(result: Result): PresetSteps {
  const job = result.job
  if (job.op !== 'convert') return {}
  return {
    to: job.target,
    ...(job.options.quality === undefined ? {} : { quality: job.options.quality }),
    ...(job.options.compress ? { compress: job.options.compress } : {}),
  }
}

/** Moves a finished rerun into place: a rename, or a copy across volumes. */
async function moveInto(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  } catch {
    await copyFile(from, to)
    await unlink(from).catch(() => {})
  }
}

/**
 * Presets on Done (decided, mockups/presets-ux-2026-10-round10.html). Done is
 * the hub: `e` opens Continue editing — one more thing done to the file, then
 * back to Done — and `p` opens Save as preset, which keeps the chain Done's
 * strip says. Holds this Done's session: the steps added (for Undo), the
 * preset saved, and the screen App shows while either is open.
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
  /** A step that failed: said on Done, which keeps the file and the chain as they were. */
  fail: (error: unknown) => void
  /** The extensions on this machine, and adding one: the shell's own, injectable for tests. */
  tools: {
    list(): Promise<ExtensionStatus[]>
    install(
      id: string,
      opts: { onProgress: (done: number, total: number) => void; signal: AbortSignal },
    ): Promise<unknown>
  }
}) {
  /** The steps Done's result was first made with, and each step added since, with what Undo calls it. */
  const [base, setBase] = useState<PresetSteps | undefined>()
  const [history, setHistory] = useState<Array<{ steps: PresetSteps; label: string }>>([])
  const [saved, setSaved] = useState<{ name: string; changed: boolean } | undefined>()
  const temps = useRef<string[]>([])

  const job = o.result?.job
  const source =
    job?.op === 'convert' && job.sources[0].kind === 'image' ? job.sources[0] : undefined
  const usable = o.enabled && source !== undefined
  // The first result of a session is what the chain starts from.
  const first = base ?? (o.result && usable ? stepsOfResult(o.result) : undefined)
  useEffect(() => {
    if (base === undefined && o.result && usable) setBase(stepsOfResult(o.result))
  }, [base, o.result, usable])
  const steps = history.at(-1)?.steps ?? first ?? {}

  // Reruns no one moved into place go when the session ends.
  const sweep = useCallback(async () => {
    const dirs = temps.current
    temps.current = []
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })))
  }, [])
  useEffect(() => () => void sweep(), [sweep])

  // Why an operation cannot apply: what the probe knows at once, the trim once the image is read.
  const [reasons, setReasons] = useState<Partial<Record<Op, string>>>({})
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

  // Operations whose on-device model is not added, and the boost scales the installed one makes.
  const [missing, setMissing] = useState<Partial<Record<Op, number>>>({})
  const [unavailable, setUnavailable] = useState<Partial<Record<Op, string>>>({})
  const [boostVersion, setBoostVersion] = useState<string | undefined>()
  const tools = o.tools
  const check = useCallback(async (): Promise<Partial<Record<Op, number>>> => {
    const all = await tools.list().catch((): ExtensionStatus[] => [])
    const away: Partial<Record<Op, number>> = {}
    const not: Partial<Record<Op, string>> = {}
    const rows: Array<[string, Op[]]> = [
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
    return away
  }, [tools])
  useEffect(() => {
    if (editing) void check()
  }, [editing, check])
  const add = useCallback(
    async (op: Op): Promise<boolean> => {
      const id = op === 'cutout' ? 'remove-background' : 'boost'
      await tools
        .install(id, { onProgress: () => {}, signal: new AbortController().signal })
        .catch(() => {})
      const away = await check()
      return away[op] === undefined
    },
    [tools, check],
  )

  const reset = () => {
    setBase(undefined)
    setHistory([])
    setSaved(undefined)
    void sweep()
  }
  /** Done after a saved preset ran: the chain starts from its steps, and the button says it is saved. */
  const seed = (steps: PresetSteps, name: string) => {
    setBase(steps)
    setHistory([])
    setSaved({ name, changed: false })
  }

  /** Opens Save as preset or Continue editing, while a preset can be made from what is shown. */
  const open = (which: 'save' | 'edit'): boolean => {
    if (!usable) return false
    o.setOpen(which)
    return true
  }
  /** Done's keys: p and e (←→ move Done's selection, mockups/done-next-2026-10-round9.html). */
  const key = (input: string): boolean =>
    input === 'p' ? open('save') : input === 'e' ? open('edit') : false

  const done: DonePreset | undefined = usable
    ? saved
      ? { save: saved.changed ? 'update' : 'saved', name: saved.name }
      : { save: 'key' }
    : undefined
  /** The chain Done's strip says (C1): the source, every step, and the + slot. */
  const links: DoneLinks | undefined =
    usable && source
      ? {
          source: FORMATS[source.format]?.label ?? source.format.toUpperCase(),
          steps: chainLabels(source.format, steps),
          slot: true,
        }
      : undefined

  // The rerun: the steps on the original, into a temp folder, named as the
  // result will be.
  const original = source
  const output = job?.outputs[0]
  const run = useCallback(
    async (s: PresetSteps, signal: AbortSignal): Promise<Rerun> => {
      if (!original || !output) return { kind: 'failed', message: 'nothing to edit' }
      const passes = passesFor(s, original.format)
      const last = passes[passes.length - 1]
      if (last?.kind !== 'encode') return { kind: 'failed', message: 'nothing to do' }
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
      return { kind: 'failed', message: error.detail ?? error.title, error }
    },
    [original, output],
  )
  const setOpen = o.setOpen
  const fail = o.fail
  const onFail = useCallback(
    (error: unknown) => {
      setOpen(null)
      if (error !== 'cancelled') fail(error)
    },
    [setOpen, fail],
  )
  const result = o.result
  const setResult = o.setResult
  const onFinish = useCallback(
    (
      next: PresetSteps,
      rerun: Extract<Rerun, { kind: 'ready' }>,
      change: Parameters<Parameters<typeof ContinueEditingScreen>[0]['onFinish']>[2],
    ) => {
      if (!result || !original || !output || result.job.op !== 'convert' || !rerun.file) return
      const convert = result.job
      const file = rerun.file
      void (async () => {
        let to = rerun.output
        // Never written over the original.
        if (to === original.path) to = uniqueOutputPath(to)
        await moveInto(file, to)
        if (to !== output) await unlink(output).catch(() => {})
        const last = passesFor(next, original.format).at(-1)
        const target = last?.kind === 'encode' ? last.target : convert.target
        setResult({
          job: {
            ...convert,
            target,
            outputs: [to],
            options: {
              ...convert.options,
              ...(next.quality === undefined ? {} : { quality: next.quality }),
            },
          },
          outputBytes: rerun.bytes,
          warnings: [],
        })
        setHistory((h) =>
          change.kind === 'undo'
            ? h.slice(0, -1)
            : [...h, { steps: next, label: stepLabel(change.step) }],
        )
        setSaved((s) => (s ? { ...s, changed: true } : s))
        setOpen(null)
      })()
    },
    [result, original, output, setResult, setOpen],
  )

  let screen: ReactNode = null
  if (o.open && result && original && result.job.op === 'convert') {
    if (o.open === 'edit') {
      const last = history.at(-1)
      screen = (
        <ContinueEditingScreen
          mode={o.mode}
          trail={o.trail}
          result={result}
          original={original as ImageInfo}
          steps={steps}
          undo={
            last ? { label: last.label, steps: history.at(-2)?.steps ?? first ?? {} } : undefined
          }
          targets={targetsFor(original).map((t) => t.id)}
          scales={boostScales(boostVersion)}
          cutout={offeredHere('remove-background')}
          reasons={{ ...unavailable, ...reasons }}
          missing={missing}
          onAdd={add}
          run={run}
          onFinish={onFinish}
          onFail={onFail}
          onCancel={() => setOpen(null)}
          width={o.width}
          height={o.height}
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
          links={links ? { ...links, slot: false } : undefined}
          width={o.width}
          height={o.height}
          name={updating ?? ''}
          taken={presets.map((p) => p.name).filter((n) => n !== updating)}
          folders={presetFolders(o.prefs.defaultOutput)}
          defaultValue={o.prefs.defaultOutput}
          onCancel={() => setOpen(null)}
          onMakeDefault={(path) => {
            o.setPrefs((p) => ({ ...p, defaultOutput: path }))
            void o.save({ defaultOutput: path })
          }}
          onSave={({ name, saveTo }) => {
            // Saved again under its name, a preset stays where it was in the right-click menu.
            const kept = presets.find((p) => p.name === name)?.quickAction
            const preset: Preset = { name, steps, saveTo, ...(kept ? { quickAction: kept } : {}) }
            const next = [...presets.filter((p) => p.name !== name), preset]
            o.setPrefs((p) => ({ ...p, presets: next }))
            void o.save({ presets: next })
            setSaved({ name, changed: false })
            setOpen(null)
          }}
        />
      )
    }
  }

  return { done, links, key, open, screen, reset, seed }
}
