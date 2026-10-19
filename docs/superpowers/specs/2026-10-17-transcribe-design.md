# Transcribe — design

2026-10-17. Mockups: `mockups/transcribe-2026-10-round2.html` (built by
`scripts/transcribe-mockup.ts`; round 1, `transcribe-2026-10.html`, is frozen).
Spike measurements are in §9.

## 1. What it is

A sixth mode on home, **transcribe**, in red. It turns a video or sound file, a
typed path, or a YouTube link into a Markdown file: the transcript, and —
when Apple Intelligence is on — a summary and notes for each part of the
talk. Everything runs on the Mac: Apple's speech recogniser writes the
transcript, Apple's on-device model writes the notes.

## 2. Decided by the user

- Its own mode, the sixth home tab, red, in the slot "/ menu" had. "/ menu"
  moves to the row above the key row, right-aligned (the menu itself becomes a
  popup — owned by the quick-actions session, not this work).
- Input: a dropped file, a typed path, or a YouTube link.
- Mac only (macOS 26 or later). Windows only if it gains equivalent built-in
  tools.
- Output is Markdown. **Notes** (summary, notes per part, transcript) or
  **Only transcript**. No subtitles.
- The file carries one line under the summary:
  *Summary and notes by Apple Intelligence. They may contain mistakes.*
- YouTube links stay, through yt-dlp as an add-on, after the terms-of-service
  risk was explained.
- Done: a green-tinted **done** chip, the file, the parts with their start
  times; keys **↵ new · o open · s finder · c copy**. No word or part count.

## 3. Calls made here (with why)

- **The language is the Mac's own**; another is `--language` on the CLI. Apple's
  public Speech API cannot detect the spoken language, and a step would cost
  everyone a ↵ to serve a few.
- **Transcribe to** is a plain list, Notes / Only transcript. With Apple
  Intelligence off there is nothing to choose, so the step is skipped.
- **Notes are written part by part** (≈ 14 min of talk each on a 4 096-token
  window), each in a fresh session with fixed (greedy) sampling; the headings
  and summary are written last with every part's notes in view, so headings
  differ. A part the safety filter refuses is retried once with
  `.permissiveContentTransformations` and a plain-text reply; if it is refused
  again it keeps its transcript and time, and Done says so in one line.
- **The Swift helper ships inside Forge**, built on the macOS publish runner
  (~0.2 MB, Apple silicon). It is not an extension: nothing to install.
- **yt-dlp is an extension**, pinned in the catalogue like every other
  (version + sha256, the upstream single-file `yt-dlp_macos`, 37 MB). It runs
  on the Node Forge already runs on (`--js-runtimes node:<execPath>`). When a
  lookup fails in the way a YouTube change breaks it, Forge runs
  `yt-dlp --update` (yt-dlp verifies its own updates) once and retries.
- **One yt-dlp run per link.** It prints the title, uploader and length for the
  card, then keeps downloading the sound (M4A, no ffmpeg) into a temp folder
  while you choose and name, so its ~8 s start is paid once and the download
  is usually done by ↵. Esc or leaving the mode kills it and deletes the file.
- **One video per run**; a playlist link is refused with what to do instead.
- **No ffmpeg.** AVFoundation reads MP4, MOV, M4A, MP3, WAV, AIFF directly. A
  file it cannot read (MKV, WebM) is refused for now; once `feat/video` lands
  on dev, transcribe uses its ffmpeg to pull the sound out of those.
- **No new FormatId or SourceInfo kind.** Transcribe is its own flow and never
  goes through `targetsFor` or convert, so it cannot clash with `feat/video`.
  A dropped file is recognised by content with dev's `sniffKind`, then the
  helper's probe confirms it has sound.
- Red is `#e63946` (dark), the red furthest (OKLab) from pdf and fail; its
  hatching and dots run red → pink, mirroring convert's cyan → violet.

## 4. Pieces

### 4.1 The helper, `forge-transcribe` (Swift)

Source in `helpers/transcribe/`; `scripts/build-helpers.mjs` compiles it into
`dist/helpers/` when `swiftc` and a macOS 26+ SDK are there, and skips (with
one line) everywhere else — CI tests run on macos-14 and Windows and never need
it. Tests use a fake helper through `FORGE_TRANSCRIBE_HELPER`.

Every line on stdout is one JSON object.

