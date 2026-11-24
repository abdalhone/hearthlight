// Lyra's live Kokoro voice, the Web Worker (DESIGN.md §21). Built only with
// `npm run build -- --kokoro` into dist/kokoro/worker.js, with onnxruntime-web (WebAssembly)
// and the espeak-ng phonemizer bundled in. Inference runs here so the game never stalls.
//
// Messages in:  { type: 'load', base }                  model parts, style vectors, runtime
//               { type: 'speak', id, text, speed }      synthesize sentence by sentence
//               { type: 'cancel', id }
// Messages out: { type: 'progress', f, label } | { type: 'ready', info } | { type: 'error', message }
//               { type: 'chunk', id, audio (Float32Array, transferred), ms } | { type: 'end', id }

import { load, synth, defaultSpeed } from './kokoro_core.js';

const cancelled = new Set();
let ready = false;
let queue = Promise.resolve();
const post = (m, transfer) => self.postMessage(m, transfer || []);

self.onmessage = (e) => {
  const m = e.data || {};
  if (m.type === 'load') {
    load(m.base, (f, label) => post({ type: 'progress', f, label })).then(
      (info) => {
        ready = true;
        post({ type: 'ready', info });
      },
      (err) => post({ type: 'error', message: String(err?.message || err) }),
    );
  } else if (m.type === 'speak') {
    // One line at a time, in order; a cancelled line stops between sentences.
    queue = queue.then(async () => {
      try {
        if (!ready) throw new Error('not loaded');
        await synth(m.text, m.speed || defaultSpeed(), (audio, ms) => post({ type: 'chunk', id: m.id, audio, ms }, [audio.buffer]), () => cancelled.has(m.id));
      } catch (err) {
        post({ type: 'error', id: m.id, message: String(err?.message || err) });
      }
      cancelled.delete(m.id);
      post({ type: 'end', id: m.id });
    });
  } else if (m.type === 'cancel') {
    cancelled.add(m.id);
  }
};
