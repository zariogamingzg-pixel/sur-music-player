/** Owns the single audio element, object URLs and playback command ordering.
 * UI is notified through callbacks; collection selection is supplied explicitly.
 */
export function createAudioPlayer({
  audio, state, storage, mediaSession, getVisible,
  URL = globalThis.URL,
  notify = () => {},
  onChange = () => {},
  onTrack = () => {},
  onPlayback = () => {},
  onBuffering = () => {},
  onProgress = () => {},
}) {
  let currentURL = null;
  let playRequest = 0;
  let playbackCommand = 0;
  let disposed = false;
  const listeners = [];

  function listen(event, handler) {
    audio.addEventListener(event, handler);
    listeners.push([event, handler]);
  }

  function setQueue(ids, id) {
    state.orderedQueue = [...ids];
    state.queue = [...ids];
    if (state.shuffled) {
      state.queue = state.queue.filter((item) => item !== id);
      for (let i = state.queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
      }
      if (id && ids.includes(id)) state.queue.unshift(id);
    }
    state.queueIndex = state.queue.indexOf(id);
  }

  function syncPlayback(playing) {
    onPlayback(playing);
    mediaSession.setPlayback(playing, state.current, audio);
  }

  async function resume() {
    const command = ++playbackCommand;
    if (disposed || !state.current || !audio.getAttribute("src")) {
      syncPlayback(false);
      return false;
    }
    mediaSession.prepareAudioSession();
    try {
      // Keep play() in the control action, without a database or other await.
      await audio.play();
      if (command !== playbackCommand) return false;
      return !audio.paused;
    } catch (error) {
      if (command !== playbackCommand || error.name === "AbortError") return false;
      syncPlayback(false);
      notify("Could not resume audio. Open Sur and tap Play to try again.", true);
      return false;
    }
  }

  function pause() {
    ++playRequest;
    state.pendingTrack = null;
    ++playbackCommand;
    audio.pause();
    syncPlayback(false);
  }

  function releaseSource() {
    audio.removeAttribute("src");
    audio.load();
    if (currentURL) URL.revokeObjectURL(currentURL);
    currentURL = null;
  }

  async function playTrack(id) {
    if (disposed) return;
    const request = ++playRequest;
    state.pendingTrack = id;
    try {
      const track = state.tracks.find((item) => item.id === id);
      if (!track) return;
      const blob = await storage.getAudio(id);
      if (request !== playRequest || !state.tracks.some((item) => item.id === id)) return;
      if (!blob) {
        notify("This audio file is missing. Remove it and import the original again.", true);
        return;
      }
      audio.pause();
      releaseSource();
      state.current = id;
      currentURL = URL.createObjectURL(blob);
      audio.src = currentURL;
      onTrack(track);
      mediaSession.setTrack(track);
      onChange();
      if (await resume() && request === playRequest) notify("Playing from your offline library.");
    } catch (error) {
      if (request !== playRequest || error.name === "AbortError") return;
      notify("Playback did not start. Tap Play to try again. Check that the file is a playable MP3.", true);
    } finally {
      if (request === playRequest) state.pendingTrack = null;
    }
  }

  function next(direction = 1, automatic = false) {
    if (!state.tracks.length || disposed) return;
    if (!state.queue.length) {
      const ids = getVisible().map((track) => track.id);
      setQueue(ids.length ? ids : state.tracks.map((track) => track.id), state.current);
    }
    if (!state.queue.length) return;
    if (automatic && state.repeat === 2) {
      audio.currentTime = 0;
      return resume();
    }
    const target = state.queueIndex < 0
      ? (direction < 0 ? state.queue.length - 1 : 0)
      : state.queueIndex + direction;
    if (automatic && target >= state.queue.length && state.repeat === 0) {
      notify("End of this collection.");
      return;
    }
    state.queueIndex = (target + state.queue.length) % state.queue.length;
    return playTrack(state.queue[state.queueIndex]);
  }

  async function toggle() {
    if (state.pendingTrack) {
      pause();
      return;
    }
    if (!state.current) {
      const visible = getVisible();
      const list = visible.length ? visible : state.tracks;
      if (list.length) {
        setQueue(list.map((track) => track.id), list[0].id);
        await playTrack(list[0].id);
      }
      return;
    }
    if (audio.paused) await resume();
    else pause();
  }

  function seekTo(value) {
    if (Number.isFinite(value) && Number.isFinite(audio.duration)) {
      audio.currentTime = Math.max(0, Math.min(value, audio.duration));
      mediaSession.updatePosition(audio);
    }
  }

  function progress() {
    onProgress({ currentTime: audio.currentTime, duration: audio.duration });
    mediaSession.updatePosition(audio);
  }

  // A play request alone does not establish audible output. Wait for playing.
  listen("playing", () => syncPlayback(true));
  for (const event of ["pause", "emptied"]) {
    listen(event, () => syncPlayback(false));
  }
  listen("waiting", onBuffering);
  listen("seeked", () => mediaSession.updatePosition(audio));
  listen("ratechange", () => mediaSession.updatePosition(audio));
  listen("loadedmetadata", progress);
  listen("timeupdate", progress);
  listen("ended", () => {
    syncPlayback(false);
    return next(1, true);
  });
  listen("error", () => {
    syncPlayback(false);
    if (audio.getAttribute("src")) {
      notify("This file could not be played. Try another MP3 or re-import the original.", true);
    }
  });

  const player = {
    playTrack, setQueue, resume, pause, toggle, next, seekTo,
    select(id, ids) {
      setQueue(ids, id);
      return playTrack(id);
    },
    seekPercent(percent) {
      if (Number.isFinite(audio.duration)) seekTo((Number(percent) / 100) * audio.duration);
    },
    toggleShuffle() {
      state.shuffled = !state.shuffled;
      setQueue(state.orderedQueue.length ? state.orderedQueue : getVisible().map((track) => track.id), state.pendingTrack || state.current);
      onChange();
      notify(state.shuffled ? "Shuffle on." : "Shuffle off. Original play order restored.");
    },
    cycleRepeat() {
      state.repeat = (state.repeat + 1) % 3;
      onChange();
      notify(`Repeat ${["off", "collection", "song"][state.repeat]}.`);
    },
    removeTrack(id) {
      if (state.pendingTrack === id) pause();
      const removedIndex = state.queue.indexOf(id);
      if (state.current === id) {
        pause();
        releaseSource();
        state.current = null;
        onTrack(null);
        mediaSession.clear();
      }
      state.queue = state.queue.filter((item) => item !== id);
      state.orderedQueue = state.orderedQueue.filter((item) => item !== id);
      state.queueIndex = state.current ? state.queue.indexOf(state.current) : removedIndex - 1;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pause();
      releaseSource();
      state.current = null;
      for (const [event, handler] of listeners) audio.removeEventListener(event, handler);
      mediaSession.dispose();
    },
  };
  mediaSession.bind(player);
  return player;
}
