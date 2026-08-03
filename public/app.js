function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const els = {
  standalone: document.getElementById('st-standalone'),
  sw: document.getElementById('st-sw'),
  permission: document.getElementById('st-permission'),
  sub: document.getElementById('st-sub'),
  iosHint: document.getElementById('ios-hint'),
  subWrap: document.getElementById('sub-wrap'),
  subJson: document.getElementById('sub-json'),
  vapid: document.getElementById('f-vapid'),
  cmd: document.getElementById('cmd'),
  cmdNote: document.getElementById('cmd-note'),
  log: document.getElementById('log'),
};

const VAPID_STORAGE_KEY = 'ybwp-vapid-public-key';
const PRIVATE_KEY_PLACEHOLDER = 'ВСТАВЬ_СЮДА_PRIVATE_KEY';

let swRegistration = null;
let currentSubscription = null;

function pill(ok, text) {
  return `<span class="pill ${ok ? 'ok' : 'bad'}">${text}</span>`;
}

// Single-quote for a POSIX shell: close, escape, reopen.
function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function absoluteUrl(relative) {
  return new URL(relative, location.href).href;
}

function readForm() {
  const url = document.getElementById('f-url').value;
  const useDeepLink = document.getElementById('f-use-deeplink').checked;
  const deepLink = useDeepLink
    ? document.getElementById('f-deeplink').value.replace('{url}', url)
    : null;
  return {
    title: document.getElementById('f-title').value,
    body: document.getElementById('f-body').value,
    url,
    deepLink,
    useYandexDeepLink: useDeepLink,
    mode: document.getElementById('f-mode').value,
    payloadType: document.getElementById('f-payload-type').value,
  };
}

// The declarative payload has no JS hook at all: WebKit navigates straight to
// `navigate`, so the deep-link attempt has to live on the landing page.
function buildPayload(form) {
  if (form.payloadType === 'declarative') {
    const navigate = form.deepLink
      ? `${absoluteUrl('./redirect.html')}?url=${encodeURIComponent(form.url)}&deep=${encodeURIComponent(form.deepLink)}`
      : form.url;
    return JSON.stringify({
      web_push: 8030,
      notification: { title: form.title, body: form.body, navigate },
    });
  }
  return JSON.stringify({
    title: form.title,
    body: form.body,
    url: form.url,
    deepLink: form.deepLink,
    useYandexDeepLink: form.useYandexDeepLink,
    mode: form.mode,
  });
}

function buildCommand() {
  const form = readForm();
  const payload = buildPayload(form);
  const vapidPublic = els.vapid.value.trim();

  if (!currentSubscription) {
    els.cmd.textContent = 'Сначала подпишись на push (раздел 2) — из подписки берутся endpoint и ключи.';
    els.cmdNote.textContent = '';
    return;
  }

  const json = currentSubscription.toJSON();
  const lines = [
    'npx web-push send-notification',
    `  --endpoint=${shellQuote(json.endpoint)}`,
    `  --key=${shellQuote(json.keys.p256dh)}`,
    `  --auth=${shellQuote(json.keys.auth)}`,
    `  --vapid-subject=${shellQuote('mailto:test@example.com')}`,
    `  --vapid-pubkey=${shellQuote(vapidPublic)}`,
    `  --vapid-pvtkey=${shellQuote(PRIVATE_KEY_PLACEHOLDER)}`,
    `  --payload=${shellQuote(payload)}`,
  ];
  els.cmd.textContent = lines.join(' \\\n');
  els.cmdNote.textContent =
    form.payloadType === 'declarative'
      ? 'Декларативный payload: service worker участвовать не должен — если в логе появится push-received, значит формат не распознан.'
      : 'Классический payload: его разбирает push-обработчик в service worker, тап ловит notificationclick.';
}

async function refreshStatus() {
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  els.standalone.innerHTML = pill(isStandalone, isStandalone ? 'да' : 'нет');
  els.iosHint.style.display = isStandalone ? 'none' : 'block';

  const swOk = !!(swRegistration && swRegistration.active);
  els.sw.innerHTML = pill(swOk, swOk ? 'зарегистрирован' : 'нет');

  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  els.permission.innerHTML = pill(perm === 'granted', perm);

  if (swRegistration && swRegistration.pushManager) {
    currentSubscription = await swRegistration.pushManager.getSubscription();
    els.sub.innerHTML = currentSubscription ? pill(true, 'активна') : pill(false, 'нет');
  } else {
    currentSubscription = null;
    els.sub.innerHTML = pill(false, 'PushManager недоступен');
  }

  if (currentSubscription) {
    els.subWrap.style.display = 'block';
    els.subJson.textContent = JSON.stringify(currentSubscription.toJSON(), null, 2);
  } else {
    els.subWrap.style.display = 'none';
  }

  buildCommand();
}

