/* Ledger — IndexedDB layer. All data on-device. */
const DB = (() => {
  const NAME = "ledger-db", VERSION = 1;
  const STORES = ["settings", "watchlist", "holdings", "analyses", "notes", "prices"];
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(store, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const result = fn(t.objectStore(store));
      t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
      t.onerror = () => reject(t.error);
    }));
  }

  const get = (store, key) => open().then(db => new Promise((res, rej) => {
    const r = db.transaction(store).objectStore(store).get(key);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const set = (store, key, val) => tx(store, "readwrite", os => os.put(val, key));
  const del = (store, key) => tx(store, "readwrite", os => os.delete(key));
  const clear = (store) => tx(store, "readwrite", os => os.clear());
  const all = (store) => open().then(db => new Promise((res, rej) => {
    const out = {};
    const cur = db.transaction(store).objectStore(store).openCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) { out[c.key] = c.value; c.continue(); } else res(out);
    };
    cur.onerror = () => rej(cur.error);
  }));

  async function exportAll() {
    const dump = { app: "ledger", version: 1, exportedAt: new Date().toISOString(), data: {} };
    for (const s of STORES) dump.data[s] = await all(s);
    return dump;
  }

  async function importAll(dump) {
    if (!dump || dump.app !== "ledger" || !dump.data) throw new Error("Not a Ledger backup file");
    for (const s of STORES) {
      if (!dump.data[s]) continue;
      await clear(s);
      for (const [k, v] of Object.entries(dump.data[s])) await set(s, k, v);
    }
  }

  async function wipe() { for (const s of STORES) await clear(s); }

  return { get, set, del, clear, all, exportAll, importAll, wipe };
})();
