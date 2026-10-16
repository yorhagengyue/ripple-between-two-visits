# Loudness of a stem (or the final mix) per section, and a short-term loudness strip every 5 s.
import sys, json
import numpy as np, soundfile as sf, pyloudnorm as pyln
x, sr = sf.read(sys.argv[1], dtype="float64")
m = pyln.Meter(sr)
secs = [("story", 0, 205), ("c07 clinic", 127, 187), ("explainer", 205, 292.8), ("sober", 292.8, 445.8), ("end card", 445.8, 455.8)]
print(f"{sys.argv[1]}: {len(x)} samples = {len(x)/sr:.4f} s, integrated {m.integrated_loudness(x):.2f} LUFS, sample peak {20*np.log10(np.abs(x).max()):.2f} dBFS")
for n, a, b in secs:
    seg = x[int(a * sr):int(b * sr)]
    print(f"  {n:12} {a:6.1f}-{b:6.1f}  {m.integrated_loudness(seg):7.2f} LUFS")
if len(sys.argv) > 2:
    st = []
    for t in np.arange(0, len(x) / sr - 3, 5):
        st.append(round(m.integrated_loudness(x[int(t * sr):int((t + 3) * sr)]), 1))
    print("  short-term every 5 s:", st)
