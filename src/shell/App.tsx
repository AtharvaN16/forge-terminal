import { existsSync, statSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Box, type DOMElement, type Key, Static, useApp, useStdout } from 'ink'
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_PREFERENCES,
  expandTilde,
  type Preferences,
  savePreferences,
} from '../config/preferences.js'
import { boostAction, removeBackgroundAction } from '../core/actions/extension.js'
import type { Action, OptionSpec } from '../core/actions/index.js'
import { ACTIONS, compressAction, convertAction } from '../core/actions/index.js'
import { mediaEditAction } from '../core/actions/media.js'
import { cropAction, resizeAction, trimAction } from '../core/actions/resize.js'
import { putBack, saveCopy, type Taken, takeImage, undoClip } from '../core/clip.js'
import { parseColour } from '../core/colour/parse.js'
import { DEFAULT_STEPS, type StepSpec } from '../core/colour/scale.js'
import { describeResult } from '../core/describe.js'
import {
  emptyDirectory,
  type ForgeError,
  ffmpegMissing,
  isForgeError,
  unexpectedError,
  unsupportedCompress,
  unsupportedPdf,
} from '../core/errors.js'
import { runPlan } from '../core/execute-jobs.js'
import { boostScales } from '../core/extension-targets.js'
import { type FolderScan, scanFolder } from '../core/folder.js'
import { FORMATS } from '../core/formats.js'
import { compressFloor, hasPicture, sizeUnitsFor, soundBytes } from '../core/media.js'
import { uniqueOutputPath } from '../core/output-path.js'
import type { InputFailure } from '../core/resolve.js'
import { type Suggestion, suggestFormat } from '../core/suggest.js'
import type {
  Box as CropBox,
  FormatId,
  ImageInfo,
  Job,
  MediaInfo,
  MediaOptions,
  Progress,
  ResizeSpec,
  Result,
  SourceInfo,
} from '../core/types.js'
import { describeSize, formatBytes, parseSize } from '../core/units.js'
import { checkWriteSafety } from '../core/write-safety.js'
import { encodeToBuffer, type ImageMeasure } from '../engines/image.js'
import { pdfiumEngine } from '../engines/pdfium.js'
import { probe } from '../engines/registry.js'
import type { ExtensionId } from '../extensions/catalog.js'
import { displayName, displayPath } from '../utils/display-path.js'
import { lastSegment } from '../utils/last-segment.js'
import type { Pasteboard } from '../utils/pasteboard.js'
import { printable } from '../utils/printable.js'
import {
  splitPastedPaths,
  startsLikePath,
  trimPasted,
  unescapePath,
} from '../utils/unescape-path.js'
import type { Trail } from './bar-art.js'
import type { HistoryBlock } from './blocks.js'
import { HistoryEntry } from './blocks.js'
import { ClickTargetProvider } from './ClickTargets.js'
import { ColourFlow } from './colour/ColourFlow.js'
import { COLOUR_CARD_KEYS } from './colour/colour-art.js'
import { type Start as ColourStart, typedPair } from './colour/state.js'
import { COMMANDS, type Command, isCommandBuffer, listCommands, parseCommand } from './commands.js'
import { type Completion, completePath } from './complete.js'
import { type CropAt, CropStep } from './components/CropStep.js'
import { DoneScreen } from './components/Done.js'
import { EditDone } from './components/EditDone.js'
import { EditPicker } from './components/EditPicker.js'
import { ErrorLine } from './components/ErrorLine.js'
import { ErrorPanel } from './components/ErrorPanel.js'
import { ExactSizeStep } from './components/ExactSizeStep.js'
import { FfmpegStep } from './components/FfmpegStep.js'
import { HeaderBar, isWorking } from './components/HeaderBar.js'
import { HintBar } from './components/HintBar.js'
import { Home, homeKeys, Suggestions } from './components/Home.js'
import { type Cut, LengthStep } from './components/LengthStep.js'
import { MediaFormatPicker } from './components/MediaFormatPicker.js'
import { NameTaken } from './components/NameTaken.js'
import { isNotice, type Notice, Notices, NoticesContext, noticeRows } from './components/Notices.js'
import { PageGrid } from './components/PageGrid.js'
import { Prompt } from './components/Prompt.js'
import { QualityStep } from './components/QualityStep.js'
import { ResizeStep } from './components/ResizeStep.js'
import { SaveAs } from './components/SaveAs.js'
import { Select } from './components/Select.js'
import { SizeAside } from './components/SizeAside.js'
import { SIZE_UNIT_IDS, SizeField, type SizeUnit } from './components/SizeField.js'
import { StagedFiles } from './components/StagedFiles.js'
import { StepTitle } from './components/StepTitle.js'
import { ThemePicker } from './components/ThemePicker.js'
import { Working } from './components/Working.js'
import { safeStem } from './destinations.js'
import {
  actionForRow,
  type EditRow,
  type EditTools,
  editRow,
  editRows,
  mediaEditRows,
  realTools,
  rowValues,
  shapeOf,
  type ToolState,
  toolState,
} from './edit.js'
import { notePanel } from './error-art.js'
import { fieldKey } from './field-key.js'
import { AboutFlow, type AboutSystem, realAbout } from './flows/about.js'
import { ExtensionsFlow } from './flows/extensions.js'
import { HUB_ACTIONS, PdfFlow, type PdfResume } from './flows/pdf.js'
import { usePresetsOnDone } from './flows/presets.js'
import { realUpdater, UpdateFlow, type Updater } from './flows/update.js'
import { WatchFlow } from './flows/watch.js'
import { useFocusIn } from './focus.js'
import { HOME_MARGIN, type Row } from './home-art.js'
import { motionEnabled } from './motion.js'
import { isStrayEscapeSequence } from './mouse.js'
import { CLEAR_SCREEN, historyForRedraw } from './redraw.js'
import { largestPercent } from './resize-art.js'
import { requestRestart } from './restart.js'
import { openPath, revealLabel, revealPath } from './reveal.js'
import {
  addToStage,
  clearStage,
  emptyStage,
  folderStage,
  type Stage,
  stagedVerb,
  stagedView,
  underField,
} from './stage.js'
import { Text } from './Text.js'
import { ThemeProvider } from './ThemeContext.js'
import { writeToTerminal } from './terminal-write.js'
import {
  colourProp,
  type HomeTab,
  MODE_KEYS,
  modeColours,
  modeForKey,
  modePalette,
  paintsCanvas,
  paletteFor,
  type ShellMode,
  SYMBOLS,
  tabStep,
  VERSION,
} from './theme.js'
import { answerFor, type Question, trailFor } from './trail.js'
import { useAfter } from './useAfter.js'
import { PASTE, useKeys } from './useKeys.js'
import { type MeasuredSize, type MeasureFn, useMeasuredSize } from './useMeasuredSize.js'
import { useMouseRouting } from './useMouseRouting.js'
import { useTerminalBackground } from './useTerminalBackground.js'
import { bandFor, CARD_WIDTH } from './width.js'
import { phaseLabel } from './working-art.js'

/**
 * Everything below `App` is dumb and takes props; this is the only file
 * that knows the flow. It walks: drop a file -> pick a target format ->
 * (quality, for a lossy target only) -> save as (name and folder) -> convert ->
 * show the result.
 */
export type Step =
  | 'theme'
  | 'idle'
  /** `/extensions`: install and remove the AI tools. */
  | 'extensions'
  | 'update'
  | 'about'
  /** Edit's picker: Sharpen, Boost resolution (2× / 4× on the row), Remove background. */
  | 'edit'
  /** Edit's Resize: the 0–200 % slider (H3). */
  | 'resize'
  /** Resize's `#`: the exact Width × Height pair (X). */
  | 'exact-size'
  /** Edit's Crop to shape: the preview, where the crop is moved and zoomed (P3). */
  | 'crop'
  /** Video and sound with no ffmpeg here: the download, in place (video spec §3.7). */
  | 'ffmpeg'
  /** Video and sound: Trim's screen, and GIF's which part (video spec §3.4, §3.5). */
  | 'length'
  /** Sound: the bitrate, in kbps, as convert's and compress's quality. */
  | 'bitrate'
  /** Compress: by quality, or to a target size. */
  | 'mode'
  /** Compress: the target-size field. */
  | 'size'
  | 'target'
  /** A document target only: which pages to rasterise (all/first/choose). */
  | 'pages'
  /** 'Choose pages' from the `pages` step opens `PageGrid` here. */
  | 'page-picker'
  /** A document target only: the rasterisation resolution. */
  | 'dpi'
  | 'quality'
  /** Where the file goes and what it is called, as one answer (P1). */
  | 'save-as'
  | 'overwrite'
  | 'converting'
  /** A target size searched down to the lowest quality and still missed it — see `sizeUnreachable`. */
  | 'size-unreachable'
  | 'result'
  /** `/pdf`: `PdfFlow` owns the conversation; this just mounts it. */
  | 'pdf'
  /** Between `PdfFlow` handing off its jobs and `runJobs` finishing. */
  | 'pdf-running'
  /** `checkWriteSafety` refused the job `PdfFlow` handed off — see `pdfBlocked`. */
  | 'pdf-blocked'
  /** Colour mode's palette or scale: `ColourFlow` owns the conversation. */
  | 'colour'
  /** Done's → : Continue editing, one window over Done (presets, W2). */
  | 'preset-edit'
  /** Done's p : Save as preset, over Done. */
  | 'preset-save'
  /** A folder in convert mode, converted then watched: `WatchFlow` owns it. */
  | 'watch'

/**
 * Save as while it is open: the folder chosen, and the name the action
 * proposes for it (`plan()`), split where the user edits it. The typed name
 * itself is `text`.
 */
interface SaveAsState {
  folder: string
  /** The proposed name without its extension: what an empty field means. */
  stem: string
  /** Fixed: decided by the target format, not by what is typed. */
  ext: string
  /**
   * What a save that writes many files (a document rasterised a page at a
   * time) will write, in place of a name to edit: "doc-1.jpg … 12 files".
   */
  fixedName?: string | undefined
  /** Typed into, so a new folder's proposal no longer replaces it. */
  edited: boolean
  /** The name as it was typed when last saved, to come back to. */
  given?: string | undefined
  /** Bumped to open it afresh. */
  opened: number
}

/**
 * What the overwrite question needs to remember while it is being asked:
 * where the user chose to save, what that resolved to, and the name "keep
 * both" would use — resolved once, when the question is raised, rather than
 * on every render of it.
 */
interface PendingOverwrite {
  destination: string
  output: string
  keepBoth: string
  /** The one there now, for the title's right: its size and when it changed. */
  existing?: TakenFile | undefined
}

/** A file already at the path a save wants, as Name taken describes it. */
interface TakenFile {
  bytes: number
  modified: Date
}

/** One `stat` of the file in the way, or nothing if it has gone since. */
function takenFile(path: string): TakenFile | undefined {
  try {
    const st = statSync(path)
    return { bytes: st.size, modified: st.mtime }
  } catch {
    return undefined
  }
}

/**
 * What the "can't get that small" question needs to remember while it is
 * being asked: the plan a target-size search already fell short of, plus the
 * smallest quality/size that search actually found, so "use the lowest
 * quality" can finish the same conversion rather than re-planning or
 * re-searching from scratch.
 */
interface PendingSizeUnreachable {
  planned: Extract<Job, { op: 'convert' }>
  destination: string
  output: string
  opts: ConversionOpts
  targetBytes: number
  smallest: number
  quality: number
  /**
   * The rung the smallest size came from. Only a document has one — an image
   * search has a single lever — so it names the resolution the "use it anyway"
   * answer would write at.
   */
  dpi?: number
  /** A video's: the floor as the size its encode aims at (video spec §3.3). */
  media?: MediaOptions
}

/**
 * How a conversion was asked for. `targetBytes` travels with it so the search
 * happens inside `runPlan` rather than in the shell — which is what makes a
 * document reach the resolution ladder at all.
 */
interface ConversionOpts {
  force?: boolean
  output?: string
  targetBytes?: number
}

/**
 * What the `/pdf` write-safety refusal needs to remember while it is being
 * asked: the exact jobs `PdfFlow` handed off (so "Replace" can re-check them
 * with `force: true` rather than needing to re-derive them) and the refusal
 * itself. `checkWriteSafety` is per-job all-or-nothing, and every page
 * action this phase built plans exactly one job, so `failures` is one entry
 * in practice — kept as a list because `checkWriteSafety`'s own return type
 * is, and nothing here should assume more than that type promises.
 */
interface PendingPdfRefusal {
  jobs: Job[]
  failures: InputFailure[]
  /**
   * Where "Cancel" lands. `/pdf`'s five page operations hand off through
   * `onDone` with nowhere else of their own to go back to but the hub —
   * `'pdf'` reopens `PdfFlow` there, same as it always has. An ordinary
   * document conversion run through the wizard (`confirmDocumentConversion`)
   * has a real step to return to instead: `'save-as'`, where "pick a
   * different folder" is the actual fix, exactly what `answerOverwrite`'s
   * own cancel already offers every other format that hits this same
   * question. Defaulting a caller-less refusal to the hub would silently
   * drop a wizard conversion into `/pdf` instead of back into its own flow.
   */
  cancelTo: 'pdf' | 'save-as'
}

let blockSeq = 0

/** Edit's actions name their output with `output`, not `destination`. */
const isExtensionAction = (act: Action): boolean =>
  act === boostAction ||
  act === removeBackgroundAction ||
  act === trimAction ||
  act === resizeAction ||
  act === cropAction

/** What edit says to a file that is not an image. */
const editRefusal = (source: SourceInfo): string =>
  `${SYMBOLS.warn} Edit works on images; ${displayName(source.path)} is ${FORMATS[source.format].label}.`

const nextId = () => `b${++blockSeq}`

/**
 * One line for the history, once a page-operation job has actually run.
 * `HistoryEntry`'s `result` block is built around a `convert` job's
 * one-source-to-one-target shape (spec: "A page operation's result gets its
 * own rendering once one exists") — until it does, a `note` block says what
 * happened in plain words rather than the shell crashing trying to draw a
 * before/after pair for a job that has neither.
 */
function describePdfResult(result: Result): string {
  const { job } = result
  const outputs = job.outputs.map((o) => displayName(o))
  const first = outputs[0] ?? ''
  switch (job.op) {
    /**
     * The case this switch used to lack.
     *
     * A rasterisation writes one file per page, and falling through to the old
     * `done — ${first}` default reported one filename for however many were
     * written. The count comes from `describeResult` rather than being worked
     * out again here — that is the module which owns what a result means.
     */
    case 'convert': {
      const view = describeResult(result)
      return view.outputs.length === 1
        ? `${view.verb} — ${first}`
        : `${view.verb} into ${view.outputs.length} files`
    }
    case 'merge':
      return `merged ${job.sources.length} files into ${first}`
    case 'split':
      return `split into ${outputs.length} files`
    case 'extract':
      return job.separate
        ? `extracted ${job.pages.length} pages into ${outputs.length} files`
        : `extracted ${job.pages.length} pages into ${first}`
    case 'delete':
      return `removed ${job.pages.length} pages — ${first}`
    case 'rotate':
      return `rotated ${job.turns * 90}° — ${first}`
    case 'boost':
      return job.scale === 1 ? `sharpened — ${first}` : `boosted ${job.scale}× — ${first}`
    case 'remove-background':
      return `removed the background — ${first}`
    default: {
      /**
       * No silent default. The old one swallowed `convert` and reported a
       * wrong-but-plausible sentence; a new op must fail to compile instead.
       */
      const unhandled: never = job
      throw new Error(`describePdfResult has no wording for ${JSON.stringify(unhandled)}`)
    }
  }
}

/**
 * What a running job is doing, as its action says it ("Splitting"), found
 * from the job itself — never a flag threaded down by hand, so it can never
 * say one operation while another runs. Every op is an action's id.
 */
function verbOf(job: Job | undefined): string | undefined {
  return ACTIONS.find((a) => a.id === job?.op)?.verb
}

/**
 * The fallback for callers that do not supply preferences — tests, and any
 * direct render. It carries a theme on purpose: an absent theme is the
 * first-run signal, and defaulting to it would put the theme picker in front
 * of every test that only wanted to convert a file.
 *
 * The production path never uses this. `launchShell` always passes what
 * `loadPreferences` returned, where a genuinely absent theme does raise the
 * picker — which is what `theme-picker.test.tsx` exercises by passing
 * `DEFAULT_PREFERENCES` explicitly.
 */
const APP_DEFAULT_PREFS: Preferences = { ...DEFAULT_PREFERENCES, theme: 'dark' }

/**
 * Routes mouse events into the frame. Renders nothing.
 *
 * A component rather than a `useMouseRouting` call in `App`'s own body, for a
 * reason that is invisible until the whole thing is assembled and is easy to
 * reintroduce: `useContext` only sees providers *above* the component that
 * calls it. `App` renders `ClickTargetProvider` as its own child, so a routing
 * hook in `App`'s body reads the inert fallback registry — the one that
 * hit-tests to nothing — while every clickable component below registers into
 * the real one. Two registries that never meet: no click can land, and hover
 * can never switch the terminal into motion reporting. Routing has to be
 * *inside* the provider, which is the whole job of this component.
 *
 * Rendered as the root Box's first child so its subscription is in place
 * before any sibling registers a target. That is belt-and-braces — the
 * registry defers its notifications for exactly this reason — but it costs
 * nothing and removes the ordering question entirely.
 */
function MouseRouter({
  rootRef,
  revision,
}: {
  rootRef: RefObject<DOMElement | null>
  revision: number
}) {
  useMouseRouting(rootRef, revision)
  return null
}

/** Sentinel `Select` value for the convert-target picker's row into `/pdf`. */
/**
 * The largest image whose formats are measured as they are highlighted: 12
 * megapixels, a typical phone photo. Above it a single encode (AVIF, worst
 * case) runs long enough to overlap the conversion the user then asks for.
 */
const MEASURE_MAX_PIXELS = 12_000_000

/** How long a job runs before Working is shown at all (W5). */
const WORK_AFTER_MS = 300

/** How long what the shell just said stays on screen before it goes to the scrollback (`notices`). */
export const NOTICE_SHOWN_MS = 8_000
/** Notices drawn at once; older ones go to the scrollback. */
const MAX_NOTICES = 3
const NO_NOTICES: readonly Notice[] = []

const GOTO_PDF = '__goto-pdf__'

/** The `/pdf` command, looked up once rather than re-found on every render. */
const pdfCommand = COMMANDS.find((c) => c.name === 'pdf')

/** How long the rows a drop just added wear the band before they settle. */
const FRESH_MS = 1200

/**
 * How soon after a piece of a paste the next piece must be handled to be
 * joined to it. A terminal that does not bracket pastes can still split one
 * across reads; the pieces come a few ms apart, but a busy render between
 * them can hold the second back. No one types that fast after a paste.
 */
const DROP_PIECE_MS = 100

/** Text, not a key: what a piece of a paste looks like when it arrives. */
const isText = (input: string, key: Key) =>
  input !== '' &&
  !key.ctrl &&
  !key.meta &&
  !key.super &&
  !key.return &&
  !key.escape &&
  !key.tab &&
  !key.backspace &&
  !key.delete &&
  !key.upArrow &&
  !key.downArrow &&
  !key.leftArrow &&
  !key.rightArrow &&
  !isStrayEscapeSequence(input)

/**
 * What a pasted or typed path turned out to name. `anyExists` is false when
 * nothing in it is on disk at all — every failure a missing file or a path
 * that cannot be one — which is how a paste of plain text, or half a path,
 * is told apart from a drop.
 */
interface DropResolution {
  sources: SourceInfo[]
  failures: InputFailure[]
  anyExists: boolean
  /**
   * The text named one path, and it could not be read: a refusal of that
   * path, to answer in a row under the field. Not set for a folder, or for
   * several paths at once.
   */
  single?: boolean
  /** A folder, read whole: staged as the folder it is (see `folderStage`). */
  folder?: FolderScan
}

/**
 * The failures that mean "there is nothing here", rather than "there is a
 * file here that could not be read". `path-too-long` is among them: a pasted
 * paragraph is not a path, and calling it one left out would be wrong.
 */
const NOTHING_THERE = new Set(['file-not-found', 'not-a-directory', 'path-too-long'])

const asFailure = (path: string, e: unknown): InputFailure => ({
  path,
  error: isForgeError(e) ? e : unexpectedError(e),
})

/** Columns of painted margin on each side of the canvas (see `paint` in `App`). */
export const PAINT_INSET = 2

const resolution = (sources: SourceInfo[], failures: InputFailure[]): DropResolution => ({
  sources,
  failures,
  anyExists: sources.length > 0 || failures.some((f) => !NOTHING_THERE.has(f.error.code)),
})

/**
 * Reads what a path, a drop of several, or a folder names — shared by a typed
 * path's ↵ and a paste read the moment it lands.
 *
 * Tried whole and unescaped, before anything is split on whitespace. A single
 * dropped file is the overwhelmingly common case, and a terminal's own
 * escaping of it can be *incomplete* rather than absent: Terminal.app leaves
 * the space before "AM.png"/"PM.png" unescaped in a macOS screenshot's
 * filename (confirmed against the literal bytes it pastes), so splitting on
 * whitespace first read one dropped screenshot as two nonexistent fragments
 * and never resolved the real file at all. `unescapePath` strips every
 * backslash wherever one appears, so it reconstructs the true filename either
 * way; two real paths joined by a space essentially never match anything on
 * disk as one string, so a genuine multi-file drop still falls through.
 *
 * Split only when the whole names nothing on disk: a file that is there but
 * can't be read (a format Forge doesn't know) is reported as itself, not as
 * the fragments a split would make of its name.
 *
 * Then split with `splitPastedPaths`, on the raw text: a real OS drag of
 * several files pastes every escaped path on one line, space-separated, and
 * unescaping first would leave nothing able to tell an escaped space inside a
 * filename from the plain one between two paths. That is why the home
 * `Prompt` is given `rawOnSubmit`.
 *
 * Then a folder, read non-recursively through `resolve.ts` as the CLI does
 * without `--recursive` (phase 3 §4; probed whole as a file it was refused as
 * "Not a file", UX audit #11).
 */
async function resolveDrop(text: string): Promise<DropResolution> {
  const trimmed = trimPasted(text)
  let path = unescapePath(trimmed)
  let error: unknown
  try {
    return resolution([await probe(path)], [])
  } catch (e) {
    error = e
  }
  const namesNothing = (e: unknown) => isForgeError(e) && NOTHING_THERE.has(e.code)

  // The text as it is, for a name with a real backslash in it that a terminal
  // left unescaped (WezTerm escapes only spaces), or one typed by hand.
  if (namesNothing(error) && trimmed !== path) {
    try {
      return resolution([await probe(trimmed)], [])
    } catch (e) {
      if (!namesNothing(e)) {
        path = trimmed
        error = e
      }
    }
  }

  const paths = namesNothing(error) ? splitPastedPaths(trimmed) : []
  if (paths.length > 1) {
    const sources: SourceInfo[] = []
    const failures: InputFailure[] = []
    for (const path of paths) {
      try {
        sources.push(await probe(path))
      } catch (e) {
        failures.push(asFailure(path, e))
      }
    }
    return resolution(sources, failures)
  }

  if (isForgeError(error) && error.code === 'not-a-file') {
    const isDirectory = await stat(path).then(
      (s) => s.isDirectory(),
      () => false,
    )
    if (isDirectory) {
      // Read whole and by content (`scanFolder`): every file, each kind
      // counted, so a folder can be one thing on home — and watched.
      const scan = await scanFolder(path)
      if (scan.sources.length === 0) {
        return resolution([], [...scan.failures, { path, error: emptyDirectory(path) }])
      }
      return { ...resolution(scan.sources, scan.failures), folder: scan }
    }
  }
  return { ...resolution([], [asFailure(path, error)]), single: true }
}

