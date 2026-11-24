# Voices (DESIGN.md §21)

Every fixed line in Hearthlight — the narrator, Lyra's scripted lines and barks, each
villager's greetings, farewells, gift reactions and day/night/rain lines, the bandits —
is rendered ahead of time with [Kokoro](https://github.com/thewh1teagle/kokoro-onnx), an
open-weight text-to-speech model, in a voice cast for that character (`cast.json`,
reasons in `CASTING.md`). The game plays a clip when a character says its line
(`src/audio/voice.js`). Lines that change every time (Claude's replies, lines with a
name or a number in them) have no clip; Lyra can still speak them with her live voice.

## Setup (once)

Python 3.11+ with pip, ffmpeg, Node 20+. Model files live outside the repository.

```sh
CACHE=~/.cache/hearthlight-voice            # or set HEARTHLIGHT_VOICE_CACHE
mkdir -p $CACHE && cd $CACHE
python3 -m venv venv
venv/bin/pip install kokoro-onnx==0.6.1 soundfile pyloudnorm scipy numpy
R=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
curl -LO $R/kokoro-v1.0.onnx -LO $R/voices-v1.0.bin -LO $R/kokoro-v1.0.int8.onnx   # 310 + 27 + 88 MB
```

Below, `PY` is `~/.cache/hearthlight-voice/venv/bin/python`.

## Render

```sh
node scripts/voice/collect.mjs            # -> scripts/voice/lines.json (git-ignored)
$PY scripts/voice/render.py --jobs 2      # -> assets/voice/<key>.mp3 + manifest.json
$PY scripts/voice/verify.py               # loudness, peaks, pitch, abrupt ends, per speaker
npm run build                             # packs the clips into dist/voice/
node scripts/voice/browser_check.mjs      # plays clips in the built game (Chromium)
```

- **collect.mjs** imports the game's own data (story scripts when present, villager
  profiles and `npc_data_more.js`, `FACT_SAY`, bandit barks, Lyra's line banks in
  `src/ai/brain/lines.js` (with `lines_will.js`), `src/ai/mind/autonomy_lines.js`, and the
  string literals in `src/ai/behavior/lines.js` and `phrases.js`). It keeps lines with no
  `{slot}` and expands `[a|b]` choices and `{#rule}`s when they make 8 lines or fewer.
  It warns about speakers with no cast voice. `--sample` writes a small validation set.
- **Story scripts** (`src/story/scripts.js`) are read generically: a step with a speaker
  (`speaker`/`who`/`by`) and `text` is dialogue; `{type: 'narrate', text}`, `{narrate}` or
  `{caption}` is the narrator's. The simplest contract: export
  `voiceLines() -> [{ speaker, text }]`. Speakers may be ids, names or first names.
- **Keys.** `key = speaker + '-' + hash(speaker + normalized text)` from
  `src/audio/voice_key.js`, the same function the game uses at run time, so any line
  that is said exactly as written finds its clip. Typography, case and spacing do not
  matter; words and punctuation do. Change a line and it simply needs a new render.
- **render.py** is incremental: a clip is skipped when it exists and its speaker's cast
  entry is unchanged (fingerprints in `assets/voice/render_state.json`). Change a voice in
  `cast.json` and only that speaker re-renders. `--only lyra,bram`, `--limit N`,
  `--force`, `--prune` (delete clips whose line is gone). `--jobs 2 --threads 1` keeps it
  polite on a shared 4-CPU machine (about 0.55x real time per job, so an hour of speech
  takes about 17 minutes with two jobs). It ends with a size report per speaker.
- **Output:** mono MP3, 24 kHz, 48 kbps CBR (MPEG-2 Layer III: decodes everywhere,
  iOS Safari included), -16 LUFS integrated, true peak under -1 dBTP, silence trimmed to
  30 ms before and 140 ms after the voice, with short fades.

## Casting

```sh
$PY scripts/voice/cast.py audition     # every English Kokoro voice, raw, measured
$PY scripts/voice/cast.py check --both # every cast voice, shaped: pitch, rate, loudness,
                                       # HNR, artifacts, and each voice's nearest neighbour
```

A cast entry: `voice` (a Kokoro voice, or a blend `{name: weight}` of style vectors),
`lang` (`en-us`/`en-gb` phonemes), `speed`, optional `sentencePause`/`clausePause`, and
`fx`: `pitch` (semitones, formants kept), `size` (formant shift in semitones: + smaller
or younger, - bigger or older), `tremor` (cents of slow waver for the very old),
`highpass`/`lowpass` (Hz), `bass`/`treble` (dB shelves), `eq` (`[[Hz, dB, Q]]`), `room`
(0..0.3 wet) and `roomSize` (s). Interjections espeak would spell out ("Hmph", "Mm",
"Hm") are spoken as sounds (`LEXICON` in `voicelib.py`).

## Publishing (claude.ai Artifact)

An Artifact version holds at most 511 files (255 per publish, 64 MB per publish), so the
build packs clips: `dist/voice/<speaker>-<n>.mp3` are concatenations of complete clips
(about 256 KB each) and `dist/voice/manifest.json` gives each key its pack, byte offset,
length and duration. The game fetches a pack once, slices the clip out and decodes it.
Publish `dist/artifact.html` as the page and every file in `dist/voice/` at
`voice/<name>`; when there are more than 255, publish twice to the same URL.
`npm run build -- --loose-voices` copies clips one per file instead (for other hosts).

## Lyra's live voice (experimental)

`npm run build -- --kokoro` also builds `dist/kokoro/`: the engine (onnxruntime-web and
an espeak-ng phonemizer in WebAssembly), the int8 model in parts of 14 MB or less, and
Lyra's style vectors only. The player turns it on in Settings ("Kokoro voice for
everything she says — downloads about 90 MB once"); it is cached in Cache Storage. See
`KOKORO_LIVE.md` for measurements and status.
