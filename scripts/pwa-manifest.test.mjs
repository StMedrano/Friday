import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
const manifest=JSON.parse(await readFile(new URL('../public/manifest.webmanifest',import.meta.url),'utf8'))
const html=await readFile(new URL('../index.html',import.meta.url),'utf8')
const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'))
test('PWA manifest has installable standalone root, themed launcher and raster fallbacks',()=>{
 assert.equal(manifest.id,'/')
 assert.equal(manifest.start_url,'/')
 assert.equal(manifest.scope,'/')
 assert.equal(manifest.display,'standalone')
 assert.equal(manifest.short_name,'FRIDAY')
 assert.equal(manifest.background_color,manifest.theme_color)
 const png=manifest.icons.filter(x=>x.type==='image/png')
 for(const size of [192,512]){
  assert.ok(png.some(x=>x.sizes===`${size}x${size}`&&
   x.src===`/icons/friday-${size}.png`&&x.purpose.includes('maskable')))
 }
 assert.match(html,/rel="manifest" href="\/manifest\.webmanifest"/)
 // Cloudflare Access only lets the manifest through with the session cookie.
 assert.match(html,/rel="manifest" href="\/manifest\.webmanifest" crossorigin="use-credentials"/)
 assert.match(html,/rel="apple-touch-icon" href="\/icons\/friday-180\.png"/)
 assert.match(html,/name="apple-mobile-web-app-capable"/)
 assert.match(pkg.scripts.build,/build-pwa-icons\.mjs/)
})