/**
 * What became of a copied image's result: on the clipboard; saved to the
 * default folder because something else was copied meanwhile (E3); or left
 * aside because a compression came out larger, which is never put back.
 */
type ClipDone =
  | { status: 'placed'; output: string }
  | { status: 'changed'; saved: string }
  | { status: 'larger' }

/** The ⌘V hint, and the key it names: what a terminal sends as an empty paste. */
const PASTE_HINT = { key: '⌘V', words: 'to paste from clipboard' } as const

/** The settings' own screens: each draws its own bar, so the app's mode bar stays off them. */
const SETTINGS_STEPS: ReadonlySet<string> = new Set(['extensions', 'update', 'about'])

export function App({
  initialWidth,
  initialHeight,
  prefs = APP_DEFAULT_PREFS,
  configWarning,
  tools = realTools,
  updater = realUpdater,
  about = realAbout,
  latestRelease,
  pasteboard = null,
  clipRoot,
}: {
  initialWidth?: number
  initialHeight?: number
  prefs?: Preferences
  configWarning?: string
  /** Where edit reads and installs its tools from; tests pass a fake. */
  tools?: EditTools
  /** What /update checks and installs with; tests pass a fake. */
  updater?: Updater
  /** What /about opens links and reads credits with; tests pass a fake. */
  about?: AboutSystem
  /**
   * A newer Forge for home's band, found in the background at start-up.
   * Default: the once-a-day check (src/update/check.ts). Tests pass a fake.
   */
  latestRelease?: () => Promise<string | undefined>
  /**
   * The clipboard as a picture, for ⌘V on home; null where there is none
   * (not macOS, over SSH). launch.tsx passes the real one; tests a fake.
   */
  pasteboard?: Pasteboard | null
  /** Where a copied image and its result are kept; the system temp folder by default. */
  clipRoot?: string
}) {
  const { stdout } = useStdout()
  const [measured, setMeasured] = useState(initialWidth ?? stdout?.columns ?? 80)
  /** Only `PdfFlow`'s page grid needs this — see `gridLayout`. */
  const [measuredHeight, setMeasuredHeight] = useState(initialHeight ?? stdout?.rows ?? 24)

  /**
   * Bumped to remount `<Static>`, which replays every history block. See
   * `redraw.ts` for why a width change has to clear the screen and redraw.
   */
  const [staticGeneration, setStaticGeneration] = useState(0)

  useEffect(() => {
    if (initialWidth !== undefined || !stdout) return
    let drawnAt = stdout.columns ?? 80
    const onResize = () => {
      const columns = stdout.columns ?? 80
      // Height alone reflows nothing, so only a width change pays for a redraw.
      if (columns !== drawnAt) {
        drawnAt = columns
        writeToTerminal(CLEAR_SCREEN, stdout)
        setHistory((h) => historyForRedraw(h, columns))
        setStaticGeneration((g) => g + 1)
      }
      setMeasured(columns)
    }
    stdout.on('resize', onResize)
    return () => {
      stdout.off('resize', onResize)
    }
  }, [initialWidth, stdout])

  useEffect(() => {
    if (initialHeight !== undefined || !stdout) return
    const onResize = () => setMeasuredHeight(stdout.rows ?? 24)
    stdout.on('resize', onResize)
    return () => {
      stdout.off('resize', onResize)
    }
  }, [initialHeight, stdout])

  /**
   * Seeded with the banner rather than having an effect push it, so it is
   * `<Static>` item zero from the very first frame. Ink flushes static output
   * above everything that re-renders, so this is what pins the banner to the
   * top of the session — it scrolls up as history grows, exactly as Claude
   * Code's does, instead of being redrawn below the scrollback on every
   * update, which is how it ended up in the middle of the screen.
   *
   * Skipped when no theme has been chosen: the first-run picker owns the
   * screen until it is answered, and the banner is pushed once it is.
   */
  /**
   * Seeded with the banner so it is `<Static>` item zero from the first
   * frame, which is what pins it to the top: Ink flushes static output above
   * everything that re-renders.
   *
   * An animated version of this existed briefly and was removed. Animation
   * cannot live in `<Static>` — static output is written once and never
   * redrawn — so it had to run in the live region and then settle into
   * history. That height change left earlier lines on screen: the rendered
   * frame was correct, and the terminal showed a stack of stale rules
   * underneath it. A still mark costs nothing and cannot do that.
   */
  /**
   * Empty. The banner is drawn by `playIntro` before Ink mounts, so by the
   * time this renders it is already on screen as ordinary scrollback — see
   * intro.ts. The one exception is first run, where the theme picker owned
   * the screen and there was no palette to draw it in; `chooseTheme` pushes
   * one then.
   */
  const [history, setHistory] = useState<HistoryBlock[]>([])
  /**
   * Held in state, not read straight from `prefs`, so `/theme` re-themes the
   * running session rather than only the next launch.
   */
  const [theme, setTheme] = useState<'dark' | 'light' | undefined>(prefs.theme)
  /**
   * Derived straight from `theme`, not read from context: this component is
   * the one that renders `<ThemeProvider palette={palette}>` a few
   * hundred lines down, and a component can never consume a context value
   * from a provider it renders as its own descendant — that provider's value
   * only reaches components further down the tree. Reading `useTheme()` here
   * instead resolved against whatever wraps `<App>` from the outside
   * (launch.tsx's provider, frozen at the palette computed once at launch),
   * so this file's own top-level elements — the mode header background among
   * them — never picked up a theme chosen or changed mid-session.
   */
  const basePalette = paletteFor(theme)
  /**
   * Light and dark paint their own canvas (see the root Box). Where the
   * terminal's own background follows it (OSC 11), its padding is the
   * margin. Where it cannot (NO_COLOR, a multiplexer), that padding keeps
   * the terminal's colour: content at column 0 sat against a dark edge and
   * read as cropped. So there the canvas keeps a painted margin, and
   * everything lays out in `width`, `PAINT_INSET` columns in from each side,
   * under a blank row.
   */
  const paint = paintsCanvas(basePalette)
  const followed = useTerminalBackground(basePalette)
  const inset = paint && !followed ? PAINT_INSET : 0
  const top = inset > 0 ? 1 : 0
  const width = paint ? Math.max(20, measured - 2 * inset) : measured
  // The blank row on top, if any, comes out of the layout's rows: a frame
  // taller than the window makes Ink clear and redraw every frame.
  const height = measuredHeight - top
  const band = bandFor(width)
  // A picker's band stops where the file card above it does.
  const pickerWidth = Math.min(width, CARD_WIDTH)
  /**
   * Preferences as they stand *now*, seeded from what was loaded at launch.
   * `d` changes the default output mid-session, and the banner, the preset
   * list and the `default` tag must all follow it without waiting for a
   * relaunch — so they all read this, never the `prefs` prop.
   */
  const [livePrefs, setLivePrefs] = useState<Preferences>(prefs)
  const { exit } = useApp()

  /**
   * A newer Forge, for home's band (N1). Asked once at start-up, in the
   * background: the cache answers at once, and a cache more than a day old
   * is refreshed without holding anything up. /update keeps it current.
   */
  const [release, setRelease] = useState<string>()
  const keepRelease = useCallback(async (latest: string | undefined) => {
    const { isNewer } = await import('../update/check.js')
    setRelease(latest !== undefined && isNewer(latest, VERSION) ? latest : undefined)
  }, [])
  useEffect(() => {
    let live = true
    const ask = latestRelease ?? (() => backgroundRelease(prefs))
    void ask()
      .then((v) => {
        if (live) void keepRelease(v)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [latestRelease, prefs, keepRelease])
  const [step, setStep] = useState<Step>(prefs.theme === undefined ? 'theme' : 'idle')
  /**
   * Which action the staged file is being put through. Dropping a file means
   * convert; `/compress` switches it. The action layer already supports more
   * than one action — `actionsFor` has existed since 0.1 and never been
   * called, because until now there was nothing to choose between.
   */
  const [mode, setMode] = useState<ShellMode>('convert')
  /**
   * Edit's tools as this Mac has them — installed, not, or installing with
   * the real bytes so far — read when its picker opens. `checking` once every
   * byte is in and the archive is being verified.
   */
  const [toolStates, setToolStates] = useState<Partial<Record<ExtensionId, ToolState>> | undefined>(
    undefined,
  )
  const [checking, setChecking] = useState(false)
  const installAbort = useRef<AbortController | undefined>(undefined)
  /**
   * What Trim and Resize know about the image in Edit: its upright size
   * and what a trim leaves. Measured once per image when the list opens.
   */
  const [imageMeasure, setImageMeasure] = useState<
    { path: string; measure: ImageMeasure } | undefined
  >(undefined)
  /** Resize's slider, in percent of the upright size. */
  const [resizePercent, setResizePercent] = useState(100)
  /**
   * Where the crop stood when its preview was left for Save as, so coming
   * back finds it there. A row chosen afresh starts on the guess again.
   */
  const [cropAt, setCropAt] = useState<CropAt | undefined>(undefined)
  /** A video's frame, as a picture: Crop to shape's preview of a video (video spec §3.4). */
  const [cropFrame, setCropFrame] = useState<ImageInfo | undefined>(undefined)
  /**
   * What everything below is drawn in: the base palette with its role
   * colours handed to the current mode (`modePalette`), so a screen tells
   * one colour story. The base is kept for `modeColours`, which needs the
   * mode fills as they are, and the banner reads `brand`, which never moves.
   */
  const palette = modePalette(basePalette, mode)
  const action = mode === 'compress' ? compressAction : convertAction
  /** Where the target-size search has got to, for an honest counter. */
  /**
   * `dpi` names the rung a document search is on. Without it, a search
   * dropping from 150 to 120 dpi looks like the counter restarting for no
   * reason — the CLI learned this the same way.
   */
  const [attempt, setAttempt] = useState<{ n: number; of: number; dpi?: number } | undefined>(
    undefined,
  )
  /**
   * Aborts the target-size search that is running right now, if one is.
   *
   * A ref rather than state: esc is delivered to a synchronous `useKeys`
   * handler, which must abort the controller the in-flight `runPlan` was
   * actually given — not whichever one the last render happened to close
   * over. Same reasoning as `Select`'s `indexRef`.
   */
  const searchAbort = useRef<AbortController | undefined>(undefined)
  /**
   * A video or sound encode is running, from before ffmpeg's first report:
   * esc stops it and goes back, rather than landing on a size step that a
   * convert does not have.
   */
  const mediaRun = useRef(false)

  /**
   * The target-size field's unit, and whether tab has moved focus onto it.
   *
   * The typed text stays the source of truth for the *amount* only — a unit
   * typed directly (`2mb`) still wins, so the picker is a convenience rather
   * than a second way of saying the same thing that could disagree with the
   * first. `kb` rests as the default because it is the unit a target size is
   * usually written in.
   */
  const [sizeUnit, setSizeUnit] = useState<SizeUnit>('kb')
  const [unitFocused, setUnitFocused] = useState(false)
  /**
   * The latest `{ phase: 'page' }` event `runJobs` reported, or `null` until
   * one actually arrives. `null` is the whole point, not just an initial
   * value: invariant 7 forbids a fabricated percentage, and an operation
   * that only ever reports the phases-only variant (`reading`/`decoding`/
   * `encoding`/`writing`) must never grow a page bar — gating on "a page
   * event has been seen" rather than "a job is running" is what keeps a
   * single-file, single-phase conversion from growing a bar it has no real
   * position to show on.
   */
  const [pageProgress, setPageProgress] = useState<{
    done: number
    total: number
    /** The job this count belongs to: what the line names ("Splitting report.pdf"). */
    job: Job
  } | null>(null)
  /**
   * A video's or sound file's seconds encoded of the seconds it will have
   * (video spec §3.6): a true total, so Working draws a real bar. `pass` while
   * a size is hit in two passes; `since` when this pass began, for the time left.
   */
  const [timeProgress, setTimeProgress] = useState<{
    done: number
    total: number
    pass?: { at: 1 | 2; of: 2 } | undefined
    since: number
  } | null>(null)
  /**
   * The job running now, for the Working screen (W5): when it began, what it
   * is doing as its action says it, and the last phase it reported — never a
   * guess. `null` when nothing runs.
   */
  const [work, setWork] = useState<{
    startedAt: number
    verb: string
    phase?: string | undefined
  } | null>(null)
  /** Why a typed size was rejected, shown against the field rather than later. */
  const [sizeError, setSizeError] = useState<string | undefined>(undefined)
  /** A measured alternative worth offering after a compression. */
  const [suggestion, setSuggestion] = useState<Suggestion | undefined>(undefined)
  /**
   * How many `target: 'pdf'` conversions have written a file this session.
   * Unlike `suggestion` (recomputed fresh from one result), the merge offer
   * below only makes sense once a *second* single-image PDF exists to
   * combine the first one with — so this has to survive across separate
   * conversions rather than being derived from the latest result alone. A
   * ref, not state: the count itself is never rendered, only whether it has
   * crossed one, which `mergeOffer` below tracks.
   */
  const pdfOutputsThisSession = useRef(0)
  /**
   * Set once a `target: 'pdf'` conversion brings `pdfOutputsThisSession`
   * above one. Several single-image PDFs are exactly what phase 3's
   * `mergeAction` combines, and once they exist as separate files nothing
   * else in the wizard points at that — so this offers it, the same way the
   * compress flow offers a stronger format. See the render below for why
   * acting on it is left to `/pdf` rather than a dedicated key.
   */
  const [mergeOffer, setMergeOffer] = useState<number | undefined>(undefined)
  const [text, setText] = useState('')
  /**
   * The staged list. What was one file (`SourceInfo | null`) is now a list
   * with two drops accumulating into it — merge needs several files at once,
   * and `resolve.ts`/`run.ts` already speak in lists; the shell was the only
   * place still narrowed to one.
   *
   * The wizard below (target, quality, destination) still walks a single
   * representative file — `source`, derived just below — because picking a
   * target format is one choice for the whole batch, not a per-file one.
   * Only the run itself, and what is drawn on screen, need the full list.
   */
  const [stage, setStage] = useState<Stage>(emptyStage())
  /**
   * Mirrors `stage` for what a drop does once it has been read: the read is
   * async, and the stage it lands on is the one standing then, not the one
   * the paste's render closed over.
   */
  const stageRef = useRef(stage)
  stageRef.current = stage
  /**
   * The copied image while it is staged or running (clipboard, 2026-10-16):
   * read into a run folder of its own, its result written there and put back
   * on the clipboard, with no Save as.
   */
  const [clip, setClip] = useState<Taken | null>(null)
  const clipRef = useRef(clip)
  clipRef.current = clip
  /** Whether the clipboard holds a picture, for home's ⌘V hint. */
  const [clipHint, setClipHint] = useState(false)
  const [clipDone, setClipDone] = useState<ClipDone | null>(null)
  /** Bumped to run the copied image once its answers are in (see `openSaveAs`). */
  const [clipRun, setClipRun] = useState(0)
  /** Mirrors `step`, for a drop's read to know whether home is still showing. */
  const stepRef = useRef(step)
  stepRef.current = step
  /** The `requestId` of a drop being read right now, or 0 — ↵ waits on it. */
  const dropReading = useRef(0)
  /**
   * The last paste onto the empty home field, for the next piece of it to be
   * joined to (`DROP_PIECE_MS`): all of it so far, what of it the field
   * shows (nothing while it is read; all of it once it named nothing, or
   * ended in a slash), and when it came. Gone once it lands as a drop: the
   * paste is over, and a key pressed then is a key.
   */
  const dropPiece = useRef<{ text: string; shown: string; at: number } | undefined>(undefined)
  /**
   * How many of the last staged files the latest drop added, for the band
   * they wear for `FRESH_MS`. `at` makes each drop a new value, so a second
   * drop inside the window restarts it.
   */
  const [fresh, setFresh] = useState({ count: 0, at: 0 })
  useEffect(() => {
    if (fresh.count === 0) return
    const timer = setTimeout(() => setFresh({ count: 0, at: 0 }), FRESH_MS)
    return () => clearTimeout(timer)
  }, [fresh])
  /**
   * The first staged file, standing in for "the" file everywhere the wizard
   * only ever needed one — computing option specs, planning a filename
   * preview, and so on. `?? null` keeps the exact `SourceInfo | null` shape
   * this used to be, so none of that logic has to change.
   */
  const source: SourceInfo | null = stage.sources[0] ?? null
  /** The units a target size is offered in: a video's or sound file's own (B never). */
  const unitsHere: readonly SizeUnit[] =
    source?.kind === 'media' ? sizeUnitsFor(source) : SIZE_UNIT_IDS
  /** The smallest a video or sound file can be compressed to: a typed size under it is refused. */
  const floorHere = source?.kind === 'media' ? compressFloor(source) : undefined
  /** Done after editing a video or sound file: c takes the result on to compress. */
  const compressNextFor = (r: Result | null) =>
    mode === 'edit' && r?.job.sources[0]?.kind === 'media'
  /**
   * Whether converting or compressing right now would silently act on only
   * the first of several staged files. Batch convert/compress is deferred —
   * see the note above `convert()` — so this is what keeps that deferral
   * from being a silent one: `/convert` and `/compress`, and a drop that
   * would otherwise advance straight into the wizard, all check this first
   * and refuse instead of quietly picking `stage.sources[0]` for the user.
   */
  const stagedBatch = stage.sources.length > 1
  /** Anything but an empty idle prompt — see `isWorking` and `HeaderBar`. */
  const working = isWorking(step, stage.sources.length)
  /** A job is running: a conversion, or a page operation. */
  const running = step === 'converting' || step === 'pdf-running'
  /**
   * Working shows only once a job has run 0.3 s (W5): most finish sooner and
   * go straight to their result. Until then the bar keeps the trail of the
   * question just answered (`lastQuestion`) and the card stays.
   */
  const workShown = useAfter(running, WORK_AFTER_MS)
  const lastQuestion = useRef(step)
  if (!running) lastQuestion.current = step
  /**
   * The command list, while the field holds a command (see
   * `isCommandBuffer`): what matches, and which row ↵ runs. The choice is
   * kept against the text it was made for, so typing — which changes the
   * list — starts it over at the first row without an extra render.
   */
  const [commandChoice, setCommandChoice] = useState({ text: '', at: 0 })
  const commandList = isCommandBuffer(text) ? listCommands(text.slice(1)) : undefined
  const commands = commandList && {
    ...commandList,
    selected: commandChoice.text === text ? commandChoice.at : 0,
  }
  const [values, setValues] = useState<Record<string, unknown>>({})
  /** Edit's chosen row, once one is: what Save as names and the run does. */
  const enhancing: EditRow | undefined =
    mode === 'edit' && source?.kind === 'image'
      ? editRow(source, values.tool)
      : mode === 'edit' && source?.kind === 'media'
        ? mediaEditRows(source).find((r) => r.id === values.tool)
        : undefined
  /** Crop to shape's shape, from the row's pill: what its preview cuts. */
  const cropShape = shapeOf(enhancing, values.shape)
  /** What Save as names and runs for: the row's extension action in edit. */
  const currentAction = enhancing ? actionForRow(enhancing) : action
  const [lastResult, setLastResult] = useState<Result | null>(null)
  const compressNext = compressNextFor(lastResult)
  /**
   * Done's header bar while Done is on screen (K3·a). Done fills the screen
   * live, so the run goes into the scrollback — its bar, then its record —
   * only once Done is left: `doneRecord` holds those blocks until
   * `recordDone` pushes them.
   */
  const [doneBar, setDoneBar] = useState<{ mode: ShellMode; trail: Trail } | null>(null)
  // Presets on Done: p saves what was done, → continues editing it (round 9).
  const presets = usePresetsOnDone({
    result: lastResult,
    setResult: setLastResult,
    mode: doneBar?.mode ?? 'convert',
    trail: doneBar?.trail ?? { answers: [], current: 'Done' },
    width,
    height,
    open: step === 'preset-edit' ? 'edit' : step === 'preset-save' ? 'save' : null,
    setOpen: (open) =>
      setStep(open === 'edit' ? 'preset-edit' : open === 'save' ? 'preset-save' : 'result'),
    prefs: livePrefs,
    setPrefs: setLivePrefs,
    save: savePreferences,
    enabled:
      (doneBar?.mode === 'convert' || doneBar?.mode === 'compress') &&
      clip === null &&
      clipDone === null,
    tools,
  })
  const doneRecord = useRef<HistoryBlock[] | null>(null)
  const [pending, setPending] = useState<PendingOverwrite | null>(null)
  /** Save as's folder and proposed name, while it is open — see `SaveAsState`. */
  const [saving, setSaving] = useState<SaveAsState | null>(null)
  /** The name given at Name, for the header bar's trail while the file is written. */
  const [savedAs, setSavedAs] = useState<string | undefined>(undefined)
  /** Where `PdfFlow` is, as the header bar's trail — it owns its own steps. */
  const [pdfTrailNow, setPdfTrailNow] = useState<Trail>({ answers: [], current: 'Action' })
  /** Where `WatchFlow` is, as the header bar's trail — it owns its own steps. */
  const [watchTrailNow, setWatchTrailNow] = useState<Trail>({ answers: [], current: 'Format' })
  /** How the last /pdf run was asked, so a refused save can reopen its Save as. */
  const [pdfAsked, setPdfAsked] = useState<PdfResume | undefined>(undefined)
  /**
   * What /pdf's Save as was told, as the trail says it after: the folder by
   * its name, then the file — or how many, for a run that writes several.
   */
  const [pdfSaved, setPdfSaved] = useState<string[]>([])
  /** Set to open /pdf on that Save as (Cancel on Name taken); cleared once it is left. */
  const [pdfReopen, setPdfReopen] = useState<PdfResume | undefined>(undefined)
  /** Colour's home: the card chosen, Extract (0), Scale (1) or Palette (2). */
  const [colourChoice, setColourChoice] = useState<0 | 1 | 2>(0)
  /** How the colour flow opens, and the trail it hands up for the bar. */
  const [colourStart, setColourStart] = useState<ColourStart>('palette')
  const [colourTrailNow, setColourTrailNow] = useState<Trail>({ answers: [], current: 'Extract' })
  /** Which steps a scale has, as last kept on the line under its ramp; for the session. */
  const [colourSteps, setColourSteps] = useState<StepSpec>(DEFAULT_STEPS)
  /** Set only while `step === 'pdf-blocked'` — what a refused `/pdf` run can still do. */
  const [pdfBlocked, setPdfBlocked] = useState<PendingPdfRefusal | null>(null)
  /** Set only while `step === 'size-unreachable'` — see `PendingSizeUnreachable`. */
  const [sizeUnreachable, setSizeUnreachable] = useState<PendingSizeUnreachable | null>(null)

  /**
   * Mirrors `text` for the completion callback, for the same reason
   * `Prompt` mirrors its own buffer: reading a directory is async, and by the
   * time it resolves the user may have typed on. Comparing against the ref
   * is what lets a superseded completion be dropped instead of overwriting
   * what they typed — the same rule `requestId` applies to probes.
   */
  const textRef = useRef('')
  textRef.current = text

  /**
   * The refusal of the last thing typed or dropped (E5·b), shown as a row
   * under the home field. Typing, choosing a mode, or leaving home clears it.
   */
  const [homeError, setHomeError] = useState<ForgeError | undefined>(undefined)
  /**
   * What the field held when the row went up. A refused typed path stays in
   * the field to be corrected, so the row clears on a *change* of the text,
   * not on any text.
   */
  const homeErrorFor = useRef('')
  /** Shows `error` under the field, with `field` left in it (a typed path stays). */
  const refuseOnHome = useCallback((error: ForgeError, field = '') => {
    homeErrorFor.current = field
    setText(field)
    setHomeError(error)
  }, [])
  /**
   * Why the file in hand cannot go where it was sent (compress on a PNG, /pdf
   * on a photo). Live, not history: a block in `<Static>` can never be taken
   * back, and this one is only true of that file — it sat above the next
   * file's flow, explaining a refusal nobody had made of it. It goes when
   * the file leaves the bench (esc, a finished run, another drop).
   */
  const [fileRefusal, setFileRefusal] = useState<{ error: ForgeError; path: string } | undefined>(
    undefined,
  )
  const refuseFile = useCallback((error: ForgeError, path: string) => {
    setFileRefusal({ error, path })
  }, [])
  useEffect(() => {
    if (!fileRefusal) return
    const [only, ...rest] = stage.sources
    if (only?.path !== fileRefusal.path || rest.length > 0) setFileRefusal(undefined)
  }, [stage, fileRefusal])
  useEffect(() => {
    if (text !== homeErrorFor.current) setHomeError(undefined)
    // The size step's row goes the same way. Its field is emptied by the
    // submit that raised it, so the row outlives that and goes with the next
    // change: typing makes it stale.
    if (text !== '') setSizeError(undefined)
  }, [text])
  // biome-ignore lint/correctness/useExhaustiveDependencies: `mode` and `step` are the triggers
  useEffect(() => {
    setHomeError(undefined)
  }, [mode, step])

  /**
   * The prompt is the home screen (mockups/flow-parts-2026-10.html, tab 3),
   * staged files or not: home holds the stage in its drop panel
   * (docs/superpowers/specs/2026-10-11-forge-drop-zone-design.md).
   */
  const onHome = step === 'idle'
  /** Done, or one of its windows over it: the run it shows is still on screen. */
  const atDone = step === 'result' || step === 'preset-edit' || step === 'preset-save'
  /** The launch plays on the session's first home only (M8b): leaving it, it is over. */
  const firstHome = useRef(true)
  if (!onHome) firstHome.current = false
  /** Something is staged: home draws it, and the field asks for more. */
  const staged = stage.sources.length > 0
  /** The rows the latest drop added, for their band — none while motion is off. */
  const freshRows = motionEnabled(palette.name) ? fresh.count : 0

  /**
   * Looks at the clipboard for home's ⌘V hint: on opening, each time home
   * comes back, and when the window comes back to the front — a picture is
   * usually copied in another app. A look that fails says no picture.
   */
  const lookAtClipboard = useCallback(() => {
    if (!pasteboard) return
    pasteboard
      .peek()
      .then((p) => setClipHint(p.image !== null))
      .catch(() => setClipHint(false))
  }, [pasteboard])
  useEffect(() => {
    if (onHome) lookAtClipboard()
  }, [onHome, lookAtClipboard])
  useFocusIn(lookAtClipboard, pasteboard !== null)
  /** The hint, while the field is empty on a home with nothing staged. */
  const pasteHint =
    clipHint && onHome && !staged && text === '' && mode !== 'colour'
      ? fieldKey({
          palette,
          key: PASTE_HINT.key,
          words: PASTE_HINT.words,
          colour: modeColours(palette, mode).fg,
          plain: (process.env.NO_COLOR ?? '') !== '',
        })
      : undefined

  /** Path completions for the home field, and which one Tab would take. */
  const [completions, setCompletions] = useState<Completion[]>([])
  const [chosen, setChosen] = useState(0)

  useEffect(() => {
    if (!onHome || text.trim() === '' || isCommandBuffer(text)) {
      setCompletions((c) => (c.length === 0 ? c : []))
      return
    }
    let live = true
    completePath(text).then(
      (found) => {
        if (!live || textRef.current !== text) return
        setCompletions(found)
        setChosen(0)
      },
      () => {
        if (live) setCompletions([])
      },
    )
    return () => {
      live = false
    }
  }, [onHome, text])

  /** Same as `/convert`, `/compress` or `/pdf` with nothing staged. */
  const switchMode = (next: ShellMode) => {
    if (next === mode) return
    // Colour starts from its own home, never from a staged file: what is
    // staged is let go, as `/colour` lets it go (see `runCommand`), and a
    // drop still being read is dropped with it.
    if (next === 'colour') {
      requestId.current++
      dropReading.current = 0
      setStage(clearStage())
    }
    setMode(next)
    setValues({})
  }

  /**
   * ← or → on home: the tab beside `from` on the tab row — the modes, then
   * "/ menu" — stopping at both ends (decided 2026-10-14). The menu
   * tab is the bare "/" in the field, as typing it opens the list. Colour is
   * passed through like any tab: its cards are chosen with a s d.
   */
  const stepTab = (from: HomeTab, delta: 1 | -1) => {
    const next = tabStep(from, delta)
    if (next === from) return
    if (next === 'menu') {
      setText('/')
      return
    }
    setText('')
    switchMode(next)
  }

  /**
   * `1`–`3` on a screen with no text field — the pickers and the quality
   * slider — move the file to that mode, as its command would (see
   * `runCommand` for what that means for the file). Screens that take text
   * leave the digits to the field.
   */
  useKeys(
    (input, key) => {
      const next = modeForKey(input)
      if (key.ctrl || key.meta || !next || next === mode) return
      // Not while a tool installs: that row is busy until it finishes or stops.
      if (installAbort.current) return
      const command = COMMANDS.find((c) => c.mode === next)
      if (command) runCommand(command)
    },
    {
      isActive: ['mode', 'target', 'pages', 'dpi', 'quality', 'edit', 'resize', 'crop'].includes(
        step,
      ),
    },
  )

  /**
   * Keys the command list takes before the field sees them, while it is
   * open: ↑↓ choose a row and ↵ runs it. ↵ with nothing listed falls through
   * to the field, which reports that no command matches.
   */
  const commandKey = (input: string, key: Key): boolean => {
    if (!commands) return false
    // A mode digit right after the slash is the tab row's, not a search: no
    // command name starts with a digit, so it could only match nothing.
    const digitMode = modeForKey(input)
    if (digitMode && !key.ctrl && !key.meta && !key.super && textRef.current === '/') {
      setText('')
      if (digitMode !== mode) switchMode(digitMode)
      return true
    }
    // ←→ leave the menu tab for its neighbours on the tab row while
    // nothing is typed after the slash; past that they move the cursor.
    if (
      (key.leftArrow || key.rightArrow) &&
      !key.ctrl &&
      !key.meta &&
      !key.super &&
      textRef.current === '/'
    ) {
      stepTab('menu', key.rightArrow ? 1 : -1)
      return true
    }
    const last = commands.items.length - 1
    if (key.downArrow || key.upArrow) {
      const step = key.downArrow ? 1 : -1
      // From the previous choice, not this render's: two presses can land
      // before the screen catches up.
      setCommandChoice((prev) => {
        const from = prev.text === textRef.current ? prev.at : 0
        return { text: textRef.current, at: Math.max(0, Math.min(last, from + step)) }
      })
      return true
    }
    if (key.return) {
      const command = commands.items[commands.selected]
      if (!command) return false
      runCommand(command)
      return true
    }
    return key.tab
  }

  /**
   * Keys the home screen takes before the field sees them: `1`–`3` pick a
   * mode, but only on an empty field, so a path can still have digits in it;
   * Tab and the arrows act on the completions, or on the command list while
   * it is open. Tab is never typed — a tab character in a path is never what
   * was meant.
   *
   * On an empty field it also reads drops (see `readDrop`), and ↵ on a home
   * holding the stage takes it on: one file to its next step, several PDFs in
   * pdf mode to the hub, anything else nowhere until batch exists. (esc
   * clearing the stage is the idle esc handler's, below.)
   *
   * A paste onto the empty field is taken, not shown: drawn and then cleared
   * for the card, a dropped path blinked in the field while its file was
   * read. It is put back if it names nothing. A piece that follows it within
   * `DROP_PIECE_MS` is joined to it and the whole read again
   * (docs/superpowers/specs/2026-10-13-forge-paste-drops-design.md).
   */
  const homeKey = (input: string, key: Key, value: string): boolean => {
    if (pasteboard && ((key === PASTE && input === '') || (key.ctrl && input === 'v'))) {
      pasteClipboard()
      return true
    }
    const piece = dropPiece.current
    // `value` can still be '' for a piece read back into the field but not
    // drawn yet.
    const joining =
      piece !== undefined &&
      Date.now() - piece.at < DROP_PIECE_MS &&
      (value === piece.shown || value === '') &&
      isText(input, key)
    if (!joining && commandKey(input, key)) return true
    if (value === '' || joining) {
      const whole = joining ? piece.text + input : input
      const [pasted = '', ...rest] = whole.split(/[\r\n]/)
      if (
        [...whole].length > 1 &&
        !key.ctrl &&
        !key.meta &&
        !isStrayEscapeSequence(whole) &&
        pasted.trim() !== '' &&
        !isCommandBuffer(pasted)
      ) {
        // Words are typing: nothing to read off the disk first. With a line
        // break the field would submit them, so they are put in it instead.
        if (!startsLikePath(pasted)) {
          if (rest.length === 0) return false
          setText(pasted)
          return true
        }
        // A drag never ends a path in a slash; "~/Desktop/" pasted to be
        // finished by hand is typing, and stays in the field — though a next
        // piece can still make it a drop.
        if (/\/\s*$/.test(pasted) && rest.length === 0) {
          dropPiece.current = { text: whole, shown: whole, at: Date.now() }
          if (value !== '' || !joining) return false
          // The pieces before this one were taken: the read of them is
          // dropped, and the whole goes in the field.
          requestId.current++
          dropReading.current = 0
          setText(whole)
          return true
        }
        // A line break ends a paste: nothing after it is joined to it.
        dropPiece.current =
          rest.length === 0 ? { text: whole, shown: '', at: Date.now() } : undefined
        if (value !== '') setText('')
        readDrop(pasted)
        return true
      }
    }
    if (value === '') {
      // ↵ waits for a drop still being read: acting on the stage as it stood
      // would let the read land mid-wizard and add files the run never sees.
      if (key.return && dropReading.current !== 0) return true
      const staged = stageRef.current
      if (key.return && staged.sources.length > 0) {
        const [only] = staged.sources
        if (staged.folder && mode === 'convert') setStep('watch')
        else if (only && staged.sources.length === 1) proceedWith(only)
        else if (stagedVerb(staged, mode) === 'pdf' && pdfCommand) runCommand(pdfCommand)
        return true
      }
      const next = modeForKey(input)
      if (!key.ctrl && !key.meta && next) {
        switchMode(next)
        return true
      }
      // An empty field has no cursor to move, so ←→ are free for the modes.
      if (!key.ctrl && !key.meta && !key.super && (key.leftArrow || key.rightArrow)) {
        stepTab(mode, key.rightArrow ? 1 : -1)
        return true
      }
      return key.tab
    }
    if (key.tab) {
      const pick = completions[chosen]
      if (pick) setText(pick.insert)
      return true
    }
    if (completions.length === 0) return false
    if (key.downArrow) {
      setChosen((i) => Math.min(completions.length - 1, i + 1))
      return true
    }
    if (key.upArrow) {
      setChosen((i) => Math.max(0, i - 1))
      return true
    }
    return false
  }

  const push = useCallback((block: HistoryBlock) => {
    setHistory((h) => [...h, block])
  }, [])

  /** Files the run Done showed into the scrollback, once. See `doneBar`. */
  const recordDone = useCallback(() => {
    const blocks = doneRecord.current
    doneRecord.current = null
    for (const block of blocks ?? []) push(block)
    setDoneBar(null)
  }, [push])
  // Whatever way Done is left, the run it showed is not lost from the scrollback.
  useEffect(() => {
    if (!atDone && doneRecord.current) recordDone()
  }, [atDone, recordDone])

  /**
   * What the shell just said — a failed run (E5), a refusal, a note — held
   * live rather than printed to `<Static>` at once: every screen fills the
   * window, so a block printed above it is already off the top of the screen
   * (a failed run looked like it just went home). Home draws them under its
   * field, every other screen above its keys (`Notices`). They go to the
   * scrollback, in order, once something new starts (`fenceOff`, a change to
   * what is staged or typed), or after `NOTICE_SHOWN_MS`. The ref is what
   * `commitNotices` reads, so two in one handler are both kept. A held `bar`
   * is not drawn live; it keeps its place ahead of the notes it heads.
   */
  const [notices, setNotices] = useState<HistoryBlock[]>([])
  const noticesRef = useRef<HistoryBlock[]>([])
  const commitNotices = useCallback(() => {
    const held = noticesRef.current
    if (held.length === 0) return
    noticesRef.current = []
    setNotices([])
    for (const block of held) push(block)
  }, [push])
  const hold = useCallback(
    (block: HistoryBlock) => {
      const next = [...noticesRef.current, block]
      // Past the last few, the oldest go on to the scrollback.
      while (next.filter(isNotice).length > MAX_NOTICES) {
        const oldest = next.shift()
        if (oldest) push(oldest)
      }
      noticesRef.current = next
      setNotices(next)
    },
    [push],
  )
  const holdFailure = useCallback(
    (e: unknown) =>
      hold({ kind: 'error', id: nextId(), error: isForgeError(e) ? e : unexpectedError(e) }),
    [hold],
  )
  /**
   * What was staged and typed when the newest notice was first drawn: a
   * change from that is something new. Taken after the render that shows it,
   * so the change that came with it (a failed run clearing the stage) is not.
   */
  const shownWith = useRef<{ id: string; stage: Stage; text: string } | null>(null)
  useEffect(() => {
    const newest = notices.at(-1)
    if (!newest) {
      shownWith.current = null
      return
    }
    const seen = shownWith.current
    if (seen?.id !== newest.id) shownWith.current = { id: newest.id, stage, text }
    else if (seen.stage !== stage || seen.text !== text) commitNotices()
  }, [notices, stage, text, commitNotices])
  // Keyed on the list: a new notice gets the whole time, and those with it.
  useEffect(() => {
    if (notices.length === 0) return
    const id = setTimeout(commitNotices, NOTICE_SHOWN_MS)
    return () => clearTimeout(id)
  }, [notices, commitNotices])
  const liveNotices = useMemo(() => notices.filter(isNotice), [notices])

  /**
   * Rules a dashed line under whatever is already on screen, so a change of
   * flow reads as a new operation rather than a continuation of the last one.
   *
   * A compress refusal used to sit directly above `/pdf`'s operation list,
   * close enough to read as part of that menu — the user took a message about
   * compression as an explanation of the PDF screen they were now looking at.
   * The same rule already separates finished results (see the `lastResult`
   * handler); entering a different flow earns it for the same reason.
   *
   * Functional update rather than reading `history`: this runs from input
   * callbacks whose closures would otherwise capture a stale array. No rule
   * on an empty session, and never two in a row.
   */
  const fenceOff = useCallback(() => {
    // A refusal is live (see `fileRefusal`): a new flow takes it away rather
    // than leaving it above a screen it is not part of.
    setFileRefusal(undefined)
    // Above the rule, as it would have been had it gone to the scrollback at once.
    commitNotices()
    setHistory((h) => {
      if (h.length === 0) return h
      if (h[h.length - 1]?.kind === 'separator') return h
      return [...h, { kind: 'separator' as const, id: nextId(), width }]
    })
  }, [width, commitNotices])

  /**
   * A config that could not be read is told to the user once, as history,
   * and never again. The ref — not state — is what makes "once" true: this
   * effect reruns on every render that changes its deps, and a state flag
   * would not be visible to the run that scheduled it.
   */
  /**
   * Pushed once, before anything else can reach history, so the banner is the
   * first thing `<Static>` flushes and stays at the top of the session.
   */
  const warned = useRef(false)
  useEffect(() => {
    if (warned.current || configWarning === undefined) return
    warned.current = true
    hold({ kind: 'note', id: nextId(), text: `${SYMBOLS.warn} ${configWarning}` })
  }, [configWarning, hold])

  /**
   * The one way anything in this file reports a failure. Whatever was thrown
   * — a `ForgeError`, or something nothing anticipated — becomes a history
   * block the user can actually read, never a raw stack trace (spec §11).
   */
  const showError = holdFailure

  /**
   * Refuses to convert or compress a staged batch rather than silently
   * acting on the first file in it. Refusing beats converting-the-first-
   * loudly: a partial action on an ambiguous request is worse than no
   * action, because the user can clear the stage and drop one file in a
   * second, but they cannot un-convert a file they never meant to touch —
   * the same "a change nobody asked for is a surprise" reasoning the phase-2
   * compress design doc uses for why compress never changes the format.
   *
   * A `note` block, not a new one: this is a plain history line, the same
   * shape `/help` and the config-warning banner already use, with the warn
   * symbol paired with words so the reason survives a monochrome terminal.
   */
  const refuseBatch = useCallback(() => {
    hold({
      kind: 'note',
      id: nextId(),
      text: `${SYMBOLS.warn} Converting several files at once isn't supported yet. Drop a single file, or esc to clear the list.`,
    })
  }, [hold])

  /**
   * Whether `convertAction` actually has somewhere to send this source.
   * `convertAction.appliesTo` only checks `sources.length >= 1` — that was
   * never enough on its own to guarantee a real choice: before a
   * rasterisation engine arrived, a PDF's only writable format was PDF
   * itself, which
   * `targetSelect` (in `core/actions/convert.ts`) deliberately filters out
   * as a no-op conversion, leaving its target list genuinely empty. A PDF
   * now has real targets (jpeg, png — see `engines/pdfium.ts`), so this
   * returns `true` for one; the check stays because nothing guarantees
   * every future source kind will have somewhere to go.
   *
   * Without this check, a source with no real target would open the
   * `target` step with a `Select` that has nothing to move a cursor onto —
   * and critically, `Select` no-ops on *every* key, including escape, when
   * its item list is empty (see `Select.tsx`). That was a dead end a
   * person could not back out of short of quitting the process; it is why
   * this exists at all, even though no source reaches that empty case
   * today.
   */
  const hasConvertTarget = useCallback(
    (candidate: SourceInfo): boolean =>
      convertAction
        .options([candidate], {}, livePrefs)
        .some((s) => s.kind === 'select' && s.id === 'target' && s.choices.length > 0),
    [livePrefs],
  )

  /**
   * Whether *any* of the five page operations `PdfFlow`'s hub lists applies
   * to what is staged — the same question `/convert` asks via
   * `hasConvertTarget` and `/compress` asks via `compressAction.appliesTo`,
   * asked here so `/pdf` agrees with its two siblings in this file about
   * checking applicability before opening anything.
   *
   * Without this, staging a non-PDF (or a mix that satisfies none of the
   * five actions — see each action's own `appliesTo`) and running `/pdf`
   * mounted the hub anyway: every row came back `disabled`, `Select`'s
   * `firstEnabled` fell back to index 0 regardless, and `selected` was
   * false for every row — no visible cursor, arrows doing nothing, Enter
   * submitting nothing. Not the same unrecoverable lock the empty-list case
   * was (`items.length` is 5, so Escape still works), but a confusing,
   * silent screen all the same.
   */
  const pdfActionsApply = useCallback(
    (sources: SourceInfo[]): boolean => HUB_ACTIONS.some((a) => a.appliesTo(sources)),
    [],
  )

  // Gated on `step === 'result'`: Ink delivers input to every mounted
  // `useInput` hook regardless of what else is on screen, so an ungated
  // handler here would steal `f`/`o`/`q` from the target/quality/destination
  // stages the moment they happen to share a letter.
  // esc on the size field goes back to the mode choice, once `Prompt` has
  // nothing left in the field to clear — the same "clear first, then back"
  // split Save as's name makes.
  useKeys(
    (_input, key) => {
      if (!key.escape || text !== '') return
      setSizeError(undefined)
      setUnitFocused(false)
      setStep('mode')
    },
    { isActive: step === 'size' },
  )

  /**
   * Tab moves between the amount and the unit row; left/right walk the units
   * once it has focus, and enter confirms the field from either half.
   *
   * Left/right and enter are claimed only while the row is focused, so the
   * caret keys and submit `Prompt` needs keep working in the amount — Ink
   * hands every keystroke to both hooks, so anything this one swallows
   * unconditionally would be taken away from the field beside it, and enter
   * in particular would submit twice.
   *
   * Enter is here because the unit row is one half of a single answer rather
   * than a step of its own: the amount and its unit are the same question,
   * and having to tab back onto the amount to say yes to them made the row a
   * dead end — the hint bar names `↵ confirm` first, and it was the one key
   * there that did nothing.
   */
  useKeys(
    (_input, key) => {
      if (key.tab) {
        setUnitFocused((focused) => !focused)
        return
      }
      if (!unitFocused) return
      if (key.return) {
        submitSize(text)
        return
      }
      const delta = key.rightArrow ? 1 : key.leftArrow ? -1 : 0
      if (delta === 0) return
      setSizeUnit((current) => {
        const next = unitsHere.indexOf(current) + delta
        return unitsHere[Math.min(unitsHere.length - 1, Math.max(0, next))] ?? current
      })
    },
    { isActive: step === 'size' },
  )

  /**
   * esc while a target-size search is running: stop it and step back one, the
   * way esc does everywhere else. Nothing has been written at this point — a
   * search only measures — so there is nothing to undo, and the staged file
   * stays staged.
   *
   * Only meaningful while a search is actually in flight (`searchAbort` set);
   * an ordinary conversion has no interruptible phase, so esc there is left
   * alone rather than given a cancel that would silently do nothing.
   */
  useKeys(
    (_input, key) => {
      if (!key.escape || !searchAbort.current) return
      searchAbort.current.abort()
      if (mediaRun.current && mode !== 'edit') {
        // A video or sound encode: ffmpeg is killed and its temp file removed.
        // Back to the step that started it, the file still staged.
        searchAbort.current = undefined
        setTimeProgress(null)
        setStep(mode === 'compress' ? 'mode' : 'target')
        return
      }
      if (mode === 'edit') {
        // An extension job: the child is killed and nothing is written. Back
        // to the picker, the file still there.
        searchAbort.current = undefined
        setValues({})
        setStep('edit')
        return
      }
      /**
       * Moved here rather than waiting for `runPlan` to return, because an
       * abort can only take effect *between* encodes — the one already in
       * flight still has to finish, and a 300-dpi scan's encode is seconds
       * long. Waiting for it would leave esc looking as dead as the screen
       * this fixes. Nothing is written during a search, so leaving early
       * costs nothing; the search unwinds behind the screen the user is
       * already back on.
       *
       * Safe against the race where the search settles in the same moment:
       * `finishConversion` returns early only when the outcome really came
       * back cancelled, and otherwise carries on to the result (or the
       * unreachable question) exactly as it would have, moving the step off
       * this one again. The user is never told nothing happened when a file
       * was in fact written.
       */
      searchAbort.current = undefined
      setAttempt(undefined)
      setStep('size')
    },
    { isActive: step === 'converting' },
  )

  // esc at the prompt clears whatever is typed first (mirroring every other
  // text field), and only once that field is empty does it fall through to
  // clearing the stage home is holding, and its failures with it. A drop
  // still being read is superseded too, or it would land on the cleared home.
  //
  // This is also how esc leaves the command list: the list is only open
  // while the field holds a command, so clearing the field closes it — and,
  // the field not being empty, never touches the stage on the same press.
  useKeys(
    (_input, key) => {
      if (!key.escape) return
      setHomeError(undefined)
      if (text !== '') {
        setText('')
        return
      }
      if (stage.sources.length === 0 && stage.failures.length === 0) return
      ++requestId.current
      setStage(clearStage())
      setFresh({ count: 0, at: 0 })
    },
    { isActive: step === 'idle' },
  )

  /**
   * Ctrl+N: abandon whatever is in progress and start over, from any step.
   * A harder reset than any single step's own "back" — it drops the staged
   * source(s), every answer collected so far, and any pending confirmation,
   * landing back on the idle prompt exactly as if the app had just started.
   *
   * Excluded while a job is actually running: there is nothing sound to do
   * with a `runJobs` promise already in flight once the state it was
   * closed over has been reset out from under it.
   */
  const startNewSession = () => {
    installAbort.current?.abort()
    installAbort.current = undefined
    setStage(clearStage())
    setValues({})
    setLastResult(null)
    setPending(null)
    setSaving(null)
    setPdfBlocked(null)
    setPdfReopen(undefined)
    setSizeUnreachable(null)
    setSuggestion(undefined)
    setSizeError(undefined)
    setHomeError(undefined)
    setText('')
    setMode('convert')
    setColourChoice(0)
    setStep('idle')
  }

  /** Into the colour flow, opening as `start` says. */
  const openColour = useCallback((start: ColourStart) => {
    setColourStart(start)
    setColourTrailNow({
      answers: [],
      current:
        start === 'palette' || (typeof start === 'object' && 'palette' in start)
          ? 'Extract'
          : start === 'system'
            ? 'Palette'
            : 'Scale',
    })
    setText('')
    setStep('colour')
  }, [])

  /**
   * Colour's home, with nothing typed (colour spec §6.2): a s d open a card,
   * left to right, and ↵ the last one opened; ←→ step to the next tab, as on every home; `#` opens the scale with it typed; a drop opens the palette
   * of what was dropped; `/` puts the slash in the field, which opens the
   * commands as on every home; the mode digits switch mode. The field is hidden here, so
   * these are read directly rather than through its `intercept`.
   */
  useKeys(
    (input, key) => {
      if (key.ctrl || key.meta || isStrayEscapeSequence(input)) return
      // ←→ are the tab row's, as on every other home; a s d (either case),
      // the keys under the left hand in the cards' order, open a card at
      // once, and ↵ the one last opened (decided 2026-10-14).
      const card = COLOUR_CARD_KEYS.indexOf(input.toLowerCase())
      const open = (at: 0 | 1 | 2) => {
        setColourChoice(at)
        openColour(at === 0 ? 'palette' : at === 1 ? 'scale' : 'system')
      }
      if (key.leftArrow || key.rightArrow) stepTab('colour', key.rightArrow ? 1 : -1)
      else if (input.length === 1 && card >= 0) open(card as 0 | 1 | 2)
      else if (key.return) {
        open(colourChoice)
      } else if (input === '#') openColour({ typed: '#' })
      else if (input === '/') setText('/')
      else if (input.length > 1) {
        // A pasted colour (a hex copied from Figma, an rgb() or oklch() from a
        // browser) is a scale, and two are a mix, typed into Scale's box; anything
        // else pasted or dropped is an image's path. A path never reads as a
        // colour: it starts with / ~ or ., or ends with an extension.
        const pasted = input.trim()
        const pathLike = /^[/~.]/.test(pasted) || /\.[a-z0-9]{2,5}$/i.test(pasted)
        const rgb = pathLike ? undefined : parseColour(pasted)?.rgb
        if (rgb) openColour({ scale: rgb })
        else if (!pathLike && typedPair(pasted)?.b) openColour({ typed: pasted })
        else openColour({ palette: pasted })
      } else {
        const next = modeForKey(input)
        if (next && next !== mode) switchMode(next)
      }
    },
    // Its field is not mounted, so pastes are taken here: a drop arrives whole.
    { isActive: onHome && mode === 'colour' && text === '', pastes: true },
  )

  useKeys(
    (input, key) => {
      if (key.ctrl && input === 'n') startNewSession()
    },
    { isActive: step !== 'theme' && step !== 'converting' && step !== 'pdf-running' },
  )

  /**
   * `.catch`, not `void`: `reveal.ts` promisifies `execFile`, so `open`
   * exiting non-zero — which is exactly what it does when the file has
   * since been moved, renamed, or its volume unmounted — rejects. A
   * `void`ed rejection is an unhandled rejection, and Node terminates
   * the process and prints the stack. Result blocks live in `<Static>`
   * scrollback for the rest of the session, so `o` and `s` (and the
   * result links, which call the same two functions) stay pressable
   * long after the file they point at has gone.
   *
   * Shared by the `o`/`s` keys and by clicking the result links. One
   * function per action, not two copies that can drift — the `.catch`
   * above is easy to omit from a second copy.
   */
  /** The file Done is about: the copy saved to the default folder after E3, else the result. */
  const lastFile = (): string | undefined =>
    clipDone?.status === 'changed' ? clipDone.saved : lastResult?.job.outputs[0]
  const openLastResult = () => {
    const file = lastFile()
    if (file !== undefined) openPath(file).catch(showError)
  }
  const revealLastResult = () => {
    const file = lastFile()
    if (file !== undefined) revealPath(file).catch(showError)
  }

  /** u on a copied image's Done: the original back on the clipboard. */
  const undoCopied = () => {
    if (!pasteboard) return
    undoClip(pasteboard, clipRoot)
      .then((ok) => {
        if (ok)
          hold({
            kind: 'note',
            id: nextId(),
            text: `${SYMBOLS.ok} the original is back on the clipboard`,
          })
      })
      .catch(showError)
  }
  /** s on a copied image's Done: the result kept as a file too, in the default folder. */
  const saveCopied = (output: string) => {
    saveCopy(output, expandTilde(livePrefs.defaultOutput))
      .then((saved) =>
        hold({
          kind: 'note',
          id: nextId(),
          text: `${SYMBOLS.ok} saved to ${printable(displayPath(saved))}`,
        }),
      )
      .catch(showError)
  }

  /** The Done key last pressed, for its cap to answer (M6b); `n` makes each press new. */
  const [donePressed, setDonePressed] = useState<{ key: string; n: number } | undefined>()
  const pressDone = (k: string) => setDonePressed((p) => ({ key: k, n: (p?.n ?? 0) + 1 }))

  useKeys(
    (input, key) => {
      if (!lastResult) return
      if (presets.key(input, key)) return
      if (key.return) {
        presets.reset()
        recordDone()
        // A dashed rule and a blank line either side, so a long session reads
        // as a sequence of separate operations rather than one wall of text.
        push({ kind: 'separator', id: nextId(), width })
        setStage(clearStage())
        setValues({})
        setLastResult(null)
        setClip(null)
        setClipDone(null)
        setStep('idle')
        return
      }
      if (clipDone?.status === 'placed') {
        if (input === 'u') {
          pressDone('u')
          undoCopied()
          return
        }
        if (input === 's') {
          pressDone('s')
          saveCopied(clipDone.output)
          return
        }
      }
      // O as well: edit's note under its pictures says "Press O".
      if (input === 'o' || input === 'O') {
        pressDone('o')
        openLastResult()
      }
      if (input === 's') {
        pressDone('s')
        revealLastResult()
      }
      // After an edit of a video or sound file: on to compress, the result
      // the file now (video spec §2 — two jobs are two runs).
      if (input === 'c' && !suggestion && compressNext && lastResult?.job.outputs[0]) {
        pressDone('c')
        recordDone()
        probe(lastResult.job.outputs[0]).then((info) => {
          setMode('compress')
          setValues({})
          setLastResult(null)
          setStage(addToStage(emptyStage(), [info], []))
          setStep('mode')
        }, showError)
        return
      }
      // Acts on the measured suggestion: re-enters convert with that target
      // already chosen, so the offer is one keystroke from being taken.
      if (input === 'c' && suggestion && lastResult) {
        recordDone()
        setSuggestion(undefined)
        setMode('convert')
        const next = { target: suggestion.target }
        setValues(next)
        setStage(addToStage(emptyStage(), [lastResult.job.sources[0]], []))
        openSaveAs({ values: next, source: lastResult.job.sources[0], action: convertAction })
      }
    },
    { isActive: step === 'result' },
  )

  // The picker never hardcodes a format list: it renders whatever
  // convertAction.options() returns for the probed source and the answers
  // collected so far (e.g. the quality step only appears once a lossy
  // target is chosen).
  const specs: OptionSpec[] = useMemo(
    () => (source ? action.options([source], values, livePrefs) : []),
    [source, values, livePrefs, action],
  )

  const specFor = useCallback((id: string) => specs.find((s) => s.id === id), [specs])

  /**
   * The format picker's highlighted row and its measured size (spec
   * 2026-10-11 picker §2). Only a lone image is measured: a document's
   * targets go through another engine, and a batch has no one size to quote.
   * The encode is the conversion's own plan at the quality the slider will
   * open on, so the number is the one the default answers would produce.
   *
   * Not in the compact band, where the row has no room to say it, and not
   * above MEASURE_MAX_PIXELS: an encode cannot be stopped part-way, and on a
   * large photo one AVIF measurement is seconds of CPU that could still be
   * running when the real conversion starts.
   */
  const [targetHighlight, setTargetHighlight] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (step !== 'target') setTargetHighlight(undefined)
  }, [step])
  const measureTarget = useMemo<MeasureFn | undefined>(() => {
    if (
      source?.kind !== 'image' ||
      stage.sources.length !== 1 ||
      mode !== 'convert' ||
      band === 'compact' ||
      source.width * source.height > MEASURE_MAX_PIXELS
    ) {
      return undefined
    }
    return async (target) => {
      // An animated GIF can become a video too: that is ffmpeg's, never measured here.
      if (target !== 'gif' && FORMATS[target as FormatId]?.media !== undefined) {
        throw new Error('a video target is not measured')
      }
      const [planned] = convertAction.plan([source], {
        target,
        quality: livePrefs.quality,
        destination: expandTilde(livePrefs.defaultOutput),
      })
      if (planned?.op !== 'convert') throw new Error('nothing to measure')
      return (await encodeToBuffer(source, planned.target, planned.options)).length
    }
  }, [source, stage.sources.length, mode, band, livePrefs.quality, livePrefs.defaultOutput])
  const firstTarget = (() => {
    const spec = specFor('target')
    return spec?.kind === 'select' ? spec.choices.find((c) => !c.disabled)?.value : undefined
  })()
  const targetSize = useMeasuredSize({
    highlighted: step === 'target' ? (targetHighlight ?? firstTarget) : undefined,
    measure: measureTarget,
    // A size belongs to this file, as it is now, at this quality.
    resetKey: source ? `${source.path}|${source.bytes}|${livePrefs.quality}` : undefined,
  })

  /**
   * The quality step's measured size (G1): what the file would really come
   * to at the value the slider rests on. The format list's rule, extended
   * with the quality — encode only once the value has rested, one encode at a
   * time, every answer kept per value. A size belongs to this file, in this
   * mode, at this target, so changing any of those starts the cache again.
   *
   * The same limits as the format list's, for the same reasons: one image,
   * room to say it, and not so large that a measurement is still running
   * when the real conversion starts.
   */
  const qualitySpecNow = specFor('quality')
  const qualityNow =
    typeof values.quality === 'number'
      ? values.quality
      : qualitySpecNow?.kind === 'slider'
        ? qualitySpecNow.default
        : livePrefs.quality
  const measureQuality = useMemo<MeasureFn | undefined>(() => {
    if (
      source?.kind !== 'image' ||
      stage.sources.length !== 1 ||
      band === 'compact' ||
      source.width * source.height > MEASURE_MAX_PIXELS
    ) {
      return undefined
    }
    return async (key) => {
      const [quality, dither] = key.split('|')
      const [planned] = action.plan([source], {
        ...values,
        quality: Number(quality),
        dither: dither === 'dither',
        destination: expandTilde(livePrefs.defaultOutput),
      })
      if (planned?.op !== 'convert') throw new Error('nothing to measure')
      return (await encodeToBuffer(source, planned.target, planned.options)).length
    }
  }, [source, stage.sources.length, band, action, values, livePrefs.defaultOutput])
  const ditherOn = values.dither === true
  const qualityKey = (quality: number, dither: boolean) =>
    `${quality}|${dither ? 'dither' : 'flat'}`
  const qualityReset = source
    ? `${source.path}|${source.bytes}|${mode}|${String(values.target)}|${String(values.pages)}|${String(values.dpi)}`
    : undefined
  const qualitySize = useMeasuredSize({
    highlighted: step === 'quality' ? qualityKey(qualityNow, ditherOn) : undefined,
    measure: measureQuality,
    resetKey: qualityReset,
  })

  /**
   * Dithering (N4), on a PNG's or GIF's points only: the same point encoded
   * the other way, alongside, so the note can say whether d would change
   * anything. Forge does not judge the look; it only knows whether the file
   * would differ.
   */
  const pointsSpec = specFor('quality')
  const points = pointsSpec?.kind === 'slider' && pointsSpec.points === true
  const otherSize = useMeasuredSize({
    highlighted: step === 'quality' && points ? qualityKey(qualityNow, !ditherOn) : undefined,
    measure: measureQuality,
    resetKey: qualityReset,
  })
  const offerDither = (() => {
    if (!points || pointsSpec?.kind !== 'slider') return false
    // Switched on, it stays said, so it can be switched off again.
    if (ditherOn) return true
    const top = qualityNow >= pointsSpec.max
    // Not measured (a large image, a narrow window): below the top point
    // it is worth offering; at the top it most often changes nothing.
    if (measureQuality === undefined) return !top
    if (qualitySize.status !== 'done' || otherSize.status !== 'done') return false
    const [a, b] = [qualitySize.bytes, otherSize.bytes]
    // Identical: d would change nothing at all (a logo of a few colours).
    if (a === b) return false
    // At the top point only where it really changes the file (a gradient).
    return !top || Math.abs(a - b) / Math.min(a, b) >= 0.01
  })()

  /**
   * `probe()` is genuinely I/O-bound (`stat`, `access`, then sharp reading
   * the file's header), and nothing moves `step` off `'idle'` until it
   * resolves — the Prompt stays mounted and interactive for the whole
   * `await` by design (disabling it mid-probe, e.g. via `isActive`, is a UX
   * decision this file doesn't get to make on its own). So a user can submit
   * a second, different path before the first probe settles, and the two
   * probes genuinely race.
   *
   * `requestId` is a ref, not state, for the same reason `Select.tsx` and
   * `Prompt.tsx` use one: `useInput` handlers are synchronous but `setState`
   * is not, so a second submission arriving before React re-renders must
   * still see the true current id, not a stale closed-over value. Each call
   * claims the next id the instant it starts, so the *latest* submission
   * always wins ownership — and a probe's result, success or failure, is
   * only applied if its id is still the current one by the time it settles.
   * A superseded (stale) result — an earlier submission that is still
   * finishing after a newer one has already started — is dropped on the
   * floor rather than clobbering whatever the newer submission produced.
   */
  const requestId = useRef(0)

  /**
   * Runs a command chosen from the palette or typed in full.
   *
   * `needsSource` decides what a command does with a file already on the
   * bench: `/compress` switches it into the compress flow, `/theme` ignores
   * it entirely.
   */
  const runCommand = useCallback(
    (command: Command) => {
      setText('')
      setHomeError(undefined)

      if (command.name === 'theme') {
        setStep('theme')
        return
      }

      if (command.name === 'extensions') {
        setStep('extensions')
        return
      }

      if (command.name === 'update') {
        setStep('update')
        return
      }

      if (command.name === 'about') {
        setStep('about')
        return
      }

      /**
       * Edit acts on one image, as convert does. With nothing staged it
       * arms the mode for the next drop, as `/compress` and `/pdf` do.
       */
      if (command.name === 'edit') {
        if (stagedBatch) {
          refuseBatch()
          return
        }
        if (source && source.kind !== 'image') {
          hold({ kind: 'note', id: nextId(), text: editRefusal(source) })
          return
        }
        setMode('edit')
        setValues({})
        setStep(source ? 'edit' : 'idle')
        return
      }

      if (command.name === 'help') {
        hold({
          kind: 'note',
          id: nextId(),
          text: COMMANDS.map((c) => `  /${c.name.padEnd(10)} ${c.description}`).join('\n'),
        })
        return
      }

      // Colour starts from its own home (Palette or Scale), never from a
      // staged file: what you drop or type belongs to the screen you open
      // (colour spec §6.2). A staged file is let go, as ctrl-n would.
      if (command.mode === 'colour') {
        fenceOff()
        setStage(clearStage())
        setMode('colour')
        setValues({})
        setStep('idle')
        return
      }

      if (command.name === 'convert') {
        if (stage.folder) {
          setMode('convert')
          setValues({})
          setStep('watch')
          return
        }
        if (stagedBatch) {
          refuseBatch()
          return
        }
        setMode('convert')
        setValues({})
        // A source with nowhere to convert to would stay at idle rather
        // than opening a target picker with nothing in it — see
        // `hasConvertTarget`. No source reaches that today; a staged PDF
        // now opens the real picker like anything else, with a way back to
        // `/pdf` from there — see the `target` step's own signpost.
        setStep(source && hasConvertTarget(source) ? 'target' : 'idle')
        return
      }

      if (command.name === 'compress') {
        if (stagedBatch) {
          refuseBatch()
          return
        }
        if (source && !compressAction.appliesTo([source])) {
          refuseFile(unsupportedCompress(source), source.path)
          return
        }
        fenceOff()
        setMode('compress')
        setValues({})
        setStep(source ? 'mode' : 'idle')
        return
      }

      /**
       * Deliberately does not consult `stagedBatch`/`refuseBatch` — those
       * exist to stop convert/compress from silently acting on only the
       * first of several staged files (see the note above `convert()`),
       * and `/pdf`'s whole point is the opposite: merge is defined by
       * having several files staged, and the hub itself dims whatever the
       * current stage can't do, with a reason, rather than the shell
       * refusing to even open it.
       *
       * With no source at all, this arms `mode` and stays at idle — the same
       * shape `/compress` already has a few lines up, for the same reason:
       * `/pdf` has nothing to open yet (the hub has no files to show
       * operations for), but the choice of what happens to the *next*
       * dropped file is real and worth remembering, same as compress's own
       * pre-armed mode. `proceedWith` is where that arming actually takes
       * effect once something lands and ↵ takes it on.
       */
      if (command.name === 'pdf') {
        if (!source) {
          setMode('pdf')
          setStep('idle')
          return
        }
        // With a source, "dims what doesn't apply" only works once the hub
        // is open — it is not a substitute for checking whether *anything*
        // applies before opening it at all. `/convert` has `hasConvertTarget`
        // and `/compress` has `compressAction.appliesTo` for exactly this, a
        // few lines up; `pdfActionsApply` is `/pdf`'s version of the same
        // check, so all three commands in this file agree on the rule.
        if (!pdfActionsApply(stage.sources)) {
          hold({
            kind: 'note',
            id: nextId(),
            text: `${SYMBOLS.warn} /pdf needs the staged files to be PDFs.`,
          })
          return
        }
        setMode('pdf')
        fenceOff()
        setStep('pdf')
      }
    },
    [
      refuseFile,
      fenceOff,
      source,
      stage.sources,
      stage.folder,
      stagedBatch,
      refuseBatch,
      hasConvertTarget,
      pdfActionsApply,
      hold,
    ],
  )

  /**
   * What ↵ does with one staged file, and what a typed path does with nothing
   * staged once it is read: the mode decides where the file goes next.
   *
   * Deliberately nothing pushed to history. A block committed to <Static> can
   * never be taken back, and until a conversion actually happens the file is a
   * choice the user is still making — esc has to be able to undo it. The
   * result block records the file once there is something worth recording.
   */
  const proceedWith = useCallback(
    (info: SourceInfo) => {
      setValues({})
      // `/compress` before dropping a file means the file lands in the
      // compress flow, and compressing something lossless is refused here
      // rather than after the user has answered three more questions about it.
      // A video or sound file ffmpeg has not read: nothing but convert's
      // picker can be shown for it, and that says how to get ffmpeg.
      if (info.kind === 'media' && !info.facts) {
        setStep('ffmpeg')
        return
      }
      if (mode === 'compress') {
        if (!compressAction.appliesTo([info])) {
          refuseFile(unsupportedCompress(info), info.path)
          setMode('convert')
          // `compressAction.appliesTo` only accepts a lossy image, so nothing
          // reaches this branch without a real convert target either — but
          // check anyway rather than trade one dead end for another.
          setStep(hasConvertTarget(info) ? 'target' : 'idle')
          return
        }
        setStep('mode')
        return
      }
      // `/pdf` armed with nothing staged yet (see `runCommand`): a source the
      // hub has nothing to do with falls back to convert, one it can act on
      // opens the hub directly.
      if (mode === 'pdf') {
        if (!pdfActionsApply([info])) {
          refuseFile(unsupportedPdf(info), info.path)
          setMode('convert')
          setStep(hasConvertTarget(info) ? 'target' : 'idle')
          return
        }
        fenceOff()
        setStep('pdf')
        return
      }
      // Edit takes images; anything else falls back to convert, as a
      // file compress cannot take does.
      if (mode === 'edit') {
        if (info.kind !== 'image' && info.kind !== 'media') {
          hold({ kind: 'note', id: nextId(), text: editRefusal(info) })
          setMode('convert')
          setStep(hasConvertTarget(info) ? 'target' : 'idle')
          return
        }
        setStep('edit')
        return
      }
      // A source with a real convert target — every image, and a PDF too —
      // goes to the target picker; one without stays on home, staged, rather
      // than opening a picker with nothing in it (see `hasConvertTarget`).
      setStep(hasConvertTarget(info) ? 'target' : 'idle')
    },
    [mode, refuseFile, hasConvertTarget, pdfActionsApply, fenceOff, hold],
  )

  /**
   * Adds what a drop read to the stage and stays on home. Appended, exact
   * repeats dropped (`addToStage`); files that exist but could not be read
   * ride along as the stage's failures, for the left-out line. Nothing is
   * refused here any more: a stage of several images is shown as it is, and
   * `refuseBatch` speaks up only if `/convert` or `/compress` is run on it.
   */
  const landDrop = useCallback((drop: DropResolution) => {
    const known = new Set(stageRef.current.sources.map((s) => s.path))
    const added = new Set(drop.sources.map((s) => s.path).filter((p) => !known.has(p))).size
    setText('')
    setValues({})
    const { folder } = drop
    // A folder onto an empty home stays a folder; onto anything staged it adds its files.
    setStage((s) =>
      folder && s.sources.length === 0
        ? folderStage(folder)
        : addToStage(s, drop.sources, drop.failures),
    )
    setFresh({ count: added, at: Date.now() })
  }, [])

  /**
   * Reads a paste into the empty home field the moment it lands — a drop
   * (docs/superpowers/specs/2026-10-11-forge-drop-zone-design.md). A terminal
   * cannot see a drag; the first thing it learns is the paths, as one chunk
   * of text, so this is the moment the zone can answer.
   *
   * If nothing in it is on disk it was never a drop — plain text, or half a
   * path to finish by hand — and it is put in the field as typed, unless the
   * field was typed into meanwhile.
   * A later ↵, paste or esc claims `requestId` and this result is dropped.
   */
  /**
   * ⌘V with a picture copied: the terminal has no text to paste, so it sends
   * an empty paste, or nothing at all — ctrl-v is here for that. Either way
   * the picture is read off the clipboard and lands as a dropped file does,
   * named "Copied image", replacing one pasted before it. Nothing copied
   * means nothing happens: the hint was not showing either.
   */
  const pasteClipboard = () => {
    if (!pasteboard) return
    const id = ++requestId.current
    dropReading.current = id
    const settled = () => {
      if (dropReading.current === id) dropReading.current = 0
      return requestId.current === id && stepRef.current === 'idle'
    }
    void (async () => {
      try {
        const taken = await takeImage(pasteboard, clipRoot)
        const info = taken ? await probe(taken.source) : undefined
        if (!settled() || !taken || !info) return
        const before = clipRef.current
        if (before) {
          setStage((s) => ({ ...s, sources: s.sources.filter((x) => x.path !== before.source) }))
        }
        setClip(taken)
        landDrop({ sources: [info], failures: [], anyExists: true })
      } catch (e) {
        settled()
        showError(e)
      }
    })()
  }

  const readDrop = (pasted: string) => {
    const id = ++requestId.current
    dropReading.current = id
    const settled = () => {
      if (dropReading.current === id) dropReading.current = 0
      // Superseded, or home was left meanwhile (a command run from the list):
      // a stage changing under a wizard would wipe its answers.
      return requestId.current === id && stepRef.current === 'idle'
    }
    const leaveAsText = () => {
      if (textRef.current !== '') return
      setText(pasted)
      const piece = dropPiece.current
      if (piece) dropPiece.current = { ...piece, shown: pasted }
    }
    resolveDrop(pasted).then(
      (drop) => {
        if (!settled()) return
        if (!drop.anyExists) {
          leaveAsText()
          return
        }
        dropPiece.current = undefined
        // Only empty folders: nothing was left out, there was nothing to
        // read. Said the way a typed folder says it, hint and all.
        if (
          drop.sources.length === 0 &&
          drop.failures.every((f) => f.error.code === 'empty-directory')
        ) {
          setText('')
          setHomeError(undefined)
          for (const failure of drop.failures) showError(failure.error)
          return
        }
        // One dropped file that could not be read, onto an empty home: said
        // under the field, as a typed path is, and nothing is staged.
        const [only] = drop.failures
        if (drop.single && only && stageRef.current.sources.length === 0) {
          refuseOnHome(only.error)
          return
        }
        setHomeError(undefined)
        landDrop(drop)
      },
      () => {
        if (settled()) leaveAsText()
      },
    )
  }

  const submitPath = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim()
      if (!trimmed) return

      /**
       * A command, not a path. Checked before probing, because otherwise
       * `/compress` is looked up as a file and reported missing — which is
       * exactly what happened before this branch existed.
       */
      if (isCommandBuffer(trimmed)) {
        const command = parseCommand(trimmed)
        setText('')
        if (command) {
          runCommand(command)
        } else {
          hold({
            kind: 'note',
            id: nextId(),
            text: `no command matches ${trimmed} — try /help`,
          })
        }
        return
      }
      // Colour's home: a path typed after `/` is an image for its palette.
      if (mode === 'colour') {
        setText('')
        openColour({ palette: trimmed })
        return
      }
      const id = ++requestId.current
      setText('')
      setHomeError(undefined)
      // The path stays in the field if it is refused, to be corrected — unless
      // something was typed in the meantime, which then stays instead.
      const kept = () => (textRef.current === '' ? trimmed : textRef.current)

      let drop: DropResolution
      try {
        drop = await resolveDrop(trimmed)
      } catch (e) {
        if (requestId.current !== id) return // superseded by a later submission
        // A rethrow here would become an unhandled rejection: submitPath is
        // fired from Prompt's synchronous useInput handler, and nothing awaits
        // or catches the promise it returns. The shell must render it — as
        // the refusal of the path just typed, under the field.
        refuseOnHome(isForgeError(e) ? e : unexpectedError(e), kept())
        setStep('idle')
        return
      }
      if (requestId.current !== id) return // superseded by a later submission

      // With something already staged, a typed path adds to it, as a drop does.
      const nothingStaged = stageRef.current.sources.length === 0
      const [first] = drop.sources
      if (nothingStaged && !first) {
        // One path that could not be read is answered under the field; a
        // folder with nothing readable in it keeps a panel for each failure.
        const [only] = drop.failures
        if (drop.single && only) refuseOnHome(only.error, kept())
        else for (const failure of drop.failures) showError(failure.error)
        return
      }
      landDrop(drop)
      // One file typed onto an empty home goes on at once, as it always has.
      // A folder in convert mode waits on home as its card, for ↵.
      const folderHere = drop.folder !== undefined && mode === 'convert'
      if (nothingStaged && first && drop.sources.length === 1 && !folderHere) proceedWith(first)
    },
    [showError, runCommand, landDrop, proceedWith, refuseOnHome, mode, openColour, hold],
  )

  // Takes `currentSource` as a parameter, rather than closing over `source`
  // (which is `SourceInfo | null`) and asserting it non-null: the caller
  // below only reaches this from a branch already narrowed on `source`
  // being set, so the non-null-ness is a real invariant, not a suppression.
  /**
   * Takes the whole staged batch back off the bench and returns to the
   * prompt. Right for a source whose only path forward *was* the target
   * picker — an image has nothing else to do with a staged file, so
   * backing out means abandoning it. See `backToPromptKeepingStage` for the
   * other case.
   *
   * Also how a run that failed, was refused, or was abandoned at the
   * "can't get that small" question ends. Phase 3's rule is that completing
   * an action clears the stage, and a failure completes it as surely as a
   * result does: leaving the file staged meant the natural recovery — drop it
   * again, or drop another — appended to it instead, building a batch the
   * convert flow then refused (UX audit #7).
   */
  const clearSource = () => {
    setStage(clearStage())
    setValues({})
    setStep('idle')
  }

  /** A run failed: the action ends, as `clearSource`, and home shows why (`notices`). */
  const failRun = (e: unknown) => {
    clearSource()
    holdFailure(e)
  }

  /**
   * Backs out of the target picker without discarding what is staged.
   *
   * A staged PDF has somewhere else to go besides conversion: `/pdf`'s five
   * page operations, and — by dropping a second PDF once back at the
   * prompt — a merge stage. `clearSource` would cost the user both just for
   * escaping the question "convert it to what", so a document keeps its
   * place on the bench; only the in-progress target choice is dropped.
   * Wired up only where the staged source is a document (see the `target`
   * step below) — an image still uses `clearSource`, unchanged.
   */
  const backToPromptKeepingStage = () => {
    setValues({})
    setStep('idle')
  }

  const chooseTarget = (currentSource: SourceInfo, target: string) => {
    if (currentSource.kind === 'media' && !currentSource.facts) {
      refuseFile(ffmpegMissing(currentSource.path), currentSource.path)
      return
    }
    setValues((v) => ({ ...v, target }))
    const next = action.options([currentSource], { target }, livePrefs)
    if (currentSource.kind === 'media' && target === 'gif') {
      setStep('length')
      return
    }
    if (next.some((s) => s.id === 'bitrate')) {
      setStep('bitrate')
      return
    }
    // `action.options()` only includes a pages spec when the chosen target
    // actually rasterises the source (jpeg/png via pdfium) — a pdf/docx/doc
    // target skips straight to quality or destination, having no pages or
    // resolution concept at all.
    if (next.some((s) => s.id === 'pages')) {
      setStep('pages')
      return
    }
    if (next.some((s) => s.id === 'quality')) setStep('quality')
    else openSaveAs({ values: { ...values, target } })
  }

  /**
   * `'all'`/`'first'` advance straight to resolution; `'choose'` hands off to
   * `PageGrid` (`page-picker`) rather than storing itself as the answer —
   * `convertAction.plan()` only knows how to turn `'all'`, `'first'`, a typed
   * range, or an explicit array into pages, not the literal string `'choose'`.
   */
  const choosePages = (value: string) => {
    setValues((v) => ({ ...v, pages: value }))
    setStep(value === 'choose' ? 'page-picker' : 'dpi')
  }

  /** `PageGrid`'s own selection, already 0-based — `convertAction.plan()` still runs it through `normalisePages`. */
  const submitPagePicker = (pages: number[]) => {
    setValues((v) => ({ ...v, pages }))
    setStep('dpi')
  }

  const chooseDpi = (currentSource: SourceInfo, dpi: string) => {
    setValues((v) => ({ ...v, dpi }))
    const next = action.options(
      [currentSource],
      { ...values, target: values.target, dpi },
      livePrefs,
    )
    if (next.some((s) => s.id === 'quality')) setStep('quality')
    else openSaveAs({ values: { ...values, dpi } })
  }

  /**
   * `.catch`, not `void`: this runs from Select's synchronous useInput
   * handler and nothing awaits the promise, so a rejected write would be an
   * unhandled rejection and Node would take the process down. A theme that
   * fails to persist is worth telling the user about; it must never cost
   * them the session.
   */
  /**
   * Back from a setting (/theme, /extensions, /update, /about) to where settings live: the
   * command list, the setting just left still highlighted.
   */
  const backToCommands = (name: string) => {
    setStep('idle')
    setText('/')
    setCommandChoice({
      text: '/',
      at: Math.max(
        0,
        listCommands('').items.findIndex((c) => c.name === name),
      ),
    })
  }

  const chooseTheme = (next: 'dark' | 'light') => {
    setTheme(next)
    setStep('idle')
    savePreferences({ theme: next }).catch(showError)
  }

  /**
   * Writes the folder to config and says so, without advancing the flow —
   * the user is still choosing where *this* conversion goes. `.catch` for
   * the same reason as chooseTheme: nothing awaits this promise.
   */
  /** Where a file was just saved: Save as lists it next time, tagged. Best effort, never in the way. */
  const rememberSaved = (folder: string) => {
    setLivePrefs((p) => ({ ...p, lastOutput: folder }))
    savePreferences({ lastOutput: folder }).catch(() => {})
  }

  const makeDefault = (path: string) => {
    setLivePrefs((p) => ({ ...p, defaultOutput: path }))
    hold({
      kind: 'note',
      id: nextId(),
      text: `${SYMBOLS.ok} default output is now ${printable(path)}`,
    })
    savePreferences({ defaultOutput: path }).catch(showError)
  }

  /**
   * What `plan()` would write in `folder`: the name it proposes, split where
   * the user edits it, or — for a document rasterised a page at a time, which
   * names one output per page — what the many files will be called.
   *
   * The proposal comes from `plan()` rather than being rebuilt here: the
   * action knows the extension (compress keeps the source's, convert uses the
   * target's) and any suffix it needs to avoid landing on the input. Deriving
   * it a second time in the shell is how the field once offered a name with
   * no extension at all for compression. The extension is never editable: a
   * `.png` typed onto a WebP would make a file that lies about itself.
   */
  const proposalFor = (
    src: SourceInfo,
    vals: Record<string, unknown>,
    folder: string,
    act: Action = currentAction,
  ): Pick<SaveAsState, 'stem' | 'ext' | 'fixedName'> & { realStem: string } => {
    const planned = isExtensionAction(act)
      ? act.plan([src], { ...vals, output: folder })[0]
      : act.plan([src], { ...vals, destination: folder })[0]
    const outputs = planned?.outputs ?? []
    const first = displayName(outputs[0] ?? src.path)
    if (rasterises(src, planned)) {
      return {
        stem: '',
        ext: '',
        realStem: '',
        fixedName: outputs.length > 1 ? `${first} … ${outputs.length} files` : first,
      }
    }
    // `first` is for showing (a control or bidi character shows as `?`); the
    // file is saved under the real name, `realStem`, unless one is typed.
    const real = lastSegment(outputs[0] ?? src.path) ?? first
    const dot = first.lastIndexOf('.')
    const ext = dot > 0 ? first.slice(dot) : ''
    return {
      stem: dot > 0 ? first.slice(0, dot) : first,
      ext,
      realStem: real.slice(0, real.length - ext.length),
    }
  }

  /**
   * Opens Save as: on the name, pre-filled with the proposal, or on the
   * folder. `values`, `source` and `action` are passed by a caller that has
   * just set them, since this runs before React has.
   *
   * The folder it opens on is the one last chosen, else the action's own
   * default (the configured output folder, which its places list first).
   */
  const openSaveAs = ({
    values: vals = values,
    source: src = source,
    action: act = currentAction,
    name,
  }: {
    values?: Record<string, unknown>
    source?: SourceInfo | null
    action?: Action
    /** The name to open with, when coming back to one already given. */
    name?: string
  } = {}) => {
    if (!src) return
    // A copied image has no file to name or place: it goes back where it
    // came from. Run once the answers just given are in (`clipRun`).
    if (clipRef.current && src.path === clipRef.current.source) {
      setClipRun((n) => n + 1)
      return
    }
    // An extension action has no destination option of its own; its folders
    // are the ones a conversion of the same image would offer.
    const spec = (isExtensionAction(act) ? convertAction : act)
      .options([src], vals, livePrefs)
      .find((s) => s.id === 'destination')
    const folder =
      typeof vals.destination === 'string'
        ? vals.destination
        : spec?.kind === 'path'
          ? spec.default
          : expandTilde(livePrefs.defaultOutput)
    const proposal = proposalFor(src, vals, folder, act)
    setSaving((s) => ({
      folder,
      ...proposal,
      edited: name !== undefined && name !== proposal.stem,
      opened: (s?.opened ?? 0) + 1,
    }))
    setSavedAs(undefined)
    setText(name ?? proposal.stem)
    setStep('save-as')
  }

  /** Back to Save as from a question after it, with the name as it was given. */
  const reopenSaveAs = () => openSaveAs(saving?.given !== undefined ? { name: saving.given } : {})

  /**
   * A different folder highlighted in Save as. The sentence follows it, and
   * so does the proposed name — `plan()` may name a file differently in
   * another folder — unless the user has typed a name of their own.
   */
  const chooseFolder = (folder: string) => {
    if (!source || !saving) return
    const proposal = proposalFor(source, values, folder)
    setSaving({ ...saving, folder, ...proposal })
    setValues((v) => ({ ...v, destination: folder }))
    if (!saving.edited && !proposal.fixedName) setText(proposal.stem)
  }

  const editName = (next: string) => {
    setText(next)
    setSaving((s) => (s && !s.edited ? { ...s, edited: true } : s))
  }

  /**
   * A document rasterisation plans one output per page — there is no single
   * stem for a name to edit, and `resolveOutputPath`'s single-output
   * shape is exactly what `rasterOutputPaths` (inside `convertAction.plan()`)
   * exists to bypass. So this skips the name entirely and
   * routes through the same `checkWriteSafety` + `runJobs` pipeline `/pdf`'s
   * five page operations already use — `handlePdfDone` is generic over any
   * `Job[]`, not `/pdf`-specific, and a multi-output convert job fits it
   * exactly (self-collision, existing-file and input-collision checks all
   * apply the same way here as they do to a separated extract).
   */
  const confirmDocumentConversion = (destination: string) => {
    if (!source) return
    void handlePdfDone(action.plan([source], { ...values, destination }), {
      cancelTo: 'save-as',
    })
  }

  /**
   * Routes on how the outputs get their names, not on source kind.
   *
   * A rasterisation names one output per page (`doc-1.jpg`) — at one page as
   * much as at twenty — so there is no single stem for a name to edit, and
   * it takes the multi-output path. A compression keeps the source's own
   * format and plans one ordinarily-named output, so it takes the ordinary
   * path, where `finishConversion` runs the target-size search.
   *
   * Read from the engine's declared `writes` rather than a hardcoded list of
   * raster formats (invariant 2), the same way the CLI's `rasterises` does.
   *
   * Branching on `kind` alone sent every document down the rasterisation
   * route, a compression included — which is how the shell came to offer "to
   * a target size" for a scan, collect the number, and ignore it.
   */
  const rasterises = (src: SourceInfo, planned: Job | undefined): boolean =>
    src.kind === 'document' && planned?.op === 'convert' && pdfiumEngine.writes.has(planned.target)

  /**
   * Save as's answer: the folder, and the name as typed. The one place a
   * chosen destination goes — every way of saving comes through here.
   *
   * The name is trimmed, a `/` in it becomes `-` (it would name a folder;
   * on Windows so do `\ : * ? " < > |`, see `safeStem`), and an empty one
   * means the proposal.
   */
  const confirmDestination = (destination: string, typed = '') => {
    if (!source) return
    // Not read by the action, which is always handed the destination
    // directly; kept for the header bar's trail.
    setValues((v) => ({ ...v, destination }))
    rememberSaved(destination)

    const proposal = proposalFor(source, values, destination)
    if (proposal.fixedName) {
      confirmDocumentConversion(destination)
      return
    }
    const kept = typed.trim() === '' || typed.trim() === proposal.stem
    const stem = (kept ? '' : safeStem(typed, process.platform, proposal.ext)) || proposal.realStem
    setSaving((s) => (s ? { ...s, given: typed } : s))
    setText('')
    setSavedAs(`${stem}${proposal.ext}`)
    const output = `${destination}/${stem}${proposal.ext}`
    if (enhancing) {
      void runExtensionJob(destination, { output })
      return
    }
    void convert(destination, { output })
  }

  /** Back from Save as: to whichever step actually precedes it for this source. */
  const destinationBack = () => {
    setText('')
    if (mode === 'edit') {
      setStep(
        values.tool === 'resize'
          ? 'resize'
          : values.tool === 'crop'
            ? 'crop'
            : values.tool === 'cut'
              ? 'length'
              : 'edit',
      )
      return
    }
    if (source?.kind === 'media' && values.target === 'gif') {
      setStep('length')
      return
    }
    if (specFor('bitrate')) {
      setStep('bitrate')
      return
    }
    if (specFor('quality')) {
      setStep('quality')
      return
    }
    setStep(specFor('dpi') ? 'dpi' : 'target')
  }

  /**
   * Validates in the field rather than at conversion time — the difference
   * between catching a typo and failing a run that already chose a folder.
   */
  /**
   * What the field actually means: the typed text if it already names a unit,
   * otherwise that text plus whichever unit the row is on. Written as one
   * function because three places need the same answer — the live echo, the
   * submit, and the error message about what could not be read.
   */
  const sizeWithUnit = (raw: string): string =>
    /[a-z]/i.test(raw) ? raw.trim() : `${raw.trim()}${sizeUnit}`

  const submitSize = (typed: string) => {
    const raw = sizeWithUnit(typed)
    const bytes = parseSize(raw)
    if (bytes === undefined) {
      setSizeError(`${raw.trim() || 'that'} is not a size. Try 500kb or 2mb.`)
      return
    }
    // Under what this video can get: said under the field already, nothing to confirm.
    if (floorHere !== undefined && bytes < floorHere) return
    setSizeError(undefined)
    setValues((v) => ({ ...v, size: raw, targetBytes: bytes }))
    setText('')
    // Both halves of the field are left as they were found. Clearing the
    // amount without releasing the unit row would hand the next visit an
    // inert amount field — the caret would be in it, and typing would go to
    // the units instead.
    setUnitFocused(false)
    openSaveAs({ values: { ...values, size: raw, targetBytes: bytes } })
  }

  const chooseQuality = (quality: number) => {
    setValues((v) => ({ ...v, quality }))
    openSaveAs({ values: { ...values, quality } })
  }

  /**
   * Two Enters delivered in the same tick — a held key repeating, or a paste
   * carrying two line endings — both reach `convert` from the destination
   * step's synchronous `useInput` handler. Moving `step` to `'converting'`
   * does not stop the second: React unmounts that handler on the next
   * render, and both calls have already run by then. Measured before this
   * ref existed: two `runJobs` calls, two encodes, two renames onto the same
   * path, two result blocks. So this is claimed synchronously, before the
   * first `await`, for the same reason `requestId` above is.
   */
  const converting = useRef(false)

  /**
   * Spec §8's write-safety rules live in `core/write-safety.ts` and reach this
   * path through `runPlan`: never write over the input, never replace an
   * existing output without consent. The shell needs them for exactly the
   * reason the CLI does — `targetIdsFor` legitimately offers jpeg for a JPEG,
   * and "Same folder" is legitimately the first destination preset, so the
   * all-defaults keypath resolves the output straight onto the user's
   * original unless something refuses.
   *
   * `action.plan()` derives the job; `runPlan` decides whether it may happen,
   * resolves any target size, and runs it. `buildPlan` used to sit in between
   * re-deriving a job that already existed, which is why the output path had
   * two authorities and the rename field once offered a name with no
   * extension.
   *
   * Still one source, not `stage.sources`: `output` here is one exact
   * filename, since the rename step builds `${destination}/${stem}${ext}` for
   * a single representative source. Handing the whole stage the same output
   * would make every source past the first collide on that path — correctly
   * refused, but the branch below treats any refusal as the whole run being
   * refused, so a two-file stage would convert nothing instead of batching.
   * Making that work needs the wizard to know it is planning for a batch
   * (skip or reinterpret the rename step, run what did resolve, show more
   * than one result) — UX decisions this change does not make.
   */
  /**
   * The part of a conversion that runs once quality is settled — a plan
   * already carrying the quality it will encode at, never one still waiting
   * on a target-size search. Split out of `convert()` so the "use the lowest
   * quality anyway" answer to `sizeUnreachable` can finish the same
   * conversion the search already ran most of, instead of re-planning or
   * re-searching from scratch.
   */
  /**
   * What a running job reported, for the Working screen: a count of pages
   * done where it has one, otherwise the phase it is in. Only what the engine
   * said — never a position it did not report (invariant 7).
   */
  const showPhase = (job: Job, progress: Progress) => {
    if (progress.phase === 'page') {
      setPageProgress({ done: progress.done, total: progress.total, job })
      return
    }
    if (progress.phase === 'time') {
      setTimeProgress((t) => ({
        done: progress.done,
        total: progress.total,
        pass: progress.pass,
        // A new pass starts its own clock: its speed is its own.
        since: t && t.pass?.at === progress.pass?.at ? t.since : Date.now(),
      }))
      return
    }
    const phase = phaseLabel(job, progress.phase)
    setWork((w) => (w ? { ...w, phase } : w))
  }

  const finishConversion = async (
    planned: Extract<Job, { op: 'convert' }>,
    destination: string,
    output: string,
    opts: ConversionOpts,
  ) => {
    if (!source) return

    // The rename step can redirect where this lands, so the job carries the
    // final path rather than a second module re-deriving it.
    planned.outputs[0] = output

    /**
     * One call for write safety, the target-size search and the run.
     *
     * This used to be `buildPlan` (which re-planned a job `action.plan()` had
     * already produced) followed by `runJobs`, with the search living in
     * `convert()` — where a document source never reached it. Routing both
     * kinds through here is what makes a PDF target size take effect.
     */
    const controller = new AbortController()
    searchAbort.current = controller
    setTimeProgress(null)
    // A video or sound encode can be stopped all the way through (ffmpeg is
    // killed, nothing is written), so esc stays live past the size search.
    const media = planned.sources[0].kind === 'media'
    mediaRun.current = media

    const outcome = await runPlan([planned], {
      force: opts.force ?? false,
      signal: controller.signal,
      ...(opts.targetBytes === undefined ? {} : { targetBytes: opts.targetBytes }),
      onEvent: (event) => {
        if (event.type === 'search:attempt') {
          setAttempt({ n: event.attempt, of: event.of, dpi: event.rung.dpi })
        }
        // Settled: what runs now is the encode itself, which esc cannot stop.
        if (event.type === 'search:settled') {
          setAttempt(undefined)
          if (!media) searchAbort.current = undefined
        }
        if (event.type === 'job:phase') showPhase(event.job, event.progress)
      },
    })
    setAttempt(undefined)
    setTimeProgress(null)
    mediaRun.current = false
    searchAbort.current = undefined

    /**
     * Cancelled by esc, which has already put the screen back on the size
     * field (see the `converting` key handler). Nothing further to do:
     * a cancelled run has no result, no refusal and no unreachable target to
     * report, and reporting one anyway would be inventing an answer the user
     * stopped waiting for.
     */
    if (outcome.cancelled) return

    /**
     * Nothing gets small enough — but the search measured the smallest it
     * *can* get, so this asks rather than refuses: take that size, or go pick
     * a format with more room to shrink.
     */
    const missed = outcome.unreachable[0]
    if (missed && opts.targetBytes !== undefined) {
      setSizeUnreachable({
        planned,
        destination,
        output,
        opts,
        targetBytes: opts.targetBytes,
        smallest: missed.smallest,
        quality: missed.settings.quality,
        ...(missed.settings.dpi === undefined ? {} : { dpi: missed.settings.dpi }),
        ...(missed.settings.media === undefined ? {} : { media: missed.settings.media }),
      })
      setStep('size-unreachable')
      return
    }

    const refusal = outcome.refusals[0]
    if (refusal) {
      // An output that already exists is a question, not a refusal: spec §8
      // says the shell asks — keep both, replace, or cancel.
      if (refusal.error.code === 'output-exists') {
        setPending({
          destination,
          output,
          keepBoth: uniqueOutputPath(output),
          existing: takenFile(output),
        })
        setStep('overwrite')
        return
      }
      // Writing over the source has no "replace" worth offering — there is
      // no outcome there that keeps the original. Back to the destination
      // step, where choosing a different folder is the actual fix. Any
      // other refusal ends the action, and ending one clears the stage —
      // see `failRun`.
      if (refusal.error.code === 'output-is-input') {
        hold({ kind: 'error', id: nextId(), error: refusal.error })
        reopenSaveAs()
      } else failRun(refusal.error)
      return
    }

    const summary = outcome
    const result = summary.results[0]
    if (result) {
      const copied = clipRef.current !== null && clipRef.current.source === source.path
      const done = copied ? await settleClip(result) : null
      setLastResult(result)
      const trail = copied
        ? doneTrail({ place: 'Clipboard' })
        : doneTrail({ destination, name: displayName(result.job.outputs[0] ?? output) })
      setDoneBar({ mode, trail })
      doneRecord.current = [
        { kind: 'bar', id: nextId(), mode, trail },
        { kind: 'result', id: nextId(), result, mode, place: clipPlace(done) },
      ]
      setStep('result')

      /**
       * Only after a compression, and only once the file is safely written:
       * this is an extra encode purely to find out whether a sentence is
       * worth saying, and it must not be able to cost the user the
       * conversion they actually asked for.
       */
      if (mode === 'compress') {
        const found = await suggestFormat({
          source,
          resultBytes: result.outputBytes,
          quality: planned.options.quality ?? livePrefs.quality,
          encode: async (target, quality) =>
            (await encodeToBuffer(source, target, { ...planned.options, quality })).length,
        })
        setSuggestion(found)
        setMergeOffer(undefined)
      } else {
        setSuggestion(undefined)
        // Compress never reaches here with `target === 'pdf'` — it keeps
        // the source's own format (see `compressAction.appliesTo`) — so
        // this only ever counts conversions the user actually chose 'PDF'
        // for.
        if (planned.target === 'pdf') {
          pdfOutputsThisSession.current += 1
          setMergeOffer(
            pdfOutputsThisSession.current > 1 ? pdfOutputsThisSession.current : undefined,
          )
        } else {
          setMergeOffer(undefined)
        }
      }
    } else {
      const failure = summary.failures[0]
      if (failure) failRun(failure.error)
      else clearSource()
    }
  }

  /**
   * Edit's run: the same plan-and-run path as the CLI (`action.plan` then
   * `runPlan`), with esc wired to the AbortSignal so the extension's child is
   * killed and nothing is written. Done is X5 (`EditDone`).
   */
  const runExtensionJob = async (
    destination: string,
    opts: { force?: boolean; output?: string } = {},
  ) => {
    if (!source || !enhancing || converting.current) return
    converting.current = true
    const row = enhancing
    const act = actionForRow(row)
    setWork({ startedAt: Date.now(), verb: row.verb })
    setStep('converting')
    const controller = new AbortController()
    searchAbort.current = controller
    setTimeProgress(null)
    try {
      const [job] = act.plan([source], { ...values, output: opts.output ?? destination })
      if (!job) return
      const outcome = await runPlan([job], {
        force: opts.force ?? false,
        concurrency: 1,
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'job:phase') showPhase(event.job, event.progress)
        },
      })
      if (outcome.cancelled) return
      const refusal = outcome.refusals[0]
      if (refusal) {
        if (refusal.error.code === 'output-exists') {
          const output = job.outputs[0] ?? destination
          setPending({ destination, output, keepBoth: uniqueOutputPath(output) })
          setStep('overwrite')
          return
        }
        hold({ kind: 'error', id: nextId(), error: refusal.error })
        reopenSaveAs()
        return
      }
      const result = outcome.results[0]
      if (result) {
        const copied = clipRef.current !== null && clipRef.current.source === source.path
        if (copied) await settleClip(result)
        const name = displayName(result.job.outputs[0] ?? '')
        const trail = copied
          ? doneTrail({ place: 'Clipboard' })
          : doneTrail({
              destination: dirname(result.job.outputs[0] ?? destination),
              name,
            })
        setLastResult(result)
        setDoneBar({ mode, trail })
        doneRecord.current = [
          { kind: 'bar', id: nextId(), mode, trail },
          {
            kind: 'note',
            id: nextId(),
            text: `${SYMBOLS.ok} ${describePdfResult(result)}`,
            savedTo: result.job.outputs[0],
          },
          ...result.warnings.map(
            (warning): HistoryBlock => ({
              kind: 'note',
              id: nextId(),
              text: `${SYMBOLS.warn} ${warning.message}`,
            }),
          ),
        ]
        setSuggestion(undefined)
        setMergeOffer(undefined)
        setStep('result')
        return
      }
      if (outcome.failures[0]) failRun(outcome.failures[0].error)
      else clearSource()
    } catch (e) {
      failRun(e)
    } finally {
      setTimeProgress(null)
      if (searchAbort.current === controller) searchAbort.current = undefined
      converting.current = false
      setWork(null)
    }
  }

  /**
   * The tools' states, read each time the picker opens: offline and instant
   * (the catalogue is compiled in, installed state is on disk).
   */
  useEffect(() => {
    if (step !== 'edit') return
    let live = true
    tools.list().then(
      (all) => {
        if (!live) return
        // Always what is on disk: an install is never carried across a
        // reopen (leaving the picker stops it, below).
        const next: Partial<Record<ExtensionId, ToolState>> = {}
        for (const s of all) next[s.entry.id] = toolState(s)
        setToolStates(next)
      },
      (e) => {
        if (!live) return
        // An ordinary error block, and home: the picker has nothing to draw.
        showError(e)
        setStage(clearStage())
        setValues({})
        setStep('idle')
      },
    )
    return () => {
      live = false
      installAbort.current?.abort()
    }
  }, [step, tools, showError])

  /**
   * Trim's row says what a trim leaves: measured once per image, when the
   * list opens. The engine is loaded only then. A failure leaves the row
   * without its fact; the run itself says what went wrong.
   */
  const measureFor = source?.kind === 'image' && step === 'edit' ? source : undefined
  useEffect(() => {
    if (!measureFor || imageMeasure?.path === measureFor.path) return
    let live = true
    import('../engines/image.js')
      .then(({ measureImage }) => measureImage(measureFor))
      .then(
        (measure) => {
          if (live) setImageMeasure({ path: measureFor.path, measure })
        },
        () => {},
      )
    return () => {
      live = false
    }
  }, [measureFor, imageMeasure])
  const measure = source && imageMeasure?.path === source.path ? imageMeasure.measure : undefined

  /**
   * A row chosen whose tool is on this Mac: on to Save as, with the row's
   * answers (at its pill's step: Boost's scale, Crop's shape). Resize asks
   * its size first; Crop to shape shows where it cuts.
   */
  const chooseEdit = (row: EditRow, step?: number | string) => {
    if (!source) return
    const vals = rowValues(row, step)
    setValues(vals)
    if (row.id === 'cut') {
      setStep('length')
      return
    }
    if (row.id === 'crop' && source.kind === 'media') {
      if (!shapeOf(row, vals.shape)) return
      void frameFor(source).then(
        (frame) => {
          setCropFrame(frame)
          setCropAt(undefined)
          setStep('crop')
        },
        (e) => showError(e),
      )
      return
    }
    if (row.id === 'crop') {
      // No shape to cut (the row is dimmed then): never a preview with nothing to show.
      if (!shapeOf(row, vals.shape)) return
      setCropAt(undefined)
      setStep('crop')
      return
    }
    if (row.id === 'resize') {
      // An oversized source opens at its own limit, never past it (spec §2.3).
      // A video is never made bigger: its slider stops at 100 %.
      setResizePercent(source.kind === 'image' ? Math.min(100, largestPercent(source)) : 100)
      setStep('resize')
      return
    }
    openSaveAs({ values: vals, action: actionForRow(row) })
  }

  /**
   * The middle frame of a video, written as a PNG beside nothing (a temp
   * folder) and probed as a picture: Crop to shape's preview cuts it as it
   * cuts a photo, and the box is in the video's own upright pixels.
   */
  const frameFor = async (video: MediaInfo): Promise<ImageInfo> => {
    const [{ frameAt }, { mkdtemp }, { tmpdir }, { join }] = await Promise.all([
      import('../engines/ffmpeg.js'),
      import('node:fs/promises'),
      import('node:os'),
      import('node:path'),
    ])
    const out = join(await mkdtemp(join(tmpdir(), 'forge-frame-')), 'frame.png')
    await frameAt(video.path, (video.facts?.duration ?? 0) / 2, out)
    const info = await probe(out)
    if (info.kind !== 'image') throw new Error('the frame did not read as a picture')
    return info
  }

  /** A sound format's size, said beside it: arithmetic, so there at once. */
  const soundSize = (src: MediaInfo, target: FormatId): MeasuredSize => {
    const bytes = soundBytes(src, target)
    return bytes === undefined ? { status: 'idle' } : { status: 'done', bytes }
  }

  /** A video's frame, once Crop is done with it. Its temp folder goes with it (below). */
  const dropFrame = () => setCropFrame(undefined)

  // A frame's temp folder goes when the frame is replaced or let go, and with the shell.
  useEffect(() => {
    const frame = cropFrame
    if (!frame) return
    return () => {
      void import('node:fs/promises').then(({ rm }) =>
        rm(dirname(frame.path), { recursive: true, force: true }).catch(() => {}),
      )
    }
  }, [cropFrame])
  // …and when the video it came from leaves the bench.
  const benchPath = source?.path
  useEffect(() => {
    if (benchPath === undefined) setCropFrame(undefined)
  }, [benchPath])

  /** The crop where the preview left it: on to Save as, the box with its shape. */
  const chooseCrop = (box: CropBox) => {
    if (!cropShape) return
    const { w, h } = cropShape
    const vals = { ...values, tool: 'crop', crop: { aspect: { w, h }, box } }
    setValues(vals)
    openSaveAs({ values: vals, action: source?.kind === 'media' ? mediaEditAction : cropAction })
  }

  /** Resize's size, from the slider or the exact pair: on to Save as. */
  const chooseResize = (resize: ResizeSpec) => {
    const vals = { ...values, tool: 'resize', resize }
    setValues(vals)
    openSaveAs({ values: vals, action: source?.kind === 'media' ? mediaEditAction : resizeAction })
  }

  /**
   * ↵ on a row whose tool is not here yet: installs it in place, the row
   * showing the real bytes (`installExtension`'s `onProgress`), then goes on
   * to Save as by itself. esc stops it and keeps nothing.
   */
  /** The video extension's state, while a file waits for ffmpeg ('ffmpeg' step). */
  const [ffmpegState, setFfmpegState] = useState<ToolState | undefined>(undefined)
  useEffect(() => {
    if (step !== 'ffmpeg') return
    let live = true
    setFfmpegState(undefined)
    tools.list().then(
      (all) => {
        if (!live) return
        const status = all.find((s) => s.entry.id === 'video')
        setFfmpegState(
          status ? toolState(status) : { kind: 'unsupported', reason: 'no download here' },
        )
      },
      () => live && setFfmpegState({ kind: 'unsupported', reason: 'no download here' }),
    )
    return () => {
      live = false
    }
  }, [step, tools])

  /** ffmpeg is here now (installed, or found): read the file again and go on where it was going. */
  const lookAgain = () => {
    const waiting = source
    if (!waiting) return
    probe(waiting.path).then((info) => {
      if (info.kind === 'media' && !info.facts) {
        hold({
          kind: 'note',
          id: nextId(),
          text: `${SYMBOLS.warn} ffmpeg is still not on this computer`,
        })
        return
      }
      setStage(addToStage(emptyStage(), [info], []))
      proceedWith(info)
    }, showError)
  }

  const installFfmpeg = async () => {
    if (installAbort.current) return
    const controller = new AbortController()
    installAbort.current = controller
    const total = ffmpegState?.kind === 'absent' ? ffmpegState.downloadBytes : 0
    setFfmpegState({ kind: 'installing', done: 0, total })
    setChecking(false)
    let ok = false
    try {
      await tools.install('video', {
        signal: controller.signal,
        onProgress: (done, all) => {
          if (controller.signal.aborted) return
          setFfmpegState({ kind: 'installing', done, total: all })
          if (all > 0 && done >= all) setChecking(true)
        },
      })
      ok = true
    } catch (e) {
      if (!controller.signal.aborted) showError(e)
    }
    if (installAbort.current === controller) installAbort.current = undefined
    setChecking(false)
    if (ok && !controller.signal.aborted) lookAgain()
    else setFfmpegState(total > 0 ? { kind: 'absent', downloadBytes: total } : undefined)
  }

  const installThen = async (row: EditRow) => {
    if (installAbort.current) return
    const controller = new AbortController()
    installAbort.current = controller
    const id = row.extension
    if (!id) return
    const set = (state: ToolState) => setToolStates((t) => ({ ...t, [id]: state }))
    const absent = toolStates?.[id]
    set({
      kind: 'installing',
      done: 0,
      total: absent?.kind === 'absent' ? absent.downloadBytes : 0,
    })
    setChecking(false)
    let installed = false
    // The version now on disk, from what `install` returns (`Installed`), so
    // Boost's row offers the scales it makes without reading the catalogue.
    let version: string | undefined
    try {
      const got = await tools.install(id, {
        signal: controller.signal,
        onProgress: (done, total) => {
          if (controller.signal.aborted) return
          set({ kind: 'installing', done, total })
          if (total > 0 && done >= total) setChecking(true)
        },
      })
      if (typeof got === 'object' && got !== null && 'version' in got) {
        version = typeof got.version === 'string' ? got.version : undefined
      }
      installed = true
    } catch (e) {
      if (!controller.signal.aborted) showError(e)
    }
    if (installAbort.current === controller) installAbort.current = undefined
    setChecking(false)
    if (installed && !controller.signal.aborted) {
      set({ kind: 'ready', ...(version === undefined ? {} : { version }) })
      // A row with a scale to choose stays put: its pill shows now, and ↵
      // goes on. Any other row goes straight on to Save as.
      const now = source?.kind === 'image' ? editRow(source, row.id, boostScales(version)) : row
      const toChoose = (now?.scales?.length ?? 0) > 1
      if (stepRef.current === 'edit' && !toChoose) chooseEdit(row)
      return
    }
    // Stopped or failed: the row says what is really on disk now. A stop that
    // landed after the swap leaves the tool installed, and the row says so.
    const all = await tools.list().catch(() => [])
    set(toolState(all.find((s) => s.entry.id === id)))
  }

  const stopInstall = () => {
    installAbort.current?.abort()
  }

  /**
   * The copied image's run, in place of Save as: its result is written into
   * its own run folder as "Copied image" with the format's extension, then
   * put back (`settleClip`). After a render, so `values` holds the answer
   * that was just given. Replacing is safe there: the folder is Forge's own.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per bump, with the answers as they stand then
  useEffect(() => {
    const taken = clipRef.current
    if (clipRun === 0 || !taken || !source || source.path !== taken.source) return
    const { ext } = proposalFor(source, values, taken.outDir, currentAction)
    const output = join(taken.outDir, `Copied image${ext}`)
    setClipDone(null)
    setSavedAs(undefined)
    if (enhancing) void runExtensionJob(taken.outDir, { output, force: true })
    else void convert(taken.outDir, { output, force: true })
  }, [clipRun])

  /**
   * A copied image's result, put back on the clipboard. Not when something
   * else was copied while it ran: that copy is left alone and the result is
   * saved to the default folder instead (E3). Not when a compression came
   * out larger, either — that is never put back.
   */
  const settleClip = async (result: Result): Promise<ClipDone | null> => {
    const done = await clipOutcome(result)
    setClipDone(done)
    return done
  }
  const clipOutcome = async (result: Result): Promise<ClipDone | null> => {
    const taken = clipRef.current
    const output = result.job.outputs[0]
    const target = 'target' in result.job ? result.job.target : undefined
    if (!pasteboard || !taken || output === undefined || target === undefined) return null
    if (mode === 'compress' && result.outputBytes >= result.job.sources[0].bytes) {
      return { status: 'larger' }
    }
    try {
      if ((await putBack(pasteboard, taken, output, target)) === 'placed') {
        return { status: 'placed', output }
      }
      return {
        status: 'changed',
        saved: await saveCopy(output, expandTilde(livePrefs.defaultOutput)),
      }
    } catch (e) {
      showError(e)
      return null
    }
  }

  /** The scrollback's folder line and bar name for a copied image's result. */
  const clipPlace = (done: ClipDone | null) =>
    done?.status === 'placed'
      ? { folder: 'Clipboard', name: 'On the clipboard' }
      : done?.status === 'changed'
        ? { folder: displayPath(dirname(done.saved)), name: displayName(done.saved) }
        : undefined

  const convert = async (destination: string, opts: { force?: boolean; output?: string } = {}) => {
    if (!source) return
    if (converting.current) return
    converting.current = true
    setWork({ startedAt: Date.now(), verb: action.verb })
    setStep('converting')
    try {
      const planned = action.plan([source], { ...values, destination })[0]
      // `action` here is always convertAction or compressAction — both plan
      // only ever produce a `convert` job — but `plan()`'s return type is now
      // the full `Job` union (widened for the page actions), so the `target`/
      // `options` reads below need this narrowed explicitly rather than
      // assumed.
      if (planned?.op !== 'convert') {
        setStep('idle')
        return
      }
      const output = opts.output ?? planned.outputs[0]

      /**
       * A target size means the quality is the search's answer, not the
       * user's — but the search itself belongs to `runPlan`, which picks the
       * right ladder from the engine. The shell used to run a one-dimensional
       * image search here, which a document source never reached at all.
       */
      await finishConversion(planned, destination, output, {
        ...opts,
        ...(typeof values.targetBytes === 'number' ? { targetBytes: values.targetBytes } : {}),
      })
    } catch (e) {
      // convertAction.plan() throws synchronously on a bad target, and
      // nothing guarantees runPlan() can never reject for some
      // cause they don't themselves catch. Either way, this runs inside an
      // async handler nothing awaits — Save as fires onSubmit from a
      // synchronous useInput handler — so a rethrow here would become an
      // unhandled rejection instead of something the user ever sees. Render
      // it instead, exactly like submitPath does for probe().
      failRun(e)
    } finally {
      converting.current = false
      setWork(null)
    }
  }

  /** Answers `sizeUnreachable`: take the smallest size the search found, or back off to pick a format instead. */
  const answerSizeUnreachable = (choice: string) => {
    if (!sizeUnreachable) return
    const { planned, destination, output, opts, quality, dpi, media } = sizeUnreachable
    setSizeUnreachable(null)
    if (choice === 'lowest') {
      if (converting.current) return
      converting.current = true
      planned.options.quality = quality
      // A document's smallest came off a resolution rung as well as a quality,
      // so taking that size means taking both.
      if (dpi !== undefined) planned.options.dpi = dpi
      if (media !== undefined) planned.options.media = media
      setWork({ startedAt: Date.now(), verb: action.verb })
      setStep('converting')
      // Deliberately without `targetBytes`: the search already ran and this is
      // the answer to it. Passing it again would search a second time and miss
      // a second time.
      const { targetBytes: _alreadySearched, ...settled } = opts
      void finishConversion(planned, destination, output, settled)
        .catch(failRun)
        .finally(() => {
          converting.current = false
          setWork(null)
        })
      return
    }

    /**
     * The other three answers all reuse a step that already exists rather
     * than inventing a screen: the size field the number came from, the
     * quality slider the other compress mode uses, and `/convert`'s own
     * target picker. A search that missed is a fork in the road, not a
     * failure with one exit.
     */
    if (choice === 'size') {
      // `text` still holds what was typed, so this lands on their own number.
      setStep('size')
      return
    }
    if (choice === 'quality') {
      setValues((v) => ({ ...v, mode: 'quality', targetBytes: undefined }))
      setStep('quality')
      return
    }
    setMode('convert')
    setValues({})
    setStep(source && hasConvertTarget(source) ? 'target' : 'idle')
  }

  const answerOverwrite = (choice: string) => {
    if (!pending) return
    const { destination, output, keepBoth } = pending
    setPending(null)
    if (enhancing) {
      if (choice === 'replace') void runExtensionJob(destination, { output, force: true })
      else if (choice === 'keep') void runExtensionJob(destination, { output: keepBoth })
      else reopenSaveAs()
      return
    }
    if (choice === 'replace') void convert(destination, { force: true })
    else if (choice === 'keep') void convert(destination, { output: keepBoth })
    else reopenSaveAs()
  }

  /**
   * `PdfFlow` only ever decides *what* to run — `onDone` is where that
   * handoff happens, through the same `runJobs` the convert/compress wizard
   * uses. Page-op outputs are named by the action's own `plan()` (suffixed,
   * numbered, or merged beside the source) rather than a destination the
   * user picks, so there is no `buildPlan`/overwrite step here the way
   * `convert()` has one — see the note on `convert()` for why that function
   * still only ever plans for `[source]`, not `stage.sources`; `/pdf` is the
   * one place in this file that deliberately does act on the whole staged
   * list, because merge is defined by having several files staged.
   */
  /**
   * Actually runs jobs already cleared by `checkWriteSafety`.
   *
   * A rasterisation job's `total` is `job.options.pages.length` — the
   * *selected* page count, not the document's — because that is exactly
   * what `engines/pdfium.ts` reports (see its own doc comment); this only
   * relays it, never recomputes one of its own.
   */
  const runPdfJobs = async (jobs: Job[], opts: { force?: boolean } = {}) => {
    setWork({ startedAt: Date.now(), verb: verbOf(jobs[0]) ?? action.verb })
    setStep('pdf-running')
    setPageProgress(null)
    // Held for home once it is back (see `notices`).
    const failed: unknown[] = []
    try {
      /**
       * `force` is threaded rather than defaulted because these jobs have
       * already cleared `handlePdfDone`'s check — including, after "Replace",
       * a deliberate overwrite. Running them through `runPlan` at `force:
       * false` would refuse exactly the outputs the user just chose to
       * replace.
       *
       * No `targetBytes`: a page operation has no quality dial, so there is
       * nothing here for a search to settle.
       */
      const summary = await runPlan(jobs, {
        force: opts.force ?? false,
        onEvent: (event) => {
          if (event.type === 'job:phase') showPhase(event.job, event.progress)
        },
      })
      const [first] = summary.results
      if (first) {
        hold({
          kind: 'bar',
          id: nextId(),
          mode,
          trail: doneTrail({ destination: dirname(first.job.outputs[0] ?? '') }),
        })
      }
      for (const result of summary.results) {
        hold({
          kind: 'note',
          id: nextId(),
          text: `${SYMBOLS.ok} ${describePdfResult(result)}`,
          savedTo: result.job.outputs[0],
        })
        // Warnings used to stop here: only the note was pushed, and
        // `result.warnings` was never read. No page operation emits one today,
        // so this is a guard against the next one that does rather than a live
        // fix — but it costs a loop and the alternative was a silent drop.
        for (const warning of result.warnings) {
          hold({ kind: 'note', id: nextId(), text: `${SYMBOLS.warn} ${warning.message}` })
        }
      }
      for (const failure of [...summary.refusals, ...summary.failures]) failed.push(failure.error)
    } catch (e) {
      // Mirrors `convert()`'s own catch: this runs from a handler PdfFlow's
      // synchronous `useInput` fired, and nothing else awaits this promise.
      failed.push(e)
    } finally {
      setPageProgress(null)
      setWork(null)
      setStage(clearStage())
      setValues({})
      setStep('idle')
      for (const e of failed) holdFailure(e)
    }
  }

  /**
   * `PdfFlow`'s `plan()` output bypasses `buildPlan` (see the note above) and
   * so bypasses its write-safety checks too — merge, split, extract, delete
   * and rotate can each collide with an existing file, and merge and rotate
   * can even target a path that is one of their own inputs (rotate twice,
   * or merge a folder a second time after its own merged output already
   * landed there). `checkWriteSafety` is the same check the CLI's page-op
   * path applies before its own `runJobs` call — this is the shell applying
   * it too, in the one spot both paths share: right before the actual run.
   *
   * The shell has no `--force` flag, so a refusal has to be answered
   * in-flow rather than by re-typing the command with a flag. Only
   * `output-exists` gets an in-flow bypass ("Replace"): it is the ordinary,
   * expected case (rerunning an operation regenerates a file that is
   * already there) and `checkWriteSafety` supports overriding it safely.
   * `output-is-input` is deliberately given no bypass here even though
   * `checkWriteSafety` could technically allow one with `force: true` — an
   * operation reading and overwriting its own input in place, with no
   * `--output` to redirect to, is confusing enough that "go back and choose
   * something else" is the honest answer, not a one-keystroke override.
   * `output-collision` has no bypass at all, in the shell or the CLI: it is
   * the job's own plan asking to write two things to one path, which is not
   * a preference `force` can express (see `checkWriteSafety`'s doc).
   */
  const handlePdfDone = async (jobs: Job[], opts: { cancelTo?: 'pdf' | 'save-as' } = {}) => {
    const safe = checkWriteSafety(jobs, { force: false })
    if (safe.failures.length > 0) {
      setPdfBlocked({ jobs, failures: safe.failures, cancelTo: opts.cancelTo ?? 'pdf' })
      setStep('pdf-blocked')
      return
    }
    await runPdfJobs(safe.jobs)
  }

  /**
   * `keep` runs the jobs with every output that is taken given the name Keep
   * both gives it (`uniqueOutputPath`: ` (1)`, counting up) — every one, not
   * just the first, since a split can collide on several. `replace` retries
   * them with `force: true`; anything else cancels.
   */
  const answerPdfBlocked = (choice: string) => {
    if (!pdfBlocked) return
    if (choice === 'keep') {
      const renamed = pdfBlocked.jobs.map(
        (job) => ({ ...job, outputs: job.outputs.map((o) => uniqueOutputPath(o)) }) as Job,
      )
      const safe = checkWriteSafety(renamed, { force: false })
      setPdfBlocked(null)
      if (safe.failures.length > 0) {
        for (const failure of safe.failures) {
          hold({ kind: 'error', id: nextId(), error: failure.error })
        }
        setStep('pdf')
        return
      }
      void runPdfJobs(safe.jobs)
      return
    }
    if (choice !== 'replace') {
      const cancelTo = pdfBlocked.cancelTo
      setPdfBlocked(null)
      if (cancelTo === 'save-as') reopenSaveAs()
      else {
        // Back to /pdf's own Save as, as the run was asked, on the folder.
        setPdfReopen(pdfAsked)
        setStep(cancelTo)
      }
      return
    }
    const forced = checkWriteSafety(pdfBlocked.jobs, { force: true })
    setPdfBlocked(null)
    if (forced.failures.length > 0) {
      // A collision: `force` never bypasses it (see `checkWriteSafety`), so
      // this is the rare remainder "Replace" cannot fix.
      for (const failure of forced.failures) {
        hold({ kind: 'error', id: nextId(), error: failure.error })
      }
      setStep('pdf')
      return
    }
    void runPdfJobs(forced.jobs, { force: true })
  }

  /**
   * What Name taken says for a refused /pdf run: the one name that is taken,
   * with its size and age — or how many, when a split or an extract collides
   * on several.
   */
  const pdfTaken = (jobs: Job[]) => {
    const taken = jobs.flatMap((j) => j.outputs).filter((o) => existsSync(o))
    const [first] = taken
    if (!first) return { name: 'The file', keepBoth: '' }
    if (taken.length === 1) {
      return {
        name: displayName(first),
        keepBoth: displayName(uniqueOutputPath(first)),
        existing: takenFile(first),
      }
    }
    return { name: `${taken.length} files`, keepBoth: `${displayName(uniqueOutputPath(first))} …` }
  }

  // `NameTaken` owns its keys for the output-exists question; a plain refusal
  // (no bypass offered) has nothing mounted to answer escape or enter, so
  // this step owns both directly — same reasoning as the 'size' step
  // above, which owns escape for the same reason.
  useKeys(
    (_input, key) => {
      if (key.escape || key.return) answerPdfBlocked('cancel')
    },
    { isActive: step === 'pdf-blocked' && pdfBlocked?.failures[0]?.error.code !== 'output-exists' },
  )

  const modeSpec = specFor('mode')
  const sizeSpec = specFor('size')
  const targetSpec = specFor('target')
  // A PDF reaching the format picker still has page operations on the table
  // too — see `backToPromptKeepingStage`. A dim line below the list used to
  // be the only pointer to `/pdf`, which said where to go but not how to get
  // there short of escaping and typing the command from memory. This is that
  // same pointer, reachable the way JPEG or PNG are: a disabled, unlabelled
  // row first, so it reads as its own group rather than a sixth format
  // (`nextEnabledIndex` in Select already skips a disabled row when the
  // cursor walks past it), then the row itself.
  //
  // `format === 'pdf'` matters as much as `kind` does: a docx/doc source has
  // no page operations `/pdf` could offer it, so the row would be a dead end.
  const targetItems =
    targetSpec?.kind !== 'select'
      ? []
      : source?.kind === 'document' && source.format === 'pdf'
        ? [
            ...targetSpec.choices,
            { value: '__gap__', label: '', hint: '', disabled: true },
            // The pointer is the label itself: a picker row only speaks while
            // highlighted, and this one has to be read before anyone would
            // think to highlight it.
            { value: GOTO_PDF, label: '/pdf for more options' },
          ]
        : targetSpec.choices
  const pagesSpec = specFor('pages')
  const dpiSpec = specFor('dpi')
  const qualitySpec = specFor('quality')
  const destinationSpec = specFor('destination')

  /**
   * Every answer given so far in convert or compress, as the user would say
   * it, for the header bar's trail. `trailFor` decides which of them are
   * behind the screen on now. A folder is said by its own name, as Save to
   * lists it; `destination` is a path.
   */
  const trailAnswers = (
    extra: { destination?: string; name?: string | undefined; place?: string } = {},
  ): Partial<Record<Question, string>> => {
    const folder = extra.destination ?? (values.destination as string | undefined)
    const bySize = mode === 'compress' && values.mode === 'size'
    return {
      mode: modeSpec ? answerFor(modeSpec, values.mode) : undefined,
      // Edit's answer is the row's name ("Sharpen"), not the format it
      // keeps, and its pill's step with it ("Boost resolution 4×", "Crop to
      // shape 1:1").
      target: enhancing
        ? enhancing.scales && typeof values.scale === 'string'
          ? `${enhancing.label} ${values.scale}×`
          : enhancing.shapes && typeof values.shape === 'string'
            ? `${enhancing.label} ${values.shape}`
            : enhancing.label
        : typeof values.target === 'string' && values.target in FORMATS
          ? FORMATS[values.target as FormatId].label
          : undefined,
      pages: pagesSpec ? answerFor(pagesSpec, values.pages) : undefined,
      dpi: dpiSpec ? answerFor(dpiSpec, values.dpi) : undefined,
      size: bySize && typeof values.size === 'string' ? values.size : undefined,
      quality:
        !bySize && qualitySpec && typeof values.quality === 'number'
          ? String(values.quality)
          : undefined,
      // Edit's trail is the row and the name (the mockup's), no folder.
      // A copied image's place is the clipboard, and it has no file name.
      destination:
        extra.place ?? (folder && mode !== 'edit' ? displayName(displayPath(folder)) : undefined),
      name: extra.place ? undefined : (extra.name ?? savedAs),
    }
  }

  /** The trail a finished run is recorded with: every answer, then "Done". */
  const doneTrail = (extra: { destination?: string; name?: string; place?: string }): Trail => ({
    answers:
      mode === 'pdf'
        ? pdfTrailNow.answers
        : trailFor({ mode, step: 'result', answers: trailAnswers(extra) }).answers,
    current: 'Done',
  })

  /**
   * Done for a copied image (clipboard Step 6 and E3): the bar is named for
   * where the result went, and the keys are the clipboard's — u puts the
   * original back, s keeps a file too. When something else was copied
   * meanwhile, the user's own words (2026-10-16) say where it went instead.
   */
  const clipDoneProps = (again: string) => {
    if (clipDone?.status === 'placed') {
      return {
        afterName: 'On the clipboard',
        keys: [
          ['↵', again],
          ['u', 'undo'],
          ['s', 'save a copy'],
          ['o', 'open'],
        ] as Array<[string, string]>,
      }
    }
    if (clipDone?.status !== 'changed') return {}
    const inset = HOME_MARGIN + 2
    const verb = mode === 'compress' ? 'compressed' : 'converted'
    const block = notePanel({
      palette,
      title: 'Clipboard changed',
      lines: [
        'The file you uploaded is no longer in the clipboard.',
        `The ${verb} image is saved to ${displayName(dirname(clipDone.saved))}.`,
      ],
      width: Math.max(8, width - 2 * inset),
      plain: (process.env.NO_COLOR ?? '') !== '',
    }).map((row): Row => [{ text: ' '.repeat(inset) }, ...row])
    const reveal = revealLabel()
    return {
      afterName: displayName(clipDone.saved),
      block,
      keys: [
        ['↵', again],
        ['o', 'open'],
        ['s', reveal.charAt(0).toLowerCase() + reveal.slice(1)],
      ] as Array<[string, string]>,
    }
  }

  /** The header bar's trail for the screen on now. */
  const barTrail = (): Trail => {
    // A job not yet shown as Working: the bar stays as the last question left it.
    const at = running && !workShown ? lastQuestion.current : step
    if (at === 'pdf') return pdfTrailNow
    if (at === 'watch') return watchTrailNow
    if (at === 'colour') return colourTrailNow
    // Crop to shape ╱ 1:1: the preview is named by the shape it cuts.
    if (at === 'crop' && enhancing) {
      return {
        answers: [enhancing.label],
        current: typeof values.shape === 'string' ? values.shape : undefined,
      }
    }
    // Resize ╱ Exact size ╱ Size: the pair is the slider's question, asked another way.
    if (at === 'exact-size') {
      const slider = trailFor({ mode, step: 'resize', answers: trailAnswers() })
      return { answers: [...slider.answers, 'Exact size'], current: slider.current }
    }
    if (mode === 'pdf' && (at === 'pdf-running' || at === 'pdf-blocked')) {
      return {
        answers: [...pdfTrailNow.answers, ...pdfSaved],
        current: at === 'pdf-running' ? work?.verb : 'Name taken',
      }
    }
    const waiting =
      stage.sources.length > 1
        ? `${stage.sources.length} files`
        : source
          ? displayName(source.path)
          : undefined
    return trailFor({ mode, step: at, answers: trailAnswers(), waiting, verb: work?.verb })
  }

  /**
   * The Box the whole frame is measured from. `useFrameOrigin` needs its
   * height to place the frame, and `<Static>` is excluded from this Box's
   * layout (measured against Ink 7.1.1) — which is what makes the height the
   * *live* frame's height rather than the whole session's.
   */
  const rootRef = useRef<DOMElement | null>(null)
  /**
   * Light and dark paint their own canvas: the live frame fills the window,
   * every row the full width, so forge looks the same on any profile while
   * it runs (the terminal's own default background follows it too — see
   * `useTerminalBackground`). Each history block is painted too, so what
   * forge printed stays readable once the frame moves on. The
   * margin (`inset`), if any, is painted with it, and the blank row (`top`)
   * the live frame keeps above it.
   */
  const canvas = paint ? { backgroundColor: palette.canvas, width: measured, paddingX: inset } : {}
  // Home draws the notices under its field, and makes room for them (a
  // refusal of what was typed takes the slot first); every other screen
  // above its keys.
  const homeNotices = onHome && !homeError ? liveNotices : NO_NOTICES
  const keyNotices = onHome ? NO_NOTICES : liveNotices

  return (
    <ThemeProvider palette={palette}>
      <NoticesContext.Provider value={keyNotices}>
        <ClickTargetProvider>
          <Box
            flexDirection="column"
            ref={rootRef}
            {...canvas}
            // The frame fills the window on every screen, as home does, so
            // each screen's keys reach the last row (see HintBar).
            minHeight={measuredHeight}
            paddingTop={top}
          >
            {/* Inside the provider, deliberately — see `MouseRouter`. `revision`
              recalibrates the frame's origin: committed history scrolls the
              live frame down the screen, and `history.length` changes exactly
              when that happens. */}
            <MouseRouter rootRef={rootRef} revision={history.length} />
            {step === 'theme' ? (
              <ThemePicker
                width={width}
                onChoose={chooseTheme}
                {...(theme ? { onCancel: () => backToCommands('theme') } : {})}
              />
            ) : null}

            {/* Where a history block would sit — above the flow it explains —
              but live, so it can go with the file (see `fileRefusal`). */}
            {fileRefusal && step !== 'theme' && !SETTINGS_STEPS.has(step) ? (
              <Box flexDirection="column" marginBottom={1}>
                <ErrorPanel
                  error={fileRefusal.error}
                  width={Math.max(8, width - 2 * HOME_MARGIN)}
                />
              </Box>
            ) : null}

            {/* The header bar: which mode, and the trail of answers so far —
            on every screen after home. Not on Done, which draws its own, the
            trail ending in "Done" (see `doneTrail` and `DoneScreen`). Nor on
            the settings (/extensions, /update, /about), which are no mode and
            each draw their own chip. */}
            {working && !onHome && !atDone && !SETTINGS_STEPS.has(step) ? (
              <Box marginBottom={1}>
                <HeaderBar
                  mode={mode}
                  trail={barTrail()}
                  width={width}
                  drift={running && workShown}
                />
              </Box>
            ) : null}

            {/* The staged list, shown live rather than committed to scrollback,
            for as long as it is still something the user can take back.
            Not on home: its drop panel holds the stage there. */}
            {stage.sources.length > 0 &&
            step !== 'theme' &&
            !atDone &&
            step !== 'watch' &&
            !onHome ? (
              <Box marginBottom={1}>
                <StagedFiles stage={stage} width={width} dim={running && workShown} />
              </Box>
            ) : null}
            <Static key={staticGeneration} items={history}>
              {(block) =>
                paint ? (
                  <Box key={block.id} flexDirection="column" {...canvas}>
                    <HistoryEntry block={block} width={width} />
                  </Box>
                ) : (
                  <HistoryEntry key={block.id} block={block} width={width} />
                )
              }
            </Static>

            {step === 'mode' && source && modeSpec?.kind === 'select' ? (
              <Box flexDirection="column" flexGrow={1}>
                <Box marginBottom={1}>
                  <StepTitle
                    mode={mode}
                    title="Method"
                    aside={displayName(source.path)}
                    width={width}
                  />
                </Box>
                <Select
                  width={pickerWidth}
                  items={modeSpec.choices}
                  initialValue={modeSpec.default}
                  onSubmit={(chosen) => {
                    setValues((v) => ({ ...v, mode: chosen }))
                    if (chosen === 'size' && !unitsHere.includes(sizeUnit)) {
                      setSizeUnit(unitsHere.includes('mb') ? 'mb' : (unitsHere[0] ?? 'kb'))
                    }
                    const sound = source.kind === 'media' && !hasPicture(source)
                    setStep(chosen === 'size' ? 'size' : sound ? 'bitrate' : 'quality')
                  }}
                  onCancel={clearSource}
                  showHints={band !== 'compact'}
                />
                <HintBar
                  width={width}
                  pairs={[
                    ['↑↓', 'choose'],
                    ['↵', 'confirm'],
                    [MODE_KEYS, 'mode'],
                    // Method is the first question: esc takes the file off the bench.
                    ['esc', 'remove file'],
                  ]}
                />
              </Box>
            ) : null}

            {step === 'size' && source && sizeSpec?.kind === 'text' ? (
              <Box flexDirection="column" flexGrow={1}>
                <StepTitle
                  mode={mode}
                  title={sizeSpec.label}
                  aside={`${displayName(source.path)} · ${formatBytes(source.bytes)}`}
                  width={width}
                />
                {/* Save as's field, the unit inside it at the right: the amount
                  and its unit are one answer, read as one line. */}
                <SizeField
                  value={text}
                  onChange={setText}
                  onSubmit={submitSize}
                  placeholder={sizeSpec.placeholder}
                  unit={sizeUnit}
                  units={unitsHere}
                  unitFocused={unitFocused}
                  width={width}
                />
                {/* A video's floor, as compress already says it (SizeAside):
                  the size in bold, then the words in plain orange. */}
                {floorHere !== undefined &&
                (parseSize(sizeWithUnit(text)) ?? Number.POSITIVE_INFINITY) < floorHere ? (
                  <Text>
                    {'   '}
                    <Text bold color={colourProp(palette.fg)}>
                      {formatBytes(floorHere)}
                    </Text>
                    <Text color={colourProp(palette.larger)}>{'  cannot compress more'}</Text>
                  </Text>
                ) : null}
                {/* Said only when what was typed is not a size at all; what it
                  is, when it is one, the field already shows. */}
                {text.trim() !== '' && describeSize(sizeWithUnit(text)) === undefined ? (
                  <Text color={colourProp(palette.dim)}>
                    {`  ${SYMBOLS.warn} not a size — try 500kb or 2mb`}
                  </Text>
                ) : null}
                {sizeError ? (
                  <Box flexDirection="column">
                    <Text> </Text>
                    <ErrorLine
                      title="Not a size"
                      reason={sizeError}
                      width={Math.max(8, width - 2 * HOME_MARGIN)}
                    />
                  </Box>
                ) : null}
                <HintBar
                  width={width}
                  pairs={[
                    ['↵', 'confirm'],
                    // One unit leaves nothing for tab to switch to.
                    ...(unitsHere.length > 1
                      ? ([['tab', unitFocused ? 'amount' : 'unit']] as Array<[string, string]>)
                      : []),
                    ...(unitFocused ? ([['←→', 'change unit']] as Array<[string, string]>) : []),
                    ['esc', 'back'],
                  ]}
                />
              </Box>
            ) : null}

            {step === 'target' &&
            source?.kind === 'media' &&
            hasPicture(source) &&
            targetSpec?.kind === 'select' ? (
              <MediaFormatPicker
                mode={mode}
                targets={targetSpec.choices.map((c) => c.value as FormatId)}
                initial={
                  typeof values.target === 'string' ? (values.target as FormatId) : undefined
                }
                missing={
                  source.facts
                    ? undefined
                    : process.platform === 'win32'
                      ? 'winget install ffmpeg'
                      : 'brew install ffmpeg'
                }
                onSubmit={(target) => chooseTarget(source, target)}
                onCancel={clearSource}
                width={width}
              />
            ) : null}

            {step === 'target' &&
            source &&
            !(source.kind === 'media' && hasPicture(source)) &&
            targetSpec?.kind === 'select' ? (
              <Box flexDirection="column" flexGrow={1}>
                <Box marginBottom={1}>
                  <StepTitle mode={mode} title="Convert to" width={width} />
                </Box>
                <Select
                  width={pickerWidth}
                  items={targetItems}
                  onHighlight={(i) => setTargetHighlight(targetItems[i]?.value)}
                  speak={(item, budget) =>
                    item.value === GOTO_PDF ? null : (
                      <SizeAside
                        size={
                          source.kind === 'media'
                            ? soundSize(source, item.value as FormatId)
                            : targetSize
                        }
                        sourceBytes={source.bytes}
                        budget={budget}
                      />
                    )
                  }
                  onSubmit={(target) => {
                    if (target === GOTO_PDF) {
                      if (pdfCommand) runCommand(pdfCommand)
                      return
                    }
                    chooseTarget(source, target)
                  }}
                  onCancel={source.kind === 'document' ? backToPromptKeepingStage : clearSource}
                  showHints={band !== 'compact'}
                />
                <HintBar
                  width={width}
                  pairs={[
                    ['↑↓', 'choose'],
                    ['↵', 'confirm'],
                    [MODE_KEYS, 'mode'],
                    // A document stays staged on esc (/pdf may still want it); an image
                    // is taken off the bench. The key says which.
                    ['esc', source.kind === 'document' ? 'back' : 'remove file'],
                  ]}
                />
              </Box>
            ) : null}

            {step === 'pages' && source && pagesSpec?.kind === 'select' ? (
              <Box flexDirection="column" flexGrow={1}>
                <Box marginBottom={1}>
                  <StepTitle
                    mode={mode}
                    title={pagesSpec.label}
                    aside={
                      source.kind === 'document'
                        ? `${displayName(source.path)} · ${source.pages} pages`
                        : displayName(source.path)
                    }
                    width={width}
                  />
                </Box>
                <Select
                  width={pickerWidth}
                  items={pagesSpec.choices}
                  initialValue={pagesSpec.default}
                  onSubmit={choosePages}
                  onCancel={() => setStep('target')}
                  showHints={band !== 'compact'}
                />
                <HintBar
                  width={width}
                  pairs={[
                    ['↑↓', 'choose'],
                    ['↵', 'confirm'],
                    [MODE_KEYS, 'mode'],
                    ['esc', 'back'],
                  ]}
                />
              </Box>
            ) : null}

            {step === 'page-picker' && source && source.kind === 'document' ? (
              <Box flexDirection="column" flexGrow={1}>
                <PageGrid
                  mode="cell"
                  pageCount={source.pages}
                  selected={Array.isArray(values.pages) ? (values.pages as number[]) : []}
                  cuts={[]}
                  onSubmit={submitPagePicker}
                  onCancel={() => setStep('pages')}
                  width={width}
                  height={height}
                />
                <HintBar
                  width={width}
                  pairs={[
                    ['space', 'toggle'],
                    ['a', 'all'],
                    ['↵', 'confirm'],
                    ['esc', 'back'],
                  ]}
                />
              </Box>
            ) : null}

            {step === 'dpi' && source && dpiSpec?.kind === 'select' ? (
              <Box flexDirection="column" flexGrow={1}>
                <Box marginBottom={1}>
                  <StepTitle
                    mode={mode}
                    title={dpiSpec.label}
                    aside={displayName(source.path)}
                    width={width}
                  />
                </Box>
                <Select
                  width={pickerWidth}
                  items={dpiSpec.choices}
                  initialValue={dpiSpec.default}
                  onSubmit={(dpi) => chooseDpi(source, dpi)}
                  onCancel={() => setStep(Array.isArray(values.pages) ? 'page-picker' : 'pages')}
                  showHints={band !== 'compact'}
                />
                <HintBar
                  width={width}
                  pairs={[
                    ['↑↓', 'choose'],
                    ['↵', 'confirm'],
                    [MODE_KEYS, 'mode'],
                    ['esc', 'back'],
                  ]}
                />
              </Box>
            ) : null}

            {step === 'bitrate' && source?.kind === 'media' && specFor('bitrate')?.kind === 'slider'
              ? (() => {
                  const spec = specFor('bitrate')
                  if (spec?.kind !== 'slider') return null
                  const kbps = typeof values.bitrate === 'number' ? values.bitrate : spec.default
                  const duration = source.facts?.duration ?? 0
                  return (
                    <Box flexDirection="column" flexGrow={1}>
                      <QualityStep
                        mode={mode}
                        aside={
                          mode === 'compress'
                            ? displayName(source.path)
                            : typeof values.target === 'string'
                              ? FORMATS[values.target as FormatId].label
                              : undefined
                        }
                        min={spec.min}
                        max={spec.max}
                        step={spec.step}
                        value={kbps}
                        unit=" kbps"
                        onChange={(b) => setValues((v) => ({ ...v, bitrate: b }))}
                        onSubmit={(b) => openSaveAs({ values: { ...values, bitrate: b } })}
                        onCancel={() => setStep(mode === 'compress' ? 'mode' : 'target')}
                        // For sound the size is arithmetic: bitrate × length.
                        size={{ status: 'done', bytes: Math.round((kbps * 1000 * duration) / 8) }}
                        sourceBytes={source.bytes}
                        width={width}
                        noBigger={mode === 'compress'}
                      />
                    </Box>
                  )
                })()
              : null}

            {step === 'ffmpeg' && source?.kind === 'media' ? (
              <FfmpegStep
                state={ffmpegState}
                checking={checking}
                how={process.platform === 'win32' ? 'winget install ffmpeg' : 'brew install ffmpeg'}
                onInstall={() => void installFfmpeg()}
                onLookAgain={lookAgain}
                onStop={() => installAbort.current?.abort()}
                onCancel={clearSource}
                width={width}
              />
            ) : null}

            {step === 'length' && source?.kind === 'media' && source.facts ? (
              <LengthStep
                source={source}
                title={mode === 'edit' ? 'Trim' : 'GIF'}
                gif={mode !== 'edit'}
                initial={values.cut as Cut | undefined}
                onSubmit={(cut) => {
                  const vals = { ...values, cut }
                  setValues(vals)
                  openSaveAs({
                    values: vals,
                    action: mode === 'edit' ? mediaEditAction : convertAction,
                  })
                }}
                onCancel={() => setStep(mode === 'edit' ? 'edit' : 'target')}
                width={width}
              />
            ) : null}

            {step === 'quality' && source && qualitySpec?.kind === 'slider' ? (
              <Box flexDirection="column" flexGrow={1}>
                <QualityStep
                  mode={mode}
                  // What the quality is for: the format in convert, the file in compress.
                  aside={
                    mode === 'compress'
                      ? displayName(source.path)
                      : typeof values.target === 'string'
                        ? FORMATS[values.target as FormatId].label
                        : undefined
                  }
                  min={qualitySpec.min}
                  max={qualitySpec.max}
                  step={qualitySpec.step}
                  value={qualityNow}
                  onChange={(q) => setValues((v) => ({ ...v, quality: q }))}
                  onSubmit={(q) => {
                    // A copied image is never put back larger: ↵ waits for
                    // the size, and is off where it would grow.
                    const copied = clip !== null && clip.source === source.path
                    const grows = qualitySize.status !== 'done' || qualitySize.bytes >= source.bytes
                    if (copied && mode === 'compress' && grows) return
                    chooseQuality(q)
                  }}
                  onCancel={() => setStep(dpiSpec ? 'dpi' : 'target')}
                  size={qualitySize}
                  sourceBytes={source.bytes}
                  width={width}
                  points={qualitySpec.points === true}
                  noBigger={mode === 'compress'}
                  dither={
                    offerDither
                      ? {
                          on: ditherOn,
                          onToggle: () => setValues((v) => ({ ...v, dither: v.dither !== true })),
                        }
                      : undefined
                  }
                />
              </Box>
            ) : null}

            {step === 'edit' && source?.kind === 'media' ? (
              <EditPicker
                format={FORMATS[source.format].label}
                rows={mediaEditRows(source)}
                tools={{}}
                checking={false}
                chosen={{ tool: values.tool, step: values.shape }}
                width={width}
                onChoose={chooseEdit}
                onStop={() => {}}
                onCancel={clearSource}
              />
            ) : null}

            {step === 'edit' && source?.kind === 'image' && toolStates ? (
              <EditPicker
                format={FORMATS[source.format].label}
                rows={editRows(
                  source,
                  measure,
                  boostScales(
                    toolStates.boost?.kind === 'ready' ? toolStates.boost.version : undefined,
                  ),
                )}
                tools={toolStates}
                checking={checking}
                chosen={{ tool: values.tool, step: values.shape ?? values.scale }}
                width={width}
                onChoose={(row, step) => {
                  const state = row.extension ? toolStates[row.extension] : { kind: 'ready' }
                  if (state?.kind === 'ready') chooseEdit(row, step)
                  else if (state?.kind === 'absent') void installThen(row)
                }}
                onStop={stopInstall}
                onCancel={clearSource}
              />
            ) : null}

            {step === 'resize' && source?.kind === 'media' && source.facts?.video ? (
              <ResizeStep
                mode={mode}
                aside={`${displayName(source.path)} · ${source.facts.video.width} × ${source.facts.video.height}`}
                from={source.facts.video}
                percent={resizePercent}
                // Never bigger than the video is.
                max={100}
                onChange={setResizePercent}
                onSubmit={(percent) => chooseResize({ percent })}
                onExact={() => setStep('exact-size')}
                onCancel={() => setStep('edit')}
                width={width}
              />
            ) : null}

            {step === 'crop' && source?.kind === 'media' && cropFrame && cropShape ? (
              <CropStep
                key={`${source.path}\u0000${cropShape.label}`}
                mode={mode}
                source={cropFrame}
                shape={cropShape}
                initial={cropAt}
                onChange={setCropAt}
                onSubmit={chooseCrop}
                onCancel={() => {
                  dropFrame()
                  setStep('edit')
                }}
                width={width}
              />
            ) : null}

            {step === 'resize' && source?.kind === 'image' ? (
              <ResizeStep
                mode={mode}
                aside={`${displayName(source.path)} · ${source.width} × ${source.height}`}
                from={source}
                percent={resizePercent}
                max={largestPercent(source)}
                onChange={setResizePercent}
                onSubmit={(percent) => chooseResize({ percent })}
                onExact={() => setStep('exact-size')}
                onCancel={() => setStep('edit')}
                width={width}
              />
            ) : null}

            {step === 'crop' && source?.kind === 'image' && cropShape ? (
              <CropStep
                key={`${source.path}\u0000${cropShape.label}`}
                mode={mode}
                source={source}
                shape={cropShape}
                initial={cropAt}
                onChange={setCropAt}
                onSubmit={chooseCrop}
                // Back to the list, the shape still on the pill.
                onCancel={() => setStep('edit')}
                width={width}
              />
            ) : null}

            {step === 'exact-size' && source?.kind === 'media' && source.facts?.video ? (
              <ExactSizeStep
                mode={mode}
                aside={`${displayName(source.path)} · ${source.facts.video.width} × ${source.facts.video.height}`}
                from={source.facts.video}
                percent={resizePercent}
                onSubmit={chooseResize}
                onCancel={() => setStep('resize')}
                width={width}
              />
            ) : null}

            {step === 'exact-size' && source?.kind === 'image' ? (
              <ExactSizeStep
                mode={mode}
                aside={`${displayName(source.path)} · ${source.width} × ${source.height}`}
                from={source}
                percent={resizePercent}
                onSubmit={chooseResize}
                onCancel={() => setStep('resize')}
                width={width}
              />
            ) : null}

            {step === 'save-as' && saving && destinationSpec?.kind === 'path' ? (
              <Box flexDirection="column" flexGrow={1}>
                <SaveAs
                  key={saving.opened}
                  mode={mode}
                  width={width}
                  name={text}
                  onNameChange={editName}
                  proposed={saving.stem}
                  ext={saving.ext}
                  fixedName={saving.fixedName}
                  folder={saving.folder}
                  onFolder={chooseFolder}
                  presets={destinationSpec.presets}
                  defaultPath={expandTilde(livePrefs.defaultOutput)}
                  lastPath={destinationSpec.last}
                  display={displayPath}
                  onMakeDefault={makeDefault}
                  onSubmit={confirmDestination}
                  onBack={destinationBack}
                />
              </Box>
            ) : null}

            {step === 'overwrite' && pending ? (
              <Box flexDirection="column" flexGrow={1}>
                <NameTaken
                  mode={mode}
                  width={width}
                  name={displayName(pending.output)}
                  keepBoth={displayName(pending.keepBoth)}
                  existing={pending.existing}
                  onSubmit={answerOverwrite}
                  onCancel={() => {
                    setPending(null)
                    reopenSaveAs()
                  }}
                />
              </Box>
            ) : null}

            {step === 'size-unreachable' && sizeUnreachable ? (
              <Box flexDirection="column" flexGrow={1}>
                <Box marginBottom={1}>
                  <StepTitle
                    mode={mode}
                    title={`${source ? displayName(source.path) : 'This file'} can't get below ${formatBytes(
                      sizeUnreachable.smallest,
                    )}`}
                    aside={`asked for ${formatBytes(sizeUnreachable.targetBytes)}`}
                    width={width}
                  />
                </Box>
                <Select
                  width={pickerWidth}
                  items={[
                    {
                      value: 'lowest',
                      label: `Use ${formatBytes(sizeUnreachable.smallest)} anyway`,
                      // What the answer does, the way Name taken's answers say it.
                      hint: `saves it at ${formatBytes(sizeUnreachable.smallest)}`,
                    },
                    { value: 'size', label: 'Try a different target size' },
                    { value: 'quality', label: 'Compress by quality instead' },
                    { value: 'format', label: 'Convert to a different format' },
                  ]}
                  onSubmit={answerSizeUnreachable}
                  onCancel={() => {
                    setSizeUnreachable(null)
                    clearSource()
                  }}
                  showHints={band !== 'compact'}
                />
                <HintBar
                  width={width}
                  pairs={[
                    ['↑↓', 'choose'],
                    ['↵', 'confirm'],
                    ['esc', 'cancel'],
                  ]}
                />
              </Box>
            ) : null}

            {/* Working (W5), once a job has run long enough to need it: the
              bar above drifts, and this says what is happening. The same
              screen for a conversion and a page operation. */}
            {running && workShown && work ? (
              <Box flexDirection="column" flexGrow={1}>
                <Working
                  mode={mode}
                  label={
                    attempt
                      ? 'Finding the right quality'
                      : timeProgress?.pass
                        ? `Pass ${timeProgress.pass.at} of 2 · ${work.phase ?? work.verb}`
                        : pageProgress
                          ? `${verbOf(pageProgress.job) ?? work.verb} ${displayName(pageProgress.job.sources[0].path)}`
                          : (work.phase ?? work.verb)
                  }
                  startedAt={work.startedAt}
                  search={attempt}
                  pages={attempt ? undefined : (pageProgress ?? undefined)}
                  time={attempt ? undefined : (timeProgress ?? undefined)}
                  stoppable={mode === 'edit' || timeProgress !== null}
                  width={width}
                />
              </Box>
            ) : null}

            {/* Done (K3·a): the file before and after, sized by bytes, filling
              the screen with the keys on the bottom row. Its offers are
              measured, not estimated — the suggestion came from actually
              encoding a candidate — and offered rather than applied: the
              file asked for is already written, which is why they are drawn
              in `accent`, the colour of the `c` key that takes one, and not
              as warnings. The merge offer reuses the same place: a nudge,
              with no key of its own (doing that honestly needs the written
              PDFs re-probed first), toward `/pdf`, which already merges.
              No clickable "Open file · Show in Finder" labels: `o` and `s`
              on the key row do the same, and the design has no row for them. */}
            {/* Edit's Done (X5): the header bar, the quiet line and the
              picture before and after (`EditDone`), then the keys. */}
            {step === 'result' &&
            lastResult &&
            doneBar &&
            doneBar.mode === 'edit' &&
            !compressNext ? (
              <Box flexDirection="column" flexGrow={1}>
                <Box marginBottom={1}>
                  <HeaderBar mode="edit" trail={doneBar.trail} width={width} />
                </Box>
                <EditDone
                  op={
                    lastResult.job.op === 'convert'
                      ? lastResult.job.options.crop
                        ? 'crop'
                        : lastResult.job.options.resize
                          ? 'resize'
                          : 'trim'
                      : lastResult.job.op === 'remove-background'
                        ? 'remove-background'
                        : 'boost'
                  }
                  {...(lastResult.job.op === 'boost' ? { scale: lastResult.job.scale } : {})}
                  before={lastResult.job.sources[0].path}
                  after={lastResult.job.outputs[0] ?? ''}
                  savedTo={
                    clipDone?.status === 'changed'
                      ? dirname(clipDone.saved)
                      : dirname(lastResult.job.outputs[0] ?? '')
                  }
                  placed={clipDone?.status === 'placed' ? 'On the clipboard' : undefined}
                  width={width}
                  // The terminal's rows less the header bar (2) and keys (3),
                  // and one more so the frame never fills the screen.
                  rows={height - 6}
                />
                <HintBar
                  width={width}
                  pairs={
                    clipDone?.status === 'placed'
                      ? [
                          ['↵', 'edit another'],
                          ['u', 'undo'],
                          ['s', 'save a copy'],
                          ['o', 'open'],
                        ]
                      : [
                          ['↵', 'edit another'],
                          ['o', 'open'],
                          ['s', revealLabel()],
                        ]
                  }
                  foot={[['ctrl-c', 'quit']]}
                />
              </Box>
            ) : null}

            {step === 'result' &&
            lastResult &&
            doneBar &&
            (doneBar.mode !== 'edit' || compressNext) ? (
              <DoneScreen
                mode={doneBar.mode}
                trail={doneBar.trail}
                result={lastResult}
                offers={[
                  ...(suggestion
                    ? [
                        `${SYMBOLS.tip} ${FORMATS[suggestion.target].label} would be ${formatBytes(
                          suggestion.bytes,
                        )}, ${Math.round(suggestion.saving * 100)}% smaller again.`,
                      ]
                    : []),
                  ...(mergeOffer
                    ? [
                        `${SYMBOLS.tip} ${mergeOffer} PDFs from this session could become one — /pdf, then Merge.`,
                      ]
                    : []),
                ]}
                again={
                  doneBar.mode === 'compress'
                    ? 'compress again'
                    : doneBar.mode === 'edit'
                      ? 'edit another'
                      : 'convert another'
                }
                offer={
                  suggestion
                    ? FORMATS[suggestion.target].label
                    : compressNext
                      ? 'compress it'
                      : undefined
                }
                reveal={revealLabel()}
                width={width}
                height={height}
                pressed={donePressed}
                preset={presets.done}
                chain={presets.chain}
                {...clipDoneProps(
                  doneBar.mode === 'compress' ? 'compress again' : 'convert another',
                )}
              />
            ) : null}

            {(step === 'preset-edit' || step === 'preset-save') && presets.screen
              ? presets.screen
              : null}

            {step === 'update' ? (
              <UpdateFlow
                width={width}
                current={VERSION}
                auto={livePrefs.updateCheck !== false}
                updater={updater}
                onClose={() => backToCommands('update')}
                onChecked={(latest) => void keepRelease(latest)}
                onRestart={() => {
                  requestRestart()
                  exit()
                }}
              />
            ) : null}

            {step === 'about' ? (
              <AboutFlow
                width={width}
                height={height}
                version={VERSION}
                system={about}
                onClose={() => backToCommands('about')}
              />
            ) : null}

            {step === 'extensions' ? (
              <ExtensionsFlow
                width={width}
                onError={(error) => hold({ kind: 'error', id: nextId(), error })}
                onClose={() => backToCommands('extensions')}
              />
            ) : null}

            {step === 'colour' ? (
              <ColourFlow
                start={colourStart}
                width={width}
                height={height}
                onCancel={() => setStep('idle')}
                onTrail={setColourTrailNow}
                steps={colourSteps}
                onSteps={setColourSteps}
              />
            ) : null}

            {step === 'watch' && stage.folder ? (
              <WatchFlow
                scan={stage.folder}
                width={width}
                height={height}
                prefs={livePrefs}
                onTrail={setWatchTrailNow}
                onCancel={backToPromptKeepingStage}
                onClose={clearSource}
                onMakeDefault={makeDefault}
                onSaved={rememberSaved}
              />
            ) : null}

            {step === 'pdf' ? (
              <PdfFlow
                stage={stage}
                width={width}
                height={height}
                prefs={livePrefs}
                resume={pdfReopen}
                onDone={(jobs, resume) => {
                  const outputs = jobs.flatMap((j) => j.outputs)
                  const [first] = outputs
                  setPdfSaved(
                    first
                      ? [
                          displayName(displayPath(dirname(first))),
                          outputs.length > 1 ? `${outputs.length} files` : displayName(first),
                        ]
                      : [],
                  )
                  setPdfAsked(resume)
                  setPdfReopen(undefined)
                  void handlePdfDone(jobs)
                }}
                // Keeps the stage rather than `clearSource`: `mode` is still
                // 'pdf' on the way back out (nothing here resets it), so
                // dropping a second PDF at idle re-enters the hub with both
                // staged — the escape hatch merge needs, now that a single
                // drop opens the hub directly instead of requiring `/pdf`
                // to be typed again. Abandoning the file entirely is still
                // one keystroke further: esc again at idle, on an empty
                // field, clears the stage the same way it already does
                // everywhere else in this file.
                onCancel={() => {
                  setPdfReopen(undefined)
                  backToPromptKeepingStage()
                }}
                onTrail={setPdfTrailNow}
                onMakeDefault={makeDefault}
                onSaved={rememberSaved}
              />
            ) : null}

            {step === 'pdf-blocked' && pdfBlocked?.failures[0] ? (
              pdfBlocked.failures[0].error.code === 'output-exists' ? (
                <Box flexDirection="column" flexGrow={1}>
                  <NameTaken
                    mode={mode}
                    width={width}
                    {...pdfTaken(pdfBlocked.jobs)}
                    onSubmit={answerPdfBlocked}
                    onCancel={() => answerPdfBlocked('cancel')}
                  />
                </Box>
              ) : (
                <Box flexDirection="column" flexGrow={1}>
                  <Text color={colourProp(palette.fail)}>
                    {SYMBOLS.fail} {pdfBlocked.failures[0].error.title}
                  </Text>
                  {/* `.detail`, never `.hint` — the hint text is CLI wording
                  ("Pass --force to replace it"), and the shell has no
                  --force flag. */}
                  <Text
                    color={colourProp(palette.fg)}
                  >{`  ${pdfBlocked.failures[0].error.detail}`}</Text>
                  <Text color={colourProp(palette.dim)}>{'  esc or enter to go back'}</Text>
                  <HintBar width={width} pairs={[['esc', 'back']]} />
                </Box>
              )
            ) : null}

            {onHome ? (
              <Home
                width={width}
                height={height}
                intro={firstHome.current}
                update={release}
                mode={mode}
                typing={text !== ''}
                staged={staged ? stagedView(stage, freshRows, mode) : undefined}
                under={underField(stage, mode)}
                note={
                  homeError ? (
                    <ErrorLine
                      title={homeError.title}
                      reason={homeError.short ?? homeError.detail}
                      width={Math.max(8, width - 2 * HOME_MARGIN)}
                    />
                  ) : homeNotices.length > 0 ? (
                    <Notices notices={homeNotices} width={width} />
                  ) : undefined
                }
                noteRows={
                  homeNotices.length > 0 ? noticeRows(homeNotices, width, palette) : undefined
                }
                field={
                  <Prompt
                    value={text}
                    onChange={setText}
                    onSubmit={submitPath}
                    placeholder={staged ? 'drop more, or type a path' : 'or type a path'}
                    isActive
                    variant="home"
                    width={width}
                    rawOnSubmit
                    intercept={homeKey}
                    hint={pasteHint}
                  />
                }
                commands={commands}
                list={
                  completions.length > 0
                    ? (rows) => (
                        <Suggestions
                          items={completions.map((c) => c.label)}
                          selected={chosen}
                          width={width}
                          rows={rows}
                        />
                      )
                    : undefined
                }
                colourChoice={colourChoice}
                keys={homeKeys({
                  typing: text !== '',
                  completions: completions.length,
                  menu: commands !== undefined,
                  colour: mode === 'colour',
                  staged: staged
                    ? { count: stage.sources.length, verb: stagedVerb(stage, mode) }
                    : undefined,
                })}
              />
            ) : null}
          </Box>
        </ClickTargetProvider>
      </NoticesContext.Provider>
    </ThemeProvider>
  )
}

/**
 * The default for `latestRelease`: the once-a-day check, from the cache, or
 * from npm when the cache is more than a day old. Nothing when it is off.
 */
async function backgroundRelease(prefs: Preferences): Promise<string | undefined> {
  const { checkNow, isStale, readCache, updateChecksEnabled } = await import('../update/check.js')
  if (!updateChecksEnabled(prefs)) return undefined
  const cache = await readCache()
  if (!isStale(cache)) return cache?.latest
  return (await checkNow()) ?? cache?.latest
}
