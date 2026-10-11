import { McpServer } from '@modelcontextprotocol/server'
import { VERSION } from '../shell/theme.js'
import {
  CompressInput,
  ConvertInput,
  FormatsInput,
  FormatsOutput,
  PdfInput,
  ProbeInput,
  ProbeOutput,
  RunOutput,
} from './schemas.js'
import { compressTool, convertTool, formatsTool, pdfTool, probeTool } from './tools.js'

/** What a client tells its model about Forge as a whole. */
export const INSTRUCTIONS = [
  'Forge converts, compresses and edits files on this Mac, locally.',
  'Every path must be absolute.',
  'Call forge_probe first: it says what a file is, every format it can become, and every action that applies.',
  'Nothing is overwritten unless you pass overwrite: true — only do that when the user asked to replace a file.',
  'A failure hint that mentions --force means overwrite: true here; --output means the output argument.',
].join(' ')

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
 * Forge's MCP server, with five tools on purpose. A 57-tool ImageMagick server
 * is the cautionary example of flooding an agent's context (spec §3.5). Tools
 * call core in-process; nothing here spawns the CLI.
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
        'Convert files to another format, beside each source unless output is given. A PDF becomes one image per page (choose pages and dpi); Word documents become PDF; images convert between formats. Returns every output path and a file:// link to each.',
      inputSchema: ConvertInput,
      outputSchema: RunOutput,
      annotations: WRITES,
    },
    (args) => convertTool(args),
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

  return server
}
