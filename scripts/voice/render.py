"""Render every cutscene line, the author's way (README.md here).

    node scripts/voice/collect.mjs                      # -> scripts/voice/lines.json
    $PY scripts/voice/render.py --jobs 2                 # -> assets/voice/<key>.mp3 + manifest.json
    $PY scripts/voice/verify.py                          # Whisper, loudness, peaks: the table

Per line: Chatterbox speaks it three times (three seeds) in the cast voice; Whisper
transcribes each take; the take where every word is right wins (ties go to the take that
sounds most like the character's reference, with no long gaps and the clearest words);
it is cut on its real loudness, shaped (the Void's chain for the narrator), set to -16
LUFS, encoded as mono MP3, and transcribed again for the word times the captions use.

Incremental: takes are cached by speaker voice + text + generation settings + seed
(~/.cache/hearthlight-voice/takes), finished clips by their takes + shaping, so changing a
voice's shaping re-finishes in seconds and only changed lines are spoken again.
  --only lyra,hess     these speakers      --script prologue   this scene
  --limit N            the first N lines   --force             finish everything again
  --jobs 2 --threads 2 two workers, two CPU threads each (the machine is shared)
"""

from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import voicelib as vl  # noqa: E402

OUT = vl.ROOT / "assets" / "voice"
LINES = vl.HERE / "lines.json"
CAST = vl.HERE / "cast.json"
MODEL = "chatterbox-0.1.7"
EARS = "small.en"  # Whisper that judges takes and checks the finished clips (base.en mishears the Void)
LIGHTER = [1.0, 0.6, 0.35, 0.15]  # effect strength tried in turn while a finished clip loses a word


def load_cast() -> dict:
    return json.loads(CAST.read_text())


def voice_for(cast: dict, speaker: str) -> dict:
    v = cast["voices"].get(speaker)
    if not v:
        raise SystemExit(f"no cast voice for '{speaker}' in cast.json")
    return v


def gen_for(v: dict, mood: str | None) -> dict:
    g = dict(v.get("gen", {}))
    g.update((v.get("moods") or {}).get(mood or "", {}))
    return {"exaggeration": float(g.get("exaggeration", 0.5)), "cfg": float(g.get("cfg", 0.5)), "temperature": float(g.get("temperature", 0.8))}


def plan_line(line: dict, cast: dict) -> dict:
    """Everything a worker needs for one line, with the fingerprints that decide what is
    already done."""
    v = voice_for(cast, line["speaker"])
    ref = vl.shaped_ref(v["ref"], v.get("refShape"))
    gen = gen_for(v, line.get("mood"))
    text = vl.tts_text(line["text"])
    ref_sha = vl.file_sha(ref)
    seeds = list(v.get("seeds") or cast.get("seeds") or [11, 23, 37])
    takes = [{"seed": s, "fp": vl.sha({"model": MODEL, "ref": ref_sha, "text": text, "gen": gen, "seed": s})} for s in seeds]
    post = {"fx": v.get("fx") or {}, "void": v.get("void"), "place": line.get("place"), "pipeline": vl.PIPELINE, "ears": EARS, "lighter": LIGHTER}
    fp = vl.sha({"takes": [t["fp"] for t in takes], "post": post, "kbps": vl.KBPS})
    return {**line, "tts": text, "ref": str(ref), "ref_sha": ref_sha, "gen": gen, "takes": takes, "post": post, "fp": fp}


# --------------------------------------------------------------------------- worker

_W: dict = {}


def _init(threads: int, names: list[str]) -> None:
    os.environ["OMP_NUM_THREADS"] = str(threads)
    import warnings

    warnings.filterwarnings("ignore")
    _W["mouth"] = vl.Mouth(threads)
    _W["ears"] = vl.Ears(EARS, threads, set(names))
    _W["names"] = set(names)
    _W["refemb"] = {}


def _ref_emb(ref: str, ref_sha: str) -> np.ndarray:
    e = _W["refemb"].get(ref_sha)
    if e is None:
        e = _W["mouth"].ref_embed(Path(ref))
        _W["refemb"][ref_sha] = e
    return e


