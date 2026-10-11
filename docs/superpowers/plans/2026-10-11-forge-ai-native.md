# Forge AI-native Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Forge something an AI agent can drive: it never blocks without a terminal, every command can answer in one JSON document, `forge probe` says what a file can become, exit codes follow one rule, and `forge mcp` serves the same operations as a local MCP server over stdio.

**Architecture:** The machine-readable shapes are plain data built in `core/` (`src/core/report-data.ts`, `src/core/probe-report.ts`), so the CLI's `--json` and the MCP server emit the same documents. `src/cli/execute.ts` is split into `runIntent()`, which returns a `RunReport` (data), and rendering (text or JSON). The MCP server in `src/mcp/` is a third front end beside `src/cli/` and `src/shell/`. It builds the same intents the CLI builds and calls `runIntent()` in-process, so there is no second copy of the planning logic. `forge mcp` imports it dynamically, so no other command loads the MCP SDK.

**Tech Stack:** TypeScript 7 (NodeNext, strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), commander 15, vitest 4, Biome 2. New: `@modelcontextprotocol/server` 2.3.1 and `zod` 4 (runtime); `@modelcontextprotocol/client` 2.3.1 (tests only).

**Spec:** `docs/superpowers/specs/2026-10-11-forge-ai-native-design.md`. Read it together with `CLAUDE.md`, whose invariants are binding.

**Baseline this plan assumes:**

- **Lean-and-fast Task 1 (§4.2 of `docs/superpowers/specs/2026-10-11-forge-lean-and-fast-design.md`) has landed.** `src/index.ts` parses with `src/cli/args.ts` first, answers `--help`/`--version` without importing anything else, and loads `src/cli/execute.ts` with `await import('./cli/execute.js')` only when there is work to do. Engines load their heavy libraries lazily. Every edit to `src/index.ts` below is anchored on statements that exist both before and after that change: the `parseArgs(argv)` call, the `intent.kind === 'shell'` branch, the `execute(intent, {...})` call, the `isForgeError(e)` catch, and the closing `await main()`. Keep lean-and-fast's lazy import and its `module.enableCompileCache` line exactly as they are. Do not restructure `index.ts` again.
- If lean-and-fast **§4.6** (`--to … --max-size`) has landed, its convert-path code in `execute.ts` moves into `runConvert` in Task 5 unchanged.
- If lean-and-fast **§4.5** (single esbuild bundle) has landed, apply its dependency rule to the MCP packages: anything bundled goes to `devDependencies`, and the MCP server becomes a lazy chunk. If it has not landed, add them to `dependencies` as Task 7 says.
- **`src/shell/` is not touched.** It is being redesigned in parallel. There are three unavoidable contacts, none of which edits a file under `src/shell/`:
  1. `ErrorCode` gains `'unsupported-operation'` and `Warning['code']` gains `'config-unreadable'`. The shell compiles against both unions but has no exhaustive switch over either (checked: `grep -rn "code ===" src/shell` matches only `not-a-file`, `output-exists` and `output-is-input`).
  2. `tests/shell/sticky-context.test.tsx:77` asserts the stale string `'cannot compress a PDF yet'`. Task 3 changes that one assertion.
  3. `VERSION` is imported read-only from `src/shell/theme.ts`, which has no imports of its own. `src/index.ts` already re-exports it from there.

## Global Constraints

- **Invariant 1:** `core/` and `engines/` write nothing to stdout and import no React/Ink/Chalk. `report-data.ts` and `probe-report.ts` return data only. While `forge mcp` runs, stdout belongs to the protocol (spec §3.5).
- **Invariant 2:** no hardcoded format list. Probe `targets` come from `targetIdsFor()`, `actions` from `actionsFor()`, the formats matrix from `readableFormats()`/`writableFormats()`, and the MCP `to` enum from `writableFormats()`. MCP page-op, rotate and split vocabularies come from `core/actions/` (`ACTIONS`, `rotateAction.options`, `splitAction.options`).
- **Invariant 3:** probe reports the format detected from content (`engines/registry.ts` `probe`).
- **Invariant 6:** every write still goes through `runPlan` → write safety → atomic writer. MCP never overwrites unless the call passes `overwrite: true`.
- **Invariant 7:** no invented progress. MCP reports completion only. Under `--json` the stderr progress lines and spinner stay off.
- **Invariant 8 (password):** never from argv, never echoed. The MCP `password` argument is never returned or logged.
- When stdin is not a TTY, Forge never prompts (spec §3.1). `--password-stdin` reads **one line**, not until EOF.
- `--json`: stdout carries **exactly one** JSON document (a single line, `JSON.stringify`) and nothing else. It contains no colour and no glyphs. Paths are always absolute, and every output is listed. The document has a `forge` field set to `VERSION` from `src/shell/theme.ts`. No field is renamed or removed in a minor version.
- Exit codes (spec §3.4): `0` every input succeeded; `1` the command was understood and at least one input failed or was refused; `2` the command itself was invalid. The rule: if the same flags could succeed on a different file, the code is 1; otherwise it is 2. In code this is `exitCodeFor(failures)`: 2 if any failure's code is `invalid-arguments`, else 1 if there are any failures, else 0.
- MCP dependency is `@modelcontextprotocol/server` (the v2 line), **not** `@modelcontextprotocol/sdk`. The server module is imported only by `forge mcp`.
- MCP tools are exactly `forge_probe`, `forge_formats`, `forge_convert`, `forge_compress`, `forge_pdf`. They take absolute paths and never return base64.
- Gate per task: `npx vitest run <files>` while working. Before committing: `npx biome check --write src tests` (it orders imports), then `npm test && npm run typecheck && npm run lint`.
- Work on `dev` (or a worktree branched from it). One commit per task, conventional style (`feat(cli): …`, `fix(cli): …`, `feat(mcp): …`, `docs: …`), with the message ending in:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## MCP SDK facts (verified 2026-10-11, against `/tmp/ai-native-plan/node_modules`)

Do not re-derive these. They were checked by installing and running the packages.

- `@modelcontextprotocol/server@2.3.1` is `latest`; the published versions run 2.0.0 → 2.3.1. Its dependencies are `zod ^4.2.0` and `@modelcontextprotocol/core 2.3.1`. On disk: server 6.4 MB, core 1.3 MB, zod 8.0 MB, unbundled. Importing server, its stdio entry and zod takes about 50 ms, paid only by `forge mcp`.
- `@modelcontextprotocol/client@2.3.1` exists. It pulls in jose, cross-spawn, eventsource and pkce-challenge, which is why it is a **devDependency** used only by tests.
- Exports used here:
  - from `@modelcontextprotocol/server`: `McpServer`, `InMemoryTransport` (`InMemoryTransport.createLinkedPair(): [InMemoryTransport, InMemoryTransport]`) and `type CallToolResult`.
  - from `@modelcontextprotocol/server/stdio`: `StdioServerTransport` (constructor `(stdin?: Readable, stdout?: Writable, options?)`) and `serveStdio`.
  - from `@modelcontextprotocol/client`: `Client`, plus `getNegotiatedProtocolVersion()`.
  - from `@modelcontextprotocol/client/stdio`: `StdioClientTransport`.
- `new McpServer({ name, version }, { instructions })`.
- `server.registerTool(name, { title?, description?, inputSchema?: z.object(...), outputSchema?: z.object(...), annotations? }, async (args, ctx) => CallToolResult)`. Pass a zod **object** schema. The raw-shape form is deprecated. The handler's `args` are typed from `inputSchema`. This was typechecked with this repo's `tsc` (TypeScript 7) under the repo's compiler options.
- Input validation failures, including `.refine()` failures, come back as a **tool result** with `isError: true` and text `Input validation error: …`. They are not JSON-RPC errors. An unknown tool name is a JSON-RPC error (`ProtocolError`, code -32602). If a handler throws, that also becomes `isError: true` with the message as text.
- `outputSchema` is checked against `structuredContent` only when `isError` is not set. Error results keep their `structuredContent`. In `tools/list` an output schema built with `z.object` advertises `additionalProperties: false`.
- `structuredContent` is typed `{ [k: string]: unknown }`. That is why the JSON document types in `report-data.ts` are `type` aliases rather than `interface`s, and why they are passed as `{ ...doc }`.
- `resource_link` content: `{ type: 'resource_link', uri, name, mimeType? }` round-trips intact.
- `StdioServerTransport` closes itself when stdin reaches EOF. A server that holds no other handles then exits on its own (measured at 0.17 s).
- Passing a wrapper `Writable` as the transport's stdout and pointing `process.stdout.write` at stderr sends a stray `console.log` to stderr, while protocol frames still reach the real stdout. Verified end-to-end.
- **Protocol revision (the spec's open question):** the SDK reports `LATEST_PROTOCOL_VERSION = '2025-11-25'` and `SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25','2025-06-18','2025-03-26','2024-11-05','2024-10-07']`. It also has a separate "2026-07-28 era" (per-request envelope, `server/discover`), which only `serveStdio()` / the HTTP entry will serve. `StdioServerTransport` + `McpServer.connect` is a 2025-era server. It echoes the client's `initialize.protocolVersion` if that version is supported, and otherwise answers `2025-11-25`. A raw `initialize` asking for `2026-07-28` was answered with `2025-11-25`. **Claude Code 2.1.292**, the version installed here, opens stdio servers with `initialize` at `protocolVersion: "2025-11-25"` (found in its binary). The SDK's own client negotiated `2025-11-25`. So Forge negotiates **2025-11-25** with current Claude Code. Claude Desktop is not installed on this machine, so its revision is unverified. That check stays in Task 9's by-hand release step. Decision: use `StdioServerTransport`, not `serveStdio`.

## Review Focus

1. **A password piped with no trailing newline** (`echo -n hunter2 | forge locked.pdf --to png --password-stdin`, the form the README itself shows). The one-line reader must return `hunter2` when the stream ends, not `''`. Pinned in Task 1 (`stdin.test.ts` and `agent-conditions.test.ts`).
2. **Paths with spaces and non-ASCII characters** (`my photo é.jpg`). JSON must carry the raw absolute path, and the MCP `resource_link` must carry a correctly percent-encoded `file://` URI (`pathToFileURL`, never string concatenation). Pinned in Task 5 (`json.test.ts`) and Task 7 (`server.test.ts`).
3. **A partly refused batch under `--json`** (one output already exists). Expect exit 1, `ok: false`, the converted file in `results`, and the refused one in `failures` with its absolute source path. Nothing may go to stderr. Pinned in Task 5.
4. **An encrypted PDF sent to `forge_convert` without a password.** The MCP server's stdin *is* the protocol stream. Forge must refuse with `encrypted-source` and must never read, or try to prompt on, `process.stdin`. Pinned in Task 7.
5. **A literal filename containing glob characters** (`Scan [2024].pdf`), and a glob that matches nothing. Today `resolveInputs` treats any `[ ] { } * ?` as a glob: the literal file matches nothing and the run reports success having done nothing. An agent reads `ok: true`. The file must be read as itself, and an empty glob must be a `file-not-found` failure. Pinned in Task 4 (`probe-report.test.ts` and `resolve.test.ts`).

## Parallelism

```
Wave 1 (4 worktrees, concurrent):  T1 never-block   T2 exit codes   T3 honest text   T4 core data shapes
                                        \               |               |               /
Wave 2:                                  ───────────────────── T5 --json ──────────────
                                                              /            \
Wave 3 (2 worktrees, concurrent):              T6 forge probe        T7 MCP tools (in-process)
                                                      |                       |
                                                      |                T8 forge mcp over stdio
                                                       \                     /
Wave 4:                                                  ─── T9 agent docs ──
```

- **T1, T2, T3, T4 run concurrently**, each in its own `git worktree` branched from `dev`. They share three files, but every task edits different hunks, chosen so git merges them cleanly:
  - `src/core/errors.ts`: T1 edits `encryptedSource` (lines ~320-333). T2 adds `'unsupported-operation'` right after `'unsupported-pdf'` in the `ErrorCode` union and inserts `unsupportedOperation()` directly after `unsupportedPdf()`. T3 edits `unsupportedCompress` (~179-219) and adds one `export type` line directly after the `ErrorCode` union's closing line.
  - `src/cli/execute.ts`: T1 edits only the password block of `buildRasterJob`. T2 edits only the `pageop` branch, renames `execute` to `executeIntent`, and adds a new `execute` wrapper plus `exitCodeFor`. T3 edits only the two `reportBatch(outcome, intent.output)` calls.
  - `README.md`: T1 edits the Encrypted PDFs section. T3 edits "Not yet", the two batch examples, and the Roadmap bullet.
  - Test files: T2's tests go in new files and `tests/cli/config-command.test.ts`. T3 appends to `tests/core/errors.test.ts`. T1 does not touch `errors.test.ts`.
  - Merge order into `dev`: **T4, T3, T1, T2**. Run the full gate after each merge.
- **T5 depends on T1, T2, T3, T4.** It rewrites `execute.ts` around `runIntent` and wires `--json` into `args.ts`, `config-command.ts`, `fatal.ts` and `index.ts`.
- **T6 and T7 run concurrently after T5**, in separate worktrees. T6 edits `args.ts` (the `probe` subcommand and the `Intent` union), `report.ts`, and the dispatch block of `execute()`. T7 edits the `ConvertIntent` interface in `args.ts` and `buildRasterJob`/`ExecuteOptions` in `execute.ts`, and adds `src/mcp/*` and `package.json`. The hunks are disjoint. Merge T6 first.
- **T8 depends on T7** (`createForgeServer`) and edits `src/index.ts`, which nothing else in wave 3 touches. It may overlap with T6.
- **T9 depends on everything.** It documents what shipped (spec §6.4).

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `src/cli/stdin.ts` | modify (T1) | `readPassword` → one line from stdin, or `undefined` off a TTY; never prompts without a terminal |
| `src/cli/fatal.ts` | create (T1), modify (T5) | `fatalLines`, `asForgeError`, `guardUnsettled`: no path ends in Node's exit 13 or a raw stack |
| `src/core/errors.ts` | modify (T1, T2, T3) | `encryptedSource(path, { attempted })`, `unsupportedOperation`, `'unsupported-operation'` code, corrected PDF compress wording, `WarningCode` re-export |
| `src/core/types.ts` | modify (T3) | `WarningCode` union (`'config-unreadable'` added); `Warning.code: WarningCode` |
| `src/cli/report.ts` | modify (T3, T6) | `reportBatch` lists every output; `reportProbe` text |
| `src/core/resolve.ts` | modify (T4) | a literal path is read literally even with glob characters; an empty glob is a failure |
| `src/core/capabilities.ts` | modify (T4) | `FormatCapability`, `formatMatrix()`: the capability matrix as data |
| `src/core/report-data.ts` | create (T4) | JSON document types and builders (`runJson`, `errorJson`, `formatsJson`, `probeJson`, `configJson`, `resultJson`, `failureJson`) |
| `src/core/probe-report.ts` | create (T4) | `ProbeReport`, `describeSource`, `probeFiles` |
| `src/cli/execute.ts` | modify (T1, T2, T3, T5, T6, T7) | `exitCodeFor`; `runIntent` → `RunReport`; `renderRun`; `execute` renders text or JSON; probe dispatch; MCP password / non-interactive |
| `src/cli/args.ts` | modify (T2, T5, T6, T7, T9) | `EXIT_CODES_HELP`, `--json`, `wantsJson`, commander errors → `invalid-arguments`, `ProbeIntent`, `ConvertIntent.password`, `COMMANDS_HELP` |
| `src/cli/config-command.ts` | modify (T2, T5) | refusals become thrown `invalid-arguments` (stderr, exit 2); results also returned as data |
| `src/index.ts` | modify (T1, T5, T8) | fatal guard; JSON-aware error printing; `forge mcp` dispatch |
| `src/mcp/schemas.ts` | create (T7) | zod input/output schemas; vocabularies from `core/actions` and `capabilities` |
| `src/mcp/tools.ts` | create (T7) | the five tool handlers: build an intent, call `runIntent`/`probeFiles`, shape `CallToolResult` |
| `src/mcp/server.ts` | create (T7), modify (T8) | `createForgeServer()`, `INSTRUCTIONS`, `runMcpServer()` |
| `src/mcp/stdout-guard.ts` | create (T8) | `claimStdout()`: protocol keeps real stdout, stray writes go to stderr |
| `skills/forge/SKILL.md` | create (T9) | the Agent Skill |
| `README.md` | modify (T1, T3, T9) | corrected text; "Use with AI agents"; JSON schema; exit-code table; probe |
| `package.json` | modify (T7) | `@modelcontextprotocol/server`, `zod`; dev `@modelcontextprotocol/client` |
| `tests/helpers/run-forge.ts` | create (T1) | spawn the CLI with stdin closed / open / fed, with a timeout |
| `tests/helpers/unsettled-child.ts` | create (T1) | child process that awaits forever under `guardUnsettled` |
| `tests/cli/agent-conditions.test.ts` | create (T1) | spec §5 "agent conditions as tests" |
| `tests/cli/fatal.test.ts` | create (T1) | |
| `tests/cli/exit-codes.test.ts` | create (T2) | the table-driven §3.4 test |
| `tests/core/report-data.test.ts`, `tests/core/probe-report.test.ts` | create (T4) | |
| `tests/cli/json.test.ts`, `tests/cli/json-spawn.test.ts` | create (T5) | |
| `tests/cli/probe.test.ts` | create (T6) | |
| `tests/mcp/server.test.ts`, `tests/mcp/schemas.test.ts` | create (T7) | in-process client over `InMemoryTransport` |
| `tests/mcp/stdio.test.ts`, `tests/mcp/stdout-guard.test.ts` | create (T8) | real stdio process; stdout hygiene; exit on EOF |
| `tests/docs/skill.test.ts` | create (T9) | skill frontmatter |

---

### Task 1: Never block without a terminal

Spec §3.1. Fixes the exit-13 crash and the open-pipe hang on an encrypted PDF.

**Files:**
- Modify: `src/cli/stdin.ts` (the whole file)
- Modify: `src/cli/execute.ts:141-169` (the `if (source.encrypted)` block in `buildRasterJob`)
- Modify: `src/core/errors.ts:320-333` (`encryptedSource`)
- Create: `src/cli/fatal.ts`
- Modify: `src/index.ts` (the closing `await main()`)
- Create: `tests/helpers/run-forge.ts`, `tests/helpers/unsettled-child.ts`, `tests/cli/agent-conditions.test.ts`, `tests/cli/fatal.test.ts`
- Modify: `tests/cli/stdin.test.ts`
- Modify: `README.md` (§ Encrypted PDFs)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `readPassword(opts: { stdin: boolean }): Promise<string | undefined>` in `src/cli/stdin.ts`. `undefined` means "no way to ask".
  - `encryptedSource(path: string, opts?: { attempted?: boolean }): ForgeError` in `src/core/errors.ts`. `attempted: true` swaps the hint for "That password didn't open it. Check it and try again."
  - `fatalLines(e: unknown, debug: boolean): string[]`, `asForgeError(e: unknown): ForgeError` and `guardUnsettled(isSettled: () => boolean, report: (error: unknown) => void): void` in `src/cli/fatal.ts`.
  - Test helper `runForge(args: string[], opts?: { stdin?: StdinMode; cwd?: string; timeoutMs?: number }): Promise<ForgeRun>`, where `StdinMode = { kind: 'closed' } | { kind: 'open' } | { kind: 'open-after'; text: string } | { kind: 'text'; text: string }` and `ForgeRun = { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }`.

- [ ] **Step 1: Write the spawn helper**

Create `tests/helpers/run-forge.ts`:

```ts
import { spawn } from 'node:child_process'
import { join } from 'node:path'

/**
 * How the child's stdin looks — the conditions an agent harness actually
 * produces (spec §5). `closed` is `< /dev/null`; `open` is a pipe nobody
 * writes to or closes; `open-after` writes once and never closes; `text`
 * writes and closes.
 */
export type StdinMode =
  | { kind: 'closed' }
  | { kind: 'open' }
  | { kind: 'open-after'; text: string }
  | { kind: 'text'; text: string }

export interface ForgeRun {
  /** null when the process was killed for overrunning the timeout. */
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

const tsx = join(process.cwd(), 'node_modules', '.bin', 'tsx')
const entry = join(process.cwd(), 'src', 'index.ts')

/** Runs the real CLI entry from source, as an agent would, with a hard timeout. */
export function runForge(
  args: string[],
  opts: { stdin?: StdinMode; cwd?: string; timeoutMs?: number } = {},
): Promise<ForgeRun> {
  const stdin = opts.stdin ?? { kind: 'closed' }
  return new Promise((resolve) => {
    const child = spawn(tsx, [entry, ...args], {
      cwd: opts.cwd,
      stdio: [stdin.kind === 'closed' ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    // `stdio` is computed, so TypeScript types these as possibly null.
    child.stdout?.setEncoding('utf8').on('data', (d: string) => {
      stdout += d
    })
    child.stderr?.setEncoding('utf8').on('data', (d: string) => {
      stderr += d
    })
    if (stdin.kind === 'open-after') child.stdin?.write(stdin.text)
    if (stdin.kind === 'text') child.stdin?.end(stdin.text)

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, opts.timeoutMs ?? 15_000)

    child.on('close', (code) => {
      clearTimeout(timer)
      child.stdin?.destroy()
      resolve({ exitCode: code, stdout, stderr, timedOut })
    })
  })
}
```

- [ ] **Step 2: Write the failing agent-conditions test**

Create `tests/cli/agent-conditions.test.ts`:

