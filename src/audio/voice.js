// Cutscene voices (DESIGN.md §21). Voices play only in cutscenes: every spoken line of the
// story engine's scenes (src/story/*) has a pre-rendered clip, made the author's way
// (scripts/voice/: Chatterbox from the author's reference voices, three takes, Whisper
// picks the one with every word right) with the time each word is spoken. Villagers, Lyra
// in the world and in the chat, and people talking to each other are text only.
//
//   game.voice.play({ speaker, text, maxLatency?, onStart?, wanted? }) -> Promise<{ ok, reason }>
//       plays the clip of that exact line; onStart({ duration, words }) the moment it really
//       plays (words: [[word, start, end], …] in seconds, for the captions); wanted() false
//       drops it unplayed; resolves when it ends (or at once: muted, no clip, unavailable)
//   game.voice.stop()                       silence it
//   game.voice.preload([{ speaker, text }]) fetch and decode clips ahead of a line
//   game.voice.clip(speaker, text)          { dur, words } of a line's clip, or null
//   game.voice.elapsed()                    seconds into the playing clip, or -1
//
// Every promise resolves (never rejects), so a cutscene can always `await` it; a cutscene
// never waits on a voice (src/story/cutscene.js). The music dips while a line is spoken.
//
// Clips live next to the page in voice/: manifest.json and packs (several clips in one
// file, sliced by byte range) made by the build, or loose <key>.mp3 files.

import { lineKey, normalizeSpeaker } from './voice_key.js';

export const VOICE_SETTINGS = Object.freeze({
  voices: true, // the cutscenes are spoken
  voiceVol: 0.85,
});

const SCENE_LATENCY = 10; // s a line waits for its clip unless the caller says less
const CACHE_CLIPS = 48; // decoded clips kept

// Voices on and audible?
export function voicesOn(settings) {
  if (settings?.voices === false) return false;
  const vol = Number(settings?.voiceVol ?? VOICE_SETTINGS.voiceVol);
  return vol > 0;
}

function cleanWords(words) {
  if (!Array.isArray(words)) return [];
  const out = [];
  for (const w of words) {
    if (!Array.isArray(w) || typeof w[0] !== 'string') continue;
    const s = Number(w[1]);
    const e = Number(w[2]);
    if (!Number.isFinite(s)) continue;
    out.push([w[0], s, Number.isFinite(e) ? Math.max(s, e) : s]);
  }
  return out;
}

// Both manifest shapes into one map: key -> { dur, words, file, off?, len? }.
//   assets/voice/manifest.json  { format, clips: { key: { file, dur, words, … } } }       (loose)
//   dist/voice/manifest.json    { format, packs: [file], clips: { key: [pack, off, len, dur, words] } }
export function readManifest(json) {
  const map = new Map();
  const clips = json && typeof json === 'object' ? json.clips : null;
  if (!clips || typeof clips !== 'object') return map;
  const packs = Array.isArray(json.packs) ? json.packs : null;
  for (const [key, v] of Object.entries(clips)) {
    if (packs && Array.isArray(v)) {
      const [p, off, len, dur, words] = v;
      const file = packs[p];
      if (file && Number.isFinite(off) && len > 0) map.set(key, { file, off, len, dur: Number(dur) || 0, words: cleanWords(words) });
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      map.set(key, { file: v.file || `${key}.mp3`, dur: Number(v.dur) || 0, words: cleanWords(v.words) });
    }
  }
  return map;
}

const done = (reason, ok = false) => Promise.resolve({ ok, reason });

function stillWanted(wanted) {
  if (typeof wanted !== 'function') return true;
  try {
    return !!wanted();
  } catch {
    return false;
  }
}

// What the build put next to the page: { manifest: 'voice/manifest.json' } (a one-line tag
// written by scripts/build.mjs). Without it there are no clips to ask for.
export function pageVoices() {
  try {
    return (typeof window !== 'undefined' && window.__HEARTHLIGHT_VOICES__) || null;
  } catch {
    return null;
  }
}

export class VoicePlayer {
  constructor(game, opts = {}) {
    this.game = game;
    this.config = opts.config ?? pageVoices();
    const url = opts.manifestUrl ?? this.config?.manifest ?? (opts.fetch ? 'voice/manifest.json' : null);
    this.manifestUrl = url;
    this.base = opts.base ?? (url ? url.slice(0, url.lastIndexOf('/') + 1) : 'voice/');
    this._fetch = opts.fetch || null;
    this._ctx = opts.ctx || null;
    this._now = opts.now || null;
    this.manifest = null; // Map once loaded (empty when there are no clips)
    this._manifestP = null;
    this.buffers = new Map(); // key -> AudioBuffer, oldest first
    this.files = new Map(); // file -> Promise<ArrayBuffer|null>
    this.loading = new Map(); // key -> Promise<AudioBuffer|null>
    this.current = null;
    this.out = null;
    this._duckTimer = null;
    this._token = 0;
    this.stats = { played: 0, noClip: 0, late: 0, failed: 0 };
    this.game?.bus?.on?.('settings_changed', (p) => {
      if (p?.key === 'voiceVol') this.applyVolume();
      if ((p?.key === 'voices' || p?.key === 'voiceVol') && !voicesOn(this.settings())) this.stop();
    });
  }

