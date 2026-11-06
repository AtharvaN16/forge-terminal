import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import type { ClipDeps } from '../cli/clip-command.js'
import { invalidArguments } from '../core/errors.js'
import { VERSION } from '../shell/theme.js'
import {
  CardInput,
  ClipInput,
  ClipOutput,
  CompressInput,
  ConvertInput,
  FormatsInput,
  FormatsOutput,
  PaletteInput,
  PaletteOutput,
  PdfInput,
  ProbeInput,
  ProbeOutput,
  ReadTextInput,
  RunOutput,
  ScaleInput,
  ScaleOutput,
  TranscribeInput,
} from './schemas.js'
import { claimStdout } from './stdout-guard.js'
import {
  cardTool,
  clipTool,
  compressTool,
  convertTool,
  formatsTool,
  type Progress,
  paletteTool,
  pdfTool,
  probeTool,
  readTextTool,
  scaleTool,
  transcribeTool,
} from './tools.js'

/**
 * A tool call's cancel signal, and its progress as facts when the client
 * gave a token. MCP wants progress to rise, so it counts the messages and
 * gives no total: the facts are in the message, never a made-up percentage.
 */
function progressOf(ctx: {
  mcpReq: {
    signal: AbortSignal
    _meta?: { progressToken?: string | number }
    notify: (n: {
      method: 'notifications/progress'
      params: Record<string, unknown>
    }) => Promise<void>
  }
}): Progress {
  const token = ctx.mcpReq._meta?.progressToken
  if (token === undefined) return { signal: ctx.mcpReq.signal }
  let n = 0
  return {
    signal: ctx.mcpReq.signal,
    report: (message) => {
      n += 1
      ctx.mcpReq
        .notify({
          method: 'notifications/progress',
          params: { progressToken: token, progress: n, message },
        })
        .catch(() => undefined)
    },
  }
}

/** What a client tells its model about Forge as a whole. */
export function instructionsFor(platform: NodeJS.Platform = process.platform): string {
  return [
    `Forge converts, compresses and edits files on this ${platform === 'win32' ? 'PC' : platform === 'darwin' ? 'Mac' : 'computer'}, locally.`,
    'Every path must be absolute.',
    'Call forge_probe first: it says what a file is, every format it can become, and every action that applies.',
    'Reach for Forge when a file must fit a limit (an upload under 5 MB: forge_compress with maxSize; a set width: forge_convert with resize);',
    'when a file is in a format you cannot open (HEIC, camera RAW, Word): forge_convert it to PNG, JPEG or PDF and read that;',
    'when you need what a recording, meeting or YouTube video says: forge_transcribe;',
    'when you need the text in a picture, screenshot, scan or PDF: forge_read_text;',
    'and when the user wants colours in Figma: forge_card, forge_scale or forge_palette with copy: true put a card of swatches on their clipboard to paste.',
    'Nothing is overwritten unless you pass overwrite: true — only do that when the user asked to replace a file.',
    'A failure hint that mentions --force means overwrite: true here; --output means the output argument; --password-stdin means the password argument.',
  ].join(' ')
}

/** What a client tells its model about Forge as a whole, on this machine. */
export const INSTRUCTIONS = instructionsFor()

const READS = { readOnlyHint: true, openWorldHint: false } as const

/**
 * The colour tools read, and write nothing to disk, but `copy: true` puts
 * their card on the user's clipboard. That changes something, so they are
 * not marked read-only; it is only ever asked for, and the same call gives
 * the same card, so they are not destructive and are idempotent.
 */
const COPIES = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

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
 * Forge's MCP server, with eleven tools on purpose. A 57-tool ImageMagick server
 * is the cautionary example of flooding an agent's context (spec §3.5). The
 * three colour tools earn their place the way `forge_probe` does: they
 * write no file, are small, and answer a question an agent cannot answer
 * by looking at a file (colour spec §7.2). `forge_card` is the way back: colours the agent
 * was given in words, out as a card Figma pastes. Transcribe and read text
 * hear and read what an agent cannot, on this computer. Tools call core
 * in-process; nothing spawns the CLI.
 */
