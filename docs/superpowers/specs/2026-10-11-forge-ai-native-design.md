# Forge — AI-native

**Date:** 2026-10-11
**Status:** design approved in conversation; spec awaiting review
**Origin:** a research spike driving `forge-terminal@0.1.0` the way an agent
would (no TTY, `stdin` closed or an open pipe), plus a survey of MCP and agent
conventions as of 2026-10-11.

---

## 1. Why

A user should be able to tell any AI agent — Claude Code, Claude Desktop,
Cursor, Codex — *"take this image and use Forge on it"* and have it work.
Agents are poor at file conversion today: they improvise with `sips` and
ImageMagick and guess at flags. A converter that is local, private, and built
to be driven by an agent is a reason for Forge to exist that a web converter
or Preview cannot match.

Forge is already close — it is a flag-driven CLI. But an agent driving 0.1.0
hits these:

**Blockers**

1. **An encrypted PDF hangs or crashes the agent.** Without
   `--password-stdin`, Forge always prompts (`execute.ts:145` →
   `src/cli/stdin.ts:30`, readline with `terminal: true` on a non-TTY). With
   `stdin` closed it prints `Password: ` and Node dies with *unsettled
   top-level await*, **exit 13**, no Forge error. With `stdin` an open pipe —
   common in agent harnesses — it **hangs forever**.
2. **A batch never says where its files went.** Two or more results print
   `✓ 2 converted` and a size line (`report.ts:78-92`); no paths. PDF→image
   and page operations print basenames only.

**Friction**

3. No machine-readable output. Results are prose with glyphs; paths are
   relative or `~`-shortened; sizes are rounded; warnings go to stdout among
   results; the stable `ErrorCode` union (26 codes, `errors.ts:6-32`) is never
   printed.
4. No way to ask *what can this file become?* `targetsFor()` and
   `actionsFor()` exist in core with no CLI surface.
5. Exit codes are inconsistent: a runtime refusal is sometimes 2 (merge of a
   non-PDF, `execute.ts:247`; split out of range, `execute.ts:89`), while an
   unsupported target is 1. `forge config set` writes its errors to stdout.
6. A wrong password's hint suggests `--password-stdin` — the flag that was
   just used (`errors.ts:320-333`).
7. Stale guidance: a text-only PDF is told "Forge cannot compress a PDF yet"
   (`errors.ts:189-195`), and README "Not yet" says the same, but PDFs with
   images do compress.

## 2. Scope

| In | Out (for now) |
| --- | --- |
| Never blocking without a TTY | ChatGPT chat — it connects only to *remote* MCP servers; needs an HTTP endpoint or tunnel |
| `--json` on every command | One-click Claude Desktop bundle (`.mcpb`) — sharp's native binaries in a bundle are unverified |
| `forge probe` | Base64 image input/output over MCP |
| Exit-code contract | Resize/crop, or any new conversion capability |
| `forge mcp` (local, stdio) | |
| An agent skill and setup docs | |

## 3. Design

### 3.1 Never block

- When `stdin` is not a TTY, Forge never prompts. An encrypted PDF without
  `--password-stdin` fails immediately with the existing `encrypted-source`
  error and exit 1, and the hint names `--password-stdin`.
- `--password-stdin` reads one line, not until EOF, so an open pipe that sends
  a password and stays open does not hang.
- No code path can end in Node's exit 13: the top-level `await` is wrapped so
  any rejection becomes a Forge error.
- A wrong password gets its own hint ("That password didn't open it"), not a
  suggestion to use the flag already used.

The shell is unaffected — it has a TTY by definition.

### 3.2 `--json`

`--json` is accepted on every command. When set, stdout carries exactly one
JSON document and nothing else; progress, spinners and prompts are already
TTY-gated on stderr and stay off. Colour and glyphs never appear in it.

```jsonc
{
  "forge": "0.2.0",            // version, so consumers can detect changes
  "ok": false,                 // true only if every input succeeded
  "results": [
    {
      "source": "/abs/photo.heic",
      "outputs": ["/abs/photo.webp"],   // always absolute, always all of them
      "inputBytes": 52074,
      "outputBytes": 42684,
      "warnings": [{ "code": "basic-formatting", "message": "…" }]
    }
  ],
  "failures": [
    {
      "path": "/abs/locked.pdf",
      "code": "encrypted-source",      // the existing ErrorCode union
      "title": "…", "detail": "…", "hint": "…"
    }
  ]
}
```

- Argument errors are reported in the same shape (`failures` with
  `code: "invalid-arguments"`), which means catching commander's errors before
  it prints its own text.
- Warnings carry a stable `code`. This adds a `WarningCode` union beside
  `ErrorCode` in `src/core/errors.ts`; warnings that today are bare strings
  get one.
- `--formats --json` returns the capability matrix as data.
- The schema is documented in the README and versioned by the `forge` field.
  A field is never renamed or removed in a minor version.
- The JSON is built from the same result objects the text reporter uses
  (`src/cli/report.ts`), so the two cannot drift.

Text output also gets the batch fix: two or more results list every output
path, not just a count.

### 3.3 `forge probe`

```
forge probe <file> [--json]
```

Reports what the file is and what Forge can do with it:

```jsonc
{
  "path": "/abs/scan.pdf",
  "format": "pdf",                 // by content (invariant 3)
  "bytes": 2483021,
  "pages": 12,                     // when the format has pages
  "width": 2480, "height": 3508,   // when it has dimensions
  "encrypted": false,
  "targets": ["png", "jpeg", "docx"],          // targetsFor(source)
  "actions": ["compress", "merge", "split", "extract", "delete", "rotate"]
}
```

