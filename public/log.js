// Shared logging helper, loaded both as a plain <script> in page contexts and via
// importScripts() in the service worker. Uses IndexedDB (not fetch to a server)
// so the whole app works on static hosting (GitHub Pages) with no backend, and so
// logs survive the PWA's JS context disappearing when a foreign browser opens.

const YBWP_DB_NAME = 'ybwp-logs';
const YBWP_STORE = 'logs';

function ybwpOpenDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(YBWP_DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(YBWP_STORE, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function addLog(entry) {
  const db = await ybwpOpenDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(YBWP_STORE, 'readwrite');
    tx.objectStore(YBWP_STORE).add({ ...entry, ts: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getLogs() {
  const db = await ybwpOpenDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(YBWP_STORE, 'readonly');
    const req = tx.objectStore(YBWP_STORE).getAll();
    req.onsuccess = () => resolve(req.result.reverse());
    req.onerror = () => reject(req.error);
  });
}

async function clearLogs() {
  const db = await ybwpOpenDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(YBWP_STORE, 'readwrite');
    tx.objectStore(YBWP_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
