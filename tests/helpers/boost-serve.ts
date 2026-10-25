import { spawn } from 'node:child_process'

/** What one `runner.mjs --serve` answered to a list of jobs. */
export interface Served {
  /** Each job's result line, in order. */
  results: Array<Record<string, unknown>>
  /** Each job's `[done, of]` counts, in order. */
  progress: Array<Array<[number, number]>>
  exitCode: number | null
  stderr: string
}

/**
 * Runs `jobs` (each the argv a one-file run would take) through one
 * `runner.mjs --serve`, the next sent only once the last has answered, as
 * Forge does, then closes its input and waits for it to exit.
 */
export function serveJobs(
  runner: string,
  jobs: string[][],
  env: NodeJS.ProcessEnv = process.env,
  /** Under the test's own 20 s, so a runner that never exits says how far it got. */
  timeoutMs = 15_000,
): Promise<Served> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runner, '--serve'], { env })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      const last = progress.at(-1)?.at(-1)
      reject(
        new Error(
          `runner.mjs --serve did not exit within ${timeoutMs} ms: answered ${results.length} of ${jobs.length} jobs` +
            `${last ? `, the next at tile ${last[0]} of ${last[1]}` : ', the next not started'}` +
            `${next > jobs.length ? ', its input closed' : ''}; stderr: ${stderr.trim() || '(none)'}`,
        ),
      )
    }, timeoutMs)
    const results: Array<Record<string, unknown>> = []
    const progress: Array<Array<[number, number]>> = [[]]
    let stderr = ''
    let pending = ''
    let next = 0
    const send = () => {
      const job = jobs[next++]
      if (job) child.stdin.write(`${JSON.stringify({ args: job })}\n`)
      else child.stdin.end()
    }
    child.stdout.setEncoding('utf8').on('data', (d: string) => {
      const lines = (pending + d).split('\n')
      pending = lines.pop() ?? ''
      for (const l of lines) {
        if (!l.startsWith('{')) continue
        const o = JSON.parse(l) as Record<string, unknown>
        if ('progress' in o) progress.at(-1)?.push([Number(o.progress), Number(o.of)])
        else if ('ok' in o) {
          results.push(o)
          progress.push([])
          send()
        }
      }
    })
    child.stderr.setEncoding('utf8').on('data', (d: string) => {
      stderr += d
    })
    child.on('error', reject)
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      resolve({ results, progress: progress.slice(0, results.length), exitCode, stderr })
    })
    send()
  })
}
