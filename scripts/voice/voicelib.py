"""Shared voice tooling for Hearthlight (DESIGN.md §21).

Kokoro synthesis with cast voices (single voices or blends of style vectors), gentle
shaping (pitch/formant via ffmpeg rubberband, EQ, a touch of room), loudness
normalization, trimming, MP3 encoding, and the objective measurements the casting is
judged by (pitch, speaking rate, loudness, timbre, artifacts).

Model files live outside the repository, in HEARTHLIGHT_VOICE_CACHE
(default ~/.cache/hearthlight-voice): kokoro-v1.0.onnx and voices-v1.0.bin from
https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0
"""

from __future__ import annotations

import json
import math
import os
import re
import subprocess
from pathlib import Path

import numpy as np

SR = 24000
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent


def _cache_dir() -> Path:
    env = os.environ.get("HEARTHLIGHT_VOICE_CACHE")
    if env:
        return Path(env)
    for c in (Path.home() / ".cache" / "hearthlight-voice", Path("/home/user/.cache/hearthlight-voice")):
        if (c / "voices-v1.0.bin").exists():
            return c
    return Path.home() / ".cache" / "hearthlight-voice"


CACHE = _cache_dir()
MODEL = Path(os.environ.get("HEARTHLIGHT_KOKORO_MODEL", CACHE / "kokoro-v1.0.onnx"))
VOICES = Path(os.environ.get("HEARTHLIGHT_KOKORO_VOICES", CACHE / "voices-v1.0.bin"))

TARGET_LUFS = -16.0
CEILING_DB = -2.0  # sample-peak ceiling after the limiter (true peak stays under about -1 dBTP)


def load_cast(path: Path | None = None) -> dict:
    with open(path or HERE / "cast.json", encoding="utf-8") as fp:
        return json.load(fp)


# --------------------------------------------------------------------------- text

# Interjections espeak-ng spells out letter by letter ("Hmph" -> "H M P H"): spoken
# as sounds instead. Matched as whole words, case-insensitive.
LEXICON = [
    (r"h+u?m+p+h+", "hˈʌmf"),
    (r"h+m+", "hˈmː"),
    (r"m+-h+m+", "mˌhˈm"),
    (r"m+h+", "mˈmh"),
    (r"m{2,}", "ˈmmm"),
    (r"tch", "tʃ"),
    (r"sh{2,}", "ʃːː"),
    (r"pff+t", "pfːt"),
]
_LEX = [(re.compile(rf"^{pat}$", re.I), ipa) for pat, ipa in LEXICON]
_WORD = re.compile(r"[A-Za-z]+(?:-[A-Za-z]+)*")


def tts_text(text: str) -> str:
    """What is read aloud: no stage directions, notes or emoji, tidy spacing."""
    s = str(text or "")
    s = re.sub(r"\*[^*]{1,80}\*", " ", s)
    s = s.replace("♪", " ")
    s = re.sub("[\U0001F300-\U0001FAFF☀-➿]", " ", s)
    s = s.replace("’", "'").replace("‘", "'")
    s = re.sub(r"\s+", " ", s).strip()
    return s


