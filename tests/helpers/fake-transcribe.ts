import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeTempDir } from './fixtures.js'

/**
 * A stand-in for the Swift helper (spec 2026-10-17-transcribe-design §4.1):
 * a node script that answers each command with the JSON lines given here.
 * Every command writes its argv to `argv.json` beside it, so a test can see
 * what was asked for, and adds a line to `calls.log`, so it can count how
 * often; `echo` stands in for a command that writes a file.
 * Point FORGE_TRANSCRIBE_HELPER at the returned path. `whisper` makes it
 * the whisper helper's stand-in instead: a .mjs, run by Forge's own Node.
 */
export async function fakeTranscribeHelper(
  answers: Partial<
    Record<
      'status' | 'probe' | 'run' | 'render' | 'read',
      {
        lines: object[]
        exit?: number
        hang?: boolean
        /** Writes `prefix` + the file at argument `from` to the path at argument `to` (render). */
        echo?: { from: number; to: number; prefix: string }
      }
    >
  >,
  opts: { whisper?: boolean } = {},
): Promise<{ path: string; dir: string }> {
  const dir = await makeTempDir()
  // A script either way, run on Forge's own Node (Windows cannot run a #! file):
  // .mjs is whisper's, .cjs Apple's stand-in.
  const path = join(dir, opts.whisper ? 'forge-transcribe-whisper.mjs' : 'forge-transcribe.cjs')
  const script = `#!${process.execPath}
${opts.whisper ? "import fs from 'node:fs'" : "const fs = require('node:fs')"}
const answers = ${JSON.stringify(answers)}
const cmd = process.argv[2]
fs.writeFileSync(${JSON.stringify(join(dir, 'argv.json'))}, JSON.stringify(process.argv.slice(2)))
fs.appendFileSync(${JSON.stringify(join(dir, 'calls.log'))}, JSON.stringify(process.argv.slice(2)) + '\\n')
const a = answers[cmd] ?? { lines: [{ ok: false, code: 'usage', message: 'no answer' }], exit: 1 }
if (a.echo) {
  const args = process.argv.slice(2)
  fs.writeFileSync(args[a.echo.to], a.echo.prefix + fs.readFileSync(args[a.echo.from], 'utf8'))
}
for (const line of a.lines) process.stdout.write(JSON.stringify(line) + '\\n')
// Waits to be killed, but never outlives the process that ran it: a test that
// ends mid-run would otherwise leave it behind for good (and CI waiting on it).
if (a.hang) {
  const parent = process.ppid
  setInterval(() => {
    try { process.kill(parent, 0) } catch { process.exit(0) }
    if (process.ppid !== parent) process.exit(0)
  }, 250)
}
else process.exitCode = a.exit ?? 0
`
  await writeFile(path, script)
  await chmod(path, 0o755)
  return { path, dir }
}
