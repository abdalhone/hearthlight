# Cutscene voices (DESIGN.md §21)

Only the cutscenes are spoken: the prologue, the story scenes, the mission scenes and the
boss intros (`src/story/scripts*.js`). Every spoken line is rendered ahead of time, the
author's way, from the author's own reference voices (`refs/`), and the game plays it with
captions that follow it word by word. Everything else in the game is text.

## The method (the author's, step by step)

1. **Getting the voices.** [Chatterbox](https://github.com/resemble-ai/chatterbox) (free,
   open-weight TTS) conditioned on a reference voice: the Void, the goth girl or Bro (the
   author's synthetic voices, `refs/*.flac`), reshaped per character (`cast.json`
   `refShape`: pitch, vocal-tract size, pace). Each line is spoken with **three seeds**;
   each take is transcribed with **Whisper** (faster-whisper `small.en`); the take where
   every word comes out right is kept (ties: the one closest to the reference voice, with no
   long holes and the clearest words). A line whose every take loses a word keeps the best
   and is flagged.
2. **Cutting.** Whisper's word edges are a little off, so loudness is measured every 10 ms
   too: above -42 dB is speech, gaps under 0.12 s are ignored. The line is cut from the start
   of its first sound to the end of its last (sounds far from any word, a breath or a mutter,
   are left out), with a 10 ms fade at each end.
3. **Timeline.** The game places each line after the last; its word times (from Whisper on
   the finished clip) drive the captions (each word pops in as it is spoken) and the sound
   cues tied to words (`src/story/sfx.js`).
4. **Sounding right.** The Void: 3 semitones down, a quiet layer an octave lower, echoes at 90
   and 160 ms, a small bass boost, a cut at 350 Hz and a lift at 2800 Hz, the words evened out
   so the end of a line never fades away. Everyone else: gentle shaping (a waver for the old,
   grit for the rough, EQ); a small room, the chapel or a stone hall where a scene is indoors;
   a muffle for a remembered voice. Every clip at -16 LUFS, true peak under -1.5 dBTP.
5. **Checking.** The finished clip is transcribed again. If an effect hid a word, the effects
   are lightened (echo, octave layer, room, grit, waver: 100 % → 60 % → 35 % → 15 %) and the
   clip is heard again. `verify.py` checks every clip against the script.

## Setup (once)

Python 3.11, ffmpeg (with rubberband), Node 20+. Models stay outside the repository.

```sh
CACHE=~/.cache/hearthlight-voice            # or set HEARTHLIGHT_VOICE_CACHE
uv venv -p 3.11 $CACHE/cbvenv
VIRTUAL_ENV=$CACHE/cbvenv uv pip install chatterbox-tts==0.1.7 faster-whisper soundfile scipy pyloudnorm "setuptools<81"
```

The first run downloads Chatterbox (~3 GB) and Whisper `small.en` from Hugging Face into
`$CACHE/hf`. CPU only is fine (about 7x real time per take on two threads).

Below, `PY` is `$CACHE/cbvenv/bin/python`.

## Render

```sh
node scripts/voice/collect.mjs            # -> scripts/voice/lines.json (git-ignored): every cutscene line
$PY scripts/voice/render.py --jobs 2      # -> assets/voice/<key>.mp3 + manifest.json
$PY scripts/voice/verify.py               # Whisper vs the script, loudness, peaks -> verify.json
npm run build                             # packs the clips into dist/voice/ (story order)
```

- **collect.mjs** reads `SCRIPTS`, `MISSION_SCRIPTS` and `BOSS_SCRIPTS`: each spoken step
  (`narrate` or `say`) with its speaker, mood and where it is heard (`place`: a room, the
  chapel, a stone hall, a memory). Scenes built at the moment (a funeral, the Moot) are not
  fixed lines and stay text.
- **Keys.** `key = speaker + '-' + hash(speaker + normalized text)` from
  `src/audio/voice_key.js`, the same function the game uses, so a line finds its clip by its
  words. Change a line and it simply needs a new render (the old clip is pruned).
- **render.py** is incremental: takes are cached by voice + text + generation settings +
  seed (`$CACHE/takes`), finished clips by their takes + shaping. Change a voice's shaping and
  only its clips are re-finished (seconds); change a line and only it is spoken again.
  `--only lyra,hess`, `--script prologue`, `--line prologue.11`, `--limit N`, `--force`. `--jobs 2 --threads 2`
  keeps it polite on a shared 4-CPU machine.
- **Output:** mono MP3, 24 kHz, 64 kbps CBR (MPEG-2 Layer III: decodes everywhere, iPhones
  included), -16 LUFS, true peak under -1.5 dBTP. `manifest.json`:
  `{ format, clips: { key: { file, dur, words: [[word, start, end], …], line, speaker, text, takes, … } } }`.

## Casting

```sh
$PY scripts/voice/refs.py --void void_dry.mp3 --goth goth_girl.mp3 --bro bro.mp3   # the conditioning clips
$PY scripts/voice/cast.py audition [--only hess,wenna]   # a real line per character, measured
```

The audition reports each character's median pitch and range, speaking rate, brightness,
how close Chatterbox came to the reference, and how alike every pair of characters sounds
(voice-encoder similarity). The reasons for every voice are in `CASTING.md`.

## Publishing

`npm run build` packs the clips in story order into `dist/voice/<scene>-<n>.mp3` (about
200 KB each; each clip stays a complete MP3 the game slices out by byte range) with
`dist/voice/manifest.json` (`{ format, packs, clips: { key: [pack, offset, length, seconds, words] } }`),
and tells the page with a one-line tag. `--loose-voices` copies clips one per file instead;
`--no-voices` builds without them.