class Synth:
    """One Kokoro session (threads limited so several can share the machine)."""

    def __init__(self, threads: int = 2, model: Path | None = None):
        import onnxruntime as rt
        from kokoro_onnx import Kokoro

        model = Path(model or MODEL)
        if not model.exists() or not VOICES.exists():
            raise SystemExit(
                f"Kokoro model files missing in {CACHE}. See scripts/voice/README.md (setup)."
            )
        so = rt.SessionOptions()
        so.intra_op_num_threads = max(1, threads)
        so.inter_op_num_threads = 1
        sess = rt.InferenceSession(str(model), sess_options=so, providers=["CPUExecutionProvider"])
        self.k = Kokoro.from_session(sess, str(VOICES))
        self.voices = self.k.voices

    def style(self, voice) -> np.ndarray:
        """A voice name, or a blend {name: weight} of style vectors."""
        if isinstance(voice, str):
            return self.voices[voice]
        total = float(sum(voice.values()))
        out = None
        for name, w in voice.items():
            v = self.voices[name] * (float(w) / total)
            out = v if out is None else out + v
        return out.astype(np.float32)

    def phonemes(self, text: str, lang: str) -> str:
        """espeak-ng phonemes, with the interjection lexicon spliced in."""
        tok = self.k.tokenizer
        pieces, last = [], 0
        for m in _WORD.finditer(text):
            ipa = next((p for rx, p in _LEX if rx.match(m.group(0))), None)
            if ipa is None:
                continue
            before = text[last : m.start()]
            if before.strip():
                pieces.append(tok.phonemize(before, lang))
            pieces.append(ipa)
            last = m.end()
        rest = text[last:]
        if rest.strip():
            pieces.append(tok.phonemize(rest, lang))
        out = ""
        for p in (p.strip() for p in pieces):
            if not p:
                continue
            out += p if (not out or p[0] in ".,!?;:…—") else " " + p
        return out

    def raw(self, text: str, cast: dict) -> np.ndarray:
        lang = cast.get("lang", "en-us")
        ph = self.phonemes(tts_text(text), lang)
        if not ph:
            return np.zeros(int(0.2 * SR), dtype=np.float32)
        audio, sr = self.k.create(
            ph,
            voice=self.style(cast["voice"]),
            speed=float(cast.get("speed", 1.0)),
            lang=lang,
            is_phonemes=True,
            sentence_pause=float(cast.get("sentencePause", 0.3)),
            clause_pause=float(cast.get("clausePause", 0.12)),
        )
        assert sr == SR
        return np.asarray(audio, dtype=np.float32)


# --------------------------------------------------------------------------- shaping


def ffmpeg_filters(fx: dict) -> list[str]:
    """The ffmpeg chain for a cast's fx. Everything is gentle by design."""
    f: list[str] = []
    size = float(fx.get("size", 0))  # formant shift in semitones (+ smaller/younger, - bigger/older)
    pitch = float(fx.get("pitch", 0))  # pitch shift in semitones, formants kept
    if size:
        r = 2 ** (size / 12)
        f.append(f"asetrate={SR * r:.3f}")
        f.append(f"aresample={SR}")
        f.append(f"rubberband=tempo={1 / r:.5f}:pitch={(2 ** (pitch / 12)) / r:.5f}:formant=preserved:pitchq=quality")
    elif pitch:
        f.append(f"rubberband=pitch={2 ** (pitch / 12):.5f}:formant=preserved:pitchq=quality")
    if fx.get("highpass"):
        f.append(f"highpass=f={float(fx['highpass']):.0f}:poles=2")
    if fx.get("bass"):
        f.append(f"bass=g={float(fx['bass']):.2f}:f=160:w=0.7")
    for band in fx.get("eq", []):
        freq, gain, q = band
        f.append(f"equalizer=f={freq}:t=q:w={q}:g={gain}")
    if fx.get("treble"):
        f.append(f"treble=g={float(fx['treble']):.2f}:f=4500:w=0.6")
    if fx.get("lowpass"):
        f.append(f"lowpass=f={float(fx['lowpass']):.0f}:poles=2")
    return f


def run_ffmpeg(audio: np.ndarray, filters: list[str]) -> np.ndarray:
    if not filters:
        return audio
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "pipe:0",
        "-af", ",".join(filters),
        "-f", "f32le", "-ar", str(SR), "-ac", "1", "pipe:1",
    ]
    p = subprocess.run(cmd, input=audio.astype(np.float32).tobytes(), capture_output=True, check=True)
    return np.frombuffer(p.stdout, dtype=np.float32).copy()


def room(audio: np.ndarray, amount: float, size: float = 0.35, seed: int = 11) -> np.ndarray:
    """A small, dark room: decaying filtered noise convolved in, mixed low."""
    if amount <= 0:
        return audio
    from scipy.signal import fftconvolve, lfilter

    n = int(SR * size)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    ir = rng.standard_normal(n) * np.exp(-6.9 * t / size)  # -60 dB at `size` seconds
    ir = lfilter([0.25], [1, -0.75], ir)  # darker tail
    pre = int(0.012 * SR)
    ir = np.concatenate([np.zeros(pre), ir])
    ir /= np.sqrt(np.sum(ir**2)) + 1e-12
    wet = fftconvolve(audio, ir)
    dry = np.concatenate([audio, np.zeros(len(wet) - len(audio), dtype=np.float32)])
    return (dry + amount * wet).astype(np.float32)


