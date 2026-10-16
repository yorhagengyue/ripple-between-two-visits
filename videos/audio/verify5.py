# Checks out/audio-v5.wav (see build5.py):
#  1 length, loudness, true peak (pyloudnorm and ffmpeg)    2 every voice's onset on its bubble's first frame (one frame)
#  3 the voice stem silent outside the 17 windows, and each voice over before its bubble goes
#  4 effects' transients within one frame of their word frames    5 no clicks at the segment cuts
#  6 Whisper (local-transcribe, large-v3) on the mixed track around each voice
#   D:/AI/seed-vc/.venv/Scripts/python.exe audio/verify5.py [--v6] [--no-whisper]
import json, os, subprocess, sys
import numpy as np, soundfile as sf, pyloudnorm as pyln
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import SR, PROMO, AUD, onset_env, db, hp
import build as B, build5 as B5

FRAME = 1 / 30
cues = json.load(open(B5.OUT_CUES, encoding="utf-8"))
mix, sr = sf.read(B5.OUT_WAV, dtype="float64"); assert sr == SR
print(f"1. length {len(mix)} samples = {len(mix) / SR:.4f} s: {'OK' if len(mix) == B5.N5 else 'WRONG'}")
m = pyln.Meter(SR)
print(f"   integrated {m.integrated_loudness(mix):.2f} LUFS, true peak {B.true_peak_db(mix):.2f} dBTP (4x oversampled)")
for n, a, b in B5.PARTS:
    print(f"   {n:14} {m.integrated_loudness(mix[int(a * SR):int(b * SR)]):7.2f} LUFS")
r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", B5.OUT_WAV, "-af", "loudnorm=I=-16:TP=-1.3:LRA=11:print_format=json", "-f", "null", "-"],
                   capture_output=True, text=True)
j = json.loads(r.stderr[r.stderr.rfind("{"):r.stderr.rfind("}") + 1])
print("   ffmpeg loudnorm (measure):", {k: j[k] for k in ("input_i", "input_tp", "input_lra")})

