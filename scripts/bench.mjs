#!/usr/bin/env node
/**
 * Reproduces the lean-and-fast spec's §3 measurements against the package as
 * a user gets it: packed, installed globally into an empty prefix, run as
 * `forge`. Prints each against its target and exits 1 if any is missed.
 *
 * Run on demand and before a release. Never in the unit suite, where
 * wall-clock assertions would be flaky (spec §7).
 *
 *   node scripts/bench.mjs [--runs 11] [--shell-runs 11] [--batch-runs 3]
 *                          [--skip install,version,overhead,shell,batch]
 *                          [--no-build] [--prompt-marker ›] [--keep]
 *
 * Each figure is a median, after one discarded warm-up run. Acceptance needs
 * at least 11 samples per row: --batch-runs defaults to 3 (a batch takes
 * ~35 s), so for release acceptance run with --batch-runs 11. The sample photo
 * is `Test Images/test.png` converted by `sips`, byte-identical to the one
 * the spec's baseline was measured with (152,033 bytes, 2756×774). Installing
 * needs the npm registry, because sharp and pdfium are real dependencies.
 * The shell figure needs tmux (`brew install tmux`) and is skipped without it.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const ROOT = resolve(import.meta.dirname, '..')
const { values } = parseArgs({
  options: {
    runs: { type: 'string', default: '11' },
    'shell-runs': { type: 'string', default: '11' },
    'batch-runs': { type: 'string', default: '3' },
    skip: { type: 'string', default: '' },
    'no-build': { type: 'boolean', default: false },
    'prompt-marker': { type: 'string', default: '›' },
    keep: { type: 'boolean', default: false },
  },
})
const skip = new Set(values.skip.split(',').filter(Boolean))
const runs = Number(values.runs)
const shellRuns = Number(values['shell-runs'])
const batchRuns = Number(values['batch-runs'])
const marker = values['prompt-marker']

/** Spec §3. `baseline` is 0.1.0 as measured; `target` is the acceptance bar. */
const TARGETS = {
  install: { label: 'Global install', unit: 'MB', baseline: 188, target: 40 },
  version: { label: 'forge --version', unit: 'ms', baseline: 253, target: 60 },
  overhead: { label: 'Load overhead, image conversion', unit: 'ms', baseline: 230, target: 100 },
  shell: { label: 'Shell to first prompt, intro on', unit: 'ms', baseline: 968, target: 600 },
  batch: { label: '50 JPEGs, --max-size 50kb', unit: 's', baseline: 36, target: 12 },
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Median wall time of `n` spawned runs, after one discarded warm-up. */
function timed(n, cmd, args, opts = {}) {
  const samples = []
  for (let i = 0; i <= n; i++) {
    const start = process.hrtime.bigint()
    const r = spawnSync(cmd, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: opts.env ?? process.env,
      cwd: opts.cwd,
    })
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    if (r.status !== 0) {
      throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}\n${r.stderr?.toString()}`)
    }
    if (i > 0) samples.push(ms)
  }
  return median(samples)
}

/** Milliseconds from starting `command` in a fresh tmux pane to `marker` appearing in it. */
async function untilVisible(command) {
  const session = `forge-bench-${process.pid}-${Math.random().toString(36).slice(2, 7)}`
  const start = performance.now()
  execFileSync('tmux', ['new-session', '-d', '-s', session, '-x', '120', '-y', '40', command])
  try {
    while (performance.now() - start < 10_000) {
      const pane = spawnSync('tmux', ['capture-pane', '-p', '-t', session], { encoding: 'utf8' })
      if (pane.stdout.includes(marker)) return performance.now() - start
      await sleep(2)
    }
    throw new Error(`"${marker}" did not appear within 10 s: ${command}`)
  } finally {
    spawnSync('tmux', ['kill-session', '-t', session])
    await sleep(100)
  }
}

async function medianVisible(n, command) {
  const samples = []
  for (let i = 0; i <= n; i++) {
    const ms = await untilVisible(command)
    if (i > 0) samples.push(ms)
  }
  return median(samples)
}

const work = mkdtempSync(join(tmpdir(), 'forge-bench-'))
const results = {}
const notes = []

try {
  if (!values['no-build']) execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' })
  const [packed] = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--pack-destination', work], {
      cwd: ROOT,
      encoding: 'utf8',
    }),
  )
  const prefix = join(work, 'prefix')
  execFileSync(
    'npm',
    [
      'install',
      '--global',
      '--prefix',
      prefix,
      '--no-audit',
      '--no-fund',
      join(work, packed.filename),
    ],
    { stdio: 'inherit' },
  )
  const forge = join(prefix, 'bin', 'forge')
  const installed = join(prefix, 'lib', 'node_modules', 'forge-terminal')

  if (!skip.has('install')) {
    const kb = Number(execFileSync('du', ['-sk', prefix], { encoding: 'utf8' }).split('\t')[0])
    results.install = kb / 1024
  }

  if (!skip.has('version')) results.version = timed(runs, forge, ['--version'])

  const sample = join(work, 'sample.jpg')
  execFileSync(
    'sips',
    ['-s', 'format', 'jpeg', join(ROOT, 'Test Images', 'test.png'), '--out', sample],
    {
      stdio: 'ignore',
    },
  )

  if (!skip.has('overhead')) {
    // Forge's conversion minus the same Sharp pipeline run directly, from the
    // same installed Sharp, in a bare node process: what is left is Forge's
    // own load and plumbing.
    const out = join(work, 'overhead')
    mkdirSync(out)
    const forgeMs = timed(runs, forge, [
      sample,
      '--to',
      'webp',
      '-o',
      join(out, 'forge.webp'),
      '--force',
    ])
    const raw = join(work, 'raw-sharp.mjs')
    writeFileSync(
      raw,
      `import { createRequire } from 'node:module'
const require = createRequire(${JSON.stringify(join(installed, 'package.json'))})
const sharp = require('sharp')
await sharp(process.argv[2]).rotate().keepIccProfile().webp({ quality: 80 }).toFile(process.argv[3])
`,
    )
    const rawMs = timed(runs, process.execPath, [raw, sample, join(out, 'raw.webp')])
    results.overhead = forgeMs - rawMs
    notes.push(`overhead = forge ${forgeMs.toFixed(0)} ms − raw sharp ${rawMs.toFixed(0)} ms`)
  }

  if (!skip.has('shell')) {
    if (spawnSync('tmux', ['-V']).status !== 0) {
      notes.push('shell: skipped, tmux not found')
    } else {
      const xdg = join(work, 'xdg')
      mkdirSync(join(xdg, 'forge'), { recursive: true })
      writeFileSync(join(xdg, 'forge', 'config.json'), JSON.stringify({ theme: 'dark' }))
      const env = `env XDG_CONFIG_HOME='${xdg}' TERM=xterm-256color COLORTERM=truecolor`
      // tmux's own start-up is subtracted: a pane that prints the marker at
      // once measures what the harness itself costs.
      const calibration = await medianVisible(shellRuns, `printf 'ready${marker}\\n'; sleep 30`)
      const shell = await medianVisible(shellRuns, `${env} '${forge}'`)
      results.shell = shell - calibration
      notes.push(`shell = ${shell.toFixed(0)} ms − tmux calibration ${calibration.toFixed(0)} ms`)
    }
  }

  if (!skip.has('batch')) {
    const batch = join(work, 'batch')
    const out = join(work, 'batch-out')
    mkdirSync(batch)
    mkdirSync(out)
    for (let i = 1; i <= 50; i++)
      copyFileSync(sample, join(batch, `img${String(i).padStart(2, '0')}.jpg`))
    results.batch =
      timed(batchRuns, forge, [batch, '--max-size', '50kb', '-o', `${out}/`, '--force']) / 1000
  }
} finally {
  if (values.keep) console.log(`\nkept ${work}`)
  else rmSync(work, { recursive: true, force: true })
}

const SAMPLES = { version: runs, overhead: runs, shell: shellRuns, batch: batchRuns }
const cell = (v, unit) => `${unit === 's' ? v.toFixed(1) : v.toFixed(0)} ${unit}`.padStart(11)
let missed = 0
const short = []
console.log(
  `\n${'measure'.padEnd(34)}${'0.1.0'.padStart(11)}${'now'.padStart(11)}${'target'.padStart(11)}${'runs'.padStart(6)}`,
)
for (const [key, t] of Object.entries(TARGETS)) {
  const v = results[key]
  if (v === undefined) {
    console.log(`${t.label.padEnd(34)}${'skipped'.padStart(22)}`)
    continue
  }
  const ok = v <= t.target
  if (!ok) missed += 1
  const n = SAMPLES[key]
  if (n !== undefined && n < 11) short.push(key)
  console.log(
    `${t.label.padEnd(34)}${cell(t.baseline, t.unit)}${cell(v, t.unit)}${cell(t.target, t.unit)}${String(n ?? '-').padStart(6)}  ${ok ? 'ok' : 'MISSED'}`,
  )
}
for (const note of notes) console.log(`  ${note}`)
if (short.length > 0) {
  console.log(
    `Not acceptance-grade: ${short.join(', ')} used fewer than 11 runs. For release acceptance run with --batch-runs 11.`,
  )
}
process.exitCode = missed > 0 ? 1 : 0