def tremor(audio: np.ndarray, cents: float, rate: float = 5.2, seed: int = 3) -> np.ndarray:
    """A faint, uneven pitch waver for the very old (a few cents, never a warble):
    a modulated delay line read with linear interpolation."""
    if cents <= 0:
        return audio
    n = len(audio)
    t = np.arange(n) / SR
    rel = 2 ** (cents / 1200) - 1  # peak relative frequency deviation
    rng = np.random.default_rng(seed)
    p1, p2 = rng.uniform(0, 2 * np.pi, 2)
    # Two incommensurate rates so it never sounds like an effect.
    a1 = rel / (2 * np.pi * rate) * 0.7
    a2 = rel / (2 * np.pi * rate * 1.37) * 0.3
    delay = 0.004 + a1 * np.sin(2 * np.pi * rate * t + p1) + a2 * np.sin(2 * np.pi * rate * 1.37 * t + p2)
    pos = np.clip(np.arange(n) - delay * SR, 0, n - 1)
    i = np.floor(pos).astype(np.int64)
    f = (pos - i).astype(np.float32)
    j = np.minimum(i + 1, n - 1)
    return (audio[i] * (1 - f) + audio[j] * f).astype(np.float32)


def shape(audio: np.ndarray, cast: dict) -> np.ndarray:
    fx = cast.get("fx", {}) or {}
    out = run_ffmpeg(audio, ffmpeg_filters(fx))
    out = tremor(out, float(fx.get("tremor", 0)))
    out = room(out, float(fx.get("room", 0)), float(fx.get("roomSize", 0.35)))
    return out


# --------------------------------------------------------------------------- loudness, limiting, trimming


def lufs(audio: np.ndarray) -> float:
    import pyloudnorm as pyln

    x = audio
    min_len = int(0.45 * SR)
    if len(x) < min_len:
        x = np.concatenate([x, np.zeros(min_len - len(x), dtype=np.float32)])
    try:
        v = pyln.Meter(SR).integrated_loudness(x.astype(np.float64))
    except Exception:
        v = -70.0
    return float(v) if math.isfinite(v) else -70.0


def true_peak_db(audio: np.ndarray) -> float:
    from scipy.signal import resample_poly

    up = resample_poly(audio.astype(np.float64), 4, 1)
    pk = float(np.max(np.abs(up))) if len(up) else 0.0
    return 20 * math.log10(pk + 1e-12)


def limit(audio: np.ndarray, ceiling_db: float = CEILING_DB) -> np.ndarray:
    """Look-ahead peak limiter: gain never exceeds what keeps every sample under the ceiling."""
    from scipy.ndimage import minimum_filter1d, uniform_filter1d

    ceiling = 10 ** (ceiling_db / 20)
    a = np.abs(audio)
    if a.max(initial=0) <= ceiling:
        return audio
    need = np.minimum(1.0, ceiling / np.maximum(a, 1e-9))
    w = int(0.004 * SR)
    g = minimum_filter1d(need, size=2 * w + 1, mode="nearest")
    g = uniform_filter1d(g, size=2 * w + 1, mode="nearest")
    return (audio * g).astype(np.float32)


def frame_rms(audio: np.ndarray, frame: int = 240) -> np.ndarray:
    n = len(audio) // frame
    if n == 0:
        return np.zeros(1)
    return np.sqrt(np.mean(audio[: n * frame].reshape(n, frame) ** 2, axis=1) + 1e-12)


def trim(audio: np.ndarray, rel_db: float = -45.0, lead: float = 0.03, tail: float = 0.14) -> np.ndarray:
    frame = 240  # 10 ms
    r = frame_rms(audio, frame)
    thr = r.max() * 10 ** (rel_db / 20)
    on = np.nonzero(r > thr)[0]
    if not len(on):
        return audio
    a = max(0, on[0] * frame - int(lead * SR))
    b = min(len(audio), (on[-1] + 1) * frame + int(tail * SR))
    out = audio[a:b].copy()
    fi, fo = int(0.006 * SR), int(0.04 * SR)
    out[:fi] *= np.linspace(0, 1, fi, dtype=np.float32)[: len(out[:fi])]
    if len(out) > fo:
        out[-fo:] *= np.linspace(1, 0, fo, dtype=np.float32)
    return out


