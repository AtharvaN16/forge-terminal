# Forge — Extract audio and Clean up audio (Edit)

**Date:** 2026-10-23
**Status:** design agreed in conversation; not built
**Builds on:** [video and sound](2026-10-17-forge-video-audio-design.md) §3.4 (Edit)

Decisions marked **(call)** were made by the assistant on the user's
delegation; the rest were stated or confirmed by the user.

---

## 1. Why

Two jobs people reach for with a recording: pull the sound out of a video, and
make a poor recording (a call, a lecture, a phone clip) easier to listen to.
Extraction already exists as Convert → "sound only" (MP3 · M4A · WAV) but is
not where people look for it; Clean up has no home at all. Both belong in
Edit, where the video spec's rule applies: the mode is the job, no questions
about technical settings.

## 2. The rule

Two new Edit rows, each one key press, no step between the row and Save as.

| Source | Rows (blank row where marked) |
|---|---|
| video with sound | Trim · Mute · **Extract audio** · **Clean up audio** · ⏎ · Resize · Crop to shape |
| video, no sound | unchanged (neither row is offered, as Mute is not) |
| sound | Trim · **Clean up audio** · Even out loudness |

### 2.1 Extract audio (video only)

- **No format question.** The sound is copied out as it is, in the container
  that holds it: AAC/ALAC → `.m4a`, MP3 → `.mp3`, Opus → `.opus`. Any other
  codec (Vorbis, AC-3, PCM…) is encoded to M4A **(call)**. Copying is instant
  and loses nothing. Someone who wants MP3 or WAV uses Convert, which stays
  the format picker.
- It is a convert job to a sound-only target, so the engine already does it
  (`FORMATS[target].media === 'sound'`, `copyAudio`). New: a pure
  `extractTarget(audio codec)` choosing the target, and the Edit tool `extract`
  in `actions/media.ts`.
- Name: `rec-audio.m4a`.

### 2.2 Clean up audio (video and sound)

- One row, no settings: take out low rumble and steady hiss or hum, then bring
  the level to −16 LUFS (the level Even out loudness already uses).
- Tuned for **speech** **(call)**; music is not the target. Built from
  ffmpeg's own filters, so no model file and no extension change:
  `highpass=f=80`, `afftdn` (`nr=12`: at most 12 dB off), then the existing
  two-pass `loudnorm`.
- **The noise level is measured first (built, by measurement).** afftdn's own
  tracking (`tn=1`) did nothing on speech with hiss, and a fixed `nf` either
  does nothing (file noisier than `nf`) or eats quiet speech. So a first,
  fast pass reads the file's quietest stretch (`astats` RMS trough, after the
  rumble filter, on the part being kept) and sets `nf` 8 dB above it, held
  within −70…−30; with no quiet stretch to read, afftdn's own −50. Steps:
  noise measure (no Working label), loudness measure (Pass 1 of 2) through the
  same filters, write (Pass 2 of 2).
- Measured with macOS `say` speech and added hiss (white −35 and −55 dBFS,
  pink −45): signal-to-noise up 8.6, 8.9 and 4.7 dB; speech moved ≤ 0.2 dB
  before levelling; loudness −16.0 LUFS.
- Video: the picture is copied, only the sound is re-encoded (as Mute copies).
  Sound file: written in its own format. Re-encoding a lossy sound loses a
  little; the bitrate is the source's, within 96–256 kbps **(call)**, and WAV,
  AIFF and FLAC lose nothing.
- Name: `rec-cleaned.mp4`.
- Even out loudness stays on sound files (a user who only wants the level).
  Clean up includes levelling, so it is not added to video separately.

### 2.3 CLI

- Extract audio: no new flag; `forge rec.mov --to m4a` already does it.
- Clean up audio: `--clean-audio` **(call)**, listed in
  `core/cli-reference.ts` and `cli/args.ts` beside `--loudness`.
- Presets, MCP, `forge watch`, batch: not now (as video and sound v1).

## 3. Goals, non-goals, anti-goals

- **Goals:** two rows that work on the first press; Extract is lossless and
  quick; Clean up makes speech clearer without anyone choosing a strength.
- **Non-goals:** a noise-strength control, a before/after listen, voice
  isolation with a model (a later extension if wanted), music tuning, a format
  choice on Extract.
- **Anti-goals:** a result that sounds watery or robotic (keep the reduction
  conservative; a mild result beats an artefact-ridden one); a bigger
  file than the source for Extract (it copies); fabricated progress
  (Working's real bar, against the output's duration, as for every media job).

## 4. Interface text (needs approval before it ships)

New strings, quoted so each can be accepted or changed:

- Row labels: `Extract audio` · `Clean up audio`
- Extract detail: `becomes M4A` (dim `becomes `, bold the format; `MP3`/`Opus`)
- Extract pane: `Keeps just the sound.` / `Copied out as it is, so it takes seconds and loses nothing.`
- Clean up pane: `Clearer voices.` / `Takes out rumble and hiss, then evens the level.`
- Working verbs: `Extracting audio` · `Cleaning up audio`

## 5. Tests

- `media-encode.test.ts`: Extract plans a copy for AAC → m4a, MP3 → mp3,
  Opus → opus, and an encode for the rest; Clean up's `-af` chain order
  (highpass, afftdn, loudnorm) with the measure pass through the same chain;
  picture copied.
- `actions-media.test.ts`, `edit-media-rows.test.ts`: rows by source (video,
  silent video, sound), order and the blank row; the plan's names.
- `cli`: `--clean-audio` parses; refused on an image.
- Real-ffmpeg check (existing media tests' pattern): synthesise a tone over
  `anoisesrc`, run Clean up, assert with `astats` that the noise floor fell
  and the loudness is within 1 LU of −16. Final tuning of `afftdn` is by
  listening to a real voice clip, noted in the commit.

## 6. Left to the builder

`afftdn` parameters (within "conservative"), the exact bitrate rule, where the
tool ids sit in the shell's flow table, Done's wording if it says anything
beyond the file name (it should not).
