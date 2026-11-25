/* ------------------------------------------------------------------ */
/*  Abilities · progression state                                      */
/*                                                                     */
/*  Everything the player unlocks lives here: ability flags, the plant */
/*  cap derived from them, anchor states and a small local save.       */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = 'wind-passing.progress.v1';

export const ABILITY_ORDER = ['camera', 'multiPlant', 'lift', 'restore', 'time'];

export const ABILITY_LABELS = {
  camera: '相机',
  multiPlant: '种三株',
  lift: '起飞',
  restore: '种六株',
  time: '拨动日月'
};

const DEFAULT_ABILITIES = {
  camera: false,
  multiPlant: false,
  lift: false,
  restore: false,
  time: false
};

function defaultState() {
  return {
    abilities: { ...DEFAULT_ABILITIES },
    maxPlants: 1,
    anchors: {},
    postcards: [],
    settings: {}
  };
}

function deriveMaxPlants(abilities) {
  if (abilities.time) return 15;
  if (abilities.restore) return 6;
  if (abilities.multiPlant) return 3;
  return 1;
}

function safeStorage() {
  try {
    return window.localStorage;
  } catch (err) {
    return null;
  }
}

export class Abilities {
  constructor() {
    this.storage = safeStorage();
    this.listeners = new Set();
    this.state = this._load();
    this._applyDerived();
  }

  _load() {
    const base = defaultState();
    if (!this.storage) return base;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return base;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return base;

      if (saved.abilities && typeof saved.abilities === 'object') {
        for (const name of ABILITY_ORDER) {
          if (saved.abilities[name] === true) base.abilities[name] = true;
        }
      }
      if (saved.anchors && typeof saved.anchors === 'object') {
        for (const [id, value] of Object.entries(saved.anchors)) {
          if (typeof value === 'string') base.anchors[id] = value;
        }
      }
      if (Array.isArray(saved.postcards)) {
        base.postcards = saved.postcards.filter((id) => typeof id === 'string');
      }
      if (saved.settings && typeof saved.settings === 'object') {
        base.settings = { ...saved.settings };
      }
      return base;
    } catch (err) {
      return base;
    }
  }

  _applyDerived() {
    this.state.maxPlants = deriveMaxPlants(this.state.abilities);
  }

  save() {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (err) {
      /* file:// or private mode may reject writes; in-memory state still works. */
    }
  }

  has(name) {
    return this.state.abilities[name] === true;
  }

  get maxPlants() {
    return this.state.maxPlants;
  }

  get anchors() {
    return this.state.anchors;
  }

  getAnchorState(id) {
    return this.state.anchors[id] || null;
  }

  setAnchorState(id, state) {
    this.state.anchors[id] = state;
    this.save();
    this._emit('anchor');
  }

  unlock(name) {
    if (!ABILITY_ORDER.includes(name)) return false;
    if (this.state.abilities[name]) return false;

    this.state.abilities[name] = true;
    this._applyDerived();
    this.save();
    this._emit(name);
    return true;
  }

  addPostcard(id) {
    if (!id || this.state.postcards.includes(id)) return false;
    this.state.postcards.push(id);
    this.save();
    this._emit('postcard');
    return true;
  }

  hasPostcard(id) {
    return this.state.postcards.includes(id);
  }

  reset() {
    this.state = defaultState();
    if (this.storage) {
      try {
        this.storage.removeItem(STORAGE_KEY);
      } catch (err) {
        /* noop */
      }
    }
    this._emit('reset');
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(reason) {
    for (const fn of this.listeners) {
      try {
        fn(this.state, reason);
      } catch (err) {
        console.error(err);
      }
    }
  }
}