```ts
import { existsSync } from 'node:fs'
import { cp, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'
import { runForge, type StdinMode } from '../helpers/run-forge.js'

const LOCKED = fileURLToPath(new URL('../fixtures/locked-hunter2.pdf', import.meta.url))

async function lockedCopy(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'forge-agent-'))
  const path = join(dir, 'locked.pdf')
  await cp(LOCKED, path)
  return path
}

const NO_TTY: StdinMode[] = [{ kind: 'closed' }, { kind: 'open' }]

describe('an encrypted PDF with no terminal (spec §3.1)', () => {
  for (const stdin of NO_TTY) {
    it(`fails at once with stdin ${stdin.kind}, naming --password-stdin`, async () => {
      const path = await lockedCopy()
      const run = await runForge([path, '--to', 'jpeg'], { stdin })
      expect(run.timedOut).toBe(false)
      expect(run.exitCode).toBe(1)
      expect(run.stderr).toContain('password-protected')
      expect(run.stderr).toContain('--password-stdin')
      expect(run.stderr).not.toContain('Password:')
      expect(run.stdout).toBe('')
    })
  }

  it('reads one line from a pipe that stays open, instead of waiting for EOF', async () => {
    const path = await lockedCopy()
    const run = await runForge([path, '--to', 'jpeg', '--password-stdin'], {
      stdin: { kind: 'open-after', text: 'hunter2\n' },
    })
    expect(run.timedOut).toBe(false)
    expect(run.exitCode).toBe(0)
    expect(existsSync(join(path, '..', 'locked-1.jpg'))).toBe(true)
  })

  it('accepts a password sent without a trailing newline, as echo -n sends it', async () => {
    const path = await lockedCopy()
    const run = await runForge([path, '--to', 'png', '--password-stdin'], {
      stdin: { kind: 'text', text: 'hunter2' },
    })
    expect(run.exitCode).toBe(0)
    expect(existsSync(join(path, '..', 'locked-1.png'))).toBe(true)
  })

  it('says a wrong password did not open it, without suggesting the flag just used', async () => {
    const path = await lockedCopy()
    const run = await runForge([path, '--to', 'jpeg', '--password-stdin'], {
      stdin: { kind: 'text', text: 'not-the-password\n' },
    })
    expect(run.exitCode).toBe(1)
    expect(run.stderr).toContain("didn't open it")
    expect(run.stderr).not.toContain('--password-stdin')
    expect(run.stderr).not.toContain('not-the-password')
  })
})

describe('ordinary commands with no terminal', () => {
  for (const stdin of NO_TTY) {
    it(`converts and exits with stdin ${stdin.kind}`, async () => {
      const dir = await makeTempDir()
      const jpg = await makeJpeg(dir, 'a.jpg')
      const run = await runForge([jpg, '--to', 'webp'], { stdin })
      expect(run.timedOut).toBe(false)
      expect(run.exitCode).toBe(0)
      expect(existsSync(join(dir, 'a.webp'))).toBe(true)
    })

    it(`lists formats and exits with stdin ${stdin.kind}`, async () => {
      const run = await runForge(['--formats'], { stdin })
      expect(run.timedOut).toBe(false)
      expect(run.exitCode).toBe(0)
    })

    it(`exits 2 on a bad flag with stdin ${stdin.kind}`, async () => {
      const run = await runForge(['--bogus'], { stdin })
      expect(run.timedOut).toBe(false)
      expect(run.exitCode).toBe(2)
    })
  }
})
```

- [ ] **Step 3: Update `tests/cli/stdin.test.ts` for the new contract**

In the `stdin mode` describe, replace the test `'does not strip internal newlines, only trailing'` with these three:

```ts
    it('reads only the first line, so a pipe that stays open is never waited on', async () => {
      const stream = Readable.from(['line1\nline2\n'])
      Object.defineProperty(process, 'stdin', { value: stream, configurable: true })
      expect(await readPassword({ stdin: true })).toBe('line1')
    })

    it('keeps a password sent without a trailing newline (echo -n)', async () => {
      const stream = Readable.from(['hunter2'])
      Object.defineProperty(process, 'stdin', { value: stream, configurable: true })
      expect(await readPassword({ stdin: true })).toBe('hunter2')
    })

    it('returns as soon as a line arrives on a stream that never ends', async () => {
      const stream = new PassThrough()
      Object.defineProperty(process, 'stdin', { value: stream, configurable: true })
      const pending = readPassword({ stdin: true })
      stream.write('hunter2\n')
      expect(await pending).toBe('hunter2')
    })
```

In the `prompt mode` describe, the three existing tests must now present a TTY, because prompting off a TTY is exactly what is being removed. Add this helper at the top of the file, under the imports:

```ts
/** A stdin that claims to be a terminal — the only kind Forge may prompt on. */
function tty<T extends object>(stream: T): T & { isTTY: true } {
  return Object.assign(stream, { isTTY: true as const })
}
```

and wrap each `inputStream` in those three tests: `const inputStream = tty(Readable.from(['mypassword\n']))`, `const inputStream = tty(Readable.from(['secret123\n']))`, `const inputStream = tty(new PassThrough())`.

Then add a new describe at the end of the outer `describe('readPassword', …)`:

```ts
  describe('without a terminal', () => {
    it('never prompts and never reads stdin — it returns undefined', async () => {
      const explosive = new Readable({
        read() {
          this.destroy(new Error('stdin was read with no terminal and no --password-stdin'))
        },
      })
      const stderrWrites: string[] = []
      const mockStderr = new PassThrough()
      mockStderr.on('data', (chunk) => stderrWrites.push(chunk.toString('utf8')))
      Object.defineProperty(process, 'stdin', { value: explosive, configurable: true })
      Object.defineProperty(process, 'stderr', { value: mockStderr, configurable: true })

      expect(await readPassword({ stdin: false })).toBeUndefined()
      expect(stderrWrites.join('')).toBe('')
    })
  })
```

- [ ] **Step 4: Write the failing fatal-guard test and its child**

Create `tests/helpers/unsettled-child.ts`:

```ts
/**
 * Awaits something that can never settle, under guardUnsettled — the shape
 * of the old encrypted-PDF crash, where Node exited 13 ("unsettled top-level
 * await") with no Forge error at all.
 */
import { fatalLines, guardUnsettled } from '../../src/cli/fatal.js'

let settled = false
guardUnsettled(
  () => settled,
  (e) => process.stderr.write(`${fatalLines(e, false).join('\n')}\n`),
)
await new Promise<void>(() => {})
settled = true
```

Create `tests/cli/fatal.test.ts`:

```ts
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { asForgeError, fatalLines } from '../../src/cli/fatal.js'
import { fileNotFound } from '../../src/core/errors.js'

const tsx = join(process.cwd(), 'node_modules', '.bin', 'tsx')

function runChild(script: string): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    execFile(tsx, [script], (err, _stdout, stderr) => {
      const code = err ? ((err as { code?: number }).code ?? -1) : 0
      resolve({ code, stderr })
    })
  })
}

describe('guardUnsettled', () => {
  it('turns an await that can never settle into a Forge error and exit 1, not Node exit 13', async () => {
    const { code, stderr } = await runChild(
      join(process.cwd(), 'tests', 'helpers', 'unsettled-child.ts'),
    )
    expect(code).toBe(1)
    expect(stderr).toContain('Something went wrong')
    expect(stderr).not.toContain('unsettled top-level await')
  })
})

describe('fatalLines', () => {
  it('wraps a non-Forge error without a stack trace', () => {
    const text = fatalLines(new Error('boom'), false).join('\n')
    expect(text).toContain('Something went wrong')
    expect(text).toContain('boom')
    expect(text).not.toMatch(/\n\s+at /)
  })

  it('renders a ForgeError as itself', () => {
    expect(fatalLines(fileNotFound('/a/x.jpg'), false)[0]).toBe('✕ File not found')
  })

  it('asForgeError passes a ForgeError through untouched', () => {
    const e = fileNotFound('/a/x.jpg')
    expect(asForgeError(e)).toBe(e)
    expect(asForgeError('oops').code).toBe('unexpected')
  })
})
```

- [ ] **Step 5: Run the new and changed tests to confirm they fail**

Run: `npx vitest run tests/cli/agent-conditions.test.ts tests/cli/stdin.test.ts tests/cli/fatal.test.ts`
Expected: FAIL. `fatal.test.ts` cannot resolve `src/cli/fatal.js`. In `agent-conditions`, the `closed` case exits 13 and the `open` case times out. In `stdin.test.ts`, `reads only the first line` gets `line1\nline2` and `without a terminal` throws "stdin was read…".

- [ ] **Step 6: Rewrite `src/cli/stdin.ts`**

Replace the whole file with:

```ts
import { createInterface } from 'node:readline'
import { PassThrough } from 'node:stream'

/**
 * The first line of `input`, without its line ending, after which the stream
 * is let go.
 *
 * It reads one line rather than reading until EOF. An agent harness often gives
 * Forge a stdin pipe, writes the password to it, and never closes it. Reading
 * to EOF waited on that pipe forever (spec §3.1).
 *
 * If the stream ends before a newline arrives (`echo -n`), readline still emits
 * what was sent as a final line. If it ends with nothing at all, the result is ''.
 *
 * Pausing and unref-ing afterwards is what lets the process exit while the
 * writer still holds the pipe open. readline's close() pauses the stream but
 * leaves its handle keeping the event loop alive. Measured: a run that had
 * already finished waited until the writer closed.
 */
function readFirstLine(input: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input, terminal: false })
    let done = false
    const finish = (line: string) => {
      if (done) return
      done = true
      rl.close()
      input.pause()
      const handle = input as { unref?: () => void }
      handle.unref?.()
      resolve(line.replace(/\r$/, ''))
    }
    rl.once('line', finish)
    rl.once('close', () => finish(''))
  })
}

/**
 * A password, never from argv.
 *
 * An argument lands in shell history and in `ps` output, and PDF passwords
 * are reused often enough that leaking one leaks more than one file. Reading
 * stdin or prompting costs the same keystrokes and avoids both.
 *
 * Returns `undefined` when there is no way to ask: `--password-stdin` was not
 * given and stdin is not a terminal. Forge never prompts without a TTY. A prompt
 * nobody can see hangs forever on an open pipe. On a closed pipe it left Node
 * to exit 13 on an await that could never settle. The caller refuses with
 * `encrypted-source` instead, and that error's hint names --password-stdin.
 */
export async function readPassword(opts: { stdin: boolean }): Promise<string | undefined> {
  if (opts.stdin) return readFirstLine(process.stdin)
  if (!process.stdin.isTTY) return undefined

  // Use a null stream for readline's output to prevent echoing typed characters.
  // readline writes input echo to this stream, which we buffer but do not forward to
  // stderr. We write the prompt manually to stderr instead, and supply the newline
  // after the user presses Enter, since readline's line-submit writes to the buffered
  // output stream that never reaches the terminal.
  const nullOutput = new PassThrough()
  // CRITICAL: terminal:true engages raw mode on real TTYs, disabling OS line discipline
  // echo. Dropping this flag causes the kernel to echo typed characters in plaintext.
  // No test catches this regression — the test suite uses Readable.from() which is
  // never a TTY, so has no kernel echo to suppress. This only breaks on real terminals.
  const rl = createInterface({ input: process.stdin, output: nullOutput, terminal: true })
  try {
    process.stderr.write('Password: ')
    // Use empty string for prompt since we already wrote it; readline would
    // append it to the line but we've handled it separately.
    return await new Promise<string>((resolve) => rl.question('', resolve))
  } finally {
    process.stderr.write('\n')
    // Releases stdin: readline removes its 'keypress' listener and pauses the stream.
    // The finally guarantees it runs whether the promise resolves or rejects.
    // Covered by 'releases stdin when the prompt completes' in tests/cli/stdin.test.ts,
    // which asserts no 'keypress' listener survives. That test must feed stdin from a
    // stream that stays open — Readable.from() ends immediately and readline auto-closes
    // on the input's 'end' event, which would mask this call and make the test hollow.
    rl.close()
  }
}
```

- [ ] **Step 7: Give a wrong password its own hint**

In `src/core/errors.ts`, replace `encryptedSource` (lines 320-333) with:

```ts
export function encryptedSource(path: string, opts: { attempted?: boolean } = {}): ForgeError {
  const name = basename(path)
  return new ForgeError({
    code: 'encrypted-source',
    title: 'This PDF is password-protected',
    detail: `${name} is password-protected.`,
    hint: opts.attempted
      ? // A password was given and it did not open the file. The old hint
        // suggested --password-stdin, the flag that had just been used, which
        // sent people round in a circle (spec §3.1). It deliberately says
        // nothing about the attempt itself (invariant 8).
        "That password didn't open it. Check it and try again."
      : // Forge cannot decrypt-and-write a PDF — the only libraries that can are
        // AGPL, and Forge is MIT (see the phase-4a spec's ruling on this). The
        // shell also has no password field by design (spec §8), so this points
        // at the one front end that reads an encrypted PDF rather than only
        // refusing.
        `Convert it to images instead:  forge ${name} --to jpeg --password-stdin`,
  })
}
```

- [ ] **Step 8: Refuse instead of prompting in `buildRasterJob`**

In `src/cli/execute.ts`, inside `buildRasterJob`, replace the opening of the `if (source.encrypted)` block and its `catch` return with the following. The `doc.destroy()` part and its comment stay as they are.

```ts
  if (source.encrypted) {
    // Never for an unencrypted file — asking would be a prompt nobody
    // expected and, worse, a password nothing is actually locked with.
    password = await readPassword({ stdin: intent.passwordStdin ?? false })
    // No --password-stdin and no terminal to ask on. Refuse now rather than
    // wait for input that cannot come. The hint names --password-stdin,
    // which is exactly what is missing.
    if (password === undefined) {
      return { failure: { path: source.path, error: encryptedSource(source.path) } }
    }
    let doc: Awaited<ReturnType<typeof openPdf>>
    try {
      doc = await openPdf(await readFile(source.path), password)
    } catch {
      // (keep the existing comment block here verbatim)
      return {
        failure: { path: source.path, error: encryptedSource(source.path, { attempted: true }) },
      }
    }
```

- [ ] **Step 9: Create `src/cli/fatal.ts`**

```ts
import { type ForgeError, isForgeError, renderError, unexpectedError } from '../core/errors.js'

/** Any thrown value as a ForgeError, so every front end has something to render. */
export function asForgeError(e: unknown): ForgeError {
  return isForgeError(e) ? e : unexpectedError(e)
}

/** Display lines for an error nothing else caught. Never a stack trace unless `debug`. */
export function fatalLines(e: unknown, debug: boolean): string[] {
  return renderError(asForgeError(e), { debug })
}

/**
 * Catches the one failure a try/catch cannot: `main()` awaiting something
 * that will never settle. In that case Node exits 13 ("unsettled top-level await")
 * and prints no Forge error at all. That is what an agent saw when an encrypted
 * PDF prompted on a closed stdin.
 *
 * `beforeExit` fires exactly when the event loop has run dry. If `main()` is
 * still pending at that moment, nothing can ever resume it, so this reports
 * the failure and sets exit code 1. Measured on Node 26: setting `exitCode`
 * here replaces the 13, and Node's own warning is not printed.
 */
export function guardUnsettled(isSettled: () => boolean, report: (error: unknown) => void): void {
  process.once('beforeExit', () => {
    if (isSettled()) return
    report(new Error('Forge stopped before it finished: it was waiting for input that never came.'))
    process.exitCode = 1
  })
}
```

- [ ] **Step 10: Wrap the entry point**

In `src/index.ts`, add to the imports:

```ts
import { fatalLines, guardUnsettled } from './cli/fatal.js'
```

Replace the final line `await main()` with:

```ts
/**
 * Prints an error that main() did not turn into a Forge answer itself. There is
 * never a raw stack trace (unless --debug), and Node's own exit code never
 * leaks through. Only this file prints.
 */
function reportFatal(e: unknown): void {
  process.stderr.write(`${fatalLines(e, process.argv.includes('--debug')).join('\n')}\n`)
}

let settled = false
guardUnsettled(() => settled, reportFatal)
try {
  await main()
} catch (e) {
  reportFatal(e)
  process.exitCode = 1
} finally {
  settled = true
}
```

The `throw e` at the end of `main()`'s own catch stays. It now lands here instead of in Node.

- [ ] **Step 11: Run the tests to confirm they pass**

Run: `npx vitest run tests/cli/agent-conditions.test.ts tests/cli/stdin.test.ts tests/cli/fatal.test.ts tests/cli/pixels-password.test.ts tests/index.test.ts`
Expected: PASS. `pixels-password` still passes because its wrong-password test asserts only `'password-protected'`, which is in the detail.

- [ ] **Step 12: Correct the README's encrypted-PDF section**

In `README.md`, replace:

```
or leave `--password-stdin` off and Forge prompts on stderr, reading one
line without echoing it back:
```

with:

```
or, at a terminal, leave `--password-stdin` off and Forge prompts on stderr,
reading one line without echoing it back:
```

Replace the paragraph and example that start with `A wrong password gets the same message an unattempted password does` with:

````
A wrong password is told apart from a missing one, and Forge never echoes the
attempt itself:

```
$ echo -n "wrongpass" | forge locked-hunter2.pdf --to png --password-stdin
✕ This PDF is password-protected

  locked-hunter2.pdf is password-protected.

  That password didn't open it. Check it and try again.
```

`--password-stdin` reads one line, so a pipe that stays open after sending
the password does not hold Forge up. Without a terminal (piped, scripted, or
driven by an agent) Forge never prompts: an encrypted PDF without
`--password-stdin` fails at once with exit 1.
````

- [ ] **Step 13: Gate and commit**

Run: `npx biome check --write src tests && npm test && npm run typecheck && npm run lint`
Expected: all green.

```bash
git add src/cli/stdin.ts src/cli/fatal.ts src/cli/execute.ts src/core/errors.ts src/index.ts \
  tests/helpers/run-forge.ts tests/helpers/unsettled-child.ts tests/cli/agent-conditions.test.ts \
  tests/cli/fatal.test.ts tests/cli/stdin.test.ts README.md
git commit -m "$(cat <<'EOF'
fix(cli): never block on a password without a terminal

Off a TTY Forge no longer prompts: an encrypted PDF without
--password-stdin fails at once with exit 1. --password-stdin reads one
line, so an open pipe no longer hangs. A wrong password gets its own
hint, and an await that can never settle becomes a Forge error and exit 1
instead of Node's exit 13.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: One exit-code rule

Spec §3.4. Runtime refusals about *files* move from 2 to 1. `forge config set` errors go to stderr. `--help` prints the table.

**Files:**
- Modify: `src/core/errors.ts`. Add `'unsupported-operation'` to `ErrorCode` directly after `| 'unsupported-pdf'`. Add `unsupportedOperation()` directly after `unsupportedPdf()`.
- Modify: `src/cli/execute.ts`. Add `exitCodeFor` after the `ExecuteOptions` interface. Rewrite the `pageop` branch. Rename `execute` to `executeIntent` and add a new exported `execute` wrapper.
- Modify: `src/cli/config-command.ts` (the error returns in `runConfig`)
- Modify: `src/cli/args.ts`. Add `EXIT_CODES_HELP` and `.addHelpText` after `.version(…)`.
- Create: `tests/cli/exit-codes.test.ts`
- Modify: `tests/cli/config-command.test.ts`, `tests/index.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `exitCodeFor(failures: InputFailure[]): 0 | 1 | 2` exported from `src/cli/execute.ts`
  - `unsupportedOperation(action: string, reason: string): ForgeError` with code `'unsupported-operation'`, in `src/core/errors.ts`
  - `EXIT_CODES_HELP: string` exported from `src/cli/args.ts`
  - `runConfig` now **throws** `invalid-arguments` for a rejected value. It still returns `{ stdout, exitCode: 0 }` on success.
  - `execute()` never throws a `ForgeError`. It turns one into an `ExecuteResult` whose code comes from `exitCodeFor`.

- [ ] **Step 1: Write the failing table-driven test**

Create `tests/cli/exit-codes.test.ts`:

```ts
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { unsupportedOperation } from '../../src/core/errors.js'
import { makeJpeg, makePdf, makePng, makeTempDir } from '../helpers/fixtures.js'

/**
 * What src/index.ts does with an argv. Anything parseArgs throws (other than
 * --help/--version, which never appear here) exits 2. Otherwise execute()
 * decides.
 */
async function exitOf(argv: string[]): Promise<number> {
  let intent: ReturnType<typeof parseArgs>
  try {
    intent = parseArgs(argv)
  } catch {
    return 2
  }
  return (await execute(intent)).exitCode
}

interface Fixtures {
  jpg: string
  png: string
  pdf3: string
  pdf1: string
  ghost: string
}

let dir: string
const savedXdg = process.env.XDG_CONFIG_HOME

beforeEach(async () => {
  dir = await makeTempDir()
  process.env.XDG_CONFIG_HOME = dir
})

afterEach(() => {
  if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = savedXdg
})

async function fixtures(): Promise<Fixtures> {
  return {
    jpg: await makeJpeg(dir, 'a.jpg'),
    png: await makePng(dir, 'b.png'),
    pdf3: await makePdf(dir, 'three.pdf', 3),
    pdf1: await makePdf(dir, 'one.pdf', 1),
    ghost: join(dir, 'ghost.jpg'),
  }
}

const CASES: { name: string; argv: (f: Fixtures) => string[]; code: 0 | 1 | 2 }[] = [
  // 2 — the command itself is invalid, whatever file it names
  { name: 'an unknown flag', argv: (f) => [f.jpg, '--bogus'], code: 2 },
  { name: 'a flag missing its value', argv: (f) => [f.jpg, '--to'], code: 2 },
  { name: 'no target format', argv: (f) => [f.jpg], code: 2 },
  { name: 'a format Forge does not know', argv: (f) => [f.jpg, '--to', 'mp4'], code: 2 },
  {
    name: 'contradictory flags',
    argv: (f) => [f.jpg, '--quality', '40', '--max-size', '1mb'],
    code: 2,
  },
  {
    name: 'two page operations at once',
    argv: (f) => [f.pdf3, '--rotate', '90', '--delete', '2'],
    code: 2,
  },
  { name: 'an invalid config value', argv: () => ['config', 'set', 'theme', 'chartreuse'], code: 2 },
  // 0 — everything worked
  { name: 'a conversion that works', argv: (f) => [f.jpg, '--to', 'webp'], code: 0 },
  // 1 — understood, but these files could not be done; other files could
  { name: 'a missing file', argv: (f) => [f.ghost, '--to', 'webp'], code: 1 },
  { name: 'a target this file cannot become', argv: (f) => [f.jpg, '--to', 'heic'], code: 1 },
  { name: 'compressing a lossless file', argv: (f) => [f.png, '--quality', '50'], code: 1 },
  { name: 'merging something that is not a PDF', argv: (f) => [f.jpg, f.pdf3, '--merge'], code: 1 },
  { name: 'merging a single PDF', argv: (f) => [f.pdf3, '--merge'], code: 1 },
  { name: 'splitting a one-page PDF', argv: (f) => [f.pdf1, '--split', 'every-page'], code: 1 },
  { name: 'a split point past the last page', argv: (f) => [f.pdf3, '--split', 'at=9'], code: 1 },
  { name: 'extracting a page that does not exist', argv: (f) => [f.pdf3, '--extract', '9'], code: 1 },
  {
    name: 'rendering a page that does not exist',
    argv: (f) => [f.pdf3, '--to', 'png', '--pages', '9'],
    code: 1,
  },
]

describe('exit codes (spec §3.4)', () => {
  for (const c of CASES) {
    it(`${c.code} for ${c.name}`, async () => {
      expect(await exitOf(c.argv(await fixtures()))).toBe(c.code)
    })
  }

  it('reports a page operation that does not fit the files on stderr, not by throwing', async () => {
    const f = await fixtures()
    const out = await execute(parseArgs([f.jpg, f.pdf3, '--merge']))
    expect(out.stdout).toEqual([])
    expect(out.stderr.join('\n')).toContain('PDFs only')
  })
})

describe('unsupportedOperation', () => {
  it('has its own code, distinct from invalid-arguments (which always means exit 2)', () => {
    const e = unsupportedOperation('merge', 'PDFs only')
    expect(e.code).toBe('unsupported-operation')
    expect(e.detail).toContain('PDFs only')
    expect(e.hint).toBeTruthy()
  })
})
```