# 2 + 3 voices
voice, _ = sf.read(f"{B5.STEMS}/voice.wav", dtype="float64")
va = np.abs(voice).max(1); hop = SR // 1000
env = db(va[: len(va) // hop * hop].reshape(-1, hop).max(1)); gate = env.max() - 50
inside = np.zeros(len(va), bool)
last = {}
for f in B5.VOICE_LOGS:
    for b in json.load(open(f"{PROMO}/{f}", encoding="utf-8")).get("bubbles", []):
        if b.get("voice"): last[b["voice"]] = max(last.get(b["voice"], -1), b["t"])
segs = B5.segments()
print("2. voices (id: out start | speech heard from | bubble's last frame | voice ends)")
bad = 0
for v in cues["voices"]:
    i0, i1 = v["sample_start"], v["sample_end"]; inside[i0:i1] = True
    k = np.where(env[int((v["out"] - 0.1) * 1000): int((v["out"] + 0.3) * 1000)] > gate)[0]
    on = (int((v["out"] - 0.1) * 1000) + k[0]) / 1000 if len(k) else None
    lo, _ = B5.src_to_out(last[v["id"]], segs) if v["id"] in last else (None, None)
    bubble_end = lo + FRAME if lo is not None else None
    ok = on is not None and abs(on - v["out"]) <= FRAME and (bubble_end is None or v["out_end"] <= bubble_end + 1e-6) and i0 == round(v["out"] * SR)
    bad += not ok
    print(f"   {v['id']:16} {v['out']:8.3f} | {on:8.3f} ({(on - v['out']) * 1000:+4.0f} ms) | bubble up to {bubble_end:8.3f} | ends {v['out_end']:8.3f}  {'OK' if ok else 'CHECK'}")
outside = np.abs(voice[~inside]).max() if (~inside).any() else 0.0
print(f"3. voice stem outside the 17 windows: peak {outside:.2e} ({'silent' if outside == 0 else 'NOT SILENT'}); {bad} voice(s) to check")
ov = sorted((v["out"], v["out_end"], v["id"]) for v in cues["voices"])
print("   overlaps between voices:", [(a[2], b[2]) for a, b in zip(ov, ov[1:]) if b[0] < a[1]] or "none")

# 4 effects
sfx, _ = sf.read(f"{B5.STEMS}/sfx-dry-unducked.wav", dtype="float64")
def picked(x, lo, hi):
    a, b = max(0, int((lo - 0.3) * SR)), int((hi + 0.3) * SR)
    t, f = onset_env(x[a:b]); t = t + a / SR
    if f.max() <= 0: return []
    f = f / f.max()
    return [t[i] for i in range(1, len(f) - 1) if f[i] >= f[i - 1] and f[i] > f[i + 1] and f[i] > 0.12 and lo <= t[i] <= hi]
errs, outl, soft = [], [], []
for c in cues["sfx"]:
    on = picked(sfx, c["out"] - 0.12, c["out"] + 0.12)
    e = min((o - c["out"] for o in on), key=abs) if on else None
    if c["soft_onset"]: soft.append((c["out"], c["word"])); continue
    if e is None or abs(e) > FRAME: outl.append((c["out"], c["word"], e))
    else: errs.append(abs(e) * 1000)
print(f"4. effects: {len(errs)} of {len(errs) + len(outl)} sharp effects within one frame (median {np.median(errs):.1f} ms, max {max(errs):.1f} ms); "
      f"outside: {outl or 'none'}; soft swells not checked: {len(soft)}")

# 5 clicks at the cuts: the sharpest sample-to-sample curvature within 2 ms of each cut against the 99.9th percentile of
#   the second second around it (a click stands far above the music's own transients); and what starts right there
mono = mix.mean(1); d2 = np.abs(np.diff(mono, 2)); rows = []
starts_at = [(c["out"], c["word"]) for c in cues["sfx"]] + [(v["out"], v["id"]) for v in cues["voices"]]
for s_ in segs[1:]:
    i = int(round(s_["oa"] * SR)); w = int(0.002 * SR)
    at = d2[i - w: i + w].max(); ref = np.percentile(d2[i - SR // 2: i + SR // 2], 99.9)
    near = [n for t_, n in starts_at if abs(t_ - s_["oa"]) < 0.02]
    rows.append((round(s_["oa"], 2), round(float(at / (ref + 1e-12)), 2), near))
worst = max(rows, key=lambda r: r[1])
print(f"5. cuts: sharpest curvature at a cut over the local 99.9th percentile: worst x{worst[1]} at {worst[0]} s "
      f"({'no click' if worst[1] < 2 else 'LOOK'}); per cut: {[(r[0], r[1]) + ((r[2],) if r[2] else ()) for r in rows]}")

# 6 Whisper on the mix around each voice (Mandarin and English lines in two files, each with its language set)
if "--no-whisper" not in sys.argv:
    wd = f"{AUD}/check-{B5.VER}"; os.makedirs(wd, exist_ok=True)
    print("6. Whisper (local-transcribe, large-v3) on the mixed track, per voice window:")
    for lang in ("zh", "en"):
        parts, offs, t = [], [], 0.0
        gap = np.zeros((int(3.0 * SR), 2))
        for v in cues["voices"]:
            if (v["speaker"] == "patient") != (lang == "zh"): continue
            a, b = int((v["out"] - 0.15) * SR), int((v["out_end"] + 0.25) * SR)
            parts += [mix[a:b], gap]; offs.append((t, t + (b - a) / SR, v)); t += (b - a) / SR + 3.0
        f = f"{wd}/voices-in-mix-{lang}.wav"
        sf.write(f, np.concatenate(parts), SR, subtype="PCM_16")
        cmd = [os.environ.get("WHISPER_PYTHON", "python"), os.environ.get("TRANSCRIBE_SCRIPT", "transcribe.py"),
               f, "--chunk", "0", "--lang", lang, "--hotwords", "Mr Tan, Dr Lim, amlodipine, tai chi, uncle", "--out", f"{wd}/whisper-{lang}"]
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
        tj = f"{wd}/whisper-{lang}/transcript.json"
        if not os.path.exists(tj): print("   whisper failed:", r.stdout[-600:], r.stderr[-600:]); continue
        sw = json.load(open(tj, encoding="utf-8"))["segments"]
        for a, b, v in offs:
            heard = " ".join(x.get("text", "").strip() for x in sw if a - 1.4 <= (x.get("start", 0) + x.get("end", 0)) / 2 < b + 1.4)
            print(f"   {v['id']:16} spoken: {v['spoken']}")
            print(f"   {'':16} heard:  {heard}")