def take_for(job: dict, t: dict) -> dict:
    """One take: spoken (or from the cache), heard, scored."""
    d = vl.cache_dir() / "takes"
    wav, meta = d / f"{t['fp']}.wav", d / f"{t['fp']}.json"
    info = vl.load_json(meta)
    if info and wav.exists() and info.get("ears") == EARS:
        # What was heard is kept; how it is compared with the script may have improved.
        info["errors"], info["n"] = vl.word_errors(job["text"], info["heard"].split(), _W.get("names"))
        return info
    t0 = time.time()
    if wav.exists():
        audio = vl.read_wav(wav)
    else:
        g = job["gen"]
        audio = _W["mouth"].say(job["tts"], Path(job["ref"]), t["seed"], g["exaggeration"], g["cfg"], g["temperature"])
        vl.write_wav(audio, wav)
    gen_s = time.time() - t0
    words = _W["ears"].words(audio)
    errors, n = vl.word_errors(job["text"], [w[0] for w in words], _W["names"])
    emb = _W["mouth"].embed(audio)
    sim = float(np.dot(emb, _ref_emb(job["ref"], job["ref_sha"])))
    clip, off = vl.cut_line(audio, words)
    info = {
        "seed": t["seed"], "fp": t["fp"], "errors": errors, "n": n, "heard": " ".join(w[0] for w in words),
        "words": words, "sim": round(sim, 4), "gap": round(vl.longest_gap(clip), 3), "dur": round(len(clip) / vl.SR, 3),
        "prob": round(float(np.mean([w[3] for w in words])) if words else 0.0, 3), "gen_s": round(gen_s, 1), "ears": EARS,
    }
    vl.write_json(meta, info)
    return info


def score(info: dict) -> float:
    """Lower is better: every word right first, then the voice, no long holes, clear words."""
    gap_pen = max(0.0, info["gap"] - 0.9) * 0.5
    return info["errors"] * 10 + (1 - info["sim"]) * 5 + gap_pen + (1 - info["prob"]) * 2


def lighter(post: dict, k: float) -> dict:
    """The same shaping with its effects at strength k (the author's check: an effect that
    hides a word is lowered, the echo lightened, and the clip heard again)."""
    if k >= 1:
        return post
    p = json.loads(json.dumps(post))
    if p.get("void"):
        v = p["void"]
        v["echo90"] = v.get("echo90", 0.22) * k
        v["echo160"] = v.get("echo160", 0.12) * k
        v["octaveDb"] = v.get("octaveDb", -15.0) + 20 * np.log10(max(k, 1e-3))
    fx = p.get("fx") or {}
    for key in ("grit", "tremor"):
        if key in fx:
            fx[key] = fx[key] * k
    p["fx"] = fx
    p["roomScale"] = k
    return p


def finish_line(job: dict, best: dict, k: float = 1.0) -> tuple[np.ndarray, list]:
    audio = vl.read_wav(vl.cache_dir() / "takes" / f"{best['fp']}.wav")
    clip, off = vl.cut_line(audio, best["words"])
    post = lighter(job["post"], k)
    if post.get("void"):
        x = vl.void_chain(clip, best["words"], off, post["void"])
    else:
        x = vl.shape(clip, post.get("fx") or {}, post.get("place"), post.get("roomScale", 1.0))
    return vl.finish(x), best["words"]


