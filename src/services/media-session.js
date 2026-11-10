/** Optional browser integration; no DOM access or ownership of playback. */
export function createMediaSession({
  navigator = globalThis.navigator,
  MediaMetadata = globalThis.MediaMetadata,
  location = globalThis.location,
  URL = globalThis.URL,
} = {}) {
  const session = navigator.mediaSession;
  const registered = new Set();
  const unsupported = new Set();
  let actions;

  function refreshActions() {
    if (!session || !actions) return;
    for (const [action, handler] of Object.entries(actions)) {
      try {
        // setActionHandler replaces one action's handler; it does not add a
        // listener. Reuse the callbacks when reasserting an active session.
        session.setActionHandler(action, handler);
        registered.add(action);
      } catch (error) {
        if (!unsupported.has(action)) {
          unsupported.add(action);
          console.warn(`Sur: Media Session action "${action}" is unavailable.`, error);
        }
      }
    }
  }

  function prepareAudioSession(reset = true) {
    if (!("audioSession" in navigator)) return;
    try {
      // Reassert the iOS audio category after a background interruption.
      if (reset) navigator.audioSession.type = "auto";
      navigator.audioSession.type = "playback";
    } catch {
      // Optional API. HTML audio must continue when the category is unsupported.
    }
  }

  function updatePosition(audio) {
    if (!session?.setPositionState || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    try {
      session.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate,
        position: Math.min(audio.currentTime, audio.duration),
      });
    } catch {
      // Some engines reject transient duration/rate values while changing src.
      // Position is advisory; the next media event will retry it.
    }
  }

  return {
    prepareAudioSession,
    updatePosition,
    bind(player) {
      if (actions) return;
      actions = {
        play: player.resume,
        pause: player.pause,
        previoustrack: () => player.next(-1),
        nexttrack: () => player.next(),
        // Remove JS interval-seek handlers. The system button layout is
        // still chosen by the browser/OS; null cannot guarantee its icons.
        seekbackward: null,
        seekforward: null,
        seekto: ({ seekTime }) => player.seekTo(seekTime),
      };
      refreshActions();
      prepareAudioSession(false);
    },
    setTrack(track) {
      if (session && MediaMetadata) {
        session.metadata = new MediaMetadata({
          title: track.title,
          artist: track.artist,
          album: "Sur · Your collection",
          artwork: [{
            src: new URL("music-icon.png", location.href).href,
            sizes: "512x512",
            type: "image/png",
          }],
        });
      }
    },
    setPlayback(playing, current, audio) {
      if (session) session.playbackState = playing ? "playing" : current ? "paused" : "none";
      // Startup registration may precede the platform's active media session.
      // Reassert after real playback starts, including track changes/resumes.
      if (playing) refreshActions();
      updatePosition(audio);
    },
    clear() {
      if (session) {
        session.metadata = null;
        session.playbackState = "none";
      }
    },
    dispose() {
      for (const action of registered) {
        try { session.setActionHandler(action, null); } catch {
          // Support can change when a browser tears down the media session.
        }
      }
      registered.clear();
      actions = null;
      this.clear();
    },
  };
}