def finish(audio: np.ndarray, target: float = TARGET_LUFS) -> np.ndarray:
    """Normalize to the target loudness, limit, trim, fade."""
    x = trim(audio)
    # Limiting a peaky voice lowers its loudness: measure again and top it up.
    for _ in range(3):
        gain = target - lufs(x)
        if abs(gain) < 0.3:
            break
        x = limit(x * (10 ** (gain / 20)))
    return x.astype(np.float32)


def encode_mp3(audio: np.ndarray, path: Path, kbps: int = 48) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp.mp3")
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "pipe:0",
        "-c:a", "libmp3lame", "-b:a", f"{kbps}k", "-ar", str(SR), "-ac", "1",
        "-map_metadata", "-1", str(tmp),
    ]
    subprocess.run(cmd, input=audio.astype(np.float32).tobytes(), capture_output=True, check=True)
    os.replace(tmp, path)


def decode(path: Path) -> np.ndarray:
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path), "-f", "f32le", "-ar", str(SR), "-ac", "1", "pipe:1"]
    p = subprocess.run(cmd, capture_output=True, check=True)
    return np.frombuffer(p.stdout, dtype=np.float32).copy()


def write_wav(audio: np.ndarray, path: Path) -> None:
    import soundfile as sf

    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), audio, SR)


def render(synth: Synth, text: str, cast: dict) -> np.ndarray:
    return finish(shape(synth.raw(text, cast), cast))


# --------------------------------------------------------------------------- analysis


def f0_track(audio: np.ndarray, fmin: float = 65, fmax: float = 520, strengths: list | None = None) -> np.ndarray:
    """Per-frame F0 (Hz) of voiced frames by normalized autocorrelation.

    `strengths`, when given, receives each voiced frame's autocorrelation peak (for HNR)."""
    frame, hop = int(0.04 * SR), int(0.01 * SR)
    lo, hi = int(SR / fmax), int(SR / fmin)
    if len(audio) < frame:
        return np.zeros(0)
    peak = np.max(np.abs(audio)) + 1e-9
    out = []
    win = np.hanning(frame)
    nfft = 1 << (2 * frame - 1).bit_length()
    for s in range(0, len(audio) - frame, hop):
        x = audio[s : s + frame] * win
        if np.sqrt(np.mean(x**2)) < peak * 0.02:
            continue
        spec = np.fft.rfft(x, nfft)
        ac = np.fft.irfft(np.abs(spec) ** 2)[: frame]
        if ac[0] <= 0:
            continue
        # Normalize by the window's own autocorrelation so long lags are not penalized.
        wac = np.fft.irfft(np.abs(np.fft.rfft(win, nfft)) ** 2)[: frame]
        r = ac / (ac[0] * np.maximum(wac / wac[0], 1e-3))
        seg = r[lo:hi]
        i = int(np.argmax(seg))
        if seg[i] < 0.55:
            continue
        # Prefer the shortest lag that is nearly as strong (avoids octave-down errors).
        strong = np.nonzero(seg >= seg[i] * 0.92)[0]
        j = int(strong[0])
        # walk to the local max of that region
        while j + 1 < len(seg) and seg[j + 1] > seg[j]:
            j += 1
        lag = j + lo
        if 1 <= j < len(seg) - 1:
            a, b, c = seg[j - 1], seg[j], seg[j + 1]
            d = (a - c) / (2 * (a - 2 * b + c) + 1e-12)
            lag = lag + float(np.clip(d, -0.5, 0.5))
        out.append(SR / lag)
        if strengths is not None:
            strengths.append(float(min(seg[i], 0.999)))
    return np.asarray(out)


VOWELS = set("aeiouyæɑɐɒɔəɘɚɛɜɞɤɨɪʊʉʌʏøœɶɯɵʘᵻAIOQWY")


def syllables(ipa: str) -> int:
    n, prev = 0, False
    for ch in ipa:
        v = ch in VOWELS
        if v and not prev:
            n += 1
        prev = v
    return max(1, n)


