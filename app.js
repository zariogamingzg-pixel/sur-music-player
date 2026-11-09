"use strict";
const $ = (id) => document.getElementById(id);
const audio = $("audio");
let db,
  tracks = [],
  playlists = [],
  current = null,
  currentURL = null,
  view = "all",
  queue = [],
  orderedQueue = [],
  queueIndex = -1,
  pendingTrack = null,
  shuffled = false,
  repeat = 0,
  libraryLoaded = false,
  importing = false,
  playRequest = 0;
const status = (message, error = false) => {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
};
const time = (value) =>
  Number.isFinite(value)
    ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`
    : "0:00";
let idSequence = 0;
function createID() {
  if (typeof globalThis.crypto?.randomUUID === "function")
    return globalThis.crypto.randomUUID();
  // These are local database keys, not authentication tokens. Older browsers
  // and HTTP previews do not always expose randomUUID.
  return `sur-${Date.now().toString(36)}-${++idSequence}-${Math.random().toString(36).slice(2)}`;
}
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("sur-music", 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore("tracks", { keyPath: "id" });
      d.createObjectStore("audio");
      d.createObjectStore("settings");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () =>
      status(
        "Close other Sur tabs, then reload to finish opening your library.",
        true,
      );
  });
}
function read(store, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function all(store) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function write(stores, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, "readwrite");
    const timeout = setTimeout(() => {
      const error = new Error("Saving timed out. Download the MP3 to this device, close other Sur tabs, then retry.");
      reject(error);
      try { tx.abort(); } catch {}
    }, 30000);
    tx.oncomplete = () => {
      clearTimeout(timeout);
      resolve();
    };
    tx.onerror = tx.onabort = () => {
      clearTimeout(timeout);
      reject(tx.error || new Error("Storage operation cancelled"));
    };
    try {
      fn(tx);
    } catch (e) {
      clearTimeout(timeout);
      reject(e);
      try { tx.abort(); } catch {}
      return;
    }
  });
}
const saveSettings = () =>
  write(["settings"], (tx) =>
    tx.objectStore("settings").put(playlists, "playlists"),
  );
function getVisible() {
  let list = tracks.filter(
    (t) =>
      (view === "all" ||
        (view === "favourites"
          ? t.favourite
          : playlists.find((p) => p.id === view)?.tracks.includes(t.id))) &&
      `${t.title} ${t.artist}`
        .toLowerCase()
        .includes($("search").value.toLowerCase()),
  );
  let sort = $("sort").value;
  return list.sort((a, b) =>
    sort === "new"
      ? b.added - a.added
      : sort === "artist"
        ? a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title)
        : a.title.localeCompare(b.title),
  );
}
function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function render() {
  $("count").textContent =
    `${tracks.length} track${tracks.length === 1 ? "" : "s"}`;
  document
    .querySelectorAll("[data-view]")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $("playlist").replaceChildren(
    new Option("Playlists", ""),
    ...playlists.map((p) => new Option(p.name, p.id)),
  );
  $("playlist").value = playlists.some((p) => p.id === view) ? view : "";
  const visible = getVisible();
  $("tracks").replaceChildren();
  $("empty").hidden = tracks.length > 0;
  if (tracks.length && !visible.length)
    $("tracks").append(
      element(
        "li",
        "status",
        "No songs here yet. Try another search or add songs to this playlist.",
      ),
    );
  visible.forEach((track, i) => {
    const row = element(
      "li",
      "track" + (current === track.id ? " current" : ""),
    );
    row.dataset.id = track.id;
    const select = element("button", "track-main");
    select.setAttribute("aria-label", `Play ${track.title} by ${track.artist}`);
    const info = element("span", "song-info");
    info.append(
      element("strong", "", track.title),
      element("small", "", track.artist),
    );
    select.append(
      element(
        "span",
        "number",
        current === track.id ? "♫" : String(i + 1).padStart(2, "0"),
      ),
      info,
    );
    select.onclick = () => {
      setQueue(
        visible.map((t) => t.id),
        track.id,
      );
      playTrack(track.id);
    };
    const heart = element(
      "button",
      "heart" + (track.favourite ? " on" : ""),
      track.favourite ? "♥" : "♡",
    );
    heart.setAttribute(
      "aria-label",
      `${track.favourite ? "Unfavourite" : "Favourite"} ${track.title}`,
    );
    heart.setAttribute("aria-pressed", String(track.favourite));
    heart.onclick = async () => {
      heart.disabled = true;
      const updated = { ...track, favourite: !track.favourite };
      try {
        await write(["tracks"], (tx) => tx.objectStore("tracks").put(updated));
        Object.assign(track, updated);
        render();
      } catch {
        status("Could not save favourite. Check device storage.", true);
      } finally {
        heart.disabled = false;
      }
    };
    row.append(select, heart);
    if (playlists.length) {
      const add = element("select");
      add.setAttribute("aria-label", `Playlist membership for ${track.title}`);
      add.append(new Option("＋ List", ""));
      playlists.forEach((p) =>
        add.append(
          new Option(
            `${p.tracks.includes(track.id) ? "✓ " : ""}${p.name}`,
            p.id,
          ),
        ),
      );
      add.onchange = async () => {
        const p = playlists.find((p) => p.id === add.value);
        if (!p) return;
        add.disabled = true;
        const old = [...p.tracks];
        const present = p.tracks.includes(track.id);
        p.tracks = present
          ? p.tracks.filter((id) => id !== track.id)
          : [...p.tracks, track.id];
        try {
          await saveSettings();
          status(`${present ? "Removed from" : "Added to"} ${p.name}.`);
          render();
        } catch {
          p.tracks = old;
          add.value = "";
          status("Could not save playlist.", true);
        } finally {
          add.disabled = false;
        }
      };
      row.append(add);
    }
    const remove = element("button", "remove", "×");
    remove.setAttribute("aria-label", `Remove ${track.title}`);
    remove.onclick = () => removeTrack(track);
    row.append(remove);
    $("tracks").append(row);
  });
  const bytes = tracks.reduce((total, t) => total + t.size, 0);
  $("storage").textContent =
    `${(bytes / 1048576).toFixed(1)} MB · stored on this device`;
  for (const id of ["play", "previous", "next"])
    $(id).disabled = !tracks.length;
}
function setQueue(ids, id) {
  orderedQueue = [...ids];
  queue = [...ids];
  if (shuffled) {
    queue = queue.filter((x) => x !== id);
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    if (id && ids.includes(id)) queue.unshift(id);
  }
  queueIndex = queue.indexOf(id);
}
async function playTrack(id) {
  const request = ++playRequest;
  pendingTrack = id;
  try {
    const track = tracks.find((t) => t.id === id);
    if (!track) return;
    const blob = await read("audio", id);
    if (request !== playRequest || !tracks.some((t) => t.id === id)) return;
    if (!blob) {
      status(
        "This audio file is missing. Remove it and import the original again.",
        true,
      );
      return;
    }
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    if (currentURL) URL.revokeObjectURL(currentURL);
    current = id;
    currentURL = URL.createObjectURL(blob);
    audio.src = currentURL;
    $("playing-title").textContent = track.title;
    $("playing-artist").textContent = track.artist;
    $("elapsed").textContent = "0:00";
    $("duration").textContent = "0:00";
    $("seek").value = "0";
    if ("mediaSession" in navigator && "MediaMetadata" in window)
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: "Sur · Your collection",
        artwork: [
          {
            src: new URL("icon.png", location.href).href,
            sizes: "512x512",
            type: "image/png",
          },
        ],
      });
    render();
    if (await resumePlayback() && request === playRequest)
      status("Playing from your offline library.");
  } catch (e) {
    if (request !== playRequest || e.name === "AbortError") return;
    status(
      "Playback did not start. Tap Play to try again. Check that the file is a playable MP3.",
      true,
    );
  } finally {
    if (request === playRequest) pendingTrack = null;
  }
}
function next(direction = 1, automatic = false) {
  if (!tracks.length) return;
  if (!queue.length) {
    const ids = getVisible().map((t) => t.id);
    setQueue(ids.length ? ids : tracks.map((t) => t.id), current);
  }
  if (!queue.length) return;
  if (automatic && repeat === 2) {
    audio.currentTime = 0;
    resumePlayback();
    return;
  }
  if (direction < 0 && audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  const target = queueIndex < 0
    ? (direction < 0 ? queue.length - 1 : 0)
    : queueIndex + direction;
  if (automatic && target >= queue.length && repeat === 0) {
    status("End of this collection.");
    return;
  }
  queueIndex = (target + queue.length) % queue.length;
  playTrack(queue[queueIndex]);
}
// All controls operate the same element and use the same resume path.
let playbackCommand = 0;
function syncPlayback(playing) {
  $("play").setAttribute("aria-label", playing ? "Pause" : "Play");
  $("record").classList.toggle("is-playing", playing);
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = playing ? "playing" :
      (current ? "paused" : "none");
  }
  updatePosition();
}
function prepareAudioSession() {
  if (!("audioSession" in navigator)) return;
  try {
    // Reassert the category after an iOS background interruption. Setting the
    // same value alone can leave a cached audio-session configuration in place.
    navigator.audioSession.type = "auto";
    navigator.audioSession.type = "playback";
  } catch {
    // Audio Session is optional; ordinary HTML audio must still work.
  }
}
async function resumePlayback() {
  const command = ++playbackCommand;
  if (!current || !audio.getAttribute("src")) {
    syncPlayback(false);
    return false;
  }
  prepareAudioSession();
  try {
    // Call play immediately in the control action; keep the source and position.
    await audio.play();
    if (command !== playbackCommand) return false;
    return !audio.paused;
  } catch (error) {
    if (command !== playbackCommand || error.name === "AbortError") return false;
    syncPlayback(false);
    status("Could not resume audio. Open Sur and tap Play to try again.", true);
    return false;
  }
}
function pausePlayback() {
  ++playRequest;
  pendingTrack = null;
  ++playbackCommand;
  audio.pause();
  syncPlayback(false);
}
async function toggle() {
  if (pendingTrack) {
    pausePlayback();
    return;
  }
  if (!current) {
    const visible = getVisible();
    const list = visible.length ? visible : tracks;
    if (list.length) {
      setQueue(list.map((t) => t.id), list[0].id);
      await playTrack(list[0].id);
    }
    return;
  }
  if (audio.paused) await resumePlayback();
  else pausePlayback();
}
function updatePosition() {
  if (
    "mediaSession" in navigator &&
    navigator.mediaSession.setPositionState &&
    Number.isFinite(audio.duration) &&
    audio.duration > 0
  )
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate,
        position: Math.min(audio.currentTime, audio.duration),
      });
    } catch {}
}
// A play request does not establish audible output. Wait for playback to start.
audio.addEventListener("playing", () => syncPlayback(true));
for (const event of ["pause", "ended", "error", "emptied"]) {
  audio.addEventListener(event, () => syncPlayback(false));
}
audio.addEventListener("waiting", () => {
  $("record").classList.toggle("is-playing", false);
});
audio.addEventListener("seeked", updatePosition);
audio.addEventListener("ratechange", updatePosition);
audio.addEventListener("loadedmetadata", () => {
  $("duration").textContent = time(audio.duration);
  updatePosition();
});
audio.addEventListener("timeupdate", () => {
  $("elapsed").textContent = time(audio.currentTime);
  $("seek").value =
    Number.isFinite(audio.duration) && audio.duration
      ? String((audio.currentTime / audio.duration) * 100)
      : "0";
  updatePosition();
});
audio.addEventListener("ended", () => next(1, true));
audio.addEventListener("error", () => {
  if (audio.getAttribute("src"))
    status(
      "This file could not be played. Try another MP3 or re-import the original.",
      true,
    );
});
$("seek").oninput = () => {
  if (Number.isFinite(audio.duration)) {
    audio.currentTime = (Number($("seek").value) / 100) * audio.duration;
    updatePosition();
  }
};
$("play").onclick = toggle;
$("next").onclick = () => next();
$("previous").onclick = () => next(-1);
$("shuffle").onclick = () => {
  shuffled = !shuffled;
  $("shuffle").setAttribute("aria-pressed", String(shuffled));
  setQueue(orderedQueue.length ? orderedQueue : getVisible().map((t) => t.id), pendingTrack || current);
  status(
    shuffled
      ? "Shuffle on."
      : "Shuffle off. Original play order restored.",
  );
};
$("repeat").onclick = () => {
  repeat = (repeat + 1) % 3;
  $("repeat").setAttribute("aria-pressed", String(repeat !== 0));
  $("repeat").setAttribute(
    "aria-label",
    `Repeat ${["off", "collection", "song"][repeat]}`,
  );
  $("repeat").textContent = repeat === 2 ? "↻¹" : "↻";
  status(`Repeat ${["off", "collection", "song"][repeat]}.`);
};
function seekBy(amount) {
  if (Number.isFinite(audio.duration))
    audio.currentTime = Math.max(
      0,
      Math.min(audio.duration, audio.currentTime + amount),
    );
}
if ("mediaSession" in navigator) {
  for (const [action, fn] of Object.entries({
    play: resumePlayback,
    pause: pausePlayback,
    previoustrack: () => next(-1),
    nexttrack: () => next(),
    seekbackward: (d) => seekBy(-(d.seekOffset || 10)),
    seekforward: (d) => seekBy(d.seekOffset || 10),
    seekto: (d) => {
      if (Number.isFinite(d.seekTime) && Number.isFinite(audio.duration))
        audio.currentTime = Math.max(0, Math.min(d.seekTime, audio.duration));
    },
  }))
    try {
      navigator.mediaSession.setActionHandler(action, fn);
    } catch {}
}
if ("audioSession" in navigator)
  try {
    navigator.audioSession.type = "playback";
  } catch {}
async function importFiles(files) {
  if (importing || !files.length) return;
  importing = true;
  $("import").disabled = true;
  $("empty-import").disabled = true;
  let added = 0,
    duplicates = 0,
    skipped = 0,
    failed = 0;
  let failureMessage = "";
  const known = new Set(tracks.map((t) => t.fingerprint));
  try {
    if (!libraryLoaded) await libraryReady;
    if (!libraryLoaded) {
      status("Music storage is unavailable. Reload the page and try again.", true);
      return;
    }
    for (const track of tracks) known.add(track.fingerprint);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!/\.mp3$/i.test(file.name)) {
        skipped++;
        continue;
      }
      const fingerprint = `${file.name}|${file.size}|${file.lastModified}`;
      if (known.has(fingerprint)) {
        duplicates++;
        continue;
      }
      status(`Saving ${i + 1} of ${files.length}: ${file.name}`);
      const name = file.name.replace(/\.mp3$/i, "");
      const separator = name.indexOf(" - ");
      const track = {
        id: createID(),
        title: separator > 0 ? name.slice(separator + 3) : name,
        artist: separator > 0 ? name.slice(0, separator) : "Your collection",
        size: file.size,
        added: Date.now(),
        favourite: false,
        fingerprint,
      };
      try {
        if (!file.size) throw new Error("This file is empty. Download the MP3 to your device first.");
        const blob = new Blob([file], {
          type: "audio/mpeg",
        });
        await write(["tracks", "audio"], (tx) => {
          tx.objectStore("tracks").put(track);
          tx.objectStore("audio").put(blob, track.id);
        });
        tracks.push(track);
        known.add(fingerprint);
        added++;
      } catch (e) {
        failed++;
        failureMessage = e.name === "QuotaExceededError"
            ? "Storage is full. Free device space before importing more music."
            : `Could not save ${file.name}. ${e.message || "Check that it is downloaded in Files."}`;
        break;
      }
    }
  } catch (error) {
    failed++;
    failureMessage = `Import failed: ${error.message || "Reload and try again."}`;
  } finally {
    importing = false;
    $("import").disabled = !libraryLoaded;
    $("empty-import").disabled = !libraryLoaded;
    $("files").value = "";
    render();
    if (libraryLoaded) status(
      `${added} imported${duplicates ? `, ${duplicates} already in your library` : ""}${skipped ? `, ${skipped} non-MP3 files skipped` : ""}.${failed ? ` ${failureMessage}` : ""}`,
      !!failed,
    );
  }
}
async function removeTrack(track) {
  const dialog = $("delete-dialog");
  if (dialog.open) return;
  dialog.returnValue = "cancel";
  dialog.showModal();
  dialog.addEventListener(
    "close",
    async () => {
      if (dialog.returnValue !== "remove") return;
      const updated = playlists.map((p) => ({
        ...p,
        tracks: p.tracks.filter((id) => id !== track.id),
      }));
      try {
        await write(["tracks", "audio", "settings"], (tx) => {
          tx.objectStore("tracks").delete(track.id);
          tx.objectStore("audio").delete(track.id);
          tx.objectStore("settings").put(updated, "playlists");
        });
        if (pendingTrack === track.id) pausePlayback();
        const removedIndex = queue.indexOf(track.id);
        if (current === track.id) {
          pausePlayback();
          audio.removeAttribute("src");
          audio.load();
          if (currentURL) URL.revokeObjectURL(currentURL);
          currentURL = null;
          current = null;
          $("playing-title").textContent = "A soundtrack of your own";
          $("playing-artist").textContent = "Choose a song to begin";
          $("seek").value = "0";
          $("elapsed").textContent = $("duration").textContent = "0:00";
          if ("mediaSession" in navigator) {
            navigator.mediaSession.metadata = null;
            navigator.mediaSession.playbackState = "none";
          }
        }
        tracks = tracks.filter((t) => t.id !== track.id);
        playlists = updated;
        queue = queue.filter((id) => id !== track.id);
        orderedQueue = orderedQueue.filter((id) => id !== track.id);
        queueIndex = current ? queue.indexOf(current) : removedIndex - 1;
        render();
        status(
          "Removed the player’s copy. Your original in Files is unchanged.",
        );
      } catch {
        status("Could not remove this song. Please try again.", true);
      }
    },
    { once: true },
  );
}
$("import").onclick = $("empty-import").onclick = () => $("files").click();
$("files").onchange = () => importFiles(Array.from($("files").files));
$("search").oninput = render;
$("sort").onchange = render;
document.querySelectorAll("[data-view]").forEach(
  (b) =>
    (b.onclick = () => {
      view = b.dataset.view;
      render();
    }),
);
$("playlist").onchange = () => {
  view = $("playlist").value || "all";
  render();
};
$("new-playlist").onclick = () => {
  $("playlist-dialog").showModal();
  $("playlist-name").focus();
};
$("close-playlist").onclick = () => $("playlist-dialog").close();
let savingPlaylist = false;
$("playlist-form").onsubmit = async (e) => {
  e.preventDefault();
  if (savingPlaylist || !db) return;
  const name = $("playlist-name").value.trim();
  if (!name) return;
  savingPlaylist = true;
  const p = { id: createID(), name, tracks: [] };
  playlists.push(p);
  try {
    await saveSettings();
    view = p.id;
    $("playlist-dialog").close();
    $("playlist-name").value = "";
    render();
    status(
      "Playlist created. Use the List menu beside any song to add or remove it.",
    );
  } catch {
    playlists = playlists.filter((item) => item.id !== p.id);
    status("Could not save playlist.", true);
  } finally {
    savingPlaylist = false;
  }
};
$("help").onclick = () => $("guide").showModal();
$("close-guide").onclick = () => $("guide").close();
let swRegistration;
async function offline() {
  if (!("serviceWorker" in navigator)) {
    status(
      "Offline app installation is unavailable here. Open the HTTPS site in Safari.",
      true,
    );
    return;
  }
  try {
    const persisted = navigator.storage?.persist
      ? await navigator.storage.persist().catch(() => false)
      : false;
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Offline setup timed out")), 12000),
      ),
    ]);
    swRegistration = registration;
    const cache = await caches.open("sur-shell-v5");
    const complete = (
      await Promise.all(
        [
          "./",
          "./index.html",
          "./style.css",
          "./app.js",
          "./manifest.webmanifest",
          "./icon.png",
        ].map((path) => cache.match(new URL(path, location.href).href)),
      )
    ).every(Boolean);
    if (!complete) throw new Error("Incomplete offline cache");
    status(
      `Player saved for offline use. ${persisted ? "Persistent storage granted." : "Keep the original MP3s; iOS may clear website storage."} Test once in airplane mode.`,
    );
  } catch {
    status(
      "Offline setup did not complete. Stay online, reload, and try again. Private hosting or browser restrictions may prevent offline access.",
      true,
    );
  }
}
$("keep").onclick = offline;
const libraryReady = (async () => {
  try {
    db = await openDB();
    tracks = await all("tracks");
    playlists = (await read("settings", "playlists")) || [];
    render();
    libraryLoaded = true;
  } catch {
    status(
      "This browser could not open offline storage. Open the site in Safari with normal browsing enabled.",
      true,
    );
    $("import").disabled = true;
    $("empty-import").disabled = true;
  }
  if ("serviceWorker" in navigator)
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => {
        swRegistration = reg;
      })
      .catch(() =>
        status(
          "Offline setup is unavailable. Playback works while this page stays open; use Safari over HTTPS for offline installation.",
          true,
        ),
      );
})();

