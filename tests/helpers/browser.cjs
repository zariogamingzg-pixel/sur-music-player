const { createIndexedDB } = require('./indexeddb.cjs');

class Element {
  constructor(tag = '') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.value = '';
    this.dataset = {};
    this.textContent = '';
    this.attrs = {};
    this.listeners = new Map();
    this.classes = new Map();
    this.classList = { toggle: (key, enabled) => this.classes.set(key, enabled) };
    this.paused = true;
    this.currentTime = 0;
    this.duration = 180;
    this.playbackRate = 1;
    this.open = false;
    this.files = [];
  }
  set src(value) { this.attrs.src = value; }
  get src() { return this.attrs.src; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute(key, value) { this.attrs[key] = value; }
  getAttribute(key) { return this.attrs[key]; }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(event, fn, options) {
    const entries = this.listeners.get(event) || [];
    entries.push({ fn, once: options?.once });
    this.listeners.set(event, entries);
  }
  removeEventListener(event, fn) {
    this.listeners.set(event, (this.listeners.get(event) || []).filter((entry) => entry.fn !== fn));
  }
  emit(event) {
    const entries = [...(this.listeners.get(event) || [])];
    for (const entry of entries) if (entry.once) this.removeEventListener(event, entry.fn);
    return Promise.all(entries.map((entry) => entry.fn()));
  }
  click() { return this.onclick?.(); }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; return this.emit('close'); }
  load() { this.currentTime = 0; this.emit('emptied'); }
  async play() { this.paused = false; this.emit('play'); this.emit('playing'); }
  pause() { this.paused = true; this.emit('pause'); }
}

function createBrowser({ database = createIndexedDB(), media = false } = {}) {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  get('sort').value = 'title';
  const tabs = ['all', 'favourites'].map((view) => {
    const node = new Element('button'); node.dataset.view = view; return node;
  });
  const handlers = new Map();
  const categories = [];
  const activeURLs = new Map();
  const revokedURLs = [];
  let nextURL = 0;
  const URLApi = class extends URL {
    static createObjectURL(blob) {
      const url = `blob:sur-test-${++nextURL}`;
      activeURLs.set(url, blob);
      return url;
    }
    static revokeObjectURL(url) { activeURLs.delete(url); revokedURLs.push(url); }
  };
  const navigator = {};
  if (media) {
    navigator.mediaSession = {
      playbackState: 'none',
      setActionHandler: (action, handler) => handlers.set(action, handler),
      setPositionState(state) { this.position = state; },
    };
    navigator.audioSession = {
      get type() { return categories.at(-1) || 'auto'; },
      set type(value) {
        if (navigator.rejectCategory) throw new Error('unsupported');
        categories.push(value);
      },
    };
  }
  const env = {
    document: {
      getElementById: get,
      createElement: (tag) => new Element(tag),
      querySelectorAll: (selector) => selector === '[data-view]' ? tabs : [],
    },
    navigator,
    indexedDB: database.indexedDB,
    location: { href: 'https://sur.test/' },
    URL: URLApi,
    MediaMetadata: class { constructor(metadata) { Object.assign(this, metadata); } },
    timers: { setTimeout, clearTimeout },
  };
  return { env, get, tabs, database, handlers, categories, activeURLs, revokedURLs };
}

module.exports = { Element, createBrowser };
