// Lyra's spoken voice (DESIGN.md §13, §21). Her lines go through the game's voice layer
// (src/audio/voice.js): a pre-rendered Kokoro clip when the line has one. Lines without
// a clip (Claude's replies, generated lines) take the first voice that works here:
//   live Kokoro in the browser (opt-in) -> claude.ai's voice (`tts`) -> the browser's
//   speechSynthesis (only if the player enabled it) -> silence, the words on screen.
// Nothing here ever blocks the game or the chat, and only one voice speaks at a time.

import { VoicePlayer } from '../../audio/voice.js';
import { lyraVoiceChain } from '../../audio/voice_chain.js';
import { LiveKokoro } from '../../audio/kokoro_live.js';

const FEMALE_VOICE = /female|woman|samantha|victoria|karen|moira|tessa|fiona|zira|serena|allison|ava|susan|aria|jenny|libby|sonia|natasha|hazel|kate|emma|amy|joanna|salli|kimberly|ivy|nicky|google uk english female|google us english/i;
// Voices that sound natural, best first (neural/online voices beat the old robotic ones).
const BEST_VOICE = [/natural|neural|online/i, /premium|enhanced|siri/i, /google/i, FEMALE_VOICE];

// Strip what should not be read aloud: stage directions, symbols, emoji.
export function speakable(text) {
  return String(text || '')
    .replace(/\*[^*]{1,80}\*/g, ' ')
    .replace(/♪/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1900);
}

// The best English female voice the browser offers (neural first), or null.
export function pickBrowserVoice(voices) {
  const list = Array.isArray(voices) ? voices : [];
  const en = list.filter((v) => /^en/i.test(v.lang || ''));
  const pool = en.length ? en : list;
  const female = pool.filter((v) => FEMALE_VOICE.test(v.name || ''));
  for (const rx of BEST_VOICE) {
    const hit = (female.length ? female : pool).find((v) => rx.test(v.name || ''));
    if (hit) return hit;
  }
  return female[0] || pool[0] || null;
}

export class Voice {
  constructor(game) {
    this.game = game;
    this.noticeShown = false;
    this._pick = null;
    this.live = new LiveKokoro(game);
    try {
      if (game && !game.voice) game.voice = new VoicePlayer(game);
    } catch {
      /* the voice layer is a nicety */
    }
    // Lines of hers with no clip come back here.
    game?.voice?.setFallback?.('lyra', (text, opts) => this.speakLive(text, opts));
    game?.bus?.on?.('settings_changed', (p) => {
      if (p?.key === 'kokoroLive' && p.value) this.live.start();
      if (p?.key === 'kokoroLive' && !p.value) this.live.stopSpeaking();
    });
    if (game?.settings?.kokoroLive) this.live.start({ quiet: true });
  }

  // The old switch: read aloud the replies that have no recorded line.
  enabled() {
    return !!this.game?.settings?.voice;
  }

  // One of her chat replies.
  speak(text) {
    const say = speakable(text);
    if (!say) return;
    const gv = this.game?.voice;
    if (gv?.say) {
      gv.say({ speaker: 'lyra', text: say, kind: 'reply' });
      return;
    }
    this.speakLive(say, { kind: 'reply' });
  }

  // Which voices could speak a line with no clip, best first.
  chain(kind = 'reply') {
    const g = this.game;
    return lyraVoiceChain({
      settings: g?.settings || {},
      kind,
      hasClip: false,
      kokoro: { supported: this.live.supported(), failed: this.live.state === 'failed' },
      tts: !!(g?.runtime?.tts && typeof g.runtime.tts.speak === 'function'),
      synth: hasSynth(),
    });
  }

  // Say a line with no clip: the first voice that works. Resolves { ok, reason }.
  async speakLive(text, { kind = 'reply', priority } = {}) {
    const say = speakable(text);
    if (!say) return { ok: false, reason: 'empty' };
    for (const method of this.chain(kind)) {
      let r = null;
      try {
        if (method === 'kokoro') r = await this.live.speak(say, { kind, priority });
        else if (method === 'tts') r = await this._tts(say, kind, priority);
        else if (method === 'browser') r = await this._browserSpeak(say, kind, priority);
      } catch {
        r = null;
      }
      // Busy, muted or cut off: that line is over. Unavailable: try the next voice.
      if (r && r.reason !== 'unavailable') return r;
    }
    return { ok: false, reason: 'silent' };
  }

