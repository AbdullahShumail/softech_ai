#!/usr/bin/env python3
"""Generate the prompt WAV library with edge-tts (free Microsoft neural voices).

    python3 tools/gen_prompts_edge.py
    python3 tools/gen_prompts_edge.py --voice en-US-ChristopherNeural --rate -5%
    python3 tools/gen_prompts_edge.py --only greeting,pitch --force

No API key needed. Outputs 8 kHz mono PCM16 WAV (telephony native) via ffmpeg,
through the same telephony post-chain as the ElevenLabs generator so a library
built by either engine sounds like it came off the same phone system.

This is the free fallback. tools/gen_prompts_11labs.py gives noticeably more
natural delivery and is what the live library should be built with.
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
ap.add_argument("--head-ms", type=int, default=180, help="room tone before the speech")
ap.add_argument("--tail-ms", type=int, default=250, help="room tone after the speech")
ap.add_argument("--room-tone", type=float, default=0.004,
                help="room tone level; 0 disables it and gives digital silence")
ap.add_argument("--force", action="store_true")
args = ap.parse_args()

# Band-limit to a phone passband, compress, and pad with faint room tone rather
# than digital silence — see tools/gen_prompts_11labs.py for why this matters
# more than the choice of engine.
TELEPHONY_CHAIN = (
    "aresample=8000,"
    "highpass=f=200,"
    "lowpass=f=3400,"
    "acompressor=threshold=-18dB:ratio=3:attack=5:release=120,"
    "alimiter=limit=0.95"
)
# TTS engines emit their own leading and trailing silence, and it varies per clip
# (ElevenLabs gave us 100-280 ms of lead-in and 320-640 ms of tail on the same
# settings). Our padding then stacks on top of it, so prompts end with ~300 ms of
# dead air before the bot starts listening again, and short acks come out too
# long to be worth playing. Strip whatever the engine left, then pad to a length
# we actually chose.
TRIM_SILENCE = (
    "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0:detection=peak,"
    "areverse,"
    "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0:detection=peak,"
    "areverse"
)

# Acks exist to fill a ~650 ms wait. Padded like a normal prompt they would take
# longer than the wait they cover and make the turn slower, so they get almost none.
ACK_HEAD_MS, ACK_TAIL_MS = 60, 80


def afilter_for(name):
    head, tail = (ACK_HEAD_MS, ACK_TAIL_MS) if name.startswith("ack-") else (args.head_ms, args.tail_ms)
    return (
        f"[0:a]{TRIM_SILENCE},{TELEPHONY_CHAIN},"
        f"adelay={head}|{head},apad=pad_dur={tail / 1000}[sp];"
        f"[1:a]volume={args.room_tone}[rt];"
        f"[sp][rt]amix=inputs=2:duration=first:normalize=0,aresample=8000[out]"
    )

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
                 "-f", "lavfi", "-i", "anoisesrc=c=pink:r=8000",
                 "-filter_complex", afilter_for(name), "-map", "[out]",
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