`targets` and `actions` come from `targetsFor()` and `actionsFor()` — no list
is written anywhere (invariant 2). Without `--json` it prints the same facts
as text. Probe writes nothing.

### 3.4 Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Every input succeeded |
| 1 | The command was understood, and at least one input failed or was refused |
| 2 | The command itself was invalid — unknown flag, missing argument, contradictory flags |

The rule: if the same flags could succeed on a different file, it's 1;
otherwise it's 2. So merge-of-non-PDF and split-out-of-range move from 2 to
1. The table is printed in `--help` and the README. `forge config set` writes
errors to stderr.

### 3.5 `forge mcp`

A local MCP server over stdio:

```bash
claude mcp add forge -- forge mcp     # Claude Code
codex mcp add forge -- forge mcp      # Codex / ChatGPT desktop's Codex
# Claude Desktop and Cursor: { "mcpServers": { "forge": { "command": "forge", "args": ["mcp"] } } }
```

**Tools** — deliberately few; a 57-tool ImageMagick server is the cautionary
example of flooding an agent's context:

| Tool | Does |
| --- | --- |
| `forge_probe` | §3.3 for one or more paths |
| `forge_formats` | The capability matrix |
| `forge_convert` | Convert files to a target format, optional quality/dpi/background |
| `forge_compress` | Compress by quality or to a target size |
| `forge_pdf` | Page operations: `merge`, `split`, `extract`, `delete`, `rotate` (an `op` enum) |

**Behaviour**

- Tools call core directly (`runPlan` and friends) — they do not spawn the
  CLI.
- Inputs are absolute file paths. Results are `structuredContent` in the
  §3.2 shape, plus a text summary and a `resource_link` (`file://`) per
  output. No base64.
- Never overwrites unless the call passes `overwrite: true`. Without it, an
  existing output is a tool error the model can act on (`isError: true`, the
  same `code`/`hint` as the CLI). Tool annotations mark writing tools
  non-destructive by default.
- Encrypted PDFs take an optional `password` argument; there is no prompt.
- Errors the model can fix are tool errors with `isError: true`; protocol
  faults are JSON-RPC errors.
- **stdout belongs to the protocol.** Nothing else may write to it while
  `forge mcp` runs — invariant 1 already keeps `core/` and `engines/` silent;
  the server also routes any stray library output to stderr. Exits on stdin
  EOF.
- Input schemas are written once per tool with zod. Where an option already
  exists as an `OptionSpec` in `src/core/actions/`, the schema's allowed
  values come from the same source, so the shell, CLI and MCP cannot offer
  different choices.

**Dependency.** `@modelcontextprotocol/server` (the SDK's v2 line; deps: zod
4 and `@modelcontextprotocol/core`). The v1 `@modelcontextprotocol/sdk` pulls
in express and hono (26 MB) and is not used. The server module is
dynamically imported only by `forge mcp`, so no other command loads it; under
the lean-and-fast bundle (that spec, §4.5) it is a lazy chunk.

**To verify during implementation:** the installed v2 package reports
`LATEST_PROTOCOL_VERSION = 2025-11-25` while its core references the
2026-07-28 revision. Confirm which revision it negotiates with current Claude
Code and Claude Desktop before relying on either.

**Known limitation:** an image pasted into a chat app is not a file on disk, so
a path-based tool cannot see it. Path-based tools are the natural fit for
agents with file access (Claude Code, Cursor, Codex). This is noted in the
docs, not worked around.

### 3.6 Agent docs

- **`skills/forge/SKILL.md`** in the repo, following the Agent Skills format
  (`name`, `description`, body). It teaches an agent with a shell to use
  `forge probe --json` before converting, to pass `--json`, how to read exit
  codes, and never to pass `--force` unless the user asked to overwrite.
- **README** gains an "Use with AI agents" section: the MCP setup snippets
  above, and the skill.
- Stale "cannot compress a PDF yet" text in `errors.ts` and the README is
  corrected (§1, item 7).

## 4. Invariants

- **1** — the MCP server lives in `src/mcp/` alongside `src/cli/` and
  `src/shell/`, as a third front end. Core and engines stay silent.
- **2** — `probe` and `forge_formats` read from `targetsFor()`/`actionsFor()`
  and the engine registry.
- **3** — `probe` reports the content-detected format.
- **6** — MCP writes go through the same atomic writer and write-safety checks.
- **7** — MCP reports completion, not invented progress.

## 5. Testing

- **Agent conditions as tests:** the CLI suite runs key commands with `stdin`
  closed *and* with `stdin` an open pipe, and asserts each exits within a
  timeout with the documented code — including an encrypted PDF without a
  password.
- **`--json`:** every command's JSON parses, matches a schema test, contains
  absolute paths, and stdout contains nothing else. Text and JSON reporters
  are fed the same result objects in tests.
- **Exit codes:** a table-driven test over the §3.4 cases.
- **`forge mcp`:** an in-process client (the SDK's own) lists tools, calls
  each, and checks `structuredContent`, `isError` cases, the overwrite guard,
  and that nothing but protocol messages reached stdout.
- **By hand, before release:** register `forge mcp` in Claude Code and Claude
  Desktop and have each convert, compress, and split a real file.

## 6. Order

1. §3.1 and §3.4 — they fix real hangs and are small.
2. §3.2 and §3.3 — the machine-readable contract.
3. §3.5 — built on §3.2's result shape.
4. §3.6 — written last, against what shipped.

This touches `src/index.ts` and `src/cli/execute.ts`, as does lean-and-fast
§4.2; that change lands first.
