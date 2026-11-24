// Lyra's spoken voice for her chat replies (never barks). Uses the claude.ai `tts`
// capability when the page has it, otherwise the browser's speechSynthesis with a
// female-sounding voice. A new reply always cuts off the previous one.

const FEMALE_VOICE = /female|woman|samantha|victoria|karen|moira|tessa|fiona|zira|serena|allison|ava|susan|aria|jenny|libby|sonia|natasha|hazel|kate|emma|amy|joanna|salli|kimberly|ivy|nicky|google uk english female|google us english/i;

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

export class Voice {
  constructor(game) {
    this.game = game;
    this.noticeShown = false;
    this._pick = null;
  }

  enabled() {
    return !!this.game?.settings?.voice;
  }

  speak(text) {
    if (!this.enabled()) return;
    const say = speakable(text);
    if (!say) return;
    const tts = this.game?.runtime?.tts;
    if (tts && typeof tts.speak === 'function') {
      let p;
      try {
        p = tts.speak(say, { voice: this.game.settings.voiceName || 'airy' });
      } catch (err) {
        p = Promise.reject(err);
      }
      Promise.resolve(p).catch((e) => this._ttsFailed(e));
      return;
    }
    this._browserSpeak(say);
  }

  stop() {
    const tts = this.game?.runtime?.tts;
    if (tts && typeof tts.stop === 'function') {
      try {
        if (!tts.active || tts.active()) Promise.resolve(tts.stop()).catch(() => {});
      } catch {
        /* ignore */
      }
    }
    try {
      if (typeof window !== 'undefined' && window.speechSynthesis?.speaking) window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
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
    }
    // no_gesture, stopped, busy, rate_limited, unavailable: skip this line quietly.
  }

  _browserSpeak(text) {
    if (typeof window === 'undefined' || !window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== 'function') return;
    try {
      const synth = window.speechSynthesis;
      synth.cancel();
      const u = new window.SpeechSynthesisUtterance(text);
      const v = this._voice(synth);
      if (v) u.voice = v;
      u.pitch = 1.12;
      u.rate = 1.02;
      u.volume = Math.max(0.2, Math.min(1, (this.game?.settings?.sfxVol ?? 0.7) + 0.2));
      synth.speak(u);
    } catch {
      /* speech is a nicety */
    }
  }

  _voice(synth) {
    const voices = synth.getVoices?.() || [];
    if (!voices.length) return null;
    if (this._pick && voices.includes(this._pick)) return this._pick;
    const en = voices.filter((v) => /^en/i.test(v.lang || ''));
    const pool = en.length ? en : voices;
    this._pick = pool.find((v) => FEMALE_VOICE.test(v.name)) || pool[0] || null;
    return this._pick;
  }
}
