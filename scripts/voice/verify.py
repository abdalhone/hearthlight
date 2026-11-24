"""Check every cutscene clip the author's way (step 8): transcribe the finished clip with
Whisper and compare it with the script, measure loudness and peaks, and make sure nothing
is silent, missing or cut off.

    $PY scripts/voice/verify.py [--model small.en] [--quick]

Prints one row per line (WER, duration, LUFS, true peak, size) and a summary; writes
scripts/voice/verify.json. --quick skips Whisper (loudness, peaks and files only).
Exit status 1 when a clip is missing, silent, too loud or out of loudness range.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import voicelib as vl  # noqa: E402

OUT = vl.ROOT / "assets" / "voice"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="small.en")
    ap.add_argument("--quick", action="store_true")
    args = ap.parse_args()
    lines = json.loads((vl.HERE / "lines.json").read_text())["lines"]
    manifest = vl.load_json(OUT / "manifest.json", {}) or {}
    clips = manifest.get("clips", {})
    ears = None if args.quick else vl.Ears(args.model, 2, vl.glossary_of([l["text"] for l in lines]))
    rows, problems = [], []
    total_bytes = 0
    for l in lines:
        c = clips.get(l["key"])
        f = OUT / (c["file"] if c else f"{l['key']}.mp3")
        if not c or not f.exists():
            problems.append(f"{l['line']}: no clip")
            rows.append({"line": l["line"], "speaker": l["speaker"], "missing": True})
            continue
        a = vl.load_audio(f)
        dur = len(a) / vl.SR
        lu = vl.lufs(a)
        tp = vl.true_peak_db(a)
        db = vl.frame_db(a)
        voiced = float(np.mean(db > -45)) if len(db) else 0.0
        size = f.stat().st_size
        total_bytes += size
        row = {"line": l["line"], "speaker": l["speaker"], "dur": round(dur, 2), "lufs": round(lu, 1), "tp": round(tp, 2), "kb": round(size / 1024, 1),
               "voiced": round(voiced, 2), "take_errors": c.get("errors"), "strength": c.get("strength", 1.0), "seed": c.get("seed")}
        if ears:
            heard = ears.words(a)
            e, n = vl.word_errors(l["text"], [w[0] for w in heard], ears.names)
            row.update({"errors": e, "n": n, "wer": round(e / max(1, n), 3), "heard": " ".join(w[0] for w in heard)})
        if c.get("text") != l["text"]:
            problems.append(f"{l['line']}: clip made for other words")
        if dur < 0.3 or voiced < 0.25:
            problems.append(f"{l['line']}: (nearly) silent")
        if tp > vl.MAX_TRUE_PEAK_DB + 0.05:
            problems.append(f"{l['line']}: true peak {tp:.2f} dBTP")
        if abs(lu - vl.TARGET_LUFS) > 1.0:
            problems.append(f"{l['line']}: {lu:.1f} LUFS")
        if len(c.get("words", [])) != len(vl.display_tokens(l["text"])):
            problems.append(f"{l['line']}: caption words do not match the line")
        rows.append(row)
        if ears:
            flag = "" if row["errors"] == 0 else f"   heard: {row['heard']}"
            print(f"{l['line']:18s} {l['speaker']:8s} WER {row['wer']:.2f} ({row['errors']}/{row['n']})  {dur:5.1f}s {lu:6.1f} LUFS {tp:6.2f} dBTP {size / 1024:5.0f} KB{flag}", flush=True)
    done = [r for r in rows if not r.get("missing")]
    summary = {
        "lines": len(lines), "voiced": len(done), "minutes": round(sum(r["dur"] for r in done) / 60, 2), "mb": round(total_bytes / 1e6, 2),
        "lufs": [round(min(r["lufs"] for r in done), 1), round(max(r["lufs"] for r in done), 1)] if done else None,
        "max_tp": round(max(r["tp"] for r in done), 2) if done else None,
    }
    if ears and done:
        errs = sum(r["errors"] for r in done)
        words = sum(r["n"] for r in done)
        summary.update({"words": words, "word_errors": errs, "wer": round(errs / max(1, words), 4), "perfect_lines": sum(1 for r in done if r["errors"] == 0),
                        "takes_flagged": sum(1 for r in done if (r.get("take_errors") or 0) > 0), "lightened": sum(1 for r in done if (r.get("strength") or 1) < 1)})
    vl.write_json(vl.HERE / "verify.json", {"summary": summary, "problems": problems, "rows": rows}, indent=1)
    print(json.dumps(summary))
    for p in problems:
        print("  problem:", p)
    return 1 if any("no clip" in p or "silent" in p or "true peak" in p or "LUFS" in p for p in problems) else 0


if __name__ == "__main__":
    sys.exit(main())
