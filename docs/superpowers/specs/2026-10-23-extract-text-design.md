# Forge — Extract text from pictures and PDFs

**Date:** 2026-10-23
**Status:** approved 2026-10-23 ("start directly without plan"); built on `feat/extract-text`. §12 lists what changed while building.
**Builds on:** [transcribe](2026-10-17-transcribe-design.md) (the mode, its
helper, its Format step and its Done)

Decisions marked **(call)** were made by the assistant on the user's
delegation ("own the calls"). The rest were stated by the user.

---

## 1. Why

The user asked for a way to get the text out of things in Forge, on the Mac's
own on-device intelligence, and then asked whether it could reach Intel Macs,
Windows and Linux. The agreed direction: **build the Mac version now** and give
the engine a seam so Windows and Linux can plug in later.

The usual moments: a screenshot of an error, a slide or a chat; a photo of a
page, a receipt or a whiteboard; a scanned PDF that won't let you select
anything. Someone wants the words, to paste or to keep.

## 2. The rules

1. **Transcribe takes pictures and PDFs too.** Transcribe already means "turn
   this into text" (sound → words). A picture or PDF dropped, typed or pasted
   on the transcribe tab is read the same way, through the same Format step,
   Save as, Working and Done. **(call)** Why: the user moved "→ text" out of
   Convert into its own mode once already (transcribe round 2), and this mode
   already has everything after reading: the four formats, Word and PDF
   rendering in the helper, a Done with `c copy`.
2. **Apple's on-device text recognition reads; nothing rewrites.** The text in
   the file is exactly what Vision read, laid out from Vision's own structure
   (paragraphs, lists, tables). Apple's on-device language model is **not**
   used for this. **(call)**, on measured evidence (§9): given the image, the
   model produced tidy Markdown but changed a phone number (555 → 585), added
   brackets and swapped a semicolon. Vision read every character right.
3. **Nothing is asked that the picture can answer.** No language step (Vision
   detects it), no "what kind of document" step. A picture goes straight to
   Format.

## 3. The flows

The screens are the ones transcribe already has, unless noted.

### 3.1 A picture

1. Home, transcribe tab: drop, type or paste a path to `shot.png`. The staged
   card shows the name, its type tag and `1 440 × 900 · 412 KB` (the image
   card convert already draws).
2. ↵ → **Format**: Markdown / Word / PDF / Text, opening on the default
   (the `transcribeFormat` setting already shared with sound). There is no
   Transcribe to step: All / Notes / Transcript are about talk.
3. ↵ → **Save as**: `shot.md` beside the picture, by the usual rules.
4. ↵ → **Working**: one spinner line, **Reading text**, with the clock after
   3 s (W5). Usually under half a second, so it often never shows. No bar:
   there is no true fraction for one picture (invariant 7).