- [ ] **Step 2: Update the config tests to the stderr rule**

In `tests/cli/config-command.test.ts`, add `import { execute } from '../../src/cli/execute.js'` and replace the two tests `'rejects an invalid theme with exit code 2 and leaves config untouched'` and `'rejects an out-of-range quality with exit code 2'` with:

```ts
  it('rejects an invalid theme as a usage error and leaves config untouched', async () => {
    await expect(
      runConfig({ kind: 'config', action: 'set', key: 'theme', value: 'chartreuse' }),
    ).rejects.toMatchObject({ code: 'invalid-arguments', detail: expect.stringContaining('dark') })
    expect((await loadPreferences()).prefs.theme).toBeUndefined()
  })

  it('rejects an out-of-range quality as a usage error', async () => {
    await expect(
      runConfig({ kind: 'config', action: 'set', key: 'quality', value: '500' }),
    ).rejects.toMatchObject({ code: 'invalid-arguments' })
    expect((await loadPreferences()).prefs.quality).toBe(80)
  })

  it('writes a rejected value to stderr with exit 2, nothing to stdout', async () => {
    const out = await execute({ kind: 'config', action: 'set', key: 'theme', value: 'chartreuse' })
    expect(out.exitCode).toBe(2)
    expect(out.stdout).toEqual([])
    expect(out.stderr.join('\n')).toContain('dark or light')
  })
```

- [ ] **Step 3: Add the help test**

In `tests/index.test.ts`, inside `describe('CLI exit codes', …)`, add:

```ts
  it('prints the exit-code contract in --help', async () => {
    const result = await spawn(['--help'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Exit codes:')
    expect(result.stdout).toMatch(/2\s+the command itself was invalid/)
  })
```

- [ ] **Step 4: Run them to confirm they fail**

Run: `npx vitest run tests/cli/exit-codes.test.ts tests/cli/config-command.test.ts tests/index.test.ts`
Expected: FAIL. `unsupportedOperation` is not exported. The four page-op "1" cases get 2 (`exitOf` sees a throw). The config cases resolve instead of rejecting. `--help` has no "Exit codes:".

- [ ] **Step 5: Add the error**

In `src/core/errors.ts`, add `| 'unsupported-operation'` on the line directly after `| 'unsupported-pdf'` in `ErrorCode`. Insert directly after the closing `}` of `unsupportedPdf()`:

```ts
/**
 * A page operation that does not fit the files it was given: a JPEG handed to
 * --merge, a single PDF handed to --merge, a one-page PDF handed to --split.
 * `reason` is the action's own `unavailable()` text, the same words the shell's
 * /pdf hub shows beside a dimmed row.
 *
 * This gets its own code rather than `invalid-arguments`. The command was
 * well-formed and would succeed on other files, which makes it exit 1, while
 * `invalid-arguments` always means exit 2 (spec §3.4).
 */
export function unsupportedOperation(action: string, reason: string): ForgeError {
  return new ForgeError({
    code: 'unsupported-operation',
    title: `Cannot ${action} these files`,
    detail: `Not available for these files: ${reason}.`,
    hint: 'Page operations work on PDFs: --merge takes two or more, the others take one.',
    shellHint: 'Use /pdf with a PDF staged — two or more for merge.',
  })
}
```

- [ ] **Step 6: Add `exitCodeFor` and route page-op refusals through it**

In `src/cli/execute.ts`:

1. Add `unsupportedOperation` to the `../core/errors.js` import.
2. Directly after the `ExecuteOptions` interface, add:

```ts
/**
 * The exit-code contract (spec §3.4). If the same flags could succeed on a
 * different file, it is 1. If the command itself is wrong, it is 2. The only
 * failure that is the command's own fault is `invalid-arguments`.
 */
export function exitCodeFor(failures: InputFailure[]): 0 | 1 | 2 {
  if (failures.length === 0) return 0
  return failures.some((f) => f.error.code === 'invalid-arguments') ? 2 : 1
}
```

3. Replace the whole `if (intent.kind === 'pageop') { … }` branch with:

```ts
  if (intent.kind === 'pageop') {
    const resolved = await resolveInputs(intent.inputs, { recursive: false })

    if (resolved.sources.length === 0) {
      return {
        exitCode: exitCodeFor(resolved.failures),
        stdout: [],
        stderr: reportFailures(resolved.failures, { debug: intent.debug }),
      }
    }

    const action = ACTIONS.find((a) => a.id === intent.action)
    if (!action) throw new Error(`no action registered for "${intent.action}"`)

    /**
     * Some refusals are about *these files*: a JPEG handed to --merge, a split
     * point past the last page, a range that selects nothing. Those are failures
     * (exit 1), not usage errors, because the same flags would succeed on a
     * different file (spec §3.4). They used to be thrown, and surfaced as exit 2.
     */
    const first = resolved.sources[0]?.path ?? ''
    const refuse = (error: ForgeError): ExecuteResult => {
      const failures = [...resolved.failures, { path: first, error }]
      return {
        exitCode: exitCodeFor(failures),
        stdout: [],
        stderr: reportFailures(failures, { debug: intent.debug }),
      }
    }

    if (!action.appliesTo(resolved.sources)) {
      const reason = unavailableReason(action, resolved.sources) ?? 'not available for these files'
      return refuse(unsupportedOperation(intent.action, reason))
    }

    let planned: Job[]
    try {
      planned = action.plan(resolved.sources, pageOpValues(intent, resolved.sources))
    } catch (e) {
      if (!isForgeError(e)) throw e
      return refuse(e)
    }

    // `action.plan()` bypasses `buildPlan` — its one-source-one-target shape
    // does not fit merge's several sources or split's several outputs — but
    // `runPlan` is arity-agnostic, so the write-safety rules arrive for free
    // rather than having to be applied here by hand.
    const outcome = await runPlan(planned, { force: intent.force })

    const failures = [...resolved.failures, ...outcome.refusals, ...outcome.failures]
    const stdout = outcome.results.length === 0 ? [] : reportPageOp(outcome)

    return {
      exitCode: exitCodeFor(failures),
      stdout,
      stderr: reportFailures(failures, { debug: intent.debug }),
    }
  }
```

4. Rename `export async function execute(intent: Intent, opts: ExecuteOptions = {}): Promise<ExecuteResult> {` to `async function executeIntent(intent: Intent, opts: ExecuteOptions): Promise<ExecuteResult> {`. Insert this directly above it:

```ts
/**
 * Never throws a ForgeError. One that escapes a branch is still a Forge
 * answer, so it is reported and given an exit code by the §3.4 rule. A config
 * value that is refused is the main case: `runConfig` throws
 * `invalid-arguments`, which lands on stderr with exit 2.
 */
export async function execute(intent: Intent, opts: ExecuteOptions = {}): Promise<ExecuteResult> {
  try {
    return await executeIntent(intent, opts)
  } catch (e) {
    if (!isForgeError(e)) throw e
    const failures = [{ path: '', error: e }]
    const debug = 'debug' in intent ? intent.debug : false
    return { exitCode: exitCodeFor(failures), stdout: [], stderr: reportFailures(failures, { debug }) }
  }
}
```

Leave the `compress` and `convert` branches' `failures.length > 0 ? 1 : 0` lines alone. Those branches never produce `invalid-arguments`, and Task 5 replaces them.

- [ ] **Step 7: Make `forge config set` refuse on stderr**

In `src/cli/config-command.ts`, add `import { invalidArguments } from '../core/errors.js'`, change the doc comment's second paragraph to `Exit codes follow spec §3.4: a rejected value is a usage error, thrown as invalid-arguments so it is printed on stderr with exit 2. A rejected value writes nothing, so a typo never half-applies.`, and replace the three error returns:

```ts
  if (key === 'theme') {
    if (value !== 'dark' && value !== 'light') {
      throw invalidArguments(`Theme must be dark or light, not ${value}.`)
    }
    await savePreferences({ theme: value })
    return { stdout: [`theme is now ${value}`], exitCode: 0 }
  }

  if (key === 'quality') {
    const n = Number(value)
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      throw invalidArguments(`Quality must be a whole number between 1 and 100, not ${value}.`)
    }
    await savePreferences({ quality: n })
    return { stdout: [`quality is now ${n}`], exitCode: 0 }
  }

  if (value.trim().length === 0) {
    throw invalidArguments('Output must be a folder path.')
  }
```

- [ ] **Step 8: Print the table in `--help`**

In `src/cli/args.ts`, add above `parseArgs`:

```ts
/**
 * The exit-code contract (spec §3.4), printed under --help and in the README.
 * The rule behind it: if the same flags could succeed on a different file, a
 * refusal is 1; otherwise it is 2.
 */
export const EXIT_CODES_HELP = `
Exit codes:
  0  every input succeeded
  1  the command was understood, and at least one input failed or was refused
  2  the command itself was invalid: an unknown flag, a missing argument, contradictory flags`
```

and in the `program` chain, directly after `.version('0.1.0', '-V, --version', 'show the version')`, add `.addHelpText('after', EXIT_CODES_HELP)`.

- [ ] **Step 9: Run the tests to confirm they pass**

Run: `npx vitest run tests/cli/exit-codes.test.ts tests/cli/config-command.test.ts tests/index.test.ts tests/cli/pdf-args.test.ts tests/cli/pageop-safety.test.ts`
Expected: PASS.

- [ ] **Step 10: Gate and commit**

Run: `npx biome check --write src tests && npm test && npm run typecheck && npm run lint`

```bash
git add src/core/errors.ts src/cli/execute.ts src/cli/config-command.ts src/cli/args.ts \
  tests/cli/exit-codes.test.ts tests/cli/config-command.test.ts tests/index.test.ts
git commit -m "$(cat <<'EOF'
fix(cli): one exit-code rule — 1 for a file's refusal, 2 for a bad command

Merging a non-PDF, splitting past the last page and extracting a page
that does not exist now exit 1 with a reported failure instead of
throwing to exit 2. forge config set refuses on stderr. --help prints
the contract.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Honest text: warning codes, batch paths, stale wording

Spec §3.2 (WarningCode, the batch text fix) and §1 item 7.

**Files:**
- Modify: `src/core/types.ts:131-143` (`Warning`)
- Modify: `src/core/errors.ts`. Add one line directly after the `ErrorCode` union. Change the PDF branch of `unsupportedCompress` (lines ~182-197).
- Modify: `src/cli/report.ts:78-92` (`reportBatch`)
- Modify: `src/cli/execute.ts`. Change the two calls `reportBatch(outcome, intent.output)` to `reportBatch(outcome)`.
- Modify: `tests/cli/report.test.ts`, `tests/core/errors.test.ts`, `tests/shell/sticky-context.test.tsx:77`
- Modify: `README.md` ("Not yet", the two batch examples, the Roadmap bullet)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `export type WarningCode` in `src/core/types.ts` (re-exported from `src/core/errors.ts`), with the new member `'config-unreadable'`. `Warning.code: WarningCode`.
  - `reportBatch(summary: RunSummary, where?: { cwd?: string; home?: string }): string[]`. The second parameter is no longer `output?: string`.

- [ ] **Step 1: Write the failing tests**

In `tests/cli/report.test.ts`, replace the test `'names the output directory when one was given'` with:

```ts
  it('lists every output path, not just a count (spec §1, item 2)', async () => {
    const dir = await makeTempDir()
    const summary = await convertAll(dir, 3)
    const text = reportBatch(summary, { cwd: dir }).join('\n')
    expect(text).toContain('3 converted')
    for (let i = 0; i < 3; i++) expect(text).toContain(`  f${i}.webp`)
  })

  it('shows each output relative to cwd, the way a single result does', async () => {
    const dir = await makeTempDir()
    const parent = join(dir, '..')
    const lines = reportBatch(await convertAll(dir, 2), { cwd: parent })
    const folder = dir.slice(parent.length + 1)
    expect(lines).toContain(`  ${folder}/f0.webp`)
    expect(lines).toContain(`  ${folder}/f1.webp`)
  })
```

Append to `tests/core/errors.test.ts`. Change the `vitest` import to `import { describe, expect, expectTypeOf, it } from 'vitest'`, add `type WarningCode` to the `../../src/core/errors.js` import, and change `import type { SourceInfo } from '../../src/core/types.js'` to `import type { SourceInfo, Warning } from '../../src/core/types.js'`.

```ts
describe('WarningCode', () => {
  it('is the type of every Warning code', () => {
    expectTypeOf<Warning['code']>().toEqualTypeOf<WarningCode>()
  })
})

describe('unsupportedCompress for a PDF', () => {
  const pdf = (images: { compressible: number; skipped: number }): SourceInfo => ({
    kind: 'document',
    path: '/tmp/notes.pdf',
    format: 'pdf',
    bytes: 1000,
    pages: 2,
    encrypted: false,
    images,
  })

  it('says a text-only PDF has nothing to compress, not that Forge cannot yet', () => {
    const e = unsupportedCompress(pdf({ compressible: 0, skipped: 0 }))
    expect(e.title).toBe('Nothing to compress')
    expect(e.detail).toContain('no images')
    expect(`${e.title} ${e.detail} ${e.hint}`).not.toMatch(/\byet\b/)
  })

  it('says when the images are a kind Forge cannot re-encode', () => {
    expect(unsupportedCompress(pdf({ compressible: 0, skipped: 3 })).detail).toContain(
      'cannot re-encode',
    )
  })
})
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npx vitest run tests/cli/report.test.ts tests/core/errors.test.ts`
Expected: FAIL. The batch has no per-file lines. `WarningCode` is not exported (a typecheck error and an unresolved import). The title is `'Forge cannot compress a PDF yet'`.

- [ ] **Step 3: Add `WarningCode`**

In `src/core/types.ts`, replace the `Warning` interface with:

```ts
/**
 * Every warning's stable identifier. --json and the MCP server print it, so a
 * consumer can act on a warning without parsing its prose. A code is never
 * renamed or removed in a minor version (spec §3.2).
 */
export type WarningCode =
  | 'animation-flattened'
  /** A PDF held nothing this could re-encode, so its size barely moved. */
  | 'pdf-no-images'
  /** Some images were re-encoded and some were left alone. */
  | 'pdf-images-skipped'
  /** Image resolution was reduced, which is the loss worth naming. */
  | 'pdf-downsampled'
  /** The npm fallback ran instead of LibreOffice — tables, images and layout were not preserved. */
  | 'word-basic-fidelity'
  /** `forge config` could not read its settings file and fell back to defaults. */
  | 'config-unreadable'

export interface Warning {
  code: WarningCode
  message: string
}
```

In `src/core/errors.ts`, add on the line directly after the `ErrorCode` union's last member (`| 'unexpected'`):

```ts

/** Lives beside `Warning` in types.ts; re-exported so both stable vocabularies import from here (spec §3.2). */
export type { WarningCode } from './types.js'
```

- [ ] **Step 4: Correct the PDF compress wording**

In `src/core/errors.ts`, replace the `if (source.kind === 'document' && source.format === 'pdf') { … }` block in `unsupportedCompress` (keep the comment above it, but replace its last sentence, "…the real answer is that Forge has not built this yet.", with "…a PDF with images does compress; this refusal only reaches one with nothing re-encodable in it.") with:

```ts
  if (source.kind === 'document' && source.format === 'pdf') {
    const skipped = source.images?.skipped ?? 0
    return new ForgeError({
      code: 'unsupported-compress',
      title: 'Nothing to compress',
      detail:
        skipped > 0
          ? `${name}'s images are a kind Forge cannot re-encode, so there is nothing to make smaller.`
          : `${name} has no images — it is text and layout, which compression cannot shrink.`,
      hint: 'Try a page operation such as --extract to keep fewer pages, or --to <format> to turn its pages into images.',
      shellHint: 'Try /pdf to keep fewer pages, or /convert to turn its pages into images.',
    })
  }
```

In `tests/shell/sticky-context.test.tsx` line 77, change `expect(refused).toContain('cannot compress a PDF yet')` to `expect(refused).toContain('Nothing to compress')`. This is the only edit under `tests/shell/`. The shell code is unchanged; it renders the error's title as before.

- [ ] **Step 5: List every output in a batch**

In `src/cli/report.ts`, replace `reportBatch` with:

```ts
/**
 * Two or more results. Every output is named, not just counted. A batch that
 * reported "✓ 3 converted" left the reader, often an agent, to guess where the
 * files went (spec §1, item 2). There is one line per file written, so a PDF
 * rasterised inside the batch lists each of its pages.
 */
export function reportBatch(summary: RunSummary, where: Where = {}): string[] {
  const lines = [
    `✓ ${summary.results.length} converted`,
    `  ${formatBytes(summary.inputBytes)} → ${formatBytes(summary.outputBytes)} · ${changePhrase(summary.inputBytes, summary.outputBytes)}`,
  ]
  for (const result of summary.results) {
    for (const output of result.job.outputs) {
      lines.push(`  ${displayPath(output, placesFor(where))}`)
    }
  }

  const warnings = summary.results.flatMap((r) => r.warnings)
  if (warnings.length > 0) {
    lines.push('')
    for (const w of warnings) lines.push(`⚠ ${w.message}`)
  }
  return lines
}
```

In `src/cli/execute.ts`, change both `reportBatch(outcome, intent.output)` calls to `reportBatch(outcome)`.

- [ ] **Step 6: Run the tests to confirm they pass**

Run: `npx vitest run tests/cli/report.test.ts tests/core/errors.test.ts tests/cli/execute.test.ts tests/shell/sticky-context.test.tsx`
Expected: PASS.

- [ ] **Step 7: Correct the README**

1. Replace the whole paragraph under `### Not yet` with:

```
PDF↔image conversion, reading a password-protected PDF (see [PDF →
image](#pdf--image) and [Encrypted PDFs](#encrypted-pdfs) above — including
in the shell), and compressing a PDF that holds images (`forge scan.pdf
--max-size 2mb`) all work. A PDF that is only text and layout has nothing
compression can shrink, and Forge says so. Still not implemented: Markdown,
HTML and Office conversion beyond Word. Removing a password from a PDF is not
planned at all — see [Encrypted PDFs](#encrypted-pdfs) for why. Separately,
and not specific to PDFs: the shell refuses to convert or compress several
staged files at once today — that's a deliberate limit while batch handling
through the shell is still unbuilt, not a bug.
```

2. In `### Batches and folders`, replace the first example's output:

```
✓ 3 converted
  6.2 KB → 1.9 KB · 69.6% smaller

Output: ./out/
```

with

```
✓ 3 converted
  6.2 KB → 1.9 KB · 69.6% smaller
  out/photo1.webp
  out/photo2.webp
  out/photo3.webp
```

and the recursive example's output:

```
✓ 4 converted
  8.3 KB → 1.7 KB · 80% smaller

Output: ./t/
```

with

```
✓ 4 converted
  8.3 KB → 1.7 KB · 80% smaller
  t/photo1.png
  t/photo2.png
  t/photo3.png
  t/sub/deeper/bottom.png
```

3. In `## Roadmap`, in the "A video engine" bullet, replace `PDF compression and splitting to a target size are still to come.` with `splitting a PDF to a target size is still to come.`

- [ ] **Step 8: Gate and commit**

Run: `npx biome check --write src tests && npm test && npm run typecheck && npm run lint`

```bash
git add src/core/types.ts src/core/errors.ts src/cli/report.ts src/cli/execute.ts \
  tests/cli/report.test.ts tests/core/errors.test.ts tests/shell/sticky-context.test.tsx README.md
git commit -m "$(cat <<'EOF'
fix(cli): a batch names every file it wrote, and stale PDF text is gone

reportBatch lists each output path instead of a count. Warnings get a
named WarningCode union (plus config-unreadable). A text-only PDF is told
it has nothing to compress rather than that Forge cannot compress PDFs
yet, which stopped being true.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Core data shapes: result JSON, probe report, formats matrix, literal paths

The data behind spec §3.2, §3.3 and `forge_formats`, plus Review Focus 5. Pure `core/` with no front end.

**Files:**
- Create: `src/core/report-data.ts`
- Create: `src/core/probe-report.ts`
- Modify: `src/core/capabilities.ts` (append `FormatCapability`, `formatMatrix`)
- Modify: `src/core/resolve.ts` (the `isGlob` branch of `resolveInputs`)
- Create: `tests/core/report-data.test.ts`, `tests/core/probe-report.test.ts`
- Modify: `tests/core/capabilities.test.ts`, `tests/core/resolve.test.ts`

**Interfaces:**
- Consumes: `describeResult(result: Result): ResultView` (`src/core/describe.ts`), `targetIdsFor(source): FormatId[]`, `readableFormats()`, `writableFormats()` (`src/core/capabilities.ts`), `actionsFor(sources): Action[]` (`src/core/actions/index.ts`), `resolveInputs(patterns, { recursive }): Promise<ResolvedInput>` (`src/core/resolve.ts`), `ForgeError`, `ErrorCode` (`src/core/errors.ts`).
- Produces (`src/core/capabilities.ts`):
  - `interface FormatCapability { id: FormatId; label: string; extensions: string[]; read: boolean; write: boolean; lossy: boolean }`
  - `formatMatrix(): FormatCapability[]`
- Produces (`src/core/probe-report.ts`):
  - `type ProbeReport = { path: string; kind: 'image' | 'document'; format: FormatId; bytes: number; width?: number; height?: number; pages?: number; encrypted?: boolean; targets: FormatId[]; actions: string[] }`
  - `describeSource(source: SourceInfo): ProbeReport`
  - `probeFiles(patterns: string[]): Promise<{ probes: ProbeReport[]; failures: InputFailure[] }>`
- Produces (`src/core/report-data.ts`). All of these are `type` aliases:
  - `WarningJson = { code: Warning['code']; message: string }`
  - `ResultJson = { op: Job['op']; source: string; sources: string[]; outputs: string[]; inputBytes: number; outputBytes: number; warnings: WarningJson[] }`
  - `FailureJson = { path?: string; code: ErrorCode; title: string; detail: string; hint?: string }`
  - `RunJson = { forge: string; ok: boolean; results: ResultJson[]; failures: FailureJson[] }`
  - `FormatsJson = { forge: string; ok: boolean; formats: FormatCapability[]; failures: FailureJson[] }`
  - `ProbeJson = { forge: string; ok: boolean; probes: ProbeReport[]; failures: FailureJson[] }`
  - `ConfigJson = { forge: string; ok: boolean; config: Record<string, string | number | null>; warnings: WarningJson[]; failures: FailureJson[] }`
  - `interface FailureLike { path?: string; error: ForgeError }` (an `InputFailure` satisfies it). An empty or absent `path` means the failure belongs to the command.
  - `resultJson(result: Result): ResultJson`, `failureJson(f: FailureLike): FailureJson`, `runJson(forge: string, data: { results: Result[]; failures: FailureLike[] }): RunJson`, `errorJson(forge: string, error: ForgeError): RunJson`, `formatsJson(forge: string, formats: FormatCapability[]): FormatsJson`, `probeJson(forge: string, data: { probes: ProbeReport[]; failures: FailureLike[] }): ProbeJson`, `configJson(forge: string, config: Record<string, string | number | null>, warnings: Warning[]): ConfigJson`
- `report-data.ts` makes value imports only from `node:path` and `./describe.js`. Everything else is `import type`. This keeps it cheap enough for `src/index.ts` to import on the argument-error path without loading engines.

- [ ] **Step 1: Write the failing report-data test**

Create `tests/core/report-data.test.ts`:

```ts
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileNotFound, invalidArguments } from '../../src/core/errors.js'
import { buildPlan } from '../../src/core/plan.js'
import {
  errorJson,
  failureJson,
  resultJson,
  runJson,
} from '../../src/core/report-data.js'
import { resolveInputs } from '../../src/core/resolve.js'
import { runJobs } from '../../src/core/run.js'
import type { ConvertOptions, Job } from '../../src/core/types.js'
import { probe } from '../../src/engines/registry.js'
import { makeJpeg, makeMarkedPdf, makePdf, makeTempDir } from '../helpers/fixtures.js'

