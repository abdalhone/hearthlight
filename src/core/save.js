import { SAVE_KEY } from './constants.js';
import { utf8Bytes, hash32 } from '../ui/format.js';
import { isClosedSave, addPastLife, readPastLives } from '../survival/past_lives.js';

// Saving (DESIGN.md §14): local storage always, plus the player's own claude.ai
// document when the `db` and `user` capabilities are available. Load picks the newer.
// Pure helpers are exported for unit tests; the class touches browser globals only
// inside methods.

export const CLOUD_DOC_LIMIT = 250 * 1024; // the store allows 256 KiB per document; keep a margin
export const LOCAL_LIMIT = 4.5 * 1024 * 1024; // most browsers give ~5 MB per origin
export const AUTOSAVE_SECONDS = 60;
export const CLOUD_HIDDEN_MIN_MS = 120 * 1000; // visibilitychange cloud saves: at most every 2 minutes
export const CLOUD_MIN_MS = 8 * 1000; // any cloud write: at most every 8 s
const MIND_EXPORT_KIND = 'hearthlight-mind';

// Keys that must never reach a save file, at any depth.
const SECRET_KEYS = new Set(['apiKey', 'api_key', 'apikey']);

export function saveReplacer(key, value) {
  if (SECRET_KEYS.has(key)) return undefined;
  return value;
}

export function serializeSave(data) {
  return JSON.stringify(data, saveReplacer);
}

// Hash of the save without its timestamp, to tell whether anything changed.
export function contentHash(data) {
  return hash32(JSON.stringify(data, (k, v) => (k === 'savedAt' || SECRET_KEYS.has(k) ? undefined : v)));
}

export function isValidSave(d) {
  return !!d && typeof d === 'object' && !Array.isArray(d) && typeof d.version === 'number' && !!d.player;
}

export function savedAtOf(d) {
  const t = Number(d?.savedAt);
  return Number.isFinite(t) ? t : 0;
}

// Newer wins; an invalid side never wins; ties prefer the local copy (already on device).
export function pickNewer(local, cloud) {
  const l = isValidSave(local) ? local : null;
  const c = isValidSave(cloud) ? cloud : null;
  if (!l) return c ? { data: c, source: 'cloud' } : { data: null, source: null };
  if (!c) return { data: l, source: 'local' };
  return savedAtOf(c) > savedAtOf(l) ? { data: c, source: 'cloud' } : { data: l, source: 'local' };
}

export function parseSave(text) {
  if (!text || typeof text !== 'string') return null;
  try {
    const d = JSON.parse(text);
    return isValidSave(d) ? d : null;
  } catch {
    return null;
  }
}

// Whether a cloud write should happen now.
export function cloudDecision({ reason, now, lastCloudAt = 0, lastCloudHash = null, hash, bytes, inFlight = false }) {
  if (inFlight) return { ok: false, why: 'busy' };
  if (bytes > CLOUD_DOC_LIMIT) return { ok: false, why: 'too_large' };
  if (hash && hash === lastCloudHash) return { ok: false, why: 'unchanged' };
  const since = now - lastCloudAt;
  if (reason === 'hidden' && since < CLOUD_HIDDEN_MIN_MS) return { ok: false, why: 'rate' };
  if (since < CLOUD_MIN_MS) return { ok: false, why: 'rate' };
  return { ok: true, why: '' };
}

// Mind export file content, and its inverse (accepts a bare mind object too).
export function buildMindExport(mindData, { name = 'Lyra', day = 0, exportedAt = Date.now() } = {}) {
  return JSON.stringify({ kind: MIND_EXPORT_KIND, version: 1, name, day, exportedAt, mind: mindData }, saveReplacer, 1);
}

export function readMindExport(json) {
  let d = json;
  if (typeof json === 'string') {
    try {
      d = JSON.parse(json);
    } catch {
      return { ok: false, message: "That file isn't valid JSON, so it can't be a mind export." };
    }
  }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { ok: false, message: "That file doesn't hold a mind." };
  if (d.kind === MIND_EXPORT_KIND) {
    if (!d.mind || typeof d.mind !== 'object') return { ok: false, message: 'The export is missing its mind data.' };
    return { ok: true, mind: d.mind, name: d.name || 'Lyra' };
  }
  // A raw mind.serialize() object: recognise it by the fields every mind keeps.
  const keys = ['soul', 'memory', 'memories', 'relationships', 'emotions', 'diary'];
  if (keys.some((k) => k in d)) return { ok: true, mind: d, name: d.soul?.name || 'Lyra' };
  return { ok: false, message: "That file doesn't look like a Hearthlight mind export." };
}

