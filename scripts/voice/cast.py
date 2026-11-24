"""Audition the cast: one or two real lines per character, measured (CASTING.md).

    $PY scripts/voice/cast.py audition [--only hess,wenna] [--n 1] [--default]

Each audition line is rendered exactly as the full render would (first seed only, so its
take is reused later) and finished. Then, per character: median pitch and range, speaking
rate, brightness (spectral centroid), how close Chatterbox came to the character's
reference (voice-encoder cosine), whether Whisper heard every word — and, for every pair
of characters, how alike they sound (voice-encoder cosine of the finished clips). A woman
in the cutscenes must never sound like Lyra: her similarity to Lyra must stay well under
Lyra's similarity to herself. --default also auditions Chatterbox's own built-in voice.
Clips land in ~/.cache/hearthlight-voice/audition/ to listen to.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import voicelib as vl  # noqa: E402
import render as R  # noqa: E402


def pick_lines(lines: list[dict], speaker: str, n: int) -> list[dict]:
    mine = [l for l in lines if l["speaker"] == speaker]
    mine.sort(key=lambda l: abs(len(l["text"]) - 80))  # medium-length lines measure best
    return mine[:n]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["audition"])
    ap.add_argument("--only", default="")
    ap.add_argument("--n", type=int, default=1)
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--default", action="store_true")
    args = ap.parse_args()

    lines = R.collect()
    cast = R.load_cast()
    names = sorted(vl.glossary_of([l["text"] for l in lines]))
    R._init(args.threads, names)
    out = vl.cache_dir() / "audition"
    out.mkdir(parents=True, exist_ok=True)
    speakers = [s for s in cast["voices"] if not args.only or s in args.only.split(",")]
    if "lyra" not in speakers:
        speakers.insert(0, "lyra")
    rows, embs = {}, {}
    for sp in speakers:
        for l in pick_lines(lines, sp, args.n):
            job = R.plan_line(l, cast)
            job["takes"] = job["takes"][:1]
            info = R.take_for(job, job["takes"][0])
            audio, _ = R.finish_line(job, info)
            vl.write_wav(audio, out / f"{sp}-{l['line']}.wav")
            emb = R._W["mouth"].embed(audio)
            embs.setdefault(sp, []).append(emb)
            f0 = vl.f0_stats(audio)
            words = len(vl.norm_tokens(l["text"]))
            row = rows.setdefault(sp, {"f0": [], "range": [], "wps": [], "centroid": [], "sim_ref": [], "errors": 0, "n": 0})
            row["f0"].append(f0["f0"])
            row["range"].append(f0["range"])
            row["wps"].append(words / max(0.5, info["dur"]))
            row["centroid"].append(vl.timbre(audio)["centroid"])
            row["sim_ref"].append(info["sim"])
            row["errors"] += info["errors"]
            row["n"] += info["n"]
            print(f"  {sp:8s} {l['line']:18s} errors {info['errors']} sim {info['sim']:.3f} heard: {info['heard']}", flush=True)
    if args.default:
        # Chatterbox's own voice, unconditioned, on one of Aveline's lines.
        l = pick_lines(lines, "aveline", 1)[0]
        m = R._W["mouth"]
        import torch
        from chatterbox.tts import Conditionals
        from huggingface_hub import hf_hub_download

        m.tts.conds = Conditionals.load(hf_hub_download("ResembleAI/chatterbox", "conds.pt")).to("cpu")
        m._cond_key = None
        torch.manual_seed(11)
        a = m.tts.generate(vl.tts_text(l["text"]), exaggeration=0.3, cfg_weight=0.3, temperature=0.7).squeeze(0).numpy()
        clip, _ = vl.cut_line(a, R._W["ears"].words(a))
        audio = vl.finish(clip)
        vl.write_wav(audio, out / "default-voice.wav")
        embs["(default)"] = [m.embed(audio)]
        f0 = vl.f0_stats(audio)
        rows["(default)"] = {"f0": [f0["f0"]], "range": [f0["range"]], "wps": [len(vl.norm_tokens(l["text"])) / (len(audio) / vl.SR)], "centroid": [vl.timbre(audio)["centroid"]], "sim_ref": [0], "errors": 0, "n": 0}
    print()
    print(f"{'who':10s} {'F0 Hz':>6s} {'range':>6s} {'w/s':>5s} {'bright':>7s} {'~ref':>5s} {'~Lyra':>6s} {'nearest':>18s}")
    mean = {k: (lambda v: v / np.linalg.norm(v))(np.mean(v, axis=0)) for k, v in embs.items()}
    report = {}
    for sp, row in rows.items():
        others = {o: float(np.dot(mean[sp], mean[o])) for o in mean if o != sp}
        near = max(others, key=others.get) if others else "-"
        to_lyra = float(np.dot(mean[sp], mean["lyra"])) if sp != "lyra" and "lyra" in mean else 1.0
        r = {k: round(float(np.mean(v)), 3) for k, v in row.items() if isinstance(v, list)}
        r.update({"errors": row["errors"], "to_lyra": round(to_lyra, 3), "nearest": near, "nearest_sim": round(others.get(near, 0), 3)})
        report[sp] = r
        print(f"{sp:10s} {r['f0']:6.0f} {r['range']:6.1f} {r['wps']:5.2f} {r['centroid']:7.0f} {r['sim_ref']:5.2f} {to_lyra:6.3f} {near:>10s} {others.get(near, 0):.3f}")
    vl.write_json(out / "report.json", report, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
