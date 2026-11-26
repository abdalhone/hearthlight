// Procedural WebAudio: sound effects with positional falloff and generative music
// that follows the game (title, day, night, combat), crossfaded. Nothing is created
// until unlock() runs inside a user gesture; until then every call is a silent no-op.
//
// Sound names: swing, hit, hurt, bolt, bolt_hit, heal, door_open, door_close, pickup, coin,
// chop, mine, splash, step, levelup, ui_click, ui_open, ui_close, talk_blip, death, bow,
// dodge, eat, quest, downed, revive, sleep, error, magic.

import { SFX, SFX_GAP } from '../ui/sfx.js';
import { MusicPlayer } from '../ui/music.js';
import { tone, noise, fm, makeNoiseBuffer, makeImpulse } from '../ui/synth.js';
import { VoicePlayer } from '../audio/voice.js';
import { holderOf } from './party.js';

const MAX_VOICES = 28; // concurrent effects; quieter extras are dropped
// Background sounds (`other: true`, e.g. other people's footfalls) keep their own spacing,
// so they never swallow the same sound of the player's own, and they leave the last voices
// free for what the player does (a swing, a hit, their own step).
const BACKGROUND_VOICES = 14;
const FULL_RADIUS = 90; // world px around the camera center heard at full volume
const FALLOFF = 300; // further world px over which a sound fades to silence

// Gain and pan for a world-positioned sound heard from the camera center.
export function spatialize(x, y, cx, cy, halfWidth) {
  const dx = x - cx;
  const dy = y - cy;
  const d = Math.hypot(dx, dy);
  let gain = 1;
  if (d > FULL_RADIUS) {
    const k = 1 - (d - FULL_RADIUS) / FALLOFF;
    gain = k <= 0 ? 0 : k * k;
  }
  const hw = halfWidth > 0 ? halfWidth : 160;
  const pan = Math.max(-0.75, Math.min(0.75, dx / (hw * 1.4)));
  return { gain, pan };
}

// Which music fits the moment.
export function chooseTrack({ state, engaged, hour, phase }) {
  if (state === 'title' || state === 'boot') return 'title';
  if (state === 'sleeping') return 'none';
  if (state !== 'playing') return 'none';
  if (engaged) return 'combat';
  const h = Number(hour);
  if (phase === 'night' || (Number.isFinite(h) && (h >= 20 || h < 5.5))) return 'night';
  return 'day';
}

