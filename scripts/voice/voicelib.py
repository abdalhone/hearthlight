"""Hearthlight's cutscene voices, made the author's way (DESIGN.md §21, README.md here).

  1. Getting the voices: Chatterbox (free TTS) conditioned on the author's reference voices,
     every line generated with three seeds, each take transcribed with Whisper
     (faster-whisper), and the take where every word comes out right is kept.
  2. Cutting: Whisper's word edges are a little off, so loudness is measured every 10 ms as
     well (above -42 dB is speech, gaps under 0.12 s do not count) and the line is cut from
     the start of its first sound to the end of its last, with a 10 ms fade at each end.
  4. Making voices sound right: the Void's chain (3 semitones down, a quiet layer an octave
     lower, echoes at 90 and 160 ms, a small bass boost, a cut at 350 Hz and a lift at
     2800 Hz, the words evened out), gentle shaping for everyone else, a room or a muffle
     where the scene is indoors, every clip at -16 LUFS with peaks under -1.5 dBTP.
  8. Checking: the finished clip is transcribed again; its word times drive the captions.

Models and takes live outside the repository (HEARTHLIGHT_VOICE_CACHE, default
~/.cache/hearthlight-voice). Nothing here is imported by the game.
"""

from __future__ import annotations

import difflib
import hashlib
import json
import math
import os
import re
import subprocess
from pathlib import Path

import numpy as np

SR = 24000  # Chatterbox speaks at 24 kHz; clips stay at 24 kHz
TARGET_LUFS = -16.0
MAX_TRUE_PEAK_DB = -1.5
FRAME = 0.010  # loudness frames, seconds
SPEECH_DB = -42.0  # louder than this is speech
BRIDGE_S = 0.12  # quieter gaps shorter than this do not split speech
FADE_S = 0.010
KBPS = 64  # mono MP3, MPEG-2 Layer III at 24 kHz: decodes everywhere, iPhones included
PIPELINE = "r9.4"  # bump to re-finish every clip (takes are kept)

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent


def cache_dir() -> Path:
    p = Path(os.environ.get("HEARTHLIGHT_VOICE_CACHE") or Path.home() / ".cache" / "hearthlight-voice")
    p.mkdir(parents=True, exist_ok=True)
    return p


def sha(obj) -> str:
    s = obj if isinstance(obj, (bytes, bytearray)) else json.dumps(obj, sort_keys=True, ensure_ascii=False).encode()
    return hashlib.sha1(s).hexdigest()[:16]


def file_sha(path: Path) -> str:
    return hashlib.sha1(Path(path).read_bytes()).hexdigest()[:16]


def load_json(path: Path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return default


def write_json(path: Path, data, indent=None) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=indent, sort_keys=indent is not None) + "\n")
    os.replace(tmp, path)


# --------------------------------------------------------------------------- words

ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
SPELLING = {"steaks": "stakes", "gray": "grey", "color": "colour", "colors": "colours", "neighbor": "neighbour", "neighbors": "neighbours", "favor": "favour",
            "honor": "honour", "toward": "towards", "okay": "ok", "alright": "all right", "whiskey": "whisky", "theater": "theatre"}
FILLERS = {"hm": "hm", "hmm": "hm", "hmmm": "hm", "mm": "hm", "mmm": "hm", "mhm": "hm", "mmhm": "hm", "hmhm": "hm", "hmhmm": "hm", "um": "hm", "uh": "hm", "ah": "ah", "oh": "oh"}


