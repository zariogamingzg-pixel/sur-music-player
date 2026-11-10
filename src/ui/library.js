/** Library rendering and user input. All persistence is delegated to actions. */
export function createLibraryUI(document, state, library, player) {
  const get = (id) => document.getElementById(id);
  let removalPending = false;
  const bindings = [];
  const rowBindings = [];

  function bindNode(node, event, handler, list = bindings) {
    node[event] = handler;
    list.push([node, event]);
  }

  function bind(id, event, handler) {
    bindNode(get(id), event, handler);
  }

  function clearBindings(list) {
    for (const [node, event] of list) node[event] = null;
    list.length = 0;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function option(text, value) {
    const node = element("option", "", text);
    node.value = value;
    return node;
  }

  function confirmRemoval(track) {
    const dialog = get("delete-dialog");
    if (dialog.open || removalPending) return;
    dialog.returnValue = "cancel";
    dialog.showModal();
    removalPending = true;
    const close = async () => {
      removalPending = false;
      pendingClose = null;
      if (dialog.returnValue === "remove") await library.removeTrack(track.id);
    };
    dialog.addEventListener("close", close, { once: true });
    pendingClose = close;
  }
  let pendingClose;

  function renderTrack(track, index, visible) {
    const row = element("li", "track" + (state.current === track.id ? " current" : ""));
    row.dataset.id = track.id;
    const select = element("button", "track-main");
    select.setAttribute("aria-label", `Play ${track.title} by ${track.artist}`);
    const info = element("span", "song-info");
    info.append(element("strong", "", track.title), element("small", "", track.artist));
    select.append(element("span", "number", state.current === track.id ? "♫" : String(index + 1).padStart(2, "0")), info);
    bindNode(select, "onclick", () => player.select(track.id, visible.map((item) => item.id)), rowBindings);
    const heart = element("button", "heart" + (track.favourite ? " on" : ""), track.favourite ? "♥" : "♡");
    heart.setAttribute("aria-label", `${track.favourite ? "Unfavourite" : "Favourite"} ${track.title}`);
    heart.setAttribute("aria-pressed", String(track.favourite));
    bindNode(heart, "onclick", async () => {
      heart.disabled = true;
      try { await library.toggleFavourite(track.id); }
      finally { heart.disabled = false; }
    }, rowBindings);
    row.append(select, heart);
    if (state.playlists.length) {
      const add = element("select");
      add.setAttribute("aria-label", `Playlist membership for ${track.title}`);
      add.append(option("＋ List", ""));
      for (const playlist of state.playlists) {
        add.append(option(`${playlist.tracks.includes(track.id) ? "✓ " : ""}${playlist.name}`, playlist.id));
      }
      bindNode(add, "onchange", async () => {
        if (!add.value) return;
        add.disabled = true;
        try { await library.togglePlaylistTrack(add.value, track.id); }
        finally { add.disabled = false; add.value = ""; }
      }, rowBindings);
      row.append(add);
    }
    const remove = element("button", "remove", "×");
    remove.setAttribute("aria-label", `Remove ${track.title}`);
    bindNode(remove, "onclick", () => confirmRemoval(track), rowBindings);
    row.append(remove);
    return row;
  }

  return {
    bind() {
      // Keep the picker click synchronous in the original tap for iOS.
      bind("import", "onclick", () => get("files").click());
      bind("empty-import", "onclick", () => get("files").click());
      bind("files", "onchange", async () => {
        try { await library.importFiles(Array.from(get("files").files)); }
        finally { get("files").value = ""; }
      });
      bind("search", "oninput", () => library.setCollection({ search: get("search").value }));
      bind("sort", "onchange", () => library.setCollection({ sort: get("sort").value }));
      for (const button of document.querySelectorAll("[data-view]")) {
        bindNode(button, "onclick", () => library.setCollection({ view: button.dataset.view }));
      }
      bind("playlist", "onchange", () => library.setCollection({ view: get("playlist").value || "all" }));
      bind("new-playlist", "onclick", () => {
        get("playlist-dialog").showModal();
        get("playlist-name").focus();
      });
      bind("close-playlist", "onclick", () => get("playlist-dialog").close());
      bind("playlist-form", "onsubmit", async (event) => {
        event.preventDefault();
        const created = await library.createPlaylist(get("playlist-name").value);
        if (created) {
          get("playlist-dialog").close();
          get("playlist-name").value = "";
        }
      });
      bind("help", "onclick", () => get("guide").showModal());
      bind("close-guide", "onclick", () => get("guide").close());
    },
    render() {
      clearBindings(rowBindings);
      get("count").textContent = `${state.tracks.length} track${state.tracks.length === 1 ? "" : "s"}`;
      for (const button of document.querySelectorAll("[data-view]")) {
        button.classList.toggle("active", button.dataset.view === state.view);
      }
      get("playlist").replaceChildren(option("Playlists", ""), ...state.playlists.map((playlist) => option(playlist.name, playlist.id)));
      get("playlist").value = state.playlists.some((playlist) => playlist.id === state.view) ? state.view : "";
      const visible = library.getVisible();
      get("tracks").replaceChildren();
      get("empty").hidden = state.tracks.length > 0;
      if (state.tracks.length && !visible.length) {
        get("tracks").append(element("li", "status", "No songs here yet. Try another search or add songs to this playlist."));
      }
      visible.forEach((track, index) => get("tracks").append(renderTrack(track, index, visible)));
      const bytes = state.tracks.reduce((total, track) => total + track.size, 0);
      get("storage").textContent = `${(bytes / 1048576).toFixed(1)} MB · stored on this device`;
      for (const id of ["import", "empty-import"]) get(id).disabled = state.importing || state.libraryError;
    },
    dispose() {
      clearBindings(bindings);
      clearBindings(rowBindings);
      if (pendingClose) get("delete-dialog").removeEventListener("close", pendingClose);
    },
  };
}