const options: ConvertOptions = { background: '#ffffff', keepMetadata: false }

async function convertOne(dir: string) {
  const src = await makeJpeg(dir, 'a.jpg')
  const resolved = await resolveInputs([src], { recursive: false })
  const plan = await buildPlan({ resolved, target: 'webp', options, force: false })
  const summary = await runJobs(plan.jobs, {})
  const result = summary.results[0]
  if (!result) throw new Error('expected one result')
  return { src, result }
}

describe('resultJson', () => {
  it('gives the source and every output as absolute paths, with exact byte counts', async () => {
    const dir = await makeTempDir()
    const { src, result } = await convertOne(dir)
    expect(resultJson(result)).toEqual({
      op: 'convert',
      source: src,
      sources: [src],
      outputs: [join(dir, 'a.webp')],
      inputBytes: (await stat(src)).size,
      outputBytes: result.outputBytes,
      warnings: [],
    })
  })

  it('lists every page of a rasterised PDF, not just the first', async () => {
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', [1, 2, 3])
    const info = await probe(src)
    if (info.kind !== 'document') throw new Error('expected a document')
    const job: Job = {
      op: 'convert',
      sources: [info],
      outputs: [join(dir, 'doc-1.png'), join(dir, 'doc-2.png'), join(dir, 'doc-3.png')],
      target: 'png',
      options: { ...options, dpi: 72, pages: [0, 1, 2] },
    }
    const [result] = (await runJobs([job], {})).results
    if (!result) throw new Error('expected one result')
    expect(resultJson(result).outputs).toEqual(job.outputs)
  })

  it('names every source of a merge, the first as `source`', async () => {
    const dir = await makeTempDir()
    const a = await probe(await makePdf(dir, 'a.pdf', 1))
    const b = await probe(await makePdf(dir, 'b.pdf', 1))
    const job: Job = { op: 'merge', sources: [a, b], outputs: [join(dir, 'merged.pdf')] }
    const [result] = (await runJobs([job], {})).results
    if (!result) throw new Error('expected one result')
    const json = resultJson(result)
    expect(json.op).toBe('merge')
    expect(json.source).toBe(a.path)
    expect(json.sources).toEqual([a.path, b.path])
    expect(json.inputBytes).toBe(a.bytes + b.bytes)
  })
})

describe('failureJson', () => {
  it('carries the stable code, title, detail and hint, with an absolute path', () => {
    expect(failureJson({ path: '/a/ghost.jpg', error: fileNotFound('/a/ghost.jpg') })).toEqual({
      path: '/a/ghost.jpg',
      code: 'file-not-found',
      title: 'File not found',
      detail: 'ghost.jpg could not be found.',
      hint: 'Check the filename and try again.',
    })
  })

  it('omits path for a command-level failure, and hint when there is none', () => {
    const json = failureJson({ path: '', error: invalidArguments('No files given.') })
    expect(json).toEqual({
      code: 'invalid-arguments',
      title: 'Invalid arguments',
      detail: 'No files given.',
    })
  })
})

describe('runJson', () => {
  it('is ok only when nothing failed', async () => {
    const dir = await makeTempDir()
    const { result } = await convertOne(dir)
    expect(runJson('9.9.9', { results: [result], failures: [] }).ok).toBe(true)
    const failed = runJson('9.9.9', {
      results: [result],
      failures: [{ path: join(dir, 'x.jpg'), error: fileNotFound(join(dir, 'x.jpg')) }],
    })
    expect(failed.ok).toBe(false)
    expect(failed.forge).toBe('9.9.9')
  })

  it('serialises without glyphs or colour', async () => {
    const dir = await makeTempDir()
    const { result } = await convertOne(dir)
    const text = JSON.stringify(runJson('1', { results: [result], failures: [] }))
    expect(text).not.toMatch(/[✓✕⚠→]|\u001b\[/)
  })

  it('errorJson is a run document holding one failure', () => {
    const doc = errorJson('1', invalidArguments('Bad.'))
    expect(doc).toEqual({
      forge: '1',
      ok: false,
      results: [],
      failures: [{ code: 'invalid-arguments', title: 'Invalid arguments', detail: 'Bad.' }],
    })
  })
})
```

- [ ] **Step 2: Write the failing probe-report, capabilities and resolve tests**

Create `tests/core/probe-report.test.ts`:

```ts
import { cp, mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { actionsFor } from '../../src/core/actions/index.js'
import { targetIdsFor } from '../../src/core/capabilities.js'
import { describeSource, probeFiles } from '../../src/core/probe-report.js'
import { probe } from '../../src/engines/registry.js'
import { makeJpeg, makePdf, makePng, makeTempDir } from '../helpers/fixtures.js'

const LOCKED = fileURLToPath(new URL('../fixtures/locked-hunter2.pdf', import.meta.url))

describe('describeSource', () => {
  it('reports an image with its dimensions and what it can become', async () => {
    const dir = await makeTempDir()
    const source = await probe(await makeJpeg(dir, 'a.jpg'))
    const report = describeSource(source)
    expect(report).toMatchObject({ kind: 'image', format: 'jpeg', path: source.path })
    expect(report.width).toBeGreaterThan(0)
    expect(report.pages).toBeUndefined()
    // Invariant 2: from the capability graph, never a list written here.
    expect(report.targets).toEqual(targetIdsFor(source))
    expect(report.actions).toEqual(actionsFor([source]).map((a) => a.id))
    expect(report.actions).toContain('convert')
  })

  it('reports a PDF with its page count, encryption, and page operations', async () => {
    const dir = await makeTempDir()
    const source = await probe(await makePdf(dir, 'doc.pdf', 3))
    const report = describeSource(source)
    expect(report).toMatchObject({ kind: 'document', format: 'pdf', pages: 3, encrypted: false })
    expect(report.width).toBeUndefined()
    expect(report.actions).toEqual(expect.arrayContaining(['split', 'extract', 'delete', 'rotate']))
    // Merge needs two or more files, so it never applies to one.
    expect(report.actions).not.toContain('merge')
  })

  it('says when a PDF is encrypted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forge-probe-'))
    const path = join(dir, 'locked.pdf')
    await cp(LOCKED, path)
    expect(describeSource(await probe(path)).encrypted).toBe(true)
  })

  it('reads the format from content, not the extension (invariant 3)', async () => {
    const dir = await makeTempDir()
    const png = await makePng(dir, 'b.png')
    const disguised = join(dir, 'really-a-png.jpg')
    await cp(png, disguised)
    expect(describeSource(await probe(disguised)).format).toBe('png')
  })
})

describe('probeFiles', () => {
  it('reports a missing file as a failure and keeps going', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    const { probes, failures } = await probeFiles([jpg, join(dir, 'ghost.jpg')])
    expect(probes.map((p) => p.path)).toEqual([jpg])
    expect(failures[0]?.error.code).toBe('file-not-found')
  })

  it('writes nothing', async () => {
    const dir = await makeTempDir()
    await makeJpeg(dir, 'a.jpg')
    await makePdf(dir, 'doc.pdf', 2)
    const before = (await readdir(dir)).sort()
    await probeFiles([dir])
    expect((await readdir(dir)).sort()).toEqual(before)
  })

  it('reads a real file whose name contains glob characters as that file', async () => {
    const dir = await makeTempDir()
    const pdf = await makePdf(dir, 'Scan [2024].pdf', 2)
    const { probes, failures } = await probeFiles([pdf])
    expect(failures).toEqual([])
    expect(probes.map((p) => p.path)).toEqual([pdf])
  })
})
```

Append to `tests/core/capabilities.test.ts` (add `formatMatrix` and `readableFormats`/`writableFormats` to its import from `../../src/core/capabilities.js` if they are not already imported):

```ts
describe('formatMatrix', () => {
  it('lists every format any engine reads or writes, flagged from the engines themselves', () => {
    const readable = readableFormats()
    const writable = writableFormats()
    const matrix = formatMatrix()
    expect(new Set(matrix.map((f) => f.id))).toEqual(new Set([...readable, ...writable]))
    for (const f of matrix) {
      expect(f.read).toBe(readable.includes(f.id))
      expect(f.write).toBe(writable.includes(f.id))
    }
    expect(matrix.find((f) => f.id === 'heic')).toMatchObject({ read: true, write: false })
  })
})
```

Append to the `describe('resolveInputs', …)` block in `tests/core/resolve.test.ts`:

```ts
  it('reads a file whose name contains glob characters literally', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'Photo [1].jpg')
    const { sources, failures } = await resolveInputs([a], { recursive: false })
    expect(names(sources)).toEqual(['Photo [1].jpg'])
    expect(failures).toEqual([])
  })

  it('reports a glob that matches nothing, instead of silently doing nothing', async () => {
    const dir = await makeTempDir()
    const { sources, failures } = await resolveInputs([join(dir, '*.png')], { recursive: false })
    expect(sources).toEqual([])
    expect(failures[0]?.error.code).toBe('file-not-found')
  })
