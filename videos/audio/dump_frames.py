# Summarise the app-panel frames: per clip, runs of frames where the source second advances 1:1 (or holds / jumps).
import json, os, sys
sys.path.insert(0, "D:/ripple-c2/film/promo")
import edl
R = "D:/ripple-c2/film/promo"
e, segs, total = edl.load(f"{R}/edl-v3.json")
fr = []
for f in os.listdir(f"{R}/out"):
    if f.startswith("log-") and f.endswith(".json") and f != "log-test.json":
        fr += json.load(open(f"{R}/out/{f}", encoding="utf-8"))["frames"]
by = {}
for x in fr: by.setdefault(x["clip"], {}).setdefault(round(x["t"] * 30), set()).add(x["sec"])
for clip, d in sorted(by.items()):
    print("==", clip)
    frames = sorted(d)
    run = None
    def flush(r):
        if r: print(f"   film {r[0]/30:8.3f}-{(r[1]+1)/30:8.3f}  sec {r[2]:7.3f}-{r[3]:7.3f}  {r[4]}  multi={r[5]}")
    for i in frames:
        secs = sorted(d[i]); s = secs[0]; multi = len(secs) > 1
        if run and i == run[1] + 1:
            ds = s - run[3]
            kind = "1:1" if abs(ds - 1 / 30) < 0.004 else "hold" if abs(ds) < 1e-6 else f"x{ds*30:.2f}"
            if kind == run[4] or run[4] == "?":
                run = [run[0], i, run[2], s, kind, run[5] or multi]; continue
        flush(run); run = [i, i, s, s, "?", multi]
    flush(run)
