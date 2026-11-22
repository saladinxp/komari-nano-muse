// Node tag colours: Komari's "text<colour>" rule (komari-web PriceTags.tsx), from the TS source via Vite SSR.
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
try {
  const T = await server.ssrLoadModule('/src/utils/tags.ts')
  assert.deepEqual(T.parseTags('10Gbps<green>;2T<blue>'), [
    { text: '10Gbps', color: 'green' },
    { text: '2T', color: 'blue' },
  ])
  assert.deepEqual(T.parseTags(' Production ; NVMe;;'), [
    { text: 'Production', color: null },
    { text: 'NVMe', color: null },
  ])
  assert.deepEqual(T.parseTags('Beta<RED>'), [{ text: 'Beta', color: 'red' }], 'colour names ignore case')
  assert.deepEqual(T.parseTags('a<nope>'), [{ text: 'a<nope>', color: null }], 'unknown colour stays text')
  assert.deepEqual(T.parseTags('<green>'), [{ text: '<green>', color: null }], 'a colour alone stays text')
  assert.deepEqual(
    T.parseTags('x<green>y'),
    [{ text: 'x<green>y', color: null }],
    'only a trailing colour counts',
  )
  assert.deepEqual(
    T.parseTags('a,b，c；d'),
    ['a', 'b', 'c', 'd'].map(text => ({ text, color: null })),
  )
  assert.deepEqual(T.parseTags(null), [])
  assert.equal(Object.keys(T.TAG_COLORS).length, 26, 'the 26 Komari colour names')
  for (const [name, [l, d]] of Object.entries(T.TAG_COLORS))
    assert.ok(/^#[0-9a-f]{6}$/.test(l) && /^#[0-9a-f]{6}$/.test(d), name)
  assert.equal(T.tagStyle({ text: 'x', color: 'green' }), '--tag-light:#218358;--tag-dark:#3dd68c')
  assert.equal(T.tagStyle({ text: 'x', color: null }), '')
  console.log('Tags: Komari colour suffixes, case, unknown names, separators and styles passed.')
} finally {
  await server.close()
}