```

- [ ] **Step 3: Run them to confirm they fail**

Run: `npx vitest run tests/core/report-data.test.ts tests/core/probe-report.test.ts tests/core/capabilities.test.ts tests/core/resolve.test.ts`
Expected: FAIL. The two new modules do not resolve, `formatMatrix` is not exported, the bracketed file yields no sources, and the empty glob yields no failure.

- [ ] **Step 4: Make literal paths win over glob syntax**

In `src/core/resolve.ts`, add `import { existsSync } from 'node:fs'`. In `resolveInputs`, replace the start of the loop body, from `for (const pattern of patterns) {` through the glob branch's `continue`, with:

```ts
  for (const pattern of patterns) {
    const abs = resolvePath(pattern)

    /**
     * A name that exists on disk is that file or folder, even when it contains
     * glob characters. `Scan [2024].pdf` is a real file, and reading it as a
     * character class matched nothing and reported nothing, so the run looked
     * like a success. Only a pattern that names nothing literally gets expanded.
     */
    if (isGlob(pattern) && !existsSync(abs)) {
      const matches = await glob([pattern], { absolute: true, onlyFiles: true })
      // A glob that matches nothing is reported, not skipped. A run that did
      // nothing must not read as success (spec §3.2: ok only if every input
      // succeeded).
      if (matches.length === 0) failures.push({ path: abs, error: fileNotFound(abs) })
      for (const m of matches.sort()) await add(m, undefined, false)
      continue
    }
```

Then delete the now-duplicate `const abs = resolvePath(pattern)` that follows.

- [ ] **Step 5: Add `formatMatrix`**

Append to `src/core/capabilities.ts`:

```ts
/** One row of the capability matrix: `forge --formats --json` and `forge_formats`. */
export interface FormatCapability {
  id: FormatId
  label: string
  extensions: string[]
  read: boolean
  write: boolean
  lossy: boolean
}

/**
 * Every format any registered engine reads or writes, as data. Derived from
 * the engines, exactly as `reportFormats` is, so the text table, the JSON and
 * the MCP tool can never offer different formats (invariant 2).
 */
export function formatMatrix(): FormatCapability[] {
  const readable = new Set(readableFormats())
  const writable = new Set(writableFormats())
  return sortByRegistryOrder([...new Set([...readable, ...writable])]).map((id) => ({
    id,
    label: FORMATS[id].label,
    extensions: [...FORMATS[id].extensions],
    read: readable.has(id),
    write: writable.has(id),
    lossy: FORMATS[id].lossy,
  }))
}
```

- [ ] **Step 6: Create `src/core/probe-report.ts`**

```ts
import { resolve } from 'node:path'
import { actionsFor } from './actions/index.js'
import { targetIdsFor } from './capabilities.js'
import { type InputFailure, resolveInputs } from './resolve.js'
import type { FormatId, SourceInfo } from './types.js'

/**
 * What a file is and what Forge can do with it (spec §3.3), as data. The CLI
 * prints it as text or `--json`, and the MCP server returns it from
 * `forge_probe`.
 *
 * This is a type alias, not an interface: the MCP SDK types `structuredContent`
 * as an index-signature record, which an interface does not satisfy.
 */
export type ProbeReport = {
  path: string
  kind: SourceInfo['kind']
  /** Detected from content, never from the extension (invariant 3). */
  format: FormatId
  bytes: number
  width?: number
  height?: number
  pages?: number
  encrypted?: boolean
  /** `targetIdsFor(source)` — includes the file's own format, which recompresses. */
  targets: FormatId[]
  /** `actionsFor([source])` ids. Merge is never listed: it needs two or more files. */
  actions: string[]
}

export function describeSource(source: SourceInfo): ProbeReport {
  const common = {
    path: resolve(source.path),
    kind: source.kind,
    format: source.format,
    bytes: source.bytes,
  }
  const can = {
    targets: targetIdsFor(source),
    actions: actionsFor([source]).map((a) => a.id),
  }
  if (source.kind === 'image') {
    return { ...common, width: source.width, height: source.height, ...can }
  }
  return { ...common, pages: source.pages, encrypted: source.encrypted, ...can }
}

/**
 * Probes paths, folders or globs the way a conversion resolves them, and
 * writes nothing. A folder is read one level deep, so probing a folder
 * describes each file in it.
 */
export async function probeFiles(
  patterns: string[],
): Promise<{ probes: ProbeReport[]; failures: InputFailure[] }> {
  const resolved = await resolveInputs(patterns, { recursive: false })
  return { probes: resolved.sources.map(describeSource), failures: resolved.failures }
}
```

- [ ] **Step 7: Create `src/core/report-data.ts`**

```ts
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

export type ProbeJson = { forge: string; ok: boolean; probes: ProbeReport[]; failures: FailureJson[] }

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
```

- [ ] **Step 8: Run the tests to confirm they pass**

Run: `npx vitest run tests/core/report-data.test.ts tests/core/probe-report.test.ts tests/core/capabilities.test.ts tests/core/resolve.test.ts`
Expected: PASS.

- [ ] **Step 9: Gate and commit**

Run: `npx biome check --write src tests && npm test && npm run typecheck && npm run lint`

```bash
git add src/core/report-data.ts src/core/probe-report.ts src/core/capabilities.ts src/core/resolve.ts \
  tests/core/report-data.test.ts tests/core/probe-report.test.ts tests/core/capabilities.test.ts \
  tests/core/resolve.test.ts
git commit -m "$(cat <<'EOF'
feat(core): result, probe and format data for machine-readable output

report-data.ts builds the --json / MCP documents from the same Result
objects the text reporter reads; probe-report.ts describes a file from
targetIdsFor and actionsFor; formatMatrix gives the capability table as
data. A literal filename with glob characters is now read as itself, and
a glob that matches nothing is reported instead of silently skipped.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `--json` on every command

Spec §3.2. After this task, `execute.ts` is built around `runIntent()` (data), with text and JSON as two renderings of it.

**Files:**
- Modify: `src/cli/args.ts` (the `--json` option, `wantsJson`, commander errors → `invalid-arguments`, config filtering)
- Modify: `src/cli/execute.ts` (restructured: `runIntent`, `RunReport`, `renderRun`, `execute`)
- Modify: `src/cli/config-command.ts` (`ConfigResult` gains `config` and `warnings`)
- Modify: `src/index.ts` (JSON-aware error printing; progress off under `--json`)
- Create: `tests/cli/json.test.ts`, `tests/cli/json-spawn.test.ts`
- Modify: `tests/cli/args.test.ts`, `tests/cli/config-command.test.ts`

**Interfaces:**
- Consumes: `runJson`, `errorJson`, `formatsJson`, `configJson` (`src/core/report-data.ts`, Task 4); `formatMatrix` (Task 4); `exitCodeFor` and `unsupportedOperation` (Task 2); `readPassword → string | undefined` and `encryptedSource(path, { attempted })` (Task 1); `asForgeError`, `fatalLines`, `guardUnsettled` (Task 1); `reportBatch(summary, where?)` (Task 3).
- Produces:
  - `wantsJson(argv: string[]): boolean` in `src/cli/args.ts`
  - `parseArgs` throws `ForgeError` `invalid-arguments` for commander's own usage errors. Only help and version are still `CommanderError`.
  - In `src/cli/execute.ts`:
    - `ExecuteOptions.json?: boolean`
    - `type RunnableIntent = ConvertIntent | CompressIntent | PageOpIntent`
    - `interface RunReport extends RunSummary { kind: RunnableIntent['kind'] }`. Its `failures` holds every refusal and failure.
    - `runIntent(intent: RunnableIntent, opts?: ExecuteOptions): Promise<RunReport>`. It never throws a `ForgeError`.
    - `renderRun(report: RunReport, opts: { json: boolean; debug: boolean }): ExecuteResult`
    - `execute(intent: Intent, opts?: ExecuteOptions): Promise<ExecuteResult>`. Under `json`, `stdout` is exactly one element (a JSON line) and `stderr` is `[]`.
  - `ConfigResult = { stdout: string[]; exitCode: 0; config: Record<string, string | number | null>; warnings: Warning[] }` in `src/cli/config-command.ts`

- [ ] **Step 1: Write the failing in-process JSON test**

Create `tests/cli/json.test.ts`:

```ts
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute, renderRun, runIntent } from '../../src/cli/execute.js'
import type { ConfigJson, FormatsJson, RunJson } from '../../src/core/report-data.js'
import { displayPath } from '../../src/utils/display-path.js'
import { makeJpeg, makePdf, makeTempDir } from '../helpers/fixtures.js'

/** Runs argv with --json and returns the one document stdout carries. */
async function jsonOf(argv: string[]): Promise<{ exitCode: number; doc: unknown }> {
  const out = await execute(parseArgs([...argv, '--json']), { json: true })
  expect(out.stdout).toHaveLength(1)
  expect(out.stderr).toEqual([])
  return { exitCode: out.exitCode, doc: JSON.parse(out.stdout[0] ?? '') as unknown }
}

/** The §3.2 run shape, checked key by key so a stray field fails here. */
function assertRunShape(doc: unknown): asserts doc is RunJson {
  const d = doc as RunJson
  expect(typeof d.forge).toBe('string')
  expect(typeof d.ok).toBe('boolean')
  expect(Object.keys(d).sort()).toEqual(['failures', 'forge', 'ok', 'results'])
  for (const r of d.results) {
    expect(Object.keys(r).sort()).toEqual([
      'inputBytes',
      'op',
      'outputBytes',
      'outputs',
      'source',
      'sources',
      'warnings',
    ])
    expect(isAbsolute(r.source)).toBe(true)
    for (const o of r.outputs) expect(isAbsolute(o)).toBe(true)
    for (const w of r.warnings) expect(Object.keys(w).sort()).toEqual(['code', 'message'])
  }
  for (const f of d.failures) {
    for (const key of Object.keys(f)) {
      expect(['path', 'code', 'title', 'detail', 'hint']).toContain(key)
    }
    if (f.path !== undefined) expect(isAbsolute(f.path)).toBe(true)
  }
}

describe('--json for conversions', () => {
  it('reports one conversion with absolute paths', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    const { exitCode, doc } = await jsonOf([jpg, '--to', 'webp'])
    assertRunShape(doc)
    expect(exitCode).toBe(0)
    expect(doc.ok).toBe(true)
    expect(doc.results[0]?.outputs).toEqual([join(dir, 'a.webp')])
    expect(existsSync(join(dir, 'a.webp'))).toBe(true)
  })

  it('lists every output of a batch', async () => {
    const dir = await makeTempDir()
    for (let i = 0; i < 3; i++) await makeJpeg(dir, `f${i}.jpg`)
    const { doc } = await jsonOf([dir, '--to', 'webp'])
    assertRunShape(doc)
    expect(doc.results.flatMap((r) => r.outputs).sort()).toEqual(
      [0, 1, 2].map((i) => join(dir, `f${i}.webp`)),
    )
  })

  it('reports a partly refused batch: exit 1, ok false, both halves present', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const b = await makeJpeg(dir, 'b.jpg')
    await writeFile(join(dir, 'b.webp'), 'already here')
    const { exitCode, doc } = await jsonOf([a, b, '--to', 'webp'])
    assertRunShape(doc)
    expect(exitCode).toBe(1)
    expect(doc.ok).toBe(false)
    expect(doc.results.map((r) => r.source)).toEqual([a])
    expect(doc.failures).toEqual([expect.objectContaining({ path: b, code: 'output-exists' })])
  })

  it('keeps spaces and non-ASCII characters in paths exactly', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'my photo é.jpg')
    const { doc } = await jsonOf([jpg, '--to', 'webp'])
    assertRunShape(doc)
    expect(doc.results[0]?.source).toBe(jpg)
    expect(doc.results[0]?.outputs).toEqual([join(dir, 'my photo é.webp')])
  })

  it('reports a page operation that does not fit as a failure, exit 1', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    const pdf = await makePdf(dir, 'b.pdf', 2)
    const { exitCode, doc } = await jsonOf([jpg, pdf, '--merge'])
    assertRunShape(doc)
    expect(exitCode).toBe(1)
    expect(doc.failures[0]?.code).toBe('unsupported-operation')
  })
})

describe('--json for the other commands', () => {
  const savedXdg = process.env.XDG_CONFIG_HOME
  let dir: string
  beforeEach(async () => {
    dir = await makeTempDir()
    process.env.XDG_CONFIG_HOME = dir
  })
  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = savedXdg
  })

  it('--formats --json returns the capability matrix', async () => {
    const { exitCode, doc } = await jsonOf(['--formats'])
    const d = doc as FormatsJson
    expect(exitCode).toBe(0)
    expect(d.ok).toBe(true)
    expect(d.formats.find((f) => f.id === 'heic')).toMatchObject({ read: true, write: false })
  })

  it('config path --json returns the path as data', async () => {
    const { doc } = await jsonOf(['config', 'path'])
    expect((doc as ConfigJson).config.path).toBe(join(dir, 'forge', 'config.json'))
  })

  it('a rejected config value is a JSON failure with exit 2', async () => {
    const { exitCode, doc } = await jsonOf(['config', 'set', 'theme', 'chartreuse'])
    expect(exitCode).toBe(2)
    expect((doc as RunJson).failures[0]?.code).toBe('invalid-arguments')
  })
})

describe('text and JSON are two renderings of one report', () => {
  it('names the same output paths in both', async () => {
    const dir = await makeTempDir()
    for (let i = 0; i < 2; i++) await makeJpeg(dir, `f${i}.jpg`)
    const intent = parseArgs([dir, '--to', 'webp'])
    if (intent.kind !== 'convert') throw new Error('expected a convert intent')
    const report = await runIntent(intent)
    const doc = JSON.parse(renderRun(report, { json: true, debug: false }).stdout[0] ?? '') as RunJson
    const text = renderRun(report, { json: false, debug: false }).stdout.join('\n')
    for (const output of doc.results.flatMap((r) => r.outputs)) {
      expect(text).toContain(displayPath(output, { cwd: process.cwd() }))
    }
  })
})
```

- [ ] **Step 2: Write the failing spawned JSON test**

Create `tests/cli/json-spawn.test.ts`:

```ts
import { cp, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { RunJson } from '../../src/core/report-data.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'
import { runForge } from '../helpers/run-forge.js'

const LOCKED = fileURLToPath(new URL('../fixtures/locked-hunter2.pdf', import.meta.url))

/** stdout must be exactly one JSON document on one line, and nothing else. */
function onlyDocument(stdout: string): RunJson {
  expect(stdout.endsWith('\n')).toBe(true)
  expect(stdout.trimEnd().split('\n')).toHaveLength(1)
  return JSON.parse(stdout) as RunJson
}

describe('--json from the real entry point', () => {
  it('prints one document for a conversion and nothing on stderr', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    const run = await runForge([jpg, '--to', 'webp', '--json'])
    expect(run.exitCode).toBe(0)
    expect(onlyDocument(run.stdout).ok).toBe(true)
    expect(run.stderr).toBe('')
  })

  it('reports an unknown flag as invalid-arguments JSON with exit 2', async () => {
    const run = await runForge(['a.jpg', '--bogus', '--json'])
    expect(run.exitCode).toBe(2)
    expect(onlyDocument(run.stdout).failures[0]?.code).toBe('invalid-arguments')
    expect(run.stderr).toBe('')
  })

  it('reports a bare --json (which would open the shell) as invalid-arguments', async () => {
    const run = await runForge(['--json'])
    expect(run.exitCode).toBe(2)
    expect(onlyDocument(run.stdout).failures[0]?.code).toBe('invalid-arguments')
  })

  it('reports an encrypted PDF on an open pipe as JSON, without hanging', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forge-json-'))
    const pdf = join(dir, 'locked.pdf')
    await cp(LOCKED, pdf)
    const run = await runForge([pdf, '--to', 'jpeg', '--json'], { stdin: { kind: 'open' } })
    expect(run.timedOut).toBe(false)
    expect(run.exitCode).toBe(1)
    expect(onlyDocument(run.stdout).failures[0]?.code).toBe('encrypted-source')
  })
})
```

- [ ] **Step 3: Add the args and config tests**

In `tests/cli/args.test.ts`, change the import to `import { parseArgs, wantsJson } from '../../src/cli/args.js'` and append:

```ts
describe('--json', () => {
  it('is accepted beside a conversion, --formats and config', () => {
    expect(parseArgs(['a.jpg', '--to', 'webp', '--json'])).toMatchObject({ kind: 'convert' })
    expect(parseArgs(['--formats', '--json'])).toEqual({ kind: 'formats' })
    expect(parseArgs(['config', 'path', '--json'])).toEqual({ kind: 'config', action: 'path' })
  })

  it('wantsJson reads argv, and stops at --', () => {
    expect(wantsJson(['a.jpg', '--json'])).toBe(true)
    expect(wantsJson(['a.jpg'])).toBe(false)
    expect(wantsJson(['--', '--json'])).toBe(false)
  })

  it("reports commander's own usage errors as invalid-arguments", () => {
    expect(codeOf(['a.jpg', '--bogus'])).toBe('invalid-arguments')
    expect(codeOf(['a.jpg', '--to'])).toBe('invalid-arguments')
  })
})
```

In `tests/cli/config-command.test.ts`, append:

```ts
  it('returns its facts as data for --json', async () => {
    const { config, warnings } = await runConfig({ kind: 'config', action: 'list' })
    expect(config).toEqual({
      output: '~/Desktop',
      theme: null,
      quality: 80,
      path: join(dir, 'forge', 'config.json'),
    })
    expect(warnings).toEqual([])
  })

  it('turns an unreadable config into a coded warning', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(join(dir, 'forge'), { recursive: true })
    await writeFile(join(dir, 'forge', 'config.json'), '{ not json')
    const { warnings } = await runConfig({ kind: 'config', action: 'list' })
    expect(warnings[0]?.code).toBe('config-unreadable')
  })
```

- [ ] **Step 4: Run them to confirm they fail**

Run: `npx vitest run tests/cli/json.test.ts tests/cli/json-spawn.test.ts tests/cli/args.test.ts tests/cli/config-command.test.ts`
Expected: FAIL. commander rejects `--json` as an unknown option, `wantsJson`, `runIntent` and `renderRun` are not exported, and `config`/`warnings` are undefined.

- [ ] **Step 5: Teach `args.ts` about `--json`**

In `src/cli/args.ts`:

1. Change the commander import to `import { Command, CommanderError } from 'commander'`.
2. Add above `parseArgs`:

```ts
/**
 * Whether the caller asked for JSON. It is read from argv rather than from the
 * parsed intent because it has to be known even when parsing fails: an argument
 * error is reported in the same JSON shape as everything else (spec §3.2).
 * Reading stops at `--`, after which everything is a filename.
 */
export function wantsJson(argv: string[]): boolean {
  const end = argv.indexOf('--')
  return (end === -1 ? argv : argv.slice(0, end)).includes('--json')
}
```

3. In `parseArgs`, change the config line to `if (argv[0] === 'config') return parseConfigArgs(argv.filter((a) => a !== '--json'))`.
4. In the `program` chain, add `.option('--json', 'print one JSON document on stdout instead of text')` directly after the `--password-stdin` option, and add `.configureOutput({ outputError: () => {} })` directly before `.exitOverride()`.
5. Replace `program.parse(argv, { from: 'user' })` with:

```ts
  try {
    program.parse(argv, { from: 'user' })
  } catch (e) {
    /**
     * Commander's own usage errors become Forge's, so they read like every
     * other refusal and can be reported as JSON. Commander no longer prints
     * them itself (`outputError` above). Help and version are not errors: they
     * are rethrown for src/index.ts to exit 0 on.
     */
    if (
      e instanceof CommanderError &&
      e.code !== 'commander.helpDisplayed' &&
      e.code !== 'commander.version'
    ) {
      const message = e.message.replace(/^error: /, '')
      throw invalidArguments(
        `${message.charAt(0).toUpperCase()}${message.slice(1)}.`,
        'Run forge --help to see what Forge accepts.',
      )
    }
    throw e
  }
```

- [ ] **Step 6: Return config results as data**

In `src/cli/config-command.ts`, add `import type { Warning } from '../core/types.js'`, and replace `ConfigResult` and the success returns:

```ts
export interface ConfigResult {
  stdout: string[]
  /** Always 0: a rejected value throws `invalid-arguments` instead (spec §3.4). */
  exitCode: 0
  /** The same facts as `stdout`, as data, for --json. */
  config: Record<string, string | number | null>
  warnings: Warning[]
}
```

- `path` → `return { stdout: [configPath()], exitCode: 0, config: { path: configPath() }, warnings: [] }`
- `list` → keep the `lines` logic and return

```ts
    return {
      stdout: lines,
      exitCode: 0,
      config: {
        output: prefs.defaultOutput,
        theme: prefs.theme ?? null,
        quality: prefs.quality,
        path: configPath(),
      },
      warnings: warning === undefined ? [] : [{ code: 'config-unreadable', message: warning }],
    }
```

- `set theme` → `return { stdout: [\`theme is now ${value}\`], exitCode: 0, config: { theme: value }, warnings: [] }`
- `set quality` → `return { stdout: [\`quality is now ${n}\`], exitCode: 0, config: { quality: n }, warnings: [] }`
- `set output` → `return { stdout: [\`output is now ${value}\`], exitCode: 0, config: { output: value }, warnings: [] }`

- [ ] **Step 7: Restructure `src/cli/execute.ts` around `runIntent`**

Replace the file with the following. `pageOpValues` and `buildRasterJob` are **unchanged from Task 1**: move them over verbatim, comments included. In the new runner bodies, keep every existing comment block from the branch it was moved out of, next to the same statement. The code below omits those long comments only for length. `exitCodeFor` is unchanged from Task 2.

```ts
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { ACTIONS, compressAction, convertAction, unavailableReason } from '../core/actions/index.js'
import { everyNCuts, everyPageCuts } from '../core/actions/split.js'
import { formatMatrix, rasterises } from '../core/capabilities.js'
import {
  encryptedSource,
  type ForgeError,
  invalidArguments,
  invalidPageRange,
  isForgeError,
  unsupportedCompress,
  unsupportedOperation,
} from '../core/errors.js'
import { runPlan } from '../core/execute-jobs.js'
import { looksLikeDirectory, resolveOutputPath } from '../core/output-path.js'
import { buildPlan } from '../core/plan.js'
import { configJson, errorJson, formatsJson, runJson } from '../core/report-data.js'
import { type InputFailure, resolveInputs } from '../core/resolve.js'
import type { RunSummary } from '../core/run.js'
import type { ConvertOptions, DocumentInfo, FormatId, Job, SourceInfo } from '../core/types.js'
import { openPdf } from '../engines/pdfium.js'
import { VERSION } from '../shell/theme.js'
import type { CompressIntent, ConvertIntent, Intent, PageOpIntent } from './args.js'
import type { ConfigIntent } from './config-command.js'
import { reportBatch, reportFailures, reportFormats, reportPageOp, reportSingle } from './report.js'
import { readPassword } from './stdin.js'

export interface ExecuteResult {
  exitCode: 0 | 1 | 2
  stdout: string[]
  stderr: string[]
}

export interface BatchProgress {
  /** 0 on the first call, marking the batch's start. */
  completed: number
  total: number
}

export interface ExecuteOptions {
  // onProgress and onSearch: unchanged, with their existing doc comments.
  onProgress?: (progress: BatchProgress) => void
  onSearch?: (status: string) => void
  /**
   * Render as one JSON document on stdout instead of text (spec §3.2). Under
   * --json, stdout carries exactly that document and stderr carries nothing.
   */
  json?: boolean
}

/** The intents that convert, compress or edit files: everything `runIntent` accepts. */
export type RunnableIntent = ConvertIntent | CompressIntent | PageOpIntent

/**
 * What a run did, as data. `renderRun` turns it into text or JSON, and
 * `src/mcp/tools.ts` into an MCP result. It is one object so the three cannot
 * drift. `failures` holds every refusal and failure, in the order the text
 * reporter prints them.
 */
export interface RunReport extends RunSummary {
  kind: RunnableIntent['kind']
}

// exitCodeFor — unchanged from Task 2.
// pageOpValues — unchanged.
// buildRasterJob — unchanged from Task 1.

const nothingRan = (kind: RunReport['kind'], failures: InputFailure[]): RunReport => ({
  kind,
  results: [],
  failures,
  inputBytes: 0,
  outputBytes: 0,
})

async function runPageOp(intent: PageOpIntent): Promise<RunReport> {
  const resolved = await resolveInputs(intent.inputs, { recursive: false })
  if (resolved.sources.length === 0) return nothingRan('pageop', resolved.failures)

  const action = ACTIONS.find((a) => a.id === intent.action)
  if (!action) throw new Error(`no action registered for "${intent.action}"`)

  const first = resolved.sources[0]?.path ?? ''
  if (!action.appliesTo(resolved.sources)) {
    const reason = unavailableReason(action, resolved.sources) ?? 'not available for these files'
    return nothingRan('pageop', [
      ...resolved.failures,
      { path: first, error: unsupportedOperation(intent.action, reason) },
    ])
  }

  let planned: Job[]
  try {
    planned = action.plan(resolved.sources, pageOpValues(intent, resolved.sources))
  } catch (e) {
    if (!isForgeError(e)) throw e
    return nothingRan('pageop', [...resolved.failures, { path: first, error: e }])
  }

  const outcome = await runPlan(planned, { force: intent.force })
  return {
    kind: 'pageop',
    results: outcome.results,
    failures: [...resolved.failures, ...outcome.refusals, ...outcome.failures],
    inputBytes: outcome.inputBytes,
    outputBytes: outcome.outputBytes,
  }
}

async function runCompress(intent: CompressIntent, opts: ExecuteOptions): Promise<RunReport> {
  const resolved = await resolveInputs(intent.inputs, { recursive: intent.recursive })

  const jobs: Job[] = []
  const refusals: InputFailure[] = []
  for (const source of resolved.sources) {
    if (!compressAction.appliesTo([source])) {
      refusals.push({ path: source.path, error: unsupportedCompress(source) })
      continue
    }
    const explicitFile =
      intent.output !== undefined && !looksLikeDirectory(intent.output)
        ? resolve(intent.output)
        : undefined
    const destination =
      intent.output === undefined || explicitFile !== undefined
        ? dirname(source.path)
        : dirname(
            resolveOutputPath({
              sourcePath: source.path,
              target: source.format,
              output: intent.output,
              sourceRoot: resolved.roots.get(source.path),
            }),
          )
    const [planned] = compressAction.plan([source], {
      mode: intent.maxBytes === undefined ? 'quality' : 'size',
      ...(intent.quality === undefined ? {} : { quality: intent.quality }),
      destination,
    })
    if (planned?.op !== 'convert') continue
    if (explicitFile !== undefined) planned.outputs = [explicitFile]
    if (intent.dpi !== undefined) planned.options.dpi = intent.dpi
    jobs.push(planned)
  }

  const batch = jobs.length > 1
  if (batch) opts.onProgress?.({ completed: 0, total: jobs.length })

  const outcome = await runPlan(jobs, {
    force: intent.force,
    ...(intent.concurrency === undefined ? {} : { concurrency: intent.concurrency }),
    ...(intent.maxBytes === undefined ? {} : { targetBytes: intent.maxBytes }),
    onEvent: (event) => {
      if (event.type === 'search:attempt') {
        opts.onSearch?.(
          event.rung.dpi === undefined
            ? `attempt ${event.attempt} of ${event.of}`
            : `${event.rung.dpi} dpi · attempt ${event.attempt} of ${event.of}`,
        )
        return
      }
      if (batch && (event.type === 'job:done' || event.type === 'job:error')) {
        opts.onProgress?.({ completed: event.completed, total: event.total })
      }
    },
  })

  return {
    kind: 'compress',
    results: outcome.results,
    failures: [
      ...resolved.failures,
      ...refusals,
      ...outcome.refusals,
      ...outcome.unreachable.map((u) => ({ path: u.job.sources[0].path, error: u.error })),
      ...outcome.failures,
    ],
    inputBytes: outcome.inputBytes,
    outputBytes: outcome.outputBytes,
  }
}

async function runConvert(intent: ConvertIntent, opts: ExecuteOptions): Promise<RunReport> {
  const resolved = await resolveInputs(intent.inputs, { recursive: intent.recursive })

  const isDocument = (s: SourceInfo): s is DocumentInfo =>
    s.kind === 'document' && s.format === 'pdf'
  const wantsRaster = rasterises(intent.target)
  const documentSources = wantsRaster ? resolved.sources.filter(isDocument) : []
  const otherSources = wantsRaster
    ? resolved.sources.filter((s) => !isDocument(s))
    : resolved.sources

  const documentJobs: Job[] = []
  const documentFailures: InputFailure[] = []
  for (const source of documentSources) {
    const built = await buildRasterJob(source, intent, resolved.roots.get(source.path))
    if ('failure' in built) documentFailures.push(built.failure)
    else documentJobs.push(built.job)
  }
  const plan = await buildPlan({
    resolved: { sources: otherSources, failures: [], roots: resolved.roots },
    target: intent.target,
    options: intent.options,
    force: intent.force,
    ...(intent.output === undefined ? {} : { output: intent.output }),
  })

  const allJobs = [...plan.jobs, ...documentJobs]
  const isBatch = allJobs.length > 1
  if (isBatch) opts.onProgress?.({ completed: 0, total: allJobs.length })

  const outcome = await runPlan(allJobs, {
    force: intent.force,
    ...(intent.concurrency === undefined ? {} : { concurrency: intent.concurrency }),
    onEvent: (event) => {
      if (isBatch && (event.type === 'job:done' || event.type === 'job:error')) {
        opts.onProgress?.({ completed: event.completed, total: event.total })
      }
    },
  })

  return {
    kind: 'convert',
    results: outcome.results,
    failures: [
      ...resolved.failures,
      ...documentFailures,
      ...plan.failures,
      ...outcome.refusals,
      ...outcome.failures,
    ],
    inputBytes: outcome.inputBytes,
    outputBytes: outcome.outputBytes,
  }
}

/**
 * Runs a conversion, compression or page operation and returns what happened
 * as data. It never prints and never throws a ForgeError: one that escapes is
 * reported as a command-level failure. The CLI renders the result (`renderRun`)
 * and the MCP server returns it (`src/mcp/tools.ts`).
 */
export async function runIntent(
  intent: RunnableIntent,
  opts: ExecuteOptions = {},
): Promise<RunReport> {
  try {
    if (intent.kind === 'pageop') return await runPageOp(intent)
    if (intent.kind === 'compress') return await runCompress(intent, opts)
    return await runConvert(intent, opts)
  } catch (e) {
    if (!isForgeError(e)) throw e
    return nothingRan(intent.kind, [{ path: '', error: e }])
  }
}

/** One report, rendered as text or as the §3.2 JSON document. */
export function renderRun(report: RunReport, opts: { json: boolean; debug: boolean }): ExecuteResult {
  const exitCode = exitCodeFor(report.failures)
  if (opts.json) {
    return { exitCode, stdout: [JSON.stringify(runJson(VERSION, report))], stderr: [] }
  }
  const stdout =
    report.results.length === 0
      ? []
      : report.kind === 'pageop'
        ? reportPageOp(report)
        : report.results.length === 1
          ? reportSingle(report)
          : reportBatch(report)
  return { exitCode, stdout, stderr: reportFailures(report.failures, { debug: opts.debug }) }
}

function renderCommandFailure(
  error: ForgeError,
  opts: { json: boolean; debug: boolean },
): ExecuteResult {
  const failures = [{ path: '', error }]
  const exitCode = exitCodeFor(failures)
  if (opts.json) {
    return { exitCode, stdout: [JSON.stringify(errorJson(VERSION, error))], stderr: [] }
  }
  return { exitCode, stdout: [], stderr: reportFailures(failures, { debug: opts.debug }) }
}

async function runConfigCommand(intent: ConfigIntent, json: boolean): Promise<ExecuteResult> {
  // Lazy: a plain conversion has no reason to touch the config layer at all.
  const { runConfig } = await import('./config-command.js')
  const result = await runConfig(intent)
  if (json) {
    return {
      exitCode: 0,
      stdout: [JSON.stringify(configJson(VERSION, result.config, result.warnings))],
      stderr: [],
    }
  }
  return { exitCode: 0, stdout: result.stdout, stderr: [] }
}

/**
 * Turns an Intent into an ExecuteResult: the one place that does. It never
 * prints, and never throws a ForgeError. src/index.ts writes what it returns.
 */
export async function execute(intent: Intent, opts: ExecuteOptions = {}): Promise<ExecuteResult> {
  const json = opts.json ?? false
  const debug = 'debug' in intent ? intent.debug : false
  try {
    if (intent.kind === 'config') return await runConfigCommand(intent, json)
    if (intent.kind === 'formats') {
      return json
        ? { exitCode: 0, stdout: [JSON.stringify(formatsJson(VERSION, formatMatrix()))], stderr: [] }
        : { exitCode: 0, stdout: reportFormats(), stderr: [] }
    }
    if (intent.kind === 'shell') return { exitCode: 0, stdout: [], stderr: [] }
    return renderRun(await runIntent(intent, opts), { json, debug })
  } catch (e) {
    if (!isForgeError(e)) throw e
    return renderCommandFailure(e, { json, debug })
  }
}
```

`ConfigIntent` is imported as a type from `./config-command.js`, where it is declared (`args.ts` only imports it; it does not re-export it). A type-only import is erased, so the `import('./config-command.js')` in `runConfigCommand` stays lazy.

- [ ] **Step 8: Make the entry point JSON-aware**

In `src/index.ts`:

1. Imports. Add `wantsJson` to the `./cli/args.js` import. Add `asForgeError` to the `./cli/fatal.js` import. Change the `./core/errors.js` import to `import { invalidArguments, isForgeError, renderError } from './core/errors.js'`. Add `import { errorJson } from './core/report-data.js'`. Replace `export { VERSION } from './shell/theme.js'` (and its comment, which stays above) with:

```ts
import { VERSION } from './shell/theme.js'

export { VERSION }
```

2. In `main()`, directly after `const debug = argv.includes('--debug')`, add `const json = wantsJson(argv)`.
3. At the top of the `if (intent.kind === 'shell') {` branch, add:

```ts
      // --json asks for one document on stdout. The shell is the one thing that
      // cannot produce one, so a bare `forge --json` is a usage error.
      if (json) {
        throw invalidArguments(
          'No files given.',
          'Name a file, for example: forge photo.jpg --to webp --json',
        )
      }
```

4. In the `execute(intent, { … })` call, add `json` to the options object and change both `process.stderr.isTTY` conditions to `tty`, declared just above the call as:

```ts
    // Progress and the spinner are stderr decoration for a person at a
    // terminal. Under --json they stay off entirely (spec §3.2).
    const tty = Boolean(process.stderr.isTTY) && !json
```

5. Replace the body of the `if (isForgeError(e)) { … }` block in `main()`'s catch with:

```ts
    if (isForgeError(e)) {
      if (json) process.stdout.write(`${JSON.stringify(errorJson(VERSION, e))}\n`)
      else process.stderr.write(`${renderError(e, { debug }).join('\n')}\n`)
      process.exitCode = 2
      return
    }
```

6. Replace `reportFatal` (from Task 1) with:

```ts
function reportFatal(e: unknown): void {
  const argv = process.argv.slice(2)
  if (wantsJson(argv)) {
    process.stdout.write(`${JSON.stringify(errorJson(VERSION, asForgeError(e)))}\n`)
    return
  }
  process.stderr.write(`${fatalLines(e, argv.includes('--debug')).join('\n')}\n`)
}
```

- [ ] **Step 9: Run the tests to confirm they pass**

Run: `npx vitest run tests/cli tests/index.test.ts`
Expected: PASS. This includes every existing CLI suite, `exit-codes.test.ts`, `agent-conditions.test.ts` and `report.test.ts`.

- [ ] **Step 10: Gate and commit**

Run: `npx biome check --write src tests && npm test && npm run typecheck && npm run lint`

```bash
git add src/cli/args.ts src/cli/execute.ts src/cli/config-command.ts src/index.ts \
  tests/cli/json.test.ts tests/cli/json-spawn.test.ts tests/cli/args.test.ts tests/cli/config-command.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): --json on every command

stdout carries exactly one JSON document — results with absolute paths
for every output, failures with their stable code and hint — built from
the same report the text renderer uses. Argument errors, --formats and
config answer in the same shape. execute() is now runIntent() (data)
plus renderRun() (text or JSON).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `forge probe`

Spec §3.3. It can run in parallel with Task 7.

**Files:**
- Modify: `src/cli/args.ts` (`ProbeIntent`, `parseProbeArgs`, `Intent` union, the dispatch line at the top of `parseArgs`)
- Modify: `src/cli/execute.ts` (a `probe` branch in `execute`, plus imports)
- Modify: `src/cli/report.ts` (`reportProbe`)
- Create: `tests/cli/probe.test.ts`

**Interfaces:**
- Consumes: `probeFiles`, `ProbeReport` (Task 4); `probeJson` (Task 4); `exitCodeFor` (Task 2); the `execute` structure from Task 5.
- Produces:
  - `interface ProbeIntent { kind: 'probe'; inputs: string[] }`, added to `Intent`
  - `reportProbe(probe: ProbeReport, where?: { cwd?: string; home?: string }): string[]` in `src/cli/report.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/probe.test.ts`:

```ts
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { targetIdsFor } from '../../src/core/capabilities.js'
import { isForgeError } from '../../src/core/errors.js'
import type { ProbeJson } from '../../src/core/report-data.js'
import { probe } from '../../src/engines/registry.js'
import { makeJpeg, makePdf, makeTempDir } from '../helpers/fixtures.js'
import { runForge } from '../helpers/run-forge.js'

function codeOf(argv: string[]): string {
  try {
    parseArgs(argv)
  } catch (e) {
    return isForgeError(e) ? e.code : `unexpected:${String(e)}`
  }
  return 'no-error'
}

describe('parsing forge probe', () => {
  it('takes one or more files', () => {
    expect(parseArgs(['probe', 'a.jpg', 'b.pdf'])).toEqual({
      kind: 'probe',
      inputs: ['a.jpg', 'b.pdf'],
    })
    expect(parseArgs(['probe', 'a.jpg', '--json'])).toEqual({ kind: 'probe', inputs: ['a.jpg'] })
  })

  it('refuses no files, and flags it does not take', () => {
    expect(codeOf(['probe'])).toBe('invalid-arguments')
    expect(codeOf(['probe', 'a.jpg', '--to', 'png'])).toBe('invalid-arguments')
  })
})

describe('forge probe', () => {
  it('answers --json with the §3.3 facts, from the capability graph', async () => {
    const dir = await makeTempDir()
    const pdf = await makePdf(dir, 'scan.pdf', 3)
    const out = await execute(parseArgs(['probe', pdf, '--json']), { json: true })
    expect(out.exitCode).toBe(0)
    expect(out.stdout).toHaveLength(1)
    const doc = JSON.parse(out.stdout[0] ?? '') as ProbeJson
    expect(doc.ok).toBe(true)
    expect(doc.probes[0]).toMatchObject({
      path: pdf,
      format: 'pdf',
      pages: 3,
      encrypted: false,
      targets: targetIdsFor(await probe(pdf)),
    })
  })

  it('prints the same facts as text', async () => {
    const dir = await makeTempDir()
    const pdf = await makePdf(dir, 'scan.pdf', 3)
    const out = await execute(parseArgs(['probe', pdf]))
    const text = out.stdout.join('\n')
    expect(text).toContain('PDF')
    expect(text).toContain('3 pages')
    expect(text).toContain('split')
    expect(text).toMatch(/converts to\s+.*png/)
  })

  it('exits 1 and reports a missing file, still describing the rest', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    const out = await execute(parseArgs(['probe', jpg, join(dir, 'ghost.jpg'), '--json']), {
      json: true,
    })
    const doc = JSON.parse(out.stdout[0] ?? '') as ProbeJson
    expect(out.exitCode).toBe(1)
    expect(doc.probes).toHaveLength(1)
    expect(doc.failures[0]?.code).toBe('file-not-found')
  })

  it('writes nothing', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    const before = await readdir(dir)
    await execute(parseArgs(['probe', jpg]))
    expect(await readdir(dir)).toEqual(before)
  })

  it('runs from the real entry point with stdin closed', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    const run = await runForge(['probe', jpg, '--json'])
    expect(run.exitCode).toBe(0)
    expect((JSON.parse(run.stdout) as ProbeJson).probes[0]?.format).toBe('jpeg')
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/cli/probe.test.ts`
Expected: FAIL. `parseArgs(['probe', …])` is treated as a conversion of a file called `probe`, which gives "No target format given".

- [ ] **Step 3: Parse `forge probe`**

In `src/cli/args.ts`, add after `PageOpIntent`:

```ts
/** `forge probe <files...>`: what each file is and what Forge can do with it (spec §3.3). */
export interface ProbeIntent {
  kind: 'probe'
  inputs: string[]
}
```

Add `| ProbeIntent` to the `Intent` union. Add after `parseConfigArgs`:

```ts
/**
 * Claimed before Commander for the same reason `config` is: Commander's
 * variadic `[inputs...]` would otherwise read `probe` as a filename. Probe
 * takes files and `--json` (read by `wantsJson`), and nothing else. A
 * conversion flag here is a mistake worth naming, not one to ignore.
 */
function parseProbeArgs(argv: string[]): ProbeIntent {
  const rest = argv.slice(1).filter((a) => a !== '--json')
  const flag = rest.find((a) => a.startsWith('-'))
  if (flag !== undefined) {
    throw invalidArguments(
      `forge probe takes files, not ${flag}.`,
      'Try: forge probe photo.jpg --json',
    )
  }
  if (rest.length === 0) {
    throw invalidArguments('No files given.', 'Name a file, for example: forge probe scan.pdf --json')
  }
  return { kind: 'probe', inputs: rest }
}
```

In `parseArgs`, directly after the `config` line, add `if (argv[0] === 'probe') return parseProbeArgs(argv)`.

- [ ] **Step 4: Render it**

In `src/cli/report.ts`, add `import type { ProbeReport } from '../core/probe-report.js'` and append:

```ts
/**
 * A probe as text: the same facts `--json` gives, one file per block. Formats
 * and actions are printed as their ids, which are what `--to` and the flags
 * take.
 */
export function reportProbe(probe: ProbeReport, where: Where = {}): string[] {
  const facts = [FORMATS[probe.format].label, formatBytes(probe.bytes)]
  if (probe.width !== undefined && probe.height !== undefined) {
    facts.push(`${probe.width}×${probe.height}`)
  }
  if (probe.pages !== undefined) facts.push(`${probe.pages} ${probe.pages === 1 ? 'page' : 'pages'}`)
  if (probe.encrypted) facts.push('password-protected')
  return [
    `${displayPath(probe.path, placesFor(where))} · ${facts.join(' · ')}`,
    `  converts to  ${probe.targets.join(', ')}`,
    `  actions      ${probe.actions.join(', ')}`,
  ]
}
```

- [ ] **Step 5: Dispatch it**

In `src/cli/execute.ts`, add `import { probeFiles } from '../core/probe-report.js'`, add `probeJson` to the `../core/report-data.js` import, and add `reportProbe` to the `./report.js` import. In `execute()`, directly after the `formats` branch, add:

```ts
    if (intent.kind === 'probe') {
      const { probes, failures } = await probeFiles(intent.inputs)
      const exitCode = exitCodeFor(failures)
      if (json) {
        return {
          exitCode,
          stdout: [JSON.stringify(probeJson(VERSION, { probes, failures }))],
          stderr: [],
        }
      }
      return {
        exitCode,
        stdout: probes.flatMap((p, i) => [...(i > 0 ? [''] : []), ...reportProbe(p)]),
        stderr: reportFailures(failures, { debug }),
      }
    }
```

- [ ] **Step 6: Run the tests to confirm they pass**

Run: `npx vitest run tests/cli/probe.test.ts tests/cli/args.test.ts`
Expected: PASS.

- [ ] **Step 7: Gate and commit**

Run: `npx biome check --write src tests && npm test && npm run typecheck && npm run lint`

```bash
git add src/cli/args.ts src/cli/execute.ts src/cli/report.ts tests/cli/probe.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): forge probe — what a file is and what it can become

Reports format (by content), size, pages or dimensions, encryption, and
every target and action from targetIdsFor/actionsFor, as text or
--json. Writes nothing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: MCP tools, in-process

Spec §3.5: the server and its five tools, tested over the SDK's `InMemoryTransport`. The stdio entry point is Task 8.

**Files:**
- Modify: `package.json` (via `npm install`)
- Modify: `src/cli/args.ts` (`ConvertIntent.password`)
- Modify: `src/cli/execute.ts` (`ExecuteOptions.interactive`; `buildRasterJob` uses a supplied password and never prompts when non-interactive)
- Create: `src/mcp/schemas.ts`, `src/mcp/tools.ts`, `src/mcp/server.ts`
- Create: `tests/mcp/server.test.ts`, `tests/mcp/schemas.test.ts`

**Interfaces:**
- Consumes: `runIntent`, `RunReport`, `ExecuteOptions` (Task 5); `ConvertIntent`, `CompressIntent`, `PageOpIntent` (`src/cli/args.ts`); `probeFiles` (Task 4); `formatMatrix`, `writableFormats` (`src/core/capabilities.ts`); `runJson`, `errorJson`, `probeJson`, `formatsJson`, `RunJson`, `FailureJson` (Task 4); `ACTIONS`, `rotateAction`, `splitAction`, `OptionSpec` (`src/core/actions/index.ts`); `DEFAULT_PREFERENCES` (`src/config/preferences.ts`); `parseSize` (`src/core/units.ts`); `VERSION`.
- Produces:
  - `ConvertIntent.password?: string`. It is set only by the MCP server. The CLI has no flag for it (invariant 8).
  - `ExecuteOptions.interactive?: boolean`, default `true`. When `false`, `readPassword` is never called.
  - In `src/mcp/schemas.ts`:
    - zod schemas `ProbeInput`, `FormatsInput`, `ConvertInput`, `CompressInput`, `PdfInput`, `SplitSpec`, `RunOutput`, `ProbeOutput`, `FormatsOutput`
    - the constants `TARGETS`, `PAGE_OPS`, `ROTATE_DEGREES`, `SPLIT_MODES`, `SPLIT_SPEC_MODES`
    - the types `ProbeArgs`, `ConvertArgs`, `CompressArgs`, `PdfArgs` (each `z.infer` of its input)
  - `probeTool`, `formatsTool`, `convertTool`, `compressTool`, `pdfTool`, each `(args) => Promise<CallToolResult> | CallToolResult`, in `src/mcp/tools.ts`
  - `createForgeServer(): McpServer` and `INSTRUCTIONS: string` in `src/mcp/server.ts`

- [ ] **Step 1: Add the dependencies**

```bash
npm install @modelcontextprotocol/server@^2.3.1 zod@^4.2.0
npm install -D @modelcontextprotocol/client@^2.3.1
```

Expected: `package.json` gains `"@modelcontextprotocol/server": "^2.3.1"` and `"zod": "^4.2.0"` under `dependencies`, and `"@modelcontextprotocol/client": "^2.3.1"` under `devDependencies`. If lean-and-fast §4.5 has landed, follow its rule instead: bundled packages go in `devDependencies`. Do **not** add `@modelcontextprotocol/sdk`.

- [ ] **Step 2: Write the failing server test**

Create `tests/mcp/server.test.ts`:

```ts
import { existsSync } from 'node:fs'
import { cp, mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatMatrix, targetIdsFor } from '../../src/core/capabilities.js'
import type { FormatsJson, ProbeJson, RunJson } from '../../src/core/report-data.js'
import { probe } from '../../src/engines/registry.js'
import { createForgeServer } from '../../src/mcp/server.js'
import { makeJpeg, makePdf, makeTempDir } from '../helpers/fixtures.js'

const LOCKED = fileURLToPath(new URL('../fixtures/locked-hunter2.pdf', import.meta.url))

let client: Client

beforeEach(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await createForgeServer().connect(serverSide)
  client = new Client({ name: 'forge-test', version: '0' })
  await client.connect(clientSide)
})

afterEach(async () => {
  await client.close()
})

interface ToolOutcome<T> {
  isError: boolean
  doc: T
  text: string
  links: string[]
}

async function call<T = RunJson>(name: string, args: Record<string, unknown>): Promise<ToolOutcome<T>> {
  const result = await client.callTool({ name, arguments: args })
  const content = (result.content ?? []) as { type: string; text?: string; uri?: string }[]
  return {
    isError: result.isError === true,
    doc: result.structuredContent as T,
    text: content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n'),
    links: content.filter((c) => c.type === 'resource_link').map((c) => c.uri ?? ''),
  }
}

describe('the tool list', () => {
  it('offers exactly the five tools, annotated', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'forge_compress',
      'forge_convert',
      'forge_formats',
      'forge_pdf',
      'forge_probe',
    ])
    const byName = new Map(tools.map((t) => [t.name, t]))
    expect(byName.get('forge_probe')?.annotations?.readOnlyHint).toBe(true)
    expect(byName.get('forge_convert')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    })
  })
})

describe('forge_convert', () => {
  it('converts, returns the §3.2 shape and a file:// link per output', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    const out = await call('forge_convert', { paths: [jpg], to: 'webp' })
    const webp = join(dir, 'a.webp')
    expect(out.isError).toBe(false)
    expect(out.doc.ok).toBe(true)
    expect(out.doc.results[0]?.outputs).toEqual([webp])
    expect(out.links).toEqual([pathToFileURL(webp).href])
    expect(existsSync(webp)).toBe(true)
  })

  it('never overwrites unless asked: an existing output is a tool error the model can act on', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    await call('forge_convert', { paths: [jpg], to: 'webp' })
    const again = await call('forge_convert', { paths: [jpg], to: 'webp' })
    expect(again.isError).toBe(true)
    expect(again.doc.failures[0]?.code).toBe('output-exists')
    const forced = await call('forge_convert', { paths: [jpg], to: 'webp', overwrite: true })
    expect(forced.isError).toBe(false)
  })

  it('refuses a relative path rather than resolving it against the server cwd', async () => {
    const out = await call('forge_convert', { paths: ['photo.jpg'], to: 'webp' })
    expect(out.isError).toBe(true)
    expect(out.text).toContain('absolute')
  })

  it('links a path with spaces and accents as a correctly encoded file:// URI', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'my photo é.jpg')
    const out = await call('forge_convert', { paths: [jpg], to: 'png' })
    const png = join(dir, 'my photo é.png')
    expect(out.doc.results[0]?.outputs).toEqual([png])
    expect(out.links).toEqual([pathToFileURL(png).href])
    expect(out.links[0]).toContain('my%20photo%20%C3%A9.png')
  })

  describe('an encrypted PDF', () => {
    let originalStdin: NodeJS.ReadableStream
    beforeEach(() => {
      originalStdin = process.stdin
    })
    afterEach(() => {
      Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true })
    })

    async function locked(): Promise<string> {
      const dir = await mkdtemp(join(tmpdir(), 'forge-mcp-'))
      const path = join(dir, 'locked.pdf')
      await cp(LOCKED, path)
      return path
    }

    it('without a password is refused, and stdin (the protocol) is never read', async () => {
      const explosive = new Readable({
        read() {
          this.destroy(new Error('the MCP server read stdin'))
        },
      })
      Object.defineProperty(process, 'stdin', { value: explosive, configurable: true })
      const out = await call('forge_convert', { paths: [await locked()], to: 'png' })
      expect(out.isError).toBe(true)
      expect(out.doc.failures[0]?.code).toBe('encrypted-source')
    })

    it('with the right password renders every page', async () => {
      const path = await locked()
      const out = await call('forge_convert', { paths: [path], to: 'png', password: 'hunter2' })
      expect(out.isError).toBe(false)
      expect(out.doc.results[0]?.outputs).toHaveLength(3)
      expect(out.links).toHaveLength(3)
    })

    it('with a wrong password says so, and never echoes it', async () => {
      const out = await call('forge_convert', {
        paths: [await locked()],
        to: 'png',
        password: 'not-the-password',
      })
      expect(out.isError).toBe(true)
      expect(out.doc.failures[0]?.hint).toContain("didn't open it")
      expect(JSON.stringify(out)).not.toContain('not-the-password')
    })
  })
})

describe('forge_compress', () => {
  it('compresses by quality beside the source', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    const out = await call('forge_compress', { paths: [jpg], quality: 40 })
    expect(out.isError).toBe(false)
    expect(out.doc.results[0]?.outputs).toEqual([join(dir, 'a-small.jpg')])
  })

  it('compresses to fit a size', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    const out = await call('forge_compress', { paths: [jpg], maxSize: '1mb' })
    expect(out.isError).toBe(false)
  })

  it('wants exactly one of quality or maxSize', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    expect((await call('forge_compress', { paths: [jpg], quality: 40, maxSize: '1mb' })).isError).toBe(true)
    expect((await call('forge_compress', { paths: [jpg] })).isError).toBe(true)
  })
})

describe('forge_pdf', () => {
  it('splits every page', async () => {
    const dir = await makeTempDir()
    const pdf = await makePdf(dir, 'doc.pdf', 3)
    const out = await call('forge_pdf', { op: 'split', paths: [pdf], split: { mode: 'every-page' } })
    expect(out.isError).toBe(false)
    expect(out.doc.results[0]?.outputs).toHaveLength(3)
  })

  it('merges in the order given', async () => {
    const dir = await makeTempDir()
    const a = await makePdf(dir, 'a.pdf', 1)
    const b = await makePdf(dir, 'b.pdf', 2)
    const out = await call('forge_pdf', { op: 'merge', paths: [a, b] })
    expect(out.isError).toBe(false)
    expect(out.doc.results[0]?.sources).toEqual([a, b])
  })

  it('rotates', async () => {
    const dir = await makeTempDir()
    const pdf = await makePdf(dir, 'doc.pdf', 2)
    expect((await call('forge_pdf', { op: 'rotate', paths: [pdf], degrees: 90 })).isError).toBe(false)
  })

  it('refuses extract without pages, writing nothing', async () => {
    const dir = await makeTempDir()
    const pdf = await makePdf(dir, 'doc.pdf', 2)
    const before = await readdir(dir)
    const out = await call('forge_pdf', { op: 'extract', paths: [pdf] })
    expect(out.isError).toBe(true)
    expect(out.doc.failures[0]?.code).toBe('invalid-arguments')
    expect(await readdir(dir)).toEqual(before)
  })
})

describe('forge_probe and forge_formats', () => {
  it('probes with the same facts as the CLI', async () => {
    const dir = await makeTempDir()
    const pdf = await makePdf(dir, 'doc.pdf', 3)
    const out = await call<ProbeJson>('forge_probe', { paths: [pdf] })
    expect(out.isError).toBe(false)
    expect(out.doc.probes[0]).toMatchObject({
      pages: 3,
      targets: targetIdsFor(await probe(pdf)),
    })
  })

  it('lists formats from the engines', async () => {
    const out = await call<FormatsJson>('forge_formats', {})
    expect(out.doc.formats).toEqual(formatMatrix())
  })
})
```

Create `tests/mcp/schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import {
  FormatsOutput,
  PAGE_OPS,
  ProbeOutput,
  ROTATE_DEGREES,
  RunOutput,
  SPLIT_MODES,
  SPLIT_SPEC_MODES,
  TARGETS,
} from '../../src/mcp/schemas.js'
import { writableFormats } from '../../src/core/capabilities.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

describe('MCP vocabularies come from core, never from a list here', () => {
  it('page operations are the page-op actions', () => {
    expect(PAGE_OPS).toEqual(['merge', 'split', 'extract', 'delete', 'rotate'])
  })

  it('rotation degrees are the rotate action’s choices', () => {
    expect(ROTATE_DEGREES).toEqual([90, 180, 270])
  })

  it('split modes match the split action’s choices', () => {
    expect([...SPLIT_SPEC_MODES]).toEqual(SPLIT_MODES)
  })

  it('targets are what the engines write', () => {
    expect(TARGETS).toEqual(writableFormats())
  })
})

describe('output schemas match what the CLI prints', () => {
  async function jsonOf(argv: string[]): Promise<unknown> {
    const out = await execute(parseArgs([...argv, '--json']), { json: true })
    return JSON.parse(out.stdout[0] ?? '')
  }

  it('a conversion document parses as RunOutput', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    expect(RunOutput.safeParse(await jsonOf([jpg, '--to', 'png'])).success).toBe(true)
  })

  it('a probe document parses as ProbeOutput', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    expect(ProbeOutput.safeParse(await jsonOf(['probe', jpg])).success).toBe(true)
  })

  it('the formats document parses as FormatsOutput', async () => {
    expect(FormatsOutput.safeParse(await jsonOf(['--formats'])).success).toBe(true)
  })
})
```

The `probe` case depends on Task 6. If Task 6 is not merged yet, that one test fails with "No target format given". It passes once both are on `dev`. Run it again after merging.

- [ ] **Step 3: Run them to confirm they fail**

Run: `npx vitest run tests/mcp`
Expected: FAIL. `src/mcp/server.js` and `src/mcp/schemas.js` do not resolve.

- [ ] **Step 4: Let the CLI core take a password without prompting**

In `src/cli/args.ts`, add to `ConvertIntent`:

```ts
  /**
   * An encrypted source's password, supplied directly. Only the MCP server sets
   * this, from its tool argument. The CLI has no flag for it, by design
   * (invariant 8: never from argv).
   */
  password?: string
```

In `src/cli/execute.ts`:

1. Add to `ExecuteOptions`:

```ts
  /**
   * Whether a password may be asked for (prompt or --password-stdin). Default
   * true. The MCP server passes false: its stdin is the protocol stream, so
   * reading it would corrupt the session (spec §3.5, "there is no prompt").
   */
  interactive?: boolean
```

2. In `buildRasterJob`, add `password?: string` to the `intent` parameter's type. Insert a new parameter `interactive: boolean` before `sourceRoot?: string`. Change the first line of the `if (source.encrypted)` block to:

```ts
    password =
      intent.password ??
      (interactive ? await readPassword({ stdin: intent.passwordStdin ?? false }) : undefined)
```

3. In `runConvert`, change the call to `buildRasterJob(source, intent, opts.interactive ?? true, resolved.roots.get(source.path))`.

- [ ] **Step 5: Create `src/mcp/schemas.ts`**

```ts
import { isAbsolute } from 'node:path'
import * as z from 'zod'
import type { PageOpIntent } from '../cli/args.js'
import { DEFAULT_PREFERENCES } from '../config/preferences.js'
import { ACTIONS, type OptionSpec, rotateAction, splitAction } from '../core/actions/index.js'
import { writableFormats } from '../core/capabilities.js'
import type { DocumentInfo, FormatId } from '../core/types.js'

/**
 * Input and output schemas for the five tools, each written once (spec §3.5).
 * Wherever an option already exists as an `OptionSpec` in `core/actions/`,
 * the allowed values are read from it. That way the shell, the CLI and MCP
 * cannot offer different choices.
 */

function selectValues(specs: OptionSpec[], id: string): string[] {
  const spec = specs.find((s) => s.id === id)
  if (spec?.kind !== 'select') throw new Error(`no select option "${id}"`)
  return spec.choices.map((c) => c.value)
}

/**
 * A stand-in PDF. It exists only so `splitAction.options()` will describe its
 * modes. It is never planned or run.
 */
const ANY_PDF: DocumentInfo = {
  kind: 'document',
  path: '/forge.pdf',
  format: 'pdf',
  bytes: 0,
  pages: 2,
  encrypted: false,
}

/** Every format some engine writes (invariant 2). */
export const TARGETS = writableFormats() as [FormatId, ...FormatId[]]

/** The page operations: every action except the two that are not about pages. */
export const PAGE_OPS = ACTIONS.map((a) => a.id).filter(
  (id) => id !== 'convert' && id !== 'compress',
) as [PageOpIntent['action'], ...PageOpIntent['action'][]]

export const ROTATE_DEGREES = selectValues(
  rotateAction.options([ANY_PDF], {}, DEFAULT_PREFERENCES),
  'degrees',
).map(Number)

export const SPLIT_MODES = selectValues(
  splitAction.options([ANY_PDF], {}, DEFAULT_PREFERENCES),
  'mode',
)

/**
 * The split modes this schema can express. Each mode carries its own fields,
 * so the union is written out, and `tests/mcp/schemas.test.ts` holds it equal
 * to `SPLIT_MODES`.
 */
export const SPLIT_SPEC_MODES = ['every-page', 'every-n', 'points'] as const

const absolutePath = z
  .string()
  .refine(isAbsolute, 'must be an absolute path')
  .describe('An absolute path.')

const paths = z.array(absolutePath).min(1)

export const SplitSpec = z
  .discriminatedUnion('mode', [
    z.object({ mode: z.literal('every-page') }),
    z.object({ mode: z.literal('every-n'), n: z.number().int().min(1) }),
    z.object({
      mode: z.literal('points'),
      after: z.array(z.number().int().min(1)).min(1).describe('Cut after these pages (1-based).'),
    }),
  ])
  .describe('How to split: every page, every N pages, or after the given pages.')

export const ProbeInput = z.object({
  paths: paths.describe('Absolute paths of files (or folders) to inspect.'),
})

export const FormatsInput = z.object({})

export const ConvertInput = z.object({
  paths: paths.describe('Absolute paths of files, folders or globs to convert.'),
  to: z.enum(TARGETS).describe('Target format id. Use "jpeg" for JPG.'),
  output: absolutePath
    .optional()
    .describe('A folder (or, for one input, a file) to write to. Default: beside each source.'),
  quality: z.number().int().min(1).max(100).optional().describe('For lossy targets, 1-100.'),
  dpi: z.number().int().min(36).max(600).optional().describe('PDF → image resolution. Default 150.'),
  pages: z.string().optional().describe('PDF → image page selection, e.g. "3-7,12". Default all.'),
  background: z
    .string()
    .optional()
    .describe('Fill colour when transparency must be flattened. Default #ffffff.'),
  keepMetadata: z.boolean().optional().describe('Keep EXIF and GPS data. Default false.'),
  password: z.string().optional().describe('Password for an encrypted PDF. Never echoed back.'),
  overwrite: z
    .boolean()
    .optional()
    .describe('Replace existing outputs. Default false — only when the user asked.'),
  recursive: z.boolean().optional().describe('Descend into subfolders of a folder input.'),
})

export const CompressInput = z
  .object({
    paths: paths.describe('Absolute paths of files to compress.'),
    quality: z.number().int().min(1).max(100).optional().describe('Compress to this quality.'),
    maxSize: z.string().optional().describe('Compress until it fits, e.g. "500kb" or "2mb".'),
    dpi: z.number().int().min(36).max(600).optional().describe('For a PDF: image resolution.'),
    output: absolutePath.optional().describe('A folder or file to write to.'),
    overwrite: z.boolean().optional().describe('Replace existing outputs. Default false.'),
  })
  .refine((a) => (a.quality === undefined) !== (a.maxSize === undefined), {
    message: 'Give exactly one of quality or maxSize.',
  })

export const PdfInput = z.object({
  op: z.enum(PAGE_OPS).describe('The page operation.'),
  paths: paths.describe('Absolute PDF paths. merge takes two or more, in order; the others take one.'),
  pages: z.string().optional().describe('extract / delete: which pages, e.g. "3-7,12".'),
  separate: z.boolean().optional().describe('extract: one file per page.'),
  degrees: z.literal(ROTATE_DEGREES).optional().describe('rotate: degrees clockwise.'),
  split: SplitSpec.optional(),
  overwrite: z.boolean().optional().describe('Replace existing outputs. Default false.'),
})

export type ProbeArgs = z.infer<typeof ProbeInput>
export type ConvertArgs = z.infer<typeof ConvertInput>
export type CompressArgs = z.infer<typeof CompressInput>
export type PdfArgs = z.infer<typeof PdfInput>

// Outputs: the §3.2 / §3.3 documents. Strict, so that a field added in
// report-data.ts without being added here fails tests/mcp/schemas.test.ts
// rather than a client.
const FailureOut = z.strictObject({
  path: z.string().optional(),
  code: z.string(),
  title: z.string(),
  detail: z.string(),
  hint: z.string().optional(),
})

const ResultOut = z.strictObject({
  op: z.string(),
  source: z.string(),
  sources: z.array(z.string()),
  outputs: z.array(z.string()),
  inputBytes: z.number(),
  outputBytes: z.number(),
  warnings: z.array(z.strictObject({ code: z.string(), message: z.string() })),
})

export const RunOutput = z.strictObject({
  forge: z.string(),
  ok: z.boolean(),
  results: z.array(ResultOut),
  failures: z.array(FailureOut),
})

export const ProbeOutput = z.strictObject({
  forge: z.string(),
  ok: z.boolean(),
  probes: z.array(
    z.strictObject({
      path: z.string(),
      kind: z.enum(['image', 'document']),
      format: z.string(),
      bytes: z.number(),
      width: z.number().optional(),
      height: z.number().optional(),
      pages: z.number().optional(),
      encrypted: z.boolean().optional(),
      targets: z.array(z.string()),
      actions: z.array(z.string()),
    }),
  ),
  failures: z.array(FailureOut),
})

export const FormatsOutput = z.strictObject({
  forge: z.string(),
  ok: z.boolean(),
  formats: z.array(
    z.strictObject({
      id: z.string(),
      label: z.string(),
      extensions: z.array(z.string()),
      read: z.boolean(),
      write: z.boolean(),
      lossy: z.boolean(),
    }),
  ),
  failures: z.array(FailureOut),
})
```

- [ ] **Step 6: Create `src/mcp/tools.ts`**

```ts
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/server'
import type { CompressIntent, ConvertIntent, PageOpIntent } from '../cli/args.js'
import { type RunReport, runIntent } from '../cli/execute.js'
import { formatMatrix } from '../core/capabilities.js'
import { type ForgeError, invalidArguments } from '../core/errors.js'
import { probeFiles } from '../core/probe-report.js'
import {
  errorJson,
  type FailureJson,
  formatsJson,
  probeJson,
  type RunJson,
  runJson,
} from '../core/report-data.js'
import { parseSize } from '../core/units.js'
import { VERSION } from '../shell/theme.js'
import type { CompressArgs, ConvertArgs, PdfArgs, ProbeArgs } from './schemas.js'

/**
 * The server's stdin is the protocol. Nothing a tool runs may prompt or read
 * it. An encrypted PDF takes the `password` argument or is refused.
 */
const NO_PROMPT = { interactive: false } as const

function failureLine(f: FailureJson): string {
  const where = f.path === undefined ? '' : ` (${f.path})`
  const hint = f.hint === undefined ? '' : ` ${f.hint}`
  return `✕ ${f.title}${where}: ${f.detail}${hint}`
}

/**
 * Spec §3.5: `structuredContent` in the §3.2 shape, a text summary, and a
 * `resource_link` per output. It never returns file contents. `isError` is set
 * when anything failed, and the same document still says what did succeed.
 */
function runResult(doc: RunJson): CallToolResult {
  const lines = doc.results.map((r) => `✓ ${r.source} → ${r.outputs.join(', ')}`)
  lines.push(...doc.failures.map(failureLine))
  const links = doc.results
    .flatMap((r) => r.outputs)
    .map((output) => ({
      type: 'resource_link' as const,
      uri: pathToFileURL(output).href,
      name: basename(output),
    }))
  return {
    content: [{ type: 'text', text: lines.join('\n') || 'Nothing to do.' }, ...links],
    structuredContent: { ...doc },
    isError: !doc.ok,
  }
}

const fromReport = (report: RunReport): CallToolResult => runResult(runJson(VERSION, report))
const refuse = (error: ForgeError): CallToolResult => runResult(errorJson(VERSION, error))

export async function probeTool(args: ProbeArgs): Promise<CallToolResult> {
  const doc = probeJson(VERSION, await probeFiles(args.paths))
  const lines = doc.probes.map((p) => {
    const size = p.pages === undefined ? `${p.width}×${p.height}` : `${p.pages} pages`
    return `${p.path}: ${p.format}, ${p.bytes} bytes, ${size}${p.encrypted ? ', password-protected' : ''}. Can become: ${p.targets.join(', ')}. Actions: ${p.actions.join(', ')}.`
  })
  lines.push(...doc.failures.map(failureLine))
  return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: { ...doc }, isError: !doc.ok }
}

export function formatsTool(): CallToolResult {
  const doc = formatsJson(VERSION, formatMatrix())
  const text = doc.formats
    .map((f) => {
      const can = f.read && f.write ? 'read and write' : f.read ? 'read only' : 'write only'
      return `${f.id} (${f.extensions.join(' ')}): ${can}`
    })
    .join('\n')
  return { content: [{ type: 'text', text }], structuredContent: { ...doc } }
}

export async function convertTool(args: ConvertArgs): Promise<CallToolResult> {
  const intent: ConvertIntent = {
    kind: 'convert',
    inputs: args.paths,
    target: args.to,
    options: {
      background: args.background ?? '#ffffff',
      keepMetadata: args.keepMetadata ?? false,
      ...(args.quality === undefined ? {} : { quality: args.quality }),
    },
    force: args.overwrite ?? false,
    recursive: args.recursive ?? false,
    debug: false,
    dpi: args.dpi ?? 150,
    passwordStdin: false,
    ...(args.output === undefined ? {} : { output: args.output }),
    ...(args.pages === undefined ? {} : { pages: args.pages }),
    ...(args.password === undefined ? {} : { password: args.password }),
  }
  return fromReport(await runIntent(intent, NO_PROMPT))
}

export async function compressTool(args: CompressArgs): Promise<CallToolResult> {
  const intent: CompressIntent = {
    kind: 'compress',
    inputs: args.paths,
    options: { background: '#ffffff', keepMetadata: false },
    force: args.overwrite ?? false,
    recursive: false,
    debug: false,
  }
  if (args.quality !== undefined) intent.quality = args.quality
  if (args.maxSize !== undefined) {
    const maxBytes = parseSize(args.maxSize)
    if (maxBytes === undefined) {
      return refuse(
        invalidArguments(
          `${args.maxSize} is not a size.`,
          'Try a number with a unit, for example 500kb, 2mb or 1.5mb.',
        ),
      )
    }
    intent.maxBytes = maxBytes
  }
  if (args.dpi !== undefined) intent.dpi = args.dpi
  if (args.output !== undefined) intent.output = args.output
  return fromReport(await runIntent(intent, NO_PROMPT))
}

/**
 * Builds the same `PageOpIntent` that `cli/args.ts` builds from flags. The
 * per-operation requirements it checks are the ones `parseArgs` enforces, and
 * they are reported in the same `invalid-arguments` shape.
 */
export async function pdfTool(args: PdfArgs): Promise<CallToolResult> {
  const intent: PageOpIntent = {
    kind: 'pageop',
    action: args.op,
    inputs: args.paths,
    force: args.overwrite ?? false,
    debug: false,
  }
  if (args.op === 'extract' || args.op === 'delete') {
    if (args.pages === undefined) {
      return refuse(invalidArguments(`${args.op} needs pages, for example "3-7,12".`))
    }
    intent.pages = args.pages
    if (args.op === 'extract' && args.separate === true) intent.separate = true
  }
  if (args.op === 'rotate') {
    if (args.degrees === undefined) {
      return refuse(invalidArguments('rotate needs degrees: 90, 180 or 270.'))
    }
    intent.rotate = args.degrees
  }
  if (args.op === 'split') {
    if (args.split === undefined) {
      return refuse(invalidArguments('split needs a split mode: every-page, every-n or points.'))
    }
    intent.split = args.split
  }
  return fromReport(await runIntent(intent, NO_PROMPT))
}
```

- [ ] **Step 7: Create `src/mcp/server.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/server'
import { VERSION } from '../shell/theme.js'
import {
  CompressInput,
  ConvertInput,
  FormatsInput,
  FormatsOutput,
  PdfInput,
  ProbeInput,
  ProbeOutput,
  RunOutput,
} from './schemas.js'
import { compressTool, convertTool, formatsTool, pdfTool, probeTool } from './tools.js'

/** What a client tells its model about Forge as a whole. */
export const INSTRUCTIONS = [
  'Forge converts, compresses and edits files on this Mac, locally.',
  'Every path must be absolute.',
  'Call forge_probe first: it says what a file is, every format it can become, and every action that applies.',
  'Nothing is overwritten unless you pass overwrite: true — only do that when the user asked to replace a file.',
  'A failure hint that mentions --force means overwrite: true here; --output means the output argument.',
].join(' ')

const READS = { readOnlyHint: true, openWorldHint: false } as const

/**
 * These tools write new files but never replace one unless the call passes
 * overwrite: true, so they are marked non-destructive by default (spec §3.5).
 */
const WRITES = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const

/**
 * Forge's MCP server, with five tools on purpose. A 57-tool ImageMagick server
 * is the cautionary example of flooding an agent's context (spec §3.5). Tools
 * call core in-process; nothing here spawns the CLI.
 */
export function createForgeServer(): McpServer {
  const server = new McpServer({ name: 'forge', version: VERSION }, { instructions: INSTRUCTIONS })

  server.registerTool(
    'forge_probe',
    {
      title: 'Inspect files',
      description:
        'What each file is and what Forge can do with it: format (read from content, not the extension), size, pages or dimensions, whether it is password-protected, every format it can become, and every action that applies. Writes nothing.',
      inputSchema: ProbeInput,
      outputSchema: ProbeOutput,
      annotations: READS,
    },
    (args) => probeTool(args),
  )

  server.registerTool(
    'forge_formats',
    {
      title: 'List formats',
      description: 'Every format Forge reads and writes. Writes nothing.',
      inputSchema: FormatsInput,
      outputSchema: FormatsOutput,
      annotations: READS,
    },
    () => formatsTool(),
  )

  server.registerTool(
    'forge_convert',
    {
      title: 'Convert files',
      description:
        'Convert files to another format, beside each source unless output is given. A PDF becomes one image per page (choose pages and dpi); Word documents become PDF; images convert between formats. Returns every output path and a file:// link to each.',
      inputSchema: ConvertInput,
      outputSchema: RunOutput,
      annotations: WRITES,
    },
    (args) => convertTool(args),
  )

  server.registerTool(
    'forge_compress',
    {
      title: 'Compress files',
      description:
        'Make files smaller without changing their format: by quality (1-100) or to fit a size such as "500kb". Writes <name>-small.<ext> beside the source unless output is given. A lossless format such as PNG cannot be compressed; convert it instead.',
      inputSchema: CompressInput,
      outputSchema: RunOutput,
      annotations: WRITES,
    },
    (args) => compressTool(args),
  )

  server.registerTool(
    'forge_pdf',
    {
      title: 'PDF page operations',
      description:
        'merge (two or more PDFs, in order), split, extract, delete or rotate pages. Writes new files beside the source and never edits the original. Password-protected PDFs are refused.',
      inputSchema: PdfInput,
      outputSchema: RunOutput,
      annotations: WRITES,
    },
    (args) => pdfTool(args),
  )

  return server
}
```

- [ ] **Step 8: Run the tests to confirm they pass**

Run: `npx vitest run tests/mcp tests/cli`
Expected: PASS. The one exception is `schemas.test.ts › a probe document parses as ProbeOutput` if Task 6 is not merged yet (see Step 2).

- [ ] **Step 9: Gate and commit**

Run: `npx biome check --write src tests && npm test && npm run typecheck && npm run lint`

```bash
git add package.json package-lock.json src/cli/args.ts src/cli/execute.ts src/mcp tests/mcp
git commit -m "$(cat <<'EOF'
feat(mcp): five Forge tools on the MCP server SDK

forge_probe, forge_formats, forge_convert, forge_compress and forge_pdf
build the same intents as the CLI and call runIntent in-process. Results
are structuredContent in the --json shape plus a file:// resource link
per output. Nothing is overwritten without overwrite: true, and an
encrypted PDF takes a password argument — the server never prompts.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `forge mcp` over stdio

Spec §3.5: the stdio entry point, stdout hygiene, and exit on EOF.

**Files:**
- Create: `src/mcp/stdout-guard.ts`
- Modify: `src/mcp/server.ts` (add `runMcpServer`)
- Modify: `src/index.ts` (the `mcp` dispatch, before `parseArgs`)
- Create: `tests/mcp/stdout-guard.test.ts`, `tests/mcp/stdio.test.ts`

**Interfaces:**
- Consumes: `createForgeServer()` (Task 7); `StdioServerTransport` from `@modelcontextprotocol/server/stdio`; `invalidArguments`.
- Produces:
  - `claimStdout(out?: NodeJS.WriteStream, err?: NodeJS.WriteStream): Writable` in `src/mcp/stdout-guard.ts`
  - `runMcpServer(args: string[]): Promise<void>` in `src/mcp/server.ts`. It resolves once the server is connected. The process then lives until stdin reaches EOF. Any argument throws `invalid-arguments`.

- [ ] **Step 1: Write the failing tests**

Create `tests/mcp/stdout-guard.test.ts`:

```ts
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { claimStdout } from '../../src/mcp/stdout-guard.js'

describe('claimStdout', () => {
  it('keeps the real stdout for the protocol and sends every other write to stderr', async () => {
    const out = new PassThrough()
    const err = new PassThrough()
    const outText: string[] = []
    const errText: string[] = []
    out.on('data', (d) => outText.push(String(d)))
    err.on('data', (d) => errText.push(String(d)))

    const protocol = claimStdout(
      out as unknown as NodeJS.WriteStream,
      err as unknown as NodeJS.WriteStream,
    )
    // What a stray console.log in a dependency does: write to process.stdout.
    out.write('stray\n')
    await new Promise<void>((resolve) => protocol.write('{"jsonrpc":"2.0"}\n', () => resolve()))

    expect(outText.join('')).toBe('{"jsonrpc":"2.0"}\n')
    expect(errText.join('')).toBe('stray\n')
  })
})
```

Create `tests/mcp/stdio.test.ts`:

```ts
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RunJson } from '../../src/core/report-data.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'
import { runForge } from '../helpers/run-forge.js'

const tsx = join(process.cwd(), 'node_modules', '.bin', 'tsx')
const entry = join(process.cwd(), 'src', 'index.ts')

interface RpcMessage {
  jsonrpc?: string
  id?: number
  result?: { protocolVersion?: string; isError?: boolean; structuredContent?: RunJson }
}

async function waitFor<T>(find: () => T | undefined, timeoutMs = 15_000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const found = find()
    if (found !== undefined) return found
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for the server')
    await new Promise((r) => setTimeout(r, 20))
  }
}

