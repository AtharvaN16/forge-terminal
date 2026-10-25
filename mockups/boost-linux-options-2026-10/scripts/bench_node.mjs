// ms per tile with the onnxruntime-node Forge ships (1.23.2), CPU provider only
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const require = createRequire('/Users/atharvanayak/Developer/Convert Terminal/.claude/worktrees/boost-linux/package.json')
const ort = require('onnxruntime-node')
const [path, tile, threads] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4])]
const s = await ort.InferenceSession.create(path, { executionProviders: ['cpu'], intraOpNumThreads: threads, interOpNumThreads: 1, graphOptimizationLevel: 'all', logSeverityLevel: 3 })
const x = new Float32Array(3 * tile * tile).map((_, i) => ((i * 2654435761) % 255) / 255)
const feeds = { [s.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, tile, tile]) }
await s.run(feeds)
const ts = []
for (let i = 0; i < 5; i++) { const t = performance.now(); await s.run(feeds); ts.push(performance.now() - t) }
ts.sort((a, b) => a - b)
console.log(`${path.split('/').pop()} tile ${tile} threads ${threads}: median ${Math.round(ts[2])} ms/tile  rss ${Math.round(process.memoryUsage().rss / 1048576)} MB`)