export function createForgeServer(
  deps: {
    clip?: ClipDeps /** Where a link's transcript goes: Forge's default folder. */
    folder?: string
  } = {},
): McpServer {
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
        'Convert files to another format, beside each source unless output is given. A PDF becomes one image per page (choose pages and dpi); Word documents become PDF; images convert between formats; with trim, crop (to a shape such as 1:1, keeping the subject) or resize they keep their format unless `to` is given. Use it to open a format you cannot read (HEIC, camera RAW, Word): convert to PNG, JPEG or PDF. Returns every output path and a file:// link to each.',
      inputSchema: ConvertInput,
      outputSchema: RunOutput,
      annotations: WRITES,
    },
    (args, ctx) => convertTool(args, ctx.mcpReq.signal),
  )

  server.registerTool(
    'forge_compress',
    {
      title: 'Compress files',
      description:
        'Make files smaller without changing their format: by quality (1-100) or to fit a size such as "500kb" — use maxSize when an upload, email or form has a size limit. Writes <name>-small.<ext> beside the source unless output is given. PNG and GIF are cut to fewer colours. A result no smaller than the source is never written (error code cannot-compress-more).',
      inputSchema: CompressInput,
      outputSchema: RunOutput,
      annotations: WRITES,
    },
    (args) => compressTool(args),
  )

  server.registerTool(
    'forge_clip',
    {
      title: 'Compress the copied image',
      description:
        'The image on the clipboard, made smaller (quality or maxSize) or converted (to), and put back on the clipboard, so the next paste is the result. The result is also kept as a file, linked. A newer copy is never overwritten: if something else was copied meanwhile, the result goes to the default folder instead. A compression that would come out larger is refused. undo: true puts the last original back.',
      inputSchema: ClipInput,
      outputSchema: ClipOutput,
      annotations: { ...WRITES, destructiveHint: true },
    },
    (args) => clipTool(args, deps.clip),
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

  server.registerTool(
    'forge_palette',
    {
      title: 'Colours of an image',
      description:
        "An image's main colours, most of the image first, each as hex, rgb and OKLCH with its share. With inside, the shades that one colour is made of. svg: true also returns them as an SVG card of swatches; copy: true puts that card on the user's clipboard to paste into Figma. Writes no file.",
      inputSchema: PaletteInput,
      outputSchema: PaletteOutput,
      annotations: COPIES,
    },
    (args) => paletteTool(args, deps.clip),
  )

  server.registerTool(
    'forge_scale',
    {
      title: 'Tonal scale',
      description:
        "A 50–950 tonal scale built in OKLCH with the given colour at 500, each step with its contrast against white and black text. svg: true also returns it as an SVG card of swatches; copy: true puts that card on the user's clipboard to paste into Figma. Writes no file.",
      inputSchema: ScaleInput,
      outputSchema: ScaleOutput,
      annotations: COPIES,
    },
    (args) => scaleTool(args, deps.clip),
  )

  server.registerTool(
    'forge_card',
    {
      title: 'Colour card for Figma',
      description:
        "Named colours drawn as an SVG card of swatches, returned as text. Paste into Figma, it is one layer per colour, named as given, with its exact fill. copy: true puts it on the user's clipboard instead of returning it, so they can press ⌘V (Ctrl+V) in Figma straight away. Use it to turn a colour system written in words into something the user can paste. Writes no file.",
      inputSchema: CardInput,
      annotations: COPIES,
    },
    (args) => cardTool(args, deps.clip),
  )

  server.registerTool(
    'forge_transcribe',
    {
      title: 'Transcribe a recording',
      description:
        'What is said in a video or sound file, or a YouTube link, on this computer: a summary and notes (where Apple Intelligence is on) and the transcript. Use it whenever you need to know what a recording, meeting, lecture or video says, since you cannot listen to it. Writes a Markdown file beside the source (Word, PDF or text with format) and returns its text. A long recording takes minutes; progress says how far it has heard. Nothing is overwritten unless overwrite: true.',
      inputSchema: TranscribeInput,
      annotations: { ...WRITES, openWorldHint: true },
    },
    (args, ctx) =>
      transcribeTool(args, progressOf(ctx), { ...(deps.folder ? { folder: deps.folder } : {}) }),
  )

  server.registerTool(
    'forge_read_text',
    {
      title: 'Read the text in a picture or PDF',
      description:
        "The text in a picture, screenshot, scan, photo of a page or whiteboard, or PDF, read on this computer, with headings, lists and tables kept, in Latin, Cyrillic, Chinese, Japanese, Korean, Arabic, Devanagari or Thai script. Use it when you cannot read an image's text yourself or a PDF is scanned. Writes a Markdown file beside it (Word, PDF or text with format) and returns its text. Nothing is overwritten unless overwrite: true.",
      inputSchema: ReadTextInput,
      annotations: WRITES,
    },
    (args, ctx) => readTextTool(args, progressOf(ctx)),
  )

  return server
}

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