def mfcc_stats(audio: np.ndarray, n_mels: int = 40, n_mfcc: int = 13) -> tuple[np.ndarray, float]:
    from scipy.fft import dct

    nfft, hop = 512, 240
    if len(audio) < nfft:
        audio = np.pad(audio, (0, nfft - len(audio)))
    n = 1 + (len(audio) - nfft) // hop
    idx = np.arange(nfft)[None, :] + hop * np.arange(n)[:, None]
    frames = audio[idx] * np.hanning(nfft)
    p = np.abs(np.fft.rfft(frames, nfft)) ** 2
    freqs = np.fft.rfftfreq(nfft, 1 / SR)
    mel = lambda f: 2595 * np.log10(1 + f / 700)
    imel = lambda m: 700 * (10 ** (m / 2595) - 1)
    pts = imel(np.linspace(mel(60), mel(8000), n_mels + 2))
    fb = np.zeros((n_mels, len(freqs)))
    for i in range(n_mels):
        l, c, r = pts[i], pts[i + 1], pts[i + 2]
        fb[i] = np.clip(np.minimum((freqs - l) / (c - l), (r - freqs) / (r - c)), 0, None)
    e = p @ fb.T
    active = p.sum(1) > p.sum(1).max() * 10 ** (-35 / 10)
    loge = np.log(e[active] + 1e-10)
    m = dct(loge, type=2, axis=1, norm="ortho")[:, 1:n_mfcc]
    centroid = float(np.sum(p[active] * freqs, 1).sum() / (p[active].sum() + 1e-12))
    return m.mean(0), centroid


def analyze(audio: np.ndarray, ipa: str | None = None) -> dict:
    strengths: list = []
    f0 = f0_track(audio, strengths=strengths)
    r = frame_rms(audio)
    thr = r.max() * 10 ** (-35 / 20)
    act = r > thr
    on = np.nonzero(act)[0]
    speech_s = float(act.sum()) * 0.01
    # longest quiet run between the first and last active frame
    longest = 0
    if len(on):
        run = 0
        for v in act[on[0] : on[-1] + 1]:
            run = 0 if v else run + 1
            longest = max(longest, run)
    tail = audio[-int(0.03 * SR) :] if len(audio) > int(0.03 * SR) else audio
    tail_db = 20 * math.log10(np.sqrt(np.mean(tail**2)) / (r.max() + 1e-12) + 1e-12)
    mf, centroid = mfcc_stats(audio)
    out = {
        "dur": round(len(audio) / SR, 3),
        "speech_s": round(speech_s, 2),
        "lufs": round(lufs(audio), 1),
        "peak_db": round(20 * math.log10(np.max(np.abs(audio)) + 1e-12), 2),
        "true_peak_db": round(true_peak_db(audio), 2),
        "clipped": int(np.sum(np.abs(audio) >= 0.999)),
        "longest_gap_s": round(longest * 0.01, 2),
        "tail_db": round(tail_db, 1),
        "f0_med": round(float(np.median(f0)), 1) if len(f0) else 0.0,
        "f0_p10": round(float(np.percentile(f0, 10)), 1) if len(f0) else 0.0,
        "f0_p90": round(float(np.percentile(f0, 90)), 1) if len(f0) else 0.0,
        "voiced": round(len(f0) * 0.01 / max(speech_s, 0.01), 2),
        # harmonics-to-noise: low values read as breathy, hoarse or buzzy
        "hnr_db": round(float(np.median([10 * math.log10(v / (1 - v)) for v in strengths])), 1) if strengths else 0.0,
        "centroid": round(centroid),
        "mfcc": [round(float(v), 3) for v in mf],
    }
    if out["f0_p10"] > 0:
        out["f0_range_st"] = round(12 * math.log2(out["f0_p90"] / out["f0_p10"]), 1)
    if ipa:
        out["syl_per_s"] = round(syllables(ipa) / max(speech_s, 0.05), 2)
    return out


def voice_distance(a: dict, b: dict) -> float:
    """How different two voices sound: timbre (MFCC means) plus pitch in semitones."""
    m = np.linalg.norm(np.asarray(a["mfcc"]) - np.asarray(b["mfcc"]))
    if a["f0_med"] > 0 and b["f0_med"] > 0:
        st = abs(12 * math.log2(a["f0_med"] / b["f0_med"]))
    else:
        st = 0.0
    return float(m + 0.6 * st)
