/* ------------------------------------------------------------------ */
/*  Film archive · captured photos, clips and postcard progress        */
/*                                                                     */
/*  Owns the object URLs of the current session and mirrors everything */
/*  the film panel / postcard strip / ending card need into the Vue    */
/*  store. The engine keeps no DOM references.                          */
/* ------------------------------------------------------------------ */

const SESSION_CLIPS = 12;

function openAlbum() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('dandelion-photo-album', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('photos', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function photoTransaction(db, mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('photos', mode);
    const request = operation(transaction.objectStore('photos'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
  });
}

export class FilmArchive {
  constructor({ abilities, ui, onJourneyComplete, onReadError }) {
    this.abilities = abilities;
    this.ui = ui;
    this.onJourneyComplete = onJourneyComplete;
    this.items = [];
    this.closed = false;
    this.database = openAlbum().catch(() => null);
    this.ready = this.database.then(async db => {
      if (!db) throw new Error('Album unavailable');
      const records = await photoTransaction(db, 'readonly', photos => photos.getAll());
      if (this.closed) return;
      for (const record of records) {
        this.items.push({ ...record, url: URL.createObjectURL(record.blob) });
      }
      this.items.sort((a, b) => a.at - b.at);
      this.sync();
    }).catch(() => { if (!this.closed) onReadError?.(); });
  }

  /* ---------------- media ---------------- */

  async addCapture(blob, filename, meta = {}) {
    if (!blob) return null;
    await this.ready;
    if (this.closed) return null;
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      blob,
      filename,
      at: Date.now(),
      type: meta.type === 'video' ? 'video' : 'photo',
      cardTitle: meta.cardTitle || '',
      anchor: meta.anchor || null,
      duration: meta.duration || 0
    };

    if (item.type === 'photo') {
      try {
        await photoTransaction(await this.database, 'readwrite', photos => photos.put(item));
        item.saved = true;
      } catch {
        item.saved = false;
      }
    }
    if (this.closed) return null;
    item.url = URL.createObjectURL(blob);
    const clips = this.items.filter(entry => entry.type === 'video');
    if (item.type === 'video' && clips.length >= SESSION_CLIPS) {
      const old = clips[0];
      this.items.splice(this.items.indexOf(old), 1);
      URL.revokeObjectURL(old.url);
    }
    this.items.push(item);
    this.sync();
    return item;
  }

  sync() {
    this.ui.film.items = this.items.map((item) => ({
      id: item.id,
      url: item.url,
      filename: item.filename,
      type: item.type,
      cardTitle: item.cardTitle,
      duration: item.duration
    }));
    this.ui.film.count = this.items.length;
  }

  setPanelOpen(open) {
    this.ui.film.open = !!open;
  }

  togglePanel() {
    this.ui.film.open = !this.ui.film.open;
  }

  closePanel() {
    this.ui.film.open = false;
  }

  clear() {
    this.closed = true;
    this.database.then(db => db?.close());
    for (const item of this.items) URL.revokeObjectURL(item.url);
    this.items.length = 0;
    this.sync();
  }

  /* ---------------- postcards ---------------- */

  anchors() {
    return this.ui.postcards.map((entry) => entry);
  }

  refreshPostcards(anchors) {
    const cards = anchors.items.filter((item) => item.def.postcard);
    this.ui.postcards = cards.map((item) => ({
      id: item.def.postcard,
      title: item.def.cardTitle,
      on: this.abilities.hasPostcard(item.def.postcard)
    }));
    return cards;
  }

  /** Returns true when this capture completed the set of five. */
  checkJourneyEnd(anchors) {
    const cards = anchors.items.filter((item) => item.def.postcard);
    if (!cards.length) return false;
    const complete = cards.every((item) => this.abilities.hasPostcard(item.def.postcard));
    if (!complete) {
      return false;
    }
    this.ui.journeyEnd.album = true;
    this.ui.journeyEnd.cards = cards.map((item) => item.def.cardTitle);
    this.ui.journeyEnd.visible = true;
    this.onJourneyComplete?.();
    return true;
  }

  dismissJourneyEnd() {
    this.ui.journeyEnd.visible = false;
  }
}