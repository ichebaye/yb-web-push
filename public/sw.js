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

  const title = data.title || 'Test push';
  const options = {
    body: data.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/badge-96.png',
    data: {
      url: data.url || './',
      deepLink: data.deepLink || null,
      useYandexDeepLink: !!data.useYandexDeepLink,
      mode: data.mode || 'redirect',
    },
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      addLog({ event: 'push-received', data: options.data }),
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
