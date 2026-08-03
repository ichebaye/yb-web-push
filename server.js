const fs = require('fs');
const path = require('path');
const express = require('express');
const webpush = require('web-push');

const DATA_DIR = path.join(__dirname, 'data');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
const SUBS_FILE = path.join(DATA_DIR, 'subscriptions.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let vapid = loadJson(VAPID_FILE, null);
if (!vapid) {
  const keys = webpush.generateVAPIDKeys();
  vapid = { publicKey: keys.publicKey, privateKey: keys.privateKey };
  saveJson(VAPID_FILE, vapid);
  console.log('Generated new VAPID keypair (stored in data/vapid.json)');
}

webpush.setVapidDetails('mailto:test@example.com', vapid.publicKey, vapid.privateKey);

let subscriptions = loadJson(SUBS_FILE, []);
const logs = [];
const MAX_LOGS = 300;

function addLog(entry) {
  logs.unshift({ ...entry, receivedAt: new Date().toISOString() });
  if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: vapid.publicKey });
});

app.post('/api/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'invalid subscription' });
  const existingIdx = subscriptions.findIndex((s) => s.endpoint === sub.endpoint);
  if (existingIdx >= 0) subscriptions[existingIdx] = sub;
  else subscriptions.push(sub);
  saveJson(SUBS_FILE, subscriptions);
  addLog({ event: 'subscribe', endpoint: sub.endpoint });
  res.json({ ok: true, total: subscriptions.length });
});

app.post('/api/unsubscribe', (req, res) => {
  const { endpoint } = req.body || {};
  subscriptions = subscriptions.filter((s) => s.endpoint !== endpoint);
  saveJson(SUBS_FILE, subscriptions);
  addLog({ event: 'unsubscribe', endpoint });
  res.json({ ok: true, total: subscriptions.length });
});

app.get('/api/subscriptions', (req, res) => {
  res.json({
    count: subscriptions.length,
    endpoints: subscriptions.map((s) => s.endpoint),
  });
});

// Client-side diagnostics land here (sent from the service worker / redirect page
// via fetch keepalive or sendBeacon) since once Yandex Browser opens, the PWA's
// own JS context and any devtools attached to it are gone.
app.post('/api/log', (req, res) => {
  addLog({ event: req.body?.event || 'log', ...req.body });
  res.json({ ok: true });
});

app.get('/api/logs', (req, res) => {
  res.json({ logs });
});

app.post('/api/logs/clear', (req, res) => {
  logs.length = 0;
  res.json({ ok: true });
});

app.post('/api/send', async (req, res) => {
  const {
    title = 'Test push',
    body = 'Hello from the server',
    url = '/',
    useYandexDeepLink = false,
    deepLink = null,
    mode = 'redirect',
    endpoint, // optional: send to one subscription only
  } = req.body || {};

  const targets = endpoint ? subscriptions.filter((s) => s.endpoint === endpoint) : subscriptions;
  if (targets.length === 0) {
    return res.status(400).json({ error: 'no subscriptions to send to' });
  }

  const payload = JSON.stringify({ title, body, url, useYandexDeepLink, deepLink, mode });

  const results = await Promise.allSettled(
    targets.map((sub) => webpush.sendNotification(sub, payload))
  );

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const statusCode = r.reason && r.reason.statusCode;
      addLog({ event: 'send-failed', endpoint: targets[i].endpoint, statusCode, message: String(r.reason) });
      // 404/410 means the subscription is gone (uninstalled, permission revoked, etc.)
      if (statusCode === 404 || statusCode === 410) {
        subscriptions = subscriptions.filter((s) => s.endpoint !== targets[i].endpoint);
        saveJson(SUBS_FILE, subscriptions);
      }
    } else {
      addLog({ event: 'send-ok', endpoint: targets[i].endpoint });
    }
  });

  res.json({
    sent: results.filter((r) => r.status === 'fulfilled').length,
    failed: results.filter((r) => r.status === 'rejected').length,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`yb-web-push test server listening on http://localhost:${PORT}`);
  console.log('Expose it over HTTPS (e.g. a tunnel) to test on an actual iPhone.');
});