  // ------------------------------------------------------------------ plumbing

  now() {
    if (this._now) return this._now();
    return typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000;
  }

  ctx() {
    const c = this._ctx || this.game?.audio?.ctx || null;
    return c && c.state !== 'closed' ? c : null;
  }

  settings() {
    return this.game?.settings || {};
  }

  enabled() {
    return voicesOn(this.settings());
  }

  fetchBytes(url) {
    const f = this._fetch || (typeof fetch === 'function' ? fetch : null);
    if (!f) return Promise.resolve(null);
    return Promise.resolve()
      .then(() => f(url))
      .then((r) => (r && r.ok !== false ? r.arrayBuffer() : null))
      .catch(() => null);
  }

  // The manifest is small; it loads once, on first need.
  loadManifest() {
    if (this._manifestP) return this._manifestP;
    this._manifestP = Promise.resolve()
      .then(() => {
        const f = this._fetch || (typeof fetch === 'function' ? fetch : null);
        return f && this.manifestUrl ? f(this.manifestUrl) : null;
      })
      .then((r) => (r && r.ok !== false ? r.json() : null))
      .catch(() => null)
      .then((json) => {
        this.manifest = readManifest(json);
        return this.manifest;
      });
    return this._manifestP;
  }

  keyFor(speaker, text) {
    return lineKey(normalizeSpeaker(speaker), text);
  }

  // The clip of this exact line ({ dur, words }), or null (also before the manifest loaded).
  clip(speaker, text) {
    if (!this.manifest) {
      this.loadManifest();
      return null;
    }
    const m = this.manifest.get(this.keyFor(speaker, text));
    return m ? { dur: m.dur, words: m.words } : null;
  }

  hasClip(speaker, text) {
    return !!this.clip(speaker, text);
  }

  busy() {
    return !!this.current;
  }

  speaking() {
    return !!this.current?.source;
  }

  // Seconds into the clip that is playing (the captions follow it), or -1.
  elapsed() {
    const c = this.current;
    const ctx = this.ctx();
    if (!c?.source || !ctx || !Number.isFinite(c.startedAt)) return -1;
    return Math.max(0, ctx.currentTime - c.startedAt);
  }

  // ------------------------------------------------------------------ playing

  // Play the clip of a line. Resolves when it ends (or at once when muted, missing or
  // unavailable). A new line replaces the one playing.
  //   maxLatency  seconds the line may wait for its clip (a cutscene passes its reading time)
  //   onStart     called with { duration, words } the moment the clip really plays
  //   wanted      () => false once the caller has moved on: the clip is dropped unplayed
  play({ speaker, text, maxLatency, onStart = null, wanted = null } = {}) {
    const key = this.keyFor(speaker, text);
    if (!key) return done('empty');
    if (!this.enabled()) return done('muted');
    const asked = this.now();
    const wait = maxLatency ?? SCENE_LATENCY;
    return this.loadManifest().then(() => {
      if (!stillWanted(wanted)) return { ok: false, reason: 'unwanted' };
      const m = this.manifest.get(key);
      if (!m) {
        this.stats.noClip++;
        return { ok: false, reason: 'no_clip' };
      }
      if (this.current) this._halt(this.current, 'interrupted');
      const token = ++this._token;
      const cur = { token, key, source: null, resolve: null, onStart, words: m.words, startedAt: NaN };
      const p = new Promise((res) => (cur.resolve = res));
      this.current = cur;
      this._buffer(key).then((buf) => {
        if (this.current !== cur) return;
        if (!buf) return this._finish(token, 'unavailable');
        if (this.now() - asked > wait) {
          this.stats.late++;
          return this._finish(token, 'late');
        }
        if (!stillWanted(wanted)) return this._finish(token, 'unwanted');
        this._start(cur, buf);
      });
      return p;
    });
  }