  stop() {
    this.game?.voice?.stop?.();
    this.live.stopSpeaking();
    this._stopOutside();
  }

  _stopOutside() {
    const tts = this.game?.runtime?.tts;
    if (tts && typeof tts.stop === 'function') {
      try {
        if (!tts.active || tts.active()) Promise.resolve(tts.stop()).catch(() => {});
      } catch {
        /* ignore */
      }
    }
    try {
      if (hasSynth() && window.speechSynthesis.speaking) window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
  }

  _claim(kind, priority) {
    const gv = this.game?.voice;
    if (!gv?.claim) return { release() {}, active: () => true };
    return gv.claim({ speaker: 'lyra', kind, priority, stop: () => this._stopOutside() });
  }

  _tts(text, kind, priority) {
    const tts = this.game?.runtime?.tts;
    if (!tts || typeof tts.speak !== 'function') return Promise.resolve({ ok: false, reason: 'unavailable' });
    const hold = this._claim(kind, priority);
    if (!hold) return Promise.resolve({ ok: false, reason: 'busy' });
    let p;
    try {
      p = tts.speak(text, { voice: this.game.settings.voiceName || 'airy' });
    } catch (err) {
      p = Promise.reject(err);
    }
    return Promise.resolve(p).then(
      () => {
        hold.release();
        return { ok: true, reason: 'tts' };
      },
      (e) => {
        hold.release();
        return this._ttsFailed(e);
      },
    );
  }

  _ttsFailed(e) {
    const code = e && typeof e === 'object' ? e.code : null;
    if (code === 'not_granted') {
      // The viewer turned reading aloud off: respect it, and do not use another voice.
      try {
        this.game.setSetting?.('voice', false);
      } catch {
        /* ignore */
      }
      if (!this.noticeShown) {
        this.noticeShown = true;
        this.game?.ui?.chat?.addMessage?.({ from: 'system', text: "Reading aloud is turned off for this page, so Lyra's voice is off. You can still read her replies here." });
      }
      return { ok: false, reason: 'not_granted' };
    }
    if (code === 'unavailable' || code === 'not_declared' || code === 'capability_disabled') return { ok: false, reason: 'unavailable' };
    // no_gesture, stopped, busy, rate_limited: skip this line quietly.
    return { ok: false, reason: code || 'failed' };
  }

  _browserSpeak(text, kind, priority) {
    if (!hasSynth()) return Promise.resolve({ ok: false, reason: 'unavailable' });
    const hold = this._claim(kind, priority);
    if (!hold) return Promise.resolve({ ok: false, reason: 'busy' });
    return new Promise((resolve) => {
      let settled = false;
      const end = (r) => {
        if (settled) return;
        settled = true;
        hold.release();
        resolve(r);
      };
      try {
        const synth = window.speechSynthesis;
        synth.cancel();
        const u = new window.SpeechSynthesisUtterance(text);
        const v = this._voice(synth);
        if (v) u.voice = v;
        u.pitch = 1.08;
        u.rate = 1.02;
        u.volume = Math.max(0.2, Math.min(1, Number(this.game?.settings?.voiceVol ?? 0.85)));
        u.onend = () => end({ ok: true, reason: 'browser' });
        u.onerror = () => end({ ok: false, reason: 'failed' });
        synth.speak(u);
        // Some browsers never fire onend: release the floor after a generous estimate.
        setTimeout(() => end({ ok: true, reason: 'browser' }), 1500 + text.length * 90);
      } catch {
        end({ ok: false, reason: 'unavailable' });
      }
    });
  }

  _voice(synth) {
    const voices = synth.getVoices?.() || [];
    if (!voices.length) return null;
    if (this._pick && voices.includes(this._pick)) return this._pick;
    this._pick = pickBrowserVoice(voices);
    return this._pick;
  }
}

function hasSynth() {
  return typeof window !== 'undefined' && !!window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function';
}
