// Small IndexedDB simulation with atomic commits/aborts. It deliberately does
// not claim browser-engine compatibility; device acceptance is still required.
function createIndexedDB() {
  const stores = new Map();
  const control = {
    opens: [], transactions: [], upgrades: 0, failNextWrite: null, stallWrites: false, aborted: 0,
  };
  function request(result) {
    const req = {};
    queueMicrotask(() => {
      req.result = structuredClone(result);
      req.onsuccess?.();
    });
    return req;
  }
  const indexedDB = {
    open(name, version) {
      control.opens.push({ name, version });
      const req = {};
      queueMicrotask(() => {
        const connection = {
          closed: false,
          close() { this.closed = true; },
          createObjectStore(store) {
            if (stores.has(store)) throw new Error("Store already exists");
            stores.set(store, new Map());
          },
          transaction(names, mode = "readonly") {
            if (this.closed) throw new Error("Database is closed");
            control.transactions.push({ stores: typeof names === 'string' ? [names] : [...names], mode });
            const pending = [];
            const writeError = mode === "readwrite" ? control.failNextWrite : null;
            if (mode === "readwrite") control.failNextWrite = null;
            let complete = false;
            const tx = {
              error: null,
              objectStore(store) {
                if (!stores.has(store)) throw new Error(`Missing store: ${store}`);
                return {
                  get: (key) => request(stores.get(store).get(key)),
                  getAll: () => request([...stores.get(store).values()]),
                  put(value, key) {
                    const copy = structuredClone(value);
                    pending.push(() => stores.get(store).set(key ?? copy.id, copy));
                  },
                  delete(key) { pending.push(() => stores.get(store).delete(key)); },
                };
              },
              abort() {
                if (complete) {
                  const error = new Error("Finished"); error.name = "InvalidStateError"; throw error;
                }
                complete = true;
                control.aborted++;
                queueMicrotask(() => tx.onabort?.());
              },
            };
            if (!(mode === "readwrite" && control.stallWrites)) {
              setTimeout(() => {
                if (complete) return;
                complete = true;
                if (writeError) {
                  tx.error = writeError;
                  tx.onabort?.();
                } else {
                  pending.forEach((operation) => operation());
                  tx.oncomplete?.();
                }
              }, 0);
            }
            return tx;
          },
        };
        req.result = connection;
        if (!stores.size) {
          control.upgrades++;
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      });
      return req;
    },
  };
  return { indexedDB, stores, control };
}
module.exports = { createIndexedDB };
