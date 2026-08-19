# Forge

A terminal-native file converter for macOS. Product name **Convert**, command `forge`.

The design lives in [docs/superpowers/specs/2026-08-19-forge-design.md](docs/superpowers/specs/2026-08-19-forge-design.md).
Read it before changing behaviour — several defaults there are deliberate and
were chosen against measured evidence, not assumed.

## Branch workflow

```
dev   ← all work happens here
main  ← only receives work that is ready
```

Both exist locally and on `origin`. Never commit directly to `main`; merge from
`dev` when a phase is complete and its tests pass.

```bash
git switch dev                 # default working branch
git push                       # → origin/dev

# when a phase is done and green
git switch main
git merge dev
git push                       # → origin/main
git switch dev
```

## Load-bearing invariants

These are cheap to break and expensive to notice. Do not regress them.

1. `core/` and `engines/` import no React, no Ink, no Chalk, and never write to
   stdout. Everything they return is data.
2. No hardcoded list of output formats anywhere. Targets come from
   `targetsFor(source)`, computed from engine capabilities.
3. Sources are probed by content, never by file extension.
4. `.rotate()` runs before any other Sharp operation (EXIF orientation).
5. Alpha is flattened when the target format cannot carry it.
6. Writes are atomic — temp file, then rename.
7. Progress is never fabricated. Single-file conversion has no percentage.

## Skills

Two skill sets are enabled via `.claude/settings.json`: **superpowers** and
**mattpocock-skills**. They overlap in four places. Precedence for this repo:

| Task | Use | Not |
| --- | --- | --- |
| Designing something new | `superpowers:brainstorming` → `writing-plans` | `grill-with-docs`, `to-spec` |
| Writing a feature | `superpowers:test-driven-development` | `tdd` |
| Reviewing code | `superpowers:requesting-code-review` | `code-review` |
| Chasing a bug | `superpowers:systematic-debugging` | `diagnosing-bugs` |

Superpowers owns the process spine because its approval gates are explicit.
The mattpocock skills are here for what superpowers does not cover —
`codebase-design`, `domain-modeling`, `research`, `prototype`, `wayfinder`.