5. **Done** (transcribe's, with its buttons): the green `done` chip and the
   file, then **the opening lines of the text**, dim, as many rows as the space
   holds (the last one cut with `…`). This replaces the parts list that sound's
   Done shows. It shows straight away whether it read the right thing.
   **(call)**: new on this screen.

### 3.2 A PDF

As a picture, with two differences:

- Card: name, `PDF`, `12 pages · 3.1 MB`.
- Working: **Reading text** with a true bar and `page 3 of 12`. The page count
  is known before reading starts.

Every page is rendered and read, whether or not it already carries a text layer.
**(call)** One path gives structure (lists, tables) on every page, and Vision
read the repo's two-column fixture correctly. If extracted digital PDFs show
errors in testing, use the text layer for pages that have one. Convert's
PDF → Word stays as it is.

### 3.3 A screenshot on the clipboard

The clipboard flow (2026-10-16) already lands a copied picture on home as
**Copied image** and skips Save as. On the transcribe tab:

1. ⌘V (the field's existing `⌘V to paste from clipboard` chip shows here too
   while the clipboard holds a picture) → the **Copied image** card.
2. ↵ → Working → Done. **No Format step and no Save as.** The text goes back
   on the clipboard. **(call)**
3. What is put on the clipboard: two flavours. **Plain text** is the bare
   words (`markdownText`): no `#`, no pipes, no escapes, so an error message
   pasted into a terminal or editor is exactly what was on screen. **HTML** of
   the Markdown gives Notes, Mail, Pages and Docs the headings, lists and
   tables. **(call)** Markdown escaping (§4) therefore lives only in the
   Markdown writer, never in the shared blocks. The Done preview and `c copy`
   use the bare words too.
4. Done: **transcribe's Done** hosts it, not convert's clipboard Done (that one
   is tied to convert results). The `done` chip, `✓ the text is on the
   clipboard`, then the opening lines as in §3.1. Buttons: Home, `s` **save
   as a file** (the default format, where Save as would have put it by
   default; Done then shows the file as §3.1 does), and `u` **put the picture
   back**. There is no Open or Finder, because there is no file yet. **(call)**
5. E3 (the clipboard changed while reading) behaves as it does for pictures:
   the text is saved to the default folder instead, and Done says so.

### 3.4 The Mac can't

- **Older than macOS 26:** the transcribe tab is where it is today. A picture
  is refused with one tinted row (E5·b): "Reading text needs macOS 26 or later."
- **No text found:** refused with one tinted row: "No text found in
  shot.png". No empty file is written. **(call)**
- **Locked PDF:** the existing locked-PDF refusal.
- **Something Vision cannot open:** the existing `untranscribable` refusal,
  worded for a picture.

### 3.5 The CLI

`forge transcribe shot.png` writes `shot.md`. `--format` and `-o` work as they
do for sound, and so does `--language <id>`, which pins the reading language
(§8). `--to` is about talk: given explicitly with a picture or PDF, it is
refused with one line. **(call)**

## 4. What the file looks like

- **Only the text.** No title line, no source line, no disclaimer: nothing in
  it was written by a model. **(call)**
- Markdown from Vision's structure:
  - **Headings:** Vision's `title` becomes `#`. Any other paragraph that is one
    line, short (≤ 80 characters), has no closing full stop, and has a line
    height ≥ 1.25× the page's median body line height becomes `##`. The
    builder may tune the thresholds against the fixtures. **(call)**
  - **Paragraphs:** as Vision groups them. Vision already rejoins a word broken
    with a hyphen at a line end ("vis-" + "ited" → "visited", §9).
  - **Lists:** `-` for bullet and hyphen markers, `1.` for numbered ones (from
    `List.Item.markerType`).
  - **Tables:** a pipe table with the first row as the header. Merged cells
    repeat their text. **(call)**
  - Markdown's own characters in the read text (`#`, `*`, `_`, `|`, a leading
    `1.`) are escaped so the text stays the text.
- **Reading order** is decided by Forge, not taken from Vision's paragraph
  list: in §9's page Vision listed the table's cells straight after the title,
  ahead of the paragraph above them. Blocks (paragraphs, lists, tables) are
  laid out by position: down a column, columns left to right, a full-width
  block (a heading over two columns) closing the columns above it. Text inside
  a table's or list's region belongs to that block, not to the paragraphs.
  Required outcomes, as tests: §9's page reads title, paragraph, heading, list,
  table, contact line. The two-column fixture reads 1 → 90 in order.
- **PDF pages** are separated by `---` in Markdown, which renders as a rule in
  Word and PDF, and by a blank line in Text.
- **Text** (`.txt`): today's `markdownText`, extended so a table comes out as
  tab-separated rows and numbered items keep their numbers.
- **Word and PDF:** today's `markdownHtml` → helper `render`, extended for
  tables and numbered lists. `output.ts` currently reads only the lines
  transcript Markdown writes, so this extension is real work.

## 5. Pieces

### 5.1 The helper: a `read` command in `forge-transcribe`

Same binary, same JSON-lines protocol (transcribe spec §4.1). New:

- `status` gains `"read": true|false`: true on macOS 26+, where
  `RecognizeDocumentsRequest` exists.
