# Lyra's live Kokoro voice — measurements and verdict

DESIGN.md §21: for lines with no recorded clip (Claude's replies, generated lines), an
optional in-browser Kokoro ("Kokoro voice for everything she says — downloads about
90 MB once"). The fallback chain in `src/ai/brain/voice.js` is: recorded clip → live
Kokoro → claude.ai's voice (`tts`, desktop only) → the browser's own voice (only if the
player enabled it) → silence with the words on screen.

## What is built

- `src/audio/kokoro_text.js` — text → phonemes → tokens, replicating kokoro-onnx 0.6.1:
  phonemizer's punctuation preserve/restore around espeak-ng (the `phonemizer` npm
  package, espeak-ng in WebAssembly), the same interjection lexicon as the render
  (`Hmph`, `Mm`, `Hm`…), Kokoro's 114-symbol vocabulary, one style row per token count.
  Checked against kokoro-onnx on all 1,611 of Lyra's fixed lines: 1,579 identical
  phoneme strings (98%), 0.69% of tokens different (stress marks on single words, from
  the newer espeak-ng in the npm package; its "or" → oːɹ drift is folded back).
- `src/audio/kokoro_core.js` + `kokoro_worker.js` — onnxruntime-web 1.31.1 (wasm, SIMD,
  single thread unless the page is cross-origin isolated) in a Web Worker, so the game
  never stalls. Model and runtime come through Cache Storage (downloaded once).
  Sentence-by-sentence streaming; a long first sentence is cut at its first comma so the
  first words come sooner. Output trimmed and levelled to about her clips' loudness.
- `src/audio/kokoro_engine.js` — the page side: worker, progress, an async stream of
  24 kHz chunks, cancellation when she is cut off.
- `src/audio/kokoro_live.js` (in the game bundle, ~3 KB) — the hook: offered only when the
  build published it (`window.__HEARTHLIGHT_VOICES__.live`), loads on demand, measures
  the device during warm-up and **stands down when it runs slower than real time**
  (`MAX_RTF = 1.0`; the settings line then says so), and plays through
  `game.voice.playStream` under the one-voice-at-a-time rules.
- `npm run build -- --kokoro` → `dist/kokoro/` (13 files, 109 MB): `engine.js` (1 KB),
  `worker.js` (1.4 MB), `ort-wasm-simd-threaded.wasm` (14.8 MB), `model.part0..6`
  (kokoro-v1.0.int8.onnx, 92 MB, in parts of 14,000,000 bytes), `lyra.bin` (her blended
  style vectors only, 522 KB), `model.json`. Nothing of it is in `dist/artifact.html`.

## Correctness

`scripts/voice/kokoro_compare.py` renders the bench line with kokoro-onnx (same int8 model,
same voice) and compares it with what the browser produced:

| | duration | median F0 | F0 p10–p90 | HNR |
|---|---|---|---|---|
| browser (onnxruntime-web) | 3.42 s | 187.7 Hz | 90–238 Hz | 11.5 dB |
| kokoro-onnx (Python) | 3.37 s | 186.4 Hz | 85–235 Hz | 11.2 dB |

Timbre + pitch distance 0.22 (two different Kokoro voices measure 3–6 on the same scale):
the same voice. The int8 model itself is 0.67 from the fp32 model the clips are rendered
with — her live voice and her recorded voice sound alike.

## Speed (headless Chromium 1.x, this 4-CPU build machine shared with seven other agents, load average 4–5)

Line: "Wicks and ashes, you walked right past the lamp again, didn't you?" (12 words,
3.56 s of speech). `node scripts/voice/kokoro_bench.mjs`; `--isolated` adds COOP/COEP.

| run | load | first words | whole line | real-time factor |
|---|---|---|---|---|
| worker, cold (first visit, 109 MB from localhost) | 5.2 s (fetch 1.3 s, init + warm-up 3.8 s) | 5.5 s | 5.5 s | 1.56 (1.56–2.20 over 3 runs) |
| worker, warm (model from Cache Storage) | 5.4 s (fetch 0.3 s) | 5.2 s | 5.2 s | 1.46–1.62 |
| main thread, no throttling | — | 5.2 s | 5.2 s | 1.45 |
| main thread, CPU throttled x4 (phone-like) | — | 21.1 s | 21.1 s | 5.9–6.4 |
| worker, 4 threads (cross-origin isolated; not possible on claude.ai) | 5.9 s | 4.5–6.7 s | | 1.27–1.87 |
| in the running game (`browser_check.mjs --live`), first clause first | 13 s | 2.6–2.9 s | 9.3–11.8 s | 2.7–2.9 |

Native kokoro-onnx on one core of the same machine runs at 0.72x real time; the browser's
single-threaded WebAssembly is about 2x slower than that.

## Verdict

Correct, but **not usable as a default** on the hardware measured: slower than real time
on a desktop-class core (1.5–2.9x) and about 6x with phone-like throttling, so she would
pause mid-sentence and her first words would come 2.6–5 s after the text. claude.ai
cannot give a page cross-origin isolation, so the multi-threaded runtime is out of reach
there, and the fast path (WebGPU) needs the fp32 model (325 MB), which is too big to ask
a player to download.

So it stays a clean, working hook:

- The lead does **not** publish `dist/kokoro/` by default; without it the setting does not
  appear and nothing is fetched.
- If it is published (a fast desktop, or a self-hosted copy), the warm-up measures the
  device and the voice stands down above 1.0x real time, so a slow phone falls back to the
  next voice instead of lagging. `window.__HEARTHLIGHT_VOICES__.maxRtf` adjusts the limit.
- Everything else does not depend on it: every fixed line is pre-rendered, and on an
  iPhone (no claude.ai `tts` in Safari or the apps) her unrecorded replies can be read by
  the browser's own voice when the player turns that on.

Licensing note: the `phonemizer` package bundles espeak-ng (GPL-3.0) compiled to
WebAssembly. Publishing `dist/kokoro/worker.js` distributes it; the build-time pipeline
(kokoro-onnx + espeak-ng in Python) distributes nothing but the rendered audio.
