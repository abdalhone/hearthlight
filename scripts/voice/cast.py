"""Casting checks for Hearthlight's voices (DESIGN.md §21).

  python scripts/voice/cast.py audition [--out DIR]     every English Kokoro voice, raw
  python scripts/voice/cast.py check [--out DIR] [--only a,b] [--json FILE]
                                                         every cast voice, shaped and normalized

Nobody can listen from a script, so voices are judged by measurement: the same test
sentence per voice, then median pitch and pitch range, speaking rate, loudness, peaks,
timbre (MFCC means) and artifact checks (clipping, long gaps, cut-off ends). `check`
prints each voice's nearest neighbour so two characters never sound alike.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import voicelib as vl  # noqa: E402

ENGLISH = [
    "af_alloy", "af_aoede", "af_bella", "af_heart", "af_jessica", "af_kore", "af_nicole", "af_nova",
    "af_river", "af_sarah", "af_sky", "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam",
    "am_michael", "am_onyx", "am_puck", "am_santa", "bf_alice", "bf_emma", "bf_isabella", "bf_lily",
    "bm_daniel", "bm_fable", "bm_george", "bm_lewis",
]


def fmt_row(name: str, a: dict) -> str:
    return (
        f"{name:<14} f0 {a['f0_med']:6.1f} Hz [{a['f0_p10']:5.1f}-{a['f0_p90']:5.1f}] "
        f"range {a.get('f0_range_st', 0):4.1f} st  rate {a.get('syl_per_s', 0):4.2f} syl/s  "
        f"dur {a['dur']:5.2f}s  {a['lufs']:6.1f} LUFS  tp {a['true_peak_db']:5.1f}  "
        f"hnr {a.get('hnr_db', 0):4.1f}  voiced {a.get('voiced', 0):.2f}  gap {a['longest_gap_s']:.2f}s  tail {a['tail_db']:6.1f} dB  clip {a['clipped']}"
    )


def audition(args) -> None:
    cast = vl.load_cast()
    text = cast["test"]
    synth = vl.Synth(args.threads)
    out = Path(args.out)
    rows = {}
    for v in ENGLISH:
        spec = {"voice": v, "lang": "en-gb" if v.startswith("b") else "en-us"}
        raw = synth.raw(text, spec)
        a = vl.analyze(raw, synth.phonemes(vl.tts_text(text), spec["lang"]))
        a["raw_clipped"] = int(np.sum(np.abs(raw) >= 0.999))
        rows[v] = a
        vl.write_wav(raw, out / f"{v}.wav")
        print(fmt_row(v, a), flush=True)
    (out / "audition.json").write_text(json.dumps(rows, indent=1))


def check(args) -> int:
    cast = vl.load_cast()
    texts = [cast["test"]] + ([cast["test2"]] if cast.get("test2") and args.both else [])
    synth = vl.Synth(args.threads)
    out = Path(args.out)
    only = set(args.only.split(",")) if args.only else None
    results = {}
    if only and args.json and Path(args.json).exists():
        # Re-check a few voices against the last full run.
        prev = json.loads(Path(args.json).read_text())
        results = {k: v for k, v in prev.items() if k.split("#")[0] in cast["voices"]}
    problems = []
    for sid, spec in cast["voices"].items():
        if only and sid not in only:
            continue
        for ti, text in enumerate(texts):
            raw = synth.raw(text, spec)
            shaped = vl.shape(raw, spec)
            done = vl.finish(shaped)
            a = vl.analyze(done, synth.phonemes(vl.tts_text(text), spec.get("lang", "en-us")))
            a["raw_clipped"] = int(np.sum(np.abs(raw) >= 0.999))
            key = sid if ti == 0 else f"{sid}#2"
            results[key] = a
            vl.write_wav(done, out / f"{key}.wav")
            print(fmt_row(key, a), flush=True)
            if a["clipped"]:
                problems.append(f"{key}: {a['clipped']} clipped samples")
            if a["longest_gap_s"] > 0.9:
                problems.append(f"{key}: a {a['longest_gap_s']}s silence inside the line")
            if a["tail_db"] > -25:
                problems.append(f"{key}: the end may be cut off (last 30 ms at {a['tail_db']} dB)")
            if abs(a["lufs"] - vl.TARGET_LUFS) > 1.0:
                problems.append(f"{key}: loudness {a['lufs']} LUFS")
    print("\nNearest neighbours (timbre + pitch distance; under 3.0 is too close):")
    ids = [k for k in results if "#" not in k]
    if only:
        problems = [p for p in problems if p.split(":")[0].split("#")[0] in only]
    close = []
    for a in ids:
        best = min(((vl.voice_distance(results[a], results[b]), b) for b in ids if b != a), default=(0, "-"))
        print(f"  {a:<10} -> {best[1]:<10} {best[0]:5.2f}")
        if best[0] < 3.0:
            close.append((a, best[1], best[0]))
    if close:
        problems += [f"{a} and {b} are close ({d:.2f})" for a, b, d in close]
    if args.json:
        Path(args.json).write_text(json.dumps(results, indent=1))
    print("\nProblems:" if problems else "\nNo problems found.")
    for p in problems:
        print("  -", p)
    return 1 if problems and args.strict else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["audition", "check"])
    ap.add_argument("--out", default=str(vl.CACHE / "casting"))
    ap.add_argument("--only")
    ap.add_argument("--json")
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--both", action="store_true", help="also render the second test sentence")
    ap.add_argument("--strict", action="store_true", help="exit 1 on any problem")
    args = ap.parse_args()
    if args.cmd == "audition":
        audition(args)
        return 0
    return check(args)


if __name__ == "__main__":
    raise SystemExit(main())
