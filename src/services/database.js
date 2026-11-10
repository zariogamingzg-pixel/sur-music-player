// This schema is shared with every released version of Sur. Opening an
// existing v1 database never upgrades, clears, or rewrites its records.
export const DATABASE_NAME = "sur-music";
export const DATABASE_VERSION = 1;

/** IndexedDB boundary. All multi-store changes commit or abort together. */
export function createDatabase({
  indexedDB = globalThis.indexedDB,
  timers = globalThis,
  onBlocked = () => {},
} = {}) {
  let connection = null;
  let opening = null;

  function open() {
    if (connection) return Promise.resolve();
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore("tracks", { keyPath: "id" });
        database.createObjectStore("audio");
        database.createObjectStore("settings");
      };
      request.onsuccess = () => {
        connection = request.result;
        connection.onversionchange = () => close();
        resolve();
      };
      request.onerror = () => reject(request.error);
      request.onblocked = onBlocked;
    }).finally(() => { opening = null; });
    return opening;
  }

  function getConnection() {
    if (!connection) throw new Error("Music storage is not open.");
    return connection;
  }

  function read(store, key) {
    return new Promise((resolve, reject) => {
      const request = getConnection().transaction(store).objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function all(store) {
    return new Promise((resolve, reject) => {
      const request = getConnection().transaction(store).objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function write(stores, operation) {
    return new Promise((resolve, reject) => {
      const transaction = getConnection().transaction(stores, "readwrite");
      const abort = () => {
        try { transaction.abort(); } catch (error) {
          // A finished transaction cannot be aborted. The caller has already
          // received the original error; do not replace it with this one.
          if (error.name !== "InvalidStateError") console.warn("Could not abort storage transaction", error);
        }
      };
      const timeout = timers.setTimeout(() => {
        reject(new Error("Saving timed out. Download the MP3 to this device, close other Sur tabs, then retry."));
        abort();
      }, 30000);
      transaction.oncomplete = () => {
        timers.clearTimeout(timeout);
        resolve();
      };
      transaction.onerror = transaction.onabort = () => {
        timers.clearTimeout(timeout);
        reject(transaction.error || new Error("Storage operation cancelled"));
      };
      try {
        operation(transaction);
      } catch (error) {
        timers.clearTimeout(timeout);
        reject(error);
        abort();
      }
    });
  }

  function close() {
    connection?.close();
    connection = null;
  }

  return {
    open,
    close,
    async loadLibrary() {
      const [tracks, playlists] = await Promise.all([
        all("tracks"), read("settings", "playlists"),
      ]);
      return { tracks, playlists: playlists || [] };
    },
    getAudio: (id) => read("audio", id),
    saveTrack: (track) => write(["tracks"], (tx) => tx.objectStore("tracks").put(track)),
    saveImport: (track, blob) => write(["tracks", "audio"], (tx) => {
      tx.objectStore("tracks").put(track);
      tx.objectStore("audio").put(blob, track.id);
    }),
    savePlaylists: (playlists) => write(["settings"], (tx) => {
      tx.objectStore("settings").put(playlists, "playlists");
    }),
    removeTrack: (id, playlists) => write(["tracks", "audio", "settings"], (tx) => {
      tx.objectStore("tracks").delete(id);
      tx.objectStore("audio").delete(id);
      tx.objectStore("settings").put(playlists, "playlists");
    }),
  };
}
