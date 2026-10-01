const name = "arabic-journey-v1";
let database;
export async function openStorage() {
  if (database) return database;
  database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("cache", { keyPath: "key" });
      db.createObjectStore("outbox", { keyPath: "key" });
      db.createObjectStore("meta", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}
const request = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
export async function readStore(store, key) {
  const db = await openStorage();
  return request(db.transaction(store).objectStore(store).get(key));
}
export async function allStore(store, owner) {
  const db = await openStorage();
  return (
    await request(db.transaction(store).objectStore(store).getAll())
  ).filter((row) => row.owner === owner);
}
export async function atomic(stores, work) {
  const db = await openStorage();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, "readwrite");
    try {
      work(tx);
    } catch (e) {
      tx.abort();
      reject(e);
      return;
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("storage_error"));
  });
}
export const getCache = async (owner, table) =>
  (await readStore("cache", owner + ":" + table))?.data || [];
export const putCache = (owner, table, data) =>
  atomic(["cache"], (tx) =>
    tx
      .objectStore("cache")
      .put({ key: owner + ":" + table, owner, data, at: Date.now() }),
  );
export const cacheAccount = (user, profile, settings) =>
  atomic(["meta"], (tx) =>
    tx.objectStore("meta").put({
      key: user.id + ":account",
      owner: user.id,
      user,
      profile,
      settings,
    }),
  );
export const cachedAccount = (owner) => readStore("meta", owner + ":account");
export async function clearOwner(owner) {
  const rows = await Promise.all(
    ["cache", "outbox", "meta"].map((s) => allStore(s, owner)),
  );
  await atomic(["cache", "outbox", "meta"], (tx) => {
    ["cache", "outbox", "meta"].forEach((s, i) =>
      rows[i].forEach((row) => tx.objectStore(s).delete(row.key)),
    );
  });
}

export const activeAccount = () => readStore("meta", "active-account");
export const rememberActive = (user, profile, settings) =>
  atomic(["meta"], (tx) =>
    tx
      .objectStore("meta")
      .put({ key: "active-account", owner: user.id, user, profile, settings }),
  );
