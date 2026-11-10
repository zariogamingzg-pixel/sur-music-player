export function formatTime(value) {
  return Number.isFinite(value)
    ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`
    : "0:00";
}

let idSequence = 0;
export function createID() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // Local database keys, not authentication tokens. Older browsers and HTTP
  // previews do not always expose randomUUID.
  return `sur-${Date.now().toString(36)}-${++idSequence}-${Math.random().toString(36).slice(2)}`;
}

export function trackFromFile(file) {
  const name = file.name.replace(/\.mp3$/i, "");
  const separator = name.indexOf(" - ");
  return {
    id: createID(),
    title: separator > 0 ? name.slice(separator + 3) : name,
    artist: separator > 0 ? name.slice(0, separator) : "Your collection",
    size: file.size,
    added: Date.now(),
    favourite: false,
    fingerprint: fileFingerprint(file),
  };
}

export function fileFingerprint(file) {
  return `${file.name}|${file.size}|${file.lastModified}`;
}
