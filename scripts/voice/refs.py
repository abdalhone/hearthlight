"""Make the conditioning clips Chatterbox is given, from the author's reference voices.

    python scripts/voice/refs.py --void void_dry.mp3 --goth goth_girl.mp3 --bro bro.mp3

Each clip is the speech of the chosen stretch of a reference (10 ms frames above -42 dB,
gaps under 0.12 s bridged), gaps shortened to 0.25 s, at most 10 s (Chatterbox listens to
the first 6 s for the manner and 10 s for the sound of a voice). Written to refs/<name>.flac.

The references are the author's own synthetic voices (made with Chatterbox from a
computer-generated voice, and with ElevenLabs): nobody real is cloned.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import voicelib as vl  # noqa: E402

# Which stretches of each reference to listen to (seconds in the author's file).
WINDOWS = {
    "void": [(0.0, 20.0)],  # all of it: grave and even
    "goth": [(0.0, 8.0)],  # all of it
    "bro": [(4.3, 17.0)],  # not the scream at 3.4 s: an old man is not conditioned on a shout
}


def make(src: Path, windows, out: Path, max_s: float = 10.0) -> float:
    a = vl.load_audio(src)
    runs = vl.speech_runs(a)
    gap = np.zeros(int(0.25 * vl.SR), dtype=np.float32)
    parts, total = [], 0.0
    for s, e in runs:
        if not any(s >= w0 - 0.05 and e <= w1 + 0.05 for w0, w1 in windows):
            continue
        seg = a[max(0, int(s * vl.SR) - 240) : int(e * vl.SR) + 240]
        if total + len(seg) / vl.SR > max_s:
            break
        parts += [vl.fade(seg, 0.005, 0.005), gap]
        total += len(seg) / vl.SR + 0.25
    clip = np.concatenate(parts[:-1]) if parts else a[: int(max_s * vl.SR)]
    clip = vl.limit(vl.normalize(clip, -20.0), -1.0)
    vl.write_wav(clip, out)
    return len(clip) / vl.SR


def main() -> int:
    ap = argparse.ArgumentParser()
    for name in WINDOWS:
        ap.add_argument(f"--{name}", type=Path)
    args = ap.parse_args()
    for name, windows in WINDOWS.items():
        src = getattr(args, name)
        if not src:
            continue
        out = vl.HERE / "refs" / f"{name}.flac"
        print(f"{name}: {make(src, windows, out):.1f} s -> {out.relative_to(vl.ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
