// ===== IndexedDB 数据层 =====

const DB_NAME = 'TravelAlbumDB';
const DB_VERSION = 1;

let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('meta')) {
        d.createObjectStore('meta', { keyPath: 'key' });
      }
      if (!d.objectStoreNames.contains('places')) {
        d.createObjectStore('places', { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

export async function getMeta(key, def = null) {
  try {
    const tx = db.transaction('meta', 'readonly');
    const val = await new Promise((r) => {
      const req = tx.objectStore('meta').get(key);
      req.onsuccess = () => r(req.result ? req.result.value : def);
      req.onerror = () => r(def);
    });
    return val;
  } catch { return def; }
}

export async function setMeta(key, value) {
  const tx = db.transaction('meta', 'readwrite');
  await new Promise((r, j) => {
    const req = tx.objectStore('meta').put({ key, value });
    req.onsuccess = r; req.onerror = () => j(req.error);
  });
}

// ===== 地点 CRUD =====

export async function getAllPlaces() {
  try {
    const tx = db.transaction('places', 'readonly');
    return await new Promise((r) => {
      const req = tx.objectStore('places').getAll();
      req.onsuccess = () => r(req.result || []);
      req.onerror = () => r([]);
    });
  } catch { return []; }
}

export async function savePlace(place) {
  const tx = db.transaction('places', 'readwrite');
  await new Promise((r, j) => {
    const req = tx.objectStore('places').put(place);
    req.onsuccess = r; req.onerror = () => j(req.error);
  });
}

export async function deletePlace(id) {
  const tx = db.transaction('places', 'readwrite');
  await new Promise((r, j) => {
    const req = tx.objectStore('places').delete(id);
    req.onsuccess = r; req.onerror = () => j(req.error);
  });
}

// ===== 导出 =====

export async function exportAllData() {
  const places = await getAllPlaces();
  const theme = await getMeta('theme', '#ff6b6b');
  const home = await getMeta('home', null);
  return { exportTime: new Date().toISOString(), theme, home, places };
}

export async function importAllData(data) {
  if (data.theme) await setMeta('theme', data.theme);
  if (data.home) await setMeta('home', data.home);
  if (data.places) {
    const tx = db.transaction('places', 'readwrite');
    const store = tx.objectStore('places');
    for (const p of data.places) store.put(p);
    await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = j; });
  }
}

// ===== 初始化 =====

export async function initDB() {
  await openDB();
  return { theme: await getMeta('theme', '#ff6b6b'), home: await getMeta('home', null) };
}
