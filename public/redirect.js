const params = new URLSearchParams(location.search);
const targetUrl = params.get('url') || '/';
const deepLink = params.get('deep'); // already encoded by the sender, decode via URLSearchParams

const statusEl = document.getElementById('status-text');
const manualDeepEl = document.getElementById('manual-deep-link');
const manualFallbackEl = document.getElementById('manual-fallback');

manualFallbackEl.href = targetUrl;
if (deepLink) {
  manualDeepEl.href = deepLink;
  manualDeepEl.style.display = 'block';
}

function log(body) {
  return fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {});
}

log({ event: 'redirect-page-loaded', targetUrl, deepLink });

if (!deepLink) {
  statusEl.textContent = 'Переходим…';
  log({ event: 'redirect-no-deeplink-navigating', targetUrl }).finally(() => {
    location.href = targetUrl;
  });
} else {
  let settled = false;
  const FALLBACK_MS = 1800;

  const onHiddenOrBlur = () => {
    if (settled) return;
    settled = true;
    log({ event: 'deep-link-app-switch-detected', deepLink, targetUrl, via: document.hidden ? 'visibilitychange' : 'blur' });
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) onHiddenOrBlur();
  });
  window.addEventListener('pagehide', onHiddenOrBlur);
  window.addEventListener('blur', onHiddenOrBlur);

  statusEl.textContent = 'Пробуем открыть в Яндекс.Браузере…';
  log({ event: 'attempting-location-deeplink', deepLink });

  // Programmatic scheme navigation from page JS (not a direct tap) — iOS/WebKit
  // may silently ignore this even when a manual tap on the same href works.
  try {
    location.href = deepLink;
  } catch (err) {
    log({ event: 'location-deeplink-threw', message: String(err) });
  }

  setTimeout(() => {
    if (settled) return; // page was backgrounded -> assume Yandex Browser opened
    settled = true;
    statusEl.textContent = 'Не получилось — открываем обычную ссылку…';
    log({ event: 'deep-link-fallback-triggered', deepLink, targetUrl }).finally(() => {
      location.href = targetUrl;
    });
  }, FALLBACK_MS);
}
