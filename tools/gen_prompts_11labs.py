#!/usr/bin/env python3
"""Generate the prompt WAV library with ElevenLabs, shaped for a phone line.

    export ELEVENLABS_API_KEY=...
    python3 tools/gen_prompts_11labs.py --list-voices
    python3 tools/gen_prompts_11labs.py --voice Brian
    python3 tools/gen_prompts_11labs.py --only greeting,pitch-1 --force

Why the post-processing matters more than the engine: most TTS sounds robotic on
a call because of the pipeline, not the model.

  * render at 24 kHz and downsample — never ask any engine for 8 kHz directly
  * band-limit to 200-3400 Hz, the actual passband of a phone call. This makes
    synthetic speech sound MORE human, because the artifacts that give it away
    live outside that band
  * compress lightly, the way a phone system does
  * pad with faint room tone rather than digital silence. Hard digital silence
    at the edges of a clip is the single biggest tell on a live call

Outputs 8 kHz mono PCM16 WAV (telephony native). See gen_prompts_edge.py for the
free fallback; it uses the same post-chain.
"""
import argparse, json, os, shutil, subprocess, sys, tempfile, urllib.error, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "tools" / "prompt-script.json"
API = "https://api.elevenlabs.io/v1"

# Shared with gen_prompts_edge.py — keep the two in step so a library generated
# by either engine sounds like it came off the same phone system.
TELEPHONY_CHAIN = (
    "aresample=8000,"
    "highpass=f=200,"
    "lowpass=f=3400,"
    "acompressor=threshold=-18dB:ratio=3:attack=5:release=120,"
    "alimiter=limit=0.95"
)


# Acks exist to fill a ~650 ms wait. Padded like a normal prompt they would take
# longer than the wait they cover and make the turn slower, so they get almost none.
ACK_HEAD_MS = 60
ACK_TAIL_MS = 80


def pad_for(name, head_ms, tail_ms):
    if name.startswith("ack-"):
        return ACK_HEAD_MS, ACK_TAIL_MS
    return head_ms, tail_ms


def build_filter(head_ms, tail_ms, tone):
    """Band-limit + compress the speech, then pad it with faint room tone."""
    return (
        f"[0:a]{TELEPHONY_CHAIN},"
        f"adelay={head_ms}|{head_ms},apad=pad_dur={tail_ms / 1000}[sp];"
        f"[1:a]volume={tone}[rt];"
        f"[sp][rt]amix=inputs=2:duration=first:normalize=0,aresample=8000[out]"
    )


def api(path, key, data=None):
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(data).encode() if data is not None else None,
        headers={"xi-api-key": key, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read(), r.headers.get_content_type()


def list_voices(key):
    body, _ = api("/voices", key)
    for v in json.loads(body).get("voices", []):
        labels = v.get("labels") or {}
        tags = " ".join(f"{k}={x}" for k, x in labels.items() if k in ("accent", "age", "gender", "use_case"))
        print(f"  {v['name']:<22} {v['voice_id']}  {tags}")


def resolve_voice(key, wanted):
    """Accept either a voice_id or a voice name."""
    if len(wanted) == 20 and " " not in wanted:
        return wanted  # already an id
    body, _ = api("/voices", key)
    for v in json.loads(body).get("voices", []):
        if v["name"].lower() == wanted.lower():
            return v["voice_id"]
    sys.exit(f'voice "{wanted}" not found on this account — run --list-voices')


def synth(key, voice_id, text, model, stability, similarity, style):
    """Ask for raw 24 kHz PCM so nothing is lost to an intermediate mp3."""
    req = urllib.request.Request(
        f"{API}/text-to-speech/{voice_id}?output_format=pcm_24000",
        data=json.dumps(
            {
                "text": text,
                "model_id": model,
                "voice_settings": {
                    "stability": stability,
                    "similarity_boost": similarity,
                    "style": style,
                    "use_speaker_boost": True,
                },
            }
        ).encode(),
        headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/pcm"},
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default=os.environ.get("ELEVENLABS_VOICE_ID", ""),
                    help="voice name or id (or set ELEVENLABS_VOICE_ID)")
    ap.add_argument("--model", default="eleven_multilingual_v2")
    ap.add_argument("--stability", type=float, default=0.45,
                    help="lower = more expressive and varied; 0.4-0.5 reads as a real person")
    ap.add_argument("--similarity", type=float, default=0.75)
    ap.add_argument("--style", type=float, default=0.30)
    ap.add_argument("--head-ms", type=int, default=180, help="room tone before the speech")
    ap.add_argument("--tail-ms", type=int, default=250, help="room tone after the speech")
    ap.add_argument("--room-tone", type=float, default=0.004,
                    help="room tone level; 0 disables it and gives digital silence")
    ap.add_argument("--out", default=os.environ.get("PROMPT_DIR", "prompts/b2b-outreach"))
    ap.add_argument("--only", default=None, help="comma-separated prompt names")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--list-voices", action="store_true")
    args = ap.parse_args()

    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not key:
        sys.exit("set ELEVENLABS_API_KEY (put it in .env, never on the command line)")

    if args.list_voices:
        list_voices(key)
        return 0

    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg not found on PATH — needed for the telephony post-chain")
    if not args.voice:
        sys.exit("pick a voice: --voice <name|id>, or run --list-voices first")

    voice_id = resolve_voice(key, args.voice)
    out_dir = ROOT / args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    script = json.loads(SCRIPT.read_text(encoding="utf-8"))
    names = ([n.strip() for n in args.only.split(",")] if args.only
             else [k for k in script if not k.startswith("_")])

    print(f"voice={args.voice} ({voice_id})  model={args.model} -> {out_dir}\n")
    made = skipped = failed = 0

    for name in names:
        text = script.get(name)
        if not text:
            print(f"  {name:<22} SKIP  (no text in prompt-script.json)")
            failed += 1
            continue

        wav = out_dir / f"{name}.wav"
        if wav.exists() and not args.force:
            print(f"  {name:<22} skip  (exists — use --force)")
            skipped += 1
            continue

        try:
            pcm = synth(key, voice_id, text, args.model, args.stability, args.similarity, args.style)
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:200]
            print(f"  {name:<22} FAIL  HTTP {e.code} {detail}")
            failed += 1
            continue
        except Exception as e:
            print(f"  {name:<22} FAIL  {e}")
            failed += 1
            continue

        with tempfile.TemporaryDirectory() as td:
            raw = Path(td) / "speech.pcm"
            raw.write_bytes(pcm)
            head, tail = pad_for(name, args.head_ms, args.tail_ms)
            afilter = build_filter(head, tail, args.room_tone)
            cmd = [
                "ffmpeg", "-y", "-loglevel", "error",
                "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", str(raw),
                "-f", "lavfi", "-i", "anoisesrc=c=pink:r=8000",
                "-filter_complex", afilter, "-map", "[out]",
                "-ar", "8000", "-ac", "1", "-c:a", "pcm_s16le", str(wav),
            ]
            try:
                subprocess.run(cmd, check=True, capture_output=True, timeout=120)
            except subprocess.CalledProcessError as e:
                err = (e.stderr or b"").decode(errors="replace").strip().splitlines()
                print(f"  {name:<22} FAIL  ffmpeg: {err[-1] if err else e}")
                failed += 1
                continue

        secs = (wav.stat().st_size - 44) / 2 / 8000
        print(f"  {name:<22} ok    {secs:5.1f}s  {wav.stat().st_size // 1024:4d}KB")
        made += 1

    print(f"\ngenerated {made}, skipped {skipped}, failed {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
