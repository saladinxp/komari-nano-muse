// Reverse proxies in front of the local Komari that reproduce two common misconfigurations.
//
// Default: forwards everything with the original Host but refuses WebSocket upgrades, like nginx
// without `proxy_set_header Upgrade / Connection`. The /api/clients socket fails; plain HTTP
// (including POST /api/rpc2) still works, so the theme's polling fallback takes over.
//
// --rewrite-host: forwards upgrades too but replaces Host with the upstream address, as nginx does
// by default (`Host $proxy_host`). Komari then rejects every /api request that carries an Origin
// not matching Host: the socket (403) and every browser POST, the admin login included. Komari
// itself is unusable like that; the theme can only point at the cause.
//
// Usage: node qa/komari/proxy.mjs [listen=127.0.0.1:25780] [upstream=127.0.0.1:25774] [--rewrite-host]
import http from 'node:http'
import net from 'node:net'

const args = process.argv.slice(2).filter(a => !a.startsWith('--'))
const rewriteHost = process.argv.includes('--rewrite-host')
const [lh, lp] = (args[0] || '127.0.0.1:25780').split(':')
const upstream = args[1] || '127.0.0.1:25774'
const [uh, up] = upstream.split(':')
const headersFor = req => (rewriteHost ? { ...req.headers, host: upstream } : req.headers)

const server = http.createServer((req, res) => {
  const r = http.request(
    { host: uh, port: +up, method: req.method, path: req.url, headers: headersFor(req) },
    ur => {
      res.writeHead(ur.statusCode, ur.headers)
      ur.pipe(res)
    },
  )
  r.on('error', () => {
    res.writeHead(502)
    res.end('bad gateway')
  })
  req.pipe(r)
})
server.on('upgrade', (req, sock, head) => {
  if (!rewriteHost) {
    sock.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n')
    return
  }
  const u = net.connect(+up, uh, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`]
    for (const [k, v] of Object.entries(headersFor(req))) lines.push(`${k}: ${v}`)
    u.write(lines.join('\r\n') + '\r\n\r\n')
    if (head && head.length) u.write(head)
    u.pipe(sock)
    sock.pipe(u)
  })
  u.on('error', () => sock.destroy())
  sock.on('error', () => u.destroy())
})
server.listen(+lp, lh, () =>
  console.log(
    `proxy ${lh}:${lp} → ${upstream} (${rewriteHost ? 'Host rewritten' : 'Host kept, upgrades refused'})`,
  ),
)
