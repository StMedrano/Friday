# FRIDAY Progressive Web App

**Status:** Source-only candidate for installable FRIDAY on phones, tablets
and desktops. This is **not deployed to VM102**. Live browser acceptance
and secure-origin validation are required after the owner deploys.

## User experience

- Chromium on Android/desktop: visit `https://friday.mytechtactics.com`
  over HTTPS, complete the existing Cloudflare Access sign-in, then use
  the browser **Install app** prompt or menu **Install app / Add to Home
  screen**. Friday's own **Install app** control appears *only* when
  the browser actually provides the `beforeinstallprompt` event. If
  declined, the control disappears until the browser offers it again.
- iPhone/iPad Safari: open the HTTPS app in Safari, sign in, tap **Share**
  and **Add to Home Screen**. Safari does not support the same
  `beforeinstallprompt` flow; no fake install action is shown.
- Installs use the Friday icon, dark theme, safe-area-aware responsive
  existing dashboard and `standalone` browser display.
- Network loss: a **generic offline page** explains that operator
  authentication and live data are unavailable. No stale credentials,
  Tasks, Memory, monitoring, AI output or control surfaces are replayed.

## Build

`npm run build` first compiles TypeScript/Vite, then generates opaque
180, 192 and 512 pixel RGB PNG launcher icons into `dist/icons` using
the deterministic, dependency-free Node script
`scripts/build-pwa-icons.mjs`. This avoids binary assets, extra
dependencies, and dirty source checkout state. The committed manifest,
SVG favicon and worker in `public/` are copied to `dist/` by Vite.

The existing Node UI server serves `.webmanifest` with
`application/manifest+json`, and both the manifest and `/sw.js` with
no-cache response policy so clients can discover updates.

## Privacy and security policy

The worker is registered only for the **secure production origin**.
The worker is not a permission model: Cloudflare Access and Friday's
signed-token checks remain authoritative every time the app is online.

- All navigations are network-only and **never cached** (including
  successful Cloudflare login/SSO redirects).
- Every `/api/*`, `/cdn-cgi/*`, `/auth/*`, `/oauth/*`,
  `/login`, `/logout`, `/callback` and non-GET or cross-origin
  request bypasses service-worker interception/caching.
- Only same-origin **content-type validated, non-redirected, immutable
  hash-named Vite JS/CSS** may be cached. Any response with
  `Set-Cookie` is excluded.
- The network-failure fallback is built-in **generic HTML** in the
  worker, never a cached authorized dashboard or Access login screen.
- Old `friday-immutable-v*` caches are deleted on activation. Other
  apps' caches are preserved. Service-worker install/update neither
  calls privileged endpoints nor mutates server configuration.
- Friday's existing Memory and Tasks browser data remains ephemeral
  and follows preexisting application rules; PWA code does not create
  persistent API response caches.
- The PWA does **not** work as a standalone offline control plane.
  Phone connectivity, signed login and live API readiness are required
  for viewing data or any online action.

## Staging acceptance / verification

1. Run `make verify`; confirm all repository tests and the controller
   container build are green. Inspect `dist/manifest.webmanifest`,
   `dist/sw.js`, `dist/icons/friday-{180,192,512}.png`.
2. Serve over HTTPS from a staging origin behind the existing approved
   Access gate. In Chrome DevTools > Application, verify manifest,
   real 192/512 icons, installability, worker scope `/`, and standalone
   launch on desktop/Android; Safari Share > Add to Home Screen on iOS.
3. Inspect Cache Storage: **no** `/api/`, work/project memory, AI
   responses, credential headers, HTML, authenticated navigation or
   `/cdn-cgi/` login responses should appear. Static hashed bundles
   may be present. Check cache after logout/login as well.
4. In DevTools set network Offline: normal navigation shows only the
   generic "You are offline" page. Restore the network and verify a
   fresh Access/Friday API read (not stale cached data). Existing
   browser tab's PWA status indicator should show Offline.
5. Test update: deploy a new JS bundle in **staging**, refresh and
   confirm fresh navigation and service-worker refresh. Nothing should
   force-reload a busy operator session. Verify logout/authentication
   on Android and iOS and app reinstallability.
6. Review the Cloudflare Access application scope and appropriate
   TLS/mime/cache headers, plus desktop/mobile accessibility, before
   a **separately approved** VM102 deployment. This PR must not
   deploy or change production policy while the owner's deployment
   is underway.

## Recovery

PWA registration failures do not prevent the ordinary website loading.
To disable PWA behavior in a future reviewed release, remove the
registration, publish a deliberate safe uninstalling service worker
and clear only `friday-immutable-v*` caches. Merely deleting `sw.js`
does not unregister service workers that a browser already installed.

## Cloudflare Access and the manifest

Browsers fetch the web app manifest without cookies unless the link sets `crossorigin="use-credentials"`. Behind Cloudflare Access an uncredentialed manifest request is redirected to the Access login page, so Edge and Chrome report the app as not installable. `index.html` therefore requests the manifest with credentials.
