function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

const els = {
  standalone: document.getElementById('st-standalone'),
  sw: document.getElementById('st-sw'),
  permission: document.getElementById('st-permission'),
  sub: document.getElementById('st-sub'),
  iosHint: document.getElementById('ios-hint'),
  log: document.getElementById('log'),
  sendResult: document.getElementById('send-result'),
};

function pill(ok, text) {
  return `<span class="pill ${ok ? 'ok' : 'bad'}">${text}</span>`;
}

let swRegistration = null;

async function refreshStatus() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  els.standalone.innerHTML = pill(isStandalone, isStandalone ? 'да' : 'нет');
  els.iosHint.style.display = isStandalone ? 'none' : 'block';

  const swOk = !!(swRegistration && swRegistration.active);
  els.sw.innerHTML = pill(swOk, swOk ? 'зарегистрирован' : 'нет');

  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  els.permission.innerHTML = pill(perm === 'granted', perm);

  if (swRegistration && swRegistration.pushManager) {
    const sub = await swRegistration.pushManager.getSubscription();
    els.sub.innerHTML = sub ? pill(true, 'активна') : pill(false, 'нет');
  } else {
    els.sub.innerHTML = pill(false, 'PushManager недоступен');
  }
}

async function init() {
  if ('serviceWorker' in navigator) {
    swRegistration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  }
  await refreshStatus();
}

async function subscribe() {
  if (!swRegistration) return alert('Service worker не зарегистрирован');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    await refreshStatus();
    return alert('Разрешение на уведомления не выдано');
  }
  const { publicKey } = await fetch('/api/vapid-public-key').then((r) => r.json());
  const sub = await swRegistration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await fetch('/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub),
  });
  await refreshStatus();
}

async function unsubscribe() {
  if (!swRegistration) return;
  const sub = await swRegistration.pushManager.getSubscription();
  if (sub) {
    await fetch('/api/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    await sub.unsubscribe();
  }
  await refreshStatus();
}

async function sendTest() {
  const title = document.getElementById('f-title').value;
  const body = document.getElementById('f-body').value;
  const url = document.getElementById('f-url').value;
  const deepLinkTemplate = document.getElementById('f-deeplink').value;
  const useYandexDeepLink = document.getElementById('f-use-deeplink').checked;
  const mode = document.getElementById('f-mode').value;

  const deepLink = useYandexDeepLink ? deepLinkTemplate.replace('{url}', url) : null;

  const res = await fetch('/api/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body, url, useYandexDeepLink, deepLink, mode }),
  }).then((r) => r.json());

  els.sendResult.textContent = `sent: ${res.sent || 0}, failed: ${res.failed || 0}, error: ${res.error || '-'}`;
}

async function refreshLog() {
  const { logs } = await fetch('/api/logs').then((r) => r.json());
  els.log.innerHTML = logs
    .map(
      (l) =>
        `<div class="log-entry"><span class="ts">${l.receivedAt}</span> <span class="ev">${l.event}</span><br>${escapeHtml(
          JSON.stringify(l)
        )}</div>`
    )
    .join('');
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

document.getElementById('btn-subscribe').addEventListener('click', () => subscribe().catch((e) => alert(e.message)));
document.getElementById('btn-unsubscribe').addEventListener('click', () => unsubscribe().catch((e) => alert(e.message)));
document.getElementById('btn-send').addEventListener('click', () => sendTest().catch((e) => alert(e.message)));
document.getElementById('btn-refresh-log').addEventListener('click', () => refreshLog());
document.getElementById('btn-clear-log').addEventListener('click', () => fetch('/api/logs/clear', { method: 'POST' }).then(refreshLog));

init();
refreshLog();
setInterval(refreshLog, 3000);