async function subscribe() {
  if (!swRegistration) return alert('Service worker не зарегистрирован');
  if (!swRegistration.pushManager) {
    return alert('PushManager недоступен — запусти приложение с экрана «Домой», а не из Safari');
  }

  const vapidPublic = els.vapid.value.trim();
  if (!vapidPublic) return alert('Вставь VAPID public key (npx web-push generate-vapid-keys)');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    await refreshStatus();
    return alert('Разрешение на уведомления не выдано');
  }

  let applicationServerKey;
  try {
    applicationServerKey = urlBase64ToUint8Array(vapidPublic);
  } catch {
    return alert('Не удалось разобрать VAPID public key — проверь, что скопирован целиком');
  }

  const existing = await swRegistration.pushManager.getSubscription();
  // A subscription is bound to the key it was created with, so a changed key
  // means the old one has to go first.
  if (existing) {
    const sameKey = arrayBufferToBase64Url(existing.options.applicationServerKey) === vapidPublic;
    if (sameKey) {
      localStorage.setItem(VAPID_STORAGE_KEY, vapidPublic);
      await refreshStatus();
      return;
    }
    await existing.unsubscribe();
  }

  currentSubscription = await swRegistration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });
  localStorage.setItem(VAPID_STORAGE_KEY, vapidPublic);
  await addLog({ event: 'subscribed', endpoint: currentSubscription.endpoint });
  await refreshStatus();
}

async function unsubscribe() {
  if (!swRegistration || !swRegistration.pushManager) return;
  const sub = await swRegistration.pushManager.getSubscription();
  if (sub) {
    await sub.unsubscribe();
    await addLog({ event: 'unsubscribed' });
  }
  await refreshStatus();
}

async function showLocalNotification() {
  if (!swRegistration) return alert('Service worker не зарегистрирован');
  if (Notification.permission !== 'granted') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return alert('Разрешение на уведомления не выдано');
    await refreshStatus();
  }

  const form = readForm();
  await addLog({ event: 'local-notification-requested', ...form });
  await swRegistration.showNotification(form.title, {
    body: form.body,
    icon: './icons/icon-192.png',
    badge: './icons/badge-96.png',
    data: {
      url: form.url,
      deepLink: form.deepLink,
      useYandexDeepLink: form.useYandexDeepLink,
      mode: form.mode,
    },
  });
}

async function copyCommand() {
  try {
    await navigator.clipboard.writeText(els.cmd.textContent);
    els.cmdNote.textContent = 'Команда скопирована.';
  } catch {
    els.cmdNote.textContent = 'Не удалось скопировать — выдели текст команды вручную.';
  }
}

async function shareCommand() {
  if (!navigator.share) return alert('navigator.share недоступен в этом браузере');
  try {
    await navigator.share({ title: 'web-push command', text: els.cmd.textContent });
  } catch {
    /* user cancelled the share sheet */
  }
}

async function refreshLog() {
  const logs = await getLogs();
  els.log.innerHTML = logs
    .map(
      (l) =>
        `<div class="log-entry"><span class="ts">${l.ts}</span> <span class="ev">${l.event}</span><br>${escapeHtml(JSON.stringify(l))}</div>`
    )
    .join('');
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

async function init() {
  els.vapid.value = localStorage.getItem(VAPID_STORAGE_KEY) || '';
  if ('serviceWorker' in navigator) {
    swRegistration = await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
  }
  await refreshStatus();
}

document.getElementById('btn-subscribe').addEventListener('click', () => subscribe().catch((e) => alert(e.message)));
document.getElementById('btn-unsubscribe').addEventListener('click', () => unsubscribe().catch((e) => alert(e.message)));
document.getElementById('btn-show').addEventListener('click', () => showLocalNotification().catch((e) => alert(e.message)));
document.getElementById('btn-copy-cmd').addEventListener('click', () => copyCommand());
document.getElementById('btn-share-cmd').addEventListener('click', () => shareCommand());
document.getElementById('btn-refresh-log').addEventListener('click', () => refreshLog());
document.getElementById('btn-clear-log').addEventListener('click', () => clearLogs().then(refreshLog));

for (const id of ['f-title', 'f-body', 'f-url', 'f-deeplink', 'f-use-deeplink', 'f-mode', 'f-payload-type', 'f-vapid']) {
  document.getElementById(id).addEventListener('input', buildCommand);
  document.getElementById(id).addEventListener('change', buildCommand);
}

init();
refreshLog();
setInterval(refreshLog, 3000);
