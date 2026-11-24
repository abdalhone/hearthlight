"""Measure rendered clips the way a listener would notice problems (DESIGN.md §21).

  python scripts/voice/verify.py [--out assets/voice] [--only lyra,bram] [--strict]

Decodes every clip in the manifest and reports, per speaker: count, duration, size,
loudness spread, peaks, median pitch and pitch range, speaking rate; and flags clips that
clip, start or end abruptly, hold long silences, miss the loudness target, or whose
duration disagrees with the manifest.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import voicelib as vl  # noqa: E402


def probe(path: Path) -> dict:
    p = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name,sample_rate,channels,bit_rate", "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    )
    return json.loads(p.stdout)["streams"][0]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(vl.ROOT / "assets" / "voice"))
    ap.add_argument("--only")
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--json")
    args = ap.parse_args()
    out = Path(args.out)
    manifest = json.loads((out / "manifest.json").read_text())
    only = set(args.only.split(",")) if args.only else None
    lines = {}
    for f in (vl.HERE / "lines.json", vl.HERE / "lines.sample.json"):
        if f.exists():
            for l in json.loads(f.read_text())["lines"]:
                lines[l["key"]] = l["text"]

    per: dict[str, list[dict]] = {}
    problems = []
    formats = set()
    for key, m in sorted(manifest.items()):
        if only and m["speaker"] not in only:
            continue
        path = out / f"{key}.mp3"
        st = probe(path)
        formats.add(f"{st['codec_name']} {st['sample_rate']} Hz {st['channels']} ch")
        audio = vl.decode(path)
        a = vl.analyze(audio)
        a["size"] = path.stat().st_size
        a["key"] = key
        per.setdefault(m["speaker"], []).append(a)
        head = vl.frame_rms(audio[: int(0.02 * vl.SR)])
        head_db = 20 * math.log10(float(head.max()) / (float(vl.frame_rms(audio).max()) + 1e-12) + 1e-12)
        if a["clipped"]:
            problems.append(f"{key}: {a['clipped']} clipped samples")
        if a["true_peak_db"] > -1.0:
            problems.append(f"{key}: true peak {a['true_peak_db']} dBTP")
        if abs(a["lufs"] - vl.TARGET_LUFS) > 1.5 and a["dur"] > 0.6:
            problems.append(f"{key}: {a['lufs']} LUFS")
        if a["tail_db"] > -30:
            problems.append(f"{key}: ends abruptly ({a['tail_db']} dB in the last 30 ms)")
        if head_db > -20:
            problems.append(f"{key}: starts abruptly ({head_db:.0f} dB in the first 20 ms)")
        if a["longest_gap_s"] > 1.2:
            problems.append(f"{key}: {a['longest_gap_s']}s of silence inside")
        # MP3 adds about 50 ms of encoder delay and padding
        if abs(a["dur"] - m["dur"]) > 0.15:
            problems.append(f"{key}: decodes to {a['dur']}s, manifest says {m['dur']}s")
        if key in lines:
            ipa_rate = len(vl.normalize_words(lines[key])) / max(a["speech_s"], 0.05)
            a["words_per_s"] = round(ipa_rate, 2)

    print(f"formats: {', '.join(sorted(formats))}")
    print(f"{'speaker':<11} {'clips':>5} {'min':>5} {'KB':>7} {'avg s':>6} {'LUFS':>12} {'tp max':>7} {'f0 med':>7} {'f0 p10-p90':>12} {'words/s':>8}")
    summary = {}
    for sp, rows in sorted(per.items()):
        dur = sum(r["dur"] for r in rows)
        size = sum(r["size"] for r in rows)
        lu = [r["lufs"] for r in rows if r["dur"] > 0.6] or [r["lufs"] for r in rows]
        f0 = [r["f0_med"] for r in rows if r["f0_med"] > 0]
        p10 = [r["f0_p10"] for r in rows if r["f0_p10"] > 0]
        p90 = [r["f0_p90"] for r in rows if r["f0_p90"] > 0]
        wps = [r["words_per_s"] for r in rows if "words_per_s" in r]
        summary[sp] = {
            "clips": len(rows), "minutes": round(dur / 60, 2), "kb": round(size / 1024), "avg_s": round(dur / len(rows), 2),
            "lufs_min": min(lu), "lufs_max": max(lu), "true_peak_max": max(r["true_peak_db"] for r in rows),
            "f0_median": round(float(np.median(f0)), 1) if f0 else 0, "f0_p10": round(float(np.median(p10)), 1) if p10 else 0,
            "f0_p90": round(float(np.median(p90)), 1) if p90 else 0, "words_per_s": round(float(np.median(wps)), 2) if wps else 0,
        }
        s = summary[sp]
        print(f"{sp:<11} {s['clips']:>5} {s['minutes']:>5.1f} {s['kb']:>7} {s['avg_s']:>6.2f} {s['lufs_min']:>5.1f}..{s['lufs_max']:<5.1f} "
              f"{s['true_peak_max']:>7.1f} {s['f0_median']:>7.1f} {s['f0_p10']:>5.0f}-{s['f0_p90']:<6.0f} {s['words_per_s']:>8.2f}")
    if args.json:
        Path(args.json).write_text(json.dumps(summary, indent=1))
    print("\nproblems:" if problems else "\nno problems found")
    for p in problems:
        print("  -", p)
    return 1 if problems and args.strict else 0


if __name__ == "__main__":
    raise SystemExit(main())
