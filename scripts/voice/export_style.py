"""Write one cast voice's Kokoro style vectors (the blend in cast.json) as raw float32.

  python scripts/voice/export_style.py lyra OUT.bin     -> 510 x 256 float32, little-endian

Used by `npm run build -- --kokoro` so the live voice ships only Lyra's voice.
"""

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import voicelib as vl  # noqa: E402


def main() -> int:
    speaker, out = sys.argv[1], Path(sys.argv[2])
    spec = vl.load_cast()["voices"][speaker]
    voices = np.load(vl.VOICES)
    voice = spec["voice"]
    if isinstance(voice, str):
        style = voices[voice]
    else:
        total = float(sum(voice.values()))
        style = sum(voices[k] * (float(w) / total) for k, w in voice.items())
    style = np.asarray(style, dtype="<f4").reshape(-1, 256)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(style.tobytes())
    print(json.dumps({"rows": int(style.shape[0]), "speed": spec.get("speed", 1.0), "lang": spec.get("lang", "en-us")}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
