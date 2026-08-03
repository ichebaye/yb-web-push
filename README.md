# yb-web-push

Minimal test rig for one question: **can an iOS push notification hand off the
tap to Yandex Browser via its deep-link URL scheme, instead of opening in
Safari / the installed PWA?**

This is not a product — it's diagnostic scaffolding. The site is fully static
(runs on **GitHub Pages**, no backend), and real push messages are sent by a
one-off CLI command from your laptop. Nothing is hosted, deployed, or left
running to send a push.

## Why this is genuinely uncertain

- Apple's [Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/)
  is built around a `navigate` URL that the browser opens itself. The
  [WebKit explainer](https://github.com/WebKit/explainers/blob/main/DeclarativeWebPush/README.md)
  frames it as *"Navigating the user agent to HTTP URLs is the native language
  of the web platform"* — custom schemes are not mentioned, and declarative
  notifications *"always skip the `notificationclick` handler"*, so there is no
  JS hook at all on the declarative path.
- `clients.openWindow()` inside a service worker has documented bugs on iOS
  even for plain same-origin paths (see Apple dev forum threads on
  "Issue with PWA Push Notifications: Unable to Redirect to Specified URL on iOS").
- Whether WebKit permits `clients.openWindow('yandexbrowser-open-url://…')` at
  all, and whether a **programmatic** `location.href = 'yandexbrowser-open-url://…'`
  (as opposed to a direct user tap on an `<a href>`) is honored, are both
  unconfirmed — iOS often restricts custom-scheme navigation to synchronous
  user gestures.

So the app exercises multiple code paths and logs which one actually fires.

## The two payload types it can send

**Declarative** (`web_push: 8030`) — the browser shows the notification and, on
tap, navigates to `navigate` with no JS involved. Since there is no
`notificationclick` hook, the only possible place to attempt a scheme switch is
the landing page. So `navigate` is pointed at `redirect.html`, which then tries
the deep link. This is the only architecture the declarative model allows.

**Classic** — the payload is parsed by the service worker's `push` handler, and
the tap is caught by `notificationclick`, which can either open `redirect.html`
or call `clients.openWindow(deepLink)` directly.

Running both and comparing the logs is the actual experiment.

## Why sending from the browser isn't possible

It would be nicer to send the push from the PWA itself and never touch a
laptop, but push endpoints don't serve CORS headers — Firefox's is the only one
that does, and Apple's `web.push.apple.com` can't be called from browser JS.
The only workaround is a CORS proxy, which is exactly the backend this setup
avoids. Hence the one-off CLI command.

## How it works

1. **`public/`** is a standard installable PWA (manifest + service worker).
   On iOS, push requires "Add to Home Screen" (iOS 16.4+) — `PushManager` does
   not exist in a regular Safari tab.
2. The page subscribes with a VAPID public key you paste in, then renders a
   ready-to-run `npx web-push send-notification …` command with the endpoint,
   keys, and payload already substituted.
3. **`public/sw.js`**'s `notificationclick` handler supports three modes:
   - **`raw`**: open the URL verbatim (used if a declarative payload
     unexpectedly falls through to the worker).
   - **`direct`**: call `clients.openWindow(deepLink)` straight away — tests
     whether WebKit's `openWindow` accepts a custom scheme at all.
   - **`redirect`** (default): open `redirect.html`, an ordinary https page
     (which `openWindow` definitely supports), which then does the classic
     "try custom scheme, fall back after a timer" trick from plain page JS.
4. **`public/redirect.js`** sets `location.href = deepLink`, watches for
   `visibilitychange`/`blur`/`pagehide` (a sign the app actually backgrounded,
   i.e. Yandex Browser opened), and if nothing happened within ~1.8s, falls
   back to `location.href = targetUrl` (plain https). It also renders two plain
   `<a href>` buttons so you can manually tap the deep link — isolating "scheme
   unsupported" from "programmatic navigation blocked, user tap would have
   worked".
5. **`public/log.js`** is a tiny shared IndexedDB logger (loaded as a plain
   `<script>` on pages and via `importScripts()` in the service worker). Every
   step logs there instead of to a server, because once a foreign browser
   opens, the PWA's JS context (and any attached console) is gone — but
   IndexedDB persists and the log viewer reads it back next time you open the
   app.

The Yandex deep-link **format is a field in the UI**
(`yandexbrowser-open-url://{url}` by default) — it's not officially documented,
so the form lets you try variants without redeploying.

## Testing it

**On your laptop, once:**

```bash
npx web-push generate-vapid-keys
```

Keep the private key there — it never goes into the repo or the phone.

**On the iPhone:**

1. Open the Pages URL in **Safari**.
2. Share → **Add to Home Screen**.
3. Launch the app **from the Home Screen icon** (not Safari).
4. Paste the VAPID **public** key into the field in section 2, tap
   **«Подписаться»**, allow notifications.
5. Set the notification params (section 3) and pick a payload type (section 4).
6. Tap **«Поделиться (AirDrop)»** to send the generated command to your laptop.

**Back on the laptop:** paste the command, replace `ВСТАВЬ_СЮДА_PRIVATE_KEY`
with the private key, and run it. Then background the PWA (or lock the phone)
— on iOS `notificationclick` may not fire reliably while the app is in the
foreground — and tap the notification when it arrives.

**Then:** reopen the PWA and read the log at the bottom.

### Reading the log

- `push-received` present → WebKit did **not** treat the payload as
  declarative; it fell through to the classic service-worker path.
- `redirect-page-loaded` with no `push-received` and no `notificationclick` →
  the declarative path worked and the browser navigated on its own.
- `deep-link-app-switch-detected` → the app actually backgrounded, i.e. the
  scheme was honored and Yandex Browser opened.
- `deep-link-fallback-triggered` → nothing happened within the timeout, so it
  fell back to the plain https URL.

There's also a **local notification** button (section 5) that skips push
entirely — useful for iterating on the tap behavior alone. It's always the
classic path; the declarative one can't be reproduced without a real push.

## Expected outcomes (to record, not assumed)

- If the log always ends in a fallback with no app-switch detected → custom
  scheme navigation is blocked outright in this context.
- If the manual `<a href>` tap in `redirect.html` opens Yandex Browser but the
  automatic `location.href` attempt doesn't → it's a user-gesture restriction,
  not a scheme-support restriction (in which case a fully automatic hand-off
  isn't achievable this way, only a "confirm" tap is).
- If even the manual tap doesn't open Yandex Browser → iOS Safari isn't
  honoring the `yandexbrowser-open-url://` scheme in this context at all (worth
  double-checking the scheme string itself, and whether Yandex Browser is
  actually installed on the test device).

## Deploying

`.github/workflows/pages.yml` publishes `public/` via GitHub Actions on every
push to `main`. The repo's **Settings → Pages → Source** must be set to
**GitHub Actions** (not "Deploy from a branch"). All asset paths are relative,
so the app works under the `/yb-web-push/` project subpath.

### Local preview

```bash
npm run serve   # http-server on :3000
```

Service workers require `https://` or `http://localhost` — opening the files
via `file://` won't register `sw.js`.
