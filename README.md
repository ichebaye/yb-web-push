# yb-web-push

Minimal test rig for one question: **can an iOS web push notification hand off
the tap to Yandex Browser via its deep-link URL scheme, instead of opening in
Safari / the installed PWA?**

This is not a product — it's diagnostic scaffolding. It logs every step to
the server (via `POST /api/log`) because the moment a foreign browser opens,
the PWA's own JS context (and any attached debugger) is gone.

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

So the app tests multiple code paths and logs which one actually fires.

## How it works

1. **`public/`** is a standard installable PWA (manifest + service worker).
   Web Push on iOS only works after "Add to Home Screen" (iOS 16.4+).
2. `POST /api/send` sends a real Web Push message (VAPID, via `web-push`)
   with a JSON payload: `{ title, body, url, useYandexDeepLink, deepLink, mode }`.
3. `public/sw.js`:
   - `push` → shows the notification, logs the payload.
   - `notificationclick` → two selectable modes:
     - **`direct`**: calls `clients.openWindow(deepLink)` straight away —
       tests whether WebKit's openWindow accepts a custom scheme at all.
     - **`redirect`** (default, more realistic): opens `/redirect.html?...`,
       an ordinary https page (which `openWindow` definitely supports), which
       then does the classic "try custom scheme, fall back after a timer"
       trick from plain page JS.
4. **`public/redirect.js`** sets `location.href = deepLink`, watches for
   `visibilitychange`/`blur`/`pagehide` (a sign the app actually backgrounded,
   i.e. Yandex Browser opened), and if nothing happened within ~1.8s, falls
   back to `location.href = targetUrl` (plain https). It also renders two
   plain `<a href>` buttons so you can manually tap the deep link — isolating
   "scheme unsupported" from "programmatic navigation blocked, user tap would
   have worked".
5. Every step posts to `/api/log`; the main page polls `/api/logs` and shows
   a live feed, so you can watch what happened on the phone from any device.

The Yandex deep-link **format is a field in the UI**
(`yandexbrowser-open-url://{url}` by default) — it's not officially
documented, so the form lets you try variants without redeploying.

## Running it

```bash
npm install
npm start        # http://localhost:3000
```

VAPID keys are generated on first run into `data/vapid.json` (gitignored —
don't commit it, and don't regenerate it once you have real subscribers, or
they'll all need to resubscribe). Subscriptions persist in `data/subscriptions.json`.

### iOS requires real HTTPS

Web Push + "Add to Home Screen" won't work against `localhost` from an
iPhone. Expose the dev server over HTTPS, e.g.:

```bash
npx localtunnel --port 3000
# or: cloudflared tunnel --url http://localhost:3000
# or: ngrok http 3000
```

### On the iPhone

1. Open the HTTPS tunnel URL in **Safari**.
2. Share → **Add to Home Screen**.
3. Launch the app **from the Home Screen icon** (not Safari) — `PushManager`
   only exists in that context on iOS.
4. Tap **"Подписаться на push"**, allow notifications.
5. Fill in the test form (target URL, deep-link template, mode) and tap
   **"Отправить себе push"**.
6. Background the app (or lock the phone), wait for the notification, tap it.
7. Reopen the PWA and check the log feed at the bottom of the page for what
   actually happened (`openWindow-direct-result`, `deep-link-app-switch-detected`,
   `deep-link-fallback-triggered`, etc.).

## Expected outcomes (to record, not assumed)

- If nothing in the log after `notificationclick`/`redirect-page-loaded`
  changes and it always falls back → custom scheme navigation is blocked
  outright in this context.
- If the manual `<a href>` tap in `redirect.html` opens Yandex Browser but
  the automatic `location.href` attempt doesn't → it's a user-gesture
  restriction, not a scheme-support restriction (in which case a fully
  automatic hand-off isn't achievable this way, only a "confirm" tap is).
- If even the manual tap doesn't open Yandex Browser → iOS Safari isn't
  honoring the `yandexbrowser-open-url://` scheme in this context at all
  (worth double-checking the scheme string itself, and whether Yandex
  Browser is actually installed on the test device).
