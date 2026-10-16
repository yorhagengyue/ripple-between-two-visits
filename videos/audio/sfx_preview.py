# Render one instance of every sound the logs need into audio/preview-sfx/ and print a sanity line for each:
# duration, where its peak and its detected onset fall, spectral centroid; and list words that map to nothing.
import json, os, sys
import numpy as np, soundfile as sf
from common import SR, AUD, PROMO, first_onset, db
import sfxlib

out = f"{AUD}/preview-sfx"; os.makedirs(out, exist_ok=True)
words = {}
for f in os.listdir(f"{PROMO}/out"):
    if f.startswith("log-") and f.endswith(".json") and f != "log-test.json":
        for w in json.load(open(f"{PROMO}/out/{f}", encoding="utf-8"))["sfx"]:
            words.setdefault(w["txt"], w["hit"])
rng = np.random.default_rng(1)
for txt, src in sorted(words.items(), key=lambda kv: kv[1]):
    c = sfxlib.classify(txt, src)
    if c is None: print(f"{src:8.2f} {txt!r:28} -> (no sound)"); continue
    if c == "unknown": print(f"{src:8.2f} {txt!r:28} -> UNKNOWN"); continue
    name, fn, kw, base, soft = c
    y, hit = fn(rng, **kw); y = sfxlib.finish(y)
    m = y if y.ndim == 1 else y.mean(1)
    on = first_onset(m)
    pk = np.argmax(np.abs(m)) / SR
    S = np.abs(np.fft.rfft(m)); fr = np.fft.rfftfreq(len(m), 1 / SR); cen = (S * fr).sum() / (S.sum() + 1e-9)
    fn_ = "".join(ch if ch.isalnum() else "_" for ch in txt)[:20]
    sf.write(f"{out}/{src:07.2f}_{fn_}.wav", (y / (np.abs(y).max() + 1e-9) * 0.8).astype(np.float32), SR)
    print(f"{src:8.2f} {txt!r:28} -> {name:32} dur {len(m)/SR:5.2f} peak@{pk:5.3f} onset@{on:5.3f} hit_at {hit if hit is not None else '-'}  cen {cen:6.0f} Hz  nan {np.isnan(m).any()}")
