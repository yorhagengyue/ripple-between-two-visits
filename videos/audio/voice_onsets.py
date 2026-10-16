# Print where speech starts and stops in each voice wav (20 ms RMS frames, -40 dBFS gate).
import sys, numpy as np, soundfile as sf
def runs(path, gate_db=-40, min_gap=0.35):
    x, sr = sf.read(path, dtype="float32")
    if x.ndim > 1: x = x.mean(1)
    hop = int(sr * 0.01); n = len(x) // hop
    rms = np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, 1) + 1e-12)
    db = 20 * np.log10(rms)
    on = db > gate_db
    out = []; i = 0
    while i < n:
        if on[i]:
            j = i
            while j < n and (on[j] or (np.any(on[j:j + int(min_gap * 100)]))): j += 1
            out.append((i / 100, j / 100)); i = j
        else: i += 1
    # refine each onset to the sample: first sample above 10x the floor within the first frame
    return out, len(x) / sr, db.max()
for p in sys.argv[1:]:
    r, dur, pk = runs(p)
    print(p, f"dur {dur:.3f} peak {pk:.1f} dB")
    for a, b in r: print(f"   {a:7.2f} - {b:7.2f}")
