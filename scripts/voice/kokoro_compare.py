"""Check Lyra's live (browser) Kokoro voice against kokoro-onnx (DESIGN.md §21).

  python scripts/voice/kokoro_compare.py BENCH_DIR

Reads the samples kokoro_bench.mjs wrote (worker_cold.f32), renders the same line with
kokoro-onnx and the same int8 model and voice, and compares duration, pitch and timbre.
"""

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import voicelib as vl  # noqa: E402


def main() -> int:
    d = Path(sys.argv[1])
    res = json.loads((d / "results.json").read_text())
    web = np.fromfile(d / "worker_cold.f32", dtype="<f4")
    spec = dict(vl.load_cast()["voices"]["lyra"])
    synth = vl.Synth(2, vl.CACHE / "kokoro-v1.0.int8.onnx")
    py = synth.raw(res["line"], spec)
    a, b = vl.analyze(vl.finish(web)), vl.analyze(vl.finish(py))
    dist = vl.voice_distance(a, b)
    print(json.dumps({
        "browser": {k: a[k] for k in ("dur", "f0_med", "f0_p10", "f0_p90", "hnr_db")},
        "kokoro_onnx": {k: b[k] for k in ("dur", "f0_med", "f0_p10", "f0_p90", "hnr_db")},
        "timbre_pitch_distance": round(dist, 2),
        "same_voice": dist < 1.5 and abs(a["dur"] - b["dur"]) < 0.4,
    }, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