def number_words(n: int) -> list[str]:
    if n < 20:
        return [ONES[n]]
    if n < 100:
        return [TENS[n // 10]] + ([ONES[n % 10]] if n % 10 else [])
    if n < 1000:
        return [ONES[n // 100], "hundred"] + (["and"] + number_words(n % 100) if n % 100 else [])
    if n < 10000:
        return number_words(n // 1000) + ["thousand"] + (number_words(n % 1000) if n % 1000 else [])
    return [str(n)]


def norm_tokens(text: str) -> list[str]:
    """Words as they are compared: lower case, no punctuation, hyphens and numbers spelled
    out, 'hm'/'hmm'/'mm' the same sound."""
    s = str(text).replace("’", "'").replace("‘", "'").replace("…", " ").lower()
    s = re.sub(r"\bma\s*'\s*am\b", "mam", s)
    s = re.sub(r"\bwanna\b", "want to", s)
    s = re.sub(r"\bgonna\b", "going to", s)
    s = re.sub(r"\bgotta\b", "got to", s)
    s = re.sub(r"[‐-―\-]", " ", s)
    s = re.sub(r"[^a-z0-9' ]+", " ", s)
    out: list[str] = []
    for w in s.split():
        w = w.strip("'")
        if not w:
            continue
        if w.isdigit():
            out += number_words(int(w))
            continue
        m = re.fullmatch(r"(\d+)(st|nd|rd|th)", w)
        if m:
            out += number_words(int(m.group(1)))
            continue
        w = SPELLING.get(w, w)  # Whisper spells American; the story spells British
        out += w.split() if " " in w else [FILLERS.get(w, w)]
    # "a hundred" is "one hundred"; "hm-hmm" is one hum however Whisper writes it
    out = ["one" if w == "a" and i + 1 < len(out) and out[i + 1] in ("hundred", "thousand") else w for i, w in enumerate(out)]
    return [w for i, w in enumerate(out) if not (w == "hm" and i and out[i - 1] == "hm")]


def display_tokens(text: str) -> list[str]:
    """The words as the caption shows them (whitespace-separated, punctuation kept)."""
    return str(text).split()


NAMES = {
    # The story's own names and words: Whisper cannot know how they are spelled, so one
    # heard close enough (or as two words, 'hearth vale') counts as right.
    "halcyre", "lanternwright", "lanternwrights", "hearthvale", "wellstone", "ambrel", "ashgrove", "hollowcrown",
    "crownfells", "saltmere", "lowmarch", "whisperwood", "wayhouse", "lyra", "hess", "hobb", "wenna", "maren",
    "aveline", "davin", "bryn", "greyjaw", "brightfall", "gravelight", "varek", "corran", "glimmer", "longwatch",
    "hearthwatch", "lumencrafter", "wardrunner", "wardwright",
    "da",  # Lyra's father; Whisper writes it "Daa" or "Dah"
}


def glossary_of(lines: list[str]) -> set[str]:
    """NAMES plus any long capitalized word inside a sentence (a name nobody listed yet)."""
    names = set(NAMES)
    for t in lines:
        for m in re.finditer(r"(?<=[a-z,;:] )([A-Z][a-z]{6,})\b", t):
            names.add(m.group(1).lower())
    return names


def _close(a: str, b: str, fuzzy: bool) -> bool:
    if a == b:
        return True
    if a.rstrip("s") == b.rstrip("s") and abs(len(a) - len(b)) <= 1:
        return True  # 'lanternwrights' / 'lanternwright'
    if fuzzy:
        return difflib.SequenceMatcher(None, a, b).ratio() >= 0.6
    return False


def align(ref: list[str], hyp: list[str], names: set[str] | None = None):
    """Edit distance between the script's words and what Whisper heard, where a made-up
    name heard close enough counts as right and two heard words may make one name
    ('hearth vale'). Returns (errors, pairs) with pairs[i] = hyp indices for ref[i]."""
    names = names or set()
    n, m = len(ref), len(hyp)
    INF = 10**9
    d = np.full((n + 1, m + 1), INF, dtype=np.int64)
    op = np.zeros((n + 1, m + 1), dtype=np.int8)  # 1 diag, 2 del ref, 3 ins hyp, 4 merge 2 hyp
    d[0, :] = np.arange(m + 1)
    op[0, 1:] = 3
    d[1:, 0] = np.arange(1, n + 1)
    op[1:, 0] = 2
    for i in range(1, n + 1):
        r = ref[i - 1]
        fz = r in names or r.rstrip("s") in names
        for j in range(1, m + 1):
            c = d[i - 1, j - 1] + (0 if _close(r, hyp[j - 1], fz) else 1)
            o = 1
            if d[i - 1, j] + 1 < c:
                c, o = d[i - 1, j] + 1, 2
            if d[i, j - 1] + 1 < c:
                c, o = d[i, j - 1] + 1, 3
            # One written word heard as two ("hearth vale"), or two heard as one
            # ("roadguard", "everyone"): the same sounds.
            if j >= 2 and (r == hyp[j - 2] + hyp[j - 1] or (fz and _close(r, hyp[j - 2] + hyp[j - 1], True))) and d[i - 1, j - 2] < c:
                c, o = d[i - 1, j - 2], 4
            if i >= 2 and ref[i - 2] + r == hyp[j - 1] and d[i - 2, j - 1] < c:
                c, o = d[i - 2, j - 1], 5
            d[i, j], op[i, j] = c, o
    pairs: list[list[int]] = [[] for _ in range(n)]
    i, j = n, m
    while i > 0 or j > 0:
        o = op[i, j]
        if o == 1:
            pairs[i - 1] = [j - 1]
            i, j = i - 1, j - 1
        elif o == 4:
            pairs[i - 1] = [j - 2, j - 1]
            i, j = i - 1, j - 2
        elif o == 5:
            pairs[i - 2] = [j - 1]
            pairs[i - 1] = [j - 1]
            i, j = i - 2, j - 1
        elif o == 2:
            i -= 1
        else:
            j -= 1
    return int(d[n, m]), pairs


def word_errors(text: str, heard: list[str], names: set[str] | None = None) -> tuple[int, int]:
    ref = norm_tokens(text)
    hyp = norm_tokens(" ".join(heard))
    # A number may be said with or without 'and' ("a hundred and ten"): drop it on both sides.
    if "hundred" in ref:
        ref = [w for w in ref if w != "and"] if "and" not in hyp else ref
    e, _ = align(ref, hyp, names)
    return e, len(ref)


# --------------------------------------------------------------------------- audio io

def run_ffmpeg(audio: np.ndarray, filters: list[str], sr: int = SR) -> np.ndarray:
    if not filters:
        return audio.astype(np.float32)
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "pipe:0",
        "-af", ",".join(filters),
        "-f", "f32le", "-ar", str(sr), "-ac", "1", "pipe:1",
    ]
    p = subprocess.run(cmd, input=audio.astype(np.float32).tobytes(), capture_output=True, check=True)
    return np.frombuffer(p.stdout, dtype=np.float32).copy()


def load_audio(path: Path, sr: int = SR) -> np.ndarray:
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path), "-f", "f32le", "-ar", str(sr), "-ac", "1", "pipe:1"]
    p = subprocess.run(cmd, capture_output=True, check=True)
    return np.frombuffer(p.stdout, dtype=np.float32).copy()


def write_wav(audio: np.ndarray, path: Path, sr: int = SR) -> None:
    import soundfile as sf

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.stem + ".tmp" + path.suffix)
    sf.write(str(tmp), audio.astype(np.float32), sr, subtype="FLOAT" if path.suffix == ".wav" else "PCM_24")
    os.replace(tmp, path)


def read_wav(path: Path) -> np.ndarray:
    import soundfile as sf

    a, sr = sf.read(str(path), dtype="float32")
    if a.ndim > 1:
        a = a.mean(axis=1)
    if sr != SR:
        from scipy.signal import resample_poly

        g = math.gcd(sr, SR)
        a = resample_poly(a, SR // g, sr // g).astype(np.float32)
    return a


def encode_mp3(audio: np.ndarray, path: Path, kbps: int = KBPS) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp.mp3")
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "pipe:0",
        "-c:a", "libmp3lame", "-b:a", f"{kbps}k", "-ar", str(SR), "-ac", "1",
        "-map_metadata", "-1", "-id3v2_version", "0", "-write_xing", "0", str(tmp),
    ]
    subprocess.run(cmd, input=audio.astype(np.float32).tobytes(), capture_output=True, check=True)
    os.replace(tmp, path)


# --------------------------------------------------------------------------- loudness

def lufs(audio: np.ndarray, sr: int = SR) -> float:
    import pyloudnorm as pyln

    x = audio.astype(np.float64)
    min_len = int(0.45 * sr)
    if len(x) < min_len:
        x = np.concatenate([x, np.zeros(min_len - len(x))])
    try:
        v = pyln.Meter(sr).integrated_loudness(x)
    except Exception:
        v = -70.0
    return float(v) if math.isfinite(v) else -70.0


def true_peak_db(audio: np.ndarray) -> float:
    from scipy.signal import resample_poly

    up = resample_poly(audio.astype(np.float64), 4, 1)
    pk = float(np.max(np.abs(up))) if len(up) else 0.0
    return 20 * math.log10(pk + 1e-12)


def limit(audio: np.ndarray, ceiling_db: float) -> np.ndarray:
    """Look-ahead peak limiter: the gain never lets a sample over the ceiling."""
    from scipy.ndimage import minimum_filter1d, uniform_filter1d

    ceiling = 10 ** (ceiling_db / 20)
    a = np.abs(audio)
    if a.max(initial=0) <= ceiling:
        return audio.astype(np.float32)
    need = np.minimum(1.0, ceiling / np.maximum(a, 1e-9))
    w = int(0.004 * SR)
    g = minimum_filter1d(need, size=2 * w + 1, mode="nearest")
    g = uniform_filter1d(g, size=2 * w + 1, mode="nearest")
    g = np.minimum(g, need)  # never over, even where the smoothing would let it
    return (audio * g).astype(np.float32)


def frame_db(audio: np.ndarray, frame: float = FRAME) -> np.ndarray:
    n = int(round(frame * SR))
    k = len(audio) // n
    if k == 0:
        return np.full(1, -120.0)
    r = np.sqrt(np.mean(audio[: k * n].reshape(k, n).astype(np.float64) ** 2, axis=1) + 1e-14)
    return 20 * np.log10(r)


def normalize(audio: np.ndarray, target: float = TARGET_LUFS) -> np.ndarray:
    return (audio * 10 ** ((target - lufs(audio)) / 20)).astype(np.float32)


# --------------------------------------------------------------------------- cutting

def speech_runs(audio: np.ndarray, thr_db: float = SPEECH_DB, bridge: float = BRIDGE_S) -> list[tuple[float, float]]:
    """Where speech really is: 10 ms frames louder than thr_db (measured on the line
    normalized to -16 LUFS), runs closer than `bridge` joined. Returns [(start, end)] s."""
    db = frame_db(normalize(audio))
    on = db > thr_db
    runs: list[list[int]] = []
    i = 0
    while i < len(on):
        if on[i]:
            j = i
            while j < len(on) and on[j]:
                j += 1
            if runs and (i - runs[-1][1]) * FRAME < bridge:
                runs[-1][1] = j
            else:
                runs.append([i, j])
            i = j
        else:
            i += 1
    return [(a * FRAME, b * FRAME) for a, b in runs]


def fade(audio: np.ndarray, fade_in: float = FADE_S, fade_out: float = FADE_S) -> np.ndarray:
    a = audio.astype(np.float32).copy()
    fi, fo = int(fade_in * SR), int(fade_out * SR)
    if fi and len(a) > fi:
        a[:fi] *= np.linspace(0, 1, fi, dtype=np.float32)
    if fo and len(a) > fo:
        a[-fo:] *= np.linspace(1, 0, fo, dtype=np.float32)
    return a


def cut_line(audio: np.ndarray, words: list) -> tuple[np.ndarray, float]:
    """Cut from the start of the first sound to the end of the last. Sounds far from any
    word Whisper heard (a breath before, a mutter after) are left out. Returns (clip,
    offset of the cut in the take)."""
    runs = speech_runs(audio)
    if not runs:
        return fade(audio), 0.0
    if words:
        w0, w1 = float(words[0][1]), float(words[-1][2])
        keep = [r for r in runs if r[1] > w0 - 0.25 and r[0] < w1 + 0.35]
        runs = keep or runs
    # The first sound starts a little before it crosses -42 dB (a soft "If", a breathy
    # "h"), and the last rings a little after: follow each edge out while it is still
    # sound (above -62 dB), at most 120 ms before and 150 ms after.
    db = frame_db(normalize(audio))
    i0 = int(round(runs[0][0] / FRAME))
    i1 = int(round(runs[-1][1] / FRAME))
    lo, hi = max(0, i0 - 12), min(len(db), i1 + 15)
    while i0 > lo and db[i0 - 1] > -62:
        i0 -= 1
    while i1 < hi and db[i1] > -62:
        i1 += 1
    a = max(0, int(i0 * FRAME * SR))
    b = min(len(audio), int(math.ceil(i1 * FRAME * SR)))
    return fade(audio[a:b]), a / SR


def longest_gap(audio: np.ndarray) -> float:
    runs = speech_runs(audio)
    return max([b[0] - a[1] for a, b in zip(runs, runs[1:])], default=0.0)


# --------------------------------------------------------------------------- shaping

def rubberband(audio: np.ndarray, pitch_st: float = 0.0, tempo: float = 1.0, formant: str = "shifted") -> np.ndarray:
    if not pitch_st and tempo == 1.0:
        return audio
    f = f"rubberband=pitch={2 ** (pitch_st / 12):.6f}:tempo={tempo:.5f}:formant={formant}:pitchq=quality:transients=smooth:window=standard"
    return run_ffmpeg(audio, [f])


def reshape_voice(audio: np.ndarray, pitch: float = 0.0, formant: float = 0.0, tempo: float = 1.0) -> np.ndarray:
    """Pitch (semitones, formants kept) and vocal-tract size (formant semitones: - bigger or
    older, + smaller or younger), the way a reference voice becomes another person's."""
    if formant:
        r = 2 ** (formant / 12)
        x = run_ffmpeg(audio, [f"asetrate={SR * r:.3f}", f"aresample={SR}"])
        return rubberband(x, pitch - formant, tempo / r if tempo else 1 / r, "preserved")
    return rubberband(audio, pitch, tempo, "preserved")


def eq_filters(fx: dict) -> list[str]:
    f: list[str] = []
    if fx.get("highpass"):
        f.append(f"highpass=f={float(fx['highpass']):.0f}:poles=2")
    if fx.get("bass"):
        f.append(f"bass=g={float(fx['bass']):.2f}:f={float(fx.get('bassHz', 120)):.0f}:w=0.7")
    for freq, gain, q in fx.get("eq", []):
        f.append(f"equalizer=f={freq}:t=q:w={q}:g={gain}")
    if fx.get("treble"):
        f.append(f"treble=g={float(fx['treble']):.2f}:f=4500:w=0.6")
    if fx.get("lowpass"):
        f.append(f"lowpass=f={float(fx['lowpass']):.0f}:poles=2")
    return f


def room(audio: np.ndarray, amount: float, size: float = 0.35, seed: int = 11, dark: float = 0.75, pre: float = 0.012) -> np.ndarray:
    """A small dark room: decaying filtered noise convolved in, mixed low. The tail rings
    past the end of the line."""
    if amount <= 0:
        return audio
    from scipy.signal import fftconvolve, lfilter

    n = int(SR * size)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    ir = rng.standard_normal(n) * np.exp(-6.9 * t / size)
    ir = lfilter([1 - dark], [1, -dark], ir)
    ir = np.concatenate([np.zeros(int(pre * SR)), ir])
    ir /= np.sqrt(np.sum(ir**2)) + 1e-12
    wet = fftconvolve(audio, ir)
    dry = np.concatenate([audio, np.zeros(len(wet) - len(audio), dtype=np.float32)])
    return (dry + amount * wet).astype(np.float32)


def echo(audio: np.ndarray, taps: list[tuple[float, float]], lowpass: float = 0.0) -> np.ndarray:
    """Discrete echoes [(seconds, gain)], optionally darker than the voice."""
    if not taps:
        return audio
    src = run_ffmpeg(audio, [f"lowpass=f={lowpass:.0f}:poles=1"]) if lowpass else audio
    n = len(audio) + int(max(t for t, _ in taps) * SR) + 1
    out = np.zeros(n, dtype=np.float32)
    out[: len(audio)] += audio
    for t, g in taps:
        k = int(round(t * SR))
        out[k : k + len(src)] += g * src
    return out


def tremor(audio: np.ndarray, cents: float, rate: float = 5.2, seed: int = 3) -> np.ndarray:
    """A faint uneven pitch waver for the old (a few cents, never a warble)."""
    if cents <= 0:
        return audio
    n = len(audio)
    t = np.arange(n) / SR
    rel = 2 ** (cents / 1200) - 1
    rng = np.random.default_rng(seed)
    p1, p2 = rng.uniform(0, 2 * np.pi, 2)
    a1 = rel / (2 * np.pi * rate) * 0.7
    a2 = rel / (2 * np.pi * rate * 1.37) * 0.3
    delay = 0.004 + a1 * np.sin(2 * np.pi * rate * t + p1) + a2 * np.sin(2 * np.pi * rate * 1.37 * t + p2)
    pos = np.clip(np.arange(n) - delay * SR, 0, n - 1)
    i = np.floor(pos).astype(np.int64)
    f = (pos - i).astype(np.float32)
    j = np.minimum(i + 1, n - 1)
    return (audio[i] * (1 - f) + audio[j] * f).astype(np.float32)


def grit(audio: np.ndarray, amount: float) -> np.ndarray:
    """Roughness: a little soft saturation on the upper mids, mixed in parallel."""
    if amount <= 0:
        return audio
    peak = float(np.max(np.abs(audio))) + 1e-9
    band = run_ffmpeg(audio, ["highpass=f=600:poles=2", "lowpass=f=5000:poles=2"]) / peak
    sat = np.tanh(band * (2 + 10 * amount)) * peak * 0.25
    return (audio + amount * sat).astype(np.float32)


def level_words(audio: np.ndarray, words: list, offset: float = 0.0, max_up: float = 6.0, max_down: float = 3.0) -> np.ndarray:
    """Even out the words so the end of a line does not fade away: each word is brought
    toward the line's median word loudness (up to +6 dB, down to -3 dB), the gain moving
    smoothly between words."""
    if not words or len(words) < 2:
        return audio
    centers, gains = [], []
    levels = []
    for w in words:
        a = max(0, int((float(w[1]) - offset) * SR))
        b = min(len(audio), int((float(w[2]) - offset) * SR))
        if b - a < int(0.04 * SR):
            continue
        seg = audio[a:b].astype(np.float64)
        rms = np.sqrt(np.mean(seg**2) + 1e-14)
        levels.append(20 * np.log10(rms))
        centers.append((a + b) / 2)
    if len(levels) < 2:
        return audio
    ref = float(np.median(levels))
    gains = [float(np.clip(ref - lv, -max_down, max_up)) for lv in levels]
    x = np.arange(len(audio))
    g_db = np.interp(x, centers, gains)
    from scipy.ndimage import uniform_filter1d

    g_db = uniform_filter1d(g_db, size=int(0.06 * SR), mode="nearest")
    return (audio * 10 ** (g_db / 20)).astype(np.float32)


def void_chain(audio: np.ndarray, words: list, offset: float, v: dict) -> np.ndarray:
    """The Void (the narrator), as the author makes it."""
    x = level_words(audio, words, offset)  # even the words first, on the clean voice
    x = rubberband(x, float(v.get("pitch", -3.0)))  # deeper: 3 semitones down
    low = rubberband(x, -12.0)  # an octave lower, quiet, under it
    low = run_ffmpeg(low, [f"lowpass=f={float(v.get('octaveLowpass', 1400)):.0f}:poles=2"])
    n = min(len(x), len(low))
    x = x[:n] + 10 ** (float(v.get("octaveDb", -15.0)) / 20) * low[:n]
    x = echo(x, [(0.090, float(v.get("echo90", 0.22))), (0.160, float(v.get("echo160", 0.12)))], lowpass=float(v.get("echoLowpass", 4500)))
    x = run_ffmpeg(x, [
        f"bass=g={float(v.get('bass', 2.5)):.2f}:f=110:w=0.7",
        f"equalizer=f=350:t=q:w=1.0:g={float(v.get('cut350', -3.5)):.2f}",
        f"equalizer=f=2800:t=q:w=1.0:g={float(v.get('lift2800', 2.5)):.2f}",
        "highpass=f=35:poles=2",
    ])
    return x


PLACES = {
    # A voice in a room, a chapel, a stone hall, or remembered: a small room, a muffle.
    "room": {"room": 0.10, "roomSize": 0.28, "dark": 0.7},
    "chapel": {"room": 0.22, "roomSize": 1.3, "dark": 0.8, "pre": 0.025},
    "hall": {"room": 0.24, "roomSize": 0.9, "dark": 0.65, "pre": 0.018},
    "memory": {"lowpass": 4200, "room": 0.12, "roomSize": 0.45, "dark": 0.8},
    "muffled": {"lowpass": 1600, "room": 0.08, "roomSize": 0.18, "dark": 0.6},
}


def shape(audio: np.ndarray, fx: dict, place: str | None, room_scale: float = 1.0) -> np.ndarray:
    x = audio
    if fx.get("tempo", 1.0) != 1.0 or fx.get("pitch"):
        x = rubberband(x, float(fx.get("pitch", 0.0)), float(fx.get("tempo", 1.0)), "preserved")
    x = tremor(x, float(fx.get("tremor", 0)))
    x = grit(x, float(fx.get("grit", 0)))
    x = run_ffmpeg(x, eq_filters(fx))
    p = dict(PLACES.get(place or "", {}))
    if p.get("lowpass"):
        x = run_ffmpeg(x, [f"lowpass=f={p['lowpass']:.0f}:poles=2"])
    if p.get("room"):
        x = room(x, p["room"] * room_scale, p.get("roomSize", 0.35), dark=p.get("dark", 0.75), pre=p.get("pre", 0.012))
    return x


def finish(audio: np.ndarray, target: float = TARGET_LUFS) -> np.ndarray:
    """Loudness to the target, peaks limited, the ringing tail trimmed, 10 ms fades."""
    x = audio.astype(np.float32)
    db = frame_db(normalize(x))
    on = np.nonzero(db > -60)[0]
    if len(on):
        x = x[: min(len(x), int((on[-1] + 1) * FRAME * SR))]
    for _ in range(10):  # limiting a peaky line lowers its loudness: measure again, top up
        gain = target - lufs(x)
        if abs(gain) < 0.15:
            break
        x = limit(x * (10 ** (gain / 20)), -2.0)
    return fade(x, FADE_S, 0.03)


def encode_checked(audio: np.ndarray, path: Path, target: float = TARGET_LUFS) -> tuple[np.ndarray, float]:
    """Encode, decode and measure what the player will hear: MP3 can overshoot the limiter
    between samples, and its low-pass takes a little loudness from a bright voice. While the
    decoded clip is off, correct and encode again."""
    ceiling = -2.0
    tp = 0.0
    dec = audio
    for _ in range(6):
        encode_mp3(audio, path)
        dec = load_audio(path)
        tp = true_peak_db(dec)
        off = target - lufs(dec)
        if tp <= MAX_TRUE_PEAK_DB and abs(off) <= 0.3:
            return dec, tp
        if tp > MAX_TRUE_PEAK_DB:
            ceiling -= (tp - MAX_TRUE_PEAK_DB) + 0.3
        audio = limit(audio * 10 ** (off / 20), ceiling)
    return dec, tp


# --------------------------------------------------------------------------- models

def hf_env() -> None:
    os.environ.setdefault("HF_HOME", str(cache_dir() / "hf"))
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    os.environ.setdefault("TQDM_DISABLE", "1")
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


class Ears:
    """faster-whisper, small and on the CPU, with the story's names as a hint."""

    def __init__(self, model: str = "base.en", threads: int = 2, names: set[str] | None = None):
        hf_env()
        from faster_whisper import WhisperModel

        self.model = WhisperModel(model, device="cpu", compute_type="int8", cpu_threads=threads)
        self.names = names or set()
        self.prompt = ("Hearthvale, Halcyre, Lanternwrights, the Wellstone, Lyra Ambrel, Hobb, Wenna, Hess, Maren Ashgrove, "
                       "Aveline, the Hollowcrown, Crownfells, Brightfall, the Drift, Whisperwood, Saltmere, the Moot, gravelight.")

    def words(self, audio: np.ndarray, prompt: bool = True) -> list[list]:
        """[[word, start, end, prob]] in seconds."""
        a = audio.astype(np.float32)
        if SR != 16000:
            from scipy.signal import resample_poly

            a = resample_poly(a, 2, 3).astype(np.float32)
        segs, _ = self.model.transcribe(a, language="en", beam_size=5, word_timestamps=True, vad_filter=False,
                                        condition_on_previous_text=False, initial_prompt=self.prompt if prompt else None)
        out = []
        for s in segs:
            for w in s.words or []:
                out.append([w.word.strip(), round(float(w.start), 3), round(float(w.end), 3), round(float(w.probability), 3)])
        return out


class Mouth:
    """Chatterbox, loaded once; conditionals cached per reference and exaggeration."""

    def __init__(self, threads: int = 2):
        hf_env()
        import torch

        torch.set_num_threads(threads)
        from chatterbox.tts import ChatterboxTTS

        self.torch = torch
        self.tts = ChatterboxTTS.from_pretrained("cpu")
        self._cond_key = None

    def condition(self, ref: Path, exaggeration: float) -> None:
        key = (str(ref), round(float(exaggeration), 3))
        if key != self._cond_key:
            if str(ref).endswith(".pt"):  # Chatterbox's own built-in voice
                from chatterbox.tts import Conditionals

                self.tts.conds = Conditionals.load(str(ref)).to("cpu")
            else:
                self.tts.prepare_conditionals(str(ref), exaggeration=float(exaggeration))
            self._cond_key = key

    def ref_embed(self, ref: Path) -> np.ndarray:
        """The voice a take should sound like, as the voice encoder hears it."""
        if str(ref).endswith(".pt"):
            from chatterbox.tts import Conditionals

            e = Conditionals.load(str(ref)).t3.speaker_emb.detach().cpu().numpy().reshape(-1).astype(np.float64)
            return e / (np.linalg.norm(e) + 1e-12)
        return self.embed(read_wav(Path(ref)))

    def say(self, text: str, ref: Path, seed: int, exaggeration: float, cfg: float, temperature: float) -> np.ndarray:
        self.condition(ref, exaggeration)
        self.torch.manual_seed(int(seed))
        np.random.seed(int(seed))
        w = self.tts.generate(text, exaggeration=float(exaggeration), cfg_weight=float(cfg), temperature=float(temperature))
        return w.squeeze(0).detach().cpu().numpy().astype(np.float32)

    def embed(self, audio: np.ndarray) -> np.ndarray:
        from scipy.signal import resample_poly

        a = resample_poly(audio.astype(np.float32), 2, 3).astype(np.float32)
        e = self.tts.ve.embeds_from_wavs([a], sample_rate=16000)
        e = np.asarray(e[0], dtype=np.float64)
        return e / (np.linalg.norm(e) + 1e-12)


def tts_text(text: str) -> str:
    """What Chatterbox is given: the line with typography it reads badly made plain."""
    s = str(text).replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = s.replace("…", "...").replace("—", ", ").replace("–", ", ")
    s = re.sub(r"—", ", ", s)
    s = re.sub(r"\s+", " ", s).strip()
    if s.endswith("—") or s.endswith("-"):
        s = s.rstrip("-— ") + "..."
    return s


# --------------------------------------------------------------------------- references

def base_ref(name: str) -> Path:
    return HERE / "refs" / f"{name}.flac"


def default_voice() -> Path:
    """Chatterbox's own built-in voice (its conds.pt)."""
    hf_env()
    from huggingface_hub import hf_hub_download

    return Path(hf_hub_download("ResembleAI/chatterbox", "conds.pt"))


def shaped_ref(name: str, shape_spec: dict | None) -> Path:
    """The reference a character is conditioned on: one of the author's voices, reshaped
    (pitch, vocal-tract size, pace) into another person, cached by its recipe; or
    'default', Chatterbox's own voice."""
    if name == "default":
        return default_voice()
    src = base_ref(name)
    if not shape_spec:
        return src
    key = sha({"src": file_sha(src), "shape": shape_spec})
    out = cache_dir() / "refs" / f"{name}-{key}.wav"
    if not out.exists():
        a = read_wav(src)
        a = reshape_voice(a, float(shape_spec.get("pitch", 0)), float(shape_spec.get("formant", 0)), float(shape_spec.get("tempo", 1.0)))
        a = normalize(a, -20.0)
        a = limit(a, -1.0)
        write_wav(a, out)
    return out


# --------------------------------------------------------------------------- measuring

def f0_stats(audio: np.ndarray) -> dict:
    import librosa

    from scipy.signal import resample_poly

    a = resample_poly(audio.astype(np.float32), 2, 3)
    f0, vf, vp = librosa.pyin(a.astype(np.float64), fmin=50, fmax=500, sr=16000, frame_length=2048)
    ok = vf & ~np.isnan(f0)
    f = f0[ok]
    if len(f) < 5:
        return {"f0": 0.0, "range": 0.0}
    st = 12 * np.log2(f / np.median(f))
    return {"f0": round(float(np.median(f)), 1), "range": round(float(np.percentile(st, 90) - np.percentile(st, 10)), 1)}


def timbre(audio: np.ndarray) -> dict:
    import librosa

    S = np.abs(librosa.stft(audio.astype(np.float32), n_fft=1024, hop_length=240)) + 1e-9
    db = frame_db(audio)
    k = min(S.shape[1], len(db))
    keep = db[:k] > (db.max() - 30)
    cent = librosa.feature.spectral_centroid(S=S[:, :k][:, keep], sr=SR)[0]
    return {"centroid": round(float(np.median(cent)), 0) if len(cent) else 0.0}
