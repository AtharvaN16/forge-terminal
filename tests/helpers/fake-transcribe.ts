import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeTempDir } from './fixtures.js'

/**
 * A stand-in for the Swift helper (spec 2026-10-17-transcribe-design §4.1):
 * a node script that answers each command with the JSON lines given here.
 * `run` also writes its argv to `argv.json` beside it, so a test can see what
 * was asked for. Point FORGE_TRANSCRIBE_HELPER at the returned path.
 */
export async function fakeTranscribeHelper(
  answers: Partial<
    Record<'status' | 'probe' | 'run', { lines: object[]; exit?: number; hang?: boolean }>
  >,
): Promise<{ path: string; dir: string }> {
  const dir = await makeTempDir()
  const path = join(dir, 'forge-transcribe')
  const script = `#!${process.execPath}
const fs = require('node:fs')
const answers = ${JSON.stringify(answers)}
const cmd = process.argv[2]
fs.writeFileSync(${JSON.stringify(join(dir, 'argv.json'))}, JSON.stringify(process.argv.slice(2)))
const a = answers[cmd] ?? { lines: [{ ok: false, code: 'usage', message: 'no answer' }], exit: 1 }
for (const line of a.lines) process.stdout.write(JSON.stringify(line) + '\\n')
if (a.hang) setInterval(() => {}, 1000)
else process.exitCode = a.exit ?? 0
`
  await writeFile(path, script)
  await chmod(path, 0o755)
  return { path, dir }
}
