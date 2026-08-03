// Minimal test service worker.
//
// The interesting part is notificationclick: on iOS, clients.openWindow() with a
// custom URL scheme is undocumented territory (declarative web push docs only
// cover http/https "navigate" targets). We log every step to the server because
// once a foreign browser takes over, the PWA's own JS context is gone and there's
// no console left to read.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

function postLog(body) {
  return fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {});
}

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
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    data: {
      url: data.url || '/',
      deepLink: data.deepLink || null,
      useYandexDeepLink: !!data.useYandexDeepLink,
      mode: data.mode || 'redirect',
    },
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      postLog({ event: 'push-received', data: options.data }),
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {};
  event.notification.close();

  const targetUrl = data.url || '/';
  const deepLink = data.useYandexDeepLink ? data.deepLink : null;

  const work = (async () => {
    await postLog({ event: 'notificationclick', mode: data.mode, targetUrl, deepLink });

    if (data.mode === 'direct' && deepLink) {
      try {
        const client = await clients.openWindow(deepLink);
        await postLog({ event: 'openWindow-direct-result', opened: !!client, deepLink });
      } catch (err) {
        await postLog({ event: 'openWindow-direct-error', message: String(err), deepLink });
      }
      return;
    }

    const redirectUrl =
      `/redirect.html?url=${encodeURIComponent(targetUrl)}` +
      (deepLink ? `&deep=${encodeURIComponent(deepLink)}` : '');
    try {
      const client = await clients.openWindow(redirectUrl);
      await postLog({ event: 'openWindow-redirect-result', opened: !!client, redirectUrl });
    } catch (err) {
      await postLog({ event: 'openWindow-redirect-error', message: String(err), redirectUrl });
    }
  })();

  event.waitUntil(work);
});
