# TODO

## MCP preview images (agent self-check)

**Status:** design agreed in conversation 2026-10-13; parked. No spec or code yet.
**Estimate:** ~1½–2½ h (spec, plan, TDD build, review).

**Why.** After a crop, cutout or Boost, an agent only gets a file path, so it
cannot tell whether the result looks right. A small before/after image in the
tool result lets it catch a bad crop or a messy cutout before telling the user
it is done.

**Decided**

- **When:** on by default for visual edits — crop, trim, remove-background,
  sharpen, Boost. Off for plain convert and compress unless the call passes
  `preview: true`. `preview: false` always turns it off.
- **What:** one image per output, original left and result right, each panel
  at most 512 px (~700 tokens).
- **Batches:** previews for the first 4 outputs, then a text note ("previews
  for 4 of 50"); `previewAll: true` lifts the cap.

**Proposed (not yet approved)**

- Inline MCP image content blocks, not resources and not files on disk.
- Per operation:
  - crop and trim: both full images;
  - remove-background: result on a checkerboard;
  - sharpen and Boost: the same central area at full detail, the before
    enlarged plainly to match;
  - plain convert or compress with `preview: true`: both full images;
    non-image outputs (PDF, Word) skipped with a note.
- `structuredContent` / the `--json` contract unchanged; images are extra
  content blocks.
- A preview failure never fails the run: files are still written, and the text
  says "preview unavailable".
- Animated images: first frame.
- New `src/mcp/preview.ts`, called from `src/mcp/tools.ts` after a successful
  run; CLI and shell untouched.

**Next step:** approve the proposed design → spec in `docs/superpowers/specs/`
→ plan → build on a feature branch.

## Other agent-workflow ideas (not discussed in detail)

- One-command setup (`forge agent setup`): register the MCP server and install
  the skill.
- Dry run: list the files a command would write, before writing.
- MCP elicitation: ask the user directly about overwrite, password or
  extension download, where the client supports it.
- Docs drift: README's `forge_convert` row omits trim, crop and resize; consider
  a test that checks the README/SKILL against the tool schemas.
