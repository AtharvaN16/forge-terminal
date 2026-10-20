/**
 * Serves mockups/ on 127.0.0.1 and keeps what the pages' feedback buttons
 * say, so a design session can read the verdicts back:
 *
 *   GET  /feedback/<page>   → mockups/feedback/<page>.json, or {}
 *   POST /feedback/<page>   ← the page's whole answer, as JSON
 *
 *   node scripts/mockup-feedback-server.mjs     (PORT, default 8766)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'

const root = path.resolve('mockups')
const store = path.join(root, 'feedback')
const port = Number(process.env.PORT || 8766)
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
}

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const feedback = url.pathname.match(/^\/feedback\/([a-z0-9-]+)$/)
    if (feedback) {
      const file = path.join(store, `${feedback[1]}.json`)
      if (req.method === 'GET') {
        return send(res, 200, await readFile(file, 'utf8').catch(() => '{}'))
      }
      if (req.method === 'POST') {
        let body = ''
        for await (const chunk of req) body += chunk
        try {
          const answer = { ...JSON.parse(body), savedAt: new Date().toISOString() }
          await mkdir(store, { recursive: true })
          await writeFile(file, `${JSON.stringify(answer, null, 2)}\n`)
          return send(res, 200, '{"ok":true}')
        } catch {
          return send(res, 400, '{"ok":false}')
        }
      }
      return send(res, 405, '{}')
    }
    const file = path.join(root, decodeURIComponent(url.pathname))
    if (!file.startsWith(root + path.sep)) return send(res, 403, 'no', 'text/plain')
    try {
      const data = await readFile(file)
      send(res, 200, data, TYPES[path.extname(file)] ?? 'application/octet-stream')
    } catch {
      send(res, 404, 'not found', 'text/plain')
    }
  })
  .listen(port, '127.0.0.1', () => console.log(`mockups on http://127.0.0.1:${port}/`))
