# A spectrogram strip (mel-ish log frequency) of out/audio-v3.wav or a stem, with the cue marks, for eyeballing.
#   python specplot.py <wav> <start> <dur> <png>
import sys, json
import numpy as np, soundfile as sf
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
p, a, d, out = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4]
x, sr = sf.read(p, start=int(a * 48000), stop=int((a + d) * 48000)); m = x.mean(1) if x.ndim > 1 else x
fig, ax = plt.subplots(2, 1, figsize=(16, 7), sharex=True, gridspec_kw={"height_ratios": [3, 1]})
ax[0].specgram(m, NFFT=2048, Fs=sr, noverlap=1536, cmap="magma", vmin=-130, vmax=-20, xextent=(a, a + d))
ax[0].set_yscale("symlog", linthresh=200); ax[0].set_ylim(30, 16000); ax[0].set_ylabel("Hz")
cues = json.load(open("D:/ripple-c2/film/promo/out/audio-v3-cues.json", encoding="utf-8"))
for c in cues["sfx"]:
    if a <= c["out"] <= a + d:
        ax[0].axvline(c["out"], color="cyan", lw=0.6, alpha=0.7); ax[0].text(c["out"], 12000, c["word"], color="cyan", fontsize=7, rotation=90, va="top")
for v in cues["voices"]:
    if v["out"] < a + d and v["out_end"] > a: ax[1].axvspan(max(a, v["out"]), min(a + d, v["out_end"]), color="orange", alpha=0.3)
hop = 480; n = len(m) // hop
r = 20 * np.log10(np.sqrt((m[: n * hop].reshape(n, hop) ** 2).mean(1)) + 1e-9)
ax[1].plot(a + np.arange(n) * hop / sr, r, lw=0.6); ax[1].set_ylim(-60, 0); ax[1].set_ylabel("dBFS rms 10ms")
plt.tight_layout(); plt.savefig(out, dpi=80)
