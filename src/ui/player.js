import { formatTime } from "../utils/format.js";

/** DOM presentation and control binding only; audio behavior lives in services. */
export function createPlayerUI(document, state) {
  const get = (id) => document.getElementById(id);
  const controls = ["play", "previous", "next", "shuffle", "repeat", "seek"];
  return {
    bind(player) {
      get("play").onclick = player.toggle;
      get("next").onclick = () => player.next();
      get("previous").onclick = () => player.next(-1);
      get("shuffle").onclick = player.toggleShuffle;
      get("repeat").onclick = player.cycleRepeat;
      get("seek").oninput = () => player.seekPercent(get("seek").value);
    },
    render() {
      for (const id of ["play", "previous", "next"]) get(id).disabled = !state.tracks.length;
      get("shuffle").setAttribute("aria-pressed", String(state.shuffled));
      get("repeat").setAttribute("aria-pressed", String(state.repeat !== 0));
      get("repeat").setAttribute("aria-label", `Repeat ${["off", "collection", "song"][state.repeat]}`);
      get("repeat").dataset.mode = String(state.repeat);
    },
    setTrack(track) {
      get("playing-title").textContent = track?.title || "A soundtrack of your own";
      get("playing-artist").textContent = track?.artist || "Choose a song to begin";
      get("seek").value = "0";
      get("elapsed").textContent = get("duration").textContent = "0:00";
    },
    setPlayback(playing) {
      get("play").setAttribute("aria-label", playing ? "Pause" : "Play");
      get("record").classList.toggle("is-playing", playing);
    },
    setBuffering() {
      get("record").classList.toggle("is-playing", false);
    },
    setProgress({ currentTime, duration }) {
      get("duration").textContent = formatTime(duration);
      get("elapsed").textContent = formatTime(currentTime);
      get("seek").value = Number.isFinite(duration) && duration ? String((currentTime / duration) * 100) : "0";
    },
    dispose() {
      for (const id of controls) {
        get(id).onclick = null;
        get(id).oninput = null;
      }
    },
  };
}
