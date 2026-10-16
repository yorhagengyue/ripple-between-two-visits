# Checks out/audio-v3.wav against its cue list:
#  1. every effect's transient within one frame (33.3 ms) of its logged landing frame (onsets on the effects stem, and
#     where the music lets it be heard, on the final mix too)
#  2. every voice line starts where the taps sheets say, mapped through the panel's run to the output
#  3. length, integrated loudness, true peak, loudness per part (pyloudnorm and ffmpeg's ebur128 / loudnorm)
import json, re, subprocess
import numpy as np, soundfile as sf, pyloudnorm as pyln
from common import SR, PROMO, AUD, onset_env, db
import build, voices

FRAME = 1 / 30
cues = json.load(open(build.OUT_CUES, encoding="utf-8"))
mix, sr = sf.read(build.OUT_WAV, dtype="float64")
assert sr == SR
print(f"length: {len(mix)} samples = {len(mix) / SR:.4f} s (cut: 13674 frames / 30 = 455.8 s = {13674 * SR // 30} samples) "
      f"{'OK' if len(mix) == 13674 * SR // 30 else 'WRONG'}")


def picked(x, t_lo, t_hi):
    """onset times (and strengths) of x between t_lo and t_hi, from its spectral flux"""
    a, b = max(0, int((t_lo - 0.3) * SR)), int((t_hi + 0.3) * SR)
    t, f = onset_env(x[a:b])
    t = t + a / SR
    if f.max() <= 0: return []
    f = f / f.max(); out = []
    for i in range(1, len(f) - 1):
        if f[i] >= f[i - 1] and f[i] > f[i + 1] and f[i] > 0.12 and t_lo <= t[i] <= t_hi: out.append((t[i], f[i]))
    return out


# ---- 1. effects
sfx, _ = sf.read(f"{AUD}/stems/sfx-dry-unducked.wav", dtype="float64")
bad, soft_rows, errs, mix_ok, mix_n = [], [], [], 0, 0
for c in cues["sfx"]:
    on = picked(sfx, c["out"] - 0.12, c["out"] + 0.12)
    err = min((o - c["out"] for o, _ in on), key=abs) if on else None
    row = (c["out"], c["word"], c["class"], None if err is None else round(err * 1000, 1))
    if c["soft_onset"]: soft_rows.append(row); continue
    if err is None or abs(err) > FRAME: bad.append(row)
    else: errs.append(err)
    on2 = picked(mix, c["out"] - 0.12, c["out"] + 0.12)
    if on2:
        mix_n += 1
        if min(abs(o - c["out"]) for o, _ in on2) <= FRAME: mix_ok += 1
errs = np.array(errs) * 1000
print(f"effects: {len(errs)} of {len(errs) + len(bad)} sharp effects within one frame of their logged frame on the effects stem; "
      f"error median {np.median(np.abs(errs)):.1f} ms, 95th percentile {np.percentile(np.abs(errs), 95):.1f} ms, max {np.abs(errs).max():.1f} ms")
for r in bad: print("   OUTSIDE ONE FRAME:", r)
print(f"   on the final mix (music and voices in): an onset within one frame at {mix_ok} of {mix_n} cues")
print("   soft-onset effects (swells; checked loosely):", soft_rows)

# ---- 2. voices: line starts from the taps sheets (clip seconds), through each slice's panel run, against the voice stem
sheet_lines = {
    "s1-conversation": [20.9, 28.8, 36.3, 43.7, 52.4, 58.9, 65.2, 72.0, 77.3, 84.0, 92.8, 103.6, 109.3, 117.0, 124.2],
    "s2-his-words": [15.9], "s4-his-words": [2.2 + 0.75],
}
voice, _ = sf.read(f"{AUD}/stems/voice.wav", dtype="float64")
vm = np.abs(voice).max(1); hop = SR // 1000
env = db(vm[: len(vm) // hop * hop].reshape(-1, hop).max(1))
gate = env.max() - 35
print("voices (slice: output time; each line start: expected output time from the taps sheet -> heard at):")
vrows = []
for v in cues["voices"]:
    lines = list(sheet_lines.get(v["source"], []))
    if v["source"].endswith("doctor-recording") and "check_starts" not in v:
        lines = [v["anchor_clip_s"] + (0.14 if "s3" in v["source"] else 0.12)]  # the clip's own first sound (measured)
    if "check_starts" in v:  # a fixed placement: (file time, expected output time) pairs
        pairs = [(round(f, 2), o) for f, o in v["check_starts"]]
    else:
        starts = [c for c in lines if v["clip_from"] - 0.02 <= c < v["clip_to"]]
        pairs = [(round(c, 2), v["panel_run_out"][0] + (c - v["panel_run_clip"][0])) for c in starts]  # where the panel shows clip second c
    res = []
    for c, exp in pairs:
        i0 = int((exp - 0.25) * 1000); i1 = int((exp + 0.4) * 1000)
        k = np.where(env[i0:i1] > gate)[0]
        heard = (i0 + k[0]) / 1000 if len(k) else None
        res.append((round(c, 2), round(exp, 3), None if heard is None else round(heard, 3), None if heard is None else round((heard - exp) * 1000)))
        vrows.append(res[-1])
    span = f"clip {v['clip_from']:.2f}-{v['clip_to']:.2f}" if v["clip_from"] is not None else f"file {v['file_from']:.2f}-{v['file_to']:.2f}, placed by rule"
    print(f"   {v['source']:20} out {v['out']:8.3f}-{v['out_end']:8.3f} ({span}) "
          f"{'line starts ' + str(res) if res else 'continues a line (no line starts inside this slice)'}")
off = [r[3] for r in vrows if r[3] is not None]
print(f"   {len(off)} line starts heard; offset from the sheet time: median {np.median(np.abs(off)):.0f} ms, max {max(np.abs(off)):.0f} ms")

# ---- 3. loudness
m = pyln.Meter(SR)
print(f"loudness (pyloudnorm): integrated {m.integrated_loudness(mix):.2f} LUFS")
up_pk = build.true_peak_db(mix)
print(f"true peak (4x oversampled): {up_pk:.2f} dBTP; sample peak {db(np.abs(mix).max()):.2f} dBFS")
for n, a, b in [("story 0-205", 0, 205), ("  clinic 127-187 (voices)", 127, 187), ("explainer 205-292.8", 205, 292.8),
                ("sober 292.8-445.8", 292.8, 445.8), ("end card 445.8-455.8", 445.8, 455.8)]:
    print(f"   {n:28} {m.integrated_loudness(mix[int(a * SR):int(b * SR)]):7.2f} LUFS")
r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", build.OUT_WAV, "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"],
                   capture_output=True, text=True)
summ = r.stderr[r.stderr.rfind("Summary:"):]
print("ffmpeg ebur128:", " ".join(summ.split()))
r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", build.OUT_WAV, "-af", "loudnorm=I=-16:TP=-1:LRA=11:print_format=json", "-f", "null", "-"],
                   capture_output=True, text=True)
j = json.loads(r.stderr[r.stderr.rfind("{"):r.stderr.rfind("}") + 1])
print("ffmpeg loudnorm (measure only):", {k: j[k] for k in ("input_i", "input_tp", "input_lra", "input_thresh")})