  _start(cur, buf) {
    const ctx = this.ctx();
    if (!ctx) return this._finish(cur.token, 'no_audio');
    // A context the browser has not let run yet (iPhone before a tap, a hidden tab) would
    // hold the clip silent and never end it: ask it to run for next time, and skip this one.
    if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
      try {
        ctx.resume?.()?.catch?.(() => {});
      } catch {
        /* not allowed outside a gesture */
      }
      return this._finish(cur.token, 'suspended');
    }
    try {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this._output(ctx));
      src.onended = () => this._finish(cur.token, 'done');
      cur.source = src;
      const at = ctx.currentTime;
      src.start(at);
      cur.startedAt = at;
      this.stats.played++;
      this._duck(true);
      try {
        cur.onStart?.({ duration: Number(buf.duration) || 0, words: cur.words });
      } catch {
        /* the caller's business */
      }
    } catch (err) {
      console.warn('[voice] playback failed', err);
      this.stats.failed++;
      this._finish(cur.token, 'failed');
    }
  }

  _output(ctx) {
    if (this.out && this.out.context === ctx) return this.out;
    // iPhone: WebAudio is silenced by the ring/silent switch unless the page asks for
    // playback (Safari 16.4+). A voice the player turned on should be heard.
    try {
      if (typeof navigator !== 'undefined' && navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback';
    } catch {
      /* not offered here */
    }
    this.out = ctx.createGain();
    const master = this.game?.audio?.master;
    this.out.connect(master && master.context === ctx ? master : ctx.destination);
    this.applyVolume();
    return this.out;
  }

  applyVolume() {
    if (!this.out) return;
    const v = Math.max(0, Math.min(1, Number(this.settings().voiceVol ?? VOICE_SETTINGS.voiceVol)));
    const gain = v * v * 1.15;
    try {
      this.out.gain.setTargetAtTime(gain, this.out.context.currentTime, 0.05);
    } catch {
      this.out.gain.value = gain;
    }
  }

  _finish(token, reason) {
    const c = this.current;
    if (!c || c.token !== token) return;
    this.current = null;
    try {
      c.resolve?.({ ok: reason === 'done', reason });
    } catch {
      /* ignore */
    }
    this._duck(false);
  }

  _halt(c, reason) {
    if (this.current === c) this.current = null;
    try {
      if (c.source) {
        c.source.onended = null;
        c.source.stop();
      }
    } catch {
      /* already stopped */
    }
    try {
      c.resolve?.({ ok: false, reason });
    } catch {
      /* ignore */
    }
  }

  stop() {
    const c = this.current;
    if (!c) return;
    this._halt(c, 'stopped');
    this._duck(false);
  }

  // Music dips while a line is spoken; it comes back a beat after the last one.
  _duck(on) {
    const audio = this.game?.audio;
    if (!audio?.duck) return;
    if (this._duckTimer) {
      clearTimeout(this._duckTimer);
      this._duckTimer = null;
    }
    if (on) audio.duck(true);
    else {
      this._duckTimer = setTimeout(() => {
        this._duckTimer = null;
        if (!this.current) audio.duck(false);
      }, 350);
    }
  }

  // ------------------------------------------------------------------ loading

  preload(list = []) {
    if (!this.enabled()) return Promise.resolve(0);
    return this.loadManifest().then(() =>
      Promise.all(
        (list || []).map((l) => {
          const key = this.keyFor(l.speaker, l.text);
          return key && this.manifest.has(key) ? this._buffer(key) : null;
        }),
      ).then((bufs) => bufs.filter(Boolean).length),
    );
  }

  _file(file) {
    let p = this.files.get(file);
    if (!p) {
      p = this.fetchBytes(`${this.base}${file}`).then((ab) => {
        if (!ab) this.files.delete(file); // try again next time
        return ab;
      });
      this.files.set(file, p);
    }
    return p;
  }

  _buffer(key) {
    const hit = this.buffers.get(key);
    if (hit) {
      this.buffers.delete(key);
      this.buffers.set(key, hit);
      return Promise.resolve(hit);
    }
    const pending = this.loading.get(key);
    if (pending) return pending;
    const m = this.manifest?.get(key);
    if (!m) return Promise.resolve(null);
    const p = this._file(m.file)
      .then((ab) => {
        if (!ab) return null;
        const bytes = Number.isFinite(m.off) ? ab.slice(m.off, m.off + m.len) : ab.slice(0);
        return this._decode(bytes);
      })
      .then((buf) => {
        if (buf) {
          this.buffers.set(key, buf);
          while (this.buffers.size > CACHE_CLIPS) this.buffers.delete(this.buffers.keys().next().value);
        }
        return buf;
      })
      .catch(() => null)
      .finally(() => this.loading.delete(key));
    this.loading.set(key, p);
    return p;
  }

  // decodeAudioData in both its promise and its older callback form (old Safari).
  _decode(bytes) {
    const ctx = this.ctx();
    if (!ctx) return Promise.resolve(null);
    return new Promise((res) => {
      let settled = false;
      const ok = (b) => {
        if (!settled) (settled = true), res(b || null);
      };
      const bad = () => ok(null);
      try {
        const r = ctx.decodeAudioData(bytes, ok, bad);
        if (r && typeof r.then === 'function') r.then(ok, bad);
      } catch {
        bad();
      }
    });
  }
}
