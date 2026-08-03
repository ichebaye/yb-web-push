# yb-web-push

Minimal test rig for one question: **can an iOS PWA notification tap hand off
to Yandex Browser via its deep-link URL scheme, instead of opening in
Safari / the installed PWA?**

This is not a product — it's diagnostic scaffolding, and it's a fully static
site (no backend) so it can run straight from **GitHub Pages**.

## Why this is genuinely uncertain

- Apple's [declarative web push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)
  only documents `http(s)` "navigate" targets. Custom schemes aren't mentioned.
- `clients.openWindow()` inside a service worker has documented bugs on iOS
  even for plain same-origin paths (see Apple dev forum threads on
  "Issue with PWA Push Notifications: Unable to Redirect to Specified URL on iOS").
- Whether WebKit permits `clients.openWindow('yandexbrowser-open-url://…')` at
  all, and whether a **programmatic** `location.href = 'yandexbrowser-open-url://…'`
  (as opposed to a direct user tap on an `<a href>`) is honored, are both
  unconfirmed — iOS often restricts custom-scheme navigation to synchronous
  user gestures.

So the app exercises multiple code paths and logs which one actually fires.

## Why no server / no real remote push

Testing the interesting part — what happens when `notificationclick` fires —
doesn't require a real push message delivered over the network. A
`notificationclick` event fires the same way regardless of whether the
notification was shown by a `push` event or by a direct call to
`registration.showNotification()` from the page. So this app shows the test
notification **locally**, which means the whole thing is static files and can
run on GitHub Pages with no backend at all.

(If you later want to test genuine delivery while the PWA is fully closed —
i.e. actual remote Web Push over APNs — that needs a small VAPID-signing
server, which is a separate, larger step; ask if you want that added back.)

## How it works

1. **`public/`** is a standard installable PWA (manifest + service worker).
   On iOS, service-worker notifications only work after "Add to Home Screen"
   (this has worked since early iOS versions for locally-shown notifications;
   iOS 16.4+ additionally enables real remote Web Push, which this build
   doesn't use).
2. The main page (`index.html` / `app.js`) has a button that calls
   `registration.showNotification(title, { data: { url, deepLink, useYandexDeepLink, mode } })`
   directly — no server round trip.
3. **`public/sw.js`**'s `notificationclick` handler has two selectable modes:
   - **`direct`**: calls `clients.openWindow(deepLink)` straight away — tests
     whether WebKit's `openWindow` accepts a custom scheme at all.
   - **`redirect`** (default, more realistic): opens `/redirect.html`, an
     ordinary https page (which `openWindow` definitely supports), which then
     does the classic "try custom scheme, fall back after a timer" trick from
     plain page JS.
4. **`public/redirect.js`** sets `location.href = deepLink`, watches for
   `visibilitychange`/`blur`/`pagehide` (a sign the app actually backgrounded,
   i.e. Yandex Browser opened), and if nothing happened within ~1.8s, falls
   back to `location.href = targetUrl` (plain https). It also renders two
   plain `<a href>` buttons so you can manually tap the deep link — isolating
   "scheme unsupported" from "programmatic navigation blocked, user tap would
   have worked".
5. **`public/log.js`** is a tiny shared IndexedDB logger (loaded as a plain
   `<script>` on pages and via `importScripts()` in the service worker). Every
   step logs an entry there instead of to a server, because once a foreign
   browser opens, the PWA's JS context (and any attached console) is gone —
   but IndexedDB persists and the main page's log viewer reads it back next
   time you open the app.

The Yandex deep-link **format is a field in the UI**
(`yandexbrowser-open-url://{url}` by default) — it's not officially
documented, so the form lets you try variants without redeploying.

## Deploying to GitHub Pages

A workflow at `.github/workflows/pages.yml` publishes `public/` via GitHub
Actions on every push to `main` or `claude/pwa-yandex-push-ios-72iyfl`. One
manual, one-time step is required (can't be done from here): in the repo's
**Settings → Pages**, set **Source: GitHub Actions**. After that, pushes
auto-deploy to `https://<owner>.github.io/yb-web-push/`.

All asset paths in `public/` are relative (`./sw.js`, `./icons/...`, etc.) so
it works correctly under that `/yb-web-push/` subpath rather than assuming
the domain root.

### Local preview

```bash
npm run serve   # http-server on :3000, or open public/index.html via any static server
```

Note: service workers require either `https://` or `http://localhost` — a
plain `file://` open won't register `sw.js`.

### On the iPhone

1. Open the Pages URL in **Safari**.
2. Share → **Add to Home Screen**.
3. Launch the app **from the Home Screen icon** (not Safari).
4. Tap **"Запросить разрешение на уведомления"**, allow notifications.
5. Fill in the test form (target URL, deep-link template, mode) and tap
   **"Показать уведомление"**.
6. Background the app (or lock the phone) — on iOS, `notificationclick` may
   not fire reliably while the app is in the foreground — then tap the
   notification.
7. Reopen the PWA and check the log feed at the bottom of the page for what
   actually happened (`openWindow-direct-result`, `deep-link-app-switch-detected`,
   `deep-link-fallback-triggered`, etc.).

## Expected outcomes (to record, not assumed)

- If the log always ends in a fallback with no app-switch detected → custom
  scheme navigation is blocked outright in this context.
- If the manual `<a href>` tap in `redirect.html` opens Yandex Browser but
  the automatic `location.href` attempt doesn't → it's a user-gesture
  restriction, not a scheme-support restriction (in which case a fully
  automatic hand-off isn't achievable this way, only a "confirm" tap is).
- If even the manual tap doesn't open Yandex Browser → iOS Safari isn't
  honoring the `yandexbrowser-open-url://` scheme in this context at all
  (worth double-checking the scheme string itself, and whether Yandex
  Browser is actually installed on the test device).
