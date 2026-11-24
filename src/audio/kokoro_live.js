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

function resolveUrl(rel) {
  try {
    return new URL(rel, typeof document !== 'undefined' ? document.baseURI : undefined).href;
  } catch {
    return rel;
  }
}

export class LiveKokoro {
  constructor(game, { base = KOKORO_BASE, importer = null } = {}) {
    this.game = game;
    this.base = base;
    this.state = 'off'; // off | loading | ready | failed
    this.progress = 0;
    this.label = '';
    this.error = null;
    this.engine = null;
    this._p = null;
    this._import = importer || ((url) => import(url));
  }

  supported() {
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
        return this.error === 'unsupported' ? 'This browser cannot run her live voice.' : `Her live voice could not start here${this.error ? ` (${this.error})` : ''}.`;
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
        this._p = null; // the player may try again later
        this._notify();
        console.warn('[voice] live Kokoro unavailable:', err);
        if (!quiet) this.game?.ui?.toast?.("Lyra's live voice could not start in this browser; her recorded lines still play.", 'warn');
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
