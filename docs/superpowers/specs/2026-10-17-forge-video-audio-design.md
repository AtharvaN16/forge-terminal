# Forge — Video and sound

**Date:** 2026-10-17
**Status:** design settled in conversation (rounds 1–3); building on `feat/video`
**Mockup:** `mockups/video-2026-10-round3.html` (built by
`scripts/video-mockup.ts` from cells captured from the real app). Rounds 1
and 2 (`video-2026-10.html`, `-round2.html`) are history: round 2's one-sheet
design was rejected as confusing.

The user delegated every remaining call ("take the call like a UX designer").
Decisions below marked **(call)** were made on that basis, with the reason.

---

## 1. Why

The Clop comparison's item 6. Forge converts, compresses and edits images,
PDFs and documents; video and sound are the files people most often need to
shrink or convert (a screen recording into Slack, a GitHub comment or
Discord; a podcast WAV to MP3) and the terminal suits them: one file in,
one file out.

## 2. The rule: the mode is the job

A video or a sound file goes where an image would, and each mode does one
thing. The file type only changes the list.

| Mode | Video | Sound |
|---|---|---|
| convert | MP4 · HEVC · WebM · GIF, sound only: MP3 · M4A · WAV | MP3 · M4A · Opus · FLAC · AIFF · WAV (less the source's own) |
| compress | by quality / to a target size | by quality / to a target size |
| edit | Trim, Mute · Resize, Crop to shape | Trim, Even out loudness |

- **Forge picks the technical settings**, never asked: codec, frame rate, the
  picture size needed to fit a target, HDR handling, copy or re-encode.
- **Extras are CLI-only**: `--speed`, `--fps`, `--bitrate`, `--loudness`,
  `--frame`.
- **Two jobs are two runs.** Done after Trim has `c compress it`, which opens
  compress with the trimmed file as the source. Trim copies, so only one real
  encode happens.

## 3. Behaviour

### 3.1 Reading files

- Probed by content (invariant 3): box and header signatures say video or
  sound without ffmpeg — `ftyp` (MP4/MOV/M4A, brand decides), EBML (WebM/MKV),
  `RIFF…WAVE`, `RIFF…AVI `, `OggS`, `fLaC`, `ID3`/MPEG frame sync (MP3),
  `FORM…AIFF`. ffprobe then gives streams, duration, size, frame rate,
  rotation, HDR transfer.
- The card's facts: video `2:10 · 2940×1912 · 60 fps · 184 MB`; sound
  `58:12 · stereo · 48 kHz · 671 MB`. Before ffmpeg is present, `video ·
  184 MB` / `sound · 671 MB`.
- Streams, never buffers: nothing reads a whole video into memory.

### 3.2 Convert

- Format list (invariant 2: computed from what the engine can write for this
  source, never a fixed list in the shell). Video: two groups drawn as boxes
  side by side, **video** (MP4, HEVC, WebM, GIF) and **sound only** (MP3,
  M4A, WAV). GIF's detail line: `256 colours · no sound`. Sound files use
  image convert's plain picker; the chosen row shows its size, which for
  sound is arithmetic (bitrate × length), so it is shown at once.
- Animated WebP is not offered for video **(call)**: users read WebP as a
  picture format and players (QuickTime, Slack) don't play it. It stays as
  GIF Done's measured offer.
- Encoders: no size set → Apple VideoToolbox H.264/HEVC (fast); a size set or
  Windows → libx264. WebM → libvpx-vp9 + libopus. GIF → palettegen/paletteuse,
  800 px wide, 15 fps **(call)**.
- **Copy when nothing needs re-encoding**: H.264/HEVC+AAC in MOV → MP4 and
  back copy the streams (`-c copy`), as do Trim, Mute and AAC → M4A.
- Sound convert: lossy targets go through the quality slider in kbps
  (64–320, default 128; Opus 96), with the size under it.
- HDR (iPhone HLG/Dolby Vision): HEVC keeps it; H.264, WebM and GIF are
  tone-mapped to SDR (zscale/tonemap where available, else colour-space
  conversion). Rotation is honoured; sizes are rounded to even; variable frame
  rate is kept (`-fps_mode passthrough`).
- Metadata is stripped except creation date and rotation (GPS on iPhone
  video), as for images.

### 3.3 Compress

- **To a target size** (two-pass libx264, sound AAC):
  1. Budget = target × 8 ÷ duration, less the sound (64 kbps stereo AAC,
     dropping to 32 kbps mono at the bottom rung).
  2. A ladder: full size → long side 1920 → 1280 → 854; frame rate source →
     30 → 24 → 15. The first rung giving at least 0.02 bits per pixel per
     frame wins (screen-recording floor; to tune by measurement).
  3. **Floor**: the bottom rung at the minimum bits per pixel. Below it the
     size field shows `2.5 MB  cannot compress more` in plain orange
     (compress's own SizeAside words), before anything is encoded.
  4. Units offered are those between the floor and the file's size: B never,
     KB only when the floor is under 1 MB, GB only for files over 1 GB.
  5. Lands over by a little (rare): one more pass at 95 % of the budget;
     still over → today's "can't get below" screen.
  6. Done says what it took: `To fit 10 MB it is now 1280×832 at 24 fps.`
- **By quality**: the slider maps to CRF; no size is shown **(call)**: a video
  would need a full encode to measure, and invariant 7 forbids guessing.
- A file already under the target: copied, Done says it already fit; never a
  bigger file (E3).
- **WAV in compress (call)**: WAV has no smaller setting, so compress writes
  M4A (`-small.m4a`) at the chosen kbps; to a size is exact arithmetic.

### 3.4 Edit

- **Trim** (video and sound):
  - The sound as peaks: one-sided vertical lines (`│`, top in half cells
    `╷`), 3 rows, white where kept, grey where cut. A video with no sound
    shows a faint flat line. Peaks are computed by ffmpeg in the background;
    the bar shows at once and the peaks fill in.
  - The bar: kept in the mode's tint (accent mixed 45 % into the canvas), cut
    in `track` grey, a handle at each end; the chosen handle white.
  - Under the bar: `I` and `O` chips at the handles, minute marks faint.
    Then `keeps 0:37.8 of 2:10` in grey.
  - Title row: the tool name, and at the right `step ‹ 1 s ›`.
  - Fields row: `start` and `end` (white words), the chosen time on a chip in
    the mode's tint, the other plain grey; a grey `tab` keycap at the far right.
  - Keys: **I** start, **O** end (the in/out keys editors use; the labels say
    start/end), **space** the range (both ends, length kept), **←→** move by
    the step, **[ ]** step 1 s · 5 s · 10 s · 30 s · 1 min · 5 min · 10 min ·
    30 min (only steps up to about a quarter of the length), **tab** cycles
    start → end → range, typing a time (`41`, `0:41`, `1:02.5`) puts the
    chosen end there, **↵** confirm. Range at least 0.1 s; an end before the
    start is not accepted.
  - Copies, so it starts on the keyframe at or before the start **(call)**:
    seconds and lossless beat frame accuracy for the common case (cutting
    dead seconds). Done says where it landed when that moved it.
- **Mute**: copies the picture, drops the sound. Not offered without sound.
- **Resize**: today's Resize step; video sizes never larger than the source.
- **Crop to shape**: today's Crop step, with one real frame (middle of the
  video) drawn as its preview **(call)**: a crop can't be chosen blind.
- **Even out loudness** (sound): two-pass loudnorm to −16 LUFS.
- No terminal plays video; `o` on Done opens the result in the default player.

### 3.5 GIF

- Convert → GIF opens Trim's screen once, titled GIF, trail `GIF ╱ Length`.
- Past 15 s the bar's kept part turns orange (`larger`) and `GIF might be
  too large` (the user's words) sits at the right end of the keeps row.
- Done offers the measured animated-WebP size: `✧ WebP would be 1.1 MB, 77%
  smaller again.`, `c` makes it.

### 3.6 Progress (call)

Invariant 7 forbids fabricated progress. A video or sound file has a true
total — its duration — and ffmpeg reports the time encoded, so Working shows
a real bar (`0:14 of 0:38`, in the slider's greys) and, after 5 s, `about
10 s left` from the measured speed. Two-pass encodes show `Pass 1 of 2` /
`Pass 2 of 2`, each with its own bar. The total is the output's duration
(trimmed, sped up), never the source's. CLAUDE.md's invariant 7 is amended to
say so: still never fabricated; a percentage only where the total is known.

### 3.7 Getting ffmpeg (call)

- A Homebrew / PATH ffmpeg with the needed encoders is used if present
  (macOS: `/opt/homebrew/bin`, `/usr/local/bin`, PATH; Windows: PATH).
- Otherwise a Forge extension, **video**, offered in place like Boost: the
  format row's detail says `31.4 MB download · ↵ installs`, then the byte
  band, then `checking`.
- The extension is GPL (x264); it downloads separately, so Forge stays MIT.
  Publishing its release asset is outward-facing and is left for the user to
  approve; until then the row and the CLI point at `brew install ffmpeg`.

### 3.8 CLI

`forge rec.mov --to mp4`, `--max-size 10mb`, `-q`, `--cut 0:03.2-0:41`
(`--trim` already means image edges), `--mute`, `--width`, `--crop`, and the
CLI-only `--speed`, `--fps`, `--bitrate 128k`, `--loudness -16`, `--frame
1:02`. A bar on stderr, since it has a true total. No ffmpeg: an error naming
`brew install ffmpeg` / `forge extensions add video`.

## 4. Out of v1

Deferred from this spec while building (2026-10-17):

- GIF Done's measured animated-WebP offer (§3.5): measuring it means a
  second ffmpeg encode after every GIF; to add with the suggestion step.
- `--frame` (§3.8): Save a frame as a picture.
- Keeping the creation date (§3.2): metadata is stripped whole for now.
- Checking a found ffmpeg has the encoders Forge uses (§3.7): only
  VideoToolbox failures fall back to software today.
- An HEVC target size is one pass at the bitrate, held by the size check
  after it, rather than two.

Also out:

Presets and `forge watch` for video (both still settling), Finder Quick
Actions for video, MCP tools (after the CLI flags), subtitles editing,
several-track selection, AV1.

## 5. Order

1. Engine: sniffing, ffprobe facts, ffmpeg discovery, convert and compress
   (target size with floor and ladder), CLI flags, progress.
2. Shell: video/sound in convert and compress (boxes picker, sound picker,
   units, refusal, Working bar, Done notes).
3. Edit: Trim (I/O/space/step/fields/peaks), Mute, then Resize and Crop;
   GIF's length step; Done's `c compress it`.
4. Sound files: quality kbps, loudness, WAV in compress.
5. The video extension's build script and catalogue entry (publishing waits
   for the user).
