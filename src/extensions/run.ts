import { spawn } from 'node:child_process'
import { boostTooLarge, conversionFailed, type ForgeError, noSubject } from '../core/errors.js'

/** Structural subset of `Installed` (paths.ts) — all the runner needs. */
export interface RunnableExtension {
  entry: string
  kind: 'node' | 'exec'
}

export interface ExtensionJobResult {
  width: number
  height: number
  ms: number
}

type RunOpts = { signal?: AbortSignal }

/** Jobs run one at a time per process — both extensions are heavy. */
let tail: Promise<unknown> = Promise.resolve()

export function runExtension(
  ext: RunnableExtension,
  args: string[],
  opts: RunOpts = {},
): Promise<ExtensionJobResult> {
  const job = tail.then(() => runOne(ext, args, opts))
  tail = job.catch(() => undefined)
  return job
}

/** The path the failing job concerned, for error wording: the value after `--in`, else the first argument. */
function subjectPath(args: string[]): string {
  const i = args.indexOf('--in')
  return (i >= 0 ? args[i + 1] : args[0]) ?? ''
}

function maxScaleOf(args: string[]): number {
  const i = args.indexOf('--scale')
  const n = i >= 0 ? Number(args[i + 1]) : 0
  return Number.isFinite(n) ? n : 0
}

function mapFailure(code: string, message: string, args: string[]): ForgeError {
  if (code === 'no-subject') return noSubject(subjectPath(args))
  if (code === 'boost-too-large') return boostTooLarge(subjectPath(args), maxScaleOf(args))
  return conversionFailed(subjectPath(args), new Error(message))
}

function runOne(
  ext: RunnableExtension,
  args: string[],
  opts: RunOpts,
): Promise<ExtensionJobResult> {
  const { signal } = opts
  const path = subjectPath(args)
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('aborted'))

  return new Promise((resolve, reject) => {
    const [cmd, argv] =
      ext.kind === 'node' ? [process.execPath, [ext.entry, ...args]] : [ext.entry, args]
    const child = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      fn()
    }
    const onAbort = () => {
      child.kill('SIGKILL')
      done(() => reject(signal?.reason ?? new Error('aborted')))
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.setEncoding('utf8').on('data', (d: string) => {
      out += d
    })
    child.stderr.setEncoding('utf8').on('data', (d: string) => {
      err += d
    })
    child.on('error', (e) => done(() => reject(conversionFailed(path, e))))
    child.on('close', (status) =>
      done(() => {
        const line = out.split('\n').find((l) => l.trim().startsWith('{'))
        let parsed: unknown
        try {
          parsed = line ? JSON.parse(line) : undefined
        } catch {
          parsed = undefined
        }
        const r = parsed as
          | {
              ok?: boolean
              width?: number
              height?: number
              ms?: number
              code?: string
              message?: string
            }
          | undefined
        if (r && r.ok === true && status === 0) {
          return resolve({ width: Number(r.width), height: Number(r.height), ms: Number(r.ms) })
        }
        if (r && r.ok === false) {
          return reject(mapFailure(String(r.code ?? ''), String(r.message ?? ''), args))
        }
        reject(
          conversionFailed(
            path,
            new Error(
              `extension exited ${status} without a result: ${(err || out).trim().slice(-500)}`,
            ),
          ),
        )
      }),
    )
  })
}
