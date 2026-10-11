import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RunJson } from '../../src/core/report-data.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'
import { runForge } from '../helpers/run-forge.js'

const tsx = join(process.cwd(), 'node_modules', '.bin', 'tsx')
const entry = join(process.cwd(), 'src', 'index.ts')

interface RpcMessage {
  jsonrpc?: string
  id?: number
  result?: { protocolVersion?: string; isError?: boolean; structuredContent?: RunJson }
}

async function waitFor<T>(find: () => T | undefined, timeoutMs = 15_000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const found = find()
    if (found !== undefined) return found
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for the server')
    await new Promise((r) => setTimeout(r, 20))
  }
}

function startMcp() {
  const child = spawn(tsx, [entry, 'mcp'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const lines: string[] = []
  let partial = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    partial += chunk
    let nl = partial.indexOf('\n')
    while (nl !== -1) {
      lines.push(partial.slice(0, nl))
      partial = partial.slice(nl + 1)
      nl = partial.indexOf('\n')
    }
  })
  child.stderr.resume()
  const exited = new Promise<number | null>((resolve) => child.on('close', resolve))
  const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`)
  const response = (id: number) =>
    waitFor(() => lines.map((l) => JSON.parse(l) as RpcMessage).find((m) => m.id === id))
  return { child, lines, send, response, exited, unterminated: () => partial }
}

describe('forge mcp over stdio', () => {
  it('speaks only protocol on stdout, converts a file, and exits when stdin closes', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    const mcp = startMcp()

    mcp.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 't', version: '0' },
      },
    })
    expect((await mcp.response(1)).result?.protocolVersion).toBe('2025-11-25')
    mcp.send({ jsonrpc: '2.0', method: 'notifications/initialized' })

    mcp.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'forge_convert', arguments: { paths: [jpg], to: 'webp' } },
    })
    const call = await mcp.response(2)
    expect(call.result?.isError).toBeFalsy()
    expect(call.result?.structuredContent?.results[0]?.outputs).toEqual([join(dir, 'a.webp')])

    mcp.child.stdin.end()
    const code = await Promise.race([
      mcp.exited,
      new Promise<'hung'>((r) => setTimeout(() => r('hung'), 10_000)),
    ])
    expect(code).toBe(0)

    // Nothing but protocol messages reached stdout (spec §5).
    for (const line of mcp.lines) expect(JSON.parse(line)).toMatchObject({ jsonrpc: '2.0' })
    expect(mcp.unterminated()).toBe('')
  })

  it('refuses arguments with exit 2', async () => {
    const run = await runForge(['mcp', '--port', '3000'])
    expect(run.exitCode).toBe(2)
    expect(run.stderr).toContain('takes no arguments')
    expect(run.stdout).toBe('')
  })
})
