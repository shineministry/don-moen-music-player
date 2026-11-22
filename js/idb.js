/* =========================================================
   Tiny IndexedDB helper — stores audio blobs locally so the
   player works even before Cloudflare is configured.
   ========================================================= */
window.IDBStore = (function () {
  const DB_NAME = "don-moen-player";
  const STORE = "songs";
  const VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("IndexedDB not supported"));
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: "id" });
          os.createIndex("addedAt", "addedAt");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const os = t.objectStore(STORE);
      let out;
      try { out = fn(os); } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      t.onerror = () => reject(t.error);
    });
  }

  return {
    put(record) { return tx("readwrite", (os) => os.put(record)); },
    get(id) { return tx("readonly", (os) => os.get(id)); },
    del(id) { return tx("readwrite", (os) => os.delete(id)); },
    async all() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const t = db.transaction(STORE, "readonly");
        const req = t.objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    },
    async clear() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const t = db.transaction(STORE, "readwrite");
        t.objectStore(STORE).clear();
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      });
    }
  };
})();