def caption_words(text: str, heard: list, fallback: list, offset: float = 0.0) -> list:
    """Each word of the line as the caption shows it, with when it is spoken: Whisper's
    words on the finished clip aligned to the script's words; a word it missed sits between
    its neighbours."""
    disp = vl.display_tokens(text)
    owner: list[int] = []  # norm token -> display token
    ref: list[str] = []
    for i, tok in enumerate(disp):
        for w in vl.norm_tokens(tok):
            ref.append(w)
            owner.append(i)
    hyp: list[str] = []
    times: list[tuple[float, float]] = []
    for w in heard:
        sub = vl.norm_tokens(w[0])
        if not sub:
            continue
        s, e = float(w[1]) - offset, float(w[2]) - offset
        step = (e - s) / len(sub)
        for k, x in enumerate(sub):
            hyp.append(x)
            times.append((s + k * step, s + (k + 1) * step))
    _, pairs = vl.align(ref, hyp, set())
    span: list[list[float] | None] = [None] * len(disp)
    for r, hs in enumerate(pairs):
        if not hs:
            continue
        i = owner[r]
        s, e = times[hs[0]][0], times[hs[-1]][1]
        span[i] = [min(span[i][0], s), max(span[i][1], e)] if span[i] else [s, e]
    # Fill the gaps (a word Whisper missed, or a dash) from the neighbours.
    out = []
    for i, tok in enumerate(disp):
        if span[i] is None:
            prev = next((span[j][1] for j in range(i - 1, -1, -1) if span[j]), 0.0)
            nxt = next((span[j][0] for j in range(i + 1, len(disp)) if span[j]), prev)
            span[i] = [prev, max(prev, nxt)]
        out.append([tok, round(max(0.0, span[i][0]), 3), round(max(0.0, span[i][1]), 3)])
    for i in range(1, len(out)):  # starts never go backwards
        if out[i][1] < out[i - 1][1]:
            out[i][1] = out[i - 1][1]
        if out[i][2] < out[i][1]:
            out[i][2] = out[i][1]
    return out


def render_job(job: dict) -> dict:
    t0 = time.time()
    try:
        infos = [take_for(job, t) for t in job["takes"]]
        best = min(infos, key=score)
        out = Path(job["out"]) / f"{job['key']}.mp3"
        tried = []
        for k in LIGHTER:
            audio, _ = finish_line(job, best, k)
            dec, tp = vl.encode_checked(audio, out)
            heard = _W["ears"].words(dec)
            final_errors, n = vl.word_errors(job["text"], [w[0] for w in heard], _W["names"])
            tried.append((final_errors, -k, audio))
            if final_errors <= best["errors"]:
                break
        if tried[-1][0] > min(t[0] for t in tried):  # the lightest was no better: keep the best heard
            final_errors, negk, audio = min(tried, key=lambda t: (t[0], t[1]))
            k = -negk
            dec, tp = vl.encode_checked(audio, out)
            heard = _W["ears"].words(dec)
            final_errors, n = vl.word_errors(job["text"], [w[0] for w in heard], _W["names"])
        words = caption_words(job["text"], heard, best["words"])
        return {
            "key": job["key"], "ok": True, "fp": job["fp"], "seed": best["seed"], "takes": [{k: i[k] for k in ("seed", "errors", "sim", "gap", "prob", "dur")} for i in infos],
            "errors": best["errors"], "n": n, "final_errors": final_errors, "heard": " ".join(w[0] for w in heard),
            "dur": round(len(dec) / vl.SR, 3), "lufs": round(vl.lufs(dec), 2), "tp": round(tp, 2), "bytes": out.stat().st_size,
            "words": words, "secs": round(time.time() - t0, 1), "strength": k,
        }
    except Exception as err:  # one bad line never stops the render
        import traceback

        traceback.print_exc()
        return {"key": job["key"], "ok": False, "error": repr(err)}


# --------------------------------------------------------------------------- main

def update_manifest(path: Path, entries: dict, keep: set | None = None) -> dict:
    """Merge entries into the manifest on disk under a lock (two renders may share it)."""
    import fcntl

    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path.with_suffix(".lock"), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        m = vl.load_json(path, {}) or {}
        if not isinstance(m.get("clips"), dict):
            m = {"format": "hearthlight-cutscene-voice/1", "clips": {}}
        m["clips"].update(entries)
        if keep is not None:
            m["clips"] = {k: v for k, v in m["clips"].items() if k in keep}
        m["clips"] = dict(sorted(m["clips"].items(), key=lambda kv: (kv[1].get("order", 0), kv[0])))
        vl.write_json(path, m, indent=None)
        return m


