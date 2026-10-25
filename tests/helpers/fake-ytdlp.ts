import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeTempDir } from './fixtures.js'

export interface YtScenario {
  facts?: { title: string; uploader: string; duration: number; is_live: boolean }
  /** Byte progress lines, in order. */
  bytes?: [number, number][]
  /** An `ERROR:` line on stderr and exit 1, instead of the download. */
  error?: string
  /** With `error`: only until `--update` has run once. */
  fixedByUpdate?: boolean
  /** Print the facts, then wait to be killed. */
  hang?: boolean
}

/**
 * yt-dlp as the extension manager installs it (`<config>/forge/extensions/yt-dlp/<v>/yt-dlp`),
 * a node script that answers Forge's options the way the real one does
 * (checked against yt-dlp 2026.08.19). Each run appends its argv to `calls.jsonl`.
 * Points XDG_CONFIG_HOME at a fresh temp dir; returns it.
 */
export async function fakeYtDlp(scenario: YtScenario): Promise<{ home: string; calls: string }> {
  const home = await makeTempDir()
  process.env.XDG_CONFIG_HOME = home
  const base = join(home, 'forge', 'extensions', 'yt-dlp')
  const version = join(base, '2026.08.19')
  await mkdir(version, { recursive: true })
  const calls = join(home, 'calls.jsonl')
  const updated = join(home, 'updated')
  const script = `#!${process.execPath}
const fs = require('node:fs')
const s = ${JSON.stringify(scenario)}
const a = process.argv.slice(2)
if (a.includes('--version')) { console.log('2026.08.19'); process.exit(0) }
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(a) + '\\n')
if (a.includes('--update')) { fs.writeFileSync(${JSON.stringify(updated)}, ''); console.log('Updated yt-dlp'); process.exit(0) }
if (s.error && !(s.fixedByUpdate && fs.existsSync(${JSON.stringify(updated)}))) {
  process.stderr.write('ERROR: [youtube] jNQXAC9IVRw: ' + s.error + '\\n'); process.exit(1)
}
const facts = s.facts ?? { title: 'Me at the zoo', uploader: 'jawed', duration: 19, is_live: false }
console.log('forge-facts ' + JSON.stringify(facts))
// Waits to be killed, but never outlives the process that ran it: a test that
// ends mid-run would otherwise leave it behind for good (and CI waiting on it).
if (s.hang) {
  const parent = process.ppid
  setInterval(() => {
    try { process.kill(parent, 0) } catch { process.exit(0) }
    if (process.ppid !== parent) process.exit(0)
  }, 250)
}
else {
  for (const [d, t] of s.bytes ?? [[1024, 4096], [4096, 4096]]) console.log('forge-bytes ' + d + ' ' + t)
  const out = a[a.indexOf('-o') + 1].replace('%(ext)s', 'm4a')
  fs.writeFileSync(out, 'sound')
  console.log('forge-file ' + out)
}
`
  await writeFile(join(version, 'yt-dlp'), script)
  await chmod(join(version, 'yt-dlp'), 0o755)
  await writeFile(
    join(version, 'manifest.json'),
    JSON.stringify({
      id: 'yt-dlp',
      version: '2026.08.19',
      files: { 'yt-dlp': 'unchecked' },
      entry: 'yt-dlp',
      kind: 'exec',
    }),
  )
  await writeFile(join(base, 'current'), '2026.08.19\n')
  return { home, calls }
}
