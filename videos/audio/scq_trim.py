# scq_trim.py: after scq_lines.py, drop the tiny blips (< 50 ms) at either end of the two Scq takes and trim again to
# 0.03 s before the first spoken phrase and 0.08 s after the last, so the voice starts on the bubble's first frame.
# Updates voices-v5.json (duration, phrases, env) and sets c07-wei-sunday's second_line_at from the waveform: the start
# of the phrase "You went to the market early." (Whisper's word times run early here).
#   D:/AI/whisper-env/Scripts/python.exe -I D:/ripple-c2/film/promo/audio/scq_trim.py
import json
from pathlib import Path
import numpy as np, soundfile as sf

HERE = Path(__file__).resolve().parent
TABLE = json.load(open(HERE / "voices-v5.json", encoding="utf-8"))


def rms_db(x, sr, step):
    hop = int(sr * step); n = len(x) // hop
    return np.array([20 * np.log10(np.sqrt(np.mean(x[i * hop:(i + 1) * hop] ** 2) + 1e-12)) for i in range(n)])


def phrases(x, sr, gate=-40, gap=0.12):
    on = rms_db(x, sr, 0.01) > gate; out = []; i = 0; n = len(on)
    while i < n:
        if on[i]:
            j = i
            while j < n and on[j]: j += 1
            s, e = i * 0.01, j * 0.01
            if out and s - out[-1][1] < gap: out[-1] = (out[-1][0], e)
            else: out.append((s, e))
            i = j
        else: i += 1
    return [p for p in out if p[1] - p[0] >= 0.05]


def env15(x, sr):
    d = rms_db(x, sr, 1 / 15); top = d.max()
    return "".join(str(int(np.clip(round((v - (top - 36)) / 36 * 9), 0, 9))) for v in d)


for lid in ("c04-wei", "c07-wei-sunday"):
    f = HERE / "voices-v5" / f"{lid}.wav"
    x, sr = sf.read(f); x = x if x.ndim == 1 else x.mean(1)
    ph = phrases(x, sr)
    a, b = ph[0][0], ph[-1][1]
    y = x[max(0, int((a - 0.03) * sr)): int((b + 0.08) * sr)]
    sf.write(f, y, sr)
    ph2 = [(round(s, 3), round(e, 3)) for s, e in phrases(y, sr)]
    e = TABLE[lid]
    e.update({"duration": round(len(y) / sr, 3), "phrases": ph2, "env": env15(y, sr)})
    if lid == "c07-wei-sunday": e["second_line_at"] = round(ph2[-1][0], 2)
    print(lid, e["duration"], ph2, e.get("second_line_at"), len(e["env"]))
json.dump(TABLE, open(HERE / "voices-v5.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
