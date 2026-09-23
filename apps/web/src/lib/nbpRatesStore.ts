// Persists user-uploaded NBP rate CSVs in IndexedDB so they survive reloads
// in this browser, without needing any server-side storage. Only the raw CSV
// text is stored — it's re-parsed/re-merged into the NbpTable on every load,
// reusing the same parsing code the bundled yearly files go through.

const DB_NAME = "pit38_nbp_rates";
const DB_VERSION = 1;
const STORE_NAME = "files";

export interface StoredNbpFile {
  fileName: string;
  text: string;
  addedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "fileName" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listUploadedNbpFiles(): Promise<StoredNbpFile[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result as StoredNbpFile[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    // IndexedDB unavailable (private browsing, blocked storage, etc.) — act
    // as if nothing was ever uploaded; the app still works for this session.
    return [];
  }
}

export async function saveUploadedNbpFile(fileName: string, text: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({
        fileName,
        text,
        addedAt: new Date().toISOString(),
      } satisfies StoredNbpFile);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Not persisted, but the upload still applies for the current session.
  }
}

export async function deleteUploadedNbpFile(fileName: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(fileName);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Nothing to clean up if storage isn't available.
  }
}
