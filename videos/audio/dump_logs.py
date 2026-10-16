# List every logged sound word and flash, mapped to output time through edl-v3.json.
import json, os, sys, math
sys.path.insert(0, "D:/ripple-c2/film/promo")
import edl
R = "D:/ripple-c2/film/promo"
e, segs, total = edl.load(f"{R}/edl-v3.json")
logs = [f for f in os.listdir(f"{R}/out") if f.startswith("log-") and f.endswith(".json") and f != "log-test.json"]
sfx, fl, fr = [], [], []
for f in logs:
    d = json.load(open(f"{R}/out/{f}", encoding="utf-8"))
    sfx += d["sfx"]; fl += d["flash"]; fr += d["frames"]
def outt(src):
    for s in segs:
        if s["a"] - 1e-6 <= src < s["b"] - 1e-6: return s["oa"] / 30 + (src - s["a"]), s["name"]
    return None, None
seen = []
for w in sorted(sfx, key=lambda w: w["hit"]):
    if any(w["txt"] == v["txt"] and abs(w["hit"] - v["hit"]) < 0.05 for v in seen): continue
    seen.append(w)
    ff = math.ceil(w["hit"] * 30 - 1e-3) / 30
    o, n = outt(ff)
    print(f"{w['hit']:8.3f} first {ff:8.3f} out {o if o is None else round(o,3)!s:>8}  x{w['x']:6.0f} s{w['size']:4.0f}  {w['txt']}")
print("flashes:", sorted(set(round(x, 3) for x in fl)))