export class Audio {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.unlocked = false;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.reverbIn = null;
    this.noiseBuffer = null;
    this.music = null;
    this.wantTrack = 'none';
    this.lastPlay = new Map();
    this.voiceEnds = [];
    this.engaged = false;
    this.engageHold = 0;
    this.checkTimer = 0;
    this.forced = null; // setMusic() override ('none' silences until cleared with null)
    this._visBound = false;
    this.ducking = false; // music dips while a voice speaks (src/audio/voice.js)
    // Character voices share this context and master bus (DESIGN.md §21).
    try {
      if (game && !game.voice) game.voice = new VoicePlayer(game);
    } catch (err) {
      console.warn('[audio] voices unavailable', err);
    }
  }

  unlock() {
    if (this.unlocked) {
      if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
    if (!AC) return;
    // iPhone: ask for playback before the context exists, or the ring/silent switch can
    // keep the first sounds (and the cutscene voices) muted (Safari 16.4+).
    try {
      if (typeof navigator !== 'undefined' && navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback';
    } catch {
      /* not offered here */
    }
    try {
      this.ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.unlocked = true;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    // A low-pass on everything, opened wide; it closes while the player bleeds out (§27).
    this.muffleFilter = ctx.createBiquadFilter();
    this.muffleFilter.type = 'lowpass';
    this.muffleFilter.frequency.value = 20000;
    this.muffleFilter.Q.value = 0.7;
    this.master.connect(this.muffleFilter);
    this.muffleFilter.connect(comp);
    comp.connect(ctx.destination);
    this.muffled = 0;

    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);

    // A shared room reverb: music and some effects send into it.
    try {
      const conv = ctx.createConvolver();
      conv.buffer = makeImpulse(ctx, 2.2, 2.6);
      const wetGain = ctx.createGain();
      wetGain.gain.value = 0.32;
      this.reverbIn = ctx.createGain();
      this.reverbIn.connect(conv);
      conv.connect(wetGain);
      wetGain.connect(this.master);
    } catch {
      this.reverbIn = null;
    }
    this.noiseBuffer = makeNoiseBuffer(ctx, 1.5);
    this.music = new MusicPlayer(this);
    this.applyVolumes();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    this._bindVisibility();
    // Start whatever the current moment calls for.
    this.wantTrack = 'none';
    this._refreshMusic(true);
    this.game.voice?.loadManifest?.();
  }

  _bindVisibility() {
    if (this._visBound || typeof document === 'undefined') return;
    this._visBound = true;
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.visibilityState === 'hidden') this.ctx.suspend().catch(() => {});
      else this.ctx.resume().catch(() => {});
    });
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.game.settings || {};
    const now = this.ctx.currentTime;
    const music = Math.max(0, Math.min(1, Number(s.musicVol ?? 0.45)));
    const sfx = Math.max(0, Math.min(1, Number(s.sfxVol ?? 0.7)));
    const duck = this.ducking ? 0.4 : 1;
    this.musicBus.gain.setTargetAtTime(music * music * 0.9 * duck, now, this.ducking ? 0.08 : this._unduck ? 0.35 : 0.05);
    this._unduck = false;
    this.sfxBus.gain.setTargetAtTime(sfx * sfx, now, 0.05);
    this.game.voice?.applyVolume?.();
  }

  // Lower the music under a voice, and bring it back slowly afterwards.
  duck(on) {
    const v = !!on;
    if (v === this.ducking) return;
    this.ducking = v;
    this._unduck = !v;
    this.applyVolumes();
  }

  // play(name, { x, y, volume, pitch, other }): x/y in world px enable positional falloff;
  // `other` marks a background sound (someone else's footfall) that yields to the player's.
  play(name, opts = {}) {
    if (!this.ctx || this.ctx.state === 'closed') return;
    const recipe = SFX[name];
    if (!recipe) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const gap = SFX_GAP[name] ?? 0.02;
    const key = opts.other ? `${name}~other` : name;
    const last = this.lastPlay.get(key) ?? -1;
    if (now - last < gap) return;

    let gain = opts.volume ?? 1;
    let pan = 0;
    if (Number.isFinite(opts.x) && Number.isFinite(opts.y)) {
      const cam = this.game.camera;
      if (cam) {
        const sp = spatialize(opts.x, opts.y, cam.x + cam.vw / 2, cam.y + cam.vh / 2, cam.vw / 2);
        gain *= sp.gain;
        pan = sp.pan;
      }
    }
    if (gain < 0.02) return;

    // Voice budget: drop new sounds while too many are still ringing.
    let live = 0;
    for (let i = this.voiceEnds.length - 1; i >= 0; i--) {
      if (this.voiceEnds[i] < now) this.voiceEnds.splice(i, 1);
      else live++;
    }
    if (live >= (opts.other ? BACKGROUND_VOICES : MAX_VOICES)) return;

    this.lastPlay.set(key, now);
    const out = ctx.createGain();
    out.gain.value = gain;
    let head = out;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      out.connect(p);
      head = p;
    }
    head.connect(this.sfxBus);
    let wet = out;
    if (this.reverbIn) {
      wet = ctx.createGain();
      wet.gain.value = gain * 0.8;
      wet.connect(this.reverbIn);
    }
    const nb = this.noiseBuffer;
    const S = {
      wet,
      tone: (t, o) => tone(ctx, o.out || out, t, o),
      noise: (t, o) => noise(ctx, o.out || out, t, nb, o),
      fm: (t, o) => fm(ctx, o.out || out, t, o),
    };
    const pitch = Number.isFinite(opts.pitch) && opts.pitch > 0 ? opts.pitch : 1;
    try {
      recipe(S, now + 0.005, pitch);
    } catch (err) {
      console.warn('[audio] sound failed', name, err);
    }
    this.voiceEnds.push(now + 1.2);
    // Release the per-sound routing once it has rung out.
    setTimeout(() => {
      try {
        out.disconnect();
        if (head !== out) head.disconnect();
        if (wet !== out) wet.disconnect();
      } catch {
        /* already gone */
      }
    }, 2600);
  }

  // A heartbeat (DESIGN §27): lub-dub, low and close, under the muffled world.
  // `bpm` (optional) brings the dub closer to the lub as the heart races.
  heartbeat(strength = 0.7, bpm = 60) {
    if (!this.ctx || this.ctx.state === 'closed') return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.01;
    const out = ctx.createGain();
    const s = Math.max(0.2, Math.min(1, strength));
    out.gain.value = 0.9 * s * Math.max(0.25, Number(this.game.settings?.sfxVol ?? 0.7));
    // Past the muffle, straight out: it is inside your own head.
    out.connect(ctx.destination);
    try {
      tone(ctx, out, t, { type: 'sine', freq: 64, to: 44, dur: 0.16, a: 0.006, gain: 0.85 });
      tone(ctx, out, t, { type: 'triangle', freq: 120, to: 60, dur: 0.07, gain: 0.25, filter: { type: 'lowpass', freq: 400 } });
      const gap = Math.max(0.11, Math.min(0.2, (60 / Math.max(30, bpm)) * 0.34));
      tone(ctx, out, t + gap, { type: 'sine', freq: 56, to: 40, dur: 0.18, a: 0.006, gain: 0.6 });
    } catch {
      /* sound is optional */
    }
    setTimeout(() => {
      try {
        out.disconnect();
      } catch {
        /* already gone */
      }
    }, 900);
  }

  // 0 (clear) .. 1 (underwater): how muffled the world sounds.
  setMuffle(amount) {
    const a = Math.max(0, Math.min(1, Number(amount) || 0));
    if (!this.ctx || !this.muffleFilter || Math.abs(a - this.muffled) < 0.01) return;
    this.muffled = a;
    const f = a <= 0.001 ? 20000 : 3200 * Math.pow(0.08, a);
    this.muffleFilter.frequency.setTargetAtTime(f, this.ctx.currentTime, a > 0 ? 0.25 : 0.6);
  }

  // Force a track ('title'|'day'|'night'|'combat'|'none'); pass null to follow the game again.
  setMusic(track) {
    this.forced = track === null || track === undefined ? null : track;
    this._refreshMusic(true);
  }

  _refreshMusic(immediate = false) {
    const want = this.forced ?? this._autoTrack();
    if (want === this.wantTrack && !immediate) return;
    this.wantTrack = want;
    if (this.music) this.music.set(want);
  }

  _autoTrack() {
    const g = this.game;
    return chooseTrack({ state: g.state, engaged: this.engaged, hour: g.clock?.hour, phase: g.clock?.phase });
  }

  // Are enemies engaging the player or Lyra? Checked a few times a second.
  _scanEngagement() {
    const g = this.game;
    if (g.state !== 'playing' || !g.player || !g.entities) return false;
    const p = g.player;
    const c = holderOf(g) || g.companion;
    // lastAttackedAt may be stamped with the game clock or the real-time clock: accept either.
    const recent = (a) => {
      const at = a?.lastAttackedAt;
      if (!Number.isFinite(at) || !a.lastAttacker || a.lastAttacker.dead || a.lastAttacker.removed) return false;
      const d1 = (g.clock?.t ?? 0) - at;
      const d2 = (g.time ?? 0) - at;
      return (d1 >= 0 && d1 < 5) || (d2 >= 0 && d2 < 5);
    };
    if (recent(p) || recent(c)) return true;
    const ct = c?.behavior?.currentTarget;
    if (ct && !ct.dead && !ct.removed && (ct.isAlive ? ct.isAlive() : true)) return true;
    const combat = g.combat;
    const near = (who, r) => {
      if (!who) return false;
      const list = g.entities.list || [];
      const r2 = r * r;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.type !== 'actor' || e === p || e === c || e.removed || e.dead || !e.isAlive?.()) continue;
        const dx = e.x - who.x;
        const dy = e.y - who.y;
        if (dx * dx + dy * dy > r2) continue;
        let hostile = false;
        try {
          hostile = combat?.isHostile ? combat.isHostile(e, p) : false;
        } catch {
          hostile = false;
        }
        if (hostile) return true;
      }
      return false;
    };
    return near(p, 120) || near(c, 100);
  }

  update(dt) {
    if (!this.ctx) return;
    // Bleeding out: the world goes far away and thick (§27).
    const fx = this.game.survival?.fxState?.() || null;
    this.setMuffle(fx ? 0.55 + 0.4 * (1 - fx.frac) : this.game.state === 'dead' ? 0.9 : 0);
    this.checkTimer -= dt;
    if (this.checkTimer <= 0) {
      this.checkTimer = 0.4;
      const now = this._scanEngagement();
      // Hysteresis: combat music starts at once, ends after a calm stretch.
      if (now) {
        this.engaged = true;
        this.engageHold = 6;
      } else if (this.engageHold > 0) {
        this.engageHold -= 0.4;
        if (this.engageHold <= 0) this.engaged = false;
      } else this.engaged = false;
      this._refreshMusic();
    }
    this.music?.update();
  }
}
