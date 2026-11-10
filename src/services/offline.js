/** Registration and the Keep offline action. The worker alone owns shell assets. */
export function createOfflineService({
  navigator = globalThis.navigator,
  MessageChannel = globalThis.MessageChannel,
  timers = globalThis,
  notify,
} = {}) {
  const pendingChecks = new Set();

  function withTimeout(start) {
    return new Promise((resolve, reject) => {
      let close = () => {};
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        timers.clearTimeout(timeout);
        close();
        pendingChecks.delete(cancel);
        if (error) reject(error);
        else resolve(value);
      };
      const cancel = () => finish(new Error("Offline setup cancelled"));
      const timeout = timers.setTimeout(() => finish(new Error("Offline setup timed out")), 12000);
      pendingChecks.add(cancel);
      try {
        close = start((value) => finish(null, value), (error) => finish(error)) || close;
      } catch (error) { finish(error); }
    });
  }

  async function register() {
    if (!("serviceWorker" in navigator)) return;
    try {
      // Keep a classic worker for existing iOS installations. App code is ESM;
      // changing the worker's type is unnecessary for caching those modules.
      await navigator.serviceWorker.register("./sw.js");
    } catch {
      notify("Offline setup is unavailable. Playback works while this page stays open; use Safari over HTTPS for offline installation.", true);
    }
  }

  async function keepOffline() {
    if (!("serviceWorker" in navigator)) {
      notify("Offline app installation is unavailable here. Open the HTTPS site in Safari.", true);
      return;
    }
    try {
      const persisted = navigator.storage?.persist
        ? await navigator.storage.persist().catch(() => false)
        : false;
      const registration = await withTimeout((resolve, reject) => {
        navigator.serviceWorker.ready.then(resolve, reject);
      });
      await withTimeout((resolve, reject) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = ({ data }) => {
          if (data?.complete) resolve(data);
          else reject(new Error("Incomplete offline cache"));
        };
        const cleanup = () => { channel.port1.close(); channel.port2.close(); };
        try {
          registration.active.postMessage({ type: "SUR_VERIFY_OFFLINE" }, [channel.port2]);
        } catch (error) {
          cleanup();
          throw error;
        }
        return cleanup;
      });
      notify(`Player saved for offline use. ${persisted ? "Persistent storage granted." : "Keep the original MP3s; iOS may clear website storage."} Test once in airplane mode.`);
    } catch {
      notify("Offline setup did not complete. Stay online, reload, and try again. Private hosting or browser restrictions may prevent offline access.", true);
    }
  }

  return {
    register, keepOffline,
    dispose() {
      for (const cancel of [...pendingChecks]) cancel();
    },
  };
}
