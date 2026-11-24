// Voices (DESIGN.md §21): pre-rendered Kokoro clips for every fixed line, played when a
// character says that line, plus the one-voice-at-a-time rule every other voice obeys.
//
//   game.voice.say({ speaker, text, kind, entity })   clip if there is one, else the
//                                                      speaker group's fallback (Lyra's live voice)
//   game.voice.play({ speaker, text, key?, kind })    the clip only, in the foreground (cutscenes,
//                                                      dialogue) -> Promise<{ ok, reason }>
//   game.voice.stop()                                 silence whoever is speaking
//   game.voice.preload([{ speaker, text }])           fetch (and decode) clips ahead of a scene
//   game.voice.claim({ speaker, stop })               an outside voice (claude.ai tts, the
//                                                      browser's) takes the floor; returns a handle
//   game.voice.playStream({ speaker, chunks })        live audio (Kokoro in the browser)
//
// Rules: only one voice at a time; a cutscene outranks Lyra, Lyra outranks villagers;
// a villager never talks over another villager; Lyra's new line replaces her last one.
// Bubbles are voiced only when the speaker is on screen and near the player. Every
// promise resolves (never rejects), immediately when muted or unavailable, so callers
// such as cutscenes can always `await` it. Music ducks while anyone speaks.
//
// Clips live next to the page in voice/: manifest.json, and either loose <key>.mp3 files
// or packs (several clips in one file, sliced by byte range) made by the build.

import { lineKey, speakerIdOf, clipSegments } from './voice_key.js';
import { groupOf, groupEnabled, VOICE_SETTINGS } from './voice_chain.js';

export const PRIORITY = Object.freeze({ villager: 1, lyra: 2, cutscene: 3 });

const TILE = 16;
const NEAR_PX = 12 * TILE; // villagers heard within this of the player
const LYRA_NEAR_PX = 24 * TILE;
const BUBBLE_LATENCY = 1.6; // s: a clip that arrives later than this after its bubble is dropped
const SCENE_LATENCY = 10; // s: a cutscene waits this long for its line
const DEDUPE_S = 2.5; // the same line asked for twice within this is said once
const CACHE_CLIPS = 64; // decoded clips kept (about 2.5 s x 24 kHz x 4 bytes each)

export function priorityOf(speaker, kind) {
  if (kind === 'cutscene' || speaker === 'narrator') return PRIORITY.cutscene;
  if (groupOf(speaker) === 'lyra') return PRIORITY.lyra;
  return PRIORITY.villager;
}

// Both manifest shapes into one map: key -> { speaker, dur, file, off, len }.
//   assets/voice/manifest.json   { key: { speaker, dur } }                  (loose clips)
//   dist/voice/manifest.json     { format, packs: [file], clips: { key: [pack, off, len, dur, speaker] } }
export function readManifest(json) {
  const map = new Map();
  if (!json || typeof json !== 'object') return map;
  if (json.clips && Array.isArray(json.packs)) {
    for (const [key, v] of Object.entries(json.clips)) {
      if (!Array.isArray(v)) continue;
      const [p, off, len, dur, speaker] = v;
      const file = json.packs[p];
      if (file) map.set(key, { speaker: speaker || key.split('-')[0], dur: Number(dur) || 0, file, off, len });
    }
    return map;
  }
  for (const [key, v] of Object.entries(json)) {
    if (v && typeof v === 'object' && typeof v.speaker === 'string') map.set(key, { speaker: v.speaker, dur: Number(v.dur) || 0, file: `${key}.mp3` });
  }
  return map;
}

const done = (reason, ok = false) => Promise.resolve({ ok, reason });

