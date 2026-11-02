// Print each change of one node's live online state, as /api/clients reports it.
// Komari refuses WebSocket upgrades without a matching Origin (browsers always send one).
// Usage: node qa/komari/watch-online.mjs http://127.0.0.1:25774 <node uuid> <seconds>
const [base, uuid, secs = '60'] = process.argv.slice(2)
const ws = new WebSocket(base.replace(/^http/, 'ws') + '/api/clients', { headers: { Origin: base } })
let last = null
ws.onerror = e => console.log('error', e.message || e.type)
ws.onopen = () => setInterval(() => ws.send('get'), 1000)
ws.onmessage = e => {
  const m = JSON.parse(e.data),
    on = m.data.online.includes(uuid)
  if (on !== last) {
    const cpu = m.data.data[uuid] && m.data.data[uuid].cpu.usage
    console.log(new Date().toISOString().slice(11, 19), on ? 'online' : 'OFFLINE', 'cpu', cpu)
  }
  last = on
}
setTimeout(() => process.exit(0), +secs * 1000)
