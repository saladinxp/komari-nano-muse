// Build the installable theme ZIP: komari-theme.json + the cover at the root, the theme in dist/.
//
// The cover goes in twice: as preview.jpg and as preview-<version>.jpg, and the packaged manifest
// points at the versioned name. Komari serves theme files without cache headers under a fixed URL
// (/themes/NanoMuse/<preview>), so with one fixed name browsers and CDNs kept showing an old cover
// after an upgrade. A new file name per version means a new URL; the plain preview.jpg stays for
// anything that asks for it directly. The repo's komari-theme.json keeps "preview.jpg".
import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const manifest = JSON.parse(readFileSync('komari-theme.json', 'utf8'))
const { version } = manifest
const out = resolve(`release/nanomuse-${version}.zip`)
const stage = resolve(`release/.stage-${version}`)
const cover = `preview-${version}.jpg`

mkdirSync('release', { recursive: true })
rmSync(out, { force: true })
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
writeFileSync(`${stage}/komari-theme.json`, JSON.stringify({ ...manifest, preview: cover }, null, 2) + '\n')
copyFileSync('preview.jpg', `${stage}/preview.jpg`)
copyFileSync('preview.jpg', `${stage}/${cover}`)
cpSync('dist', `${stage}/dist`, { recursive: true })
execFileSync('zip', ['-qr', out, 'komari-theme.json', 'preview.jpg', cover, 'dist'], {
  cwd: stage,
  stdio: 'inherit',
})
rmSync(stage, { recursive: true, force: true })
console.log('Packaged', out, '· cover', cover)
