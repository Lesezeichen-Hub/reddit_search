const DB_NAME = 'reddit-investigator';
const DB_VERSION = 1;
export const STORES = ['settings', 'findings', 'history', 'savedSearches'];

let dbPromise = null;

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function openDb(factory = globalThis.indexedDB) {
  if (dbPromise) return dbPromise;
  if (!factory) return Promise.reject(new Error('IndexedDB ist in diesem Browser nicht verfügbar.'));
  dbPromise = new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('findings')) {
        const findings = db.createObjectStore('findings', { keyPath: 'id' });
        findings.createIndex('savedAt', 'savedAt');
      }
      if (!db.objectStoreNames.contains('history')) {
        const history = db.createObjectStore('history', { keyPath: 'id' });
        history.createIndex('searchedAt', 'searchedAt');
      }
      if (!db.objectStoreNames.contains('savedSearches')) db.createObjectStore('savedSearches', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => { dbPromise = null; reject(request.error); };
    request.onblocked = () => reject(new Error('Die lokale Datenbank ist durch einen anderen Tab blockiert.'));
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const objectStore = transaction.objectStore(store);
    let result;
    Promise.resolve(fn(objectStore)).then((value) => { result = value; }, reject);
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Transaktion abgebrochen'));
  });
}

export const db = {
  get: (store, key) => tx(store, 'readonly', (s) => promisify(s.get(key))),
  all: (store) => tx(store, 'readonly', (s) => promisify(s.getAll())),
  put: (store, value) => tx(store, 'readwrite', (s) => promisify(s.put(value))),
  delete: (store, key) => tx(store, 'readwrite', (s) => promisify(s.delete(key))),
  clear: (store) => tx(store, 'readwrite', (s) => promisify(s.clear())),
  async clearAll() {
    for (const store of STORES) await this.clear(store);
  }
};