// What the build put next to the page: { manifest: 'voice/manifest.json', live: 'kokoro/' | null }
// (a one-line tag written by scripts/build.mjs). Without it there are no clips to ask for.
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
    this.recent = new Map(); // key -> when it was last asked for
    this.fallbacks = new Map(); // group -> (text, opts) => Promise
    this.out = null;
    this._duckTimer = null;
    this._token = 0;
    this.stats = { played: 0, noClip: 0, late: 0, busy: 0, failed: 0, live: 0 };
    this._bind();
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

  _bind() {
    const bus = this.game?.bus;
    if (!bus?.on) return;
    bus.on('speech', (p) => {
      try {
        this._onSpeech(p);
      } catch (err) {
        console.warn('[voice] speech handler failed', err);
      }
    });
    bus.on('settings_changed', (p) => {
      const k = p?.key;
      if (k === 'voiceVol') this.applyVolume();
      if (k === 'voices' || k === 'voiceVol' || k === 'voiceLyra' || k === 'voiceVillagers' || k === 'voiceNarrator') {
        if (this.current && !groupEnabled(this.settings(), this.current.speaker)) this.stop();
      }
    });
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
    return lineKey(speaker, text);
  }

  // A clip exists for this exact line (false until the manifest has loaded).
  hasClip(speaker, text) {
    if (!this.manifest) this.loadManifest();
    const key = lineKey(speaker, text);
    return !!(key && this.manifest?.has(key));
  }

  enabledFor(speaker) {
    return groupEnabled(this.settings(), speaker);
  }

  busy() {
    return !!this.current;
  }

  speaking(speaker) {
    return !!this.current && (speaker == null || this.current.speaker === speaker);
  }

  // Lyra's live voice (and any other group's) for lines without a clip.
  setFallback(group, fn) {
    if (typeof fn === 'function') this.fallbacks.set(group, fn);
    else this.fallbacks.delete(group);
  }

  // ------------------------------------------------------------------ speech bubbles

  _onSpeech(p) {
    if (!p || !p.text || p.kind === 'thought') return;
    const g = this.game;
    if (g?.state !== 'playing' || g.paused) return;
    const speaker = speakerIdOf(p.speaker, g);
    if (!speaker || !this._audible(p.speaker, speaker)) return;
    this.say({ speaker, text: p.text, kind: p.kind || 'say', entity: p.speaker });
  }

  // On screen and near the player.
  _audible(entity, speaker) {
    const g = this.game;
    if (!entity || typeof entity !== 'object' || !Number.isFinite(entity.x)) return true;
    const cam = g?.camera;
    if (cam?.inView && !cam.inView(entity.x, entity.y, 12)) return false;
    const p = g?.player;
    if (!p || p === entity) return true;
    const r = groupOf(speaker) === 'lyra' ? LYRA_NEAR_PX : NEAR_PX;
    return Math.hypot(entity.x - p.x, entity.y - p.y) <= r;
  }

  // ------------------------------------------------------------------ speaking

  // Say a line: its clip if there is one, else the group's fallback, else nothing.
  say({ speaker, text, kind = 'say', entity = null, priority } = {}) {
    const sp = speakerIdOf(speaker, this.game) || speakerIdOf(entity, this.game);
    const key = lineKey(sp, text);
    if (!key) return done('empty');
    if (!this.enabledFor(sp)) return done('muted');
    const t = this.now();
    const last = this.recent.get(key);
    if (last != null && t - last < DEDUPE_S) return done('duplicate');
    this.recent.set(key, t);
    if (this.recent.size > 200) for (const [k, at] of this.recent) if (t - at > DEDUPE_S) this.recent.delete(k);
    return this.loadManifest().then(() => {
      if (this.manifest.has(key)) return this.play({ speaker: sp, text, key, kind, entity, priority, requestedAt: t, bubble: true });
      const keys = clipSegments(sp, text, (k) => this.manifest.has(k));
      if (keys) return this.play({ speaker: sp, keys, kind, entity, priority, requestedAt: t, bubble: true });
      this.stats.noClip++;
      const fb = this.fallbacks.get(groupOf(sp));
      if (!fb) return { ok: false, reason: 'no_clip' };
      return Promise.resolve()
        .then(() => fb(text, { kind, speaker: sp, priority: priority ?? priorityOf(sp, kind), entity }))
        .then((r) => r || { ok: false, reason: 'fallback' })
        .catch(() => ({ ok: false, reason: 'fallback_failed' }));
    });
  }

  // Play the pre-rendered clip of a line. Resolves when it ends (or at once when muted,
  // missing, outranked or unavailable). Called directly (a cutscene, an open dialogue) the
  // line is in the foreground: it ranks with cutscenes and waits longer for its clip.
  play({ speaker, text, key, keys, kind = 'say', entity = null, priority, requestedAt, maxLatency, bubble = false } = {}) {
    const sp = speakerIdOf(speaker, this.game) || speakerIdOf(entity, this.game);
    // A caller's own id for the line (a script's 'prologue.07') is only a hint: the clip
    // is found by speaker and text.
    const own = key && (!this.manifest || this.manifest.has(key)) ? key : null;
    const k = keys?.length ? keys.join('+') : own || lineKey(sp, text) || key;
    if (!k) return done('empty');
    if (!this.enabledFor(sp)) return done('muted');
    const pr = priority ?? (bubble ? priorityOf(sp, kind) : PRIORITY.cutscene);
    const asked = requestedAt ?? this.now();
    const wait = maxLatency ?? (pr >= PRIORITY.cutscene ? SCENE_LATENCY : BUBBLE_LATENCY);
    return this.loadManifest().then(() => {
      if (!keys?.length && !this.manifest.has(k) && text) {
        const byText = lineKey(sp, text);
        if (byText && this.manifest.has(byText)) return this.play({ speaker: sp, text, key: byText, kind, entity, priority, requestedAt: asked, maxLatency, bubble });
      }
      const parts = keys?.length ? keys : [k];
      if (!parts.every((x) => this.manifest.has(x))) {
        this.stats.noClip++;
        return { ok: false, reason: 'no_clip' };
      }
      if (!this._mayStart(pr)) {
        this.stats.busy++;
        return { ok: false, reason: 'busy' };
      }
      this._preempt();
      const token = ++this._token;
      const cur = { token, key: k, speaker: sp, priority: pr, source: null, external: null, resolve: null, gain: kind === 'whisper' ? 0.55 : 1 };
      const p = new Promise((res) => (cur.resolve = res));
      this.current = cur;
      (parts.length > 1 ? this._joined(parts) : this._buffer(k)).then((buf) => {
        if (this.current !== cur) return;
        if (!buf) return this._finish(token, 'unavailable');
        if (this.now() - asked > wait) {
          this.stats.late++;
          return this._finish(token, 'late');
        }
        this._start(cur, buf, entity);
      });
      return p;
    });
  }

  _mayStart(pr) {
    const c = this.current;
    if (!c) return true;
    if (pr > c.priority) return true;
    return pr === c.priority && pr !== PRIORITY.villager;
  }

  _preempt() {
    if (this.current) this._halt(this.current, 'interrupted');
  }

  _start(cur, buf, entity) {
    const ctx = this.ctx();
    if (!ctx) return this._finish(cur.token, 'no_audio');
    try {
      const out = this._output(ctx);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      let head = out;
      if (cur.gain !== 1 || this._pan(entity)) {
        const g = ctx.createGain();
        g.gain.value = cur.gain;
        g.connect(out);
        head = g;
        const pan = this._pan(entity);
        if (pan && ctx.createStereoPanner) {
          const pn = ctx.createStereoPanner();
          pn.pan.value = pan;
          pn.connect(g);
          head = pn;
        }
      }
      src.connect(head);
      src.onended = () => this._finish(cur.token, 'done');
      cur.source = src;
      src.start();
      this.stats.played++;
      this._duck(true);
    } catch (err) {
      console.warn('[voice] playback failed', err);
      this.stats.failed++;
      this._finish(cur.token, 'failed');
    }
  }

  // A gentle pan toward where the speaker stands (voices stay centered-ish).
  _pan(entity) {
    const cam = this.game?.camera;
    if (!entity || !cam || !Number.isFinite(entity.x) || !(cam.vw > 0)) return 0;
    const dx = entity.x - (cam.x + cam.vw / 2);
    return Math.max(-0.35, Math.min(0.35, dx / cam.vw));
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
      const ctx = this.out.context;
      this.out.gain.setTargetAtTime(gain, ctx.currentTime, 0.05);
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
      c.external?.();
    } catch {
      /* ignore */
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

  // Music dips while anyone talks; it comes back a beat after the last line.
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

  // ------------------------------------------------------------------ outside voices

  // claude.ai's voice or the browser's takes the floor under the same rules. Returns
  // null when outranked, else { release(), active() }; `stop` is called if it is cut off.
  claim({ speaker = 'lyra', kind = 'say', priority, stop } = {}) {
    const sp = speakerIdOf(speaker, this.game) || 'lyra';
    if (!this.enabledFor(sp)) return null;
    const pr = priority ?? priorityOf(sp, kind);
    if (!this._mayStart(pr)) return null;
    this._preempt();
    const token = ++this._token;
    const cur = { token, key: null, speaker: sp, priority: pr, source: null, external: stop || null, resolve: null };
    this.current = cur;
    this._duck(true);
    return { release: () => this._finish(token, 'done'), active: () => this.current === cur };
  }

  // Live audio, chunk by chunk (Float32Array at `sampleRate`), scheduled back to back so
  // the first sentence plays while the next is being made. Resolves when it has played.
  playStream({ speaker = 'lyra', kind = 'say', priority, chunks, sampleRate = 24000 } = {}) {
    const ctx = this.ctx();
    const sp = speakerIdOf(speaker, this.game) || 'lyra';
    if (!ctx || !chunks) return done('no_audio');
    if (!this.enabledFor(sp)) return done('muted');
    const pr = priority ?? priorityOf(sp, kind);
    if (!this._mayStart(pr)) return done('busy');
    this._preempt();
    const token = ++this._token;
    const sources = [];
    let cancelled = false;
    const cur = {
      token, key: null, speaker: sp, priority: pr, source: null, resolve: null,
      external: () => {
        cancelled = true;
        for (const s of sources) {
          try {
            s.stop();
          } catch {
            /* ignore */
          }
        }
      },
    };
    const p = new Promise((res) => (cur.resolve = res));
    this.current = cur;
    const out = this._output(ctx);
    (async () => {
      let at = 0;
      let last = null;
      try {
        for await (const data of chunks) {
          if (cancelled || this.current !== cur) return;
          if (!data || !data.length) continue;
          const buf = ctx.createBuffer(1, data.length, sampleRate);
          buf.getChannelData(0).set(data);
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(out);
          at = Math.max(at, ctx.currentTime + 0.03);
          src.start(at);
          at += buf.duration;
          sources.push(src);
          last = src;
          if (sources.length === 1) {
            this.stats.live++;
            this._duck(true);
          }
        }
      } catch (err) {
        console.warn('[voice] live voice failed', err);
      }
      if (cancelled || this.current !== cur) return;
      if (!last) return this._finish(token, 'empty');
      last.onended = () => this._finish(token, 'done');
    })();
    return p;
  }

  // ------------------------------------------------------------------ loading

  preload(list = []) {
    return this.loadManifest().then(() =>
      Promise.all(
        (list || []).map((l) => {
          const key = l.key || lineKey(speakerIdOf(l.speaker, this.game), l.text);
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

  // Several clips as one buffer, a short breath between them.
  _joined(keys) {
    return Promise.all(keys.map((k) => this._buffer(k))).then((bufs) => {
      const ctx = this.ctx();
      if (!ctx || bufs.some((b) => !b)) return null;
      const rate = bufs[0].sampleRate;
      const gap = Math.round(rate * 0.12);
      const len = bufs.reduce((n, b) => n + b.length, 0) + gap * (bufs.length - 1);
      try {
        const out = ctx.createBuffer(1, len, rate);
        const data = out.getChannelData(0);
        let at = 0;
        for (const b of bufs) {
          data.set(b.getChannelData(0), at);
          at += b.length + gap;
        }
        return out;
      } catch {
        return null;
      }
    });
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