function startMcp() {
  const child = spawn(tsx, [entry, 'mcp'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const lines: string[] = []
  let partial = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    partial += chunk
    let nl = partial.indexOf('\n')
    while (nl !== -1) {
      lines.push(partial.slice(0, nl))
      partial = partial.slice(nl + 1)
      nl = partial.indexOf('\n')
    }
  })
  child.stderr.resume()
  const exited = new Promise<number | null>((resolve) => child.on('close', resolve))
  const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`)
  const response = (id: number) =>
    waitFor(() =>
      lines.map((l) => JSON.parse(l) as RpcMessage).find((m) => m.id === id),
    )
  return { child, lines, send, response, exited, unterminated: () => partial }
}

describe('forge mcp over stdio', () => {
  it('speaks only protocol on stdout, converts a file, and exits when stdin closes', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    const mcp = startMcp()

    mcp.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '0' } },
    })
    expect((await mcp.response(1)).result?.protocolVersion).toBe('2025-11-25')
    mcp.send({ jsonrpc: '2.0', method: 'notifications/initialized' })

    mcp.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'forge_convert', arguments: { paths: [jpg], to: 'webp' } },
    })
    const call = await mcp.response(2)
    expect(call.result?.isError).toBeFalsy()
    expect(call.result?.structuredContent?.results[0]?.outputs).toEqual([join(dir, 'a.webp')])

    mcp.child.stdin.end()
    const code = await Promise.race([
      mcp.exited,
      new Promise<'hung'>((r) => setTimeout(() => r('hung'), 10_000)),
    ])
    expect(code).toBe(0)

    // Nothing but protocol messages reached stdout (spec §5).
    for (const line of mcp.lines) expect(JSON.parse(line)).toMatchObject({ jsonrpc: '2.0' })
    expect(mcp.unterminated()).toBe('')
  })

  it('refuses arguments with exit 2', async () => {
    const run = await runForge(['mcp', '--port', '3000'])
    expect(run.exitCode).toBe(2)
    expect(run.stderr).toContain('takes no arguments')
    expect(run.stdout).toBe('')
  })
})
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npx vitest run tests/mcp/stdout-guard.test.ts tests/mcp/stdio.test.ts`
Expected: FAIL. `stdout-guard.js` does not resolve. `forge mcp` is parsed as a conversion of a file named `mcp` ("No target format given", exit 2), so no `initialize` response ever arrives.

- [ ] **Step 3: Create `src/mcp/stdout-guard.ts`**

```ts
import { Writable } from 'node:stream'

/**
 * Claims stdout for the protocol (spec §3.5: stdout belongs to the protocol).
 *
 * It returns a stream that writes to the real stdout, for the transport.
 * After this call, anything else that writes to `out` lands on `err` instead:
 * a `console.log` in a dependency, or an emscripten `print` from the pdfium
 * wasm. One stray line on stdout would corrupt the JSON-RPC stream and end
 * the session. Invariant 1 already keeps core/ and engines/ silent. This
 * guards against libraries.
 */
export function claimStdout(
  out: NodeJS.WriteStream = process.stdout,
  err: NodeJS.WriteStream = process.stderr,
): Writable {
  const write = out.write.bind(out)
  out.write = err.write.bind(err) as typeof out.write
  return new Writable({
    write(chunk, encoding, callback) {
      write(chunk, encoding, callback)
    },
  })
}
```

- [ ] **Step 4: Add `runMcpServer`**

In `src/mcp/server.ts`, add imports:

```ts
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { invalidArguments } from '../core/errors.js'
import { claimStdout } from './stdout-guard.js'
```

and append:

```ts
/**
 * `forge mcp`: serves the tools over stdio until the client hangs up.
 *
 * It uses `StdioServerTransport`, a 2025-era server. With Claude Code 2.1.292
 * it negotiates protocol 2025-11-25, which is what Claude Code asks for (see
 * the plan's verified SDK facts). The transport closes itself on stdin EOF.
 * Nothing else holds the event loop, so the process then exits 0 on its own,
 * after any response already written has flushed.
 */
export async function runMcpServer(args: string[]): Promise<void> {
  if (args.length > 0) {
    throw invalidArguments(
      `forge mcp takes no arguments, got: ${args.join(' ')}.`,
      'Register it with your agent, for example: claude mcp add forge -- forge mcp',
    )
  }
  const protocol = claimStdout()
  await createForgeServer().connect(new StdioServerTransport(process.stdin, protocol))
}
```

- [ ] **Step 5: Route `forge mcp` in the entry point**

In `src/index.ts`, inside `main()`'s `try`, as the first statement (before `const intent = parseArgs(argv)`), add:

```ts
    /**
     * `forge mcp` is a server, not a command. It owns stdin and stdout until
     * the client hangs up, so it is routed before argument parsing and never
     * reaches execute(). The import is lazy, so no other command loads the
     * MCP SDK (spec §3.5).
     */
    if (argv[0] === 'mcp') {
      const { runMcpServer } = await import('./mcp/server.js')
      await runMcpServer(argv.slice(1))
      return
    }
```

`main()` resolves once the server is connected, which marks it settled for `guardUnsettled`. The open stdin keeps the process alive from then on.

- [ ] **Step 6: Run the tests to confirm they pass**

Run: `npx vitest run tests/mcp tests/index.test.ts tests/cli/agent-conditions.test.ts`
Expected: PASS.

- [ ] **Step 7: Check by hand that no other command loads the SDK**

Run: `grep -rn "mcp/" src | grep -v "^src/mcp/"`
Expected: the only match outside `src/mcp/` is the dynamic `import('./mcp/server.js')` in `src/index.ts`. If lean-and-fast's module-load guard test exists (spec §7, "--version does not load sharp…"), add `'@modelcontextprotocol/server'` and `'zod'` to its list of modules that must not load. That is a one-line edit to that test.

- [ ] **Step 8: Gate and commit**

Run: `npx biome check --write src tests && npm test && npm run typecheck && npm run lint`

```bash
git add src/mcp/stdout-guard.ts src/mcp/server.ts src/index.ts tests/mcp/stdout-guard.test.ts tests/mcp/stdio.test.ts
git commit -m "$(cat <<'EOF'
feat(mcp): forge mcp — a local MCP server over stdio

Lazily imported only by `forge mcp`. stdout is claimed for the protocol
and stray library output goes to stderr; the server exits when stdin
closes. Negotiates protocol 2025-11-25 with current Claude Code.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Agent docs: skill, README, help

Spec §3.6 and §6.4. Written last, against what shipped.

**Files:**
- Create: `skills/forge/SKILL.md`
- Modify: `README.md` (a new `## Use with AI agents` section after `## Usage`'s subsections, before `## Interactive shell`; plus the Architecture tree and the Testing count line)
- Modify: `src/cli/args.ts` (`COMMANDS_HELP`, used in the existing `.addHelpText` call)
- Create: `tests/docs/skill.test.ts`
- Modify: `tests/index.test.ts`

**Interfaces:**
- Consumes: everything above, as shipped.
- Produces: `COMMANDS_HELP: string` exported from `src/cli/args.ts`.

- [ ] **Step 1: Write the failing tests**

Create `tests/docs/skill.test.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('skills/forge/SKILL.md', () => {
  it('has Agent Skills frontmatter and teaches the agent contract', async () => {
    const text = await readFile(join(process.cwd(), 'skills', 'forge', 'SKILL.md'), 'utf8')
    const front = text.match(/^---\n([\s\S]*?)\n---\n/)
    expect(front?.[1]).toMatch(/^name: forge$/m)
    expect(front?.[1]).toMatch(/^description: .{40,}$/m)
    for (const needle of ['forge probe', '--json', 'Exit codes', '--force', '--password-stdin']) {
      expect(text).toContain(needle)
    }
  })
})
```

In `tests/index.test.ts`, inside `describe('CLI exit codes', …)`, add:

```ts
  it('names probe, config and mcp in --help', async () => {
    const result = await spawn(['--help'])
    expect(result.stdout).toContain('forge probe')
    expect(result.stdout).toContain('forge mcp')
  })
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npx vitest run tests/docs/skill.test.ts tests/index.test.ts`
Expected: FAIL. The file does not exist, and `--help` does not mention probe.

- [ ] **Step 3: Add the commands to `--help`**

In `src/cli/args.ts`, add next to `EXIT_CODES_HELP`:

```ts
/** The subcommands Commander does not know about, because `parseArgs` claims them first. */
export const COMMANDS_HELP = `
Other commands:
  forge probe <files...>   what each file is and what Forge can do with it
  forge config [list | path | set <setting> <value>]
  forge mcp                run as a local MCP server over stdio, for AI agents`
```

and change `.addHelpText('after', EXIT_CODES_HELP)` to `.addHelpText('after', \`${COMMANDS_HELP}\n${EXIT_CODES_HELP}\`)`.

- [ ] **Step 4: Write the skill**

Create `skills/forge/SKILL.md`:

````markdown
---
name: forge
description: Convert, compress and edit local files on macOS with the Forge CLI (`forge`) — images (HEIC, JPEG, PNG, WebP, AVIF, GIF, TIFF), PDFs and Word documents. Use when the user wants a file in another format, smaller or under a size, or a PDF merged, split, trimmed or rotated, and `forge` is installed (`npm i -g forge-terminal`).
---

# Forge

Forge converts files on this Mac. Nothing is uploaded.

## Always

1. **Probe first.** `forge probe <file> --json`. `targets` lists every format the
   file can become. `actions` lists what else applies (`compress`, `split`,
   `extract`, …). Use these lists; do not guess.
2. **Pass `--json`.** stdout is then exactly one JSON document. Read `ok`,
   `results[].outputs` (the absolute path of every file written), and
   `failures[]` (`code`, `detail`, `hint`).
3. **Read the exit code.**

   | Exit codes | Meaning | Do |
   | --- | --- | --- |
   | 0 | every input succeeded | report `results[].outputs` |
   | 1 | understood, but an input failed or was refused | read `failures`, act on `code`/`hint` |
   | 2 | the command itself was invalid | fix the flags (`failures[0].code` is `invalid-arguments`) |

4. **Never pass `--force` unless the user asked to replace files.** Without it,
   Forge refuses with `output-exists` and writes nothing. Tell the user, or
   choose another `-o`.

## Commands

```bash
forge photo.heic --to jpeg --json                 # convert
forge ~/Pictures/trip --to webp -o ~/Desktop/web/ --json   # a folder
forge photo.jpg --quality 60 --json               # compress, same format
forge photo.jpg --max-size 500kb --json           # compress to fit
forge scan.pdf --max-size 2mb --json              # a PDF with images
forge doc.pdf --to png --pages 1-3 --dpi 150 --json   # PDF pages → images
forge report.docx --to pdf --json
forge a.pdf b.pdf --merge --json
forge doc.pdf --split every-page --json           # or every=N, at=3,7
forge doc.pdf --extract 3-7,12 --json             # --separate: one file per page
forge doc.pdf --delete 2 --json
forge doc.pdf --rotate 90 --json
forge --formats --json
```

Outputs go beside the source unless `-o` names a folder (or, for one file,
a filename). Page operations always write beside the source and never edit it.

## Encrypted PDFs

Forge never prompts when there is no terminal. Send the password on stdin,
one line:

```bash
printf '%s\n' "$PASSWORD" | forge locked.pdf --to png --password-stdin --json
```

Never put a password in an argument. Only rendering to images works on an
encrypted PDF; page operations and compression refuse it (`encrypted-source`).

## Failure codes worth knowing

- `output-exists`: ask before re-running with `--force`.
- `unsupported-target`: pick from the probe's `targets`.
- `target-unreachable`: the smallest possible is still too big. Try a larger size or another format.
- `unsupported-compress`: lossless (PNG) or a PDF with no images. Convert instead.
- `unsupported-operation`: that page operation does not fit those files (merge needs two or more PDFs).
- `encrypted-source`: a password is needed, or the one given was wrong.

## MCP

If a `forge` MCP server is connected (tools `forge_probe`, `forge_formats`,
`forge_convert`, `forge_compress`, `forge_pdf`), prefer it. It takes absolute
paths and returns the same JSON as `structuredContent`. It never overwrites
unless you pass `overwrite: true`.
````

- [ ] **Step 5: Write the README section**

In `README.md`, insert this before `## Interactive shell`:

````markdown
## Use with AI agents

Tell an agent *"take this image and use Forge on it"* and it can: Forge is
local, private, and built to be driven without a person at the keyboard.

### As an MCP server

```bash
claude mcp add forge -- forge mcp     # Claude Code
codex mcp add forge -- forge mcp      # Codex / ChatGPT desktop's Codex
```

Claude Desktop and Cursor:

```json
{ "mcpServers": { "forge": { "command": "forge", "args": ["mcp"] } } }
```

Five tools, deliberately few:

| Tool | Does |
| --- | --- |
| `forge_probe` | what files are and what Forge can do with them |
| `forge_formats` | the capability matrix |
| `forge_convert` | convert to a target format (quality, dpi, pages, background, password) |
| `forge_compress` | compress by quality or to a target size |
| `forge_pdf` | `merge`, `split`, `extract`, `delete`, `rotate` |

Paths must be absolute. Results come back as structured content in the
`--json` shape below, with a `file://` link to every output, and never as
file contents. Nothing is overwritten unless the call passes
`overwrite: true`. An encrypted PDF takes a `password` argument; there is no
prompt. The server speaks MCP protocol revision 2025-11-25 over stdio and
exits when its client closes stdin.

**Limitation:** an image pasted into a chat app is not a file on disk, so a
path-based tool cannot see it. Agents with file access (Claude Code, Cursor,
Codex) are the natural fit.

### As a CLI, with the skill

[`skills/forge/SKILL.md`](skills/forge/SKILL.md) teaches an agent with a
shell to probe before converting, pass `--json`, read exit codes, and never
pass `--force` unless asked. For Claude Code, copy it to
`~/.claude/skills/forge/`.

### `forge probe`

```
$ forge probe scan.pdf --json
{"forge":"0.2.0","ok":true,"probes":[{"path":"/Users/me/scan.pdf","kind":"document","format":"pdf","bytes":2483021,"pages":12,"encrypted":false,"targets":["png","jpeg","pdf","docx"],"actions":["convert","compress","split","extract","delete","rotate"]}],"failures":[]}
```

`targets` and `actions` come from the engines' own capabilities. `format` is
read from the file's content, not its name. Probe writes nothing.

### `--json`

Every command accepts `--json`. stdout then carries exactly one JSON document
on one line, and nothing else: no colour, no glyphs, no progress. Every
document has `forge` (the version), `ok` (true only if every input
succeeded) and `failures`. A conversion, compression or page operation adds
`results`:

```jsonc
{
  "forge": "0.2.0",
  "ok": false,
  "results": [
    {
      "op": "convert",                  // convert | merge | split | extract | delete | rotate
      "source": "/abs/photo.heic",      // = sources[0]
      "sources": ["/abs/photo.heic"],   // all of them, for a merge
      "outputs": ["/abs/photo.webp"],   // always absolute, always every file written
      "inputBytes": 52074,
      "outputBytes": 42684,
      "warnings": [{ "code": "animation-flattened", "message": "…" }]
    }
  ],
  "failures": [
    {
      "path": "/abs/locked.pdf",        // absent for a command-level error
      "code": "encrypted-source",       // a stable ErrorCode
      "title": "…", "detail": "…", "hint": "…"
    }
  ]
}
```

`--formats --json` returns `formats` (`id`, `label`, `extensions`, `read`,
`write`, `lossy`). `forge probe --json` returns `probes`. `forge config
--json` returns `config` and `warnings`. An argument error is a document with
one `invalid-arguments` failure. Fields are never renamed or removed in a
minor version; the `forge` field says which version you are reading. `--help`
and `--version` stay text.

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Every input succeeded |
| 1 | The command was understood, and at least one input failed or was refused |
| 2 | The command itself was invalid — unknown flag, missing argument, contradictory flags |

If the same flags could succeed on a different file, it's 1; otherwise it's 2.

### No terminal, no prompt

Without a TTY, Forge never waits for input. An encrypted PDF without
`--password-stdin` fails at once (exit 1), and `--password-stdin` reads a
single line, so a pipe left open by the caller does not hold it up.
````

Then make three small edits:

1. In `## Architecture`'s tree, add after the `cli/` block:

```
├── mcp/                the MCP server — a third front end, loaded only by `forge mcp`
│   ├── server.ts        createForgeServer(): five tools; runMcpServer(): stdio
│   ├── tools.ts         tool handlers → the same intents and runIntent() the CLI uses
│   ├── schemas.ts       zod input/output schemas, vocabularies read from core/actions
│   └── stdout-guard.ts  stdout belongs to the protocol; stray writes go to stderr
```

2. In the `cli/` block of that tree, change the `execute.ts` line to `│   ├── execute.ts       runIntent() → RunReport (data); execute() renders text or --json`.
3. Under `## Testing`, replace `789 tests, all passing.` with the count `npm test` prints now, e.g. `N tests, all passing.`. Use the real number.

- [ ] **Step 6: Run the tests to confirm they pass**

Run: `npx vitest run tests/docs/skill.test.ts tests/index.test.ts`
Expected: PASS.

- [ ] **Step 7: Gate and commit**

Run: `npx biome check --write src tests && npm test && npm run typecheck && npm run lint`

```bash
git add skills/forge/SKILL.md README.md src/cli/args.ts tests/docs/skill.test.ts tests/index.test.ts
git commit -m "$(cat <<'EOF'
docs: using Forge from AI agents — MCP setup, --json, probe, exit codes

Adds the forge Agent Skill, a README section with MCP setup snippets,
the JSON schema and the exit-code table, and lists probe/config/mcp in
--help.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: By hand, before release (the human partner; spec §5)**

1. `npm run build && npm link` (or install the packed tarball), then `claude mcp add forge -- forge mcp`. In Claude Code: "convert ~/Desktop/x.heic to jpeg", "compress it to 200kb", "split ~/Desktop/doc.pdf into pages". Each must succeed and name its outputs. Confirm with `/mcp` that the server is connected.
2. Repeat in Claude Desktop (`claude_desktop_config.json` snippet above). **Also record which protocol revision it negotiates**: add `process.stderr.write(JSON.stringify(...))` temporarily, or read Claude Desktop's MCP log. That answers the half of the spec's open question this plan could not, because Claude Desktop is not installed on the planning machine.
3. If either client cannot connect, check its MCP log for the `initialize` exchange before changing any code.

---

## Self-Review

**Spec coverage:**

| Spec | Task |
| --- | --- |
| §3.1 never prompt off a TTY; fail at once with exit 1 and a hint naming `--password-stdin` | T1 (stdin.ts, buildRasterJob) |
| §3.1 `--password-stdin` reads one line | T1 |
| §3.1 no path ends in exit 13 | T1 (`guardUnsettled`, outer catch) |
| §3.1 a wrong password's own hint | T1 |
| §3.2 `--json` on every command, one document, no glyphs | T5 (run commands, formats, config, arg errors, fatal); T6 (probe) |
| §3.2 argument errors in the same shape, catching commander first | T5 (`configureOutput` + `CommanderError` → `invalid-arguments`) |
| §3.2 `WarningCode` | T3 |
| §3.2 `--formats --json` | T4 (`formatMatrix`), T5 |
| §3.2 schema documented and versioned | T4 (types), T9 (README) |
| §3.2 JSON from the same result objects as text | T4 (`describeResult`), T5 (`renderRun` over one `RunReport`; test feeds both) |
| §3.2 the batch text lists every output | T3 |
| §3.3 `forge probe` text and JSON; targets/actions from core; writes nothing | T4, T6 |
| §3.4 exit-code table, merge/split moved to 1, table in `--help` and README, config errors on stderr | T2, T9 |
| §3.5 `forge mcp`, five tools, call core in-process, structuredContent + text + resource_link, no base64 | T7, T8 |
| §3.5 no overwrite without `overwrite: true`; annotations non-destructive | T7 |
| §3.5 `password` argument, no prompt | T7 |
| §3.5 tool errors vs JSON-RPC errors | T7 (`isError` results; the SDK makes unknown tools JSON-RPC errors) |
| §3.5 stdout belongs to the protocol; exit on EOF | T8 |
| §3.5 zod schemas sharing `OptionSpec` values | T7 (`schemas.ts` + vocab tests) |
| §3.5 the dependency, dynamically imported | T7, T8 |
| §3.5 protocol-revision open question | answered above for Claude Code (2025-11-25); Claude Desktop is T9 by hand |
| §3.6 SKILL.md, README section, stale text corrected | T9, T3 |
| §5 agent conditions as tests | T1, T5, T6 (spawned with stdin closed/open) |
| §5 JSON schema tests, absolute paths, nothing else on stdout | T5, T7 (`schemas.test.ts`) |
| §5 table-driven exit codes | T2 |
| §5 in-process MCP client | T7; stdout purity: T8 |
| §5 by hand before release | T9 Step 8 |

**Where this plan departs from the spec's text, and why:**

1. **Probe's `actions` never include `merge`, and they do include `convert`.** The spec example lists `merge` for a single PDF and omits `convert`. `actionsFor([source])` is the source of truth (invariant 2): merge needs two or more files, and convert applies to everything. `targets` likewise include the file's own format (for example `pdf` for a PDF), because `targetIdsFor` does. The spec example omits it.
2. **The spec's warning example uses `"basic-formatting"`. The real code is `word-basic-fidelity`.** Every warning already had a code, and none was a bare string. The only bare-string warning is the config loader's, which becomes `config-unreadable`. `WarningCode` is declared beside `Warning` in `types.ts` and re-exported from `errors.ts`, which avoids a value cycle between the two modules.
3. **`ResultJson` adds `op` and `sources` beside the spec's `source`,** because a merge has several sources. `FailureJson.path` is optional, absent for command-level errors. The spec showed it on every failure.
4. **Probe's JSON is wrapped like every other document** (`{ forge, ok, probes: [...], failures }`), and `forge probe` takes several files. The spec showed a bare object for one file. The wrapper is what lets `forge` version it, and MCP's `forge_probe` takes several paths anyway.
5. **A new `ErrorCode`, `unsupported-operation`,** for page operations that do not fit their files. The spec says "the existing ErrorCode union". Reusing `invalid-arguments` with exit 1 would break the rule that `invalid-arguments` means exit 2.
6. **The MCP server calls `runIntent` from `src/cli/execute.ts` rather than reassembling `runPlan` itself.** `runIntent` returns data and never prints. Duplicating its planning (raster jobs, compress outputs, page-op values) in `src/mcp/` would be the five-places drift `runPlan` was created to end. Moving it into `core/` would restructure `execute.ts`, which lean-and-fast also touches. That move is a later refactor, not this plan's.
7. **`--help` and `--version` stay text under `--json`.**
8. **Commander's own usage errors are now Forge `invalid-arguments` errors in text mode too.** "✕ Invalid arguments … Unknown option '--bogus'." replaces commander's `error: unknown option`. Exit 2 is unchanged.
9. **Two bugs found while planning are fixed in Task 4 (Review Focus 5).** A literal path with glob characters, and an empty glob, both used to produce a silent no-op that reported success.
10. **Text output for page operations is unchanged.** It already names its folder, and `--json` carries absolute paths. Only the batch report gains per-file lines.
