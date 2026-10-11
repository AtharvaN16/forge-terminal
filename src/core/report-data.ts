import { resolve } from 'node:path'
import type { FormatCapability } from './capabilities.js'
import { describeResult } from './describe.js'
import type { ErrorCode, ForgeError } from './errors.js'
import type { ProbeReport } from './probe-report.js'
import type { Job, Result, Warning } from './types.js'

/**
 * The machine-readable contract (spec §3.2). Every document carries `forge`
 * (the version, so a consumer can detect changes), `ok`, and `failures`. A
 * field is never renamed or removed in a minor version.
 *
 * These are built from the same `Result` objects the text reporter reads (via
 * `describeResult`), so text and JSON cannot drift. They are type aliases
 * rather than interfaces because the MCP SDK types `structuredContent` as an
 * index-signature record.
 *
 * Only `node:path` and `describe.js` are value imports, so `src/index.ts` can
 * use this on its argument-error path without loading any engine.
 */
export type WarningJson = { code: Warning['code']; message: string }

export type ResultJson = {
  op: Job['op']
  /** The first source. Equal to `sources[0]`; kept because most jobs have exactly one. */
  source: string
  sources: string[]
  /** Every file written, absolute. Twenty entries for a twenty-page render. */
  outputs: string[]
  inputBytes: number
  outputBytes: number
  warnings: WarningJson[]
}

export type FailureJson = {
  /** Absent when the failure is the command's own, not a file's. */
  path?: string
  code: ErrorCode
  title: string
  detail: string
  hint?: string
}

export type RunJson = { forge: string; ok: boolean; results: ResultJson[]; failures: FailureJson[] }

export type FormatsJson = {
  forge: string
  ok: boolean
  formats: FormatCapability[]
  failures: FailureJson[]
}

export type ProbeJson = {
  forge: string
  ok: boolean
  probes: ProbeReport[]
  failures: FailureJson[]
}

export type ExtensionJson = {
  id: string
  title: string
  summary: string
  /** The version this Forge ships in its catalogue. */
  version: string
  licence: string
  /** The installed version, or null. */
  installed: string | null
  updateAvailable: boolean
  supported: boolean
  reason?: string
  downloadBytes?: number
}

export type ExtensionsJson = {
  forge: string
  ok: boolean
  extensions: ExtensionJson[]
  /** What `add` or `remove` just did, when it did something. */
  changed?: { id: string; action: 'added' | 'removed' | 'unchanged' }
  failures: FailureJson[]
}

export type ConfigJson = {
  forge: string
  ok: boolean
  config: Record<string, string | number | null>
  warnings: WarningJson[]
  failures: FailureJson[]
}

/** A failure as `execute` and `runPlan` carry one. Empty or absent `path`: the command's own. */
export interface FailureLike {
  path?: string
  error: ForgeError
}

export function resultJson(result: Result): ResultJson {
  const view = describeResult(result)
  const sources = view.sources.map((s) => resolve(s.path))
  return {
    op: result.job.op,
    source: sources[0] ?? '',
    sources,
    outputs: view.outputs.map((o) => resolve(o)),
    inputBytes: view.sources.reduce((n, s) => n + s.bytes, 0),
    outputBytes: view.outputBytes,
    warnings: view.warnings.map((w) => ({ code: w.code, message: w.message })),
  }
}

export function failureJson(failure: FailureLike): FailureJson {
  const { error } = failure
  return {
    ...(failure.path ? { path: resolve(failure.path) } : {}),
    code: error.code,
    title: error.title,
    detail: error.detail,
    ...(error.hint === undefined ? {} : { hint: error.hint }),
  }
}

export function runJson(
  forge: string,
  data: { results: Result[]; failures: FailureLike[] },
): RunJson {
  return {
    forge,
    ok: data.failures.length === 0,
    results: data.results.map(resultJson),
    failures: data.failures.map(failureJson),
  }
}

/** A command that failed before any file was touched — an argument error, say. */
export function errorJson(forge: string, error: ForgeError): RunJson {
  return runJson(forge, { results: [], failures: [{ error }] })
}

export function formatsJson(forge: string, formats: FormatCapability[]): FormatsJson {
  return { forge, ok: true, formats, failures: [] }
}

export function probeJson(
  forge: string,
  data: { probes: ProbeReport[]; failures: FailureLike[] },
): ProbeJson {
  return {
    forge,
    ok: data.failures.length === 0,
    probes: data.probes,
    failures: data.failures.map(failureJson),
  }
}

export function configJson(
  forge: string,
  config: Record<string, string | number | null>,
  warnings: Warning[],
): ConfigJson {
  return {
    forge,
    ok: true,
    config,
    warnings: warnings.map((w) => ({ code: w.code, message: w.message })),
    failures: [],
  }
}

export function extensionsJson(
  forge: string,
  data: { extensions: ExtensionJson[]; changed?: ExtensionsJson['changed'] },
): ExtensionsJson {
  return {
    forge,
    ok: true,
    extensions: data.extensions,
    ...(data.changed ? { changed: data.changed } : {}),
    failures: [],
  }
}
