/** One state object per app instance. Services own mutations; UI reads it. */
export function createAppState() {
  return {
    tracks: [],
    playlists: [],
    view: "all",
    search: "",
    sort: "title",
    libraryLoaded: false,
    libraryError: false,
    importing: false,
    savingPlaylist: false,
    current: null,
    pendingTrack: null,
    queue: [],
    orderedQueue: [],
    queueIndex: -1,
    shuffled: false,
    repeat: 0,
  };
}
