// Lyra's live Kokoro voice in the browser (DESIGN.md §21, opt-in: settings.kokoroLive).
// This small loader lives in the game bundle. The heavy parts live next to the page in
// kokoro/ and load only when the player turns the setting on:
//   kokoro/engine.js      onnxruntime-web + an espeak-ng phonemizer (built by
//                         `npm run build -- --kokoro` from src/audio/kokoro_engine.js)
//   kokoro/*.wasm         the onnxruntime WebAssembly runtime
//   kokoro/model.partN    the int8 model in <= 14 MB parts, joined and kept in Cache Storage
//   kokoro/lyra.bin       Lyra's style vectors (her cast blend), nothing else
// While it downloads, or anywhere it cannot run, her lines fall through to the next voice.

export const KOKORO_BASE = 'kokoro/';
// Slower than this (seconds of work per second of speech) and she would lag behind her
// own words: the live voice stands down on that device and the next voice speaks.
export const MAX_RTF = 1.0;

function pageConfig() {
  try {
    return (typeof window !== 'undefined' && window.__HEARTHLIGHT_VOICES__) || null;
  } catch {
    return null;
  }
}

const pageLive = () => pageConfig()?.live || null;

function resolveUrl(rel) {
  try {
    return new URL(rel, typeof document !== 'undefined' ? document.baseURI : undefined).href;
  } catch {
    return rel;
  }
}

export class LiveKokoro {
  constructor(game, { base = null, importer = null } = {}) {
    this.game = game;
    // Only offered when the build published it (npm run build -- --kokoro).
    this.base = base || pageLive();
    this.state = 'off'; // off | loading | ready | failed
    this.progress = 0;
    this.label = '';
    this.error = null;
    this.engine = null;
    this._p = null;
    this._import = importer || ((url) => import(url));
  }

  // The build published the live voice next to this page.
  available() {
    return !!this.base;
  }

  supported() {
    if (!this.available()) return false;
    if (typeof window === 'undefined' || typeof WebAssembly !== 'object') return false;
    return !!(window.AudioContext || window.webkitAudioContext) && typeof fetch === 'function';
  }

  statusText() {
    switch (this.state) {
      case 'loading':
        return `Downloading her voice… ${Math.round(this.progress * 100)}%${this.label ? ` (${this.label})` : ''}`;
      case 'ready':
        return 'Her live voice is ready.';
      case 'failed':
        if (this.error === 'unsupported') return 'This browser cannot run her live voice.';
        if (this.error === 'slow') return `This device is too slow for her live voice (${this.rtf?.toFixed(1)}x real time); her recorded lines still play.`;
        return `Her live voice could not start here${this.error ? ` (${this.error})` : ''}.`;
      default:
        return this.supported() ? 'Off. Her recorded lines still play.' : 'This browser cannot run her live voice.';
    }
  }

  _notify() {
    try {
      this.game?.bus?.emit?.('voice_live', { state: this.state, progress: this.progress, error: this.error });
    } catch {
      /* listeners must not break loading */
    }
  }

  start({ quiet = false } = {}) {
    if (this._p) return this._p;
    if (!this.supported()) {
      this.state = 'failed';
      this.error = 'unsupported';
      this._notify();
      return Promise.resolve(null);
    }
    this.state = 'loading';
    this.progress = 0;
    this.error = null;
    this._notify();
    const url = resolveUrl(`${this.base}engine.js`);
    this._p = Promise.resolve()
      .then(() => this._import(url))
      .then((mod) =>
        mod.loadKokoro({
          base: resolveUrl(this.base),
          onProgress: (f, label) => {
            this.progress = Math.max(0, Math.min(1, Number(f) || 0));
            this.label = label || '';
            this._notify();
          },
        }),
      )
      .then((engine) => {
        this.rtf = Number(engine?.info?.rtf) || null;
        const limit = Number(pageConfig()?.maxRtf) || MAX_RTF;
        if (this.rtf && this.rtf > limit) {
          engine.dispose?.();
          throw new Error('slow');
        }
        this.engine = engine;
        this.state = 'ready';
        this.progress = 1;
        this._notify();
        if (!quiet) this.game?.ui?.toast?.("Lyra's live voice is ready.", 'lyra');
        return engine;
      })
      .catch((err) => {
        this.state = 'failed';
        this.error = String(err?.message || err || 'failed').slice(0, 80);
        if (this.error !== 'slow') this._p = null; // the player may try again later
        this._notify();
        console.warn('[voice] live Kokoro unavailable:', err);
        if (!quiet) this.game?.ui?.toast?.(this.statusText(), 'warn');
        return null;
      });
    return this._p;
  }

  // Speak through the game's voice layer, sentence by sentence. Resolves { ok, reason };
  // 'unavailable' (still loading, or failed) lets the caller try the next voice.
  async speak(text, { kind = 'say', priority } = {}) {
    if (this.state !== 'ready' || !this.engine) {
      if (this.state === 'off' && this.game?.settings?.kokoroLive) this.start({ quiet: true });
      return { ok: false, reason: 'unavailable' };
    }
    const gv = this.game?.voice;
    if (!gv?.playStream) return { ok: false, reason: 'unavailable' };
    return gv.playStream({ speaker: 'lyra', kind, priority, chunks: this.engine.stream(text), sampleRate: this.engine.sampleRate || 24000 });
  }

  stopSpeaking() {
    const gv = this.game?.voice;
    if (gv?.current && !gv.current.key && gv.current.speaker === 'lyra') gv.stop();
  }
}