def collect() -> list[dict]:
    subprocess.run(["node", str(vl.HERE / "collect.mjs")], check=True, cwd=vl.ROOT)
    return json.loads(LINES.read_text())["lines"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--jobs", type=int, default=2)
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--only", default="")
    ap.add_argument("--script", default="")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--no-prune", action="store_true")
    args = ap.parse_args()
    # A stopped render takes its workers with it (each holds a few GB).
    import signal

    signal.signal(signal.SIGTERM, lambda *_: sys.exit(1))

    lines = collect()
    cast = load_cast()
    names = sorted(vl.glossary_of([l["text"] for l in lines]))
    manifest_path = OUT / "manifest.json"
    manifest = vl.load_json(manifest_path, {}) or {}
    if not isinstance(manifest.get("clips"), dict):
        manifest = {"format": "hearthlight-cutscene-voice/1", "clips": {}}
    clips = manifest["clips"]

    want = [l for l in lines if (not args.only or l["speaker"] in args.only.split(",")) and (not args.script or l["script"] in args.script.split(","))]
    if args.limit:
        want = want[: args.limit]
    jobs = []
    for l in want:
        j = plan_line(l, cast)
        j["out"] = str(OUT)
        have = clips.get(l["key"])
        if not args.force and have and have.get("fp") == j["fp"] and (OUT / have["file"]).exists():
            continue
        jobs.append(j)
    print(f"render: {len(lines)} lines, {len(want)} asked, {len(jobs)} to render ({args.jobs} jobs x {args.threads} threads)", flush=True)

    OUT.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    done = 0
    if jobs:
        ctx = mp.get_context("spawn")
        with ctx.Pool(max(1, min(args.jobs, len(jobs))), initializer=_init, initargs=(args.threads, names)) as pool:
            for r in pool.imap_unordered(render_job, jobs):
                done += 1
                if not r.get("ok"):
                    print(f"  FAILED {r['key']}: {r.get('error')}", flush=True)
                    continue
                l = next(x for x in want if x["key"] == r["key"])
                entry = {
                    "file": f"{r['key']}.mp3", "speaker": l["speaker"], "line": l["line"], "script": l["script"], "order": l["order"],
                    "text": l["text"], "dur": r["dur"], "words": r["words"], "fp": r["fp"], "seed": r["seed"], "takes": r["takes"],
                    "errors": r["errors"], "final_errors": r["final_errors"], "n": r["n"], "heard": r["heard"],
                    "lufs": r["lufs"], "tp": r["tp"], "bytes": r["bytes"], "strength": r["strength"],
                }
                manifest = update_manifest(manifest_path, {r["key"]: entry})
                clips = manifest["clips"]
                flag = "" if r["errors"] == 0 else f"  << {r['errors']} word error(s) in the best take"
                el = time.time() - t0
                print(f"  [{done}/{len(jobs)}] {l['line']:18s} {l['speaker']:8s} {r['dur']:5.1f}s seed {r['seed']} takes {[t['errors'] for t in r['takes']]} final {r['final_errors']} {r['secs']:5.0f}s  eta {el / done * (len(jobs) - done) / 60:4.0f} min{flag}", flush=True)

    # Lines that are gone take their clips with them.
    keys = {l["key"] for l in lines}
    if not args.no_prune and not args.only and not args.script and not args.limit:
        manifest = update_manifest(manifest_path, {}, keep=keys)
        clips = manifest["clips"]
        for f in OUT.glob("*.mp3"):
            if f.stem not in keys:
                f.unlink()
    manifest = update_manifest(manifest_path, {})
    clips = manifest["clips"]
    have = [clips[k] for k in keys if k in clips]
    mb = sum(c["bytes"] for c in have) / 1e6
    flagged = [c for c in have if c["errors"]]
    print(f"render: {len(have)}/{len(lines)} lines voiced, {sum(c['dur'] for c in have) / 60:.1f} min, {mb:.1f} MB; "
          f"{len(flagged)} with a word wrong in every take; {time.time() - t0:.0f} s", flush=True)
    for c in flagged:
        print(f"  flagged {c['line']}: '{c['text']}' heard '{c['heard']}'")
    return 0


if __name__ == "__main__":
    sys.exit(main())
