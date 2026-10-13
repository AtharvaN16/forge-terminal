import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { invalidArguments } from '../core/errors.js'
import { VERSION } from '../shell/theme.js'
import {
  CompressInput,
  ConvertInput,
  FormatsInput,
  FormatsOutput,
  PaletteInput,
  PaletteOutput,
  PdfInput,
  ProbeInput,
  ProbeOutput,
  RunOutput,
  ScaleInput,
  ScaleOutput,
} from './schemas.js'
import { claimStdout } from './stdout-guard.js'
import {
  compressTool,
  convertTool,
  formatsTool,
  paletteTool,
  pdfTool,
  probeTool,
  scaleTool,
} from './tools.js'

/** What a client tells its model about Forge as a whole. */
export function instructionsFor(platform: NodeJS.Platform = process.platform): string {
  return [
    `Forge converts, compresses and edits files on this ${platform === 'win32' ? 'PC' : 'Mac'}, locally.`,
    'Every path must be absolute.',
    'Call forge_probe first: it says what a file is, every format it can become, and every action that applies.',
    'Nothing is overwritten unless you pass overwrite: true — only do that when the user asked to replace a file.',
    'A failure hint that mentions --force means overwrite: true here; --output means the output argument; --password-stdin means the password argument.',
  ].join(' ')
}

/** What a client tells its model about Forge as a whole, on this machine. */
export const INSTRUCTIONS = instructionsFor()

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
 * Forge's MCP server, with seven tools on purpose. A 57-tool ImageMagick server
 * is the cautionary example of flooding an agent's context (spec §3.5). The
 * two colour tools earn their place the way `forge_probe` does: read-only,
 * small, and answering a question an agent cannot answer by looking at a
 * file (colour spec §7.2). Tools call core in-process; nothing spawns the CLI.
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
        'Convert files to another format, beside each source unless output is given. A PDF becomes one image per page (choose pages and dpi); Word documents become PDF; images convert between formats; with trim, crop (to a shape such as 1:1, keeping the subject) or resize they keep their format unless `to` is given. Returns every output path and a file:// link to each.',
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

  server.registerTool(
    'forge_palette',
    {
      title: 'Colours of an image',
      description:
        "An image's main colours, most of the image first, each as hex, rgb and OKLCH with its share. With inside, the shades that one colour is made of. Writes nothing.",
      inputSchema: PaletteInput,
      outputSchema: PaletteOutput,
      annotations: READS,
    },
    (args) => paletteTool(args),
  )

  server.registerTool(
    'forge_scale',
    {
      title: 'Tonal scale',
      description:
        'A 50–950 tonal scale built in OKLCH with the given colour at 500, each step with its contrast against white and black text. Writes nothing.',
      inputSchema: ScaleInput,
      outputSchema: ScaleOutput,
      annotations: READS,
    },
    (args) => scaleTool(args),
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
