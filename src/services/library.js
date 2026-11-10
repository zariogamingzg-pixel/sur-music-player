import { createID, fileFingerprint, trackFromFile } from "../utils/format.js";

/** Pure collection selector, shared by the library UI and playback queues. */
export function selectVisibleTracks(state) {
  const playlist = state.playlists.find((item) => item.id === state.view);
  const search = state.search.toLowerCase();
  const visible = state.tracks.filter((track) =>
    (state.view === "all" || (state.view === "favourites"
      ? track.favourite : playlist?.tracks.includes(track.id))) &&
    `${track.title} ${track.artist}`.toLowerCase().includes(search),
  );
  return visible.sort((a, b) => state.sort === "new"
    ? b.added - a.added
    : state.sort === "artist"
      ? a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title)
      : a.title.localeCompare(b.title));
}

/** Library and playlist operations. Storage commits precede in-memory changes. */
export function createLibrary({ state, storage, notify, onChange, onRemoved }) {
  let ready;
  let pendingMutation = Promise.resolve();

  // Playlist creation, membership and deletion all write the same setting.
  // Serialize those mutations so one pending snapshot cannot overwrite another.
  function mutate(operation) {
    const result = pendingMutation.then(operation);
    pendingMutation = result.catch(() => {});
    return result;
  }

  function initialize() {
    if (ready) return ready;
    ready = (async () => {
      try {
        await storage.open();
        const saved = await storage.loadLibrary();
        state.tracks = saved.tracks;
        state.playlists = saved.playlists;
        state.libraryLoaded = true;
        onChange();
      } catch {
        state.libraryError = true;
        notify("This browser could not open offline storage. Open the site in Safari with normal browsing enabled.", true);
        onChange();
      }
    })();
    return ready;
  }

  async function importFiles(files) {
    if (state.importing || !files.length) return;
    state.importing = true;
    onChange();
    let added = 0;
    let duplicates = 0;
    let skipped = 0;
    let failed = 0;
    let failureMessage = "";
    try {
      await initialize();
      if (!state.libraryLoaded) {
        notify("Music storage is unavailable. Reload the page and try again.", true);
        return;
      }
      const known = new Set(state.tracks.map((track) => track.fingerprint));
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!/\.mp3$/i.test(file.name)) {
          skipped++;
          continue;
        }
        if (known.has(fileFingerprint(file))) {
          duplicates++;
          continue;
        }
        notify(`Saving ${i + 1} of ${files.length}: ${file.name}`);
        const track = trackFromFile(file);
        try {
          if (!file.size) throw new Error("This file is empty. Download the MP3 to your device first.");
          // Keep a Blob rather than reading the whole file into an ArrayBuffer;
          // iOS Files providers may stall that read and large files waste RAM.
          await storage.saveImport(track, new Blob([file], { type: "audio/mpeg" }));
          state.tracks.push(track);
          known.add(track.fingerprint);
          added++;
        } catch (error) {
          failed++;
          failureMessage = error.name === "QuotaExceededError"
            ? "Storage is full. Free device space before importing more music."
            : `Could not save ${file.name}. ${error.message || "Check that it is downloaded in Files."}`;
          break;
        }
      }
    } catch (error) {
      failed++;
      failureMessage = `Import failed: ${error.message || "Reload and try again."}`;
    } finally {
      state.importing = false;
      onChange();
      if (state.libraryLoaded) {
        notify(`${added} imported${duplicates ? `, ${duplicates} already in your library` : ""}${skipped ? `, ${skipped} non-MP3 files skipped` : ""}.${failed ? ` ${failureMessage}` : ""}`, !!failed);
      }
    }
  }

  return {
    initialize,
    importFiles,
    getVisible: () => selectVisibleTracks(state),
    setCollection(values) {
      for (const key of ["view", "search", "sort"]) {
        if (values[key] !== undefined) state[key] = values[key];
      }
      onChange();
    },
    toggleFavourite(id) {
      return mutate(async () => {
        const track = state.tracks.find((item) => item.id === id);
        if (!track) return;
        const updated = { ...track, favourite: !track.favourite };
        try {
          await storage.saveTrack(updated);
          Object.assign(track, updated);
          onChange();
        } catch {
          notify("Could not save favourite. Check device storage.", true);
        }
      });
    },
    async createPlaylist(name) {
      name = name.trim();
      if (!name || state.savingPlaylist) return null;
      state.savingPlaylist = true;
      try {
        // An open connection does not mean saved playlists have loaded yet.
        // Wait before building the snapshot written back to settings.
        await initialize();
        if (!state.libraryLoaded) return null;
        return await mutate(async () => {
          const playlist = { id: createID(), name, tracks: [] };
          try {
            await storage.savePlaylists([...state.playlists, playlist]);
            state.playlists.push(playlist);
            state.view = playlist.id;
            onChange();
            notify("Playlist created. Use the List menu beside any song to add or remove it.");
            return playlist;
          } catch {
            notify("Could not save playlist.", true);
            return null;
          }
        });
      } finally {
        state.savingPlaylist = false;
      }
    },
    togglePlaylistTrack(playlistID, trackID) {
      return mutate(async () => {
        const playlist = state.playlists.find((item) => item.id === playlistID);
        if (!playlist || !state.tracks.some((track) => track.id === trackID)) return;
        const present = playlist.tracks.includes(trackID);
        const updated = state.playlists.map((item) => item.id === playlistID ? {
          ...item,
          tracks: present ? item.tracks.filter((id) => id !== trackID) : [...item.tracks, trackID],
        } : item);
        try {
          await storage.savePlaylists(updated);
          state.playlists = updated;
          notify(`${present ? "Removed from" : "Added to"} ${playlist.name}.`);
          onChange();
        } catch {
          notify("Could not save playlist.", true);
        }
      });
    },
    removeTrack(id) {
      return mutate(async () => {
        const updated = state.playlists.map((playlist) => ({
          ...playlist, tracks: playlist.tracks.filter((trackID) => trackID !== id),
        }));
        try {
          await storage.removeTrack(id, updated);
          state.tracks = state.tracks.filter((track) => track.id !== id);
          state.playlists = updated;
          onRemoved(id);
          onChange();
          notify("Removed the player’s copy. Your original in Files is unchanged.");
        } catch {
          notify("Could not remove this song. Please try again.", true);
        }
      });
    },
  };
}