function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(fallback);
      }
    }, ms);
    Promise.resolve(promise).then(
      (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

export class SaveManager {
  constructor(game) {
    this.game = game;
    this.timer = 0;
    this.pending = null; // a save reason queued by an event, run on the next update
    this.lastLocalAt = 0;
    this.lastCloudAt = 0;
    this.lastCloudHash = null;
    this.cloudInFlight = null;
    this.cloudDisabled = false; // a refused write disables cloud saving for this visit
    this.warnedSize = false;
    this.uidPromise = null;
    this.lastSource = null;
    this._offs = [];
  }

  async init() {
    const bus = this.game.bus;
    const queue = (reason) => () => {
      if (this.game.state === 'playing') this.pending = this.pending || reason;
    };
    this._offs.push(bus.on('player_sleep', queue('auto')));
    this._offs.push(bus.on('quest', queue('auto')));
    this._offs.push(
      bus.on('level_up', (p) => {
        if (p?.entity === this.game.player) queue('auto')();
      }),
    );
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this._onHidden();
      });
      window.addEventListener('pagehide', () => this._saveLocalNow('hidden'));
    }
  }

  // ---------- capabilities ----------

  cloudAvailable() {
    const rt = this.game.runtime;
    return !this.cloudDisabled && !!this.game.settings?.cloudSave && !!rt?.db && !!rt?.user;
  }

  async _uid() {
    const user = this.game.runtime?.user;
    if (!user) return null;
    if (!this.uidPromise) {
      this.uidPromise = withTimeout(user.id(), 5000, null).then((id) => {
        if (!id) this.uidPromise = null; // try again later; identity can arrive late
        return id || null;
      });
    }
    return this.uidPromise;
  }

  async _cloudDoc() {
    if (!this.cloudAvailable()) return null;
    const uid = await this._uid();
    if (!uid) return null;
    try {
      return this.game.runtime.db.doc(`data/users/${uid}/save`);
    } catch {
      return null;
    }
  }

  // ---------- reading ----------

  // A save whose life has ended (DESIGN §27) is kept for its memorial but never continued.
  hasLocalSave() {
    const d = this._readLocal();
    return !!d && !isClosedSave(d);
  }

  _readLocal() {
    try {
      return parseSave(localStorage.getItem(SAVE_KEY));
    } catch {
      return null;
    }
  }

  async _readCloud(timeoutMs = 6000) {
    const run = async () => {
      const doc = await this._cloudDoc();
      if (!doc) return null;
      const snap = await doc.get();
      if (!snap?.exists) return null;
      const body = snap.data() || {};
      return parseSave(typeof body.data === 'string' ? body.data : null);
    };
    return withTimeout(run(), timeoutMs, null);
  }

  async hasSave() {
    if (this.hasLocalSave()) return true;
    const rt = this.game.runtime;
    if (rt?.ready && !rt.resolved) await withTimeout(rt.ready, 3500, null);
    if (!this.cloudAvailable()) return false;
    // The newer copy decides: a life that ended on this device stays ended.
    const { data } = pickNewer(this._readLocal(), await this._readCloud(3500));
    return !!data && !isClosedSave(data);
  }

  async load() {
    const local = this._readLocal();
    let cloud = null;
    const rt = this.game.runtime;
    if (rt?.ready && !rt.resolved) await withTimeout(rt.ready, 4000, null);
    if (this.cloudAvailable()) cloud = await this._readCloud(6000);
    const { data, source } = pickNewer(local, cloud);
    this.lastSource = source;
    if (source === 'cloud' && cloud) {
      this.lastCloudHash = contentHash(cloud);
      // Keep the device copy in step with the newer cloud copy.
      this._writeLocal(serializeSave(cloud));
    }
    if (isClosedSave(data)) {
      // That story ended (§27): keep its memorial, never load it.
      if (data.memorial) addPastLife(data.memorial);
      return null;
    }
    return data;
  }

  // The player died with no kept flame (DESIGN §27): this save is closed for good. The final
  // state is written once more with its memorial, here and in the cloud, so neither copy
  // can be continued; the memorial joins Past lives.
  async closeLife(memorial) {
    const g = this.game;
    let data = null;
    try {
      data = g.player && g.map ? g.serialize() : null;
    } catch (err) {
      console.warn('[save] could not serialize the last moment', err);
    }
    if (!data) data = { version: 1, player: { id: 'player' } };
    data.savedAt = Date.now();
    data.closed = true;
    data.flags = { ...(data.flags || {}), life_closed: true };
    data.memorial = memorial || null;
    const json = serializeSave(data);
    this._writeLocal(json);
    this.pending = null;
    if (memorial) addPastLife(memorial);
    try {
      this.lastCloudAt = 0;
      this.lastCloudHash = null;
      await this._saveCloud(data, json, 'closed');
    } catch {
      /* the device copy is closed; the cloud tries again never */
    }
    return true;
  }

  pastLives() {
    return readPastLives();
  }

  // ---------- writing ----------

  _collect() {
    const g = this.game;
    if (!g.player || !g.map) return null;
    try {
      const data = g.serialize();
      data.savedAt = Date.now();
      return data;
    } catch (err) {
      console.warn('[save] could not serialize the game', err);
      return null;
    }
  }

  _writeLocal(json) {
    if (utf8Bytes(json) > LOCAL_LIMIT) {
      if (!this.warnedSize) {
        this.warnedSize = true;
        this.game.ui?.toast?.('Your save has grown too large for this browser. Lyra will prune old memories at the next sleep.', 'warn');
      }
      return false;
    }
    try {
      localStorage.setItem(SAVE_KEY, json);
      this.lastLocalAt = Date.now();
      return true;
    } catch {
      return false;
    }
  }

  _saveLocalNow(reason = 'auto') {
    if (this.game.state !== 'playing' && this.game.state !== 'sleeping') return null;
    const data = this._collect();
    if (!data) return null;
    const json = serializeSave(data);
    const ok = this._writeLocal(json);
    return { data, json, ok };
  }

  // reason: 'auto' (local only), 'manual' | 'sleep' | 'hidden' (local + cloud)
  async save(reason = 'manual') {
    const res = this._saveLocalNow(reason);
    if (!res) return false;
    this.timer = 0;
    let cloudOk = null;
    if (reason !== 'auto') cloudOk = await this._saveCloud(res.data, res.json, reason);
    if (reason === 'manual') {
      const where = cloudOk ? 'on this device and in your account' : 'on this device';
      this.game.ui?.toast?.(res.ok ? `Game saved ${where}.` : 'Saving failed: this browser is blocking storage.', res.ok ? 'good' : 'warn');
    }
    return res.ok || !!cloudOk;
  }

  async _saveCloud(data, json, reason) {
    if (!this.cloudAvailable()) return false;
    const body = { data: json, savedAt: data.savedAt };
    const bytes = utf8Bytes(json) + 64;
    const hash = contentHash(data);
    const decision = cloudDecision({
      reason,
      now: Date.now(),
      lastCloudAt: this.lastCloudAt,
      lastCloudHash: this.lastCloudHash,
      hash,
      bytes,
      inFlight: !!this.cloudInFlight,
    });
    if (!decision.ok) {
      if (decision.why === 'too_large' && !this.warnedSize) {
        this.warnedSize = true;
        this.game.ui?.toast?.('This save is too large for your claude.ai account, so it was kept on this device only.', 'warn');
      }
      return decision.why === 'unchanged';
    }
    const write = (async () => {
      const doc = await this._cloudDoc();
      if (!doc) return false;
      try {
        await doc.set(body);
        this.lastCloudAt = Date.now();
        this.lastCloudHash = hash;
        return true;
      } catch (err) {
        const code = err?.code;
        if (code === 'invalid_argument' || code === 'quota_exceeded' || code === 'revoked' || code === 'not_granted' || code === 'capability_disabled' || code === 'capability_removed') {
          this.cloudDisabled = true;
          this.game.ui?.toast?.('Cloud saving is unavailable here, so your game is kept on this device.', 'warn');
        }
        console.warn('[save] cloud save failed', code || err);
        return false;
      }
    })();
    this.cloudInFlight = write;
    try {
      return await write;
    } finally {
      this.cloudInFlight = null;
    }
  }

  _onHidden() {
    if (this.game.state !== 'playing') return;
    // Write locally right away (the page may be frozen any moment), then try the cloud.
    const res = this._saveLocalNow('hidden');
    if (res) this._saveCloud(res.data, res.json, 'hidden').catch(() => {});
  }

  update(dt) {
    if (this.game.state !== 'playing') return;
    if (this.pending) {
      const reason = this.pending;
      this.pending = null;
      this.save(reason).catch(() => {});
      return;
    }
    this.timer += dt;
    if (this.timer >= AUTOSAVE_SECONDS) {
      this.timer = 0;
      this.save('auto').catch(() => {});
    }
  }

  // ---------- Lyra's mind as a file ----------

  exportMind() {
    const c = this.game.companion;
    const mind = c?.mind;
    if (!mind?.serialize) return null;
    let data;
    try {
      data = mind.serialize();
    } catch (err) {
      console.warn('[save] mind export failed', err);
      return null;
    }
    return buildMindExport(data, { name: c.name || 'Lyra', day: this.game.clock?.day || 0 });
  }

  importMind(json) {
    const c = this.game.companion;
    if (!c?.mind?.deserialize) return { ok: false, message: 'Lyra is not here to receive it. Start or continue a game first.' };
    const r = readMindExport(json);
    if (!r.ok) return r;
    try {
      c.mind.deserialize(r.mind);
      // Exports leave out a soul that was never changed: she gets her own back.
      if (!r.mind.soul && typeof c.mind.resetSoul === 'function') c.mind.resetSoul();
    } catch (err) {
      console.warn('[save] mind import failed', err);
      return { ok: false, message: 'That mind could not be restored. The file may be from an incompatible version.' };
    }
    this.pending = 'auto';
    return { ok: true, message: `${r.name}'s mind has been restored.` };
  }
}
