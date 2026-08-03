const els = {
  standalone: document.getElementById('st-standalone'),
  sw: document.getElementById('st-sw'),
  permission: document.getElementById('st-permission'),
  iosHint: document.getElementById('ios-hint'),
  log: document.getElementById('log'),
};

function pill(ok, text) {
  return `<span class="pill ${ok ? 'ok' : 'bad'}">${text}</span>`;
}

let swRegistration = null;

function refreshStatus() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  els.standalone.innerHTML = pill(isStandalone, isStandalone ? 'да' : 'нет');
  els.iosHint.style.display = isStandalone ? 'none' : 'block';

  const swOk = !!(swRegistration && swRegistration.active);
  els.sw.innerHTML = pill(swOk, swOk ? 'зарегистрирован' : 'нет');

  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  els.permission.innerHTML = pill(perm === 'granted', perm);
}

async function init() {
  if ('serviceWorker' in navigator) {
    swRegistration = await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
  }
  refreshStatus();
}

async function requestPermission() {
  if (!('Notification' in window)) return alert('Notification API недоступен в этом браузере');
  const permission = await Notification.requestPermission();
  refreshStatus();
  if (permission !== 'granted') alert('Разрешение на уведомления не выдано');
}

async function showTestNotification() {
  if (!swRegistration) return alert('Service worker не зарегистрирован');
  if (Notification.permission !== 'granted') return alert('Сначала запроси разрешение на уведомления');

  const title = document.getElementById('f-title').value;
  const body = document.getElementById('f-body').value;
  const url = document.getElementById('f-url').value;
  const deepLinkTemplate = document.getElementById('f-deeplink').value;
  const useYandexDeepLink = document.getElementById('f-use-deeplink').checked;
  const mode = document.getElementById('f-mode').value;

  const deepLink = useYandexDeepLink ? deepLinkTemplate.replace('{url}', url) : null;

  await addLog({ event: 'local-notification-requested', title, body, url, deepLink, mode });

  await swRegistration.showNotification(title, {
    body,
    icon: './icons/icon-192.png',
    badge: './icons/badge-96.png',
    data: { url, deepLink, useYandexDeepLink, mode },
  });
}

async function refreshLog() {
  const logs = await getLogs();
  els.log.innerHTML = logs
    .map(
      (l) => `<div class="log-entry"><span class="ts">${l.ts}</span> <span class="ev">${l.event}</span><br>${escapeHtml(JSON.stringify(l))}</div>`
    )
    .join('');
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

document.getElementById('btn-permission').addEventListener('click', () => requestPermission().catch((e) => alert(e.message)));
document.getElementById('btn-show').addEventListener('click', () => showTestNotification().catch((e) => alert(e.message)));
document.getElementById('btn-refresh-log').addEventListener('click', () => refreshLog());
document.getElementById('btn-clear-log').addEventListener('click', () => clearLogs().then(refreshLog));

init();
refreshLog();
setInterval(refreshLog, 3000);
