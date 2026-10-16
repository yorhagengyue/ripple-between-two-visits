# voicebox_gen.py: synthesize one line with a Voicebox cloned voice (local REST at 127.0.0.1:17493) and save the wav.
#   python -I voicebox_gen.py <profile name> <language en|zh> "<text>" <out.wav> [seed]
# Reads the text word for word (personality false). Polls the generation, then downloads /audio/{id}.
import json, sys, time, urllib.request, urllib.error
B = "http://127.0.0.1:17493"
def get(path, timeout=30):
    with urllib.request.urlopen(B + path, timeout=timeout) as r: return r.read()
name, lang, text, out = sys.argv[1:5]
seed = int(sys.argv[5]) if len(sys.argv) > 5 else 7
profiles = json.loads(get("/profiles"))
pid = next(p["id"] for p in profiles if p["name"] == name)
body = json.dumps({"profile_id": pid, "text": text, "language": lang, "seed": seed, "personality": False, "normalize": True}).encode()
req = urllib.request.Request(B + "/generate", data=body, headers={"content-type": "application/json"})
with urllib.request.urlopen(req, timeout=1800) as r: g = json.loads(r.read())
gid = g.get("id") or g.get("generation_id")
t0 = time.time()
while True:
    try:
        wav = get(f"/audio/{gid}", timeout=60)
        if wav[:4] == b"RIFF": break
    except urllib.error.HTTPError as e:
        if e.code not in (404, 500): raise
    if time.time() - t0 > 1800: raise SystemExit("timed out")
    time.sleep(2)
open(out, "wb").write(wav)
print(f"{name} {lang} -> {out} ({len(wav)} bytes, {time.time() - t0:.0f} s after the request returned)")
