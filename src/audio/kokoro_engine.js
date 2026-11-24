// Lyra's live Kokoro voice, the page half (DESIGN.md §21). Built only with
// `npm run build -- --kokoro` into dist/kokoro/engine.js and imported on demand by
// src/audio/kokoro_live.js. It starts the worker (dist/kokoro/worker.js), reports download
// progress, and turns each line into a stream of audio chunks, one per sentence.

export async function loadKokoro({ base, onProgress = () => {}, timeoutMs = 600000 } = {}) {
  const root = base.endsWith('/') ? base : `${base}/`;
  const worker = new Worker(new URL('worker.js', root), { type: 'module' });
  const streams = new Map(); // id -> { push, end, fail }
  let nextId = 1;
  const info = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out loading the voice')), timeoutMs);
    worker.onerror = (e) => {
      clearTimeout(timer);
      reject(new Error(e?.message || 'the voice worker failed to start'));
    };
    worker.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'progress') onProgress(m.f, m.label);
      else if (m.type === 'ready') {
        clearTimeout(timer);
        resolve(m.info || {});
      } else if (m.type === 'error' && m.id == null) {
        clearTimeout(timer);
        reject(new Error(m.message));
      }
    };
    worker.postMessage({ type: 'load', base: root });
  });

  worker.onmessage = (e) => {
    const m = e.data || {};
    const s = streams.get(m.id);
    if (!s) return;
    if (m.type === 'chunk') s.push(m.audio, m.ms);
    else if (m.type === 'end') s.end();
    else if (m.type === 'error') s.fail(new Error(m.message));
  };

  // An async iterable of Float32Array chunks (24 kHz mono). Stopping early (break, or
  // the voice layer cutting her off) cancels the rest of the line in the worker.
  function stream(text, { speed } = {}) {
    const id = nextId++;
    const queue = [];
    let waiting = null;
    let finished = false;
    let error = null;
    const wake = () => {
      if (waiting) {
        const w = waiting;
        waiting = null;
        w();
      }
    };
    streams.set(id, {
      push(audio, ms) {
        queue.push(audio);
        engine.timings.push(ms);
        wake();
      },
      end() {
        finished = true;
        streams.delete(id);
        wake();
      },
      fail(err) {
        error = err;
        finished = true;
        streams.delete(id);
        wake();
      },
    });
    worker.postMessage({ type: 'speak', id, text, speed });
    return {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            for (;;) {
              if (queue.length) return { value: queue.shift(), done: false };
              if (error) throw error;
              if (finished) return { value: undefined, done: true };
              await new Promise((r) => (waiting = r));
            }
          },
          async return() {
            if (!finished) worker.postMessage({ type: 'cancel', id });
            streams.delete(id);
            finished = true;
            return { value: undefined, done: true };
          },
        };
      },
    };
  }

  const engine = {
    sampleRate: 24000,
    info,
    timings: [],
    stream,
    dispose() {
      worker.terminate();
    },
  };
  return engine;
}