- `forge-transcribe probe-read <file>` →
  `{"ok":true,"kind":"image","width":1440,"height":900}` or
  `{"ok":true,"kind":"pdf","pages":12}`, or `{"ok":false,"code":"unreadable"|"locked"}`.
- `forge-transcribe read <file> [--language <id>]` → for a PDF,
  `{"event":"page","page":3,"of":12}` lines, then
  `{"ok":true,"pages":[{"blocks":[…]}]}` where a block is one of:
  - `{"kind":"text","text":"…","title":bool,"lines":n,"lineHeight":0.021,"box":[x,y,w,h]}`
  - `{"kind":"list","items":[{"marker":"bullet"|"decimal"|…,"text":"…"}],"box":[…]}`
  - `{"kind":"table","rows":[["…","…"]],"box":[…]}`

  with boxes and heights normalised to the page, origin top-left. The helper
  reports what Vision saw. Ordering and heading decisions happen in core, so
  they are pure and tested in TypeScript.
- Images: read through ImageIO, which covers every picture format Forge takes
  on a Mac, HEIC and RAW included, using the **EXIF orientation**, so a phone
  photo taken sideways reads the right way up (the spirit of invariant 4). An
  animated GIF reads its first frame.
- PDFs: pages rendered with PDFKit, white behind them (a transparent render
  read nothing at all in §9), at a scale where the long side is about 2 500 px.
  The builder may tune this.
- If `RecognizeDocumentsRequest` throws (this is untested on Intel), fall back
  to `RecognizeTextRequest`: lines grouped into paragraphs by gap, with no
  lists or tables. **(call)**
- Language: automatic detection by default; `--language` sets
  `recognitionLanguages`.
- `{"ok":false,"code":"unsupported"}` when `read` is unavailable. The Linux
  helper in PR #3 must answer `read` and `probe-read` this way until it has its
  own reader.

### 5.2 Core (pure)

- `src/core/transcribe/page-text.ts` (name is the builder's): blocks → ordered
  blocks → Markdown, with heading detection, escaping and page rules. All the
  §4 outcomes are tested here with recorded helper output: the §9 page, the
  photo, the two-column fixture.
- `output.ts`: tables and numbered lists in `markdownHtml` and `markdownText`.

### 5.3 Engine

`src/engines/transcribe.ts`: `readStatus`, `probeRead`, `runRead` (page
events, abort, error mapping) next to the sound ones. New `ForgeError`s:
`noText(path)` and `readUnavailable(message)`, with their own wording. The
engine offers `read` **only on darwin**, so nothing depends on PR #3's Linux
helper answering `read`; the `unsupported` answer in §5.1 is the eventual
contract, not a prerequisite. **(call)**

### 5.4 Shell

- Transcribe staging (`transcribe-stage.ts`): a path that `sniffKind` calls
  `'other'` is tried as a picture or PDF through `probe-read`. The order:
  `sniffKind` video/audio → sound; else `probe-read` → picture/PDF; else
  refuse. The source is still probed by content (invariant 3).
- `TranscribeSource` gains `{ kind: 'page'; path; what: 'image' | 'pdf';
  width?; height?; pages?; bytes }` and a clipboard variant.
- The flow skips Transcribe to for a page source. Working shows
  `Reading text` (with page progress for a PDF). Done shows the preview lines.
- `MODE_KINDS.transcribe`: `Video · Audio · Images · PDF · or a YouTube link`,
  and the `?` formats list gains the image and PDF rows. **(call)**: the
  string is listed for the user to approve (§10).
- ⌘V: the transcribe tab accepts a copied picture through the existing clip
  path. Its result is text placed on the clipboard (`src/utils/pasteboard.ts`
  gains a plain-text + HTML write).

### 5.5 Build

`scripts/build.mjs` builds the helper **universal** (arm64 + x86_64,
`-target …-apple-macos26.0`, `lipo`), so Intel Macs on macOS 26 get it.
**(call)** It is about 0.2 MB more. The Intel slice is **untested**: nobody on
the project has an Intel Mac. Sound transcription on Intel is whatever the
helper's `status` reports. Nothing here promises it.

## 6. The seam for Windows and Linux

The contract is the helper's `read` / `probe-read` JSON. Core never knows which
reader ran. Later:

- **Linux and Windows:** one optional extension running PP-OCR mobile models
  (detection about 4.6 MB plus recognition about 16 MB) on ONNX Runtime,
  already a Forge dependency through Boost. It fits the 50 MB extension rule.
  It answers `read` with `text` blocks only, so no lists or tables until it
  can.
  *2026-10-25:* it now reads every script Apple's reader reads (Latin, Chinese,
  Japanese, Korean, Cyrillic, Arabic, Devanagari, Thai), with lists and tables
  too; one 45 MB archive, since a page's script is only known once a recogniser
  has read it. See `extensions/read-text/model/README.md`.
