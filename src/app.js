import { createAppState } from "./core/app-state.js";
import { createDatabase } from "./services/database.js";
import { createAudioPlayer } from "./services/audio.js";
import { createLibrary } from "./services/library.js";
import { createMediaSession } from "./services/media-session.js";
import { createOfflineService } from "./services/offline.js";
import { createLibraryUI } from "./ui/library.js";
import { createPlayerUI } from "./ui/player.js";
import { createNotifications } from "./ui/notifications.js";

/** Composition root. One app instance owns its services and can be disposed.
 * Browser dependencies may be supplied by tests without global monkey-patching.
 */
export function createApp({
  document = globalThis.document,
  navigator = globalThis.navigator,
  indexedDB = globalThis.indexedDB,
  location = globalThis.location,
  URL = globalThis.URL,
  MediaMetadata = globalThis.MediaMetadata,
  MessageChannel = globalThis.MessageChannel,
  timers = globalThis,
} = {}) {
  const state = createAppState();
  state.search = document.getElementById("search").value;
  state.sort = document.getElementById("sort").value;
  const notify = createNotifications(document);
  const storage = createDatabase({
    indexedDB, timers,
    onBlocked: () => notify("Close other Sur tabs, then reload to finish opening your library.", true),
  });
  const playerUI = createPlayerUI(document, state);
  let libraryUI;
  let disposed = false;
  const render = () => {
    if (disposed) return;
    libraryUI?.render();
    playerUI.render();
  };
  const library = createLibrary({
    state, storage, notify, onChange: render,
    onRemoved: (id) => player.removeTrack(id),
  });
  const player = createAudioPlayer({
    audio: document.getElementById("audio"), state, storage, URL,
    mediaSession: createMediaSession({ navigator, MediaMetadata, location, URL }),
    getVisible: library.getVisible,
    notify,
    onChange: render,
    onTrack: playerUI.setTrack,
    onPlayback: playerUI.setPlayback,
    onBuffering: playerUI.setBuffering,
    onProgress: playerUI.setProgress,
  });
  libraryUI = createLibraryUI(document, state, library, player);
  const offline = createOfflineService({ navigator, MessageChannel, timers, notify });
  libraryUI.bind();
  playerUI.bind(player);
  document.getElementById("keep").onclick = offline.keepOffline;
  render();
  const ready = library.initialize();
  ready.then(() => {
    if (disposed) storage.close();
    else return offline.register();
  });

  return {
    state, storage, library, player, offline, ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      player.dispose();
      libraryUI.dispose();
      playerUI.dispose();
      offline.dispose();
      document.getElementById("keep").onclick = null;
      storage.close();
    },
  };
}
