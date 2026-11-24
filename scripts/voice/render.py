"""Render Hearthlight's fixed lines with their cast voices (DESIGN.md §21).

  python scripts/voice/render.py                       # every line in scripts/voice/lines.json
  python scripts/voice/render.py --lines scripts/voice/lines.sample.json
  python scripts/voice/render.py --only lyra,bram --jobs 2 --threads 1
  python scripts/voice/render.py --prune               # also delete clips no line uses any more

Each line becomes assets/voice/<key>.mp3: Kokoro with the speaker's cast voice, gentle
shaping, -16 LUFS, trimmed, mono 24 kHz MP3 at 48 kbps (plays everywhere, iOS included).
Rendering is incremental: a clip is skipped when it exists and its speaker's cast entry
has not changed since it was made (fingerprints in assets/voice/render_state.json).
assets/voice/manifest.json maps key -> {speaker, dur} for every clip in the folder.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import multiprocessing as mp
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import voicelib as vl  # noqa: E402

_synth = None
_cast = None


def fingerprint(spec: dict) -> str:
    blob = json.dumps({k: spec.get(k) for k in ("voice", "lang", "speed", "fx", "sentencePause", "clausePause")}, sort_keys=True)
    return hashlib.sha1((blob + "|lufs=%s|kbps=%s" % (vl.TARGET_LUFS, KBPS)).encode()).hexdigest()[:10]


KBPS = 48


def _init(threads: int, cast: dict, kbps: int = 48) -> None:
    global _synth, _cast, KBPS
    KBPS = kbps
    os.environ.setdefault("OMP_NUM_THREADS", str(threads))
    _synth = vl.Synth(threads)
    _cast = cast


def _render_one(job: tuple[str, str, str, str]) -> tuple[str, float, int, str | None]:
    key, speaker, text, out = job
    try:
        audio = vl.render(_synth, text, _cast["voices"][speaker])
        path = Path(out) / f"{key}.mp3"
        audio, _tp = vl.encode_checked(audio, path, KBPS)
        return key, round(len(audio) / vl.SR, 2), path.stat().st_size, None
    except Exception as e:  # one bad line must not stop the batch
        return key, 0.0, 0, f"{type(e).__name__}: {e}"


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lines", default=str(vl.HERE / "lines.json"))
    ap.add_argument("--out", default=str(vl.ROOT / "assets" / "voice"))
    ap.add_argument("--jobs", type=int, default=2, help="parallel renderers (keep to 2 on a shared 4-CPU machine)")
    ap.add_argument("--threads", type=int, default=1, help="onnxruntime threads per renderer")
    ap.add_argument("--only", help="comma-separated speakers")
    ap.add_argument("--limit", type=int, default=0, help="render at most N new clips (0 = all)")
    ap.add_argument("--force", action="store_true", help="re-render even when up to date")
    ap.add_argument("--prune", action="store_true", help="delete clips whose line is gone")
    ap.add_argument("--budget-mb", type=float, default=90.0, help="warn when the clips exceed this")
    ap.add_argument("--kbps", type=int, default=48, help="MP3 bitrate (MPEG-2 Layer III at 24 kHz: 32-64 is sensible for speech)")
    args = ap.parse_args()
    global KBPS
    KBPS = args.kbps

    cast = vl.load_cast()
    doc = load_json(Path(args.lines), None)
    if not doc:
        print(f"No lines at {args.lines}. Run: node scripts/voice/collect.mjs", file=sys.stderr)
        return 2
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    manifest_path, state_path = out / "manifest.json", out / "render_state.json"
    manifest: dict = load_json(manifest_path, {})
    state: dict = load_json(state_path, {})
    fps = {sid: fingerprint(spec) for sid, spec in cast["voices"].items()}
    only = set(args.only.split(",")) if args.only else None

    jobs, unknown = [], set()
    for line in doc["lines"]:
        sp, key = line["speaker"], line["key"]
        if sp not in cast["voices"]:
            unknown.add(sp)
            continue
        if only and sp not in only:
            continue
        clip = out / f"{key}.mp3"
        fresh = clip.exists() and state.get(key) == fps[sp] and key in manifest
        if fresh and not args.force:
            continue
        jobs.append((key, sp, line["text"], str(out)))
    if args.limit:
        jobs = jobs[: args.limit]
    if unknown:
        print(f"[render] no cast voice for {sorted(unknown)}: skipped (add them to cast.json)")

    t0 = time.time()
    errors = []
    speech_s = 0.0
    if jobs:
        print(f"[render] {len(jobs)} clips to render with {args.jobs} x {args.threads} threads ...", flush=True)
        speaker_of = {j[0]: j[1] for j in jobs}
        with mp.get_context("fork").Pool(args.jobs, initializer=_init, initargs=(args.threads, cast, KBPS)) as pool:
            for i, (key, dur, size, err) in enumerate(pool.imap_unordered(_render_one, jobs, chunksize=2), 1):
                if err:
                    errors.append((key, err))
                    continue
                sp = speaker_of[key]
                manifest[key] = {"speaker": sp, "dur": dur}
                state[key] = fps[sp]
                speech_s += dur
                if i % 25 == 0 or i == len(jobs):
                    el = time.time() - t0
                    print(f"[render] {i}/{len(jobs)}  {el:5.0f}s elapsed, real-time factor {el / max(speech_s, 0.01):.2f}", flush=True)
                if i % 100 == 0:  # survive an interruption with the work so far
                    write_json(manifest_path, manifest)
                    write_json(state_path, state)
    else:
        print("[render] everything is up to date")

    # The manifest lists exactly the clips on disk.
    wanted = {l["key"] for l in doc["lines"]}
    for key in list(manifest):
        clip = out / f"{key}.mp3"
        if not clip.exists():
            manifest.pop(key, None)
            state.pop(key, None)
        elif args.prune and key not in wanted:
            clip.unlink()
            manifest.pop(key, None)
            state.pop(key, None)
    write_json(manifest_path, dict(sorted(manifest.items())))
    write_json(state_path, dict(sorted(state.items())))

    report(out, manifest, args.budget_mb)
    if errors:
        print(f"[render] {len(errors)} lines failed:")
        for key, err in errors[:20]:
            print(f"   {key}: {err}")
    return 1 if errors else 0


def write_json(path: Path, data) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def report(out: Path, manifest: dict, budget_mb: float) -> None:
    by: dict[str, list[float]] = {}
    total_bytes = 0
    for key, m in manifest.items():
        size = (out / f"{key}.mp3").stat().st_size
        total_bytes += size
        b = by.setdefault(m["speaker"], [0, 0.0, 0])
        b[0] += 1
        b[1] += m["dur"]
        b[2] += size
    total_s = sum(v[1] for v in by.values())
    print(f"\n[render] {len(manifest)} clips, {total_s / 60:.1f} min, {total_bytes / 1e6:.2f} MB "
          f"({total_bytes * 8 / max(total_s, 0.01) / 1000:.0f} kbps average) in {out}")
    for sp, (n, s, b) in sorted(by.items(), key=lambda kv: -kv[1][2]):
        print(f"   {sp:<11} {n:5d} clips  {s / 60:6.1f} min  {b / 1e6:6.2f} MB  avg {s / max(n, 1):4.1f}s")
    if total_bytes / 1e6 > budget_mb:
        print(f"[render] WARNING: {total_bytes / 1e6:.1f} MB is over the {budget_mb:.0f} MB budget")


if __name__ == "__main__":
    raise SystemExit(main())