- `forge-transcribe status [--locale <id>]` →
  `{"ok":true,"speech":bool,"locale":"en-US","notes":"available"|"off"|"unsupported"}`
- `forge-transcribe probe <file>` →
  `{"ok":true,"seconds":3717.0,"sound":true}`
- `forge-transcribe run <file> --locale <id> [--notes]` → progress lines, then
  the result:
  - `{"event":"model","fraction":0.4}` — macOS fetching the speech model
  - `{"event":"heard","seconds":1390.2,"of":3717.0}`
  - `{"event":"notes","part":3,"of":5}`
  - `{"ok":true,"locale":"en-US","seconds":3717.0,"segments":[{start,end,text}],
    "notes":{"summary":"…","parts":[{"start":0,"heading":"…","points":["…"],"refused":false}]}}`
  - or `{"ok":false,"code":"no-sound"|"unreadable"|"locale"|"model"|…,"message":"…"}`

### 4.2 Core (pure)

- `src/core/transcribe/links.ts` — recognise YouTube links (`watch?v=`,
  `youtu.be/`, `shorts/`, `live/`, `m.` and `music.` hosts); tell a playlist
  from a video.
- `src/core/transcribe/markdown.ts` — the file from the helper's result:
  title, source line (link or file, and length), summary, disclaimer,
  `## Notes` (one `###` per part with its start time and points),
  `## Transcript` (the same headings, paragraphs broken at pauses of > 1 s once
  they have 60 words, or at 140 words, each led by its time in bold).
  Only transcript: title, source line, paragraphs, no headings.

### 4.3 Engines

- `src/engines/transcribe.ts` — find the helper, run it with progress and
  abort, map its errors to `ForgeError`s.
- `src/engines/youtube.ts` — find yt-dlp (the extension), the one run per link
  (metadata event, then byte progress, then the file), the update-and-retry.

### 4.4 Shell

- `ShellMode` gains `'transcribe'`; palette pair `modeTranscribe` /
  `modeTranscribeBg` in dark, light and neutral; its gradient, wash and dots;
  `MODE_KINDS` line "video · sound · YouTube link". Key rows say `1–6`.
- Tab row: six modes; "/ menu" moves to the right-aligned hint row (keycap
  `#333333`, word dim; gold when the menu is open).
- `src/shell/flows/transcribe.tsx`: the staged source's card (a file's facts,
  or a link's title and uploader), Transcribe to, Save as, Working (download
  bytes → a true bar of what has been heard → a dot per part), Done.
- Home in transcribe mode takes a link in the field as well as a path;
  "Looking up the link" in the drop zone while yt-dlp starts.

### 4.5 CLI

`forge transcribe <file|link> [--to notes|transcript] [--language <id>] [-o <path>]`.
Prints the same `✓ name` line as convert; refusals as the other commands do.

## 5. Out of scope

Subtitles; summaries in other formats; playlists; live streams; choosing the
language in the app; Windows.

## 6. Build order

Each phase ends green (typecheck, lint, tests).

1. Helper + build script; core `links` and `markdown` (TDD).
2. Engine + `forge transcribe <file>` on the CLI.
3. yt-dlp extension + engine; links on the CLI.
4. Shell: the mode, the tab row and hint row, the flow.
5. Edges: Apple Intelligence off, refusals, playlists, private videos, the
   speech model download, a file AVFoundation cannot read.

## 7. Invariants

`core/` stays pure (the helper and yt-dlp are reached only from `engines/`).
Sources are probed by content. The `.md` is written atomically. Progress is
real: seconds heard of the true length, bytes of the true size, parts of a
count known before the notes start.

## 8. Words

Every on-screen string comes from the round 2 mockup, which the user reviewed.
New strings found while building are listed for the user before they ship.

## 9. Spike (2026-10-17, M2 16 GB, macOS 27, a 62-min talk)

- Speech: 68 s for 62 min (55× real time); good punctuation; names wrong.
- Notes: 5 parts, ~30 s; window 4 096 on M2 (8 192 on M3+ with 12 GB on macOS 27).
- Refusals arrive as `LanguageModelError.refusal` on macOS 27 (not
  `.guardrailViolation`; `GenerationError` is deprecated); 1–2 of 5 parts per
  run; the permissive retry got every one through.
- yt-dlp: metadata and M4A download with byte progress work on Node; ~8 s
  start per run (single-file build), 0.85 s for the 124 MB folder build.
- English speech model: ~196 MB on disk, managed by macOS.
