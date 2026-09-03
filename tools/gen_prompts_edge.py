#!/usr/bin/env python3
"""Generate the prompt WAV library with edge-tts (free Microsoft neural voices).

    python3 tools/gen_prompts_edge.py
    python3 tools/gen_prompts_edge.py --voice en-US-ChristopherNeural --rate -5%
    python3 tools/gen_prompts_edge.py --only greeting,pitch --force

No API key needed. Outputs 8 kHz mono PCM16 WAV (telephony native) via ffmpeg.
Use tools/gen-prompts.mjs instead once a paid TTS provider is available.
"""
import argparse, json, os, shutil, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "tools" / "prompt-script.json"

ap = argparse.ArgumentParser()
ap.add_argument("--voice", default="en-US-AndrewNeural")
ap.add_argument("--rate", default="-4%", help="speech rate, e.g. -10%% slower")
ap.add_argument("--out", default=os.environ.get("PROMPT_DIR", "prompts/b2b-outreach"))
ap.add_argument("--only", default=None, help="comma-separated prompt names")
ap.add_argument("--force", action="store_true")
args = ap.parse_args()

if not shutil.which("ffmpeg"):
    sys.exit("ffmpeg not found on PATH — needed to convert MP3 to 8 kHz mono WAV")

out_dir = ROOT / args.out
out_dir.mkdir(parents=True, exist_ok=True)

script = json.loads(SCRIPT.read_text(encoding="utf-8"))
names = ([n.strip() for n in args.only.split(",")] if args.only
         else [k for k in script if not k.startswith("_")])

print(f"voice={args.voice} rate={args.rate} -> {out_dir}\n")
made = skipped = failed = 0

for name in names:
    text = script.get(name)
    if not text:
        print(f"  {name:<22} SKIP  (no text in prompt-script.json)"); failed += 1; continue

    wav = out_dir / f"{name}.wav"
    if wav.exists() and not args.force:
        print(f"  {name:<22} skip  (exists — use --force)"); skipped += 1; continue

    with tempfile.TemporaryDirectory() as td:
        txt, mp3 = Path(td) / "in.txt", Path(td) / "out.mp3"
        txt.write_text(text, encoding="utf-8")
        try:
            subprocess.run(
                [sys.executable, "-m", "edge_tts", "--voice", args.voice,
                 # "=" form: a bare "-4%" would be parsed as a flag, not a value
                 f"--rate={args.rate}", "--file", str(txt), "--write-media", str(mp3)],
                check=True, capture_output=True, timeout=120,
            )
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", str(mp3),
                 "-ar", "8000", "-ac", "1", "-c:a", "pcm_s16le", str(wav)],
                check=True, capture_output=True, timeout=120,
            )
        except subprocess.CalledProcessError as e:
            err = (e.stderr or b"").decode(errors="replace").strip().splitlines()
            print(f"  {name:<22} FAIL  {err[-1] if err else e}"); failed += 1; continue
        except subprocess.TimeoutExpired:
            print(f"  {name:<22} FAIL  timeout"); failed += 1; continue

    secs = (wav.stat().st_size - 44) / 2 / 8000
    print(f"  {name:<22} ok    {secs:5.1f}s  {wav.stat().st_size // 1024:4d}KB")
    made += 1

print(f"\ngenerated {made}, skipped {skipped}, failed {failed}")
sys.exit(1 if failed else 0)
