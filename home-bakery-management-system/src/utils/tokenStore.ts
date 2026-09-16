const LS_KEY = "muyrico.deviceToken";
const IDB_NAME = "muyrico-auth";
const IDB_STORE = "tokens";
const IDB_KEY = "deviceToken";

let idbBroken = false;

function openDb(): Promise<IDBDatabase | null> {
  if (idbBroken || typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        idbBroken = true;
        resolve(null);
      };
    } catch {
      idbBroken = true;
      resolve(null);
    }
  });
}

async function idbSet(value: string | null): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    if (value === null) store.delete(IDB_KEY);
    else store.put(value, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}

async function idbGet(): Promise<string | null> {
  const db = await openDb();
  if (!db) return null;
  const value = await new Promise<string | null>((resolve) => {
    const req = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : null);
    req.onerror = () => resolve(null);
  });
  db.close();
  return value;
}

/**
 * Read the device token, preferring localStorage. If only IndexedDB has it
 * (iOS evicted localStorage), repair localStorage on the way through.
 */
export async function getDeviceToken(): Promise<string | null> {
  let ls: string | null = null;
  try {
    ls = typeof localStorage !== "undefined" ? localStorage.getItem(LS_KEY) : null;
  } catch {
    ls = null;
  }
  if (ls) return ls;

  const idb = await idbGet();
  if (idb) {
    try {
      localStorage.setItem(LS_KEY, idb);
    } catch {
      /* storage unavailable; IndexedDB copy still works */
    }
  }
  return idb;
}

export async function setDeviceToken(token: string): Promise<void> {
  try {
    localStorage.setItem(LS_KEY, token);
  } catch {
    /* ignore */
  }
  await idbSet(token);
}

export async function clearDeviceToken(): Promise<void> {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
  await idbSet(null);
}
