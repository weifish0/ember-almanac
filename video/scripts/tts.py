"""Generate the voice-over, one WAV per line, with Gemini TTS.

Reads GEMINI_API_KEY / GEMINI_TTS_MODEL / GEMINI_TTS_VOICE_ID from the environment (never from this repo):
    set -a; source ~/Developer/.env; set +a; python3 scripts/tts.py
"""
import base64
import json
import os
import pathlib
import subprocess
import sys
import urllib.request

OUT = pathlib.Path(__file__).resolve().parents[1] / "public" / "vo"
STYLE = ""
LINES = json.loads((pathlib.Path(__file__).parent / "script.json").read_text())


def speak(text: str) -> tuple[str, bytes]:
    body = {
        "contents": [{"parts": [{"text": STYLE + text}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"voice": os.environ["GEMINI_TTS_VOICE_ID"]}},
        },
    }
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{os.environ['GEMINI_TTS_MODEL']}:generateContent",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": os.environ["GEMINI_API_KEY"]},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            res = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"TTS failed: {e.code} {e.read().decode()[:600]}")
    part = res["candidates"][0]["content"]["parts"][0]["inlineData"]
    return part.get("mimeType", ""), base64.b64decode(part["data"])


only = sys.argv[1:]
OUT.mkdir(parents=True, exist_ok=True)
for key, text in LINES.items():
    if only and key not in only:
        continue
    print(key, "-", text)
    mime, audio = speak(text)
    wav = OUT / f"{key}.wav"
    # raw PCM (audio/L16) needs its format spelled out; a WAV/MP3 container describes itself
    raw = ["-f", "s16le", "-ar", "24000", "-ac", "1"] if ("L16" in mime or "pcm" in mime) else []
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *raw, "-i", "-", "-ar", "48000", "-ac", "1", str(wav)],
                   input=audio, check=True)
    dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(wav)],
                         capture_output=True, text=True).stdout.strip()
    print("   ->", wav.name, dur, "s")
