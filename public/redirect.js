const params = new URLSearchParams(location.search);
const targetUrl = params.get('url') || './';
const deepLink = params.get('deep'); // already encoded by the sender, decoded via URLSearchParams

const statusEl = document.getElementById('status-text');
const manualDeepEl = document.getElementById('manual-deep-link');
const manualFallbackEl = document.getElementById('manual-fallback');

manualFallbackEl.href = targetUrl;
if (deepLink) {
  manualDeepEl.href = deepLink;
  manualDeepEl.style.display = 'block';
}

addLog({ event: 'redirect-page-loaded', targetUrl, deepLink });

if (!deepLink) {
  statusEl.textContent = 'Переходим…';
  addLog({ event: 'redirect-no-deeplink-navigating', targetUrl }).finally(() => {
    location.href = targetUrl;
  });
} else {
  let settled = false;
  const FALLBACK_MS = 1800;

  const onHiddenOrBlur = () => {
    if (settled) return;
    settled = true;
    addLog({ event: 'deep-link-app-switch-detected', deepLink, targetUrl, via: document.hidden ? 'visibilitychange' : 'blur' });
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) onHiddenOrBlur();
  });
  window.addEventListener('pagehide', onHiddenOrBlur);
  window.addEventListener('blur', onHiddenOrBlur);

  statusEl.textContent = 'Пробуем открыть в Яндекс.Браузере…';
  addLog({ event: 'attempting-location-deeplink', deepLink });

  // Programmatic scheme navigation from page JS (not a direct tap) — iOS/WebKit
  // may silently ignore this even when a manual tap on the same href works.
  try {
    location.href = deepLink;
  } catch (err) {
    addLog({ event: 'location-deeplink-threw', message: String(err) });
  }

  setTimeout(() => {
    if (settled) return; // page was backgrounded -> assume Yandex Browser opened
    settled = true;
    statusEl.textContent = 'Не получилось — открываем обычную ссылку…';
    addLog({ event: 'deep-link-fallback-triggered', deepLink, targetUrl }).finally(() => {
      location.href = targetUrl;
    });
  }, FALLBACK_MS);
}