- Windows's built-in `Windows.Media.Ocr` was looked at and set aside: it needs
  an OCR language pack, and Microsoft documents the API for packaged apps.
- The catalogue's `PlatformKey` is `darwin | win32` today; a Linux asset needs
  `linux` added. Coordinate with PR #3, which leaves the extension manager
  alone.

None of this is built now.

## 7. Out of scope (now)

- Several pictures into one document (photos of a book's pages): the likely
  next ask. Batch is not designed for transcribe.
- A Finder right-click "Extract text" action.
- An MCP tool.
- Making a scanned PDF searchable (a text layer written back into the PDF).
- Handwriting beyond what Vision reads anyway.
- Any use of the language model on read text (summaries, tidying), and
  describing pictures that have no text.

## 8. Known limits (measured, §9)

- **One script per page.** On a page mixing Japanese, Chinese and Korean,
  automatic detection read only the Korean line. Naming Japanese read the
  Japanese and Chinese but garbled the Korean. Pages in one script read fine.
  `--language` is the way out on the CLI. The app does not ask (rule 3).
- **First use is slow:** 40–60 s the first time a language's reader loads on a
  Mac, then about 0.3 s a page. The Working clock covers it honestly. Nothing
  claims to know it is a first run.

## 9. Spike (2026-10-23, Apple silicon, macOS 27; throwaway code in /tmp/forge-ocr)

The page was drawn for the test: title, a paragraph with a word hyphenated
across lines, a heading, a bulleted list, a ruled 4×5 table, a contact line.

| Input | Reader | Result | Time (warm) |
|---|---|---|---|
| page, PNG | Vision `RecognizeDocumentsRequest` | every character right; hyphen rejoined; 1 list and 1 table found; paragraph order put the table second | 0.3 s (first run 63 s) |
| page as a phone photo (4° tilt, blur, tint, JPEG q55, 1 000 px) | same | identical | 0.5 s |
| page, white on black | same | identical | 0.3 s |
| repo `columns.pdf` rendered | same | both columns in order | 0.15 s |
| repo `arabic.pdf` rendered | same | right (first Arabic run 40 s) | — |
| repo `cjk.pdf` rendered | same | only the Korean line (see §8) | — |
| repo PDFs rendered with a transparent background | same | nothing read | — |
| page, PNG | on-device model with the image (macOS 27 `Attachment`) | good Markdown, but 555 → **585** in the phone number, added "( )", ";" → "," | 11.8 s |

Swap did not move during the model run.

## 10. Strings for the user to approve

New on-screen words (the no-helper-text rule):

- `Reading text` (Working)
- `page 3 of 12` (Working, PDF)
- `No text found in shot.png` (refusal)
- `Reading text needs macOS 26 or later.` (refusal)
- `Video · Audio · Images · PDF · or a YouTube link` (transcribe's drop-zone line)
- the clipboard Done line for text, in the existing pattern:
  `✓ the text is on the clipboard`

## 11. Build order

Each phase ends green (typecheck, lint, tests).

1. Core: blocks → Markdown (ordering, headings, lists, tables, escaping), TDD
   on recorded helper output.
2. Helper `read` / `probe-read` / `status.read`, universal build; engine and
   errors; `forge transcribe <picture|pdf>` on the CLI. Real runs on the
   fixtures.
3. `output.ts` tables and numbered lists for Word, PDF and Text.
4. Shell: staging, flow, Working, Done preview, kinds line.
5. Clipboard: ⌘V on transcribe, text and HTML back on the clipboard, `u` and
   `s`, E3.

Work happens in a worktree off `dev`, **without waiting for PR #3**. PR #3
(Linux transcribe) touches `engines/transcribe.ts`,
`cli/transcribe-command.ts`, `scripts/build.mjs` and `shell/transcribe-stage.ts`.
Whichever lands second rebases onto the first. Merging PR #3 is the user's
decision. **(call)**

**No mockup round** before building. The new screens are additions to existing
ones (preview lines on Done, a page count on Working), and the user tests in
`npm run dev`. **(call)**

## 12. As built (2026-10-23)

What building changed, each found by a real run. All are **(call)**.

- **No `probe-read` in the helper.** Forge's own `probe()` already tells a
  picture from a PDF by content, gives the card its facts, and flags an
  encrypted PDF. The helper's `status` says `read: true` and `read` does the
  rest. Apple's frameworks claimed the repo's AES-256 PDF was unlocked and
  rendered blank pages, so a locked PDF is refused with Forge's existing
  `encryptedSource`, as everywhere else.
- **Line heights are measured along the line's slant** (its corner points),
  not from its upright box. On the tilted phone photo, the upright box made
  every long line look tall.
- **Headings.** A line must be at least 1.2× the page's body line (the median
  over every line, so long paragraphs outweigh headings) and must not be the
  only text on the page. That applies to Vision's `title` too, which it gives
  to the first line of any page. On a blurred photo the heading and a body
  line full of `@` and brackets measure the same, so headings can come out as
  paragraphs there. A missed heading loses nothing. Vision's per-line
  `isTitle` was false everywhere.
- **Reading order** is an XY-cut: a column cut where a gap runs top to bottom,
  otherwise one cut across the widest gap, then again inside each part.
  Cutting at every gap across at once read two columns row by row under a
  full-width heading.
- **Word is written in Node** with the `docx` package Forge already ships.
  AppKit's Word writer drops tables. Headings are Word's own Heading 1 and 2
  styles, and each PDF page starts a new page.
- **The helper's PDF is laid out by AppKit's text system** (`NSLayoutManager`)
  instead of Core Text's framesetter, which flattened a table into one cell a
  line. Transcripts render identically (compared page by page). Small empty
  paragraphs space a table off its neighbours, since AppKit's HTML reader
  ignores the margins round a table.
- **One renderer per form, not Markdown parsed back.** `page-text.ts` turns
  Vision's blocks into pieces, and the pieces into Markdown (escaped), the
  bare words (never escaped) and HTML. `output.ts` is unchanged apart from
  exporting its style.
- **The slow first read is per helper binary**, not per Mac: a byte-identical
  copy at a new path was fast, and a rebuilt binary paid ~46 s again. So it
  comes back once after each Forge release that changes the helper.
- **Languages:** Vision reads about 30 languages. It has no Hebrew, so a
  Hebrew page is refused with "No text found".
- **Home:** the transcribe heading is the app's usual "Drop a file here", and
  holding tab lists the formats (Video MP4 · MOV; Audio M4A · MP3 · WAV ·
  AIFF; the images convert lists; PDF). The "Currently only English is
  supported" note now has room on the key row only from about 100 columns.
  Its words are about speech; changing them is left to the user.
- **The clipboard Done** reuses the copied-image Done's words: Undo, Save a
  copy, "✓ the original is back on the clipboard", "✓ saved to …". The E3
  line for text is `Clipboard changed: the text is saved to <folder>.`
- **A helper that cannot answer `status`** (the untested Intel slice failing
  to start, say) counts as no helper: nothing is offered and nothing breaks.
- The Done preview lines a table up in columns.
