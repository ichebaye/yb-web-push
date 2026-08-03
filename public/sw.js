// Minimal test service worker.
//
// The interesting part is notificationclick: on iOS, clients.openWindow() with a
// custom URL scheme is undocumented territory (declarative web push docs only
// cover http/https "navigate" targets). We log every step to IndexedDB (via
// log.js) rather than a server, because (a) this needs to work on static hosting
// like GitHub Pages, and (b) once a foreign browser takes over, the PWA's own JS
// context is gone and there's no console left to read.

importScripts('./log.js');

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Push', body: event.data ? event.data.text() : '' };
  }

  // Reaching this handler at all is a result in itself: a payload that WebKit
  // parsed as declarative is shown by the platform and never wakes the worker.
  // If one does land here, its fields live under `notification`, and `navigate`
  // already points at redirect.html — so it doubles as the click target.
  const wasDeclarative = data && data.web_push === 8030;
  const source = wasDeclarative ? data.notification || {} : data;

  const title = source.title || 'Test push';
  const options = {
    body: source.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/badge-96.png',
    data: {
      url: (wasDeclarative ? source.navigate : data.url) || './',
      deepLink: wasDeclarative ? null : data.deepLink || null,
      useYandexDeepLink: wasDeclarative ? false : !!data.useYandexDeepLink,
      // `navigate` is already a full redirect.html URL, so open it verbatim
      // instead of wrapping it in another redirect hop.
      mode: wasDeclarative ? 'raw' : data.mode || 'redirect',
    },
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      addLog({
        event: 'push-received',
        note: wasDeclarative
          ? 'declarative payload reached the SW — it was NOT handled declaratively'
          : 'classic payload handled by the service worker',
        data: options.data,
      }),
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {};
  event.notification.close();

  const targetUrl = data.url || './';
  const deepLink = data.useYandexDeepLink ? data.deepLink : null;

  const work = (async () => {
    await addLog({ event: 'notificationclick', mode: data.mode, targetUrl, deepLink });

    if (data.mode === 'raw') {
      try {
        const client = await clients.openWindow(targetUrl);
        await addLog({ event: 'openWindow-raw-result', opened: !!client, targetUrl });
      } catch (err) {
        await addLog({ event: 'openWindow-raw-error', message: String(err), targetUrl });
      }
      return;
    }

    if (data.mode === 'direct' && deepLink) {
      try {
        const client = await clients.openWindow(deepLink);
        await addLog({ event: 'openWindow-direct-result', opened: !!client, deepLink });
      } catch (err) {
        await addLog({ event: 'openWindow-direct-error', message: String(err), deepLink });
      }
      return;
    }

    const redirectUrl = new URL(
      `./redirect.html?url=${encodeURIComponent(targetUrl)}` +
        (deepLink ? `&deep=${encodeURIComponent(deepLink)}` : ''),
      self.registration.scope
    ).href;
    try {
      const client = await clients.openWindow(redirectUrl);
      await addLog({ event: 'openWindow-redirect-result', opened: !!client, redirectUrl });
    } catch (err) {
      await addLog({ event: 'openWindow-redirect-error', message: String(err), redirectUrl });
    }
  })();

  event.waitUntil(work);
});
